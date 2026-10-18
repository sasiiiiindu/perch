/**
 * Opens the microphone and streams pitch analyses of it.
 *
 *   mic → MediaStreamSource → AudioWorkletNode → Gain(0) → destination
 *                                   │ sample windows (MessagePort)
 *                                   ▼
 *                            analysis worker ──▶ onAnalysis (main thread)
 *
 * Browser glue only: what to do with each analysis is up to the caller.
 */

import { WORKER_READY, type AnalysisInit, type AnalysisMessage } from './analysis-protocol';
import { MicError, checkMicEnvironment, type MicErrorKind } from './mic-errors';
import type { PitchProcessorOptions } from './pitch-processor';
import type { FrameAnalysis } from './reading';
// `?worker&url` makes Vite bundle the processor to its own JS file and give us
// its URL (with the GitHub Pages base path). Plain `?url` would ship raw TS.
import processorUrl from './pitch-processor.ts?worker&url';

/** Must match PROCESSOR_NAME in src/audio/pitch-processor.ts. */
const PROCESSOR_NAME = 'perch-pitch-frames';

/** Same buffer size the detector is tested with (tests/pitch.test.ts). */
export const WINDOW_SIZE = 2048;
export const READINGS_PER_SECOND = 25;

/**
 * Plain `false`, not `{ exact: false }`: a browser that can't turn a feature
 * off would reject `exact` with OverconstrainedError, which reads as "no mic".
 * With plain values it opens the mic anyway and we show what it really applied.
 * All three are off because each one distorts a sustained tone: noise
 * suppression and echo cancellation treat it as noise, AGC ramps its level.
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

export interface MicHandlers {
  /**
   * The analysis of a WINDOW_SIZE-sample window, ~READINGS_PER_SECOND times
   * a second. `timeMs` is the audio-clock time of the window's newest sample.
   */
  onAnalysis(analysis: FrameAnalysis, sampleRate: number, timeMs: number): void;
  /** The mic stopped mid-session (unplugged, or permission revoked). */
  onEnded(): void;
  /** AudioContext state changed (e.g. iOS suspends it during a phone call). */
  onStateChange?(state: AudioContextState): void;
}

export interface MicSession {
  /** Already unlocked by the user's tap, so it can also play sound (the chorus). */
  context: AudioContext;
  sampleRate: number;
  /** What the browser actually applied, which may differ from what we asked for. */
  settings: MediaTrackSettings;
  readonly state: AudioContextState;
  stop(): Promise<void>;
}

/** Whether the mic can be started here at all, before the user taps. */
export function micBlocker(): MicErrorKind | null {
  return checkMicEnvironment({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    hasAudioWorklet: typeof AudioWorkletNode === 'function',
  });
}

/**
 * Must be called from a tap/click handler. Rejects with a MicError or the
 * browser's DOMException; pass either to classifyMicError().
 */
export async function startMic(handlers: MicHandlers): Promise<MicSession> {
  const blocker = micBlocker();
  if (blocker) throw new MicError(blocker);

  // Create and resume the context before the first await: iOS Safari only
  // allows audio to start while it can still tie the call to the user's tap.
  // Default sample rate on purpose: Firefox refuses to connect a mic whose
  // rate differs from the context's.
  const context = new AudioContext();
  void context.resume();

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS });
  } catch (error) {
    void context.close();
    throw error;
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());

  try {
    await context.audioWorklet.addModule(processorUrl);
  } catch (error) {
    stopTracks();
    void context.close();
    throw new MicError('unsupported', `Could not load the audio worklet: ${String(error)}`);
  }
  let worker: Worker;
  try {
    worker = await startAnalysisWorker();
  } catch (error) {
    stopTracks();
    void context.close();
    throw new MicError('unsupported', `Could not load the analysis worker: ${String(error)}`);
  }
  // Resume again: some browsers suspend the context while the permission prompt is up.
  await context.resume();

  const processorOptions: PitchProcessorOptions = {
    windowSize: WINDOW_SIZE,
    hopSize: Math.round(context.sampleRate / READINGS_PER_SECOND),
  };
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions,
  });
  // A node must lead to the destination to be guaranteed to run; the zero
  // gain makes sure no mic sound ever reaches the speakers.
  const mute = new GainNode(context, { gain: 0 });
  source.connect(node).connect(mute).connect(context.destination);

  // Windows go from the worklet straight to the worker; only results come back here.
  const channel = new MessageChannel();
  const init: AnalysisInit = { port: channel.port1, sampleRate: context.sampleRate };
  worker.postMessage(init, [channel.port1]);
  node.port.postMessage({ port: channel.port2 }, [channel.port2]);
  worker.onmessage = ({ data }: MessageEvent<AnalysisMessage>) =>
    handlers.onAnalysis(data.analysis, context.sampleRate, data.timeMs);

  const track = stream.getAudioTracks()[0];
  track.addEventListener('ended', () => handlers.onEnded());

  context.onstatechange = () => handlers.onStateChange?.(context.state);
  // iOS can leave the context suspended after the page was in the background.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && context.state !== 'closed') void context.resume();
  };
  document.addEventListener('visibilitychange', onVisible);

  // The returned object holds `source`, `node` and `worker` through stop()'s
  // closure. That matters: a garbage-collected MediaStreamSource silently stops the audio.
  return {
    context,
    sampleRate: context.sampleRate,
    settings: track.getSettings(),
    get state() {
      return context.state;
    },
    async stop() {
      document.removeEventListener('visibilitychange', onVisible);
      worker.onmessage = null;
      worker.terminate(); // closes its end of the channel too
      source.disconnect();
      node.disconnect();
      stopTracks();
      await context.close();
    },
  };
}

/** Waits for the worker to say it has loaded: without it the tuner would start and never hear anything. */
function startAnalysisWorker(timeoutMs = 10_000): Promise<Worker> {
  const worker = new Worker(new URL('./analysis-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const fail = (reason: string) => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error(reason));
    };
    const timer = window.setTimeout(() => fail('timed out'), timeoutMs);
    worker.onerror = (event) => fail(event.message || 'failed to load');
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (data !== WORKER_READY) return;
      window.clearTimeout(timer);
      worker.onerror = null;
      resolve(worker);
    };
  });
}
