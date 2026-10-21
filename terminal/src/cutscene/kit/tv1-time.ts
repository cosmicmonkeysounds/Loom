//! Act A–C's timing helpers (lane tv1), pure: where the bottle points, what
//! the results card is about, how many seconds the countdown has left, where
//! a marching icon is. Every function is a picture of `t` (or of the screen
//! state), so the TV and every wall terminal draw the same frame and a
//! reload resumes it. `scenes/act1.tsx` draws them; `test/act1.test.ts` pins them.

import { foldName } from "../../config.ts";
import type { ScreenMoment, ScreenState } from "../../screen.ts";
import { clamp01, ease, hashSeed, lerp, loop, noise1, progress } from "./time.ts";

// --- a take that ends early -----------------------------------------------------------

/**
 * A one-shot end: true on the first frame `t` reaches `end` (`prev` the
 * last frame's `t`, null on the first — so a reload past the end ends at
 * once). A wall's take is shorter than its scene's `ms` (the TV's): it ends
 * itself (`done()`) rather than drawing nothing until the TV's length is up.
 */
export function endDue(prev: number | null, t: number, end: number): boolean {
  return t >= end && (prev === null || prev < end);
}

// --- the bottle -----------------------------------------------------------------------

/** How many seats round the bottle's table (the program icons). */
export const BOTTLE_SEATS = 12;
/** How long the landing spin takes (ms): fast, slower, the last wobble. */
export const BOTTLE_SPIN_MS = 6200;
/** Whole turns before it settles. */
const BOTTLE_TURNS = 7;

/** The seat the bottle lands on for a program (the same on every screen; never seat 0, where an empty table points). */
export function bottleSeat(who: string | null, seats = BOTTLE_SEATS): number {
  if (who === null || who.trim() === "") return 0;
  return 1 + (hashSeed(foldName(who)) % (seats - 1));
}

/** A seat's angle (degrees clockwise from 12 o'clock). */
export function seatAngle(seat: number, seats = BOTTLE_SEATS): number {
  return (((seat % seats) + seats) % seats) * (360 / seats);
}

/**
 * The bottle's turn (degrees, clockwise, the neck from 12 o'clock) at `t`
 * ms into a landing spin that ends on `seat`: a fast start, a long slow
 * settle (`outCubic` over `BOTTLE_SPIN_MS`), a last overshoot that rocks back.
 * At and after the end it points exactly at the seat.
 */
export function bottleLanding(t: number, seat: number, seats = BOTTLE_SEATS, spin = BOTTLE_SPIN_MS): number {
  const target = BOTTLE_TURNS * 360 + seatAngle(seat, seats);
  if (t >= spin) return target;
  if (t <= 0) return 0;
  const main = spin * 0.86;
  if (t < main) return target * ease.outCubic(t / main) + 9 * ease.outQuad(t / main);
  // The rock: past by 9°, then back onto the seat.
  const k = progress(t, main, spin - main);
  return target + 9 * (1 - ease.inOutQuad(k));
}

/** A free spin (no pick yet): two turns a second, never quite steady. */
export function bottleFree(t: number): number {
  return (t / 1000) * 720 + 40 * Math.sin(t / 900);
}

// --- reading the moments -------------------------------------------------------------------

/**
 * The newest moment of `kind` named one of `names` (folded) within `slack`
 * ms either side of `at` — the moment a slide cue arrived with (the press
 * that put `truth_or_dare` up also drew the bottle). `at` 0 (history): none.
 */
export function momentNear(moments: readonly ScreenMoment[], kind: ScreenMoment["kind"], names: readonly string[], at: number, slack = 3000): ScreenMoment | null {
  if (!(at > 0)) return null;
  const want = names.map(foldName);
  let best: ScreenMoment | null = null;
  for (const m of moments) {
    if (m.kind !== kind || !want.includes(foldName(m.name))) continue;
    if (Math.abs(m.at - at) > slack) continue;
    if (best === null || m.seq > best.seq) best = m;
  }
  return best;
}

