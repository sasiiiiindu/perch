/**
 * Why the microphone couldn't start (or stopped), as a small set of kinds the
 * UI can show a message for. Pure: no browser globals, so it can be tested in Node.
 */

export type MicErrorKind =
  /** Page isn't on HTTPS or localhost, so browsers hide the mic API. */
  | 'insecure'
  /** No getUserMedia or AudioWorklet, or the worklet failed to load. */
  | 'unsupported'
  /** The user or browser settings refused permission. */
  | 'denied'
  /** No input device. */
  | 'no-mic'
  /** Device exists but couldn't be opened, usually because another app has it. */
  | 'mic-busy'
  /** The mic went away mid-session (unplugged, or revoked). */
  | 'disconnected'
  | 'unknown';

/** Thrown by src/audio/mic.ts for failures that aren't browser DOMExceptions. */
export class MicError extends Error {
  constructor(
    readonly kind: MicErrorKind,
    message: string = kind,
  ) {
    super(message);
    this.name = 'MicError';
  }
}

export interface MicEnvironment {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasAudioWorklet: boolean;
}

/**
 * What stops the mic from starting before we even ask, or null if nothing.
 * The secure-context check comes first: on plain http (e.g. a phone opening the
 * dev server by LAN IP) navigator.mediaDevices is undefined, and reporting that
 * as "unsupported browser" would send the user looking in the wrong place.
 */
export function checkMicEnvironment(env: MicEnvironment): MicErrorKind | null {
  if (!env.isSecureContext) return 'insecure';
  if (!env.hasGetUserMedia || !env.hasAudioWorklet) return 'unsupported';
  return null;
}

/** Maps an error from getUserMedia / Web Audio setup to a MicErrorKind. */
export function classifyMicError(error: unknown): MicErrorKind {
  if (error instanceof MicError) return error.kind;
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  switch (name) {
    case 'NotAllowedError': // permission refused (now or remembered)
    case 'SecurityError': // blocked by policy, e.g. an iframe without allow="microphone"
    case 'PermissionDeniedError': // older Chrome
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError': // older Chrome
    case 'OverconstrainedError': // only a device that can't meet the constraints
      return 'no-mic';
    case 'NotReadableError':
    case 'TrackStartError': // older Chrome
      return 'mic-busy';
    default:
      return 'unknown';
  }
}
