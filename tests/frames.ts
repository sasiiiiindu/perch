/**
 * Fake detector output for tracker tests: build FrameAnalysis objects
 * directly, without generating audio, and feed them at the real frame rate.
 */

import type { FrameAnalysis } from '../src/audio/reading';
import { MIN_CLARITY } from '../src/audio/reading';
import { frequencyToNote, midiToFrequency, nearestString } from '../src/audio/notes';
import type { Tracker, TrackerOutput } from '../src/audio/tracker';

/** 25 readings a second, as in the app. */
export const FRAME_MS = 40;
export const QUIET_DB = -60;
export const PLAYING_DB = -25;

export const E2 = 40;
export const A2 = 45;
export const D3 = 50;

/** Frequency of MIDI note `midi` moved by `cents`. */
export function hz(midi: number, cents = 0): number {
  return midiToFrequency(midi) * 2 ** (cents / 1200);
}

export function note(frequency: number, clarity = 0.99, levelDb = PLAYING_DB): FrameAnalysis {
  return {
    rms: 10 ** (levelDb / 20),
    levelDb,
    reading: {
      frequency,
      clarity,
      accepted: clarity >= MIN_CLARITY,
      note: frequencyToNote(frequency),
      string: nearestString(frequency),
    },
  };
}

export function silence(levelDb = QUIET_DB): FrameAnalysis {
  return { rms: 10 ** (levelDb / 20), levelDb, reading: null };
}

export interface Step {
  t: number;
  out: TrackerOutput;
}

/** Feeds frames one FRAME_MS apart and records every output. */
export class Feed {
  t = 0;
  readonly steps: Step[] = [];

  constructor(readonly tracker: Tracker) {}

  push(frame: FrameAnalysis | ((i: number) => FrameAnalysis), count = 1): Step[] {
    const added: Step[] = [];
    for (let i = 0; i < count; i++) {
      const out = this.tracker.update(typeof frame === 'function' ? frame(i) : frame, this.t);
      added.push({ t: this.t, out });
      this.t += FRAME_MS;
    }
    this.steps.push(...added);
    return added;
  }

  /** Room noise long enough to finish calibration. */
  calibrate(levelDb = QUIET_DB): this {
    this.push(silence(levelDb), 15);
    return this;
  }

  get last(): TrackerOutput {
    return this.steps[this.steps.length - 1].out;
  }
}

/** Small deterministic "random" offsets in [-1, 1]. */
export function wobble(i: number): number {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return 2 * (x - Math.floor(x)) - 1;
}
