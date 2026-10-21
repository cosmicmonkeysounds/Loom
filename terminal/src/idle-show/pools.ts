//! Which part of the night the idle show is playing to (wave 17): the
//! story's `Night.phase` (on the screen state's `night`) folds into six
//! pools, and every ad and popup says which pools it belongs to. The
//! character's own copy (`names: true`) plays only on a screen that may
//! name him — awake, introduced, never on attract (D1: an asleep screen
//! shows the same show minus anything naming the character, and before the
//! introduction nothing on any screen names him).

import type { ScreenState } from "../screen.ts";

export type PhasePool = "early" | "hunt" | "malware" | "late" | "y2k" | "finale";
export const PHASE_POOLS: readonly PhasePool[] = ["early", "hunt", "malware", "late", "y2k", "finale"];

/** `Night.phase` → its pool. No phase (no server yet, an older one) is the doors. */
export function phasePool(phase: string | null | undefined): PhasePool {
  const p = (phase ?? "").trim().toLowerCase();
  if (p === "" || p === "arrivals" || p === "desktop" || p === "bingo" || p === "bingo_results") return "early";
  if (p === "introduced" || p === "hunt_1" || p === "truth_1") return "hunt";
  if (p === "malware" || p === "hunt_2" || p === "summons") return "malware";
  if (p === "truth_pong" || p === "trust_chart" || p === "beans" || p === "overshare" || p === "majority") return "late";
  if (p === "y2k") return "y2k";
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
  /** The Y2K countdown's seconds left, when it runs (a popup counts with it). */
  y2kLeft: number | null;
}

/** Is the character introduced? Before the first answer, or while hidden: no. */
export function introducedIn(state: ScreenState | null): boolean {
  return state !== null && state.character !== null && state.character.hidden === false;
}

export function idleContextOf(o: { state: ScreenState | null; asleep: boolean; character: string; target: "tv" | "wall"; scan: boolean }): IdleContext {
  const s = o.state;
  const phase = s?.night.phase ?? "";
  const awake = s !== null && s.character !== null && s.character.awake && !s.attract;
  return {
    pool: phasePool(phase),
    phase: phase.trim().toLowerCase(),
    names: !o.asleep && awake && introducedIn(s) && o.character.trim() !== "",
    character: s?.character?.id ?? o.character,
    target: o.target,
    scan: o.scan,
    y2kLeft: s !== null && s.countdown === "y2k" && s.remaining !== null ? Math.max(0, s.remaining) : null,
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
}

export function eligible(item: Pooled, ctx: IdleContext): boolean {
  if (item.names === true && !ctx.names) return false;
  if (item.scan === true && !ctx.scan) return false;
  if (item.wall === true && ctx.target !== "wall") return false;
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
