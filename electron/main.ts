import { app, dialog, globalShortcut, ipcMain, Notification, session, shell } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AgentStatus, AssignmentResult, ChatMessage, ConfirmRequest, EmailDraft, NewEventInput, PickedFile, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { runAgent } from './agent/agent';
import { draftReply, suggestEventFromEmail } from './agent/mailTools';
import { ensureOllama, ollamaStatus } from './agent/ollama';
import { answerAssignment } from './docs/assignment';
import { SUPPORTED_EXTENSIONS } from './docs/extract';
import { getAuthState, getProfile, hasScope, signIn, signOut } from './google/auth';
import { createEvent, listEventsInRange, listUpcomingEvents } from './google/calendar';
import { createDraft, getFullEmail, searchEmails } from './google/gmail';
import { briefingDate, buildBriefing, shouldShowBriefing } from './services/briefing';
import { FocusService, shouldHoldReminder } from './services/focus';
import { SyncService } from './services/sync';
import { LANGUAGE_NAMES, transcribe } from './voice/transcribe';
import { getSettings, loadDotEnv, updateSettings } from './store';
import { createTray, rebuildTrayMenu } from './tray';
import { applyWidgetMode, createWidgetWindow, getWindow, peek, refreshWindowSize, setWindowMode, toggleWindow } from './window';

loadDotEnv(path.join(__dirname, '../..'));

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

/** Starts Ollama when it is installed but stopped. Attempts are rate-limited so a broken install is not retried constantly. */
let ollamaAttempt: { at: number; promise: Promise<unknown> } | undefined;
function tryStartOllama() {
  const s = getSettings();
  if (!s.autoStartOllama) return Promise.resolve();
  if (ollamaAttempt && Date.now() - ollamaAttempt.at < 60_000) return ollamaAttempt.promise;
  ollamaAttempt = { at: Date.now(), promise: ensureOllama(s.ollamaUrl) };
  return ollamaAttempt.promise;
}

function showBriefing(markShown: boolean) {
  void getProfile().catch(() => undefined).then((p) => {
    const briefing = buildBriefing(sync.data.events, sync.data.emails, new Date(), p?.name);
    send('briefing', briefing);
    peek(30_000);
    if (getSettings().systemNotifications && Notification.isSupported()) {
      new Notification({ title: `${getSettings().mascotName} ✦ ${briefing.title}`, body: briefing.lines.slice(0, 4).join('\n') }).show();
    }
    if (markShown) updateSettings({ lastBriefingDate: briefingDate(new Date()) });
  });
}

function checkBriefing() {
  if (!sync.data.lastSync || !shouldShowBriefing(getSettings())) return;
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
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'));

  registerIpc();
  createWidgetWindow();
  createTray(() => { applySystemSettings(); send('settings:changed'); });
  applySystemSettings();

  globalShortcut.register('CommandOrControl+Shift+L', () => toggleWindow());

  sync.on('updated', (snapshot) => send('data:updated', snapshot));
  sync.on('signed-out', async () => { sync.reset(); send('auth:changed', await getAuthState()); });
  sync.on('reminder', (r: ReminderPayload) => {
    if (shouldHoldReminder(!!focus.current, r.minutesUntil)) return; // urgent ones (<= 5 min) still come through
    send('reminder', r);
    peek();
    if (getSettings().systemNotifications && Notification.isSupported()) {
      const n = new Notification({ title: `${getSettings().mascotName} ✦ ${r.event.title}`, body: r.message, silent: false });
      n.on('click', () => { const w = getWindow(); w?.show(); w?.focus(); });
      n.show();
    }
  });

  focus.on('changed', (state) => send('focus:changed', state));
  focus.on('done', (state: { minutes: number }) => {
    peek();
    if (getSettings().systemNotifications && Notification.isSupported()) {
      new Notification({ title: `${getSettings().mascotName} ✦ Focus session complete`, body: `${state.minutes} focused minutes — nice work! Time for a short break.` }).show();
    }
  });
  setInterval(checkBriefing, 60_000);
  void tryStartOllama();

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
    if ('widgetView' in patch) refreshWindowSize();
    rebuildTrayMenu(() => applySystemSettings());
    if ('emailLookbackDays' in patch || 'aiEmailTriage' in patch) void sync.refreshEmails();
    return next;
  });

  // --- Window ---
  ipcMain.handle('window:setMode', (_e, mode: WindowMode) => setWindowMode(mode));
  ipcMain.handle('window:hide', () => getWindow()?.hide());
  ipcMain.handle('window:openExternal', (_e, url: string) => {
    // Only open Google pages from the renderer.
    const host = new URL(url).hostname;
    if (/(^|\.)google\.com$/.test(host)) return shell.openExternal(url);
  });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => { /* stay alive */ });
