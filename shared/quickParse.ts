import type { NewEventInput } from './types';

/**
 * Turns a line of everyday text ("Call Ana tomorrow at 3pm", "Dentista dia 20 às 9h", "Almoço sexta 13h por 2 horas")
 * into an event. Understands English and Portuguese. Pure and offline, so quick capture is instant and works
 * without the local model; the model is only a fallback when no date or time can be found.
 *
 * Conventions: dates like 25/11 are day-first; a weekday means its next occurrence after today.
 */

export interface QuickParse {
  title: string;
  /** "YYYY-MM-DD" when a date was understood. */
  date?: string;
  /** "HH:mm" when a time was understood. */
  time?: string;
  durationMinutes?: number;
  understood: { date: boolean; time: boolean; duration: boolean };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, janeiro: 1, february: 2, feb: 2, fevereiro: 2, fev: 2, march: 3, mar: 3, março: 3, marco: 3, april: 4, apr: 4, abril: 4, abr: 4,
  may: 5, maio: 5, mai: 5, june: 6, jun: 6, junho: 6, july: 7, jul: 7, julho: 7, august: 8, aug: 8, agosto: 8, ago: 8,
  september: 9, sep: 9, sept: 9, setembro: 9, set: 9, october: 10, oct: 10, outubro: 10, out: 10, november: 11, nov: 11, novembro: 11,
  december: 12, dec: 12, dezembro: 12, dez: 12,
};
const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

/** Full weekday names (always understood) and the English abbreviations (only after "on", "next" or "this"). */
const WEEKDAY_FULL: Record<string, number> = {
  sunday: 0, domingo: 0, monday: 1, segunda: 1, 'segunda-feira': 1, tuesday: 2, terça: 2, terca: 2, 'terça-feira': 2, 'terca-feira': 2,
  wednesday: 3, quarta: 3, 'quarta-feira': 3, thursday: 4, quinta: 4, 'quinta-feira': 4, friday: 5, sexta: 5, 'sexta-feira': 5,
  saturday: 6, sábado: 6, sabado: 6,
};
const WEEKDAY_ABBR: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 3 + 1, thur: 4, thurs: 4, fri: 5, sat: 6 };
const WEEKDAY_FULL_RE = Object.keys(WEEKDAY_FULL).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_ABBR_RE = Object.keys(WEEKDAY_ABBR).sort((a, b) => b.length - a.length).join('|');

const ONE = /^(an?|um|uma)$/i;
const number = (s: string) => (ONE.test(s) ? 1 : Number(s.replace(',', '.')));

const FILLER = new Set(['at', 'on', 'in', 'for', 'to', 'the', 'a', 'an', 'às', 'as', 'à', 'em', 'no', 'na', 'para', 'por', 'de', 'do', 'da', 'dia', 'até', 'ate', 'and', 'e', 'with', 'com', '@', 'this', 'next', 'esta', 'este', 'nesta', 'neste', 'próxima', 'proxima', 'próximo', 'proximo']);

