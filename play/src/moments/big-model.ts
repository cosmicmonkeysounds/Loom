//! The big moment's words (wave 18, the moments lane; GUEST-SPEC §5.1):
//! how its text splits into a glyph, a headline and a body, and which
//! kicker / install-bar line / acknowledge label it wears. Pure — tested in
//! `test/moments-big.test.tsx`; `big.tsx` renders it.

import { bigParts } from "./big-parts.ts";
import type { Moment } from "./model.ts";

export { HEADLINE_MAX, bigParts } from "./big-parts.ts";

/** The acknowledge button is disabled this long (shown as the install bar filling). */
export const BIG_DEAD_MS = 1_200;
/** After a card inside a big is answered, the settled card shows this long, then the window closes. */
export const BIG_SETTLE_MS = 1_200;
/** A glyph without its variation selector (🛡️ and 🛡 are one glyph). */
export function bareGlyph(g: string): string {
  return g.replace(/[︎️]/gu, "");
}

/** What the big window wears: its kicker line, the install bar's two lines, its acknowledge label. */
export interface Kicker {
  kicker: string;
  /** The install bar's line while it fills, then when it is done (null = no bar). */
  bar: { during: string; done: string } | null;
  /** The acknowledge button's label (null = no button: the card's own answer closes it). */
  ack: string | null;
  /** A footer under a card ("Answer to continue."). */
  footer?: string;
  /** The acknowledge counts down (`Cheer! (6)`). */
  countdown?: boolean;
}

const VIRUS = new Set(["🛡", "🚨"]);
const QUARANTINE = new Set(["🌐", "⛔", "🔒"]);
const WIN = new Set(["🎀", "🏆", "🎱", "🥇", "🦆", "✅", "🎉", "♟"]);

/**
 * The kicker (§5.1 table, first match): a card inside → YOUR MOVE; an
 * invitation; a house cheer that closes itself → HOUSE NEWS; a virus glyph;
 * a quarantine glyph; a win glyph → ACHIEVEMENT UNLOCKED; else IMPORTANT.
 */
export function kickerOf(m: Pick<Moment, "text" | "kind"> & Partial<Pick<Moment, "autoClose" | "card">>, opts: { cardInside?: boolean } = {}): Kicker {
  if (m.card?.kind === "invite") return { kicker: "🚪 AN INVITATION", bar: null, ack: null };
  if (opts.cardInside === true) return { kicker: "⚡ YOUR MOVE", bar: null, ack: null, footer: "Answer to continue." };
  if (m.autoClose !== undefined && m.autoClose > 0) return { kicker: "📣 HOUSE NEWS", bar: null, ack: "Cheer!", countdown: true };
  const g = bareGlyph(bigParts(m.text, m.kind, m.card?.kind).glyph);
  if (VIRUS.has(g)) return { kicker: "⚠ VIRUS DETECTED", bar: { during: "Scanning…", done: "Threat found." }, ack: "OK" };
  if (QUARANTINE.has(g)) return { kicker: "⛔ QUARANTINED", bar: { during: "Moving to the Internet…", done: "Done." }, ack: "OK" };
  if (WIN.has(g)) return { kicker: "★ ACHIEVEMENT UNLOCKED", bar: { during: "Installing achievement…", done: "Installed." }, ack: "Collect ✓" };
  return { kicker: "! IMPORTANT", bar: { during: "Please wait…", done: "Ready." }, ack: "OK" };
}

/** The cheer's label as it counts down: "Cheer! (6)". */
export function cheerLabel(leftMs: number): string {
  return `Cheer! (${Math.max(0, Math.ceil(leftMs / 1000))})`;
}
