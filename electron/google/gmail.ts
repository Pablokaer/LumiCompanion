import type { EmailDraft, EmailSummary } from '../../shared/types';
import { googleFetch } from './auth';

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export function parseFrom(from: string) {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].trim() };
  return { name: from.trim(), email: from.trim() };
}

function decodeEntities(s: string) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** The summary of a message (metadata or full format: both carry the headers). */
function toSummary(m: GMessage): EmailSummary {
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  const from = parseFrom(header('From'));
  return {
    id: m.id,
    threadId: m.threadId,
    from: from.name,
    fromEmail: from.email,
    to: header('To'),
    subject: header('Subject') || '(no subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date(header('Date')).toISOString(),
    labelIds: m.labelIds ?? [],
    hasListUnsubscribe: !!header('List-Unsubscribe'),
  };
}

async function getMessage(id: string): Promise<EmailSummary> {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe']) params.append('metadataHeaders', h);
  return toSummary(await googleFetch<GMessage>(`${BASE}/${id}?${params}`));
}

/** Lists inbox messages matching a Gmail search query, with limited concurrency. */
export async function searchEmails(query: string, max = 30): Promise<EmailSummary[]> {
  const params = new URLSearchParams({ q: query, maxResults: String(max) });
  const list = await googleFetch<{ messages?: { id: string }[] }>(`${BASE}?${params}`);
  const ids = (list.messages ?? []).map((m) => m.id);
  const out: EmailSummary[] = [];
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: Math.min(5, queue.length) }, async () => {
      while (queue.length) {
        const id = queue.shift()!;
        try { out.push(await getMessage(id)); } catch { /* skip unreadable message */ }
      }
    }),
  );
  return out.sort((a, b) => +new Date(b.date) - +new Date(a.date));
}

export interface FullEmail {
  summary: EmailSummary;
  /** Plain-text body (HTML is stripped when there is no text part). */
  body: string;
  /** The Message-ID header, used to thread a reply. */
  messageId: string;
  replyTo: string;
}

interface GPart { mimeType?: string; body?: { data?: string }; parts?: GPart[]; headers?: { name: string; value: string }[] }

const decodeB64Url = (data: string) => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function htmlToText(html: string) {
  return decodeEntities(html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Prefers the text/plain part; falls back to stripped HTML. */
export function extractBody(part?: GPart): string {
  if (!part) return '';
  const find = (p: GPart, type: string): string | undefined => {
    if (p.mimeType === type && p.body?.data) return decodeB64Url(p.body.data);
    for (const c of p.parts ?? []) { const r = find(c, type); if (r) return r; }
    return undefined;
  };
  const plain = find(part, 'text/plain');
  if (plain) return plain.trim();
  const html = find(part, 'text/html');
  return html ? htmlToText(html) : '';
}

export async function getFullEmail(id: string): Promise<FullEmail> {
  // One request: the full format has the headers too.
  const full = await googleFetch<GMessage & { payload?: GPart }>(`${BASE}/${id}?format=full`);
  const summary = toSummary(full);
  const header = (name: string) => full.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
  return {
    summary,
    body: extractBody(full.payload),
    messageId: header('Message-ID'),
    replyTo: parseFrom(header('Reply-To') || header('From')).email,
  };
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`);

/** Builds the base64url RFC 822 message Gmail's drafts API expects. Header values cannot contain line breaks. */
export function buildRawMessage(d: EmailDraft): string {
  const headers = [
    `To: ${oneLine(d.to)}`,
    `Subject: ${encodeHeader(oneLine(d.subject))}`,
    ...(d.inReplyTo ? [`In-Reply-To: ${oneLine(d.inReplyTo)}`, `References: ${oneLine(d.inReplyTo)}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  const body = (Buffer.from(d.body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Saves a draft in the user's Gmail Drafts folder. This never sends anything. */
export async function createDraft(d: EmailDraft): Promise<{ id: string }> {
  return googleFetch<{ id: string }>('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw: buildRawMessage(d), threadId: d.threadId } }),
  });
}

export const listRecentInbox = (days: number) => searchEmails(`in:inbox newer_than:${days}d -in:chats`, 40);
