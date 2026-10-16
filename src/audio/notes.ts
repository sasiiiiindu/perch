/**
 * Frequency ↔ note conversions and guitar-string matching (12-tone equal temperament).
 */

export const DEFAULT_A4 = 440;

const A4_MIDI = 69;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export interface Note {
  /** Note name without octave, e.g. "E" or "C#". */
  name: string;
  /** Scientific pitch octave: middle C is C4. */
  octave: number;
  /** MIDI note number of the nearest note. */
  midi: number;
  /** Offset from the nearest note, -50..+50. Positive = sharp. */
  cents: number;
}

export interface GuitarString {
  /** 0 = low E (leftmost bird) … 5 = high E (rightmost bird). */
  index: number;
  /** Note name with octave, e.g. "E2". */
  name: string;
  midi: number;
}

/** Standard tuning, low to high: E2 A2 D3 G3 B3 E4. */
export const STANDARD_TUNING: readonly GuitarString[] = [
  { index: 0, name: 'E2', midi: 40 },
  { index: 1, name: 'A2', midi: 45 },
  { index: 2, name: 'D3', midi: 50 },
  { index: 3, name: 'G3', midi: 55 },
  { index: 4, name: 'B3', midi: 59 },
  { index: 5, name: 'E4', midi: 64 },
];

export interface StringMatch {
  string: GuitarString;
  /** Target frequency of that string in Hz, for the given A4. */
  target: number;
  /** Offset from the target. Positive = sharp. */
  cents: number;
}

export function midiToFrequency(midi: number, a4 = DEFAULT_A4): number {
  return a4 * 2 ** ((midi - A4_MIDI) / 12);
}

/** Distance from `reference` to `frequency` in cents (100 per semitone). */
export function centsBetween(frequency: number, reference: number): number {
  return 1200 * Math.log2(frequency / reference);
}

export function frequencyToNote(frequency: number, a4 = DEFAULT_A4): Note {
  assertPositive(frequency, 'frequency');
  assertPositive(a4, 'a4');
  const exactMidi = A4_MIDI + 12 * Math.log2(frequency / a4);
  const midi = Math.round(exactMidi);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: (exactMidi - midi) * 100,
  };
}

/** The standard-tuning string closest to `frequency`, measured in cents. */
export function nearestString(frequency: number, a4 = DEFAULT_A4): StringMatch {
  assertPositive(frequency, 'frequency');
  assertPositive(a4, 'a4');
  let match: StringMatch | null = null;
  for (const string of STANDARD_TUNING) {
    const target = midiToFrequency(string.midi, a4);
    const cents = centsBetween(frequency, target);
    if (!match || Math.abs(cents) < Math.abs(match.cents)) match = { string, target, cents };
  }
  return match!;
}

function assertPositive(value: number, label: string): void {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a positive, finite number (got ${value})`);
  }
}
