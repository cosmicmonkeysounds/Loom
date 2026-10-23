//! The house lights in the map editor (wave 20, D7) — pure ops on
//! `lights.json` (`@loom/house` `LightsConfig`). Like the speakers, the
//! fixtures stand on the map's rooms but live in their own project file
//! (placing a bulb mid-show must never bump the map version), so every op
//! takes the config (and the house it is placed on, where it needs one) and
//! returns a changed copy; the page keeps one undo history of `{house,
//! audio, lights}` (`Doc`), so a room move that carries a bulb is one step.
//!
//! What is here: placing / moving / duplicating / renaming / deleting a
//! fixture; the fixtures following an edited map (`followHouseLights`);
//! picking its Zigbee2MQTT device (the module's device list, unplaced lights
//! first); zones; the **looks** builder (targets, steps with Zigbee-safe
//! spacing, once / repeat / loop / give the light back); the colour
//! swatches a fixture is tested with; the problem list; the save plans.

import {
  LIGHT_COLOR_STEP_MIN_MS,
  LIGHT_KINDS,
  LIGHT_LOOP_MIN_PERIOD_MS,
  LIGHT_MAX_REPEAT,
  LIGHT_MAX_STEPS,
  LIGHT_RESTORE_MS,
  LIGHT_SAFETY_MIN,
  LIGHT_STEP_MIN_MS,
  LIGHTS_EVERYWHERE,
  cloneData,
  defaultLights,
  distanceToBoundary,
  floorById,
  foldTarget,
  isLightLookName,
  pointInPoly,
  resolveLightTargets,
  roomAt,
  roomById,
  roomElevation,
  safetyMin,
  validateLights,
} from "@loom/house";
import type { HouseMap, LightCaps, LightFixture, LightKind, LightLook, LightState, LightStep, LightsConfig, Room, Vec2 } from "@loom/house";
import type { Problem } from "./check.ts";
import { rectSideOf, round } from "./doors.ts";
import { rebaseField, type History } from "./history.ts";
import { freshId, slug, uniqueId } from "./ids.ts";
import { labelSpot, rectOf } from "./plan.ts";
import type { LightTestRow, Z2mDevice, LightPairInfo } from "./lights-api.ts";

/** A new fixture hangs this far above its room's floor (the house frame is
 *  absolute: the basement's ceiling bulb is at −2.7 + 2.1 = −0.6). */
export const LIGHT_HEIGHT = 2.1;
/** A fixture id: lower-case letters, digits and `-` (`validateLights`). */
export const LIGHT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
/** Caps a new fixture starts with (an RGB bulb's; the device picker replaces them). */
export const DEFAULT_CAPS: LightCaps = { color: true, ct: true, dim: true };

const clone = (l: LightsConfig): LightsConfig => cloneData(l);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A config as the page edits it: any list the server (or a hand-written
 * file) left out is filled in, the rest kept as it is (`validateLights`
 * judges it). Not an object → the default (nothing placed, no looks).
 */
export function normalizeLights(raw: unknown): LightsConfig {
  if (!isObj(raw)) return defaultLights();
  const l = cloneData(raw) as Partial<LightsConfig> & Record<string, unknown>;
  return {
    ...l,
    version: 1,
    fixtures: Array.isArray(l.fixtures) ? l.fixtures : [],
    zones: Array.isArray(l.zones) ? l.zones : [],
    looks: isObj(l.looks) ? (l.looks as Record<string, LightLook>) : {},
  } as LightsConfig;
}

export function lightById(lights: LightsConfig, id: string): LightFixture | undefined {
  return lights.fixtures.find((f) => f.id === id);
}

/** The floor a fixture shows on: its room's ("" for a room the map lost). */
export function lightFloor(house: HouseMap, f: Pick<LightFixture, "room" | "floor">): string {
  return roomById(house, f.room)?.floor ?? f.floor ?? "";
}

/** A fixture's plan point. */
export const lightPlan = (f: LightFixture): Vec2 => [f.pos.x, f.pos.z];

/** The height a fixture in `room` is hung at by default. */
export function defaultLightY(house: HouseMap, room: Room): number {
  return round(roomElevation(house, room) + LIGHT_HEIGHT);
}

/** Put a new fixture in `roomId` (at `at`, else the room's middle), hung
 *  `LIGHT_HEIGHT` up, a Zigbee bulb with no device picked yet. */
export function addLight(lights: LightsConfig, house: HouseMap, roomId: string, at?: Vec2): { lights: LightsConfig; id: string } {
  const room = roomById(house, roomId);
  if (room === undefined) return { lights, id: "" };
  const next = clone(lights);
  const taken = [...next.fixtures.map((f) => f.id), ...next.zones.map((z) => z.id)];
  const id = uniqueId("light", taken);
  const p = at ?? labelSpot(room.poly);
  next.fixtures.push({
    id,
    name: `Light ${id.slice("light-".length)} · ${room.label}`,
    room: room.id,
    floor: room.floor,
    pos: { x: round(p[0]), y: defaultLightY(house, room), z: round(p[1]) },
    kind: "zigbee",
    device: "",
    caps: { ...DEFAULT_CAPS },
  });
  return { lights: next, id };
}

/** The 💡 palette's click: a fixture at a plan point on `floor`; null when no room is there. */
export function placeLight(lights: LightsConfig, house: HouseMap, floor: string, at: Vec2): { lights: LightsConfig; id: string } | null {
  const room = roomAt(house, at, floor);
  return room === null ? null : addLight(lights, house, room.id, at);
}

function withLight(lights: LightsConfig, id: string, f: (x: LightFixture) => void): LightsConfig {
  if (lightById(lights, id) === undefined) return lights;
  const next = clone(lights);
  f(lightById(next, id)!);
  return next;
}

