//! A big moment's text as glyph + headline + body (wave 18, GUEST-SPEC
//! §5.1) — also every Notifications row's title. Its own tiny module: the
//! big window (`big.tsx`, `big-model.ts`) loads lazily, the rows do not.

import { noticeKey } from "../../../core/src/delivery.ts";
import type { Moment } from "./model.ts";

/** A glyph without its variation selector (🛡️ and 🛡 are one glyph). */
export function bareGlyph(g: string): string {
  return g.replace(/[︎️]/gu, "");
}

/** The kicker's virus and quarantine glyphs (`big-model.ts` `kickerOf`). */
export const VIRUS: ReadonlySet<string> = new Set(["🛡", "🚨"]);
export const QUARANTINE: ReadonlySet<string> = new Set(["🌐", "⛔", "🔒"]);

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


/** Where a personal big sits in the capture chain (recheck BN2-FB / NMR-1):
 *  found (🛡 CORRUPTION DETECTED), sent (🌐 Sent to the Internet), released
 *  (🦆 Reinstallation complete, 🕺 out of the Internet). Null otherwise. */
export type CaptureStage = "found" | "sent" | "released";

export function captureStage(m: Pick<Moment, "text" | "kind" | "severity"> & Partial<Pick<Moment, "house" | "card">>): CaptureStage | null {
  if (m.severity !== "big" || m.house === true || m.kind === "card" || m.card !== undefined) return null;
  const g = bareGlyph(bigParts(m.text, m.kind).glyph);
  if (VIRUS.has(g)) return "found";
  if (QUARANTINE.has(g)) return "sent";
  if (g === "🦆" || g === "🕺" || /reinstallation complete|out of the internet/iu.test(m.text)) return "released";
  return null;
}

/**
 * The queued capture bigs that are no longer true: a found / sent big with
 * a newer one in the chain after it (the capture, the release, a second
 * confrontation), and a sent big once a view newer than it says the guest
 * is not captured (a director's release with no line of its own). Never a
 * big from the same drain as the view (2 s of slack).
 */
export function staleCaptureKeys(
  queued: readonly Pick<Moment, "key" | "seq" | "at" | "text" | "kind" | "severity" | "house" | "card">[],
  chain: readonly { seq: number }[],
  view: { captured?: boolean | undefined; clock?: number | undefined },
): string[] {
  const newest = chain.reduce((n, c) => Math.max(n, c.seq), -Infinity);
  const out: string[] = [];
  for (const q of queued) {
    const stage = captureStage(q);
    if (stage !== "found" && stage !== "sent") continue;
    if (q.seq !== null && q.seq < newest) out.push(q.key);
    else if (stage === "sent" && view.captured === false && view.clock !== undefined && view.clock > q.at + 2_000) out.push(q.key);
  }
  return out;
}
