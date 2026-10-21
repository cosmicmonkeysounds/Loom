//! Wave 13 fix round (fguest): the queue's order and the stickies. A `!`
//! alarm jumps ahead of an objective or a minor moment; stickies never pile
//! up (an older one folds into the tray's missed count, "Dismiss all (n)");
//! a guest's loud objective flashes the NOW bar instead of a second copy;
//! severity is the dialog's icon, never a red title bar; and `plain`'s
//! blue screen has neutral copy.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_MOMENTS, exitRoomFor, missedCount, momentsReducer, priorityOf, surfacesOf, type Moment, type MomentsAction, type MomentsState } from "../src/moments/model.ts";
import { BlueScreen, MomentDialog, StickyBanner, iconOf, stickyLead } from "../src/moments/surfaces.tsx";
import type { AlertLevel } from "../src/types.ts";
import { readBundledCss } from "./css.ts";

function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `moment ${seq}`, channel: "lobby", at: seq * 1000, phase: "hunt", ...over };
}
const objective = (id: string, over: Partial<Moment> = {}): Moment => ({ ...moment(0, { key: `o:${id}`, seq: null, kind: "objective", caption: "New objective", text: "Show your pass\nHold it up.", channel: null, pass: true }), ...over });
const arrive = (moments: Moment[], level: AlertLevel = "dialog", role: "guest" | "booth" = "guest"): MomentsAction => ({ type: "arrive", moments, visible: true, level, role, now: 0, phase: "hunt", batch: false });
const run = (actions: MomentsAction[], from: MomentsState = EMPTY_MOMENTS) => actions.reduce(momentsReducer, from);
const noop = () => {};
const q = (m: Moment, level: AlertLevel) => ({ moment: m, level, queuedAt: 0 });

describe("an alarm jumps the queue", () => {
  it("priority (§7): big to you 6 > big to the house 5 > your move 4 > house `!` 3 > other major 2 > loud objective 1 > minor 0", () => {
    expect(priorityOf({ kind: "readout", severity: "big" })).toBe(6);
    expect(priorityOf({ kind: "alert", severity: "big", house: true })).toBe(5);
    expect(priorityOf({ kind: "card", severity: "major" })).toBe(4);
    expect(priorityOf({ kind: "readout", severity: "major" })).toBe(4);
    expect(priorityOf({ kind: "card", severity: "major", house: true })).toBe(2);
    expect(priorityOf({ kind: "alert", severity: "major", house: true })).toBe(3);
    expect(priorityOf({ kind: "alert", severity: "major" })).toBe(4); // a `!` to you is yours
    expect(priorityOf({ kind: "objective", severity: "major" })).toBe(1);
    expect(priorityOf({ kind: "readout", severity: "minor" })).toBe(0);
  });

  it("at bsod the blue screen shows the alarm, not the objective notice that came first", () => {
    let s = run([arrive([objective("pass")], "bsod")]);
    expect(surfacesOf(s, false).modal?.moment.key).toBe("o:pass");
    s = run([arrive([moment(7, { text: "!🚨 ALARM: everyone freeze." })], "bsod")], s);
    const v = surfacesOf(s, false);
    expect(v.modal?.moment.seq).toBe(7);
    expect([v.modalIndex, v.modalTotal]).toEqual([1, 2]);
    // The objective still waits its turn behind it.
    s = momentsReducer(s, { type: "dismiss", key: "m:7", onScreenMs: 5_000 });
    expect(surfacesOf(s, false).modal?.moment.key).toBe("o:pass");
  });

  it("a minor moment never gets ahead of a major one; within a rank the newest first, the bigs oldest first", () => {
    const s = run([arrive([moment(1, { kind: "card" }), moment(2, { kind: "readout", severity: "minor" }), moment(3, { kind: "card" })], "bsod")]);
    expect(s.queue.map((x) => x.moment.seq)).toEqual([3, 1, 2]);
    // Story order for the bigs: 🎱 then 🎀.
    const b = run([arrive([moment(5, { severity: "big", kind: "readout", text: "🎱 Bingo!" }), moment(6, { severity: "big", kind: "readout", text: "🎀 You won." })], "sticky")]);
    expect(b.queue.map((x) => [x.moment.seq, x.level])).toEqual([
      [5, "big"],
      [6, "big"],
    ]);
  });
});

