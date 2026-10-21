//! Act D–E's timelines, pure (wave 17, lane tv2): what the scenes in
//! `scenes/act2.tsx` read off the live screen state and the clock — the
//! Y2K hour's escalation, the round-two number, which overshare played,
//! the King's bar, the pong ball's flight, the drifting popups — each a
//! function of its inputs only, so a reload lands on the same frame and
//! the tests can pin them.

import { foldName } from "../../config.ts";
import type { ScreenKing, ScreenMoment, ScreenNight, ScreenState, ScreenVoice } from "../../screen.ts";
import { SLIDE_HOLD_MS } from "../../slides.ts";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import { clamp01, ease, lerp, noise1, progress } from "./time.ts";

// --- the live clock ------------------------------------------------------------------

/** ms since the screen state arrived, as the poll would count it: never
 *  negative, and 0 past a minute (an answer that old is a frozen poll — or
 *  the preview's made-up 1999 state, whose `receivedAt` is its own `now`). */
export function sinceAnswer(state: Pick<ScreenState, "receivedAt">, localNow: number): number {
  const d = localNow - state.receivedAt;
  return d < 0 || d > 60_000 ? 0 : d;
}

/** The server's clock now (`state.now` + the time since the answer). */
export function liveNow(state: Pick<ScreenState, "now" | "receivedAt">, localNow: number): number {
  return state.now + sinceAnswer(state, localNow);
}

/** A named countdown's seconds left now (`kind` must be the one running), else null — as `screenLayers` counts it. */
export function liveRemaining(state: Pick<ScreenState, "countdown" | "remaining" | "receivedAt">, kind: string, localNow: number): number | null {
  if (state.countdown !== kind || state.remaining === null) return null;
  return Math.max(0, state.remaining - Math.floor(sinceAnswer(state, localNow) / 1000));
}

// --- a hold's heartbeat -----------------------------------------------------------------

/** A sound on a scene's clock (`useSfxCues`). */
export type SfxCue = readonly [number, SfxName, SfxOpts?];

/**
 * A hold's heartbeat: a cue every `step` ms from `from` (until `to`, else for
 * as long as the scene is up), as the two grid points around `t` — windowed
 * off the scene's clock, so a hold never runs out of sound however long the
 * slide stays (or a memo re-shows it) and the list stays two long.
 */
export function onGrid(t: number, from: number, step: number, name: SfxName, opts?: SfxOpts, to = Number.POSITIVE_INFINITY): SfxCue[] {
  const k = t < from ? 0 : Math.floor((t - from) / step);
  const out: SfxCue[] = [];
  for (const x of [from + k * step, from + (k + 1) * step]) if (x < to) out.push([x, name, opts] as const);
  return out;
}

// --- moments a scene reads (never queued: the slide's own scene follows them) ---------

/** The newest moment of `kind` named `name` (folded) that happened at or after `after`, else null. */
export function latestMoment(moments: readonly ScreenMoment[], kind: ScreenMoment["kind"], name: string | readonly string[], after = 0): ScreenMoment | null {
  const names = (typeof name === "string" ? [name] : name).map(foldName);
  let best: ScreenMoment | null = null;
  for (const m of moments) {
    if (m.kind !== kind || m.at < after || !names.includes(foldName(m.name))) continue;
    if (best === null || m.seq > best.seq) best = m;
  }
  return best;
}

/** The overshare beats, scenario 1–4 (`beats/overshare.loom`). */
export const OVERSHARE_BEATS: readonly string[] = ["Overshare One", "Overshare Two", "Overshare Three", "Overshare Four"];

/** Which overshare played (1–4) and when, off the house's moments, else null. */
export function scenarioOf(moments: readonly ScreenMoment[], after = 0): { scenario: 1 | 2 | 3 | 4; at: number } | null {
  const m = latestMoment(moments, "beat", OVERSHARE_BEATS, after);
  if (m === null) return null;
  const i = OVERSHARE_BEATS.findIndex((b) => foldName(b) === foldName(m.name));
  return { scenario: (i + 1) as 1 | 2 | 3 | 4, at: m.at };
}

