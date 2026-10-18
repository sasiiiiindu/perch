/**
 * Two small buttons along the bottom edge: Reset (start a fresh session)
 * and Mute (silence the chorus). Mute is remembered on this device.
 */

const MUTE_KEY = 'perch.muted';

const SPEAKER = '<path d="M4 9h3l5-4v14l-5-4H4z"/>';
const WAVES = '<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" fill="none"/>';
const CROSS = '<path d="M16 9.5l5 5M21 9.5l-5 5" fill="none"/>';

export interface ControlsHandlers {
  onReset(): void;
  onMuteChange(muted: boolean): void;
}

export interface Controls {
  element: HTMLElement;
  readonly muted: boolean;
  /** Reset only shows once there is something to reset. */
  setCanReset(can: boolean): void;
}

export function createControls(handlers: ControlsHandlers): Controls {
  const element = document.createElement('div');
  element.className = 'tuner-controls';

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tuner-control';
  reset.textContent = 'Reset';
  reset.hidden = true;

  const mute = document.createElement('button');
  mute.type = 'button';
  mute.className = 'tuner-control icon';
  mute.setAttribute('aria-label', 'Mute');
  element.append(reset, mute);

  let muted = readMuted();
  const showMute = () => {
    mute.setAttribute('aria-pressed', String(muted));
    mute.innerHTML =
      `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;
  };
  showMute();

  reset.addEventListener('click', () => handlers.onReset());
  mute.addEventListener('click', () => {
    muted = !muted;
    showMute();
    saveMuted(muted);
    handlers.onMuteChange(muted);
  });

  return {
    element,
    get muted() {
      return muted;
    },
    setCanReset(can) {
      reset.hidden = !can;
    },
  };
}

// Storage can be missing or throw (private windows, blocked site data); mute then just isn't remembered.
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Not remembered; fine.
  }
}
