//! The Language Report's containment breach (wave 48b, G14:
//! screens_award_language), pure: the lines the censored log prints (every
//! censored word, a redaction bar for each unsaid one, "+ n more"), when
//! each prints and when it escapes the window, where it lands in the pile
//! that engulfs the screen, how the window trembles, where the eye looks,
//! when the deadpan notes pop up and when the scissors cut it all away.
//! Every function is a picture of `t` (ms into the scene), seeded, never
//! `Math.random`, so the TV and every wall agree and a reload lands on the
//! right frame. `docs/loom-w48-contract.md` C14.

import { clamp, clamp01, ease, hashSeed, lerp, noise1, progress } from "./time.ts";

// --- the lines ---------------------------------------------------------------------------

/** The longest word the log and the pile show whole (code points); past it, "…". */
export const LANG_WORD_MAX = 18;

/** A word as the breach shows it: whole up to `LANG_WORD_MAX` characters, then clipped with "…". */
export function langWord(w: string): string {
  const cps = Array.from(w.trim());
  return cps.length <= LANG_WORD_MAX ? cps.join("") : `${cps.slice(0, LANG_WORD_MAX - 1).join("")}…`;
}

/** The most redaction bars the breach draws (an unsaid count past it is still counted, never drawn). */
export const BREACH_BARS_MAX = 200;

/**
 * One line of the censored log, and one piece of the pile. `heat` (0..1) is
 * how often it was censored against the most censored word; `size` is its
 * scale in the pile (1 to 3). A **bar** is an unsaid word (a slur): it has
 * no text at all, only a width in characters, so nothing can ever print it.
 */
export type BreachLine =
  | { kind: "word"; text: string; count: number; heat: number; size: number }
  | { kind: "bar"; chars: number; heat: number; size: number }
  | { kind: "more"; text: string; heat: number; size: number };

/** A pile scale for a heat: 1 for the once-censored, up to 3 for the most. */
export function breachSize(heat: number): number {
  return 1 + 2 * clamp01(heat) ** 1.15;
}

const SEED = hashSeed("language breach");

/**
 * The log's lines: the words in the order given (most censored first), the
 * unsaid words' bars mixed in among them (never ahead of the first word),
 * then "+ n more". With no counts above 1 every word is as hot as the next,
 * except a lone word, which is the most censored by definition.
 */
export function breachLines(words: readonly string[], counts: readonly number[], unsaid: number, more: number): BreachLine[] {
  const w = words.length;
  const count = (i: number) => Math.max(1, Math.floor(counts[i] ?? 1));
  let max = 1;
  for (let i = 0; i < w; i++) max = Math.max(max, count(i));
  const heatOf = (c: number) => (max > 1 ? Math.log(c) / Math.log(max) : w === 1 ? 1 : 0);
  const bars = Math.max(0, Math.min(BREACH_BARS_MAX, Math.floor(unsaid)));
  // Each bar goes ahead of word `at` (1..w; w = after the last), spread with a seeded nudge.
  const at: number[] = [];
  for (let k = 0; k < bars; k++) at.push(w === 0 ? 0 : clamp(1 + Math.floor(((k + 0.15 + 0.7 * noise1(SEED, k)) / bars) * w), 1, w));
  at.sort((a, b) => a - b);
  const out: BreachLine[] = [];
  const bar = (k: number): BreachLine => ({ kind: "bar", chars: 4 + Math.floor(noise1(SEED + 1, k) * 4), heat: 0.4, size: breachSize(0.4) });
  let b = 0;
  for (let i = 0; i <= w; i++) {
    while (b < bars && at[b] === i) out.push(bar(b++));
    if (i < w) {
      const heat = heatOf(count(i));
      out.push({ kind: "word", text: langWord(words[i]!), count: count(i), heat, size: breachSize(heat) });
    }
  }
  if (more > 0) out.push({ kind: "more", text: `+ ${Math.floor(more)} more`, heat: 0, size: 1.2 });
  return out;
}

// --- the timeline ------------------------------------------------------------------------