/** Move a fixture to a plan point (its height kept); its room follows to
 *  whichever room on its floor now holds it. */
export function moveLight(lights: LightsConfig, house: HouseMap, id: string, plan: Vec2): LightsConfig {
  const f = lightById(lights, id);
  if (f === undefined || (f.pos.x === round(plan[0]) && f.pos.z === round(plan[1]))) return lights;
  return withLight(lights, id, (n) => {
    n.pos = { x: round(plan[0]), y: n.pos.y, z: round(plan[1]) };
    const floor = lightFloor(house, n);
    const room = floor === "" ? null : roomAt(house, plan, floor);
    if (room !== null) {
      n.room = room.id;
      n.floor = room.floor;
    }
  });
}

export function setLightHeight(lights: LightsConfig, id: string, y: number): LightsConfig {
  if (!Number.isFinite(y) || lightById(lights, id)?.pos.y === round(y)) return lights;
  return withLight(lights, id, (f) => {
    f.pos = { ...f.pos, y: round(y) };
  });
}

/** The inspector's fields. `min: null` drops the fixture's own floor. */
export function patchLight(lights: LightsConfig, id: string, patch: { name?: string; kind?: LightKind; device?: string; caps?: Partial<LightCaps>; safety?: boolean; min?: number | null }): LightsConfig {
  return withLight(lights, id, (f) => {
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.kind !== undefined && (LIGHT_KINDS as readonly string[]).includes(patch.kind)) f.kind = patch.kind;
    if (patch.device !== undefined) f.device = patch.device.trim();
    if (patch.caps !== undefined) f.caps = { ...f.caps, ...patch.caps };
    if (patch.safety !== undefined) {
      if (patch.safety) f.safety = true;
      else delete f.safety;
    }
    if ("min" in patch) {
      if (patch.min === null || patch.min === undefined || !Number.isFinite(patch.min)) delete f.min;
      // A safety light's floor is never under LIGHT_SAFETY_MIN (the server would use 40 anyway).
      else f.min = Math.max(f.safety === true ? LIGHT_SAFETY_MIN : 1, Math.min(254, Math.round(patch.min)));
    }
  });
}

/** The kind a Zigbee2MQTT entry is played as. */
export function deviceKind(d: Pick<Z2mDevice, "type">): LightKind {
  return d.type === "Group" ? "zigbee-group" : "zigbee";
}

/**
 * Pick a fixture's device: a Zigbee2MQTT entry from the module's list (its
 * kind and — when the module read them — its caps come with it), or a typed
 * name (a WLED base topic, or a bulb not paired yet: the kind and caps are
 * kept, except a `wled/…` topic makes it a WLED strip).
 */
export function setLightDevice(lights: LightsConfig, id: string, device: Z2mDevice | string): LightsConfig {
  if (typeof device === "string") {
    const name = device.trim();
    const wled = /^wled\//i.test(name);
    return patchLight(lights, id, { device: name, ...(wled ? { kind: "wled" as const } : lightById(lights, id)?.kind === "wled" ? { kind: "zigbee" as const } : {}) });
  }
  return patchLight(lights, id, { device: device.friendly, kind: deviceKind(device), ...(device.caps !== null ? { caps: { ...device.caps } } : {}) });
}

/** Swap a target name everywhere a look (or one of its steps) names it. */
function retarget(l: LightsConfig, from: string, to: string | null): void {
  const f = foldTarget(from);
  const fix = (list: string[]): string[] => [...new Set(list.flatMap((t) => (foldTarget(t) === f ? (to === null ? [] : [to]) : [t])))];
  for (const look of Object.values(l.looks)) {
    if (Array.isArray(look.to)) look.to = fix(look.to);
    for (const s of Array.isArray(look.steps) ? look.steps : []) if (Array.isArray(s.to)) s.to = fix(s.to);
  }
}

/** Why an id can't be a fixture's / zone's (null: it can). */
export function lightIdError(lights: LightsConfig, id: string, self?: string): string | null {
  if (id === "") return "an id is needed";
  if (!LIGHT_ID_RE.test(id)) return `“${id}”: lower-case letters, digits and "-" only`;
  if (id === LIGHTS_EVERYWHERE) return `“${LIGHTS_EVERYWHERE}” is reserved`;
  if (id !== self && (lights.fixtures.some((f) => f.id === id) || lights.zones.some((z) => z.id === id))) return `“${id}” is taken`;
  return null;
}

/** Rename a fixture's id (and every zone / look naming it). Unchanged when
 *  `lightIdError` objects. */
export function renameLight(lights: LightsConfig, from: string, to: string): LightsConfig {
  const id = to.trim();
  if (id === from || lightById(lights, from) === undefined || lightIdError(lights, id, from) !== null) return lights;
  const next = clone(lights);
  lightById(next, from)!.id = id;
  for (const z of next.zones) z.fixtures = z.fixtures.map((x) => (x === from ? id : x));
  retarget(next, from, id);
  return next;
}

/** Delete a fixture (and its place in every zone and target list). */
export function removeLight(lights: LightsConfig, id: string): LightsConfig {
  if (lightById(lights, id) === undefined) return lights;
  const next = clone(lights);
  next.fixtures = next.fixtures.filter((f) => f.id !== id);
  for (const z of next.zones) z.fixtures = z.fixtures.filter((x) => x !== id);
  retarget(next, id, null);
  return next;
}

