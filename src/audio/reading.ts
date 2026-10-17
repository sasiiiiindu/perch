/**
 * Turns one frame of samples into everything the screen shows: input level,
 * detected pitch, nearest note and nearest string. Pure, so it can be tested
 * without a microphone.
 */

import { DEFAULT_PITCH_OPTIONS, detectPitch } from './pitch';
import { DEFAULT_A4, frequencyToNote, nearestString, type Note, type StringMatch } from './notes';

/** Readings with clarity below this are shown as rejected rather than used. */
export const MIN_CLARITY = DEFAULT_PITCH_OPTIONS.minClarity;

export interface Reading {
  frequency: number;
  /** 0–1. Below MIN_CLARITY the pitch is too unclear to trust. */
  clarity: number;
  /** clarity ≥ MIN_CLARITY. */
  accepted: boolean;
  /** Nearest note; its cents are always within ±50. */
  note: Note;
  /** Nearest standard-tuning string; its cents can be well beyond ±50. */
  string: StringMatch;
}

export interface FrameAnalysis {
  /** RMS level, linear (full scale = 1). */
  rms: number;
  /** RMS level in dBFS; -Infinity for digital silence. */
  levelDb: number;
  /** null when the frame is silent or has no pitch in the guitar range. */
  reading: Reading | null;
}

export function analyseFrame(
  samples: Float32Array,
  sampleRate: number,
  a4: number = DEFAULT_A4,
): FrameAnalysis {
  const level = rms(samples);
  const levelDb = 20 * Math.log10(level);

  // Ask the detector for every result, however unclear, and apply the clarity
  // threshold here instead: otherwise anything under 0.8 comes back as null
  // and the debug screen could never show low clarity values.
  const pitch = detectPitch(samples, sampleRate, { minClarity: 0 });
  if (!pitch) return { rms: level, levelDb, reading: null };

  return {
    rms: level,
    levelDb,
    reading: {
      frequency: pitch.frequency,
      clarity: pitch.clarity,
      accepted: pitch.clarity >= MIN_CLARITY,
      note: frequencyToNote(pitch.frequency, a4),
      string: nearestString(pitch.frequency, a4),
    },
  };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
