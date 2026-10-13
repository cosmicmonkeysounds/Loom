//! Where Gerald hides — `docs/loom-reinstall.md` §2.1. Deterministic per
//! seed (the session id), so a restart or a second process agrees.

import type { DuckSpot, HouseMap } from "./types.ts";

/**
 * The highest a duck spot may sit above its room's floor, in metres — and
 * the server's `found` height check (`core/server/spatial.ts`), so a spot
 * the validator accepts can always be found.
 */
export const DUCK_MAX_RISE = 1.2;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a 32 over the string's UTF-8 bytes (GDScript: `to_utf8_buffer()`), unsigned. */
export function fnv1a32(s: string): number {
  let h = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte;
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/**
 * The duck spot for a session: `fnv1a32(seed) % candidates.length`, where
 * the candidates are the spots outside the spawn room (unless that leaves
 * none), then minus `avoid` (unless that leaves none). Throws on a house
 * with no spots (`validateHouse` refuses one).
 */
export function pickDuckSpot(house: HouseMap, seed: string, avoid: readonly string[] = []): DuckSpot {
  let candidates = house.duck.spots.filter((s) => s.room !== house.spawn.room);
  if (candidates.length === 0) candidates = house.duck.spots;
  const kept = candidates.filter((s) => !avoid.includes(s.id));
  if (kept.length > 0) candidates = kept;
  const spot = candidates[fnv1a32(seed) % candidates.length];
  if (!spot) throw new Error("house has no duck spots");
  return spot;
}

/** A short content hash of a map (8 hex digits) — a cheap `houseVersion`. */
export function houseHash(house: HouseMap): string {
  return fnv1a32(JSON.stringify(house)).toString(16).padStart(8, "0");
}
