/**
 * Session progress: which strings have been tuned since the page opened (or
 * the last reset). A string counts once it has held in tune for holdMs.
 *
 * Only frames with a fresh reading of the string count towards that second.
 * After a note stops, the tracker keeps showing its last reading for a
 * second (its decay hold); without this rule a pluck that touched ±3 ¢ and
 * died would count as tuned. Pure: time comes from the caller.
 */

import { STANDARD_TUNING } from './notes';
import type { TrackerOutput } from './tracker';

export interface ProgressOptions {
  /** In tune this long, on fresh readings, and the string is done. */
  holdMs: number;
  /** A gap in the readings longer than this starts the second again. */
  maxGapMs: number;
}

export const DEFAULT_PROGRESS: Readonly<ProgressOptions> = {
  holdMs: 1000,
  // A clarity dip can drop a reading or two (40 ms each) mid-ring; that
  // shouldn't cost the player their second.
  maxGapMs: 200,
};

export interface ProgressUpdate {
  /** The string that became done on this frame, if any. */
  finished: number | null;
  /** True on the one frame the last string becomes done. */
  complete: boolean;
}

const NOTHING: ProgressUpdate = { finished: null, complete: false };

export class TuningProgress {
  private readonly opts: ProgressOptions;
  private readonly flags = STANDARD_TUNING.map(() => false);
  /** The in-tune stretch being timed. */
  private run: { string: number; startMs: number; lastMs: number } | null = null;

  constructor(options: Partial<ProgressOptions> = {}) {
    this.opts = { ...DEFAULT_PROGRESS, ...options };
  }

  /** One flag per string, low E first. */
  get done(): readonly boolean[] {
    return this.flags;
  }

  get count(): number {
    return this.flags.filter(Boolean).length;
  }

  get complete(): boolean {
    return this.count === this.flags.length;
  }

  /**
   * Feed every tracker answer. `sounding` = this frame carried a fresh
   * reading of the locked string (tracker.inspect().sinceLastReadingMs === 0).
   */
  update(output: TrackerOutput, sounding: boolean, timeMs: number): ProgressUpdate {
    const index = output.string?.index ?? null;
    if (output.state !== 'inTune' || index === null) {
      this.run = null;
      return NOTHING;
    }
    // In tune but only held, not heard: wait; the gap is judged at the next fresh reading.
    if (!sounding) return NOTHING;

    const run = this.run;
    if (!run || run.string !== index || timeMs - run.lastMs > this.opts.maxGapMs) {
      this.run = { string: index, startMs: timeMs, lastMs: timeMs };
    } else {
      run.lastMs = timeMs;
    }

    if (this.flags[index] || timeMs - this.run!.startMs < this.opts.holdMs) return NOTHING;
    this.flags[index] = true;
    return { finished: index, complete: this.complete };
  }

  /** Mark strings done without playing them (the ?chorus check). */
  markDone(indices: readonly number[]): void {
    for (const i of indices) this.flags[i] = true;
  }

  reset(): void {
    this.flags.fill(false);
    this.run = null;
  }
}
