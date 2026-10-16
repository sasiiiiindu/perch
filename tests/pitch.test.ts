import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_PITCH_OPTIONS, detectPitch } from '../src/audio/pitch';
import { STANDARD_TUNING, centsBetween, midiToFrequency, nearestString } from '../src/audio/notes';
import { detune, harmonicTone, seededRng, sine, whiteNoise, withNoise } from './signals';

const SAMPLE_RATES = [48000, 44100];
const BUFFER_SIZE = 2048;
/** Clean cases are repeated with these seeds (different harmonic phases). */
const SEEDS = [1, 2, 3, 4, 5];
/** Noisy cases vary much more from seed to seed, so they get more runs. */
const NOISE_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

/** Fundamental plus louder 2nd and 3rd harmonics, then decaying partials. */
const GUITAR_LIKE = [1, 1.6, 1.3, 0.6, 0.3];
/**
 * A much louder 2nd harmonic. The NSDF peak at half the period reaches ~0.64,
 * so a naive "first positive peak" picker reports the octave above.
 */
const STRONG_SECOND = [1, 3, 1];

const DETUNINGS = [-40, -15, -5, 5, 15, 40];

const strings = STANDARD_TUNING.map((s) => ({ ...s, frequency: midiToFrequency(s.midi) }));

// Worst |cents error| per sample rate, string and category, printed after all tests.
// A null detection is recorded as Infinity so failures can't vanish from the table.
const CATEGORIES = ['sine', 'guitar-like', 'strong 2nd', 'detuned', '20 dB SNR', '10 dB SNR'] as const;
type Category = (typeof CATEGORIES)[number];
const worst = new Map<string, number>();

function record(rate: number, stringName: string, category: Category, error: number): void {
  const key = `${rate}|${stringName}|${category}`;
  worst.set(key, Math.max(worst.get(key) ?? 0, Math.abs(error)));
}

/** Detects, records, then asserts: correct string, and within `tolerance` cents of `expectedHz`. */
function expectPitch(
  signal: Float32Array,
  rate: number,
  expectedHz: number,
  stringIndex: number,
  category: Category,
  tolerance: number,
): void {
  const result = detectPitch(signal, rate);
  const error = result ? centsBetween(result.frequency, expectedHz) : Infinity;
  record(rate, STANDARD_TUNING[stringIndex].name, category, error);

  const context = `${category} ${expectedHz.toFixed(2)} Hz @ ${rate}`;
  expect(result, context).not.toBeNull();
  expect(nearestString(result!.frequency).string.index, context).toBe(stringIndex);
  expect(Math.abs(error), context).toBeLessThanOrEqual(tolerance);
}

