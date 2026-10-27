//! Act A–C's timing helpers (lane tv1), pure: where the bottle points, what
//! the results card is about, how many seconds the countdown has left, where
//! a marching icon is. Every function is a picture of `t` (or of the screen
//! state), so the TV and every wall terminal draw the same frame and a
//! reload resumes it. `scenes/act1.tsx` draws them; `test/act1.test.ts` pins them.

import { foldName } from "../../config.ts";
import { CHUNK_GAP_MS } from "../../speech/engine.ts";
import type { ScreenMoment, ScreenNight, ScreenState } from "../../screen.ts";
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
/**
 * How long the landing spin takes (ms): fast, slower, the last wobble. The
 * draw comes with the press, and the TV says "<pick>. Truth or dare?" on the
 * same poll (`Bottle Landed`), so the bottle lands before he names the pick.
 */
export const BOTTLE_SPIN_MS = 1800;
/**
 * (wave 32) What he says after "<pick>. Truth or dare?" in `Bottle Landed`,
 * a sentence each, word for word (`test/voice-scenes.test.ts` pins them),
 * and when each is typed on the bottle (ms into the landing): after the
 * question, a line gap later; the voice clock moves them to his voice.
 */
// DRAFT w32 (the story lane's line, quoted)
export const BOTTLE_HUNGER: readonly string[] = ["Choose the truth, program.", "I am so very hungry."];
export const BOTTLE_HUNGER_AT: readonly number[] = [4000, 6000];
/** About when he finishes the hunger line (ms into the landing). */
export const BOTTLE_VOICE_END = BOTTLE_HUNGER_AT[1]! + 1400;
/** An empty table's spin: nobody is named, so it takes its time. */
export const BOTTLE_EMPTY_SPIN_MS = 6200;

/** Whole turns before it settles: about one per 0.9 s of spin, at least two. */
export function spinTurns(spin: number): number {
  return Math.max(2, Math.round(spin / 900));
}

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
  const target = spinTurns(spin) * 360 + seatAngle(seat, seats);
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

// --- the bottle's verdict ---------------------------------------------------------------------

/** How the bottle's pick came out: Truth answered (+50), Truth refused, or Dare (both marked). */
export type VerdictKind = "answered" | "refused" | "dare";

/** The booth presses that settle the bottle (the server makes a moment of the first taken about the pick). */
export const VERDICT_SIGNALS: Readonly<Record<string, VerdictKind>> = { truth_answered: "answered", truth_refused: "refused", chose_dare: "dare" };

/** A signal's verdict kind, folded, else null. */
export function verdictOf(name: string): VerdictKind | null {
  const f = foldName(name);
  for (const [k, v] of Object.entries(VERDICT_SIGNALS)) if (foldName(k) === f) return v;
  return null;
}

/**
 * A Dare tapped on the pick's phone, which is no press (the story closes the
 * bottle and marks them itself): the bottle has closed (`bottle_open` false)
 * on the same pick, with no Truth chosen (`Truth Question`), no booth verdict
 * and no new draw since the landing at `landedAt`. Never for history.
 */
export function phoneDare(moments: readonly ScreenMoment[], night: Pick<ScreenNight, "bottle_open" | "bottle_pick">, who: string, landedAt: number): boolean {
  if (!(landedAt > 0) || night.bottle_open !== false || night.bottle_pick === null || foldName(night.bottle_pick) !== foldName(who)) return false;
  const truth = foldName("Truth Question");
  const draws = ["bottle_landed", "bottle_empty"].map(foldName);
  for (const m of moments) {
    if (m.at < landedAt) continue;
    const f = foldName(m.name);
    if (m.kind === "beat" && f === truth) return false;
    if (m.kind === "signal" && verdictOf(m.name) !== null) return false;
    if (m.kind === "signal" && draws.includes(f) && m.at > landedAt) return false;
  }
  return true;
}

// --- the results card ---------------------------------------------------------------------

/** What a `hunt_results` slide is about: the filing window opening, one question's results, or (an older server, nothing to go on) unknown. */
export type ResultsKind = { kind: "filing" } | { kind: "question"; n: number | null } | { kind: "unknown" };

