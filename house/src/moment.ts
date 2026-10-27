//! Game moments on props (wave 26, C6): Trabolta's heart (a `heart` prop,
//! R6) and the virus disk (a `pickup` prop, R7). Both games pre-check with
//! these rules before they post `POST /api/spatial/moment`; the server
//! judges the session's last pose with the same rules (a pickup with
//! `PICKUP_SLACK_M`). Pure; the GDScript port is
//! `reinstall/vr/house/house_moment.gd`, pinned by `<map>.moments.json`.

import { DUCK_MAX_RISE } from "./duck.ts";
import { distanceToBoundary, pointInPoly, roomById } from "./geometry.ts";
import { floorOf, locate } from "./locate.ts";
import type { HouseMap, Prop, Vec2, Vec3 } from "./types.ts";

/** The story signal a heart posts when its prop names none (`signals.reached`). */
export const HEART_SIGNAL = "simulation heart reached";
/** The story signal a pickup posts when its prop names none (`signals.taken`). */
export const PICKUP_SIGNAL = "simulation pickup taken";
/** "Reached": the feet this far (plan) inside the heart's room. */
export const HEART_INSET_M = 0.3;
/** A pickup is in reach within this plan distance of its `pos`, on its floor. */
export const PICKUP_REACH_M = 0.9;
/** The server's extra pickup reach (its pose lags the player a little). */
export const PICKUP_SLACK_M = 0.3;

/** The prop kinds a moment names. */
export type MomentPropKind = "heart" | "pickup";

/**
 * Has a player with their feet at `feet` reached `heart`? `locate(feet)`
 * puts them in the heart's room, at least `HEART_INSET_M` (plan) inside
 * its polygon — past the doorway, not standing in it. The heart prop's
 * own position doesn't matter: walking into the room is reaching it.
 */
export function heartReached(house: HouseMap, feet: Vec3, heart: Prop): boolean {
  if (locate(house, feet).room !== heart.room) return false;
  const room = roomById(house, heart.room);
  if (room === undefined) return false;
  const plan: Vec2 = [feet[0], feet[2]];
  return pointInPoly(room.poly, plan) && distanceToBoundary(room.poly, plan) >= HEART_INSET_M - 1e-9;
}

/**
 * Can a player with their feet at `feet` pick `prop` up? On its floor
 * (`floorOf` of the two heights), within `DUCK_MAX_RISE` of it in height
 * (it may rest on a shelf), and within `PICKUP_REACH_M + slack` of its
 * base centre in plan. The server passes `PICKUP_SLACK_M`.
 */
export function pickupReach(house: HouseMap, feet: Vec3, prop: Prop, slack = 0): boolean {
  if (floorOf(house, feet[1]) !== floorOf(house, prop.pos[1])) return false;
  if (Math.abs(prop.pos[1] - feet[1]) > DUCK_MAX_RISE + 1e-9) return false;
  return Math.hypot(prop.pos[0] - feet[0], prop.pos[2] - feet[2]) <= PICKUP_REACH_M + slack + 1e-9;
}

/** The prop `id` when it is of `kind`, else null (no such prop, or another kind). */
export function momentProp(house: HouseMap, id: string, kind: MomentPropKind): Prop | null {
  const prop = house.props.find((p) => p.id === id);
  return prop !== undefined && prop.kind === kind ? prop : null;
}

/** The heart props of a map, in array order. */
export function heartProps(house: HouseMap): Prop[] {
  return house.props.filter((p) => p.kind === "heart");
}

/** The pickup props of a map, in array order. */
export function pickupProps(house: HouseMap): Prop[] {
  return house.props.filter((p) => p.kind === "pickup");
}

/**
 * The story signal a moment on `prop` posts: a heart's `signals.reached`,
 * a pickup's `signals.taken` (a non-empty string), else the kind's
 * default (`HEART_SIGNAL`, `PICKUP_SIGNAL`). Any other kind posts no
 * moment: "".
 */
export function propSignal(prop: Prop): string {
  const own = prop.kind === "heart" ? prop.signals?.reached : prop.kind === "pickup" ? prop.signals?.taken : undefined;
  if (typeof own === "string" && own.trim() !== "") return own;
  return prop.kind === "heart" ? HEART_SIGNAL : prop.kind === "pickup" ? PICKUP_SIGNAL : "";
}
