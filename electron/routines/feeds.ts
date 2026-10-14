/**
 * Finding articles on the web: news searches (Google News RSS), developer articles (Hacker News) and
 * websites to watch (their feed, or failing that the links on their page). Parsing is done by plain
 * code, with no extra dependency, and every address that comes out is an http(s) one.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import type { RoutineLanguage } from '../../shared/routines';

export interface FeedItem {
  title: string;
  url: string;
  source?: string;
  /** Epoch ms. */
  publishedAt?: number;
  summary?: string;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; LumiCompanion/1.0; +https://github.com/Pablokaer/LumiCompanion)';
const MAX_BYTES = 3_000_000;

/** Addresses that belong to this computer or its local network (and other non-public ranges). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(v)) {
    const [a, b] = v.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(v)) {
    const dotted = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = v.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16); return isPrivateAddress([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')); }
    if (v === '::' || v === '::1') return true;
    const first = parseInt(v.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00; // unique-local, link-local, multicast
  }
  return true; // not an address at all
}

/** Refuses a host that is, or resolves to, a private address: a routine must not be a way to read your own network. */
export async function assertPublicUrl(url: URL, lookup: (host: string) => Promise<{ address: string }[]> = (h) => dns.lookup(h, { all: true })): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const refuse = () => new Error(`${host} is not a public website, so Lumi will not read it.`);
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host)) throw refuse();
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host);
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw refuse();
}

/** Reads at most `max` bytes of a response as text, and stops downloading there. */
export async function readLimited(res: Response, max: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, max);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    size += value.length;
  }
  if (size >= max) await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

const MAX_REDIRECTS = 5;

export async function fetchText(url: string, timeoutMs = 20_000): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  // Redirects are followed by hand so every hop is checked, not just the first address.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!/^https?:\/\//i.test(current)) throw new Error('Only http and https addresses can be read.');
    await assertPublicUrl(new URL(current));
    const res = await fetch(current, {
      redirect: 'manual',
      signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, application/json;q=0.9, */*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new Error(`${new URL(current).hostname} sent a redirect without a destination`);
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`${new URL(current).hostname} answered with HTTP ${res.status}`);
    return readLimited(res, MAX_BYTES);
  }
  throw new Error('That address redirects too many times.');
}

// ---------- text helpers ----------

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function decodeEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => NAMED[n.toLowerCase()] ?? m);
}

const safeChar = (code: number) => { try { return String.fromCodePoint(code); } catch { return ''; } };

export function stripTags(html: string): string {
  return decodeEntities(decodeEntities(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** An absolute http(s) address, or undefined. */
export function absoluteUrl(href: string, base?: string): string | undefined {
  try {
    const url = new URL(decodeEntities(href).trim(), base);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

// ---------- RSS and Atom ----------

function tagText(block: string, tag: string): string | undefined {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : undefined;
}

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a)) ?? links[0];
  return pick?.match(/href=["']([^"']+)["']/i)?.[1];
}

export function looksLikeFeed(text: string): boolean {
  return /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 2000));
}

/** The articles in an RSS or Atom document. */
export function parseFeed(xml: string, baseUrl?: string): FeedItem[] {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = stripTags(tagText(block, 'title') ?? '');
    const textLink = tagText(block, 'link');
    const rawLink = textLink && stripTags(textLink) ? stripTags(textLink) : atomLink(block) ?? stripTags(tagText(block, 'guid') ?? '');
    const url = rawLink ? absoluteUrl(rawLink, baseUrl) : undefined;
    if (!title || !url) continue;
    const date = Date.parse(stripTags(tagText(block, 'pubDate') ?? tagText(block, 'published') ?? tagText(block, 'updated') ?? tagText(block, 'dc:date') ?? ''));
    const summary = stripTags(tagText(block, 'description') ?? tagText(block, 'summary') ?? tagText(block, 'content') ?? '');
    const source = stripTags(tagText(block, 'source') ?? '');
    items.push({
      title: cut(title, 200),
      url,
      source: source || undefined,
      publishedAt: Number.isFinite(date) ? date : undefined,
      summary: summary && summary !== title ? cut(summary, 280) : undefined,
    });
  }
  return items;
}

// ---------- websites ----------

