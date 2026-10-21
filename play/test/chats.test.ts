//! Wave 18 (GUEST-SPEC §3, §11 rules 1–4): the Chats window's sections, the
//! Chat log last, empty places hidden, archived arrival threads folded, and
//! one badge kind — a dot, for what is yours.

import { describe, expect, it } from "vitest";
import { CHAT_LOG_TITLE, chatSections, chatsDot, guestDot, type ChatsContext } from "../src/rooms/chats.ts";
import { guestDotOf } from "../src/stream/badges.ts";
import type { Channel, ChatMessage } from "../src/types.ts";

const MIN = 60_000;
const NOW = 100 * MIN;

function msg(seq: number, o: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel: "x", channelKind: "dm", title: "", from: "Someone", kind: "line", text: "hi", ts: NOW - MIN, audience: ["g-1"], parentSeq: null, hidden: false, ...o };
}

function ch(id: string, o: Partial<Channel> = {}): Channel {
  const kind = id === "lobby" ? "lobby" : id.startsWith("loc:") ? "location" : id.startsWith("dm:") || id.startsWith("pm:") ? "dm" : id === "codex" ? "codex" : id === "quests" ? "quests" : id === "wallet" ? "wallet" : "open";
  return { id, kind: kind as Channel["kind"], title: id, spaceId: kind === "codex" || kind === "quests" || kind === "wallet" ? "pinned" : "story", messages: [], unread: 0, decision: null, lastTs: 0, ...o };
}

const ctx = (o: Partial<ChatsContext> = {}): ChatsContext => ({ now: NOW, cardRooms: new Set(), ...o });

describe("chatSections", () => {
  const list = [
    ch("codex"),
    ch("quests"),
    ch("wallet"),
    ch("loc:The Desktop", { here: true, people: [{ id: "g-1", name: "Me", kind: "guest", group: null }] }),
    ch("dm:Trabolta", { agent: true, needsYou: true, messages: [msg(3)] }),
    ch("dm:Clippy", { messages: [msg(4)] }),
    ch("dm:The Uploader", { messages: [msg(1, { ts: NOW - 40 * MIN })] }),
    ch("pm:g-1:g-2", { unread: 1, messages: [msg(5)] }),
    ch("loc:The Start Bar", { people: [{ id: "g-3", name: "Ada", kind: "guest", group: null }] }),
    ch("loc:The CPU"),
    ch("room:truthcoin", { member: true, messages: [msg(6, { ts: NOW - 2 * MIN })] }),
    ch("room:general", { member: true, messages: [msg(2, { ts: NOW - 50 * MIN })] }),
    ch("faction:unlimited", { kind: "faction" }),
    ch("lobby", { title: CHAT_LOG_TITLE, unread: 3, decision: { title: "x", options: [] } }),
  ];

  it("cuts the list into the fixed sections, in order", () => {
    const { sections, other } = chatSections(list, ctx());
    expect(sections.map((s) => [s.title, s.channels.map((c) => c.id)])).toEqual([
      ["YOUR MOVE", ["dm:Trabolta"]],
      ["WHERE YOU ARE", ["loc:The Desktop"]],
      ["MESSAGES", ["dm:Clippy", "pm:g-1:g-2"]],
      ["ROOMS", ["loc:The Start Bar", "room:truthcoin", "faction:unlimited"]],
    ]);
    expect(other.map((c) => c.id)).toEqual(["dm:The Uploader", "room:general", "lobby"]);
  });

  it("rule 1: no pinned rooms, no empty place you don't stand in (unless it holds your card)", () => {
    const ids = (c: ChatsContext) => {
      const r = chatSections(list, c);
      return [...r.sections.flatMap((s) => s.channels), ...r.other].map((x) => x.id);
    };
    expect(ids(ctx())).not.toContain("codex");
    expect(ids(ctx())).not.toContain("wallet");
    expect(ids(ctx())).not.toContain("loc:The CPU");
    expect(ids(ctx({ cardRooms: new Set(["loc:The CPU"]) }))).toContain("loc:The CPU");
  });

  it("rule 2: the Chat log is always the last row, and the lobby never asks", () => {
    const { sections, other } = chatSections(list, ctx());
    expect(other[other.length - 1]!.id).toBe("lobby");
    expect(sections.flatMap((s) => s.channels).map((c) => c.id)).not.toContain("lobby");
    expect(guestDot(list[list.length - 1]!)).toBe(false);
  });

  it("rule 3: the server's archive list wins; a dot brings a thread back", () => {
    const archived = new Set(["dm:Clippy"]);
    expect(chatSections(list, ctx({ archived })).other.map((c) => c.id)).toContain("dm:Clippy");
    // …with no quiet rule then: The Uploader is not on the list, so it stays
    expect(chatSections(list, ctx({ archived })).sections.find((s) => s.id === "messages")!.channels.map((c) => c.id)).toContain("dm:The Uploader");
    const dotted = list.map((c) => (c.id === "dm:Clippy" ? { ...c, unread: 1 } : c));
    expect(chatSections(dotted, ctx({ archived })).sections.find((s) => s.id === "messages")!.channels.map((c) => c.id)).toContain("dm:Clippy");
  });

  it("the agent's DM never archives", () => {
    const quiet = [ch("dm:Trabolta", { agent: true, messages: [msg(1, { ts: 0 })] })];
    expect(chatSections(quiet, ctx()).sections[0]!.id).toBe("messages");
  });

  it("rule 4: the Chats button's dot is any row's dot", () => {
    expect(chatsDot(chatSections(list, ctx()))).toBe(true);
    expect(chatsDot(chatSections(list.map((c) => ({ ...c, unread: 0 })), ctx()))).toBe(false);
  });
});

