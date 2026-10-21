//! Wave 18 (GUEST-SPEC §11, DECISIONS G7): the de-bloat rules, one test
//! each, against the real builders — the session's channels, the Chats
//! sections and window, the title bar, the tour, the Start menu.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TitleBar } from "../src/chrome/title-bar.tsx";
import { Taskbar } from "../src/chrome/taskbar.tsx";
import { ChatsWindow } from "../src/guest/chats.tsx";
import { guestStartItems, guestTaskbarButtons } from "../src/guest/frame.tsx";
import { missionOf } from "../src/guest/mission-model.ts";
import { memoryStore } from "../src/host.ts";
import { CHAT_LOG_SUB, CHAT_LOG_TITLE, chatSections } from "../src/rooms/chats.ts";
import { buildGuestChannels } from "../src/session/channels.ts";
import { requiredDecision } from "../src/session/guest.ts";
import { codexUnseen } from "../src/stream/codex-room.tsx";
import { tutorialSteps } from "../src/tutorial.tsx";
import type { Channel, ChatMessage, GuestView, ObjectiveView } from "../src/types.ts";

const STORY = "Trapped in the Internet";
const MIN = 60_000;
const noop = () => {};

function view(o: Record<string, unknown> = {}): GuestView {
  return {
    id: "g-1",
    name: "Winamp",
    title: STORY,
    role: null,
    faction: null,
    score: 0,
    location: "The Desktop",
    captured: false,
    pendingChoice: null,
    decisionChannel: null,
    channels: [
      { id: "loc:The Desktop", kind: "location", title: "The Desktop", spaceId: "story", member: true, canPost: true, threadable: true },
      { id: "loc:The CPU", kind: "location", title: "The CPU", spaceId: "story", member: true, canPost: true, threadable: true },
    ],
    spaces: [],
    roster: [],
    codexTotal: 5,
    codex: [],
    questTotal: 2,
    quests: [],
    clock: 100 * MIN,
    ...o,
  } as GuestView;
}

const line = (seq: number, channel: string, o: Partial<ChatMessage> = {}): ChatMessage => ({
  seq,
  channel,
  channelKind: channel === "lobby" ? "lobby" : channel.startsWith("loc:") ? "location" : "dm",
  title: channel,
  from: "Clippy",
  kind: "line",
  text: `line ${seq}`,
  ts: 100 * MIN - 60 * MIN,
  audience: ["g-1"],
  parentSeq: null,
  hidden: false,
  ...o,
});

function chatsOf(v: GuestView, messages: ChatMessage[], dock: { channel: string; decision: { title: string; options: [] } } | null = null) {
  const list = buildGuestChannels(new Map(messages.map((m) => [m.seq, m])), dock, v);
  return { list, chats: chatSections(list, { now: v.clock ?? 0, cardRooms: new Set() }) };
}

