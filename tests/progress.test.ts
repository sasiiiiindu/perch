import { describe, expect, it } from 'vitest';
import { STANDARD_TUNING } from '../src/audio/notes';
import { DEFAULT_PROGRESS, TuningProgress, type ProgressUpdate } from '../src/audio/progress';
import { DEFAULT_TRACKER, Tracker, type TrackerOutput, type TunerState } from '../src/audio/tracker';
import { A2, FRAME_MS, Feed, hz, note, silence } from './frames';

const { holdMs } = DEFAULT_PROGRESS;

function out(index: number | null, state: TunerState, cents = 0): TrackerOutput {
  return {
    state,
    string: index === null ? null : STANDARD_TUNING[index],
    cents: index === null ? null : cents,
    frequency: null,
  };
}

/** Feeds frames at the app's rate; remembers every update. */
class Player {
  readonly progress = new TuningProgress();
  t = 0;
  readonly updates: ProgressUpdate[] = [];

  play(output: TrackerOutput, ms: number, sounding = true): this {
    for (let end = this.t + ms; this.t < end; this.t += FRAME_MS) {
      this.updates.push(this.progress.update(output, sounding, this.t));
    }
    return this;
  }

  get finished(): number[] {
    return this.updates.flatMap((u) => (u.finished === null ? [] : [u.finished]));
  }
}

describe('TuningProgress', () => {
  it('counts a string once it has held in tune for a second', () => {
    const p = new Player().play(out(1, 'inTune'), holdMs + FRAME_MS);
    expect(p.progress.done).toEqual([false, true, false, false, false, false]);
    expect(p.finished).toEqual([1]);
  });

  it('does not count 0.9 s in tune', () => {
    const p = new Player().play(out(1, 'inTune'), 900).play(out(null, 'idle'), 2000);
    expect(p.progress.count).toBe(0);
  });

  it("does not count the tracker's decay hold after the note stops", () => {
    // 0.3 s heard in tune, then 1 s of the tracker still showing it with no fresh readings.
    const p = new Player().play(out(1, 'inTune'), 300).play(out(1, 'inTune'), holdMs, false);
    p.play(out(1, 'inTune'), FRAME_MS); // a new reading after a 1 s gap starts the second again
    expect(p.progress.count).toBe(0);
  });

  it('tolerates a missing reading or two mid-ring', () => {
    const p = new Player()
      .play(out(2, 'inTune'), 500)
      .play(out(2, 'inTune'), 3 * FRAME_MS, false) // 120 ms without a fresh reading
      .play(out(2, 'inTune'), 500);
    expect(p.finished).toEqual([2]);
  });

  it('starts the second again after a longer gap', () => {
    const p = new Player()
      .play(out(2, 'inTune'), 600)
      .play(out(2, 'inTune'), 400, false)
      .play(out(2, 'inTune'), 600);
    expect(p.progress.count).toBe(0);
  });

  it('starts the second again when the string drifts out of tune', () => {
    const p = new Player().play(out(3, 'inTune'), 700).play(out(3, 'sharp', 4), 80).play(out(3, 'inTune'), 700);
    expect(p.progress.count).toBe(0);
  });

  it('starts the second again on a different string', () => {
    const p = new Player().play(out(3, 'inTune'), 700).play(out(4, 'inTune'), 700);
    expect(p.progress.count).toBe(0);
  });

  it('reports each string once, and completion exactly once', () => {
    const p = new Player();
    for (let i = 0; i < 6; i++) p.play(out(i, 'inTune'), holdMs + FRAME_MS).play(out(null, 'idle'), 200);
    p.play(out(0, 'inTune'), 2 * holdMs); // tuning one again changes nothing
    expect(p.finished).toEqual([0, 1, 2, 3, 4, 5]);
    expect(p.updates.filter((u) => u.complete)).toHaveLength(1);
    expect(p.updates.find((u) => u.complete)?.finished).toBe(5);
    expect(p.progress.complete).toBe(true);
  });

  it('completes when the last string joins strings marked done', () => {
    const p = new Player();
    p.progress.markDone([0, 1, 2, 3, 4]);
    p.play(out(5, 'inTune'), holdMs + FRAME_MS);
    expect(p.updates.filter((u) => u.complete)).toHaveLength(1);
  });

  it('forgets everything on reset', () => {
    const p = new Player().play(out(0, 'inTune'), holdMs + FRAME_MS);
    p.progress.reset();
    expect(p.progress.count).toBe(0);
    p.play(out(0, 'inTune'), holdMs + FRAME_MS);
    expect(p.finished).toEqual([0, 0]);
  });
});

describe('TuningProgress with the real tracker', () => {
  /** Feed the tracker and progress together, the way the tuner does. */
  function run(steps: [ReturnType<typeof note>, number][]): TuningProgress {
    const progress = new TuningProgress();
    const feed = new Feed(new Tracker()).calibrate(-60);
    for (const [frame, count] of steps) {
      for (let i = 0; i < count; i++) {
        const [step] = feed.push(frame); // one at a time: inspect() describes the latest frame
        progress.update(step.out, feed.tracker.inspect().sinceLastReadingMs === 0, step.t);
      }
    }
    return progress;
  }

  it('counts a string ringing in tune for a second', () => {
    expect(run([[note(hz(A2, 1)), 30]]).done[1]).toBe(true);
  });

  it('does not count a short in-tune pluck followed by the hold', () => {
    const holdFrames = DEFAULT_TRACKER.holdMs / FRAME_MS;
    expect(run([[note(hz(A2, 1)), 10], [silence(), holdFrames + 5]]).count).toBe(0);
  });
});
