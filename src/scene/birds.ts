// Perch birds — drawn in code.
// Port of the "Perch Birds" design canvas (Claude Design).
//
// Every bird is drawn in a 120×120 design box, facing left, with the wire at y = 100.
// The pitch drives the pose directly: the flatter, the lower and sleepier the bird;
// the sharper, the bigger, wider-eyed and more ruffled. Within ±3 cents it sings.

export type BirdId = 'bruno' | 'sage' | 'clementine' | 'rosa' | 'skye' | 'pip';

export interface BirdLook {
  name: string;
  string: string; // e.g. "E2"
  hz: number; // open-string frequency at A4 = 440
  main: string; // body
  light: string; // belly
  dark: string; // wing, tail, tuft/crest, ruffles
  beak: string;
  scale: number; // size relative to the low E bird
  tuft: boolean; // small curl on the head
  crest: boolean; // spiky crest
  tail: 'short' | 'long';
  blush: number; // 0–1 cheek blush at rest
  baseLid: number; // 0–1 how sleepy the eyes are at rest (personality)
  eye: number; // eye radius in design units
}

/** Low E (left) to high E (right). */
export const STRING_ORDER: BirdId[] = ['bruno', 'sage', 'clementine', 'rosa', 'skye', 'pip'];

export const FLOCK: Record<BirdId, BirdLook> = {
  bruno: { name: 'Bruno', string: 'E2', hz: 82.41, main: '#4B5A8C', light: '#B3BDDD', dark: '#35406B', beak: '#E9A23B', scale: 1, tuft: false, crest: false, tail: 'short', blush: 0, baseLid: 0.45, eye: 4.2 },
  sage: { name: 'Sage', string: 'A2', hz: 110.0, main: '#7AA387', light: '#D2E3D3', dark: '#557E64', beak: '#E9A23B', scale: 0.92, tuft: false, crest: false, tail: 'long', blush: 0, baseLid: 0.15, eye: 4.2 },
  clementine: { name: 'Clementine', string: 'D3', hz: 146.83, main: '#EA8A4B', light: '#F9D6BA', dark: '#C2642B', beak: '#7A4A2A', scale: 0.84, tuft: true, crest: false, tail: 'short', blush: 0.55, baseLid: 0, eye: 4.2 },
  rosa: { name: 'Rosa', string: 'G3', hz: 196.0, main: '#D98CA0', light: '#F6D7DF', dark: '#B4687E', beak: '#E9A23B', scale: 0.77, tuft: false, crest: false, tail: 'short', blush: 0.8, baseLid: 0, eye: 4.4 },
  skye: { name: 'Skye', string: 'B3', hz: 246.94, main: '#5AA2CF', light: '#D0E8F5', dark: '#3A7DAB', beak: '#E9A23B', scale: 0.7, tuft: false, crest: true, tail: 'long', blush: 0, baseLid: 0, eye: 4.2 },
  pip: { name: 'Pip', string: 'E4', hz: 329.63, main: '#EEC24D', light: '#FCEDBB', dark: '#C49624', beak: '#7A4A2A', scale: 0.62, tuft: true, crest: false, tail: 'short', blush: 0.55, baseLid: 0, eye: 4.9 },
};

export const COLORS = {
  ground: '#EEF2F5',
  wire: '#4A5563',
  text: '#1E2530',
  muted: '#5C6672',
  feet: '#6B5545',
  eye: '#22252B',
  blush: '#F08F9A',
  // Graphics (glow, music note, tremble lines)
  flat: '#4C7BD9',
  sharp: '#E07A2E',
  inTune: '#2F9E78',
  // Text versions with 4.5:1 contrast on the ground colour
  flatText: '#3563C2',
  sharpText: '#B85A14',
  inTuneText: '#217A5C',
};

