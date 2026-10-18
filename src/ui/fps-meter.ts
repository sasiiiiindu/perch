/**
 * `?fps`: a small readout of frame timing, for checking the frame rate on a
 * real phone. Shows the typical frame time, the slowest one, and how many
 * frames took noticeably longer than the display's own interval, over the
 * last two seconds.
 */

const WINDOW_MS = 2000;

export function createFpsMeter(): { element: HTMLElement; frame(ms: number): void; reset(): void } {
  const element = document.createElement('output');
  element.className = 'fps-meter';
  element.setAttribute('aria-hidden', 'true');
  let last: number | null = null;
  let times: { at: number; dt: number }[] = [];
  let shownAt = 0;

  return {
    element,
    frame(ms) {
      if (last !== null) times.push({ at: ms, dt: ms - last });
      last = ms;
      times = times.filter((t) => ms - t.at <= WINDOW_MS);
      if (ms - shownAt < 500 || times.length < 10) return;
      shownAt = ms;
      const sorted = times.map((t) => t.dt).sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length / 2)];
      // "Late" = more than half a frame over the display's own interval (so 120 Hz screens count right).
      const late = sorted.filter((dt) => dt > typical * 1.5).length;
      element.textContent =
        `${Math.round(1000 / typical)} fps · ${typical.toFixed(1)} ms · worst ${sorted[sorted.length - 1].toFixed(0)} ms · ` +
        `late ${late}/${sorted.length}`;
    },
    /** After the loop paused (hidden tab), so the gap doesn't count as a slow frame. */
    reset() {
      last = null;
      times = [];
    },
  };
}
