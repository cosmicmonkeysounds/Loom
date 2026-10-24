//! Wave 18b — header `badge:` lines: a glyph beside a person's name on every
//! people list (People cards, presence, the booth, the host dock, Run's
//! roster) while a path is true for them.
//!
//! ```loom
//! badge: program.afk as 🚻 Bathroom Mode
//! badge: program.captured as ⛓ Captured, while Night.step >= 3
//! ```
//!
//! One line is `<ROLE alias|Character>.<path> as <glyph> <label>[, while
//! <cond>]` (`parseBoardLine`'s shape, one item, its ` as ` required). A
//! ROLE head (its id or alias, `program`) is a per-guest flag read off the
//! guest's own world path; a CHARACTER head reads the character's (a guest
//! whose program is that character wears it too). The `while` condition is
//! evaluated with the wearer bound (`program` / `self`).
//!
//! Display only and never secret: a ROLE `secret:` slot, a `secret: true`
//! CHARACTER or a CHARACTER's `private:` slot (wave 21) — as the path or anywhere in the `while` — is refused by lint
//! L1219 and skipped here at run time, since every phone sees a badge (a
//! `while Kernel.armed == true` would tell every phone that bit).

import { foldName } from "../../parser/names.ts";
import { parseExprCached, truthy, type Expr } from "../expr.ts";
import { isSecretRoleSlot, parseBoardLine } from "./board.ts";
import { isPrivateSlot } from "./stats.ts";
import type { BadgeDef } from "./model.ts";
import type { Sim } from "./sim.ts";

/** One badge as a people list shows it. */
export interface NameBadge {
  glyph: string;
  label: string;
}

/** Parse one `badge:` value, or null when it does not parse (L1219): one
 *  dotted path, ` as ` a label whose first word is the glyph. */
export function parseBadgeLine(value: string): BadgeDef | null {
  const line = parseBoardLine(value);
  if (line === null || line.items.length !== 1) return null;
  const item = line.items[0]!;
  if (item.path === null) return null;
  const itemsText = line.while === null ? value : value.slice(0, value.search(/,\s*while\s+/u));
  if (!/\sas\s/u.test(itemsText)) return null;
  const words = item.label.trim().split(/\s+/u);
  const glyph = words[0] ?? "";
  if (glyph === "") return null;
  const label = words.slice(1).join(" ");
  const dot = item.path.indexOf(".");
  return {
    head: item.path.slice(0, dot),
    rest: item.path.slice(dot + 1),
    path: item.path,
    glyph,
    label: label === "" ? glyph : label,
    while: line.while,
    raw: line.raw,
  };
}

/** What a badge's head names: a ROLE (by id or alias) or a CHARACTER. */
export type BadgeHead = { kind: "role"; id: string } | { kind: "character"; id: string } | null;

/** Resolve a badge head against the story's ROLEs and CHARACTERs. */
export function badgeHead(model: Pick<Sim["model"], "roles" | "characters">, head: string): BadgeHead {
  const fold = foldName(head);
  for (const id of model.roles.keys()) {
    if (foldName(id) === fold || id.toLowerCase().replace(/\s+/gu, "_") === head.toLowerCase()) return { kind: "role", id };
  }
  for (const id of model.characters.keys()) if (foldName(id) === fold) return { kind: "character", id };
  return null;
}

/** Is the badge on a secret (a ROLE `secret:` slot, a `secret: true`
 *  CHARACTER)? Such a badge is never shown (L1219). */
export function badgeIsSecret(model: Pick<Sim["model"], "roles" | "characters">, def: BadgeDef): boolean {
  const head = badgeHead(model, def.head);
  if (head === null) return false;
  if (head.kind === "character") {
    const c = model.characters.get(head.id);
    return c?.secret === true || isPrivateSlot(c, def.rest); // w21: a `private:` slot too
  }
  const role = model.roles.get(head.id);
  return role !== undefined && isSecretRoleSlot(role.secret, def.rest);
}

