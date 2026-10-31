//! The guest's navigation (wave 18, GUEST-SPEC §1.3, §6.3): which window is
//! on screen (Mission · Chats · Notifications), the room open over it, the
//! overlay (Pass, Scan, Me, Sides), and `go(nav)` — the one function every
//! exit in the app lands through (a moment's button, a Notifications row, a
//! push tap, Mission's Where row and Your move rows). `planGo` is pure: the
//! tests walk every nav kind through it (`test/nav.test.ts`), and
//! `useGuestNav` applies its plan to the threads + the overlay state.

import { useCallback, useMemo, useRef, useState } from "react";
import type { Threads } from "../rooms/threads-state.ts";
import { CODEX_ROOM, QUEST_LOG, WALLET_ROOM } from "../rooms/spaces.ts";
import type { ChatMessage } from "../types.ts";
import type { GuestWindowId, Nav } from "../moments/exits.ts";

export type GuestWindow = GuestWindowId;
export type GuestOverlay = "pass" | "scan" | "me" | "sides";

/** What `go` needs to know about the guest's app. */
export interface GoContext {
  /** Room ids the guest lists. */
  listed: ReadonlySet<string>;
  /** The window on screen now. */
  window: GuestWindow;
  /** Live `who: guest` interaction ids. */
  actions: ReadonlySet<string>;
  /** Interactions that arm before they fire (`arm: true`). */
  armed?: ReadonlySet<string>;
  /** Quest id → the seq of its thread root (its `start` card in the Quest Log). */
  questRoots: ReadonlyMap<string, number>;
  /** Wave 18b (D18): the lobby is hidden from guests: a nav to it lands on Notifications. */
  lobbyHidden?: boolean;
}

/** A `go`'s plan: what to change, in this order (pure). */
export interface GoPlan {
  window: GuestWindow;
  /** The room to open (null = close any room). */
  room: { id: string; focusSeq?: number; focusEntry?: string; thread?: number } | null;
  overlay?: GuestOverlay;
  /** Fire this guest interaction. */
  act?: string;
}

/** Where `go(nav)` lands (§6.3), as a plan: never the lobby, never a room
 *  the guest doesn't list (both → Mission), an `act` only while live (an
 *  `arm: true` one is pressed on Mission, where its button arms). */
export function planGo(nav: Nav, ctx: GoContext): GoPlan {
  const mission: GoPlan = { window: "mission", room: null };
  switch (nav.to) {
    case "mission":
    case "chats":
    case "notifications":
      return { window: nav.to, room: null };
    case "room":
      if (nav.id === "lobby") {
        if (ctx.lobbyHidden !== true) return mission;
        // A card a story dealt into the hidden lobby (a `show … to everyone`
        // from a rule with no setting) is still answerable: its own nav
        // (Mission's Your move, focusSeq) opens it there. Anything else
        // naming the lobby lands on Notifications (D18).
        return nav.focusSeq !== undefined ? { window: ctx.window, room: { id: "lobby", focusSeq: nav.focusSeq } } : { window: "notifications", room: null };
      }
      if (!ctx.listed.has(nav.id)) return mission;
      return { window: ctx.window, room: { id: nav.id, ...(nav.focusSeq !== undefined ? { focusSeq: nav.focusSeq } : {}) } };
    case "codex":
      if (!ctx.listed.has(CODEX_ROOM)) return mission;
      return { window: "mission", room: { id: CODEX_ROOM, ...(nav.entry !== undefined ? { focusEntry: nav.entry } : {}) } };
    case "quests": {
      if (!ctx.listed.has(QUEST_LOG)) return mission;
      const root = nav.quest !== undefined ? ctx.questRoots.get(nav.quest) : undefined;
      return { window: "mission", room: { id: QUEST_LOG, ...(root !== undefined ? { thread: root } : {}) } };
    }
    case "wallet":
      if (!ctx.listed.has(WALLET_ROOM)) return mission;
      return { window: "mission", room: { id: WALLET_ROOM } };
    case "pass":
    case "scan":
    case "me":
    case "sides":
      // over the window on screen, the room under it kept
      return { window: ctx.window, room: null, overlay: nav.to };
    case "act":
      if (!ctx.actions.has(nav.id)) return mission;
      if (ctx.armed?.has(nav.id) === true) return mission;
      return { window: ctx.window, room: null, act: nav.id };
  }
}

/** What is open on the guest's phone, for its own Back (wave 47). */
export interface GuestOpen {
  /** Wave 55: the read-aloud pop-up or the teleprompter is up. */
  aloud?: boolean;
  /** A moment on screen: `swallow` (a big, the takeover) or `dismiss` (a dialog). */
  moment: "swallow" | "dismiss" | null;
  /** A sheet over everything (a wallet sheet, Help, People, a share picker…), topmost first. */
  sheet: boolean;
  overlay: boolean;
  credits: boolean;
  /** The arrival stage or the lock screen: on rails, nothing behind it to step back to. */
  rails: boolean;
  room: boolean;
  /** A window other than Mission. */
  window: boolean;
}

