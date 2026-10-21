//! The house speakers in the map editor — pure ops on `audio.json`
//! (`@loom/house` `AudioConfig`, wave 17). The speakers stand on the map's
//! rooms but live in their own project file (a re-patch mid-show must never
//! bump the map version), so every op here takes the config (and the house
//! it is placed on, where it needs one) and returns a changed copy: the
//! page keeps one undo history of `{house, audio}` pairs (`Doc`), so a room
//! move that carries its speakers is one step.
//!
//! What is here: placing / moving / turning / duplicating / deleting a
//! speaker; the speakers following an edited map (`followHouse`: a moved
//! room, a dragged edge, a renamed or deleted room, a floor raised); the
//! interface (device, input / output labels, the input → output matrix);
//! zones; the story's cues and the announce / TV voice targets; and the
//! problem list (`validateAudio` read back to the speaker it names).

import { AUDIO_CHIME_SOUND, AUDIO_EVERYWHERE, AUDIO_GAIN_MAX, AUDIO_GAIN_MIN, AUDIO_INPUT_KINDS, AUDIO_MAX_CHANNELS, cloneData, defaultAudio, foldTarget, pointInPoly, distanceToBoundary, roomAt, roomById, roomElevation, validateAudio, wrapYaw, yawToward } from "@loom/house";
import type { AudioConfig, AudioCue, AudioInputKind, AudioSpeaker, HouseMap, Room, Vec2 } from "@loom/house";
import type { Problem } from "./check.ts";
import type { History } from "./history.ts";
import { rectSideOf, round } from "./doors.ts";
import { uniqueId, slug, freshId } from "./ids.ts";
import { labelSpot, rectOf } from "./plan.ts";

/** What the editor's undo history holds: the map and its speakers together. */
export interface Doc {
  house: HouseMap;
  audio: AudioConfig;
}

/** A speaker is hung this far above its floor. */
export const SPEAKER_HEIGHT = 2.2;
/** The coverage ring's radius at 0 dB (metres) — a plan cue, not acoustics. */
export const SPEAKER_RANGE = 3;

const clone = (a: AudioConfig): AudioConfig => cloneData(a);
const clampGain = (g: number): number => Math.max(AUDIO_GAIN_MIN, Math.min(AUDIO_GAIN_MAX, Math.round(g * 10) / 10)) + 0;

/**
 * A config as the page edits it: any list the server (or a hand-written
 * file) left out is filled in, the rest kept as it is (`validateAudio`
 * judges it). Not an object at all → the default 16 / 16 interface.
 */
export function normalizeAudio(raw: unknown): AudioConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defaultAudio();
  const a = cloneData(raw) as Partial<AudioConfig> & Record<string, unknown>;
  const d = defaultAudio();
  return {
    ...a,
    version: 1,
    device: typeof a.device === "object" && a.device !== null ? a.device : d.device,
    inputs: Array.isArray(a.inputs) ? a.inputs : d.inputs,
    outputs: Array.isArray(a.outputs) ? a.outputs : d.outputs,
    speakers: Array.isArray(a.speakers) ? a.speakers : [],
    zones: Array.isArray(a.zones) ? a.zones : [],
    routes: Array.isArray(a.routes) ? a.routes : [],
    cues: typeof a.cues === "object" && a.cues !== null && !Array.isArray(a.cues) ? a.cues : {},
  } as AudioConfig;
}

export function speakerById(audio: AudioConfig, id: string): AudioSpeaker | undefined {
  return audio.speakers.find((s) => s.id === id);
}

/** The floor a speaker shows on: its room's ("" for a room the map lost). */
export function speakerFloor(house: HouseMap, s: Pick<AudioSpeaker, "room" | "floor">): string {
  return roomById(house, s.room)?.floor ?? s.floor ?? "";
}

/** A speaker's plan point. */
export const planOf = (s: AudioSpeaker): Vec2 => [s.pos.x, s.pos.z];

/** The lowest labelled output no speaker uses, as a speaker's `out` ([] when every one is taken). */
export function freeOutput(audio: AudioConfig): number[] {
  const used = new Set(audio.speakers.flatMap((s) => s.out));
  const chans = audio.outputs.length > 0 ? audio.outputs.map((o) => o.ch).sort((a, b) => a - b) : Array.from({ length: audio.device.outputs }, (_, i) => i + 1);
  const ch = chans.find((c) => !used.has(c) && c <= audio.device.outputs);
  return ch === undefined ? [] : [ch];
}

