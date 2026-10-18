import { loadImage, createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { APPLE_TOUCH_ICON, ICONS, renderIcon } from '../build/icons';

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

describe.each([...ICONS, APPLE_TOUCH_ICON])('icon $file', (spec) => {
  it('is a PNG of the right size with Rosa on the ground colour', async () => {
    const png = await renderIcon(spec);
    const image = await loadImage(png);
    expect([image.width, image.height]).toEqual([spec.size, spec.size]);

    const canvas = createCanvas(spec.size, spec.size);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const at = (fx: number, fy: number) => {
      const d = ctx.getImageData(Math.round(fx * spec.size), Math.round(fy * spec.size), 1, 1).data;
      return hex(d[0], d[1], d[2]);
    };
    expect(at(0.02, 0.02)).toBe('#EEF2F5'); // ground
    expect(at(0.45, 0.42)).toBe('#D98CA0'); // Rosa's body
  });
});

it('keeps the maskable icon inside the safe zone (central 80% circle)', async () => {
  const spec = ICONS.find((i) => i.purpose === 'maskable')!;
  const image = await loadImage(await renderIcon(spec));
  const canvas = createCanvas(spec.size, spec.size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, spec.size, spec.size);
  const c = spec.size / 2;
  const r = 0.4 * spec.size;
  for (let y = 0; y < spec.size; y += 2) {
    for (let x = 0; x < spec.size; x += 2) {
      if ((x - c) ** 2 + (y - c) ** 2 <= r * r) continue;
      const i = (y * spec.size + x) * 4;
      // Outside the safe zone only the ground and the grey wire (with its
      // anti-aliased edges) may show: nothing with Rosa's colour in it.
      const rgb = [data[i], data[i + 1], data[i + 2]];
      // The wire (#4A5563) spreads 25 across channels; Rosa's palest colour (#F6D7DF) 31.
      expect(Math.max(...rgb) - Math.min(...rgb), `colour at ${x},${y}`).toBeLessThanOrEqual(26);
    }
  }
});
