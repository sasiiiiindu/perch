/**
 * Messages between the main thread and the analysis worker. A separate file
 * so the main thread can import WORKER_READY without pulling in (and
 * running) the worker itself.
 */

import type { FrameAnalysis } from './reading';

/** Posted once when the worker has loaded, so a failed load can't pass silently. */
export const WORKER_READY = 'ready';

/** The first and only message from the main thread. */
export interface AnalysisInit {
  /** The worklet posts its sample windows to the other end of this port. */
  port: MessagePort;
  sampleRate: number;
}

export interface AnalysisMessage {
  analysis: FrameAnalysis;
  /** Audio-clock time of the window's newest sample, in ms. */
  timeMs: number;
}
