import { describe, expect, it } from 'vitest';
import {
  InteractionController, MEMORY_MS, PET_AFTER_MS, REACTION_LINES, REACTION_MS, STARE_AFTER_MS, type Reaction,
} from '../src/interaction';

const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

/** Advances the controller's clock in 100 ms steps, as the app does. */
function advance(c: InteractionController, from: number, ms: number) {
  let t = from;
  while (t < from + ms) { t += 100; c.tick(t); }
  return t;
}

/** One quick pass: the mouse comes onto her and leaves a moment later. */
function pass(c: InteractionController, t: number, stay = 150) {
  c.enter(t);
  c.leave(t + stay);
  return t + stay;
}

describe('first contact', () => {
  it('makes her giggle, and the reaction ends by itself', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const c = new InteractionController(rng(seed));
      c.enter(1000);
      expect(c.reaction).toBe('giggle');
      expect(REACTION_LINES.giggle).toContain(c.line);
      c.leave(1200);
      advance(c, 1200, REACTION_MS.giggle + 300);
      expect(c.reaction).toBe('none');
    }
  });

  it('is never embarrassment, whatever the random numbers say', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const c = new InteractionController(rng(seed));
      c.enter(0);
      expect(c.reaction).not.toBe('shy');
    }
    for (const r of [0, 0.3, 0.5, 0.7, 0.99999]) {
      const c = new InteractionController(() => r);
      c.enter(0);
      expect(c.reaction).toBe('giggle');
    }
  });

  it('is still a giggle when the first pass came during the cooldown and was ignored', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const c = new InteractionController(rng(seed));
      c.enter(0); c.leave(100);
      advance(c, 100, REACTION_MS.giggle + 50); // finishes, cooldown just started
      c.reset();
      // a brand new visit long afterwards
      const t = MEMORY_MS * 3;
      c.enter(t);
      expect(c.reaction).toBe('giggle');
    }
  });

  it('never makes her shy as the first thing when the mouse simply rests on her', () => {
    const c = new InteractionController(rng(4));
    c.enter(0);
    c.reset(); // pretend her welcome reaction did not happen
    c.move(100, 50, 50); c.move(200, 50, 50);
    // a fresh visit that has not had a reaction yet is greeted with a giggle, not shyness
    const fresh = new InteractionController(rng(4));
    fresh.enter(0);
    expect(fresh.reaction).toBe('giggle');
  });

  it('allows embarrassment on later passes, once she has reacted to you', () => {
    let shy = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const c = new InteractionController(rng(seed));
      c.enter(0); c.leave(100);
      const t = advance(c, 100, 2400) + 100;
      c.enter(t);
      if (c.reaction === 'shy') shy++;
    }
    expect(shy).toBeGreaterThan(40);
  });

  it('never bites on the first pass', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const c = new InteractionController(rng(seed));
      c.enter(0);
      expect(c.reaction).not.toBe('bite');
    }
  });

  it('numbers each reaction so the animation can restart', () => {
    const c = new InteractionController(rng(3));
    const k0 = c.key;
    c.enter(0);
    expect(c.key).toBe(k0 + 1);
  });
});

describe('escalation', () => {
  it('tries to bite after several quick passes, usually, and never on the first three', () => {
    let biteEarly = 0, biteLater = 0, later = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const c = new InteractionController(rng(seed));
      let t = 0;
      for (let i = 1; i <= 6; i++) {
        c.enter(t);
        if (i <= 3 && c.reaction === 'bite') biteEarly++;
        if (i >= 4) { later++; if (c.reaction === 'bite') biteLater++; }
        c.leave(t + 100);
        t = advance(c, t + 100, 2400) + 100;
      }
    }
    expect(biteEarly).toBe(0);
    expect(biteLater / later).toBeGreaterThan(0.25);
  });

  it('forgets after a while: a pass much later is a fresh first contact', () => {
    const c = new InteractionController(rng(8));
    let t = 0;
    for (let i = 0; i < 4; i++) { c.enter(t); c.leave(t + 100); t = advance(c, t + 100, 2500) + 100; }
    t += MEMORY_MS + 1000;
    c.enter(t);
    expect(c.reaction).toBe('giggle');
  });

  it('varies: no reaction repeats back to back unless nothing else is possible', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const c = new InteractionController(rng(seed));
      let t = 0;
      let prev: Reaction | undefined;
      for (let i = 0; i < 12; i++) {
        c.enter(t);
        const r = c.reaction;
        if (r !== 'none') { expect(r).not.toBe(prev); prev = r; }
        c.leave(t + 80);
        t = advance(c, t + 80, 2600) + 700; // long enough for the reaction to finish and the cooldown to pass
        // ...but within memory so it keeps escalating
        t = Math.min(t, i * 3000 + 3000);
      }
    }
  });

  it('ignores passes that happen while she is already reacting, but remembers them', () => {
    const c = new InteractionController(rng(2));
    c.enter(0);
    const first = c.key;
    c.leave(100); c.enter(200); c.leave(300); c.enter(400);
    expect(c.key).toBe(first); // still the same reaction, not a new one every pass
  });

  it('gives her a moment before she can react again', () => {
    const c = new InteractionController(rng(5));
    c.enter(0);
    c.leave(50);
    const t = advance(c, 50, REACTION_MS.giggle + 200);
    const k = c.key;
    c.enter(t + 100); // inside the cooldown
    if (c.reaction === 'none') expect(c.key).toBe(k);
  });
});

