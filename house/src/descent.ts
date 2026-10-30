//! The descent (wave 49): the more often a program is reinstalled, the less
//! the simulation holds together. House of Leaves and Alice: the house goes
//! wrong, things appear, props start talking, and a door turns up that was
//! not there. Contract: `docs/loom-w49-contract.md`.
//!
//! **Pure, and the games' only shared part.** Everything here is a decision
//! both games must make alike: the **level** a walk runs at, its seeded
//! **plan** of visions, which props are **awake**, and how a talker's
//! dialogue walks. What a vision looks like is each game's own. Nothing here
//! touches the server's judgement: a vision never blocks a find or a hit, no
//! prop with `from` is solid, and only what a program told a talker is
//! remembered (memory only, `POST /api/spatial/told`).
//!
//! The words live in the show's `descent.json` (a project file read live, so
//! a text change never needs a new headset build), checked by
//! `validateDescent`. A level with no script still plays its visions; only
//! the talkers and the lines are missing.
//!
//! The GDScript port is `reinstall/vr/house/house_descent.gd`, diffed against
//! `test/golden/descent.json`; change both together.

import { fnv1a32 } from "./duck.ts";
import { wrapYaw } from "./frames.ts";
import { floorOf, locate, standable } from "./locate.ts";
import { propModel } from "./models.ts";
import type { HouseMap, Prop, Vec3 } from "./types.ts";

/** The project file's name. */
export const DESCENT_FILE = "descent.json";
/** The deepest level; every reinstall past it stays here. */
export const DESCENT_MAX = 4;

/** The things that can happen to a program, mildest first. */
export const VISION_KINDS = ["flicker", "follower", "whisper", "tint", "whiteduck", "grin", "dark", "self", "small", "big", "door"] as const;
export type VisionKind = (typeof VISION_KINDS)[number];

/** The level a vision first happens at. */
export const VISION_FROM: Readonly<Record<VisionKind, number>> = { flicker: 1, follower: 1, whisper: 1, tint: 2, whiteduck: 2, grin: 2, dark: 3, self: 3, small: 3, big: 3, door: 3 };
/** How long a vision holds (s). `door` is how long it waits to be walked through. */
export const VISION_S: Readonly<Record<VisionKind, number>> = { flicker: 2.5, follower: 7, whisper: 5, tint: 9, whiteduck: 6, grin: 8, dark: 11, self: 9, small: 22, big: 18, door: 30 };

/** Seconds into a walk of the first vision, per level. */
export const DESCENT_FIRST_S: readonly number[] = [0, 25, 18, 12, 8];
/** The mean gap between visions, per level (s; each is 0.65–1.35 of it). */
export const DESCENT_GAP_S: readonly number[] = [0, 70, 48, 34, 22];
/** How far a plan reaches (s). A walk is rarely half this. */
export const DESCENT_PLAN_S = 900;
/** A vision that could not run for this long (s) is dropped, not saved up. */
export const DESCENT_LATE_S = 20;
/** Props awake per level. */
export const TALKERS_AWAKE: readonly number[] = [0, 1, 2, 3, 5];

/** A talker speaks to a program within this plan distance of its edge (m). */
export const TALK_NEAR_M = 1.8;
/** Further than this and it gives up on them (m). */
export const TALK_LEAVE_M = 3;
/** The most options a node may offer. */
export const TALK_OPTIONS_MAX = 4;
/** The longest option (the headset's panel fits it). */
export const TALK_OPTION_CHARS = 48;
/** The longest line of speech (`speech`'s reading time stays sane). */
export const TALK_LINE_CHARS = 160;
/** A talker id. */
export const TALKER_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;
/** `Prop.talk` for a prop that never talks. */
export const TALK_NONE = "none";

// The Hallway (the `door` vision): a pocket off the map. The server keeps
// seeing the program at the door it walked through.
/** The corridor's width and height (m). */
export const HALLWAY_WIDTH_M = 1.3;
export const HALLWAY_HEIGHT_M = 2.3;
/** How far away the far door stands when you enter (m). */
export const HALLWAY_FAR_M = 14;
/** The far door backs away for this long (s), then lets you reach it. */
export const HALLWAY_RETREAT_S = 22;
/** It backs away at this fraction of your own pace. */
export const HALLWAY_RETREAT = 0.92;
/** Nobody is in there longer than this (s): the house lets them go. */
export const HALLWAY_MAX_S = 70;
/** Walking within this of a door goes through it (m). */
export const HALLWAY_DOOR_M = 0.7;