describe("stickies never pile up", () => {
  it("a new sticky folds the older ones into the tray's missed count", () => {
    let s = run([arrive([moment(1, { kind: "other" })], "sticky")]);
    s = run([arrive([moment(2, { kind: "other" })], "sticky")], s);
    const v = surfacesOf(s, false);
    expect(v.sticky?.moment.seq).toBe(2);
    expect(v.stickyCount).toBe(1);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
    expect(missedCount(s, false, 0)).toBe(1);
  });

  it("an older alarm stays up; a lesser sticky waits behind it (no Dismiss all: each is closed on its own)", () => {
    let s = run([arrive([moment(1)], "sticky")]); // a `!` alarm
    s = run([arrive([moment(2, { kind: "other" })], "sticky")], s);
    const v = surfacesOf(s, false);
    expect(v.sticky?.moment.seq).toBe(1);
    expect(v.stickyCount).toBe(2);
    expect(s.missed).toEqual([]);
    s = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 3_000 });
    expect(surfacesOf(s, false).sticky?.moment.seq).toBe(2);
  });

  it("a wake's replay brings back the newest house banner only; the others stay unread (§7)", () => {
    let s: MomentsState = { ...EMPTY_MOMENTS, missed: [moment(1, { kind: "alert", house: true }), moment(2, { kind: "alert", house: true })] };
    s = momentsReducer(s, { type: "wake", level: "sticky", role: "guest", now: 0, phase: "hunt" });
    expect(surfacesOf(s, false).stickyCount).toBe(1);
    expect(surfacesOf(s, false).sticky?.moment.seq).toBe(2);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
  });

  it("the bar itself: no uppercase caption over the words, the speaker inline, never a Dismiss all", () => {
    const html = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(1, { kind: "other", caption: "Trabolta" }), "sticky"), count: 2, exits: [], onExit: noop, onDismiss: noop }));
    expect(html).toContain('<strong class="moments-sticky-lead">Trabolta: </strong>moment 1');
    expect(html).not.toContain("Dismiss all");
    expect(html).not.toContain("alarm"); // the full yellow is the `!` alarm's only
    const ann = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(1, { caption: "Announcement" }), "sticky"), count: 1, exits: [], onExit: noop, onDismiss: noop }));
    expect(ann).not.toContain("Announcement");
    expect(stickyLead({ kind: "quest", caption: "New quest: The Hunt" })).toBe("New quest: The Hunt");
    expect(stickyLead({ kind: "objective", caption: "New objective" })).toBeNull();
  });
});

describe("a new objective flashes the NOW bar", () => {
  it("on a guest's frame a loud objective below the modal rungs is the NOW bar's, never a sticky", () => {
    const s = run([arrive([objective("pass")], "sticky")]);
    expect(surfacesOf(s, false).sticky?.moment.key).toBe("o:pass"); // a booth: no NOW bar
    const v = surfacesOf(s, false, true);
    expect(v.now?.moment.key).toBe("o:pass");
    expect(v.sticky).toBeNull();
    expect(v.stickyCount).toBe(0);
  });

  it("at dialog it is still the loud modal", () => {
    const s = run([arrive([objective("pass")], "dialog")]);
    const v = surfacesOf(s, false, true);
    expect(v.now).toBeNull();
    expect(v.modal?.moment.key).toBe("o:pass");
  });

  it("an alarm sticky never folds the objective away", () => {
    let s = run([arrive([objective("pass")], "sticky")]);
    s = run([arrive([moment(3)], "sticky")], s);
    const v = surfacesOf(s, false, true);
    expect(v.now?.moment.key).toBe("o:pass");
    expect(v.sticky?.moment.seq).toBe(3);
    expect(s.missed).toEqual([]);
  });
});

describe("severity is the icon", () => {
  it("the red stop only for a `!` alarm, the warning for another major message, information for notices and minor ones", () => {
    expect(iconOf({ severity: "major", kind: "alert" })).toBe("error");
    // a `reply !…` readout is a `!` alarm too
    expect(iconOf({ severity: "major", kind: "readout", alarm: true })).toBe("error");
    expect(iconOf({ severity: "major", kind: "readout" })).toBe("warning");
    expect(iconOf({ severity: "major", kind: "other" })).toBe("warning");
    // notices: a card that asks, a quest, an objective, a beat's line
    for (const kind of ["card", "quest", "objective", "beat"] as const) expect(iconOf({ severity: "major", kind })).toBe("info");
    expect(iconOf({ severity: "minor", kind: "readout" })).toBe("info");
    expect(iconOf({ severity: "minor", kind: "alert" })).toBe("info");
  });

  it("the icon follows the moment, never the level it is shown at", () => {
    const notice = moment(30, { kind: "quest", text: "Round 2: one hour." });
    for (const level of ["dialog", "bsod"] as const) {
      const html = renderToStaticMarkup(createElement(MomentDialog, { q: q(notice, level), index: 1, total: 1, exits: [], onExit: noop, onDismiss: noop }));
      expect(html).toContain("moments-ico-info");
      expect(html).not.toContain("moments-ico-error");
    }
  });

  it("an alarm's dialog keeps the navy caption and carries the stop icon", () => {
    const html = renderToStaticMarkup(createElement(MomentDialog, { q: q(moment(1), "dialog"), index: 1, total: 1, exits: [], onExit: noop, onDismiss: noop }));
    expect(html).toContain('class="w95-titlebar "');
    expect(html).not.toContain("w95-titlebar alarm");
    expect(html).toContain("moments-ico-error");
  });
});

