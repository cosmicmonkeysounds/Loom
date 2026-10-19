//! The director's board: the story header's `watch:` and `countdown:`
//! lines, parsed (Run → Director's glance column and countdowns).
//!
//! ```loom
//! watch: Night.clock as Y2K clock, Night.round as Truth round
//! watch: Kernel.majority as Majority, while Night.step >= 14
//! watch: Microsoft Excel, MS Paint
//! countdown: Night.y2k_end as Midnight, while Night.final_round == true
//! ```
//!
//! One line is `<item>[, <item>…][, while <condition>]`: the first
//! `, while ` splits the items from a condition that gates the whole line
//! (evaluated like an admin cue's `while:`, with nothing bound). An item is
//! a dotted path to show (`Night.clock`), labelled by its last ` as `, or —
//! with no dot — a person's name (a character, or the guest playing it).
//! A `countdown:` line takes paths only (`pathsOnly`): each holds a story
//! time in seconds (`Time.elapsed + N`). A trailing **`for guests`** (after
//! the items or after the `while` condition, a comma before it optional)
//! puts the line on every guest's phone too (`GuestView.countdowns`):
//!
//! ```loom
//! countdown: Night.summons_end as Summons for guests
//! countdown: Night.hunt_end as Hunt closes, while Night.phase == "hunt", for guests
//! ```
//!
//! Pure and display-only: nothing here touches the sim, the journal or the
//! cue state. Scope resolution (character / role / global / person) and the
//! live `while` live with the server's views (`boardFor`).

import { splitTopLevelCommas } from "../../parser/rust.ts";

/** One thing a board line shows. Exactly one of `path` / `name` is set. */
export interface BoardItemDef {
  label: string;
  /** A dotted world path (`Night.clock`, `program.cleared`). */
  path: string | null;
  /** A person's name (`Microsoft Excel`) — a `watch:` item with no dot. */
  name: string | null;
}

/** One `watch:` / `countdown:` header line. */
export interface BoardLine {
  items: BoardItemDef[];
  /** The `, while <cond>` tail, or null (always shown). */
  while: string | null;
  /** The line's value as written. */
  raw: string;
  /** `for guests` on a `countdown:` line: guests see it too. */
  guests?: true;
}

/** `Night.wrong_combos`: identifier segments joined by dots, two or more. */
const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/u;
/** `Microsoft Excel`, `Norton Anti-Virus`: words, no dot, no operators. */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N}_'’&+!? -]*$/u;

/** The label a path shows when the line gives none: its last segment,
 *  `_` read as a space, first letter capitalised (`Night.wrong_combos` →
 *  `Wrong combos`). */
export function defaultBoardLabel(path: string): string {
  const leaf = path.slice(path.lastIndexOf(".") + 1).replace(/_+/gu, " ").replace(/\s+/gu, " ").trim();
  return leaf === "" ? path : leaf.charAt(0).toUpperCase() + leaf.slice(1);
}

/** The line split at its first `, while `: the items' text and the
 *  condition (null when there is none; "" when the tail is empty). */
function splitWhile(value: string): { items: string; cond: string | null } {
  const m = /,\s*while\s+/u.exec(value) ?? /,\s*while\s*$/u.exec(value);
  if (m === null) return { items: value, cond: null };
  return { items: value.slice(0, m.index), cond: value.slice(m.index + m[0].length).trim() };
}

/** A trailing `for guests` flag (`, for guests` or ` for guests`). */
const FOR_GUESTS = /(?:,\s*|\s+)for\s+guests\s*$/iu;

/** `value` with a countdown line's trailing `for guests` taken off — at the
 *  very end, or at the end of the items before a `, while` — and whether
 *  there was one. Only a `countdown:` line (`pathsOnly`) takes the flag. */
function splitGuests(value: string, pathsOnly: boolean): { value: string; guests: boolean } {
  if (!pathsOnly) return { value, guests: false };
  const end = FOR_GUESTS.exec(value);
  if (end !== null) return { value: value.slice(0, end.index), guests: true };
  const { items, cond } = splitWhile(value);
  if (cond === null) return { value, guests: false };
  const mid = FOR_GUESTS.exec(items);
  if (mid === null) return { value, guests: false };
  return { value: `${items.slice(0, mid.index)}, while ${cond}`, guests: true };
}

/** One item, or null when it does not parse (a name on a `countdown:`). */
export function parseBoardItem(raw: string, opts?: { pathsOnly?: boolean }): BoardItemDef | null {
  const text = raw.trim();
  if (text === "") return null;
  let head = text;
  let label: string | null = null;
  const as = [...text.matchAll(/\s+as\s+/gu)].pop();
  if (as !== undefined) {
    head = text.slice(0, as.index).trim();
    label = text.slice(as.index + as[0].length).trim();
    if (label === "") return null;
  }
  if (PATH.test(head)) return { label: label ?? defaultBoardLabel(head), path: head, name: null };
  if (head.includes(".") || opts?.pathsOnly === true || !NAME.test(head)) return null;
  const name = head.replace(/\s+/gu, " ");
  return { label: label ?? name, path: null, name };
}

/**
 * Parse one `watch:` (or, with `pathsOnly`, `countdown:`) line. An item
 * that does not parse is skipped; a line with no item left, or an empty
 * `while` tail, is null (lint L1205 names both).
 */
export function parseBoardLine(value: string, opts?: { pathsOnly?: boolean }): BoardLine | null {
  const flag = splitGuests(value, opts?.pathsOnly === true);
  const { items: text, cond } = splitWhile(flag.value);
  if (cond === "") return null;
  const items = splitTopLevelCommas(text)
    .map((piece) => parseBoardItem(piece, opts))
    .filter((i): i is BoardItemDef => i !== null);
  if (items.length === 0) return null;
  return { items, while: cond, raw: value.trim(), ...(flag.guests ? { guests: true as const } : {}) };
}

/** What parsing `value` skipped — each item that did not parse, as written
 *  (trimmed), and whether the `while` tail is empty. For lint L1205. */
export function boardLineProblems(value: string, opts?: { pathsOnly?: boolean }): { items: string[]; emptyWhile: boolean } {
  const { items: text, cond } = splitWhile(splitGuests(value, opts?.pathsOnly === true).value);
  return {
    items: splitTopLevelCommas(text)
      .map((p) => p.trim())
      .filter((p) => parseBoardItem(p, opts) === null),
    emptyWhile: cond === "",
  };
}
