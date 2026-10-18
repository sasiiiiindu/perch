import { describe, expect, it } from 'vitest';
import { chorusScore, singingAt } from '../src/audio/chorus-score';
import { STANDARD_TUNING, midiToFrequency } from '../src/audio/notes';

const score = chorusScore();

describe('chorus score', () => {
  it('chirps each string in turn, low E to high E, at its own pitch', () => {
    expect(score.chirps.map((c) => c.string)).toEqual([0, 1, 2, 3, 4, 5]);
    score.chirps.forEach((c, i) => expect(c.frequency).toBeCloseTo(midiToFrequency(STANDARD_TUNING[i].midi), 6));
    expect(score.chirps[0].frequency).toBeCloseTo(82.41, 2);
    expect(score.chirps[5].frequency).toBeCloseTo(329.63, 2);
  });

  it('never overlaps two chirps, and the chord comes after the last one', () => {
    for (let i = 1; i < score.chirps.length; i++) {
      const prev = score.chirps[i - 1];
      expect(score.chirps[i].start).toBeGreaterThanOrEqual(prev.start + prev.duration);
    }
    const last = score.chirps[score.chirps.length - 1];
    expect(score.chord.start).toBeGreaterThan(last.start + last.duration);
  });

  it('plays the chord on all six string pitches', () => {
    expect(score.chord.frequencies).toEqual(score.chirps.map((c) => c.frequency));
  });

  it('is short, and listening waits for the sound to die away', () => {
    expect(score.end).toBe(score.chord.start + score.chord.duration);
    expect(score.listenAgainAt).toBeGreaterThan(score.end);
    expect(score.listenAgainAt).toBeLessThan(6);
  });

  it('follows the sound with the birds: one bird per chirp, then all six', () => {
    score.chirps.forEach((c) => expect(singingAt(score, c.start + 0.01)).toEqual([c.string]));
    expect(singingAt(score, score.chord.start + 0.5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(singingAt(score, score.end + 0.1)).toEqual([]);
  });

  it('never has more than one bird singing before the chord', () => {
    for (let t = 0; t < score.chord.start; t += 0.01) expect(singingAt(score, t)!.length).toBeLessThanOrEqual(1);
  });

  it('is over before the start and after listening resumes', () => {
    expect(singingAt(score, -0.1)).toBeNull();
    expect(singingAt(score, score.listenAgainAt)).toBeNull();
  });
});