describe("the blue screen under plain", () => {
  it("neutral copy: no fault address, no Press any key — Tap to continue", () => {
    const m = moment(4, { kind: "beat", severity: "minor", caption: "Trabolta", text: "Trabolta: I remember her." });
    const exits = [{ label: "What do I do?", icon: "start" as const, nav: { to: "mission" as const } }];
    const plain = renderToStaticMarkup(createElement(BlueScreen, { q: q(m, "bsod"), index: 1, total: 1, exits, onExit: noop, onDismiss: noop, win95: false }));
    expect(plain).not.toContain("fatal exception");
    expect(plain).not.toContain("Press any key");
    expect(plain).toContain("Tap to continue");
    expect(plain).toContain(">Trabolta<"); // not shouted
    expect(plain).toContain("What do I do?");
    expect(plain).not.toContain("Take me there");
    const w95 = renderToStaticMarkup(createElement(BlueScreen, { q: q(m, "bsod"), index: 1, total: 1, exits: [], onExit: noop, onDismiss: noop, win95: true }));
    expect(w95).toContain("fatal exception 0E");
    expect(w95).toContain("Press any key to continue");
  });
});

describe("Take me there", () => {
  const cards = [{ glyph: "📝", channel: "dm:Trabolta", seq: 40 }, { glyph: "📊", channel: "dm:Trabolta", seq: 41 }];
  it("never to the room already open", () => {
    expect(exitRoomFor(moment(1, { channel: "loc:The Desktop", text: "ALL PROGRAMS: to the Desktop." }), { open: "loc:The Desktop", cards: [] })).toBeNull();
    expect(exitRoomFor(moment(1, { channel: "loc:The Desktop", text: "ALL PROGRAMS: to the Desktop." }), { open: null, cards: [] })).toBe("loc:The Desktop");
  });

  it("a moment about a live card goes to the card's room; never the lobby it was posted in (G2)", () => {
    const m = moment(2, { channel: "lobby", text: "📝 Last chance: file your round-one facts with Trabolta." });
    expect(exitRoomFor(m, { open: null, cards })).toBe("dm:Trabolta");
    expect(exitRoomFor(m, { open: "dm:Trabolta", cards })).toBeNull(); // already at the card
    expect(exitRoomFor(m, { open: null, cards: [] })).toBeNull(); // no such card: never the lobby
    expect(exitRoomFor(moment(3, { channel: "lobby", text: "No glyph here." }), { open: null, cards })).toBeNull();
  });

  it("an announcement that says 'check your messages' opens the DM it names, else the DM that heard last", () => {
    const dms = [
      { id: "dm:Trabolta", title: "Trabolta", last: 90 },
      { id: "dm:Truther_Download", title: "Truther Download", last: 88 },
      { id: "dm:Clippy", title: "Clippy", last: 12 },
    ];
    const truther = moment(4, { channel: "lobby", text: "📥 TRUTHER DOWNLOAD received. Check your messages. # truthcoin-exchange is open." });
    expect(exitRoomFor(truther, { open: null, cards: [], dms })).toBe("dm:Truther_Download");
    expect(exitRoomFor(truther, { open: "dm:Truther_Download", cards: [], dms })).toBeNull();
    // Names no DM: the one that heard last.
    expect(exitRoomFor(moment(5, { channel: "lobby", text: "Something arrived. Check your messages." }), { open: null, cards: [], dms })).toBe("dm:Trabolta");
    // Only a mention, no "check your messages": no room (never the lobby).
    expect(exitRoomFor(moment(6, { channel: "lobby", text: "📊 THE TRUST CHART. Trabolta is ranking every program on the TV." }), { open: null, cards: [], dms })).toBeNull();
    // A room's own moment that says it: the DM it names.
    expect(exitRoomFor(moment(7, { channel: "loc:The Desktop", text: "Check your messages, Trabolta says." }), { open: null, cards: [], dms })).toBe("dm:Trabolta");
  });
});

