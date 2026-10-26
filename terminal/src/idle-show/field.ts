//! The popups' lives (wave 17), pure: when the next window arrives, where
//! it lands, how long it stays, what a tap on it does. `IdleShow.tsx` feeds
//! it the clock and draws what it holds into a fixed pool of `MAX_POPUPS`
//! slots (the DOM is reused, never grown — an old tablet draws six windows
//! at most).
//!
//! Positions are shares of the show's box (0..1, the window's top-left);
//! a window never lands on `reserve` (the scan box in the corner), so a
//! held-up pass and the typed fallback are never covered.

import type { Layout } from "./schedule.ts";
import type { PhasePool } from "./pools.ts";
import { mulberry32, mix } from "./rng.ts";

/** At most this many windows at once. */
export const MAX_POPUPS = 6;
/** (wave 26, T1) Before the ad hijack (calm): at most this many at once. */
export const CALM_MAX_POPUPS = 2;
/** (wave 26, T3) A quiet backdrop (the tent's kiosk): at most this many. */
export const QUIET_MAX_POPUPS = 1;
/** (wave 26, T1) Calm, the windows come this many times further apart (a
 *  saver's 3–6.5 s becomes 18–39 s). */
export const CALM_POPUP_PACE = 6;

/** How many windows a show may hold at once: quiet 1, calm 2, else `MAX_POPUPS`. A storm keeps its own. */
export function popupCap(ctx: { calm?: boolean; quiet?: boolean }): number {
  if (ctx.quiet === true) return QUIET_MAX_POPUPS;
  if (ctx.calm === true) return CALM_MAX_POPUPS;
  return MAX_POPUPS;
}
/** Does a show take the calm pace (`CALM_POPUP_PACE`)? Calm (before the
 *  hijack), or quiet (the tent's backdrop, T3) all night: with one window at
 *  most, the full hijacked rate would throw the last one out every 1.5–3 s
 *  and the backdrop behind the kiosk would never settle. */
export function calmPace(ctx: { calm?: boolean; quiet?: boolean }): boolean {
  return ctx.calm === true || ctx.quiet === true;
}
/** A window's assumed footprint for placement (share of the box). */
export const POPUP_W = 0.34;
export const POPUP_H = 0.3;
/** How long a window stays if nobody closes it (ms). */
export const POPUP_LIFE_MS: readonly [number, number] = [9_000, 16_000];
/** A storm's windows: one every … ms, each staying … ms. */
export const STORM_EVERY_MS = 320;
export const STORM_LIFE_MS = 2_600;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LivePopup {
  id: number;
  /** Which of the `MAX_POPUPS` DOM slots draws it. */
  slot: number;
  /** The `n`-th popup this show drew (picks its kind: `schedule.ts` `popupAt`). */
  n: number;
  x: number;
  y: number;
  born: number;
  dies: number;
  /** It already jumped away once (a `dodge` works once). */
  dodged: boolean;
  /** A `confirm` button asked "Are you sure?" — the next tap closes. */
  asking: boolean;
  storm: boolean;
}

export interface PopupField {
  live: LivePopup[];
  nextId: number;
  /** Popups drawn so far (the next one's `n`). */
  drawn: number;
  /** When the next one arrives (local ms; null: not scheduled yet). */
  nextAt: number | null;
}

export function emptyField(drawn = 0): PopupField {
  return { live: [], nextId: 1, drawn, nextAt: null };
}

/** The wait before the next window (ms) on this layout; null = none come.
 *  `calm` (wave 26, T1/T3: `calmPace`, before the hijack or a quiet backdrop): `CALM_POPUP_PACE` times as long. */
