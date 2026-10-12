import { app, dialog, globalShortcut, ipcMain, Notification, shell } from 'electron';
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  AgentStatus, AssignmentResult, ChatMessage, ConfirmRequest, NewEventInput, PickedFile, ReminderPayload, Settings, WindowMode,
} from '../shared/types';
import { runAgent } from './agent/agent';
import { ollamaStatus } from './agent/ollama';
import { answerAssignment } from './docs/assignment';
import { SUPPORTED_EXTENSIONS } from './docs/extract';
import { getAuthState, getProfile, hasDocsScope, signIn, signOut } from './google/auth';
import { createEvent, listEventsInRange, listUpcomingEvents } from './google/calendar';
import { searchEmails } from './google/gmail';
import { SyncService } from './services/sync';
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

const send = (channel: string, payload?: unknown) => getWindow()?.webContents.send(channel, payload);

function applySystemSettings(s: Settings = getSettings()) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  applyWidgetMode(s.widgetMode);
  sync.setReminderLeads(s.reminderLeadMinutes);
}

async function bootstrap() {
  app.setAppUserModelId('com.finperiti.lumi'); // Windows notifications
  if (process.platform === 'darwin') app.dock?.hide(); // live in the menu bar, not the dock

  registerIpc();
  createWidgetWindow();
  createTray(() => { applySystemSettings(); send('settings:changed'); });
  applySystemSettings();

  globalShortcut.register('CommandOrControl+Shift+L', () => toggleWindow());

  sync.on('updated', (snapshot) => send('data:updated', snapshot));
  sync.on('signed-out', async () => { sync.reset(); send('auth:changed', await getAuthState()); });
  sync.on('reminder', (r: ReminderPayload) => {
    send('reminder', r);
    peek();
    if (getSettings().systemNotifications && Notification.isSupported()) {
      const n = new Notification({ title: `${getSettings().mascotName} ✦ ${r.event.title}`, body: r.message, silent: false });
      n.on('click', () => { const w = getWindow(); w?.show(); w?.focus(); });
      n.show();
    }
  });

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
  ipcMain.handle('agent:ollamaStatus', () => ollamaStatus(getSettings().ollamaUrl));
  ipcMain.handle('agent:respondConfirm', (_e, id: string, approved: boolean) => {
    pendingConfirms.get(id)?.(approved);
    pendingConfirms.delete(id);
  });
  ipcMain.handle('agent:send', (_e, history: ChatMessage[]) =>
    runAgent(history, {
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
    }),
  );

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
    if (!hasDocsScope()) throw new Error('Lumi needs Google Docs permission. Sign out in Settings and sign in again, then accept the Docs access.');
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
