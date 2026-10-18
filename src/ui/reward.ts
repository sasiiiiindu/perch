/**
 * The session's reward: which strings are tuned, and the chorus once all
 * six are. Tells the screen-reader status line about progress.
 */

import { CHORUS_LEAD_IN_S } from '../audio/chorus-score';
import { STANDARD_TUNING } from '../audio/notes';
import { TuningProgress } from '../audio/progress';
import type { TrackerOutput } from '../audio/tracker';
import { startChorus, type Chorus } from './chorus';

export interface RewardHooks {
  /** The running mic's AudioContext, or null when stopped. */
  context(): AudioContext | null;
  muted(): boolean;
  a4(): number;
  /** Progress for screen readers. */
  announce(text: string): void;
  /** A string was tuned, or progress was reset. */
  onProgress(count: number): void;
  /** The chorus is about to play: the live reading should clear. */
  onChorusStart(): void;
}

export class Reward {
  readonly progress = new TuningProgress();
  private chorus: Chorus | null = null;
  private leadIn: number | null = null;

  constructor(private readonly hooks: RewardHooks) {}

  /** While the chorus plays, pitch detection is paused: the mic would hear it. */
  get playing(): boolean {
    return this.chorus !== null;
  }

  /** Birds singing at `nowMs` (rAF time); null when there's no chorus. */
  singing(nowMs: number): readonly number[] | null {
    return this.chorus?.singing(nowMs) ?? null;
  }

  /** `sounding` = this frame carried a fresh reading (not the tracker's decay hold). */
  track(output: TrackerOutput, sounding: boolean, timeMs: number): void {
    const step = this.progress.update(output, sounding, timeMs);
    if (step.finished === null) return;
    this.hooks.onProgress(this.progress.count);
    const name = STANDARD_TUNING[step.finished].name;
    this.hooks.announce(
      step.complete
        ? `${name} tuned. All six strings are in tune.`
        : `${name} tuned, ${this.progress.count} of ${STANDARD_TUNING.length}.`,
    );
    if (step.complete) this.leadIn = window.setTimeout(() => this.begin(), CHORUS_LEAD_IN_S * 1000);
  }

  mute(): void {
    this.chorus?.mute();
  }

  /** Stop any chorus (or one about to start); progress is kept. */
  stop(): void {
    if (this.leadIn !== null) window.clearTimeout(this.leadIn);
    this.leadIn = null;
    this.chorus?.stop();
    this.chorus = null;
  }

  reset(message: string): void {
    this.stop();
    this.progress.reset();
    this.hooks.onProgress(0);
    this.hooks.announce(message);
  }

  private begin(): void {
    this.leadIn = null;
    const context = this.hooks.context();
    if (!context) return;
    this.hooks.onChorusStart();
    this.chorus = startChorus(context, this.hooks.muted(), this.hooks.a4(), () => {
      this.chorus = null;
    });
  }
}
