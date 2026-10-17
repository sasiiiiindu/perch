/**
 * Minimal types for the AudioWorkletGlobalScope, which TypeScript's DOM lib
 * doesn't include. Only what src/audio/pitch-processor.ts uses. Written by
 * hand rather than adding @types/audioworklet as a dependency.
 *
 * These are global to the project, but only exist at runtime inside the
 * worklet: don't use them from main-thread code.
 */

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

/** Index of the first sample of the block being processed (the audio clock). */
declare const currentFrame: number;

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
