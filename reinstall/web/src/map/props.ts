//! Placing and turning things on the map — pure: new props from a palette
//! (a sensible size and colour per kind; the King with the show's
//! defaults), a prop's fields, duplicating, turning by a step, the King's
//! guarded door, a terminal snapped onto its room's nearest wall, and the
//! terminal provisioning link's enums. Every op returns a changed copy.

import { HEART_SIGNAL, MODEL_KINDS, PICKUP_SIGNAL, PROP_MODELS, PROP_SIGNAL_KEYS, cloneData, propModel, distanceToSegment, pointInPoly, roomAt, roomById, roomElevation, wrapYaw, yawToward } from "@loom/house";
import type { HouseMap, ModelGroup, Prop, PropKind, PropModel, Vec2 } from "@loom/house";
import { round } from "./doors.ts";
import { moveTo, positionOf, setYaw, yawOf, type Selection } from "./edit.ts";
import { uniqueId } from "./ids.ts";

/** Every prop kind, in the palette's order. */
export const PROP_KINDS: readonly PropKind[] = ["box", "cylinder", "screen", "label", "king", "heart", "pickup"];

/** The palette's buttons. */
export const PROP_PALETTE: { kind: PropKind; label: string }[] = [
  { kind: "box", label: "▦ Box" },
  { kind: "cylinder", label: "◯ Cylinder" },
  { kind: "screen", label: "▭ Screen" },
  { kind: "label", label: "✎ Label" },
  { kind: "king", label: "♔ King" },
  { kind: "heart", label: "♥ Heart" },
  { kind: "pickup", label: "💾 Pickup" },
];

/** A new pickup's item (the show's one: the virus disk). */
export const DEFAULT_PICKUP_ITEM = "virus";

/** The rotate handle's step (Shift: 1°), and R / ⇧R. */
export const YAW_STEP = 15;

/** A new prop of each kind, before it is placed. */
export function propDefaults(kind: PropKind): Omit<Prop, "id" | "room" | "pos"> {
  switch (kind) {
    case "box":
      return { kind, size: [0.6, 0.75, 0.6], color: "#8a7a66" };
    case "cylinder":
      return { kind, size: [0.5, 0.9, 0.5], color: "#7a8a99" };
    case "screen":
      return { kind, size: [0.6, 0.4, 0.03], color: "#202830" };
    case "label":
      return { kind, size: [1, 0.25, 0.02], label: "LABEL" };
    case "king":
      return {
        kind,
        size: [0.6, 1.9, 0.6],
        color: "#d4af37",
        label: "THE KING",
        hp: 15,
        health: "Night.king_hp",
        signals: { won: "chess won", lost: "chess lost", drawn: "chess drawn", hit: "king hit", fallen: "king fallen" },
        armed: { path: "Night.king_armed", min: 1 },
      };
    case "heart":
      // Trabolta's heart (wave 26): a dark rack, no label (an old game would draw it).
      return { kind, size: [0.6, 1.7, 0.6], color: "#141418" };
    case "pickup":
      // A pickup (wave 26): drawn as a floppy disk in the games only; no label.
      return { kind, size: [0.3, 0.3, 0.3], item: DEFAULT_PICKUP_ITEM };
  }
}

/**
 * Place a new prop of `kind` at a plan point on `floor` (on the floor
 * surface, facing north). Null when the point is in no room on that floor.
 */
export function addProp(house: HouseMap, kind: PropKind, floor: string, at: Vec2): { house: HouseMap; id: string } | null {
  const room = roomAt(house, at, floor);
  if (room === null) return null;
  const next = cloneData(house);
  const id = uniqueId(kind === "king" ? "king" : kind, next.props.map((p) => p.id));
  const d = propDefaults(kind);
  next.props.push({ id, room: room.id, ...d, pos: [round(at[0]), roomElevation(next, room), round(at[1])] } as Prop);
  return { house: next, id };
}

/** (wave 47) A model armed for the next click: `model:<id>` (`Placing`). */
export type ModelPlacing = `model:${string}`;
export const MODEL_PLACING_PREFIX = "model:";

export function modelPlacing(id: string): ModelPlacing {
  return `model:${id}`;
}

/** The model a placing names, or null (a plain kind, a speaker, a light, an unknown model). */
export function placingModel(placing: string | null): PropModel | null {
  return placing !== null && placing.startsWith(MODEL_PLACING_PREFIX) ? propModel(placing.slice(MODEL_PLACING_PREFIX.length)) : null;
}

/** What the plan's hint calls a placing ("box", "Server rack"). */
export function placingLabel(placing: string): string {
  return placingModel(placing)?.label ?? placing;
}

