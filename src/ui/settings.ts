/**
 * The user's settings and where they're kept: localStorage, on this device
 * only. Parsing is separate and pure, so a missing, old or hand-edited value
 * can never break the app; it just falls back to the default.
 */

import { DEFAULT_A4 } from '../audio/notes';

export interface Settings {
  /** Reference pitch for A4, in whole Hz. */
  a4: number;
  /** Silence the chorus. */
  muted: boolean;
  /** Show the cents number under the active bird (the note name always shows). */
  showCents: boolean;
}

export const A4_MIN = 432;
export const A4_MAX = 446;

export const DEFAULT_SETTINGS: Readonly<Settings> = { a4: DEFAULT_A4, muted: false, showCents: true };

/** `perch.muted` predates the settings panel; keeping the key keeps an existing mute. */
const KEYS: Record<keyof Settings, string> = { a4: 'perch.a4', muted: 'perch.muted', showCents: 'perch.showCents' };

export function clampA4(hz: number): number {
  if (!Number.isFinite(hz)) return DEFAULT_SETTINGS.a4;
  return Math.min(A4_MAX, Math.max(A4_MIN, Math.round(hz)));
}

type Stored = Partial<Record<keyof Settings, string | null>>;

export function parseSettings(stored: Stored): Settings {
  const flag = (value: string | null | undefined, fallback: boolean) =>
    value === '1' ? true : value === '0' ? false : fallback;
  const a4 = stored.a4 == null || stored.a4.trim() === '' ? NaN : Number(stored.a4);
  return {
    a4: clampA4(a4),
    muted: flag(stored.muted, DEFAULT_SETTINGS.muted),
    showCents: flag(stored.showCents, DEFAULT_SETTINGS.showCents),
  };
}

export function serialiseSettings(s: Settings): Record<keyof Settings, string> {
  return { a4: String(s.a4), muted: s.muted ? '1' : '0', showCents: s.showCents ? '1' : '0' };
}

// Storage can be missing or throw (private windows, blocked site data):
// then settings simply aren't remembered.

export function loadSettings(): Settings {
  const stored: Stored = {};
  try {
    for (const key of Object.keys(KEYS) as (keyof Settings)[]) stored[key] = localStorage.getItem(KEYS[key]);
  } catch {
    // Defaults.
  }
  return parseSettings(stored);
}

export function saveSettings(s: Settings): void {
  const values = serialiseSettings(s);
  try {
    for (const key of Object.keys(KEYS) as (keyof Settings)[]) localStorage.setItem(KEYS[key], values[key]);
  } catch {
    // Not remembered; fine.
  }
}
