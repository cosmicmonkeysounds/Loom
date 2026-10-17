//! The fight with a `king` prop — pure. A player walks up to the King and
//! hits him (⚔ / Space, one hit per `HIT_COOLDOWN_MS`): each hit knocks a
//! point off his strength, which picks the chess AI's stage when the player
//! challenges him (♟ / C) — a grandmaster at full strength, down to a king
//! with nothing but his eight pawns. Checkmate fells him (`fell`); a loss or
//! a draw deals a new game at the same stage (`redeals`), and an abandoned
//! game changes nothing. Per session: nothing here is shared with another
//! device.

import { floorOf } from "@loom/house";
import type { HouseMap, Prop, Vec3 } from "@loom/house";
import { relativeBearing } from "./hud.ts";

/** Said when a checkmate's `chess won` never reached the event (every retry failed). */
export const WIN_NOT_SENT = "The win didn't reach the house: tell a host (♟).";
/** Said once a checkmate's `chess won` landed from the Y2K hour (the King is
 *  armed): the story unlocks *The Door Code* for the winner. The real
 *  server-room door has a standalone keypad — nothing here opens it. */
export const WIN_CODE = "The server-room door code is in your phone's Codex.";
/** Said once a practice checkmate (before the Y2K hour) landed. */
export const WIN_PRACTICE = "A practice win: the King guards nothing real until the Y2K clock.";

/** The armed read once an ending has played (`fetchArmed`): the story gives
 *  nothing for a win then, so no badge, no win line — and never "tell a
 *  host", there is nothing left for a host to hand over. */
export const NIGHT_ENDED = "ended";
/** Whether the fight counts: armed (true), practice (false), unknown (null)
 *  or the night is over (`NIGHT_ENDED`). */
export type ArmedRead = boolean | null | typeof NIGHT_ENDED;

/** What the HUD says once a checkmate's story signal settles, given whether
 *  the fight counted (`armed`, read at the checkmate; null = unknown,
 *  `NIGHT_ENDED` = nothing at all):
 *  `WIN_NOT_SENT` when it didn't land (so a host fires ♟ by hand) — never
 *  for a known practice game, which wins nothing a host could hand over —
 *  else `WIN_CODE` / `WIN_PRACTICE`, or nothing when it is unknown whether
 *  it counted (or there is no signal hook). */
export async function winNotice(sent: Promise<boolean> | undefined, armed: ArmedRead = null): Promise<string | null> {
  if (sent === undefined || armed === NIGHT_ENDED) return null;
  if (!(await sent)) return armed === false ? null : WIN_NOT_SENT;
  return armed === true ? WIN_CODE : armed === false ? WIN_PRACTICE : null;
}

/** The board's line under its badge: what a checkmate wins. From the Y2K
 *  hour, the door code (in the winner's Codex); before, nothing — practice.
 *  Null when it is unknown (no badge either). Never "the door opens": the
 *  real door has a keypad lock nothing in the house drives. */
export function stakesLine(armed: boolean | null): string | null {
  if (armed === true) return "Checkmate him and the server-room door code goes to your phone's Codex.";
  if (armed === false) return "Practice: the King guards nothing real until the Y2K clock.";
  return null;
}

/** Hit points when the prop declares none. */
export const KING_HP = 4;
/** One hit per this many milliseconds. */
export const HIT_COOLDOWN_MS = 2000;
/** Plan metres, feet → the king's base centre (the body stops ≈ 0.55 m from it). */
export const HIT_REACH = 1.25;
/** |relative bearing| allowed: the player must face him. */
export const HIT_CONE_DEG = 55;

export type Stage = "grandmaster" | "club" | "beginner" | "dizzy" | "pawns";

/** The stage for `hp` of `max`: `round(4·hp/max)` → 4 grandmaster … 0 pawns. */
export function stageFor(hp: number, max: number): Stage {
  const m = Math.max(1, max);
  const k = Math.round((4 * Math.max(0, Math.min(m, hp))) / m);
  return k >= 4 ? "grandmaster" : k === 3 ? "club" : k === 2 ? "beginner" : k === 1 ? "dizzy" : "pawns";
}

export interface Fight {
  hp: number;
  max: number;
  hits: number;
  lastHitAt: number;
  fallen: boolean;
}

export function newFight(max = KING_HP): Fight {
  const m = Number.isInteger(max) && max >= 1 ? Math.min(9, max) : KING_HP;
  return { hp: m, max: m, hits: 0, lastHitAt: Number.NEGATIVE_INFINITY, fallen: false };
}

export type HitVerdict = "ok" | "far" | "facing" | "floor" | "cooldown" | "fallen";

/**
 * May a hit land now? In order: he has fallen; the player is on another
 * floor; too far; not facing him; the cooldown is running; ok.
 */
export function canHit(f: Fight, now: number, house: HouseMap, feet: Vec3, yaw: number, king: Prop): HitVerdict {
  if (f.fallen) return "fallen";
  if (floorOf(house, feet[1]) !== floorOf(house, king.pos[1])) return "floor";
  if (Math.hypot(feet[0] - king.pos[0], feet[2] - king.pos[2]) > HIT_REACH) return "far";
  if (Math.abs(relativeBearing(feet, king.pos, yaw)) > HIT_CONE_DEG) return "facing";
  if (now - f.lastHitAt < HIT_COOLDOWN_MS) return "cooldown";
  return "ok";
}

/** A hit landed at `now`: one point off (never below 0), counted, stamped. */
export function hit(f: Fight, now: number): Fight {
  return { ...f, hp: Math.max(0, f.hp - 1), hits: f.hits + 1, lastHitAt: now };
}

/**
 * Does a game's end deal a fresh board at the same stage, the window still
 * open? The King winning and a draw (a pawns-only stalemate is the common
 * one) do: only checkmate fells him, so a stuck game never leaves the
 * program with nothing to do (OCT31 decision 6). A win and giving up close
 * the board.
 */
export function redeals(result: string): boolean {
  return result === "lost" || result === "drawn";
}

/** The line a re-dealt board shows under its stage (the window no longer
 *  sends the player back to ⚔ on its own): how to make him weaker — none at
 *  PAWNS ONLY (he can't get weaker) or on the first deal. */
export function redealTip(deal: number, stage: Stage): string | null {
  return deal > 0 && stage !== "pawns" ? "Too strong? Give up, then hit him more to make him weaker." : null;
}

/** Checkmate: he is down. */
export function fell(f: Fight): Fight {
  return { ...f, fallen: true };
}

/** `♥` per point left, `♡` per point lost; "" at 0. */
export function hearts(f: Fight): string {
  if (f.hp <= 0) return "";
  return "♥".repeat(f.hp) + "♡".repeat(Math.max(0, f.max - f.hp));
}

export const STAGE_LINE: Record<Stage, string> = {
  grandmaster: "The King is at full strength.",
  club: "The King is rattled.",
  beginner: "The King is reeling.",
  dizzy: "The King is dizzy — he can barely see the board.",
  pawns: "The King has lost his court. Pawns only.",
};
