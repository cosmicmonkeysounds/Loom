//! The game moments (wave 26, C6) — pure: when the web game posts `POST
//! /api/spatial/moment`, and what it does with each answer.
//!
//! - **The void** (R4). Out through an exterior door onto the outside ground
//!   and `ESCAPE_M` past the walls on that floor (`voidDistance`): a jump
//!   scare (`SCARE_MS`; one hard flash at most, nothing faster than 3 Hz), the
//!   escape posted, then a teleport back to the spawn **whatever the server
//!   says** — a 409 (doors closed, not out, cooldown, parked), an old server's
//!   404 or no answer at all just means no penalty and no lines. Only a dead
//!   session (401 / 410) ends the game instead. Every time, even before his
//!   reveal: the lines are the story's (game-only, never on a phone).
//! - **The heart** (R6). In the heart's room once the King has fallen (or
//!   the map has no King): posted once per entry; his lines are spoken once
//!   a night (`already` after that, and `Assignment.heartHeard` on a re-scan).
//!   An empty answer (he isn't awake yet) waits for the next entry.
//! - **The virus disk** (R7). Within `pickupReach` of a disk this program
//!   hasn't taken (`Assignment.picked`): posted; taken = hidden for good.
//!
//! No featured-program logic here or anywhere in the game: what the disk
//! means for a program is the story's.

import { ESCAPE_M, voidDistance } from "@loom/house";
import type { HouseMap, Spawn, Vec3 } from "@loom/house";
import type { MomentLine, MomentReply } from "../api.ts";
import { foundRetryMs } from "./hud.ts";

export { ESCAPE_M };

/** How long the jump scare holds before the teleport (ms). */
export const SCARE_MS = 1600;
/** The longest the scare waits for the server before it teleports anyway (ms). */
export const SCARE_WAIT_MS = 4000;
/** A retry after a parked session or a network hiccup (ms). */
export const MOMENT_RETRY_MS = 1500;

// DRAFT w26 (R4): the scare panel — glitch art, no name text.
export const SCARE_TITLE = "FATAL EXCEPTION 0E";

// DRAFT w26 (R7): the notice when a disk is picked up.
export const PICKUP_NOTICE = "💾 You picked up a disk.";

/** Far enough out into the void to trigger an escape (`ESCAPE_M` plan metres
 *  past the walls on the player's floor; null inside a room). */
export function escapeDue(house: HouseMap, feet: Vec3): boolean {
  const d = voidDistance(house, feet);
  return d !== null && d >= ESCAPE_M;
}

/** What an escape's answer means: always a teleport (to the server's spawn,
 *  else the map's), with the lines when it counted; `over` ends the game. */
export function escapeStep(r: MomentReply | null): { over: boolean; spawn: Spawn | null; lines: MomentLine[] } {
  if (r === null) return { over: false, spawn: null, lines: [] };
  if (r.kind === "over") return { over: true, spawn: null, lines: [] };
  if (r.kind === "escaped") return { over: false, spawn: r.spawn, lines: r.lines };
  return { over: false, spawn: null, lines: [] };
}

export type HeartStep =
  /** He spoke: say the lines; never again tonight. */
  | { kind: "speak"; lines: MomentLine[] }
  /** Heard already, or this server can't (no route, no such prop): never again this session. */
  | { kind: "done" }
  /** Not now (sealed, not there, nothing to say yet): the next entry asks again. */
  | { kind: "reenter" }
  /** Ask again in `ms` while still inside (doors closed, parked, a hiccup). */
  | { kind: "retry"; ms: number }
  | { kind: "over" };

/** What a heart moment's answer means. `refusals` = closed-door answers in a row. */
export function heartStep(r: MomentReply, refusals: number): HeartStep {
  switch (r.kind) {
    case "heart":
      return r.lines.length > 0 ? { kind: "speak", lines: r.lines } : { kind: "reenter" };
    case "already":
    case "old":
    case "noProp":
    case "bad":
      return { kind: "done" };
    case "sealed":
    case "notThere":
      return { kind: "reenter" };
    case "paused":
      return { kind: "retry", ms: foundRetryMs(refusals) };
    case "over":
      return { kind: "over" };
    default:
      return { kind: "retry", ms: MOMENT_RETRY_MS };
  }
}

export type PickupStep =
  /** Taken now: hide it, say so, play the lines. */
  | { kind: "take"; lines: MomentLine[] }
  /** Taken before (`already`): hide it quietly. */
  | { kind: "hide" }
  /** Ask again in `ms` (far, doors closed, parked, a hiccup). */
  | { kind: "retry"; ms: number }
  /** This server can't (no route, no such prop, a bad request): leave it be. */
  | { kind: "giveUp" }
  | { kind: "over" };

/** What a pickup moment's answer means. `refusals` = refusals in a row (the found backoff). */
export function pickupStep(r: MomentReply, refusals: number): PickupStep {
  switch (r.kind) {
    case "picked":
      return { kind: "take", lines: r.lines };
    case "already":
      return { kind: "hide" };
    case "far":
    case "paused":
      return { kind: "retry", ms: foundRetryMs(refusals) };
    case "old":
    case "noProp":
    case "bad":
      return { kind: "giveUp" };
    case "over":
      return { kind: "over" };
    default:
      return { kind: "retry", ms: MOMENT_RETRY_MS };
  }
}
