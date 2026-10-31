// The teleprompter's numbers (wave 55): pure, in the lazy chunk with
// `prompter.tsx`. Speed is a multiple of `BASE_WPM`; the scroll follows from
// how tall the words came out at this size on this phone.

import type { ScriptLine, ScriptSection } from "./model.ts";

/** The speed a line is timed at, words a minute. */
export const BASE_WPM = 130;
export const SPEED_MIN = 0.4;
export const SPEED_MAX = 2.5;
export const SPEED_STEP = 0.1;
export const SIZE_MIN = 22;
export const SIZE_MAX = 64;
export const SIZE_STEP = 4;
/** The reading line sits this far down the text. */
export const MARK_AT = 0.3;

export interface FlatLine extends ScriptLine {
  index: number;
  section: number;
  words: number;
}

export function flatten(script: readonly ScriptSection[]): FlatLine[] {
  const out: FlatLine[] = [];
  script.forEach((s, section) => {
    for (const l of s.lines) out.push({ ...l, index: out.length, section, words: Math.max(1, l.text.split(/\s+/u).filter(Boolean).length) });
  });
  return out;
}

export const clampSpeed = (n: number): number => Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, n)) * 10) / 10;
export const clampSize = (n: number): number => Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));

/** How fast the text moves so `speed` × `BASE_WPM` words pass the reading line. */
export function pxPerSecond(speed: number, textPx: number, words: number): number {
  return words > 0 ? ((speed * BASE_WPM) / 60) * (textPx / words) : 0;
}

/** The line at height `y`: the last one starting at or above it. */
export function lineAt(tops: readonly number[], y: number): number {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tops[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Where each line starts on the rail, 0..1, by its words; one past the end is 1. */
export function railStarts(lines: readonly FlatLine[]): number[] {
  const total = lines.reduce((n, l) => n + l.words, 0);
  let run = 0;
  const out = lines.map((l) => {
    const at = total > 0 ? run / total : 0;
    run += l.words;
    return at;
  });
  out.push(1);
  return out;
}

/** The line a spot on the rail points at. */
export function railLine(starts: readonly number[], f: number): number {
  const at = Math.min(1, Math.max(0, f));
  return lineAt(starts.slice(0, -1), at);
}

/** The cue before this reader's first new line (never before the first new
 *  line at all), so a host with one line lands on their cue, not the top of
 *  someone else's speech; with nothing new, the last section's start. */
export function startLine(lines: readonly FlatLine[], mark: number): number {
  const next = lines.find((l) => l.seq > mark);
  if (next !== undefined) {
    const own = lines.find((l) => l.mine && l.seq > mark);
    return own === undefined ? next.index : Math.max(next.index, own.index - 1);
  }
  const end = lines[lines.length - 1];
  return end === undefined ? 0 : (lines.find((l) => l.section === end.section)?.index ?? 0);
}

/** The first line of section `section`, or null past either end. */
export function sectionLine(lines: readonly FlatLine[], section: number): number | null {
  return lines.find((l) => l.section === section)?.index ?? null;
}

/** Has this reader reached their last line? */
export function pastLastLine(lines: readonly FlatLine[], at: number): boolean {
  for (let i = lines.length - 1; i > at; i--) if (lines[i]!.mine) return false;
  return true;
}

export function clip(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** "under a minute", "about 3 min": how long these lines take to say. */
export function readingLabel(lines: readonly ScriptLine[]): string {
  const words = lines.reduce((n, l) => n + l.text.split(/\s+/u).filter(Boolean).length, 0);
  const minutes = Math.round(words / BASE_WPM);
  return minutes < 1 ? "under a minute" : `about ${minutes} min`;
}