/** Put a new speaker in `roomId` (at `at`, else the room's middle), hung
 *  `SPEAKER_HEIGHT` up, facing north, on the next free output. */
export function addSpeaker(audio: AudioConfig, house: HouseMap, roomId: string, at?: Vec2): { audio: AudioConfig; id: string } {
  const room = roomById(house, roomId);
  if (room === undefined) return { audio, id: "" };
  const next = clone(audio);
  const id = uniqueId("speaker", next.speakers.map((s) => s.id));
  const p = at ?? labelSpot(room.poly);
  next.speakers.push({
    id,
    name: `Speaker ${id.slice("speaker-".length)} · ${room.label}`,
    room: room.id,
    floor: room.floor,
    pos: { x: round(p[0]), y: round(roomElevation(house, room) + SPEAKER_HEIGHT), z: round(p[1]) },
    yaw: 0,
    out: freeOutput(audio),
  });
  return { audio: next, id };
}

/** The 🔊 palette's click: a speaker at a plan point on `floor`; null when no room is there. */
export function placeSpeaker(audio: AudioConfig, house: HouseMap, floor: string, at: Vec2): { audio: AudioConfig; id: string } | null {
  const room = roomAt(house, at, floor);
  return room === null ? null : addSpeaker(audio, house, room.id, at);
}

function withSpeaker(audio: AudioConfig, id: string, f: (s: AudioSpeaker) => void): AudioConfig {
  if (speakerById(audio, id) === undefined) return audio;
  const next = clone(audio);
  f(speakerById(next, id)!);
  return next;
}

/** Move a speaker to a plan point (its height kept); its room follows to
 *  whichever room on its floor now holds it. */
export function moveSpeaker(audio: AudioConfig, house: HouseMap, id: string, plan: Vec2): AudioConfig {
  const s = speakerById(audio, id);
  if (s === undefined || (s.pos.x === round(plan[0]) && s.pos.z === round(plan[1]))) return audio;
  return withSpeaker(audio, id, (n) => {
    n.pos = { x: round(plan[0]), y: n.pos.y, z: round(plan[1]) };
    const floor = speakerFloor(house, n);
    const room = floor === "" ? null : roomAt(house, plan, floor);
    if (room !== null) {
      n.room = room.id;
      n.floor = room.floor;
    }
  });
}

/** Set a speaker's yaw (wrapped into [−180, 180), rounded to 0.5°). */
export function setSpeakerYaw(audio: AudioConfig, id: string, yaw: number): AudioConfig {
  const y = Math.round(wrapYaw(yaw) * 2) / 2 + 0;
  if (speakerById(audio, id)?.yaw === y) return audio;
  return withSpeaker(audio, id, (s) => {
    s.yaw = y;
  });
}

export function rotateSpeaker(audio: AudioConfig, id: string, delta: number): AudioConfig {
  const s = speakerById(audio, id);
  return s === undefined ? audio : setSpeakerYaw(audio, id, s.yaw + delta);
}

/** Point a speaker at a plan point (its rotate handle), in `step` degrees. */
export function aimSpeaker(audio: AudioConfig, id: string, target: Vec2, step = 5): AudioConfig {
  const s = speakerById(audio, id);
  if (s === undefined) return audio;
  const yaw = yawToward([s.pos.x, 0, s.pos.z], [target[0], 0, target[1]]);
  return setSpeakerYaw(audio, id, Math.round(yaw / step) * step);
}

export function setSpeakerHeight(audio: AudioConfig, id: string, y: number): AudioConfig {
  if (!Number.isFinite(y)) return audio;
  return withSpeaker(audio, id, (s) => {
    s.pos = { ...s.pos, y: round(y) };
  });
}

/** The inspector's fields: the name, its outputs (sorted, unique, within
 *  the device), its gain (`undefined` / 0 = unity, left unwritten). */
export function patchSpeaker(audio: AudioConfig, id: string, patch: { name?: string; out?: number[]; gain?: number | undefined }): AudioConfig {
  return withSpeaker(audio, id, (s) => {
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.out !== undefined) s.out = [...new Set(patch.out.filter((c) => Number.isInteger(c) && c >= 1 && c <= audio.device.outputs))].sort((a, b) => a - b);
    if ("gain" in patch) {
      if (patch.gain === undefined || !Number.isFinite(patch.gain) || patch.gain === 0) delete s.gain;
      else s.gain = clampGain(patch.gain);
    }
  });
}

