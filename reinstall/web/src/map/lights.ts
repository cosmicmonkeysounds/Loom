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
  LIGHT_KINDS,
  LIGHT_SAFETY_MIN,
  LIGHTS_EVERYWHERE,
  LIGHT_PRESENCE_RADIUS_M,
  LIGHT_PRESENCE_RADIUS_MAX,
  LIGHT_PRESENCE_RADIUS_MIN,
  cloneData,
  presenceSettings,
  defaultLights,
  distanceToBoundary,
  floorById,
  foldTarget,
  lookTargets,
  pointInPoly,
  resolveLightTargets,
  roomAt,
  roomById,
  roomElevation,
  safetyMin,
  validateLights,
} from "@loom/house";
import type { HouseMap, LightCaps, LightFixture, LightKind, LightLook, LightPresence, LightPresenceEffect, LightPresenceSettings, LightState, LightsConfig, Room, Vec2 } from "@loom/house";
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

/**
 * Devices that are always a safety light, with the floor each gets (Z2M
 * brightness 0–254). The server room's RGB bulb `server_room_rgb` is that
 * room's only light (Q6 / Q10: no strip), so it is the room's safety light,
 * at 80: a fixture given one of these — typed, or picked from the
 * Zigbee2MQTT list — is marked safety with at least that floor.
 */
export const SAFETY_DEVICES: Readonly<Record<string, number>> = { server_room_rgb: 80 };

/** The safety patch for a device in SAFETY_DEVICES (never lowering a higher `min`), else nothing. */
function safetyFor(lights: LightsConfig, id: string, device: string): { safety?: true; min?: number } {
  const floor = SAFETY_DEVICES[device.trim().toLowerCase()];
  if (floor === undefined) return {};
  const own = lightById(lights, id)?.min;
  return { safety: true, min: Math.max(floor, typeof own === "number" && Number.isFinite(own) ? own : 0) };
}

/** The confirm before a safety light stops being one. */
export function safetyOffText(f: Pick<LightFixture, "name">): string {
  return `Turn off safety for ${f.name}? Its looks could then turn it off or dim it below ${LIGHT_SAFETY_MIN}.`;
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
    return patchLight(lights, id, { device: name, ...safetyFor(lights, id, name), ...(wled ? { kind: "wled" as const } : lightById(lights, id)?.kind === "wled" ? { kind: "zigbee" as const } : {}) });
  }
  return patchLight(lights, id, { device: device.friendly, kind: deviceKind(device), ...safetyFor(lights, id, device.friendly), ...(device.caps !== null ? { caps: { ...device.caps } } : {}) });
}

/** Swap a target name everywhere a look (or one of its steps) names it. */
function retarget(l: LightsConfig, from: string, to: string | null): void {
  const f = foldTarget(from);
  const fix = (list: string[]): string[] => [...new Set(list.flatMap((t) => (foldTarget(t) === f ? (to === null ? [] : [to]) : [t])))];
  for (const look of Object.values(l.looks)) {
    if (Array.isArray(look.to)) look.to = fix(look.to);
    for (const s of Array.isArray(look.steps) ? look.steps : []) {
      if (!Array.isArray(s.to) || s.to.length === 0) continue;
      s.to = fix(s.to);
      // A step left naming nothing falls back to the look's own targets.
      if (s.to.length === 0) delete s.to;
    }
  }
  // (wave 39) The presence targets follow too.
  const pr = l.presence;
  if (isObj(pr) && Array.isArray(pr.to)) pr.to = fix(pr.to);
}

/**
 * (wave 39) Edit `presence` (which fixtures a program in the games pulses).
 * A field set to its default is dropped (`to: ["everywhere"]`, `radius`
 * 1.6, `effect: "breathe"`, `enabled: true`), and the block with it once it
 * is empty: an absent block is presence on with the defaults. A radius is
 * clamped to 0.5–5 m.
 */
