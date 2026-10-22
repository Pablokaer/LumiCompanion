// Types shared between the Electron main process and the React renderer.
import type { DndState } from './dnd';
import type { SystemKind } from './notices';
import type { NewsItem, Routine, RoutineInput } from './routines';
import type { WeatherState } from './weather';

export interface UserProfile {
  name: string;
  email: string;
  picture?: string;
}

export interface AuthState {
  /** True when a Google OAuth client id/secret was found. */
  configured: boolean;
  signedIn: boolean;
  profile?: UserProfile;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** ISO string. For all-day events this is the date at local midnight. */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  description?: string;
  meetLink?: string;
  /** A video-call link: the Meet link, or a Zoom/Teams/Webex link found in the event. */
  joinUrl?: string;
  htmlLink?: string;
}

export interface NewEventInput {
  title: string;
  /** Local date-time "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" for all-day events. */
  start: string;
  /** Optional local end; defaults to start + durationMinutes (or 60 min). */
  end?: string;
  durationMinutes?: number;
  allDay?: boolean;
  location?: string;
  description?: string;
}

export type ImportanceLevel = 'high' | 'medium' | 'low';

export interface EmailSummary {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  labelIds: string[];
  hasListUnsubscribe: boolean;
}

export interface ScoredEmail extends EmailSummary {
  score: number;
  level: ImportanceLevel;
  reasons: string[];
  aiReason?: string;
  url: string;
}

export type WidgetMode = 'desktop' | 'onTop';

export type Skin = 'classic' | 'nebula' | 'sunset' | 'mint' | 'mono' | 'custom';
export type Shape = 'star' | 'chubby' | 'sparkle' | 'hexa' | 'planet' | 'earth' | 'moon' | 'sun' | 'comet';
export type AccessorySlot = 'head' | 'ears' | 'eyes' | 'neck' | 'face' | 'prop';
export type Accessory =
  | 'hat' | 'crown' | 'wizard' | 'tophat' | 'halo' | 'flower' | 'catears' | 'antenna' | 'bow' | 'helmet' | 'santa' | 'witch' | 'beanie'
  | 'headphones'
  | 'glasses' | 'sunglasses' | 'monocle'
  | 'scarf' | 'bowtie'
  | 'mustache'
  | 'umbrella';

/** What the shrunken widget shows: the mascot, a month calendar or a day agenda. */
export type WidgetView = 'mascot' | 'month' | 'day';

