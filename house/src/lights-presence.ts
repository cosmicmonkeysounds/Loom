//! (wave 39) The house lights meet the reinstallation games, both ways.
//!
//! **A program pulses the real light it walks under.** `presenceStep` takes
//! every live program's pose (its presence room and feet) and the fixtures
//! `lights.json` `presence` lets pulse (`presenceFixtures`: never a safety
//! light) and says which fixtures have a program under them now: the same
//! room and within `radius` in plan, `LIGHT_PRESENCE_LEAVE_M` further for
//! one already under it, and held `LIGHT_PRESENCE_HOLD_MS` after the last
//! one left so a program pacing at the edge never flaps a Zigbee bulb. The
//! event server runs it on every pose flush; the house's lights module
//! plays the firmware effect while a fixture is pulsed.
//!
//! **The games light their house with the real one.** `GameLights` is the
//! spatial stream's `lights` frame: every placed fixture with the colour and
//! level it shows now (the lights module's report, else the server's own
//! replay of the last look) and whether a program is under it. `lampOf`
//! turns a fixture's Z2M-style state into what a game draws;
//! `gameLightsOf` reads the frame off the wire. Pure, no `node:` imports.

import type { LightEffect, LightFixture, LightKind, LightPresenceEffect, LightState, LightsConfig } from "./lights.ts";
import { LIGHT_EFFECTS, LIGHT_KINDS, LIGHT_PRESENCE_HOLD_MS, LIGHT_PRESENCE_LEAVE_M, presenceFixtures, presenceSettings } from "./lights.ts";
import { LAMP_SETTLED, miredsToHex, type LampShown } from "./look-preview.ts";
import type { HouseMap, Vec3 } from "./types.ts";

/** One live program as presence reads it. `room`: its presence room (null: outside). */
export interface PresencePlayer {
  session: string;
  room: string | null;
  p: Vec3;
}

/** One pulsed fixture. */
export interface PresenceEntry {
  /** The sessions under it now (sorted); [] while it is held after they left. */
  sessions: string[];
  /** When it started pulsing (ms). */
  since: number;
  /** When a program was last under it (ms). */
  last: number;
}

/**
 * Which fixtures have a program under them at `now`. `prev` is the last
 * step's answer (the hysteresis and the hold read it). A fixture with no
 * program left stays in the answer, `sessions: []`, until
 * `LIGHT_PRESENCE_HOLD_MS` after `last`. Presence off (or no fixture may
 * pulse): an empty map.
 */
export function presenceStep(lights: LightsConfig, house: HouseMap | null | undefined, players: readonly PresencePlayer[], prev: ReadonlyMap<string, PresenceEntry>, now: number): Map<string, PresenceEntry> {
  const out = new Map<string, PresenceEntry>();
  const { radius } = presenceSettings(lights);
  for (const f of presenceFixtures(lights, house)) {
    const was = prev.get(f.id);
    const under: string[] = [];
    for (const pl of players) {
      if (pl.room === null || pl.room !== f.room) continue;
      const reach = radius + (was?.sessions.includes(pl.session) === true ? LIGHT_PRESENCE_LEAVE_M : 0);
      if (Math.hypot(pl.p[0] - f.pos.x, pl.p[2] - f.pos.z) <= reach + 1e-9) under.push(pl.session);
    }
    under.sort();
    if (under.length > 0) out.set(f.id, { sessions: under, since: was?.since ?? now, last: now });
    else if (was !== undefined && now - was.last < LIGHT_PRESENCE_HOLD_MS) out.set(f.id, { sessions: [], since: was.since, last: was.last });
  }
  return out;
}

/** Do two steps pulse the same fixtures? (Who is under them doesn't matter to a bulb.) */
export function samePulsed(a: ReadonlyMap<string, PresenceEntry>, b: ReadonlyMap<string, PresenceEntry>): boolean {
  if (a.size !== b.size) return false;
  for (const k of a.keys()) if (!b.has(k)) return false;
  return true;
}

/** Where a game's fixture states come from: the lights module's report
 *  (`house`), or the server's own replay of the last look per fixture
 *  (`estimate`: no module, or its report is stale). */
export type GameLightsSource = "house" | "estimate";

/** One fixture as a game draws it. */
export interface GameLight {
  id: string;
  room: string;
  /** Metres, the house frame (absolute, as `lights.json`). */
  pos: { x: number; y: number; z: number };
  kind: LightKind;
  /** The colour at full brightness, `#rrggbb`. */
  color: string;
  /** 0 (dark) – 1 (full). */
  level: number;
  /** A firmware effect running now, else null. */
  effect: LightEffect | null;
  /** A program is under it (or was, within the hold): the games pulse it too. */
  pulse: boolean;
  safety: boolean;
}

