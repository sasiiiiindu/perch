/**
 * The wire scene: six birds on a wire, one of them reacting to the string
 * being played, and its note name and cents underneath.
 *
 * Knows nothing about audio: the caller says which bird is active, how many
 * cents off it is and which way the tuner has decided it reads.
 */

import { signed } from '../format';
import { BirdActor, type ActorFrame } from './bird-actor';
import { COLORS, DIM_OPACITY, FLOCK, STRING_ORDER, drawBird } from './birds';
import { GUTTER, birdX, layout, type SceneLayout } from './layout';
import { PERSONALITY } from './personality';

export type Verdict = 'flat' | 'sharp' | 'inTune';

export interface SceneInput {
  /** String index of the active bird (0 = low E), or null when no note is held. */
  active: number | null;
  cents: number | null;
  /** The tracker's settled state; the bird and the text both follow it. */
  verdict: Verdict | null;
}

const LOOKS = STRING_ORDER.map((id) => FLOCK[id]);

/** Longest step the animation takes in one frame, so a stalled tab doesn't jump oddly. */
const MAX_DT = 0.1;

const TEXT_COLORS: Record<Verdict, string> = {
  flat: COLORS.flatText,
  sharp: COLORS.sharpText,
  inTune: COLORS.inTuneText,
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * poseFor() switches to "in tune" at exactly ±inTuneCents, but the tracker
 * holds its state a moment near that edge so it doesn't flicker. Nudge the
 * cents into the tracker's band so the bird never sings while the text says
 * flat (or the other way round).
 */
export function centsForPose(cents: number, verdict: Verdict, inTuneCents: number): number {
  if (verdict === 'inTune') return Math.max(-inTuneCents, Math.min(inTuneCents, cents));
  if (verdict === 'flat') return Math.min(cents, -inTuneCents - 0.01);
  return Math.max(cents, inTuneCents + 0.01);
}

/** The label under the active bird; measured once per change, not every frame. */
interface Label {
  note: string;
  cents: string;
  halfWidth: number;
}

export class Scene {
  private l: SceneLayout | null = null;
  private readonly actors = STRING_ORDER.map((id, i) => new BirdActor(LOOKS[i], PERSONALITY[id]));
  private readonly frames: ActorFrame[] = [];
  private lastTime: number | null = null;
  private label: Label | null = null;
  /** Set from prefers-reduced-motion. */
  reducedMotion = false;

  constructor(private readonly inTuneCents: number) {}

  /** Call on every size change (CSS px). Returns the new layout. */
  resize(width: number, height: number): SceneLayout {
    this.l = layout(width, height, LOOKS.map((look) => look.scale));
    this.label = null; // font sizes may have changed
    return this.l;
  }

  /** Draw one frame. `ctx` is already scaled so 1 unit = 1 CSS px. `time` in seconds. */
  draw(ctx: CanvasRenderingContext2D, input: SceneInput, time: number): void {
    const l = this.l;
    if (!l) return;
    const dt = this.lastTime === null ? MAX_DT : Math.min(MAX_DT, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    const { cents, verdict } = input;
    const active = cents === null || verdict === null ? null : input.active;

    this.actors.forEach((actor, i) => {
      const isActive = i === active;
      this.frames[i] = actor.update({
        active: isActive,
        poseCents: isActive ? centsForPose(cents!, verdict!, this.inTuneCents) : null,
        inTune: isActive && verdict === 'inTune',
        inTuneCents: this.inTuneCents,
        sharpCents: isActive && verdict === 'sharp' ? cents! : 0,
        zoom: isActive ? l.zoom[i] : 1,
        sceneIdle: active === null,
        reduced: this.reducedMotion,
      }, time, dt);
    });

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, l.width, l.height);

    ctx.strokeStyle = COLORS.wire;
    ctx.lineWidth = Math.max(2, l.size * 0.022);
    ctx.beginPath();
    ctx.moveTo(0, l.wireY);
    ctx.lineTo(l.width, l.wireY);
    ctx.stroke();

    // Dimmer birds first, so a bird fading in (and the active one, which may
    // have grown) sits on top. At most two birds are ever between dim and full.
    for (let i = 0; i < LOOKS.length; i++) if (i !== active && this.actors[i].opacity < 0.5) this.drawOne(ctx, i);
    for (let i = 0; i < LOOKS.length; i++) if (i !== active && this.actors[i].opacity >= 0.5) this.drawOne(ctx, i);
    if (active !== null) {
      this.drawOne(ctx, active);
      this.drawText(ctx, active, cents!, verdict!);
    }
  }

  private drawOne(ctx: CanvasRenderingContext2D, i: number): void {
    const l = this.l!;
    const look = LOOKS[i];
    const f = this.frames[i];
    const size = l.size * f.zoom;
    const unit = (size * look.scale) / 120; // design units → CSS px for this bird
    const x = birdX(l, i, look.scale, f.zoom) + f.dx * unit;
    drawBird(ctx, look, f.pose, x, l.wireY - f.lift * unit, size, f.opts);
  }

  private drawText(ctx: CanvasRenderingContext2D, i: number, cents: number, verdict: Verdict): void {
    const l = this.l!;
    const note = LOOKS[i].string;
    const centsText = `${signed(cents, 0)} ¢`;
    const noteFont = `600 ${l.noteFont}px ${FONT}`;
    const centsFont = `500 ${l.centsFont}px ${FONT}`;

    if (!this.label || this.label.note !== note || this.label.cents !== centsText) {
      ctx.font = noteFont;
      const noteWidth = ctx.measureText(note).width;
      ctx.font = centsFont;
      this.label = { note, cents: centsText, halfWidth: Math.max(noteWidth, ctx.measureText(centsText).width) / 2 };
    }

    // Centre under the bird, but keep the whole label on screen at the ends.
    const half = this.label.halfWidth;
    const birdAt = birdX(l, i, LOOKS[i].scale, this.frames[i].zoom);
    const x = Math.max(half + GUTTER, Math.min(l.width - half - GUTTER, birdAt));

    ctx.save();
    // The label fades in with its bird.
    ctx.globalAlpha = Math.max(0, (this.actors[i].opacity - DIM_OPACITY) / (1 - DIM_OPACITY));
    ctx.fillStyle = TEXT_COLORS[verdict];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = noteFont;
    ctx.fillText(note, x, l.textTop);
    ctx.font = centsFont;
    ctx.fillText(centsText, x, l.textTop + l.noteFont + 6);
    ctx.restore();
  }
}