/** Which overshare played and when: its beat off the moments (from `slideAt` − 2 s), else the
 *  night's `scenario` at the slide's own `at` (the four beats play in the slide's drain). */
export function scenarioFor(moments: readonly ScreenMoment[], night: Pick<ScreenNight, "scenario">, slideAt: number): { scenario: 1 | 2 | 3 | 4; at: number } | null {
  const seen = scenarioOf(moments, slideAt > 0 ? slideAt - 2000 : 0);
  if (seen !== null) return seen;
  const n = night.scenario;
  return n === 1 || n === 2 || n === 3 || n === 4 ? { scenario: n, at: slideAt } : null;
}

/**
 * The round-two number Trabolta says (`beats/pong.loom` Round Two Tally:
 * sixty-one percent with every fact, else twelve), read off the TV's own
 * voice lines for that beat; null where there are none (a wall terminal,
 * an older server) — the scene then never shows a number it can't know.
 */
export function tallyNumber(voice: Pick<ScreenVoice, "lines"> | null): 61 | 12 | null {
  if (voice === null) return null;
  for (const l of voice.lines) {
    if (l.beat === null || foldName(l.beat) !== foldName("Round Two Tally")) continue;
    const s = l.text.toLowerCase();
    if (/sixty-one|\b61\b/u.test(s)) return 61;
    if (/\btwelve\b|\b12\b/u.test(s)) return 12;
  }
  return null;
}

/**
 * The round-two number for the tally scene: the TV's voice lines when this
 * poll carries them, else the night's `collection_complete` (every fact in →
 * 61, else 12: what the beat says). Null with neither (an older server).
 * The voice lines ride one poll only, so the scene latches what it read.
 */
export function tallyOf(voice: Pick<ScreenVoice, "lines"> | null, night: Pick<ScreenNight, "collection_complete">): 61 | 12 | null {
  const said = tallyNumber(voice);
  if (said !== null) return said;
  return night.collection_complete === true ? 61 : night.collection_complete === false ? 12 : null;
}

/** What `useLatch` holds: the first value seen for a key. */
export interface Latched<T> {
  key: number | string;
  value: T;
}

/** One step of a latch: a new key forgets; the first non-null value for a key is kept. */
export function latch<T>(held: Latched<T> | null, key: number | string, value: T | null): Latched<T> | null {
  const h = held !== null && held.key === key ? held : null;
  return h !== null ? h : value === null ? null : { key, value };
}

// --- the Y2K hour ------------------------------------------------------------------------

/**
 * How hot the Y2K hour is, off the seconds to midnight (the story's
 * watchers, `main.loom`): 0 the first half hour, 1 from 11:30, 2 from
 * 11:45, 3 from 11:55, 4 the last minute, 5 at midnight — or with no
 * clock running (`null`: past midnight, an ending stopped it).
 */
export function y2kLevel(remaining: number | null): 0 | 1 | 2 | 3 | 4 | 5 {
  if (remaining === null || remaining <= 0) return 5;
  if (remaining <= 60) return 4;
  if (remaining <= 300) return 3;
  if (remaining <= 900) return 2;
  if (remaining <= 1800) return 1;
  return 0;
}

/** What each level's chime popup says (the story's broadcasts). */
export const Y2K_CHIME_TEXT: Record<0 | 1 | 2 | 3 | 4 | 5, string> = {
  0: "SYSTEM CLOCK RESET: 11:00 PM, DECEMBER 31, 1999",
  1: "SYSTEM CLOCK: 11:30 PM, DEC 31 1999",
  2: "SYSTEM CLOCK: 11:45 PM, DEC 31 1999",
  3: "SYSTEM CLOCK: 11:55 PM, DEC 31 1999. Five minutes to midnight.",
  4: "SYSTEM CLOCK: 11:59 PM, DEC 31 1999. One minute.",
  5: "SYSTEM CLOCK: 12:00 AM",
};

