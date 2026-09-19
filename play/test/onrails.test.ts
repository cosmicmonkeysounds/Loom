//! The gentler first minutes: rooms are listed only once the story opens
//! them (the snapshot decides), an agent-voiced character's chat is on
//! the sidebar the moment they are in the directory, the cutscene shows
//! exactly what was said to you, and the tutorial card walks the app.

import { describe, expect, it } from "vitest";

import { buildGuestChannels, isListedRoom, pendingWidget, personalStream } from "../src/session.ts";
import { tourResult, tutorialSteps } from "../src/tutorial.tsx";
import type { ChannelSnapshot, ChatMessage, GuestView, PersonCard } from "../src/types.ts";
import { WIDGETS } from "../src/widgets.tsx";

function msg(seq: number, channel: string, audience: ChatMessage["audience"], extra: Partial<ChatMessage> = {}): ChatMessage {
  const kind: ChatMessage["channelKind"] = channel.startsWith("loc:") ? "location" : channel.startsWith("room:") ? "open" : channel.startsWith("dm:") ? "dm" : "lobby";
  return { seq, channel, channelKind: kind, title: channel, from: "X", kind: "line", text: `m${seq}`, ts: seq, audience, parentSeq: null, hidden: false, ...extra };
}
function snap(id: string, kind = id.startsWith("loc:") ? "location" : "open"): ChannelSnapshot {
  return { id, kind, title: id, spaceId: "story", member: false, canPost: true, threadable: true };
}
function person(id: string, agent?: { online: boolean }): PersonCard {
  return { id, name: id, kind: "character", faction: null, known: [], location: null, ...(agent ? { agent } : {}) };
}
function view(channels: ChannelSnapshot[], people: PersonCard[] = []): GuestView {
  return { id: "me", name: "Me", role: null, faction: null, score: 0, location: "Hall", captured: false, pendingChoice: null, decisionChannel: null, channels, spaces: [], roster: [], people } as unknown as GuestView;
}

describe("which rooms are listed", () => {
  it("a place or authored room is listed only when the snapshot lists it — its lines wait, then appear with it", () => {
    const messages = new Map<number, ChatMessage>([
      [1, msg(1, "loc:Hall", "all")],
      [2, msg(2, "loc:Cellar", "all")], // delivered (public) but the Cellar is hidden for me
      [3, msg(3, "room:ram", "all")],
      [4, msg(4, "dm:Clippy", ["me"])],
      [5, msg(5, "lobby", "all")],
    ]);
    const before = buildGuestChannels(messages, null, view([snap("loc:Hall"), snap("room:general")]));
    expect(before.map((c) => c.id).sort()).toEqual(["dm:Clippy", "lobby", "loc:Hall", "room:general"]);
    // The story opens the Cellar + # ram: both appear, history intact.
    const after = buildGuestChannels(messages, null, view([snap("loc:Hall"), snap("room:general"), snap("loc:Cellar"), snap("room:ram")]));
    expect(after.find((c) => c.id === "loc:Cellar")!.messages.map((m) => m.seq)).toEqual([2]);
    expect(after.find((c) => c.id === "room:ram")!.messages.map((m) => m.seq)).toEqual([3]);
    // Without a snapshot yet (first render), nothing is dropped.
    expect(buildGuestChannels(messages, null, null).map((c) => c.id)).toContain("loc:Cellar");
    expect(isListedRoom("loc:X")).toBe(true);
    expect(isListedRoom("room:x")).toBe(true);
    expect(isListedRoom("dm:X")).toBe(false);
    expect(isListedRoom("pm:a:b")).toBe(false);
    expect(isListedRoom("lobby")).toBe(false);
  });

  it("an agent-voiced character in the directory has a DM on the sidebar before a word is said; a performed one does not", () => {
    const out = buildGuestChannels(new Map(), null, view([snap("loc:Hall")], [person("Trabolta", { online: true }), person("Clippy")]));
    const ids = out.map((c) => c.id);
    expect(ids).toContain("dm:Trabolta");
    expect(ids).not.toContain("dm:Clippy");
    expect(out.find((c) => c.id === "dm:Trabolta")).toMatchObject({ kind: "dm", title: "Trabolta", messages: [], people: [{ id: "Trabolta", kind: "character" }] });
    // Not in the directory (hidden until the glitch): no row.
    expect(buildGuestChannels(new Map(), null, view([snap("loc:Hall")], [])).map((c) => c.id)).not.toContain("dm:Trabolta");
  });
});

describe("the cutscene stream", () => {
  it("is exactly what was said to me, in order — never the room-wide story or a thread reply", () => {
    const messages = new Map<number, ChatMessage>([
      [9, msg(9, "dm:The Uploader", ["me"])],
      [1, msg(1, "loc:The Desktop", "all")],
      [2, msg(2, "dm:The Uploader", ["me"])],
      [3, msg(3, "dm:The Uploader", ["you"])],
      [4, msg(4, "dm:The Uploader", ["me"], { parentSeq: 2 })],
      [5, msg(5, "lobby", ["me", "you"], { kind: "narration" })],
      [6, msg(6, "dm:The Uploader", ["me"], { kind: "widget", widget: { kind: "captcha", text: "", params: {} } })],
    ]);
    expect(personalStream(messages, "me").map((m) => m.seq)).toEqual([2, 5, 6, 9]);
  });

  it("finds the newest unanswered card of a kind", () => {
    const card = (seq: number, kind: string) => msg(seq, "dm:Clippy", ["me"], { kind: "widget", widget: { kind, text: "", params: {} } });
    const messages = new Map<number, ChatMessage>([
      [1, card(1, "tutorial")],
      [2, card(2, "captcha")],
      [3, card(3, "tutorial")],
    ]);
    expect(pendingWidget(messages, "tutorial", new Set())!.seq).toBe(3);
    expect(pendingWidget(messages, "tutorial", new Set([3]))!.seq).toBe(1);
    expect(pendingWidget(messages, "tutorial", new Set([1, 3]))).toBeNull();
    expect(pendingWidget(messages, "poll", new Set())).toBeNull();
  });
});

describe("the tutorial", () => {
  it("is an overlay card in the registry", () => {
    expect(WIDGETS["tutorial"]).toMatchObject({ answerable: true, overlay: true });
    expect(WIDGETS["captcha"]?.overlay).toBeUndefined();
  });

  it("walks the app's controls, trimmed to what the story turns on", () => {
    const full = tutorialSteps({ title: "Trapped in the Internet", hasCodex: true, hasPeople: true, hasActions: true });
    expect(full.map((s) => s.id)).toEqual(["welcome", "rooms", "me", "codex", "people", "pass", "cards", "done"]);
    expect(full[0]!.text).toContain("Trapped in the Internet");
    expect(full.find((s) => s.id === "pass")!.text).toContain("buttons");
    const bare = tutorialSteps({ title: "T", hasCodex: false, hasPeople: false, hasActions: false });
    expect(bare.map((s) => s.id)).toEqual(["welcome", "rooms", "me", "pass", "cards", "done"]);
    expect(bare.find((s) => s.id === "pass")!.text).not.toContain("buttons");
    // Every anchored step names a real `data-tour` anchor the app renders.
    for (const s of full) if (s.target !== null) expect(["rooms", "me", "codex", "people", "pass", "help"]).toContain(s.target);
  });

  it("answers the card with what happened — the story hears `skipped`", () => {
    const steps = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true });
    expect(tourResult(steps, null)).toEqual({ completed: true, steps: 8 });
    expect(tourResult(steps, 2)).toEqual({ skipped: true, step: 2, steps: 8 });
  });
});
