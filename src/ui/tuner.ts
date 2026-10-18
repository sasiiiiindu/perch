/**
 * The tuner: the full-screen wire scene, a Start button (the mic needs a
 * tap), one quiet line of guidance under the wire, and a small control row
 * (Reset, Stop, settings). Once all six strings are tuned, the birds sing.
 *
 *   mic-run.ts      mic on/off, wake lock, stopping when hidden
 *   reward.ts       strings tuned this session, and the chorus
 *   announcer.ts    note and cents for screen readers
 */

import { micBlocker } from '../audio/mic';
import { STANDARD_TUNING } from '../audio/notes';
import { DEFAULT_TRACKER, Tracker, type TrackerOutput } from '../audio/tracker';
import { COLORS } from '../scene/birds';
import { fitCanvas, type CanvasSize } from '../scene/canvas';
import { Scene, type SceneInput } from '../scene/scene';
import { Announcer } from './announcer';
import { createControls } from './controls';
import { createFpsMeter } from './fps-meter';
import { MicRun, type StopReason } from './mic-run';
import { MIC_MESSAGES, micStartFailure } from './mic-messages';
import { Reward } from './reward';
import { loadSettings, saveSettings, type Settings } from './settings';
import { createSettingsPanel } from './settings-panel';

const HINTS = {
  calibrating: 'Stay quiet a moment…',
  listening: 'Play a string',
};

const START_LABELS: Record<StopReason | 'first', string> = {
  first: 'Start tuning',
  user: 'Start tuning',
  ended: 'Start tuning',
  hidden: 'Resume tuning',
};

const IDLE: TrackerOutput = { state: 'idle', string: null, cents: null, frequency: null };

function liveInput(output: TrackerOutput): Pick<SceneInput, 'active' | 'cents' | 'verdict'> {
  const { state } = output;
  const verdict = state === 'flat' || state === 'sharp' || state === 'inTune' ? state : null;
  return { active: output.string?.index ?? null, cents: output.cents, verdict };
}

const params = new URLSearchParams(location.search);
/** `?chorus` starts with every string but high E done, so one string plays the whole chorus. */
const CHECK_CHORUS = params.has('chorus');
const SHOW_FPS = params.has('fps');