/** A chime popup shows this long after its `y2k_chime` (ms). */
export const CHIME_FLASH_MS = 7000;

/** The latest Y2K chime still on screen at server `now` (the hour's opening chime is the slide's own intro: skipped), else null. */
export function chimeFlash(moments: readonly ScreenMoment[], slideAt: number, now: number): { at: number; age: number } | null {
  const m = latestMoment(moments, "sfx", "y2k_chime", slideAt > 0 ? slideAt + 3000 : 0);
  if (m === null) return null;
  const age = now - m.at;
  return age >= 0 && age < CHIME_FLASH_MS ? { at: m.at, age } : null;
}

/** The year on the clock at level 2+ stutters between what a PC might print. */
export function glitchYear(t: number, level: number, seed = 3): string {
  if (level < 2) return "1999";
  const bucket = Math.floor(t / 180);
  const odds = level >= 4 ? 0.55 : level === 3 ? 0.3 : 0.12;
  if (noise1(seed, bucket) >= odds) return "1999";
  const forms = ["19100", "2000", "1900", "19:9", "19—", "1999"];
  return forms[Math.floor(noise1(seed + 1, bucket) * forms.length)]!;
}

// --- the recount -------------------------------------------------------------------------

/** The motorcycle's ride and its line take this long (ms), ending as the slide lets go. */
export const RECOUNT_RIDE_LEAD = 10_000;

/**
 * When the recount's motorcycle rides (scene ms): the end of the slide's hold
 * (`SLIDE_HOLD_MS`: 90 s on the TV, 45 s on the walls). The story's `sound
 * motorcycle` comes in the same drain as the slide — the TV then still has
 * the whole recount to say — so its moment can't time the ride.
 */
export function recountRideAt(target: "tv" | "wall"): number {
  return SLIDE_HOLD_MS[target === "tv" ? "tv" : "terminals"] - RECOUNT_RIDE_LEAD;
}

// --- the King --------------------------------------------------------------------------

/** The bar's share (0..1) and the hit's chip (the point just lost, fading). */
export function kingBar(hp: number, max: number, t: number, hitAt: number): { share: number; chip: number; flash: number } {
  const m = Math.max(1, max);
  const share = clamp01(hp / m);
  // The lost point hangs on in white, then drains (a fighting game's chip).
  const drain = ease.inQuad(progress(t, hitAt + 450, 700));
  const chip = t < hitAt ? 0 : (1 / m) * (1 - drain);
  const flash = t < hitAt ? 0 : 1 - progress(t, hitAt, 260);
  return { share, chip: Math.min(chip, 1 - share), flash };
}

/** The admin cue that stands the King back up (`main.loom` 👑). */
export const KING_RESTORE = "restore_the_king";

/**
 * The King's hp just after the hit at `seq`, off the bar now and the house's
 * moments since: each later `king hit` took one more point (the server knocks
 * it off before it fires the signal), so count them back. A 👑 restore since
 * (or no King on the wire) leaves the count unknown: null. A director's
 * hand-set bar is no moment — the ring can't see it.
 */
export function kingHpAt(king: Pick<ScreenKing, "hp" | "max"> | null, moments: readonly ScreenMoment[], seq: number): number | null {
  if (king === null) return null;
  let hp = king.hp;
  for (const m of moments) {
    if (m.seq <= seq || m.kind !== "signal") continue;
    const f = foldName(m.name);
    if (f === foldName(KING_RESTORE)) return null;
    if (f === foldName("king hit")) hp += 1;
  }
  return Math.max(0, Math.min(king.max, hp));
}

/** The King's scenes play only while the story still hears him (never after an ending). */
export const kingHeard = (night: Pick<ScreenNight, "ended">): boolean => night.ended !== true;