/** Toggle one output on a speaker. */
export function toggleSpeakerOutput(audio: AudioConfig, id: string, ch: number): AudioConfig {
  const s = speakerById(audio, id);
  if (s === undefined) return audio;
  return patchSpeaker(audio, id, { out: s.out.includes(ch) ? s.out.filter((c) => c !== ch) : [...s.out, ch] });
}

/** Swap a target name everywhere a target list names it (cues, announce, TV voice). */
function retarget(a: AudioConfig, from: string, to: string | null): void {
  const f = foldTarget(from);
  const fix = (list: string[]): string[] => {
    const out = list.flatMap((t) => (foldTarget(t) === f ? (to === null ? [] : [to]) : [t]));
    return [...new Set(out)];
  };
  for (const c of Object.values(a.cues)) c.to = fix(c.to);
  if (a.announce !== undefined) a.announce.to = fix(a.announce.to);
  if (a.voice?.tv !== undefined) a.voice.tv = fix(a.voice.tv);
}

/** Rename a speaker's id (and every zone / target naming it). Refused
 *  (unchanged) for an empty, taken or reserved id. */
export function renameSpeaker(audio: AudioConfig, from: string, to: string): AudioConfig {
  const id = to.trim();
  if (id === "" || id === from || foldTarget(id) === AUDIO_EVERYWHERE || audio.speakers.some((s) => s.id === id) || speakerById(audio, from) === undefined) return audio;
  const next = clone(audio);
  speakerById(next, from)!.id = id;
  for (const z of next.zones) z.speakers = z.speakers.map((x) => (x === from ? id : x));
  retarget(next, from, id);
  return next;
}

/** Delete a speaker (and its place in every zone and target list). */
export function removeSpeaker(audio: AudioConfig, id: string): AudioConfig {
  if (speakerById(audio, id) === undefined) return audio;
  const next = clone(audio);
  next.speakers = next.speakers.filter((s) => s.id !== id);
  for (const z of next.zones) z.speakers = z.speakers.filter((x) => x !== id);
  retarget(next, id, null);
  return next;
}

/** A copy of a speaker `offset` east and south, a fresh id, on the next free output. */
export function duplicateSpeaker(audio: AudioConfig, house: HouseMap, id: string, offset: number): { audio: AudioConfig; id: string } | null {
  const s = speakerById(audio, id);
  if (s === undefined) return null;
  const next = clone(audio);
  const base = s.id.replace(/-\d+$/, "") || s.id;
  const copy = uniqueId(base, next.speakers.map((x) => x.id));
  next.speakers.push({ ...cloneData(s), id: copy, name: `${s.name} copy`, out: freeOutput(audio) });
  return { audio: moveSpeaker(next, house, copy, [s.pos.x + offset, s.pos.z + offset]), id: copy };
}

const samePoly = (a: readonly Vec2[], b: readonly Vec2[]): boolean => a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);

/** `after` is `before` shifted by one (dx, dz), or null. */
function shiftOf(before: readonly Vec2[], after: readonly Vec2[]): Vec2 | null {
  if (before.length !== after.length || before.length === 0) return null;
  const dx = after[0]![0] - before[0]![0];
  const dz = after[0]![1] - before[0]![1];
  const ok = before.every((p, i) => Math.abs(after[i]![0] - p[0] - dx) < 1e-6 && Math.abs(after[i]![1] - p[1] - dz) < 1e-6);
  return ok ? [dx, dz] : null;
}

const insideOf = (room: Room, p: Vec2): boolean => pointInPoly(room.poly, p) || distanceToBoundary(room.poly, p) <= 0.05 + 1e-9;

/**
 * The speakers after a map edit, as the map's own placed things move: a
 * moved room carries its speakers; a dragged edge carries the ones on that
 * wall; a raised floor lifts them; a renamed room is followed; a yard
 * re-cut re-homes them into the piece they stand in; a speaker left
 * standing in another room on its floor now lives there; a deleted indoor
 * room takes its speakers with it. The same config when nothing moved.
 */