export function mountTuner(root: HTMLElement): void {
  let settings: Settings = loadSettings();

  const screen = document.createElement('main');
  screen.className = 'tuner';
  const canvas = document.createElement('canvas');
  // Purely visual: screen readers get the buttons, messages, hints and the spoken readout below.
  canvas.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'tuner-panel';
  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'tuner-start';
  startButton.textContent = START_LABELS.first;
  const message = document.createElement('p');
  message.className = 'tuner-message';
  message.setAttribute('role', 'alert');
  message.hidden = true;
  const hint = document.createElement('p');
  hint.className = 'tuner-hint';
  hint.setAttribute('aria-live', 'polite');
  // Two live regions: progress ("A2 tuned, 3 of 6") and the reading itself
  // ("A2, 12 cents flat"), so one never cuts the other off.
  const status = liveRegion();
  const reading = liveRegion();
  panel.append(startButton, message, hint, status, reading);

  const controls = createControls({
    onReset: () => reward.reset('Reset. No strings tuned yet.'),
    onStop: () => run.stop('user'),
    onSettings: () => settingsPanel.open(),
  });
  controls.setA4(settings.a4);
  const settingsPanel = createSettingsPanel(settings, applySettings);
  const fps = SHOW_FPS ? createFpsMeter() : null;
  screen.append(canvas, panel, controls.element, settingsPanel.element);
  if (fps) screen.append(fps.element);
  root.replaceChildren(screen);

  // Page colours come from birds.ts so the edges (and notch areas) match the scene.
  document.documentElement.style.background = COLORS.ground;
  screen.style.setProperty('--text', COLORS.text);
  screen.style.setProperty('--muted', COLORS.muted);
  screen.style.setProperty('--wire', COLORS.wire);
  screen.style.setProperty('--ground', COLORS.ground);

  const scene = new Scene(DEFAULT_TRACKER.inTuneCents);
  scene.showCents = settings.showCents;
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

  // Latest tracker answer; the analysis callback only stores it, drawing happens per animation frame.
  let latest = IDLE;
  const announcer = new Announcer();

  const reward = new Reward({
    context: () => run.context,
    muted: () => settings.muted,
    a4: () => settings.a4,
    announce: (text) => { status.textContent = text; },
    onProgress: (count) => controls.setCanReset(count > 0),
    onChorusStart: () => {
      latest = IDLE;
      showHint(null);
    },
  });
  if (CHECK_CHORUS) reward.progress.markDone([0, 1, 2, 3, 4]);
  controls.setCanReset(reward.progress.count > 0);

  const run = new MicRun({
    newTracker: () => new Tracker({ a4: settings.a4 }),
    onUpdate(output, tracker, timeMs) {
      latest = output;
      const calibrating = tracker.inspect().calibrating;
      showHint(calibrating ? HINTS.calibrating : output.string ? null : HINTS.listening);
      // Only frames that actually heard the string count, not the tracker's decay hold.
      reward.track(output, tracker.inspect().sinceLastReadingMs === 0, timeMs);
      speak(output);
    },
    // The mic would hear the chorus through the speakers (echo cancellation is off on purpose).
    isPaused: () => reward.playing,
    onStarted() {
      showMessage(null);
      startButton.hidden = true;
      controls.setRunning(true);
    },
    onStopped(reason) {
      reward.stop();
      latest = IDLE;
      announcer.update({ string: null, verdict: null, cents: null }, 0);
      showHint(null);
      showMessage(reason === 'ended' ? MIC_MESSAGES.disconnected : null);
      startButton.textContent = START_LABELS[reason];
      startButton.hidden = false;
      startButton.disabled = false;
      controls.setRunning(false);
    },
    onFailed(error) {
      const failure = micStartFailure(error);
      showMessage(failure.text);
      startButton.disabled = !failure.canRetry;
    },
  });

  // ---- Drawing: a requestAnimationFrame loop that stops while the page is hidden ----

  let rafId: number | null = null;
  const frame = (ms: number) => {
    rafId = requestAnimationFrame(frame);
    fps?.frame(ms);
    if (!size) return;
    ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
    scene.draw(ctx, { ...liveInput(latest), done: reward.progress.done, singing: reward.singing(ms) }, ms / 1000);
  };
  const loop = (on: boolean) => {
    if (on && rafId === null && document.visibilityState === 'visible') {
      fps?.reset();
      rafId = requestAnimationFrame(frame);
    } else if (!on && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  document.addEventListener('visibilitychange', () => loop(document.visibilityState === 'visible'));
  window.addEventListener('pagehide', () => loop(false));
  // Back from the back/forward cache: pagehide stopped the mic and the loop.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) loop(true);
  });
  loop(true);

  // ---- Helpers ----

  function applySettings(next: Settings): void {
    const a4Changed = next.a4 !== settings.a4;
    settings = next;
    saveSettings(settings);
    scene.showCents = settings.showCents;
    controls.setA4(settings.a4);
    if (settings.muted) reward.mute();
    if (a4Changed) {
      run.tracker?.setA4(settings.a4);
      latest = IDLE;
      // Strings tuned against the old reference aren't in tune against the new one.
      if (reward.progress.count > 0 || reward.playing) reward.reset(`A4 is now ${settings.a4} Hz. Session reset.`);
    }
  }

  function speak(output: TrackerOutput): void {
    const { verdict, cents } = liveInput(output);
    const name = output.string ? STANDARD_TUNING[output.string.index].name : null;
    const text = announcer.update({ string: name, verdict, cents }, performance.now());
    if (text) reading.textContent = text;
  }

  function showMessage(text: string | null): void {
    message.hidden = text === null;
    message.textContent = text ?? '';
  }

  /** Hidden while a bird is showing its note, so the two never overlap. */
  function showHint(text: string | null): void {
    hint.classList.toggle('faded', text === null);
    if (text !== null && hint.textContent !== text) hint.textContent = text;
  }

  startButton.addEventListener('click', () => {
    if (run.active) return;
    startButton.disabled = true;
    showMessage('Starting microphone…');
    void run.start();
  });

  showHint(null);
  const blocker = micBlocker();
  if (blocker) {
    showMessage(MIC_MESSAGES[blocker]);
    startButton.disabled = true;
  }
}

function liveRegion(): HTMLElement {
  const p = document.createElement('p');
  p.className = 'visually-hidden';
  p.setAttribute('aria-live', 'polite');
  return p;
}
