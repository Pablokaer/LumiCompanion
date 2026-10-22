import { app, desktopCapturer, dialog, globalShortcut, Notification, powerMonitor, screen, session, shell } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AgentStatus, AssignmentResult, CaptureResult, ChatMessage, ConfirmRequest, EmailDraft, LumiEvent, LumiEvents, NewEventInput, PickedFile, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { handle, sendEvent } from './ipc';
import { isAllowedExternalUrl } from '../shared/meeting';
import type { SystemKind } from '../shared/notices';
import type { RoutineInput } from '../shared/routines';
import { isUnderstood, parseQuickEvent, toEventInput } from '../shared/quickParse';
import { weatherSummary } from '../shared/weather';
import { runAgent, type AgentDeps } from './agent/agent';
import { applyMemoryFlags } from './memoryFlags';
import { draftReply, eventFromText, suggestEventFromEmail } from './agent/mailTools';
import { LocalAi } from './agent/localAi';
import { OllamaSetup } from './agent/ollamaSetup';
import { answerAssignment } from './docs/assignment';
import { SUPPORTED_EXTENSIONS } from './docs/extract';
import { fetchSite, searchArticles, searchNews } from './routines/feeds';
import { dropSession, getAuthState, getProfile, hasScope, signIn, signOut } from './google/auth';
import { createEvent, listEventsInRange, listUpcomingEvents } from './google/calendar';
import { createDraft, getFullEmail, searchEmails } from './google/gmail';
import { briefingDate, buildBriefing, shouldShowBriefing } from './services/briefing';
import { DndService } from './services/dnd';
import { FocusService } from './services/focus';
import { Interruptions } from './services/interruptions';
import { RoutineService } from './services/routines';
import { SyncService } from './services/sync';
import { WeatherService } from './services/weather';
import { startPerfLog } from './perf';
import { QuickCapture } from './quickCapture';
import { RELEASES_PAGE, UpdateService } from './updater';
import { LANGUAGE_NAMES, transcribe } from './voice/transcribe';
import { clearTokens, getSettings, loadDotEnv, onSettingsChanged, routineStorage, updateSettings } from './store';
import { createTray, rebuildTrayMenu, setPendingUpdate } from './tray';
import { applyWidgetMode, createWidgetWindow, currentScale, getWindow, peek, refreshWindowSize, setWindowMode, toggleWindow } from './window';

loadDotEnv(path.join(__dirname, '../..'));

// The widget sits behind other windows; without this Chromium treats it as hidden and throttles its
// timers and animation frames, which would make the dancing stutter.
// Also sets the memory switches (about 60% less memory, see memoryFlags.ts). Must run before the app is ready.
applyMemoryFlags(app, ['CalculateNativeWinOcclusion']);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { const w = getWindow(); w?.show(); w?.focus(); });
  app.whenReady().then(bootstrap);
}

const sync = new SyncService();
const pendingConfirms = new Map<string, (approved: boolean) => void>();
const pickedFiles = new Set<string>();
const focus = new FocusService();
const updates = new UpdateService();
const ollamaSetup = new OllamaSetup();
const localAi = new LocalAi({
  getSettings,
  setup: (url, model) => ollamaSetup.ensure(url, model),
  allowSetup: !process.env.LUMI_NO_AUTOSETUP,
});
let notifiedUpdate = '';

const dnd = new DndService({
  getSettings,
  getEvents: () => sync.data.events,
  saveManual: (untilMs) => { updateSettings({ dndUntil: untilMs }); },
});
const weather = new WeatherService({ getSettings });
const routines = new RoutineService({
  storage: routineStorage,
  runner: {
    getSettings,
    // A "task" routine: the agent follows the user's instructions with nobody there, so it can only read.
    runTask: async (routine) => {
      await localAi.require();
      return runAgent([{ role: 'user', content: routine.target }], {
        ...agentDeps(),
        unattended: true,
        onStatus: () => undefined,
        confirm: async () => false,
      });
    },
  },
});
const quick = new QuickCapture();
let hiddenByDnd = false;
/** The screen is locked or the computer is asleep. */
let screenLocked = false;

const showWindow = () => { const w = getWindow(); w?.show(); w?.focus(); };

