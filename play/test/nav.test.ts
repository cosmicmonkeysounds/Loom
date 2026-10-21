//! Wave 18 (GUEST-SPEC §6.3–6.4): every exit kind lands exactly where it
//! says — the room, the DM, the pass, the scanner, the Codex entry, the
//! quest's thread, the Wallet, Chats, Mission, Notifications, Sides, Me and
//! a guest button — and never in the lobby.

import { describe, expect, it } from "vitest";
import { keepsRoom, planGo, pressedWindow, questRootsOf, taskbarTap, type GoContext } from "../src/guest/nav.ts";
import { navFromSearch, navOfTarget } from "../src/moments/exits.ts";
import type { ChatMessage } from "../src/types.ts";

const ctx = (o: Partial<GoContext> = {}): GoContext => ({
  listed: new Set(["lobby", "loc:The Desktop", "dm:Trabolta", "pm:g-1:g-2", "codex", "quests", "wallet"]),
  window: "chats",
  actions: new Set(["bathroom_mode", "self_destruct"]),
  armed: new Set(["self_destruct"]),
  questRoots: new Map([["bingo", 41]]),
  ...o,
});

describe("go(nav) lands exactly (§6.3)", () => {
  it("mission / chats / notifications: that window, the room closed", () => {
    for (const to of ["mission", "chats", "notifications"] as const) expect(planGo({ to }, ctx())).toEqual({ window: to, room: null });
  });

  it("a room: opens it over the window on screen, with the card focused", () => {
    expect(planGo({ to: "room", id: "loc:The Desktop" }, ctx())).toEqual({ window: "chats", room: { id: "loc:The Desktop" } });
    expect(planGo({ to: "room", id: "loc:The Desktop", focusSeq: 7 }, ctx({ window: "mission" }))).toEqual({ window: "mission", room: { id: "loc:The Desktop", focusSeq: 7 } });
  });

  it("a DM and a private thread are rooms too", () => {
    expect(planGo({ to: "room", id: "dm:Trabolta" }, ctx()).room).toEqual({ id: "dm:Trabolta" });
    expect(planGo({ to: "room", id: "pm:g-1:g-2" }, ctx()).room).toEqual({ id: "pm:g-1:g-2" });
  });

  it("never the lobby, never a room the guest doesn't list: Mission", () => {
    expect(planGo({ to: "room", id: "lobby" }, ctx())).toEqual({ window: "mission", room: null });
    expect(planGo({ to: "room", id: "loc:The Server Room" }, ctx())).toEqual({ window: "mission", room: null });
  });

  it("the pass and the scanner open over the window, keeping the room under them", () => {
    const pass = planGo({ to: "pass" }, ctx());
    expect(pass).toEqual({ window: "chats", room: null, overlay: "pass" });
    expect(keepsRoom(pass)).toBe(true);
    expect(planGo({ to: "scan" }, ctx({ window: "mission" })).overlay).toBe("scan");
  });

  it("the Codex, and a Codex entry, from Mission", () => {
    expect(planGo({ to: "codex" }, ctx())).toEqual({ window: "mission", room: { id: "codex" } });
    expect(planGo({ to: "codex", entry: "the-orientation-list" }, ctx())).toEqual({ window: "mission", room: { id: "codex", focusEntry: "the-orientation-list" } });
  });

  it("the Quest Log, and one quest's own thread", () => {
    expect(planGo({ to: "quests" }, ctx())).toEqual({ window: "mission", room: { id: "quests" } });
    expect(planGo({ to: "quests", quest: "bingo" }, ctx())).toEqual({ window: "mission", room: { id: "quests", thread: 41 } });
    // a quest with no card yet: the Log itself
    expect(planGo({ to: "quests", quest: "hunt" }, ctx())).toEqual({ window: "mission", room: { id: "quests" } });
  });

  it("the Wallet", () => {
    expect(planGo({ to: "wallet" }, ctx())).toEqual({ window: "mission", room: { id: "wallet" } });
  });

  it("a pinned room the story doesn't have: Mission", () => {
    const bare = ctx({ listed: new Set(["lobby"]) });
    for (const to of ["codex", "quests", "wallet"] as const) expect(planGo({ to }, bare)).toEqual({ window: "mission", room: null });
  });

  it("Me and Sides: their sheets over the window", () => {
    expect(planGo({ to: "me" }, ctx())).toEqual({ window: "chats", room: null, overlay: "me" });
    expect(planGo({ to: "sides" }, ctx())).toEqual({ window: "chats", room: null, overlay: "sides" });
  });

  it("a live guest button presses; an arm-first one lands on Mission; a dead one too", () => {
    const p = planGo({ to: "act", id: "bathroom_mode" }, ctx());
    expect(p.act).toBe("bathroom_mode");
    expect(keepsRoom(p)).toBe(true);
    expect(planGo({ to: "act", id: "self_destruct" }, ctx())).toEqual({ window: "mission", room: null });
    expect(planGo({ to: "act", id: "gone" }, ctx())).toEqual({ window: "mission", room: null });
  });
});

