import { app, desktopCapturer, dialog, globalShortcut, ipcMain, Notification, powerMonitor, screen, session, shell } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AgentStatus, AssignmentResult, CaptureResult, ChatMessage, ConfirmRequest, EmailDraft, NewEventInput, PickedFile, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { isAllowedExternalUrl } from '../shared/meeting';
import { isUnderstood, parseQuickEvent, toEventInput } from '../shared/quickParse';
import { weatherSummary } from '../shared/weather';
import { runAgent } from './agent/agent';
import { draftReply, eventFromText, suggestEventFromEmail } from './agent/mailTools';
import { ensureOllama, ollamaStatus } from './agent/ollama';
import { OllamaSetup } from './agent/ollamaSetup';
import { answerAssignment } from './docs/assignment';
import { SUPPORTED_EXTENSIONS } from './docs/extract';
import { getAuthState, getProfile, hasScope, signIn, signOut } from './google/auth';
import { createEvent, listEventsInRange, listUpcomingEvents } from './google/calendar';
import { createDraft, getFullEmail, searchEmails } from './google/gmail';
import { briefingDate, buildBriefing, shouldShowBriefing } from './services/briefing';
import { DndService } from './services/dnd';
import { FocusService, shouldHoldReminder } from './services/focus';
import { SyncService } from './services/sync';
import { WeatherService } from './services/weather';
import { startPerfLog } from './perf';
import { QuickCapture } from './quickCapture';
import { RELEASES_PAGE, UpdateService } from './updater';
import { LANGUAGE_NAMES, transcribe } from './voice/transcribe';
import { clearTokens, getSettings, loadDotEnv, updateSettings } from './store';
import { createTray, rebuildTrayMenu } from './tray';
import { applyWidgetMode, createWidgetWindow, getWindow, peek, refreshWindowSize, setWindowMode, toggleWindow } from './window';

loadDotEnv(path.join(__dirname, '../..'));

// The widget sits behind other windows; without this Chromium treats it as hidden and throttles its
// timers and animation frames, which would make the dancing stutter.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

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
let notifiedUpdate = '';

const dnd = new DndService({
  getSettings,
  getEvents: () => sync.data.events,
  saveManual: (untilMs) => { updateSettings({ dndUntil: untilMs }); },
});
const weather = new WeatherService({ getSettings });
const quick = new QuickCapture();
/** Reminders that came due while she was asked to be quiet; shown when the quiet ends. */
let heldReminders: ReminderPayload[] = [];
let hiddenByDnd = false;
/** The screen is locked or the computer is asleep. */
let screenLocked = false;

/** Shows a system notification, unless notifications are off or do-not-disturb is on. Returns whether it was shown. */
function notify(title: string, body: string, onClick?: () => void): boolean {
  if (!getSettings().systemNotifications || !Notification.isSupported() || dnd.state.active) return false;
  const n = new Notification({ title: `${getSettings().mascotName} ✦ ${title}`, body, silent: false });
  if (onClick) n.on('click', onClick);
  n.show();
  return true;
}

/** Brings the widget to the front for a moment, unless do-not-disturb is on. */
const peekUnlessQuiet = (ms?: number) => { if (!dnd.state.active) peek(ms); };

/** Starts Ollama when it is installed but stopped. Attempts are rate-limited so a broken install is not retried constantly. */
let ollamaAttempt: { at: number; promise: Promise<unknown> } | undefined;
function tryStartOllama() {
  const s = getSettings();
  if (!s.autoStartOllama) return Promise.resolve();
  if (ollamaAttempt && Date.now() - ollamaAttempt.at < 60_000) return ollamaAttempt.promise;
  ollamaAttempt = { at: Date.now(), promise: ensureOllama(s.ollamaUrl) };
  return ollamaAttempt.promise;
}