/** A copy of a fixture `offset` east and south, a fresh id, no device (one bulb is one device). */
export function duplicateLight(lights: LightsConfig, house: HouseMap, id: string, offset: number): { lights: LightsConfig; id: string } | null {
  const f = lightById(lights, id);
  if (f === undefined) return null;
  const next = clone(lights);
  const base = f.id.replace(/-\d+$/, "") || f.id;
  const copy = uniqueId(base, [...next.fixtures.map((x) => x.id), ...next.zones.map((z) => z.id)]);
  next.fixtures.push({ ...cloneData(f), id: copy, name: `${f.name} copy`, device: "" });
  return { lights: moveLight(next, house, copy, [f.pos.x + offset, f.pos.z + offset]), id: copy };
}

// --- following the map -------------------------------------------------------

const samePoly = (a: readonly Vec2[], b: readonly Vec2[]): boolean => a.length === b.length && a.every((p, i) => p[0] === b[i]![0] && p[1] === b[i]![1]);

function shiftOf(before: readonly Vec2[], after: readonly Vec2[]): Vec2 | null {
  if (before.length !== after.length || before.length === 0) return null;
  const dx = after[0]![0] - before[0]![0];
  const dz = after[0]![1] - before[0]![1];
  const ok = before.every((p, i) => Math.abs(after[i]![0] - p[0] - dx) < 1e-6 && Math.abs(after[i]![1] - p[1] - dz) < 1e-6);
  return ok ? [dx, dz] : null;
}

const insideOf = (room: Room, p: Vec2): boolean => pointInPoly(room.poly, p) || distanceToBoundary(room.poly, p) <= 0.05 + 1e-9;

/**
 * The fixtures after a map edit, as the speakers follow it (`followHouse`):
 * a moved room carries its lights; a dragged edge carries the ones on that
 * wall; a raised floor lifts them; a renamed room is followed; a yard re-cut
 * re-homes them into the piece they stand in; a fixture left standing in
 * another room on its floor now lives there; a deleted room takes its
 * lights with it. The same config when nothing moved.
 */