/** What may interrupt you, and when: quiet mode, focus and "calendar pop-ups only" are decided there. */
const interruptions = new Interruptions({
  quiet: () => ({ dnd: dnd.state.active, focus: !!focus.current, calendarOnly: getSettings().calendarPopupsOnly }),
  showReminder: (r) => send('reminder', r),
  peek: (ms) => peek(ms),
  systemNotify: (title, body, onClick) => {
    if (!getSettings().systemNotifications || !Notification.isSupported()) return false;
    const n = new Notification({ title: `${getSettings().mascotName} ✦ ${title}`, body, silent: false });
    if (onClick) n.on('click', onClick);
    n.show();
    return true;
  },
  onReminderClick: (r) => {
    // Clicking a reminder joins the call (only links to known meeting services), or opens Lumi.
    if (r.event.joinUrl && isAllowedExternalUrl(r.event.joinUrl)) void shell.openExternal(r.event.joinUrl);
    else showWindow();
  },
});

function showBriefing(markShown: boolean) {
  void getProfile().catch(() => undefined).then((p) => {
    const briefing = buildBriefing(sync.data.events, sync.data.emails, new Date(), p?.name, weatherSummary(weather.state, getSettings().temperatureUnit));
    send('briefing', briefing);
    interruptions.notify(briefing.title, briefing.lines.slice(0, 4).join('\n'), { peek: 30_000 });
    if (markShown) updateSettings({ lastBriefingDate: briefingDate(new Date()) });
  });
}

function checkBriefing() {
  if (!sync.data.lastSync || !interruptions.briefingMayShow() || !shouldShowBriefing(getSettings())) return; // while quiet, it waits
  showBriefing(true);
}

const send = <K extends LumiEvent>(channel: K, ...payload: LumiEvents[K] extends undefined ? [] : [LumiEvents[K]]) => sendEvent(getWindow()?.webContents, channel, ...payload);

function applySystemSettings(s: Settings = getSettings()) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  applyWidgetMode(s.widgetMode);
  sync.setReminderLeads(s.reminderLeadMinutes);
}

