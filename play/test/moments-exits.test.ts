//! Wave 18, the moments lane (GUEST-SPEC §6, CONTRACTS C2, the user's
//! "navigation from alerts and popups should be rock solid"): every moment's
//! exits, from every surface, and the one rule asked for in so many words —
//! an exit never lands on the lobby (the far-away Chat log).

import { describe, expect, it } from "vitest";
import { exitIcon, exitLabel, exitsOf, navFromRoom, navFromSearch, navKey, navOfTarget, plainTitle, type ExitContext, type GoTarget, type Nav } from "../src/moments/exits.ts";
import type { Moment } from "../src/moments/model.ts";

const ctx = (over: Partial<ExitContext> = {}): ExitContext => ({
  listed: new Set(["lobby", "loc:The Desktop", "loc:The Tube", "dm:Trabolta", "dm:Clippy", "pm:g1:g2", "codex", "quests", "wallet", "hosts"]),
  titles: new Map([
    ["loc:The Desktop", "The Desktop (living room)"],
    ["loc:The Tube", "The Tube"],
    ["dm:Trabolta", "Trabolta"],
    ["dm:Clippy", "Clippy"],
    ["pm:g1:g2", "Netscape Navigator"],
    ["lobby", "Chat log"],
  ]),
  open: null,
  window: "chats",
  cards: [],
  dms: [
    { id: "dm:Trabolta", title: "Trabolta", last: 90 },
    { id: "dm:Clippy", title: "Clippy", last: 10 },
  ],
  actions: new Set(["bathroom_mode"]),
  sides: false,
  actionLabels: new Map([["bathroom_mode", "🚻 Bathroom Mode"]]),
  ...over,
});

function moment(over: Partial<Moment> = {}): Moment {
  return { key: "m:1", seq: 1, severity: "major", kind: "alert", caption: "Clippy", text: "📣 Hello.", channel: "lobby", at: 1000, phase: null, ...over };
}

const navs = (m: Moment, c: ExitContext = ctx(), max: 1 | 2 = 2) => exitsOf(m, c, max).map((e) => e.nav);

describe("never the lobby", () => {
  it("a house broadcast in the lobby with nothing better goes to Mission", () => {
    expect(navs(moment())).toEqual([{ to: "mission" }]);
    expect(exitsOf(moment(), ctx(), 2)[0]).toEqual({ label: "What do I do?", icon: "start", nav: { to: "mission" } });
  });

  it("a story `go:` naming the lobby lands on Mission; a room target the guest doesn't list is dropped", () => {
    const go: GoTarget[] = [
      { kind: "room", id: "lobby", label: "Go to the lobby" },
      { kind: "room", id: "loc:The Server Room", label: "Go to The Server Room" },
    ];
    expect(navs(moment({ go }))).toEqual([{ to: "mission" }]);
  });

  it("no surface, no target, ever lists the lobby room", () => {
    const all: Moment[] = [
      moment(),
      moment({ kind: "card", channel: "lobby", card: { seq: 1, kind: "poll", glyph: "📊" } }),
      moment({ kind: "readout", channel: "lobby" }),
      moment({ go: [{ kind: "dm", id: "lobby", label: "x" }] }),
    ];
    for (const m of all) for (const max of [1, 2] as const) for (const window of ["mission", "chats", "notifications"] as const) {
      for (const n of navs(m, ctx({ window }), max)) expect(n.to === "room" ? n.id : "", JSON.stringify(m)).not.toBe("lobby");
    }
  });

  it("on Mission with no room open, the Mission exit is left out (there is nowhere to take you)", () => {
    expect(navs(moment(), ctx({ window: "mission" }))).toEqual([]);
    expect(navs(moment(), ctx({ window: "mission", open: "dm:Clippy" }))).toEqual([{ to: "mission" }]);
  });
});