export function followHouseLights(before: HouseMap, after: HouseMap, lights: LightsConfig): LightsConfig {
  if (before === after || lights.fixtures.length === 0) return lights;
  let changed = false;
  const next = clone(lights);
  const gone: string[] = [];
  for (const f of next.fixtures) {
    const rb = roomById(before, f.room);
    if (rb === undefined) continue; // never on this map: validateLights says so
    let ra = roomById(after, f.room);
    let p: Vec2 = [f.pos.x, f.pos.z];
    if (ra === undefined) {
      ra = after.rooms.find((r) => r.floor === rb.floor && roomById(before, r.id) === undefined && samePoly(r.poly, rb.poly));
      if (ra === undefined && rb.outdoor === true) ra = roomAt(after, p, rb.floor) ?? undefined;
      if (ra === undefined) {
        gone.push(f.id);
        continue;
      }
    } else if (!samePoly(rb.poly, ra.poly)) {
      const shift = shiftOf(rb.poly, ra.poly);
      if (shift !== null) p = [round(p[0] + shift[0]), round(p[1] + shift[1])];
      else {
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
    const y = round(f.pos.y + roomElevation(after, ra) - roomElevation(before, rb));
    let home = ra;
    if (!insideOf(ra, p)) home = roomAt(after, p, ra.floor) ?? ra;
    if (p[0] !== f.pos.x || p[1] !== f.pos.z || y !== f.pos.y || home.id !== f.room || home.floor !== f.floor) {
      changed = true;
      f.pos = { x: p[0], y, z: p[1] };
      f.room = home.id;
      f.floor = home.floor;
    }
  }
  if (gone.length > 0) {
    let out = next;
    for (const id of gone) out = removeLight(out, id);
    return out;
  }
  return changed ? next : lights;
}

/** The fixtures a map edit would take with it (for the delete confirm). */
export function lightsDropped(before: HouseMap, after: HouseMap, lights: LightsConfig): string[] {
  const kept = new Set(followHouseLights(before, after, lights).fixtures.map((f) => f.id));
  return lights.fixtures.filter((f) => !kept.has(f.id)).map((f) => f.id);
}

/** "Delete the room “Kitchen” with 2 doors and 1 speaker?" + " and 1 light". */
export function withLightsText(confirm: string, n: number): string {
  if (n === 0) return confirm;
  const what = `${n} light${n === 1 ? "" : "s"}`;
  return /\swith\s/.test(confirm) ? confirm.replace(/\?$/, ` and ${what}?`) : confirm.replace(/\?$/, ` with ${what}?`);
}

// --- zones -------------------------------------------------------------------

/** A new zone (id slugged from its name, never `everywhere` or a fixture's id). */
export function addLightZone(lights: LightsConfig, name: string, fixtures: readonly string[] = []): { lights: LightsConfig; id: string } {
  const label = name.trim() === "" ? "Zone" : name.trim();
  let base = slug(label, "zone");
  if (base === LIGHTS_EVERYWHERE || !LIGHT_ID_RE.test(base)) base = "zone";
  const id = freshId(base, [...lights.zones.map((z) => z.id), ...lights.fixtures.map((f) => f.id), LIGHTS_EVERYWHERE]);
  const next = clone(lights);
  next.zones.push({ id, name: label, fixtures: fixtures.filter((x) => lightById(lights, x) !== undefined) });
  return { lights: next, id };
}

export function renameLightZone(lights: LightsConfig, id: string, name: string): LightsConfig {
  const z = lights.zones.find((x) => x.id === id);
  if (z === undefined || z.name === name) return lights;
  const next = clone(lights);
  // A look naming the zone by its old name keeps reaching it.
  retarget(next, z.name, id);
  next.zones.find((x) => x.id === id)!.name = name;
  return next;
}

/** Put a fixture in a zone or take it out (file order kept). */
export function setLightZoneMember(lights: LightsConfig, id: string, fixture: string, on: boolean): LightsConfig {
  const z = lights.zones.find((x) => x.id === id);
  if (z === undefined || lightById(lights, fixture) === undefined || z.fixtures.includes(fixture) === on) return lights;
  const next = clone(lights);
  const n = next.zones.find((x) => x.id === id)!;
  const want = new Set(on ? [...n.fixtures, fixture] : n.fixtures.filter((x) => x !== fixture));
  n.fixtures = next.fixtures.map((f) => f.id).filter((x) => want.has(x));
  return next;
}

/** Delete a zone (and its name from every look). */
export function removeLightZone(lights: LightsConfig, id: string): LightsConfig {
  const z = lights.zones.find((x) => x.id === id);
  if (z === undefined) return lights;
  const next = clone(lights);
  next.zones = next.zones.filter((x) => x.id !== id);
  retarget(next, id, null);
  retarget(next, z.name, null);
  return next;
}

export function lightZonesOf(lights: LightsConfig, fixture: string): string[] {
  return lights.zones.filter((z) => z.fixtures.includes(fixture)).map((z) => z.id);
}

// --- targets -----------------------------------------------------------------

export type LightTargetKind = "everywhere" | "zone" | "location" | "room" | "fixture";

export interface LightTargetOption {
  value: string;
  label: string;
  kind: LightTargetKind;
}

/** What a look's `to` can name, grouped: everywhere, the zones, the story's
 *  LOCATIONs, the map's rooms, the fixtures. */
export function lightTargetOptions(lights: LightsConfig, house: HouseMap, locations: readonly string[] | null): LightTargetOption[] {
  const locs = locations !== null && locations.length > 0 ? locations : [...new Set(house.rooms.flatMap((r) => (r.location ? [r.location] : [])))].sort((a, b) => a.localeCompare(b));
  return [
    { value: LIGHTS_EVERYWHERE, label: "everywhere (every fixture)", kind: "everywhere" },
    ...lights.zones.map((z): LightTargetOption => ({ value: z.id, label: `${z.name} (zone)`, kind: "zone" })),
    ...locs.map((l): LightTargetOption => ({ value: l, label: l, kind: "location" })),
    ...house.rooms.map((r): LightTargetOption => ({ value: r.id, label: `${r.label} · room ${r.id}`, kind: "room" })),
    ...lights.fixtures.map((f): LightTargetOption => ({ value: f.id, label: `${f.name} · light`, kind: "fixture" })),
  ];
}

const KIND_ICON: Record<LightTargetKind, string> = { everywhere: "🌐", zone: "◎", room: "⌂", location: "📍", fixture: "💡" };

/** A target chip's text and kind (`kind: null`: it names nothing known). */
export function lightTargetChip(options: readonly LightTargetOption[], value: string): { text: string; kind: LightTargetKind | null } {
  const f = foldTarget(value);
  const o = options.find((x) => foldTarget(x.value) === f) ?? options.find((x) => x.kind === "zone" && foldTarget(x.label.replace(/ \(zone\)$/, "")) === f);
  if (o === undefined) return { text: `⚠ ${value}`, kind: null };
  const short = o.kind === "room" || o.kind === "fixture" ? o.label.split(" · ")[0]! : o.kind === "everywhere" ? LIGHTS_EVERYWHERE : o.kind === "zone" ? o.label.replace(/ \(zone\)$/, "") : o.label;
  return { text: `${KIND_ICON[o.kind]} ${short}`, kind: o.kind };
}

// --- looks -------------------------------------------------------------------

/** A look's steps (`set` is one step at 0). */
export function stepsOfLook(look: LightLook): LightStep[] {
  if (Array.isArray(look.steps)) return look.steps;
  if (look.set !== undefined) return [{ at: 0, set: look.set }];
  return [];
}

/** A look written the short way when it can be: one step at 0 for the
 *  look's own targets is `set`; anything else is `steps` (sorted by `at`). */
function canonical(look: LightLook, steps: LightStep[]): LightLook {
  const out: LightLook = { ...look };
  delete out.set;
  delete out.steps;
  const sorted = [...steps].sort((a, b) => a.at - b.at);
  if (sorted.length === 1 && sorted[0]!.at === 0 && sorted[0]!.to === undefined) out.set = sorted[0]!.set;
  else out.steps = sorted;
  return out;
}

/** Why `name` can't be a new look (null: it can). */
export function lookNameError(lights: LightsConfig, name: string, self?: string): string | null {
  if (name === "") return "a look needs a name (the story's cue name)";
  if (!isLightLookName(name)) return /^[a-z][a-z0-9_]*$/.test(name) ? `“${name}”: screens_ / terminals_ / tv_ / tablet_ / room_ cues are the screens'` : `“${name}”: lower-case letters, digits and "_", starting with a letter`;
  if (name !== self && Object.prototype.hasOwnProperty.call(lights.looks, name)) return `“${name}” is already a look`;
  return null;
}

/** A typed name as a look name: "Heart Wake!" → `heart_wake`. */
export function lookNameOf(text: string): string {
  return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^[^a-z]+|_+$/g, "");
}

/** A new look: one `ON` step at full brightness for `to`. */
export function addLook(lights: LightsConfig, name: string, to: readonly string[]): { lights: LightsConfig; name: string } | { error: string } {
  const err = lookNameError(lights, name);
  if (err !== null) return { error: err };
  const next = clone(lights);
  next.looks[name] = { to: [...new Set(to)], set: { state: "ON", brightness: 254, transition: 1 } };
  return { lights: next, name };
}

function withLook(lights: LightsConfig, name: string, f: (look: LightLook) => LightLook): LightsConfig {
  const look = lights.looks[name];
  if (look === undefined) return lights;
  const out = f(cloneData(look));
  if (JSON.stringify(out) === JSON.stringify(look)) return lights;
  const next = clone(lights);
  next.looks[name] = out;
  return next;
}

/** Rename a look (the boot look follows). The story's `cue X` must follow too. */
export function renameLook(lights: LightsConfig, from: string, to: string): LightsConfig {
  if (from === to || lights.looks[from] === undefined || lookNameError(lights, to, from) !== null) return lights;
  const next = clone(lights);
  const looks: Record<string, LightLook> = {};
  for (const [k, v] of Object.entries(next.looks)) looks[k === from ? to : k] = v;
  next.looks = looks;
  if (next.boot === from) next.boot = to;
  return next;
}

export function removeLook(lights: LightsConfig, name: string): LightsConfig {
  if (lights.looks[name] === undefined) return lights;
  const next = clone(lights);
  delete next.looks[name];
  if (next.boot === name) delete next.boot;
  return next;
}

/** Copy a look under a new name. */
export function duplicateLook(lights: LightsConfig, from: string): { lights: LightsConfig; name: string } | null {
  const look = lights.looks[from];
  if (look === undefined) return null;
  let i = 2;
  while (Object.prototype.hasOwnProperty.call(lights.looks, `${from}_${i}`)) i++;
  const name = `${from}_${i}`;
  const next = clone(lights);
  next.looks[name] = cloneData(look);
  return { lights: next, name };
}

export function setLookTargets(lights: LightsConfig, name: string, to: readonly string[]): LightsConfig {
  return withLook(lights, name, (look) => ({ ...look, to: [...new Set(to.map((t) => t.trim()).filter((t) => t !== ""))] }));
}

export function setLookNote(lights: LightsConfig, name: string, note: string): LightsConfig {
  return withLook(lights, name, (look) => {
    const out = { ...look };
    if (note.trim() === "") delete out.note;
    else out.note = note;
    return out;
  });
}

/** One state field set, or (null) dropped. `color` and `color_temp` replace each other. */
export type StatePatch = { [K in keyof LightState]?: LightState[K] | null };

export function patchState(s: LightState, patch: StatePatch): LightState {
  const out: LightState = { ...s };
  for (const [k, v] of Object.entries(patch) as [keyof LightState, unknown][]) {
    if (v === null || v === undefined) delete out[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  if (patch.color !== undefined && patch.color !== null) delete out.color_temp;
  if (patch.color_temp !== undefined && patch.color_temp !== null) delete out.color;
  return out;
}

/** Does a step's set change the colour (the 400 ms rule)? */
export const setsColour = (s: LightState): boolean => s.color !== undefined || s.color_temp !== undefined;

/** The earliest `at` step `i` may have after the step before it (Zigbee's spacing). */
export function minStepAt(steps: readonly LightStep[], i: number): number {
  if (i <= 0) return 0;
  const prev = steps[i - 1]!;
  return prev.at + (setsColour(steps[i]!.set) ? LIGHT_COLOR_STEP_MIN_MS : LIGHT_STEP_MIN_MS);
}

/** Change step `i`: its `at` (the steps re-sorted), its state, its own targets (null: the look's). */
export function patchLookStep(lights: LightsConfig, name: string, i: number, patch: { at?: number; set?: StatePatch; to?: string[] | null }): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look).map((s) => cloneData(s));
    const s = steps[i];
    if (s === undefined) return look;
    if (patch.at !== undefined && Number.isFinite(patch.at)) s.at = Math.max(0, Math.round(patch.at));
    if (patch.set !== undefined) s.set = patchState(s.set, patch.set);
    if (patch.to !== undefined) {
      if (patch.to === null || patch.to.length === 0) delete s.to;
      else s.to = [...new Set(patch.to)];
    }
    return keepPeriod(canonical(look, steps), lights);
  });
}

