/**
 * Plain debug screen: raw detector output as text, plus a cents bar.
 * Deliberately unstyled; this will later live behind ?debug.
 */

import { classifyMicError } from '../audio/mic-errors';
import { micBlocker, startMic, type MicSession } from '../audio/mic';
import { MIN_CLARITY, analyseFrame, type FrameAnalysis, type Reading } from '../audio/reading';
import { MIC_MESSAGES } from './mic-messages';

/** Friendly names for STANDARD_TUNING, by string index. */
const STRING_LABELS = ['low E', 'A', 'D', 'G', 'B', 'high E'];
/** Half-width of the bar, in cents. */
const BAR_RANGE = 50;
/** Within this many cents counts as in tune (CLAUDE.md). Drawn as a band on the bar. */
const IN_TUNE_CENTS = 3;

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

/** "+4.2", "−4.2" (true minus sign), "0.0". */
function signed(value: number, digits: number): string {
  const abs = Math.abs(value).toFixed(digits);
  if (Number(abs) === 0) return abs;
  return (value > 0 ? '+' : '−') + abs;
}

/** A track setting we asked to be off. Some browsers report a string mode instead of a boolean. */
function flag(value: boolean | string | undefined): string {
  if (value === undefined) return 'unknown';
  if (typeof value === 'string') return value;
  return value ? 'ON (asked for off)' : 'off';
}

export function mountDebugScreen(root: HTMLElement): void {
  const screen = el('main', 'debug');
  const heading = el('h1', undefined, 'Perch · debug');
  const startButton = el('button', 'start', 'Start tuning');
  startButton.type = 'button';
  const message = el('p', 'message');
  message.setAttribute('role', 'alert');
  message.hidden = true;

  const readout = el('section', 'readout');
  readout.hidden = true;
  const note = el('div', 'note', '—');

  const fields = el('dl', 'fields');
  const field = (label: string): HTMLElement => {
    const row = el('div');
    const value = el('dd', undefined, '—');
    row.append(el('dt', undefined, label), value);
    fields.append(row);
    return value;
  };
  const frequency = field('Frequency');
  const noteCents = field('Cents from note');
  const string = field('Nearest string');
  const clarity = field('Clarity');

  const bar = el('div', 'bar');
  bar.setAttribute('aria-hidden', 'true');
  const inTuneBand = el('div', 'bar-in-tune');
  inTuneBand.style.left = `${50 - (IN_TUNE_CENTS / BAR_RANGE) * 50}%`;
  inTuneBand.style.width = `${(IN_TUNE_CENTS / BAR_RANGE) * 100}%`;
  const marker = el('div', 'bar-marker');
  marker.hidden = true;
  bar.append(inTuneBand, el('div', 'bar-centre'), marker);
  const barScale = el('div', 'bar-scale');
  barScale.append(
    el('span', undefined, `−${BAR_RANGE}`),
    el('span', undefined, '0 · cents from string'),
    el('span', undefined, `+${BAR_RANGE}`),
  );

  const status = el('p', 'status', 'Listening… play a string.');
  const levelLine = el('p', 'diag');
  const micLine = el('p', 'diag');

  readout.append(note, fields, bar, barScale, status, levelLine, micLine);
  screen.append(heading, startButton, message, readout);
  root.replaceChildren(screen);

  let session: MicSession | null = null;
  const frameTimes: number[] = [];

  function showMessage(text: string | null): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
  }

  function showReading(reading: Reading): void {
    note.textContent = `${reading.note.name}${reading.note.octave}`;
    frequency.textContent = `${reading.frequency.toFixed(2)} Hz`;
    noteCents.textContent = `${signed(reading.note.cents, 1)} ¢`;
    const { string: match } = reading;
    string.textContent =
      `${STRING_LABELS[match.string.index]} (${match.string.name}) ${signed(match.cents, 1)} ¢`;
    clarity.textContent = reading.clarity.toFixed(2);

    const clamped = Math.max(-BAR_RANGE, Math.min(BAR_RANGE, match.cents));
    marker.hidden = false;
    marker.style.left = `${50 + (clamped / BAR_RANGE) * 50}%`;
    marker.classList.toggle('off-scale', clamped !== match.cents);
  }

  function showFrame(analysis: FrameAnalysis, sampleRate: number): void {
    const { reading } = analysis;
    if (reading) showReading(reading);
    // With no pitch, keep the last values on screen but dimmed.
    readout.classList.toggle('stale', reading === null);
    readout.classList.toggle('rejected', reading !== null && !reading.accepted);
    if (!reading) status.textContent = 'No clear pitch.';
    else if (!reading.accepted) status.textContent = `Rejected: clarity below ${MIN_CLARITY.toFixed(2)}.`;
    else status.textContent = 'OK';

    const now = performance.now();
    frameTimes.push(now);
    while (frameTimes[0] < now - 1000) frameTimes.shift();
    const level = Number.isFinite(analysis.levelDb) ? signed(analysis.levelDb, 0) : '−∞';
    levelLine.textContent = `Input level ${level} dBFS · ${frameTimes.length} readings/s · ${sampleRate} Hz`;
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
    try {
      session = await startMic({
        onFrame: (samples, sampleRate) => showFrame(analyseFrame(samples, sampleRate), sampleRate),
        onEnded: () => {
          showMessage(MIC_MESSAGES.disconnected);
          readout.classList.add('stale');
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
      const kind = classifyMicError(error);
      const detail = kind === 'unknown' && error instanceof Error ? ` (${error.name}: ${error.message})` : '';
      showMessage(MIC_MESSAGES[kind] + detail);
      startButton.disabled = kind === 'insecure' || kind === 'unsupported';
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