export function spawnGap(layout: Layout, pool: PhasePool, target: "tv" | "wall", r: number, y2kLeft: number | null = null, calm = false): number | null {
  if (layout === "face") return null;
  if (layout === "storm") return STORM_EVERY_MS;
  const [lo, hi] = layout === "saver" ? [3_000, 6_500] : layout === "banner" ? [4_500, 8_000] : [7_000, 12_000];
  // Hijacked: twice as often. The Y2K hour: faster as midnight nears. The TV, across the room: a little calmer.
  const k = (pool === "malware" ? 0.5 : pool === "y2k" ? y2kPace(y2kLeft) : 1) * (target === "tv" ? 1.3 : 1) * (calm ? CALM_POPUP_PACE : 1);
  return Math.round((lo + r * (hi - lo)) * k);
}

/** The Y2K hour's pace (a share of the usual gap): 0.8 all hour, 0.5 in
 *  the last five minutes, 0.3 in the last minute. */
export function y2kPace(left: number | null): number {
  if (left === null) return 0.8;
  if (left <= 60) return 0.3;
  if (left <= 300) return 0.5;
  return 0.8;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Where a new window lands: anywhere on screen but `reserve`, a few tries
 *  at random, else the top-left quarter (always clear of a bottom-right box). */
export function placePopup(rand: () => number, reserve: Rect | null): { x: number; y: number } {
  const span = (n: number) => Math.max(0, 1 - n - 0.04);
  for (let i = 0; i < 10; i++) {
    const x = 0.02 + rand() * span(POPUP_W);
    const y = 0.02 + rand() * span(POPUP_H);
    if (reserve === null || !overlaps({ x, y, w: POPUP_W, h: POPUP_H }, reserve)) return { x, y };
  }
  return { x: 0.02 + rand() * 0.2, y: 0.02 + rand() * 0.15 };
}

/** A storm cascades: each window a step down-right of the last, wrapping. */
export function stormPlace(n: number, seed: number, reserve: Rect | null): { x: number; y: number } {
  const r = mulberry32(mix(seed, Math.floor(n / 8), 0x570)); // a new cascade every 8
  const x0 = 0.03 + r() * 0.25;
  const y0 = 0.03 + r() * 0.2;
  const step = n % 8;
  const p = { x: Math.min(x0 + step * 0.045, 1 - POPUP_W - 0.02), y: Math.min(y0 + step * 0.055, 1 - POPUP_H - 0.02) };
  if (reserve !== null && overlaps({ ...p, w: POPUP_W, h: POPUP_H }, reserve)) return { x: Math.max(0.02, p.x - 0.35), y: p.y };
  return p;
}

function freeSlot(live: readonly LivePopup[]): number {
  for (let s = 0; s < MAX_POPUPS; s++) if (!live.some((p) => p.slot === s)) return s;
  return -1;
}

/** Add one window now (the oldest close first when the show holds its
 *  `cap` — `MAX_POPUPS` by default; a storm's windows always may fill every slot). */
export function spawn(f: PopupField, now: number, o: { seed: number; reserve: Rect | null; storm: boolean; cap?: number }): { field: PopupField; popup: LivePopup } {
  const cap = o.storm ? MAX_POPUPS : Math.max(1, Math.min(MAX_POPUPS, o.cap ?? MAX_POPUPS));
  let live = f.live;
  if (live.length >= cap) live = live.slice().sort((a, b) => a.born - b.born).slice(live.length - cap + 1);
  const rand = mulberry32(mix(o.seed, f.drawn, 0x9097));
  const at = o.storm ? stormPlace(f.drawn, o.seed, o.reserve) : placePopup(rand, o.reserve);
  const life = o.storm ? STORM_LIFE_MS : POPUP_LIFE_MS[0] + Math.floor(rand() * (POPUP_LIFE_MS[1] - POPUP_LIFE_MS[0]));
  const popup: LivePopup = { id: f.nextId, slot: freeSlot(live), n: f.drawn, x: at.x, y: at.y, born: now, dies: now + life, dodged: false, asking: false, storm: o.storm };
  return { field: { live: [...live, popup], nextId: f.nextId + 1, drawn: f.drawn + 1, nextAt: f.nextAt }, popup };
}

/**
 * One step of the clock: windows past their time close, and if one is due
 * (and the layout brings any) it arrives. Returns who arrived (for the sound).
 */
export function tick(f: PopupField, now: number, o: { seed: number; layout: Layout; pool: PhasePool; target: "tv" | "wall"; reserve: Rect | null; y2kLeft?: number | null; calm?: boolean; cap?: number }): { field: PopupField; arrived: LivePopup | null } {
  let field: PopupField = { ...f, live: f.live.filter((p) => p.dies > now) };
  const gap = spawnGap(o.layout, o.pool, o.target, mulberry32(mix(o.seed, field.drawn, 0x6a9))(), o.y2kLeft ?? null, o.calm === true);
  if (gap === null) return { field: { ...field, nextAt: null }, arrived: null };
  if (field.nextAt === null) return { field: { ...field, nextAt: now + (o.layout === "storm" ? 0 : Math.round(gap / 2)) }, arrived: null };
  if (now < field.nextAt) return { field, arrived: null };
  const s = spawn(field, now, { seed: o.seed, reserve: o.reserve, storm: o.layout === "storm", cap: o.cap });
  field = { ...s.field, nextAt: now + gap };
  return { field, arrived: s.popup };
}

/** What a tap on a window's × does (pure: `r` is the roll). */
export type CloseGag = "close" | "hydra" | "dodge";
export function closeGag(r: number, p: Pick<LivePopup, "dodged" | "storm">, live: number, cap: number = MAX_POPUPS): CloseGag {
  if (p.storm) return "close";
  if (r < 0.18 && live + 1 <= cap) return "hydra"; // one closes, two arrive: one more on screen
  if (r < 0.3 && !p.dodged) return "dodge";
  return "close";
}

/** Close one window. */
export function close(f: PopupField, id: number): PopupField {
  return { ...f, live: f.live.filter((p) => p.id !== id) };
}

/** The window jumps somewhere else (once), and stays a little longer. */
export function dodge(f: PopupField, id: number, now: number, o: { seed: number; reserve: Rect | null }): PopupField {
  const rand = mulberry32(mix(o.seed, id, 0xd0d6e));
  return { ...f, live: f.live.map((p) => (p.id === id ? { ...p, ...placePopup(rand, o.reserve), dodged: true, dies: Math.max(p.dies, now + 6_000) } : p)) };
}

/** A `confirm` button: the window asks first. */
export function ask(f: PopupField, id: number, now: number): PopupField {
  return { ...f, live: f.live.map((p) => (p.id === id ? { ...p, asking: true, dies: Math.max(p.dies, now + 6_000) } : p)) };
}

/** Close one and bring two more (the hydra): never past the show's `cap` (`MAX_POPUPS` by default). */
export function hydra(f: PopupField, id: number, now: number, o: { seed: number; reserve: Rect | null; cap?: number }): { field: PopupField; arrived: LivePopup[] } {
  const cap = Math.max(1, Math.min(MAX_POPUPS, o.cap ?? MAX_POPUPS));
  let field = close(f, id);
  const arrived: LivePopup[] = [];
  for (let i = 0; i < 2 && field.live.length < cap; i++) {
    const s = spawn(field, now + i, { seed: o.seed, reserve: o.reserve, storm: false, cap });
    field = s.field;
    arrived.push(s.popup);
  }
  return { field, arrived };
}

/** A layout change: storm windows go with the storm; the rest stay to pile up.
 *  The next window's arrival is kept (wave 26, T1): only a storm starting
 *  (its windows come at once) or ending (a short pause after it) resets it.
 *  Resetting on every segment change made a calm wall wait its halved gap
 *  afresh each segment, and a halved gap longer than a 12–18 s saver never
 *  came at all: the windows stopped. `prev` is the layout being left. */
export function relayout(f: PopupField, layout: Layout, prev?: Layout): PopupField {
  const reset = layout === "storm" || prev === "storm";
  return { ...f, live: layout === "storm" ? f.live : f.live.filter((p) => !p.storm), nextAt: reset ? null : f.nextAt };
}