export function followHouse(before: HouseMap, after: HouseMap, audio: AudioConfig): AudioConfig {
  if (before === after || audio.speakers.length === 0) return audio;
  let changed = false;
  const next = clone(audio);
  const gone: string[] = [];
  for (const s of next.speakers) {
    const rb = roomById(before, s.room);
    if (rb === undefined) continue; // never on this map: validateAudio says so
    let ra = roomById(after, s.room);
    let p: Vec2 = [s.pos.x, s.pos.z];
    let y = s.pos.y;
    if (ra === undefined) {
      // Renamed (the same footprint under a new id), a re-cut yard piece, or deleted.
      ra = after.rooms.find((r) => r.floor === rb.floor && roomById(before, r.id) === undefined && samePoly(r.poly, rb.poly));
      if (ra === undefined && rb.outdoor === true) ra = roomAt(after, p, rb.floor) ?? undefined;
      if (ra === undefined) {
        gone.push(s.id);
        continue;
      }
    } else if (!samePoly(rb.poly, ra.poly)) {
      const shift = shiftOf(rb.poly, ra.poly);
      if (shift !== null) p = [round(p[0] + shift[0]), round(p[1] + shift[1])];
      else {
        // A dragged edge: a speaker on that wall goes with it.
        const r0 = rectOf(rb.poly);
        const r1 = rectOf(ra.poly);
        if (r0 !== null && r1 !== null) {
          const side = rectSideOf(r0, p, 0.05);
          if (side === "w") p = [r1[0], p[1]];
          else if (side === "e") p = [r1[2], p[1]];
          else if (side === "n") p = [p[0], r1[1]];
          else if (side === "s") p = [p[0], r1[3]];
        }
      }
    }
    y = round(y + roomElevation(after, ra) - roomElevation(before, rb));
    // Standing in another room on its floor now (not on a shared wall): it lives there.
    let home = ra;
    if (!insideOf(ra, p)) home = roomAt(after, p, ra.floor) ?? ra;
    if (p[0] !== s.pos.x || p[1] !== s.pos.z || y !== s.pos.y || home.id !== s.room || home.floor !== s.floor) {
      changed = true;
      s.pos = { x: p[0], y, z: p[1] };
      s.room = home.id;
      s.floor = home.floor;
    }
  }
  if (gone.length > 0) {
    let out = next;
    for (const id of gone) out = removeSpeaker(out, id);
    return out;
  }
  return changed ? next : audio;
}

/** The speakers deleting these rooms takes with it (for the confirm). */
export function speakersIn(audio: AudioConfig, roomIds: readonly string[]): string[] {
  const gone = new Set(roomIds);
  return audio.speakers.filter((s) => gone.has(s.room)).map((s) => s.id);
}

/** "Delete the room “Kitchen” with 2 doors?" + " and 2 speakers". */
export function withSpeakersText(confirm: string, n: number): string {
  if (n === 0) return confirm;
  const what = `${n} speaker${n === 1 ? "" : "s"}`;
  return /\swith\s/.test(confirm) ? confirm.replace(/\?$/, ` and ${what}?`) : confirm.replace(/\?$/, ` with ${what}?`);
}

/** The coverage ring's radius: `SPEAKER_RANGE` at 0 dB, ×2 every +6 dB (0.8 to 8 m). */
export function coverageRadius(gain: number | undefined): number {
  return Math.max(0.8, Math.min(8, SPEAKER_RANGE * Math.pow(10, (gain ?? 0) / 20)));
}

/** The speakers an output feeds. */
export function outputUsers(audio: AudioConfig, ch: number): AudioSpeaker[] {
  return audio.speakers.filter((s) => s.out.includes(ch));
}

/** An output's label ("Out 3" when it has none). */
export function outputLabel(audio: AudioConfig, ch: number): string {
  return audio.outputs.find((o) => o.ch === ch)?.label || `Out ${ch}`;
}

export function inputLabel(audio: AudioConfig, ch: number): string {
  return audio.inputs.find((i) => i.ch === ch)?.label || `In ${ch}`;
}

// --- the interface --------------------------------------------------------

/**
 * Set the device (its CoreAudio name substring, channel counts, rate). A
 * count that grows adds labelled channels; one that shrinks drops the
 * channels, matrix cells and speaker outputs past it.
 */
