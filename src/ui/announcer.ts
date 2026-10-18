/**
 * What screen readers hear while tuning: "A2, 12 cents flat", "A2, in tune".
 *
 * The tracker answers 25 times a second; speaking each one would drown the
 * screen reader. So a new string is spoken straight away, a change of
 * verdict (flat → in tune) after a short pause, and a mere change in cents
 * at most every 1.5 s. Pure: time comes from the caller.
 */

export type Verdict = 'flat' | 'sharp' | 'inTune';

export interface Heard {
  /** String name, e.g. "A2"; null when no string is sounding. */
  string: string | null;
  verdict: Verdict | null;
  cents: number | null;
}

export interface AnnouncerOptions {
  /** Same string, same verdict, new cents: at most this often. */
  centsEveryMs: number;
  /** Same string, new verdict: at least this long after the last phrase. */
  verdictAfterMs: number;
}

export const DEFAULT_ANNOUNCER: Readonly<AnnouncerOptions> = { centsEveryMs: 1500, verdictAfterMs: 500 };

export function phrase(string: string, verdict: Verdict, cents: number): string {
  if (verdict === 'inTune') return `${string}, in tune`;
  const n = Math.max(1, Math.round(Math.abs(cents)));
  return `${string}, ${n} ${n === 1 ? 'cent' : 'cents'} ${verdict}`;
}

export class Announcer {
  private readonly opts: AnnouncerOptions;
  private last: { string: string; verdict: Verdict; text: string; atMs: number } | null = null;

  constructor(options: Partial<AnnouncerOptions> = {}) {
    this.opts = { ...DEFAULT_ANNOUNCER, ...options };
  }

  /** The phrase to speak now, or null to stay quiet. */
  update(heard: Heard, nowMs: number): string | null {
    const { string, verdict, cents } = heard;
    if (string === null || verdict === null || cents === null) {
      this.last = null; // the next note is spoken straight away
      return null;
    }
    const text = phrase(string, verdict, cents);
    const last = this.last;
    if (last && last.text === text) return null;
    const since = last ? nowMs - last.atMs : Infinity;
    const due =
      !last ||
      last.string !== string ||
      (last.verdict !== verdict ? since >= this.opts.verdictAfterMs : since >= this.opts.centsEveryMs);
    if (!due) return null;
    this.last = { string, verdict, text, atMs: nowMs };
    return text;
  }
}
