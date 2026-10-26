//! The big moment's words (wave 18, the moments lane; GUEST-SPEC §5.1):
//! how its text splits into a glyph, a headline and a body, and which
//! kicker / install-bar line / acknowledge label it wears. Pure — tested in
//! `test/moments-big.test.tsx`; `big.tsx` renders it.

import { QUARANTINE, VIRUS, bareGlyph, bigParts } from "./big-parts.ts";
import type { Moment } from "./model.ts";

export { HEADLINE_MAX, bigParts } from "./big-parts.ts";

/** The acknowledge button is disabled this long (shown as the install bar filling). */
export { BIG_DEAD_MS } from "../../../core/src/delivery.ts";
/** After a card inside a big is answered, the settled card shows this long, then the window closes. */
export const BIG_SETTLE_MS = 1_200;
export { bareGlyph } from "./big-parts.ts";

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

/** Wave 26 (R1): the acknowledge label a big wears once its exits are
 *  known. `with ack: none` drops it — but only when one of the story's own
 *  exits resolved for this viewer (`Exit.story`), so a guest is never
 *  trapped and the NM-F1 "What do I do?" fallback keeps its OK. */
export function bigAck(ack: string | null, m: Pick<Moment, "noAck">, exits: ReadonlyArray<{ story?: true }>): string | null {
  return m.noAck === true && exits.slice(0, 2).some((x) => x.story === true) ? null : ack;
}

/** The cheer's label as it counts down: "Cheer! (6)". */
export function cheerLabel(leftMs: number): string {
  return `Cheer! (${Math.max(0, Math.ceil(leftMs / 1000))})`;
}

/** Words only: no pictographs, quotes or punctuation, one case, one space. */
function plainWords(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[!"'`“”‘’.,:;?…()[\]-]+/gu, " ")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/** The card inside a big says what the big already says (N8: "The bottle
 *  landed on you. Truth or dare?" over "THE BOTTLE LANDED ON YOU. TRUTH OR
 *  DARE?"): the card's own title is hidden there. */
export function cardTitleRepeats(momentText: string, cardText: string): boolean {
  const card = plainWords(cardText);
  if (card === "") return false;
  const big = plainWords(momentText);
  return big === card || big.startsWith(`${card} `) || big.endsWith(` ${card}`) || card.startsWith(`${big} `);
}
