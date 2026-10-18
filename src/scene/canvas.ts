/**
 * Keeps a canvas sharp: its backing store always matches the physical pixels
 * it covers. Moving a Mac window to a display with a different pixel ratio
 * changes devicePixelRatio without changing the CSS size, so a resize
 * listener alone would leave the canvas blurry; a resolution media query
 * catches that case.
 */

export interface CanvasSize {
  /** CSS px. */
  width: number;
  height: number;
  /** Backing pixels per CSS px, for ctx.setTransform. */
  scaleX: number;
  scaleY: number;
}

/**
 * Never render more than 2 backing pixels per CSS px. Most phones are 3×:
 * capping saves 56% of the pixels drawn every frame, and at that density
 * the difference is very hard to see.
 */
const MAX_RATIO = 2;

/** Calls `onResize` now and on every size or pixel-ratio change. Returns a cleanup function. */
export function fitCanvas(canvas: HTMLCanvasElement, onResize: (size: CanvasSize) => void): () => void {
  // Exact device pixels where the browser reports them (Chrome, Firefox);
  // CSS size × devicePixelRatio elsewhere (Safari).
  let devicePixels: { w: number; h: number } | null = null;

  const apply = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // Exact device pixels only when they're within the cap.
    const exact = dpr <= MAX_RATIO ? devicePixels : null;
    const ratio = Math.min(dpr, MAX_RATIO);
    const w = exact?.w ?? Math.round(rect.width * ratio);
    const h = exact?.h ?? Math.round(rect.height * ratio);
    // Assigning width/height clears the canvas, so only do it on a real change.
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    onResize({ width: rect.width, height: rect.height, scaleX: w / rect.width, scaleY: h / rect.height });
  };

  const observer = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    devicePixels = box ? { w: box.inlineSize, h: box.blockSize } : null;
    apply();
  });
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas);
  }

  let query: MediaQueryList | null = null;
  const onRatioChange = () => {
    watchRatio();
    apply();
  };
  // A resolution query only matches one ratio, so re-arm it after each change.
  const watchRatio = () => {
    query?.removeEventListener('change', onRatioChange);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', onRatioChange);
  };
  watchRatio();
  apply();

  return () => {
    observer.disconnect();
    query?.removeEventListener('change', onRatioChange);
  };
}
