//! The idle show's running order (wave 17), pure: an endless line of
//! **segments**, each 7–18 s (never longer than `SEGMENT_MAX_MS` — an idle
//! terminal never sits on one thing), each a layout over a screensaver:
//!
//!   saver   the screensaver full screen, popups piling up over it
//!   ad      one ad, big, over the dimmed saver
//!   banner  the saver with a banner ad across it (+ popups)
//!   side    two ads side by side (stacked on a portrait tablet)
//!   storm   a popup storm: windows everywhere, a trail of them, an alarm
//!   face    the character's face shows through, with a tip from him and
//!           an ad beside it (awake wall terminals after the introduction,
//!           only where the face is under the show — never beside the world)
//!
//! The order repeats in cycles of `PATTERN` with the draws (which saver,
//! which ads) taken from seeded shuffles (`rng.ts` `drawAt`), so segment
//! `i` is a pure function of (seed, i, what the pool holds). The seed is the
//! terminal's name; the first segment comes off the name + the wall clock;
//! the cursor (`IdleCursor`) is kept in sessionStorage per terminal name, so
//! a remount (the character waking, a pass connecting and the line ending)
//! picks up where it was — never back at ad 0.

import { IDLE_ADS, type IdleAd } from "./ads.ts";
import { eligible, type IdleContext, type PhasePool } from "./pools.ts";
import { POPUP_KINDS, type PopupKind } from "./popups.ts";
import { drawAt, hash32, mix, roll, rollInt } from "./rng.ts";
import { SAVER_IDS, type SaverId } from "./savers/index.ts";

export type Layout = "saver" | "ad" | "banner" | "side" | "storm" | "face";

/** One cycle of slots: [the layout (or the first of two it may be), the ads it draws]. */
type Slot = { layout: Layout; alt?: Layout; ads: number };
export const PATTERN: readonly Slot[] = [
  { layout: "saver", ads: 0 },
  { layout: "ad", ads: 1 },
  { layout: "banner", ads: 1 },
  { layout: "saver", ads: 0 },
  { layout: "side", ads: 2 },
  { layout: "ad", ads: 1 },
  // A saver, or (awake, after the introduction) the face with an ad beside it.
  { layout: "saver", alt: "face", ads: 1 },
  // A popup storm now and then (every cycle while the ads are hijacked), else a banner.
  { layout: "storm", alt: "banner", ads: 1 },
];
/** (wave 26, T1) The calm cycle before the ad hijack (`IdleContext.calm`):
 *  screensavers, and one ad a cycle — the full-screen ad, or (awake, after
 *  the introduction) his face with an ad beside it in its place. About two
 *  minutes a cycle; no storm slot. After the hijack `PATTERN` takes over
 *  (the flood). */
export const CALM_PATTERN: readonly Slot[] = [
  { layout: "saver", ads: 0 },
  { layout: "saver", ads: 0 },
  { layout: "saver", ads: 0 },
  { layout: "ad", alt: "face", ads: 1 },
  { layout: "saver", ads: 0 },
  { layout: "saver", ads: 0 },
  { layout: "saver", ads: 0 },
  { layout: "saver", ads: 0 },
];
const adsPerCycle = (p: readonly Slot[]) => p.reduce((n, s) => n + s.ads, 0);
const adsBefore = (p: readonly Slot[]): readonly number[] => p.map((_, i) => p.slice(0, i).reduce((n, s) => n + s.ads, 0));
const CYCLES = new Map<readonly Slot[], { perCycle: number; before: readonly number[] }>([
  [PATTERN, { perCycle: adsPerCycle(PATTERN), before: adsBefore(PATTERN) }],
  [CALM_PATTERN, { perCycle: adsPerCycle(CALM_PATTERN), before: adsBefore(CALM_PATTERN) }],
]);

/** The cycle a context plays: calm (or quiet and not hijacked: no storms) → `CALM_PATTERN`. */
export function patternFor(ctx: Pick<IdleContext, "calm" | "quiet" | "pool">): readonly Slot[] {
  return ctx.calm === true || (ctx.quiet === true && ctx.pool !== "malware") ? CALM_PATTERN : PATTERN;
}

/** No segment lasts longer than this (ms). */
export const SEGMENT_MAX_MS = 18_000;
/** Each layout's length range (ms). */
export const LAYOUT_MS: Record<Layout, readonly [number, number]> = {
  saver: [12_000, 18_000],
  ad: [9_000, 13_000],
  banner: [12_000, 16_000],
  side: [11_000, 15_000],
  storm: [7_000, 9_000],
  face: [10_000, 14_000],
};
/** How often a cycle's last slot is a storm (all night: rare; hijacked: always). */
export const STORM_CHANCE = 0.4;

export interface Segment {
  index: number;
  layout: Layout;
  saver: SaverId;
  ads: IdleAd[];
  ms: number;
}

/** The ads this screen may show now, in their declared order. */
export function adPool(ctx: IdleContext): IdleAd[] {
  return IDLE_ADS.filter((a) => eligible(a, ctx));
}

/** The popups this screen may show now, in their declared order. */
export function popupPool(ctx: IdleContext): PopupKind[] {
  return POPUP_KINDS.filter((p) => eligible(p, ctx));
}

/** Every `POPUP_FOCUS_EVERY`-th window and `AD_FOCUS_EVERY`-th ad is one
 *  of the night's own (tagged with this pool: the hijack, the Y2K hour, the
 *  beans…), so a phase's handful is felt among the all-night dozens. */
export const POPUP_FOCUS_EVERY = 3;
export const AD_FOCUS_EVERY = 4;

