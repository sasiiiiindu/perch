/**
 * Each bird's character in motion. Bigger, lower birds are calmer; the
 * little high ones are livelier. Shapes and colours live in birds.ts.
 */

import type { BirdId } from './birds';

export interface Personality {
  /** Mean seconds between blinks (±40%). */
  blinkEvery: number;
  /** Spring time constant (s): larger = slower to settle into a new pose. */
  springTau: number;
  /** Hop height and squash depth, relative to the default. */
  hop: number;
  squash: number;
  /** Mean seconds between fidgets while no string plays (±45%); null = never fidgets. */
  fidgetEvery: number | null;
  /** Crest flicks while sharp. */
  crestTwitch: boolean;
}

export const BLINK_SPREAD = 0.4;
export const FIDGET_SPREAD = 0.45;
/** Crest flicks come every 0.3–0.8 s while sharp. */
export const TWITCH_EVERY = 0.55;
export const TWITCH_SPREAD = 0.45;

export const PERSONALITY: Record<BirdId, Personality> = {
  bruno: { blinkEvery: 7, springTau: 0.055, hop: 0.5, squash: 0.5, fidgetEvery: null, crestTwitch: false },
  sage: { blinkEvery: 5, springTau: 0.04, hop: 1, squash: 1, fidgetEvery: null, crestTwitch: false },
  clementine: { blinkEvery: 4.5, springTau: 0.04, hop: 1, squash: 1, fidgetEvery: null, crestTwitch: false },
  rosa: { blinkEvery: 4, springTau: 0.04, hop: 1, squash: 1, fidgetEvery: null, crestTwitch: false },
  skye: { blinkEvery: 3.5, springTau: 0.04, hop: 1, squash: 1, fidgetEvery: null, crestTwitch: true },
  pip: { blinkEvery: 2.5, springTau: 0.035, hop: 1.2, squash: 1.1, fidgetEvery: 2.75, crestTwitch: false },
};
