import { describe, expect, it } from 'vitest';
import { DEFAULT_TRACKER, Tracker, type TrackerOutput } from '../src/audio/tracker';
import { analyseFrame } from '../src/audio/reading';
import { midiToFrequency } from '../src/audio/notes';
import { A2, D3, E2, FRAME_MS, Feed, PLAYING_DB, hz, note, silence, wobble, type Step } from './frames';
import { pluck, seededRng } from './signals';

const { holdMs, switchMs } = DEFAULT_TRACKER;

const tuned = (steps: Step[]) => steps.filter((s) => s.out.cents !== null);
const centsOf = (steps: Step[]) => tuned(steps).map((s) => s.out.cents!);
const maxAbs = (values: number[]) => Math.max(...values.map(Math.abs));

describe('Tracker: calibration and gate', () => {
  it('is idle while calibrating, even if a string is already ringing', () => {
    const feed = new Feed(new Tracker());
    const steps = feed.push(note(hz(A2)), 12); // 480 ms, inside the 500 ms calibration
    expect(steps.every((s) => s.out.state === 'idle')).toBe(true);
    expect(feed.tracker.inspect().calibrating).toBe(true);
  });

  it('sets the gate 10 dB above a quiet room', () => {
    const feed = new Feed(new Tracker()).calibrate(-60);
    const info = feed.tracker.inspect();
    expect(info.calibrating).toBe(false);
    expect(info.noiseFloorDb).toBeCloseTo(-60, 5);
    expect(info.gateThresholdDb).toBeCloseTo(-50, 5);
  });

  it('ignores clear notes during calibration (plucking straight after Start)', () => {
    const feed = new Feed(new Tracker());
    feed.push(silence(-62), 4);
    feed.push(note(hz(E2), 0.99, -20), 10);
    expect(feed.tracker.inspect().noiseFloorDb).toBeCloseTo(-62, 5);
  });

  it('is not fooled by one odd frame when a string is already ringing at Start', () => {
    const feed = new Feed(new Tracker());
    feed.push(silence(-21)); // first frame after the mic opens: no pitch found yet
    feed.push(note(hz(A2, 12), 0.99, -17), 14);
    expect(feed.tracker.inspect().noiseFloorDb).toBe(-60); // fallback, not -21
    feed.push(note(hz(A2, 12), 0.99, -17), 50);
    expect(feed.last.cents).toBeCloseTo(12, 1);
  });

  it('caps the gate after a loud strum in calibration, then lets it fall', () => {
    const feed = new Feed(new Tracker());
    // A strummed chord: loud, but low clarity, so it isn't recognised as a note.
    feed.push(note(hz(A2), 0.4, -25), 15);
    expect(feed.tracker.inspect().gateThresholdDb).toBe(-35);
    feed.push(silence(-60), 50); // 2 s of quiet room
    expect(feed.tracker.inspect().gateThresholdDb!).toBeLessThan(-48);
  });

  it('stays idle for sound below the gate', () => {
    const feed = new Feed(new Tracker()).calibrate(-60);
    const steps = feed.push(note(hz(A2), 0.99, -53), 20);
    expect(steps.every((s) => s.out.state === 'idle')).toBe(true);
  });

  it('does not chatter when the level hovers just under the open threshold', () => {
    const feed = new Feed(new Tracker()).calibrate(-60); // opens at -50, closes at -54
    feed.push(silence(-48));
    let changes = 0;
    let open = feed.tracker.inspect().gateOpen;
    for (let i = 0; i < 50; i++) {
      feed.push(silence(-52 + wobble(i))); // -53 … -51
      const now = feed.tracker.inspect().gateOpen;
      if (now !== open) changes++;
      open = now;
    }
    expect(changes).toBe(0);
    expect(open).toBe(true);
  });

  it('says listening while there is sound but no clear pitch', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2), 0.5), 5);
    expect(feed.last).toEqual({ state: 'listening', string: null, cents: null, frequency: null });
  });
});

