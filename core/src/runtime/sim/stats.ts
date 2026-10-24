//! Wave 21 (C3) — header `stat:` lines: a player booth's score tiles.
//!
//! ```loom
//! stat: self.score as ⭐ Points
//! stat: self.captures as ⛓ Captures, for Antivirus, while Night.step >= 3
//! ```
//!
//! One line is `self.<path> as <glyph> <label>[, for <who>][, while <cond>]`.
//! `<who>` is `players` (the default: every `player: true` part), or a list
//! of CHARACTER names and GROUPs. The value is read off the booth's own
//! character (`<Character>.<path>`); the `while` is evaluated with `self` =
//! that character. A booth sees its own `private:` slots here (it is its own
//! score), but a `while` that reads another character's private slot or a
//! `secret: true` character hides the line (lint L1225).

import { foldName } from "../../parser/names.ts";
import { display, parseExprCached, type Expr } from "../expr.ts";
import { isSecretRoleSlot } from "./board.ts";
import type { CharDef } from "./model.ts";
import type { Sim } from "./sim.ts";

/** A compiled header `stat:` line. */
export interface StatDef {
  /** The path under `self.` (`score`, `game.points`). */
  path: string;
  glyph: string;
  /** The label after the glyph (the glyph again when none). */
  label: string;
  /** The `for` names as written; null = `players` (the default). */
  for: string[] | null;
  while: string | null;
  raw: string;
}

/** One stat as a booth shows it. */
export interface StatView {
  glyph: string;
  label: string;
  value: string;
}

/** Parse one `stat:` value, or null when it does not parse (L1223). */
export function parseStatLine(value: string): StatDef | null {
  const raw = value.trim();
  let rest = raw;
  let cond: string | null = null;
  const w = /,\s*while\s+/u.exec(rest);
  if (w !== null) {
    cond = rest.slice(w.index + w[0].length).trim();
    rest = rest.slice(0, w.index);
    if (cond === "") return null;
  }
  let who: string[] | null = null;
  const f = /,\s*for\s+/u.exec(rest);
  if (f !== null) {
    who = rest
      .slice(f.index + f[0].length)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "");
    rest = rest.slice(0, f.index);
    if (who.length === 0) return null;
    if (who.some((n) => foldName(n) === "players")) who = null;
  }
  const m = /^(?:self|me)\.([A-Za-z_][\w.]*?)\s+as\s+(\S+)(?:\s+(\S.*))?$/u.exec(rest.trim());
  if (m === null) return null;
  const label = (m[3] ?? "").trim();
  return { path: m[1]!, glyph: m[2]!, label: label === "" ? m[2]! : label, for: who, while: cond, raw };
}

/** Is the line for `c`'s booth (`for` matches)? */
export function statFor(def: StatDef, c: CharDef): boolean {
  if (def.for === null) return c.player;
  const id = foldName(c.id);
  const group = c.faction === null ? null : foldName(c.faction);
  return def.for.some((n) => {
    const k = foldName(n);
    return k === id || (group !== null && k === group);
  });
}

/** Every dotted path an expression reads (as written). */
function pathsIn(e: Expr, out: string[][]): void {
  switch (e.kind) {
    case "path":
      out.push(e.segments);
      return;
    case "list":
      for (const x of e.items) pathsIn(x, out);
      return;
    case "unary":
      pathsIn(e.inner, out);
      return;
    case "binary":
      pathsIn(e.left, out);
      pathsIn(e.right, out);
      return;
    case "call":
      for (const x of e.args) pathsIn(x, out);
      return;
    case "listComp":
      pathsIn(e.source, out);
      pathsIn(e.value, out);
      if (e.filter !== null) pathsIn(e.filter, out);
      return;
    default:
      return;
  }
}

/** Is `rest` one of `c`'s `private:` slots (a name or a dotted prefix)? */
export function isPrivateSlot(c: Pick<CharDef, "privateSlots"> | undefined, rest: string): boolean {
  return c !== undefined && c.privateSlots.length > 0 && isSecretRoleSlot(c.privateSlots, rest);
}

/** The CHARACTER a path head names (folded), or undefined. */
function charOf(model: Pick<Sim["model"], "characters">, head: string): CharDef | undefined {
  const k = foldName(head);
  for (const c of model.characters.values()) if (foldName(c.id) === k) return c;
  return undefined;
}

/** Does `cond` read another character's `private:` slot or a `secret:
 *  true` character (`self` / `me` = `owner`, whose own slots are fine)? An
 *  expression that does not parse reads nothing. */
export function readsOthersPrivate(model: Pick<Sim["model"], "characters">, cond: string | null, owner: string | null): boolean {
  if (cond === null) return false;
  const paths: string[][] = [];
  try {
    pathsIn(parseExprCached(cond), paths);
  } catch {
    return false;
  }
  return paths.some((segs) => {
    if (segs.length < 2) return false;
    const head = segs[0]!;
    if (head === "self" || head === "me") return false;
    const c = charOf(model, head);
    if (c === undefined) return false;
    if (owner !== null && foldName(c.id) === foldName(owner)) return false;
    return c.secret || isPrivateSlot(c, segs.slice(1).join("."));
  });
}

/** `PrimeView.stats` for `character`'s booth: its lines whose `for`
 *  matches and whose `while` holds, in header order. A value that is unset
 *  shows "0" on a declared numeric slot, else the line is skipped. */
export function statsFor(sim: Sim, character: string): StatView[] {
  const c = sim.model.characters.get(character);
  if (c === undefined || sim.model.stats.length === 0) return [];
  const out: StatView[] = [];
  for (const def of sim.model.stats) {
    if (!statFor(def, c)) continue;
    if (readsOthersPrivate(sim.model, def.while, c.id)) continue;
    if (def.while !== null) {
      let ok = false;
      try {
        ok = sim.holds(def.while, null, c.id);
      } catch {
        ok = false;
      }
      if (!ok) continue;
    }
    const v = sim.world.get(`${c.id}.${def.path}`);
    let value: string | null = null;
    if (v.kind === "null") {
      const d = c.defaults.get(def.path);
      value = c.ranges.has(def.path) || d?.kind === "number" ? "0" : null;
    } else if (v.kind === "number") value = Number.isInteger(v.value) ? String(v.value) : String(Math.round(v.value * 100) / 100);
    else value = display(v);
    if (value === null) continue;
    out.push({ glyph: def.glyph, label: def.label, value });
  }
  return out;
}
