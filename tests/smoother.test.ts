import { describe, expect, it } from 'vitest';
import { CentsSmoother, median } from '../src/audio/smoother';

describe('median', () => {
  it('handles odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('CentsSmoother', () => {
  it('starts at the first reading', () => {
    const s = new CentsSmoother();
    expect(s.value).toBeNull();
    expect(s.push(7, 1, 40)).toBe(7);
  });

  it('drops a single outlier via the median', () => {
    const s = new CentsSmoother();
    for (let i = 0; i < 5; i++) s.push(0, 1, 40);
    expect(s.push(15, 1, 40)).toBe(0);
  });

  it('ignores weight-0 readings entirely', () => {
    const s = new CentsSmoother();
    s.push(0, 1, 40);
    for (let i = 0; i < 10; i++) s.push(10, 0, 40);
    expect(s.value).toBe(0);
  });

  it('moves more slowly for low weights', () => {
    const fast = new CentsSmoother();
    const slow = new CentsSmoother();
    for (const s of [fast, slow]) s.push(0, 1, 40);
    for (let i = 0; i < 5; i++) {
      fast.push(10, 1, 40);
      slow.push(10, 0.2, 40);
    }
    expect(fast.value!).toBeGreaterThan(slow.value!);
    expect(slow.value!).toBeGreaterThan(0);
  });

  it('uses a time constant, so the frame rate does not change the speed', () => {
    const opts = { medianSize: 1, slowTimeConstantMs: 150, fastTimeConstantMs: 150 };
    const a = new CentsSmoother(opts);
    const b = new CentsSmoother(opts);
    a.push(0, 1, 0);
    b.push(0, 1, 0);
    for (let i = 0; i < 10; i++) a.push(10, 1, 40); // 400 ms at 25/s
    for (let i = 0; i < 20; i++) b.push(10, 1, 20); // 400 ms at 50/s
    expect(a.value!).toBeCloseTo(b.value!, 9);
  });

  it('drops one or two far-off readings, but jumps after three that agree', () => {
    const s = new CentsSmoother();
    for (let i = 0; i < 5; i++) s.push(0, 1, 40);
    s.push(30, 1, 40);
    s.push(30, 1, 40);
    expect(s.value).toBe(0);
    s.push(30, 1, 40);
    expect(s.value).toBe(30);
  });

  it('does not treat scattered outliers as a change', () => {
    const s = new CentsSmoother();
    for (let i = 0; i < 5; i++) s.push(0, 1, 40);
    for (const c of [25, -25, 30, 0, 28, -30]) s.push(c, 1, 40);
    expect(Math.abs(s.value!)).toBeLessThan(0.5);
  });
});

describe('CentsSmoother adaptive speed', () => {
  it('averages small jitter slowly but catches up quickly with a real change', () => {
    const steps = (target: number) => {
      const s = new CentsSmoother({ medianSize: 1 });
      s.push(0, 1, 0);
      for (let i = 0; i < 30; i++) s.push(0, 1, 40); // past the warm-up
      for (let i = 0; i < 3; i++) s.push(target, 1, 40);
      return s.value! / target; // fraction of the way there after 120 ms
    };
    expect(steps(1)).toBeLessThan(0.35);
    expect(steps(12)).toBeGreaterThan(0.6);
  });
});

describe('CentsSmoother warm-up', () => {
  it('follows a fresh note quickly, then settles down', () => {
    const fresh = new CentsSmoother({ medianSize: 1 });
    const settled = new CentsSmoother({ medianSize: 1 });
    fresh.push(0, 1, 0);
    settled.push(0, 1, 0);
    for (let i = 0; i < 30; i++) settled.push(0, 1, 40);
    for (let i = 0; i < 3; i++) {
      fresh.push(2, 1, 40);
      settled.push(2, 1, 40);
    }
    expect(fresh.value!).toBeGreaterThan(1.5 * settled.value!);
  });
});
