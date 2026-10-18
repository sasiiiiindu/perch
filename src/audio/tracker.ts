/**
 * Tracker: turns the detector's frame-by-frame readings into one steady
 * answer for the screen: which string, how many cents off, and a state.
 *
 *   frame → noise gate → clarity → string lock → smoother → decay hold → output
 *
 * Pure: every update gets its timestamp from the caller (the audio clock in
 * the app, synthetic times in tests), so behaviour never depends on when
 * frames happen to be delivered.
 */

import { NoiseGate, type NoiseGateOptions } from './noise-gate';
import { CentsSmoother, type SmootherOptions } from './smoother';
import { DEFAULT_A4, centsBetween, midiToFrequency, nearestString, type GuitarString } from './notes';
import { MIN_CLARITY, type FrameAnalysis, type Reading } from './reading';

export type TunerState = 'idle' | 'listening' | 'flat' | 'sharp' | 'inTune';

export interface TrackerOutput {
  state: TunerState;
  /** The locked string; null when idle or listening. */
  string: GuitarString | null;
  /** Smoothed offset from that string. Positive = sharp. */
  cents: number | null;
  /** Smoothed frequency in Hz. */
  frequency: number | null;
}

export interface TrackerOptions {
  a4: number;
  /** In tune = |cents| ≤ this (CLAUDE.md). */
  inTuneCents: number;
  /** Readings at or above this clarity mean "a note is sounding". */
  presentClarity: number;
  /** At or below this clarity a reading no longer moves the value… */
  freezeClarity: number;
  /** …and at or above this it moves it at full speed. Linear in between. */
  fullClarity: number;
  /** Likewise for level above the noise floor (dB): at or below this, no movement… */
  freezeSnrDb: number;
  /** …at or above this, full speed. */
  fullSnrDb: number;
  /** Agreeing readings needed to lock when no string is ringing. */
  firstLockReadings: number;
  /** A different string must win continuously this long to take over a ringing one. */
  switchMs: number;
  /** After this long without the locked string, a new string locks the quick way. */
  relockAfterMs: number;
  /** After the note stops, keep showing the last good reading this long. */
  holdMs: number;
  /** A level jump this big (dB, frame to frame) is a new pluck: smoothing restarts. */
  onsetJumpDb: number;
  /** Near the ±inTuneCents edge, a state change must persist this long. */
  edgeSettleMs: number;
  /** "Near the edge" = within this many cents of ±inTuneCents. */
  edgeBandCents: number;
  gate: Partial<NoiseGateOptions>;
  smoother: Partial<SmootherOptions>;
}

/**
 * Values chosen from synthetic plucks run through the real detector
 * (tests/tracker.test.ts, "synthetic plucks through the real detector"):
 * a cleanly ringing string gives clarity ≥ 0.98 and ±1–3 ¢ jitter; by
 * clarity 0.94 single frames are off by ±9 ¢, and below 0.9 by ±20 ¢.
 * So clarity weights the smoothing rather than acting as a single cut.
 *
 * Clarity stays at 0.98–0.99 down to about 20 dB above the room noise, yet
 * there runs of frames can already be 2 ¢ off. Level above the calibrated
 * noise floor (SNR) catches that, so it weights the smoothing too: the
 * quieter the note, the longer the effective averaging. It phases in as the
 * note settles, so the first half-second after a pluck stays fast even on a
 * quiet string.
 */
export const DEFAULT_TRACKER: Readonly<TrackerOptions> = {
  a4: DEFAULT_A4,
  inTuneCents: 3,
  presentClarity: MIN_CLARITY,
  freezeClarity: 0.93,
  fullClarity: 0.98,
  freezeSnrDb: 12,
  fullSnrDb: 30,
  firstLockReadings: 2,
  switchMs: 150,
  relockAfterMs: 200,
  holdMs: 1000,
  onsetJumpDb: 6,
  edgeSettleMs: 120,
  edgeBandCents: 1,
  gate: {},
  smoother: {},
};