/** Shows a reminder: in the app, as a popup, and as a notification that joins the call when you click it. */
function announceReminder(r: ReminderPayload) {
  send('reminder', r);
  peekUnlessQuiet();
  const join = r.event.joinUrl && isAllowedExternalUrl(r.event.joinUrl) ? r.event.joinUrl : undefined;
  notify(r.event.title, join ? `${r.message} Click to join the call.` : r.message, () => {
    if (join) { void shell.openExternal(join); return; }
    const w = getWindow(); w?.show(); w?.focus();
  });
}

function showBriefing(markShown: boolean) {
  void getProfile().catch(() => undefined).then((p) => {
    const briefing = buildBriefing(sync.data.events, sync.data.emails, new Date(), p?.name, weatherSummary(weather.state, getSettings().temperatureUnit));
    send('briefing', briefing);
    peekUnlessQuiet(30_000);
    notify(briefing.title, briefing.lines.slice(0, 4).join('\n'));
    if (markShown) updateSettings({ lastBriefingDate: briefingDate(new Date()) });
  });
}

function checkBriefing() {
  if (!sync.data.lastSync || dnd.state.active || !shouldShowBriefing(getSettings())) return; // while quiet, it waits
  showBriefing(true);
}

const send = (channel: string, payload?: unknown) => getWindow()?.webContents.send(channel, payload);

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
  createTray(() => { applySystemSettings(); send('settings:changed'); }, { state: () => dnd.state, set: (ms) => dnd.setManual(ms) });
  applySystemSettings();

  globalShortcut.register('CommandOrControl+Shift+L', () => toggleWindow());

  sync.on('updated', (snapshot) => send('data:updated', snapshot));
  sync.on('signed-out', async () => { sync.reset(); send('auth:changed', await getAuthState()); });
  sync.on('reminder', (r: ReminderPayload) => {
    if (shouldHoldReminder(!!focus.current, r.minutesUntil)) return; // urgent ones (<= 5 min) still come through
    if (dnd.state.active) { heldReminders = [...heldReminders.filter((h) => h.event.id !== r.event.id), r].slice(-5); return; }
    announceReminder(r);
  });

  focus.on('changed', (state) => send('focus:changed', state));
  focus.on('done', (state: { minutes: number }) => {
    peekUnlessQuiet();
    notify('Focus session complete', `${state.minutes} focused minutes — nice work! Time for a short break.`);
  });
  setInterval(checkBriefing, 60_000);
  updates.on('state', (s) => {
    send('update:state', s);
    const worthTellingAbout = s.status === 'ready' || s.status === 'available';
    if (worthTellingAbout && s.version && notifiedUpdate !== s.version) {
      if (notify(`Lumi ${s.version} is available`, s.status === 'ready' ? 'Restart Lumi to finish updating.' : s.notifyOnly ? 'Open Lumi to download the new version.' : 'Open Lumi and click Update.')) notifiedUpdate = s.version;
    }
  });
  updates.start(() => getSettings().autoUpdate);

  // The star's eyes follow the cursor anywhere on screen, but a web page only sees the mouse inside its
  // own window, so the cursor position (relative to the window) is sent from here, only when it moves.
  let lastCursor = '';
  setInterval(() => {
    const win = getWindow();
    if (!win || !win.isVisible() || !getSettings().followMouse) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    // The page is zoomed by the widget scale, so its CSS pixels are not the window's pixels.
    const z = getSettings().widgetScale || 1;
    const x = Math.round((p.x - b.x) / z), y = Math.round((p.y - b.y) / z);
    const key = `${x},${y}`;
    if (key === lastCursor) return;
    lastCursor = key;
    send('cursor', { x, y });
  }, 33);
  // Tell the star how long the computer has been idle so she can fall asleep (and wake up).
  setInterval(() => send('activity', { idleSeconds: powerMonitor.getSystemIdleTime() }), 5_000);
  void tryStartOllama();
  ollamaSetup.on('state', (s) => send('ollama:setup', s));
  // When Ollama or its model is missing, set it up by itself a few seconds after opening (Windows and macOS).
  setTimeout(() => { if (getSettings().autoSetupOllama && !process.env.LUMI_NO_AUTOSETUP) void ollamaSetup.ensure(getSettings().ollamaUrl, getSettings().ollamaModel); }, 8_000);

  // ---- do not disturb ----
  dnd.on('state', (state, was) => {
    send('dnd:state', state);
    rebuildTrayMenu(() => applySystemSettings());
    // A full-screen app in front: get out of the way entirely, and come back afterwards.
    const win = getWindow();
    if (state.active && state.reason === 'fullscreen' && getSettings().dndHideWidget && win?.isVisible()) { win.hide(); hiddenByDnd = true; }
    if (!state.active && hiddenByDnd) { hiddenByDnd = false; win?.showInactive(); }
    // Back to normal: tell her about anything that came due in the meantime.
    if (was.active && !state.active && heldReminders.length) {
      const now = Date.now();
      const relevant = heldReminders.filter((h) => +new Date(h.event.start) > now - 10 * 60_000).sort((a, b) => +new Date(a.event.start) - +new Date(b.event.start));
      heldReminders = [];
      if (relevant.length) {
        announceReminder(relevant[0]);
        if (relevant.length > 1) notify('While you were busy', `${relevant.length} reminders came up: ${relevant.map((h) => h.event.title).join(', ')}.`);
      }
    }
  });
  dnd.start();

  // ---- weather ----
  weather.on('state', (s) => send('weather:state', s));
  if (getSettings().weather) weather.start();

  // ---- quick capture shortcut ----
  quick.apply(getSettings().quickCapture, getSettings().quickCaptureShortcut);

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
  const systemEvent = (kind: string) => () => { if (getSettings().reactToSystem) send('system', { kind }); };
  powerMonitor.on('lock-screen', systemEvent('lock-screen'));
  powerMonitor.on('unlock-screen', systemEvent('unlock-screen'));
  powerMonitor.on('suspend', systemEvent('suspend'));
  powerMonitor.on('resume', systemEvent('resume'));
  powerMonitor.on('on-ac', systemEvent('on-ac'));
  powerMonitor.on('on-battery', systemEvent('on-battery'));

  if ((await getAuthState()).signedIn) sync.start();
}

