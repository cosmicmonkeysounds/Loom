//! Footsteps in the real house (wave 49): as a program pulses the real light
//! it walks under (wave 39), it is heard walking. The event server judges,
//! from the poses it already has, which speakers carry each program's steps
//! and how loud: a pure step over `audio.json`, the house map and the
//! players, sent to the router only when the answer changes. The router
//! plays the steps itself at the pace `speed` asks for, so nothing goes over
//! the wire per step and one slow link never stutters a walk.
//!
//! **Who hears what** (`walkerOutputs`). A speaker's level falls with the
//! distance from the program's feet (−6 dB per doubling past 1 m). A speaker
//! in the program's own presence room plays it clear; one in another room on
//! the same floor plays it `FOOTSTEP_WALL_DB` down and muffled, as through a
//! wall; one on another floor `FOOTSTEP_FLOOR_DB` down and muffled, as
//! through a ceiling. Past `reach`, or under `FOOTSTEP_CUT_DB`, it is
//! silent, and at most `FOOTSTEP_SPEAKERS` speakers carry one program.
//!
//! The steps are a surprise: the guests' play help never describes them.
//! Pure, no `node:` imports.

import type { AudioConfig, AudioSpeaker } from "./audio.ts";
import { AUDIO_GAIN_MAX, AUDIO_GAIN_MIN } from "./audio.ts";
import { roomById } from "./geometry.ts";
import type { HouseMap, Vec3 } from "./types.ts";

/** `audio.json` `footsteps`. Absent: on, with the defaults. */
export interface FootstepsConfig {
  enabled?: boolean;
  /** How far a speaker carries a program's steps (m). */
  reach?: number;
  /** dB on every step, on top of the mix's Footsteps strip. */
  gain?: number;
}

export const FOOTSTEP_REACH_M = 7;
export const FOOTSTEP_REACH_MIN = 2;
export const FOOTSTEP_REACH_MAX = 20;
/** Another room, same floor (dB, and muffled). */
export const FOOTSTEP_WALL_DB = -8;
/** Another floor (dB, and muffled). */
export const FOOTSTEP_FLOOR_DB = -12;
/** Quieter than this is not played (dB). */
export const FOOTSTEP_CUT_DB = -30;
/** The most speakers one program is heard on. */
export const FOOTSTEP_SPEAKERS = 3;
/** Levels are sent to this step (dB), so a walk only moves them now and then. */
export const FOOTSTEP_STEP_DB = 2;
/** Slower than this is standing still (m/s). */
export const FOOTSTEP_MOVING_MPS = 0.25;
/** Faster than this is a teleport, not a walk (m/s). */
export const FOOTSTEP_MAX_MPS = 6;
/** Speed is sent to this step (m/s). */
export const FOOTSTEP_SPEED_STEP = 0.25;
/** One stride (m): the pace is `speed / stride` steps a second. */
export const FOOTSTEP_STRIDE_M = 0.72;
/** The pace's bounds, seconds a step. */
export const FOOTSTEP_PACE_MIN_S = 0.3;
export const FOOTSTEP_PACE_MAX_S = 0.9;
/** The hub measures speed over at least this long (ms). */
export const FOOTSTEP_MEASURE_MS = 250;
/** Frames go out at most this often (ms)… */
export const FOOTSTEPS_MIN_MS = 200;
/** …and at least this often while anyone walks (ms), so the router can tell
 *  a quiet house from a dead link. */
export const FOOTSTEPS_KEEP_MS = 2000;
/** With no frame for this long the router stops every walker (ms). */
export const FOOTSTEPS_STALE_MS = 4500;
/** A test walker lasts this long (ms). */
export const FOOTSTEP_TEST_MS = 3000;

/** What a program walks on, which picks the steps' sound. */
export const FOOTSTEP_SURFACES = ["floor", "tile", "grass"] as const;
export type FootstepSurface = (typeof FOOTSTEP_SURFACES)[number];

/** One speaker carrying a program. */
export interface WalkerOutput {
  speaker: string;
  /** Rounded to `FOOTSTEP_STEP_DB`; negative. */
  db: number;
  /** Heard through a wall or a floor. */
  muffled: boolean;
}

/** One program walking within earshot. */
export interface Walker {
  /** The session id. */
  id: string;
  /** m/s, rounded to `FOOTSTEP_SPEED_STEP`. */
  speed: number;
  surface: FootstepSurface;
  to: WalkerOutput[];
}

/** The router's frame. */
export interface WalkersFrame {
  seq: number;
  /** Server ms. */
  at: number;
  walkers: Walker[];
}

/** One live program as the step reads it. `room`: its presence room. */
export interface WalkerInput {
  session: string;
  room: string | null;
  p: Vec3;
  /** m/s, 0 standing. */
  speed: number;
}

export function footstepsSettings(audio: Pick<AudioConfig, "footsteps">): { enabled: boolean; reach: number; gain: number } {
  const f = audio.footsteps;
  return { enabled: f?.enabled !== false, reach: f?.reach ?? FOOTSTEP_REACH_M, gain: f?.gain ?? 0 };
}