describe("a booth's peek follows its sticky twin (merged with fbooth's peeks)", () => {
  it("a folded sticky and a read take their peeks with them", async () => {
    const { peekFor } = await import("../src/moments/model.ts");
    const a = moment(1, { kind: "readout", text: "🚨 Calculator marked" });
    const b = moment(2, { kind: "readout", text: "🚨 Winamp marked" });
    let s = run([arrive([a, peekFor(a)], "sticky", "booth")]);
    expect(surfacesOf(s, true).balloon?.moment.peekOf).toBe("m:1");
    // A second sticky folds the first (no more urgent) — its peek goes too.
    s = run([arrive([b, peekFor(b)], "sticky", "booth")], s);
    expect(s.queue.map((x) => x.moment.key).sort()).toEqual(["m:2", "p:m:2"]);
    expect(s.missed.map((m) => m.key)).toEqual(["m:1"]);
    // Read: the sticky and its peek leave.
    s = momentsReducer(s, { type: "read", keys: surfacesOf(s, true).stickyKeys });
    expect(s.queue).toEqual([]);
  });
});

describe("a sticky's words stop at three lines (finish review #2)", () => {
  it("a long sticky is clamped with 'more ›'; a short one has no 'more'", () => {
    const long = moment(50, { kind: "quest", caption: "New quest: The Truth Scavenger Hunt", text: "Round 2: It is more important than ever that I get the information I need. One hour. The books have not moved. Return to the Desktop for the Second Moment of Truth.\n- Q1. What extension does the Customer Care card tell you to dial?" });
    const html = renderToStaticMarkup(createElement(StickyBanner, { q: q(long, "sticky"), count: 1, exits: [], onExit: noop, onDismiss: noop }));
    expect(html).toContain('class="moments-sticky-words clamp"');
    expect(html).toMatch(/<button type="button" class="w95-btn moments-sticky-more" aria-expanded="false">more ›<\/button>/u);
    const short = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(51, { text: "Snacks are in The Start Bar." }), "sticky"), count: 1, exits: [], onExit: noop, onDismiss: noop }));
    expect(short).not.toContain("moments-sticky-more");
    const css = readBundledCss();
    expect(css).toMatch(/\.moments-sticky-words\.clamp \{[^}]*-webkit-line-clamp: 3;[^}]*overflow: hidden/u);
  });
});

describe("the host balloon in the tight layout (finish review #3)", () => {
  it("never clips the whole box mid-line, never leaves the screen: one row, then whole lines (≤ 2) or none", () => {
    const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
    // No max-height / overflow on the tight balloon box itself.
    expect(css).not.toMatch(/\[data-host-drawer="tight"\] \.moments-balloon \{[^}]*max-height/u);
    // One 44 px row: the head's parts and "Take me there" flow side by side.
    expect(css).toMatch(/\[data-host-drawer="tight"\] \.moments-balloon \{[^}]*flex-direction: row;[^}]*flex-wrap: wrap/u);
    expect(css).toMatch(/\[data-host-drawer="tight"\] \.moments-balloon-head \{ display: contents; \}/u);
    expect(css).toMatch(/\[data-host-drawer="tight"\] \.moments-balloon-caption \{[^}]*white-space: nowrap/u);
    // Never above the top of the screen: the row's top stays on it (over the console's edge when it must).
    expect(css).toMatch(/@supports \(bottom: min\(1px, 2px\)\) \{\s*\[data-host-drawer="tight"\] \.moments-balloon \{ bottom: min\(calc\(var\(--host-drawer-lift\) \+ 14px\), calc\(100% - var\(--safe-top\) - var\(--tap\) - 16px\)\); \}/u);
    // The fallback: the message is left out; with round(): whole lines, at most two.
    expect(css).toMatch(/\[data-host-drawer="tight"\] \.moments-balloon-text \{[^}]*display: none; \}/u);
    expect(css).toMatch(/@supports \(max-height: round\(down, 100px, 10px\)\) \{\s*\[data-host-drawer="tight"\] \.moments-balloon-text \{[^}]*-webkit-line-clamp: 2;[^}]*round\(down, calc\(var\(--host-drawer-room\) - 66px\), 1\.35em\), 2\.7em\)/u);
  });
});
