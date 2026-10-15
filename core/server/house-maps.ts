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

/** The variant a stored choice resolves to among `files`: the choice when
 *  it is still there, else the default file, else the first; null when
 *  there are no files at all. */
export function activeVariant(files: readonly string[], wanted: string | null, fallback = DEFAULT_MAP_FILE): string | null {
  if (wanted !== null && files.includes(wanted)) return wanted;
  if (files.includes(fallback)) return fallback;
  return [...files].sort(compareMapFiles(fallback))[0] ?? null;
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

/**
 * What pushing an example folder's maps over a project's does
 * (`scripts/sync-example.ts`): every example map is written, every project
 * map the example lacks is deleted, and `replaced` lists the project maps
 * whose text would be lost (changed or deleted) — a map saved from the map
 * page since the last sync, say — so the script can back them up first.
 */
export function planMapSync(project: MapFiles, example: MapFiles): { put: string[]; remove: string[]; replaced: string[] } {
  const put = Object.keys(example).sort();
  const remove = Object.keys(project).filter((f) => !(f in example)).sort();
  const replaced = Object.keys(project)
    .filter((f) => !(f in example) || example[f] !== project[f])
    .sort();
  return { put, remove, replaced };
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
}