export function parseQuickEvent(input: string, now = new Date()): QuickParse {
  let rest = ` ${input} `;
  // Matching runs on an accent-free copy of the same length (JavaScript's \b does not treat letters like ã or à as
  // word characters), and the same spans are cut from the original so the title keeps its accents.
  const ACCENTED = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ';
  const PLAIN = 'aaaaaaceeeeiiiinooooouuuuyy';
  const fold = (text: string) => text.replace(/[àáâãäåçèéêëìíîïñòóôõöùúûüýÿ]/gi, (c) => PLAIN[ACCENTED.indexOf(c.toLowerCase())]);
  let shadow = fold(rest);
  const today = startOfDay(now);
  const understood = { date: false, time: false, duration: false };
  let date: Date | undefined;
  let hour: number | undefined;
  let minute = 0;
  let meridiem: 'am' | 'pm' | undefined;
  let period: 'morning' | 'afternoon' | 'night' | undefined;
  let durationMinutes: number | undefined;
  let tonight = false;

  /** Finds the first match, hands it to `use`, and cuts it out of the text so nothing is matched twice. */
  const take = (re: RegExp, use: (m: RegExpExecArray) => boolean | void): boolean => {
    const m = re.exec(shadow);
    if (!m) return false;
    if (use(m) === false) return false;
    const cut = (text: string) => `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    rest = cut(rest);
    shadow = cut(shadow);
    return true;
  };

  // ---------- durations ----------
  const dur = (minutes: number) => { durationMinutes = Math.round(minutes); understood.duration = true; };
  take(/\b(?:for\s+|por\s+)?(?:half an hour|half hour|meia hora)\b/i, () => dur(30));
  if (!understood.duration) take(/\b(?:for|por|durante)\s+(\d+)\s*h\s*(\d{1,2})\b/i, (m) => dur(Number(m[1]) * 60 + Number(m[2])));
  if (!understood.duration) take(/\b(?:for|por|durante)\s+(an?|um|uma|\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h|horas?)\b/i, (m) => dur(number(m[1]) * 60));
  if (!understood.duration) take(/\b(?:for|por|durante)\s+(an?|um|uma|\d+)\s*(?:minutes?|mins?|min|minutos?)\b/i, (m) => dur(number(m[1])));
  if (!understood.duration) take(/\b(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|horas?)\b/i, (m) => dur(number(m[1]) * 60));
  if (!understood.duration) take(/\b(\d+)\s*(?:minutes?|mins?|minutos?)\b/i, (m) => dur(number(m[1])));

  // ---------- dates ----------
  const setDate = (d: Date) => { date = d; understood.date = true; };
  /** A real calendar day, or undefined (31/2 is not one). Without a year, a date that has passed means next year. */
  const make = (day: number, month: number, year?: number): Date | undefined => {
    if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
    const build = (y: number) => { const d = new Date(y, month - 1, day); return d.getMonth() === month - 1 ? d : undefined; };
    if (year !== undefined) return build(year < 100 ? 2000 + year : year);
    const thisYear = build(today.getFullYear());
    return thisYear && thisYear >= today ? thisYear : build(today.getFullYear() + 1);
  };
  const useDate = (d: Date | undefined) => { if (!d) return false; setDate(d); };

  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, (m) => useDate(make(+m[3], +m[2], +m[1])));
  if (!date) take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => useDate(make(+m[1], +m[2], m[3] ? +m[3] : undefined)));
  if (!date) {
    take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|º)?\\s*(?:of|de)?\\s*(${MONTH_RE})\\b(?:\\s*(?:de|,)?\\s*(\\d{4}))?`, 'i'),
      (m) => useDate(make(+m[1], MONTHS[m[2].toLowerCase()], m[3] ? +m[3] : undefined)));
  }
  if (!date) {
    take(new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s*(\\d{4}))?`, 'i'),
      (m) => useDate(make(+m[2], MONTHS[m[1].toLowerCase()], m[3] ? +m[3] : undefined)));
  }
  if (!date) {
    const dayOfMonth = (day: number) => {
      if (day < 1 || day > 31) return false;
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), day);
      setDate(thisMonth < today ? new Date(today.getFullYear(), today.getMonth() + 1, day) : thisMonth);
    };
    take(/\bdia\s+(\d{1,2})\b/i, (m) => dayOfMonth(+m[1]));
    if (!date) take(/\bon\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i, (m) => dayOfMonth(+m[1]));
  }

  // relative days
  if (!date) take(/\b(?:the\s+)?day after tomorrow\b|\bdepois de amanh[ãa]\b/i, () => setDate(addDays(today, 2)));
  if (!date) take(/\b(?:tomorrow|tmrw|tmr|amanh[ãa])\b/i, () => setDate(addDays(today, 1)));
  if (!date) take(/\b(?:tonight|esta noite|hoje\s+[àa]\s+noite)\b/i, () => { setDate(today); tonight = true; });
  if (!date) take(/\b(?:today|hoje)\b/i, () => setDate(today));
  if (!date) take(/\b(?:in|em)\s+(\d+)\s*(?:days?|dias?)\b/i, (m) => setDate(addDays(today, +m[1])));
  if (!date) take(/\b(?:in|em)\s+(\d+)\s*(?:weeks?|semanas?)\b/i, (m) => setDate(addDays(today, 7 * +m[1])));
  if (!date) take(/\b(?:next week|semana que vem|pr[óo]xima semana)\b/i, () => setDate(addDays(today, 7)));
  if (!date) {
    const nextWeekday = (wd: number) => { const delta = (wd - today.getDay() + 7) % 7; setDate(addDays(today, delta === 0 ? 7 : delta)); };
    take(new RegExp(`\\b(?:(?:next|this|pr[óo]xim[ao]|est[ae]|nest[ae]|na|no|on)\\s+)?(${WEEKDAY_FULL_RE})\\b(?:\\s+que\\s+vem)?`, 'i'), (m) => nextWeekday(WEEKDAY_FULL[m[1].toLowerCase()]));
    if (!date) take(new RegExp(`\\b(?:next|this|on)\\s+(${WEEKDAY_ABBR_RE})\\b`, 'i'), (m) => nextWeekday(WEEKDAY_ABBR[m[1].toLowerCase()]));
  }

  // ---------- times ----------
  const setTime = (h: number, m: number) => { if (h > 23 || m > 59) return false; hour = h; minute = m; understood.time = true; };
  take(/\b(?:noon|meio[- ]dia)\b/i, () => setTime(12, 0));
  if (!understood.time) take(/\b(?:midnight|meia[- ]noite)\b/i, () => setTime(0, 0));
  if (!understood.time) take(/(?:(?<![a-z0-9])(?:at|@|as|a)\s+)?\b(\d{1,2})(?::|h)(\d{2})\s*(am|pm)?\b/i, (m) => { const ok = setTime(+m[1], +m[2]); if (ok !== false && m[3]) meridiem = m[3].toLowerCase() as 'am' | 'pm'; return ok; });
  if (!understood.time) take(/\b(\d{1,2})\s*(am|pm)\b/i, (m) => { const ok = setTime(+m[1], 0); if (ok !== false) meridiem = m[2].toLowerCase() as 'am' | 'pm'; return ok; });
  if (!understood.time) take(/(?:(?<![a-z0-9])(?:at|@|as|a)\s+)?\b(\d{1,2})\s*h\b/i, (m) => setTime(+m[1], 0));
  if (!understood.time) take(/(?<![a-z0-9])(?:at|@|as|a)\s+(\d{1,2})\b(?![\d/:.-])/i, (m) => setTime(+m[1], 0));

  // part of the day, e.g. "3 da tarde", "in the morning"
  take(/\b(?:in the |da |de |a |of the )?(morning|manha|madrugada)\b/i, () => { period = 'morning'; });
  if (!period) take(/\b(?:in the |da |de |a |of the )?(afternoon|tarde)\b/i, () => { period = 'afternoon'; });
  if (!period) take(/\b(?:in the |da |de |a |at |of the )?(evening|night|noite)\b/i, () => { period = 'night'; });

  const wantsEvening = /\b(dinner|jantar|supper|ceia|evening|noite|night)\b/i.test(input);
  if (hour !== undefined) {
    if (meridiem === 'pm' && hour < 12) hour += 12;
    else if (meridiem === 'am' && hour === 12) hour = 0;
    else if (!meridiem && hour <= 12) {
      if (period === 'afternoon' || period === 'night') { if (hour < 12) hour += 12; else if (period === 'night') hour = 0; }
      else if (period === 'morning') { if (hour === 12) hour = 0; }
      else if (hour >= 1 && hour <= 6) hour += 12;
      else if (hour >= 7 && hour <= 11 && wantsEvening) hour += 12;
    }
  } else if (tonight) {
    hour = 20; minute = 0; understood.time = true;
  } else if (period && date) {
    hour = period === 'morning' ? 9 : period === 'afternoon' ? 15 : 20; minute = 0; understood.time = true;
  }

  // ---------- title ----------
  const words = rest.replace(/[,;:]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length && FILLER.has(words[0].toLowerCase())) words.shift();
  while (words.length && FILLER.has(words[words.length - 1].toLowerCase())) words.pop();
  let title = words.join(' ').replace(/^[-–—·|]+|[-–—·|]+$/g, '').trim();
  if (!title) title = input.trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return {
    title,
    date: date ? ymd(date) : undefined,
    time: hour !== undefined ? `${pad(hour)}:${pad(minute)}` : undefined,
    durationMinutes,
    understood,
  };
}

/**
 * Builds the event to propose. A time without a date means the next time that clock time comes round
 * (today if it is still ahead, otherwise tomorrow); a date without a time becomes an all-day event.
 */
export function toEventInput(p: QuickParse, now = new Date()): NewEventInput {
  let date = p.date;
  if (!date && p.time) {
    const [h, m] = p.time.split(':').map(Number);
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
    date = ymd(at > now ? now : addDays(now, 1));
  }
  if (!date) return { title: p.title, start: '' };
  if (!p.time) return { title: p.title, start: date, allDay: true };
  return { title: p.title, start: `${date}T${p.time}`, durationMinutes: p.durationMinutes };
}

/** True when the text gave enough to place an event on the calendar. */
export const isUnderstood = (p: QuickParse) => p.understood.date || p.understood.time;
