//! (wave 39, C4) The real house lights in the game — the pure half
//! (`lamps.ts` draws them). The spatial stream's `lights` frame
//! (`GameLights`) says what every real fixture shows now; here:
//!
//! - how bright a fixture is drawn at a moment (`lampLevel`): its level,
//!   breathing with `pulseFactor` while a program is under it (`pulse`) or
//!   its firmware plays an effect — a dark bulb stays dark, as in the house;
//! - which fixtures get the few real `PointLight`s (`pickLamps`): the nearest
//!   lit ones, the player's floor first;
//! - how far the house's ambient light dims (`ambientFactor`): with a frame,
//!   toward a night floor that follows how lit the real house is, never
//!   below `NIGHT_FLOOR` (Gerald must stay findable); without one, as today;
//! - `demoLights`, a synthetic frame for a dev check with no server.

import { locate, pulseFactor, roomById, roomElevation, roomHeight } from "@loom/house";
import type { GameLight, GameLights, HouseMap, Vec3 } from "@loom/house";

/** The ambient (hemisphere + sun) with every real light dark. */
export const NIGHT_FLOOR = 0.5;
/** The ambient with every real light at full. */
export const LIT_AMBIENT = 0.8;
/** The ambient eases to its target with this time constant (s). */
export const AMBIENT_EASE_S = 1.2;
/** Under this level a fixture counts as dark (no point light). */
export const LAMP_DARK = 0.02;
/** A breath of a presence pulse (s) — the games' curve, `pulseFactor`. */
export const PULSE_PERIOD_S = 2;
/** A firmware `blink` / `okay` flashes faster. */
export const FLASH_PERIOD_S = 0.8;

/** Does this fixture animate (a presence pulse or a firmware effect)? */
export function animated(l: Pick<GameLight, "pulse" | "effect">): boolean {
  return l.pulse || l.effect === "breathe" || l.effect === "blink" || l.effect === "okay";
}

/**
 * Keep each animated fixture's start time (s) — an animation that is
 * already running keeps its phase across frames; a new one starts at `now`.
 */
export function animationClock(prev: ReadonlyMap<string, number>, lights: readonly GameLight[], now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lights) if (animated(l)) out.set(l.id, prev.get(l.id) ?? now);
  return out;
}

/** How bright a fixture is drawn, 0–1, `t` s into its animation. */
export function lampLevel(l: Pick<GameLight, "level" | "pulse" | "effect">, t: number): number {
  if (l.level <= 0) return 0;
  if (l.pulse || l.effect === "breathe") return l.level * pulseFactor(Math.max(0, t), PULSE_PERIOD_S);
  if (l.effect === "blink" || l.effect === "okay") return l.level * pulseFactor(Math.max(0, t), FLASH_PERIOD_S);
  return l.level;
}

/** Each fixture's floor, by its room (null: a room this map hasn't). */
export function lampFloors(house: HouseMap, lights: readonly GameLight[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const l of lights) out.set(l.id, roomById(house, l.room)?.floor ?? null);
  return out;
}

/**
 * The fixtures that get the real point lights: up to `n` lit ones (level ≥
 * `LAMP_DARK`), those on the player's `floor` first, then the nearest (3-D
 * distance to `at`); ties by id, so the pick is stable.
 */
export function pickLamps(lights: readonly GameLight[], at: Vec3, floor: string | null, floors: ReadonlyMap<string, string | null>, n: number): string[] {
  if (n <= 0) return [];
  const lit = lights.filter((l) => l.level >= LAMP_DARK);
  const d = (l: GameLight) => Math.hypot(l.pos.x - at[0], l.pos.y - at[1], l.pos.z - at[2]);
  return lit
    .map((l) => ({ id: l.id, away: floor !== null && floors.get(l.id) === floor ? 0 : 1, d: d(l) }))
    .sort((a, b) => a.away - b.away || a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, n)
    .map((x) => x.id);
}

/** The house's ambient factor for a frame: 1 with none (as today), else
 *  `NIGHT_FLOOR` → `LIT_AMBIENT` by the mean level of the real lights. */
export function ambientFactor(frame: Pick<GameLights, "lights"> | null): number {
  if (frame === null || frame.lights.length === 0) return 1;
  let sum = 0;
  for (const l of frame.lights) sum += Math.max(0, Math.min(1, l.level));
  return NIGHT_FLOOR + (LIT_AMBIENT - NIGHT_FLOOR) * (sum / frame.lights.length);
}

/** Ease `cur` toward `target` over `dt` s (time constant `tau`). */
export function easeToward(cur: number, target: number, dt: number, tau = AMBIENT_EASE_S): number {
  if (!(dt > 0)) return cur;
  return target + (cur - target) * Math.exp(-dt / Math.max(1e-3, tau));
}

const DEMO_COLORS = ["#ffd9a0", "#ff4fd8", "#4fd8ff", "#a0ff7a", "#ffb347", "#b38cff"];

/**
 * A synthetic `lights` frame for a dev check with no lights config: a
 * fixture under each indoor room's ceiling, at its centre, in a colour of
 * its own; the one a program at `at` stands under (same room, ≤ 1.6 m plan)
 * pulses. Never sent anywhere.
 */
export function demoLights(house: HouseMap, at: Vec3 | null, nowMs: number): GameLights {
  const here = at === null ? null : locate(house, at).room;
  const lights: GameLight[] = [];
  house.rooms.forEach((room, i) => {
    if (room.outdoor === true || room.poly.length === 0) return;
    let x = 0;
    let z = 0;
    for (const [px, pz] of room.poly) {
      x += px;
      z += pz;
    }
    x /= room.poly.length;
    z /= room.poly.length;
    const y = roomElevation(house, room) + Math.max(1.8, roomHeight(house, room) - 0.15);
    const under = at !== null && here === room.id && Math.hypot(at[0] - x, at[2] - z) <= 1.6;
    lights.push({
      id: `demo-${room.id}`,
      room: room.id,
      pos: { x, y, z },
      kind: "zigbee",
      color: DEMO_COLORS[i % DEMO_COLORS.length]!,
      level: i % 5 === 4 ? 0 : 0.85,
      effect: null,
      pulse: under,
      safety: false,
    });
  });
  return { at: nowMs, source: "estimate", pulse: "breathe", lights };
}