/** A new step after the last one, far enough for a colour change: a swell
 *  back the other way (bright after dim, dim after bright). */
export function addLookStep(lights: LightsConfig, name: string): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look).map((s) => cloneData(s));
    if (steps.length >= LIGHT_MAX_STEPS) return look;
    const last = steps[steps.length - 1];
    const at = last === undefined ? 0 : Math.ceil((last.at + LIGHT_COLOR_STEP_MIN_MS) / 100) * 100;
    const was = last === undefined ? undefined : [...steps].reverse().find((s) => s.set.brightness !== undefined)?.set.brightness;
    steps.push({ at, set: { brightness: was !== undefined && was >= 128 ? 60 : 254, transition: 0.5 } });
    // A repeating look's period must stay past the new last step.
    const out = canonical(look, steps);
    if (out.period !== undefined && out.period <= at) out.period = minPeriod(out, lights) ?? at + LIGHT_COLOR_STEP_MIN_MS;
    return keepPeriod(out, lights);
  });
}

/** Drop step `i` (a look keeps at least one). */
export function removeLookStep(lights: LightsConfig, name: string, i: number): LightsConfig {
  return withLook(lights, name, (look) => {
    const steps = stepsOfLook(look);
    if (steps.length <= 1 || i < 0 || i >= steps.length) return look;
    return keepPeriod(canonical(look, steps.filter((_, j) => j !== i).map((s) => cloneData(s))), lights);
  });
}

/** How a look ends: once, a few times, until the next look, or once and then the light is given back. */
export type LookMode = "once" | "repeat" | "loop" | "restore";

export function lookMode(look: LightLook): LookMode {
  if (look.loop === true) return "loop";
  if (look.then === "restore") return "restore";
  if (look.repeat !== undefined && look.repeat > 1) return "repeat";
  return "once";
}

