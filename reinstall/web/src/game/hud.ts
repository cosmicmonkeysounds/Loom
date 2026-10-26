//! The heads-up display's arithmetic — pure: where am I (room + its story
//! location), how warm am I (the route's length to the duck, compared with
//! a moment ago), how long have I been in here, which way is north, and am
//! I there yet.

import { DUCK_MAX_RISE, floorOf, locate, PATH_REVEAL_MS, roomById, wrapYaw } from "@loom/house";
import type { DuckSpot, HouseMap, Vec3 } from "@loom/house";

/** Plan distance at which the duck counts as reached (and `found` is sent). */
export const REACH = 0.9;

/**
 * The most the duck's y may sit above (or below) the feet for the server
 * to accept a find (`nearDuck` in `core/server/spatial.ts` bounds it by
 * `DUCK_MAX_RISE` from `@loom/house`, §2.1 `found`) — the same 1.2 m the
 * validator caps a spot's rise at, so the game never asks for a find the
 * server must refuse.
 */
export const FOUND_DY = DUCK_MAX_RISE;

/**
 * Close enough to the duck to call it found: within `REACH` on the plan,
 * on its floor, and no more than `FOUND_DY` below or above the feet (a duck
 * raised onto a high shelf is out of reach — the server would refuse it).
 */
export function withinReach(house: HouseMap, feet: Vec3, duck: DuckSpot): boolean {
  if (Math.hypot(feet[0] - duck.pos[0], feet[2] - duck.pos[2]) > REACH) return false;
  if (Math.abs(feet[1] - duck.pos[1]) > FOUND_DY) return false;
  return floorOf(house, feet[1]) === floorOf(house, duck.pos[1]);
}

/**
 * Standing right under the duck (within `REACH` on the plan, on its floor)
 * but it sits more than `FOUND_DY` off the feet — a map problem the player
 * can't walk out of, so the game says so.
 */
export function perchedOutOfReach(house: HouseMap, feet: Vec3, duck: DuckSpot): boolean {
  if (Math.hypot(feet[0] - duck.pos[0], feet[2] - duck.pos[2]) > REACH) return false;
  return Math.abs(feet[1] - duck.pos[1]) > FOUND_DY && floorOf(house, feet[1]) === floorOf(house, duck.pos[1]);
}

/**
 * How long to wait before asking for the find again after `refusals`
 * refusals in a row (the server's copy of the pose said "not near", or the
 * doors were closed): 1.5 s, 3 s, 6 s, then every 10 s.
 */
export function foundRetryMs(refusals: number): number {
  return Math.min(10_000, 1500 * 2 ** Math.max(0, refusals));
}

/** What the HUD says while a find waits for the doors (§2.1: 409 "doors
 *  are closed" — the run is paused, or not open yet). */
export const PAUSED_NOTICE = "The simulation is paused — Gerald will wait for you.";

/**
 * A find the doors held (409 "doors are closed"): say so until just past
 * the next retry, and retry on the usual backoff — the first retry after
 * resume lands. The player was told to wait, so every held reply touches
 * the idle leash here: a director's pause never disconnects a player
 * standing at Gerald (retries are at most 10 s apart, well inside the
 * leash).
 */
export function heldFind(now: number, refusals: number, leash: { touch(now: number): void }): { notice: string; noticeMs: number; cooldownUntil: number } {
  leash.touch(now);
  const wait = foundRetryMs(refusals);
  return { notice: PAUSED_NOTICE, noticeMs: wait + 1000, cooldownUntil: now + wait };
}

/**
 * What a judged find means for this tablet (§2.1 `found`):
 * - `released` — the find freed a captured program (the story's
 *   `the simulation completed` let them out): the reinstallation is complete.
 * - `refused` — the program is still captured after the find: the story
 *   kept them (the banishment — "Gerald can't help"), so no egg, no
 *   fanfare, nothing that reads as a release. A server that doesn't say
 *   `captured` falls back to the captured state the walk began with.
 * - `found` — a free program (never captured, or freed mid-walk) found Gerald.
 */
export type FindOutcome = "released" | "refused" | "found";

export function findOutcome(found: { released: boolean; captured?: boolean | null }, capturedAtBegin: boolean): FindOutcome {
  if (found.released) return "released";
  const captured = typeof found.captured === "boolean" ? found.captured : capturedAtBegin;
  return captured ? "refused" : "found";
}

/** The celebration window's copy for each outcome (pure, so it is tested). */
export function findCopy(outcome: FindOutcome, name: string): { title: string; heading: string; line: string; progress: string; egg: boolean } {
  switch (outcome) {
    case "released":
      return {
        title: "Reinstallation Wizard",
        heading: "REINSTALLATION COMPLETE",
        line: `${name} has been reinstalled. Instructions followed. The Internet releases you.`,
        progress: "Copying files… done",
        egg: true,
      };
    case "refused":
      return {
        title: "Gerald",
        heading: "GERALD CAN'T HELP",
        line: `Gerald can't help ${name} tonight. The Internet keeps you — your phone says what happens next.`,
        progress: "Nothing to copy",
        egg: false,
      };
    case "found":
      return { title: "Gerald", heading: "YOU FOUND GERALD", line: `Gerald laid a golden egg for ${name}. Quack.`, progress: "Egg: laid", egg: true };
  }
}

/** The scan screen's line after a find (the wizard's flash). */
export function findFlash(outcome: FindOutcome, name: string): { text: string; tone: "good" | "bad" } {
  switch (outcome) {
    case "released":
      return { text: `${name} — reinstallation complete.`, tone: "good" };
    case "refused":
      return { text: `${name} found Gerald — he can't help tonight.`, tone: "bad" };
    case "found":
      return { text: `${name} found Gerald.`, tone: "good" };
  }
}

