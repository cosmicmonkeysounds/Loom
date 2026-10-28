//! `audio.json` (wave 17) — the house speakers and the audio interface that
//! feeds them: the device (16 in / 16 out on the show's MOTU), what each
//! input carries, each output's label, every placed speaker (a `house.json`
//! room + a position, the outputs it hangs on), zones of speakers, the
//! input → output matrix, and where each story `sound X` plays.
//!
//! A project file of its own, never part of `house.json`: a speaker edit or a
//! re-patch mid-show must not bump the map version (that remaps every game),
//! and the tent / shed map variants share one physical house. Never name it
//! `house.audio.json` — the server reads that as a map variant.
//!
//! `validateAudio` refuses a broken file (`problems`) and advises on a valid
//! one (`warnings`); with a house it checks every speaker's room and that it
//! stands inside it. `resolveTargets` turns a cue's `to` list (zones, room
//! ids, LOCATION names, speaker ids, `everywhere`) into speakers + output
//! channels; stagehand's router mirrors it in Python, pinned by the shared
//! fixtures `house/test/fixtures/audio-*.json`. Pure, no `node:` imports.

import { fnv1a32 } from "./duck.ts";
import { distanceToBoundary, pointInPoly } from "./geometry.ts";
import type { HouseMap } from "./types.ts";

/** The project file's name. */
export const AUDIO_FILE = "audio.json";
/** The implicit zone of every speaker (it may not be redefined). */
export const AUDIO_EVERYWHERE = "everywhere";
/** The story's announcement chime (`sound announce_chime`): rung with the
 *  announcements on `announce.to` (or by the house Mac's own player), never
 *  as a cue — a cue keyed on it does nothing, so it is warned about. */
export const AUDIO_CHIME_SOUND = "announce_chime";
/** A device has 1 to this many inputs / outputs. */
export const AUDIO_MAX_CHANNELS = 64;
/** A gain (dB) is within these. */
export const AUDIO_GAIN_MIN = -60;
export const AUDIO_GAIN_MAX = 12;
/** How far outside its room a speaker may stand (as a terminal spot). */
export const AUDIO_SPOT_TOLERANCE = 0.05;
/** What an input carries. */
export const AUDIO_INPUT_KINDS = ["software", "mic", "line"] as const;
export type AudioInputKind = (typeof AUDIO_INPUT_KINDS)[number];
/** (wave 38) An input's `role`: the priority source it drives (the router's
 *  sidechain ducks the music under it). Lower-case, so a YAML `priority` key
 *  matches it without folding. */
export const AUDIO_ROLE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/u;
/** Sources the router derives itself (the announcement bus, a takeover track):
 *  an input claiming one would merge a live mic into them, so it is refused. */
export const AUDIO_RESERVED_ROLES = ["announce", "takeover"] as const;
/** The roles the map editor offers by name (any well-formed one is accepted). */
export const AUDIO_KNOWN_ROLES = ["trabolta", "clippy"] as const;

export interface AudioDevice {
  /** A substring of the CoreAudio device name ("MOTU"). */
  name: string;
  inputs: number;
  outputs: number;
  /** Sample rate in Hz (the router opens the device at it; 48000 if absent). */
  rate?: number;
  /** (wave 18b) The channel counts the device itself reports when its
   *  layout is as planned (the 828x + an ADAT expander: 32 in / 30 out).
   *  `inputs` / `outputs` above are the channels we use; a device that
   *  reports other totals has moved its layout (mirroring, 96 kHz,
   *  TOSLink): `stagehand check` fails and the router logs an error. */
  expect?: { inputs: number; outputs: number };
}

/** One interface input (1-based `ch`): a house Mac / QLab output, a mic, a line. */
export interface AudioInput {
  ch: number;
  label: string;
  kind: AudioInputKind;
  /** (wave 38) The priority source this input drives ("trabolta", "clippy"):
   *  the router meters it and ducks the music under it. Two inputs may share
   *  one (their activity is the max). Never `announce` / `takeover`. */
  role?: string;
  /** (wave 38) The targets (as a cue's `to`) the source ducks. Absent: the
   *  outputs this input's `routes` rows feed, or `everywhere` with no route. */
  reach?: string[];
}

/** One interface output (1-based `ch`). */
export interface AudioOutput {
  ch: number;
  label: string;
}

/** A placed speaker: a `house.json` room, a position in the house frame
 *  (metres, Y up, +z south), the way it faces, and the outputs feeding it. */
