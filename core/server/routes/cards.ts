//! Wave 14 — the **scan-from-the-screen cards** (`GET /api/mod/cards`, the
//! `/cards` page): every QR a director would otherwise print — room check-in
//! signs, codex fact posters, the join poster and the reserved programs'
//! invitations — with its QR drawn here as an SVG, so a laptop or the TV
//! can show it full screen for a phone to scan.
//!
//! It builds nothing new: the links are exactly `/api/mod/codes`' (the
//! codex `?unlock=` links, the claims) plus `printExtras` (the join link,
//! the check-in signs, the fact stacks). Pure apart from the QR drawing.

import QRCode from "qrcode";
import { CLUE_STACK, type CodexStack, type PrintExtras } from "./k12.ts";

export interface CardItem {
  /** Stable per card (`room:<slug>`, `fact:<id>`, …) — the page keys its ✓ on it. */
  ref: string;
  title: string;
  sub?: string;
  /** The code a guest could type instead (absent for a digit note: title + QR only). */
  code?: string;
  url: string;
  svg: string;
  /** The fact stack's pile name (`hunt answers`, `shelf`, …). */
  stack?: string;
  colour?: string;
  /** A `secret: true` codex entry (the digit notes, the hunt answers). */
  secret?: boolean;
  /** A `hidden: true` room: its sign works once the story opens it. */
  hidden?: boolean;
}

export interface CardSection {
  kind: "rooms" | "facts" | "join" | "invitations";
  label: string;
  items: CardItem[];
}

export interface CardsResponse {
  title: string;
  eventPass: string;
  sections: CardSection[];
}

export interface CardCodex {
  id: string;
  title: string;
  about: string | null;
  code: string | null;
  url: string;
  secret: boolean;
}

export interface CardsInput {
  title: string;
  eventPass: string;
  codex: CardCodex[];
  extras: PrintExtras;
  claims: { character: string; url: string }[];
}

/** The print sheet's pile order: gold → green → blue → red → silver → the
 *  rest → unplaced (`editor/src/lib/print-sheet.ts` `stackRank`). */
const COLOUR_RANK = ["gold", "green", "blue", "red", "silver"];
function stackRank(s: CodexStack | null): number {
  if (s === null) return COLOUR_RANK.length + 1;
  const i = COLOUR_RANK.indexOf(s.colour);
  return i === -1 ? COLOUR_RANK.length : i;
}

/** QR SVGs by link — the links never change for an event, so a refetch is free. */
const svgCache = new Map<string, string>();
const SVG_CACHE_MAX = 1000;

export async function qrSvg(text: string): Promise<string> {
  const hit = svgCache.get(text);
  if (hit !== undefined) return hit;
  const svg = await QRCode.toString(text, { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  if (svgCache.size >= SVG_CACHE_MAX) svgCache.clear();
  svgCache.set(text, svg);
  return svg;
}

export async function buildCards(input: CardsInput): Promise<CardsResponse> {
  const { extras } = input;
  const stackOf = (id: string): CodexStack | null => (Object.hasOwn(extras.stacks, id) ? extras.stacks[id]! : null);

  const rooms: CardItem[] = await Promise.all(
    extras.checkin.map(async (r) => ({
      ref: `room:${r.slug}`,
      title: r.label,
      sub: r.hidden ? "check in · opens later in the story" : "check in",
      url: r.url,
      svg: await qrSvg(r.url),
      ...(r.hidden ? { hidden: true } : {}),
    })),
  );

  // `sort` is stable: model order holds within a pile.
  const codex = [...input.codex].sort((a, b) => stackRank(stackOf(a.id)) - stackRank(stackOf(b.id)));
  const facts: CardItem[] = await Promise.all(
    codex.map(async (e) => {
      const stack = stackOf(e.id);
      const digit = stack?.stack === CLUE_STACK;
      const sub = [stack?.stack, stack?.where, e.about !== null ? `about ${e.about}` : null].filter((s): s is string => typeof s === "string" && s !== "").join(" · ");
      return {
        ref: `fact:${e.id}`,
        title: e.title,
        ...(sub !== "" ? { sub } : {}),
        ...(digit || e.code === null ? {} : { code: e.code }),
        url: e.url,
        svg: await qrSvg(e.url),
        ...(stack !== null ? { stack: stack.stack, colour: stack.colour } : {}),
        ...(e.secret ? { secret: true } : {}),
      };
    }),
  );

  const join: CardItem[] = [{ ref: "join", title: "Scan to join", sub: "pick who you are", code: input.eventPass, url: extras.joinLink, svg: await qrSvg(extras.joinLink) }];

  const invitations: CardItem[] = await Promise.all(
    input.claims.map(async (c) => ({ ref: `claim:${c.character}`, title: c.character, sub: "invitation · reserved program", url: c.url, svg: await qrSvg(c.url) })),
  );

  const sections: CardSection[] = [
    { kind: "rooms", label: "Rooms", items: rooms },
    { kind: "facts", label: "Facts", items: facts },
    { kind: "join", label: "Join", items: join },
  ];
  if (invitations.length > 0) sections.push({ kind: "invitations", label: "Invitations", items: invitations });
  return { title: input.title, eventPass: input.eventPass, sections };
}
