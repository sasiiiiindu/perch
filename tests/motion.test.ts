import { describe, expect, it } from 'vitest';
import {
  BLINK_S, FIDGET_S, HOP_S, NEVER, NOTE_DELAY_S, NOTE_S, SQUASH_S, Scheduler, Smooth2,
  blink, bump, freshTriggers, hop, lerp, noteFloat, offsets, squash, twitchDegrees,
} from '../src/scene/motion';
import { BLINK_SPREAD, PERSONALITY } from '../src/scene/personality';

/** Small seeded PRNG (mulberry32) so the random rhythms are repeatable. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Times (s) at which a scheduler fires over `seconds`, stepping at `fps`. */
function firings(s: Scheduler, seconds: number, fps = 60, start = 0): number[] {
  const out: number[] = [];
  for (let t = start; t < start + seconds; t += 1 / fps) if (s.due(t)) out.push(t);
  return out;
}

describe('Smooth2 spring', () => {
  const tau = PERSONALITY.sage.springTau;

  it.each([30, 60, 120])('never overshoots and lands within 5τ at %i fps', (fps) => {
    const spring = new Smooth2(0, lerp, tau);
    let prev = 0;
    let landedAt: number | null = null;
    for (let t = 1 / fps; t < 1; t += 1 / fps) {
      const v = spring.step(1, 1 / fps);
      expect(v).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(prev); // monotonic: no wobble on the way in
      prev = v;
      if (landedAt === null && v >= 0.95) landedAt = t;
    }
    expect(landedAt).not.toBeNull();
    expect(landedAt!).toBeLessThanOrEqual(5 * tau + 1 / fps);
  });

  it('starts gently: the first frame moves far less than a plain ease would', () => {
    const spring = new Smooth2(0, lerp, tau);
    const plainEase = 1 - Math.exp(-(1 / 60) / tau);
    expect(spring.step(1, 1 / 60)).toBeLessThan(plainEase / 2);
  });

  it('Bruno settles slower than Pip', () => {
    expect(PERSONALITY.bruno.springTau).toBeGreaterThan(PERSONALITY.pip.springTau);
  });
});

describe('envelopes', () => {
  const cases: [string, (t: number) => number, number][] = [
    ['hop', hop, HOP_S],
    ['squash', squash, SQUASH_S],
    ['blink', blink, BLINK_S],
    ['bump', (t) => bump(t, FIDGET_S), FIDGET_S],
  ];

  it.each(cases)('%s is exactly 0 before, at the start, and from the end on', (_, f, d) => {
    for (const t of [-1, -0.001, 0, d, d + 0.001, d + 5]) expect(f(t)).toBe(0);
  });

  it.each(cases)('%s never jumps more than half its range in one 60 fps frame', (_, f, d) => {
    let prev = 0;
    for (let t = 0; t <= d + 0.05; t += 1 / 60) {
      expect(Math.abs(f(t) - prev)).toBeLessThanOrEqual(0.5);
      prev = f(t);
    }
  });

  // The hop lands like a thrown ball and the blink snaps open, both on purpose;
  // the squash and the fidget/crest bump must fade out to nothing.
  it.each(cases.filter(([name]) => name === 'squash' || name === 'bump'))('%s fades out smoothly', (_, f, d) => {
    expect(Math.abs(f(d - 1 / 60))).toBeLessThan(0.05);
  });

  it('hop peaks at 1 halfway', () => {
    expect(hop(HOP_S / 2)).toBeCloseTo(1, 10);
  });

  it('squash squashes first, then stretches once', () => {
    expect(squash(0.04)).toBeGreaterThan(0.5);
    expect(squash(0.12)).toBeLessThan(0);
  });

  it('blink closes fully', () => {
    expect(blink(BLINK_S * 0.4)).toBeCloseTo(1, 10);
  });

  it('the note waits for the squash, rises, and fades away', () => {
    expect(noteFloat(0)).toBeNull();
    expect(noteFloat(NOTE_DELAY_S + NOTE_S + 1e-9)).toBeNull();
    const early = noteFloat(NOTE_DELAY_S + 0.2)!;
    const late = noteFloat(NOTE_DELAY_S + NOTE_S - 0.05)!;
    expect(late.rise).toBeGreaterThan(early.rise);
    expect(early.alpha).toBeGreaterThan(0.9);
    expect(late.alpha).toBeLessThan(0.1);
  });
});

