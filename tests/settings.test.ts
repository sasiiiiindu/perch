import { describe, expect, it } from 'vitest';
import { A4_MAX, A4_MIN, DEFAULT_SETTINGS, clampA4, parseSettings, serialiseSettings } from '../src/ui/settings';

describe('settings', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(parseSettings({})).toEqual({ a4: 440, muted: false, showCents: true });
    expect(parseSettings({ a4: null, muted: null, showCents: null })).toEqual(DEFAULT_SETTINGS);
  });

  it('reads stored values', () => {
    expect(parseSettings({ a4: '442', muted: '1', showCents: '0' })).toEqual({ a4: 442, muted: true, showCents: false });
  });

  it('keeps a mute saved before the settings panel existed (same key, same format)', () => {
    expect(parseSettings({ muted: '1' }).muted).toBe(true);
  });

  it('clamps A4 to 432–446 Hz in whole Hz', () => {
    expect(parseSettings({ a4: '400' }).a4).toBe(A4_MIN);
    expect(parseSettings({ a4: '460' }).a4).toBe(A4_MAX);
    expect(parseSettings({ a4: '441.6' }).a4).toBe(442);
    expect(clampA4(431)).toBe(432);
  });

  it.each(['', ' ', 'abc', 'NaN', 'Infinity'])('falls back to 440 for a stored A4 of %j', (a4) => {
    expect(parseSettings({ a4 }).a4).toBe(440);
  });

  it('falls back for flags that are not 0 or 1', () => {
    expect(parseSettings({ muted: 'yes', showCents: 'true' })).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips', () => {
    const s = { a4: 435, muted: true, showCents: false };
    expect(parseSettings(serialiseSettings(s))).toEqual(s);
  });
});
