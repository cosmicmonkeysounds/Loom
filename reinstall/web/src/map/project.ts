//! The map page's project bar, its logic (`ProjectBar.tsx` renders it):
//! the whole-map variants a director toggles between (the tent ↔ shed
//! switch, SW-MAP-13), "Save to project" (SW-MAP-01) and "Download JSON".
//! Pure, so the decisions are unit-tested; the component only wires them
//! to the server (`api.ts`) and the DOM.

import type { HouseMap, HouseSource, MapVariant, MapVariantsResponse } from "@loom/house";
import type { MapReply } from "../api.ts";

/** The default variant's file (the server's `DEFAULT_MAP_FILE`). */
export const DEFAULT_MAP_FILE = "house.json";

/** A project map file's name: `house.json` or `house.<variant>.json` (the
 *  server's `isMapFile`). */
const MAP_FILE = /^house(\.[A-Za-z0-9_-]{1,40})?\.json$/;

/** Words a variant label is never made of (the names of the variants of
 *  one house share most of their words; these say nothing either way). */
const FILLER = new Set(["the", "and", "for", "with", "until", "not", "yet", "but", "its", "house", "map", "layout", "variant", "version", "copy"]);

const wordsOf = (name: string): Set<string> => new Set(name.toLowerCase().match(/[a-z][a-z0-9]*/g) ?? []);

/** `shed` → "Shed", `rain_night` → "Rain night". */
const titleOf = (word: string): string => {
  const w = word.replace(/[_-]+/g, " ").trim();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
};

/**
 * A variant button's label, in a director's words. `house.shed.json` →
 * "Shed": the file names the variant, so the map's own `variant` field (the
 * server's `label`) is used only when it says the same word ("Shed (rain)")
 * — a shed made from a copy of the tent map still saying "Tent" reads
 * "Shed". The default `house.json` → its `variant` unless another file is
 * named for that word; else the one word only its map's name has
 * among the variants (the show's tent map is "… the Internet in the tent)"
 * against the shed's "… the Internet in the shed)" → "Tent"), else "Main".
 * A show sibling not named like a project map keeps its file's stem.
 */
export function variantLabel(v: MapVariant, all: readonly MapVariant[] = []): string {
  const given = v.label?.trim() ?? "";
  const m = MAP_FILE.exec(v.file);
  if (m === null) return given || v.file.replace(/\.json$/i, "");
  if (m[1] !== undefined) {
    const own = wordsOf(given);
    return given && [...wordsOf(m[1].slice(1))].every((w) => own.has(w)) ? given : titleOf(m[1].slice(1));
  }
  const others = all.filter((o) => o.file !== v.file);
  const fileWords = new Set(others.flatMap((o) => [...wordsOf(MAP_FILE.exec(o.file)?.[1]?.slice(1) ?? "")]));
  if (given && ![...wordsOf(given)].some((w) => fileWords.has(w))) return given;
  if (v.ok && others.length > 0) {
    const theirs = new Set<string>();
    for (const o of others) {
      for (const w of wordsOf(o.name)) theirs.add(w);
      const sfx = MAP_FILE.exec(o.file)?.[1];
      if (sfx !== undefined) for (const w of wordsOf(sfx.slice(1))) theirs.add(w);
    }
    const own = [...wordsOf(v.name)].filter((w) => w.length >= 3 && !FILLER.has(w) && !theirs.has(w));
    if (own.length === 1) return titleOf(own[0]!);
  }
  return "Main";
}

/** A variant button's tooltip: its file and the map's own name, or why it can't be played. */
export function variantTitle(v: MapVariant): string {
  if (!v.ok) return `${v.file} does not validate:\n${v.problems.slice(0, 5).join("\n")}${v.problems.length > 5 ? `\n… ${v.problems.length - 5} more` : ""}`;
  return v.active ? `${v.file} — ${v.name} (playing now)` : `Play ${v.file} — ${v.name}`;
}

/** "Tent (house.json)" — what the status line and the confirms call a variant. */
export function variantName(v: MapVariant, all: readonly MapVariant[] = []): string {
  const label = variantLabel(v, all);
  return label === v.file ? label : `${label} (${v.file})`;
}

/** The variant the event plays now (null before the list loads, or with none). */
export function activeOf(r: MapVariantsResponse | null): MapVariant | null {
  return r?.variants.find((v) => v.active) ?? null;
}

/**
 * What to ask before switching to `to` — null when nothing is at stake.
 * Programs mid-game keep playing (one standing where the new map has no
 * floor is put back at its spawn), but their duck may move; a director's
 * unsaved save is dropped by the switch (it is an edit of the old variant).
 */