export function setDevice(audio: AudioConfig, patch: { name?: string; inputs?: number; outputs?: number; rate?: number | null }): AudioConfig {
  const next = clone(audio);
  const d = next.device;
  if (patch.name !== undefined) d.name = patch.name;
  if (patch.rate !== undefined) {
    if (patch.rate === null) delete d.rate;
    else if (Number.isInteger(patch.rate) && patch.rate >= 8000 && patch.rate <= 384000) d.rate = patch.rate;
  }
  const count = (v: number | undefined, was: number) => (v === undefined || !Number.isInteger(v) ? was : Math.max(1, Math.min(AUDIO_MAX_CHANNELS, v)));
  const nIn = count(patch.inputs, d.inputs);
  const nOut = count(patch.outputs, d.outputs);
  if (nIn !== d.inputs) {
    next.inputs = next.inputs.filter((c) => c.ch <= nIn);
    for (let ch = d.inputs + 1; ch <= nIn; ch++) if (!next.inputs.some((c) => c.ch === ch)) next.inputs.push({ ch, label: `In ${ch}`, kind: "line" });
    next.inputs.sort((a, b) => a.ch - b.ch);
    next.routes = next.routes.filter((r) => r.in <= nIn);
    d.inputs = nIn;
  }
  if (nOut !== d.outputs) {
    next.outputs = next.outputs.filter((c) => c.ch <= nOut);
    for (let ch = d.outputs + 1; ch <= nOut; ch++) if (!next.outputs.some((c) => c.ch === ch)) next.outputs.push({ ch, label: `Out ${ch}` });
    next.outputs.sort((a, b) => a.ch - b.ch);
    next.routes = next.routes.map((r) => ({ ...r, out: r.out.filter((c) => c <= nOut) })).filter((r) => r.out.length > 0);
    for (const s of next.speakers) s.out = s.out.filter((c) => c <= nOut);
    d.outputs = nOut;
  }
  return next;
}

/** Label an input / set what it carries (an unlisted channel is added). */
export function patchInput(audio: AudioConfig, ch: number, patch: { label?: string; kind?: AudioInputKind }): AudioConfig {
  if (!Number.isInteger(ch) || ch < 1 || ch > audio.device.inputs) return audio;
  if (patch.kind !== undefined && !(AUDIO_INPUT_KINDS as readonly string[]).includes(patch.kind)) return audio;
  const next = clone(audio);
  let c = next.inputs.find((x) => x.ch === ch);
  if (c === undefined) {
    c = { ch, label: `In ${ch}`, kind: "line" };
    next.inputs.push(c);
    next.inputs.sort((a, b) => a.ch - b.ch);
  }
  if (patch.label !== undefined) c.label = patch.label;
  if (patch.kind !== undefined) c.kind = patch.kind;
  return next;
}

export function patchOutput(audio: AudioConfig, ch: number, patch: { label: string }): AudioConfig {
  if (!Number.isInteger(ch) || ch < 1 || ch > audio.device.outputs) return audio;
  const next = clone(audio);
  const c = next.outputs.find((x) => x.ch === ch);
  if (c !== undefined) c.label = patch.label;
  else {
    next.outputs.push({ ch, label: patch.label });
    next.outputs.sort((a, b) => a.ch - b.ch);
  }
  return next;
}

// --- the matrix -----------------------------------------------------------

const cellKey = (i: number, o: number): string => `${i}>${o}`;

/** Every routed cell, `in>out` → dB. */
export function cellsOf(audio: AudioConfig): Map<string, number> {
  const cells = new Map<string, number>();
  for (const r of audio.routes) for (const o of r.out) if (!cells.has(cellKey(r.in, o))) cells.set(cellKey(r.in, o), r.gain ?? 0);
  return cells;
}

/** The cells back as sparse routes: one row per (input, gain), outputs
 *  ascending, unity gain left unwritten — so the same matrix is always the
 *  same JSON (and the same version). */
export function routesOf(cells: ReadonlyMap<string, number>): AudioConfig["routes"] {
  const rows = new Map<string, { in: number; out: number[]; gain: number }>();
  for (const [k, gain] of cells) {
    const [i, o] = k.split(">").map(Number) as [number, number];
    const key = `${i}@${gain}`;
    const row = rows.get(key) ?? { in: i, out: [], gain };
    row.out.push(o);
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, out: r.out.sort((a, b) => a - b) }))
    .sort((a, b) => a.in - b.in || a.out[0]! - b.out[0]!)
    .map((r) => (r.gain === 0 ? { in: r.in, out: r.out } : { in: r.in, out: r.out, gain: r.gain }));
}

/** A cell's gain (dB), null when the input isn't routed there. */
export function cellGain(audio: AudioConfig, input: number, output: number): number | null {
  return cellsOf(audio).get(cellKey(input, output)) ?? null;
}

