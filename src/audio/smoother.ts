/**
 * Cents smoothing: median of the last few readings, then an exponential
 * moving average (EMA) that adapts its speed.
 *
 * - Readings far from the smoothed value are held back: one or two are
 *   outliers and dropped; three in a row agreeing are a real change, and the
 *   value jumps there. Without this, frequent outliers sitting inside the
 *   median window drag the median by a cent or so.
 * - The median removes the smaller single-frame errors.
 * - The EMA removes the remaining jitter. Its time constant shrinks as the
 *   gap between the new median and the smoothed value grows (the idea of
 *   the "1€ filter"): a steady note is averaged over ~400 ms, which irons
 *   out the ±2–3 ¢ noise of a moderately quiet string, while a peg being
 *   turned opens it up to ~60 ms so the display keeps up. Defined in time,
 *   not frames, so it behaves the same if the frame rate changes.
 * - A fresh note starts fast and settles: for the first `warmupMs` only the
 *   fast time constant is used, then the slow one eases in over the same
 *   length again. Right after a pluck the pitch glides down a
 *   few cents (strings go sharp when struck) and the signal is at its
 *   cleanest, so that's when following quickly is both needed and safe.
 * - `weight` (0–1, from clarity) scales the EMA step: clean readings move
 *   the value at full speed, doubtful ones only nudge it, weight 0 freezes it.
 *
 * Pure: the caller passes the time step.
 */

export interface SmootherOptions {
  /** Readings in the median window. Odd, so the median is a real reading. */
  medianSize: number;
  /** EMA time constant while the reading is steady… */
  slowTimeConstantMs: number;
  /** …shrinking towards this one as the gap grows. */
  fastTimeConstantMs: number;
  /** Gap (cents) at which the time constant has halved. */
  gapScaleCents: number;
  /** After a reset, stay fast this long, then ease into the slow time constant over this long again. */
  warmupMs: number;
  /** A reading this far from the smoothed value is an outlier… */
  outlierCents: number;
  /** …unless this many in a row agree, which makes it a real change. */
  outliersForChange: number;
}

export const DEFAULT_SMOOTHER: Readonly<SmootherOptions> = {
  medianSize: 5, // 200 ms at 25 readings/s
  slowTimeConstantMs: 400,
  fastTimeConstantMs: 60,
  gapScaleCents: 3,
  warmupMs: 500,
  // Well above the ±3 ¢ jitter of a ringing string and the few cents a
  // turning peg runs ahead of the smoothed value, well below any real retune.
  outlierCents: 12,
  outliersForChange: 3, // 120 ms at 25 readings/s
};

export class CentsSmoother {
  private readonly opts: SmootherOptions;
  private window: number[] = [];
  private smoothed: number | null = null;
  /** Time since the first reading after a reset. */
  private ageMs = 0;
  /** Consecutive far-off readings waiting to be confirmed as a real change. */
  private pending: number[] = [];

  constructor(options: Partial<SmootherOptions> = {}) {
    this.opts = { ...DEFAULT_SMOOTHER, ...options };
  }

  /** Current smoothed value; null until the first reading after a reset. */
  get value(): number | null {
    return this.smoothed;
  }

  /**
   * 0 while a fresh note is warming up (fast), rising to 1 once it has
   * settled into steady averaging.
   */
  get settling(): number {
    return Math.min(1, Math.max(0, this.ageMs / this.opts.warmupMs - 1));
  }

  reset(): void {
    this.window = [];
    this.smoothed = null;
    this.ageMs = 0;
    this.pending = [];
  }

  /**
   * Adds a reading. `weight` 0 is ignored entirely (not even added to the
   * median), so untrusted readings can't creep in. Returns the smoothed value.
   */
  push(cents: number, weight: number, dtMs: number): number | null {
    if (weight <= 0) return this.smoothed;

    if (this.smoothed !== null && Math.abs(cents - this.smoothed) > this.opts.outlierCents) {
      // Only a run of far-off readings that agree with each other counts.
      if (this.pending.length > 0 && Math.abs(cents - median(this.pending)) > this.opts.outlierCents) {
        this.pending = [];
      }
      this.pending.push(cents);
      if (this.pending.length < this.opts.outliersForChange) return this.smoothed;
      const run = this.pending;
      this.reset();
      this.window = run;
      this.smoothed = median(run);
      return this.smoothed;
    }
    this.pending = [];

    this.window.push(cents);
    if (this.window.length > this.opts.medianSize) this.window.shift();
    const m = median(this.window);

    if (this.smoothed === null) {
      // First reading after a pluck: show it straight away rather than easing in.
      this.smoothed = m;
    } else {
      this.ageMs += Math.max(0, dtMs);
      const gap = m - this.smoothed;
      const { slowTimeConstantMs, fastTimeConstantMs, gapScaleCents } = this.opts;
      const slow = fastTimeConstantMs + (slowTimeConstantMs - fastTimeConstantMs) * this.settling;
      const tau = Math.max(fastTimeConstantMs, slow / (1 + Math.abs(gap) / gapScaleCents));
      const alpha = (1 - Math.exp(-Math.max(0, dtMs) / tau)) * Math.min(1, weight);
      this.smoothed += alpha * gap;
    }
    return this.smoothed;
  }
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
