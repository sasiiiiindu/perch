import { describe, expect, it } from 'vitest';
import { Announcer, phrase, type Heard } from '../src/ui/announcer';

const heard = (string: string | null, verdict: Heard['verdict'], cents: number | null): Heard => ({ string, verdict, cents });

describe('phrase', () => {
  it('says the string and how far off it is', () => {
    expect(phrase('A2', 'flat', -12.4)).toBe('A2, 12 cents flat');
    expect(phrase('D3', 'sharp', 4.6)).toBe('D3, 5 cents sharp');
    expect(phrase('E4', 'inTune', 1.2)).toBe('E4, in tune');
  });

  it('never says "0 cents" off, and uses "cent" for one', () => {
    expect(phrase('G3', 'sharp', 0.4)).toBe('G3, 1 cent sharp');
  });
});

describe('Announcer', () => {
  it('speaks a new string straight away, then stays quiet while nothing changes', () => {
    const a = new Announcer();
    expect(a.update(heard('A2', 'flat', -20), 0)).toBe('A2, 20 cents flat');
    expect(a.update(heard('A2', 'flat', -20.2), 40)).toBeNull();
  });

  it('speaks changing cents at most every 1.5 s', () => {
    const a = new Announcer();
    a.update(heard('A2', 'flat', -20), 0);
    const spoken: string[] = [];
    for (let t = 40; t <= 3100; t += 40) {
      const text = a.update(heard('A2', 'flat', -20 + t / 200), t);
      if (text) spoken.push(`${t}: ${text}`);
    }
    expect(spoken).toEqual(['1520: A2, 12 cents flat', '3040: A2, 5 cents flat']);
  });

  it('speaks a change of verdict after half a second, not 1.5 s', () => {
    const a = new Announcer();
    a.update(heard('A2', 'flat', -5), 0);
    expect(a.update(heard('A2', 'inTune', -1), 200)).toBeNull();
    expect(a.update(heard('A2', 'inTune', -1), 520)).toBe('A2, in tune');
  });

  it('speaks a different string at once', () => {
    const a = new Announcer();
    a.update(heard('A2', 'flat', -5), 0);
    expect(a.update(heard('D3', 'sharp', 8), 40)).toBe('D3, 8 cents sharp');
  });

  it('speaks the same note again after silence', () => {
    const a = new Announcer();
    a.update(heard('A2', 'inTune', 0), 0);
    expect(a.update(heard(null, null, null), 40)).toBeNull();
    expect(a.update(heard('A2', 'inTune', 0), 80)).toBe('A2, in tune');
  });
});
