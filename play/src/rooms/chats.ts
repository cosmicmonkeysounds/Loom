//! The guest's Chats window (wave 18, GUEST-SPEC §3): the rooms list cut
//! into fixed sections — Your move · Where you are · Messages · Rooms ·
//! Other rooms (n) — with the lobby, renamed the 📜 Chat log, always the
//! last row of Other rooms. Pure — `test/chats.test.ts`. The booth keeps
//! `SpaceList` + `foldRooms` as they were.

import type { Channel } from "../types.ts";

/** How long a quiet thread still counts as a conversation (story time). */
export const QUIET_MS = 15 * 60_000;

/** A crew's room (`crew:<id>`) the view no longer lists: dissolved, or left (A3). */
export function crewRoomGone(room: string, channels: ReadonlyArray<{ id: string }> | undefined): boolean {
  return room.startsWith("crew:") && channels !== undefined && !channels.some((c) => c.id === room);
}

/** The guest-side words for the lobby (G2). */
export const CHAT_LOG_TITLE = "Chat log";
export const CHAT_LOG_SUB = "Everything the house said tonight";

export type ChatSectionId = "move" | "here" | "messages" | "rooms";

export const CHAT_SECTION_TITLES: Record<ChatSectionId, string> = {
  move: "YOUR MOVE",
  here: "WHERE YOU ARE",
  messages: "MESSAGES",
  rooms: "ROOMS",
};

export interface ChatSection {
  id: ChatSectionId;
  title: string;
  channels: Channel[];
}

export interface ChatsContext {
  /** The story clock now (ms). */
  now: number;
  /** `GuestView.archived` (C11); undefined = an old server (the quiet rule). */
  archived?: ReadonlySet<string>;
  /** Rooms holding a live card for the guest. */
  cardRooms: ReadonlySet<string>;
}

export interface Chats {
  sections: ChatSection[];
  /** Under Other rooms (n), closed by default; the Chat log last. */
  other: Channel[];
}

function isPinned(c: Channel): boolean {
  return c.spaceId === "pinned" || c.kind === "codex" || c.kind === "quests" || c.kind === "wallet";
}

function isDm(c: Channel): boolean {
  return c.kind === "dm" || c.id.startsWith("dm:") || c.id.startsWith("pm:");
}

function lastTs(c: Channel): number {
  for (let i = c.messages.length - 1; i >= 0; i--) if (c.messages[i]!.ambient !== true) return c.messages[i]!.ts;
  return -Infinity;
}

/** The guest's one badge (§3.3): the room has something unread that is for them. */
export function guestDot(c: Pick<Channel, "id" | "unread">): boolean {
  return c.id !== "lobby" && c.unread > 0;
}

/** Is this thread archived for the guest (§3.2 rule 6)? */
export function isArchived(c: Channel, ctx: ChatsContext): boolean {
  if (!isDm(c) && ctx.archived === undefined) return false;
  if (guestDot(c) || ctx.cardRooms.has(c.id)) return false;
  if (ctx.archived !== undefined) return ctx.archived.has(c.id);
  if (c.agent === true) return false;
  return ctx.now - lastTs(c) > QUIET_MS;
}

/** Is it asking the guest something (a decision outside the lobby, a card)? */
function asks(c: Channel, ctx: ChatsContext): boolean {
  if (c.id === "lobby") return false;
  return (c.decision !== null && c.decision !== undefined) || c.needsYou === true || ctx.cardRooms.has(c.id);
}

/** Is this location empty, and so not in Chats at all (§3.2 rule 1)? */
function emptyPlace(c: Channel, ctx: ChatsContext): boolean {
  return c.kind === "location" && c.here !== true && (c.people?.length ?? 0) === 0 && !ctx.cardRooms.has(c.id);
}

/** The Chats window's sections (§3.2, first match wins per room). `list` is
 *  the session's sorted list; the order inside a section is kept. */
export function chatSections(list: readonly Channel[], ctx: ChatsContext): Chats {
  const out: Record<ChatSectionId, Channel[]> = { move: [], here: [], messages: [], rooms: [] };
  const other: Channel[] = [];
  let lobby: Channel | null = null;
  for (const c of list) {
    if (c.id === "lobby") {
      lobby = c;
      continue;
    }
    if (isPinned(c) || emptyPlace(c, ctx)) continue;
    if (asks(c, ctx)) out.move.push(c);
    else if (c.here === true) out.here.push(c);
    else if (isDm(c)) (c.agent === true || !isArchived(c, ctx) ? out.messages : other).push(c);
    else if (c.kind === "location") out.rooms.push(c);
    else if (ctx.archived?.has(c.id) === true && !guestDot(c)) other.push(c);
    else if (c.kind === "faction" || guestDot(c) || (c.member !== false && ctx.now - lastTs(c) <= QUIET_MS)) out.rooms.push(c);
    else other.push(c);
  }
  if (lobby !== null) other.push(lobby);
  const sections = (Object.keys(out) as ChatSectionId[]).filter((id) => out[id].length > 0).map((id) => ({ id, title: CHAT_SECTION_TITLES[id], channels: out[id] }));
  return { sections, other };
}

/** The Chats taskbar button's dot: any row in Chats has one. */
export function chatsDot(chats: Chats): boolean {
  return chats.sections.some((s) => s.channels.some(guestDot)) || chats.other.some(guestDot);
}

/** The fold's button: "Other rooms (6)". */
export function otherRoomsLabelOf(n: number): string {
  return `Other rooms (${n})`;
}
