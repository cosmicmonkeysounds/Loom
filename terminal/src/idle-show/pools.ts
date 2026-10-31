//! Which part of the night the idle show is playing to (wave 17): the
//! story's `Night.phase` (on the screen state's `night`) folds into six
//! pools, and every ad and popup says which pools it belongs to. The
//! character's own copy (`names: true`) plays only on a screen that may
//! name him — awake, introduced, never on attract (D1: an asleep screen
//! shows the same show minus anything naming the character, and before the
//! introduction nothing on any screen names him). Wave 18b (D19): an
//! `owner: true` item names "Jean Trabolta" only in the third person, as
//! the owner of Maps and Ducks who joins by digital conference later tonight;
//! it plays from the Desktop (`Night.phase` desktop / bingo) onward, asleep
//! or not, never at the doors (no phase, `arrivals`).

import type { ScreenState } from "../screen.ts";

export type PhasePool = "early" | "hunt" | "malware" | "late" | "y2k" | "finale";
export const PHASE_POOLS: readonly PhasePool[] = ["early", "hunt", "malware", "late", "y2k", "finale"];

/** `Night.phase` → its pool. No phase (no server yet, an older one) is the doors. */
export function phasePool(phase: string | null | undefined): PhasePool {
  const p = (phase ?? "").trim().toLowerCase();
  if (p === "" || p === "arrivals" || p === "desktop" || p === "bingo" || p === "bingo_results") return "early";
  if (p === "introduced" || p === "hunt_1" || p === "truth_1") return "hunt";
  if (p === "malware" || p === "hunt_2" || p === "summons") return "malware";
  if (p === "truth_pong" || p === "trust_chart" || p === "beans" || p === "overshare") return "late";
  // A side's majority lands inside the Y2K hour: the clock keeps running.
  if (p === "y2k" || p === "majority") return "y2k";
  if (p === "final_reveal" || p === "bobbing" || p === "advice" || p === "grok_prom" || p.startsWith("finale")) return "finale";
  return "early";
}

/** What the show may draw on this screen right now. */
export interface IdleContext {
  pool: PhasePool;
  /** The raw phase (a few popups key on one: `beans`, `trust_chart`, `bingo`). */
  phase: string;
  /** May copy name the character? */
  names: boolean;
  /** His name in the story's spelling (only read when `names`). */
  character: string;
  /** The TV (no taps, no scan box, quieter) or a wall terminal. */
  target: "tv" | "wall";
  /** A scan box is in the corner (a popup may point at it). */
  scan: boolean;
  /** His face is under the show (a wall terminal's whole stage, no world
   *  view in its face pane): the `face` layout may let it show through. */
  face: boolean;
  /** The Y2K countdown's seconds left, when it runs (a popup counts with it). */
  y2kLeft: number | null;
  /** (wave 26, T1) The calm rate before the ad hijack: pool `early` or
   *  `hunt` (every phase before `second_hunt_preview`). About one ad a
   *  two-minute cycle (`CALM_PATTERN`), a popup every 18–39 s, at most
   *  `CALM_MAX_POPUPS` up, no storms, no ad-like popups. Absent: not calm. */
  calm?: boolean;
  /** (wave 26, T3) A dimmed backdrop behind something else (the tent's scan
   *  kiosk): no storm unless hijacked, at most `QUIET_MAX_POPUPS` window, no
   *  TOUCH ME, no face layout. Absent: not quiet. */
  quiet?: boolean;
}

/** Is a pool the calm part of the night, before the ad hijack (T1)? */
export function calmPool(pool: PhasePool): boolean {
  return pool === "early" || pool === "hunt";
}

/** Is the character introduced? Before the first answer, or while hidden: no. */
export function introducedIn(state: ScreenState | null): boolean {
  return state !== null && state.character !== null && state.character.hidden === false;
}

