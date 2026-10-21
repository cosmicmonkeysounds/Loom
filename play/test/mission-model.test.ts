//! Wave 18 (GUEST-SPEC §2, §11 rule 5): Mission's model — the Where row,
//! the promoted card, Your move, the tiles, Also now, the evergreen rule.

import { describe, expect, it } from "vitest";
import { MISSION_DOCK_ID, countdownText, evergreenOf, freeRoamOf, missionOf, whereRowOf, type MissionInput } from "../src/guest/mission-model.ts";
import { MISSION_DOCK } from "../src/session/guest.ts";
import type { Channel, ChatMessage, GuestView, ObjectiveView } from "../src/types.ts";

const obj = (id: string, o: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: id, brief: "", checklist: [], buttons: [], act: null, ...o });

function view(o: Partial<GuestView> & Record<string, unknown> = {}): GuestView {
  return { id: "g-1", name: "Winamp", role: null, faction: null, score: 0, location: "The Desktop", captured: false, pendingChoice: null, decisionChannel: null, channels: [], spaces: [], roster: [], ...o } as GuestView;
}

function ch(id: string, o: Partial<Channel> = {}): Channel {
  return { id, kind: id.startsWith("loc:") ? "location" : "dm", title: id.replace(/^\w+:/, ""), spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...o };
}

const card = (seq: number, channel: string, kind = "fact"): ChatMessage =>
  ({ seq, channel, channelKind: "dm", title: "", from: "Trabolta", kind: "widget", text: "", ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, widget: { kind, text: "", params: {} } }) as ChatMessage;

const input = (o: Partial<MissionInput> = {}): MissionInput => ({ view: view(), list: [ch("loc:The Desktop", { title: "The Desktop (living room)" }), ch("loc:The CPU")], cards: [], decision: null, ...o });

describe("the evergreen rule (§2.1, rule 5)", () => {
  it("the last of two or more with no to-dos; never shown in Also now", () => {
    const bingo = obj("bingo", { checklist: [{ label: "a", done: false }] });
    const explore = obj("explore");
    expect(evergreenOf([bingo, explore])).toBe(explore);
    expect(evergreenOf([explore])).toBeNull();
    const m = missionOf(input({ view: view({ objectives: [bingo, obj("hunt", { checklist: [{ label: "x", done: null }] }), explore] }) }));
    expect(m.also.map((o) => o.id)).toEqual(["hunt"]);
  });
  it("the server's flag wins (A7)", () => {
    const flagged = { ...obj("explore", { checklist: [{ label: "a", done: false }] }), evergreen: true } as ObjectiveView;
    expect(evergreenOf([flagged, obj("b")])).toBe(flagged);
    expect(freeRoamOf([flagged])).toBe(true);
  });
  it("free roam = only the evergreen is live", () => {
    const m = missionOf(input({ view: view({ objectives: [obj("🧭 Explore the computer")] }) }));
    expect(m.freeRoam).toBe(true);
    expect(m.glyph).toBe("🧭");
    expect(m.also).toEqual([]);
  });
});

