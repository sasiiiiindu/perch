/**
 * Pitch detection with the McLeod Pitch Method (MPM).
 *
 * P. McLeod & G. Wyvill, "A Smarter Way to Find Pitch", ICMC 2005.
 *
 * Steps:
 *   1. Normalised square difference function (NSDF): how well the signal
 *      matches itself shifted by `tau` samples, scaled to the range -1..1.
 *   2. Key-maximum peak picking: take the highest point of each positive
 *      region of the NSDF, then choose the FIRST one that is close to the
 *      tallest. This is what avoids octave errors (see pickKeyMaximum).
 *   3. Parabolic interpolation around that peak for a sub-sample period.
 *
 * Pure function of its inputs: no Web Audio or DOM, so it can be tested in Node.
 */

export interface PitchResult {
  /** Fundamental frequency in Hz. */
  frequency: number;
  /** Height of the chosen NSDF peak, 0–1. Near 1 means a clean, periodic tone. */
  clarity: number;
}

export interface PitchOptions {
  /** Lowest frequency searched, in Hz. */
  minFrequency?: number;
  /** Highest frequency searched, in Hz. */
  maxFrequency?: number;
  /** Results with clarity below this are treated as "no clear pitch". */
  minClarity?: number;
  /** Buffers quieter than this RMS level (linear, full scale = 1) are silence. */
  minRms?: number;
  /** Key-maximum threshold `k` from the paper: pick the first peak ≥ k × tallest. */
  keyMaximumThreshold?: number;
}

/**
 * 60–500 Hz leaves margin around the guitar's 75–400 Hz so heavily detuned
 * strings are still found, while a high E's 2nd harmonic (~659 Hz) is excluded.
 */
export const DEFAULT_PITCH_OPTIONS: Readonly<Required<PitchOptions>> = {
  minFrequency: 60,
  maxFrequency: 500,
  minClarity: 0.8,
  minRms: 0.001, // about -60 dBFS
  keyMaximumThreshold: 0.9,
};

export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  options: PitchOptions = {},
): PitchResult | null {
  const opts = { ...DEFAULT_PITCH_OPTIONS, ...options };
  const n = samples.length;

  // Cap the longest lag at half the buffer so every NSDF value is computed
  // from at least n/2 overlapping samples; beyond that the estimate gets noisy.
  const minLag = Math.max(2, Math.floor(sampleRate / opts.maxFrequency));
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / opts.minFrequency));
  if (minLag >= maxLag) return null;

  if (rms(samples) < opts.minRms) return null;

  // One extra lag so the peak at maxLag still has a right-hand neighbour.
  const nsdf = normalisedSquareDifference(samples, maxLag + 1);
  const peak = pickKeyMaximum(nsdf, minLag, maxLag, opts.keyMaximumThreshold);
  if (!peak) return null;

  const clarity = Math.min(1, peak.value);
  if (clarity < opts.minClarity) return null;

  const frequency = sampleRate / peak.lag;
  if (frequency < opts.minFrequency || frequency > opts.maxFrequency) return null;

  return { frequency, clarity };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/**
 * NSDF n'(tau) = 2·r(tau) / m(tau), for tau = 0..lastLag, where
 *   r(tau) = Σ x[j]·x[j+tau]              (autocorrelation over the overlap)
 *   m(tau) = Σ (x[j]² + x[j+tau]²)        (energy of the two overlapping parts)
 * Dividing by m instead of r(0) means a shifted copy that matches perfectly
 * scores 1 at any lag, so later periods aren't penalised for a shorter overlap.
 *
 * Direct O(n · lags) form: ~1.6M multiply-adds for 2048 samples at 48 kHz,
 * a few ms in JS. An FFT would be faster but isn't needed yet.
 */
function normalisedSquareDifference(x: Float32Array, lastLag: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(lastLag + 1);

  let m = 0;
  for (let j = 0; j < n; j++) m += 2 * x[j] * x[j];

  for (let tau = 0; tau <= lastLag; tau++) {
    let r = 0;
    for (let j = 0; j < n - tau; j++) r += x[j] * x[j + tau];
    out[tau] = m > 0 ? (2 * r) / m : 0;
    // m(tau + 1) drops the last sample of the first part and the first of the second.
    m -= x[n - 1 - tau] * x[n - 1 - tau] + x[tau] * x[tau];
  }
  return out;
}

interface Peak {
  /** Interpolated lag in samples (one period). */
  lag: number;
  /** Interpolated NSDF height at that lag. */
  value: number;
}

/**
 * Key-maximum peak picking.
 *
 * A periodic signal has NSDF peaks near 1 at its period T and at 2T, 3T…
 * Loud upper harmonics add smaller peaks at T/2, T/3… Taking the tallest
 * peak can land on 2T (octave too low); taking the first positive peak can
 * land on T/2 (octave too high). The paper's rule: collect the maximum of
 * each positive region, then choose the first one ≥ k × the tallest. With
 * k = 0.9 the harmonic peaks (lower) are skipped and T wins over 2T (earlier).
 */
function pickKeyMaximum(
  nsdf: Float64Array,
  minLag: number,
  maxLag: number,
  k: number,
): Peak | null {
  const candidates: Peak[] = [];

  // Skip the lobe around lag 0, where the signal trivially matches itself.
  let tau = 1;
  while (tau <= maxLag && nsdf[tau] > 0) tau++;

  let best = -1;
  for (; tau <= maxLag; tau++) {
    if (nsdf[tau] > 0) {
      if (best < 0 || nsdf[tau] > nsdf[best]) best = tau;
    } else if (best >= 0) {
      if (best >= minLag) candidates.push(interpolate(nsdf, best));
      best = -1;
    }
  }
  // A region still open at maxLag only counts if its maximum isn't the cut-off edge.
  if (best >= minLag && best < maxLag) candidates.push(interpolate(nsdf, best));

  if (candidates.length === 0) return null;

  let tallest = 0;
  for (const c of candidates) tallest = Math.max(tallest, c.value);
  return candidates.find((c) => c.value >= k * tallest) ?? null;
}

/** Fit a parabola through the peak and its two neighbours; return its vertex. */
function interpolate(nsdf: Float64Array, tau: number): Peak {
  const a = nsdf[tau - 1];
  const b = nsdf[tau];
  const c = nsdf[tau + 1];
  const denominator = a - 2 * b + c;
  if (Math.abs(denominator) < 1e-12) return { lag: tau, value: b };
  const shift = (0.5 * (a - c)) / denominator;
  return { lag: tau + shift, value: b - 0.25 * (a - c) * shift };
}