/** The `footsteps` block's problems (`validateAudio` calls it). */
export function footstepsProblems(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["footsteps must be an object {enabled?, reach?, gain?}"];
  const f = raw as Record<string, unknown>;
  const out: string[] = [];
  if (f["enabled"] !== undefined && typeof f["enabled"] !== "boolean") out.push("footsteps.enabled must be a boolean");
  const reach = f["reach"];
  if (reach !== undefined && !(typeof reach === "number" && reach >= FOOTSTEP_REACH_MIN && reach <= FOOTSTEP_REACH_MAX)) out.push(`footsteps.reach must be ${FOOTSTEP_REACH_MIN} to ${FOOTSTEP_REACH_MAX} m`);
  const gain = f["gain"];
  if (gain !== undefined && !(typeof gain === "number" && gain >= AUDIO_GAIN_MIN && gain <= AUDIO_GAIN_MAX)) out.push(`footsteps.gain must be ${AUDIO_GAIN_MIN} to ${AUDIO_GAIN_MAX} dB`);
  return out;
}

/** A level to `FOOTSTEP_STEP_DB`; never -0. */
function stepDb(db: number): number {
  return Math.round(db / FOOTSTEP_STEP_DB) * FOOTSTEP_STEP_DB + 0;
}

/** A speed to `FOOTSTEP_SPEED_STEP`. */
export function stepSpeed(speed: number): number {
  return Math.round(speed / FOOTSTEP_SPEED_STEP) * FOOTSTEP_SPEED_STEP;
}

function floorOfRoom(house: HouseMap | null | undefined, room: string | null): string | null {
  if (house == null || room === null) return null;
  return roomById(house, room)?.floor ?? null;
}

function speakerFloor(house: HouseMap | null | undefined, s: AudioSpeaker): string | null {
  return s.floor ?? floorOfRoom(house, s.room);
}

/** The speakers that carry a program's steps from where it stands, loudest
 *  first (ties by file order). */
export function walkerOutputs(audio: AudioConfig, house: HouseMap | null | undefined, room: string | null, p: Vec3): WalkerOutput[] {
  const { reach, gain } = footstepsSettings(audio);
  const myFloor = floorOfRoom(house, room);
  const rows: { out: WalkerOutput; raw: number }[] = [];
  for (const s of audio.speakers) {
    if (s.out.length === 0) continue;
    const d = Math.hypot(p[0] - s.pos.x, p[1] - s.pos.y, p[2] - s.pos.z);
    if (d > reach + 1e-9) continue;
    const same = room !== null && s.room === room;
    const sameFloor = myFloor !== null && speakerFloor(house, s) === myFloor;
    const wall = same ? 0 : sameFloor ? FOOTSTEP_WALL_DB : FOOTSTEP_FLOOR_DB;
    const raw = -20 * Math.log10(Math.max(d, 1)) + wall;
    if (raw < FOOTSTEP_CUT_DB) continue;
    rows.push({ out: { speaker: s.id, db: stepDb(raw + gain), muffled: !same }, raw });
  }
  rows.sort((a, b) => b.raw - a.raw);
  return rows.slice(0, FOOTSTEP_SPEAKERS).map((r) => r.out);
}

/** What the steps sound like in `room`: grass outdoors, tile in a room the
 *  map calls a bathroom or a kitchen, else floorboards. */
export function surfaceOf(house: HouseMap | null | undefined, room: string | null): FootstepSurface {
  const r = house == null || room === null ? undefined : roomById(house, room);
  if (r === undefined) return "floor";
  if (r.outdoor === true) return "grass";
  return /bath|kitchen/iu.test(`${r.id} ${r.label}`) ? "tile" : "floor";
}

/** Every program walking within earshot. Off: nobody. */
export function walkersOf(audio: AudioConfig, house: HouseMap | null | undefined, players: readonly WalkerInput[]): Walker[] {
  if (!footstepsSettings(audio).enabled) return [];
  const out: Walker[] = [];
  for (const pl of players) {
    if (pl.speed < FOOTSTEP_MOVING_MPS || pl.speed > FOOTSTEP_MAX_MPS) continue;
    const to = walkerOutputs(audio, house, pl.room, pl.p);
    if (to.length > 0) out.push({ id: pl.session, speed: stepSpeed(pl.speed), surface: surfaceOf(house, pl.room), to });
  }
  return out;
}

/** The same walkers, carried the same way? */
export function sameWalkers(a: readonly Walker[], b: readonly Walker[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Seconds a step at `speed` m/s. */
export function stepPaceS(speed: number): number {
  if (!(speed > 0)) return FOOTSTEP_PACE_MAX_S;
  return Math.max(FOOTSTEP_PACE_MIN_S, Math.min(FOOTSTEP_PACE_MAX_S, FOOTSTEP_STRIDE_M / speed));
}
