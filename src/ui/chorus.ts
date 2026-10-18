/**
 * Runs one chorus: plays the sound (unless muted), tells the scene which
 * birds sing when, and says when the mic may listen again.
 */

import { chorusScore, singingAt } from '../audio/chorus-score';
import { playChorus, type ChorusPlayback } from '../audio/chorus-sound';

/** Scheduling a little ahead keeps the first chirp from being clipped. */
const SCHEDULE_AHEAD_S = 0.05;

/**
 * Whether all six birds sing on screen during the chord. Off: CLAUDE.md
 * says only one bird animates at a time, so the chord is heard while the
 * birds sit in their proud pose. Set to true to have the whole flock sing.
 */
const CHORD_ANIMATES = false;

export interface Chorus {
  /** Birds singing at `nowMs` (performance.now / rAF time); null once the chorus is over. */
  singing(nowMs: number): readonly number[] | null;
  /** Silence the sound; the birds carry on singing silently. */
  mute(): void;
  /** End it now: silence, and `onOver` is not called. */
  stop(): void;
}

/**
 * `context` is the mic's AudioContext: the chorus starts from an audio
 * callback rather than a tap, and on iOS only a context unlocked by a tap
 * can play. `onOver` fires when detection may resume.
 */
export function startChorus(context: AudioContext, muted: boolean, a4: number, onOver: () => void): Chorus {
  const score = chorusScore(a4);
  if (context.state === 'suspended') void context.resume();

  let playback: ChorusPlayback | null = muted
    ? null
    : playChorus(context, score, context.currentTime + SCHEDULE_AHEAD_S);
  // Line the birds up with what the speaker plays, not with when it was scheduled.
  const latencyS = SCHEDULE_AHEAD_S + (context.outputLatency || context.baseLatency || 0);
  const startMs = performance.now() + latencyS * 1000;

  // A wall-clock deadline, not context.currentTime: if iOS suspends the
  // context mid-chorus (a call, the app backgrounded) its clock stops, and
  // detection would otherwise stay paused for good.
  const deadline = window.setTimeout(onOver, (latencyS + score.listenAgainAt) * 1000);

  const silence = () => {
    playback?.stop();
    playback = null;
  };

  const visible = (birds: readonly number[] | null) => (birds && birds.length > 1 && !CHORD_ANIMATES ? [] : birds);

  return {
    singing: (nowMs) => visible(singingAt(score, (nowMs - startMs) / 1000)) ?? (nowMs < startMs ? [] : null),
    mute: silence,
    stop() {
      silence();
      window.clearTimeout(deadline);
    },
  };
}
