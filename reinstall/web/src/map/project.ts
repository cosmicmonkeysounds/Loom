//! The map page's project bar, its logic (`ProjectBar.tsx` renders it):
//! the whole-map variants a director toggles between (the tent ↔ shed
//! switch, SW-MAP-13), "Save to project" (SW-MAP-01) and "Download JSON".
//! Pure, so the decisions are unit-tested; the component only wires them
//! to the server (`api.ts`) and the DOM.

import type { HouseMap, HouseSource, MapVariant, MapVariantsResponse } from "@loom/house";
import type { MapReply } from "../api.ts";

/** The default variant's file (the server's `DEFAULT_MAP_FILE`). */
export const DEFAULT_MAP_FILE = "house.json";

/** A variant button's label: the file, as the project names it. */
export function variantLabel(v: MapVariant): string {
  return v.file;
}

/** A variant button's tooltip: the map's own name, or why it can't be played. */
export function variantTitle(v: MapVariant): string {
  if (!v.ok) return `${v.file} does not validate:\n${v.problems.slice(0, 5).join("\n")}${v.problems.length > 5 ? `\n… ${v.problems.length - 5} more` : ""}`;
  return v.active ? `${v.name} (playing now)` : `Play ${v.name}`;
}

/** The variant the event plays now (null before the list loads, or with none). */
export function activeOf(r: MapVariantsResponse | null): MapVariant | null {
  return r?.variants.find((v) => v.active) ?? null;
}

/**
 * What to ask before switching to `to` — null when nothing is at stake.
 * Programs mid-game keep playing, but their duck may move; a director's
 * unsaved save is dropped by the switch (it is an edit of the old variant).
 */
export function switchConfirm(to: MapVariant, state: { players: number; edited: boolean }): string | null {
  const lines: string[] = [];
  if (state.players > 0) {
    lines.push(`${state.players === 1 ? "1 program is" : `${state.players} programs are`} in the simulation now. They keep playing on ${to.file}; a duck whose spot is not on it is dealt a new one.`);
  }
  if (state.edited) lines.push("The map edits saved to this event (not to the project) are dropped. Save to project first to keep them.");
  return lines.length === 0 ? null : `Switch the house map to ${to.file}?\n\n${lines.join("\n\n")}`;
}

/** Can the variant be switched to now? */
export function canSwitch(v: MapVariant, busy: boolean): boolean {
  return !busy && v.ok && !v.active;
}

/** "Save to project" is offered on an event that has a project, for a map
 *  the server serves (not the bundled stand-in, `version` null). */
export function canSaveToProject(r: MapVariantsResponse | null, version: string | null, busy: boolean): boolean {
  return r !== null && r.project && version !== null && !busy;
}

/** What "Save to project" asks first — a page with unsaved edits saves the
 *  *event's* map, not the draft on screen. Null: just save. */
export function saveConfirm(file: string, dirty: boolean): string | null {
  return dirty ? `Your unsaved edits are not part of it: this saves the event's current map to the project as ${file}. Save the edits first to include them.\n\nSave anyway?` : null;
}

/** A project map file's name: `house.json` or `house.<variant>.json` (the
 *  server's `isMapFile`). */
const MAP_FILE = /^house(\.[A-Za-z0-9_-]{1,40})?\.json$/;

/** The file "Save to project" writes: the active variant's — a show
 *  sibling's too, when the event has no project maps yet — else the
 *  default. The bar sends it explicitly, so what the director confirms is
 *  what is written (the server's `saveFileFor` picks the same by default). */
export function saveTarget(r: MapVariantsResponse | null): string {
  const file = activeOf(r)?.file;
  return file !== undefined && MAP_FILE.test(file) ? file : DEFAULT_MAP_FILE;
}

/** Where the map the page shows comes from, for its status line: a
 *  director's save on this event, a project file (the playing variant's
 *  name when known), the show's fallback file, or the bundled stand-in. */
export function sourceLabel(source: HouseSource | "bundled", r: MapVariantsResponse | null = null): string {
  switch (source) {
    case "event":
      return "this event's map";
    case "project": {
      const file = r?.from === "project" ? activeOf(r)?.file : undefined;
      return file !== undefined ? `the project's ${file}` : "the project's map";
    }
    case "show":
      return "the show's map";
    case "bundled":
      return "offline — the bundled show map";
  }
}

/** "Download JSON": the file name (the active variant's) and its text —
 *  two-space JSON with a trailing newline, like the committed show file. */
export function downloadOf(house: HouseMap, r: MapVariantsResponse | null): { name: string; text: string } {
  return { name: saveTarget(r), text: `${JSON.stringify(house, null, 2)}\n` };
}

/** The bar's status line after an action. */
export type BarStatus =
  | { kind: "idle" }
  | { kind: "busy"; what: string }
  | { kind: "ok"; text: string }
  | { kind: "error"; text: string };

/** What a switch's or a save's reply tells the director. */
export function statusOf(r: MapReply<{ file: string }>, action: "switch" | "save"): BarStatus {
  if (r.ok) return { kind: "ok", text: action === "switch" ? `Playing ${r.result.file}` : `Saved to the project as ${r.result.file}` };
  if (r.conflict) return { kind: "error", text: "The map changed since this page loaded it — reload, then try again." };
  const first = r.problems[0];
  return { kind: "error", text: first !== undefined ? `${r.error}: ${first}${r.problems.length > 1 ? ` (+${r.problems.length - 1} more)` : ""}` : r.error };
}
