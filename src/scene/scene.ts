/**
 * The wire scene: six birds on a wire, one of them reacting to the string
 * being played, and its note name and cents underneath.
 *
 * Knows nothing about audio: the caller says which bird is active, how many
 * cents off it is and which way the tuner has decided it reads.
 */

import { signed } from '../format';
import { COLORS, FLOCK, STRING_ORDER, drawBird, mixPose, poseFor, type BirdPose } from './birds';
import { GUTTER, birdX, layout, type SceneLayout } from './layout';

export type Verdict = 'flat' | 'sharp' | 'inTune';

export interface SceneInput {
  /** String index of the active bird (0 = low E), or null when no note is held. */
  active: number | null;
  cents: number | null;
  /** The tracker's settled state; the bird and the text both follow it. */
  verdict: Verdict | null;
}

const LOOKS = STRING_ORDER.map((id) => FLOCK[id]);
const REST_POSES = LOOKS.map((look) => poseFor(look, null));

/** Time constants (s) for easing toward the target pose and size. */
const POSE_TAU = 0.08;
const ZOOM_TAU = 0.15;
/** Longest step the easing takes in one frame, so a stalled tab doesn't jump oddly. */
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

export class Scene {
  private l: SceneLayout | null = null;
  private poses: BirdPose[] = [...REST_POSES];
  private zooms: number[] = LOOKS.map(() => 1);
  private lastTime: number | null = null;

  constructor(private readonly inTuneCents: number) {}

  /** Call on every size change (CSS px). Returns the new layout. */
  resize(width: number, height: number): SceneLayout {
    this.l = layout(width, height, LOOKS.map((look) => look.scale));
    return this.l;
  }

  /** Draw one frame. `ctx` is already scaled so 1 unit = 1 CSS px. `time` in seconds. */
  draw(ctx: CanvasRenderingContext2D, input: SceneInput, time: number): void {
    const l = this.l;
    if (!l) return;
    const dt = this.lastTime === null ? MAX_DT : Math.min(MAX_DT, Math.max(0, time - this.lastTime));
    this.lastTime = time;

    const active = input.cents === null || input.verdict === null ? null : input.active;
    this.ease(active, input, dt);

    ctx.fillStyle = COLORS.ground;
    ctx.fillRect(0, 0, l.width, l.height);

    ctx.strokeStyle = COLORS.wire;
    ctx.lineWidth = Math.max(2, l.size * 0.022);
    ctx.beginPath();
    ctx.moveTo(0, l.wireY);
    ctx.lineTo(l.width, l.wireY);
    ctx.stroke();

    // Resting birds first, so the active one (which may have grown) sits on top.
    LOOKS.forEach((_, i) => { if (i !== active) this.drawOne(ctx, i, true, time); });
    if (active !== null) {
      this.drawOne(ctx, active, false, time);
      this.drawText(ctx, active, input.cents!, input.verdict!);
    }
  }

  private ease(active: number | null, input: SceneInput, dt: number): void {
    const poseT = 1 - Math.exp(-dt / POSE_TAU);
    const zoomT = 1 - Math.exp(-dt / ZOOM_TAU);
    LOOKS.forEach((look, i) => {
      const target = i === active
        ? poseFor(look, centsForPose(input.cents!, input.verdict!, this.inTuneCents), this.inTuneCents)
        : REST_POSES[i];
      this.poses[i] = mixPose(this.poses[i], target, poseT);
      const zoomTarget = i === active ? this.l!.zoom[i] : 1;
      this.zooms[i] += (zoomTarget - this.zooms[i]) * zoomT;
    });
  }

  private drawOne(ctx: CanvasRenderingContext2D, i: number, dim: boolean, time: number): void {
    const l = this.l!;
    const look = LOOKS[i];
    const zoom = this.zooms[i];
    drawBird(ctx, look, this.poses[i], birdX(l, i, look.scale, zoom), l.wireY, l.size * zoom, { dim, time });
  }

  private drawText(ctx: CanvasRenderingContext2D, i: number, cents: number, verdict: Verdict): void {
    const l = this.l!;
    const note = LOOKS[i].string;
    const centsText = `${signed(cents, 0)} ¢`;

    ctx.save();
    ctx.fillStyle = TEXT_COLORS[verdict];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const noteFont = `600 ${l.noteFont}px ${FONT}`;
    const centsFont = `500 ${l.centsFont}px ${FONT}`;

    // Centre under the bird, but keep the whole label on screen at the ends.
    ctx.font = noteFont;
    const half = Math.max(ctx.measureText(note).width, measure(ctx, centsFont, centsText)) / 2;
    const x = Math.max(half + GUTTER, Math.min(l.width - half - GUTTER, birdX(l, i, LOOKS[i].scale, this.zooms[i])));

    ctx.fillText(note, x, l.textTop);
    ctx.font = centsFont;
    ctx.fillText(centsText, x, l.textTop + l.noteFont + 6);
    ctx.restore();
  }
}

function measure(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const previous = ctx.font;
  ctx.font = font;
  const width = ctx.measureText(text).width;
  ctx.font = previous;
  return width;
}