export interface AudioSpeaker {
  id: string;
  name: string;
  room: string;
  /** The room's floor id (informational; checked against the room). */
  floor?: string;
  pos: { x: number; y: number; z: number };
  yaw: number;
  out: number[];
  /** dB, −60 to +12. */
  gain?: number;
}

export interface AudioZone {
  id: string;
  name: string;
  speakers: string[];
}

/** One row of the input → output matrix: `in` to every `out`, at `gain` dB. */
export interface AudioRoute {
  in: number;
  out: number[];
  gain?: number;
}

/** Where a story `sound X` plays: zone ids, room ids, LOCATION names or speaker ids. */
export interface AudioCue {
  to: string[];
  gain?: number;
}

export interface AudioConfig {
  version: 1;
  note?: string;
  device: AudioDevice;
  inputs: AudioInput[];
  outputs: AudioOutput[];
  speakers: AudioSpeaker[];
  zones: AudioZone[];
  routes: AudioRoute[];
  cues: Record<string, AudioCue>;
  /** `terminals` (wave 18b, Q8): the house map's terminal spot ids whose
   *  tablets also say the announcements unless their own setting says
   *  Always / Never (kept here, not in `house.json`, so a toggle never
   *  bumps the map version). */
  announce?: { to: string[]; chime?: boolean; terminals?: string[] };
  /** Speakers / zones the TV's voice should also reach (documents the
   *  interface mixer's fan-out today). */
  voice?: { tv?: string[] };
}