describe("the Where row (§2.1)", () => {
  const listed = new Set(["loc:The Desktop", "loc:The CPU"]);
  const titles = new Map([["loc:The Desktop", "The Desktop (living room)"]]);
  it("here: YOU'RE HERE, not a button", () => {
    expect(whereRowOf({ location: "The Desktop", mission: { objective: "x", place: { id: "loc:The Desktop", name: "The Desktop" } } }, listed, titles)).toEqual({ kind: "here", name: "The Desktop (living room)" });
  });
  it("elsewhere: a button to the room", () => {
    expect(whereRowOf({ location: "The CPU", mission: { objective: "x", place: { id: "The Desktop", name: "The Desktop" } } }, listed, titles)).toEqual({ kind: "go", name: "The Desktop (living room)", nav: { to: "room", id: "loc:The Desktop" } });
  });
  it("a word: that exit's button", () => {
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "sides", name: "sides" } } }, listed, titles)).toMatchObject({ kind: "word", word: "sides", label: "🚪 Choose a side", nav: { to: "sides" } });
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "scan", name: "Check in" } } }, listed, titles)).toMatchObject({ kind: "word", label: "📷 Check in", nav: { to: "scan" } });
  });
  it("core's other place ids: a Codex entry, a quest, a guest button (C11)", () => {
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "codex:the-door-sign", name: "Read the sign" } } }, listed, titles)).toMatchObject({ label: "📓 Read the sign", nav: { to: "codex", entry: "the-door-sign" } });
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "quests:bingo", name: "quests:bingo" } } }, listed, titles)).toMatchObject({ label: "📜 See the quest", nav: { to: "quests", quest: "bingo" } });
    const interactions = [{ id: "bathroom_mode", label: "🚻 Bathroom Mode", who: "guest" as const, description: null }];
    expect(whereRowOf({ location: null, interactions, mission: { objective: "x", place: { id: "bathroom_mode", name: "Bathroom Mode" } } }, listed, titles)).toMatchObject({ label: "🚻 Bathroom Mode", nav: { to: "act", id: "bathroom_mode" } });
  });

  it("no mission field, no place, the lobby or a room not listed: no row", () => {
    expect(whereRowOf({ location: null }, listed, titles)).toBeNull();
    expect(whereRowOf({ location: null, mission: { objective: null, place: null } }, listed, titles)).toBeNull();
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "lobby", name: "Lobby" } } }, listed, titles)).toBeNull();
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "loc:Hidden", name: "Hidden" } } }, listed, titles)).toBeNull();
  });
  it("captured: the Internet is somewhere to go, never 'YOU'RE HERE' (GN-F3)", () => {
    const l = new Set([...listed, "loc:The Internet"]);
    const t = new Map([...titles, ["loc:The Internet", "The Internet (Reinstallation — backyard)"]]);
    const mission = { objective: "x", place: { id: "loc:The Internet", name: "The Internet" } };
    expect(whereRowOf({ location: "The Internet", captured: true, mission }, l, t)).toMatchObject({ kind: "go", nav: { to: "room", id: "loc:The Internet" } });
    expect(whereRowOf({ location: "The Internet", captured: false, mission }, l, t)).toMatchObject({ kind: "here" });
  });
  it("a DM target says Open, never Go to (GN-F18)", () => {
    const l = new Set([...listed, "dm:Trabolta"]);
    expect(whereRowOf({ location: null, mission: { objective: "x", place: { id: "dm:Trabolta", name: "Trabolta" } } }, l, titles)).toMatchObject({ kind: "go", dm: true });
  });
  it("📷 Check in goes once every to-do is ticked (GN-F11)", () => {
    const mission = { objective: "summons", place: { id: "scan", name: "Check in" } };
    const open = missionOf(input({ view: view({ objectives: [obj("summons", { checklist: [{ label: "Checked in", done: false }] })], mission }) }));
    expect(open.where).toMatchObject({ kind: "word", word: "scan" });
    const done = missionOf(input({ view: view({ objectives: [obj("summons", { checklist: [{ label: "Checked in", done: true }] })], mission }) }));
    expect(done.where).toBeNull();
  });
  it("a standing condition (no to-dos, no buttons) is a strip, never folded under Also now (NM-F1)", () => {
    const m = missionOf(input({ view: view({ objectives: [obj("summons", { checklist: [{ label: "a", done: false }] }), obj("You Are Marked", { brief: "Carry on." }), obj("hunt", { checklist: [{ label: "x", done: null }] }), obj("explore")] }) }));
    expect(m.strips.map((o) => o.id)).toEqual(["You Are Marked"]);
    expect(m.also.map((o) => o.id)).toEqual(["hunt"]);
  });
  it("the objective's button the row already is, is not repeated", () => {
    const m = missionOf(input({ view: view({ objectives: [obj("summons", { buttons: ["scan", "pass"] })], mission: { objective: "summons", place: { id: "scan", name: "Check in" } } }) }));
    expect(m.buttons).toEqual(["pass"]);
  });
});