describe('Tracker: smoothing', () => {
  it('locks on fast after a pluck: an answer within 120 ms of the first clear reading', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2), 0.6)); // attack frame: not clear yet
    const firstClear = feed.t;
    const steps = feed.push(note(hz(A2, 12)), 10);
    const first = steps.find((s) => s.out.string !== null)!;
    expect(first.t - firstClear).toBeLessThanOrEqual(120);
    expect(first.out.string!.name).toBe('A2');
    expect(first.out.cents).toBeCloseTo(12, 5);
    expect(first.out.state).toBe('sharp');
  });

  it('turns jittery readings with outliers into a steady value on one string', () => {
    const feed = new Feed(new Tracker()).calibrate();
    const raw: number[] = [];
    const steps = feed.push((i) => {
      // ±4 ¢ jitter around +5, and every 7th frame a wild one: +30 ¢, or the
      // octave above (a different string) every 14th.
      let cents = 5 + 4 * wobble(i);
      if (i % 7 === 3) cents = 30;
      raw.push(cents);
      return note(i % 14 === 10 ? hz(A2 + 12) : hz(A2, cents));
    }, 75);

    const settled = steps.slice(25); // after the first second: steady while it rings
    expect(settled.every((s) => s.out.string?.name === 'A2')).toBe(true);
    expect(settled.every((s) => s.out.state === 'sharp')).toBe(true);
    // The output can't beat the input's own short-term average, which for
    // this pattern wanders about ±1.1 ¢: allow 2 ¢ around the truth.
    const cents = centsOf(settled);
    expect(maxAbs(cents.map((c) => c - 5))).toBeLessThan(2);
    // Per-frame movement under 1 ¢, a third of the ±3 ¢ in-tune band:
    // too small for the bird to show as a twitch.
    expect(maxAbs(cents.slice(1).map((c, i) => c - cents[i]))).toBeLessThan(1);
    expect(maxAbs(raw.map((c) => c - 5))).toBeGreaterThan(20); // the input really was noisy
  });

  it('follows a peg being turned', () => {
    const feed = new Feed(new Tracker()).calibrate();
    // -30 ¢ to 0 over 2 s, then held at 0.
    const ramp = feed.push((i) => note(hz(A2, -30 + 30 * Math.min(1, i / 50))), 50);
    const lagging = ramp.slice(8).map((s, i) => s.out.cents! - (-30 + (30 * (i + 8)) / 50));
    expect(maxAbs(lagging)).toBeLessThan(6);
    feed.push(note(hz(A2)), 15);
    expect(Math.abs(feed.last.cents!)).toBeLessThan(0.5);
    expect(feed.last.state).toBe('inTune');
  });

  it('restarts on a new pluck of the same string instead of easing over', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(E2, 12), 0.99, -30), 20);
    expect(feed.last.cents).toBeCloseTo(12, 1);
    // Re-plucked harder after a quarter-turn: 10 dB louder, now -3 ¢.
    const steps = feed.push(note(hz(E2, -3), 0.99, -20), 3);
    expect(steps[0].out.cents).toBeCloseTo(-3, 5);
  });
});

describe('Tracker: string lock', () => {
  it(`switches to a new string only after it holds for ${switchMs} ms`, () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(E2)), 25);
    const start = feed.t;
    const steps = feed.push(note(hz(A2)), 10);
    const switched = steps.find((s) => s.out.string?.name === 'A2')!;
    expect(switched.t - start).toBeGreaterThanOrEqual(switchMs);
    expect(switched.t - start).toBeLessThan(switchMs + 2 * FRAME_MS);
    expect(steps.filter((s) => s.t < switched.t).every((s) => s.out.string?.name === 'E2')).toBe(true);
  });

  it('ignores a short blip of another string (e.g. an octave slip)', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(E2, 2)), 20);
    feed.push(note(hz(D3)), 3); // 120 ms
    feed.push(note(hz(E2, 2)), 20);
    expect(tuned(feed.steps).every((s) => s.out.string?.name === 'E2')).toBe(true);
  });

  it('locks a new string quickly once the old one has stopped', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(E2)), 20);
    feed.push(silence(), 8); // 320 ms of quiet: E2 is held, not ringing
    const start = feed.t;
    const steps = feed.push(note(hz(A2, -7)), 5);
    const switched = steps.find((s) => s.out.string?.name === 'A2')!;
    expect(switched.t - start).toBeLessThanOrEqual(FRAME_MS);
    expect(switched.out.state).toBe('flat');
  });
});