describe("§11 de-bloat rules", () => {
  it("1. Chats shows no pinned room, no empty place you don't stand in, never the story's title, never a number", () => {
    const { chats } = chatsOf(view(), [line(1, "lobby", { audience: "all", text: "📣 hello", alert: true })]);
    const ids = [...chats.sections.flatMap((s) => s.channels), ...chats.other].map((c) => c.id);
    expect(ids).not.toContain("codex");
    expect(ids).not.toContain("quests");
    expect(ids).not.toContain("loc:The CPU");
    expect(ids).toContain("loc:The Desktop");
    const out = renderToStaticMarkup(createElement(ChatsWindow, { chats, activeId: null, meId: "g-1", onOpen: noop }));
    expect(out).not.toContain(STORY);
    expect(out).not.toContain('class="badge"');
  });

  it("2. the Chat log is the last row of Other rooms: no preview, badge or dot, and no decision docks there", () => {
    const { list, chats } = chatsOf(view(), [line(1, "lobby", { audience: "all", text: "📣 the house said this" })]);
    const lobby = list.find((c) => c.id === "lobby")!;
    expect(lobby.title).toBe(CHAT_LOG_TITLE);
    expect(chats.other[chats.other.length - 1]!.id).toBe("lobby");
    // open the fold: the row reads the fixed line, never the house's words
    const out = renderToStaticMarkup(createElement(ChatsWindow, { chats, activeId: null, meId: "g-1", onOpen: noop }));
    expect(out).toContain("Other rooms (");
    const dock = requiredDecision({ ...view(), pendingChoice: ["Yes"], decisionChannel: "lobby" }, { choose: noop, escape: noop });
    expect(dock?.channel).toBe("mission");
    const docked = chatsOf(view(), [], dock as never);
    expect(docked.list.find((c) => c.id === "mission")).toBeUndefined();
    expect(docked.list.find((c) => c.id === "lobby")!.decision).toBeNull();
    expect(CHAT_LOG_SUB).toBe("Everything the house said tonight");
  });

  it("3. archived arrival threads (the server's list, else 15 quiet minutes) live under Other rooms", () => {
    const old = line(2, "dm:The Uploader", { ts: 100 * MIN - 40 * MIN });
    const { list } = chatsOf(view(), [old]);
    const quiet = chatSections(list, { now: 100 * MIN, cardRooms: new Set() });
    expect(quiet.other.map((c) => c.id)).toContain("dm:The Uploader");
    const listed = chatSections(list, { now: 100 * MIN, cardRooms: new Set(), archived: new Set(["dm:The Uploader"]) });
    expect(listed.other.map((c) => c.id)).toContain("dm:The Uploader");
  });

  it("4. a guest's badge is the dot; the Chats button shows a dot, never a number", () => {
    const out = renderToStaticMarkup(
      createElement(Taskbar, { start: [], buttons: guestTaskbarButtons({ now: null, pressed: "chats", chatsDot: true, missionNew: false, mission: noop, chats: noop, pass: noop, scan: noop }) }),
    );
    expect(out).toContain("taskbar-dot");
    expect(out).not.toContain("taskbar-badge");
    const row: Channel = { id: "pm:g-1:g-2", kind: "dm", title: "Ada", spaceId: "story", messages: [line(4, "pm:g-1:g-2")], unread: 3, decision: null, lastTs: 0 };
    const chats = renderToStaticMarkup(createElement(ChatsWindow, { chats: { sections: [{ id: "messages", title: "MESSAGES", channels: [row] }], other: [] }, activeId: null, meId: "g-1", onOpen: noop }));
    expect(chats).toContain("guest-dot");
    expect(chats).not.toContain(">3<");
  });

  it("5. the evergreen objective never shows as +1 and is never counted in Also now", () => {
    const bingo: ObjectiveView = { id: "bingo", title: "Bingo", brief: "", checklist: [{ label: "row", done: false }], buttons: [], act: null };
    const explore: ObjectiveView = { id: "explore", title: "Explore the computer", brief: "", checklist: [], buttons: [], act: null };
    const bar = renderToStaticMarkup(createElement(TitleBar, { objectives: [bingo, explore], fallback: "", onOpen: noop, sub: "📍 The Desktop" }));
    expect(bar).not.toMatch(/\+\d+ objective/u);
    expect(missionOf({ view: view({ objectives: [bingo, explore] }), list: [], cards: [], decision: null }).also).toEqual([]);
  });

  it("6. the Codex's NEW: an entry stays NEW until the Codex has shown it", () => {
    const entry = (seq: number, id: string): ChatMessage => ({ ...line(seq, "codex"), kind: "codex", codex: { entry: id, title: id, about: null, via: "code", from: null } });
    const store = memoryStore();
    expect(codexUnseen(store, "g-6", [entry(1, "a")])).toBe(true);
    const seen = memoryStore({ "loom.stream.codex-seen.g-7": ["a"] });
    expect(codexUnseen(seen, "g-7", [entry(1, "a")])).toBe(false);
    expect(codexUnseen(seen, "g-7", [entry(1, "a"), entry(2, "b")])).toBe(true);
  });

  it("7. the tour has five steps", () => {
    expect(tutorialSteps({ title: STORY, hasCodex: true, hasPeople: true, hasActions: true, hasObjectives: true, hasQuests: true, hasWallet: true, bathroom: "🚻" })).toHaveLength(5);
  });

  it("8. a house alert never previews on a Chats row (the Chat log reads its fixed line)", () => {
    const { chats } = chatsOf(view(), [line(1, "lobby", { audience: "all", text: "📣 ALL PROGRAMS: report to the Desktop.", alert: true })]);
    const lobby = chats.other.find((c) => c.id === "lobby")!;
    expect(lobby.subtitle).toBe(CHAT_LOG_SUB);
  });

  it("9. the Start menu: the story's buttons + at most five items", () => {
    const items = guestStartItems({
      name: "Winamp",
      faction: null,
      interactions: [{ id: "a", label: "🚻 Bathroom Mode", who: "guest", description: null }, { id: "b", label: "💾 Insert a disk", who: "guest", description: null }],
      sides: true,
      people: true,
      open: { act: noop, sides: noop, people: noop, notifications: noop, help: noop, leave: noop },
    });
    expect(items.filter((i) => !i.id.startsWith("act:")).length).toBeLessThanOrEqual(5);
  });
});
