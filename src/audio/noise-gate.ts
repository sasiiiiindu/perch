/**
 * Noise gate with a short room-noise calibration at start.
 *
 * Mic levels vary by tens of dB between phones and laptops (auto gain is
 * off), so a fixed threshold can't work. For the first CALIBRATION_MS we
 * collect input levels, take a low percentile as the noise floor, and open
 * the gate a margin above it. Pure: time is passed in.
 */

export interface NoiseGateOptions {
  /** Length of the calibration at start. */
  calibrationMs: number;
  /** Gate opens this far above the noise floor… */
  openMarginDb: number;
  /** …and closes this far above it. The gap stops a fading note making the gate chatter. */
  closeMarginDb: number;
  /** The open threshold is clamped to this range, whatever the calibration says. */
  minThresholdDb: number;
  maxThresholdDb: number;
  /** Noise floor used if calibration saw too few noise-only frames. */
  fallbackFloorDb: number;
  /** Fewer noise-only frames than this and calibration isn't trusted. */
  minCalibrationFrames: number;
}

export const DEFAULT_NOISE_GATE: Readonly<NoiseGateOptions> = {
  calibrationMs: 500,
  openMarginDb: 10,
  closeMarginDb: 6,
  // detectPitch already treats anything under -60 dBFS as silence.
  minThresholdDb: -60,
  // Even in a loud room, never demand more than this: the clarity filter
  // copes with noise above the gate, but a deaf tuner can't be fixed later.
  maxThresholdDb: -35,
  fallbackFloorDb: -60,
  // One odd frame (e.g. the first after the mic opens, while a string is
  // already ringing) must not become "the room": that set the floor to the
  // note itself in testing.
  minCalibrationFrames: 3,
};

/** Calibration takes this percentile of levels: low, so a stray sound barely moves it. */
const FLOOR_PERCENTILE = 0.25;
/** Fraction of the gap closed per quieter frame: most of it within a second at 25 frames/s. */
const FLOOR_FALL_RATE = 0.1;

export class NoiseGate {
  private readonly opts: NoiseGateOptions;
  private startMs: number | null = null;
  private samples: number[] = [];
  private floor: number | null = null;
  private open = false;

  constructor(options: Partial<NoiseGateOptions> = {}) {
    this.opts = { ...DEFAULT_NOISE_GATE, ...options };
  }

  get calibrating(): boolean {
    return this.floor === null;
  }

  /** Estimated room noise in dBFS; null while calibrating. */
  get noiseFloorDb(): number | null {
    return this.floor;
  }

  /** Level at which the gate opens; null while calibrating. */
  get thresholdDb(): number | null {
    return this.floor === null ? null : this.clampThreshold(this.floor + this.opts.openMarginDb);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /**
   * Feed one frame. `hasPitch` = the frame has a recognisable pitch, so it's
   * a played note, not room noise, and is left out of the noise estimate.
   * Returns whether the gate is open (always false while calibrating).
   */
  update(levelDb: number, hasPitch: boolean, timeMs: number): boolean {
    if (this.floor === null) {
      this.startMs ??= timeMs;
      if (!hasPitch && Number.isFinite(levelDb)) this.samples.push(levelDb);
      if (timeMs - this.startMs < this.opts.calibrationMs) return false;
      this.floor = this.estimateFloor();
      this.samples = [];
    }

    const open = this.clampThreshold(this.floor + this.opts.openMarginDb);
    const close = Math.min(open, this.floor + this.opts.closeMarginDb);
    this.open = this.open ? levelDb >= close : levelDb >= open;

    // If calibration caught a strum (chords have low clarity, so they aren't
    // excluded), the floor is too high. Let it ease down towards quieter
    // levels seen later (gradually, so one unusually quiet frame doesn't drag
    // it). It never rises, so a long note can't push it up.
    if (!this.open && !hasPitch && levelDb < this.floor) this.floor += FLOOR_FALL_RATE * (levelDb - this.floor);
    return this.open;
  }

  private estimateFloor(): number {
    if (this.samples.length < this.opts.minCalibrationFrames) return this.opts.fallbackFloorDb;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.floor(FLOOR_PERCENTILE * (sorted.length - 1))];
  }

  private clampThreshold(db: number): number {
    return Math.min(this.opts.maxThresholdDb, Math.max(this.opts.minThresholdDb, db));
  }
}
