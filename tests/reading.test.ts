import { describe, expect, it } from 'vitest';
import { MIN_CLARITY, analyseFrame } from '../src/audio/reading';
import { midiToFrequency } from '../src/audio/notes';
import { detune, harmonicTone, seededRng, whiteNoise } from './signals';

const RATE = 48000;
const SIZE = 2048; // WINDOW_SIZE in src/audio/mic.ts
const GUITAR_LIKE = [1, 1.6, 1.3, 0.6, 0.3];

describe('analyseFrame', () => {
  it('reads an open low E as E2, string 0, near 0 cents, accepted', () => {
    const e2 = midiToFrequency(40);
    const { reading, levelDb } = analyseFrame(harmonicTone(e2, GUITAR_LIKE, RATE, SIZE, seededRng(1)), RATE);
    expect(reading).not.toBeNull();
    expect(reading!.note).toMatchObject({ name: 'E', octave: 2 });
    expect(reading!.string.string.index).toBe(0);
    expect(Math.abs(reading!.string.cents)).toBeLessThan(1);
    expect(reading!.accepted).toBe(true);
    expect(reading!.clarity).toBeGreaterThanOrEqual(MIN_CLARITY);
    expect(levelDb).toBeLessThan(0);
  });

  it('reports cents from the string with the right sign', () => {
    const sharpA = detune(midiToFrequency(45), 20);
    const { reading } = analyseFrame(harmonicTone(sharpA, GUITAR_LIKE, RATE, SIZE, seededRng(2)), RATE);
    expect(reading!.string.string.name).toBe('A2');
    expect(reading!.string.cents).toBeCloseTo(20, 0);
    expect(reading!.note.cents).toBeCloseTo(20, 0);
  });

  it('keeps note cents within ±50 while string cents can go beyond', () => {
    // G#2 sits a semitone below A2: in tune as a note, 100 cents flat as a string.
    const gSharp2 = midiToFrequency(44);
    const { reading } = analyseFrame(harmonicTone(gSharp2, GUITAR_LIKE, RATE, SIZE, seededRng(3)), RATE);
    expect(reading!.note).toMatchObject({ name: 'G#', octave: 2 });
    expect(Math.abs(reading!.note.cents)).toBeLessThan(1);
    expect(reading!.string.string.name).toBe('A2');
    expect(reading!.string.cents).toBeCloseTo(-100, 0);
  });

  it('returns no reading for digital silence, with -Infinity dBFS', () => {
    const result = analyseFrame(new Float32Array(SIZE), RATE);
    expect(result.reading).toBeNull();
    expect(result.rms).toBe(0);
    expect(result.levelDb).toBe(-Infinity);
  });

  it('never accepts white noise, though it may report a low-clarity reading', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { reading } = analyseFrame(whiteNoise(SIZE, 0.1, seededRng(seed)), RATE);
      if (reading) {
        expect(reading.accepted).toBe(false);
        expect(reading.clarity).toBeLessThan(MIN_CLARITY);
      }
    }
  });

  it('reports level in dBFS', () => {
    // A full-scale-0.5 sine has RMS 0.5/√2 ≈ -9.03 dBFS.
    const { levelDb } = analyseFrame(harmonicTone(220, [1], RATE, SIZE, seededRng(4)), RATE);
    expect(levelDb).toBeCloseTo(-9.03, 1);
  });
});
