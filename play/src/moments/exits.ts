//! Moment exits (wave 18, the moments lane; GUEST-SPEC §6, CONTRACTS C2):
//! the buttons every moment offers, from every surface — a balloon, a sticky,
//! a dialog, a blue screen, a big moment, a Notifications row, a push tap.
//! A moment says where it goes as a `Nav` (a place in the guest app); the
//! guest lane's `go(nav)` (`guest/nav.ts`) lands there. Pure — tested in
//! `test/moments-exits.test.ts`.
//!
//! The one rule the user asked for in so many words: an exit never lands on
//! the lobby (the room named after the story, the far-away Chat log). With no
//! better target a moment's exit is Mission ("What do I do?").

import { noticeKey } from "../../../core/src/delivery.ts";
import type { IconName } from "../chrome/icons.tsx";
import type { GoTarget } from "../types.ts";
import type { Moment } from "./model.ts";

// --- the wire type -------------------------------------------------------------

/** A moment's button, as the server sends it (`ChatMessage.go`, CONTRACTS C2),
 *  already resolved per viewer: core's own shape (`../types.ts`). */
export type { GoTarget } from "../types.ts";

// --- where an exit goes ----------------------------------------------------------

/** A place in the guest app (`guest/nav.ts` `go` lands there). */
export type Nav =
  | { to: "mission" }
  | { to: "chats" }
  | { to: "notifications" }
  | { to: "me" }
  | { to: "sides" }
  /** A `loc:` / channel / `dm:` / `pm:` id the guest lists; `focusSeq` opens that card. */
  | { to: "room"; id: string; focusSeq?: number }
  | { to: "pass" }
  | { to: "scan" }
  | { to: "codex"; entry?: string }
  | { to: "quests"; quest?: string }
  | { to: "wallet" }
  /** A live `who: guest` INTERACTION, pressed through the arm model. */
  | { to: "act"; id: string };

/** One button a moment offers. */
export interface Exit {
  label: string;
  icon: IconName | null;
  nav: Nav;
}

/** A live card waiting on the viewer: its glyph, its room, its seq. */
export interface LiveCard {
  glyph: string;
  channel: string;
  seq: number;
}

/** A direct-message room the viewer has, for an announcement that sends them to it. */
export interface DmRoom {
  id: string;
  title: string;
  /** Its newest message's seq (-1 when empty). */
  last: number;
}

/** The guest app's three windows (`guest/nav.ts`). */
export type GuestWindowId = "mission" | "chats" | "notifications";

/** What the guest app knows when it resolves exits (`guest/nav.ts` `exitContext()`). */
export interface ExitContext {
  /** Room ids the guest lists (`t.list`). */
  listed: ReadonlySet<string>;
  /** Room id → title. */
  titles: ReadonlyMap<string, string>;
  /** The room on screen (null when none). */
  open: string | null;
  window: GuestWindowId;
  cards: readonly LiveCard[];
  dms: readonly DmRoom[];
  /** Live guest INTERACTION ids. */
  actions: ReadonlySet<string>;
  /** `GuestView.sides` is non-empty. */
  sides: boolean;
  /** Labels of the live guest INTERACTIONs (an `act` exit with no server label). */
  actionLabels?: ReadonlyMap<string, string>;
  /** The guest is on a side already: a `sides` exit is "Sides", never "Choose a side". */
  sideChosen?: boolean;
}

/** The far-away Chat log (the room named after the story): never an exit. */
export const LOBBY = "lobby";

/** A stable key for a nav (deduplication). */
export function navKey(n: Nav): string {
  switch (n.to) {
    case "room":
      return `room:${n.id}${n.focusSeq !== undefined ? `#${n.focusSeq}` : ""}`;
    case "codex":
      return `codex:${n.entry ?? ""}`;
    case "quests":
      return `quests:${n.quest ?? ""}`;
    case "act":
      return `act:${n.id}`;
    default:
      return n.to;
  }
}

/** A room title without its "(…)" gloss: "The Desktop (living room)" → "The Desktop". */
export function plainTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*$/u, "").trim() || title.trim();
}