/** A later moment of `kind` named one of `names` (seq order), after `at` — "Filing Closed" after the window opened. */
export function momentAfter(moments: readonly ScreenMoment[], kind: ScreenMoment["kind"], names: readonly string[], at: number): ScreenMoment | null {
  if (!(at > 0)) return null;
  const want = names.map(foldName);
  for (const m of moments) if (m.kind === kind && m.at >= at && want.includes(foldName(m.name))) return m;
  return null;
}

// --- the results card ---------------------------------------------------------------------

/** What a `hunt_results` slide is about: the filing window opening, one question's results, or (history / an older server) unknown. */
export type ResultsKind = { kind: "filing" } | { kind: "question"; n: number | null } | { kind: "unknown" };

/** The results presses this TV has seen, per story (`announceEpoch`): question n is the n-th. */
export interface ResultsMemory {
  epoch: string | null;
  /** The `read_the_results` moments' seqs, in order. */
  seqs: number[];
  /** Each results slide resolved so far, by its `at` (a reload keeps its card). */
  slides: Record<string, ResultsKind>;
}

export const EMPTY_RESULTS: ResultsMemory = { epoch: null, seqs: [], slides: {} };

/**
 * Resolve a results slide (at `at`) against the moments, remembering what
 * it learns. The window is `first_moment_of_truth`; a question is a
 * `read_the_results` press, numbered by how many this TV has seen this
 * story (shown only for 1–3: a TV that missed a press shows no number, it
 * never shows a wrong one past three). Pure: returns the new memory.
 */
export function resolveResults(mem: ResultsMemory, epoch: string | null, moments: readonly ScreenMoment[], at: number): { kind: ResultsKind; mem: ResultsMemory } {
  let m: ResultsMemory = mem.epoch === epoch ? mem : { epoch, seqs: [], slides: {} };
  // Learn every results press on the wire (they arrive in seq order).
  for (const x of moments) {
    if (x.kind === "signal" && foldName(x.name) === foldName("read_the_results") && !m.seqs.includes(x.seq)) m = { ...m, seqs: [...m.seqs, x.seq].sort((a, b) => a - b) };
  }
  const key = String(at);
  const known = m.slides[key];
  if (known !== undefined) return { kind: known, mem: m };
  if (!(at > 0)) return { kind: { kind: "unknown" }, mem: m };
  let kind: ResultsKind | null = null;
  if (momentNear(moments, "signal", ["first_moment_of_truth"], at) !== null) kind = { kind: "filing" };
  else {
    const q = momentNear(moments, "signal", ["read_the_results"], at);
    if (q !== null) {
      const n = m.seqs.indexOf(q.seq) + 1;
      kind = { kind: "question", n: n >= 1 && n <= 3 ? n : null };
    }
  }
  if (kind === null) return { kind: { kind: "unknown" }, mem: m };
  return { kind, mem: { ...m, slides: { ...m.slides, [key]: kind } } };
}

// --- countdowns -------------------------------------------------------------------------------

/**
 * ms left on the screen state's countdown at a scene's frame, when it is
 * `which` (`hunt`, `bingo`, …), else null. The server's `remaining`
 * (seconds at its `now`), less the time since — the frame is `at + t`
 * (history: the answer's own `now`).
 */
export function countdownLeft(state: Pick<ScreenState, "countdown" | "remaining" | "now">, which: readonly string[], at: number, t: number): number | null {
  if (state.countdown === null || state.remaining === null || !which.includes(state.countdown)) return null;
  const frame = at > 0 ? at + t : state.now;
  return Math.max(0, state.remaining * 1000 - Math.max(0, frame - state.now));
}

/** A fixed window's ms left (the two-minute filing window from `at`). */
export function windowLeft(at: number, t: number, ms: number): number | null {
  if (!(at > 0)) return null;
  return Math.max(0, ms - t);
}

// --- marching icons --------------------------------------------------------------------------

/** One icon walking in from an edge to the centre (0..1 of the area). */
export interface Marcher {
  i: number;
  x: number;
  y: number;
  /** 0 just in … 1 arrived (it fades out as it arrives). */
  k: number;
  /** Which icon kind (0..n-1, by seed). */
  kind: number;
  alpha: number;
}

/**
 * `count` icons, each on its own `period` ms trip from a point on the edge
 * to the centre, staggered so there is always a stream. Pure, a loop:
 * position = f(t). Under reduced motion they hold still at mid-trip.
 */