/**
 * The shortest `period` that keeps the Zigbee spacing across the wrap (the
 * repeat's next first step, or the restore), with a loop / repeat that can
 * reach a Zigbee light also held to `LIGHT_LOOP_MIN_PERIOD_MS` (anything
 * faster reads as flicker: `validateLights` warns); a WLED-only look may
 * repeat faster. Without `lights` every look is taken to reach Zigbee.
 * Null for a once-only look (no period needed). Look-wide: the last step
 * and the first, as `validateLights` checks each fixture.
 */
export function minPeriod(look: LightLook, lights?: LightsConfig): number | null {
  const mode = lookMode(look);
  if (mode === "once") return null;
  const steps = stepsOfLook(look);
  if (steps.length === 0) return null;
  const last = Math.max(...steps.map((s) => s.at));
  if (mode === "restore") return last + LIGHT_COLOR_STEP_MIN_MS;
  const first = [...steps].sort((a, b) => a.at - b.at)[0]!;
  // Any fixture's first step may be the colour one (`validateLights` checks each fixture's own).
  const gap = steps.some((s) => s.at === first.at && setsColour(s.set)) ? LIGHT_COLOR_STEP_MIN_MS : LIGHT_STEP_MIN_MS;
  return Math.max(last - first.at + gap, last + 1, lights === undefined || lookMayReachZigbee(lights, look) ? LIGHT_LOOP_MIN_PERIOD_MS : 0);
}

/**
 * Can a look reach a Zigbee bulb or group? Its targets resolved without the
 * map (fixtures, zones, a fixture's room); a name only the map resolves (a
 * LOCATION, a room label) counts as reaching any Zigbee light there is.
 */
export function lookMayReachZigbee(lights: LightsConfig, look: LightLook): boolean {
  const zig = (id: string): boolean => {
    const k = lightById(lights, id)?.kind;
    return k === "zigbee" || k === "zigbee-group";
  };
  const names = [...(Array.isArray(look.to) ? look.to : []), ...stepsOfLook(look).flatMap((s) => (Array.isArray(s.to) ? s.to : []))];
  for (const n of new Set(names)) {
    const hit = resolveLightTargets(lights, null, [n]).fixtures;
    if (hit.length === 0 ? lights.fixtures.some((f) => zig(f.id)) : hit.some(zig)) return true;
  }
  return false;
}

/** The period the look plays with (its own, else the schema's default). */
export function effectivePeriod(look: LightLook): number {
  const steps = stepsOfLook(look);
  const last = steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.at));
  return look.period ?? last + (look.then === "restore" ? LIGHT_RESTORE_MS : LIGHT_STEP_MIN_MS);
}

/**
 * Set how a look ends. A mode that needs a period gets one when the look
 * has none or one too short to wrap safely (`minPeriod`), so the builder
 * never writes a look the server refuses for its wrap gap.
 */
export function setLookMode(lights: LightsConfig, name: string, mode: LookMode, repeat = 2): LightsConfig {
  return withLook(lights, name, (look) => {
    const out: LightLook = { ...look };
    delete out.loop;
    delete out.repeat;
    delete out.then;
    if (mode === "loop") out.loop = true;
    else if (mode === "repeat") out.repeat = Math.max(2, Math.min(LIGHT_MAX_REPEAT, Math.round(repeat)));
    else if (mode === "restore") out.then = "restore";
    else delete out.period;
    return keepPeriod(out, lights);
  });
}

/**
 * Lengthen a repeating / give-back look's period when it no longer wraps
 * safely (`minPeriod`): after a mode change, and after a step moves, is
 * added or is dropped, so no edit in the builder leaves a period the
 * server refuses.
 */
function keepPeriod(look: LightLook, lights: LightsConfig): LightLook {
  const min = minPeriod(look, lights);
  if (min !== null && (look.period === undefined ? effectivePeriod(look) < min : look.period < min)) return { ...look, period: Math.ceil(min / 100) * 100 };
  return look;
}

/** A look's period (null: the default, last step + 150 ms / + 1 s for a restore). */
export function setLookPeriod(lights: LightsConfig, name: string, period: number | null): LightsConfig {
  return withLook(lights, name, (look) => {
    const out = { ...look };
    if (period === null || !Number.isFinite(period) || period <= 0) delete out.period;
    else out.period = Math.round(period);
    return out;
  });
}

/** The look the module plays on boot and after a story reset (null: none). */
export function setBoot(lights: LightsConfig, name: string | null): LightsConfig {
  if ((lights.boot ?? null) === name || (name !== null && lights.looks[name] === undefined)) return lights;
  const next = clone(lights);
  if (name === null) delete next.boot;
  else next.boot = name;
  return next;
}

/** The validation lines about one look (its builder shows them inline). */
export function lookProblems(lines: readonly string[], name: string): string[] {
  const head = `looks["${name}"]`;
  return lines.filter((l) => l.startsWith(head)).map((l) => l.slice(head.length).replace(/^[.:\s]+/, "").replace(/^steps\[(\d+)\]/, (_, n: string) => `step ${Number(n) + 1}`) || l);
}

/** The story cues that name no look yet, and the looks the story never cues. */
export function lookCoverage(lights: LightsConfig, storyLooks: readonly string[]): { unwritten: string[]; uncued: string[] } {
  const story = new Set(storyLooks);
  const have = new Set(Object.keys(lights.looks));
  return { unwritten: [...story].filter((n) => !have.has(n)).sort(), uncued: [...have].filter((n) => !story.has(n) && n !== lights.boot).sort() };
}

// --- colours, tests, devices -------------------------------------------------

export interface LightSwatch {
  id: string;
  label: string;
  /** The CSS colour drawn on the button and the plan. */
  css: string;
  hex?: string;
  /** Mireds, for white on a colour-temperature bulb. */
  ct?: number;
}

/** The inspector's test colours (§4's palette: his cyan, listening blue,
 *  argument violet, warning amber, alarm red). */
