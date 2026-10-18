//! Keyed patches between two director views (W9 O1-01, contract C7).
//!
//! A full director console streams the whole `ModView` — ≈ 410 KB at 45
//! guests (the world block alone is ≈ 280 KB, 6k entries) — up to twice a
//! second, yet a frame changes ≈ 2 world entries and a few codex / roster
//! rows. A console that opts in (`/events?role=mod&delta=1`) gets a full
//! `snapshot` as a keyframe and then `snapshotPatch` frames carrying just
//! what changed; `applyModPatch` rebuilds the next view from the last one.
//!
//! The patch is per top-level field: an unchanged field is absent, a gone
//! one is `{remove: true}`, a changed one is `{value}` — except the three
//! big arrays, which are keyed (`world` by `path`, `codex` and `roster` by
//! `id`) and sent as `{set, del}`: the changed or new rows and the removed
//! keys. The receiver keeps the old order (new rows appended; `world`
//! sorted, as `Sim.worldEntries` is), and the patch carries an explicit
//! `order` only when that implied order is wrong.
//!
//! Pure and dependency-free: the server builds patches, the editor applies
//! them, and the tests pin that `applyModPatch(prev, modPatch(prev, next))`
//! deep-equals `next`.

/** The keyed arrays and the field each row is keyed by. */
export const MOD_PATCH_KEYS: Readonly<Record<string, string>> = { world: "path", codex: "id", roster: "id" };

/** One top-level field's change. */
export type ModFieldPatch =
  | { value: unknown }
  | { remove: true }
  | { set: Array<Record<string, unknown>>; del: string[]; order?: string[] };

/** What changed between two views, by top-level field. */
export type ModPatch = Record<string, ModFieldPatch>;

/** The `snapshotPatch` SSE frame: `patch` turns frame `base` into `frame`. */
export interface ModPatchFrame {
  base: number;
  frame: number;
  patch: ModPatch;
}

type Row = Record<string, unknown>;

// Serialisations memoised by object identity: the server keeps the previous
// view, so its fields (and its rows) are stringified once, not once a frame.
const fieldMemo = new WeakMap<object, Map<string, string | undefined>>();
const rowMemo = new WeakMap<object, string>();

/** `JSON.stringify(view[key])`, memoised per view (undefined for a field
 *  JSON leaves out). */
export function fieldJson(view: object, key: string): string | undefined {
  let m = fieldMemo.get(view);
  if (m === undefined) fieldMemo.set(view, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const json = JSON.stringify((view as Record<string, unknown>)[key]) as string | undefined;
  m.set(key, json);
  return json;
}

function rowJson(row: Row): string {
  let json = rowMemo.get(row);
  if (json === undefined) rowMemo.set(row, (json = JSON.stringify(row)));
  return json;
}

/** `JSON.stringify(view)`, assembled from the memoised field serialisations
 *  (byte-identical: same keys, same order, undefined fields left out). */
export function modViewJson(view: object): string {
  const parts: string[] = [];
  for (const key of Object.keys(view)) {
    const json = fieldJson(view, key);
    if (json !== undefined) parts.push(`${JSON.stringify(key)}:${json}`);
  }
  return `{${parts.join(",")}}`;
}

/** The rows' keys, or null when the array can't be keyed (a row that isn't
 *  an object, a key that isn't a string, or a duplicate key). */
function keysOf(rows: unknown, key: string): string[] | null {
  if (!Array.isArray(rows)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r === null || typeof r !== "object") return null;
    const k = (r as Row)[key];
    if (typeof k !== "string" || seen.has(k)) return null;
    seen.add(k);
    out.push(k);
  }
  return out;
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order a receiver rebuilds a keyed array in without being told. */
function impliedOrder(field: string, prevKeys: readonly string[], kept: ReadonlySet<string>, added: readonly string[]): string[] {
  const order = [...prevKeys.filter((k) => kept.has(k)), ...added];
  return field === "world" ? order.sort(byCodeUnit) : order;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** What turns `prev` into `next`. */
export function modPatch(prev: object, next: object): ModPatch {
  const patch: ModPatch = {};
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const before = fieldJson(prev, field);
    const after = fieldJson(next, field);
    if (before === after) continue;
    if (after === undefined) {
      patch[field] = { remove: true };
      continue;
    }
    const key = MOD_PATCH_KEYS[field];
    const prevKeys = key !== undefined ? keysOf(a[field], key) : null;
    const nextKeys = key !== undefined && prevKeys !== null ? keysOf(b[field], key) : null;
    if (key === undefined || prevKeys === null || nextKeys === null) {
      patch[field] = { value: b[field] };
      continue;
    }
    const was = new Map<string, string>();
    (a[field] as Row[]).forEach((r, i) => was.set(prevKeys[i]!, rowJson(r)));
    const set: Row[] = [];
    const added: string[] = [];
    (b[field] as Row[]).forEach((r, i) => {
      const k = nextKeys[i]!;
      const old = was.get(k);
      if (old === undefined) added.push(k);
      if (old !== rowJson(r)) set.push(r);
    });
    const kept = new Set(nextKeys);
    const del = prevKeys.filter((k) => !kept.has(k));
    const implied = impliedOrder(field, prevKeys, kept, added);
    patch[field] = sameList(implied, nextKeys) ? { set, del } : { set, del, order: nextKeys };
  }
  return patch;
}

/** `prev` with `patch` applied (a new object; unchanged fields and rows are
 *  `prev`'s own, so a store can tell what moved). */
export function applyModPatch<T extends object>(prev: T, patch: ModPatch): T {
  const out = { ...prev } as Record<string, unknown>;
  for (const [field, change] of Object.entries(patch)) {
    if ("remove" in change) {
      delete out[field];
      continue;
    }
    if ("value" in change) {
      out[field] = change.value;
      continue;
    }
    const key = MOD_PATCH_KEYS[field] ?? "id";
    const before = Array.isArray(out[field]) ? (out[field] as Row[]) : [];
    const rows = new Map<string, Row>(before.map((r) => [r[key] as string, r]));
    const prevKeys = [...rows.keys()];
    for (const k of change.del) rows.delete(k);
    const added: string[] = [];
    for (const r of change.set) {
      const k = r[key] as string;
      if (!rows.has(k)) added.push(k);
      rows.set(k, r);
    }
    const order = change.order ?? impliedOrder(field, prevKeys, new Set(rows.keys()), added);
    out[field] = order.map((k) => rows.get(k)!);
  }
  return out as T;
}
