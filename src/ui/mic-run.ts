/**
 * Starting and stopping the mic for the tuner, and what goes with it: the
 * screen wake lock, and stopping whenever the page is hidden (switching
 * apps or tabs, locking the phone). A hidden tuner shouldn't keep the mic,
 * and the mic indicator, on.
 */

import type { MicSession } from '../audio/mic';
import type { Tracker, TrackerOutput } from '../audio/tracker';
import { startTuning } from './tuning-session';
import { ScreenWake } from './wake-lock';

/** user: Stop was tapped. hidden: the page was hidden. ended: the mic went away. */
export type StopReason = 'user' | 'hidden' | 'ended';

export interface MicRunHooks {
  /** A fresh tracker for each start, so the room noise is measured again. */
  newTracker(): Tracker;
  onUpdate(output: TrackerOutput, tracker: Tracker, timeMs: number): void;
  /** Analyses are dropped while this is true (see TuningHandlers.isPaused). */
  isPaused(): boolean;
  onStarted(): void;
  onStopped(reason: StopReason): void;
  onFailed(error: unknown): void;
}

export class MicRun {
  private session: MicSession | null = null;
  private trackerInUse: Tracker | null = null;
  private starting = false;
  /** Bumped by every stop, so a start that finishes afterwards knows it's stale. */
  private generation = 0;
  private readonly wake = new ScreenWake();

  constructor(private readonly hooks: MicRunHooks) {
    const onHide = () => this.stop('hidden');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    // Also covers the page going into the back/forward cache.
    window.addEventListener('pagehide', onHide);
  }

  /** Starting or running. */
  get active(): boolean {
    return this.starting || this.session !== null;
  }

  /** The running mic's AudioContext (unlocked by the Start tap, so it can also play sound). */
  get context(): AudioContext | null {
    return this.session?.context ?? null;
  }

  get tracker(): Tracker | null {
    return this.trackerInUse;
  }

  /** Must be called from a tap. */
  async start(): Promise<void> {
    if (this.active) return;
    this.starting = true;
    // Before the first await, while the browser can still tie it to the tap.
    this.wake.request();
    const generation = this.generation;
    const tracker = this.hooks.newTracker();
    this.trackerInUse = tracker;
    try {
      const session = await startTuning(tracker, {
        onUpdate: (output, _analysis, _sampleRate, timeMs) => this.hooks.onUpdate(output, tracker, timeMs),
        isPaused: () => this.hooks.isPaused(),
        onEnded: () => this.stop('ended'),
      });
      // Stopped (e.g. the page was hidden) while the mic was starting: don't keep it.
      if (generation !== this.generation) {
        void session.stop();
        return;
      }
      this.starting = false;
      this.session = session;
      this.hooks.onStarted();
    } catch (error) {
      if (generation !== this.generation) return;
      this.starting = false;
      this.trackerInUse = null;
      this.wake.release();
      this.hooks.onFailed(error);
    }
  }

  stop(reason: StopReason): void {
    if (!this.active) return;
    this.generation++;
    this.starting = false;
    void this.session?.stop();
    this.session = null;
    this.trackerInUse = null;
    this.wake.release();
    this.hooks.onStopped(reason);
  }
}