export function switchConfirm(to: MapVariant, state: { players: number; edited: boolean; dirty?: boolean; all?: readonly MapVariant[] }): string | null {
  const lines: string[] = [];
  const name = variantName(to, state.all ?? []);
  if (state.players > 0) {
    lines.push(
      `${state.players === 1 ? "1 program is" : `${state.players} programs are`} in the simulation now. They keep playing on ${name} from where they stand; anyone standing where ${name} has no floor (inside what is a solid prop there, like the shed on the tent map) goes back to its start. A duck whose spot is not on it is dealt a new one.`,
    );
  }
  if (state.edited) lines.push("The map edits saved to this event (not to the project) are dropped. Save to project first to keep them.");
  if (state.dirty === true) lines.push("Your unsaved edits on this page are dropped too.");
  return lines.length === 0 ? null : `Switch the house map to ${name}?\n\n${lines.join("\n\n")}`;
}

/**
 * Before a switch drops a director's save (this event's map edits, which
 * are not in the project): the offer to save them to the project first
 * (W-22). Null when nothing would be lost or there is no project to keep
 * them in. OK saves; Cancel goes on to `switchConfirm`'s warning.
 */
export function switchSaveOffer(r: MapVariantsResponse | null, to: MapVariant, dirty = false): string | null {
  if (r === null || !r.edited || !r.project) return null;
  const draft = dirty ? " (not the unsaved edits on this page)" : "";
  return `This event's map has edits that are not in the project. Save them to the project as ${saveTarget(r)} before switching to ${variantName(to, r.variants)}${draft}?\n\nOK saves them first. Cancel goes on without saving — you can still back out.`;
}

/** How a switch asks and saves (`ProjectBar` wires the DOM and the server). */
export interface SwitchSteps {
  confirm: (message: string) => boolean;
  /** Save the event's map to the project as `file` from `base`: the version
   *  it leaves, null when the save failed (the bar says why). */
  save: (file: string, base: string | null) => Promise<string | null>;
}

/**
 * A switch's questions, in order: the offer to save a director's save to
 * the project first (`switchSaveOffer`), then `switchConfirm` — its
 * "dropped" line only when the save was turned down. Resolves to the `base`
 * the switch posts (the save's version when it saved), or null = stop:
 * cancelled, or the save failed (never switch over a save that didn't land).
 *
 * The base is the version the list `r` was drawn against (the server's
 * `version`), not the page's: a page holding a draft never reloads, so its
 * own version is stale after a switch made elsewhere, and posting it would
 * 409 every time (B18). The director confirmed against the list, so the
 * list is the race guard — a save or switch it hasn't seen still 409s. An
 * older server's list has no version: the page's is used.
 */
export async function planSwitch(
  to: MapVariant,
  r: MapVariantsResponse | null,
  state: { players: number; dirty: boolean; version: string | null },
  steps: SwitchSteps,
): Promise<{ base: string | null } | null> {
  let base = r?.version ?? state.version;
  let edited = r?.edited ?? false;
  const offer = switchSaveOffer(r, to, state.dirty);
  if (offer !== null && steps.confirm(offer)) {
    const saved = await steps.save(saveTarget(r), base);
    if (saved === null) return null;
    base = saved;
    edited = false;
  }
  const ask = switchConfirm(to, { players: state.players, edited, dirty: state.dirty, all: r?.variants ?? [] });
  if (ask !== null && !steps.confirm(ask)) return null;
  return { base };
}

/**
 * What a press on a variant's button means, against the list it was drawn
 * from. A press on the one the list calls live refetches the list first:
 * it may be stale (a switch made on another page while this one held a
 * draft, so its version never moved), and doing nothing would leave the
 * director unable to switch back. Resolves to the variant and the list to
 * switch with (`live`: it really is playing, nothing to do), or null.
 */
export async function pressTarget(
  file: string,
  list: MapVariantsResponse | null,
  busy: boolean,
  refetch: () => Promise<MapVariantsResponse | null>,
): Promise<{ v: MapVariant; list: MapVariantsResponse | null; live: boolean } | null> {
  if (busy) return null;
  const v = list?.variants.find((x) => x.file === file);
  if (v === undefined) return null;
  if (!v.active) return { v, list, live: false };
  const fresh = await refetch();
  const now = fresh?.variants.find((x) => x.file === file);
  return now === undefined ? null : { v: now, list: fresh, live: now.active };
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
export function saveConfirm(file: string, dirty: boolean, draftSaves = false): string | null {
  // A valid draft is saved to the event on the way (the bar's `saveDraft`).
  if (!dirty || draftSaves) return null;
  return `Your unsaved edits are not part of it (they don't pass the checks yet): this saves the event's current map to the project as ${file}. Fix and save the edits first to include them.\n\nSave anyway?`;
}

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
export function statusOf(r: MapReply<{ file: string }>, action: "switch" | "save", label?: string): BarStatus {
  if (r.ok) {
    const file = r.result.file;
    const what = label !== undefined && label !== file ? `${label} (${file})` : file;
    return { kind: "ok", text: action === "switch" ? `Playing ${what}` : `Saved to the project as ${file}` };
  }
  if (r.conflict) return { kind: "error", text: "The map changed since this page loaded it — reload, then try again." };
  const first = r.problems[0];
  return { kind: "error", text: first !== undefined ? `${r.error}: ${first}${r.problems.length > 1 ? ` (+${r.problems.length - 1} more)` : ""}` : r.error };
}
