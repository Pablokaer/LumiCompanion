import type {
  AgentStatus, CalendarEvent, ChatMessage, ConfirmRequest, EmailSummary, NewEventInput, ScoredEmail, Settings, UserProfile,
} from '../../shared/types';
import { checkNewEvent, formatLocalDateTime, localTimeZone } from '../services/time';
import { modelFor, ollamaChat, type OllamaMessage, type OllamaTool } from './ollama';

export interface AgentDeps {
  getSettings(): Settings;
  getProfile(): Promise<UserProfile | undefined>;
  listEvents(days: number): Promise<CalendarEvent[]>;
  getImportantEmails(): Promise<ScoredEmail[]>;
  searchEmails(query: string): Promise<EmailSummary[]>;
  createEvent(input: NewEventInput): Promise<CalendarEvent>;
  /** Asks the user in the UI; resolves true when approved. */
  confirm(req: Omit<ConfirmRequest, 'id'>): Promise<boolean>;
  onStatus(status: AgentStatus): void;
  chat?: typeof ollamaChat;
}

const MAX_STEPS = 6;

export const TOOLS: OllamaTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_upcoming_events',
      description: "List the user's Google Calendar events from today for the next N days.",
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', description: 'How many days ahead (1-30). Default 7.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description: 'Create an event in the user\'s Google Calendar. The user will be asked to confirm before it is saved.',
      parameters: {
        type: 'object',
        required: ['title', 'start'],
        properties: {
          title: { type: 'string', description: 'Event title' },
          start: { type: 'string', description: 'Local start "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" for an all-day event' },
          end: { type: 'string', description: 'Optional local end "YYYY-MM-DDTHH:mm"' },
          durationMinutes: { type: 'integer', description: 'Duration if no end is given. Default 60.' },
          location: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_important_emails',
      description: 'Get the most important recent emails from the inbox, already ranked by importance.',
      parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Max emails (default 5)' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_emails',
      description: 'Search Gmail using Gmail search syntax, e.g. "from:anna newer_than:7d" or "subject:invoice".',
      parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    },
  },
];

const fmtTime = (iso: string) => formatLocalDateTime(new Date(iso)).replace('T', ' ');

export function describeEvents(events: CalendarEvent[]) {
  if (!events.length) return 'No events.';
  return events
    .map((e) => {
      const when = e.allDay ? `${e.start.slice(0, 10)} (all day)` : `${fmtTime(e.start)} → ${fmtTime(e.end).slice(11)}`;
      return `- ${when} | ${e.title}${e.location ? ` | ${e.location}` : ''}`;
    })
    .join('\n');
}

export function describeEmails(emails: (EmailSummary | ScoredEmail)[]) {
  if (!emails.length) return 'No emails found.';
  return emails
    .map((e) => {
      const s = e as ScoredEmail;
      const tag = s.level ? `[${s.level.toUpperCase()} ${s.score}] ` : '';
      return `- ${tag}From ${e.from} <${e.fromEmail}> | "${e.subject}" | ${fmtTime(e.date)}\n  ${e.snippet.slice(0, 160)}`;
    })
    .join('\n');
}

export function systemPrompt(settings: Settings, profile?: UserProfile, now = new Date()) {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return [
    `You are ${settings.mascotName}, a cheerful little blue star who lives on the user's desktop and is their personal companion.`,
    `You help with their Google Calendar and Gmail using the tools provided. Keep replies short, warm and practical, with an occasional space/star flourish (✦, 🌌) — never overdo it.`,
    `Reply in the same language the user writes in.`,
    profile ? `The user's name is ${profile.name} (${profile.email}).` : '',
    `Current local date-time: ${weekday} ${formatLocalDateTime(now).replace('T', ' ')} (time zone ${localTimeZone()}).`,
    `Rules:`,
    `- Always call a tool to look up calendar or email data; never invent events or emails.`,
    `- To add an event, resolve relative dates ("tomorrow at 3pm") into local "YYYY-MM-DDTHH:mm" yourself and call create_calendar_event. The app asks the user to confirm, so do not ask for confirmation in text first.`,
    `- If essential details (like the day or time) are missing, ask one short question instead of guessing.`,
    `- When summarising emails, lead with the most important ones and say why they matter.`,
  ].filter(Boolean).join('\n');
}

function parseArgs(raw: Record<string, unknown> | string): Record<string, any> {
  if (typeof raw !== 'string') return raw ?? {};
  try { return JSON.parse(raw); } catch { return {}; }
}

