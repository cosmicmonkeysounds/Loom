//! Sticky notices (wave 4, lane E): `activePins` keeps the newest pin per
//! (channel, key) until an unpin with the same key, and the `PinnedRail`
//! renders what is left — a `!` pin as an alert.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PinnedRail } from "../src/chat.tsx";
import { activePins } from "../src/pins.ts";
import type { ChatMessage } from "../src/types.ts";

function m(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "lobby", title: "Lobby", from: "", kind: "signal", text: `t${seq}`, ts: seq, audience: "all", parentSeq: null, hidden: false, ...extra };
}

describe("activePins", () => {
  it("keeps the newest pin per key; an unpin with the same key clears it", () => {
    const list = [m(1, "lobby", { pin: "g1", text: "Go." }), m(2, "lobby", { pin: "g1", text: "Go now." }), m(3, "lobby", { pin: "", text: "All." })];
    expect(activePins(list).map((x) => [x.seq, x.text])).toEqual([
      [2, "Go now."],
      [3, "All."],
    ]);
    expect(activePins([...list, m(4, "lobby", { kind: "system", unpin: "g1" })]).map((x) => x.seq)).toEqual([3]);
    // An unpin for a key nobody pinned is harmless.
    expect(activePins([...list, m(5, "lobby", { kind: "system", unpin: "g9" })]).map((x) => x.seq)).toEqual([2, 3]);
  });

  it("a different channel's unpin does not clear; `channel` narrows; hidden pins and thread replies are skipped", () => {
    const list = [
      m(1, "lobby", { pin: "g1" }),
      m(2, "room:quarantine", { pin: "g1", channelKind: "faction" }),
      m(3, "room:quarantine", { kind: "system", unpin: "g1" }),
      m(4, "lobby", { pin: "g2", hidden: true }),
      m(5, "lobby", { pin: "g3", parentSeq: 1 }),
    ];
    expect(activePins(list).map((x) => x.seq)).toEqual([1]);
    expect(activePins(list, "room:quarantine")).toEqual([]);
    expect(activePins(list, "lobby").map((x) => x.seq)).toEqual([1]);
  });

  it("orders by seq whatever order the messages arrive in", () => {
    const list = [m(9, "lobby", { pin: "b" }), m(2, "lobby", { pin: "a" }), m(5, "lobby", { pin: "a", text: "newer" })];
    expect(activePins(list).map((x) => [x.seq, x.pin])).toEqual([
      [5, "a"],
      [9, "b"],
    ]);
    // A later message with the same key (seq 5 over seq 2) wins even when listed first.
    expect(activePins([m(5, "lobby", { pin: "a", text: "newer" }), m(2, "lobby", { pin: "a", text: "older" })])[0]!.text).toBe("newer");
  });
});

describe("PinnedRail", () => {
  it("renders one line per pin, an alert pin flagged; nothing when empty", () => {
    expect(renderToStaticMarkup(<PinnedRail pins={[]} />)).toBe("");
    const html = renderToStaticMarkup(<PinnedRail pins={[m(1, "lobby", { pin: "g1", text: "GO TO THE INTERNET.", alert: true }), m(2, "lobby", { pin: "", text: "Doors at nine." })]} />);
    expect(html).toContain('class="pinned-rail"');
    expect(html).toContain('class="pin alert"');
    expect(html).toContain("📌 GO TO THE INTERNET.");
    expect(html).toContain("📌 Doors at nine.");
    expect(html.match(/class="pin /g)).toHaveLength(2);
  });
});