describe("the order: go, its card, a live card, its room, a named DM, Mission", () => {
  it("the story's buttons first, in order, with the server's labels", () => {
    const go: GoTarget[] = [
      { kind: "room", id: "loc:The Desktop", label: "📍 Go to The Desktop" },
      { kind: "pass", label: "🎟 Show my pass" },
    ];
    const e = exitsOf(moment({ go }), ctx(), 2);
    expect(e.map((x) => x.label)).toEqual(["📍 Go to The Desktop", "🎟 Show my pass"]);
    expect(e.map((x) => x.nav)).toEqual([{ to: "room", id: "loc:The Desktop" }, { to: "pass" }]);
  });

  it("its own card: '{glyph} Answer ›' focuses the card in its room; inline inside a big, none", () => {
    const card = moment({ kind: "card", channel: "dm:Trabolta", seq: 7, text: "🍾 The bottle landed on you.", card: { seq: 7, kind: "poll", glyph: "🍾" } });
    const e = exitsOf(card, ctx(), 2);
    expect(e[0]).toEqual({ label: "🍾 Answer ›", icon: null, nav: { to: "room", id: "dm:Trabolta", focusSeq: 7 } });
    expect(exitsOf(card, ctx(), 2, { inlineCard: true }).map((x) => x.nav)).toEqual([{ to: "room", id: "dm:Trabolta" }, { to: "mission" }]);
    expect(exitsOf(card, ctx(), 2, { big: true })[0]?.label).toBe("🍾 Open the card ›");
  });

  it("an announcement about a live card goes to the card (the newest with its glyph)", () => {
    const cards = [
      { glyph: "📝", channel: "dm:Trabolta", seq: 40 },
      { glyph: "📝", channel: "dm:Trabolta", seq: 44 },
      { glyph: "📊", channel: "dm:Clippy", seq: 41 },
    ];
    expect(navs(moment({ text: "📝 Last chance: file your facts." }), ctx({ cards }))[0]).toEqual({ to: "room", id: "dm:Trabolta", focusSeq: 44 });
  });

  it("its own room: the Codex (+ entry), the Quest Log (+ quest), the Wallet, a listed room", () => {
    expect(navs(moment({ channel: "codex", entry: "the-door-code" }))[0]).toEqual({ to: "codex", entry: "the-door-code" });
    expect(navs(moment({ channel: "quests", quest: "orientation" }))[0]).toEqual({ to: "quests", quest: "orientation" });
    expect(navs(moment({ channel: "wallet" }))[0]).toEqual({ to: "wallet" });
    expect(navs(moment({ channel: "loc:The Desktop" }))[0]).toEqual({ to: "room", id: "loc:The Desktop" });
    // A room the guest doesn't list: Mission.
    expect(navs(moment({ channel: "loc:Hidden" }))).toEqual([{ to: "mission" }]);
  });

  it("'check your messages' opens the DM it names", () => {
    expect(navs(moment({ text: "📥 Something arrived. Check your messages from Clippy." }))[0]).toEqual({ to: "room", id: "dm:Clippy" });
  });

  it("the loud 'show your pass' objective offers the pass", () => {
    expect(navs(moment({ kind: "objective", channel: null, pass: true, seq: null, key: "o:pass" }))).toEqual([{ to: "pass" }, { to: "mission" }]);
  });

  it("deduplicated, the open room dropped, cut to max (a balloon 1)", () => {
    const go: GoTarget[] = [
      { kind: "room", id: "loc:The Desktop", label: "A" },
      { kind: "room", id: "loc:The Desktop", label: "B" },
    ];
    expect(exitsOf(moment({ go, channel: "loc:The Desktop" }), ctx(), 2).map((x) => x.label)).toEqual(["A", "What do I do?"]);
    expect(navs(moment({ channel: "loc:The Desktop" }), ctx({ open: "loc:The Desktop" }))).toEqual([{ to: "mission" }]);
    expect(navs(moment({ go }), ctx(), 1)).toHaveLength(1);
  });
});

describe("every GoTarget kind", () => {
  const c = ctx({ sides: true });
  const t = (x: GoTarget) => navOfTarget(x, c);
  it("maps to its Nav (or drops)", () => {
    expect(t({ kind: "room", id: "loc:The Tube", label: "" })).toEqual({ to: "room", id: "loc:The Tube" });
    expect(t({ kind: "dm", id: "dm:Trabolta", label: "" })).toEqual({ to: "room", id: "dm:Trabolta" });
    expect(t({ kind: "dm", id: "dm:Nobody", label: "" })).toBeNull();
    for (const kind of ["pass", "scan", "chats", "mission", "notifications", "sides", "wallet", "me"] as const) expect(t({ kind, label: "" })).toEqual({ to: kind });
    expect(t({ kind: "codex", label: "" })).toEqual({ to: "codex" });
    expect(t({ kind: "codex", entry: "e1", label: "" })).toEqual({ to: "codex", entry: "e1" });
    expect(t({ kind: "quests", label: "" })).toEqual({ to: "quests" });
    expect(t({ kind: "quests", quest: "q1", label: "" })).toEqual({ to: "quests", quest: "q1" });
    expect(t({ kind: "act", id: "bathroom_mode", label: "" })).toEqual({ to: "act", id: "bathroom_mode" });
    expect(t({ kind: "act", id: "not_live", label: "" })).toBeNull();
    expect(navOfTarget({ kind: "sides", label: "" }, ctx({ sides: false }))).toBeNull();
  });
});