export function setLightPresence(lights: LightsConfig, patch: { enabled?: boolean; to?: string[]; radius?: number | null; effect?: LightPresenceEffect }): LightsConfig {
  const was = presenceSettings(lights);
  const want: LightPresenceSettings = {
    enabled: patch.enabled ?? was.enabled,
    to: patch.to ?? was.to,
    radius: patch.radius === null ? LIGHT_PRESENCE_RADIUS_M : patch.radius !== undefined && Number.isFinite(patch.radius) ? Math.round(Math.max(LIGHT_PRESENCE_RADIUS_MIN, Math.min(LIGHT_PRESENCE_RADIUS_MAX, patch.radius)) * 100) / 100 : was.radius,
    effect: patch.effect ?? was.effect,
  };
  const block: LightPresence = {};
  if (!want.enabled) block.enabled = false;
  if (!(want.to.length === 1 && foldTarget(want.to[0]!) === LIGHTS_EVERYWHERE)) block.to = [...want.to];
  if (want.radius !== LIGHT_PRESENCE_RADIUS_M) block.radius = want.radius;
  if (want.effect !== "breathe") block.effect = want.effect;
  const next = clone(lights);
  if (Object.keys(block).length === 0) delete next.presence;
  else next.presence = block;
  return JSON.stringify(next.presence ?? null) === JSON.stringify(lights.presence ?? null) ? lights : next;
}

/** The looks a delete leaves lighting nothing: they named something before and resolve to no fixture after. */
export function emptiedLooks(before: LightsConfig, after: LightsConfig, house: HouseMap | null): string[] {
  const reach = (l: LightsConfig, look: LightLook): number => resolveLightTargets(l, house, lookTargets(look)).fixtures.length;
  return Object.keys(after.looks)
    .filter((n) => before.looks[n] !== undefined && reach(before, before.looks[n]!) > 0 && reach(after, after.looks[n]!) === 0)
    .sort();
}

/** The confirm before deleting a fixture or zone (null: nothing to ask): a safety light, or looks left lighting nothing. */
export function removeLightConfirm(lights: LightsConfig, house: HouseMap | null, id: string): string | null {
  const f = lightById(lights, id);
  const z = lights.zones.find((x) => x.id === id);
  if (f === undefined && z === undefined) return null;
  const after = f !== undefined ? removeLight(lights, id) : removeLightZone(lights, id);
  const empty = emptiedLooks(lights, after, house);
  const why = [
    f?.safety === true ? "It is a safety light (never dark)." : null,
    empty.length > 0 ? `${empty.length === 1 ? "The look" : `${empty.length} looks`} ${empty.join(", ")} would light nothing.` : null,
  ].filter((x): x is string => x !== null);
  return why.length === 0 ? null : `Delete ${f !== undefined ? f.name : `zone ${z!.name}`}? ${why.join(" ")}`;
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

/** The confirm before opening a pairing window: any reset Zigbee device nearby joins the house network. */
export function pairConfirmText(seconds: number): string {
  return `Open pairing for ${seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} s`}? Any Zigbee device reset nearby joins the house network. Only pair when you are adding a bulb, never while the doors are open.`;
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
export function lightProblemList(lights: LightsConfig, house: HouseMap, opts: { saved?: LightsConfig | null; storyLooks?: readonly string[] } = {}): { errors: Problem[]; warnings: Problem[] } {
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
  // A light saved as a safety light that the draft no longer keeps safe.
  const lost: Problem[] = [];
  for (const f of opts.saved?.fixtures ?? []) {
    if (f.safety !== true) continue;
    const now = lightById(lights, f.id);
    if (now === undefined) lost.push({ text: `💡 safety light "${f.id}" (${f.name}) is deleted in this draft — saved, nothing keeps that room lit`, sel: null, level: "warning", tab: "lights" });
    else if (now.safety !== true) lost.push({ text: `💡 "${f.id}" is no longer a safety light (it was saved as one): its looks may turn it off or below ${LIGHT_SAFETY_MIN}`, sel: { kind: "light", id: f.id }, level: "warning" });
  }
  // A look the story cues that lights nothing goes dark on show night: an error, not a warning.
  const dark: Problem[] = [...new Set(opts.storyLooks ?? [])]
    .filter((n) => lights.looks[n] !== undefined && resolveLightTargets(lights, house, lookTargets(lights.looks[n]!)).fixtures.length === 0)
    .sort()
    .map((n) => ({ text: `💡 look "${n}" is cued by the story but lights nothing — give it a light or a zone`, sel: null, level: "error" as const, tab: "lights" as const }));
  return { errors: [...dark, ...v.problems.map(friendly).map(item("error"))], warnings: [...lost, ...v.warnings.map(item("warning"))] };
}

/**
 * A lights view the long poll brought while this page's save was in flight
 * (the poll's cursor moved past it, so it never comes again): offered once
 * the save settles unless it is the version the page now holds (its own save
 * echoed back). Adopting it shows the "changed" banner, or takes it when
 * the page is clean.
 */
export function stashedLightsView<V extends { version: string }>(stash: V | null, holding: string | null): V | null {
  return stash !== null && stash.version !== holding ? stash : null;
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