/** Everything that changes with pitch. Interpolate between two poses to animate. */
export interface BirdPose {
  sx: number; // body width scale
  sy: number; // body height scale
  tilt: number; // degrees; negative = beak down
  wingRot: number; // degrees
  eyeR: number;
  lid: number; // 0–1 sleepy eyelid
  ring: number; // 0–1 wide-eyed white ring
  ruffle: number; // 0–1 ruffled feathers
  jitter: number; // 0–1 tremble lines
  happy: number; // 0–1 closed happy eyes + open singing beak + note + glow
  blush: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/**
 * The pose for a bird at a given offset.
 * @param cents  offset from the target string; null = no note (resting)
 * @param inTuneCents  the "in tune" window, ± cents
 */
export function poseFor(look: BirdLook, cents: number | null, inTuneCents = 3): BirdPose {
  if (cents === null) {
    return { sx: 1, sy: 1, tilt: 0, wingRot: -18, eyeR: look.eye, lid: look.baseLid, ring: 0, ruffle: 0, jitter: 0, happy: 0, blush: look.blush };
  }
  const c = Math.max(-50, Math.min(50, cents));
  const f = clamp01(-c / 40); // flatness
  const s = clamp01(c / 40); // sharpness
  const tuned = Math.abs(c) <= inTuneCents;
  return {
    sx: 1 + 0.05 * f + 0.12 * s,
    sy: 1 - 0.16 * f + 0.07 * s,
    tilt: -11 * f + 5 * s,
    wingRot: -18 + 16 * f - 14 * s,
    eyeR: look.eye + 1.5 * s,
    lid: tuned ? 0 : clamp01(Math.max(look.baseLid * (1 - clamp01(s * 3)), f * 1.6)),
    ring: tuned ? 0 : clamp01(s * 1.6),
    ruffle: clamp01((s - 0.15) * 1.6),
    jitter: clamp01((s - 0.35) * 1.8),
    happy: tuned ? 1 : 0,
    blush: tuned ? Math.max(look.blush, 0.5) : look.blush,
  };
}

/** Linear blend between two poses, t in 0–1. Use it with easing for smooth transitions. */
export function mixPose(a: BirdPose, b: BirdPose, t: number): BirdPose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    sx: m(a.sx, b.sx), sy: m(a.sy, b.sy), tilt: m(a.tilt, b.tilt), wingRot: m(a.wingRot, b.wingRot),
    eyeR: m(a.eyeR, b.eyeR), lid: m(a.lid, b.lid), ring: m(a.ring, b.ring), ruffle: m(a.ruffle, b.ruffle),
    jitter: m(a.jitter, b.jitter), happy: m(a.happy, b.happy), blush: m(a.blush, b.blush),
  };
}

