/**
 * The small row along the bottom edge: Reset (start a fresh session), Stop,
 * and a gear for the settings panel. When A4 isn't 440 Hz the row says so,
 * so a non-standard reference is never invisible.
 */

import { DEFAULT_A4 } from '../audio/notes';

const GEAR =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none"/>' +
  '<path fill="none" d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/></svg>';

export interface ControlsHandlers {
  onReset(): void;
  onStop(): void;
  onSettings(): void;
}

export interface Controls {
  element: HTMLElement;
  /** Reset only shows once there is something to reset. */
  setCanReset(can: boolean): void;
  /** Stop shows while the mic is on. */
  setRunning(running: boolean): void;
  setA4(hz: number): void;
}

export function createControls(handlers: ControlsHandlers): Controls {
  const element = document.createElement('div');
  element.className = 'tuner-controls';

  const button = (label: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tuner-control';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  };
  const reset = button('Reset', () => handlers.onReset());
  reset.hidden = true;
  const stop = button('Stop', () => handlers.onStop());
  stop.hidden = true;
  const settings = button('', () => handlers.onSettings());
  settings.classList.add('icon');
  settings.setAttribute('aria-label', 'Settings');
  settings.setAttribute('aria-haspopup', 'dialog');
  settings.innerHTML = GEAR;

  const a4 = document.createElement('span');
  a4.className = 'tuner-a4';
  a4.hidden = true;
  element.append(a4, reset, stop, settings);

  return {
    element,
    setCanReset(can) {
      reset.hidden = !can;
    },
    setRunning(running) {
      stop.hidden = !running;
    },
    setA4(hz) {
      a4.hidden = hz === DEFAULT_A4;
      a4.textContent = `A4 = ${hz} Hz`;
    },
  };
}
