import { describe, expect, it } from 'vitest';
import {
  STANDARD_TUNING,
  centsBetween,
  frequencyToNote,
  midiToFrequency,
  nearestString,
} from '../src/audio/notes';

describe('midiToFrequency', () => {
  it('matches the standard-tuning table in CLAUDE.md', () => {
    const expected = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
    STANDARD_TUNING.forEach((s, i) => expect(midiToFrequency(s.midi)).toBeCloseTo(expected[i], 2));
  });

  it('scales with A4', () => {
    expect(midiToFrequency(69, 432)).toBe(432);
    expect(midiToFrequency(57, 432)).toBeCloseTo(216, 10);
  });
});

describe('frequencyToNote', () => {
  it('names A4 with zero offset', () => {
    expect(frequencyToNote(440)).toEqual({ name: 'A', octave: 4, midi: 69, cents: 0 });
  });

  it('names notes and octaves, with the octave changing at C', () => {
    expect(frequencyToNote(82.41)).toMatchObject({ name: 'E', octave: 2 });
    expect(frequencyToNote(246.94)).toMatchObject({ name: 'B', octave: 3 });
    expect(frequencyToNote(261.63)).toMatchObject({ name: 'C', octave: 4 });
    expect(frequencyToNote(466.16)).toMatchObject({ name: 'A#', octave: 4 });
    expect(frequencyToNote(27.5)).toMatchObject({ name: 'A', octave: 0 });
  });

  it('reports cents: positive when sharp, negative when flat', () => {
    expect(frequencyToNote(440 * 2 ** (10 / 1200)).cents).toBeCloseTo(10, 6);
    expect(frequencyToNote(440 * 2 ** (-30 / 1200)).cents).toBeCloseTo(-30, 6);
  });

  it('rounds to the nearer note past 50 cents', () => {
    const note = frequencyToNote(440 * 2 ** (60 / 1200));
    expect(note).toMatchObject({ name: 'A#', octave: 4 });
    expect(note.cents).toBeCloseTo(-40, 6);
  });

  it('uses the A4 parameter', () => {
    const note = frequencyToNote(440, 432);
    expect(note).toMatchObject({ name: 'A', octave: 4 });
    expect(note.cents).toBeCloseTo(centsBetween(440, 432), 6); // ≈ +31.8
  });

  it('rejects non-positive or non-finite input', () => {
    expect(() => frequencyToNote(0)).toThrow(RangeError);
    expect(() => frequencyToNote(-1)).toThrow(RangeError);
    expect(() => frequencyToNote(NaN)).toThrow(RangeError);
    expect(() => frequencyToNote(Infinity)).toThrow(RangeError);
    expect(() => frequencyToNote(440, 0)).toThrow(RangeError);
  });
});

describe('nearestString', () => {
  it('matches each open string exactly', () => {
    for (const s of STANDARD_TUNING) {
      const match = nearestString(midiToFrequency(s.midi));
      expect(match.string).toBe(s);
      expect(match.cents).toBeCloseTo(0, 9);
    }
  });

  it('picks the closest string in cents and reports the offset', () => {
    const match = nearestString(100); // between E2 (82.41) and A2 (110), closer to A2
    expect(match.string.name).toBe('A2');
    expect(match.target).toBeCloseTo(110, 9);
    expect(match.cents).toBeCloseTo(centsBetween(100, 110), 9);
  });

  it('clamps to the outer strings beyond the guitar range', () => {
    expect(nearestString(40).string.name).toBe('E2');
    expect(nearestString(1000).string.name).toBe('E4');
  });

  it('uses the A4 parameter', () => {
    const match = nearestString(108, 432); // A2 when A4 = 432
    expect(match.string.name).toBe('A2');
    expect(match.target).toBeCloseTo(108, 9);
    expect(match.cents).toBeCloseTo(0, 9);
  });
});
