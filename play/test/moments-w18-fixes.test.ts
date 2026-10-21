//! Wave 18 fix round, the moments lane: the testers' findings as the
//! reducer's and the model's rules — a new sign-in's swept bigs (GN-F7 /
//! NM-F3), a big card never escaped (NM-F2), the backlog's supersession
//! (BN-F10), the newest house banner only (GN-F2), the NOW change retiring
//! the house's old news (GN-F2), the self-naming cheer (GN-F14), captions
//! (GN-F12), card glyphs (GN-F10), big readouts that never wait (GN-F15),
//! and exits that are never empty on a big (NM-F1).

import { describe, expect, it } from "vitest";
import {
  BIG_WINDOW_MS,
  EMPTY_MOMENTS,
  momentOf,
  momentsReducer,
  namesViewer,
  newestHouseSeq,
  priorityOf,
  sortArrivals,
  surfacesOf,
  sweepBigs,
  wakeReplay,
  type Moment,
  type MomentsAction,
  type MomentsState,
  type Viewer,
} from "../src/moments/model.ts";
import { bigParts } from "../src/moments/big-parts.ts";
import { exitsOf, type ExitContext } from "../src/moments/exits.ts";
import type { ChatMessage } from "../src/types.ts";

function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `moment ${seq}`, channel: "lobby", at: seq * 1000, phase: "p", ...over };
}
const big = (seq: number, over: Partial<Moment> = {}) => moment(seq, { severity: "big", kind: "readout", ...over });
const arrive = (moments: Moment[], over: Partial<Extract<MomentsAction, { type: "arrive" }>> = {}): MomentsAction => ({ type: "arrive", moments, visible: true, level: "sticky", role: "guest", now: 0, phase: "p", batch: false, ...over });
const run = (actions: MomentsAction[], from: MomentsState = EMPTY_MOMENTS) => actions.reduce(momentsReducer, from);
const guest: Viewer = { role: "guest", me: "g1", name: "Winamp" };

function msg(seq: number, over: Partial<ChatMessage> & Record<string, unknown> = {}): ChatMessage {
  return { seq, channel: "lobby", channelKind: "lobby", title: "Trapped in the Internet", from: "", kind: "narration", text: "x", ts: seq * 1000, audience: ["g1"], parentSeq: null, hidden: false, ...over } as ChatMessage;
}

const ctx = (over: Partial<ExitContext> = {}): ExitContext => ({ listed: new Set(["loc:The Desktop"]), titles: new Map(), open: null, window: "mission", cards: [], dms: [], actions: new Set(), sides: true, ...over });

describe("a new sign-in's first backlog (GN-F7 / NM-F3)", () => {
  const now = 100 * 60_000;
  const list = [
    msg(10, { moment: "big", kind: "widget", alert: true, widget: { kind: "sides", text: "🕚 Doors", params: {} }, ts: now - 40 * 60_000 }),
    msg(11, { moment: "big", alert: true, readout: true, text: "🛡 Found you.", ts: now - 60_000 }),
    msg(12, { moment: "big", alert: true, readout: true, text: "🎀 Old news.", ts: now - BIG_WINDOW_MS - 1 }),
    msg(13, { moment: "big", alert: true, audience: "all", autoClose: 6000, text: "🎀 ICQ won!" }),
    msg(14, { moment: "big", kind: "widget", alert: true, widget: { kind: "poll", text: "🍾 Truth?", params: {} } }),
  ];
  const sweep = (o: { answered?: number[]; acked?: string[] } = {}) =>
    sweepBigs(list, 20, guest, { now, phase: null, acked: new Set(o.acked ?? []), answered: (s) => (o.answered ?? []).includes(s), processed: new Set() }).map((m) => m.seq);

  it("an unanswered card at any age, another big inside the window; never a self-closing cheer", () => {
    expect(sweep()).toEqual([10, 11, 14]);
  });
  it("never one answered or acknowledged", () => {
    expect(sweep({ answered: [10], acked: ["m:11"] })).toEqual([14]);
  });
  it("a backlog wake keeps every unanswered card past the window", () => {
    const old = big(1, { kind: "card", at: 0 });
    expect(wakeReplay([old], {}, "p", BIG_WINDOW_MS * 3).show.map((m) => m.seq)).toEqual([1]);
  });
});

describe("a big card is never escaped (NM-F2)", () => {
  it("an exit with `keep` takes it off the screen but a wake brings it back", () => {
    let s = run([arrive([big(5, { kind: "card" })])]);
    s = momentsReducer(s, { type: "dismiss", key: "m:5", onScreenMs: 2000, acted: true, keep: true });
    expect(surfacesOf(s, false).big).toBeNull();
    expect(s.missed.map((m) => m.seq)).toEqual([5]);
    s = momentsReducer(s, { type: "wake", level: "sticky", role: "guest", now: 0, phase: "p", storyNow: 10_000 });
    expect(surfacesOf(s, false).big?.moment.seq).toBe(5);
  });
});

