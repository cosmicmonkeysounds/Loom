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

function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `moment ${seq}`, channel: "lobby", at: seq * 1000, phase: "hunt", ...over };
}
const objective = (id: string, over: Partial<Moment> = {}): Moment => ({ ...moment(0, { key: `o:${id}`, seq: null, kind: "objective", caption: "New objective", text: "Show your pass\nHold it up.", channel: null, pass: true }), ...over });
const arrive = (moments: Moment[], level: AlertLevel = "dialog", role: "guest" | "booth" = "guest"): MomentsAction => ({ type: "arrive", moments, visible: true, level, role, now: 0, phase: "hunt", batch: false });
const run = (actions: MomentsAction[], from: MomentsState = EMPTY_MOMENTS) => actions.reduce(momentsReducer, from);
const noop = () => {};
const q = (m: Moment, level: AlertLevel) => ({ moment: m, level, queuedAt: 0 });

describe("an alarm jumps the queue", () => {
  it("priority: `!` alert > other major > loud objective > minor", () => {
    expect(priorityOf({ kind: "alert", severity: "major" })).toBe(3);
    expect(priorityOf({ kind: "card", severity: "major" })).toBe(2);
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

  it("a minor moment never gets ahead of a major one; arrival order holds within a rank", () => {
    const s = run([arrive([moment(1, { kind: "card" }), moment(2, { kind: "readout", severity: "minor" }), moment(3, { kind: "card" })], "bsod")]);
    expect(s.queue.map((x) => x.moment.seq)).toEqual([1, 3, 2]);
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

  it("an older alarm stays up; a lesser sticky waits behind it, and Dismiss all takes both, read", () => {
    let s = run([arrive([moment(1)], "sticky")]); // a `!` alarm
    s = run([arrive([moment(2, { kind: "other" })], "sticky")], s);
    const v = surfacesOf(s, false);
    expect(v.sticky?.moment.seq).toBe(1);
    expect(v.stickyCount).toBe(2);
    expect(s.missed).toEqual([]);
    s = momentsReducer(s, { type: "dismissMany", keys: v.stickyKeys });
    expect(s.queue).toEqual([]);
    expect(s.missed).toEqual([]); // read, not missed
  });

  it("a wake's replay of a few stickies shows them all, with the count (only a live arrival folds)", () => {
    let s: MomentsState = { ...EMPTY_MOMENTS, missed: [moment(1, { kind: "other" }), moment(2, { kind: "other" })] };
    s = momentsReducer(s, { type: "wake", level: "sticky", role: "guest", now: 0, phase: "hunt" });
    expect(surfacesOf(s, false).stickyCount).toBe(2);
  });

  it("the bar itself: no uppercase caption over the words, the speaker inline, Dismiss all (n) when more wait", () => {
    const html = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(1, { kind: "other", caption: "Trabolta" }), "sticky"), count: 2, canGo: false, onGo: noop, onDismiss: noop, onDismissAll: noop }));
    expect(html).toContain('<strong class="moments-sticky-lead">Trabolta: </strong>moment 1');
    expect(html).toContain("Dismiss all (2)");
    expect(html).not.toContain("alarm"); // the full yellow is the `!` alarm's only
    const ann = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(1, { caption: "Announcement" }), "sticky"), count: 1, canGo: false, onGo: noop, onDismiss: noop }));
    expect(ann).not.toContain("Announcement");
    expect(ann).not.toContain("Dismiss all");
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
  it("a `!` alarm is the red stop, other major the warning, minor information", () => {
    expect(iconOf({ severity: "major", kind: "alert" })).toBe("error");
    expect(iconOf({ severity: "major", kind: "card" })).toBe("warning");
    expect(iconOf({ severity: "minor", kind: "readout" })).toBe("info");
  });

  it("an alarm's dialog keeps the navy caption and carries the stop icon", () => {
    const html = renderToStaticMarkup(createElement(MomentDialog, { q: q(moment(1), "dialog"), index: 1, total: 1, canGo: false, onGo: noop, onDismiss: noop }));
    expect(html).toContain('class="w95-titlebar "');
    expect(html).not.toContain("w95-titlebar alarm");
    expect(html).toContain("moments-ico-error");
  });
});

describe("the blue screen under plain", () => {
  it("neutral copy: no fault address, no Press any key — Tap to continue", () => {
    const m = moment(4, { kind: "beat", severity: "minor", caption: "Trabolta", text: "Trabolta: I remember her." });
    const plain = renderToStaticMarkup(createElement(BlueScreen, { q: q(m, "bsod"), index: 1, total: 1, canGo: true, onGo: noop, onDismiss: noop, win95: false }));
    expect(plain).not.toContain("fatal exception");
    expect(plain).not.toContain("Press any key");
    expect(plain).toContain("Tap to continue");
    expect(plain).toContain(">Trabolta<"); // not shouted
    expect(plain).toContain("Take me there");
    const w95 = renderToStaticMarkup(createElement(BlueScreen, { q: q(m, "bsod"), index: 1, total: 1, canGo: false, onGo: noop, onDismiss: noop, win95: true }));
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

  it("a moment about a live card goes to the card's room, not the lobby it was posted in", () => {
    const m = moment(2, { channel: "lobby", text: "📝 Last chance: file your round-one facts with Trabolta." });
    expect(exitRoomFor(m, { open: null, cards })).toBe("dm:Trabolta");
    expect(exitRoomFor(m, { open: "dm:Trabolta", cards })).toBeNull(); // already at the card
    expect(exitRoomFor(m, { open: null, cards: [] })).toBe("lobby"); // no such card: its own room
    expect(exitRoomFor(moment(3, { channel: "lobby", text: "No glyph here." }), { open: null, cards })).toBe("lobby");
  });
});
