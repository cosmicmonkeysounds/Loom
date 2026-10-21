//! Wave 18 (GUEST-SPEC §6.2, §4): the guest bridge's local exit rules —
//! never the lobby, the story's `go:` first, a card's room, its own room,
//! "check your messages", then "What do I do?" — and the Notifications rows.

import { describe, expect, it } from "vitest";
import { firstSentence, localClearGag, localExitsOf, localGagFor, notificationsOf } from "../src/guest/notification-rows.ts";
import type { ExitContext } from "../src/guest/moments-bridge.ts";
import type { ChatMessage } from "../src/types.ts";

const ctx = (o: Partial<ExitContext> = {}): ExitContext => ({
  listed: new Set(["lobby", "loc:The Desktop (living room)", "dm:Trabolta", "dm:Clippy", "codex", "quests", "wallet"]),
  titles: new Map([
    ["loc:The Desktop (living room)", "The Desktop (living room)"],
    ["dm:Trabolta", "Trabolta"],
    ["dm:Clippy", "Clippy"],
  ]),
  open: null,
  window: "chats",
  cards: [{ glyph: "📝", channel: "dm:Trabolta", seq: 90 }],
  dms: [
    { id: "dm:Trabolta", title: "Trabolta", last: 90 },
    { id: "dm:Clippy", title: "Clippy", last: 20 },
  ],
  actions: new Set(["bathroom_mode"]),
  sides: true,
  ...o,
});

describe("exitsOf (local)", () => {
  it("a lobby broadcast never offers the lobby: it falls to What do I do?", () => {
    const ex = localExitsOf({ channel: "lobby", text: "ALL PROGRAMS: stand by.", kind: "alert", severity: "major", seq: 5 }, ctx(), 2);
    expect(ex.map((e) => e.nav)).toEqual([{ to: "mission" }]);
    expect(ex[0]!.label).toBe("What do I do?");
  });

  it("the story's go: targets come first, with their labels", () => {
    const ex = localExitsOf(
      { channel: "lobby", text: "Report to the Desktop.", kind: "alert", severity: "major", seq: 5, go: [{ kind: "room", id: "loc:The Desktop (living room)", label: "" }, { kind: "pass", label: "Show my pass" }] },
      ctx(),
      2,
    );
    expect(ex.map((e) => e.nav)).toEqual([{ to: "room", id: "loc:The Desktop (living room)" }, { to: "pass" }]);
    expect(ex[0]!.label).toBe("Go to The Desktop ›");
    expect(ex[1]!.label).toBe("Show my pass");
  });

  it("a go to the lobby is Mission; an unlisted room is dropped", () => {
    const ex = localExitsOf({ channel: "lobby", text: "x", kind: "alert", severity: "major", seq: 1, go: [{ kind: "room", id: "lobby", label: "" }, { kind: "room", id: "loc:Hidden", label: "" }] }, ctx(), 2);
    expect(ex.map((e) => e.nav)).toEqual([{ to: "mission" }]);
  });

  it("a moment about a live card goes to that card, focused", () => {
    const ex = localExitsOf({ channel: "lobby", text: "📝 Last chance: file your facts.", kind: "alert", severity: "major", seq: 95 }, ctx(), 2);
    expect(ex[0]!.nav).toEqual({ to: "room", id: "dm:Trabolta", focusSeq: 90 });
    expect(ex[0]!.label).toBe("📝 Answer ›");
  });

  it("a pinned room's moment opens that room's nav", () => {
    expect(localExitsOf({ channel: "quests", text: "New quest.", kind: "quest", severity: "minor", seq: 3 }, ctx(), 1)[0]!.nav).toEqual({ to: "quests" });
    expect(localExitsOf({ channel: "wallet", text: "Paid.", kind: "other", severity: "minor", seq: 3 }, ctx(), 1)[0]!.nav).toEqual({ to: "wallet" });
  });

  it("check your messages opens the DM it names", () => {
    expect(localExitsOf({ channel: "lobby", text: "📥 Clippy sent you something. Check your messages.", kind: "alert", severity: "major", seq: 3 }, ctx(), 1)[0]!.nav).toEqual({ to: "room", id: "dm:Clippy" });
  });

  it("never the room already open; no What do I do? on Mission with no room", () => {
    const ex = localExitsOf({ channel: "dm:Clippy", text: "Hi.", kind: "readout", severity: "major", seq: 3 }, ctx({ open: "dm:Clippy", window: "mission" }), 2);
    expect(ex.map((e) => e.nav)).toEqual([{ to: "mission" }]);
    expect(localExitsOf({ channel: "lobby", text: "x", kind: "alert", severity: "major", seq: 3 }, ctx({ window: "mission" }), 2)).toEqual([]);
  });

  it("a balloon gets one exit, the others two", () => {
    const m = { channel: "dm:Clippy", text: "Hi.", kind: "readout" as const, severity: "major" as const, seq: 3 };
    expect(localExitsOf(m, ctx(), 1)).toHaveLength(1);
    expect(localExitsOf(m, ctx(), 2)).toHaveLength(2);
  });
});

