/**
 * One bird's live state: its sprung pose, brightness, size, and the one-shot
 * effects (hop, squash, blink, fidget, crest flick, floating note).
 */

import { DIM_OPACITY, mixPose, poseFor, type BirdLook, type BirdPose, type DrawOptions } from './birds';
import {
  NEVER, Scheduler, Smooth2, freshTriggers, lerp, offsets, twitchDegrees, type Rng, type Triggers,
} from './motion';
import { BLINK_SPREAD, FIDGET_SPREAD, TWITCH_EVERY, TWITCH_SPREAD, type Personality } from './personality';

/**
 * Spring time constants (s); ~4.7τ to land. Brighten in ~200 ms, fade back in
 * ~400 ms. Size uses the same gentle-start spring as the pose: on a phone Pip
 * grows to 4× and a plain ease would make her pop on the first frame.
 */
const BRIGHTEN_TAU = 0.045;
const DIM_TAU = 0.085;
const ZOOM_TAU = 0.06;
/** A note wobbling around ±3 ¢ shouldn't keep re-triggering the in-tune celebration. */
const ARRIVE_REFRACTORY_S = 1;

export interface ActorInput {
  active: boolean;
  /** Cents for poseFor (already nudged to agree with the tracker's state); null when resting. */
  poseCents: number | null;
  inTune: boolean;
  /** The tracker's in-tune window, so poseFor sings exactly when the label says in tune. */
  inTuneCents: number;
  sharpCents: number; // > 0 when sharp, else 0
  zoom: number; // target size multiplier
  sceneIdle: boolean; // no string is playing at all
  reduced: boolean;
}

export interface ActorFrame {
  pose: BirdPose;
  zoom: number;
  /** Design units, added to the wire point. */
  dx: number;
  lift: number;
  opts: DrawOptions;
}

export class BirdActor {
  private readonly rest: BirdPose;
  private readonly spring: Smooth2<BirdPose>;
  private readonly fade = new Smooth2(DIM_OPACITY, lerp, DIM_TAU);
  private readonly grow = new Smooth2(1, lerp, ZOOM_TAU);
  private tr: Triggers = freshTriggers();
  private wasActive = false;
  private wasInTune = false;
  private lastArrival = NEVER;
  private readonly blinks: Scheduler;
  private readonly fidgets: Scheduler | null;
  private readonly twitches: Scheduler;

  constructor(private readonly look: BirdLook, private readonly p: Personality, private readonly rng: Rng = Math.random) {
    this.rest = poseFor(look, null);
    this.spring = new Smooth2(this.rest, mixPose, p.springTau);
    this.blinks = new Scheduler(p.blinkEvery, BLINK_SPREAD, rng);
    this.fidgets = p.fidgetEvery === null ? null : new Scheduler(p.fidgetEvery, FIDGET_SPREAD, rng);
    this.twitches = new Scheduler(TWITCH_EVERY, TWITCH_SPREAD, rng);
  }

  get opacity(): number {
    return this.fade.value;
  }

  get zoom(): number {
    return this.grow.value;
  }

  update(input: ActorInput, now: number, dt: number): ActorFrame {
    const { active, inTune } = input;
    const tr = this.tr;

    if (active && !this.wasActive) tr.woke = now;
    if (active && inTune && !this.wasInTune && now - this.lastArrival >= ARRIVE_REFRACTORY_S) {
      tr.arrived = now;
      this.lastArrival = now;
    }
    if (!active) this.lastArrival = NEVER; // a fresh note may celebrate straight away
    this.wasActive = active;
    this.wasInTune = active && inTune;

    // Schedulers tick every frame so their rhythm continues; each fires only when allowed.
    if (this.blinks.due(now) && !active) tr.blink = now;
    if (this.fidgets?.due(now) && input.sceneIdle) {
      tr.fidget = now;
      tr.fidgetDir = this.rng() < 0.5 ? -1 : 1;
    }
    if (this.twitches.due(now) && this.p.crestTwitch && active && input.sharpCents > 0) {
      tr.twitch = now;
      tr.twitchDeg = twitchDegrees(input.sharpCents) * (this.rng() < 0.5 ? -1 : 1);
    }
    if (active) tr.blink = NEVER; // the active bird's eyes are part of the readout

    const target = input.poseCents === null ? this.rest : poseFor(this.look, input.poseCents, input.inTuneCents);
    const sprung = this.spring.step(target, dt);
    this.fade.tau = active ? BRIGHTEN_TAU : DIM_TAU;
    this.fade.step(active ? 1 : DIM_OPACITY, dt);
    this.grow.step(input.zoom, dt);

    const fx = offsets(tr, now, this.p, input.reduced);
    const pose: BirdPose = {
      ...sprung,
      sx: sprung.sx * (1 + 0.06 * fx.squash),
      sy: sprung.sy * (1 - 0.08 * fx.squash),
      tilt: sprung.tilt + fx.tilt,
      // A blink: lid fully down and the eye shrunk away leaves just the lid line.
      lid: sprung.lid + (1 - sprung.lid) * fx.blink,
      // Never negative: ctx.ellipse throws on a negative radius.
      eyeR: Math.max(0, sprung.eyeR * (1 - fx.blink)),
    };

    const opts: DrawOptions = { opacity: this.opacity };
    // Breathing and the sharp shake come from `time`; reduced motion leaves them out.
    if (!input.reduced) opts.time = now;
    if (fx.note) opts.note = fx.note;
    if (fx.crestDeg) opts.crestTilt = fx.crestDeg;
    return { pose, zoom: this.zoom, dx: fx.dx, lift: fx.lift, opts };
  }
}
