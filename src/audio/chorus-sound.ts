/**
 * Synthesises the chorus with Web Audio: no audio files.
 *
 *   voices → master Gain → lowpass → destination
 *
 * Triangle waves at the true string pitches. A sine at 82 Hz is close to
 * silent on a phone speaker; a triangle's odd harmonics (3×, 5×) carry the
 * low strings a little further while staying soft. The lowpass takes the
 * edge off those harmonics on the high strings.
 */

import type { ChorusScore } from './chorus-score';

const CHIRP_PEAK = 0.2;
/** Per voice; six of them sound together. */
const CHORD_PEAK = 0.06;
/** A chirp starts a semitone under its note and slides up, like a bird. */
const CHIRP_BEND = 2 ** (-1 / 12);
const BEND_S = 0.04;
const CHIRP_ATTACK_S = 0.012;
const CHORD_ATTACK_S = 0.15;
const LOWPASS_HZ = 2200;
/** exponentialRampToValueAtTime can't reach 0. */
const SILENT = 0.0001;

export interface ChorusPlayback {
  /** Fade out within a few tens of ms and release every node. Safe to call twice. */
  stop(): void;
}

/** Schedule the whole chorus, starting at `startAt` on the context's clock. */
export function playChorus(context: AudioContext, score: ChorusScore, startAt: number): ChorusPlayback {
  const master = new GainNode(context, { gain: 1 });
  const lowpass = new BiquadFilterNode(context, { type: 'lowpass', frequency: LOWPASS_HZ, Q: 0.5 });
  master.connect(lowpass).connect(context.destination);
  const oscillators: OscillatorNode[] = [];

  const voice = (frequency: number, start: number, attack: number, duration: number, peak: number) => {
    const osc = new OscillatorNode(context, { type: 'triangle', frequency });
    const env = new GainNode(context, { gain: 0 });
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    // Exponential decay sounds natural (like a plucked or sung note dying away).
    env.gain.exponentialRampToValueAtTime(SILENT, start + duration);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
    oscillators.push(osc);
    return osc;
  };

  for (const chirp of score.chirps) {
    const start = startAt + chirp.start;
    const osc = voice(chirp.frequency, start, CHIRP_ATTACK_S, chirp.duration, CHIRP_PEAK);
    osc.frequency.setValueAtTime(chirp.frequency * CHIRP_BEND, start);
    osc.frequency.exponentialRampToValueAtTime(chirp.frequency, start + BEND_S);
  }
  const { chord } = score;
  for (const frequency of chord.frequencies) {
    voice(frequency, startAt + chord.start, CHORD_ATTACK_S, chord.duration, CHORD_PEAK);
  }

  let stopped = false;
  // Release the graph once it's done, so a later chorus starts clean.
  const cleanup = window.setTimeout(release, (startAt - context.currentTime + score.end + 0.2) * 1000);

  function release(): void {
    for (const osc of oscillators) osc.disconnect();
    master.disconnect();
    lowpass.disconnect();
  }

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(cleanup);
      if (context.state === 'closed') return;
      const now = context.currentTime;
      // A quick fade rather than a cut, which would click.
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const osc of oscillators) {
        try {
          osc.stop(now + 0.05);
        } catch {
          // Already stopped.
        }
      }
      window.setTimeout(release, 100);
    },
  };
}