/** Route an input to an output at `gain` dB (null: unroute it). */
export function setCell(audio: AudioConfig, input: number, output: number, gain: number | null): AudioConfig {
  if (input < 1 || input > audio.device.inputs || output < 1 || output > audio.device.outputs) return audio;
  const cells = cellsOf(audio);
  const k = cellKey(input, output);
  const was = cells.get(k) ?? null;
  const g = gain === null || !Number.isFinite(gain) ? null : clampGain(gain);
  if (was === g) return audio;
  if (g === null) cells.delete(k);
  else cells.set(k, g);
  const next = clone(audio);
  next.routes = routesOf(cells);
  return next;
}

/** A tap on a matrix cell: routed → off; off → 0 dB. */
export function toggleCell(audio: AudioConfig, input: number, output: number): AudioConfig {
  return setCell(audio, input, output, cellGain(audio, input, output) === null ? 0 : null);
}

// --- zones ----------------------------------------------------------------

/** A new zone (id slugged from its name, never `everywhere`). */
export function addZone(audio: AudioConfig, name: string, speakers: readonly string[] = []): { audio: AudioConfig; id: string } {
  const label = name.trim() === "" ? "Zone" : name.trim();
  let base = slug(label, "zone");
  if (base === AUDIO_EVERYWHERE) base = "zone";
  const taken = [...audio.zones.map((z) => z.id), ...audio.speakers.map((s) => s.id), AUDIO_EVERYWHERE];
  const id = freshId(base, taken);
  const next = clone(audio);
  next.zones.push({ id, name: label, speakers: speakers.filter((x) => speakerById(audio, x) !== undefined) });
  return { audio: next, id };
}

export function patchZone(audio: AudioConfig, id: string, patch: { name: string }): AudioConfig {
  if (!audio.zones.some((z) => z.id === id)) return audio;
  const next = clone(audio);
  next.zones.find((z) => z.id === id)!.name = patch.name;
  return next;
}

/** Put a speaker in a zone or take it out (file order kept). */
export function setZoneMember(audio: AudioConfig, id: string, speaker: string, on: boolean): AudioConfig {
  const z = audio.zones.find((x) => x.id === id);
  if (z === undefined || speakerById(audio, speaker) === undefined || z.speakers.includes(speaker) === on) return audio;
  const next = clone(audio);
  const n = next.zones.find((x) => x.id === id)!;
  const want = new Set(on ? [...n.speakers, speaker] : n.speakers.filter((x) => x !== speaker));
  n.speakers = next.speakers.map((s) => s.id).filter((x) => want.has(x));
  return next;
}

/** Delete a zone (and its name from every target list). */
export function removeZone(audio: AudioConfig, id: string): AudioConfig {
  if (!audio.zones.some((z) => z.id === id)) return audio;
  const next = clone(audio);
  next.zones = next.zones.filter((z) => z.id !== id);
  retarget(next, id, null);
  return next;
}

/** The zones a speaker is in. */
export function zonesOf(audio: AudioConfig, speaker: string): string[] {
  return audio.zones.filter((z) => z.speakers.includes(speaker)).map((z) => z.id);
}

// --- cues and targets -----------------------------------------------------

export interface CueRow {
  name: string;
  cue: AudioCue | null;
  /** The story plays it (`sound X`); false = only in the config. */
  inStory: boolean;
  /** The announcement chime: rung with the announcements (`announce.to`),
   *  never as a cue — its row says so instead of offering targets (LA-2). */
  chime: boolean;
}

/** Every story sound (sorted), then any cue the config has that the story doesn't play. */
export function cueRows(audio: AudioConfig, sounds: readonly string[]): CueRow[] {
  const story = new Set(sounds);
  const rows: CueRow[] = [...story].sort().map((name) => ({ name, cue: audio.cues[name] ?? null, inStory: true, chime: name === AUDIO_CHIME_SOUND }));
  for (const name of Object.keys(audio.cues).sort()) if (!story.has(name)) rows.push({ name, cue: audio.cues[name]!, inStory: false, chime: name === AUDIO_CHIME_SOUND });
  return rows;
}

/** Set where a sound plays; an empty list drops the cue (the router then
 *  falls back to the `sound … in` room or the beat's setting). */
export function setCueTargets(audio: AudioConfig, name: string, to: readonly string[]): AudioConfig {
  const list = [...new Set(to.map((t) => t.trim()).filter((t) => t !== ""))];
  const was = audio.cues[name];
  if (list.length === 0 && was === undefined) return audio;
  const next = clone(audio);
  if (list.length === 0) delete next.cues[name];
  else next.cues[name] = { ...(was ?? {}), to: list };
  return next;
}