describe('Tracker: fade-out and hold', () => {
  it('holds the last good reading through a messy fade, then goes idle after ~1 s', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(E2, 4), 0.99, -25), 25); // ringing cleanly at +4

    // Fading: clarity sinking towards the threshold, ±15 ¢ jumps, and a
    // couple of wrong-string frames, all still above the 0.8 "present" line.
    const fade = feed.push((i) => {
      const clarity = 0.9 - 0.08 * (i / 12);
      if (i === 5 || i === 6) return note(hz(A2), 0.82, -40);
      return note(hz(E2, 4 + 15 * wobble(i)), clarity, -38 - i * 0.5);
    }, 12);
    const lastPresent = fade[fade.length - 1].t;

    // Then noise-only frames, below the gate.
    const tail = feed.push((i) => (i < 5 ? note(hz(E2, 40 * wobble(i)), 0.4, -48) : silence()), 40);

    const heldOrFading = [...fade, ...tail].filter((s) => s.out.cents !== null);
    expect(heldOrFading.every((s) => s.out.string?.name === 'E2')).toBe(true);
    expect(maxAbs(centsOf(heldOrFading).map((c) => c - 4))).toBeLessThan(1.5);
    expect(heldOrFading.every((s) => s.out.state === 'sharp')).toBe(true);

    const idle = tail.find((s) => s.out.state === 'idle')!;
    expect(idle.t - lastPresent).toBeGreaterThan(holdMs);
    expect(idle.t - lastPresent).toBeLessThanOrEqual(holdMs + FRAME_MS);
  });

  // Frame times come from the audio clock, so a gap means frames were lost
  // while the clock kept running (e.g. the main thread stalled). A suspended
  // context pauses the clock too; then the 1 s hold is what clears the note.
  it('forgets the note after a long gap in the frame times', () => {
    const tracker = new Tracker();
    const feed = new Feed(tracker).calibrate();
    feed.push(note(hz(E2)), 10);
    feed.t += 5000;
    const out = tracker.update(note(hz(A2, 5)), feed.t);
    expect(out.string).toBeNull();
    feed.t += FRAME_MS;
    expect(tracker.update(note(hz(A2, 5)), feed.t).string?.name).toBe('A2');
  });
});

describe('Tracker: in-tune edge', () => {
  const settleAt = (cents: number): TrackerOutput => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2, cents)), 20);
    return feed.last;
  };

  it('is in tune within ±3 cents, flat or sharp outside', () => {
    expect(settleAt(0).state).toBe('inTune');
    expect(settleAt(2.9).state).toBe('inTune');
    expect(settleAt(-2.9).state).toBe('inTune');
    expect(settleAt(3.2).state).toBe('sharp');
    expect(settleAt(-3.2).state).toBe('flat');
    expect(settleAt(-25).state).toBe('flat');
  });

  it('does not flicker when the pitch sits right on the edge', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2, 3)), 10);
    const steps = feed.push((i) => note(hz(A2, 3 + 0.8 * wobble(i))), 75);
    let changes = 0;
    for (let i = 1; i < steps.length; i++) if (steps[i].out.state !== steps[i - 1].out.state) changes++;
    expect(changes).toBeLessThanOrEqual(2);
  });

  it('leaves in tune promptly when the peg moves clearly away', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2)), 20);
    const start = feed.t;
    const steps = feed.push(note(hz(A2, 10)), 10);
    const sharp = steps.find((s) => s.out.state === 'sharp')!;
    expect(sharp.t - start).toBeLessThanOrEqual(200);
  });
});