describe("the label table (§6.2)", () => {
  const c = ctx();
  const label = (n: Nav, extra = {}) => exitLabel(n, c, extra);
  it("every nav's default words and icon", () => {
    const rows: Array<[Nav, string, string | null]> = [
      [{ to: "mission" }, "What do I do?", "start"],
      [{ to: "chats" }, "Chats", "reply"],
      [{ to: "notifications" }, "See all", "bell"],
      [{ to: "me" }, "Me", "people"],
      [{ to: "sides" }, "Choose a side", "defect"],
      [{ to: "room", id: "loc:The Desktop" }, "Go to The Desktop ›", "pin"],
      [{ to: "room", id: "dm:Trabolta" }, "Open Trabolta ›", "reply"],
      [{ to: "room", id: "pm:g1:g2" }, "Open Netscape Navigator ›", "reply"],
      [{ to: "room", id: "hosts" }, "Open hosts ›", "reply"],
      [{ to: "pass" }, "Show my pass", "pass"],
      [{ to: "scan" }, "Scan", "scan"],
      [{ to: "codex" }, "Open the Codex", "codex"],
      [{ to: "quests" }, "Open the Quest Log", "quest"],
      [{ to: "quests", quest: "q" }, "See the quest", "quest"],
      [{ to: "wallet" }, "Open my Wallet", "coin"],
      [{ to: "act", id: "bathroom_mode" }, "🚻 Bathroom Mode", null],
    ];
    for (const [n, words, icon] of rows) {
      expect(label(n), navKey(n)).toBe(words);
      expect(exitIcon(n), navKey(n)).toBe(icon);
    }
    expect(label({ to: "room", id: "dm:Trabolta", focusSeq: 3 }, { glyph: "📊" })).toBe("📊 Answer ›");
    expect(label({ to: "codex", entry: "e" }, { entryTitle: "The Golden Duck and Other Stories" })).toBe('Read "The Golden Duck and Oth…"');
    expect(plainTitle("The Desktop (living room)")).toBe("The Desktop");
  });
});

describe("push taps and deep links (§6.4)", () => {
  const listed = ["lobby", "loc:The Desktop", "dm:Trabolta"];
  it("?room= lands on its place, never the lobby", () => {
    expect(navFromSearch("?room=lobby", listed)).toEqual({ to: "mission" });
    expect(navFromSearch("?room=codex", listed)).toEqual({ to: "codex" });
    expect(navFromSearch("?room=quests", listed)).toEqual({ to: "quests" });
    expect(navFromSearch("?room=wallet", listed)).toEqual({ to: "wallet" });
    expect(navFromSearch("?room=dm%3ATrabolta", listed)).toEqual({ to: "room", id: "dm:Trabolta" });
    expect(navFromSearch("?room=loc%3AHidden", listed)).toEqual({ to: "mission" });
    expect(navFromSearch("?code=ABC", listed)).toBeNull();
    expect(navFromSearch("", listed)).toBeNull();
    expect(navFromRoom("  ", listed)).toBeNull();
  });
  it("a moment's push lands where the moment goes: a screen word, a codex entry, a quest (NM-F5)", () => {
    expect(navFromSearch("?go=pass", listed)).toEqual({ to: "pass" });
    expect(navFromSearch("?go=sides", listed)).toEqual({ to: "sides" });
    expect(navFromSearch("?go=nonsense&room=dm%3ATrabolta", listed)).toEqual({ to: "room", id: "dm:Trabolta" });
    expect(navFromSearch("?room=codex&entry=computer-bingo", listed)).toEqual({ to: "codex", entry: "computer-bingo" });
    expect(navFromSearch("?room=quests&quest=The%20Bingo%20Card", listed)).toEqual({ to: "quests", quest: "The Bingo Card" });
  });
});