describe('Scheduler', () => {
  it('Bruno blinks slowest, Pip fastest, each near its mean', () => {
    const means = Object.entries(PERSONALITY).map(([id, p]) => {
      const times = firings(new Scheduler(p.blinkEvery, BLINK_SPREAD, seeded(id.length * 97)), 600);
      const gaps = times.slice(1).map((t, i) => t - times[i]);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      expect(mean).toBeGreaterThan(p.blinkEvery * 0.9);
      expect(mean).toBeLessThan(p.blinkEvery * 1.1);
      return { id, mean };
    });
    const sorted = [...means].sort((a, b) => b.mean - a.mean).map((m) => m.id);
    expect(sorted[0]).toBe('bruno');
    expect(sorted[sorted.length - 1]).toBe('pip');
  });

  it('keeps gaps within the spread', () => {
    const times = firings(new Scheduler(4, BLINK_SPREAD, seeded(1)), 300);
    times.slice(1).forEach((t, i) => {
      expect(t - times[i]).toBeGreaterThanOrEqual(4 * (1 - BLINK_SPREAD) - 1e-9);
      expect(t - times[i]).toBeLessThanOrEqual(4 * (1 + BLINK_SPREAD) + 1 / 60 + 1e-9);
    });
  });

  it('starts birds out of step', () => {
    const firsts = [1, 2, 3, 4, 5, 6].map((seed) => firings(new Scheduler(4, BLINK_SPREAD, seeded(seed)), 10)[0]);
    expect(new Set(firsts.map((t) => t.toFixed(2))).size).toBe(6);
  });

  it('does not fire on a clock jump (a background tab coming back)', () => {
    const s = new Scheduler(1, 0.4, seeded(3));
    s.due(0);
    expect(s.due(60)).toBe(false);
    expect(firings(s, 3, 60, 60).length).toBeGreaterThan(0); // and carries on afterwards
  });
});

describe('offsets', () => {
  const pip = PERSONALITY.pip;
  const busy = { ...freshTriggers(), woke: 0, arrived: 0, blink: 0, fidget: 0, twitch: 0, twitchDeg: 6 };

  it('adds nothing when nothing has been triggered', () => {
    const o = offsets(freshTriggers(), 10, pip, false);
    expect(o).toEqual({ lift: 0, squash: 0, tilt: 0, dx: 0, crestDeg: 0, blink: 0, note: { rise: 0, alpha: 0 } });
  });

  it('reduced motion drops the hop, squash, fidget and crest flick, keeps blinks, and leaves the note still', () => {
    for (let t = 0; t < 2; t += 1 / 60) {
      const o = offsets(busy, t, pip, true);
      expect([o.lift, o.squash, o.tilt, o.dx, o.crestDeg]).toEqual([0, 0, 0, 0, 0]);
      expect(o.note).toBeNull();
    }
    expect(offsets(busy, BLINK_S * 0.4, pip, true).blink).toBeCloseTo(1, 10);
  });

  it('without reduced motion, the same triggers do move the bird', () => {
    const o = offsets(busy, 0.05, pip, false);
    expect(o.lift).toBeGreaterThan(0);
    expect(o.tilt).not.toBe(0);
    expect(o.crestDeg).not.toBe(0);
  });

  it('Bruno hops and squashes less than Pip', () => {
    const at = (p: typeof pip) => offsets(busy, HOP_S / 2, p, false).lift;
    expect(at(PERSONALITY.bruno)).toBeLessThan(at(pip));
    expect(PERSONALITY.bruno.squash).toBeLessThan(pip.squash);
  });

  it('everything returns to rest', () => {
    const o = offsets(busy, 5, pip, false);
    expect([o.lift, o.squash, o.tilt, o.dx, o.crestDeg, o.blink]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(o.note).toEqual({ rise: 0, alpha: 0 });
    expect(NEVER).toBe(-Infinity);
  });
});

describe('personality', () => {
  it('only Pip fidgets and only Skye flicks a crest', () => {
    const fidgeters = Object.entries(PERSONALITY).filter(([, p]) => p.fidgetEvery !== null).map(([id]) => id);
    const twitchers = Object.entries(PERSONALITY).filter(([, p]) => p.crestTwitch).map(([id]) => id);
    expect(fidgeters).toEqual(['pip']);
    expect(twitchers).toEqual(['skye']);
  });

  it('crest flicks grow with sharpness, 3° to 8°', () => {
    expect(twitchDegrees(4)).toBeGreaterThan(3);
    expect(twitchDegrees(15)).toBeLessThan(twitchDegrees(30));
    expect(twitchDegrees(50)).toBe(8);
  });
});
