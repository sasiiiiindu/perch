import { classifyMicError, type MicErrorKind } from '../audio/mic-errors';

/** What to tell the user for each way the microphone can fail. */
export const MIC_MESSAGES: Record<MicErrorKind, string> = {
  insecure:
    'The microphone only works on a secure page. Open Perch with an https:// address (or on localhost).',
  unsupported:
    "This browser can't run the tuner. Try a recent version of Safari, Chrome, Firefox or Edge.",
  denied:
    'Microphone access is blocked. Allow the microphone for this site in your browser settings ' +
    '(on iPhone: tap aA in the address bar › Website Settings › Microphone), reload, then tap Start tuning.',
  'no-mic': 'No microphone was found. Connect one, or check that your device has one, then try again.',
  'mic-busy': 'The microphone is being used by another app. Close that app, then try again.',
  disconnected: 'The microphone was disconnected. Reconnect it, then tap Start tuning.',
  unknown: "Couldn't start the microphone.",
};

/** The message for a failed start, and whether tapping Start again could help. */
export function micStartFailure(error: unknown): { text: string; canRetry: boolean } {
  const kind = classifyMicError(error);
  const detail = kind === 'unknown' && error instanceof Error ? ` (${error.name}: ${error.message})` : '';
  return { text: MIC_MESSAGES[kind] + detail, canRetry: kind !== 'insecure' && kind !== 'unsupported' };
}