/** The `door` vision stands this far from the program (m). */
export const DOOR_AHEAD_M = 3;

/** Small / big: the eye height scales by this, over `ALICE_EASE_S`. */
export const ALICE_SMALL = 0.32;
export const ALICE_BIG = 1.42;
export const ALICE_EASE_S = 4;

/** The clamped level (a whole number, 0 … `DESCENT_MAX`; junk reads 0). */
export function clampDescent(level: unknown): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(DESCENT_MAX, Math.floor(level)));
}

/** The level of a walk by the reinstalls behind it: the first walk is clean. */
export function descentLevel(reinstalled: unknown): number {
  return clampDescent(reinstalled);
}

/** A walk's level: the server's word (`descent`), else its `reinstalled`. */
export function descentOf(a: { descent?: number | undefined; reinstalled?: number | undefined }): number {
  return typeof a.descent === "number" ? clampDescent(a.descent) : descentLevel(a.reinstalled);
}

/** The steady wrongness of a level, always on. `fog` and `ambient` multiply
 *  the game's own; `flicker` divides the neon's stutter period; `tint` is
 *  mixed into the light by `tintBy` (0 … 1). */
export interface DescentLook {
  fog: number;
  ambient: number;
  flicker: number;
  tint: string;
  tintBy: number;
}

const LOOKS: readonly DescentLook[] = [
  { fog: 1, ambient: 1, flicker: 1, tint: "#ffffff", tintBy: 0 },
  { fog: 1.15, ambient: 0.92, flicker: 1.25, tint: "#b8a6ff", tintBy: 0.06 },
  { fog: 1.35, ambient: 0.82, flicker: 1.7, tint: "#ff9ad5", tintBy: 0.1 },
  { fog: 1.6, ambient: 0.7, flicker: 2.2, tint: "#ff5a6e", tintBy: 0.14 },
  { fog: 2, ambient: 0.58, flicker: 3.3, tint: "#8aff9a", tintBy: 0.18 },
];

export function descentLook(level: number): DescentLook {
  return LOOKS[clampDescent(level)]!;
}

/** One planned vision. `n` picks among its lines and sides (any whole number). */
export interface DescentBeat {
  /** Seconds after the walk starts (the intro's end). */
  at: number;
  vision: VisionKind;
  n: number;
}