/** The spatial stream's `lights` frame. */
export interface GameLights {
  /** Server ms. */
  at: number;
  source: GameLightsSource;
  /** The presence pulse's effect, null when presence is off. */
  pulse: LightPresenceEffect | null;
  lights: GameLight[];
}

/** Merge one command into a fixture's state the way a bulb keeps it
 *  (`color` and `color_temp` replace each other; `transition` is dropped). */
export function mergeLightState(was: Readonly<LightState>, set: Readonly<LightState>): LightState {
  const out: LightState = { ...was };
  if (set.state !== undefined) out.state = set.state;
  if (set.brightness !== undefined) out.brightness = set.brightness;
  if (set.color !== undefined) {
    out.color = set.color;
    delete out.color_temp;
  }
  if (set.color_temp !== undefined) {
    out.color_temp = set.color_temp;
    delete out.color;
  }
  if (set.effect !== undefined) {
    if (set.effect === "stop_effect" || set.effect === "finish_effect") delete out.effect;
    else out.effect = set.effect;
  }
  return out;
}

/** What a fixture's (merged) state looks like: OFF is dark, a missing
 *  field keeps `LAMP_SETTLED`'s. */
export function lampOf(state: Readonly<LightState>): LampShown {
  const color = state.color ?? (state.color_temp !== undefined ? miredsToHex(state.color_temp) : LAMP_SETTLED.color);
  const brightness = state.state === "OFF" ? 0 : state.brightness ?? LAMP_SETTLED.brightness;
  const effect = state.effect !== undefined && state.effect !== "stop_effect" && state.effect !== "finish_effect" ? state.effect : null;
  return { brightness, color, effect };
}

/** One fixture for the frame. */
export function gameLight(f: LightFixture, lamp: LampShown, pulse: boolean): GameLight {
  return {
    id: f.id,
    room: f.room,
    pos: { x: f.pos.x, y: f.pos.y, z: f.pos.z },
    kind: f.kind,
    color: lamp.color.toLowerCase(),
    level: Math.round((Math.max(0, Math.min(254, lamp.brightness)) / 254) * 1000) / 1000,
    effect: lamp.effect,
    pulse,
    safety: f.safety === true,
  };
}

const HEX = /^#[0-9a-f]{6}$/iu;

/** Read a `lights` frame off the wire (null when it isn't one); a malformed
 *  light is dropped, not the frame. */
export function gameLightsOf(raw: unknown): GameLights | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r["lights"])) return null;
  const lights: GameLight[] = [];
  for (const l of r["lights"] as unknown[]) {
    if (typeof l !== "object" || l === null) continue;
    const o = l as Record<string, unknown>;
    const pos = o["pos"] as Record<string, unknown> | undefined;
    if (typeof o["id"] !== "string" || typeof pos !== "object" || pos === null) continue;
    const [x, y, z] = [pos["x"], pos["y"], pos["z"]];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number" || ![x, y, z].every(Number.isFinite)) continue;
    const level = typeof o["level"] === "number" && Number.isFinite(o["level"]) ? Math.max(0, Math.min(1, o["level"])) : 0;
    lights.push({
      id: o["id"],
      room: typeof o["room"] === "string" ? o["room"] : "",
      pos: { x, y, z },
      kind: (LIGHT_KINDS as readonly unknown[]).includes(o["kind"]) ? (o["kind"] as LightKind) : "zigbee",
      color: typeof o["color"] === "string" && HEX.test(o["color"]) ? o["color"].toLowerCase() : LAMP_SETTLED.color,
      level,
      effect: (LIGHT_EFFECTS as readonly unknown[]).includes(o["effect"]) ? (o["effect"] as LightEffect) : null,
      pulse: o["pulse"] === true,
      safety: o["safety"] === true,
    });
  }
  const pulse = r["pulse"];
  return {
    at: typeof r["at"] === "number" ? r["at"] : 0,
    source: r["source"] === "house" ? "house" : "estimate",
    pulse: pulse === "breathe" || pulse === "blink" || pulse === "okay" ? pulse : null,
    lights,
  };
}

/** A game's pulse brightness factor at `t` seconds into a pulse (1 → ~0.35 → 1,
 *  one breath per `period` s): the games draw a pulsed fixture with it. */
export function pulseFactor(t: number, period = 2): number {
  const phase = (((t / period) % 1) + 1) % 1;
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2));
}
