/**
 * The live pipeline both screens use: mic → detector → tracker.
 */

import { startMic, type MicSession } from '../audio/mic';
import type { FrameAnalysis } from '../audio/reading';
import type { Tracker, TrackerOutput } from '../audio/tracker';

export interface TuningHandlers {
  /** Every analysed frame, ~25 times a second, with the tracker's answer and the audio-clock time. */
  onUpdate(output: TrackerOutput, analysis: FrameAnalysis, sampleRate: number, timeMs: number): void;
  onEnded(): void;
  onStateChange?(state: AudioContextState): void;
  /**
   * While this returns true, analyses are dropped before the tracker sees
   * them (the app is playing sound the mic would hear). The tracker sees the
   * gap as longer than its hold and ends the old note by itself when they return.
   */
  isPaused?(): boolean;
}

/** Must be called from a tap/click handler (see startMic). */
export function startTuning(tracker: Tracker, handlers: TuningHandlers): Promise<MicSession> {
  return startMic({
    onAnalysis(analysis, sampleRate, timeMs) {
      if (handlers.isPaused?.()) return;
      handlers.onUpdate(tracker.update(analysis, timeMs), analysis, sampleRate, timeMs);
    },
    onEnded: () => handlers.onEnded(),
    onStateChange: (state) => handlers.onStateChange?.(state),
  });
}
