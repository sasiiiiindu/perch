import { describe, expect, it } from 'vitest';
import { MicError, checkMicEnvironment, classifyMicError } from '../src/audio/mic-errors';

const domError = (name: string) => new DOMException('test', name);

describe('checkMicEnvironment', () => {
  const ok = { isSecureContext: true, hasGetUserMedia: true, hasAudioWorklet: true };

  it('allows a secure context with getUserMedia and AudioWorklet', () => {
    expect(checkMicEnvironment(ok)).toBeNull();
  });

  it('reports insecure before unsupported (http hides getUserMedia too)', () => {
    expect(checkMicEnvironment({ ...ok, isSecureContext: false, hasGetUserMedia: false })).toBe('insecure');
  });

  it('reports unsupported without getUserMedia or AudioWorklet', () => {
    expect(checkMicEnvironment({ ...ok, hasGetUserMedia: false })).toBe('unsupported');
    expect(checkMicEnvironment({ ...ok, hasAudioWorklet: false })).toBe('unsupported');
  });
});

describe('classifyMicError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['NotFoundError', 'no-mic'],
    ['DevicesNotFoundError', 'no-mic'],
    ['OverconstrainedError', 'no-mic'],
    ['NotReadableError', 'mic-busy'],
    ['TrackStartError', 'mic-busy'],
    ['AbortError', 'unknown'],
  ])('%s → %s', (name, kind) => {
    expect(classifyMicError(domError(name))).toBe(kind);
  });

  it('passes through the kind of a MicError', () => {
    expect(classifyMicError(new MicError('unsupported'))).toBe('unsupported');
  });

  it('treats anything else as unknown', () => {
    expect(classifyMicError(new Error('boom'))).toBe('unknown');
    expect(classifyMicError('nope')).toBe('unknown');
    expect(classifyMicError(null)).toBe('unknown');
  });
});