/** The model picker's groups, in order. */
export const MODEL_GROUP_LABELS: Record<ModelGroup, string> = { structure: "Structure", computer: "Computer", office: "Office" };

export function modelGroups(): { group: ModelGroup; label: string; models: PropModel[] }[] {
  return (Object.keys(MODEL_GROUP_LABELS) as ModelGroup[]).map((group) => ({ group, label: MODEL_GROUP_LABELS[group], models: PROP_MODELS.filter((m) => m.group === group) }));
}

/**
 * (wave 47) Place a new prop drawn as model `modelId` at a plan point on
 * `floor`: the model's kind and size, no colour (the model's clean white),
 * facing north. Null when the point is in no room or the model is unknown.
 */
export function addModelProp(house: HouseMap, modelId: string, floor: string, at: Vec2): { house: HouseMap; id: string } | null {
  const m = propModel(modelId);
  const room = roomAt(house, at, floor);
  if (m === null || room === null) return null;
  const next = cloneData(house);
  const id = uniqueId(m.id, next.props.map((p) => p.id));
  next.props.push({ id, room: room.id, kind: m.kind, model: m.id, pos: [round(at[0]), roomElevation(next, room), round(at[1])], size: [...m.size] });
  return { house: next, id };
}

/** Whether a prop of this kind can carry a model. */
export function takesModel(kind: PropKind): boolean {
  return MODEL_KINDS.includes(kind);
}

/** The fields the inspector edits (`undefined` clears an optional one).
 *  `signal` is a heart's `signals.reached` / a pickup's `signals.taken`
 *  (`undefined` or blank: the kind's default). */
export type PropPatch = Partial<Pick<Prop, "kind" | "size" | "color" | "label" | "solid" | "hp" | "item" | "model" | "neon">> & { signal?: string };

/** The story signal a heart or a pickup posts (its own, else the default) — what the inspector shows. */
export function momentSignalOf(p: Prop): { key: "reached" | "taken"; own: string | undefined; fallback: string } | null {
  if (p.kind === "heart") return { key: "reached", own: p.signals?.reached, fallback: HEART_SIGNAL };
  if (p.kind === "pickup") return { key: "taken", own: p.signals?.taken, fallback: PICKUP_SIGNAL };
  return null;
}

/**
 * Set a prop's fields. A prop made a King gains the King's defaults for
 * what it lacks; a King made something else loses hp / health / armed and
 * the doors it guarded. A heart or a pickup never keeps a label; a pickup
 * always has an item (`DEFAULT_PICKUP_ITEM`) and nothing else does. The
 * `signals` keys a kind doesn't take are dropped on a kind change.
 */
export function patchProp(house: HouseMap, id: string, patch: PropPatch): HouseMap {
  if (!house.props.some((p) => p.id === id)) return house;
  const next = cloneData(house);
  const p = next.props.find((x) => x.id === id)!;
  const wasKing = p.kind === "king";
  const { signal, ...fields } = patch;
  Object.assign(p, fields);
  for (const k of ["color", "label", "solid", "hp", "item", "model", "neon"] as const) if (k in fields && (fields[k] === undefined || fields[k] === "")) delete p[k];
  // A model (and its neon) is drawn on a box or a cylinder only.
  if (!takesModel(p.kind)) {
    delete p.model;
    delete p.neon;
  }
  if (p.size.some((v) => !(v > 0))) return house;
  if (p.kind === "king" && !wasKing) {
    const d = propDefaults("king");
    p.hp ??= d.hp!;
    p.health ??= d.health!;
    p.signals ??= d.signals!;
    p.armed ??= d.armed!;
  } else if (p.kind !== "king" && wasKing) {
    delete p.hp;
    delete p.health;
    delete p.armed;
    for (const door of next.doors) if (door.guard === id) delete door.guard;
  }
  if (p.kind === "heart" || p.kind === "pickup") delete p.label;
  if (p.kind === "pickup") {
    if (typeof p.item !== "string" || p.item.trim() === "") p.item = DEFAULT_PICKUP_ITEM;
  } else delete p.item;
  if ("signal" in patch) {
    const m = momentSignalOf(p);
    if (m !== null) {
      const v = signal?.trim();
      if (v === undefined || v === "" || v === m.fallback) {
        if (p.signals) delete p.signals[m.key];
      } else p.signals = { ...(p.signals ?? {}), [m.key]: v };
    }
  }
  if (p.signals !== undefined) {
    const allowed = PROP_SIGNAL_KEYS[p.kind] ?? [];
    for (const k of Object.keys(p.signals) as (keyof NonNullable<Prop["signals"]>)[]) if (!allowed.includes(k)) delete p.signals[k];
    if (Object.keys(p.signals).length === 0) delete p.signals;
  }
  if (p.kind === "king" && !wasKing && p.signals === undefined) p.signals = propDefaults("king").signals!;
  if (p.hp !== undefined) p.hp = Math.max(1, Math.min(99, Math.round(p.hp)));
  return next;
}

