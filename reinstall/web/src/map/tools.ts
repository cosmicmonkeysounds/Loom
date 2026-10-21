//! The map editor's shared vocabulary — pure: the drawing tools, how an
//! edit lands in the undo history, which floor a selection lives on, and
//! the context a toolbar extra (the project bar) is handed.

import { roomById } from "@loom/house";
import type { AudioConfig, HouseMap, PropKind } from "@loom/house";
import type { LoadedHouse } from "../api.ts";
import type { ReinstallConfig } from "../config.ts";
import { doorFloor } from "./doors.ts";
import type { Selection } from "./edit.ts";

/** `select`: click / drag what is there. The others draw (until Esc). */
export type Tool = "select" | "room" | "yard" | "door" | "stair";

export const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "select", label: "↖ Select", key: "v", hint: "Click to select, drag to move (V)" },
  { id: "room", label: "▭ Room", key: "r", hint: "Drag a rectangle for an indoor room (R)" },
  { id: "yard", label: "▒ Yard", key: "y", hint: "Drag a rectangle for an outdoor yard — no roof, fences (Y)" },
  { id: "door", label: "▯ Door", key: "d", hint: "Click a wall to put a door in it (D)" },
  { id: "stair", label: "▤ Stairs", key: "s", hint: "Drag the stair's rectangle on its lower floor (S)" },
];

/** What the next click on the plan places: a palette prop, or a 🔊 speaker. */
export type Placing = PropKind | "speaker";

/** `push`: a new undo step. `replace`: the running drag's next frame (its step was pushed when it started changing). */
export type EditMode = "push" | "replace";

/** The floor the selected thing is on ("" when unknown; a speaker needs its `audio`). */
export function floorOfSelection(house: HouseMap, sel: Selection, audio?: AudioConfig | null): string {
  const ofRoom = (id: string) => roomById(house, id)?.floor ?? "";
  switch (sel.kind) {
    case "terminal":
      return ofRoom(house.terminals.find((t) => t.id === sel.id)?.room ?? "");
    case "duck":
      return ofRoom(house.duck.spots.find((d) => d.id === sel.id)?.room ?? "");
    case "prop":
      return ofRoom(house.props.find((p) => p.id === sel.id)?.room ?? "");
    case "spawn":
      return ofRoom(house.spawn.room);
    case "room":
      return ofRoom(sel.id);
    case "door": {
      const d = house.doors.find((x) => x.id === sel.id);
      return d === undefined ? "" : doorFloor(house, d);
    }
    case "stair":
      return ofRoom(house.stairs.find((s) => s.id === sel.id)?.from ?? "");
    case "floor":
      return sel.id;
    case "speaker": {
      const s = audio?.speakers.find((x) => x.id === sel.id);
      return s === undefined ? "" : (roomById(house, s.room)?.floor ?? s.floor ?? "");
    }
  }
}

/** Whether a selection still names something in the map (or, for a speaker, in `audio`). */
export function selectionExists(house: HouseMap, sel: Selection, audio?: AudioConfig | null): boolean {
  switch (sel.kind) {
    case "terminal":
      return house.terminals.some((t) => t.id === sel.id);
    case "duck":
      return house.duck.spots.some((d) => d.id === sel.id);
    case "prop":
      return house.props.some((p) => p.id === sel.id);
    case "spawn":
      return true;
    case "room":
      return house.rooms.some((r) => r.id === sel.id);
    case "door":
      return house.doors.some((d) => d.id === sel.id);
    case "stair":
      return house.stairs.some((s) => s.id === sel.id);
    case "floor":
      return house.floors.some((f) => f.id === sel.id);
    case "speaker":
      return audio?.speakers.some((s) => s.id === sel.id) ?? false;
  }
}

/**
 * What a toolbar extra gets — the slot the project bar (variant switch,
 * Save to project, Download JSON) plugs into: `MapApp`'s `toolbarExtras`.
 */
export interface MapToolbarContext {
  /** The draft on screen. */
  house: HouseMap;
  /** The map as last loaded / saved. */
  saved: HouseMap | null;
  loaded: LoadedHouse;
  config: ReinstallConfig;
  /** The event's API base (`baseOf(config)`). */
  base: string;
  /** Programs in the simulation now. */
  players: number;
  /** The map version the server last announced on the spatial stream (a
   *  save or a variant switch anywhere): ahead of `loaded` while a dirty page
   *  only warns, so the project bar refetches its variant list on it. */
  remoteVersion: string | null;
  /** The draft differs from `saved` (or the JSON tab holds unparsed text). */
  dirty: boolean;
  /** The draft can be saved: `validateHouse` passes, the JSON tab parses, the map is the server's (not the bundled stand-in). */
  valid: boolean;
  /** Replace the draft as one undoable edit (a variant loaded from the project, an imported file). */
  adopt: (next: HouseMap) => void;
  /** Reload the event's map from the server, dropping the draft. */
  reload: () => Promise<void>;
  /** Save the draft to the event, like 💾 Save: the new version, null when refused. */
  save: () => Promise<string | null>;
  /** Ask for the moderator passcode before the page's first write (W-15): false = cancelled, don't write. */
  unlock: () => Promise<boolean>;
}

/** A number field's text: a number, `null` for an empty field, `undefined` for something that isn't one. */
export function parseNum(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const v = Number(text);
  return Number.isFinite(v) ? v : undefined;
}

/**
 * Whether a number field's `input` event is a step (its spinner, ↑ / ↓ —
 * a whole value, safe to apply at once) rather than typing (an
 * `InputEvent` with an `inputType`: the field may hold a prefix of the
 * number being typed, so it waits for Enter / blur).
 */
export function isStep(ev: Event): boolean {
  return !("inputType" in ev) || (ev as InputEvent).inputType === "";
}

/**
 * Whether a text field leaving the page still has to land what was typed:
 * not when it shows the value, and not when Enter / blur already committed
 * this very text (a speaker's id rename re-keys its inspector, and the
 * leaving field would apply the rename a second time, as a second undo step).
 */
export function commitPending(text: string, value: string, committed: string | null): boolean {
  return text !== value && text !== committed;
}