// Shapes in design units (SVG path data, so they match the design canvas exactly)
const P = {
  feet: new Path2D('M54 92 L52 100 M66 92 L68 100'),
  tailShort: new Path2D('M86 76 Q108 78 113 68 Q106 88 87 90 Z'),
  tailLong: new Path2D('M86 80 Q112 86 118 101 Q100 97 85 91 Z'),
  tuft: new Path2D('M47 42 Q43 29 53 30 Q47 34 52 41 Z'),
  crest: new Path2D('M45 43 L42 32 L49 40 L50 29 L55 40 L58 33 L59 42 Z'),
  ruffle: new Path2D('M35 46 L30 41 M50 38 L49 31 M68 40 L71 33 M84 49 L90 45 M91 64 L97 63'),
  lid: new Path2D('M38.6 57.4 A5.4 5.4 0 0 1 49.4 57.4 Z'),
  lidLine: new Path2D('M38.6 57.4 L49.4 57.4'),
  happyEye: new Path2D('M40 58.5 Q44 53.5 48 58.5'),
  beakShut: new Path2D('M31 58 L19 62.5 L31 67 Z'),
  beakOpen: new Path2D('M31 57.5 L18 58.5 L31 62.5 Z M31 64 L20 69 L31 68 Z'),
  tremble: new Path2D('M12 70 Q8 75 12 80 M108 52 Q112 57 108 62'),
  noteStem: new Path2D('M25.6 33 L25.6 18 Q30 20 31 25'),
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Opacity of an inactive bird. */
export const DIM_OPACITY = 0.38;

export interface DrawOptions {
  dim?: boolean; // inactive birds sit back at 38% opacity
  opacity?: number; // 0–1; overrides dim, so a bird can fade between dim and full
  time?: number; // seconds; adds breathing and tremble when given
  note?: { rise: number; alpha: number }; // overrides the music note: lift in design units, alpha 0–1
  crestTilt?: number; // degrees; the crest pivots on its base
}

/**
 * Draw one bird.
 * @param x, y   the point on the wire under the bird (wire y in canvas px)
 * @param size   size of the 120×120 design box in canvas px (all birds share it; look.scale sizes each bird)
 */
export function drawBird(ctx: CanvasRenderingContext2D, look: BirdLook, pose: BirdPose, x: number, y: number, size: number, opts: DrawOptions = {}): void {
  const t = opts.time;
  const breathe = t === undefined ? 0 : Math.sin(t * 2.2) * 0.012;
  const shake = t === undefined ? 0 : Math.sin(t * 55) * 0.9 * pose.jitter;

  ctx.save();
  ctx.globalAlpha = opts.opacity ?? (opts.dim ? DIM_OPACITY : 1);
  const base = ctx.globalAlpha;
  const alpha = (a: number) => { ctx.globalAlpha = base * a; };

  // Design box → canvas, with the wire point (60, 100) at (x, y)
  ctx.translate(x, y);
  ctx.scale(size / 120, size / 120);
  ctx.translate(-60 + shake, -100);

  // Per-bird size, anchored on the wire
  ctx.translate(60, 100);
  ctx.scale(look.scale, look.scale);
  ctx.translate(-60, -100);

  const fill = (color: string, a = 1) => { alpha(a); ctx.fillStyle = color; };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  const stroke = (path: Path2D, color: string, width: number, a = 1) => {
    if (a <= 0.001) return;
    alpha(a);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  };

  // Glow on the wire when in tune
  if (pose.happy > 0.001) { fill(COLORS.inTune, 0.28 * pose.happy); ellipse(60, 100, 38, 5); }

  // Feet stay on the wire
  stroke(P.feet, COLORS.feet, 2.6);

  // Body group: pivots on the feet
  ctx.save();
  ctx.translate(60, 98);
  ctx.rotate(rad(pose.tilt));
  ctx.scale(pose.sx, pose.sy * (1 + breathe));
  ctx.translate(-60, -98);

  fill(look.dark);
  ctx.fill(look.tail === 'short' ? P.tailShort : P.tailLong);
  fill(look.main); ellipse(60, 68, 32, 28);
  fill(look.light); ellipse(53, 77, 20, 15);
  fill(look.dark); ellipse(73, 70, 15, 10.5, rad(pose.wingRot));
  if (look.tuft) { fill(look.dark); ctx.fill(P.tuft); }
  if (look.crest) {
    fill(look.dark);
    ctx.save();
    if (opts.crestTilt) { ctx.translate(52, 42); ctx.rotate(rad(opts.crestTilt)); ctx.translate(-52, -42); }
    ctx.fill(P.crest);
    ctx.restore();
  }
  stroke(P.ruffle, look.dark, 2.4, pose.ruffle);
  if (pose.blush > 0.001) { fill(COLORS.blush, pose.blush); ellipse(39, 66, 4.6, 2.6); }

  // Eyes
  if (pose.ring > 0.001) { fill('#FFFFFF', pose.ring * (1 - pose.happy)); ellipse(44, 57, pose.eyeR + 1.8, pose.eyeR + 1.8); }
  const open = 1 - pose.happy;
  if (open > 0.001) {
    fill(COLORS.eye, open); ellipse(44, 57, pose.eyeR, pose.eyeR);
    fill('#FFFFFF', open); ellipse(45.4, 55.5, 1.4, 1.4);
    if (pose.lid > 0.001) {
      fill(look.main, pose.lid * open); ctx.fill(P.lid);
      stroke(P.lidLine, COLORS.eye, 1.5, pose.lid * open);
    }
  }
  stroke(P.happyEye, COLORS.eye, 2.2, pose.happy);

  // Beak
  if (open > 0.001) { fill(look.beak, open); ctx.fill(P.beakShut); stroke(P.beakShut, look.beak, 1.5, open); }
  if (pose.happy > 0.001) { fill(look.beak, pose.happy); ctx.fill(P.beakOpen); stroke(P.beakOpen, look.beak, 1.5, pose.happy); }
  ctx.restore();

  // Tremble lines when very sharp
  stroke(P.tremble, COLORS.sharp, 2.2, pose.jitter);

  // Music note when in tune
  const note = opts.note ?? { rise: 0, alpha: pose.happy };
  if (note.alpha > 0.001) {
    ctx.save();
    ctx.translate(0, -note.rise);
    fill(COLORS.inTune, note.alpha); ellipse(22, 34, 4.2, 3.2, rad(-20));
    stroke(P.noteStem, COLORS.inTune, 2, note.alpha);
    ctx.restore();
  }

  ctx.restore();
}
