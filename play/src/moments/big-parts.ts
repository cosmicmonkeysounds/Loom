//! A big moment's text as glyph + headline + body (wave 18, GUEST-SPEC
//! §5.1) — also every Notifications row's title. Its own tiny module: the
//! big window (`big.tsx`, `big-model.ts`) loads lazily, the rows do not.

import { noticeKey } from "../../../core/src/delivery.ts";
import type { Moment } from "./model.ts";

/** A headline is at most this many characters. */
export const HEADLINE_MAX = 90;

/** A card kind's own glyph (GN-F10: an invitation wore a 🃏 joker). */
const CARD_GLYPHS: Readonly<Record<string, string>> = { invite: "🚪", answer: "💬", sides: "🚪", fact: "📝", poll: "📊", captcha: "🤖", pass: "🎟" };

/** The fallback glyph for a moment kind (a card's own kind first). */
function kindGlyph(kind: Moment["kind"], cardKind?: string): string {
  switch (kind) {
    case "card":
      return (cardKind !== undefined ? CARD_GLYPHS[cardKind] : undefined) ?? "🃏";
    case "quest":
      return "📓";
    case "objective":
      return "▣";
    default:
      return "❗";
  }
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/**
 * A big moment's text as glyph + headline + body: the leading pictograph
 * (else the kind's icon), the first sentence (to the first `. ! ?` and a
 * space, ≤ 90 characters) and the rest. A first sentence too long for a
 * headline is clipped there and the body keeps the whole text, so no word
 * is lost.
 */
export function bigParts(text: string, kind: Moment["kind"] = "other", cardKind?: string): { glyph: string; headline: string; body: string } {
  const t = text.trim();
  const lead = noticeKey(t);
  const glyph = lead !== "•" ? lead : kindGlyph(kind, cardKind);
  const words = (lead !== "•" ? t.replace(/^["'`]+/u, "").trimStart().slice(lead.length) : t).trim();
  const end = /[.!?](?=\s|$)/u.exec(words);
  const first = end === null ? words : words.slice(0, end.index + 1);
  const rest = end === null ? "" : words.slice(end.index + 1).trim();
  if (first.length <= HEADLINE_MAX) return { glyph, headline: first, body: rest };
  return { glyph, headline: clip(first, HEADLINE_MAX), body: words };
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
