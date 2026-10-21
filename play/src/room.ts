//! Notification deep links (SW-PLAY-20). Every push carries `/?room=<id>`
//! (a server channel id, or `scanner` for a booth's scan readouts). A tap
//! with no play window open opens that link; with one open, the service
//! worker posts `{type: "open-room", room}` to it instead (a navigate would
//! reload the page and drop what's in memory). Either way the session opens
//! the room once its backlog is in — and only a room this participant
//! lists, so a link can never reveal a room the story hasn't opened.
//! Pure helpers — unit-tested in `test/room.test.ts`.
//!
//! Wave 18 (GUEST-SPEC §6.4): a guest's link lands through the moments'
//! exit type — `navFromSearch` / `navFromMessage` give the `Nav` the guest
//! app's `go` takes: the lobby → Mission, the Codex / Quest Log / Wallet →
//! those, a listed room → that room, anything else → Mission. The booth's
//! mapping (`roomTarget`) is unchanged.

import { navFromRoom, type Nav } from "./moments/exits.ts";

export { navFromRoom, navFromSearch } from "./moments/exits.ts";

/** The service worker's message to an open window. */
export const OPEN_ROOM = "open-room";

/** The room riding a notification's link (`?room=…`), or null. */
export function roomFromSearch(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get("room");
    return v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}

/** A notification link's own params (`room`, `go`, `entry`, `quest`) as a
 *  query string, or null when the page carries none. */
export function linkFromSearch(search: string): string | null {
  try {
    const p = new URLSearchParams(search);
    const out = new URLSearchParams();
    for (const k of ["room", "go", "entry", "quest"]) {
      const v = p.get(k)?.trim() ?? "";
      if (v !== "") out.set(k, v);
    }
    return out.has("room") || out.has("go") ? `?${out.toString()}` : null;
  } catch {
    return null;
  }
}

/** The link in a service-worker message: its whole `link` query (wave 18),
 *  else the old `room` alone; null for anything else. */
export function linkFromMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { type?: unknown; link?: unknown };
  if (d.type === OPEN_ROOM && typeof d.link === "string") {
    const l = linkFromSearch(d.link);
    if (l !== null) return l;
  }
  const room = roomFromMessage(data);
  return room !== null ? `?room=${encodeURIComponent(room)}` : null;
}

/** `search` without its link params (so a reload doesn't jump again). */
export function withoutRoom(search: string): string {
  const p = new URLSearchParams(search);
  p.delete("room");
  p.delete("go");
  p.delete("entry");
  p.delete("quest");
  const s = p.toString();
  return s === "" ? "" : `?${s}`;
}

/** The room in a service-worker message, or null for anything else. */
export function roomFromMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { type?: unknown; room?: unknown };
  return d.type === OPEN_ROOM && typeof d.room === "string" && d.room.trim() !== "" ? d.room.trim() : null;
}

/** A booth names some rooms its own way: the broadcast feed, the Scanner
 *  thread (readouts), an agent's private `cast:` thread. */
function boothRoom(room: string): string {
  if (room === "lobby") return "__feed";
  if (room === "scanner") return "__scanner";
  if (room.startsWith("dm:")) return `cast:${room.slice(3)}`;
  return room;
}

/** The thread to open for a linked room, or null when this participant
 *  doesn't list it (hidden, never theirs, or someone else's link). */
export function roomTarget(room: string, listed: readonly string[], booth: boolean): string | null {
  // A booth's link to the lobby (every `!` broadcast) lands on the booth's
  // home, never the far-away Chat log (NM-F6).
  if (booth && room === "lobby") return null;
  const id = booth ? boothRoom(room) : room;
  return listed.includes(id) ? id : null;
}

/** On a wide screen the app opens a home room when none is open — unless a
 *  link is waiting to open its own room: both fire in the same commit once
 *  the backlog is in, and the home default (which runs last) would win. */
export function opensHome(signedIn: boolean, wide: boolean, activeId: string | null, home: string | null, linkPending: boolean): boolean {
  return signedIn && wide && activeId === null && home !== null && !linkPending;
}

/** A guest's landing for the service worker's `open-room` message (null for anything else). */
export function navFromMessage(data: unknown, listed: Iterable<string>): Nav | null {
  return navFromRoom(roomFromMessage(data), listed);
}