/** The house's lines as the bar falls (the story's broadcasts at 10 and 5, `main.loom`). */
export function kingLine(hp: number, max: number): string {
  if (hp <= 0) return "The King has fallen.";
  if (hp === 5) return "He is bleeding pixels. At the cold door he hesitates over every move.";
  if (hp === 10) return "The King staggers. His game at the cold door is slipping.";
  if (hp >= max) return "He stands at the cold door at full strength.";
  return "His bar is shared by every program. It never grows back.";
}

// --- Truth Pong ---------------------------------------------------------------------------

/** The cups, a 4-3-2-1 pyramid (x 0..1 across the far end, row 0 nearest). */
export const CUPS: ReadonlyArray<{ x: number; row: number }> = (() => {
  const out: Array<{ x: number; row: number }> = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 4 - row; i++) out.push({ x: 0.5 + (i - (3 - row) / 2) * 0.14, row });
  return out;
})();

/** A throw every this many ms. */
export const THROW_MS = 2800;

export interface Throw {
  /** Which throw (0, 1, …). */
  n: number;
  /** ms into this throw. */
  at: number;
  /** The cup aimed at (an index of `CUPS`). */
  cup: number;
  sink: boolean;
  /** The ball now, 0..1 of the table area (x across, y down), and its height (0 = on the table). */
  x: number;
  y: number;
  z: number;
  /** It has landed (in a cup or off the rim). */
  landed: boolean;
}

/** The ball at `t`: thrown from the near edge in an arc to a cup; about two in five sink. */
export function throwAt(t: number, seed = 7): Throw {
  const n = Math.floor(Math.max(0, t) / THROW_MS);
  const at = Math.max(0, t) - n * THROW_MS;
  const cup = Math.floor(noise1(seed, n * 3) * CUPS.length);
  const sink = noise1(seed, n * 3 + 1) < 0.42;
  const c = CUPS[cup]!;
  const fly = 1100;
  const k = progress(at, 250, fly);
  const fromX = 0.5 + (noise1(seed, n * 3 + 2) - 0.5) * 0.4;
  const toX = c.x + (sink ? 0 : (noise1(seed, n * 3 + 2) < 0.5 ? -1 : 1) * 0.07);
  const toY = 0.14 + c.row * 0.075;
  let x = lerp(fromX, toX, k);
  let y = lerp(1.02, toY, ease.outQuad(k));
  let z = Math.sin(Math.PI * k) * 0.55;
  const landed = at >= 250 + fly;
  if (landed && !sink) {
    // A miss: it clips the rim and skips off the table's edge.
    const b = progress(at, 250 + fly, 700);
    x = toX + (toX < 0.5 ? -1 : 1) * 0.28 * b;
    y = toY - 0.1 * b;
    z = Math.abs(Math.sin(Math.PI * 2 * b)) * 0.18 * (1 - b);
  }
  return { n, at, cup, sink, x, y, z, landed };
}

// --- drifting popups (a hold that never stands still) ----------------------------------------

export interface DriftPop {
  /** Which popup slot. */
  i: number;
  /** Which life of the slot (a new message each time round). */
  life: number;
  /** Where it is (0..1 of the area, its top-left). */
  x: number;
  y: number;
  /** 0 → 1 → 0 over its life: pops open, then shrinks away. */
  open: number;
  /** Which message (by seed). */
  pick: number;
}

/**
 * `count` popups, each living `life` ms then reborn somewhere else after a
 * gap, drifting a little while open — staggered so they never all land at
 * once. Pure: the same popups on every screen at the same `t`.
 */
