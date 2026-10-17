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

export interface PluckOptions {
  /** Total length in seconds. */
  seconds: number;
  /** Silence before the pluck, in seconds. */
  delay?: number;
  /** Peak level of the pluck (linear, full scale = 1). */
  peak?: number;
  /** Decay time constant of the fundamental, in seconds. Upper partials decay faster. */
  decay?: number;
  /** Cents sharp at the instant of the pluck, gliding down to 0 (strings go sharp when struck hard). */
  attackSharpCents?: number;
  /** Room noise RMS level (linear). */
  noiseRms?: number;
  /** String stiffness: partial h sits at h·f0·√(1 + B·h²). Real guitar strings: ~1e-5–1e-4. */
  inharmonicity?: number;
}

/**
 * A plucked string, closer to a real guitar than harmonicTone: a short noise
 * burst at the attack, partials that decay at different rates, slight
 * inharmonicity, a pitch glide from sharp to settled, and constant room noise.
 */
export function pluck(f0: number, sampleRate: number, rng: Rng, options: PluckOptions): Float32Array {
  const {
    seconds,
    delay = 0,
    peak = 0.3,
    decay = 1.2,
    attackSharpCents = 6,
    noiseRms = 0.001,
    inharmonicity = 5e-5,
  } = options;
  const amplitudes = [1, 1.4, 1.1, 0.7, 0.5, 0.35, 0.25, 0.15];
  const total = amplitudes.reduce((a, b) => a + b, 0);
  const phases = amplitudes.map(() => 2 * Math.PI * rng());
  const glideTau = 0.15; // seconds for the attack glide to settle
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  const phase = new Float64Array(amplitudes.length);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate - delay;
    let v = 0;
    if (t >= 0) {
      const glide = 2 ** ((attackSharpCents * Math.exp(-t / glideTau)) / 1200);
      for (let h = 0; h < amplitudes.length; h++) {
        const k = h + 1;
        const fk = k * f0 * glide * Math.sqrt(1 + inharmonicity * k * k);
        phase[h] += (2 * Math.PI * fk) / sampleRate;
        const env = Math.exp(-t / (decay / (1 + 0.6 * h)));
        v += amplitudes[h] * env * Math.sin(phase[h] + phases[h]);
      }
      v = (peak * v) / total;
      if (t < 0.01) v += peak * 0.5 * (rng() * 2 - 1) * (1 - t / 0.01); // pick noise
    }
    out[i] = v + noiseRms * gaussian(rng);
  }
  return out;
}