describe.each(SAMPLE_RATES)(`detectPitch at %i Hz (${BUFFER_SIZE}-sample buffer)`, (rate) => {
  it.each(strings)('pure sine at open $name within ±1 cent', ({ index, frequency }) => {
    for (const seed of SEEDS) {
      const signal = sine(frequency, rate, BUFFER_SIZE, seededRng(seed));
      expectPitch(signal, rate, frequency, index, 'sine', 1);
    }
  });

  it.each(strings)('guitar-like $name (louder 2nd + 3rd harmonics): fundamental, no octave error', ({ index, frequency }) => {
    for (const seed of SEEDS) {
      const signal = harmonicTone(frequency, GUITAR_LIKE, rate, BUFFER_SIZE, seededRng(seed));
      expectPitch(signal, rate, frequency, index, 'guitar-like', 1);
    }
  });

  it.each(strings)('$name with a very loud 2nd harmonic: fundamental, no octave error', ({ index, frequency }) => {
    for (const seed of SEEDS) {
      const signal = harmonicTone(frequency, STRONG_SECOND, rate, BUFFER_SIZE, seededRng(seed));
      expectPitch(signal, rate, frequency, index, 'strong 2nd', 1);
    }
  });

  it.each(strings)('$name detuned by ±5, ±15, ±40 cents: cents correct within ±1', ({ index, frequency }) => {
    for (const cents of DETUNINGS) {
      const target = detune(frequency, cents);
      for (const seed of SEEDS) {
        expectPitch(sine(target, rate, BUFFER_SIZE, seededRng(seed)), rate, target, index, 'detuned', 1);
        const tone = harmonicTone(target, GUITAR_LIKE, rate, BUFFER_SIZE, seededRng(seed));
        expectPitch(tone, rate, target, index, 'detuned', 1);

        // The value the UI will show: cents from the nearest string.
        const result = detectPitch(tone, rate);
        expect(Math.abs(nearestString(result!.frequency).cents - cents)).toBeLessThanOrEqual(1);
      }
    }
  });

  // Noise makes single-frame readings jitter: at 20 dB SNR the worst low-string
  // frames are ~2 cents off with 2048 samples, and still ~1.6 with 4096. No
  // buffer size gets every frame within ±1, so these bounds come from the
  // product rules instead; steadying the reading is the job of smoothing
  // across frames.
  it.each(strings)('guitar-like $name with 20 dB SNR white noise stays in the ±3-cent in-tune window', ({ index, frequency }) => {
    for (const seed of NOISE_SEEDS) {
      const rng = seededRng(seed);
      const signal = withNoise(harmonicTone(frequency, GUITAR_LIKE, rate, BUFFER_SIZE, rng), 20, rng);
      expectPitch(signal, rate, frequency, index, '20 dB SNR', 3);
    }
  });

  it.each(strings)('guitar-like $name with 10 dB SNR white noise: right string, no octave error', ({ index, frequency }) => {
    for (const seed of NOISE_SEEDS) {
      const rng = seededRng(seed);
      const signal = withNoise(harmonicTone(frequency, GUITAR_LIKE, rate, BUFFER_SIZE, rng), 10, rng);
      expectPitch(signal, rate, frequency, index, '10 dB SNR', 50);
    }
  });

  it('sines from 75 to 400 Hz within ±1 cent', () => {
    for (let f = 75; f <= 400; f += 5) {
      const result = detectPitch(sine(f, rate, BUFFER_SIZE, seededRng(f)), rate);
      expect(result, `${f} Hz`).not.toBeNull();
      expect(Math.abs(centsBetween(result!.frequency, f)), `${f} Hz`).toBeLessThanOrEqual(1);
    }
  });

  it('returns null for silence', () => {
    expect(detectPitch(new Float32Array(BUFFER_SIZE), rate)).toBeNull();
    // A tone far below the silence gate (~-80 dBFS) also counts as silence.
    const faint = sine(110, rate, BUFFER_SIZE, seededRng(1)).map((v) => v * 1e-3);
    expect(detectPitch(faint, rate)).toBeNull();
  });

  it('returns null for pure white noise', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(detectPitch(whiteNoise(BUFFER_SIZE, 0.1, seededRng(seed)), rate), `seed ${seed}`).toBeNull();
    }
  });

  // Guards the test signals themselves: without key-maximum picking (k = 0,
  // i.e. "first positive peak") the strong-2nd signal must cause octave errors,
  // otherwise the test above proves nothing.
  it('strong-2nd signal really is an octave trap for a naive peak picker', () => {
    // Clarity gate off too: the half-period peak (~0.63) would otherwise be rejected as unclear.
    const naive = { keyMaximumThreshold: 0, minClarity: 0 };
    for (const { frequency } of strings) {
      if (2 * frequency > DEFAULT_PITCH_OPTIONS.maxFrequency) continue; // octave above is out of range
      const signal = harmonicTone(frequency, STRONG_SECOND, rate, BUFFER_SIZE, seededRng(1));
      const result = detectPitch(signal, rate, naive);
      // About an octave sharp; the half-period peak is skewed, so not exactly 1200 cents.
      expect(centsBetween(result!.frequency, frequency), `${frequency} Hz`).toBeGreaterThan(1100);
    }
  });
});

afterAll(() => {
  const cell = (rate: number, name: string, category: Category): string => {
    const value = worst.get(`${rate}|${name}|${category}`);
    if (value === undefined) return '–';
    return Number.isFinite(value) ? value.toFixed(3) : 'NULL';
  };
  const lines = [
    `Worst-case |error| in cents (${BUFFER_SIZE}-sample buffer; ${SEEDS.length} seeds per clean case, ${NOISE_SEEDS.length} per noisy case)`,
    `| Rate | String | ${CATEGORIES.join(' | ')} |`,
    `|---|---|${CATEGORIES.map(() => '---').join('|')}|`,
  ];
  for (const rate of SAMPLE_RATES) {
    for (const { name } of strings) {
      lines.push(`| ${rate} | ${name} | ${CATEGORIES.map((c) => cell(rate, name, c)).join(' | ')} |`);
    }
  }
  console.log(lines.join('\n'));
});