/** Put a placed thing back on its room's floor surface (y = the floor's elevation). */
export function onFloor(house: HouseMap, sel: Selection): HouseMap {
  const pos = positionOf(house, sel);
  if (pos === null) return house;
  const roomId = sel.kind === "spawn" ? house.spawn.room : sel.kind === "prop" ? house.props.find((p) => p.id === sel.id)?.room : sel.kind === "duck" ? house.duck.spots.find((d) => d.id === sel.id)?.room : house.terminals.find((t) => sel.kind === "terminal" && t.id === sel.id)?.room;
  const room = roomId === undefined ? undefined : roomById(house, roomId);
  if (room === undefined) return house;
  const y = roomElevation(house, room);
  if (pos[1] === y) return house;
  const next = cloneData(house);
  positionOf(next, sel)![1] = y;
  return next;
}

/** Turn a thing by `delta` degrees from its yaw. */
export function rotateBy(house: HouseMap, sel: Selection, delta: number): HouseMap {
  const yaw = yawOf(house, sel);
  return yaw === null ? house : setYaw(house, sel, yaw + delta);
}

/** A yaw rounded to the nearest `step` degrees, wrapped into [−180, 180). */
export function snapYaw(yaw: number, step: number): number {
  return wrapYaw(Math.round(yaw / step) * step);
}

/**
 * A copy of the selected prop / terminal / duck spot, `offset` east and
 * south, with a fresh id (the spawn, rooms and the rest aren't copied).
 * The copy's room follows where it lands.
 */
export function duplicate(house: HouseMap, sel: Selection, offset: number): { house: HouseMap; sel: Selection } | null {
  let next: HouseMap;
  let copy: Selection;
  if (sel.kind === "prop") {
    const p = house.props.find((x) => x.id === sel.id);
    if (p === undefined) return null;
    next = cloneData(house);
    const id = uniqueId(baseOf(p.id), next.props.map((x) => x.id));
    next.props.push({ ...cloneData(p), id });
    copy = { kind: "prop", id };
  } else if (sel.kind === "terminal") {
    const t = house.terminals.find((x) => x.id === sel.id);
    if (t === undefined) return null;
    next = cloneData(house);
    const id = uniqueId(baseOf(t.id), next.terminals.map((x) => x.id));
    next.terminals.push({ ...cloneData(t), id, name: `${t.name} copy` });
    copy = { kind: "terminal", id };
  } else if (sel.kind === "duck") {
    const d = house.duck.spots.find((x) => x.id === sel.id);
    if (d === undefined) return null;
    next = cloneData(house);
    const id = uniqueId(baseOf(d.id), next.duck.spots.map((x) => x.id));
    next.duck.spots.push({ ...cloneData(d), id });
    copy = { kind: "duck", id };
  } else return null;
  const pos = positionOf(next, copy)!;
  return { house: moveTo(next, copy, [round(pos[0] + offset), round(pos[2] + offset)]), sel: copy };
}

/** `desk-2` → `desk` (so a copy of a copy is `desk-3`, not `desk-2-1`). */
function baseOf(id: string): string {
  return id.replace(/-\d+$/, "") || id;
}

/** The doors a King guards. */
export function guardedBy(house: HouseMap, kingId: string): string[] {
  return house.doors.filter((d) => d.guard === kingId).map((d) => d.id);
}

/** The doors a King can guard: those on his own room (a guard must stand
 *  in one of its door's rooms), plus any he guards now. */
export function guardableDoors(house: HouseMap, kingId: string): HouseMap["doors"] {
  const king = house.props.find((p) => p.id === kingId);
  if (king === undefined) return [];
  return house.doors.filter((d) => d.a === king.room || d.b === king.room || d.guard === kingId);
}

/** Make `doorId` the one door a King guards (null: none) — any other door
 *  it guarded is let go; a door another King guarded passes to this one. */
export function setGuard(house: HouseMap, kingId: string, doorId: string | null): HouseMap {
  if (!house.props.some((p) => p.id === kingId && p.kind === "king")) return house;
  if (doorId !== null && !house.doors.some((d) => d.id === doorId)) return house;
  const next = cloneData(house);
  for (const d of next.doors) {
    if (d.id === doorId) d.guard = kingId;
    else if (d.guard === kingId) delete d.guard;
  }
  return next;
}

