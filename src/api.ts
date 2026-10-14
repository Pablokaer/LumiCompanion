import type { DndState } from '../shared/dnd';
import { isUnderstood, parseQuickEvent, toEventInput } from '../shared/quickParse';
import { buildRoutine, type NewsItem, type Routine } from '../shared/routines';
import type {
  AuthState, CalendarEvent, CaptureResult, ChatMessage, DataSnapshot, FocusState, LumiApi, NewEventInput, ScoredEmail, Settings, UpdateState,
} from '../shared/types';
import type { WeatherCondition, WeatherState } from '../shared/weather';

declare global {
  interface Window { lumi?: LumiApi }
}

/**
 * In Electron the preload exposes `window.lumi`. When the UI is opened in a
 * normal browser (`npm run preview:ui`) we fall back to a mock with sample data
 * so the design can be worked on without Google or Ollama.
 */
export const api: LumiApi = window.lumi ?? createMockApi();
export const isMock = !window.lumi;

function createMockApi(): LumiApi {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const emit = (ch: string, p: unknown) => listeners.get(ch)?.forEach((l) => l(p));
  const at = (dayOffset: number, h: number, m = 0) => {
    const d = new Date(); d.setDate(d.getDate() + dayOffset); d.setHours(h, m, 0, 0); return d.toISOString();
  };
  const soon = new Date(Date.now() + 12 * 60_000).toISOString();
  const soonEnd = new Date(Date.now() + 42 * 60_000).toISOString();
  const params = new URLSearchParams(location.search);
  let auth: AuthState = { configured: true, signedIn: params.get('signedIn') !== '0', profile: { name: 'Pablo', email: 'pablo@example.com' } };
  let settings: Settings = {
    mascotName: 'Lumi', widgetMode: 'desktop', widgetView: (params.get('view') as Settings['widgetView']) ?? 'mascot', widgetScale: Number(params.get('scale')) || 1,
    panelScale: 1,
    startInTray: false, skin: ((params.get('skin') as Settings['skin']) ?? 'classic'), customColor: '#' + (params.get('color') ?? 'ff6fae'), colorSwatches: ['#ff6fae', '#34d399', '#f59e0b'], shape: (params.get('shape') as Settings['shape']) ?? 'star', accessories: (params.get('acc')?.split(',').filter(Boolean) ?? []) as Settings['accessories'], mascotLife: true, followMouse: true, petReactions: true, dndFullscreen: true, dndMeetings: false, dndHideWidget: true, quickCapture: true, quickCaptureShortcut: 'CommandOrControl+Shift+Space', weather: true, weatherPlace: '', temperatureUnit: 'c', seasonalLook: true, reactToSystem: true, proactiveTips: true, tipFrequency: 'normal', keepSignedIn: true, autoSetupOllama: true, sleepAfterMinutes: 3, reactToMusic: true, autoUpdate: true, autoInstallUpdates: true, autoStartOllama: true, morningBriefing: true, briefingTime: '08:00', focusMinutes: 25, voiceLanguage: 'system', modelChat: '', modelTriage: '', modelWriting: '', launchAtLogin: true, reminderLeadMinutes: [15, 5], systemNotifications: true,
    ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'llama3.1:8b', aiEmailTriage: true, emailLookbackDays: 2,
  };
  const events: CalendarEvent[] = [
    { id: '1', title: 'Team stand-up', start: soon, end: soonEnd, allDay: false, meetLink: 'https://meet.google.com/abc', joinUrl: 'https://meet.google.com/abc' },
    { id: '2', title: 'Lunch with Marina', start: at(0, 13), end: at(0, 14), allDay: false, location: 'Café Orbital' },
    { id: '3', title: 'Product review', start: at(0, 16, 30), end: at(0, 17, 30), allDay: false },
    { id: '4', title: 'Mum’s birthday 🎂', start: at(1, 0), end: at(2, 0), allDay: true },
    { id: '5', title: 'Dentist', start: at(1, 9, 30), end: at(1, 10, 15), allDay: false, location: 'Rua das Estrelas 42' },
    { id: '6', title: 'Quarterly planning', start: at(3, 10), end: at(3, 12), allDay: false },
  ];
  const mk = (id: string, from: string, subject: string, snippet: string, score: number, reasons: string[], aiReason?: string): ScoredEmail => ({
    id, threadId: id, from, fromEmail: `${from.split(' ')[0].toLowerCase()}@example.com`, to: 'pablo@example.com', subject, snippet,
    date: new Date(Date.now() - Number(id) * 3_600_000).toISOString(), labelIds: ['INBOX', 'UNREAD'], hasListUnsubscribe: false,
    score, level: score >= 60 ? 'high' : score >= 35 ? 'medium' : 'low', reasons, aiReason, url: 'https://mail.google.com',
  });
  const emails: ScoredEmail[] = [
    mk('1', 'Ana Ribeiro', 'Contract needs your signature today', 'Hi Pablo, the client is waiting on the signed contract before 5pm…', 92, ['Marked important by Gmail', 'Mentions “contract”, “today”'], 'Client deadline today'),
    mk('2', 'Finance Team', 'Invoice #2291 overdue', 'Friendly reminder that invoice #2291 is now 3 days overdue…', 74, ['Unread', 'Mentions “invoice”, “overdue”'], 'Overdue payment'),
    mk('3', 'Carlos Mendes', 'Re: interview slots next week', 'Would Tuesday at 10:00 work for the second round?', 63, ['Sent directly to you', 'Mentions “interview”'], 'Needs a reply'),
    mk('4', 'GitHub', '[finperiti/core] PR #482 approved', 'Your pull request was approved by 2 reviewers.', 41, ['Automated update']),
    mk('5', 'Space Weekly', 'The 10 most beautiful nebulae', 'This week: Carina, Orion and a surprise…', 12, ['Newsletter', 'Promotion']),
  ];
  const hoursAgo = (h: number) => Date.now() - h * 3_600_000;
  let routines: Routine[] = [
    { id: 'r1', name: 'AI & LLM news', kind: 'news', target: 'artificial intelligence OR LLM', language: 'en', frequency: 'daily', time: '08:00', maxItems: 5, useAi: true, enabled: true, createdAt: hoursAgo(72), lastRunAt: hoursAgo(3), lastAdded: 3 },
    { id: 'r2', name: 'Akita on Rails', kind: 'site', target: 'https://akitaonrails.com/', language: 'en', frequency: 'hourly', time: '08:00', maxItems: 5, useAi: false, enabled: true, createdAt: hoursAgo(72), lastRunAt: hoursAgo(1), lastAdded: 1 },
  ];
  let news: NewsItem[] = [
    { id: 'n1', routineId: 'r2', routineName: 'Akita on Rails', title: 'Rodando LLMs locais no meu servidor caseiro', url: 'https://akitaonrails.com/', source: 'akitaonrails.com', summary: 'Um passo a passo de como montar um servidor para rodar modelos abertos.', publishedAt: hoursAgo(1), addedAt: hoursAgo(1), read: false },
    { id: 'n2', routineId: 'r1', routineName: 'AI & LLM news', title: 'New open-weight model tops coding benchmarks', url: 'https://news.ycombinator.com/', source: 'Hacker News', summary: 'A lab released a model that beats larger rivals on several programming evaluations.', publishedAt: hoursAgo(3), addedAt: hoursAgo(3), read: false },
    { id: 'n3', routineId: 'r1', routineName: 'AI & LLM news', title: 'Chipmakers report record demand for AI accelerators', url: 'https://news.google.com/', source: 'Reuters', publishedAt: hoursAgo(5), addedAt: hoursAgo(3), read: true },
  ];
  const setNews = (next: NewsItem[]) => { news = next; emit('news:updated', news); };
  let focusState: FocusState | undefined;
  let snapshot: DataSnapshot = { events, emails, lastSync: new Date().toISOString() };

  return {
    auth: {
      getState: async () => auth,
      signIn: async () => { await wait(800); auth = { ...auth, signedIn: true }; return auth; },
      signOut: async () => { auth = { ...auth, signedIn: false }; return auth; },
    },
    data: {
      get: async () => snapshot,
      refresh: async () => { await wait(600); snapshot = { ...snapshot, lastSync: new Date().toISOString() }; return snapshot; },
      getRange: async (fromIso, toIso) => {
        const from = new Date(fromIso);
        const to = new Date(toIso);
        const extra: CalendarEvent[] = [];
        for (let d = new Date(from); d < to; d.setDate(d.getDate() + 1)) {
          const day = d.getDate();
          const mk = (id: string, title: string, h: number, len = 1): CalendarEvent => {
            const s = new Date(d); s.setHours(h, 0, 0, 0);
            return { id: `${id}-${d.toDateString()}`, title, start: s.toISOString(), end: new Date(+s + len * 3_600_000).toISOString(), allDay: false };
          };
          if (day % 3 === 0) extra.push(mk('study', 'Study session', 18, 2));
          if (day % 7 === 2) extra.push(mk('gym', 'Gym', 7));
          if (day % 10 === 5) extra.push(mk('rev', 'Project review', 11));
          if (day === 15) extra.push({ id: `due-${d.getMonth()}`, title: 'Assignment due', start: new Date(d.getFullYear(), d.getMonth(), 15).toISOString(), end: new Date(d.getFullYear(), d.getMonth(), 16).toISOString(), allDay: true });
        }
        return [...snapshot.events, ...extra].filter((e) => new Date(e.end) > from && new Date(e.start) < to);
      },
      createEvent: async (input: NewEventInput) => {
        const start = new Date(input.start).toISOString();
        const ev: CalendarEvent = { id: String(Math.random()), title: input.title, start, end: new Date(+new Date(start) + 3_600_000).toISOString(), allDay: !!input.allDay };
        snapshot = { ...snapshot, events: [...snapshot.events, ev].sort((a, b) => a.start.localeCompare(b.start)) };
        emit('data:updated', snapshot);
        return ev;
      },
    },
    agent: {
      send: async (history: ChatMessage[]) => {
        emit('agent:status', { state: 'thinking' });
        await wait(900);
        emit('agent:status', { state: 'idle' });
        const last = history[history.length - 1]?.content.toLowerCase() ?? '';
        if (last.includes('email')) return 'Your top priority is **Ana’s contract** — it needs a signature before 5pm. Finance also flagged an overdue invoice. ✦';
        return 'You have 3 things today: stand-up soon, lunch with Marina at 13:00 and the product review at 16:30. Shine on! ✦';
      },
      respondConfirm: async () => undefined,
      ollamaStatus: async () => ({ running: true, models: ['llama3.1:8b', 'qwen2.5:7b'] }),
      setupOllama: async () => {
        for (const [status, percent] of [['downloading', 20], ['downloading', 90], ['installing', 0], ['pulling', 15], ['pulling', 70]] as const) {
          emit('ollama:setup', { status, percent, model: 'qwen2.5:7b', message: status === 'downloading' ? 'Downloading Ollama' : status === 'installing' ? 'Installing Ollama' : 'Downloading the qwen2.5:7b model' });
          await wait(600);
        }
        emit('ollama:setup', { status: 'ready' });
        return { status: 'ready' as const };
      },
      setupState: async () => {
        const f = params.get('ollama');
        if (f === 'downloading') return { status: 'downloading' as const, percent: 42, message: 'Downloading Ollama' };
        if (f === 'pulling') return { status: 'pulling' as const, percent: 63, model: 'qwen2.5:7b', message: 'Downloading the qwen2.5:7b model' };
        if (f === 'error') return { status: 'error' as const, message: 'Could not reach ollama.com. Check your internet connection; Lumi will try again next time it opens.' };
        if (f === 'unsupported') return { status: 'unsupported' as const, message: 'On Linux, install Ollama with:  curl -fsSL https://ollama.com/install.sh | sh  (it needs administrator rights), then reopen Lumi.' };
        return { status: 'idle' as const };
      },
    },
    updates: (() => {
      const forced = params.get('update');
      let state: UpdateState = { status: 'idle', currentVersion: '0.1.5', notifyOnly: params.get('notify') === '1' };
      if (forced === 'ready') state = { ...state, status: 'ready', version: '0.1.9', percent: 100 };
      if (forced === 'available') state = { ...state, status: 'available', version: '0.1.9' };
      if (forced === 'downloading') state = { ...state, status: 'downloading', version: '0.1.9', percent: 42 };
      if (forced === 'error') state = { ...state, status: 'error', message: 'Could not reach the update server. Check your internet connection.' };
      return {
        getState: async () => state,
        check: async () => { state = { ...state, status: 'checking' }; emit('update:state', state); await wait(900); state = { ...state, status: 'none' }; emit('update:state', state); return state; },
        download: async () => {
          for (const percent of [5, 30, 60, 90, 100]) { state = { ...state, status: 'downloading', version: '0.1.9', percent }; emit('update:state', state); await wait(500); }
          state = { ...state, status: 'ready', percent: 100 }; emit('update:state', state);
          return state;
        },
        install: async () => undefined,
        openDownload: async () => { window.open('https://github.com/Pablokaer/LumiCompanion/releases/latest', '_blank'); },
      };
    })(),
    dnd: (() => {
      // ?dnd=fullscreen|meeting|manual shows each kind of quiet in the browser preview
      const forced = params.get('dnd') as DndState['reason'] | null;
      let state: DndState = forced ? { active: true, reason: forced, until: forced === 'manual' ? Date.now() + 3_600_000 : undefined, meeting: forced === 'meeting' ? 'Team stand-up' : undefined } : { active: false };
      return {
        get: async () => state,
        set: async (ms: number | null) => { state = ms ? { active: true, reason: 'manual', until: ms } : { active: false }; emit('dnd:state', state); return state; },
      };
    })(),
    weather: (() => {
      // ?weather=rain|snow|hot|cold|fog|thunder|clear|off shows each kind of weather in the browser preview
      const kind = params.get('weather') ?? 'clear';
      const presets: Record<string, { condition: WeatherCondition; temperatureC: number; isDay?: boolean }> = {
        rain: { condition: 'rain', temperatureC: 14 }, snow: { condition: 'snow', temperatureC: -2 }, hot: { condition: 'clear', temperatureC: 34 },
        cold: { condition: 'cloudy', temperatureC: 2 }, fog: { condition: 'fog', temperatureC: 9 }, thunder: { condition: 'thunder', temperatureC: 19 },
        clear: { condition: 'clear', temperatureC: 21 }, night: { condition: 'clear', temperatureC: 12, isDay: false },
      };
      const preset = presets[kind];
      const state: WeatherState = kind === 'off' || !preset ? { status: 'off' } : { status: 'ok', place: 'Lisbon, Portugal', latitude: Number(params.get('lat') ?? 38.7), isDay: true, updatedAt: Date.now(), ...preset };
      return { get: async () => state, refresh: async () => state };
    })(),
    capture: {
      parse: async (text: string): Promise<CaptureResult> => {
        await wait(150);
        const parsed = parseQuickEvent(text);
        return isUnderstood(parsed) ? { event: toEventInput(parsed), understood: true, via: 'rules' } : { event: { title: parsed.title, start: '' }, understood: false, via: 'none' };
      },
      close: async () => undefined,
      setShortcut: async (accelerator: string) => (/\+/.test(accelerator) ? { ok: true } : { ok: false, error: `“${accelerator}” is not a valid shortcut. Use something like CommandOrControl+Shift+Space.` }),
    },
    music: {
      requestStart: async () => undefined,
    },
    focus: {
      get: async () => focusState,
      start: async (minutes) => { focusState = { endsAt: Date.now() + minutes * 60_000, minutes }; emit('focus:changed', focusState); return focusState; },
      stop: async () => { focusState = undefined; emit('focus:changed', undefined); },
    },
    briefing: {
      show: async () => {
        emit('briefing', {
          title: 'Good morning, Pablo! Here is your day',
          lines: ['3 events today:', '• 09:30 — Dentist', '• 13:00 — Lunch with Marina', '• 16:30 — Product review', '2 important emails:', '• Ana Ribeiro: Contract needs your signature today', '• Finance Team: Invoice #2291 overdue'],
        });
      },
    },
    mail: {
      draftReply: async (emailId, instructions) => {
        await wait(900);
        const e = emails.find((m) => m.id === emailId);
        return { threadId: emailId, to: e?.fromEmail ?? 'ana@example.com', subject: `Re: ${e?.subject ?? ''}`, body: `Hi ${e?.from.split(' ')[0] ?? ''},\n\n${instructions || 'Thanks for your message — I will get back to you shortly.'}\n\nBest,\nPablo` };
      },
      saveDraft: async () => { await wait(500); return { url: 'https://mail.google.com/mail/u/0/#drafts' }; },
      suggestEvent: async (emailId) => {
        await wait(900);
        if (emailId !== '3') return undefined;
        const d = new Date(); d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
        const pad = (n: number) => String(n).padStart(2, '0');
        return { title: 'Second-round interview', start: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`, durationMinutes: 60 };
      },
    },
    voice: {
      transcribe: async () => { await wait(800); return 'Schedule a call with Ana tomorrow at 15:00'; },
    },
    docs: {
      pickFile: async () => ({ path: 'C:\\sample\\questions.docx', name: 'questions.docx' }),
      answerFile: async () => {
        for (const message of ['Reading your file…', 'Question 1/2: searching sources…', 'Question 1/2: writing the answer…', 'Creating your Google Doc…']) {
          emit('agent:status', { state: 'progress', message });
          await wait(700);
        }
        emit('agent:status', { state: 'idle' });
        return { title: 'Sample answers', url: 'https://docs.google.com/document/d/sample/edit', questionCount: 2, sourceCount: 4, unsupported: [], style: 'APA' as const, reviewNotes: 2 };
      },
    },
    routines: {
      list: async () => routines,
      save: async (input) => {
        const r = buildRoutine(input, input.id ? routines.find((x) => x.id === input.id) : undefined, `r${Date.now()}`);
        routines = input.id ? routines.map((x) => (x.id === r.id ? r : x)) : [...routines, r];
        emit('routines:updated', routines);
        return routines;
      },
      remove: async (id) => { routines = routines.filter((r) => r.id !== id); emit('routines:updated', routines); return routines; },
      run: async () => { await wait(800); return { added: 0 }; },
    },
    news: {
      list: async () => news,
      open: async (id) => { const n = news.find((x) => x.id === id); if (n) { setNews(news.map((x) => (x.id === id ? { ...x, read: true } : x))); window.open(n.url, '_blank'); } },
      markRead: async (id) => setNews(news.map((x) => (!id || x.id === id ? { ...x, read: true } : x))),
      dismiss: async (id) => setNews(news.filter((x) => x.id !== id)),
      clearRead: async () => setNews(news.filter((x) => !x.read)),
    },
    settings: {
      get: async () => settings,
      update: async (patch) => (settings = { ...settings, ...patch }),
    },
    window: {
      setMode: async () => undefined,
      hide: async () => undefined,
      openExternal: async (url) => { window.open(url, '_blank'); },
    },
    on(channel, listener) {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
      if (channel === 'system' && params.get('system')) {
        // ?system=unlock-screen|on-ac|on-battery|resume plays one system event shortly after loading
        const kind = params.get('system')!;
        window.setTimeout(() => listener({ kind }), 1500);
      }
      if (channel === 'cursor') {
        const move = (e: PointerEvent) => listener({ x: e.clientX, y: e.clientY });
        window.addEventListener('pointermove', move);
        const pinned = params.get('mouse')?.split(',').map(Number);
        if (pinned && pinned.length === 2) window.setTimeout(() => listener({ x: pinned[0], y: pinned[1] }), 300);
        return () => { window.removeEventListener('pointermove', move); listeners.get(channel)!.delete(listener); };
      }
      if (channel === 'activity') {
        // Browser preview: idle time = time since the last key or mouse movement (?sleep=1 starts asleep).
        let lastInput = params.get('sleep') === '1' ? Date.now() - 3_600_000 : Date.now();
        const touch = () => { lastInput = Date.now(); listener({ idleSeconds: 0 }); };
        window.addEventListener('pointermove', touch);
        window.addEventListener('keydown', touch);
        const timer = window.setInterval(() => listener({ idleSeconds: (Date.now() - lastInput) / 1000 }), 5000);
        window.setTimeout(() => listener({ idleSeconds: (Date.now() - lastInput) / 1000 }), 300);
        return () => { window.clearInterval(timer); window.removeEventListener('pointermove', touch); window.removeEventListener('keydown', touch); listeners.get(channel)!.delete(listener); };
      }
      if (channel === 'reminder' && params.get('reminder') === '1') {
        setTimeout(() => listener({ event: events[0], minutesUntil: 5, message: '“Team stand-up” starts in 5 minutes.' }), 1500);
      }
      return () => listeners.get(channel)!.delete(listener);
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