function shuffled(pool: readonly VisionKind[], seed: string): VisionKind[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = fnv1a32(`${seed}/s${i}`) % (i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * A walk's visions, in order, deterministic per seed (the session id). Every
 * kind its level allows comes up once before any repeats; `door` comes up
 * once only, and from level 3 it is always the third.
 */
export function descentPlan(seed: string, level: number): DescentBeat[] {
  const l = clampDescent(level);
  if (l === 0) return [];
  const pool = VISION_KINDS.filter((k) => VISION_FROM[k] <= l);
  const order = shuffled(pool, seed);
  const door = order.indexOf("door");
  if (door >= 0) {
    const swap = Math.min(2, order.length - 1);
    order[door] = order[swap]!;
    order[swap] = "door";
  }
  const out: DescentBeat[] = [];
  let t = DESCENT_FIRST_S[l]!;
  let turn = 0;
  for (let i = 0; t < DESCENT_PLAN_S; i++) {
    let vision = order[turn % order.length]!;
    turn += 1;
    if (vision === "door" && out.some((b) => b.vision === "door")) {
      vision = order[turn % order.length]!;
      turn += 1;
    }
    const h = fnv1a32(`${seed}:${i}`);
    out.push({ at: t, vision, n: h % 1024 });
    const jitter = 0.65 + ((h >>> 10) % 701) / 1000;
    t = Math.round((t + DESCENT_GAP_S[l]! * jitter) * 10) / 10;
  }
  return out;
}

/**
 * The next beat to play at `t` seconds. `from` is the first beat not yet
 * spent. Answers its index, or -1 while none is due. A beat `DESCENT_LATE_S`
 * overdue is passed over (it was held off too long, by a talk or a King).
 */
export function dueBeat(plan: readonly DescentBeat[], from: number, t: number): number {
  for (let i = from; i < plan.length; i++) {
    const b = plan[i]!;
    if (b.at > t) return -1;
    if (t - b.at <= DESCENT_LATE_S) return i;
  }
  return -1;
}

// -- the script (`descent.json`) -----------------------------------------------

/** A choice. `to`: the next node (absent: the talk ends). `tell`: a mark the
 *  talker remembers on later visits. `do`: a vision it sets off. */
export interface TalkOption {
  text: string;
  to?: string;
  tell?: string;
  do?: VisionKind;
}

/** A node: what is said, then the choices (none: the talk ends after it). */
export interface TalkNode {
  say: string[];
  options?: TalkOption[];
  do?: VisionKind;
}

/** Where a talk starts: the first entry whose `told` matches. */
export interface TalkOpen {
  node: string;
  /** Talker id → the mark it must hold (a talker may read another's). */
  told?: Record<string, string>;
}

export interface Talker {
  id: string;
  /** Which models it speaks through (`Prop.talk` may name it instead). */
  models?: string[];
  /** The level it wakes from (at least 1). */
  from: number;
  /** Woken ahead of the rest at its level. */
  first?: boolean;
  /** Tried in order; the fallback is the node `start`. */
  opens?: TalkOpen[];
  nodes: Record<string, TalkNode>;
}

export interface DescentScript {
  version: 1;
  note?: string;
  talkers: Talker[];
  /** A whisper's lines, per level ("1" … "4"). */
  whispers: Record<string, string[]>;
  /** Lines the vision of each kind may say. */
  grin: string[];
  whiteduck: string[];
  self: string[];
  small: string[];
  big: string[];
  /** The Hallway: on entering, at the far door, on the way out. */
  hallway: { enter: string[]; far: string[]; out: string[] };
  /** What Gerald says at the find, per level. */
  found: Record<string, string[]>;
}

export interface DescentValidation {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/** Is `raw` a usable `descent.json`? Problems refuse it; warnings advise. */
export function validateDescent(raw: unknown): DescentValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const done = (): DescentValidation => ({ ok: problems.length === 0, problems, warnings });
  if (!isObj(raw)) {
    problems.push("descent.json must be an object");
    return done();
  }
  if (raw["version"] !== 1) problems.push("version must be 1");
  const lines = (at: string, v: unknown): void => {
    if (!Array.isArray(v) || !v.every(isText)) {
      problems.push(`${at} must be a list of lines`);
      return;
    }
    for (const l of v as string[]) if (l.length > TALK_LINE_CHARS) problems.push(`${at}: a line over ${TALK_LINE_CHARS} characters ("${l.slice(0, 30)}…")`);
  };
  const levels = (at: string, v: unknown): void => {
    if (!isObj(v)) {
      problems.push(`${at} must be an object of levels`);
      return;
    }
    for (const [k, list] of Object.entries(v)) {
      if (!/^[1-4]$/u.test(k)) problems.push(`${at}.${k}: a level is 1–${DESCENT_MAX}`);
      lines(`${at}.${k}`, list);
    }
  };
  const vision = (at: string, v: unknown): void => {
    if (v !== undefined && !(VISION_KINDS as readonly unknown[]).includes(v)) problems.push(`${at}: "${String(v)}" is not a vision`);
  };
  levels("whispers", raw["whispers"]);
  levels("found", raw["found"]);
  for (const k of ["grin", "whiteduck", "self", "small", "big"] as const) lines(k, raw[k]);
  const hallway = raw["hallway"];
  if (!isObj(hallway)) problems.push("hallway must be an object {enter, far, out}");
  else for (const k of ["enter", "far", "out"] as const) lines(`hallway.${k}`, hallway[k]);

  const talkers = raw["talkers"];
  if (!Array.isArray(talkers)) {
    problems.push("talkers must be a list");
    return done();
  }
  const ids = new Set<string>();
  for (const [i, t] of talkers.entries()) {
    const at = `talkers[${i}]`;
    if (!isObj(t)) {
      problems.push(`${at} must be an object`);
      continue;
    }
    const id = t["id"];
    if (typeof id !== "string" || !TALKER_ID_PATTERN.test(id) || id === TALK_NONE) problems.push(`${at}: id must be a talker id`);
    else if (ids.has(id)) problems.push(`${at}: id "${id}" is used twice`);
    else ids.add(id);
    const who = typeof id === "string" ? `talker "${id}"` : at;
    const from = t["from"];
    if (!Number.isInteger(from) || (from as number) < 1 || (from as number) > DESCENT_MAX) problems.push(`${who}: from must be a level, 1–${DESCENT_MAX}`);
    const models = t["models"];
    if (models !== undefined) {
      if (!Array.isArray(models) || !models.every((m) => typeof m === "string")) problems.push(`${who}: models must be a list of model ids`);
      else for (const m of models as string[]) if (propModel(m) === null) warnings.push(`${who}: "${m}" is not a model yet`);
    }
    const nodes = t["nodes"];
    if (!isObj(nodes)) {
      problems.push(`${who}: nodes must be an object`);
      continue;
    }
    if (nodes["start"] === undefined) problems.push(`${who}: no "start" node`);
    const seen = new Set<string>(["start"]);
    const opens = t["opens"];
    if (opens !== undefined) {
      if (!Array.isArray(opens)) problems.push(`${who}: opens must be a list`);
      else {
        for (const o of opens) {
          if (!isObj(o) || typeof o["node"] !== "string") {
            problems.push(`${who}: an opens entry needs a node`);
            continue;
          }
          seen.add(o["node"]);
          if (nodes[o["node"]] === undefined) problems.push(`${who}: opens names no node "${o["node"]}"`);
        }
      }
    }
    for (const [name, n] of Object.entries(nodes)) {
      const nat = `${who} node "${name}"`;
      if (!isObj(n)) {
        problems.push(`${nat} must be an object`);
        continue;
      }
      lines(`${nat} say`, n["say"]);
      vision(`${nat} do`, n["do"]);
      const options = n["options"];
      if (options === undefined) continue;
      if (!Array.isArray(options) || options.length === 0) {
        problems.push(`${nat}: options must be a non-empty list`);
        continue;
      }
      if (options.length > TALK_OPTIONS_MAX) problems.push(`${nat}: more than ${TALK_OPTIONS_MAX} options`);
      for (const [k, o] of options.entries()) {
        const oat = `${nat} option ${k + 1}`;
        if (!isObj(o) || !isText(o["text"])) {
          problems.push(`${oat}: needs text`);
          continue;
        }
        if ((o["text"] as string).length > TALK_OPTION_CHARS) problems.push(`${oat}: over ${TALK_OPTION_CHARS} characters`);
        if (o["to"] !== undefined) {
          if (typeof o["to"] !== "string" || nodes[o["to"]] === undefined) problems.push(`${oat}: goes to no node "${String(o["to"])}"`);
          else seen.add(o["to"]);
        }
        if (o["tell"] !== undefined && !isText(o["tell"])) problems.push(`${oat}: tell must be a mark`);
        vision(`${oat} do`, o["do"]);
      }
    }
    for (const name of Object.keys(nodes)) if (!seen.has(name)) warnings.push(`${who}: node "${name}" is never reached`);
  }
  return done();
}

/** The script in `raw`, or null when it doesn't validate. */
export function parseDescent(raw: unknown): DescentScript | null {
  return validateDescent(raw).ok ? (raw as DescentScript) : null;
}

/** The talker a prop speaks through, or null. */
export function talkerFor(script: DescentScript, prop: Prop): Talker | null {
  if (prop.talk === TALK_NONE) return null;
  if (prop.talk !== undefined) return script.talkers.find((t) => t.id === prop.talk) ?? null;
  if (prop.model === undefined) return null;
  return script.talkers.find((t) => t.models?.includes(prop.model!) === true) ?? null;
}

/** One awake prop. */
export interface TalkerWake {
  prop: string;
  talker: string;
}

/**
 * Who is awake on this walk: up to `TALKERS_AWAKE[level]` props, one per
 * talker, in as many rooms as it can, `first` talkers ahead of the rest, in
 * an order seeded by the session. A prop not there yet (`from`) never wakes.
 */
export function wakeTalkers(house: HouseMap, script: DescentScript | null, level: number, seed: string): TalkerWake[] {
  const l = clampDescent(level);
  if (script === null || l === 0) return [];
  const rows: { prop: Prop; talker: Talker; key: number }[] = [];
  for (const prop of house.props) {
    if ((prop.from ?? 0) > l) continue;
    const talker = talkerFor(script, prop);
    if (talker === null || talker.from > l) continue;
    rows.push({ prop, talker, key: fnv1a32(`${seed}:${prop.id}`) });
  }
  rows.sort((a, b) => (a.talker.first === true ? 0 : 1) - (b.talker.first === true ? 0 : 1) || a.key - b.key || (a.prop.id < b.prop.id ? -1 : 1));
  const want = TALKERS_AWAKE[l]!;
  const out: TalkerWake[] = [];
  const talkers = new Set<string>();
  const rooms = new Set<string>();
  for (const pass of [0, 1]) {
    for (const r of rows) {
      if (out.length >= want) return out;
      if (talkers.has(r.talker.id) || (pass === 0 && rooms.has(r.prop.room))) continue;
      talkers.add(r.talker.id);
      rooms.add(r.prop.room);
      out.push({ prop: r.prop.id, talker: r.talker.id });
    }
  }
  return out;
}

/** Is a program with its feet at `feet` within `radius` (plan, from the
 *  prop's edge) of `prop`, on its floor? */
export function talkReach(house: HouseMap, feet: Vec3, prop: Prop, radius: number = TALK_NEAR_M): boolean {
  if (floorOf(house, feet[1]) !== floorOf(house, prop.pos[1])) return false;
  const reach = radius + Math.max(prop.size[0], prop.size[2]) / 2;
  return Math.hypot(prop.pos[0] - feet[0], prop.pos[2] - feet[2]) <= reach + 1e-9;
}

/** Where a talker's face sits, in the house frame: on the prop's front, two
 *  thirds up; `yaw` the way the prop faces. */
export function faceAnchor(prop: Prop): { pos: Vec3; yaw: number } {
  const yaw = prop.yaw ?? 0;
  const a = (yaw * Math.PI) / 180;
  const out = prop.size[2] / 2 + 0.02;
  return { pos: [prop.pos[0] - Math.sin(a) * out, prop.pos[1] + prop.size[1] * 0.68, prop.pos[2] - Math.cos(a) * out], yaw };
}

/**
 * Where the Hallway's door turns up: `DOOR_AHEAD_M` ahead of a program at
 * `feet` looking along `yaw`, in the room it is in, turned to face it; else
 * off to a side, else behind it. Null when nowhere fits (outdoors in a corner,
 * or no room at all): the vision is skipped.
 */
export function doorSpot(house: HouseMap, feet: Vec3, yaw: number): { pos: Vec3; yaw: number } | null {
  const room = locate(house, feet).room;
  if (room === null) return null;
  for (const turn of [0, 40, -40, 90, -90, 180]) {
    const a = ((yaw + turn) * Math.PI) / 180;
    const pos: Vec3 = [feet[0] - Math.sin(a) * DOOR_AHEAD_M, feet[1], feet[2] - Math.cos(a) * DOOR_AHEAD_M];
    if (locate(house, pos).room === room && standable(house, pos)) return { pos, yaw: wrapYaw(yaw + turn + 180) };
  }
  return null;
}

/** The node a talk with `talker` starts at, given what was told so far. */
export function openNode(talker: Talker, told: Readonly<Record<string, string>> | null | undefined): string {
  for (const o of talker.opens ?? []) {
    const need = Object.entries(o.told ?? {});
    if (need.every(([k, v]) => told?.[k] === v)) return o.node;
  }
  return "start";
}

/** What picking option `index` on `node` does. */
export function pickOption(talker: Talker, node: string, index: number): { to: string | null; tell: string | null; vision: VisionKind | null } | null {
  const o = talker.nodes[node]?.options?.[index];
  if (o === undefined) return null;
  return { to: o.to ?? null, tell: o.tell ?? null, vision: o.do ?? null };
}

const NTH = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

/** "fourth" (12 and under), else "13th". */
export function ordinal(n: number): string {
  return NTH[n] ?? `${n}th`;
}

/** A line for this program: `{name}` their name, `{visit}` this walk's number,
 *  `{nth}` it as a word ("fourth"). */
export function fillLine(text: string, who: { name: string; visit: number }): string {
  return text.replace(/\{name\}/gu, who.name).replace(/\{visit\}/gu, String(who.visit)).replace(/\{nth\}/gu, ordinal(who.visit));
}

/** A vision's lines at `n`: the script's list wrapped by `n`, or none. */
export function pickLine(list: readonly string[] | undefined, n: number): string | null {
  if (list === undefined || list.length === 0) return null;
  return list[Math.abs(Math.trunc(n)) % list.length]!;
}