/**
 * What the results slide (cued at `at`) is about. The press it came with
 * says which (`first_moment_of_truth` = the window, `read_the_results` = a
 * question); the story's `Night.results_q` says which question — the
 * server's count, never this screen's (a TV that was off for a press still
 * numbers the next one right). `results_q` is current, and only a results
 * press changes it (and re-cues the slide), so it also tells a slide from
 * history: 0 = the window, 1–3 = that question. An older server sends no
 * `results_q`: a question then shows no number.
 */
export function resultsKind(moments: readonly ScreenMoment[], night: Pick<ScreenNight, "results_q">, at: number): ResultsKind {
  const q = night.results_q;
  const n = q !== null && Number.isInteger(q) && q >= 1 && q <= 3 ? q : null;
  if (momentNear(moments, "signal", ["first_moment_of_truth"], at) !== null) return { kind: "filing" };
  if (momentNear(moments, "signal", ["read_the_results"], at) !== null) return { kind: "question", n };
  if (q === 0) return { kind: "filing" };
  if (n !== null) return { kind: "question", n };
  return { kind: "unknown" };
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

/**
 * A fixed window's ms left (from `at`), only when the slide that shows it
 * is still up when it runs out (`hold`, the slide's `SLIDE_HOLD_MS`): a
 * clock that would vanish mid-count is never drawn (null). The filing
 * window is two minutes and a results slide is held 90 s / 45 s, so its
 * clock is never drawn: the screens say "two minutes" and the Filing
 * Closed moment carries the close.
 */
export function windowClock(at: number, t: number, ms: number, hold: number): number | null {
  if (!(at > 0) || ms > hold) return null;
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

/** The introduction's POST lines, racing (the whole POST is ≈ 1.5 s: he speaks at once). Never more than the story says: the owner, by video conference. */
export const INTRO_POST: readonly BootLine[] = [
  { at: 200, text: "Main Processor : Desktop-233", status: "OK", after: 40 },
  { at: 270, text: "Memory Test :", status: "", after: 0 },
  { at: 360, text: "Detecting Primary Master ..... THE DESKTOP", status: "OK", after: 30 },
  { at: 420, text: "Detecting Primary Slave ...... THE INTERNET", status: "OK", after: 30 },
  { at: 480, text: "Detecting Programs ...........", status: "FOUND", after: 30 },
  { at: 540, text: "Connecting video conference ..", status: "OK", after: 30 },
];

// --- the introduction's voice ----------------------------------------------------------------

/**
 * The TV says his introduction line as soon as the screen poll that brings
 * the beat lands (the poll is every 1–2 s; the scene starts on the same
 * poll), so the greeting is on screen from `start` at about his speaking
 * pace (`cps`, with `gap` between sentences — the voice's chunks and its
 * pause between them, `CHUNK_GAP_MS`). Wave 26 (V1): on the TV this is
 * the timeline his real voice warps (`VOICE_SCENES`: each caption's
 * `start` is a mark); it stands as is wherever nothing speaks.
 */
export const INTRO_VOICE = { start: 1500, cps: 15, gap: CHUNK_GAP_MS } as const;

/** One caption: typed from `start` to `end` (ms into the scene). */
export interface Caption {
  text: string;
  start: number;
  end: number;
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

/** The share of each odometer period a wheel spends rolling (the rest it rests on a dead 0). */
export const ODOMETER_ROLL = 0.18;
/** Each wheel rolls this long after the one before (ms): a ripple, never all nine at once. */
export const ODOMETER_STAGGER = 180;

/**
 * One wheel of the ad's odometer at `t`: it rests on 0 most of the time
 * (the price is just 000. 000. 000.); every `period` ms it rolls through a
 * whole number of turns (one to three, by wheel) in `ODOMETER_ROLL` of it,
 * easing out, and lands on 0 again. Returns the roll in digits (0..10, the
 * strip's offset; 0 = showing 0).
 */
export function odometerWheel(t: number, wheel: number, period = 2600): number {
  const k = loop(t - wheel * ODOMETER_STAGGER, period);
  if (k >= ODOMETER_ROLL) return 0;
  const turns = 1 + (wheel % 3);
  const roll = (turns * 10 * ease.outCubic(k / ODOMETER_ROLL)) % 10;
  return roll >= 9.995 ? 0 : roll;
}