export interface Settings {
  mascotName: string;
  widgetMode: WidgetMode;
  widgetView: WidgetView;
  /** Size of the shrunken widget window and its contents, from 0.6 to 1 (1 = normal). */
  widgetScale: number;
  /** Size of the window while the full panel is open, from 0.6 to 1 (1 = normal). */
  panelScale: number;
  /** Start hidden in the system tray instead of showing the widget. */
  startInTray: boolean;
  skin: Skin;
  /** The colour used when `skin` is 'custom', as "#rrggbb". */
  customColor: string;
  /** Saved colours (newest first) shown under the colour picker. */
  colorSwatches: string[];
  /** The body: a star variant or a space object. */
  shape: Shape;
  /** What she is wearing: at most one accessory per slot (head, ears, eyes, neck, face). */
  accessories: Accessory[];
  /** The star does spontaneous things (smiles, hops, waves…) when idle. */
  mascotLife: boolean;
  /** Her eyes follow the mouse cursor around the screen. */
  followMouse: boolean;
  /** Do not disturb: stay quiet while a full-screen app, presentation or Focus Assist is on (Windows). */
  dndFullscreen: boolean;
  /** Do not disturb: stay quiet during meetings on the calendar. */
  dndMeetings: boolean;
  /** Hide the widget entirely while a full-screen app is in front. */
  dndHideWidget: boolean;
  /** Manual "quiet until" time, epoch ms. */
  dndUntil?: number;
  /** A global shortcut opens a small window to add an event by typing it. */
  quickCapture: boolean;
  quickCaptureShortcut: string;
  /** Show the weather for where you are, and let it change how she looks. */
  weather: boolean;
  /** A city to use instead of the location guessed from your IP address; empty means automatic. */
  weatherPlace: string;
  temperatureUnit: 'c' | 'f';
  /** Dress for the weather and the season (umbrella, scarf, festive hats) and show falling rain, snow or leaves. */
  seasonalLook: boolean;
  /** React to battery, charging, the network, locking the screen and audio devices. */
  reactToSystem: boolean;
  /** Occasional gentle tips: water, stretching, resting your eyes, bedtime. */
  proactiveTips: boolean;
  tipFrequency: 'rare' | 'normal' | 'often';
  /** Only calendar pop-ups: her bubble speaks only about an event that is about to start (and reminders); no tips, system reactions, chatter, briefing or routine notifications. */
  calendarPopupsOnly: boolean;
  /** Stay signed in to Google between runs. Off: you sign in again every time the app starts. */
  keepSignedIn: boolean;
  /** She reacts when the mouse passes over her: laughs, purrs, tries to bite. */
  petReactions: boolean;
  /** Minutes without keyboard/mouse use before the star falls asleep; 0 = never. */
  sleepAfterMinutes: number;
  /** Detect music playing on the computer and dance to its tempo. */
  reactToMusic: boolean;
  /** Look for new versions in the background (every 30 minutes, and when the computer wakes up). */
  autoUpdate: boolean;
  /** Download a new version as soon as it is found, and restart into it once you have been away for a while. */
  autoInstallUpdates: boolean;
  /** Start `ollama serve` automatically when it is installed but not running. */
  startAiOnLaunch: boolean;
  /** Download and install Ollama and its model by itself when they are missing (Windows and macOS). */
  autoSetupOllama: boolean;
  morningBriefing: boolean;
  /** Local "HH:mm" after which the morning briefing is shown once per day. */
  briefingTime: string;
  /** Local "YYYY-MM-DD" of the last briefing shown. */
  lastBriefingDate?: string;
  /** Default focus-session length in minutes. */
  focusMinutes: number;
  /** Language spoken to the microphone; 'system' follows the OS language. */
  voiceLanguage: 'system' | 'pt' | 'en' | 'es';
  launchAtLogin: boolean;
  /** Minutes before an event at which to remind, e.g. [15, 5]. */
  reminderLeadMinutes: number[];
  systemNotifications: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  /** Per-task model overrides; empty means "use ollamaModel". */
  modelChat: string;
  modelTriage: string;
  modelWriting: string;
  aiEmailTriage: boolean;
  emailLookbackDays: number;
}

/** Progress of setting up the local AI (Ollama and its model) by itself. */
export interface OllamaSetupState {
  status: 'idle' | 'downloading' | 'installing' | 'starting' | 'pulling' | 'ready' | 'error' | 'unsupported';
  /** 0-100 while downloading Ollama or its model. */
  percent?: number;
  model?: string;
  message?: string;
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
  error?: string;
}

export interface ReminderPayload {
  event: CalendarEvent;
  minutesUntil: number;
  message: string;
}

