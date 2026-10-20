//! The pinned rooms: the Quest Log (each quest a card whose steps are its
//! thread) and the Codex (entries as cards, a composer that takes codes) sit
//! above every other room, in a fixed order, and stay out of a cutscene.

import { describe, expect, it } from "vitest";

import { buildGuestChannels, isPinnedRoom, personalStream } from "../src/session.ts";
import { questStatusOf, questSummary } from "../src/threads.ts";
import type { ChatMessage, GuestView } from "../src/types.ts";

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "lobby", title: channel, from: "", kind: "line", text: `m${seq}`, ts: seq, audience: ["me"], parentSeq: null, hidden: false, ...extra };
}
function quest(seq: number, action: "start" | "update" | "complete" | "fail", parentSeq: number | null = null): ChatMessage {
  return msg(seq, "quests", { channelKind: "quests", kind: "quest", from: "Clippy", parentSeq, quest: { quest: "The Hunt", title: "The Hunt", action } });
}
function view(extra: Partial<GuestView> = {}): GuestView {
  return {
    id: "me",
    name: "Me",
    role: null,
    faction: null,
    score: 0,
    location: null,
    captured: false,
    pendingChoice: null,
    decisionChannel: null,
    channels: [],
    spaces: [],
    roster: [],
    codex: [{ id: "a", title: "A", about: null, text: "" }],
    codexTotal: 12,
    quests: [
      { id: "The Hunt", title: "The Hunt", giver: "Clippy", status: "active" },
      { id: "The Keys", title: "The Keys", giver: null, status: "done" },
    ],
    questTotal: 3,
    ...extra,
  };
}

describe("pinned rooms", () => {
  it("a story without a codex or quests has no pinned rooms", () => {
    const list = buildGuestChannels(new Map(), null, view({ codexTotal: 0, questTotal: 0, codex: [], quests: [] }));
    expect(list.map((c) => c.id)).toEqual(["lobby"]);
  });

  it("a quest's status is read off its thread; the log summarises", () => {
    const thread = [quest(1, "start"), quest(2, "update", 1), quest(5, "start"), quest(6, "fail", 5)];
    expect(questStatusOf(thread, 1)).toBe("active");
    expect(questStatusOf([...thread, quest(7, "complete", 1)], 1)).toBe("done");
    expect(questStatusOf(thread, 5)).toBe("failed");
    expect(questSummary([])).toBe("no quests yet");
    expect(questSummary([{ status: "active" }, { status: "failed" }])).toBe("1 active · 1 failed");
  });

  it("a cutscene shows what was said to you, never your log or your codex", () => {
    const messages = new Map<number, ChatMessage>([
      [1, msg(1, "dm:Uploader")],
      [2, quest(2, "start")],
      [3, msg(3, "codex", { channelKind: "codex", kind: "codex", codex: { entry: "a", title: "A", about: null, via: "story", from: null } })],
    ]);
    expect(personalStream(messages, "me").map((m) => m.seq)).toEqual([1]);
    expect(isPinnedRoom("codex")).toBe(true);
    expect(isPinnedRoom("quests")).toBe(true);
    expect(isPinnedRoom("lobby")).toBe(false);
  });
});
