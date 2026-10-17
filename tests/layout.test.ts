import { beforeAll, describe, expect, it } from 'vitest';
import { STANDARD_TUNING } from '../src/audio/notes';
import { GUTTER, MIN_ACTIVE_WIDTH, birdBounds, birdX, layout } from '../src/scene/layout';

// Bird scales from FLOCK in birds.ts, low E first (checked against the real
// file below, so the two can't drift apart).
const SCALES = [1, 0.92, 0.84, 0.77, 0.7, 0.62];

const VIEWPORTS = {
  'small phone, portrait': [320, 568],
  'phone, portrait': [390, 844],
  'phone, landscape': [844, 390],
  'phone, landscape minus notch': [750, 390],
  'tablet, portrait': [820, 1180],
  'Mac window': [1280, 800],
  'small Mac window': [600, 400],
  'huge display': [2560, 1440],
} as const;

describe('birds.ts', () => {
  let birds: typeof import('../src/scene/birds');

  beforeAll(async () => {
    // birds.ts builds Path2D shapes on load; Node has no Path2D, and these
    // tests only read the data, so a stand-in class is enough.
    (globalThis as { Path2D?: unknown }).Path2D ??= class {};
    birds = await import('../src/scene/birds');
  });

  it('puts the birds in tuner string order, low E on the left', () => {
    const names = birds.STRING_ORDER.map((id) => birds.FLOCK[id].string);
    expect(names).toEqual(STANDARD_TUNING.map((s) => s.name));
  });

  it('matches the scales the layout tests use', () => {
    expect(birds.STRING_ORDER.map((id) => birds.FLOCK[id].scale)).toEqual(SCALES);
  });
});

describe.each(Object.entries(VIEWPORTS))('layout: %s', (_, [width, height]) => {
  const l = layout(width, height, SCALES);

  it('keeps the birds in order, low E on the left', () => {
    for (let i = 1; i < SCALES.length; i++) expect(l.slots[i]).toBeGreaterThan(l.slots[i - 1]);
  });

  it('keeps every bird on screen, at rest and when active', () => {
    SCALES.forEach((scale, i) => {
      for (const zoom of [1, l.zoom[i]]) {
        const b = birdBounds(l, i, scale, zoom);
        expect(b.left).toBeGreaterThanOrEqual(GUTTER - 1e-9);
        expect(b.right).toBeLessThanOrEqual(width - GUTTER + 1e-9);
        expect(b.top).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('draws the active bird at least the readable width', () => {
    SCALES.forEach((scale, i) => {
      expect(birdBounds(l, i, scale, l.zoom[i]).width).toBeGreaterThanOrEqual(MIN_ACTIVE_WIDTH - 1e-9);
    });
  });

  it('only grows birds that need it', () => {
    SCALES.forEach((scale, i) => {
      if (birdBounds(l, i, scale, 1).width >= MIN_ACTIVE_WIDTH) expect(l.zoom[i]).toBe(1);
    });
  });

  it('leaves room for the note name and cents under the wire', () => {
    const textBottom = l.textTop + l.noteFont + 6 + l.centsFont;
    expect(textBottom).toBeLessThanOrEqual(height);
    expect(l.noteFont).toBeGreaterThanOrEqual(24);
  });

  it('leaves resting birds where they sit', () => {
    SCALES.forEach((scale, i) => expect(birdX(l, i, scale, 1)).toBeCloseTo(l.slots[i], 9));
  });
});