/** Extra numbers for the debug screen; not part of the tracker's answer. */
export interface TrackerInspection {
  calibrating: boolean;
  noiseFloorDb: number | null;
  gateThresholdDb: number | null;
  gateOpen: boolean;
  /** How long the locked string has gone without a reading; null if none is locked. */
  sinceLastReadingMs: number | null;
  /** A string waiting to take over, if any. */
  candidate: GuitarString | null;
  /** Smoothing weight of the latest reading, 0–1 (the lower of clarity and SNR weights). */
  weight: number;
}

/**
 * Frames with clarity at or above this have some pitch in them, so they're
 * kept out of the room-noise estimate. Measured room noise sits at 0.05–0.1.
 */
const NOISE_MAX_CLARITY = 0.5;

const IDLE: TrackerOutput = { state: 'idle', string: null, cents: null, frequency: null };
const LISTENING: TrackerOutput = { state: 'listening', string: null, cents: null, frequency: null };

export class Tracker {
  private readonly opts: TrackerOptions;
  private readonly gate: NoiseGate;
  private readonly smoother: CentsSmoother;

  private lastTimeMs: number | null = null;
  private prevLevelDb = -Infinity;
  private wasOpen = false;
  /** A new pluck was heard; restart smoothing at the next trusted reading. */
  private restartPending = false;
  private lastWeight = 0;

  private locked: GuitarString | null = null;
  private lockedTarget = 0;
  /** Time of the latest present reading of the locked string. */
  private lastPresentMs: number | null = null;
  private candidate: { string: GuitarString; sinceMs: number; count: number } | null = null;

  private shownState: TunerState = 'idle';
  private pendingState: { state: TunerState; sinceMs: number } | null = null;
  /** Next state is shown immediately (new pluck or string): no edge settling. */
  private freshNote = true;

  constructor(options: Partial<TrackerOptions> = {}) {
    this.opts = { ...DEFAULT_TRACKER, ...options };
    this.gate = new NoiseGate(this.opts.gate);
    this.smoother = new CentsSmoother(this.opts.smoother);
  }

  update(analysis: FrameAnalysis, timeMs: number): TrackerOutput {
    const dt = this.lastTimeMs === null ? 0 : timeMs - this.lastTimeMs;
    // A gap longer than the hold (tab in the background, audio suspended):
    // whatever was ringing is long gone.
    if (dt < 0 || dt > this.opts.holdMs) this.endNote();
    this.lastTimeMs = timeMs;

    const reading = analysis.reading;
    const hasPitch = reading !== null && reading.clarity >= NOISE_MAX_CLARITY;
    const gateOpen = this.gate.update(analysis.levelDb, hasPitch, timeMs);
    const onset = gateOpen && (!this.wasOpen || analysis.levelDb - this.prevLevelDb >= this.opts.onsetJumpDb);
    this.wasOpen = gateOpen;
    this.prevLevelDb = analysis.levelDb;
    if (this.gate.calibrating) return IDLE;
    if (onset) this.restartPending = true;

    if (gateOpen && reading && reading.clarity >= this.opts.presentClarity) {
      this.handleReading(reading, this.weightOf(reading, analysis.levelDb), timeMs, dt);
    } else {
      this.candidate = null;
    }

    if (this.locked && this.lastPresentMs !== null && timeMs - this.lastPresentMs > this.opts.holdMs) {
      this.endNote();
    }
    return this.output(gateOpen, timeMs);
  }

  /**
   * Change the reference pitch. Whatever was ringing is dropped (its cents
   * were measured against the old reference); the noise calibration is kept.
   */
  setA4(a4: number): void {
    this.opts.a4 = a4;
    this.endNote();
  }

  inspect(): TrackerInspection {
    return {
      calibrating: this.gate.calibrating,
      noiseFloorDb: this.gate.noiseFloorDb,
      gateThresholdDb: this.gate.thresholdDb,
      gateOpen: this.gate.isOpen,
      sinceLastReadingMs:
        this.locked && this.lastPresentMs !== null && this.lastTimeMs !== null
          ? this.lastTimeMs - this.lastPresentMs
          : null,
      candidate: this.candidate?.string ?? null,
      weight: this.lastWeight,
    };
  }

