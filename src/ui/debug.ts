/**
 * Plain debug screen: the tracker's answer on top, the raw detector output
 * below it, and a cents bar showing both so the smoothing is visible.
 * Deliberately unstyled; open it with ?debug.
 */

import { micBlocker, type MicSession } from '../audio/mic';
import { centsBetween, midiToFrequency } from '../audio/notes';
import { MIN_CLARITY, type FrameAnalysis, type Reading } from '../audio/reading';
import { DEFAULT_TRACKER, Tracker, type TrackerOutput, type TunerState } from '../audio/tracker';
import { signed } from '../format';
import { MIC_MESSAGES, micStartFailure } from './mic-messages';
import { startTuning } from './tuning-session';

/** Friendly names for STANDARD_TUNING, by string index. */
const STRING_LABELS = ['low E', 'A', 'D', 'G', 'B', 'high E'];
/** Half-width of the bar, in cents. */
const BAR_RANGE = 50;
const STATE_LABELS: Record<TunerState, string> = {
  idle: 'Idle',
  listening: 'Listening…',
  flat: 'Flat',
  sharp: 'Sharp',
  inTune: 'In tune',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dbfs(value: number | null): string {
  if (value === null) return '—';
  return Number.isFinite(value) ? `${signed(value, 0)} dBFS` : '−∞ dBFS';
}

/** A track setting we asked to be off. Some browsers report a string mode instead of a boolean. */
function flag(value: boolean | string | undefined): string {
  if (value === undefined) return 'unknown';
  if (typeof value === 'string') return value;
  return value ? 'ON (asked for off)' : 'off';
}

/** A `dl` that rows can be added to; returns the value cell of each row. */
function fieldList(className: string): { list: HTMLDListElement; add(label: string): HTMLElement } {
  const list = el('dl', className);
  return {
    list,
    add(label) {
      const row = el('div');
      const value = el('dd', undefined, '—');
      row.append(el('dt', undefined, label), value);
      list.append(row);
      return value;
    },
  };
}

function placeMarker(marker: HTMLElement, cents: number | null): void {
  marker.hidden = cents === null;
  if (cents === null) return;
  const clamped = Math.max(-BAR_RANGE, Math.min(BAR_RANGE, cents));
  marker.style.left = `${50 + (clamped / BAR_RANGE) * 50}%`;
  marker.classList.toggle('off-scale', clamped !== cents);
}

export function mountDebugScreen(root: HTMLElement): void {
  const screen = el('main', 'debug');
  const heading = el('h1', undefined, 'Perch · debug');
  const startButton = el('button', 'start', 'Start tuning');
  startButton.type = 'button';
  const message = el('p', 'message');
  message.setAttribute('role', 'alert');
  message.hidden = true;

  // ---- Tracker: the answer the birds will use ----
  const readout = el('section', 'readout');
  readout.hidden = true;
  const trackedString = el('div', 'note', '—');
  const state = el('div', 'state', STATE_LABELS.idle);
  const tracked = fieldList('fields');
  const trackedCents = tracked.add('Cents');
  const trackedHz = tracked.add('Frequency');

  const bar = el('div', 'bar');
  bar.setAttribute('aria-hidden', 'true');
  const inTuneBand = el('div', 'bar-in-tune');
  const band = DEFAULT_TRACKER.inTuneCents / BAR_RANGE;
  inTuneBand.style.left = `${50 - band * 50}%`;
  inTuneBand.style.width = `${band * 100}%`;
  const rawMarker = el('div', 'bar-marker raw');
  const trackerMarker = el('div', 'bar-marker');
  rawMarker.hidden = trackerMarker.hidden = true;
  bar.append(inTuneBand, el('div', 'bar-centre'), rawMarker, trackerMarker);
  const barScale = el('div', 'bar-scale');
  barScale.append(
    el('span', undefined, `−${BAR_RANGE}`),
    el('span', undefined, '0 · solid = tracker, faint = raw'),
    el('span', undefined, `+${BAR_RANGE}`),
  );
  const trackerLine = el('p', 'diag');

  // ---- Raw detector: one frame at a time, unsmoothed ----
  const raw = el('section', 'raw');
  const rawNote = el('div', 'raw-note', '—');
  const rawFields = fieldList('fields small');
  const rawHz = rawFields.add('Frequency');
  const rawNoteCents = rawFields.add('Cents from note');
  const rawString = rawFields.add('Nearest string');
  const rawClarity = rawFields.add('Clarity');
  const rawStatus = el('p', 'status', 'Waiting for sound.');
  raw.append(el('h2', undefined, 'Raw detector'), rawNote, rawFields.list, rawStatus);

  const levelLine = el('p', 'diag');
  const micLine = el('p', 'diag');

  readout.append(trackedString, state, tracked.list, bar, barScale, trackerLine, raw, levelLine, micLine);
  screen.append(heading, startButton, message, readout);
  root.replaceChildren(screen);

  let session: MicSession | null = null;
  let tracker = new Tracker();
  const frameTimes: number[] = [];

  function showMessage(text: string | null): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
  }

  function showTracker(output: TrackerOutput): void {
    const info = tracker.inspect();
    readout.dataset.state = output.state;
    state.textContent = info.calibrating ? 'Calibrating — stay quiet' : STATE_LABELS[output.state];
    trackedString.textContent = output.string
      ? `${output.string.name} · ${STRING_LABELS[output.string.index]}`
      : '—';
    trackedCents.textContent = output.cents === null ? '—' : `${signed(output.cents, 1)} ¢`;
    trackedHz.textContent = output.frequency === null ? '—' : `${output.frequency.toFixed(2)} Hz`;
    placeMarker(trackerMarker, output.cents);

    const parts = [
      `Noise floor ${dbfs(info.noiseFloorDb)}`,
      `gate ${dbfs(info.gateThresholdDb)} (${info.gateOpen ? 'open' : 'closed'})`,
      `weight ${info.weight.toFixed(2)}`,
    ];
    if (info.sinceLastReadingMs !== null && info.sinceLastReadingMs > 0) {
      parts.push(`holding ${(info.sinceLastReadingMs / 1000).toFixed(1)} s`);
    }
    if (info.candidate) parts.push(`switching to ${info.candidate.name}?`);
    trackerLine.textContent = parts.join(' · ');
  }

  function showRaw(reading: Reading | null, output: TrackerOutput): void {
    // With no pitch, keep the last raw values on screen but dimmed.
    raw.classList.toggle('stale', reading === null);
    raw.classList.toggle('rejected', reading !== null && !reading.accepted);
    if (!reading) {
      rawStatus.textContent = 'No clear pitch.';
      return;
    }
    rawStatus.textContent = reading.accepted ? 'OK' : `Rejected: clarity below ${MIN_CLARITY.toFixed(2)}.`;
    rawNote.textContent = `${reading.note.name}${reading.note.octave}`;
    rawHz.textContent = `${reading.frequency.toFixed(2)} Hz`;
    rawNoteCents.textContent = `${signed(reading.note.cents, 1)} ¢`;
    const { string: match } = reading;
    rawString.textContent =
      `${STRING_LABELS[match.string.index]} (${match.string.name}) ${signed(match.cents, 1)} ¢`;
    rawClarity.textContent = reading.clarity.toFixed(2);
    // Measure the raw marker against the tracker's string when there is one,
    // so the two markers on the bar are comparable.
    const target = output.string ? midiToFrequency(output.string.midi) : match.target;
    placeMarker(rawMarker, centsBetween(reading.frequency, target));
  }

  function showFrame(output: TrackerOutput, analysis: FrameAnalysis, sampleRate: number): void {
    showTracker(output);
    showRaw(analysis.reading, output);

    const now = performance.now();
    frameTimes.push(now);
    while (frameTimes[0] < now - 1000) frameTimes.shift();
    levelLine.textContent =
      `Input level ${dbfs(analysis.levelDb)} · ${frameTimes.length} readings/s · ${sampleRate} Hz`;
  }

  function showMicInfo(): void {
    if (!session) return;
    const s = session.settings;
    micLine.textContent =
      `Echo cancellation ${flag(s.echoCancellation)} · ` +
      `noise suppression ${flag(s.noiseSuppression)} · ` +
      `auto gain ${flag(s.autoGainControl)} · mic ${s.sampleRate ?? '?'} Hz · audio ${session.state}`;
  }

  async function start(): Promise<void> {
    startButton.disabled = true;
    showMessage('Starting microphone…');
    // Fresh tracker each start, so the room noise is measured again.
    tracker = new Tracker();
    try {
      session = await startTuning(tracker, {
        onUpdate: showFrame,
        onEnded: () => {
          showMessage(MIC_MESSAGES.disconnected);
          raw.classList.add('stale');
          void session?.stop();
          session = null;
          startButton.hidden = false;
          startButton.disabled = false;
        },
        onStateChange: showMicInfo,
      });
      showMessage(null);
      showMicInfo();
      startButton.hidden = true;
      readout.hidden = false;
    } catch (error) {
      const failure = micStartFailure(error);
      showMessage(failure.text);
      startButton.disabled = !failure.canRetry;
    }
  }

  startButton.addEventListener('click', () => {
    if (!session) void start();
  });

  const blocker = micBlocker();
  if (blocker) {
    showMessage(MIC_MESSAGES[blocker]);
    startButton.disabled = true;
  }
}