/** How far into the room a snapped screen sits off the wall line. */
export const WALL_INSET = 0.03;
/** A terminal dropped this close to a wall goes onto it. */
export const WALL_SNAP = 0.4;

/**
 * Hang a terminal on the nearest wall of its room: its screen centre on
 * that edge, `WALL_INSET` into the room, facing straight into it (its
 * height kept). With `within`, only when that wall is that close. The map
 * unchanged when nothing qualifies.
 */
export function snapTerminalToWall(house: HouseMap, id: string, within = Infinity): HouseMap {
  const t = house.terminals.find((x) => x.id === id);
  const room = t === undefined ? undefined : roomById(house, t.room);
  if (t === undefined || room === undefined || room.poly.length < 3) return house;
  const p: Vec2 = [t.pos[0], t.pos[2]];
  let best: { d: number; a: Vec2; b: Vec2 } | null = null;
  for (let i = 0; i < room.poly.length; i++) {
    const a = room.poly[i]!;
    const b = room.poly[(i + 1) % room.poly.length]!;
    const d = distanceToSegment(p, a, b);
    if (best === null || d < best.d) best = { d, a, b };
  }
  if (best === null || best.d > within) return house;
  const { a, b } = best;
  const ex = b[0] - a[0];
  const ez = b[1] - a[1];
  const len = Math.hypot(ex, ez);
  if (len === 0) return house;
  // The foot on the edge, kept off the corners so the screen fits.
  const margin = Math.min(0.25, len / 2);
  const s = Math.max(margin, Math.min(len - margin, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / len));
  const foot: Vec2 = [a[0] + (ex / len) * s, a[1] + (ez / len) * s];
  // The normal that points into the room.
  let nx = -ez / len;
  let nz = ex / len;
  if (!pointInPoly(room.poly, [foot[0] + nx * 0.05, foot[1] + nz * 0.05])) {
    nx = -nx;
    nz = -nz;
  }
  const at: Vec2 = [round(foot[0] + nx * WALL_INSET), round(foot[1] + nz * WALL_INSET)];
  const yaw = Math.round(yawToward([at[0], 0, at[1]], [at[0] + nx, 0, at[1] + nz]) * 2) / 2;
  if (at[0] === t.pos[0] && at[1] === t.pos[2] && wrapYaw(yaw) === t.yaw) return house;
  const next = cloneData(house);
  const n = next.terminals.find((x) => x.id === id)!;
  n.pos = [at[0], n.pos[1], at[1]];
  n.yaw = wrapYaw(yaw) + 0;
  return next;
}

/** The terminal app's views (`terminal/src/config.ts` `TerminalView`). */
// The screen types live in `@loom/house` (`TerminalSpot.view`); the terminal app uses the same list.
export { TERMINAL_VIEWS } from "@loom/house";
export type { TerminalViewName } from "@loom/house";
import type { TerminalViewName } from "@loom/house";

/** What each view does, for the picker. */
export const TERMINAL_VIEW_HINTS: Record<TerminalViewName, string> = {
  auto: "auto — the world view where it can, else the face",
  world: "world — the virtual house through this window",
  face: "face — the character's face",
  mirror: "mirror — the spectator view",
  tv: "tv — the house TV",
  chess: "chess — the King's board (the Server Door)",
  shadow: "shadow — this terminal's camera with the players as ghosts",
  casino: "casino — Truthcoin bets on the coin, the dice and the slots",
  reinstall: "reinstall — the tent laptop: idle show + the reinstallation wizard",
};

/** The views that belong to no room (no `speaks`): the TV (its own room
 *  voice), the King's board, the casino and the tent laptop's
 *  reinstallation station (wave 18b: the Internet's lines are prisoners'
 *  own DMs, never spoken aloud) — as the terminal's `ROOMLESS_VIEWS`. */
export const ROOMLESS_TERMINAL_VIEWS: readonly TerminalViewName[] = ["tv", "chess", "casino", "reinstall"];

export function isRoomlessView(view: TerminalViewName): boolean {
  return ROOMLESS_TERMINAL_VIEWS.includes(view);
}

/** The story LOCATIONs the map's rooms stand for, for the room picker. */
export function mapLocations(house: HouseMap): string[] {
  return [...new Set(house.rooms.flatMap((r) => (r.location !== undefined && r.location !== "" ? [r.location] : [])))].sort((a, b) => a.localeCompare(b));
}
