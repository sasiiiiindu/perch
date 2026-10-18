/**
 * Where everything sits on screen, in CSS px. Pure numbers, no drawing, so it
 * can be tested without a canvas. (It deliberately doesn't import birds.ts:
 * that file builds Path2D objects on load, which Node doesn't have.)
 *
 * Birds are drawn in a 120×120 design box with the wire point at (60, 100)
 * (see birds.ts). The extents below are measured from that point in design
 * units, with room for the sharpest pose (body 12% wider) and the tremble lines.
 */

const BOX = 120;
/** Beak tip at x = 18 → 42 units left of the wire point; 52 with the widest pose and tremble lines. */
const LEFT = 52 / BOX;
/** Long tail ends at x = 118 → 58 right; 66 with the widest pose. */
const RIGHT = 66 / BOX;
/** Beak tip to tail tip, the bird's width at rest. */
const WIDTH = 100 / BOX;
/** Top of the music note (y = 18) above the wire (y = 100). */
const TOP = 82 / BOX;

/** Side margin, matching the 16 px page gutter. */
export const GUTTER = 16;
/** The active bird is drawn at least this wide (CSS px), so its pose reads at arm's length. */
export const MIN_ACTIVE_WIDTH = 150;
const VERTICAL_MARGIN = 24;
/** Kept clear at the bottom for the Reset / Mute buttons (44 px tall, 16 px off the edge). */
export const CONTROLS_RESERVE = 72;
/** Never draw the birds bigger than this, even on a huge window. */
const MAX_SIZE = 280;
/** Neighbouring birds may overlap a little (tail behind the next beak). */
const SLOT_FILL = 1.15;

export interface SceneLayout {
  width: number;
  height: number;
  wireY: number;
  /** Design-box size in CSS px for a scale-1 bird at rest. */
  size: number;
  /** Wire point of each bird at rest, low E first. */
  slots: number[];
  /** How much each bird grows when it is the active one (≥ 1). */
  zoom: number[];
  /** Top of the text block under the wire (note name, cents, hints). */
  textTop: number;
  noteFont: number;
  centsFont: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** @param scales  each bird's look.scale, low E first */
export function layout(width: number, height: number, scales: readonly number[]): SceneLayout {
  const noteFont = Math.round(clamp(Math.min(width, height) * 0.08, 24, 44));
  const centsFont = Math.max(15, Math.round(noteFont * 0.5));
  const textBlock = 16 + noteFont + 6 + centsFont;

  const slotWidth = (width - 2 * GUTTER) / scales.length;
  const sizeForHeight = (height - VERTICAL_MARGIN - CONTROLS_RESERVE - textBlock) / TOP;
  const size = Math.max(1, Math.min(slotWidth * SLOT_FILL, sizeForHeight, MAX_SIZE));

  const slots = scales.map((_, i) => GUTTER + slotWidth * (i + 0.5));
  const zoom = scales.map((s) => Math.max(1, MIN_ACTIVE_WIDTH / (WIDTH * s * size)));

  // Centre the tallest possible picture (any bird active, zoomed) plus the
  // text, so the wire never moves when a different string is played. On a
  // short screen, lift it clear of the buttons, but never off the top.
  const above = Math.max(...scales.map((s, i) => TOP * s * size * zoom[i]));
  const centred = Math.max(VERTICAL_MARGIN, (height - above - textBlock) / 2) + above;
  const wireY = Math.round(Math.max(above, Math.min(centred, height - CONTROLS_RESERVE - textBlock)));

  return { width, height, wireY, size, slots, zoom, textTop: wireY + 16, noteFont, centsFont };
}

/**
 * Wire point for bird `i` drawn at `zoom`: its slot, pushed inwards just
 * enough that a grown bird at either end stays inside the gutters.
 */
export function birdX(l: SceneLayout, i: number, scale: number, zoom: number): number {
  const px = scale * l.size * zoom;
  const lo = GUTTER + LEFT * px;
  const hi = l.width - GUTTER - RIGHT * px;
  return lo > hi ? l.width / 2 : clamp(l.slots[i], lo, hi);
}

/** Horizontal extent of bird `i` at `zoom` (CSS px), for tests and hit checks. */
export function birdBounds(l: SceneLayout, i: number, scale: number, zoom: number) {
  const px = scale * l.size * zoom;
  const x = birdX(l, i, scale, zoom);
  return { left: x - LEFT * px, right: x + RIGHT * px, top: l.wireY - TOP * px, width: WIDTH * px };
}
