//! Wave 13: badges count only what is for you.

import { describe, expect, it } from "vitest";
import { badgeWorthy, unreadOf } from "../src/stream/badges.ts";
import type { Viewer } from "../src/rooms/threads-state.ts";
import type { Channel, ChatMessage } from "../src/types.ts";

const ada: Viewer = { id: "g1", name: "Ada", booth: false };
const norton: Viewer = { id: "Norton", name: "Norton", booth: true };
let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from: "Clippy", kind: "line", text: "x", ts: 0, audience: "all", parentSeq: null, hidden: false, beat: "B", ...extra,
});

describe("what earns a guest's badge", () => {
  it("a DM line to you, your readout, a card that asks, an alert, a new codex entry or quest", () => {
    expect(badgeWorthy(m({ channel: "dm:Clippy", channelKind: "dm", audience: ["g1"] }), ada)).toBe(true);
    expect(badgeWorthy(m({ channel: "lobby", kind: "narration", from: "", readout: true, audience: ["g1"] }), ada)).toBe(true);
    expect(badgeWorthy(m({ kind: "widget", widget: { kind: "poll", text: "?", params: {} }, audience: ["g1"] }), ada)).toBe(true);
    expect(badgeWorthy(m({ kind: "widget", widget: { kind: "poll", text: "?", params: {} } }), ada)).toBe(true); // a poll to everyone asks you too
    expect(badgeWorthy(m({ kind: "signal", alert: true }), ada)).toBe(true);
    expect(badgeWorthy(m({ kind: "codex", audience: ["g1"] }), ada)).toBe(true);
    expect(badgeWorthy(m({ kind: "quest", audience: ["g1"] }), ada)).toBe(true);
  });

  it("never the house lines, barks, notices, system, a picture, your own words or a reply in a thread", () => {
    expect(badgeWorthy(m({}), ada)).toBe(false); // house-wide Desktop line
    expect(badgeWorthy(m({ kind: "narration", ambient: true }), ada)).toBe(false);
    expect(badgeWorthy(m({ kind: "signal", notice: "✅" }), ada)).toBe(false);
    expect(badgeWorthy(m({ kind: "system", audience: ["g1"] }), ada)).toBe(false);
    expect(badgeWorthy(m({ kind: "widget", widget: { kind: "image", text: "", params: {} }, audience: ["g1"] }), ada)).toBe(false);
    expect(badgeWorthy(m({ from: "Ada", channel: "dm:Clippy", audience: ["g1"] }), ada)).toBe(false);
    expect(badgeWorthy(m({ channel: "dm:Clippy", audience: ["g1"], parentSeq: 3 }), ada)).toBe(false);
    // typed chat where you stand is the room talking
    expect(badgeWorthy(m({ beat: undefined, from: "Bo", audience: ["g1", "g2"] }), ada)).toBe(false);
  });
});

describe("a booth's badge", () => {
  it("counts lines to @its character, never what the guests got", () => {
    expect(badgeWorthy(m({ channel: "dm:Norton", channelKind: "dm", kind: "narration", from: "", readout: true, audience: ["@Norton"] }), norton)).toBe(true);
    expect(badgeWorthy(m({ channel: "dm:Norton", channelKind: "dm", audience: ["g1"] }), norton)).toBe(false); // to a guest
    expect(badgeWorthy(m({ kind: "signal", alert: true }), norton)).toBe(false); // a house alert is the guests'
    expect(badgeWorthy(m({ kind: "signal", alert: true, channel: "hosts", channelKind: "faction", audience: [] }), norton)).toBe(true); // a staff alert
    expect(badgeWorthy(m({ kind: "signal", alert: true, audience: [] }), norton)).toBe(false); // a room alert that reached nobody
    expect(badgeWorthy(m({ kind: "signal", alert: true, audience: ["@Norton"] }), norton)).toBe(true); // to its character
    expect(badgeWorthy(m({ kind: "signal", alert: true, channel: "faction:Mods", channelKind: "faction", audience: ["g1", "g2"] }), norton)).toBe(false); // a faction's
    expect(badgeWorthy(m({ kind: "line", alert: true, from: "Ada", audience: ["g1"] }), norton)).toBe(false); // a guest's own reply !…
    expect(badgeWorthy(m({ kind: "widget", widget: { kind: "poll", text: "?", params: {} } }), norton)).toBe(false);
  });
});

describe("unreadOf", () => {
  const room = (messages: ChatMessage[], decision: Channel["decision"] = null): Channel => ({ id: "dm:Clippy", kind: "dm", title: "Clippy", spaceId: "story", messages, unread: 0, decision, lastTs: 0 });
  it("counts the worthy ones past the mark; a decision is at least one", () => {
    const a = m({ channel: "dm:Clippy", audience: ["g1"] });
    const b = m({});
    const c = m({ channel: "dm:Clippy", audience: ["g1"] });
    expect(unreadOf(room([a, b, c]), -1, ada)).toBe(2);
    expect(unreadOf(room([a, b, c]), a.seq, ada)).toBe(1);
    expect(unreadOf(room([b], { title: "Your move", options: [] }), -1, ada)).toBe(1);
    expect(unreadOf(room([a, b, c]), -1, undefined)).toBe(3); // no viewer: the old rule
  });
});