describe("the gags (§4.2)", () => {
  it("✕ asks on every fourth seq; Clear all's outcome is (n + firstSeq) % 3", () => {
    expect(localGagFor(8)).toBe("ask");
    expect(localGagFor(9)).toBe("delete");
    expect(localClearGag(14, 3)).toBe(2);
    expect(localClearGag(14, 4)).toBe(0);
    expect(localClearGag(14, 5)).toBe(1);
  });
});

describe("notificationsOf (§4.1)", () => {
  const msg = (seq: number, o: Partial<ChatMessage>): ChatMessage => ({ seq, channel: "lobby", channelKind: "lobby", title: "T", from: "", kind: "signal", text: "", ts: seq * 1000, audience: "all", parentSeq: null, hidden: false, ...o });
  const me = { id: "g-1", name: "Winamp" };

  it("every moment, newest first; house ~ notices folded per glyph + phase; a personal one stays itself", () => {
    const rows = notificationsOf(
      [
        msg(1, { alert: true, moment: "major", text: "📣 Time is up. Return to the Desktop." }),
        msg(2, { notice: "🎀", text: "🎀 Encarta won a ribbon.", phase: "bingo" }),
        msg(3, { notice: "🎀", text: "🎀 Excel won a ribbon.", phase: "bingo" }),
        msg(4, { notice: "📂", text: "📂 The Start Bar is open now.", audience: ["g-1"], channel: "loc:x", channelKind: "location" }),
        msg(5, { text: "just chat" }),
      ],
      me,
      "bingo",
    );
    expect(rows.map((r) => r.key)).toEqual(["m:4", "f:🎀:bingo", "m:1"]);
    expect(rows[1]!.title).toBe("2 updates about others");
    expect(rows[2]!.title).toBe("Time is up.");
    expect(rows[2]!.rest).toBe("Return to the Desktop.");
    expect(rows[2]!.glyph).toBe("📣");
  });

  it("a notice naming the guest is personal", () => {
    const rows = notificationsOf([msg(2, { notice: "✅", text: "✅ Winamp's answer is accepted." })], me, null);
    expect(rows[0]!.key).toBe("m:2");
  });

  it("deleted keys stay deleted; the cap holds", () => {
    const many = Array.from({ length: 250 }, (_, i) => msg(i + 1, { alert: true, moment: "major", text: `Line ${i}.` }));
    expect(notificationsOf(many, me, null)).toHaveLength(200);
    expect(notificationsOf(many.slice(0, 2), me, null, new Set(["m:2"])).map((r) => r.key)).toEqual(["m:1"]);
  });

  it("a big moment row says so", () => {
    const rows = notificationsOf([msg(7, { alert: true, moment: "big" as never, text: "🎀 You won a Bingo Ribbon. Take a bow." })], me, null);
    expect(rows[0]!.big).toBe(true);
  });

  it("first sentence splits at . ! ? + space", () => {
    expect(firstSentence("Hi there! More here.")).toEqual({ head: "Hi there!", rest: "More here." });
    expect(firstSentence("No end")).toEqual({ head: "No end", rest: "" });
  });
});