describe("guestDotOf (§3.3)", () => {
  const me = { id: "g-1", name: "Winamp", booth: false };
  it("a card asking you, a pm line, the agent's line: a dot", () => {
    const card = msg(10, { kind: "widget", widget: { kind: "poll", text: "?", params: { options: "a|b" } } });
    expect(guestDotOf(ch("dm:Clippy", { needsYou: true, messages: [card] }), -1, me)).toBe(1);
    // answered (the room no longer needs you), or an overlay (the tour): no dot
    expect(guestDotOf(ch("dm:Clippy", { messages: [card] }), -1, me)).toBe(0);
    const tour = msg(13, { kind: "widget", widget: { kind: "tutorial", text: "", params: {} } });
    expect(guestDotOf(ch("dm:Clippy", { needsYou: true, messages: [tour] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("pm:g-1:g-2", { messages: [msg(11, { channel: "pm:g-1:g-2", from: "Ada" })] }), -1, me)).toBe(1);
    expect(guestDotOf(ch("dm:Trabolta", { agent: true, messages: [msg(12, { from: "Trabolta" })] }), -1, me)).toBe(1);
  });
  it("never a scripted readout, a house card, a notice, your own words, the Chat log", () => {
    expect(guestDotOf(ch("dm:Clippy", { messages: [msg(10, { from: "Clippy" })] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("dm:Clippy", { messages: [msg(10, { readout: true, from: "Clippy" })] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("loc:x", { messages: [msg(10, { kind: "widget", audience: "all", widget: { kind: "poll", text: "?", params: {} } })] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("pm:g-1:g-2", { messages: [msg(10, { notice: "✅", from: "Ada" })] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("pm:g-1:g-2", { messages: [msg(10, { from: "Winamp" })] }), -1, me)).toBe(0);
    expect(guestDotOf(ch("lobby", { messages: [msg(10, { kind: "widget", widget: { kind: "poll", text: "?", params: {} } })], decision: { title: "x", options: [] } }), -1, me)).toBe(0);
  });
  it("a decision outside the lobby is a dot; past the read mark nothing is", () => {
    expect(guestDotOf(ch("dm:Clippy", { decision: { title: "x", options: [] } }), -1, me)).toBe(1);
    expect(guestDotOf(ch("pm:g-1:g-2", { messages: [msg(11, { from: "Ada" })] }), 11, me)).toBe(0);
  });
});
