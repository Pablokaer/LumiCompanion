// Types shared between the Electron main process and the React renderer.

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

/** What the shrunken widget shows: the mascot, a month calendar or a day agenda. */
export type WidgetView = 'mascot' | 'month' | 'day';

export interface Settings {
  mascotName: string;
  widgetMode: WidgetMode;
  widgetView: WidgetView;
  launchAtLogin: boolean;
  /** Minutes before an event at which to remind, e.g. [15, 5]. */
  reminderLeadMinutes: number[];
  systemNotifications: boolean;
  ollamaUrl: string;
  ollamaModel: string;
  aiEmailTriage: boolean;
  emailLookbackDays: number;
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

export interface ConfirmRequest {
  id: string;
  kind: 'create_event';
  title: string;
  details: NewEventInput;
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
  };
  docs: {
    /** Opens a native file picker; resolves undefined when cancelled. */
    pickFile(): Promise<PickedFile | undefined>;
    /** Answers the questions in a local file and saves the result as a Google Doc. */
    answerFile(path: string): Promise<AssignmentResult>;
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
  on(
    channel: 'reminder' | 'data:updated' | 'agent:confirm' | 'agent:status' | 'auth:changed' | 'settings:changed',
    listener: (payload: any) => void,
  ): () => void;
}