/** The `k`-th draw out of `pool`, every `every`-th from its items tagged `focus`. */
export function drawFocused<T extends { pools?: readonly PhasePool[] }>(seed: number, k: number, pool: readonly T[], focus: PhasePool | undefined, every: number): T | null {
  const kk = Math.max(0, Math.floor(k));
  const own = focus === undefined ? [] : pool.filter((x) => x.pools !== undefined && x.pools.includes(focus));
  if (own.length === 0 || own.length === pool.length || every < 2) {
    const i = drawAt(pool.length, kk, seed);
    return i < 0 ? null : pool[i]!;
  }
  if (kk % every === every - 1) return own[drawAt(own.length, Math.floor(kk / every), mix(seed, 0xf0c))]!;
  const rest = pool.filter((x) => !own.includes(x));
  return rest[drawAt(rest.length, kk - Math.floor((kk + 1) / every), seed)]!;
}

/** The `k`-th ad draw for this seed out of `pool` (the night's own every `AD_FOCUS_EVERY`-th). */
export function adAt(seed: number, k: number, pool: readonly IdleAd[], focus?: PhasePool): IdleAd | null {
  return drawFocused(mix(seed, 0xad), k, pool, focus, AD_FOCUS_EVERY);
}

/** The `n`-th popup for this seed out of `pool` (the night's own every `POPUP_FOCUS_EVERY`-th). */
export function popupAt(seed: number, n: number, pool: readonly PopupKind[], focus?: PhasePool): PopupKind | null {
  return drawFocused(mix(seed, 0x909), n, pool, focus, POPUP_FOCUS_EVERY);
}

/** Segment `index` for this seed and context. */
export function segmentAt(seed: number, index: number, ctx: IdleContext, pool: readonly IdleAd[] = adPool(ctx)): Segment {
  const i = Math.max(0, Math.floor(index));
  const pattern = patternFor(ctx);
  const counts = CYCLES.get(pattern)!;
  const cycle = Math.floor(i / pattern.length);
  const pos = i - cycle * pattern.length;
  const slot = pattern[pos]!;
  let layout = slot.layout;
  if (slot.alt === "face") layout = ctx.names && ctx.target === "wall" && ctx.face && roll(seed, cycle, 0xface) < 0.6 ? "face" : slot.layout;
  else if (slot.alt !== undefined) layout = roll(seed, cycle, 0x5707) < (ctx.pool === "malware" ? 1 : STORM_CHANCE) ? slot.layout : slot.alt;
  const first = cycle * counts.perCycle + counts.before[pos]!;
  const wants = layout === "saver" || layout === "storm" ? 0 : layout === "side" ? 2 : 1;
  const ads: IdleAd[] = [];
  for (let k = 0; k < wants; k++) {
    const ad = adAt(seed, first + k, pool, ctx.pool);
    if (ad !== null) ads.push(ad);
  }
  // An ad layout with nothing to show (an empty pool) falls back to the saver.
  if (ads.length === 0 && layout !== "storm") layout = "saver";
  const saver = SAVER_IDS[drawAt(SAVER_IDS.length, i, mix(seed, 0x5a7e))]!;
  const [lo, hi] = LAYOUT_MS[layout];
  return { index: i, layout, saver, ads, ms: rollInt(lo / 500, hi / 500, seed, i, 0x7135) * 500 };
}

// --- the cursor ---------------------------------------------------------------------

/** Where a terminal is in its line: segment `index`, begun at wall-clock `start`. */
export interface IdleCursor {
  index: number;
  start: number;
}

/** Cycles of the line a name + the wall clock spread the first segment over. */
const START_SPREAD = 997;
/** Where a fresh terminal starts: off its name and the wall clock (a minute a step). */
export function startIndex(name: string, now: number): number {
  return (hash32(name) % START_SPREAD) + Math.floor(now / 60_000) % START_SPREAD;
}

/** A page coming back after this many segments' worth of absence starts fresh rather than walk them. */
const CATCH_UP_MAX = 64;

/**
 * Bring a cursor up to `now`: every segment that has ended is passed (its
 * length off `lengthOf`). A cursor from the future (a clock moved back) or
 * one long stale starts the next segment now.
 */
export function advance(c: IdleCursor, now: number, lengthOf: (index: number) => number): IdleCursor {
  if (now < c.start) return { index: c.index + 1, start: now };
  let { index, start } = c;
  for (let n = 0; n < CATCH_UP_MAX; n++) {
    const len = Math.max(1, lengthOf(index));
    if (now < start + len) return { index, start };
    start += len;
    index += 1;
  }
  return { index: index + 1, start: now };
}

/**
 * The cursor for a show mounting at `now`: the saved one (this terminal's,
 * from an earlier mount this session) brought up to date, else a fresh one
 * off the name and the clock.
 */
export function resumeCursor(saved: IdleCursor | null, name: string, now: number, lengthOf: (index: number) => number): IdleCursor {
  if (saved === null) return { index: startIndex(name, now), start: now };
  return advance(saved, now, lengthOf);
}

const CURSOR_KEY = "loom-terminal:idle:";

export function loadCursor(name: string, storage: Pick<Storage, "getItem"> | null = sessionStore()): IdleCursor | null {
  try {
    const raw = storage?.getItem(CURSOR_KEY + name) ?? null;
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<IdleCursor>;
    return typeof v.index === "number" && Number.isFinite(v.index) && v.index >= 0 && typeof v.start === "number" && Number.isFinite(v.start) ? { index: Math.floor(v.index), start: v.start } : null;
  } catch {
    return null;
  }
}

export function saveCursor(name: string, c: IdleCursor, storage: Pick<Storage, "setItem"> | null = sessionStore()): void {
  try {
    storage?.setItem(CURSOR_KEY + name, JSON.stringify(c));
  } catch {
    /* no storage: a remount starts off the clock again */
  }
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}
