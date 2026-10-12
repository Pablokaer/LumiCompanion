import type { EmailSummary } from '../../shared/types';
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

async function getMessage(id: string): Promise<EmailSummary> {
  const params = new URLSearchParams({ format: 'metadata' });
  for (const h of ['From', 'To', 'Subject', 'Date', 'List-Unsubscribe']) params.append('metadataHeaders', h);
  const m = await googleFetch<GMessage>(`${BASE}/${id}?${params}`);
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

export const listRecentInbox = (days: number) => searchEmails(`in:inbox newer_than:${days}d -in:chats`, 40);