async function bootstrap() {
  app.setAppUserModelId('com.finperiti.lumi'); // Windows notifications
  if (process.platform === 'darwin') app.dock?.hide(); // live in the menu bar, not the dock

  // Microphone access is only granted to Lumi's own window, for voice input.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === 'media' || (permission === 'display-capture' && getSettings().reactToMusic)));
  // Music detection listens to the system's audio output ("loopback"). Only audio is granted, and only
  // while the setting is on; the renderer drops the video track at once and analyses audio in memory.
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    if (!getSettings().reactToMusic) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'] });
      callback({ video: sources[0], audio: 'loopback' });
    } catch { callback({}); }
  }, { useSystemPicker: false });

  startPerfLog(); // LUMI_PERF=1: CPU use per process every 5 s
  registerIpc();
  const widget = createWidgetWindow();
  createTray({ state: () => dnd.state, set: (ms) => dnd.setManual(ms) });
  applySystemSettings();
  // Every saved change, from the panel, the tray or the app itself, ends up here.
  onSettingsChanged((next, changed) => {
    const has = (...keys: (keyof Settings)[]) => keys.some((k) => changed.includes(k));
    applySystemSettings(next);
    if (has('widgetView', 'widgetScale', 'panelScale')) refreshWindowSize();
    if (has('emailLookbackDays', 'aiEmailTriage')) void sync.refreshEmails();
    if (has('dndFullscreen', 'dndMeetings', 'dndUntil')) dnd.applySettings();
    if (has('weather', 'weatherPlace')) { if (next.weather) weather.start(); else { weather.stop(); void weather.refresh(); } }
    if (has('quickCapture', 'quickCaptureShortcut')) quick.apply(next.quickCapture, next.quickCaptureShortcut);
    rebuildTrayMenu();
    send('settings:changed');
  });

  globalShortcut.register('CommandOrControl+Shift+L', () => toggleWindow());

  sync.on('updated', (snapshot) => send('data:updated', snapshot));
  sync.on('signed-out', async () => { sync.reset(); dropSession(); send('auth:changed', await getAuthState()); });
  sync.on('reminder', (r: ReminderPayload) => interruptions.reminder(r));

  focus.on('changed', (state) => {
    send('focus:changed', state);
    interruptions.quietChanged();
  });
  focus.on('done', (state: { minutes: number }) => {
    interruptions.notify('Focus session complete', `${state.minutes} focused minutes — nice work! Time for a short break.`, { peek: true });
  });
  setInterval(checkBriefing, 60_000);
  updates.on('state', (s) => {
    send('update:state', s);
    // The tray offers a restart as soon as a downloaded update is waiting, for people who never open the panel.
    setPendingUpdate(s.status === 'ready' && s.version ? { version: s.version, install: () => updates.install() } : undefined);
    rebuildTrayMenu();
    // With automatic installs a new version downloads by itself, so there is nothing to click until it is ready.
    const automatic = getSettings().autoInstallUpdates && !s.notifyOnly;
    const worthTellingAbout = s.status === 'ready' || (s.status === 'available' && !automatic);
    if (worthTellingAbout && s.version && notifiedUpdate !== s.version) {
      const body = s.status === 'ready'
        ? (automatic ? 'It installs by itself when you are away. Use the tray menu to restart now.' : 'Restart Lumi to finish updating.')
        : s.notifyOnly ? 'Open Lumi to download the new version.' : 'Open Lumi and click Update.';
      if (interruptions.notify(`Lumi ${s.version} is ${s.status === 'ready' ? 'ready' : 'available'}`, body)) notifiedUpdate = s.version;
    }
  });
  updates.start(() => getSettings().autoUpdate, {
    autoInstall: () => getSettings().autoInstallUpdates,
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    focusActive: () => !!focus.current,
  });
  // A computer that was asleep or locked has not been checking: look as soon as it is back.
  powerMonitor.on('resume', () => void updates.checkSoon());
  powerMonitor.on('unlock-screen', () => void updates.checkSoon());
  widget.on('show', () => void updates.checkSoon());

  // The star's eyes follow the cursor anywhere on screen, but a web page only sees the mouse inside its
  // own window, so the cursor position (relative to the window) is sent from here, only when it moves.
  let lastCursor = '';
  setInterval(() => {
    const win = getWindow();
    if (!win || !win.isVisible() || !getSettings().followMouse) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // The page is zoomed by the widget scale, so its CSS pixels are not the window's pixels.
    const z = currentScale();
    const x = Math.round((p.x - b.x) / z), y = Math.round((p.y - b.y) / z);
    const key = `${x},${y}`;
    if (key === lastCursor) return;
    lastCursor = key;
    send('cursor', { x, y });
  }, 33);
  // Tell the star how long the computer has been idle so she can fall asleep (and wake up).
  setInterval(() => send('activity', { idleSeconds: powerMonitor.getSystemIdleTime() }), 5_000);
  ollamaSetup.on('state', (s) => send('ollama:setup', s));
  // The local AI is off until you start it in Chat, unless you asked for it when Lumi opens.
  localAi.on('state', (s) => send('ai:state', s));
  if (getSettings().startAiOnLaunch) setTimeout(() => void localAi.start(), 8_000);

  // ---- do not disturb ----
  dnd.on('state', (state, was) => {
    send('dnd:state', state);
    rebuildTrayMenu();
    // A full-screen app in front: get out of the way entirely, and come back afterwards.
    const win = getWindow();
    if (state.active && state.reason === 'fullscreen' && getSettings().dndHideWidget && win?.isVisible()) { win.hide(); hiddenByDnd = true; }
    if (!state.active && hiddenByDnd) { hiddenByDnd = false; win?.showInactive(); }
    // Back to normal: tell her about anything that came due in the meantime.
    if (was.active && !state.active) interruptions.quietChanged();
  });
  dnd.start();

  // ---- routines: daily jobs that put new articles in the News tab ----
  routines.on('changed', () => { send('routines:updated', routines.list()); send('news:updated', routines.news()); });
  routines.on('news', (items: { title: string; summary?: string; body?: string }[], routine: { name: string }) => {
    // In "calendar pop-ups only" mode there is no pop-up; the items are still in the News tab.
    interruptions.notify(items[0]?.body ? routine.name : `${items.length} new in “${routine.name}”`, items.slice(0, 3).map((i) => `• ${i.body ? i.summary ?? i.title : i.title}`).join('\n'), { chatter: true, onClick: showWindow });
  });
  routines.start();

  // ---- weather ----
  weather.on('state', (s) => send('weather:state', s));
  if (getSettings().weather) weather.start();

  // ---- quick capture shortcut ----
  const shortcut = quick.apply(getSettings().quickCapture, getSettings().quickCaptureShortcut);
  if (!shortcut.ok) interruptions.notify('Quick capture is not available', shortcut.error ?? 'Choose another shortcut in Settings → Quick capture.');

  // ---- tell the window when nobody can see her, so her animation loop stops ----
  // (The window keeps running in the background on purpose, so the page cannot tell by itself that it is hidden.)
  const sendPower = () => send('power', { hidden: !widget.isVisible() || widget.isMinimized() || screenLocked });
  widget.on('show', sendPower);
  widget.on('hide', sendPower);
  widget.on('minimize', sendPower);
  widget.on('restore', sendPower);
  const setLocked = (locked: boolean) => () => { screenLocked = locked; sendPower(); };
  powerMonitor.on('lock-screen', setLocked(true));
  powerMonitor.on('suspend', setLocked(true));
  powerMonitor.on('unlock-screen', setLocked(false));
  powerMonitor.on('resume', setLocked(false));

  // ---- system events the star can react to (lock, unlock, sleep, wake, plugging in) ----
  const systemEvent = (kind: SystemKind) => () => { if (getSettings().reactToSystem) send('system', { kind }); };
  powerMonitor.on('lock-screen', systemEvent('lock-screen'));
  powerMonitor.on('unlock-screen', systemEvent('unlock-screen'));
  powerMonitor.on('suspend', systemEvent('suspend'));
  powerMonitor.on('resume', systemEvent('resume'));
  powerMonitor.on('on-ac', systemEvent('on-ac'));
  powerMonitor.on('on-battery', systemEvent('on-battery'));

  if ((await getAuthState()).signedIn) sync.start();
}