function shorten(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** The icon an exit carries (§6.2 table). */
export function exitIcon(n: Nav): IconName | null {
  switch (n.to) {
    case "mission":
      return "start";
    case "chats":
      return "reply";
    case "notifications":
      return "bell";
    case "me":
      return "people";
    case "sides":
      return "defect";
    case "room":
      if (n.focusSeq !== undefined) return null;
      return n.id.startsWith("loc:") ? "pin" : "reply";
    case "pass":
      return "pass";
    case "scan":
      return "scan";
    case "codex":
      return "codex";
    case "quests":
      return "quest";
    case "wallet":
      return "coin";
    case "act":
      return null;
  }
}

/**
 * An exit's default label (§6.2 table), when the server gave none. `glyph`
 * is a card's leading glyph (a `room` + `focusSeq` exit reads "📊 Answer ›");
 * `entryTitle` a codex entry's title.
 */
export function exitLabel(n: Nav, ctx: Pick<ExitContext, "titles"> & Partial<Pick<ExitContext, "actionLabels" | "sideChosen">>, extra: { glyph?: string; entryTitle?: string } = {}): string {
  switch (n.to) {
    case "mission":
      return "What do I do?";
    case "chats":
      return "Chats";
    case "notifications":
      return "See all";
    case "me":
      return "Me";
    case "sides":
      return ctx.sideChosen === true ? "Sides" : "Choose a side";
    case "room": {
      if (n.focusSeq !== undefined) return `${extra.glyph !== undefined && extra.glyph !== "•" ? `${extra.glyph} ` : ""}Answer ›`;
      const title = ctx.titles.get(n.id) ?? n.id.replace(/^(?:loc|dm|pm):/u, "");
      return n.id.startsWith("loc:") ? `Go to ${plainTitle(title)} ›` : `Open ${title} ›`;
    }
    case "pass":
      return "Show my pass";
    case "scan":
      return "Scan";
    case "codex":
      return n.entry !== undefined ? `Read "${shorten(extra.entryTitle ?? n.entry, 24)}"` : "Open the Codex";
    case "quests":
      return n.quest !== undefined ? "See the quest" : "Open the Quest Log";
    case "wallet":
      return "Open my Wallet";
    case "act":
      return ctx.actionLabels?.get(n.id) ?? n.id;
  }
}

/**
 * A server `GoTarget` as a `Nav` for this guest, or null to drop it: a room
 * they don't list, an `act` that isn't live, `sides` before there are any.
 * The lobby is never a destination: its target is Mission.
 */
export function navOfTarget(t: GoTarget, ctx: Pick<ExitContext, "listed" | "actions" | "sides">): Nav | null {
  switch (t.kind) {
    case "room":
    case "dm":
      if (t.id === LOBBY) return { to: "mission" };
      return ctx.listed.has(t.id) ? { to: "room", id: t.id } : null;
    case "codex":
      return t.entry !== undefined && t.entry !== "" ? { to: "codex", entry: t.entry } : { to: "codex" };
    case "quests":
      return t.quest !== undefined && t.quest !== "" ? { to: "quests", quest: t.quest } : { to: "quests" };
    case "act":
      return ctx.actions.has(t.id) ? { to: "act", id: t.id } : null;
    case "sides":
      return ctx.sides ? { to: "sides" } : null;
    case "pass":
    case "scan":
    case "chats":
    case "mission":
    case "notifications":
    case "wallet":
    case "me":
      return { to: t.kind };
    default:
      return null;
  }
}

/** "Check your messages", "read your DMs", "see your inbox". */
const TO_MESSAGES = /\b(?:check|read|open|see)\s+(?:your\s+)?(?:messages|inbox|dms?|direct messages)\b/iu;

function foldWords(s: string): string {
  return ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
}

/**
 * The DM a moment sends the viewer to ("📥 TRUTHER DOWNLOAD received. Check
 * your messages."): one that tells them to check their messages goes to the
 * DM it names (the longest name that appears in it, word for word), else to
 * the DM that heard last. Null for anything else.
 */
export function namedDm(text: string, dms: readonly DmRoom[]): string | null {
  if (!TO_MESSAGES.test(text) || dms.length === 0) return null;
  const said = foldWords(text);
  let named: DmRoom | null = null;
  for (const d of dms) {
    const t = foldWords(d.title);
    if (t.trim() !== "" && said.includes(t) && (named === null || d.title.length > named.title.length)) named = d;
  }
  if (named !== null) return named.id;
  let newest: DmRoom | null = null;
  for (const d of dms) if (d.last >= 0 && (newest === null || d.last > newest.last)) newest = d;
  return newest?.id ?? null;
}

/** What a moment's exits need of it. */
export type ExitMoment = Pick<Moment, "text" | "kind" | "channel" | "seq"> & Partial<Pick<Moment, "go" | "card" | "pass" | "entry" | "quest" | "alarm">>;

export interface ExitOptions {
  /** The moment is a big one whose card renders inline: its card is no exit. */
  inlineCard?: boolean;
  /** A big moment whose card is not inline: "{glyph} Open the card ›". */
  big?: boolean;
  /** Codex entry id → title, for "Read "…"". */
  entryTitles?: ReadonlyMap<string, string>;
}

/**
 * The exits a moment offers (§6.2), in order, deduplicated by nav, cut to
 * `max` (a balloon 1, every other surface 2):
 * 1. the story's `go:` targets (the server's own labels win);
 * 2. the moment's own card ("{glyph} Answer ›"; inline inside a big);
 * 3. a live card whose glyph leads the text (an announcement about it);
 * 4. its own room — the Codex, the Quest Log, the Wallet, a listed room —
 *    never the lobby;
 * 5. the DM a "check your messages" line names;
 * 6. Mission ("What do I do?"), unless Mission is on screen already.
 * The room already open is never an exit.
 */
export function exitsOf(m: ExitMoment, ctx: ExitContext, max: 1 | 2, opts: ExitOptions = {}): Exit[] {
  const out: Exit[] = [];
  const seen = new Set<string>();
  const add = (nav: Nav | null, label?: string, extra: { glyph?: string; entryTitle?: string } = {}) => {
    if (nav === null) return;
    if (nav.to === "room" && nav.id === ctx.open) return;
    if (nav.to === "room" && nav.id === LOBBY) return;
    const k = navKey(nav);
    if (seen.has(k)) return;
    seen.add(k);
    const entryTitle = nav.to === "codex" && nav.entry !== undefined ? opts.entryTitles?.get(nav.entry) : undefined;
    out.push({ label: label !== undefined && label.trim() !== "" ? label : exitLabel(nav, ctx, { ...extra, ...(entryTitle !== undefined ? { entryTitle } : {}) }), icon: exitIcon(nav), nav });
  };
  // 1. The story's own buttons (a guest on a side already is never asked to choose one).
  for (const t of m.go ?? []) add(navOfTarget(t, ctx), t.kind === "sides" && ctx.sideChosen === true ? undefined : t.label);
  // The loud "show your pass" objective.
  if (m.pass === true) add({ to: "pass" });
  // 2. Its own card.
  if (m.kind === "card" && m.seq !== null && m.channel !== null && !opts.inlineCard && ctx.listed.has(m.channel) && m.channel !== LOBBY) {
    const glyph = m.card?.glyph ?? noticeKey(m.text);
    if (opts.big === true) add({ to: "room", id: m.channel, focusSeq: m.seq }, `${glyph !== "•" ? `${glyph} ` : ""}Open the card ›`);
    else add({ to: "room", id: m.channel, focusSeq: m.seq }, undefined, { glyph });
  }
  // 3. A live card this announcement is about (its glyph leads the text).
  if (m.kind !== "card") {
    const glyph = noticeKey(m.text);
    let card: LiveCard | undefined;
    if (glyph !== "•") for (const c of ctx.cards) if (c.glyph === glyph && ctx.listed.has(c.channel) && (card === undefined || c.seq > card.seq)) card = c;
    if (card !== undefined) add({ to: "room", id: card.channel, focusSeq: card.seq }, undefined, { glyph });
  }
  // 4. Its own room.
  const ch = m.channel;
  if (ch === "codex") add(m.entry !== undefined ? { to: "codex", entry: m.entry } : { to: "codex" });
  else if (ch === "quests") add(m.quest !== undefined ? { to: "quests", quest: m.quest } : { to: "quests" });
  else if (ch === "wallet") add({ to: "wallet" });
  else if (ch !== null && ch !== LOBBY && ctx.listed.has(ch)) add({ to: "room", id: ch });
  // 5. "Check your messages".
  const dm = namedDm(m.text, ctx.dms);
  if (dm !== null && ctx.listed.has(dm)) add({ to: "room", id: dm });
  // 6. Mission.
  if (!(ctx.window === "mission" && ctx.open === null)) add({ to: "mission" });
  // A big moment or an alarm is never left without a way to go (NM-F1):
  // "What do I do?" even on Mission (it lands on the NOW card).
  if (out.length === 0 && (opts.big === true || m.alarm === true)) {
    seen.delete("mission");
    add({ to: "mission" });
  }
  return out.slice(0, max);
}

/**
 * Where a link's `?room=` (a push tap, the service worker's `open-room`
 * message) lands: the lobby → Mission; the Codex / Quest Log / Wallet →
 * those; a listed room → that room; any other → Mission. Null when the link
 * names no room at all.
 */
export function navFromRoom(room: string | null, listed: Iterable<string>): Nav | null {
  if (room === null) return null;
  const id = room.trim();
  if (id === "") return null;
  if (id === LOBBY) return { to: "mission" };
  if (id === "codex") return { to: "codex" };
  if (id === "quests") return { to: "quests" };
  if (id === "wallet") return { to: "wallet" };
  for (const l of listed) if (l === id) return { to: "room", id };
  return { to: "mission" };
}

/** `navFromRoom` for a page's query string (`?room=…`). */
export function navFromSearch(search: string, listed: Iterable<string>): Nav | null {
  let room: string | null = null;
  try {
    room = new URLSearchParams(search).get("room");
  } catch {
    room = null;
  }
  return navFromRoom(room, listed);
}
