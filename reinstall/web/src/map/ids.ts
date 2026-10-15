//! Fresh ids for the map editor's new floors, rooms, doors and stairs —
//! pure. Ids are what every other part of the map refers to (a door's
//! `a` / `b`, a terminal's `room`, the Godot goldens), so a new one is
//! readable (slugged from its label) and never collides.

/** An id not yet used by `taken`: `prefix-1`, `prefix-2`, … */
export function uniqueId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let i = 1; ; i++) {
    const id = `${prefix}-${i}`;
    if (!used.has(id)) return id;
  }
}

/** `base` itself when free, else `base-2`, `base-3`, … */
export function freshId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
}

/** A label as an id: lower case, runs of anything but letters and digits
 *  → one `-`, a leading "the" dropped ("The Server Room" → `server-room`). */
export function slug(label: string, fallback = "item"): string {
  const s = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return s === "" ? fallback : s;
}

/** A default label not yet used: `Room`, then `Room 2`, `Room 3`, … */
export function freshLabel(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) {
    const label = `${base} ${i}`;
    if (!used.has(label)) return label;
  }
}