/**
 * (wave 48b) The breach's beats, ms into the scene. The award's intro (the
 * kind at 900, the title typing from 1100), then the DOS window opens at
 * `cmd` and types its command; the first line prints at `flow`. The lines
 * print over a span (`breachSpan`: 2.5 s for two, 20 s for 400 or more,
 * never longer); the drama around them takes at least `minStage`, so one
 * word gets the whole treatment. Fractions of that stage: the leak
 * (`leak`: the log spills out of the window), the eye (`eye`). Then
 * *Abort, Retry, Censor?* for `ask` ms (✂ Censor sinks at `press`), the
 * scissors cross the screen in `cut` ms, the window switches off, and the
 * summary comes `sum` ms after the snap.
 */
export const BREACH = { kind: 900, title: 1100, cmd: 2600, flow: 4000, span: 20_000, minSpan: 2500, minStage: 6000, leak: 0.36, eye: 0.62, ask: 2000, press: 1500, cut: 800, sum: 1100 } as const;

/** (wave 48b) First line to last, for `n` lines: 0 for one, 2.5 s for two, rising to 20 s at 400 and capped there. */
export function breachSpan(n: number): number {
  if (!(n > 1)) return 0;
  return Math.min(BREACH.span, Math.round(BREACH.minSpan + (BREACH.span - BREACH.minSpan) * Math.sqrt(Math.min(1, (n - 1) / 399))));
}

/** (wave 48b) The breach's beats for `n` lines (ms into the scene). */
export interface BreachTimes {
  n: number;
  /** The first line prints. */
  flow: number;
  /** First line to last (`breachSpan`). */
  span: number;
  /** The last line prints. */
  last: number;
  /** The drama's length from `flow`: at least `BREACH.minStage`. */
  stage: number;
  /** The log spills out of the window. */
  leak: number;
  /** The eye opens in the window. */
  eye: number;
  /** *Abort, Retry, Censor?* */
  ask: number;
  /** ✂ Censor sinks. */
  press: number;
  /** The scissors start across. */
  snap: number;
  /** The scissors are past the right edge: nothing of the breach is left. */
  cut: number;
  /** The summary starts. */
  summary: number;
  /** The print curve's exponent: 1 is even, lower accelerates (the lines rush at the end). */
  p: number;
}

export function breachTimes(n: number): BreachTimes {
  const span = breachSpan(n);
  const stage = Math.max(span, BREACH.minStage);
  const flow = BREACH.flow;
  const ask = flow + stage;
  const snap = ask + BREACH.ask;
  return {
    n,
    flow,
    span,
    last: flow + span,
    stage,
    leak: flow + Math.round(stage * BREACH.leak),
    eye: flow + Math.round(stage * BREACH.eye),
    ask,
    press: ask + BREACH.press,
    snap,
    cut: snap + BREACH.cut,
    summary: snap + BREACH.sum,
    p: 1 - 0.45 * clamp01((n - 4) / 100),
  };
}

/** (wave 48b) When line `i` prints: the first at `flow`, the last at `last`, faster and faster in between. */
export function lineAt(i: number, tm: BreachTimes): number {
  if (tm.n <= 1 || i <= 0) return tm.flow;
  return tm.flow + Math.round(tm.span * Math.min(1, i / (tm.n - 1)) ** tm.p);
}

/** (wave 48b) Each line's moments: it prints (`line`), leaves the window (`leave`), lands in the pile (`land`). */
export interface BreachSchedule {
  line: number[];
  leave: number[];
  land: number[];
  /** The longest flight (ms; 0 without flights). */
  flightMax: number;
}

/** A word's flight from the window to its place (ms). */
export const FLIGHT = { min: 560, spread: 340 } as const;

/**
 * (wave 48b) Every line's schedule. Lines printed before the leak burst out
 * of the window together at the leak, a beat apart (the burst lasts about
 * 2.4 s); a line printed after it leaves 200 ms after it prints. `flights`:
 * the TV's words fly to their place; elsewhere they land as they leave.
 */
