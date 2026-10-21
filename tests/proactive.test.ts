import { describe, expect, it } from 'vitest';
import { ActivityTracker, FREQUENCY_FACTOR, MIN_GAP_MINUTES, TipEngine, calendarWindowMinutes, type TipContext } from '../shared/proactive';

const MIN = 60_000;
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ctx = (over: Partial<TipContext> = {}): TipContext => ({ now: 1_000_000_000_000, activeMinutes: 0, hour: 14, quiet: false, ...over });

describe('when she speaks up', () => {
  it('says nothing after a short stretch of work', () => {
    const engine = new TipEngine(rng(1));
    expect(engine.consider(ctx({ activeMinutes: 10 }))).toBeUndefined();
    expect(engine.consider(ctx({ activeMinutes: 30 }))).toBeUndefined();
  });

  it('suggests a break once you have worked a long time, then waits before the next tip', () => {
    const engine = new TipEngine(rng(1));
    const t0 = ctx({ activeMinutes: 60 });
    const first = engine.consider(t0);
    expect(first?.id).toBe('stretch');
    expect(first?.text.length).toBeGreaterThan(10);
    expect(engine.consider({ ...t0, now: t0.now + 5 * MIN, activeMinutes: 90 })).toBeUndefined(); // too soon after the last tip
    expect(engine.consider({ ...t0, now: t0.now + (MIN_GAP_MINUTES + 1) * MIN, activeMinutes: 90 })?.id).toBe('water'); // a different tip, after the gap
  });

  it('never repeats the same tip before its cooldown', () => {
    const engine = new TipEngine(rng(2));
    let t = 1_000_000_000_000;
    const seen: { id: string; at: number }[] = [];
    for (let minute = 0; minute < 8 * 60; minute += 5) {
      t += 5 * MIN;
      const tip = engine.consider({ now: t, activeMinutes: 200, hour: 14, quiet: false });
      if (tip) seen.push({ id: tip.id, at: t });
    }
    expect(seen.length).toBeGreaterThan(3);
    for (const id of new Set(seen.map((s) => s.id))) {
      const times = seen.filter((s) => s.id === id).map((s) => s.at);
      for (let i = 1; i < times.length; i++) expect((times[i] - times[i - 1]) / MIN).toBeGreaterThanOrEqual(45);
    }
    // and never more than a few tips an hour: at least the global gap apart
    for (let i = 1; i < seen.length; i++) expect((seen[i].at - seen[i - 1].at) / MIN).toBeGreaterThanOrEqual(MIN_GAP_MINUTES);
  });

  it('stays silent whenever she should be quiet', () => {
    const engine = new TipEngine(rng(1));
    expect(engine.consider(ctx({ activeMinutes: 500, quiet: true }))).toBeUndefined();
    expect(engine.consider(ctx({ activeMinutes: 500, quiet: false }))).toBeDefined(); // and speaks when she may
  });

  it('suggests bedtime late at night, once per night', () => {
    const engine = new TipEngine(rng(1));
    const night = ctx({ hour: 2, activeMinutes: 25 });
    expect(engine.consider(night)?.id).toBe('late');
    expect(engine.consider({ ...night, now: night.now + 2 * 60 * MIN })).not.toMatchObject({ id: 'late' });
    expect(engine.consider(ctx({ hour: 14, activeMinutes: 25 }))).toBeUndefined(); // not at 2 pm
  });

  it('mentions the umbrella when rain and an event are close, but only now and then', () => {
    const engine = new TipEngine(rng(3));
    const rainy = ctx({ rainSoon: true });
    expect(engine.consider(rainy)?.id).toBe('rain');
    expect(engine.consider({ ...rainy, now: rainy.now + 60 * MIN })).toBeUndefined();
    expect(engine.consider({ ...rainy, now: rainy.now + 4 * 60 * MIN })?.id).toBe('rain');
  });

  it('remembers across restarts', () => {
    const a = new TipEngine(rng(1));
    const t0 = ctx({ activeMinutes: 60 });
    expect(a.consider(t0)).toBeDefined();
    const b = new TipEngine(rng(1), a.serialize());
    expect(b.consider({ ...t0, now: t0.now + 2 * MIN })).toBeUndefined();
  });
});

describe('frequency', () => {
  it('"rare" waits longer and "often" waits less', () => {
    const count = (freq: 'rare' | 'normal' | 'often') => {
      const engine = new TipEngine(rng(5), undefined, freq);
      let t = 1_000_000_000_000, n = 0;
      for (let i = 0; i < 12 * 60; i += 5) { t += 5 * MIN; if (engine.consider({ now: t, activeMinutes: 300, hour: 14, quiet: false })) n++; }
      return n;
    };
    expect(count('rare')).toBeLessThan(count('normal'));
    expect(count('normal')).toBeLessThan(count('often'));
    expect(FREQUENCY_FACTOR.rare).toBeGreaterThan(FREQUENCY_FACTOR.often);
  });
});

describe('measuring continuous use', () => {
  it('adds up while you are active and starts again after a real break', () => {
    const t = new ActivityTracker();
    let now = 0;
    for (let i = 0; i < 60; i++) { now += 60_000; t.update(now, 3); } // an hour of work
    expect(Math.round(t.minutes)).toBe(59);
    now += 60_000; t.update(now, 301); // five minutes idle
    expect(t.minutes).toBe(0);
    now += 60_000; t.update(now, 2);
    expect(t.minutes).toBeGreaterThan(0.9);
  });

  it('does not count time while you are idle for a short while, nor a long gap (sleep mode)', () => {
    const t = new ActivityTracker();
    t.update(0, 0);
    t.update(60_000, 200); // idle 3+ minutes but under a full break: not counted
    expect(t.minutes).toBe(0);
    t.update(60_000 + 9 * 60 * 60_000, 1); // the laptop slept for 9 hours
    expect(t.minutes).toBeLessThanOrEqual(2);
  });
});

describe('calendar pop-ups only', () => {
  it('speaks up from the largest reminder lead time of up to an hour', () => {
    expect(calendarWindowMinutes([15, 5])).toBe(15);
    expect(calendarWindowMinutes([30, 1440])).toBe(30); // a day-before reminder does not count
    expect(calendarWindowMinutes([])).toBe(15);
    expect(calendarWindowMinutes([0, 1440])).toBe(15);
  });
});