export function setCueGain(audio: AudioConfig, name: string, gain: number | null): AudioConfig {
  if (audio.cues[name] === undefined) return audio;
  const next = clone(audio);
  const c = next.cues[name]!;
  if (gain === null || gain === 0 || !Number.isFinite(gain)) delete c.gain;
  else c.gain = clampGain(gain);
  return next;
}

/** Where house announcements play (empty: the section goes — the router's default). */
export function setAnnounce(audio: AudioConfig, to: readonly string[], chime?: boolean): AudioConfig {
  const next = clone(audio);
  const list = [...new Set(to)];
  const c = chime ?? audio.announce?.chime;
  if (list.length === 0 && c === undefined) delete next.announce;
  else next.announce = { to: list, ...(c !== undefined ? { chime: c } : {}) };
  return next;
}

/** The speakers / zones the TV's voice also reaches. */
export function setTvVoice(audio: AudioConfig, to: readonly string[]): AudioConfig {
  const next = clone(audio);
  const list = [...new Set(to)];
  if (list.length === 0) delete next.voice;
  else next.voice = { ...(next.voice ?? {}), tv: list };
  return next;
}

export type TargetKind = "everywhere" | "zone" | "room" | "location" | "speaker";

export interface TargetOption {
  value: string;
  label: string;
  kind: TargetKind;
}

/** What a target list can name, grouped: everywhere, the zones, the
 *  story's LOCATIONs, the map's rooms, the speakers. */
export function targetOptions(audio: AudioConfig, house: HouseMap, locations: readonly string[] | null): TargetOption[] {
  const locs = locations ?? [...new Set(house.rooms.flatMap((r) => (r.location ? [r.location] : [])))].sort((a, b) => a.localeCompare(b));
  return [
    { value: AUDIO_EVERYWHERE, label: "everywhere (every speaker)", kind: "everywhere" },
    ...audio.zones.map((z): TargetOption => ({ value: z.id, label: `${z.name} (zone)`, kind: "zone" })),
    ...locs.map((l): TargetOption => ({ value: l, label: l, kind: "location" })),
    ...house.rooms.map((r): TargetOption => ({ value: r.id, label: `${r.label} · room ${r.id}`, kind: "room" })),
    ...audio.speakers.map((s): TargetOption => ({ value: s.id, label: `${s.name} · speaker`, kind: "speaker" })),
  ];
}

const KIND_ICON: Record<TargetKind, string> = { everywhere: "🌐", zone: "◎", room: "⌂", location: "📍", speaker: "🔊" };

/** A target chip: what it names and how (an unknown name is `kind: null`). */
export function targetChip(options: readonly TargetOption[], value: string): { text: string; kind: TargetKind | null } {
  const f = foldTarget(value);
  const o = options.find((x) => foldTarget(x.value) === f) ?? options.find((x) => x.kind === "zone" && foldTarget(x.label.replace(/ \(zone\)$/, "")) === f);
  if (o === undefined) return { text: `⚠ ${value}`, kind: null };
  const short = o.kind === "room" ? o.label.split(" · ")[0]! : o.kind === "speaker" ? o.label.split(" · ")[0]! : o.kind === "everywhere" ? AUDIO_EVERYWHERE : o.kind === "zone" ? o.label.replace(/ \(zone\)$/, "") : o.label;
  return { text: `${KIND_ICON[o.kind]} ${short}`, kind: o.kind };
}

// --- checking ----------------------------------------------------------------

/**
 * `validateAudio` (against the draft map) as the problem panel's items:
 * each one naming a speaker selects it; the rest open the Audio tab.
 */