export function breachSchedule(tm: BreachTimes, flights: boolean): BreachSchedule {
  const line: number[] = [];
  for (let i = 0; i < tm.n; i++) line.push(lineAt(i, tm));
  const before = line.filter((a) => a < tm.leak).length;
  const stagger = clamp(Math.round(2400 / Math.max(1, before)), 24, 160);
  const leave = line.map((a, i) => (i < before ? tm.leak + i * stagger : a + 200));
  const flight = (i: number) => (flights ? FLIGHT.min + Math.round(noise1(SEED + 2, i) * FLIGHT.spread) : 0);
  const land = leave.map((l, i) => l + flight(i));
  return { line, leave, land, flightMax: flights ? FLIGHT.min + FLIGHT.spread : 0 };
}

/** (wave 48b) How many lines have printed by `t` (the schedule's `line` is sorted). */
export function printedBy(t: number, line: readonly number[]): number {
  let lo = 0;
  let hi = line.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (line[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// --- the window and the pile -------------------------------------------------------------

/** A box in screen fractions (0..1 of the width, 0..1 of the height). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** (wave 48b) The log's window: centred on a landscape screen, wider on a portrait wall; a short night's heap fits under it. */
export const BREACH_WIN: { readonly land: Rect; readonly port: Rect } = {
  land: { x: 0.25, y: 0.29, w: 0.5, h: 0.46 },
  port: { x: 0.06, y: 0.3, w: 0.88, h: 0.3 },
};

/** The window for a screen of this aspect (width / height). */
export function winRect(aspect: number): Rect {
  return aspect < 1 ? BREACH_WIN.port : BREACH_WIN.land;
}

/** Where a line lands: its centre, its box and its font (screen fractions; `fs` of the height), its tilt (radians). */
export interface TideSlot {
  cx: number;
  cy: number;
  w: number;
  h: number;
  fs: number;
  rot: number;
}

/** How the pile packs: the screen's margin, the gap kept round the window, the font range (of the height). */
export const TIDE = { margin: 0.012, gap: 0.014, fsMin: 0.008, fsMax: 0.075, line: 1.22, pad: 1.1 } as const;

/** A line's width in characters as the pile measures it. */
export function lineChars(l: BreachLine): number {
  return l.kind === "bar" ? l.chars : Array.from(l.text).length;
}

/** (wave 48b) The pile, packed: one slot per line, `fs` the base font it fitted at, `fits` false only when even the smallest overflows. */
export interface Tide {
  slots: TideSlot[];
  fs: number;
  fits: boolean;
}

/**
 * Packs the lines from the bottom of the screen up, row by row, around the
 * window (`hole`), at the largest base font (`TIDE.fsMin`..`fsMax`, of the
 * height, and never so big the first row can't fit under the window) that
 * fits them all: 400 lines fill the screen, a dozen sit big at the bottom. A line is `size` × the base font; `charW` is the font's
 * advance in ems (VT323's, measured on the page). Rows are centred in their
 * span with a seeded jitter and tilt, so it reads as a heap, not a page.
 */
export function packTide(lines: readonly BreachLine[], aspect: number, hole: Rect, charW: number): Tide {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
  const cw = charW > 0 && Number.isFinite(charW) ? charW : 0.5;
  const tryAt = (fs: number) => packRows(lines, a, hole, cw, fs);
  // No font so big that the first row can't sit under the window: a short night's heap lands there, not up by the title.
  const below = 1 - TIDE.margin - (hole.y + hole.h + TIDE.gap);
  const biggest = lines.reduce((m, l) => Math.max(m, l.size), 1);
  let lo: number = TIDE.fsMin;
  let hi: number = Math.max(TIDE.fsMin, Math.min(TIDE.fsMax, below / (biggest * TIDE.line)));
  if (tryAt(hi) !== null) lo = hi;
  else {
    if (tryAt(lo) === null) return { slots: packRows(lines, a, hole, cw, lo, true)!, fs: lo, fits: false };
    for (let k = 0; k < 18 && hi - lo > 0.0004; k++) {
      const mid = (lo + hi) / 2;
      if (tryAt(mid) !== null) lo = mid;
      else hi = mid;
    }
  }
  return { slots: tryAt(lo)!, fs: lo, fits: true };
}

/** Rows bottom up at base font `fs`; null when they run out of screen (unless `force`). */
function packRows(lines: readonly BreachLine[], aspect: number, hole: Rect, charW: number, fs: number, force = false): TideSlot[] | null {
  const m = TIDE.margin;
  const top = { y: hole.y - TIDE.gap, b: hole.y + hole.h + TIDE.gap };
  const left = hole.x - TIDE.gap;
  const right = hole.x + hole.w + TIDE.gap;
  const width = (l: BreachLine) => ((lineChars(l) + TIDE.pad) * charW * fs * l.size) / aspect;
  const height = (l: BreachLine) => fs * l.size * TIDE.line;
  const slots: TideSlot[] = new Array(lines.length);
  let y = 1 - m;
  let i = 0;
  let row = 0;
  while (i < lines.length) {
    const h0 = height(lines[i]!);
    if (y - h0 < m && !force) return null;
    // The row's spans: the whole width, or either side of the window when the row crosses it.
    const crosses = y - h0 < top.b && y > top.y;
    const spans = crosses ? [[m, left], [right, 1 - m]] : [[m, 1 - m]];
    let rowH = 0;
    let placedAny = false;
    for (const [x0, x1] of spans) {
      const room = x1! - x0!;
      if (room <= 0) continue;
      const start = i;
      let used = 0;
      while (i < lines.length) {
        const wi = width(lines[i]!);
        if (used + wi > room && (used > 0 || !force)) break;
        used += wi;
        rowH = Math.max(rowH, height(lines[i]!));
        i++;
        if (used > room) break; // forced: an oversized line alone
      }
      if (i === start) continue;
      placedAny = true;
      // Centre what fits in the span, with a seeded nudge of the leftover, the
      // row's first (most censored) in the middle and the rest alternating out
      // to either side: a mound, its biggest words clear of the corners.
      const slack = Math.max(0, room - used);
      let x = x0! + slack * (0.5 + (noise1(SEED + 3, row * 2 + (x0 === m ? 0 : 1)) - 0.5) * 0.6);
      for (const k of centreOut(start, i)) {
        const l = lines[k]!;
        const wk = width(l);
        const hk = height(l);
        slots[k] = { cx: x + wk / 2, cy: y - rowH / 2 + (noise1(SEED + 4, k) - 0.5) * 0.18 * (rowH - hk * 0.5), w: wk, h: hk, fs: fs * l.size, rot: (noise1(SEED + 5, k) - 0.5) * 0.14 };
        x += wk;
      }
    }
    if (!placedAny) {
      // Nothing fits even alone in this row's spans (a huge word beside the window): try the next row up.
      if (force) return slots.map((s) => s ?? { cx: 0.5, cy: -1, w: 0, h: 0, fs, rot: 0 });
      y -= h0 * 0.5;
      if (y < m) return null;
      continue;
    }
    y -= rowH * 1.06;
    row++;
  }
  return slots;
}

/** `start..end-1` in the order a row lays them out left to right: the first in the middle, the rest alternating out. */
export function centreOut(start: number, end: number): number[] {
  const left: number[] = [];
  const right: number[] = [];
  for (let k = start; k < end; k++) ((k - start) % 2 === 0 ? left : right).push(k);
  return [...left.reverse(), ...right];
}

/** (wave 48b) Where a line leaves the window for its slot: the window's edge, towards the slot. */
export function spawnPoint(slot: TideSlot, win: Rect): { x: number; y: number } {
  const cx = win.x + win.w / 2;
  const cy = win.y + win.h / 2;
  const dx = slot.cx - cx;
  const dy = slot.cy - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const s = Math.min(dx === 0 ? Infinity : win.w / 2 / Math.abs(dx), dy === 0 ? Infinity : win.h / 2 / Math.abs(dy), 1);
  return { x: cx + dx * s * 0.9, y: cy + dy * s * 0.9 };
}

/** (wave 48b) A flying line at `k` (0..1 of its flight): a thrown arc from the window to its slot, growing, spinning to rest. */
export function flightAt(slot: TideSlot, win: Rect, i: number, k: number): { x: number; y: number; scale: number; rot: number } {
  const p = clamp01(k);
  const from = spawnPoint(slot, win);
  const dx = slot.cx - from.x;
  const dy = slot.cy - from.y;
  const bend = (noise1(SEED + 6, i) - 0.5) * 0.5;
  const cx = from.x + dx * 0.5 - dy * bend;
  const cy = from.y + dy * 0.5 + dx * bend - 0.14;
  const q = ease.inOutQuad(p);
  const u = 1 - q;
  const spin = (noise1(SEED + 7, i) - 0.5) * 4 * Math.PI;
  return {
    x: u * u * from.x + 2 * u * q * cx + q * q * slot.cx,
    y: u * u * from.y + 2 * u * q * cy + q * q * slot.cy,
    scale: lerp(0.35, 1, ease.outCubic(p)),
    rot: slot.rot + spin * (1 - ease.outCubic(p)),
  };
}

// --- the window's fit, the eye -----------------------------------------------------------

/** A smooth seeded wobble in 0..1 (value noise between integer samples). */
export function wobble(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  return lerp(noise1(seed, i), noise1(seed, i + 1), s);
}

/** How hard the window strains at `t` (0..1.5): from a fifth into the stage to the leak, harder to the eye, calmer while it asks. */
export function strainAt(t: number, tm: BreachTimes): number {
  if (t < tm.flow || t >= tm.snap) return 0;
  const start = tm.flow + tm.stage * 0.18;
  let a = t < tm.leak ? 0.6 * progress(t, start, tm.leak - start) : t < tm.eye ? 0.6 + 0.9 * progress(t, tm.leak, tm.eye - tm.leak) : 1.5;
  if (t >= tm.ask) a *= 1 - 0.6 * progress(t, tm.ask, 600);
  return a;
}

/**
 * (wave 48b) The window's tremble at `t`: `x` / `y` in vmin, `s` its scale
 * (the TV's breathes and bulges once the eye is open), `sk` its skew (deg).
 * A wall trembles less and never scales. Reduced motion: none.
 */
export function windowShake(t: number, tm: BreachTimes, lite: boolean): { x: number; y: number; s: number; sk: number } {
  const a = strainAt(t, tm);
  if (a <= 0) return { x: 0, y: 0, s: 1, sk: 0 };
  const amp = (lite ? 0.3 : 0.55) * a;
  const x = amp * (wobble(SEED + 8, t / 70) * 2 - 1);
  const y = amp * (wobble(SEED + 9, t / 70) * 2 - 1);
  if (lite) return { x, y, s: 1, sk: 0 };
  const breathe = t >= tm.leak ? 0.018 * (a / 1.5) * (0.5 + 0.5 * Math.sin(((t - tm.leak) / 1300) * Math.PI * 2)) : 0;
  const bulge = t >= tm.eye ? 0.035 * ease.outCubic(progress(t, tm.eye, 900)) * (t >= tm.ask ? 1 - progress(t, tm.ask, 600) : 1) : 0;
  return { x, y, s: 1 + breathe + bulge, sk: 1.1 * (a / 1.5) * Math.sin((t / 1900) * Math.PI * 2) };
}

/** (wave 48b) The window switching off once the scissors cross its middle: flat to a line, then to nothing (an old CRT). */
export function windowOff(t: number, tm: BreachTimes): { sx: number; sy: number; o: number } {
  const at = tm.snap + BREACH.cut * 0.4;
  return {
    sy: 1 - 0.985 * ease.inCubic(progress(t, at, 200)),
    sx: 1 - ease.inCubic(progress(t, at + 200, 180)),
    o: 1 - progress(t, at + 260, 140),
  };
}

/** (wave 48b) The eye's lids, 0 (shut) to 1: open over 0.9 s from `eye`, a blink at +2.6 s and +5.4 s while it has time. */
export function eyeOpen(t: number, tm: BreachTimes): number {
  if (t < tm.eye) return 0;
  let k = ease.outCubic(progress(t, tm.eye, 900));
  for (const b of [tm.eye + 2600, tm.eye + 5400]) {
    if (b + 400 > tm.ask) continue;
    const down = progress(t, b, 110);
    const up = progress(t, b + 110, 170);
    k *= 1 - 0.96 * (down - up);
  }
  return k;
}

/** (wave 48b) Where the eye looks (-1..1 each way): at you first, then darting to a new spot every 1.1 s; back at you while it asks. */
export function eyeLook(t: number, tm: BreachTimes): { x: number; y: number } {
  if (t < tm.eye) return { x: 0, y: 0 };
  const target = (k: number) => (k <= 0 ? { x: 0, y: 0 } : { x: (noise1(SEED + 10, k) * 2 - 1) * 0.75, y: (noise1(SEED + 11, k) * 2 - 1) * 0.4 });
  const e = t - tm.eye;
  const k = Math.floor(e / 1100);
  const m = ease.outCubic(progress(e - k * 1100, 0, 160));
  const a = target(k - 1);
  const b = target(k);
  const at = { x: lerp(a.x, b.x, m), y: lerp(a.y, b.y, m) };
  const home = t >= tm.ask ? ease.outCubic(progress(t, tm.ask, 300)) : 0;
  return { x: lerp(at.x, 0, home), y: lerp(at.y, 0, home) };
}

// --- the notes and the cut ---------------------------------------------------------------

/** A note's place: left / top / width in % of the stage. */
export interface NotePos {
  x: number;
  y: number;
  w: number;
}

/** (wave 48b) The deadpan system notes (their words: `LANG_COPY.notes`). */
export type BreachNoteId = "overflow" | "aloud" | "panic" | "seen" | "dll";

export interface BreachNote {
  id: BreachNoteId;
  /** When it pops up: a fraction of the stage from `flow`. */
  at: number;
  icon: "warning" | "error" | "info";
  /** On a landscape screen / a portrait wall. */
  land: NotePos;
  port: NotePos;
  /** A wall shows it too. */
  lite: boolean;
  /** Reduced motion shows it too. */
  calm: boolean;
}

/**
 * (wave 48b) The notes, in order: five on the TV, three on a wall, two when
 * calm. Each is up for `noteLife` and then OK'd away, and none sits in the
 * screen's bottom quarter, where a short night's heap lands.
 */
export const BREACH_NOTES: readonly BreachNote[] = [
  { id: "overflow", at: BREACH.leak, icon: "warning", land: { x: 3, y: 5, w: 27 }, port: { x: 4, y: 3, w: 74 }, lite: true, calm: true },
  { id: "aloud", at: 0.47, icon: "info", land: { x: 70, y: 9, w: 27 }, port: { x: 22, y: 13, w: 74 }, lite: true, calm: true },
  { id: "panic", at: 0.55, icon: "error", land: { x: 11, y: 37, w: 26 }, port: { x: 4, y: 33, w: 74 }, lite: false, calm: false },
  { id: "seen", at: BREACH.eye + 0.02, icon: "warning", land: { x: 36.5, y: 3, w: 27 }, port: { x: 13, y: 23, w: 74 }, lite: true, calm: false },
  { id: "dll", at: 0.8, icon: "error", land: { x: 63, y: 41, w: 28 }, port: { x: 22, y: 45, w: 74 }, lite: false, calm: false },
];

/** When a note pops up (ms into the scene). */
export function noteAt(n: BreachNote, tm: BreachTimes): number {
  return tm.flow + Math.round(tm.stage * n.at);
}

/** How long a note stays up (ms): about a sixth of the stage, 2.4–3.6 s. Its OK sinks 450 ms before it closes. */
export function noteLife(tm: BreachTimes): number {
  return clamp(Math.round(tm.stage * 0.16), 2400, 3600);
}

/** (wave 48b) The scissors' x at `t` (screen fraction): off the left edge at the snap, off the right at `cut`. */
export function scissorsX(t: number, tm: BreachTimes): number {
  return lerp(-0.08, 1.08, ease.inOutQuad(progress(t, tm.snap, BREACH.cut)));
}

/** (wave 48b) When the scissors pass screen x (the inverse of `scissorsX`). */
export function cutAt(x: number, tm: BreachTimes): number {
  const y = clamp01((x + 0.08) / 1.16);
  const k = y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt((1 - y) / 2);
  return tm.snap + k * BREACH.cut;
}

/** (wave 48b) The censored count shown while the log prints: `c` scaled by the share of lines printed. */
export function tallyAt(c: number, printed: number, n: number): number {
  if (n <= 0) return c;
  return Math.round((c * Math.min(printed, n)) / n);
}