export const LIGHT_SWATCHES: readonly LightSwatch[] = [
  { id: "red", label: "Red", css: "#FF0000", hex: "#FF0000" },
  { id: "amber", label: "Amber", css: "#FF6A00", hex: "#FF6A00" },
  { id: "white", label: "White", css: "#FFF4E0", hex: "#FFFFFF", ct: 250 },
  { id: "cyan", label: "Cyan", css: "#00E5FF", hex: "#00E5FF" },
  { id: "blue", label: "Blue", css: "#2D6BFF", hex: "#2D6BFF" },
  { id: "violet", label: "Violet", css: "#7A2DFF", hex: "#7A2DFF" },
];

/** What a swatch sends a fixture: full brightness in that colour, as far
 *  as its caps go (a white-only bulb gets white, a plain dimmer full on). */
export function swatchSet(f: LightFixture, sw: LightSwatch): LightState {
  const s: LightState = { state: "ON" };
  if (f.caps.dim) s.brightness = 254;
  if (sw.ct !== undefined && f.caps.ct) s.color_temp = sw.ct;
  else if (sw.hex !== undefined && f.caps.color) s.color = sw.hex;
  else if (sw.ct !== undefined && f.caps.color) s.color = sw.hex ?? "#FFFFFF";
  s.transition = 0.3;
  return s;
}

/** The dimmest a test may take a fixture: its safety floor, else 10. */
export function dimSet(f: LightFixture): LightState {
  return f.caps.dim ? { state: "ON", brightness: f.safety === true ? safetyMin(f) : 10, transition: 0.3 } : { state: "ON" };
}

/** A state as a CSS colour (the plan's bulb tint), null when it sets none. */
export function stateTint(s: LightState | undefined): string | null {
  if (s === undefined) return null;
  if (s.color !== undefined) return s.color;
  if (s.color_temp !== undefined) return s.color_temp >= 330 ? "#FFD59A" : "#FFF4E0";
  if (s.state === "OFF") return "#444444";
  return null;
}

/** The colour a fixture was last tested in (the plan tints its bulb with it). */
export function lastTint(tests: readonly LightTestRow[], fixture: string): string | null {
  for (let i = tests.length - 1; i >= 0; i--) {
    const t = tests[i]!;
    if (t.fixture === fixture && t.set !== null) {
      const c = stateTint(t.set);
      if (c !== null) return c;
    }
  }
  return null;
}

/** One row of the Lights tab's device list. */
export interface DeviceRow {
  device: Z2mDevice;
  /** It can be played (Zigbee2MQTT read light caps off it, or it is a group). */
  light: boolean;
  /** The fixtures that name it. */
  placed: string[];
}

const isLightDevice = (d: Z2mDevice): boolean => d.caps !== null || d.type === "Group";

/**
 * The module's devices as the Lights tab lists them: the lights nobody has
 * placed yet first (a newly paired bulb is at the top), then the placed
 * ones, then the groups, then everything that isn't a light (sensors,
 * plugs); the coordinator never. A–Z within each.
 */
export function deviceRows(devices: readonly Z2mDevice[], lights: LightsConfig): DeviceRow[] {
  const rank = (r: DeviceRow): number => (!r.light ? 3 : r.device.type === "Group" ? 2 : r.placed.length === 0 ? 0 : 1);
  return devices
    .filter((d) => d.type !== "Coordinator")
    .map((d): DeviceRow => ({ device: d, light: isLightDevice(d), placed: lights.fixtures.filter((f) => f.device === d.friendly).map((f) => f.id) }))
    .sort((a, b) => rank(a) - rank(b) || a.device.friendly.localeCompare(b.device.friendly));
}

/** The inspector's device picker: unplaced lights first, then this
 *  fixture's own, then lights placed elsewhere and the groups. */
export function deviceChoices(devices: readonly Z2mDevice[], lights: LightsConfig, fixture: string): { device: Z2mDevice; note: string }[] {
  const own = lightById(lights, fixture)?.device ?? "";
  const rows = deviceRows(devices, lights).filter((r) => r.light);
  const note = (r: DeviceRow): string => (r.device.friendly === own ? "this light" : r.placed.length > 0 ? `placed as ${r.placed.join(", ")}` : r.device.type === "Group" ? "group" : "not placed yet");
  const order = (r: DeviceRow): number => (r.device.friendly === own ? 1 : r.placed.length === 0 && r.device.type !== "Group" ? 0 : 2);
  return [...rows].sort((a, b) => order(a) - order(b)).map((r) => ({ device: r.device, note: note(r) }));
}

/** What a device's caps say, short ("colour · white · dim"). */
export function capsText(c: LightCaps | null): string {
  if (c === null) return "not a light";
  const parts = [c.color ? "colour" : null, c.ct ? "white temp" : null, c.dim ? "dim" : null].filter((x): x is string => x !== null);
  return parts.length === 0 ? "on / off" : parts.join(" · ");
}

/**
 * A pairing window on this browser's clock: the server's `until − at` from
 * when this page first saw it (a wake on the pairing, or this page's own
 * request), so a skewed clock never shows in the countdown. The same
 * pairing seen again keeps its first local times.
 */
export function localPair(prev: LightPairInfo | null, next: LightPairInfo | null, receivedAt: number): LightPairInfo | null {
  if (next === null) return null;
  if (prev !== null && prev.seq === next.seq && prev.seconds === next.seconds) return prev;
  return { ...next, at: receivedAt, until: receivedAt + Math.max(0, next.until - next.at) };
}

/** Whole seconds left on a pairing (0 when closed or past). */
export function pairSecondsLeft(pair: LightPairInfo | null, now: number): number {
  if (pair === null || pair.seconds === 0) return 0;
  return Math.max(0, Math.ceil((pair.until - now) / 1000));
}