export async function runAgent(history: ChatMessage[], deps: AgentDeps): Promise<string> {
  const chat = deps.chat ?? ollamaChat;
  const settings = deps.getSettings();
  const profile = await deps.getProfile().catch(() => undefined);
  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt(settings, profile) },
    ...history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      deps.onStatus({ state: 'thinking' });
      const reply = await chat({ baseUrl: settings.ollamaUrl, model: modelFor(settings, 'chat'), messages, tools: TOOLS });
      messages.push(reply);
      if (!reply.tool_calls?.length) return reply.content || '✦';

      for (const call of reply.tool_calls) {
        const name = call.function.name;
        deps.onStatus({ state: 'tool', tool: name });
        let result: string;
        try {
          result = await executeTool(name, parseArgs(call.function.arguments), deps);
        } catch (e) {
          result = `Error: ${(e as Error).message}`;
        }
        messages.push({ role: 'tool', tool_name: name, content: result });
      }
    }
    return 'I got a bit lost among the stars there — could you rephrase that? ✦';
  } finally {
    deps.onStatus({ state: 'idle' });
  }
}

export async function executeTool(name: string, args: Record<string, any>, deps: AgentDeps): Promise<string> {
  switch (name) {
    case 'get_upcoming_events': {
      const days = Math.min(30, Math.max(1, Number(args.days) || 7));
      return describeEvents(await deps.listEvents(days));
    }
    case 'create_calendar_event': {
      const input: NewEventInput = {
        title: String(args.title ?? '').trim(),
        start: String(args.start ?? '').trim(),
        end: args.end ? String(args.end) : undefined,
        durationMinutes: args.durationMinutes ? Number(args.durationMinutes) : undefined,
        location: args.location ? String(args.location) : undefined,
        description: args.description ? String(args.description) : undefined,
      };
      // Refuse an impossible date (2025-02-30) now, not after the user has already said yes.
      const problem = checkNewEvent(input);
      if (problem) return `Error: the event was NOT created because ${problem}. Fix it and try again, or ask the user.`;
      const approved = await deps.confirm({ kind: 'create_event', title: `Add “${input.title}” to your calendar?`, details: input });
      if (!approved) return 'The user declined. The event was NOT created.';
      const created = await deps.createEvent(input);
      return `Created event: ${describeEvents([created])}`;
    }
    case 'get_important_emails': {
      const limit = Math.min(15, Math.max(1, Number(args.limit) || 5));
      return describeEmails((await deps.getImportantEmails()).slice(0, limit));
    }
    case 'search_emails': {
      const query = String(args.query ?? '').trim();
      if (!query) return 'Error: query is required.';
      return describeEmails((await deps.searchEmails(query)).slice(0, 10));
    }
    default:
      return `Error: unknown tool "${name}".`;
  }
}

/**
 * Asks the local model to rate emails 0-100. Returns {} on any failure so the
 * heuristic ranking is used instead.
 */
export async function aiTriageEmails(
  emails: ScoredEmail[],
  settings: Settings,
  chat: typeof ollamaChat = ollamaChat,
): Promise<Record<string, { score: number; reason?: string }>> {
  if (!emails.length) return {};
  const list = emails.slice(0, 15).map((e, i) => `${i + 1}. id=${e.id} | from ${e.from} <${e.fromEmail}> | "${e.subject}" | ${e.snippet.slice(0, 140)}`).join('\n');
  try {
    const reply = await chat({
      baseUrl: settings.ollamaUrl,
      model: modelFor(settings, 'triage'),
      format: 'json',
      timeoutMs: 90_000,
      messages: [
        {
          role: 'system',
          content: 'You triage email for a busy professional. Rate how important each email is for the user to read soon (0 = ignore, 100 = urgent personal action needed). Real people, deadlines, money, meetings and requests score high; newsletters, promotions and automated notifications score low. Respond ONLY with JSON: {"emails":[{"id":"...","score":0,"reason":"max 8 words"}]}',
        },
        { role: 'user', content: list },
      ],
    });
    const parsed = JSON.parse(reply.content) as { emails?: { id: string; score: number; reason?: string }[] };
    const out: Record<string, { score: number; reason?: string }> = {};
    for (const r of parsed.emails ?? []) if (r?.id && Number.isFinite(Number(r.score))) out[r.id] = { score: Number(r.score), reason: r.reason };
    return out;
  } catch {
    return {};
  }
}