/** Every dotted path an expression reads (as written, bound heads too). */
function pathsIn(e: Expr, out: string[][], bound: Set<string>): void {
  switch (e.kind) {
    case "path":
      out.push(bound.has(e.segments[0] ?? "") ? ["*", ...e.segments.slice(1)] : e.segments);
      return;
    case "list":
      for (const x of e.items) pathsIn(x, out, bound);
      return;
    case "unary":
      pathsIn(e.inner, out, bound);
      return;
    case "binary":
      pathsIn(e.left, out, bound);
      pathsIn(e.right, out, bound);
      return;
    case "call":
      for (const x of e.args) pathsIn(x, out, bound);
      return;
    case "listComp": {
      pathsIn(e.source, out, bound);
      const inner = new Set(bound).add(e.var);
      pathsIn(e.value, out, inner);
      if (e.filter !== null) pathsIn(e.filter, out, inner);
      return;
    }
    default:
      return;
  }
}

const whileSecret = new WeakMap<BadgeDef, boolean>();

/** Does the badge's `while` read a secret: a `secret: true` CHARACTER, or
 *  a ROLE `secret:` slot (through the ROLE's alias, `self` / `me` — the
 *  wearer — or a list comprehension's variable, which may be anyone)? A
 *  `while` that does not parse reads nothing (L1219 warns about it). */
export function badgeWhileReadsSecret(model: Pick<Sim["model"], "roles" | "characters">, def: BadgeDef): boolean {
  if (def.while === null) return false;
  const hit = whileSecret.get(def);
  if (hit !== undefined) return hit;
  const paths: string[][] = [];
  try {
    pathsIn(parseExprCached(def.while), paths, new Set());
  } catch {
    paths.length = 0;
  }
  const anyRoleSlot = (rest: string): boolean => [...model.roles.values()].some((r) => isSecretRoleSlot(r.secret, rest));
  const own = badgeHead(model, def.head);
  const secret = paths.some((segs) => {
    if (segs.length < 2) return false;
    const rest = segs.slice(1).join(".");
    const head = segs[0]!;
    if (head === "*") return anyRoleSlot(rest);
    if (head === "self" || head === "me") {
      if (own?.kind === "character") {
        const c = model.characters.get(own.id);
        return c?.secret === true || isPrivateSlot(c, rest);
      }
      if (own?.kind === "role") return isSecretRoleSlot(model.roles.get(own.id)?.secret ?? [], rest);
      return anyRoleSlot(rest);
    }
    const h = badgeHead(model, head);
    if (h === null) return false;
    if (h.kind === "character") {
      const c = model.characters.get(h.id);
      return c?.secret === true || isPrivateSlot(c, rest);
    }
    return isSecretRoleSlot(model.roles.get(h.id)?.secret ?? [], rest);
  });
  whileSecret.set(def, secret);
  return secret;
}

/** Per sim: the badges worn at one log length (a view build asks for every
 *  person, and every view build asks again). */
const memo = new WeakMap<Sim, { len: number; worn: Map<string, NameBadge[]> }>();

/** The badges `person` (a guest or a listed character) wears now, header
 *  order, only the true ones. Memoised per sim log length. */
export function badgesOf(sim: Sim, person: string): NameBadge[] {
  if (sim.model.badges.length === 0) return [];
  const len = sim.log.len();
  let m = memo.get(sim);
  if (m === undefined || m.len !== len) {
    m = { len, worn: new Map() };
    memo.set(sim, m);
  }
  const hit = m.worn.get(person);
  if (hit !== undefined) return hit;
  const worn = computeBadges(sim, person);
  m.worn.set(person, worn);
  return worn;
}

function computeBadges(sim: Sim, person: string): NameBadge[] {
  const guest = sim.persons.get(person);
  const out: NameBadge[] = [];
  for (const def of sim.model.badges) {
    const head = badgeHead(sim.model, def.head);
    if (head === null || badgeIsSecret(sim.model, def) || badgeWhileReadsSecret(sim.model, def)) continue;
    let path: string | null = null;
    if (head.kind === "role") {
      if (guest !== undefined && guest.role === head.id) path = `${person}.${def.rest}`;
    } else if (head.id === person || (guest !== undefined && foldName(guest.name) === foldName(head.id))) {
      path = `${head.id}.${def.rest}`;
    }
    if (path === null || !truthy(sim.world.get(path))) continue;
    if (def.while !== null && !(guest !== undefined ? sim.holds(def.while, person) : sim.holds(def.while, null, person))) continue;
    out.push({ glyph: def.glyph, label: def.label });
  }
  return out;
}
