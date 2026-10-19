//! The King — a `kind: "king"` prop standing in a guarded doorway
//! (`Door.guard`). One shared health bar per event (C2): the server holds
//! it, every reinstallation visit may knock one point off, and at 0 he
//! kneels and his doors open for everyone. Pure: the reach rule both games
//! and the server judge a hit by, the defaults, and the map a fallen King
//! leaves behind (`withFallenKings`, what `route()`'s `fallen` option uses).

import { wrapYaw } from "./frames.ts";
import { floorOf } from "./locate.ts";
import type { Door, HouseMap, KingState, Prop, Vec3 } from "./types.ts";

/** Plan metres, feet → the king's base centre (the body stops ≈ 0.55 m from it). */
export const KING_REACH = 1.25;
/** |relative bearing| allowed, degrees: the player must face him. */
export const KING_CONE_DEG = 55;
/** A king's maximum hit points when the prop declares none. */
export const KING_HP = 4;
/** The story signals a king prop names when it declares none (`Prop.signals`). */
export const KING_SIGNALS = Object.freeze({
  won: "chess won",
  lost: "chess lost",
  drawn: "chess drawn",
  hit: "king hit",
  fallen: "king fallen",
});

export type KingSignal = keyof typeof KING_SIGNALS;

/** Every king prop of a map, in array order. */
export function kingProps(house: HouseMap): Prop[] {
  return house.props.filter((p) => p.kind === "king");
}

/** A king's maximum hit points: its `hp` (an integer ≥ 1), else `KING_HP`. */
export function kingMax(king: Prop): number {
  const hp = king.hp;
  return typeof hp === "number" && Number.isInteger(hp) && hp >= 1 ? hp : KING_HP;
}

/** The story signal a king posts for `which`: its own, else the default. */
export function kingSignal(king: Prop, which: KingSignal): string {
  const own = king.signals?.[which];
  return typeof own === "string" && own.trim() !== "" ? own : KING_SIGNALS[which];
}

/**
 * A king's state from a raw current value (`health`'s world value, or the
 * hub's own count): a missing or non-number value reads as full; otherwise
 * rounded and clamped to `0..max`. `fallen` ⇔ `hp ≤ 0`.
 */
export function kingStateOf(king: Prop, raw: unknown): KingState {
  const max = kingMax(king);
  const hp = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.round(raw))) : max;
  return { id: king.id, hp, max, fallen: hp <= 0 };
}

/** The doors a king guards (`Door.guard === king`), in array order. */
export function guardedDoors(house: HouseMap, king: string): Door[] {
  return house.doors.filter((d) => d.guard === king);
}

export type KingReach = "ok" | "floor" | "far" | "facing";

/** Extra allowance on the reach rule — the server's, since a 10 Hz
 *  latest-only pose lags the player a little. */
export interface KingSlack {
  /** Extra plan metres on `KING_REACH`. */
  reach?: number;
  /** Extra degrees on `KING_CONE_DEG`. */
  cone?: number;
}

/** The server's slack on a hit (C2): the pose it judges is the session's
 *  last, which a 10 Hz latest-only pump leaves a little behind the player. */
export const KING_HIT_SLACK: Readonly<Required<KingSlack>> = Object.freeze({ reach: 0.35, cone: 25 });

/**
 * May a player at `feet` facing `yaw` (degrees, §1 convention) hit `king`?
 * In order: on another floor (`floorOf` of the two heights) → "floor";
 * plan distance feet → his base centre over `KING_REACH` → "far"; the
 * plan bearing to him more than `KING_CONE_DEG` off the facing → "facing";
 * else "ok" (standing on his very centre counts as facing him). `slack`
 * widens the reach and the cone. Cooldowns and his falling are the
 * server's to judge, not this rule's.
 */
export function kingReach(house: HouseMap, feet: Vec3, yaw: number, king: Prop, slack: KingSlack = {}): KingReach {
  if (floorOf(house, feet[1]) !== floorOf(house, king.pos[1])) return "floor";
  const dx = king.pos[0] - feet[0];
  const dz = king.pos[2] - feet[2];
  if (Math.hypot(dx, dz) > KING_REACH + (slack.reach ?? 0)) return "far";
  if (dx === 0 && dz === 0) return "ok";
  // The yaw that faces him (§1: 0 = north / −z, counter-clockwise +).
  const toward = (Math.atan2(-dx, -dz) * 180) / Math.PI;
  if (Math.abs(wrapYaw(toward - yaw)) > KING_CONE_DEG + (slack.cone ?? 0)) return "facing";
  return "ok";
}

/**
 * The map once the kings named in `fallen` are down: every door one of them
 * guards loses its `guard` (open for routing, as for the physics), and each
 * of those king props stops being solid (he kneels; the games' physics
 * leaves him out). A copy — `house` is untouched; an empty set (or one
 * naming no king) returns `house` itself.
 */
export function withFallenKings(house: HouseMap, fallen: ReadonlySet<string>): HouseMap {
  if (fallen.size === 0 || !house.props.some((p) => p.kind === "king" && fallen.has(p.id))) return house;
  const doors = house.doors.map((d): Door => {
    if (d.guard === undefined || !fallen.has(d.guard)) return d;
    const { guard: _guard, ...rest } = d;
    return rest;
  });
  const props = house.props.map((p): Prop => (p.kind === "king" && fallen.has(p.id) ? { ...p, solid: false } : p));
  return { ...house, doors, props };
}