export function marchersAt(t: number, count: number, period: number, seed = 1, reduced = false): Marcher[] {
  const out: Marcher[] = [];
  for (let i = 0; i < count; i++) {
    const phase = noise1(seed, i * 5);
    const k = reduced ? 0.45 + 0.1 * noise1(seed, i * 5 + 4) : loop(t + phase * period, period);
    const ang = noise1(seed, i * 5 + 1) * Math.PI * 2;
    // The edge point: the unit square's border along that bearing.
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const s = 0.5 / Math.max(Math.abs(dx), Math.abs(dy));
    const ex = 0.5 + dx * s * 1.08;
    const ey = 0.5 + dy * s * 1.08;
    const kk = ease.inQuad(k);
    const x = lerp(ex, 0.5 + dx * 0.06, kk);
    const y = lerp(ey, 0.5 + dy * 0.06, kk);
    const alpha = clamp01(k * 6) * clamp01((1 - k) * 5);
    out.push({ i, x, y, k, kind: Math.floor(noise1(seed, i * 5 + 2) * 1e6), alpha });
  }
  return out;
}

// --- sounds on a loop ------------------------------------------------------------------------

/**
 * The cue times of a repeating sound near `t` (every `period` ms from
 * `start`, before `end`): the last two due, so `useSfxCues` fires each
 * once as `t` crosses it — a held scene keeps its accents without a list
 * an hour long.
 */
export function periodicCues(t: number, start: number, period: number, end = Number.POSITIVE_INFINITY): number[] {
  if (period <= 0 || t < start) return [];
  const n = Math.floor((Math.min(t, end) - start) / period);
  const out: number[] = [];
  for (let k = Math.max(0, n - 1); k <= n; k++) {
    const at = start + k * period;
    if (at <= t && at < end) out.push(at);
  }
  return out;
}

// --- the boot -----------------------------------------------------------------------------

/** The POST memory count (KB) at `t`: 64 K steps up to `kb` over `dur` ms. */
export function memoryCount(t: number, start: number, dur: number, kb = 65_536): number {
  const k = progress(t, start, dur);
  return Math.min(kb, Math.floor((k * kb) / 64) * 64);
}

/** A boot screen line: shown from `at` (ms into the scene), typed at `cps`. */
export interface BootLine {
  at: number;
  text: string;
  /** Right-aligned status that appears `after` ms later ("OK", "FOUND"). */
  status?: string;
  after?: number;
}

/** The introduction's POST lines, racing (the whole POST is ≈ 1.5 s: he speaks at once). Never more than the story says: he keeps the computer running. */
export const INTRO_POST: readonly BootLine[] = [
  { at: 330, text: "Main Processor : Desktop-233", status: "OK", after: 60 },
  { at: 480, text: "Memory Test :", status: "", after: 0 },
  { at: 1000, text: "Detecting Primary Master ..... THE DESKTOP", status: "OK", after: 40 },
  { at: 1120, text: "Detecting Primary Slave ...... THE INTERNET", status: "OK", after: 40 },
  { at: 1240, text: "Detecting Programs ...........", status: "FOUND", after: 60 },
  { at: 1360, text: "Loading AI helper ............", status: "OK", after: 40 },
];

// --- the introduction's voice ----------------------------------------------------------------

/**
 * The TV says his introduction line as soon as the screen poll that brings
 * the beat lands (the poll is every 1–2 s; the scene starts on the same
 * poll), so the greeting is on screen from `start` at about his speaking
 * pace (`cps`, with `gap` between sentences — the voice's chunks).
 */
export const INTRO_VOICE = { start: 1500, cps: 15, gap: 350 } as const;

/** One caption: typed from `start` to `end` (ms into the scene). */
export interface Caption {
  text: string;
  start: number;
  end: number;
}

/** A line's sentences, as the voice splits them. */
export function sentencesOf(line: string): string[] {
  return (line.match(/[^.!?]+[.!?]+/gu) ?? [line]).map((x) => x.trim()).filter((x) => x !== "");
}