export interface DataSnapshot {
  events: CalendarEvent[];
  emails: ScoredEmail[];
  lastSync?: string;
  error?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FocusState {
  /** Epoch ms when the session ends. */
  endsAt: number;
  minutes: number;
}

export interface Briefing {
  title: string;
  lines: string[];
}

export interface EmailDraft {
  threadId: string;
  to: string;
  subject: string;
  body: string;
  /** Message-ID of the email being answered, for threading. */
  inReplyTo?: string;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error' | 'unsupported';

export interface UpdateState {
  status: UpdateStatus;
  /** The version of this installed app. */
  currentVersion: string;
  /** The newer version, once one is found. */
  version?: string;
  /** Download progress, 0-100. */
  percent?: number;
  message?: string;
  /** When the last check finished without an error, epoch ms. */
  checkedAt?: number;
  /** Why the last check failed (also for background checks, which stay quiet otherwise); cleared by the next good one. */
  lastError?: string;
  /** True when Lumi can only point you to the download page (macOS, .deb) instead of updating itself. */
  notifyOnly: boolean;
}

export interface CaptureResult {
  event: NewEventInput;
  /** Whether a date or time was found. When false the form is shown with just the title. */
  understood: boolean;
  /** How it was understood: by simple rules, with the local AI, or not at all. */
  via: 'rules' | 'ai' | 'none';
}

export interface ConfirmRequest {
  id: string;
  kind: 'create_event' | 'create_routine' | 'update_routine' | 'delete_routine';
  title: string;
  /** What the confirmation card lists, label and value. */
  rows: { label: string; value: string }[];
  /** Text of the approve button. */
  confirmLabel: string;
}

export type AgentStatus =
  | { state: 'idle' }
  | { state: 'thinking' }
  | { state: 'tool'; tool: string }
  | { state: 'progress'; message: string };

export interface PickedFile {
  path: string;
  name: string;
}

export interface AssignmentResult {
  title: string;
  url: string;
  questionCount: number;
  /** Distinct bibliographic sources cited in the document. */
  sourceCount: number;
  /** Questions for which no usable source was found. */
  unsupported: number[];
  /** Number of points the automatic review flagged for the student to check. */
  reviewNotes: number;
  /** Citation style used (ABNT or APA). */
  style: 'ABNT' | 'APA';
}

export type WindowMode = 'compact' | 'expanded';

/** The API exposed to the renderer as `window.lumi` by the preload script. */
export interface LumiApi {
  auth: {
    getState(): Promise<AuthState>;
    signIn(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
  };
  data: {
    get(): Promise<DataSnapshot>;
    refresh(): Promise<DataSnapshot>;
    createEvent(input: NewEventInput): Promise<CalendarEvent>;
    /** Events between two ISO instants (at most ~2 months), for the calendar views. */
    getRange(fromIso: string, toIso: string): Promise<CalendarEvent[]>;
  };
  agent: {
    send(history: ChatMessage[]): Promise<string>;
    respondConfirm(id: string, approved: boolean): Promise<void>;
    ollamaStatus(): Promise<OllamaStatus>;
    /** Installs Ollama (if missing), starts it and downloads the model. Progress arrives as 'ollama:setup' events. */
    setupOllama(): Promise<OllamaSetupState>;
    setupState(): Promise<OllamaSetupState>;
    /** Turns the local AI on (installing it first when automatic setup is on). */
    startAi(): Promise<OllamaStatus>;
    /** Turns it off: unloads the model and ends the server Lumi started. `external`: a server started outside Lumi keeps running. */
    stopAi(): Promise<{ status: OllamaStatus; external: boolean }>;
  };
  focus: {
    get(): Promise<FocusState | undefined>;
    start(minutes: number): Promise<FocusState>;
    stop(): Promise<void>;
  };
  dnd: {
    get(): Promise<DndState>;
    /** Quiet until the given time (epoch ms), or null to turn the manual pause off. */
    set(untilMs: number | null): Promise<DndState>;
  };
  weather: {
    get(): Promise<WeatherState>;
    refresh(): Promise<WeatherState>;
  };
  capture: {
    /** Understands a line of text ("lunch tomorrow 1pm") as an event. */
    parse(text: string): Promise<CaptureResult>;
    /** Closes the quick-capture window. */
    close(): Promise<void>;
    /** Changes the global shortcut; resolves with an error message when it cannot be used. */
    setShortcut(accelerator: string): Promise<{ ok: boolean; error?: string }>;
  };
  updates: {
    getState(): Promise<UpdateState>;
    /** Checks now. */
    check(): Promise<UpdateState>;
    /** Downloads the new version inside the app and restarts into it when it is ready. */
    download(): Promise<UpdateState>;
    /** Restarts into a downloaded update. */
    install(): Promise<void>;
    /** Opens the download page (for platforms that cannot update themselves). */
    openDownload(): Promise<void>;
  };
  music: {
    /** Asks the main process to start system-audio listening (it supplies the user gesture Chromium needs). */
    requestStart(): Promise<void>;
  };
  briefing: {
    /** Shows the morning briefing right now (also used for previewing). */
    show(): Promise<void>;
  };
  mail: {
    /** Drafts a reply with the local model. Nothing is saved or sent. */
    draftReply(emailId: string, instructions?: string): Promise<EmailDraft>;
    /** Saves the (possibly edited) draft to Gmail Drafts. Never sends it. */
    saveDraft(draft: EmailDraft): Promise<{ url: string }>;
    /** Looks for a meeting or deadline in an email; undefined when there is none. */
    suggestEvent(emailId: string): Promise<NewEventInput | undefined>;
  };
  voice: {
    /** Transcribes 16 kHz mono audio with a local speech model. */
    transcribe(samples: Float32Array): Promise<string>;
  };
  docs: {
    /** Opens a native file picker; resolves undefined when cancelled. */
    pickFile(): Promise<PickedFile | undefined>;
    /** Answers the questions in a local file and saves the result as a Google Doc. */
    answerFile(path: string): Promise<AssignmentResult>;
  };
  routines: {
    list(): Promise<Routine[]>;
    /** Creates a routine (no id) or changes one. Rejects with a message when something is not valid. A new one runs at once. */
    save(input: RoutineInput): Promise<Routine[]>;
    remove(id: string): Promise<Routine[]>;
    /** Runs a routine now. */
    run(id: string): Promise<{ added: number; error?: string }>;
  };
  news: {
    list(): Promise<NewsItem[]>;
    /** Opens the article in the browser and marks it read. */
    open(id: string): Promise<void>;
    /** One article, or all of them when no id is given. */
    markRead(id?: string): Promise<void>;
    dismiss(id: string): Promise<void>;
    /** Removes the articles already read. */
    clearRead(): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  window: {
    setMode(mode: WindowMode): Promise<void>;
    hide(): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  on<K extends LumiEvent>(channel: K, listener: (payload: LumiEvents[K]) => void): () => void;
}

/**
 * The IPC contract. Every push event from the main process and its payload; `send` in main.ts and
 * `api.on` in the renderer are both typed by this map, and the preload's allow-list must name every key.
 */
export interface LumiEvents {
  reminder: ReminderPayload;
  'data:updated': DataSnapshot;
  'agent:confirm': ConfirmRequest;
  'agent:status': AgentStatus;
  'auth:changed': AuthState;
  'settings:changed': undefined;
  'focus:changed': FocusState | undefined;
  briefing: Briefing;
  activity: { idleSeconds: number };
  'update:state': UpdateState;
  cursor: { x: number; y: number };
  'dnd:state': DndState;
  'weather:state': WeatherState;
  system: { kind: SystemKind };
  power: { hidden: boolean };
  'quick:show': undefined;
  'ollama:setup': OllamaSetupState;
  'routines:updated': Routine[];
  'news:updated': NewsItem[];
  'ai:state': OllamaStatus;
}
export type LumiEvent = keyof LumiEvents;

/**
 * Every invoke channel with its call, derived from LumiApi: `api.agent.send` is 'agent:send' (the
 * `updates` group uses the 'update:' prefix). The preload and main.ts's `handle` are typed by it, so a
 * misspelt channel or a handler with the wrong arguments does not compile.
 */
type ApiGroups = Omit<LumiApi, 'on'>;
type ChannelPrefix<G extends string> = G extends 'updates' ? 'update' : G;
type GroupChannels<G extends keyof ApiGroups & string> = {
  [M in keyof ApiGroups[G] & string as `${ChannelPrefix<G>}:${M}`]: ApiGroups[G][M];
};
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
export type IpcChannels = UnionToIntersection<{ [G in keyof ApiGroups & string]: GroupChannels<G> }[keyof ApiGroups & string]>;
export type IpcChannel = keyof IpcChannels & string;
/** The arguments and result of one invoke channel. */
export type IpcCall<K extends IpcChannel> = IpcChannels[K] extends (...args: infer A) => infer R ? { args: A; result: R } : never;