export function driftPops(t: number, count: number, o: { seed?: number; life?: number; gap?: number; start?: number; area?: { x0: number; x1: number; y0: number; y1: number } } = {}): DriftPop[] {
  const seed = o.seed ?? 5;
  const life = o.life ?? 6000;
  const gap = o.gap ?? 2500;
  const start = o.start ?? 0;
  const area = o.area ?? { x0: 0.04, x1: 0.62, y0: 0.06, y1: 0.62 };
  const period = life + gap;
  const out: DriftPop[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (i / Math.max(1, count)) * period + noise1(seed, i * 17) * gap;
    const local = t - start - offset;
    if (local < 0) continue;
    const n = Math.floor(local / period);
    const into = local - n * period;
    if (into >= life) continue;
    const r = (j: number) => noise1(seed + i * 31, n * 7 + j);
    const k = into / life;
    const open = Math.min(clamp01(into / 220), clamp01((life - into) / 260));
    out.push({
      i,
      life: n,
      x: lerp(area.x0, area.x1, r(0)) + (r(2) - 0.5) * 0.04 * k,
      y: lerp(area.y0, area.y1, r(1)) + (r(3) - 0.5) * 0.04 * k,
      open,
      pick: Math.floor(r(4) * 1e6),
    });
  }
  return out;
}

/** When each drifting popup lands, within `[from, to)` (ms): the sound cues a scene hangs on them. */
export function driftLandings(count: number, from: number, to: number, o: Parameters<typeof driftPops>[2] = {}): number[] {
  const seed = o?.seed ?? 5;
  const life = o?.life ?? 6000;
  const gap = o?.gap ?? 2500;
  const start = o?.start ?? 0;
  const period = life + gap;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const offset = (i / Math.max(1, count)) * period + noise1(seed, i * 17) * gap;
    const first = start + offset;
    const n0 = Math.max(0, Math.ceil((from - first) / period));
    for (let n = n0; first + n * period < to; n++) out.push(first + n * period);
  }
  return out.sort((a, b) => a - b);
}

// --- the trust chart ----------------------------------------------------------------------

/** When row `i` (0 = the top) of `n` comes up, server ms: the bottom at `revealAt`, one more every `step` (0: history, all at once). */
export function chartRowAt(i: number, n: number, revealAt: number, step: number): number {
  if (revealAt <= 0) return 0;
  return revealAt + (n - 1 - i) * step;
}

// --- the beans ------------------------------------------------------------------------------

/** How full the heap at the bottom of the screen is (0..1): fast at the spill, then a slow creep that never stops. */
export function beanHeap(t: number, spillAt: number): number {
  if (t < spillAt) return 0;
  const s = (t - spillAt) / 1000;
  return clamp01(0.55 * (1 - Math.exp(-s / 2.2)) + 0.35 * (1 - Math.exp(-s / 70)));
}

// --- the dance ------------------------------------------------------------------------------

/** The song's beat (120 BPM): which beat, and how far into it (0..1). */
export function danceBeat(t: number, start: number, bpm = 120): { n: number; k: number } {
  const per = 60_000 / bpm;
  const local = Math.max(0, t - start);
  const n = Math.floor(local / per);
  return { n, k: (local - n * per) / per };
}

/** Equaliser bar heights (0..1) at `t`: a beat-driven bounce per band. */
export function equaliser(t: number, bands: number, start: number, seed = 13): number[] {
  const { n, k } = danceBeat(t, start);
  const hit = Math.exp(-k * 4);
  const out: number[] = [];
  for (let b = 0; b < bands; b++) {
    const base = 0.25 + 0.35 * noise1(seed, n * bands + b);
    const wob = 0.15 * Math.sin(t / (140 + b * 23) + b);
    out.push(clamp01(base + wob + hit * (b < bands / 3 ? 0.45 : 0.25)));
  }
  return out;
}

/** Where the chart's rows sit: columns of rows, filled top to bottom (as the card's CSS columns). */
export function chartLayout(n: number, maxCols = 3): { cols: number; perCol: number } {
  const cols = Math.min(Math.max(1, maxCols), n <= 10 ? 1 : n <= 24 ? 2 : 3);
  return { cols, perCol: Math.max(1, Math.ceil(n / cols)) };
}