/** Captions for `parts` said one after another from `v.start` (pure). */
export function introCaptions(parts: readonly string[], v: { start: number; cps: number; gap: number } = INTRO_VOICE): Caption[] {
  const out: Caption[] = [];
  let at = v.start;
  for (const text of parts) {
    const end = at + (text.length * 1000) / Math.max(1, v.cps);
    out.push({ text, start: at, end });
    at = end + v.gap;
  }
  return out;
}

/** The caption up at `t`: the latest begun (it stays up until the next begins), null before the first. */
export function captionAt(captions: readonly Caption[], t: number): Caption | null {
  let cur: Caption | null = null;
  for (const c of captions) if (t >= c.start) cur = c;
  return cur;
}

/** Which of `lines` are showing at `t`. */
export function bootLinesAt(lines: readonly BootLine[], t: number): BootLine[] {
  return lines.filter((l) => t >= l.at);
}

// --- glyphs -----------------------------------------------------------------------------------

/** A column of the data rain: its x (0..1), its head (0..1.4 of the height) and its glyphs (0/1, a seeded stream). */
export function rainColumn(t: number, i: number, seed: number, speed = 0.18): { x: number; head: number; chars: string } {
  const x = noise1(seed, i * 3);
  const v = speed * (0.6 + noise1(seed, i * 3 + 1));
  const head = loop(t * v * 0.001 + noise1(seed, i * 3 + 2), 1) * 1.4;
  let chars = "";
  const tick = Math.floor(t / 140);
  for (let j = 0; j < 14; j++) chars += noise1(seed + i, j * 31 + Math.floor((tick + j * 7) / 5)) < 0.5 ? "0" : "1";
  return { x, head, chars };
}

// --- the bottle's ticks and the seat under its neck ---------------------------------------------

/** The seat the neck is over at `angle` (nearest; degrees clockwise from 12). */
export function seatUnder(angle: number, seats = BOTTLE_SEATS): number {
  const step = 360 / seats;
  return ((Math.round(angle / step) % seats) + seats) % seats;
}

/** When the landing spin's neck crosses each seat boundary (ms), at least `gap` ms apart — a tick per seat, never a buzz. */
export function bottleTicks(seat: number, seats = BOTTLE_SEATS, spin = BOTTLE_SPIN_MS, gap = 70): number[] {
  const out: number[] = [];
  const step = 360 / seats;
  let last = Number.NEGATIVE_INFINITY;
  let prev = Math.floor(bottleLanding(0, seat, seats, spin) / step + 0.5);
  for (let t = 10; t <= spin; t += 10) {
    const k = Math.floor(bottleLanding(t, seat, seats, spin) / step + 0.5);
    if (k !== prev && t - last >= gap) {
      out.push(t);
      last = t;
    }
    prev = k;
  }
  return out;
}

// --- a logo bouncing round the frame -----------------------------------------------------------

/**
 * A screensaver bounce: a box `bw` × `bh` (0..1 of the frame) at `speed`
 * frames a second, reflecting off every edge — a triangle wave on each
 * axis, the two periods kept apart so it never quite hits the corner.
 */
export function bounceAt(t: number, bw: number, bh: number, speed = 0.11, seed = 1): { x: number; y: number } {
  const tri = (v: number) => {
    const k = loop(v, 2);
    return k < 1 ? k : 2 - k;
  };
  const s = (t / 1000) * speed;
  const ox = noise1(seed, 1) * 2;
  const oy = noise1(seed, 2) * 2;
  return { x: tri(s / Math.max(0.01, 1 - bw) + ox) * (1 - bw), y: tri((s * 1.37) / Math.max(0.01, 1 - bh) + oy) * (1 - bh) };
}

// --- the odometer ------------------------------------------------------------------------------

/**
 * One wheel of the ad's odometer at `t`: it rolls (a digit's worth every
 * `per` ms, faster for later wheels) and every `period` ms snaps back to a
 * dead 0 for a beat — a price that is just 000. Returns the roll in digits
 * (0..10, the strip's offset).
 */
export function odometerWheel(t: number, wheel: number, period = 2600, per = 90): number {
  const k = loop(t + wheel * 37, period);
  if (k > 0.72) return 0; // stopped on 0
  const spin = (k * period) / Math.max(10, per - wheel * 6);
  return spin % 10;
}
