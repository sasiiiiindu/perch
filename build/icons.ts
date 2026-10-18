/**
 * App icons: Rosa (the G string) in tune, sitting on the wire, drawn by the
 * real drawBird so the icon can never drift from the birds in the app.
 *
 * Runs in Node at build time. @napi-rs/canvas (a dev dependency: prebuilt,
 * nothing ships to users) gives Node the Canvas 2D API. birds.ts builds
 * Path2D shapes as soon as it loads, so the global Path2D has to be in place
 * before it's imported, hence the dynamic import.
 */

import { Path2D, createCanvas } from '@napi-rs/canvas';

export interface IconSpec {
  file: string;
  size: number;
  purpose: 'any' | 'maskable';
}

export const ICONS: readonly IconSpec[] = [
  { file: 'icons/icon-192.png', size: 192, purpose: 'any' },
  { file: 'icons/icon-512.png', size: 512, purpose: 'any' },
  // Android crops maskable icons to a circle or squircle: keep Rosa inside the central 80%.
  { file: 'icons/icon-maskable-512.png', size: 512, purpose: 'maskable' },
];

/** iOS ignores the manifest icons and wants this one, full-bleed (it rounds the corners itself). */
export const APPLE_TOUCH_ICON: IconSpec = { file: 'icons/apple-touch-icon.png', size: 180, purpose: 'any' };

/**
 * Rosa's in-tune picture in design units (scale 0.77, anchored on the wire
 * point 60,100): beak tip x ≈ 28, tail tip ≈ 101, music note top y ≈ 37,
 * wire glow bottom ≈ 105.
 */
const ROSA_BOX = { left: 27.7, right: 100.8, top: 36.9, bottom: 105 };
/** Share of the icon Rosa's picture fills. */
const FILL = { any: 0.78, maskable: 0.58 };

export async function renderIcon(spec: IconSpec): Promise<Uint8Array> {
  (globalThis as { Path2D?: unknown }).Path2D ??= Path2D;
  const { COLORS, FLOCK, drawBird, poseFor } = await import('../src/scene/birds.ts');

  const canvas = createCanvas(spec.size, spec.size);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  const s = spec.size;
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, s, s);

  const boxWidth = ROSA_BOX.right - ROSA_BOX.left;
  const boxHeight = ROSA_BOX.bottom - ROSA_BOX.top;
  const unit = (FILL[spec.purpose] * s) / Math.max(boxWidth, boxHeight); // px per design unit
  // Wire point that centres the picture.
  const x = s / 2 - ((ROSA_BOX.left + ROSA_BOX.right) / 2 - 60) * unit;
  const y = s / 2 + (100 - (ROSA_BOX.top + ROSA_BOX.bottom) / 2) * unit;

  ctx.strokeStyle = COLORS.wire;
  ctx.lineWidth = Math.max(2, unit * 2.6);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(s, y);
  ctx.stroke();

  const rosa = FLOCK.rosa;
  drawBird(ctx, rosa, poseFor(rosa, 0), x, y, unit * 120);
  return new Uint8Array(await canvas.encode('png'));
}
