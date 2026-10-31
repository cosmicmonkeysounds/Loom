// The teleprompter's numbers (wave 55): pure, in the lazy chunk with
// `prompter.tsx`. Speed is a multiple of `BASE_WPM`; the scroll follows from
// how tall the words came out at this size on this phone.

import type { ScriptLine, ScriptSection } from "./model.ts";
import type { PrompterFrame } from "./shared.ts";

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

/** Wave 59: where each line starts, in words; one past the end is the total. */
export function wordOffsets(lines: readonly FlatLine[]): number[] {
  const out = [0];
  for (const l of lines) out.push(out[out.length - 1]! + l.words);
  return out;
}

/** Wave 59: a shared position, in words, as a height in this phone's text.
 *  `bottom` is where the last line ends. */
export function yOfPos(pos: number, offs: readonly number[], tops: readonly number[], bottom: number): number {
  if (tops.length === 0) return 0;
  const i = Math.min(tops.length - 1, lineAt(offs, pos));
  const span = offs[i + 1]! - offs[i]!;
  const next = tops[i + 1] ?? bottom;
  return tops[i]! + (span > 0 ? Math.min(1, Math.max(0, (pos - offs[i]!) / span)) : 0) * (next - tops[i]!);
}

/** Wave 59: the height in this phone's text as a shared position. */
export function posOfY(y: number, offs: readonly number[], tops: readonly number[], bottom: number): number {
  if (tops.length === 0) return 0;
  const i = lineAt(tops, y);
  const next = tops[i + 1] ?? bottom;
  const f = next > tops[i]! ? Math.min(1, Math.max(0, (y - tops[i]!) / (next - tops[i]!))) : 0;
  return offs[i]! + f * (offs[i + 1]! - offs[i]!);
}

export interface PrompterBits {
  /** Someone else has it, or he is speaking. */
  locked: boolean;
  speaking: boolean;
  /** Who has it. */
  name: string;
  playing: boolean;
}

/** What the controls need from a frame, as a key: only a change re-renders. */
export function bitsKey(f: PrompterFrame | null, me: string): string {
  if (f === null) return "|0";
  const who = f.speaking !== null ? `s${f.speaking.name}` : f.holder !== null && f.holder.who !== me ? `h${f.holder.name}` : "";
  return `${who}|${f.playing ? 1 : 0}`;
}

export function bitsOf(key: string): PrompterBits {
  const cut = key.lastIndexOf("|");
  const who = key.slice(0, cut);
  return { locked: who !== "", speaking: who.startsWith("s"), name: who.slice(1), playing: key.slice(cut + 1) === "1" };
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
