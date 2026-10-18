/**
 * Web Worker that runs the detector, off the main thread.
 *
 *   worklet ──(MessagePort: sample windows)──▶ this worker ──(analyses)──▶ main thread
 *
 * analyseFrame takes a few ms per window on a phone, 25 times a second. On
 * the main thread that competes with drawing and makes frames uneven; here
 * the main thread only gets the small result. The samples go straight from
 * the worklet to this worker and never touch the main thread.
 */

import { WORKER_READY, type AnalysisInit, type AnalysisMessage } from './analysis-protocol';
import type { FrameMessage } from './pitch-processor';
import { analyseFrame } from './reading';

postMessage(WORKER_READY);

addEventListener('message', ({ data }: MessageEvent<AnalysisInit>) => {
  const { port, sampleRate } = data;
  port.onmessage = ({ data: frame }: MessageEvent<FrameMessage>) => {
    const message: AnalysisMessage = {
      analysis: analyseFrame(frame.samples, sampleRate),
      timeMs: (frame.endFrame / sampleRate) * 1000,
    };
    postMessage(message);
  };
});