describe('petting', () => {
  /** Moves the pointer slowly back and forth for `ms`. */
  function pet(c: InteractionController, from: number, ms: number, speedPxPerSec = 60) {
    let t = from, x = 100;
    while (t < from + ms) {
      t += 50;
      x += (speedPxPerSec * 0.05) * (Math.floor((t - from) / 800) % 2 ? -1 : 1);
      c.move(t, x, 80);
      c.tick(t);
    }
    return t;
  }

  it('purrs after about a second of gentle movement, and keeps purring while it lasts', () => {
    const c = new InteractionController(rng(4));
    c.enter(0);
    advance(c, 0, REACTION_MS.shy + REACTION_MS.giggle); // let the hello reaction finish
    let t = 4200;
    c.reset();
    c.enter(t); // (ignored or not, we only care about what follows)
    c.reset();
    t = pet(c, t + 600, PET_AFTER_MS + 400);
    expect(c.reaction).toBe('purr');
    t = pet(c, t, 4000);
    expect(c.reaction).toBe('purr');
  });

  it('stops soon after the pointer leaves', () => {
    const c = new InteractionController(rng(4));
    c.enter(0);
    c.reset();
    let t = pet(c, 0, PET_AFTER_MS + 600);
    expect(c.reaction).toBe('purr');
    c.leave(t);
    advance(c, t, 400);
    expect(c.reaction).toBe('purr'); // lingers a little
    advance(c, t + 400, 800);
    expect(c.reaction).toBe('none');
  });

  it('is not triggered by fast swipes or by barely-there movement', () => {
    const swipe = new InteractionController(rng(4));
    swipe.enter(0); swipe.reset();
    pet(swipe, 0, 3000, 900);
    expect(swipe.reaction).not.toBe('purr');
    const frozen = new InteractionController(rng(4));
    frozen.enter(0); frozen.reset();
    pet(frozen, 0, 3000, 1);
    expect(frozen.reaction).not.toBe('purr');
  });

  it('ends a very long petting session at some point (she may blush), even if you keep going', () => {
    const c = new InteractionController(rng(6));
    c.enter(0); c.reset();
    let t = pet(c, 0, PET_AFTER_MS + 300);
    expect(c.reaction).toBe('purr');
    const seen = new Set<Reaction>();
    for (let i = 0; i < 17_000 / 50; i++) { t = pet(c, t, 50); seen.add(c.reaction); }
    expect([...seen].some((r) => r !== 'purr')).toBe(true);
  });
});

describe('being stared at', () => {
  it('gets shy once when the mouse just sits on her', () => {
    const c = new InteractionController(rng(9));
    c.enter(0);
    c.reset();
    c.move(100, 50, 50);
    c.move(200, 50, 50); // a stationary pointer reports the same position
    const t = advance(c, 200, STARE_AFTER_MS + 300);
    expect(c.reaction).toBe('shy');
    const k = c.key;
    advance(c, t, 8000);
    expect(c.key).toBe(k); // only once per visit
  });
});

describe('bite sequence', () => {
  it('is sometimes followed by embarrassment while the mouse is still there', () => {
    let embarrassed = 0, total = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const c = new InteractionController(rng(seed));
      let t = 0;
      for (let i = 0; i < 6 && c.reaction !== 'bite'; i++) {
        c.leave(t); t = advance(c, t, 2600) + 100;
        c.enter(t);
      }
      if (c.reaction !== 'bite') continue;
      total++;
      advance(c, t, REACTION_MS.bite + 200); // mouse stays over her
      if (c.reaction === 'shy') embarrassed++;
    }
    expect(total).toBeGreaterThan(50);
    expect(embarrassed / total).toBeGreaterThan(0.2);
    expect(embarrassed / total).toBeLessThan(0.65);
  });
});

describe('reset', () => {
  it('stops everything, for example when she falls asleep', () => {
    const c = new InteractionController(rng(1));
    c.enter(0);
    expect(c.reset()).toBe(true);
    expect(c.reaction).toBe('none');
    expect(c.reset()).toBe(false);
  });
});