describe('Tracker: synthetic plucks through the real detector', () => {
  const RATE = 48000;
  const WINDOW = 2048;
  const HOP = 1920; // 25 frames/s, as in the app

  function run(signal: Float32Array) {
    const tracker = new Tracker();
    const steps: (Step & { raw: number | null })[] = [];
    for (let start = 0; start + WINDOW <= signal.length; start += HOP) {
      const analysis = analyseFrame(signal.subarray(start, start + WINDOW), RATE);
      const t = ((start + WINDOW) / RATE) * 1000;
      const out = tracker.update(analysis, t);
      const r = analysis.reading;
      steps.push({ t, out, raw: r?.accepted ? r.string.cents : null });
    }
    return steps;
  }

  const cases = [
    { name: 'low E, loud', midi: E2, peak: 0.3, decay: 2.0, noiseRms: 0.002 },
    { name: 'A, quieter', midi: A2, peak: 0.15, decay: 1.6, noiseRms: 0.003 },
    { name: 'high E, quiet and short', midi: 64, peak: 0.1, decay: 0.9, noiseRms: 0.003 },
  ];

  it.each(cases)('$name: one string, steady cents, then idle', ({ midi, peak, decay, noiseRms }) => {
    const offset = 4; // cents sharp
    const signal = pluck(midiToFrequency(midi) * 2 ** (offset / 1200), RATE, seededRng(midi), {
      seconds: 7,
      delay: 0.8,
      peak,
      decay,
      noiseRms,
    });
    const steps = run(signal);
    const locked = tuned(steps);
    expect(locked.length).toBeGreaterThan(10);
    expect(locked.every((s) => s.out.string?.midi === midi)).toBe(true);

    // Once the attack glide is over (0.6 s after the pluck, under 1 ¢ of it
    // left), the answer stays near the true offset all the way through the
    // hold. 2 ¢ = the detector's own worst case at 20 dB SNR (pitch.test.ts),
    // which is about where the trusted part of the fade ends.
    const settled = locked.filter((s) => s.t > 800 + 600);
    const trackedError = maxAbs(centsOf(settled).map((c) => c - offset));
    expect(trackedError).toBeLessThan(2);
    const jumps = settled.slice(1).map((s, i) => Math.abs(s.out.cents! - settled[i].out.cents!));
    expect(Math.max(...jumps)).toBeLessThan(1); // a third of the in-tune band, as above
    expect(settled.every((s) => s.out.state === 'sharp')).toBe(true);

    // Over the same window, the raw readings that pass the 0.8 clarity cut
    // jump far more: the smoothing must cut the worst error to a third or less.
    const rawError = maxAbs(steps.filter((s) => s.t > 1400 && s.raw !== null).map((s) => s.raw! - offset));
    expect(trackedError).toBeLessThan(rawError / 3);

    expect(steps[steps.length - 1].out.state).toBe('idle');
  });

  it('room noise alone never produces a reading', () => {
    const noise = pluck(110, RATE, seededRng(9), { seconds: 4, delay: 10, noiseRms: 0.003 });
    expect(run(noise).every((s) => s.out.cents === null)).toBe(true);
  });
});

describe('Tracker output', () => {
  it('reports frequency consistent with string and cents', () => {
    const feed = new Feed(new Tracker()).calibrate();
    feed.push(note(hz(A2, -8), 0.99, PLAYING_DB), 15);
    const { frequency, cents, string } = feed.last;
    expect(string!.name).toBe('A2');
    expect(frequency!).toBeCloseTo(midiToFrequency(string!.midi) * 2 ** (cents! / 1200), 9);
    expect(frequency!).toBeCloseTo(hz(A2, -8), 3);
  });
});