function registerIpc() {
  // --- Auth ---
  ipcMain.handle('auth:getState', () => getAuthState());
  ipcMain.handle('auth:signIn', async () => {
    const state = await signIn();
    getWindow()?.show();
    getWindow()?.focus();
    if (state.signedIn) sync.start();
    return state;
  });
  ipcMain.handle('auth:signOut', async () => { sync.reset(); return signOut(); });

  // --- Data ---
  ipcMain.handle('data:get', () => sync.data);
  ipcMain.handle('data:refresh', () => sync.refreshAll());
  ipcMain.handle('data:createEvent', async (_e, input: NewEventInput) => {
    const created = await createEvent(input);
    void sync.refreshEvents();
    return created;
  });

  ipcMain.handle('data:getRange', (_e, fromIso: string, toIso: string) => {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from) throw new Error('Invalid date range.');
    if (+to - +from > 62 * 86_400_000) throw new Error('Date range is too large.');
    return listEventsInRange(from, to);
  });

  // --- Agent ---
  ipcMain.handle('agent:setupOllama', () => ollamaSetup.ensure(getSettings().ollamaUrl, getSettings().ollamaModel));
  ipcMain.handle('agent:setupState', () => ollamaSetup.current);
  ipcMain.handle('agent:ollamaStatus', async () => {
    const status = await ollamaStatus(getSettings().ollamaUrl);
    if (!status.running && getSettings().autoStartOllama) await tryStartOllama();
    return status.running ? status : ollamaStatus(getSettings().ollamaUrl);
  });
  ipcMain.handle('agent:respondConfirm', (_e, id: string, approved: boolean) => {
    pendingConfirms.get(id)?.(approved);
    pendingConfirms.delete(id);
  });
  ipcMain.handle('agent:send', async (_e, history: ChatMessage[]) => {
    if (!(await ollamaStatus(getSettings().ollamaUrl)).running) await tryStartOllama();
    return runAgent(history, {
      getSettings,
      getProfile: () => getProfile(),
      listEvents: (days) => (days <= 7 && sync.data.events.length ? Promise.resolve(sync.data.events) : listUpcomingEvents(days)),
      getImportantEmails: async () => (sync.data.emails.length ? sync.data.emails : (await sync.refreshEmails(), sync.data.emails)),
      searchEmails: (q) => searchEmails(q, 10),
      createEvent: async (input) => { const ev = await createEvent(input); void sync.refreshEvents(); return ev; },
      onStatus: (status: AgentStatus) => send('agent:status', status),
      confirm: (req) =>
        new Promise<boolean>((resolve) => {
          const full: ConfirmRequest = { ...req, id: crypto.randomUUID() };
          pendingConfirms.set(full.id, resolve);
          send('agent:confirm', full);
          // Auto-decline after 5 minutes so the agent never hangs forever.
          setTimeout(() => { if (pendingConfirms.delete(full.id)) resolve(false); }, 5 * 60_000);
        }),
    });
  });

  // --- Do not disturb ---
  ipcMain.handle('dnd:get', () => dnd.state);
  ipcMain.handle('dnd:set', (_e, untilMs: number | null) => {
    dnd.setManual(typeof untilMs === 'number' && Number.isFinite(untilMs) && untilMs > Date.now() ? untilMs : null);
    return dnd.state;
  });

  // --- Weather ---
  ipcMain.handle('weather:get', () => weather.state);
  ipcMain.handle('weather:refresh', () => weather.refresh());

  // --- Quick capture ---
  ipcMain.handle('capture:parse', async (_e, text: string): Promise<CaptureResult> => {
    const input = String(text ?? '').slice(0, 300).trim();
    if (!input) return { event: { title: '', start: '' }, understood: false, via: 'none' };
    const parsed = parseQuickEvent(input);
    if (isUnderstood(parsed)) return { event: toEventInput(parsed), understood: true, via: 'rules' };
    // No date or time in the words: ask the local model, if it happens to be running.
    try {
      if ((await ollamaStatus(getSettings().ollamaUrl)).running) {
        const event = await eventFromText(input, getSettings());
        if (event) return { event, understood: true, via: 'ai' };
      }
    } catch { /* fall through to the plain form */ }
    return { event: { title: parsed.title, start: '' }, understood: false, via: 'none' };
  });
  ipcMain.handle('capture:close', () => quick.hide());
  ipcMain.handle('capture:setShortcut', (_e, accelerator: string) => {
    const result = quick.apply(true, String(accelerator ?? ''));
    if (result.ok) updateSettings({ quickCapture: true, quickCaptureShortcut: String(accelerator).trim() });
    else quick.apply(getSettings().quickCapture, getSettings().quickCaptureShortcut); // put the previous shortcut back
    return result;
  });

  // --- Updates ---
  ipcMain.handle('update:getState', () => updates.current);
  ipcMain.handle('update:check', () => updates.check(true));
  ipcMain.handle('update:download', () => updates.download());
  ipcMain.handle('update:install', () => updates.install());
  ipcMain.handle('update:openDownload', () => shell.openExternal(RELEASES_PAGE));

  // --- Music detection ---
  ipcMain.handle('music:requestStart', () => {
    if (!getSettings().reactToMusic) return;
    // `true` simulates a user gesture, which Chromium requires for getDisplayMedia.
    return getWindow()?.webContents
      .executeJavaScript('window.__lumiMusicStart && window.__lumiMusicStart()', true)
      .then(() => undefined, () => undefined);
  });

  // --- Focus timer ---
  ipcMain.handle('focus:get', () => focus.current);
  ipcMain.handle('focus:start', (_e, minutes: number) => focus.start(minutes));
  ipcMain.handle('focus:stop', () => focus.stop());

  // --- Morning briefing ---
  ipcMain.handle('briefing:show', () => showBriefing(false));

  // --- Mail helpers: draft a reply, turn an email into an event ---
  const EMAIL_ADDRESS = /^[^\s<>@,;]+@[^\s<>@,;]+$/;
  ipcMain.handle('mail:draftReply', async (_e, emailId: string, instructions?: string): Promise<EmailDraft> => {
    await tryStartOllama();
    const [email, profile] = await Promise.all([getFullEmail(String(emailId)), getProfile().catch(() => undefined)]);
    return draftReply(email, instructions ? String(instructions).slice(0, 1000) : undefined, profile?.name, getSettings());
  });
  ipcMain.handle('mail:saveDraft', async (_e, draft: EmailDraft) => {
    if (!hasScope('gmail.compose')) throw new Error('Lumi needs permission to save Gmail drafts. Sign out in Settings and sign in again, then accept the new access.');
    if (!EMAIL_ADDRESS.test(String(draft?.to ?? '').trim())) throw new Error('The recipient is not a valid email address.');
    if (!String(draft.body ?? '').trim()) throw new Error('The draft is empty.');
    await createDraft({ ...draft, to: draft.to.trim() });
    return { url: 'https://mail.google.com/mail/u/0/#drafts' };
  });
  ipcMain.handle('mail:suggestEvent', async (_e, emailId: string) => {
    await tryStartOllama();
    return suggestEventFromEmail(await getFullEmail(String(emailId)), getSettings());
  });

  // --- Voice input (local Whisper) ---
  ipcMain.handle('voice:transcribe', async (_e, samples: Float32Array) => {
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
  ipcMain.handle('docs:pickFile', async (): Promise<PickedFile | undefined> => {
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
  ipcMain.handle('docs:answerFile', async (_e, file: string): Promise<AssignmentResult> => {
    // Only files the user chose in the picker may be read.
    if (!pickedFiles.has(file)) throw new Error('Please choose the file again.');
    if (!hasScope('documents')) throw new Error('Lumi needs Google Docs permission. Sign out in Settings and sign in again, then accept the Docs access.');
    try {
      return await answerAssignment(file, { settings: getSettings(), onProgress: (message) => send('agent:status', { state: 'progress', message }) });
    } finally {
      send('agent:status', { state: 'idle' });
    }
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, patch: Partial<Settings>) => {
    const next = updateSettings(patch);
    applySystemSettings(next);
    if ('widgetView' in patch || 'widgetScale' in patch) refreshWindowSize();
    rebuildTrayMenu(() => applySystemSettings());
    if ('emailLookbackDays' in patch || 'aiEmailTriage' in patch) void sync.refreshEmails();
    if ('dndFullscreen' in patch || 'dndMeetings' in patch || 'dndUntil' in patch) dnd.applySettings();
    if ('weather' in patch || 'weatherPlace' in patch) { if (next.weather) weather.start(); else { weather.stop(); void weather.refresh(); } }
    if ('quickCapture' in patch || 'quickCaptureShortcut' in patch) quick.apply(next.quickCapture, next.quickCaptureShortcut);
    return next;
  });

  // --- Window ---
  ipcMain.handle('window:setMode', (_e, mode: WindowMode) => setWindowMode(mode));
  ipcMain.handle('window:hide', () => getWindow()?.hide());
  ipcMain.handle('window:openExternal', (_e, url: string) => {
    // Only Google pages and video-meeting services, over https, may be opened from the interface.
    if (isAllowedExternalUrl(String(url))) return shell.openExternal(url);
  });
}

app.on('will-quit', () => { updates.applyOnQuit(); if (!getSettings().keepSignedIn) clearTokens(); dnd.stop(); weather.stop(); quick.dispose(); globalShortcut.unregisterAll(); });
// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => { /* stay alive */ });
