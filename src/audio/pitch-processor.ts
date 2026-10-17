/**
 * AudioWorklet processor: collects microphone samples and posts the most
 * recent `windowSize` samples to the main thread every `hopSize` samples.
 *
 * It does no pitch detection itself. The audio thread gets 128 samples
 * (~2.7 ms at 48 kHz) per call, and detectPitch takes a few ms on a 2048-sample
 * window, so running it here would make the thread miss deadlines and drop input.
 *
 * Runs in the AudioWorkletGlobalScope: no DOM, and no imports from the rest of src/.
 */

export interface PitchProcessorOptions {
  /** Samples per posted frame (the detector's buffer size). */
  windowSize: number;
  /** Samples between posted frames: sampleRate / hopSize = readings per second. */
  hopSize: number;
}

/** Must match PROCESSOR_NAME in src/audio/mic.ts. */
const PROCESSOR_NAME = 'perch-pitch-frames';

class PitchFrameProcessor extends AudioWorkletProcessor {
  private readonly ring: Float32Array;
  private readonly hopSize: number;
  /** Where the next sample goes in `ring`. */
  private writeIndex = 0;
  /** Samples received so far, capped at the window size. */
  private filled = 0;
  private sinceLastPost = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const { windowSize, hopSize } = options.processorOptions as PitchProcessorOptions;
    this.ring = new Float32Array(windowSize);
    this.hopSize = hopSize;
  }

  process(inputs: Float32Array[][]): boolean {
    // Channel 0 only: a stereo mic's channels carry the same string.
    // The input is empty until the mic source is connected.
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const ring = this.ring;
    for (let i = 0; i < channel.length; i++) {
      ring[this.writeIndex] = channel[i];
      this.writeIndex = (this.writeIndex + 1) % ring.length;
    }
    this.filled = Math.min(ring.length, this.filled + channel.length);
    this.sinceLastPost += channel.length;

    if (this.filled === ring.length && this.sinceLastPost >= this.hopSize) {
      // Subtract rather than reset: the hop isn't a multiple of 128, and
      // carrying the remainder keeps the average rate exact.
      this.sinceLastPost -= this.hopSize;
      this.post();
    }
    // Keep the processor alive while the node exists.
    return true;
  }

  /** Posts the window oldest-sample-first, transferring the buffer to avoid a copy. */
  private post(): void {
    const ring = this.ring;
    const frame = new Float32Array(ring.length);
    frame.set(ring.subarray(this.writeIndex), 0);
    frame.set(ring.subarray(0, this.writeIndex), ring.length - this.writeIndex);
    this.port.postMessage(frame, [frame.buffer]);
  }
}

registerProcessor(PROCESSOR_NAME, PitchFrameProcessor);
