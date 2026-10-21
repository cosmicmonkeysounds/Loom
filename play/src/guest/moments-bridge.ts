//! The guest lane's bridge to the moments lane (wave 18, GUEST-SPEC §6).
//! The moments lane writes `moments/exits.ts` (`exitsOf`, `navOfTarget`,
//! `navFromSearch`) in parallel; their names and signatures are the spec's
//! (§6.1). This file declares the spec's types (`Nav`, `Exit`,
//! `ExitContext`) verbatim and feature-detects that module
//! (`import.meta.glob` finds nothing when a file isn't there yet), falling
//! back to a local copy of the rule, so the guest app builds and is tested
//! on either side of the merge. The exits themselves and the Notifications
//! rows live in `notification-rows.ts` (the lazy Notifications chunk: only
//! that window reads them in the guest app).

import type { IconName } from "../chrome/icons.tsx";
import type { DmRoom, LiveCard, Moment } from "../moments/model.ts";
import type { GoTarget } from "./wire.ts";

// --- the shared types (§6.1) -------------------------------------------------

export type Nav =
  | { to: "mission" }
  | { to: "chats" }
  | { to: "notifications" }
  | { to: "me" }
  | { to: "sides" }
  | { to: "room"; id: string; focusSeq?: number }
  | { to: "pass" }
  | { to: "scan" }
  | { to: "codex"; entry?: string }
  | { to: "quests"; quest?: string }
  | { to: "wallet" }
  | { to: "act"; id: string };

export interface Exit {
  label: string;
  icon: IconName | null;
  nav: Nav;
}

export type GuestWindowId = "mission" | "chats" | "notifications";

export interface ExitContext {
  /** Room ids the guest lists. */
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
  /** Interaction id → its label (for an `act` exit's words). */
  actionLabels?: ReadonlyMap<string, string>;
}

/** A moment as the exits read it: the moments lane's `Moment`, plus the
 *  wave 18 fields it may carry. */
export type ExitMoment = Pick<Moment, "channel" | "text" | "kind" | "severity" | "seq"> & {
  go?: readonly GoTarget[];
  card?: { seq: number; kind: string } | null;
};

/** A stable key for a nav (dedupe). */
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

// --- push links (§6.4) ----------------------------------------------------------

const PINNED: Record<string, Nav> = { codex: { to: "codex" }, quests: { to: "quests" }, wallet: { to: "wallet" } };

/** A push link's `?room=` (§6.4): the lobby → Mission, a pinned room → it, a
 *  listed room → it, an unlisted one → Mission; no `room` → null. */
export function localNavFromSearch(search: string, listed: readonly string[]): Nav | null {
  let room: string | null = null;
  try {
    const v = new URLSearchParams(search).get("room");
    room = v !== null && v.trim() !== "" ? v.trim() : null;
  } catch {
    room = null;
  }
  if (room === null) return null;
  if (room === "lobby") return { to: "mission" };
  if (PINNED[room] !== undefined) return PINNED[room]!;
  return listed.includes(room) ? { to: "room", id: room } : { to: "mission" };
}

interface SearchModule {
  navFromSearch: (search: string, listed: readonly string[]) => Nav | null;
}
const theirs = Object.values(import.meta.glob("../moments/exits.ts", { eager: true }))[0] as Partial<SearchModule> | undefined;
export const navFromSearch: SearchModule["navFromSearch"] = typeof theirs?.navFromSearch === "function" ? theirs.navFromSearch : localNavFromSearch;
