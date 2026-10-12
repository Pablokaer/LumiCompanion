import type { EmailDraft, NewEventInput, Settings } from '../../shared/types';
import { isLocalDate, isLocalDateTime } from '../services/time';
import type { FullEmail } from '../google/gmail';
import { modelFor, ollamaChat } from './ollama';

const MAX_BODY_CHARS = 6000;

type Chat = typeof ollamaChat;

const quote = (e: FullEmail) =>
  `From: ${e.summary.from} <${e.summary.fromEmail}>\nSubject: ${e.summary.subject}\nDate: ${e.summary.date}\n\n${(e.body || e.summary.snippet).slice(0, MAX_BODY_CHARS)}`;

export const replySubject = (subject: string) => (/^\s*(re|res|aw)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`);

/** Drafts a reply with the local model. The result is only a suggestion for the user to edit. */
export async function draftReply(
  email: FullEmail, instructions: string | undefined, userName: string | undefined, settings: Settings, chat: Chat = ollamaChat,
): Promise<EmailDraft> {
  const reply = await chat({
    baseUrl: settings.ollamaUrl,
    model: modelFor(settings, 'writing'),
    timeoutMs: 180_000,
    numCtx: 8192,
    messages: [
      {
        role: 'system',
        content: `You write email replies on behalf of ${userName ?? 'the user'}. Reply in the same language as the email. Be concise, polite and natural. ` +
          'Never invent facts, commitments, dates, prices or attachments. If a needed detail is unknown, leave a short [placeholder] in square brackets for the user to fill in. ' +
          `Output ONLY the body of the reply, ending with a short sign-off${userName ? ` signed "${userName}"` : ''}. No subject line, no quoted original, no commentary.`,
      },
      {
        role: 'user',
        content: `${instructions?.trim() ? `What I want to say: ${instructions.trim()}\n\n` : 'Write a suitable reply.\n\n'}Email to answer:\n${quote(email)}`,
      },
    ],
  });
  const body = reply.content.trim();
  if (!body) throw new Error('The model returned an empty reply. Try again.');
  return {
    threadId: email.summary.threadId,
    to: email.replyTo || email.summary.fromEmail,
    subject: replySubject(email.summary.subject),
    body,
    inReplyTo: email.messageId || undefined,
  };
}

/**
 * Looks for a meeting, appointment or deadline in an email. Returns undefined when
 * there is none or when the model's answer cannot be turned into a valid event.
 */
export async function suggestEventFromEmail(
  email: FullEmail, settings: Settings, now = new Date(), chat: Chat = ollamaChat,
): Promise<NewEventInput | undefined> {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let json: unknown;
  try {
    const reply = await chat({
      baseUrl: settings.ollamaUrl,
      model: modelFor(settings, 'chat'),
      format: 'json',
      timeoutMs: 120_000,
      numCtx: 8192,
      messages: [
        {
          role: 'system',
          content: `Today is ${weekday} ${today}. Find ONE meeting, appointment, call or deadline that the email asks the reader to attend or meet. ` +
            'Respond ONLY with JSON: {"found":true|false,"title":"short title","start":"YYYY-MM-DDTHH:mm or YYYY-MM-DD","end":"YYYY-MM-DDTHH:mm or empty","location":"or empty","description":"one short line or empty"}. ' +
            'Resolve relative dates ("next Tuesday") from today. Use a date-only start for deadlines or all-day items. If no concrete date can be determined, set found to false. Never guess a date.',
        },
        { role: 'user', content: quote(email) },
      ],
    });
    json = JSON.parse(reply.content);
  } catch {
    return undefined;
  }
  return normalizeSuggestion(json);
}

export function normalizeSuggestion(raw: unknown): NewEventInput | undefined {
  const json = raw as Record<string, unknown> | null;
  if (!json?.found) return undefined;
  const title = String(json.title ?? '').trim();
  const start = String(json.start ?? '').trim().slice(0, 16);
  const dateOnly = start.length === 10;
  if (!title || !(dateOnly ? isLocalDate(start) : isLocalDateTime(start))) return undefined;
  const end = String(json.end ?? '').trim().slice(0, 16);
  return {
    title,
    start,
    end: !dateOnly && isLocalDateTime(end) && end > start ? end : undefined,
    allDay: dateOnly || undefined,
    location: String(json.location ?? '').trim() || undefined,
    description: String(json.description ?? '').trim() || undefined,
  };
}

/**
 * Asks the local model to turn a free-form note into one calendar event. Used by quick capture when the
 * simple rules found no date or time. Returns undefined when the model has nothing concrete to offer.
 */
export async function eventFromText(
  text: string, settings: Settings, now = new Date(), chat: Chat = ollamaChat,
): Promise<NewEventInput | undefined> {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  try {
    const reply = await chat({
      baseUrl: settings.ollamaUrl,
      model: modelFor(settings, 'chat'),
      format: 'json',
      timeoutMs: 60_000,
      numCtx: 4096,
      messages: [
        {
          role: 'system',
          content: `Today is ${weekday} ${today}. Turn the user's note into ONE calendar event. The note may be in English or Portuguese. ` +
            'Respond ONLY with JSON: {"found":true|false,"title":"short title","start":"YYYY-MM-DDTHH:mm or YYYY-MM-DD","end":"YYYY-MM-DDTHH:mm or empty","location":"or empty","description":"or empty"}. ' +
            'Resolve relative dates from today. If the note gives no concrete date or time, set found to false. Never guess a date.',
        },
        { role: 'user', content: text.slice(0, 500) },
      ],
    });
    return normalizeSuggestion(JSON.parse(reply.content));
  } catch {
    return undefined;
  }
}