/** What the agent can use, for the chat and for routines. */
function agentDeps(): AgentDeps {
  return {
    getSettings,
    getProfile: () => getProfile(),
    listEvents: (days) => (days <= 7 && sync.data.events.length ? Promise.resolve(sync.data.events) : listUpcomingEvents(days)),
    getImportantEmails: async () => (sync.data.emails.length ? sync.data.emails : (await sync.refreshEmails(), sync.data.emails)),
    searchEmails: (q) => searchEmails(q, 10),
    createEvent: async (input) => { const ev = await createEvent(input); void sync.refreshEvents(); return ev; },
    listRoutines: () => routines.list(),
    saveRoutine: (input) => routines.save(input),
    removeRoutine: (id) => routines.remove(id),
    onStatus: (status: AgentStatus) => send('agent:status', status),
    confirm: (req) =>
      new Promise<boolean>((resolve) => {
        const full: ConfirmRequest = { ...req, id: crypto.randomUUID() };
        pendingConfirms.set(full.id, resolve);
        send('agent:confirm', full);
        // Auto-decline after 5 minutes so the agent never hangs forever.
        setTimeout(() => { if (pendingConfirms.delete(full.id)) resolve(false); }, 5 * 60_000);
      }),
    searchNews: (q, language) => searchNews(q, language),
    searchArticles: (q) => searchArticles(q),
    readWebsite: (url) => fetchSite(url).then((r) => r.items),
  };
}

