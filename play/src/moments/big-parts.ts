//! A big moment's text as glyph + headline + body (wave 18, GUEST-SPEC
//! §5.1) — also every Notifications row's title. Its own tiny module: the
//! big window (`big.tsx`, `big-model.ts`) loads lazily, the rows do not.

import { noticeKey } from "../../../core/src/delivery.ts";
import type { Moment } from "./model.ts";

/** A headline is at most this many characters. */
export const HEADLINE_MAX = 90;

/** The fallback glyph for a moment kind. */
function kindGlyph(kind: Moment["kind"]): string {
  switch (kind) {
    case "card":
      return "🃏";
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
export function bigParts(text: string, kind: Moment["kind"] = "other"): { glyph: string; headline: string; body: string } {
  const t = text.trim();
  const lead = noticeKey(t);
  const glyph = lead !== "•" ? lead : kindGlyph(kind);
  const words = (lead !== "•" ? t.replace(/^["'`]+/u, "").trimStart().slice(lead.length) : t).trim();
  const end = /[.!?](?=\s|$)/u.exec(words);
  const first = end === null ? words : words.slice(0, end.index + 1);
  const rest = end === null ? "" : words.slice(end.index + 1).trim();
  if (first.length <= HEADLINE_MAX) return { glyph, headline: first, body: rest };
  return { glyph, headline: clip(first, HEADLINE_MAX), body: words };
}