  /** How much to trust a reading, 0–1: the lower of its clarity and SNR weights. */
  private weightOf(reading: Reading, levelDb: number): number {
    const ramp = (x: number, lo: number, hi: number) => Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
    const o = this.opts;
    const clarityWeight = ramp(reading.clarity, o.freezeClarity, o.fullClarity);
    const snr = levelDb - (this.gate.noiseFloorDb ?? levelDb);
    const snrWeight = 1 - this.smoother.settling * (1 - ramp(snr, o.freezeSnrDb, o.fullSnrDb));
    return Math.min(clarityWeight, snrWeight);
  }

  private handleReading(reading: Reading, weight: number, timeMs: number, dt: number): void {
    const string = nearestString(reading.frequency, this.opts.a4).string;
    if (this.locked && string.index === this.locked.index) {
      this.candidate = null;
      this.feed(reading, weight, timeMs, dt);
      return;
    }

    if (!this.candidate || this.candidate.string.index !== string.index) {
      this.candidate = { string, sinceMs: timeMs, count: 0 };
    }
    this.candidate.count++;

    // Nothing ringing (or it went quiet a while ago): lock quickly, needing
    // only a couple of agreeing readings. A ringing string is protected:
    // the newcomer has to win for switchMs, so octave slips and stray
    // frames in the decay can't steal it.
    const quiet =
      this.locked === null ||
      this.lastPresentMs === null ||
      timeMs - this.lastPresentMs >= this.opts.relockAfterMs;
    const ready = quiet
      ? this.candidate.count >= this.opts.firstLockReadings
      : timeMs - this.candidate.sinceMs >= this.opts.switchMs;
    if (!ready) return;

    this.locked = string;
    this.lockedTarget = midiToFrequency(string.midi, this.opts.a4);
    this.candidate = null;
    this.smoother.reset();
    this.restartPending = false;
    this.freshNote = true;
    this.feed(reading, weight, timeMs, 0);
  }

  private feed(reading: Reading, weight: number, timeMs: number, dt: number): void {
    this.lastPresentMs = timeMs;
    this.lastWeight = weight;
    if (weight <= 0) return;
    if (this.restartPending) {
      // New pluck on the same string: drop the old note's history so the
      // display jumps to the new pitch instead of easing over from the old one.
      this.smoother.reset();
      this.restartPending = false;
      this.freshNote = true;
    }
    this.smoother.push(centsBetween(reading.frequency, this.lockedTarget), weight, dt);
  }

  private output(gateOpen: boolean, timeMs: number): TrackerOutput {
    const cents = this.smoother.value;
    if (!this.locked || cents === null) {
      this.shownState = 'idle';
      return gateOpen ? LISTENING : IDLE;
    }
    return {
      state: this.settle(this.classify(cents), cents, timeMs),
      string: this.locked,
      cents,
      frequency: this.lockedTarget * 2 ** (cents / 1200),
    };
  }

  private classify(cents: number): TunerState {
    if (Math.abs(cents) <= this.opts.inTuneCents) return 'inTune';
    return cents < 0 ? 'flat' : 'sharp';
  }

  /**
   * In tune is strictly |cents| ≤ 3, but a reading resting right on 3.0 would
   * make the bird flicker between "in tune" and "sharp" every frame. So only
   * near the edge, a change in or out of inTune must persist for edgeSettleMs
   * (120 ms) before it's shown. Clearly-off values are never shown as in tune,
   * and a fresh pluck shows its state immediately.
   */
  private settle(state: TunerState, cents: number, timeMs: number): TunerState {
    const nearEdge = Math.abs(Math.abs(cents) - this.opts.inTuneCents) <= this.opts.edgeBandCents;
    const crossesEdge = state === 'inTune' || this.shownState === 'inTune';
    if (this.freshNote || state === this.shownState || !crossesEdge || !nearEdge || this.shownState === 'idle') {
      this.freshNote = false;
      this.shownState = state;
      this.pendingState = null;
      return state;
    }
    if (this.pendingState?.state !== state) this.pendingState = { state, sinceMs: timeMs };
    if (timeMs - this.pendingState.sinceMs >= this.opts.edgeSettleMs) {
      this.shownState = state;
      this.pendingState = null;
    }
    return this.shownState;
  }

  private endNote(): void {
    this.locked = null;
    this.lastPresentMs = null;
    this.candidate = null;
    this.smoother.reset();
    this.restartPending = false;
    this.freshNote = true;
    this.shownState = 'idle';
    this.pendingState = null;
  }
}
