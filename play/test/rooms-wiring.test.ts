//! Wave 13 integration: the room list as both apps mount it — the fold keeps
//! the sections it is given (a booth's "Messages" stays "Messages"), a
//! booth folds only the house's empty rooms, and a GENERATOR bark never
//! becomes a room's preview line.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SpaceList, foldSections, lastPreview } from "../src/rooms/list.tsx";
import { boothFoldable } from "../src/booth/model.ts";
import type { Channel, ChatMessage } from "../src/types.ts";

function ch(id: string, extra: Partial<Channel> = {}): Channel {
  const kind = id === "lobby" ? "lobby" : id.startsWith("loc:") ? "location" : id.startsWith("dm:") ? "dm" : "open";
  return { id, kind, title: id.replace(/^\w+:/u, ""), spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0, ...extra } as Channel;
}
function msg(seq: number, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel: "lobby", channelKind: "lobby", title: "Lobby", from: "", kind: "line", text, ts: seq, audience: "all", parentSeq: null, hidden: false, ...extra } as ChatMessage;
}

describe("foldSections", () => {
  it("takes the folded rooms out and keeps every section's own title and order", () => {
    const readouts = ch("__inbox", { kind: "dm", spaceId: "booth" });
    const messages = ch("guest:g1", { kind: "guest", spaceId: "guests", unread: 1 });
    const cloud = ch("loc:The Cloud");
    const ram = ch("loc:The RAM");
    const spaces = [
      { id: "booth", title: "Booth", channels: [readouts] },
      { id: "guests", title: "Messages", channels: [messages] },
      { id: "story", title: "Trapped", channels: [cloud, ram] },
    ];
    expect(foldSections(spaces, [cloud, ram]).map((s) => [s.title, s.channels.map((c) => c.id)])).toEqual([
      ["Booth", ["__inbox"]],
      ["Messages", ["guest:g1"]],
    ]);
    expect(foldSections(spaces, [])).toEqual(spaces);
  });
});

describe("the booth's fold", () => {
  it("folds only the house's rooms: never Readouts, the Wallet, staff, the Cast or the feed", () => {
    expect(boothFoldable(ch("loc:The Cloud"))).toBe(true);
    expect(boothFoldable(ch("back-channel", { kind: "private", spaceId: "os" }))).toBe(true);
    expect(boothFoldable(ch("__inbox", { kind: "dm", spaceId: "booth" }))).toBe(false);
    expect(boothFoldable(ch("wallet", { kind: "wallet", spaceId: "booth" }))).toBe(false);
    expect(boothFoldable(ch("hosts", { spaceId: "staff", staff: true }))).toBe(false);
    expect(boothFoldable(ch("cast:Trabolta", { kind: "dm", spaceId: "cast" }))).toBe(false);
    expect(boothFoldable(ch("codex", { kind: "codex", spaceId: "pinned" }))).toBe(false);
    expect(boothFoldable(ch("__feed", { kind: "lobby" }))).toBe(false);
  });

  it("gathers the empty house rooms under Other rooms (n) and keeps the quiet tools up", () => {
    const spaces = [
      { id: "booth", title: "Booth", channels: [ch("__inbox", { kind: "dm", spaceId: "booth", title: "Readouts" }), ch("wallet", { kind: "wallet", spaceId: "booth", title: "Wallet" })] },
      { id: "story", title: "Trapped", channels: [ch("loc:The Cloud"), ch("loc:The RAM"), ch("loc:The Hard Drive")] },
    ];
    const out = renderToStaticMarkup(createElement(SpaceList, { spaces, onOpen: () => {}, fold: boothFoldable }));
    expect(out).toContain("Other rooms (3)");
    expect(out).toContain("Readouts");
    expect(out).toContain("Wallet");
    // The fold is closed: the house rooms are behind it.
    expect(out).not.toContain("The RAM");
    // `fold: true` would have folded the empty tools too.
    expect(renderToStaticMarkup(createElement(SpaceList, { spaces, onOpen: () => {}, fold: true }))).toContain("Other rooms (5)");
  });
});

describe("a room's preview line", () => {
  it("skips GENERATOR barks for the newest real line", () => {
    const lobby = ch("lobby", { messages: [msg(1, "Welcome to the Desktop.", { from: "Clippy" }), msg(2, "The screensaver changes. Pipes now.", { ambient: true })] });
    expect(lastPreview(lobby)).toBe("Clippy: Welcome to the Desktop.");
    expect(lastPreview(ch("lobby", { messages: [msg(2, "A fan spins up somewhere.", { ambient: true })] }))).toBe("");
  });
});
