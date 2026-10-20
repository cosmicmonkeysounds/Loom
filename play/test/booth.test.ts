//! The performer's booth rooms (wave 4, lane D): the character's own
//! pinned Quest Log / Codex (rows addressed `@<me>`), the Inbox (cards the
//! story deals to the character), and the pending-card bubble shared with
//! the guest's rooms.

import { describe, expect, it } from "vitest";

import { INBOX, buildPrimeChannels, hasPendingCard } from "../src/session.ts";
import { groupBySpace } from "../src/threads.ts";
import type { ChatMessage, PrimeView } from "../src/types.ts";

let seq = 0;
function msg(channel: string, audience: string[] | "all", extra: Partial<ChatMessage> = {}): ChatMessage {
  seq += 1;
  return { seq, channel, from: "", kind: "line", text: `m${seq}`, ts: seq * 1000, audience, parentSeq: null, ...extra } as ChatMessage;
}
function poll(channel: string, audience: string[]): ChatMessage {
  return msg(channel, audience, { kind: "widget", widget: { kind: "poll", text: "Approve?", params: { options: "Yes | No" } } });
}
function view(over: Partial<PrimeView> = {}): PrimeView {
  return {
    character: "Clippy",
    faction: null,
    guests: [{ id: "g-1", name: "Ada", faction: null, captured: false, location: null }],
    channels: [],
    spaces: [],
    agents: [{ id: "Trabolta", online: true }],
    codex: [{ id: "A", title: "A", about: null, text: "a" }, { id: "B", title: "B", about: null, text: "b" }],
    codexTotal: 5,
    quests: [{ id: "Run The Bingo", title: "Bingo", giver: "Task Manager", status: "active" }],
    questTotal: 2,
    ...over,
  } as PrimeView;
}
function store(list: ChatMessage[]): Map<number, ChatMessage> {
  return new Map(list.map((m) => [m.seq, m]));
}

describe("the booth's pinned rooms", () => {
  it("Quest Log + Codex hold only this character's rows, read-only, under Pinned", () => {
    const list = [
      msg("quests", ["@Clippy"], { kind: "quest" }),
      msg("quests", ["@Norton"], { kind: "quest" }),
      msg("quests", ["g-1"], { kind: "quest" }),
      msg("codex", ["@Clippy"], { kind: "codex" }),
      msg("codex", ["g-1"], { kind: "codex" }),
    ];
    const chans = buildPrimeChannels(store(list), view());
    const quests = chans.find((c) => c.id === "quests")!;
    const codex = chans.find((c) => c.id === "codex")!;
    expect(quests).toMatchObject({ kind: "quests", title: "Quest Log", spaceId: "pinned", canPost: false, threadable: true, order: 0 });
    expect(quests.messages.map((m) => m.audience)).toEqual([["@Clippy"]]);
    expect(quests.subtitle).toContain("1");
    expect(codex).toMatchObject({ kind: "codex", title: "Codex", spaceId: "pinned", canPost: false, threadable: false, order: 1, subtitle: "2 of 5 found" });
    expect(codex.messages.map((m) => m.audience)).toEqual([["@Clippy"]]);
    // The sidebar sections: Pinned on top, then the booth tools.
    expect(groupBySpace(chans).map((g) => g.id)).toEqual(["pinned", "booth", "story", "cast", "guests"]);
    // The fixed order: scanner, inbox, feed, the pinned rooms, rooms, cast, guests.
    expect(chans.map((c) => c.id)).toEqual(["__scanner", INBOX, "__feed", "quests", "codex", "cast:Trabolta", "guest:g-1"]);
  });

  it("a story with no quests / no codex shows no pinned room", () => {
    const chans = buildPrimeChannels(store([msg("quests", ["@Clippy"], { kind: "quest" })]), view({ questTotal: 0, codexTotal: 0 }));
    expect(chans.some((c) => c.id === "quests" || c.id === "codex")).toBe(false);
    expect(chans.map((c) => c.id)).toEqual(["__scanner", INBOX, "__feed", "cast:Trabolta", "guest:g-1"]);
  });

  it("the guest view's shape is untouched when there is no view yet", () => {
    const chans = buildPrimeChannels(store([]), null);
    expect(chans.map((c) => c.id)).toEqual(["__scanner", INBOX, "__feed"]);
  });
});

