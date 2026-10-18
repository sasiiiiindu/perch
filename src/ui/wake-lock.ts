/**
 * Keeps the screen on while tuning (Screen Wake Lock API), so the phone
 * doesn't dim and lock while both hands are on the guitar.
 *
 * Where the API is missing (older iOS) Perch carries on without it. The
 * browser drops the lock by itself when the tab is hidden; Perch stops
 * tuning then anyway, and asks again on the next start.
 */

export class ScreenWake {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;

  /** Call from the Start tap, before any await: some browsers want it tied to the tap. */
  request(): void {
    this.wanted = true;
    if (!('wakeLock' in navigator) || this.sentinel) return;
    navigator.wakeLock.request('screen').then(
      (sentinel) => {
        // Stopped while the request was pending.
        if (!this.wanted) {
          void sentinel.release();
          return;
        }
        this.sentinel = sentinel;
        log('on');
        sentinel.addEventListener('release', () => {
          if (this.sentinel === sentinel) this.sentinel = null;
          log('off');
        });
      },
      (error: unknown) => log(`refused (${String(error)})`),
    );
  }

  release(): void {
    this.wanted = false;
    void this.sentinel?.release();
    this.sentinel = null;
  }
}

function log(state: string): void {
  if (import.meta.env.DEV) console.info(`[Perch] screen wake lock ${state}`);
}