describe("Your move (§2.1 part 2)", () => {
  it("the newest card is the first big button; the rest are rows, newest first", () => {
    const list = [ch("dm:Trabolta", { title: "Trabolta", messages: [card(30, "dm:Trabolta"), card(50, "dm:Trabolta", "poll")] }), ch("dm:Clippy", { title: "Clippy" })];
    const m = missionOf(input({ list, cards: [{ glyph: "📝", channel: "dm:Trabolta", seq: 30 }, { glyph: "📊", channel: "dm:Trabolta", seq: 50 }] }));
    expect(m.cardButton?.nav).toEqual({ to: "room", id: "dm:Trabolta", focusSeq: 50 });
    expect(m.cardButton?.label).toMatch(/^📊 .* · in Trabolta$/u);
    expect(m.moves.map((x) => x.key)).toEqual(["card:30"]);
  });
  it("a lobby-docked decision renders on Mission; one in a room is a row", () => {
    const decision = { title: "Your move…", options: [] };
    expect(missionOf(input({ decision: { channel: MISSION_DOCK_ID, decision } })).decision).toBe(decision);
    const inRoom = missionOf(input({ list: [ch("dm:Task Manager", { title: "Task Manager" })], decision: { channel: "dm:Task Manager", decision } }));
    expect(inRoom.decision).toBeNull();
    expect(inRoom.moves[0]!.text).toBe("▶ Task Manager is asking you something");
  });
  it("invites, coin requests to you and dotted chats", () => {
    const wallet = { name: "Truthcoin", balance: 100, escrowed: 0, maxTransfer: 50, transfers: [], offers: [], requests: [{ id: "r1", from: "g-2", fromName: "Ada", to: "g-1", toName: "Winamp", amount: 5, state: "open", expiresAt: 0, at: 9 }] };
    const m = missionOf(
      input({
        view: view({ wallet, invites: [{ id: "i1", from: "g-2", fromName: "Excel", kind: "side", target: "up", targetName: "Unlimited Power" }] } as never),
        list: [ch("pm:g-1:g-2", { title: "Ada", unread: 1, messages: [{ seq: 4 } as ChatMessage] })],
      }),
    );
    expect(m.moves.map((x) => x.text)).toEqual(["🚪 Excel wants you in Unlimited Power", "🪙 Ada asks for 5 Truthcoin", "💬 Ada replied to you"]);
    expect(m.moves[0]!.action.kind).toBe("invite");
    expect(m.tiles.find((t) => t.id === "wallet")!.status).toBe("100 · 1 waiting");
  });
  it("at most four rows, then + n more", () => {
    const list = Array.from({ length: 6 }, (_, i) => ch(`pm:g-1:g-${i + 2}`, { unread: 1, messages: [{ seq: i } as ChatMessage] }));
    const m = missionOf(input({ list }));
    expect(m.moves).toHaveLength(4);
    expect(m.moreMoves).toBe(2);
  });
});

describe("the tiles (§2.1 part 3)", () => {
  it("only the ones the story has, never a number badge", () => {
    expect(missionOf(input()).tiles).toEqual([]);
    const m = missionOf(input({ view: view({ questTotal: 3, quests: [{ id: "a", title: "A", giver: null, status: "active" }], codexTotal: 9, codex: [{ id: "x" } as never] }), codexUnseen: true, list: [ch("quests", { kind: "quests", spaceId: "pinned", unread: 2 })] }));
    expect(m.tiles.map((t) => [t.id, t.status, t.dot])).toEqual([
      ["quests", "1 active", true],
      ["codex", "1 found", true],
    ]);
  });
});

describe("the countdown line", () => {
  it("m:ss, h mm, stopped", () => {
    expect(countdownText(1122, false)).toBe("⏳ 18:42 left");
    expect(countdownText(3900, false)).toBe("⏳ 1h 05m left");
    expect(countdownText(10, true)).toBe("⏸ stopped");
  });
  it("the session's dock id is Mission's", () => {
    expect(MISSION_DOCK).toBe(MISSION_DOCK_ID);
  });
});