/** Feeds a page advertises in its head. */
export function discoverFeeds(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const url = href && absoluteUrl(href, baseUrl);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');

/** Article-looking links on a page (long enough text, same site), in page order. A last resort when there is no feed. */
export function extractLinks(html: string, baseUrl: string): FeedItem[] {
  const items: FeedItem[] = [];
  const seen = new Set<string>();
  const here = host(baseUrl);
  for (const m of html.matchAll(/<a\b[^>]*?href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absoluteUrl(m[2], baseUrl);
    if (!url) continue;
    const clean = url.split('#')[0];
    const parsed = new URL(clean);
    const title = stripTags(m[3]);
    if (host(clean) !== here || parsed.pathname.replace(/\/+$/, '') === '' || seen.has(clean)) continue;
    if (title.length < 20 || title.split(' ').length < 3) continue;
    seen.add(clean);
    items.push({ title: cut(title, 200), url: clean });
  }
  return items;
}

const COMMON_FEEDS = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml'];

/** The latest posts of a website: from the feed when it has one, otherwise from the links on its page. */
export async function fetchSite(target: string, get: typeof fetchText = fetchText): Promise<{ items: FeedItem[]; via: 'feed' | 'page' }> {
  const body = await get(target);
  if (looksLikeFeed(body)) return { items: parseFeed(body, target), via: 'feed' };
  const tried = new Set<string>();
  const tryFeed = async (url: string) => {
    if (tried.has(url) || tried.size >= 6) return [];
    tried.add(url);
    try {
      const text = await get(url);
      return looksLikeFeed(text) ? parseFeed(text, url) : [];
    } catch { return []; }
  };
  for (const url of discoverFeeds(body, target)) {
    const items = await tryFeed(url);
    if (items.length) return { items, via: 'feed' };
  }
  const origin = new URL(target).origin;
  for (const p of COMMON_FEEDS) {
    const items = await tryFeed(origin + p);
    if (items.length) return { items, via: 'feed' };
  }
  return { items: extractLinks(body, target), via: 'page' };
}

// ---------- searches ----------

const NEWS_LOCALE: Record<RoutineLanguage, string> = { en: 'hl=en-US&gl=US&ceid=US:en', pt: 'hl=pt-BR&gl=BR&ceid=BR:pt-419' };

export function newsSearchUrl(query: string, language: RoutineLanguage): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&${NEWS_LOCALE[language]}`;
}

/** Google News titles end with " - Publisher". */
export function splitHeadline(item: FeedItem): FeedItem {
  const m = item.title.match(/^(.*\S)\s[-–—]\s([^-–—]{2,60})$/);
  if (!m) return item;
  return { ...item, title: m[1], source: item.source ?? m[2].trim() };
}

export async function searchNews(query: string, language: RoutineLanguage, get: typeof fetchText = fetchText): Promise<FeedItem[]> {
  const xml = await get(newsSearchUrl(query, language));
  // Google's summaries are only a list of related links, so they are dropped.
  return parseFeed(xml).map((i) => splitHeadline({ ...i, summary: undefined }));
}

interface HackerNewsHit { objectID: string; title?: string | null; story_title?: string | null; url?: string | null; created_at_i?: number; points?: number }

export function hackerNewsUrl(query: string): string {
  const params = new URLSearchParams({ query, tags: 'story', numericFilters: 'points>5', hitsPerPage: '30' });
  return `https://hn.algolia.com/api/v1/search_by_date?${params}`;
}

export async function searchArticles(query: string, get: typeof fetchText = fetchText): Promise<FeedItem[]> {
  const json = JSON.parse(await get(hackerNewsUrl(query))) as { hits?: HackerNewsHit[] };
  const items: FeedItem[] = [];
  for (const h of json.hits ?? []) {
    const title = (h.title ?? h.story_title ?? '').trim();
    const url = h.url ? absoluteUrl(h.url) : `https://news.ycombinator.com/item?id=${encodeURIComponent(h.objectID)}`;
    if (!title || !url) continue;
    items.push({
      title: cut(title, 200),
      url,
      source: h.url ? new URL(url).hostname.replace(/^www\./, '') : 'Hacker News',
      publishedAt: h.created_at_i ? h.created_at_i * 1000 : undefined,
    });
  }
  return items;
}
