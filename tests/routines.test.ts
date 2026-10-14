import { describe, expect, it } from 'vitest';
import { buildRoutine, capNews, isDue, normalizeUrl, RETRY_AFTER_MS, type NewsItem, type Routine } from '../shared/routines';
import {
  absoluteUrl, decodeEntities, discoverFeeds, extractLinks, fetchSite, hackerNewsUrl, newsSearchUrl, parseFeed, searchArticles, searchNews, splitHeadline,
} from '../electron/routines/feeds';
import { curate, FIRST_RUN_ITEMS, runRoutine } from '../electron/routines/runner';
import { newsId, RoutineService, type RoutineStorage } from '../electron/services/routines';
import type { Settings } from '../shared/types';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
<item><title><![CDATA[Rails &amp; Ruby: what's new]]></title><link>https://blog.example/rails-ruby</link><pubDate>Tue, 14 Oct 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;A &lt;b&gt;long&lt;/b&gt; story&lt;/p&gt;</description></item>
<item><title>Second post</title><link>/second</link><guid>abc</guid></item>
<item><title>No link here</title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom blog</title>
<entry><title>Atom one</title><link rel="self" href="https://a.example/self"/><link rel="alternate" href="https://a.example/one"/><updated>2026-10-13T08:00:00Z</updated><summary>Short</summary></entry>
<entry><title>Atom two</title><link href="https://a.example/two"/></entry></feed>`;

const settings = { ollamaUrl: 'http://x', ollamaModel: 'm', modelChat: '', modelTriage: '', modelWriting: '' } as Settings;

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: 'r1', name: 'Test', kind: 'news', target: 'ai', language: 'en', frequency: 'daily', time: '08:00', maxItems: 3, useAi: false, enabled: true, createdAt: 0, ...patch,
});

describe('feed parsing', () => {
  it('decodes entities and CDATA', () => {
    expect(decodeEntities('<![CDATA[A &amp; B]]> &#8212; &#x41; &quot;q&quot; &nbsp;&unknown;')).toBe('A & B — A "q"  &unknown;');
  });

  it('reads RSS items, skipping the ones without a link', () => {
    const items = parseFeed(RSS, 'https://blog.example/feed');
    expect(items.map((i) => i.title)).toEqual(["Rails & Ruby: what's new", 'Second post']);
    expect(items[0]).toMatchObject({ url: 'https://blog.example/rails-ruby', summary: 'A long story', publishedAt: Date.parse('2026-10-14T10:00:00Z') });
    expect(items[1].url).toBe('https://blog.example/second'); // relative link resolved
  });

  it('reads Atom entries and prefers the alternate link', () => {
    const items = parseFeed(ATOM);
    expect(items.map((i) => i.url)).toEqual(['https://a.example/one', 'https://a.example/two']);
    expect(items[0].publishedAt).toBe(Date.parse('2026-10-13T08:00:00Z'));
  });

  it('only accepts http(s) addresses', () => {
    expect(absoluteUrl('javascript:alert(1)')).toBeUndefined();
    expect(absoluteUrl('file:///etc/passwd')).toBeUndefined();
    expect(absoluteUrl('/a', 'https://x.example/b')).toBe('https://x.example/a');
    expect(parseFeed('<rss><channel><item><title>Bad</title><link>javascript:alert(1)</link></item></channel></rss>')).toEqual([]);
  });

  it('splits "Headline - Publisher" from Google News', () => {
    expect(splitHeadline({ title: 'Big launch - The Verge', url: 'u' })).toMatchObject({ title: 'Big launch', source: 'The Verge' });
    expect(splitHeadline({ title: 'No publisher', url: 'u' }).title).toBe('No publisher');
  });
});

describe('finding the latest posts of a website', () => {
  const html = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

  it('finds the feeds a page advertises', () => {
    const page = html('<link rel="alternate" type="application/rss+xml" href="/index.xml"><link rel="stylesheet" href="/a.css"><link type="application/atom+xml" href="https://x.example/atom">');
    expect(discoverFeeds(page, 'https://x.example/')).toEqual(['https://x.example/index.xml', 'https://x.example/atom']);
  });

  it('keeps only article-looking links of the same site', () => {
    const page = html('', `<a href="/">Home page of the site</a><a href="/about">About</a>
      <a href="/2026/10/a-long-article-title">A really long article title here</a>
      <a href="https://other.example/post">An article on another website entirely</a>
      <a href="/2026/10/a-long-article-title#comments">A really long article title here</a>
      <a href="mailto:a@b.c">Write to me please, about anything at all</a>`);
    expect(extractLinks(page, 'https://x.example/').map((i) => i.url)).toEqual(['https://x.example/2026/10/a-long-article-title']);
  });

  const site = (pages: Record<string, string>) => async (url: string) => {
    if (url in pages) return pages[url];
    throw new Error(`404 ${url}`);
  };

  it('reads the address itself when it is a feed', async () => {
    const r = await fetchSite('https://x.example/feed', site({ 'https://x.example/feed': RSS }));
    expect(r.via).toBe('feed');
    expect(r.items).toHaveLength(2);
  });

  it('follows the feed a page advertises', async () => {
    const r = await fetchSite('https://x.example/', site({ 'https://x.example/': html('<link rel="alternate" type="application/atom+xml" href="/atom">'), 'https://x.example/atom': ATOM }));
    expect(r).toMatchObject({ via: 'feed' });
    expect(r.items[0].title).toBe('Atom one');
  });

  it('tries the usual feed paths', async () => {
    const r = await fetchSite('https://x.example/', site({ 'https://x.example/': html(''), 'https://x.example/index.xml': ATOM }));
    expect(r.via).toBe('feed');
  });

  it('falls back to the links on the page', async () => {
    const page = html('', '<a href="/p/my-first-long-article">My first long article of the year</a>');
    const r = await fetchSite('https://x.example/', site({ 'https://x.example/': page }));
    expect(r).toMatchObject({ via: 'page', items: [{ url: 'https://x.example/p/my-first-long-article' }] });
  });
});

describe('searches', () => {
  it('builds the news search address for a language', () => {
    expect(newsSearchUrl('AI OR LLM', 'pt')).toContain('q=AI%20OR%20LLM%20when%3A2d');
    expect(newsSearchUrl('x', 'pt')).toContain('hl=pt-BR');
    expect(newsSearchUrl('x', 'en')).toContain('hl=en-US');
    expect(hackerNewsUrl('llm')).toContain('query=llm');
  });

  it('turns a news RSS into items without the related-links summary', async () => {
    const xml = '<rss><channel><item><title>Chips boom - Reuters</title><link>https://n.example/1</link><description>&lt;a href=&quot;x&quot;&gt;Chips boom&lt;/a&gt;</description></item></channel></rss>';
    const items = await searchNews('chips', 'en', async () => xml);
    expect(items).toEqual([{ title: 'Chips boom', url: 'https://n.example/1', source: 'Reuters', publishedAt: undefined, summary: undefined }]);
  });

  it('reads Hacker News, linking to its page for stories without an address', async () => {
    const json = JSON.stringify({ hits: [
      { objectID: '1', title: 'Show HN: a thing', url: 'https://www.thing.dev/post', created_at_i: 1_700_000_000 },
      { objectID: '2', title: 'Ask HN: anything?', url: null },
      { objectID: '3', title: '', url: 'https://x.example' },
    ] });
    const items = await searchArticles('thing', async () => json);
    expect(items.map((i) => [i.url, i.source])).toEqual([['https://www.thing.dev/post', 'thing.dev'], ['https://news.ycombinator.com/item?id=2', 'Hacker News']]);
    expect(items[0].publishedAt).toBe(1_700_000_000_000);
  });
});

describe('when a routine is due', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 14, h, m);

  it('never runs while paused, and runs at once when it has never run', () => {
    expect(isDue(routine({ enabled: false }), at(12))).toBe(false);
    expect(isDue(routine(), at(12))).toBe(true);
  });

  it('runs hourly and six-hourly routines after their interval', () => {
    const last = at(10).getTime();
    expect(isDue(routine({ frequency: 'hourly', lastRunAt: last }), at(10, 59))).toBe(false);
    expect(isDue(routine({ frequency: 'hourly', lastRunAt: last }), at(11))).toBe(true);
    expect(isDue(routine({ frequency: 'every6h', lastRunAt: last }), at(15))).toBe(false);
    expect(isDue(routine({ frequency: 'every6h', lastRunAt: last }), at(16))).toBe(true);
  });

  it('runs a daily routine once a day, after its time, even if it is late', () => {
    const yesterday = new Date(2026, 9, 13, 8, 5).getTime();
    expect(isDue(routine({ lastRunAt: yesterday }), at(7, 59))).toBe(false); // not yet today
    expect(isDue(routine({ lastRunAt: yesterday }), at(8))).toBe(true);
    expect(isDue(routine({ lastRunAt: yesterday }), at(21))).toBe(true); // the computer was off at 08:00
    expect(isDue(routine({ lastRunAt: at(8, 1).getTime() }), at(21))).toBe(false); // already ran today
  });

  it('waits a while after a failure before trying again', () => {
    const failedAt = at(12).getTime();
    const r = routine({ frequency: 'hourly', lastAttemptAt: failedAt, lastError: 'offline' });
    expect(isDue(r, new Date(failedAt + RETRY_AFTER_MS - 1))).toBe(false);
    expect(isDue(r, new Date(failedAt + RETRY_AFTER_MS))).toBe(true);
  });
});

describe('checking a routine', () => {
  it('fills in the defaults', () => {
    const r = buildRoutine({ name: ' AI ', target: 'llm' }, undefined, 'id1', 5);
    expect(r).toMatchObject({ id: 'id1', name: 'AI', kind: 'news', target: 'llm', frequency: 'daily', time: '08:00', maxItems: 5, useAi: true, enabled: true, createdAt: 5 });
  });

  it('turns a typed address into a full one', () => {
    expect(normalizeUrl('akitaonrails.com')).toBe('https://akitaonrails.com/');
    expect(normalizeUrl('https://akitaonrails.com/')).toBe('https://akitaonrails.com/');
    expect(normalizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(normalizeUrl('ftp://x.example')).toBeUndefined();
    expect(normalizeUrl('two words.com')).toBeUndefined();
    expect(normalizeUrl('localhost')).toBeUndefined();
    expect(buildRoutine({ name: 'Akita', kind: 'site', target: 'akitaonrails.com' }, undefined, 'i').target).toBe('https://akitaonrails.com/');
  });

  it('explains what is wrong', () => {
    expect(() => buildRoutine({ name: '', target: 'x' })).toThrow(/name/i);
    expect(() => buildRoutine({ name: 'a', target: '  ' })).toThrow(/search/i);
    expect(() => buildRoutine({ name: 'a', kind: 'site', target: 'not a site' })).toThrow(/address/i);
    expect(() => buildRoutine({ name: 'a', target: 'x', time: '25:00' })).toThrow(/HH:mm/);
    expect(() => buildRoutine({ name: 'a', target: 'x', kind: 'nope' as never })).toThrow(/type/i);
  });

  it('keeps the limits and starts over when the target changes', () => {
    expect(buildRoutine({ name: 'a', target: 'x', maxItems: 99 }).maxItems).toBe(10);
    expect(buildRoutine({ name: 'a', target: 'x', maxItems: 0 }).maxItems).toBe(5);
    const old = routine({ lastRunAt: 5, lastAdded: 2 });
    expect(buildRoutine({ enabled: false }, old).lastRunAt).toBe(5); // same target: history kept
    expect(buildRoutine({ target: 'other' }, old).lastRunAt).toBeUndefined();
    expect(buildRoutine({ kind: 'site', target: 'x.example' }, old).useAi).toBe(false); // sites never use AI
  });

  it('keeps the news list to the newest items', () => {
    const items = [1, 2, 3].map((n) => ({ id: String(n), addedAt: n }) as NewsItem);
    expect(capNews(items, 2).map((n) => n.id)).toEqual(['3', '2']);
  });
});

const feed = (n: number, prefix = 'a') => Array.from({ length: n }, (_, i) => ({ title: `${prefix} ${i + 1} title`, url: `https://x.example/${prefix}${i + 1}`, publishedAt: 1000 - i }));
const deps = (find: () => Promise<ReturnType<typeof feed>>, chat?: never) => ({ getSettings: () => settings, find, chat, makeId: (u: string) => u, now: () => 99 });

describe('running a routine', () => {
  it('adds the newest items not seen before and remembers everything it looked at', async () => {
    const r = await runRoutine(routine({ maxItems: 2 }), new Set(['https://x.example/a1']), deps(async () => feed(5)));
    expect(r.items.map((i) => i.url)).toEqual(['https://x.example/a2', 'https://x.example/a3']);
    expect(r.items[0]).toMatchObject({ routineId: 'r1', routineName: 'Test', addedAt: 99, read: false });
    expect(r.seen).toHaveLength(5);
  });

  it('shows only a few posts on the first run of a website watcher, all new ones afterwards', async () => {
    const site = routine({ kind: 'site', maxItems: 10 });
    const first = await runRoutine(site, new Set(), deps(async () => feed(8)));
    expect(first.items).toHaveLength(FIRST_RUN_ITEMS);
    expect(first.seen).toHaveLength(8); // the rest is marked seen, so it does not come back later
    const later = await runRoutine({ ...site, lastRunAt: 1 }, new Set(first.seen), deps(async () => [...feed(2, 'new'), ...feed(8)]));
    expect(later.items.map((i) => i.url)).toEqual(['https://x.example/new1', 'https://x.example/new2']);
  });

  it('ignores duplicates in what it finds', async () => {
    const r = await runRoutine(routine(), new Set(), deps(async () => [...feed(2), ...feed(2)]));
    expect(r.items).toHaveLength(2);
  });

  it('lets the AI choose and summarise, using only valid positions', async () => {
    const chat = (async () => ({ role: 'assistant', content: JSON.stringify({ items: [{ n: 3, summary: ' Third one ' }, { n: 3, summary: 'dup' }, { n: 99, summary: 'out of range' }, { n: 'x' }, { n: 1, summary: 'x'.repeat(500) }] }) })) as never;
    const picked = await curate(feed(4), routine({ maxItems: 5, useAi: true }), { getSettings: () => settings, chat });
    expect(picked.map((p) => p.url)).toEqual(['https://x.example/a3', 'https://x.example/a1']);
    expect(picked[0].summary).toBe('Third one');
    expect(picked[1].summary).toHaveLength(240);
  });

  it('falls back to the newest items when the AI is down or answers nonsense', async () => {
    const down = (async () => { throw new Error('Ollama is not running'); }) as never;
    const junk = (async () => ({ role: 'assistant', content: 'not json' })) as never;
    const empty = (async () => ({ role: 'assistant', content: '{"items":[]}' })) as never;
    for (const chat of [down, junk, empty]) {
      const picked = await curate(feed(5), routine({ maxItems: 2, useAi: true }), { getSettings: () => settings, chat });
      expect(picked.map((p) => p.url)).toEqual(['https://x.example/a1', 'https://x.example/a2']);
    }
  });

  it('does not call the AI when it is off', async () => {
    const chat = (async () => { throw new Error('should not be called'); }) as never;
    const r = await runRoutine(routine({ useAi: false, maxItems: 1 }), new Set(), deps(async () => feed(3), chat));
    expect(r.items).toHaveLength(1);
  });
});

function memoryStorage(): RoutineStorage & { data: { routines: Routine[]; seen: Record<string, string[]>; news: NewsItem[] } } {
  const data = { routines: [] as Routine[], seen: {} as Record<string, string[]>, news: [] as NewsItem[] };
  return {
    data,
    routines: () => data.routines, saveRoutines: (r) => { data.routines = r; },
    seen: () => data.seen, saveSeen: (s) => { data.seen = s; },
    news: () => data.news, saveNews: (n) => { data.news = n; },
  };
}

describe('the routine service', () => {
  const make = (find: () => Promise<ReturnType<typeof feed>>, now = () => new Date(2026, 9, 14, 12)) => {
    const storage = memoryStorage();
    const service = new RoutineService({ storage, runner: { getSettings: () => settings, find }, now });
    return { storage, service };
  };
  const input = { name: 'AI', kind: 'news' as const, target: 'ai', useAi: false, maxItems: 3 };

  it('runs a new routine right away and reports the news once', async () => {
    const { service, storage } = make(async () => feed(5));
    const heard: number[] = [];
    service.on('news', (items: unknown[]) => heard.push(items.length));
    service.save(input);
    await service.run(storage.data.routines[0].id); // joins the run already going (no duplicate)
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.data.news).toHaveLength(3);
    expect(storage.data.routines[0]).toMatchObject({ lastAdded: 3, lastError: undefined });
    expect(storage.data.routines[0].lastRunAt).toBeGreaterThan(0);
    expect(heard).toEqual([3]);
  });

  it('adds only new articles on the next run, never the same one twice', async () => {
    let batch = feed(3);
    const { service, storage } = make(async () => batch);
    service.save({ ...input, maxItems: 10 });
    await new Promise((r) => setTimeout(r, 10));
    expect(storage.data.news).toHaveLength(3);
    batch = [...feed(1, 'b'), ...feed(3)];
    const out = await service.run(storage.data.routines[0].id);
    expect(out).toEqual({ added: 1 });
    expect(storage.data.news.map((n) => n.url)).toContain('https://x.example/b1');
    expect(storage.data.news).toHaveLength(4);
    expect(storage.data.news[0].id).toBe(newsId('https://x.example/b1')); // newest first
  });

  it('records a failure, without losing the last good run, and keeps going', async () => {
    let fail = false;
    const { service, storage } = make(async () => { if (fail) throw new Error('example.com answered with HTTP 500'); return feed(2); });
    service.save(input);
    await new Promise((r) => setTimeout(r, 10));
    const goodRun = storage.data.routines[0].lastRunAt;
    fail = true;
    const out = await service.run(storage.data.routines[0].id);
    expect(out.error).toMatch(/HTTP 500/);
    expect(storage.data.routines[0]).toMatchObject({ lastRunAt: goodRun, lastError: expect.stringMatching(/HTTP 500/) });
    fail = false;
    expect((await service.run(storage.data.routines[0].id)).error).toBeUndefined();
    expect(storage.data.routines[0].lastError).toBeUndefined();
  });

  it('runs only the routines that are due when it ticks', async () => {
    let runs = 0;
    const { service, storage } = make(async () => { runs++; return feed(1); });
    storage.data.routines = [routine({ id: 'due' }), routine({ id: 'paused', enabled: false }), routine({ id: 'done', lastRunAt: new Date(2026, 9, 14, 8, 30).getTime() })];
    await service.tick();
    expect(runs).toBe(1);
    expect(storage.data.routines.find((r) => r.id === 'due')?.lastRunAt).toBeGreaterThan(0);
  });

  it('removes a routine together with what it remembered', async () => {
    const { service, storage } = make(async () => feed(2));
    service.save(input);
    await new Promise((r) => setTimeout(r, 10));
    const id = storage.data.routines[0].id;
    expect(storage.data.seen[id]).toHaveLength(2);
    service.remove(id);
    expect(storage.data.routines).toEqual([]);
    expect(storage.data.seen[id]).toBeUndefined();
  });

  it('marks news read, dismisses it and clears what was read', async () => {
    const { service, storage } = make(async () => feed(3));
    service.save(input);
    await new Promise((r) => setTimeout(r, 10));
    const [a, b] = storage.data.news;
    service.markRead(a.id);
    expect(storage.data.news.filter((n) => n.read).map((n) => n.id)).toEqual([a.id]);
    service.dismiss(b.id);
    expect(storage.data.news).toHaveLength(2);
    service.clearRead();
    expect(storage.data.news.map((n) => n.read)).toEqual([false]);
    service.markRead();
    expect(storage.data.news.every((n) => n.read)).toBe(true);
  });

  it('refuses to change a routine that is gone, and to have too many', () => {
    const { service } = make(async () => []);
    expect(() => service.save({ id: 'nope', name: 'x', target: 'y' })).toThrow(/no longer exists/);
    for (let i = 0; i < 30; i++) service.save({ ...input, enabled: false, name: `r${i}` });
    expect(() => service.save({ ...input, enabled: false })).toThrow(/up to 30/);
  });
});