describe("a backlog keeps the newest of each (BN-F10)", () => {
  it("cards first, then the newest of yours, then the newest of the house; the rest superseded", () => {
    const list = [big(1, { text: "🎱 BINGO" }), big(2, { text: "🌐 Sent to the Internet" }), big(3, { text: "🦆 Reinstalled" }), big(4, { kind: "card" }), big(5, { house: true }), big(6, { house: true })];
    const { show, rest } = wakeReplay(list, {}, "p", 10_000);
    expect(show.map((m) => m.seq)).toEqual([4, 3, 6]);
    expect(rest.filter((m) => m.superseded === true).map((m) => m.seq).sort()).toEqual([1, 2, 5]);
    // A superseded one never comes back on a later wake.
    expect(wakeReplay(rest, {}, "p", 10_000).show).toEqual([]);
  });
  it("a big card is your move: it outranks your other bigs", () => {
    expect(priorityOf({ severity: "big", kind: "card" })).toBeGreaterThan(priorityOf({ severity: "big", kind: "readout" }));
    const s = run([arrive([big(1), big(2, { kind: "card" })])]);
    expect(surfacesOf(s, false).big?.moment.seq).toBe(2);
  });
});

describe("one house banner: the newest of all (GN-F2)", () => {
  it("an older banner never comes back over a newer one already seen", () => {
    const older = moment(3, { house: true });
    expect(wakeReplay([older], {}, "p", undefined, 9).show).toEqual([]);
    expect(wakeReplay([older], {}, "p", undefined, 3).show.map((m) => m.seq)).toEqual([3]);
    expect(newestHouseSeq([msg(3, { audience: "all", alert: true, moment: "major" }), msg(9, { audience: "all", alert: true, moment: "major" }), msg(12, { audience: ["g1"], alert: true, moment: "major" })], guest, null)).toBe(9);
  });
  it("the NOW objective changing retires the house moments from before it, never the bigs or the press's own", () => {
    let s = run([arrive([moment(1, { house: true, at: 10_000 }), big(2, { house: true, at: 10_000 }), moment(3, { house: true, at: 59_000 })])]);
    s = momentsReducer(s, { type: "now", storyNow: 60_000 });
    expect(s.queue.map((q) => q.moment.seq).sort()).toEqual([2, 3]);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
  });
});

describe("the moment's words (GN-F12, GN-F10, GN-F14)", () => {
  it("a house broadcast is an Announcement; a line for you alone is For you; an invitation an Invitation", () => {
    expect(momentOf(msg(1, { audience: "all", alert: true }), guest, null)?.caption).toBe("Announcement");
    expect(momentOf(msg(2, { alert: true, readout: true }), guest, null)?.caption).toBe("For you");
    expect(momentOf(msg(3, { moment: "big", kind: "widget", widget: { kind: "invite", text: "Ada wants you", params: {} } }), guest, null)?.caption).toBe("Invitation");
  });
  it("a card kind has its own glyph, never the joker", () => {
    expect(bigParts("Ada wants you in Night Shift", "card", "invite").glyph).toBe("🚪");
    expect(bigParts("What's the line?", "card", "answer").glyph).toBe("💬");
    expect(bigParts("Something", "card", "unknown").glyph).toBe("🃏");
  });
  it("a house cheer that names you is not for you; anyone else's is", () => {
    const cheer = msg(4, { moment: "big", alert: true, audience: "all", autoClose: 6000, text: "🎀 Winamp won the Bingo Ribbon! Cheer for them at the Desktop." });
    expect(momentOf(cheer, guest, null)).toBeNull();
    expect(momentOf(cheer, { ...guest, name: "ICQ" }, null)?.severity).toBe("big");
    expect(namesViewer("🎀 Winampy won", "Winamp")).toBe(false);
    expect(namesViewer("🎀 C++ (the fan) won", "C++ (the fan)")).toBe(true);
  });
});

describe("a big readout never waits for a toast (GN-F15)", () => {
  it("it shows with the batch, not 1.2 s after the house cheer", () => {
    const r = sortArrivals([big(1, { kind: "readout" }), moment(2, { severity: "minor", kind: "readout" })], { role: "guest", held: false, sinceHoldEnd: Infinity, about: () => false, recent: [], now: 0 });
    expect(r.now.map((m) => m.seq)).toEqual([1]);
    expect(r.later.map((m) => m.seq)).toEqual([2]);
  });
});

describe("exits on a big are never empty; a side already chosen is never asked again (NM-F1, NM-F4)", () => {
  it("on Mission, a big with nothing else still offers What do I do?", () => {
    const m = moment(1, { severity: "big", kind: "readout", channel: "lobby" });
    expect(exitsOf(m, ctx(), 2)).toEqual([]);
    expect(exitsOf(m, ctx(), 2, { big: true }).map((e) => e.nav)).toEqual([{ to: "mission" }]);
  });
  it("a `sides` exit reads Sides once the guest is on one", () => {
    const m = moment(1, { go: [{ kind: "sides", label: "Choose a side" }] });
    expect(exitsOf(m, ctx(), 2)[0]?.label).toBe("Choose a side");
    expect(exitsOf(m, ctx({ sideChosen: true }), 2)[0]?.label).toBe("Sides");
  });
});
