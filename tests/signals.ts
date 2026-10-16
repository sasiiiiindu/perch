/**
 * Synthetic test signals. All randomness comes from a seeded generator,
 * so every run produces exactly the same buffers.
 */

export type Rng = () => number;

/** mulberry32: small, fast, seedable PRNG returning values in [0, 1). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box–Muller). */
function gaussian(rng: Rng): number {
  const u = 1 - rng(); // (0, 1], avoids log(0)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * Sum of harmonics of `f0`: amplitudes[0] is the fundamental, amplitudes[1]
 * the 2nd harmonic, etc. Each harmonic gets a random phase. Peak level ≈ 0.5.
 */
export function harmonicTone(
  f0: number,
  amplitudes: readonly number[],
  sampleRate: number,
  length: number,
  rng: Rng,
): Float32Array {
  const phases = amplitudes.map(() => 2 * Math.PI * rng());
  const total = amplitudes.reduce((sum, a) => sum + Math.abs(a), 0);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (let h = 0; h < amplitudes.length; h++) {
      v += amplitudes[h] * Math.sin(2 * Math.PI * f0 * (h + 1) * t + phases[h]);
    }
    out[i] = (0.5 * v) / total;
  }
  return out;
}

export function sine(f: number, sampleRate: number, length: number, rng: Rng): Float32Array {
  return harmonicTone(f, [1], sampleRate, length, rng);
}

export function whiteNoise(length: number, rmsLevel: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = rmsLevel * gaussian(rng);
  return out;
}

/** Returns a copy of `signal` with white noise added at the given signal-to-noise ratio. */
export function withNoise(signal: Float32Array, snrDb: number, rng: Rng): Float32Array {
  const noise = whiteNoise(signal.length, rms(signal) / 10 ** (snrDb / 20), rng);
  return signal.map((v, i) => v + noise[i]);
}

export function rms(signal: Float32Array): number {
  let sum = 0;
  for (const v of signal) sum += v * v;
  return Math.sqrt(sum / signal.length);
}

/** `f` moved by `cents` (positive = sharper). */
export function detune(f: number, cents: number): number {
  return f * 2 ** (cents / 1200);
}
