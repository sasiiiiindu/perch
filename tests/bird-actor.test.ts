import { beforeAll, describe, expect, it } from 'vitest';
import type { ActorInput, BirdActor as BirdActorType } from '../src/scene/bird-actor';
import { PERSONALITY } from '../src/scene/personality';

let BirdActor: typeof BirdActorType;
let look: import('../src/scene/birds').BirdLook;

beforeAll(async () => {
  // birds.ts builds Path2D shapes on load; Node has none, and nothing is drawn here.
  (globalThis as { Path2D?: unknown }).Path2D ??= class {};
  ({ BirdActor } = await import('../src/scene/bird-actor'));
  look = (await import('../src/scene/birds')).FLOCK.pip;
});

const input = (over: Partial<ActorInput>): ActorInput => ({
  active: false, poseCents: null, inTune: false, inTuneCents: 3, sharpCents: 0,
  zoom: 1, sceneIdle: true, done: false, reduced: false, ...over,
});

describe('BirdActor with reduced motion', () => {
  it('is at its reading size at once instead of growing', () => {
    const actor = new BirdActor(look, PERSONALITY.pip, () => 0.5);
    const frame = actor.update(input({ active: true, poseCents: -20, zoom: 3, sceneIdle: false, reduced: true }), 0, 1 / 60);
    expect(frame.zoom).toBe(3);
  });

  it('grows gradually without it', () => {
    const actor = new BirdActor(look, PERSONALITY.pip, () => 0.5);
    const frame = actor.update(input({ active: true, poseCents: -20, zoom: 3, sceneIdle: false }), 0, 1 / 60);
    expect(frame.zoom).toBeGreaterThan(1);
    expect(frame.zoom).toBeLessThan(2);
  });

  it('settles poses a little more slowly', () => {
    const move = (reduced: boolean) => {
      const actor = new BirdActor(look, PERSONALITY.pip, () => 0.5);
      return actor.update(input({ active: true, poseCents: -40, zoom: 1, sceneIdle: false, reduced }), 0, 0.05).pose.tilt;
    };
    expect(Math.abs(move(true))).toBeGreaterThan(0);
    expect(Math.abs(move(true))).toBeLessThan(Math.abs(move(false)));
  });

  it('adds no hop, squash or wobble when a bird wakes or sings', () => {
    const actor = new BirdActor(look, PERSONALITY.pip, () => 0.5);
    for (let t = 0; t < 1; t += 1 / 60) {
      const f = actor.update(input({ active: true, poseCents: 0, inTune: true, sceneIdle: false, reduced: true }), t, 1 / 60);
      expect(f.lift).toBe(0);
      expect(f.dx).toBe(0);
      expect(f.opts.time).toBeUndefined(); // no breathing or shake
    }
  });
});

describe('BirdActor: tuned birds', () => {
  it('rest in a prouder pose: head up, never puffed up like sharp', () => {
    const rest = new BirdActor(look, PERSONALITY.pip, () => 0.5);
    const proud = new BirdActor(look, PERSONALITY.pip, () => 0.5);
    let a = rest.update(input({}), 0, 0.016);
    let b = proud.update(input({ done: true }), 0, 0.016);
    for (let t = 0.016; t < 2; t += 0.016) {
      a = rest.update(input({}), t, 0.016);
      b = proud.update(input({ done: true }), t, 0.016);
    }
    expect(b.pose.tilt).toBeGreaterThan(a.pose.tilt + 4);
    expect(b.pose.sx * b.pose.sy).toBeLessThanOrEqual(a.pose.sx * a.pose.sy * 1.02);
    expect(b.pose.ring).toBe(0);
    expect(b.pose.ruffle).toBe(0);
  });
});
