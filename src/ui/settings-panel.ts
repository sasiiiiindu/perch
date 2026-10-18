/**
 * The settings panel: a small modal dialog behind the gear. A4 reference,
 * mute, and whether the cents number shows. Every change applies at once
 * and is remembered (see settings.ts).
 *
 * A native <dialog>: focus moves into it, Escape closes it, and the rest of
 * the page is inert while it's open.
 */

import { DEFAULT_A4 } from '../audio/notes';
import { A4_MAX, A4_MIN, clampA4, type Settings } from './settings';

export interface SettingsPanel {
  element: HTMLDialogElement;
  open(): void;
}

/** `onChange` gets the whole new settings object after every change. */
export function createSettingsPanel(initial: Settings, onChange: (next: Settings) => void): SettingsPanel {
  let settings = { ...initial };

  const dialog = document.createElement('dialog');
  dialog.className = 'settings';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <h2 id="settings-title">Settings</h2>
    <div class="settings-row">
      <span class="settings-label" id="a4-label">A4 reference</span>
      <div class="a4-stepper" role="group" aria-labelledby="a4-label">
        <button type="button" class="settings-step" data-step="-1" aria-label="Lower A4 by 1 Hz">−</button>
        <output class="a4-value" aria-live="polite"></output>
        <button type="button" class="settings-step" data-step="1" aria-label="Raise A4 by 1 Hz">+</button>
      </div>
    </div>
    <p class="settings-note">
      <span class="a4-range">${A4_MIN}–${A4_MAX} Hz. Changing it starts a fresh session.</span>
      <button type="button" class="settings-link a4-default">Back to ${DEFAULT_A4}</button>
    </p>
    <label class="settings-row"><span class="settings-label">Show cents</span><input type="checkbox" name="showCents" /></label>
    <label class="settings-row"><span class="settings-label">Mute chorus</span><input type="checkbox" name="muted" /></label>
    <form method="dialog" class="settings-actions"><button class="tuner-start settings-done">Done</button></form>
  `;

  const q = <T extends Element>(selector: string) => dialog.querySelector<T>(selector)!;
  const value = q<HTMLOutputElement>('.a4-value');
  const lower = q<HTMLButtonElement>('[data-step="-1"]');
  const raise = q<HTMLButtonElement>('[data-step="1"]');
  const backToDefault = q<HTMLButtonElement>('.a4-default');
  const showCents = q<HTMLInputElement>('[name="showCents"]');
  const muted = q<HTMLInputElement>('[name="muted"]');

  const render = () => {
    value.textContent = `${settings.a4} Hz`;
    lower.disabled = settings.a4 <= A4_MIN;
    raise.disabled = settings.a4 >= A4_MAX;
    backToDefault.hidden = settings.a4 === DEFAULT_A4;
    showCents.checked = settings.showCents;
    muted.checked = settings.muted;
  };

  const change = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    next.a4 = clampA4(next.a4);
    if (next.a4 === settings.a4 && next.muted === settings.muted && next.showCents === settings.showCents) return;
    settings = next;
    render();
    onChange({ ...settings });
  };

  for (const step of [lower, raise]) {
    step.addEventListener('click', () => change({ a4: settings.a4 + Number(step.dataset.step) }));
  }
  backToDefault.addEventListener('click', () => {
    change({ a4: DEFAULT_A4 });
    raise.focus(); // the link hides itself; keep focus somewhere sensible
  });
  showCents.addEventListener('change', () => change({ showCents: showCents.checked }));
  muted.addEventListener('change', () => change({ muted: muted.checked }));
  // A tap on the backdrop closes it, like Escape. The backdrop counts as the
  // dialog itself, and so does the panel's padding, hence the position check.
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    const inside = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
    if (!inside) dialog.close();
  });

  render();
  return {
    element: dialog,
    open() {
      if (!dialog.open) dialog.showModal();
    },
  };
}