function registerIpc() {
  // --- Auth ---
  handle('auth:getState', () => getAuthState());
  handle('auth:signIn', async () => {
    const state = await signIn();
    getWindow()?.show();
    getWindow()?.focus();
    if (state.signedIn) sync.start();
    return state;
  });
  handle('auth:signOut', async () => { sync.reset(); return signOut(); });

  // --- Data ---
  handle('data:get', () => sync.data);
  handle('data:refresh', () => sync.refreshAll());
  handle('data:createEvent', async (_e, input: NewEventInput) => {
    const created = await createEvent(input);
    void sync.refreshEvents();
    return created;
  });

  handle('data:getRange', (_e, fromIso: string, toIso: string) => {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from) throw new Error('Invalid date range.');
    if (+to - +from > 62 * 86_400_000) throw new Error('Date range is too large.');
    return listEventsInRange(from, to);
  });

  // --- Agent ---
  handle('agent:setupOllama', () => ollamaSetup.ensure(getSettings().ollamaUrl, getSettings().ollamaModel));
  handle('agent:setupState', () => ollamaSetup.current);
  handle('agent:ollamaStatus', () => localAi.state());
  handle('agent:startAi', () => localAi.start());
  handle('agent:stopAi', () => localAi.stop());
  handle('agent:respondConfirm', (_e, id: string, approved: boolean) => {
    pendingConfirms.get(id)?.(approved);
    pendingConfirms.delete(id);
  });
  handle('agent:send', async (_e, history: ChatMessage[]) => {
    await localAi.require();
    return runAgent(history, agentDeps());
  });

  // --- Do not disturb ---
  handle('dnd:get', () => dnd.state);
  handle('dnd:set', (_e, untilMs: number | null) => {
    dnd.setManual(typeof untilMs === 'number' && Number.isFinite(untilMs) && untilMs > Date.now() ? untilMs : null);
    return dnd.state;
  });

  // --- Weather ---
  handle('weather:get', () => weather.state);
  handle('weather:refresh', () => weather.refresh());

  // --- Quick capture ---
  handle('capture:parse', async (_e, text: string): Promise<CaptureResult> => {
    const input = String(text ?? '').slice(0, 300).trim();
    if (!input) return { event: { title: '', start: '' }, understood: false, via: 'none' };
    const parsed = parseQuickEvent(input);
    if (isUnderstood(parsed)) return { event: toEventInput(parsed), understood: true, via: 'rules' };
    // No date or time in the words: ask the local model, if it happens to be running.
    try {
      if (await localAi.isOn()) {
        const event = await eventFromText(input, getSettings());
        if (event) return { event, understood: true, via: 'ai' };
      }
    } catch { /* fall through to the plain form */ }
    return { event: { title: parsed.title, start: '' }, understood: false, via: 'none' };
  });
  handle('capture:close', () => quick.hide());
  handle('capture:setShortcut', (_e, accelerator: string) => {
    const result = quick.apply(true, String(accelerator ?? ''));
    if (result.ok) updateSettings({ quickCapture: true, quickCaptureShortcut: String(accelerator).trim() });
    else quick.apply(getSettings().quickCapture, getSettings().quickCaptureShortcut); // put the previous shortcut back
    return result;
  });

  // --- Updates ---
  handle('update:getState', () => updates.current);
  handle('update:check', () => updates.check(true));
  handle('update:download', () => updates.download());
  handle('update:install', () => updates.install());
  handle('update:openDownload', () => shell.openExternal(RELEASES_PAGE));

  // --- Music detection ---
  handle('music:requestStart', () => {
    if (!getSettings().reactToMusic) return;
    // `true` simulates a user gesture, which Chromium requires for getDisplayMedia.
    return getWindow()?.webContents
      .executeJavaScript('window.__lumiMusicStart && window.__lumiMusicStart()', true)
      .then(() => undefined, () => undefined);
  });

  // --- Focus timer ---
  handle('focus:get', () => focus.current);
  handle('focus:start', (_e, minutes: number) => focus.start(minutes));
  handle('focus:stop', () => focus.stop());

  // --- Morning briefing ---
  handle('briefing:show', () => showBriefing(false));

  // --- Mail helpers: draft a reply, turn an email into an event ---
  const EMAIL_ADDRESS = /^[^\s<>@,;]+@[^\s<>@,;]+$/;
  handle('mail:draftReply', async (_e, emailId: string, instructions?: string): Promise<EmailDraft> => {
    await localAi.start(); // an explicit AI action turns the AI on
    await localAi.require();
    const [email, profile] = await Promise.all([getFullEmail(String(emailId)), getProfile().catch(() => undefined)]);
    return draftReply(email, instructions ? String(instructions).slice(0, 1000) : undefined, profile?.name, getSettings());
  });
  handle('mail:saveDraft', async (_e, draft: EmailDraft) => {
    if (!hasScope('gmail.compose')) throw new Error('Lumi needs permission to save Gmail drafts. Sign out in Settings and sign in again, then accept the new access.');
    if (!EMAIL_ADDRESS.test(String(draft?.to ?? '').trim())) throw new Error('The recipient is not a valid email address.');
    if (!String(draft.body ?? '').trim()) throw new Error('The draft is empty.');
    await createDraft({ ...draft, to: draft.to.trim() });
    return { url: 'https://mail.google.com/mail/u/0/#drafts' };
  });
  handle('mail:suggestEvent', async (_e, emailId: string) => {
    await localAi.start(); // an explicit AI action turns the AI on
    await localAi.require();
    return suggestEventFromEmail(await getFullEmail(String(emailId)), getSettings());
  });

  // --- Voice input (local Whisper) ---
  handle('voice:transcribe', async (_e, samples: Float32Array) => {
    if (!(samples instanceof Float32Array)) throw new Error('Invalid audio.');
    const pref = getSettings().voiceLanguage;
    const code = pref === 'system' ? app.getLocale().slice(0, 2).toLowerCase() : pref;
    try {
      return await transcribe(samples, app.getPath('userData'), LANGUAGE_NAMES[code] ?? 'english', (p) =>
        send('agent:status', { state: 'progress', message: `Downloading the speech model… ${p}%` }));
    } finally {
      send('agent:status', { state: 'idle' });
    }
  });

  // --- Documents (answer an assignment file into a Google Doc) ---
  handle('docs:pickFile', async (): Promise<PickedFile | undefined> => {
    const win = getWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a document with questions',
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: SUPPORTED_EXTENSIONS }],
    };
    const { canceled, filePaths } = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (canceled || !filePaths[0]) return undefined;
    pickedFiles.add(filePaths[0]);
    return { path: filePaths[0], name: path.basename(filePaths[0]) };
  });
  handle('docs:answerFile', async (_e, file: string): Promise<AssignmentResult> => {
    // Only files the user chose in the picker may be read.
    if (!pickedFiles.has(file)) throw new Error('Please choose the file again.');
    if (!hasScope('documents')) throw new Error('Lumi needs Google Docs permission. Sign out in Settings and sign in again, then accept the Docs access.');
    await localAi.require();
    try {
      return await answerAssignment(file, { settings: getSettings(), onProgress: (message) => send('agent:status', { state: 'progress', message }) });
    } finally {
      send('agent:status', { state: 'idle' });
    }
  });

  // --- Routines and news ---
  handle('routines:list', () => routines.list());
  handle('routines:save', (_e, input: RoutineInput) => routines.save(input ?? {}));
  handle('routines:remove', (_e, id: string) => routines.remove(String(id)));
  handle('routines:run', (_e, id: string) => routines.run(String(id)));
  handle('news:list', () => routines.news());
  handle('news:open', (_e, id: string) => {
    // Only an address that a routine found (and that is http or https) can be opened.
    const item = routines.news().find((n) => n.id === id);
    if (!item || !/^https?:\/\//i.test(item.url)) return;
    routines.markRead(item.id);
    return shell.openExternal(item.url);
  });
  handle('news:markRead', (_e, id?: string) => routines.markRead(id ? String(id) : undefined));
  handle('news:dismiss', (_e, id: string) => routines.dismiss(String(id)));
  handle('news:clearRead', () => routines.clearRead());

  // --- Settings ---
  handle('settings:get', () => getSettings());
  handle('settings:update', (_e, patch: Partial<Settings>) => updateSettings(patch)); // side effects: onSettingsChanged in bootstrap

  // --- Window ---
  handle('window:setMode', (_e, mode: WindowMode) => setWindowMode(mode));
  handle('window:hide', () => getWindow()?.hide());
  handle('window:openExternal', (_e, url: string) => {
    // Only Google pages and video-meeting services, over https, may be opened from the interface.
    if (isAllowedExternalUrl(String(url))) return shell.openExternal(url);
  });
}

// Quitting also turns off the local AI Lumi started, so nothing keeps running in the background.
let aiStopped = false;
app.on('before-quit', (e) => {
  const stopping = aiStopped ? undefined : localAi.stopForQuit();
  if (!stopping) return;
  e.preventDefault();
  aiStopped = true;
  void Promise.race([stopping, new Promise((r) => setTimeout(r, 4000))]).finally(() => app.quit());
});
app.on('will-quit', () => { updates.applyOnQuit(); if (!getSettings().keepSignedIn) clearTokens(); dnd.stop(); weather.stop(); routines.stop(); quick.dispose(); globalShortcut.unregisterAll(); });
// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => { /* stay alive */ });
