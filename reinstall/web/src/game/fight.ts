//! The fight with a `king` prop — pure. A player walks up to the King and
//! hits him (⚔ / Space, one hit per `HIT_COOLDOWN_MS`): each hit knocks a
//! point off his strength, which picks the chess AI's stage when the player
//! challenges him (♟ / C) — a grandmaster at full strength, down to a king
//! with nothing but his eight pawns. Checkmate fells him (`fell`); a loss, a
//! draw or an abandoned game changes nothing. Per session: nothing here is
//! shared with another device.

import { floorOf } from "@loom/house";
import type { HouseMap, Prop, Vec3 } from "@loom/house";
import { relativeBearing } from "./hud.ts";

/** Hit points when the prop declares none. */
export const KING_HP = 4;
/** One hit per this many milliseconds. */
export const HIT_COOLDOWN_MS = 1200;
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
