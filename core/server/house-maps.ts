//! A project's house maps (SW-MAP-01, the tent ↔ shed switch SW-MAP-13;
//! `docs/loom-reinstall.md` §1.3).
//!
//! The map belongs to the project: `house.json` (the default variant) and
//! any `house.<variant>.json` (e.g. `house.shed.json`) are ordinary
//! `project_file`s next to the `.loom` story. A launch snapshots them like
//! `scenario_source`, so an event plays a fixed map, and a relaunch (or a
//! reload) picks up the project's current one. Every variant is a whole,
//! separately validated map; the server stays show-agnostic — a variant is
//! labelled by its file name (and the map's own `name`).
//!
//! An event with no project map files (the LAN default event, an old
//! project) offers the show file's siblings instead: `LOOM_HOUSE` =
//! `/config/house.json` → `/config/house.*.json`.
//!
//! Everything here is pure (the directory read aside), so the runtime, the
//! control plane and `scripts/sync-example.ts` share one definition.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { validateHouse, type HouseMap, type MapVariant } from "@loom/house";

/** The default variant's file. */
export const DEFAULT_MAP_FILE = "house.json";

/** A variant's label: letters, digits, `_` and `-`, one dot-free segment. */
const VARIANT = "[A-Za-z0-9_-]{1,40}";
const MAP_FILE = new RegExp(`^house(\\.${VARIANT})?\\.json$`);

/** Is `path` a project map file (`house.json`, `house.<variant>.json`, at
 *  the project's root)? */
export function isMapFile(path: string): boolean {
  return MAP_FILE.test(path);
}

/** A project's map files: file name → its raw JSON text (unvalidated —
 *  a broken file is listed with its problems, never dropped). */
export type MapFiles = Record<string, string>;

/** The map files among a project's files. */
export function mapFilesOf(files: Iterable<{ path: string; content: string }>): MapFiles {
  const out: MapFiles = {};
  for (const f of files) if (isMapFile(f.path)) out[f.path] = f.content;
  return out;
}

/** An untrusted record (a DB row's jsonb, a `/api/mod/load` body) as map
 *  files: only map-file names with string contents survive. Null when it
 *  isn't a record at all. */
export function asMapFiles(raw: unknown): MapFiles | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: MapFiles = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isMapFile(k) && typeof v === "string") out[k] = v;
  return out;
}

/** The default file first, then by name. */
export function compareMapFiles(fallback: string): (a: string, b: string) => number {
  return (a, b) => (a === fallback ? 0 : 1) - (b === fallback ? 0 : 1) || (a < b ? -1 : a > b ? 1 : 0);
}

/** One map file read: the normalized map when it validates, else why not. */
export interface ParsedMap {
  house: HouseMap | null;
  problems: string[];
}

/** Parse + validate a map file's text. */
export function parseMapText(text: string): ParsedMap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { house: null, problems: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] };
  }
  const v = validateHouse(raw);
  return v.ok && v.house !== undefined ? { house: v.house, problems: [] } : { house: null, problems: v.problems };
}

/** The first map file that doesn't validate, with why — null when all do.
 *  Every path that writes map files (`PUT /files`, `/api/mod/load {maps}`,
 *  `scripts/sync-example.ts`) refuses a broken one: a launch would quietly
 *  play the show file instead. */
export function mapProblems(maps: MapFiles): { file: string; problems: string[] } | null {
  for (const file of Object.keys(maps).sort()) {
    const { house, problems } = parseMapText(maps[file]!);
    if (house === null) return { file, problems };
  }
  return null;
}

/** The variant a stored choice resolves to among `files`: the choice when
 *  it is still there, else the default file, else the first; null when
 *  there are no files at all. */
export function activeVariant(files: readonly string[], wanted: string | null, fallback = DEFAULT_MAP_FILE): string | null {
  if (wanted !== null && files.includes(wanted)) return wanted;
  if (files.includes(fallback)) return fallback;
  return [...files].sort(compareMapFiles(fallback))[0] ?? null;
}

/** The project file "Save to project" writes by default: the active
 *  variant's (a show sibling keeps its name when it is a map-file name),
 *  else the default file. The map page's `saveTarget` mirrors this. */
export function saveFileFor(active: string | null): string {
  return active !== null && isMapFile(active) ? active : DEFAULT_MAP_FILE;
}

/** The variant list a director picks from (default first). */
export function listVariants(entries: ReadonlyArray<[file: string, parsed: ParsedMap]>, active: string | null, fallback = DEFAULT_MAP_FILE): MapVariant[] {
  return [...entries]
    .sort(([a], [b]) => compareMapFiles(fallback)(a, b))
    .map(([file, parsed]) => ({
      file,
      name: parsed.house?.name || file,
      active: file === active,
      ok: parsed.house !== null,
      problems: parsed.problems,
    }));
}