export function audioProblemList(audio: AudioConfig, house: HouseMap): { errors: Problem[]; warnings: Problem[] } {
  const v = validateAudio(audio, house);
  const sel = (text: string): Problem["sel"] => {
    const m = /^speakers\[\d+\] "([^"]*)"/.exec(text);
    return m !== null && speakerById(audio, m[1]!) !== undefined ? { kind: "speaker", id: m[1]! } : null;
  };
  const item = (level: Problem["level"]) => (text: string): Problem => {
    const s = sel(text);
    return { text: `🔊 ${text}`, sel: s, level, ...(s === null ? { tab: "audio" as const } : {}) };
  };
  // "output N has no speaker" × 12 on a fresh interface reads as one line.
  const free: number[] = [];
  const rest: string[] = [];
  for (const w of v.warnings) {
    const m = /^output (\d+) has no speaker$/.exec(w);
    if (m !== null) free.push(Number(m[1]));
    else rest.push(w);
  }
  const warnings = rest.map(item("warning"));
  if (free.length === 1) warnings.push(item("warning")(`output ${free[0]} has no speaker`));
  else if (free.length > 1) warnings.push(item("warning")(`outputs ${free.join(", ")} have no speaker`));
  return { errors: v.problems.map(item("error")), warnings };
}

/** The Download JSON button's file. */
export function audioDownload(audio: AudioConfig): { name: string; text: string } {
  return { name: "audio.json", text: `${JSON.stringify(audio, null, 2)}\n` };
}

/** Two configs are the same document (dirty check). */
export function sameAudio(a: AudioConfig | null, b: AudioConfig | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

/**
 * The speakers a map edit would take with it (`followHouse` drops a
 * speaker whose room is gone and that stands in no yard piece): the
 * confirm counts these, yards included.
 */
export function speakersDropped(before: HouseMap, after: HouseMap, audio: AudioConfig): string[] {
  const kept = new Set(followHouse(before, after, audio).speakers.map((s) => s.id));
  return audio.speakers.filter((s) => !kept.has(s.id)).map((s) => s.id);
}

// --- the shared history -----------------------------------------------------

/**
 * The `{house, audio}` history after another director's speaker save was
 * adopted: every entry takes the adopted speakers, so the map's own steps
 * still undo, and a step that only changed speakers (now the same map
 * twice) disappears. The present wins a tie.
 */
export function rebaseHistory(h: History<Doc>, present: Doc, audio: AudioConfig): History<Doc> {
  const line = [...h.past.map((d) => ({ d, now: false })), { d: present, now: true }, ...[...h.future].reverse().map((d) => ({ d, now: false }))];
  const kept: { d: Doc; now: boolean }[] = [];
  for (const x of line) {
    const last = kept[kept.length - 1];
    if (last !== undefined && last.d.house === x.d.house) {
      if (x.now) kept[kept.length - 1] = x;
      continue;
    }
    kept.push(x);
  }
  const at = kept.findIndex((x) => x.now);
  const re = (x: { d: Doc }): Doc => ({ house: x.d.house, audio });
  return { past: kept.slice(0, at).map(re), future: kept.slice(at + 1).map(re).reverse() };
}

// --- saving -----------------------------------------------------------------

/**
 * How the speakers can be saved now. The server checks them against the
 * map it holds, so they save **alone** only when they are valid against
 * the saved map, and **with the map** (the map first) when they are valid
 * against a draft map that can itself be saved.
 */
export interface SpeakerSave {
  alone: boolean;
  withMap: boolean;
  /** Why neither (null: nothing to save, or one of them can). */
  why: string | null;
}

export function speakerSavePlan(o: {
  audioDirty: boolean;
  status: "loading" | "ok" | "missing" | "error";
  mapDirty: boolean;
  mapSaveable: boolean;
  /** `validateAudio` against the draft map / the saved one. */
  validDraft: boolean;
  validSaved: boolean;
}): SpeakerSave {
  const no = (why: string | null): SpeakerSave => ({ alone: false, withMap: false, why });
  if (!o.audioDirty) return no(null);
  if (o.status === "missing") return no("this server can't store speakers (it predates wave 17) — Download JSON keeps them");
  if (o.status === "loading") return no("the speaker config is still loading");
  if (o.status !== "ok") return no("the speaker config is out of reach right now");
  const alone = o.validSaved;
  const withMap = o.mapDirty && o.mapSaveable && o.validDraft;
  if (alone || withMap) return { alone, withMap, why: null };
  return no(o.mapDirty && o.validDraft ? "a speaker stands where only the draft map has a room, and the map can't be saved yet — fix the map first" : "fix the speaker problems first");
}

/** The toolbar's 💾: the map when it changed and can be saved, the speakers when they can follow it. */
export function saveAllPlan(o: { mapDirty: boolean; mapSaveable: boolean; speakers: SpeakerSave }): { map: boolean; speakers: boolean } {
  const map = o.mapDirty && o.mapSaveable;
  return { map, speakers: map ? o.speakers.withMap : o.speakers.alone };
}