/** The room the feet are in, as the HUD names it. */
export function roomTitle(house: HouseMap, feet: Vec3): { room: string; location: string | null } {
  const at = locate(house, feet);
  const room = at.room !== null ? roomById(house, at.room) : undefined;
  if (room === undefined) return { room: "Somewhere between rooms", location: null };
  return { room: room.label, location: room.location ?? null };
}

export type Heat = "found" | "burning" | "hot" | "warmer" | "colder" | "cold" | "steady";

/**
 * How warm the player is: absolute when close (burning < 1.5 m, hot < 4 m
 * of route), else the trend against the distance a moment ago (a change
 * under 0.15 m is "steady"). `prev` null = no trend yet.
 */
export function heat(dist: number, prev: number | null): Heat {
  if (dist <= REACH) return "found";
  if (dist < 1.5) return "burning";
  if (dist < 4) return "hot";
  if (prev === null || Math.abs(dist - prev) < 0.15) return dist > 15 ? "cold" : "steady";
  return dist < prev ? "warmer" : "colder";
}

export const HEAT_LABEL: Record<Heat, string> = {
  found: "THERE!",
  burning: "BURNING HOT",
  hot: "HOT",
  warmer: "WARMER",
  colder: "COLDER",
  cold: "COLD",
  steady: "FOLLOW THE GOLDEN ARROWS",
};

// --- the path reveal (wave 26, R2) ---------------------------------------------

/** The first minute of a session hides the way to Gerald (`@loom/house`'s
 *  constant, the VR game's too). The quack is not a path: never delayed. */
export { PATH_REVEAL_MS };

/**
 * Is the way to Gerald shown `playedMs` into this session? Hidden for the
 * first `PATH_REVEAL_MS` — the chevron trail, the compass pip, the distance
 * and the warmer / colder ladder — then shown for the rest of it. Per
 * session, client side: a re-scan starts the minute again.
 */
export function pathShown(playedMs: number): boolean {
  return playedMs >= PATH_REVEAL_MS;
}

// DRAFT w26 (R2): the notice as the trail draws.
export const PATH_REVEAL_NOTICE = "The way to Gerald lights up.";

// DRAFT w26 (R2): the HUD's heat box before the reveal (no label, no distance, no hint).
export const FIND_GERALD = "FIND GERALD";

/** A director's save moved Gerald: before the reveal the notice names no
 *  arrows (there are none yet); after it, the old line. */
export function duckMovedNotice(revealed: boolean): string {
  // DRAFT w26 (R2): "Gerald moved." before the reveal.
  return revealed ? "Gerald moved — follow the golden arrows." : "Gerald moved.";
}

/** `m:ss` (or `h:mm:ss`). */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A compass bearing (0 = N, 90 = E, clockwise) for a house yaw (0 = N, + = left). */
export function bearingOf(yaw: number): number {
  const b = -wrapYaw(yaw);
  return ((b % 360) + 360) % 360;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** The 8-point compass name of a yaw. */
export function compassPoint(yaw: number): (typeof POINTS)[number] {
  return POINTS[Math.round(bearingOf(yaw) / 45) % 8]!;
}

/**
 * The on-screen angle (degrees, clockwise, 0 = straight ahead) of a plan
 * target seen from `from` while facing `yaw` — the compass's duck pip.
 */
export function relativeBearing(from: Vec3, to: Vec3, yaw: number): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  if (dx === 0 && dz === 0) return 0;
  // Bearing of the target: clockwise from north (−z).
  const target = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const rel = target - bearingOf(yaw);
  return ((((rel + 180) % 360) + 360) % 360) - 180 + 0;
}

/**
 * The King is on this map and standing: what the help card's "Space hits
 * the King" / "⚔ by the King" line needs (wave 26, R3) — the same rule as
 * the ⚔ HIT button, which never shows once he has fallen (a fallen King's
 * HUD state is still non-null: he kneels in the doorway).
 */
export function kingStands(king: { fallen: boolean } | null | undefined): boolean {
  return king !== null && king !== undefined && !king.fallen;
}

/** Plan metres within which a King in view clears the HUD's top centre. */
export const KING_VIEW_M = 4.5;
/** |relative bearing| (degrees) within which he counts as in view. */
export const KING_VIEW_DEG = 40;

/**
 * A King the player is looking at from close enough to read his bar (wave
 * 26, R3: the bar over his head is his only display): on the player's
 * floor, within `KING_VIEW_M` on the plan, and no more than
 * `KING_VIEW_DEG` off the facing. While he stands and is in view, the play
 * screen hides the compass and the heat line, which sit right where his bar
 * projects from his hit reach out to about 4 m. Walls are not judged: he
 * stands in a doorway, and the HUD comes back as soon as the player turns.
 */
export function kingInView(house: HouseMap, feet: Vec3, yaw: number, king: { pos: Vec3 }): boolean {
  if (floorOf(house, feet[1]) !== floorOf(house, king.pos[1])) return false;
  if (Math.hypot(king.pos[0] - feet[0], king.pos[2] - feet[2]) > KING_VIEW_M) return false;
  return Math.abs(relativeBearing(feet, king.pos, yaw)) <= KING_VIEW_DEG;
}

/** The HUD's top centre (compass, heat line) gives way to his bar: he stands and is in view. */
export function kingClearsHud(king: { fallen: boolean; inView: boolean } | null | undefined): boolean {
  return king !== null && king !== undefined && !king.fallen && king.inView;
}
