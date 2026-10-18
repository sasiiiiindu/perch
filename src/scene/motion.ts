/**
 * Motion building blocks: a smoothing spring, one-shot envelopes (hop,
 * squash, blink, fidget, crest flick, floating note) and a random scheduler.
 *
 * All plain functions of time with the randomness passed in, so they can be
 * tested without a canvas. (No birds.ts import: it needs Path2D on load.)
 */

import type { Personality } from './personality';

export type Rng = () => number;

/** Fraction of the remaining distance an exponential ease covers in `dt` seconds. */
export function easeFactor(dt: number, tau: number): number {
  return 1 - Math.exp(-Math.max(0, dt) / tau);
}

/**
 * Two exponential eases in series: a critically damped spring. Unlike a
 * single ease it starts moving gently (no velocity snap when the target
 * jumps), and unlike a bouncy spring it never overshoots, so a flat bird
 * never flickers sharp on its way in. Step response 1 − e^(−t/τ)(1 + t/τ):
 * 95% of the way in about 4.7τ.
 */
export class Smooth2<T> {
  private mid: T;
  value: T;

  constructor(initial: T, private readonly mix: (a: T, b: T, t: number) => T, public tau: number) {
    this.mid = initial;
    this.value = initial;
  }

  step(target: T, dt: number): T {
    const k = easeFactor(dt, this.tau);
    this.mid = this.mix(this.mid, target, k);
    this.value = this.mix(this.value, this.mid, k);
    return this.value;
  }

  /** Land on `target` at once. Both stages, or the next step would slide back. */
  jump(target: T): T {
    this.mid = target;
    this.value = target;
    return target;
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// ---- One-shot envelopes: t = seconds since the trigger. All are exactly 0 before and after. ----

export const HOP_S = 0.22;
export const SQUASH_S = 0.35;
export const BLINK_S = 0.14;
export const FIDGET_S = 0.35;
export const TWITCH_S = 0.12;
/** The note waits for the squash to land, then floats for NOTE_S. */
export const NOTE_DELAY_S = 0.12;
export const NOTE_S = 1.2;

/** 0 → 1 → 0, a parabola like a thrown ball. */
export function hop(t: number): number {
  if (!(t > 0 && t < HOP_S)) return 0;
  const p = t / HOP_S;
  return 4 * p * (1 - p);
}

/**
 * Positive = squashed, negative = stretched. Starts at 0 (no snap), squashes,
 * rebounds once and dies away; the (1 − p) window makes it land on exactly 0.
 */
export function squash(t: number): number {
  if (!(t > 0 && t < SQUASH_S)) return 0;
  return Math.sin((Math.PI * t) / 0.08) * Math.exp(-t / 0.1) * (1 - t / SQUASH_S);
}

/** Eyelid closure 0–1: closes fast, opens a little slower. */
export function blink(t: number): number {
  if (!(t > 0 && t < BLINK_S)) return 0;
  const p = t / BLINK_S;
  return p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
}

/** A smooth 0 → 1 → 0 bump over `duration`, for fidgets and crest flicks. sin² so it eases in and out. */
export function bump(t: number, duration: number): number {
  if (!(t > 0 && t < duration)) return 0;
  return Math.sin((Math.PI * t) / duration) ** 2;
}

/** The floating note: rises with an ease-out, fades in quickly and out slowly. Null when not showing. */
export function noteFloat(t: number): { rise: number; alpha: number } | null {
  const s = t - NOTE_DELAY_S;
  if (!(s >= 0 && s < NOTE_S)) return null;
  const p = s / NOTE_S;
  return {
    rise: 14 * (1 - (1 - p) ** 2),
    alpha: p < 0.12 ? p / 0.12 : 1 - ((p - 0.12) / 0.88) ** 2,
  };
}

// ---- Scheduling ----

/**
 * Fires at random intervals around `mean` seconds (± spread). The first one
 * comes at a random point in the first interval, so birds start out of step.
 * If the clock jumps (a background tab coming back), it reschedules without
 * firing, so the whole flock doesn't blink at once.
 */
export class Scheduler {
  private next: number | null = null;

  constructor(
    private readonly mean: number,
    private readonly spread: number,
    private readonly rng: Rng,
  ) {}

  private interval(): number {
    return this.mean * (1 + this.spread * (2 * this.rng() - 1));
  }

  due(now: number): boolean {
    if (this.next === null) {
      this.next = now + this.rng() * this.interval();
      return false;
    }
    if (now < this.next) return false;
    const late = now - this.next > 0.5;
    this.next = now + this.interval();
    return !late;
  }
}

// ---- Putting it together for one bird ----

/** When each one-shot last started (seconds on the scene clock). */
export interface Triggers {
  woke: number;
  arrived: number;
  blink: number;
  fidget: number;
  fidgetDir: number; // ±1
  twitch: number;
  twitchDeg: number; // signed
}

export const NEVER = -Infinity;

export function freshTriggers(): Triggers {
  return { woke: NEVER, arrived: NEVER, blink: NEVER, fidget: NEVER, fidgetDir: 1, twitch: NEVER, twitchDeg: 0 };
}

/** What the envelopes add on top of the sprung pose, in design units and degrees. */
export interface Offsets {
  lift: number; // up, design units
  squash: number; // signed; scales sx up and sy down
  tilt: number; // degrees
  dx: number; // design units
  crestDeg: number;
  blink: number; // 0–1
  /** Floating note; null = draw the plain note that follows the pose (reduced motion). */
  note: { rise: number; alpha: number } | null;
}

const HOP_UNITS = 6;
const FIDGET_TILT = 4;
const FIDGET_DX = 2;

/**
 * The effects at time `now`. With reduced motion only the blink survives;
 * the hop, squash, fidget and crest flick are dropped and the note sits still.
 */
export function offsets(tr: Triggers, now: number, p: Personality, reduced: boolean): Offsets {
  const blinkNow = blink(now - tr.blink);
  if (reduced) return { lift: 0, squash: 0, tilt: 0, dx: 0, crestDeg: 0, blink: blinkNow, note: null };
  const fidget = bump(now - tr.fidget, FIDGET_S) * tr.fidgetDir;
  return {
    lift: HOP_UNITS * p.hop * hop(now - tr.woke),
    squash: p.squash * squash(now - tr.arrived),
    tilt: FIDGET_TILT * fidget,
    dx: FIDGET_DX * fidget,
    crestDeg: tr.twitchDeg * bump(now - tr.twitch, TWITCH_S),
    blink: blinkNow,
    note: noteFloat(now - tr.arrived) ?? { rise: 0, alpha: 0 },
  };
}

/** Crest flick size for a given sharpness in cents: 3° just past in tune, 8° at +30 ¢ and beyond. */
export function twitchDegrees(cents: number): number {
  return 3 + 5 * clamp01(cents / 30);
}