describe("the booth's Readouts (was Inbox) + pending cards", () => {
  it("the Inbox holds `dm:<me>` rows addressed `@<me>`, and needs you while a card is unanswered", () => {
    const list = [
      msg("dm:Clippy", ["g-1"]), // a guest's thread with Clippy: the guest conversation, not the Inbox
      msg("dm:Clippy", ["@Clippy"]),
      poll("dm:Clippy", ["@Clippy"]),
      poll("dm:Norton", ["@Norton"]),
    ];
    const card = list[2]!;
    const chans = buildPrimeChannels(store(list), view());
    const inbox = chans.find((c) => c.id === INBOX)!;
    // Wave 13: the Inbox is "Readouts" (readouts + cards); no readout yet → its hint.
    expect(inbox).toMatchObject({ kind: "dm", title: "Readouts", spaceId: "booth", order: 1, needsYou: true });
    expect(inbox.subtitle).toBe("what your scans and buttons said");
    expect(inbox.messages.map((m) => m.seq)).toEqual([list[1]!.seq, card.seq]);
    // Answered → calm.
    const calm = buildPrimeChannels(store(list), view(), new Set([card.seq])).find((c) => c.id === INBOX)!;
    expect(calm.needsYou).toBe(false);
    // The guest's own thread with Clippy still lists every message addressed to the guest.
    expect(chans.find((c) => c.id === "guest:g-1")!.messages.map((m) => m.seq)).toEqual([list[0]!.seq]);
  });

  it("a card in a Cast thread (`with thread: <Agent>`) bubbles that thread up until answered", () => {
    const list = [msg("dm:Trabolta", ["@Clippy"]), poll("dm:Trabolta", ["@Clippy"]), poll("dm:Trabolta", ["@Norton"])];
    const card = list[1]!;
    const cast = buildPrimeChannels(store(list), view()).find((c) => c.id === "cast:Trabolta")!;
    expect(cast.messages.map((m) => m.seq)).toEqual([list[0]!.seq, card.seq]);
    expect(cast.needsYou).toBe(true);
    expect(buildPrimeChannels(store(list), view(), new Set([card.seq])).find((c) => c.id === "cast:Trabolta")!.needsYou).toBe(false);
  });

  it("`hasPendingCard` is the one rule both apps share: answerable, unanswered, and not superseded", () => {
    const a = poll("dm:Clippy", ["@Clippy"]);
    expect(hasPendingCard([a], new Set())).toBe(true);
    expect(hasPendingCard([a], new Set([a.seq]))).toBe(false);
    expect(hasPendingCard([msg("dm:Clippy", ["@Clippy"])], new Set())).toBe(false);
    // An un-answerable kind never counts.
    const image = msg("dm:Clippy", ["@Clippy"], { kind: "widget", widget: { kind: "image", text: "", params: { src: "x" } } });
    expect(hasPendingCard([image], new Set())).toBe(false);
  });
});

describe("a restricted guest in the booth (wave 4, lane E)", () => {
  it("the guest row's subtitle ends with ⛔ restricted", () => {
    const chans = buildPrimeChannels(store([]), view({ guests: [{ id: "g-1", name: "Ada", faction: null, captured: false, restricted: true, location: null }] }));
    expect(chans.find((c) => c.id === "guest:g-1")!.subtitle).toBe("unaligned · ⛔ restricted");
    const plain = buildPrimeChannels(store([]), view());
    expect(plain.find((c) => c.id === "guest:g-1")!.subtitle).toBe("unaligned");
  });
});
