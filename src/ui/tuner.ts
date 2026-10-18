/**
 * The tuner: the full-screen wire scene, a Start button (the mic needs a
 * tap), one quiet line of guidance under the wire, and Reset / Mute.
 * Once all six strings are tuned, the birds sing (see chorus.ts).
 */

import { CHORUS_LEAD_IN_S } from '../audio/chorus-score';
import { micBlocker, type MicSession } from '../audio/mic';
import { STANDARD_TUNING } from '../audio/notes';
import { TuningProgress } from '../audio/progress';
import { DEFAULT_TRACKER, Tracker, type TrackerOutput } from '../audio/tracker';
import { COLORS } from '../scene/birds';
import { fitCanvas, type CanvasSize } from '../scene/canvas';
import { Scene, type SceneInput } from '../scene/scene';
import { startChorus, type Chorus } from './chorus';
import { createControls } from './controls';
import { MIC_MESSAGES, micStartFailure } from './mic-messages';
import { startTuning } from './tuning-session';

const HINTS = {
  calibrating: 'Stay quiet a moment…',
  listening: 'Play a string',
};

const IDLE: TrackerOutput = { state: 'idle', string: null, cents: null, frequency: null };

function liveInput(output: TrackerOutput): Pick<SceneInput, 'active' | 'cents' | 'verdict'> {
  const { state } = output;
  const verdict = state === 'flat' || state === 'sharp' || state === 'inTune' ? state : null;
  return { active: output.string?.index ?? null, cents: output.cents, verdict };
}

/** `?chorus` starts with every string but high E done, so one string plays the whole chorus. */
const CHECK_CHORUS = new URLSearchParams(location.search).has('chorus');

export function mountTuner(root: HTMLElement): void {
  const screen = document.createElement('main');
  screen.className = 'tuner';
  const canvas = document.createElement('canvas');
  // Purely visual for now; screen readers get the button, messages and hints.
  canvas.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'tuner-panel';
  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'tuner-start';
  startButton.textContent = 'Start tuning';
  const message = document.createElement('p');
  message.className = 'tuner-message';
  message.setAttribute('role', 'alert');
  message.hidden = true;
  const hint = document.createElement('p');
  hint.className = 'tuner-hint';
  hint.setAttribute('aria-live', 'polite');
  // The canvas is hidden from screen readers, so progress is announced here.
  const status = document.createElement('p');
  status.className = 'visually-hidden';
  status.setAttribute('aria-live', 'polite');
  panel.append(startButton, message, hint, status);

  const progress = new TuningProgress();
  if (CHECK_CHORUS) progress.markDone([0, 1, 2, 3, 4]);
  const controls = createControls({
    onReset() {
      stopChorus();
      progress.reset();
      controls.setCanReset(false);
      status.textContent = 'Reset. No strings tuned yet.';
    },
    onMuteChange(muted) {
      if (muted) chorus?.mute();
    },
  });
  controls.setCanReset(progress.count > 0);
  controls.element.hidden = true;
  screen.append(canvas, panel, controls.element);
  root.replaceChildren(screen);

  // Page colours come from birds.ts so the edges (and notch areas) match the scene.
  document.documentElement.style.background = COLORS.ground;
  screen.style.setProperty('--text', COLORS.text);
  screen.style.setProperty('--muted', COLORS.muted);
  screen.style.setProperty('--wire', COLORS.wire);
  screen.style.setProperty('--ground', COLORS.ground);

  const scene = new Scene(DEFAULT_TRACKER.inTuneCents);
  // Followed live, so switching the system setting takes effect without a reload.
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  scene.reducedMotion = reducedMotion.matches;
  reducedMotion.addEventListener('change', () => { scene.reducedMotion = reducedMotion.matches; });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  let size: CanvasSize | null = null;
  fitCanvas(canvas, (s) => {
    size = s;
    panel.style.top = `${scene.resize(s.width, s.height).textTop}px`;
  });

  let session: MicSession | null = null;
  let tracker = new Tracker();
  // Latest tracker answer; the audio callback only stores it, drawing happens per animation frame.
  let latest = IDLE;
  /** While set, the birds sing and pitch detection is paused. */
  let chorus: Chorus | null = null;
  let leadIn: number | null = null;

  const frame = (ms: number) => {
    if (size) {
      ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
      const singing = chorus?.singing(ms) ?? null;
      scene.draw(ctx, { ...liveInput(latest), done: progress.done, singing }, ms / 1000);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  function showMessage(text: string | null): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
  }

  /** Hidden while a bird is showing its note, so the two never overlap. */
  function showHint(text: string | null): void {
    hint.classList.toggle('faded', text === null);
    if (text !== null && hint.textContent !== text) hint.textContent = text;
  }

  function beginChorus(): void {
    leadIn = null;
    if (!session) return;
    latest = IDLE;
    showHint(null);
    chorus = startChorus(session.context, controls.muted, () => {
      chorus = null;
    });
  }

  function stopChorus(): void {
    if (leadIn !== null) window.clearTimeout(leadIn);
    leadIn = null;
    chorus?.stop();
    chorus = null;
  }

  function track(output: TrackerOutput, timeMs: number): void {
    // Only frames that actually heard the string count, not the tracker's decay hold.
    const sounding = tracker.inspect().sinceLastReadingMs === 0;
    const step = progress.update(output, sounding, timeMs);
    if (step.finished === null) return;
    controls.setCanReset(true);
    const name = STANDARD_TUNING[step.finished].name;
    status.textContent = step.complete
      ? `${name} tuned. All six strings are in tune.`
      : `${name} tuned, ${progress.count} of ${STANDARD_TUNING.length}.`;
    if (step.complete) leadIn = window.setTimeout(beginChorus, CHORUS_LEAD_IN_S * 1000);
  }

  function stopped(text: string): void {
    stopChorus();
    latest = IDLE;
    session = null;
    showHint(null);
    showMessage(text);
    startButton.hidden = false;
    startButton.disabled = false;
  }

  async function start(): Promise<void> {
    startButton.disabled = true;
    showMessage('Starting microphone…');
    // Fresh tracker each start, so the room noise is measured again.
    tracker = new Tracker();
    try {
      session = await startTuning(tracker, {
        onUpdate(output, _analysis, _sampleRate, timeMs) {
          latest = output;
          const calibrating = tracker.inspect().calibrating;
          showHint(calibrating ? HINTS.calibrating : output.string ? null : HINTS.listening);
          track(output, timeMs);
        },
        // The mic would hear the chorus through the speakers (echo cancellation is off on purpose).
        isPaused: () => chorus !== null,
        onEnded() {
          void session?.stop();
          stopped(MIC_MESSAGES.disconnected);
        },
      });
      showMessage(null);
      startButton.hidden = true;
      controls.element.hidden = false;
    } catch (error) {
      const failure = micStartFailure(error);
      showMessage(failure.text);
      startButton.disabled = !failure.canRetry;
    }
  }

  startButton.addEventListener('click', () => {
    if (!session) void start();
  });

  showHint(null);
  const blocker = micBlocker();
  if (blocker) {
    showMessage(MIC_MESSAGES[blocker]);
    startButton.disabled = true;
  }
}