describe("the taskbar's windows (§1.2)", () => {
  it("pressed = the window on screen; none on Notifications", () => {
    expect(pressedWindow("mission")).toBe("mission");
    expect(pressedWindow("chats")).toBe("chats");
    expect(pressedWindow("notifications")).toBeNull();
  });
  it("Mission / Chats close any open room", () => {
    expect(taskbarTap("chats")).toEqual({ window: "chats", room: null });
  });
});

describe("a quest's thread root", () => {
  const q = (seq: number, quest: string, action: "start" | "update", parentSeq: number | null = null): ChatMessage =>
    ({ seq, channel: "quests", channelKind: "quests", title: "Quest Log", from: "", kind: "quest", text: "", ts: seq, audience: ["g-1"], parentSeq, hidden: false, quest: { quest, title: quest, action } }) as ChatMessage;
  it("is its start card", () => {
    expect(questRootsOf([q(3, "bingo", "start"), q(9, "bingo", "update", 3), q(12, "hunt", "start")])).toEqual(new Map([["bingo", 3], ["hunt", 12]]));
  });
});

describe("C2 targets → navs, and push links (§6.2, §6.4)", () => {
  const c = { listed: new Set(["loc:The Desktop", "dm:Trabolta", "codex"]), actions: new Set(["bathroom_mode"]), sides: false };
  it("maps every target kind", () => {
    expect(navOfTarget({ kind: "room", id: "loc:The Desktop", label: "" }, c)).toEqual({ to: "room", id: "loc:The Desktop" });
    expect(navOfTarget({ kind: "dm", id: "dm:Trabolta", label: "" }, c)).toEqual({ to: "room", id: "dm:Trabolta" });
    expect(navOfTarget({ kind: "room", id: "lobby", label: "" }, c)).toEqual({ to: "mission" });
    expect(navOfTarget({ kind: "room", id: "loc:Nowhere", label: "" }, c)).toBeNull();
    for (const kind of ["pass", "scan", "chats", "mission", "notifications", "wallet", "me"] as const) expect(navOfTarget({ kind, label: "" }, c)).toEqual({ to: kind });
    expect(navOfTarget({ kind: "sides", label: "" }, c)).toBeNull();
    expect(navOfTarget({ kind: "sides", label: "" }, { ...c, sides: true })).toEqual({ to: "sides" });
    expect(navOfTarget({ kind: "codex", entry: "x", label: "" }, c)).toEqual({ to: "codex", entry: "x" });
    expect(navOfTarget({ kind: "quests", quest: "q", label: "" }, c)).toEqual({ to: "quests", quest: "q" });
    expect(navOfTarget({ kind: "act", id: "bathroom_mode", label: "" }, c)).toEqual({ to: "act", id: "bathroom_mode" });
    expect(navOfTarget({ kind: "act", id: "nope", label: "" }, c)).toBeNull();
  });
  it("?room=lobby is Mission; a pinned room is itself; an unlisted room is Mission", () => {
    const listed = ["loc:The Desktop", "codex", "quests", "wallet"];
    expect(navFromSearch("?room=lobby", listed)).toEqual({ to: "mission" });
    expect(navFromSearch("?room=codex", listed)).toEqual({ to: "codex" });
    expect(navFromSearch("?room=quests", listed)).toEqual({ to: "quests" });
    expect(navFromSearch("?room=wallet", listed)).toEqual({ to: "wallet" });
    expect(navFromSearch("?room=loc%3AThe%20Desktop", listed)).toEqual({ to: "room", id: "loc:The Desktop" });
    expect(navFromSearch("?room=dm%3AClippy", listed)).toEqual({ to: "mission" });
    expect(navFromSearch("?code=X", listed)).toBeNull();
  });
});
