/**
 * The live pipeline both screens use: mic → detector → tracker.
 */

import { startMic, type MicSession } from '../audio/mic';
import { analyseFrame, type FrameAnalysis } from '../audio/reading';
import type { Tracker, TrackerOutput } from '../audio/tracker';

export interface TuningHandlers {
  /** Every analysed frame, ~25 times a second, with the tracker's answer. */
  onUpdate(output: TrackerOutput, analysis: FrameAnalysis, sampleRate: number): void;
  onEnded(): void;
  onStateChange?(state: AudioContextState): void;
}

/** Must be called from a tap/click handler (see startMic). */
export function startTuning(tracker: Tracker, handlers: TuningHandlers): Promise<MicSession> {
  return startMic({
    onFrame(samples, sampleRate, timeMs) {
      const analysis = analyseFrame(samples, sampleRate);
      handlers.onUpdate(tracker.update(analysis, timeMs), analysis, sampleRate);
    },
    onEnded: () => handlers.onEnded(),
    onStateChange: (state) => handlers.onStateChange?.(state),
  });
}
