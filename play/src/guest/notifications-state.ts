//! The Notifications window's state (wave 18, GUEST-SPEC §4), the eager
//! part: what is unread (the bell's count), the read mark, and what the
//! guest deleted (both kept per sign-in in host storage,
//! `loom.notif.read.<token>` / `loom.notif.deleted.<token>`). The rows, the
//! exits and the gags are the lazy window's (`notification-rows.ts`).

import { useCallback, useMemo, useState } from "react";
import type { SessionStorage } from "../host.ts";
import type { ChatMessage } from "../types.ts";


export function deletedKey(token: string): string {
  return `loom.notif.deleted.${token}`;
}
export function readKey(token: string): string {
  return `loom.notif.read.${token}`;
}

/** How many rows past the read mark (the bell's count), without building
 *  the rows (the window, lazily, does that): every moment and personal `~`
 *  notice past it, and each new glyph + phase of house `~` notices. */
export function unreadNotes(messages: Iterable<ChatMessage>, me: { id: string; name: string }, mark: number): number {
  let n = 0;
  const folds = new Set<string>();
  for (const m of messages) {
    if (m.seq <= mark || m.parentSeq != null || m.hidden || m.ambient === true || m.takeover === true) continue;
    if (m.moment !== undefined || m.alert === true) {
      n++;
      continue;
    }
    if (m.notice === undefined) continue;
    const personal = (Array.isArray(m.audience) && m.audience.includes(me.id) && m.channel !== "lobby") || (me.name !== "" && m.text.includes(me.name));
    if (personal) n++;
    else folds.add(`${m.notice}:${typeof m.phase === "string" ? m.phase : ""}`);
  }
  return n + folds.size;
}

/** The newest seq a row could come from (where "read" moves the mark to). */
export function topSeq(messages: Iterable<ChatMessage>): number {
  let top = -1;
  for (const m of messages) if (m.seq > top) top = m.seq;
  return top;
}

function loadList(storage: SessionStorage, key: string): string[] {
  try {
    const v = storage.load<unknown>(key);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function loadMark(storage: SessionStorage, key: string): number {
  try {
    const v = storage.load<unknown>(key);
    return typeof v === "number" ? v : -1;
  } catch {
    return -1;
  }
}

export interface GuestNotifications {
  unread: number;
  /** The read mark (rows past it are unread). */
  mark: number;
  /** What the guest deleted. */
  deleted: ReadonlySet<string>;
  markRead: () => void;
  remove: (keys: readonly string[]) => void;
}

/** The marks for one sign-in. */
export function useGuestNotifications(o: {
  messages: ReadonlyMap<number, ChatMessage>;
  me: { id: string; name: string; token: string } | null;
  storage: SessionStorage;
}): GuestNotifications {
  const token = o.me?.token ?? null;
  const fresh = () => ({
    token,
    deleted: new Set(token !== null ? loadList(o.storage, deletedKey(token)) : []) as ReadonlySet<string>,
    mark: token !== null ? loadMark(o.storage, readKey(token)) : -1,
  });
  const [held, setHeld] = useState(fresh);
  const cur = held.token === token ? held : fresh();
  if (held.token !== token) setHeld(cur);
  const meId = o.me?.id ?? "";
  const meName = o.me?.name ?? "";
  const unread = useMemo(() => (meId === "" ? 0 : unreadNotes(o.messages.values(), { id: meId, name: meName }, cur.mark)), [o.messages, meId, meName, cur.mark]);
  const top = useMemo(() => topSeq(o.messages.values()), [o.messages]);
  const markRead = useCallback(() => {
    setHeld((h) => {
      if (top <= h.mark) return h;
      if (h.token !== null) {
        try {
          o.storage.save(readKey(h.token), top);
        } catch {
          /* the mark lives for this visit */
        }
      }
      return { ...h, mark: top };
    });
  }, [top, o.storage]);
  const remove = useCallback(
    (keys: readonly string[]) => {
      if (keys.length === 0) return;
      setHeld((h) => {
        const next = new Set(h.deleted);
        for (const k of keys) next.add(k);
        if (h.token !== null) {
          try {
            o.storage.save(deletedKey(h.token), [...next].slice(-2000));
          } catch {
            /* fine */
          }
        }
        return { ...h, deleted: next };
      });
    },
    [o.storage],
  );
  return { unread, mark: cur.mark, deleted: cur.deleted, markRead, remove };
}