/** The show file's variants: the file itself (by its base name) plus its
 *  siblings `<stem>.<variant>.json` — `LOOM_HOUSE=/config/house.json` →
 *  `/config/house.shed.json`. A directory that can't be read leaves the
 *  show file alone. */
export function showVariantFiles(houseFile: string): Array<{ file: string; path: string }> {
  const dir = dirname(houseFile);
  const own = basename(houseFile);
  const out = [{ file: own, path: houseFile }];
  if (!own.endsWith(".json")) return out;
  const stem = own.slice(0, -".json".length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sibling = new RegExp(`^${stem}\\.${VARIANT}\\.json$`);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) if (name !== own && sibling.test(name)) out.push({ file: name, path: join(dir, name) });
  return out;
}

/** Read one show-side variant file (fresh — the variant list is rare). */
export function readMapFile(path: string): ParsedMap {
  try {
    return parseMapText(readFileSync(path, "utf8"));
  } catch (err) {
    return { house: null, problems: [`unreadable: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** A map as a project file: two-space JSON, trailing newline (what the
 *  example folder commits). */
export function mapFileText(house: HouseMap): string {
  return `${JSON.stringify(house, null, 2)}\n`;
}

/** How `scripts/sync-example.ts` treats the project's maps: `merge` (the
 *  default) only adds the example maps the project lacks, `replace`
 *  (`--replace-maps`) makes the project's maps the example's, `keep`
 *  (`--keep-maps`) touches none. */
export type MapSyncMode = "merge" | "replace" | "keep";

/**
 * What pushing an example folder's maps over a project's does. A project map
 * is the live copy — a survey saved from the map page lands there ("Save to
 * project") — so by default it is never overwritten: an example map is
 * added only when the project lacks that file, and `kept` lists the project
 * maps that differ from the example's (the script prints the difference).
 * `replace` writes every example map, deletes every project map the example
 * lacks, and lists in `replaced` the project text that is lost, so the
 * script can back it up first. `maps` is the project's map set afterwards.
 */
export function planMapSync(
  project: MapFiles,
  example: MapFiles,
  mode: MapSyncMode = "merge",
): { maps: MapFiles; put: string[]; remove: string[]; kept: string[]; replaced: string[] } {
  const differs = (f: string): boolean => f in example && example[f] !== project[f];
  if (mode === "keep") return { maps: { ...project }, put: [], remove: [], kept: [], replaced: [] };
  if (mode === "replace") {
    return {
      maps: { ...example },
      put: Object.keys(example).sort(),
      remove: Object.keys(project).filter((f) => !(f in example)).sort(),
      kept: [],
      replaced: Object.keys(project).filter((f) => !(f in example) || differs(f)).sort(),
    };
  }
  return {
    maps: { ...example, ...project },
    put: Object.keys(example).filter((f) => !(f in project)).sort(),
    remove: [],
    kept: Object.keys(project).filter(differs).sort(),
    replaced: [],
  };
}

/** One line telling two versions of a map file apart (sync-example's
 *  "kept the project's copy" note): name, counts, and the bytes. */
export function mapSummary(text: string): string {
  const { house, problems } = parseMapText(text);
  if (house === null) return `invalid (${problems[0] ?? "?"})`;
  const n = (k: number, what: string): string => `${k} ${what}${k === 1 ? "" : "s"}`;
  return `"${house.name}" — ${n(house.floors.length, "floor")}, ${n(house.rooms.length, "room")}, ${n(house.doors.length, "door")}, ${n(house.terminals.length, "terminal")}, ${n(house.duck.spots.length, "duck spot")}, ${text.length} bytes`;
}

/**
 * The event's way back to its project (absent for an event with no project,
 * like the LAN default event): "Save to project" writes a map file the next
 * launch and every co-writer sees, and the event row's snapshot follows.
 * The control plane builds it (`events-api.ts` `projectLink`); tests fake it.
 */
export interface ProjectLink {
  readonly projectId: string;
  /** Upsert a project file — folded into the live co-editing doc when
   *  it's open, announced to every editor's file tree. */
  writeFile(path: string, content: string): Promise<void>;
  /** Record the event's map snapshot on its row (`event.house_maps`). */
  saveSnapshot(maps: MapFiles): Promise<void>;
  /** Record the variant the event plays on its row (`event.map_variant`),
   *  which the project's next launch starts on. */
  saveVariant(file: string | null): Promise<void>;
}