// --- checking ----------------------------------------------------------------

/**
 * `validateLights` (against the draft map) as the problem panel's items:
 * each one naming a fixture selects it; the rest open the 💡 Lights tab.
 */
export function lightProblemList(lights: LightsConfig, house: HouseMap): { errors: Problem[]; warnings: Problem[] } {
  const v = validateLights(lights, house);
  const sel = (text: string): Problem["sel"] => {
    const m = /^fixtures\[\d+\] "([^"]*)"/.exec(text) ?? /^fixture "([^"]*)" is in no look/.exec(text);
    return m !== null && lightById(lights, m[1]!) !== undefined ? { kind: "light", id: m[1]! } : null;
  };
  const item = (level: Problem["level"]) => (text: string): Problem => {
    const s = sel(text);
    return { text: `💡 ${text}`, sel: s, level, ...(s === null ? { tab: "lights" as const } : {}) };
  };
  // An unpicked device reads as what to do, not as a schema line.
  const friendly = (t: string): string => t.replace(/\.device must name the Zigbee2MQTT device \/ group or the WLED topic$/, ": pick its device (💡 Lights → Devices, or type the name)");
  return { errors: v.problems.map(friendly).map(item("error")), warnings: v.warnings.map(item("warning")) };
}

/** The Download JSON button's file. */
export function lightsDownload(lights: LightsConfig): { name: string; text: string } {
  return { name: "lights.json", text: `${JSON.stringify(lights, null, 2)}\n` };
}

/** Two configs are the same document (dirty check). */
export function sameLights(a: LightsConfig | null, b: LightsConfig | null): boolean {
  return a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));
}

/** The undo history after another director's lights save was adopted
 *  (`rebaseHistory`'s twin: the map's and the speakers' steps stay). */
export function rebaseLightsHistory<D extends { house: HouseMap; lights: LightsConfig }>(h: History<D>, present: D, lights: LightsConfig): History<D> {
  return rebaseField(h, present, "lights", lights);
}

// --- saving ------------------------------------------------------------------

/** How the lights can be saved now: alone (valid against the saved map), or
 *  with the map (valid against a draft map that can itself be saved). */
export interface LightSave {
  alone: boolean;
  withMap: boolean;
  why: string | null;
}

export function lightSavePlan(o: { lightsDirty: boolean; status: "loading" | "ok" | "missing" | "error"; mapDirty: boolean; mapSaveable: boolean; validDraft: boolean; validSaved: boolean }): LightSave {
  const no = (why: string | null): LightSave => ({ alone: false, withMap: false, why });
  if (!o.lightsDirty) return no(null);
  if (o.status === "missing") return no("this server can't store lights (it predates wave 20) — Download JSON keeps them");
  if (o.status === "loading") return no("the lights are still loading");
  if (o.status !== "ok") return no("the lights config is out of reach right now");
  const alone = o.validSaved;
  const withMap = o.mapDirty && o.mapSaveable && o.validDraft;
  if (alone || withMap) return { alone, withMap, why: null };
  return no(o.mapDirty && o.validDraft ? "a light hangs where only the draft map has a room, and the map can't be saved yet — fix the map first" : "fix the light problems first");
}

/** The toolbar's 💾: the map when it changed and can be saved, then each
 *  of the speakers and the lights when they can follow it. */
export function saveEverythingPlan(o: { mapDirty: boolean; mapSaveable: boolean; speakers: { alone: boolean; withMap: boolean }; lights: LightSave }): { map: boolean; speakers: boolean; lights: boolean } {
  const map = o.mapDirty && o.mapSaveable;
  return { map, speakers: map ? o.speakers.withMap : o.speakers.alone, lights: map ? o.lights.withMap : o.lights.alone };
}

/** The floor a fixture is on, by id (the floor tabs follow a picked light). */
export function lightFloorById(house: HouseMap, lights: LightsConfig | null | undefined, id: string): string {
  const f = lights?.fixtures.find((x) => x.id === id);
  return f === undefined ? "" : lightFloor(house, f);
}

/** The height band a fixture in `room` may hang in (the validator's). */
export function heightBand(house: HouseMap, room: Room): [number, number] {
  const floors = [...house.floors].sort((a, b) => a.elevation - b.elevation);
  const k = floors.findIndex((f) => f.id === room.floor);
  const here = floorById(house, room.floor);
  if (k < 0 || here === undefined) return [-Infinity, Infinity];
  return [round(here.elevation), round(k + 1 < floors.length ? floors[k + 1]!.elevation : here.elevation + 4)];
}

/**
 * Hang a fixture in another room (the inspector's room picker): at that
 * room's middle; on the same floor its height is kept, on another floor it
 * is hung `LIGHT_HEIGHT` above that floor.
 */
export function moveLightToRoom(lights: LightsConfig, house: HouseMap, id: string, roomId: string): LightsConfig {
  const f = lightById(lights, id);
  const room = roomById(house, roomId);
  if (f === undefined || room === undefined || f.room === roomId) return lights;
  const p = labelSpot(room.poly);
  const sameFloor = lightFloor(house, f) === room.floor;
  return withLight(lights, id, (n) => {
    n.pos = { x: round(p[0]), y: sameFloor ? n.pos.y : defaultLightY(house, room), z: round(p[1]) };
    n.room = room.id;
    n.floor = room.floor;
  });
}

/** Can a fixture be tested now: the server holds it with the same device and kind? */
export function testable(saved: LightsConfig | null, now: LightFixture): boolean {
  const s = saved?.fixtures.find((f) => f.id === now.id);
  return s !== undefined && s.device === now.device && s.device !== "" && s.kind === now.kind;
}
