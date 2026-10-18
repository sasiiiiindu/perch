/**
 * The chorus that plays once all six strings are tuned: each bird chirps in
 * turn, low E to high E, then all six sing a short soft chord.
 *
 * Just the timeline, in seconds from the first chirp. The sound
 * (chorus-sound.ts) and the birds on screen both read it, so they stay in step.
 */

import { DEFAULT_A4, STANDARD_TUNING, midiToFrequency } from './notes';

/** After the last string is done, let its in-tune moment play out before the chorus starts. */
export const CHORUS_LEAD_IN_S = 0.8;

const CHIRP_EVERY = 0.35;
const CHIRP_LENGTH = 0.28;
const CHORD_GAP = 0.3;
const CHORD_LENGTH = 2;
/** Quiet after the chord fades, so the room's echo dies before the mic listens again. */
const TAIL = 0.4;

export interface Chirp {
  string: number;
  frequency: number;
  start: number;
  duration: number;
}

export interface ChorusScore {
  /** One per string, low E first. */
  chirps: Chirp[];
  chord: { start: number; duration: number; frequencies: number[] };
  /** When the last sound has died away. */
  end: number;
  /** When pitch detection may resume. */
  listenAgainAt: number;
}

export function chorusScore(a4 = DEFAULT_A4): ChorusScore {
  const frequencies = STANDARD_TUNING.map((s) => midiToFrequency(s.midi, a4));
  const chirps = frequencies.map((frequency, string) => ({
    string,
    frequency,
    start: string * CHIRP_EVERY,
    duration: CHIRP_LENGTH,
  }));
  const chordStart = chirps.length * CHIRP_EVERY + CHORD_GAP;
  const end = chordStart + CHORD_LENGTH;
  return {
    chirps,
    chord: { start: chordStart, duration: CHORD_LENGTH, frequencies },
    end,
    listenAgainAt: end + TAIL,
  };
}

const ALL = STANDARD_TUNING.map((s) => s.index);
const NONE: number[] = [];

/**
 * Which birds sing at time `t`. A chirping bird sings until the next one
 * starts, so exactly one bird is singing through the chirps; all six sing
 * for the chord. Null before the start and once the chorus is over.
 */
export function singingAt(score: ChorusScore, t: number): readonly number[] | null {
  if (!(t >= 0 && t < score.listenAgainAt)) return null;
  const { chord } = score;
  if (t >= chord.start) return t < chord.start + chord.duration ? ALL : NONE;
  const i = Math.floor(t / CHIRP_EVERY);
  return i < score.chirps.length ? [i] : NONE;
}
