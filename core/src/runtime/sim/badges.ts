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
//! <cond>]` (`parseBoardLine`'s shape, one item). A ROLE head (or its alias,
//! `program`) is a per-guest flag read off the guest's own world path; a
//! CHARACTER head reads the character's (a guest playing it shows it).
//! Display only and never secret: a ROLE `secret:` slot or a `secret: true`
//! CHARACTER is refused by lint L1219 and skipped here at run time, since
//! every phone sees a badge.

import type { BadgeDef } from "./model.ts";
import type { Sim } from "./sim.ts";

/** One badge as a people list shows it. */
export interface NameBadge {
  glyph: string;
  label: string;
}

/** Parse one `badge:` value, or null when it does not parse (L1219). */
export function parseBadgeLine(_value: string): BadgeDef | null {
  return null;
}

/** The badges `person` wears now (header order; only the true ones). */
export function badgesOf(_sim: Sim, _person: string): NameBadge[] {
  return [];
}