export interface AudioValidation {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

/** What a target list reaches: speaker ids (in file order) and their output channels (ascending). */
export interface AudioTargets {
  speakers: string[];
  outputs: number[];
}

/** A short content hash (8 hex digits) — the config's `version` on the wire. */
export function audioHash(audio: AudioConfig): string {
  return fnv1a32(JSON.stringify(audio)).toString(16).padStart(8, "0");
}

/** A fresh config: a 16 in / 16 out interface, labelled, nothing placed. */
export function defaultAudio(): AudioConfig {
  const n = 16;
  return {
    version: 1,
    device: { name: "", inputs: n, outputs: n, rate: 48000 },
    inputs: Array.from({ length: n }, (_, i) => ({ ch: i + 1, label: `In ${i + 1}`, kind: "line" as const })),
    outputs: Array.from({ length: n }, (_, i) => ({ ch: i + 1, label: `Out ${i + 1}` })),
    speakers: [],
    zones: [],
    routes: [],
    cues: {},
  };
}

/** Fold a target name: case, `_` / `-` and runs of spaces don't matter
 *  (`The_Desktop` = `the desktop`, `start-bar` = `Start Bar`). */
export function foldTarget(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/**
 * The speakers and output channels a target list reaches. Each target is
 * matched (folded) against, and reaches the union of:
 * `everywhere` (every speaker), a speaker id, a zone id or name, a room id
 * (the speakers whose `room` it is), and — with a house — a LOCATION name
 * (every room whose `location` it is) or a room's label. A target that
 * names nothing reaches nothing.
 */
export function resolveTargets(audio: AudioConfig, house: HouseMap | null | undefined, to: readonly string[]): AudioTargets {
  const hit = new Set<string>();
  const speakers = Array.isArray(audio.speakers) ? audio.speakers : [];
  const zones = Array.isArray(audio.zones) ? audio.zones : [];
  const rooms = house?.rooms ?? [];
  for (const raw of to) {
    if (typeof raw !== "string") continue;
    const t = foldTarget(raw);
    if (t === "") continue;
    if (t === AUDIO_EVERYWHERE) {
      for (const s of speakers) hit.add(s.id);
      continue;
    }
    const roomIds = new Set<string>();
    for (const s of speakers) {
      if (foldTarget(s.id) === t) hit.add(s.id);
      if (foldTarget(s.room) === t) roomIds.add(s.room);
    }
    for (const z of zones) if (foldTarget(z.id) === t || foldTarget(z.name) === t) for (const id of z.speakers) hit.add(id);
    for (const r of rooms) {
      if (foldTarget(r.id) === t || foldTarget(r.label) === t || (r.location !== undefined && foldTarget(r.location) === t)) roomIds.add(r.id);
    }
    for (const s of speakers) if (roomIds.has(s.room)) hit.add(s.id);
  }
  const out = new Set<number>();
  const ids: string[] = [];
  for (const s of speakers) {
    if (!hit.has(s.id)) continue;
    ids.push(s.id);
    for (const ch of s.out) out.add(ch);
  }
  return { speakers: ids, outputs: [...out].sort((a, b) => a - b) };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/**
 * Check an `audio.json` (parsed): `problems` refuse it, `warnings` advise.
 * With a `house`: every speaker's room exists, its `floor` (if given) is the
 * room's, and its plan position is inside the room (± 0.05 m).
 */
export function validateAudio(audio: unknown, house?: HouseMap | null): AudioValidation {
  const problems: string[] = [];
  const warnings: string[] = [];
  const done = (): AudioValidation => ({ ok: problems.length === 0, problems, warnings });
  if (!isObj(audio)) {
    problems.push("audio.json must be an object");
    return done();
  }
  if (audio["version"] !== 1) problems.push("version must be 1");
  if (audio["note"] !== undefined && !isStr(audio["note"])) problems.push("note must be a string");

  // The device: everything else is counted against it.
  const device = audio["device"];
  let nIn = AUDIO_MAX_CHANNELS;
  let nOut = AUDIO_MAX_CHANNELS;
  if (!isObj(device)) problems.push("device must be an object {name, inputs, outputs}");
  else {
    if (!isStr(device["name"])) problems.push("device.name must be a string");
    for (const k of ["inputs", "outputs"] as const) {
      const v = device[k];
      if (!isInt(v) || v < 1 || v > AUDIO_MAX_CHANNELS) problems.push(`device.${k} must be a whole number from 1 to ${AUDIO_MAX_CHANNELS}`);
      else if (k === "inputs") nIn = v;
      else nOut = v;
    }
    if (device["rate"] !== undefined && (!isInt(device["rate"]) || device["rate"] < 8000 || device["rate"] > 384000)) problems.push("device.rate must be a sample rate in Hz (8000 to 384000)");
    const expect = device["expect"];
    if (expect !== undefined) {
      if (!isObj(expect)) problems.push("device.expect must be an object {inputs, outputs}");
      else
        for (const k of ["inputs", "outputs"] as const) {
          const v = expect[k];
          if (!isInt(v) || v < 1 || v > AUDIO_MAX_CHANNELS) problems.push(`device.expect.${k} must be a whole number from 1 to ${AUDIO_MAX_CHANNELS}`);
          else if (isInt(device[k]) && v < (device[k] as number)) warnings.push(`device.expect.${k} (${v}) is fewer than device.${k} (${device[k] as number}): those channels can't exist`);
        }
    }
  }
  const gainOk = (v: unknown) => v === undefined || (isNum(v) && v >= AUDIO_GAIN_MIN && v <= AUDIO_GAIN_MAX);
  const gainMsg = `must be dB from ${AUDIO_GAIN_MIN} to +${AUDIO_GAIN_MAX}`;
  const list = (key: string): unknown[] => {
    const v = audio[key];
    if (Array.isArray(v)) return v;
    problems.push(`${key} must be a list`);
    return [];
  };
  const chOk = (v: unknown, max: number) => isInt(v) && v >= 1 && v <= max;

  // Inputs and outputs: 1-based, unique, within the device.
  const channels = (key: "inputs" | "outputs", max: number): Set<number> => {
    const seen = new Set<number>();
    list(key).forEach((c, i) => {
      const at = `${key}[${i}]`;
      if (!isObj(c)) return void problems.push(`${at} must be an object`);
      if (!chOk(c["ch"], max)) problems.push(`${at}.ch must be a channel from 1 to ${max}`);
      else if (seen.has(c["ch"] as number)) problems.push(`${at}: channel ${c["ch"]} is listed twice`);
      else seen.add(c["ch"] as number);
      if (!isStr(c["label"])) problems.push(`${at}.label must be a string`);
      if (key === "inputs" && !(AUDIO_INPUT_KINDS as readonly unknown[]).includes(c["kind"])) problems.push(`${at}.kind must be ${AUDIO_INPUT_KINDS.map((k) => `"${k}"`).join(" | ")}`);
      if (key === "inputs" && c["role"] !== undefined) {
        const role = c["role"];
        if (!isStr(role) || !AUDIO_ROLE_PATTERN.test(role)) problems.push(`${at}.role must be a lower-case name (a letter, then up to 31 of a-z 0-9 _ -)`);
        else if ((AUDIO_RESERVED_ROLES as readonly string[]).includes(role)) problems.push(`${at}.role: "${role}" is reserved for the router's own ducking`);
      }
    });
    return seen;
  };
  channels("inputs", nIn);
  const labelled = channels("outputs", nOut);

  // Speakers.
  const speakerIds = new Set<string>();
  const outUse = new Map<number, string[]>();
  const rooms = new Map((house?.rooms ?? []).map((r) => [r.id, r]));
  list("speakers").forEach((s, i) => {
    let at = `speakers[${i}]`;
    if (!isObj(s)) return void problems.push(`${at} must be an object`);
    if (!isStr(s["id"]) || s["id"].trim() === "") problems.push(`${at}.id must be a non-empty string`);
    else {
      at = `speakers[${i}] "${s["id"]}"`;
      if (speakerIds.has(s["id"])) problems.push(`${at}: the id is used twice`);
      speakerIds.add(s["id"]);
      if (foldTarget(s["id"]) === AUDIO_EVERYWHERE) problems.push(`${at}: "${AUDIO_EVERYWHERE}" is reserved`);
    }
    if (!isStr(s["name"])) problems.push(`${at}.name must be a string`);
    if (!isStr(s["room"]) || s["room"] === "") problems.push(`${at}.room must be a room id`);
    if (s["floor"] !== undefined && !isStr(s["floor"])) problems.push(`${at}.floor must be a string`);
    const pos = s["pos"];
    const posOk = isObj(pos) && isNum(pos["x"]) && isNum(pos["y"]) && isNum(pos["z"]);
    if (!posOk) problems.push(`${at}.pos must be {x, y, z} in metres`);
    if (!isNum(s["yaw"])) problems.push(`${at}.yaw must be a number (degrees)`);
    if (!gainOk(s["gain"])) problems.push(`${at}.gain ${gainMsg}`);
    const out = s["out"];
    if (!Array.isArray(out)) problems.push(`${at}.out must be a list of output channels`);
    else {
      const mine = new Set<number>();
      for (const ch of out) {
        if (!chOk(ch, nOut)) problems.push(`${at}.out: ${JSON.stringify(ch)} is not an output from 1 to ${nOut}`);
        else if (mine.has(ch)) problems.push(`${at}.out: output ${ch} is listed twice`);
        else {
          mine.add(ch);
          if (isStr(s["id"])) outUse.set(ch, [...(outUse.get(ch) ?? []), s["id"]]);
        }
      }
      if (out.length === 0) warnings.push(`${at} has no output: nothing will play on it`);
    }
    // Placement against the house.
    if (house && isStr(s["room"]) && s["room"] !== "") {
      const room = rooms.get(s["room"]);
      if (room === undefined) problems.push(`${at}: unknown room "${s["room"]}"`);
      else {
        if (isStr(s["floor"]) && s["floor"] !== room.floor) problems.push(`${at}: floor "${s["floor"]}" is not room "${room.id}"'s floor "${room.floor}"`);
        if (posOk) {
          const p = pos as { x: number; z: number };
          const plan: [number, number] = [p.x, p.z];
          const inside = pointInPoly(room.poly, plan) || distanceToBoundary(room.poly, plan) <= AUDIO_SPOT_TOLERANCE + 1e-9;
          if (!inside) problems.push(`${at}: [${p.x}, ${p.z}] is outside room "${room.id}" (± ${AUDIO_SPOT_TOLERANCE} m)`);
        }
      }
    }
  });
  for (const [ch, ids] of outUse) if (ids.length > 1) warnings.push(`output ${ch} feeds ${ids.length} speakers (${ids.join(", ")})`);
  for (const ch of [...labelled].sort((a, b) => a - b)) if (!outUse.has(ch)) warnings.push(`output ${ch} has no speaker`);

  // Zones.
  const zoneIds = new Set<string>();
  list("zones").forEach((z, i) => {
    let at = `zones[${i}]`;
    if (!isObj(z)) return void problems.push(`${at} must be an object`);
    if (!isStr(z["id"]) || z["id"].trim() === "") problems.push(`${at}.id must be a non-empty string`);
    else {
      at = `zones[${i}] "${z["id"]}"`;
      if (foldTarget(z["id"]) === AUDIO_EVERYWHERE) problems.push(`${at}: "${AUDIO_EVERYWHERE}" is every speaker already and may not be redefined`);
      if (zoneIds.has(z["id"])) problems.push(`${at}: the id is used twice`);
      zoneIds.add(z["id"]);
    }
    if (!isStr(z["name"])) problems.push(`${at}.name must be a string`);
    if (!Array.isArray(z["speakers"])) problems.push(`${at}.speakers must be a list of speaker ids`);
    else for (const id of z["speakers"]) if (!isStr(id) || !speakerIds.has(id)) problems.push(`${at}: unknown speaker ${JSON.stringify(id)}`);
  });

  // The matrix: one gain per (input, output) cell.
  const cells = new Set<string>();
  list("routes").forEach((r, i) => {
    const at = `routes[${i}]`;
    if (!isObj(r)) return void problems.push(`${at} must be an object`);
    if (!chOk(r["in"], nIn)) problems.push(`${at}.in must be an input from 1 to ${nIn}`);
    if (!gainOk(r["gain"])) problems.push(`${at}.gain ${gainMsg}`);
    if (!Array.isArray(r["out"])) return void problems.push(`${at}.out must be a list of output channels`);
    for (const ch of r["out"]) {
      if (!chOk(ch, nOut)) problems.push(`${at}.out: ${JSON.stringify(ch)} is not an output from 1 to ${nOut}`);
      else if (cells.has(`${r["in"]}>${ch}`)) problems.push(`${at}: input ${r["in"]} → output ${ch} is routed twice`);
      else cells.add(`${r["in"]}>${ch}`);
    }
  });

  // Targets: cues, announcements, the TV voice.
  const config = audio as unknown as AudioConfig;
  const targets = (at: string, to: unknown): void => {
    if (!Array.isArray(to) || to.some((t) => !isStr(t))) return void problems.push(`${at} must be a list of zones, rooms, LOCATIONs or speakers`);
    if (to.length === 0) return void warnings.push(`${at} names nothing`);
    if (!Array.isArray(config.speakers) || !Array.isArray(config.zones)) return;
    for (const t of to as string[]) {
      if (resolveTargets(config, house, [t]).speakers.length === 0) warnings.push(`${at}: "${t}" reaches no speaker`);
    }
  };
  // (wave 38) Each input's reach is a target list like a cue's `to`.
  const inputs = audio["inputs"];
  if (Array.isArray(inputs))
    inputs.forEach((c, i) => {
      if (!isObj(c) || c["reach"] === undefined) return;
      const at = `inputs[${i}].reach`;
      if (!Array.isArray(c["reach"]) || c["reach"].some((t) => !isStr(t))) return void problems.push(`${at} must be a list of zones, rooms, LOCATIONs or speakers`);
      targets(at, c["reach"]);
    });
  const cues = audio["cues"];
  if (!isObj(cues)) problems.push("cues must be an object {sound name: {to}}");
  else {
    for (const [name, c] of Object.entries(cues)) {
      const at = `cues["${name}"]`;
      if (!isObj(c)) {
        problems.push(`${at} must be an object {to, gain?}`);
        continue;
      }
      if (!gainOk(c["gain"])) problems.push(`${at}.gain ${gainMsg}`);
      if (name === AUDIO_CHIME_SOUND) warnings.push(`${at}: the chime rings with the announcements (announce.to); the router never plays this cue`);
      targets(`${at}.to`, c["to"]);
    }
  }
  const announce = audio["announce"];
  if (announce !== undefined) {
    if (!isObj(announce)) problems.push("announce must be an object {to, chime?, terminals?}");
    else {
      targets("announce.to", announce["to"]);
      if (announce["chime"] !== undefined && typeof announce["chime"] !== "boolean") problems.push("announce.chime must be true or false");
      const terms = announce["terminals"];
      if (terms !== undefined) {
        if (!Array.isArray(terms) || terms.some((t) => !isStr(t) || t.trim() === "")) problems.push("announce.terminals must be a list of terminal spot ids");
        else if (house != null) {
          const spots = new Set(house.terminals.map((t) => t.id));
          for (const t of terms as string[]) if (!spots.has(t)) warnings.push(`announce.terminals: "${t}" is no terminal spot on the house map`);
        }
      }
    }
  }
  const voice = audio["voice"];
  if (voice !== undefined) {
    if (!isObj(voice)) problems.push("voice must be an object {tv?}");
    else if (voice["tv"] !== undefined) targets("voice.tv", voice["tv"]);
  }
  return done();
}