/**
 * What one press of the phone's Back does (wave 47; pure, `test/w47-back.test.ts`).
 * The read-aloud pop-up outranks everything and stays (the teleprompter closes
 * back onto it). Then a moment: a big keeps Back (it never moves the view under it, so ✕ /
 * OK lands where the guest was); a dialog closes. Then a sheet, the overlay,
 * the credits; on the stage or the lock screen nothing (never leaving the
 * app mid-arrival or mid-capture); then the room, then the window → Mission.
 * Null at home: Back is the browser's again.
 */
export function guestBackStep(o: GuestOpen): "aloud" | "moment" | "sheet" | "overlay" | "credits" | "rails" | "room" | "window" | null {
  if (o.aloud === true) return "aloud";
  if (o.moment !== null) return "moment";
  if (o.sheet) return "sheet";
  if (o.overlay) return "overlay";
  if (o.credits) return "credits";
  if (o.rails) return "rails";
  if (o.room) return "room";
  if (o.window) return "window";
  return null;
}

/** Overlays keep the room under them; everything else replaces it. */
export function keepsRoom(plan: GoPlan): boolean {
  return plan.overlay !== undefined || plan.act !== undefined;
}

/** Quest id → its thread root's seq in the Quest Log (the `start` card). */
export function questRootsOf(messages: Iterable<ChatMessage>): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of messages) {
    if (m.channel !== QUEST_LOG || m.kind !== "quest" || m.quest === undefined || m.parentSeq != null) continue;
    const id = m.quest.quest;
    if (!out.has(id) || m.quest.action === "start") out.set(id, m.seq);
  }
  return out;
}

/** The taskbar's pressed window: the one on screen (with a room open, the
 *  one it was opened from); none while Notifications is up. */
export function pressedWindow(window: GuestWindow): "mission" | "chats" | null {
  return window === "notifications" ? null : window;
}

/** What a tap on the taskbar's Mission / Chats does (§1.2): the pressed one
 *  with a room open closes the room; otherwise go to that window, closing
 *  any room. Either way the window is `target` with no room. */
export function taskbarTap(target: "mission" | "chats"): GoPlan {
  return { window: target, room: null };
}

export interface GuestNav {
  window: GuestWindow;
  overlay: GuestOverlay | null;
  /** The card a room was opened on (Your move, an Answer exit). */
  focusSeq: number | null;
  /** The Codex entry a room was opened on. */
  focusEntry: string | null;
  setOverlay: (o: GuestOverlay | null) => void;
  /** Land on a nav (§6.3). `from` = the window it is taken from (a
   *  Notifications row's exit lands as if from Mission: the bin closes). */
  go: (nav: Nav, from?: GuestWindow) => void;
  /** Open a room from the window on screen (a Chats row, a tile). */
  openRoom: (id: string, from?: GuestWindow) => void;
  /** A room's ‹: back to the window it came from. */
  back: () => void;
  /** Mission / Chats on the taskbar. */
  tap: (target: "mission" | "chats") => void;
}

/** The guest's navigation state over the session's threads. `ctx` is read
 *  at call time (a ref), so `go` is stable across renders. */
export function useGuestNav(threads: Threads, ctx: () => Omit<GoContext, "window">, act: (id: string) => void): GuestNav {
  const [window, setWindow] = useState<GuestWindow>("mission");
  const [overlay, setOverlay] = useState<GuestOverlay | null>(null);
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const [focusEntry, setFocusEntry] = useState<string | null>(null);
  const t = useRef(threads);
  t.current = threads;
  const c = useRef(ctx);
  c.current = ctx;
  const w = useRef(window);
  w.current = window;
  const a = useRef(act);
  a.current = act;
  const apply = useCallback((plan: GoPlan) => {
    setWindow(plan.window);
    if (plan.overlay !== undefined) setOverlay(plan.overlay);
    else setOverlay(null);
    if (plan.act !== undefined) a.current(plan.act);
    if (keepsRoom(plan)) return;
    setFocusSeq(plan.room?.focusSeq ?? null);
    setFocusEntry(plan.room?.focusEntry ?? null);
    if (plan.room === null) {
      if (t.current.activeId !== null) t.current.back();
      return;
    }
    t.current.open(plan.room.id);
    if (plan.room.thread !== undefined) t.current.openThread(plan.room.thread);
  }, []);
  const go = useCallback((nav: Nav, from?: GuestWindow) => apply(planGo(nav, { ...c.current(), window: from ?? w.current })), [apply]);
  const openRoom = useCallback((id: string, from?: GuestWindow) => {
    if (from !== undefined) setWindow(from);
    setFocusSeq(null);
    setFocusEntry(null);
    t.current.open(id);
  }, []);
  const back = useCallback(() => {
    setFocusSeq(null);
    setFocusEntry(null);
    t.current.back();
  }, []);
  const tap = useCallback((target: "mission" | "chats") => apply(taskbarTap(target)), [apply]);
  return useMemo(
    () => ({ window, overlay, focusSeq, focusEntry, setOverlay, go, openRoom, back, tap }),
    [window, overlay, focusSeq, focusEntry, go, openRoom, back, tap],
  );
}