/** The Y2K countdown's seconds left at `now`, counted down off the answer's
 *  arrival exactly as `screenLayers` does (`slides.ts`), so every Y2K
 *  readout on a screen agrees; null when it isn't running. */
export function y2kLeftAt(state: Pick<ScreenState, "countdown" | "remaining" | "receivedAt"> | null, now: number): number | null {
  if (state === null || state.countdown !== "y2k" || state.remaining === null) return null;
  const since = Math.max(0, now - state.receivedAt);
  return Math.max(0, state.remaining - Math.floor(since / 1000));
}

export function idleContextOf(o: { state: ScreenState | null; asleep: boolean; character: string; target: "tv" | "wall"; scan: boolean; region?: "full" | "pane"; now?: number; quiet?: boolean }): IdleContext {
  const s = o.state;
  const phase = s?.night.phase ?? "";
  const awake = s !== null && s.character !== null && s.character.awake && !s.attract;
  let pool = phasePool(phase);
  // The Y2K clock is running: the Y2K pool, whatever beat the phase names (never over a finale).
  if (s !== null && s.countdown === "y2k" && pool !== "finale") pool = "y2k";
  return {
    pool,
    phase: phase.trim().toLowerCase(),
    names: !o.asleep && awake && introducedIn(s) && o.character.trim() !== "",
    character: s?.character?.id ?? o.character,
    target: o.target,
    scan: o.scan,
    face: o.target === "wall" && (o.region ?? "full") === "full" && o.quiet !== true,
    y2kLeft: y2kLeftAt(s, o.now ?? Date.now()),
    calm: calmPool(pool),
    quiet: o.quiet === true,
  };
}

/** The pool tags any ad or popup carries. */
export interface Pooled {
  /** The pools it plays in (absent: all). */
  pools?: readonly PhasePool[];
  /** Only these exact phases (absent: any in its pools). */
  phases?: readonly string[];
  /** It names the character (`{character}` in its copy): awake + introduced only. */
  names?: boolean;
  /** It points at the scan box: only where there is one. */
  scan?: boolean;
  /** Wall terminals only (asks for a tap). */
  wall?: boolean;
  /** It names "Jean Trabolta" in the third person, as the owner (D19): from the Desktop on (`ownerMay`). */
  owner?: boolean;
  /** (wave 26, T1) A window that is really an ad (WINNER!!!, a special
   *  offer): never while the show is calm (before the hijack). */
  adLike?: boolean;
}

/** May an `owner` item play at this phase? From the Desktop on: never at the doors (no phase, `arrivals`). */
export function ownerMay(phase: string): boolean {
  const p = phase.trim().toLowerCase();
  return p !== "" && p !== "arrivals";
}

export function eligible(item: Pooled, ctx: IdleContext): boolean {
  if (item.names === true && !ctx.names) return false;
  if (item.owner === true && !ownerMay(ctx.phase)) return false;
  if (item.scan === true && !ctx.scan) return false;
  if (item.wall === true && ctx.target !== "wall") return false;
  if (item.adLike === true && ctx.calm === true) return false;
  if (item.pools !== undefined && !item.pools.includes(ctx.pool)) return false;
  if (item.phases !== undefined && !item.phases.includes(ctx.phase)) return false;
  return true;
}

/** "1:02:03" / "4:05" for a countdown's seconds. */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Fill a copy template: `{character}`, `{y2k}` (the countdown, or "not long").
 *  A shouted template ("{character} PREMIUM") shouts his name too. */
export function fillCopy(text: string, ctx: Pick<IdleContext, "character" | "y2kLeft">): string {
  const bare = text.replace(/\{[a-z0-9]+\}/gu, "");
  const shout = /[A-Z]/u.test(bare) && bare === bare.toUpperCase();
  return text.replace(/\{character\}/gu, shout ? ctx.character.toUpperCase() : ctx.character).replace(/\{y2k\}/gu, ctx.y2kLeft === null ? "not long" : clockText(ctx.y2kLeft));
}
