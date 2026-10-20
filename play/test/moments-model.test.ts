//! Wave 13, the moments lane: the pure interrupt layer — rungs, the booth
//! cap, the queue, the blue screen per beat, the hold, the missed list, the
//! wake replay with staleness, the compressed list, the reload window, the
//! loud objective, the glitch rule, and the layer order in the stylesheet.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Alerts } from "../src/alerts.ts";
import { boothAlertFilter } from "../src/alerts.ts";
import {
  EMPTY_MOMENTS,
  GLANCE_MS,
  HOLD_MISS_MS,
  MOMENT_WINDOW_MS,
  DONE_MAX,
  arrivals,
  beatLineReaches,
  doneAbove,
  beatOpensScreen,
  boothSeverity,
  capLevel,
  faultAddress,
  isStale,
  loudObjectives,
  missedCount,
  momentOf,
  momentsReducer,
  rungFor,
  sameWords,
  settledMark,
  shouldGlitch,
  storyNow,
  surfacesOf,
  type Moment,
  type MomentsAction,
  type MomentsState,
  type Viewer,
} from "../src/moments/model.ts";
import { MomentsLayer, MomentsProvider, type MomentsInput } from "../src/moments/provider.tsx";
import { Balloon, BlueScreen, MissedList, MomentDialog, StickyBanner, SummarySticky } from "../src/moments/surfaces.tsx";
import type { AlertLevel, ChatMessage, ObjectiveView } from "../src/types.ts";
import { readBundledCss } from "./css.ts";

const MIN = 60_000;

function msg(seq: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "Trapped in the Internet",
    from: "",
    kind: "signal",
    text: `moment ${seq}`,
    ts: seq * 1000,
    audience: "all",
    parentSeq: null,
    hidden: false,
    ...over,
  } as ChatMessage;
}

function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `moment ${seq}`, channel: "lobby", at: seq * 1000, phase: "hunt", ...over };
}

const guest: Viewer = { role: "guest", me: "g1", here: "loc:The Desktop" };
const booth: Viewer = { role: "booth", me: "Norton", filter: boothAlertFilter("Norton") };

function run(actions: MomentsAction[], from: MomentsState = EMPTY_MOMENTS): MomentsState {
  return actions.reduce(momentsReducer, from);
}

function arrive(moments: Moment[], over: Partial<Extract<MomentsAction, { type: "arrive" }>> = {}): MomentsAction {
  return { type: "arrive", moments, visible: true, level: "dialog", role: "guest", now: 0, phase: "hunt", batch: false, ...over };
}

describe("the rung each moment renders on", () => {
  it("major at the level, minor one rung lower, floored at a balloon", () => {
    const levels: AlertLevel[] = ["balloon", "sticky", "dialog", "bsod"];
    expect(levels.map((l) => rungFor({ severity: "major", kind: "alert" }, l, "guest"))).toEqual(["balloon", "sticky", "dialog", "bsod"]);
    expect(levels.map((l) => rungFor({ severity: "minor", kind: "readout" }, l, "guest"))).toEqual(["balloon", "balloon", "sticky", "dialog"]);
  });

  it("a beat's line is a blue screen; a booth is capped at sticky and never sees one", () => {
    expect(rungFor({ severity: "minor", kind: "beat" }, "bsod", "guest")).toBe("bsod");
    expect(rungFor({ severity: "major", kind: "alert" }, "bsod", "booth")).toBe("sticky");
    expect(rungFor({ severity: "major", kind: "alert" }, "dialog", "booth")).toBe("sticky");
    expect(rungFor({ severity: "minor", kind: "alert" }, "bsod", "booth")).toBe("balloon");
    expect(capLevel("balloon", "sticky")).toBe("balloon");
  });

  it("on a booth an `\"all\"` guest alert is minor; @me, a staff room and its own Inbox keep major", () => {
    expect(boothSeverity(msg(1, { alert: true }), "Norton", "major")).toBe("minor");
    expect(boothSeverity(msg(2, { audience: ["@Norton"] }), "Norton", "major")).toBe("major");
    expect(boothSeverity(msg(3, { channel: "room:hosts", channelKind: "faction", audience: [] }), "Norton", "major")).toBe("major");
    expect(boothSeverity(msg(4, { channel: "dm:Norton", channelKind: "dm", audience: ["@Norton"], readout: true }), "Norton", "major")).toBe("major");
    // A `!` that reached nobody (an empty room's lights-out) stays minor.
    expect(boothSeverity(msg(5, { channelKind: "location", channel: "loc:The CPU", audience: [] }), "Norton", "major")).toBe("minor");
    // And through momentOf, with the booth filter: a guest's own pin is no booth moment at all.
    expect(momentOf(msg(6, { alert: true, moment: "major", audience: ["g7"], pin: "g7" }), booth, null)).toBeNull();
    expect(momentOf(msg(7, { alert: true, moment: "major" }), booth, null)?.severity).toBe("minor");
  });
});

describe("which messages are moments", () => {
  it("the server's class wins; an old server's `!` is major; takeovers and hidden rows never are", () => {
    expect(momentOf(msg(1, { moment: "minor", readout: true, kind: "narration" }), guest, "hunt")).toMatchObject({ severity: "minor", kind: "readout", channel: "lobby", phase: "hunt" });
    expect(momentOf(msg(2, { alert: true }), guest, null)?.severity).toBe("major");
    expect(momentOf(msg(3, { alert: true, takeover: true, pin: "" }), guest, null)).toBeNull();
    expect(momentOf(msg(4, { alert: true, hidden: true }), guest, null)).toBeNull();
    expect(momentOf(msg(5, { kind: "line" }), guest, null)).toBeNull();
  });

  it("a card that asks shows its own text; a quest names itself", () => {
    const card = momentOf(msg(1, { kind: "widget", moment: "major", text: "", widget: { kind: "truth", text: "The bottle points at you.", params: { moment: "major" } } }), guest, null)!;
    expect(card).toMatchObject({ kind: "card", text: "The bottle points at you." });
    const quest = momentOf(msg(2, { kind: "quest", channel: "quests", channelKind: "quests", from: "Clippy", moment: "minor", text: "Find ten facts.", quest: { quest: "hunt", title: "The Hunt", action: "start" } }), guest, null)!;
    expect(quest).toMatchObject({ kind: "quest", caption: "New quest: The Hunt", text: "Find ten facts.", channel: "quests" });
  });
});

describe("the queue", () => {
  it("dialogs wait one at a time: 1 of 3, then 2 of 3, then 3 of 3", () => {
    let s = run([arrive([moment(1)]), arrive([moment(2)]), arrive([moment(3)])]);
    let v = surfacesOf(s, false);
    expect([v.modal?.moment.seq, v.modalIndex, v.modalTotal]).toEqual([1, 1, 3]);
    s = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 5_000 });
    v = surfacesOf(s, false);
    expect([v.modal?.moment.seq, v.modalIndex, v.modalTotal]).toEqual([2, 2, 3]);
    s = momentsReducer(s, { type: "dismiss", key: "m:2", onScreenMs: 5_000 });
    v = surfacesOf(s, false);
    expect([v.modal?.moment.seq, v.modalIndex, v.modalTotal]).toEqual([3, 3, 3]);
    s = momentsReducer(s, { type: "dismiss", key: "m:3", onScreenMs: 5_000 });
    expect(surfacesOf(s, false).modal).toBeNull();
    expect(s.burst).toBe(0);
    expect(s.missed).toEqual([]);
  });

  it("each rung has its own surface: a minor moment balloons beside a major dialog", () => {
    const s = run([arrive([moment(1), moment(2, { severity: "minor", kind: "readout" })], { level: "sticky" })]);
    const v = surfacesOf(s, false);
    expect(v.sticky?.moment.seq).toBe(1);
    expect(v.balloon?.moment.seq).toBe(2);
    expect(v.modal).toBeNull();
  });

  it("lowering the level live lowers what is already queued (D2: switchable live)", () => {
    let s = run([arrive([1, 2, 3].map((n) => moment(n, { channel: `dm:${n}` })), { level: "dialog" }), arrive([moment(4, { severity: "minor", kind: "readout" })], { level: "dialog" })]);
    s = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 5_000 });
    expect(surfacesOf(s, false).modalIndex).toBe(2);
    s = momentsReducer(s, { type: "relevel", level: "balloon", role: "guest" });
    const v = surfacesOf(s, false);
    expect(v.modal).toBeNull();
    expect(s.queue.map((q) => q.level)).toEqual(["balloon", "balloon", "balloon"]);
    expect(s.burst).toBe(0);
    // Back up: they climb again, and "1 of 2" starts over.
    s = momentsReducer(s, { type: "relevel", level: "dialog", role: "guest" });
    expect([surfacesOf(s, false).modal?.moment.seq, surfacesOf(s, false).modalIndex, surfacesOf(s, false).modalTotal]).toEqual([2, 1, 2]);
    expect(momentsReducer(s, { type: "relevel", level: "dialog", role: "guest" })).toBe(s);
  });

  it("a queued blue screen leaves when the level drops below bsod; a booth never climbs past sticky", () => {
    let s = run([arrive([moment(1, { kind: "beat", severity: "minor" }), moment(2)], { level: "bsod" })]);
    expect(s.queue.map((q) => q.level)).toEqual(["bsod", "bsod"]);
    s = momentsReducer(s, { type: "relevel", level: "dialog", role: "guest" });
    expect(s.queue.map((q) => [q.moment.seq, q.level])).toEqual([[2, "dialog"]]);
    const b = momentsReducer(run([arrive([moment(3)], { level: "balloon", role: "booth" })]), { type: "relevel", level: "bsod", role: "booth" });
    expect(b.queue.map((q) => q.level)).toEqual(["sticky"]);
  });

  it("the same moment never queues twice", () => {
    const s = run([arrive([moment(1)]), arrive([moment(1)])]);
    expect(s.queue).toHaveLength(1);
  });
});

describe("the blue screen: once per beat", () => {
  const line = (seq: number, beat: string, over: Partial<ChatMessage> = {}) => msg(seq, { kind: "line", from: "Trabolta", beat, channel: "dm:Trabolta", channelKind: "dm", audience: ["g1"], ts: seq * 1000, ...over });

  it("only the first line of each beat reaching you opens a screen", () => {
    const beats = new Map<string, number>();
    const list = [line(1, "Recounts"), line(2, "Recounts"), line(3, "Recounts"), line(4, "Truth Txt"), line(5, "Truth Txt")];
    const r = arrivals(list, -1, new Set(), guest, { now: 10_000, phase: null, bsod: true, beats });
    expect(r.moments.map((m) => [m.seq, m.kind, rungFor(m, "bsod", "guest")])).toEqual([
      [1, "beat", "bsod"],
      [4, "beat", "bsod"],
    ]);
    expect(r.seen).toEqual([1, 2, 3, 4, 5]);
    expect(r.moments[0]!.text).toBe("Trabolta: moment 1");
  });

  it("a beat played again after a quiet gap earns a new screen", () => {
    const beats = new Map<string, number>();
    expect(beatOpensScreen("Hunt", 0, beats)).toBe(true);
    expect(beatOpensScreen("Hunt", 60_000, beats)).toBe(false);
    expect(beatOpensScreen("Hunt", 60_000 + 3 * MIN, beats)).toBe(true);
  });

  it("reaches you = your DMs, the lobby, the room you stand in; typed chat, cards and other rooms never", () => {
    expect(beatLineReaches(line(1, "B"), guest)).toBe(true);
    expect(beatLineReaches(line(2, "B", { channel: "loc:The Desktop", channelKind: "location", audience: "all" }), guest)).toBe(true);
    expect(beatLineReaches(line(3, "B", { channel: "loc:The CPU", channelKind: "location", audience: "all" }), guest)).toBe(false);
    expect(beatLineReaches(line(4, "", { beat: null }), guest)).toBe(false);
    expect(beatLineReaches(line(5, "B", { kind: "widget" }), guest)).toBe(false);
    expect(beatLineReaches(line(6, "B", { audience: ["g2"] }), guest)).toBe(false);
    expect(beatLineReaches(line(7, "B", { ambient: true, channel: "lobby", channelKind: "lobby", audience: "all" }), guest)).toBe(false);
    expect(beatLineReaches(line(8, "B"), booth)).toBe(false);
  });

  it("below bsod a beat's lines are tracked, never screened (turning bsod on mid-beat starts with the next beat)", () => {
    const beats = new Map<string, number>();
    const off = arrivals([line(1, "Recounts")], -1, new Set(), guest, { now: 10_000, phase: null, bsod: false, beats });
    expect(off.moments).toEqual([]);
    const on = arrivals([line(2, "Recounts"), line(3, "Purgatory")], 1, new Set([1]), guest, { now: 10_000, phase: null, bsod: true, beats });
    expect(on.moments.map((m) => m.seq)).toEqual([3]);
  });
});

describe("the busy-surface hold", () => {
  it("no dialog / bsod while held; balloons and stickies still show; the dialog shows on release", () => {
    const s = run([arrive([moment(1), moment(2, { severity: "minor" })], { level: "dialog" })]);
    const held = surfacesOf(s, true);
    expect(held.modal).toBeNull();
    expect(held.sticky?.moment.seq).toBe(2);
    expect(surfacesOf(s, false).modal?.moment.seq).toBe(1);
  });

  it("a dialog kept back more than 30 s counts as missed, and the release replays it", () => {
    let s = run([arrive([moment(1)], { now: 0 })]);
    s = momentsReducer(s, { type: "tick", now: HOLD_MISS_MS - 1, held: true });
    expect(s.queue).toHaveLength(1);
    expect(missedCount(s, true, HOLD_MISS_MS + 1)).toBe(1);
    s = momentsReducer(s, { type: "tick", now: HOLD_MISS_MS + 1, held: true });
    expect(s.queue).toHaveLength(0);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
    s = momentsReducer(s, { type: "wake", level: "dialog", role: "guest", now: HOLD_MISS_MS + 2, phase: "hunt" });
    expect(surfacesOf(s, false).modal?.moment.seq).toBe(1);
  });
});

describe("missed moments", () => {
  it("arrived while hidden → missed (counted), replayed on wake", () => {
    let s = run([arrive([moment(1, { channel: "dm:Clippy" })], { visible: false }), arrive([moment(2)], { visible: false })]);
    expect(s.queue).toEqual([]);
    expect(missedCount(s, false, 0)).toBe(2);
    s = momentsReducer(s, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "hunt" });
    expect(s.missed).toEqual([]);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([1, 2]);
  });

  it("a phone locked through three alerts replays all three, in order, not just the newest", () => {
    // All three in the lobby, the one announcement home: none makes another stale.
    let s = run([1, 2, 3].map((n) => arrive([moment(n, { channel: "lobby" })], { visible: false })));
    s = momentsReducer(s, { type: "wake", level: "sticky", role: "guest", now: 0, phase: "hunt" });
    expect(s.queue.map((q) => [q.moment.seq, q.level])).toEqual([
      [1, "sticky"],
      [2, "sticky"],
      [3, "sticky"],
    ]);
    expect(surfacesOf(s, false).stickyCount).toBe(3);
  });

  it("dismissed after a glance (< 1 s on screen) → missed; read → gone", () => {
    let s = run([arrive([moment(1), moment(2)])]);
    s = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: GLANCE_MS - 1 });
    s = momentsReducer(s, { type: "dismiss", key: "m:2", onScreenMs: GLANCE_MS });
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
  });

  it("'Take me there' is never missed, however quick the tap; a plain close under 1 s is", () => {
    let s = run([arrive([moment(1, { text: "Everyone to the Desktop" }), moment(2)], { level: "sticky" })]);
    s = momentsReducer(s, { type: "dismiss", key: "m:1", onScreenMs: 120, acted: true });
    expect(s.missed).toEqual([]);
    s = momentsReducer(s, { type: "dismiss", key: "m:2", onScreenMs: 120 });
    expect(s.missed.map((m) => m.seq)).toEqual([2]);
  });

  it("stale on wake: a newer major moment in the same room, or the phase moved on", () => {
    const s = run([
      arrive([moment(1, { channel: "dm:Trabolta" })], { visible: false }),
      arrive([moment(2, { channel: "dm:Clippy", phase: "hunt" })], { visible: false }),
      arrive([moment(3, { channel: "dm:Trabolta", phase: "pong" })], { visible: false }),
      arrive([moment(4, { channel: "lobby", phase: "pong" })], { visible: false }),
    ]);
    expect(isStale(s.missed[0]!, s.lastMajor, "hunt")).toBe(true); // newer major in dm:Trabolta
    const woke = momentsReducer(s, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "pong" });
    // 1: a newer major in its room; 2: the phase moved from hunt to pong.
    expect(woke.queue.map((q) => q.moment.seq)).toEqual([3, 4]);
    expect(isStale(moment(9, { phase: null }), {}, null)).toBe(false);
  });

  it("a message stamped with the phase it was posted in keeps it (a reconnect's backlog); unstamped takes the phase now", () => {
    const old = { ...msg(1, { alert: true }), phase: "hunt" } as ChatMessage;
    expect(momentOf(old, guest, "pong")?.phase).toBe("hunt");
    expect(momentOf(msg(2, { alert: true }), guest, "pong")?.phase).toBe("pong");
    // So a locked phone's backlog drops the alarm from before the change.
    const s = run([arrive([momentOf(old, guest, "pong")!, momentOf(msg(2, { alert: true }), guest, "pong")!], { batch: true, phase: "pong" })]);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([2]);
  });

  it("the lobby is every announcement's home: a newer one there never makes an older one stale", () => {
    const s = run([arrive([moment(1, { text: "One." })], { visible: false }), arrive([moment(2, { text: "Two." })], { visible: false })]);
    expect(isStale(s.missed[0]!, s.lastMajor, "hunt")).toBe(false);
  });

  it("more than three replay as one 'You missed n moments' list", () => {
    let s = run([1, 2, 3, 4, 5].map((n) => arrive([moment(n, { channel: `dm:${n}` })], { visible: false })));
    s = momentsReducer(s, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "hunt" });
    expect(s.queue).toEqual([]);
    expect(s.summary?.moments.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(surfacesOf(s, false).summary).not.toBeNull();
    expect(surfacesOf(s, true).summary).toBeNull(); // a busy surface holds the list too
    expect(momentsReducer(s, { type: "closeSummary" }).summary).toBeNull();
  });

  it("a booth never gets the list as a modal: its summary is one sticky bar (C1)", () => {
    const missed = [1, 2, 3, 4].map((n) => arrive([moment(n, { channel: `dm:${n}` })], { visible: false, role: "booth" }));
    const s = momentsReducer(run(missed), { type: "wake", level: "bsod", role: "booth", now: 0, phase: "hunt" });
    expect(s.summary?.level).toBe("sticky");
    // A sticky summary blocks nothing and shows through a hold (stickies do).
    expect(surfacesOf(s, true).summary?.level).toBe("sticky");
    expect(missedCount(s, true, 0)).toBe(0);
    // A guest below `dialog` gets the bar too; at dialog the list itself.
    const g = run(missed.map((a) => ({ ...a, role: "guest" as const })));
    expect(momentsReducer(g, { type: "wake", level: "sticky", role: "guest", now: 0, phase: "hunt" }).summary?.level).toBe("sticky");
    const d = momentsReducer(g, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "hunt" });
    expect(d.summary?.level).toBe("dialog");
    // And the level dial moves it.
    expect(momentsReducer(d, { type: "relevel", level: "balloon", role: "guest" }).summary?.level).toBe("sticky");
  });

  it("a live drain that posts several moments at once just queues them (no staleness, no summary)", () => {
    // A rule posts a major card and a `!` pin into the same room in one drain.
    const both = [moment(1, { kind: "card", channel: "dm:Clippy" }), moment(2, { channel: "dm:Clippy", text: "Pinned." })];
    expect(run([arrive(both)]).queue.map((q) => q.moment.seq)).toEqual([1, 2]);
    const four = [1, 2, 3, 4].map((n) => moment(n, { channel: `dm:${n}` }));
    const live = run([arrive(four)]);
    expect([live.queue.length, live.summary]).toEqual([4, null]);
  });

  it("a history batch (a reconnect) gets the same treatment: staleness, and > 3 compress", () => {
    const s = run([arrive([1, 2, 3, 4].map((n) => moment(n, { channel: `dm:${n}` })), { batch: true })]);
    expect(s.summary?.moments).toHaveLength(4);
    const t = run([arrive([moment(1, { channel: "dm:Clippy" }), moment(2, { channel: "dm:Clippy" })], { batch: true })]);
    expect(t.queue.map((q) => q.moment.seq)).toEqual([2]);
  });
});

describe("arrivals from the message map", () => {
  it("only above the mark, each seq once, inside the 10 story-minute window (a reload never replays the night)", () => {
    const now = 60 * MIN;
    const list = [msg(1, { alert: true, ts: now - MOMENT_WINDOW_MS - 1 }), msg(2, { alert: true, ts: now - MIN }), msg(3, { alert: true, ts: now }), msg(4, { kind: "line", ts: now })];
    const r = arrivals(list, 1, new Set([3]), guest, { now, phase: null, bsod: false, beats: new Map() });
    expect(r.moments.map((m) => m.seq)).toEqual([2]);
    expect(r.seen).toEqual([2, 4]);
    const old = arrivals(list, -1, new Set(), guest, { now, phase: null, bsod: false, beats: new Map() });
    expect(old.moments.map((m) => m.seq)).toEqual([2, 3]);
    expect(old.seen).toContain(1); // looked at, never shown
  });

  it("a client echo (half seq, wall-clock ts) is never a moment and never moves story time", () => {
    const echo = msg(4.5, { kind: "line", from: "Calculator", ts: 1_760_000_000_000 });
    const list = [msg(4, { alert: true, ts: 30_000 }), echo];
    expect(storyNow(list, 31_000)).toBe(31_000);
    const r = arrivals(list, -1, new Set(), guest, { now: storyNow(list, 31_000), phase: null, bsod: true, beats: new Map() });
    expect(r.moments.map((m) => m.seq)).toEqual([4]);
    expect(r.seen).toEqual([4]);
  });

  it("one broadcast posted to two rooms is one moment (the first copy)", () => {
    const s = run([arrive([moment(1, { channel: "lobby", text: "Go." }), moment(2, { channel: "room:system log", text: "Go." })])]);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([1]);
    const t = run([arrive([moment(1, { text: "Go." })]), arrive([moment(2, { channel: "room:system log", text: "Go.", at: 1500 })])]);
    expect(t.queue).toHaveLength(1);
    const later = run([arrive([moment(1, { text: "Go." })]), arrive([moment(9, { text: "Go.", at: 60_000 })])]);
    expect(later.queue).toHaveLength(2);
  });

  it("a reload never replays a moment already read above the mark (the done list)", () => {
    // A (seq 10) is missed; B (seq 20) is read and dismissed; 15 was a plain line.
    let s = run([arrive([moment(10)], { visible: false }), arrive([moment(20)])]);
    s = momentsReducer(s, { type: "dismiss", key: "m:20", onScreenMs: 5_000 });
    const mark = settledMark(s, 20);
    expect(mark).toBe(9);
    const done = doneAbove(s, [10, 15, 20], mark);
    expect(done).toEqual([15, 20]);
    // The reload: processed starts from the done list, so only A comes back.
    const list = [msg(10, { alert: true, ts: 10_000 }), msg(15, { kind: "line", ts: 15_000 }), msg(20, { alert: true, ts: 20_000 })];
    const r = arrivals(list, mark, new Set(done), guest, { now: 20_000, phase: null, bsod: false, beats: new Map() });
    expect(r.moments.map((m) => m.seq)).toEqual([10]);
    // Below the mark is never listed; the newest DONE_MAX only.
    expect(doneAbove(EMPTY_MOMENTS, [3, 4, 5], 4)).toEqual([5]);
    expect(doneAbove(EMPTY_MOMENTS, Array.from({ length: DONE_MAX + 5 }, (_, i) => i), -1)).toHaveLength(DONE_MAX);
  });

  it("the mark settles under the oldest moment still waiting", () => {
    const s = run([arrive([moment(5)]), arrive([moment(8)], { visible: false })]);
    expect(settledMark(s, 9)).toBe(4);
    expect(settledMark(EMPTY_MOMENTS, 9)).toBe(9);
    // A moment dispatched but not rendered yet (or a readout waiting for its toast) holds the mark too.
    expect(settledMark(EMPTY_MOMENTS, 9, [7])).toBe(6);
    expect(doneAbove(EMPTY_MOMENTS, [7, 8, 9], 6, [7])).toEqual([8, 9]);
  });
});

describe("a `!` pin taken down is not news (the wave 8 rule)", () => {
  // The Antivirus' mis-tapped mark: "🚨 GO TO THE INTERNET" to one guest, then 🩹.
  const mark = (seq: number, ts = 5 * MIN) => msg(seq, { alert: true, moment: "major", pin: "marked", audience: ["g1"], text: "🚨 GO TO THE INTERNET", ts });
  const unpin = (seq: number) => msg(seq, { unpin: "marked", audience: ["g1"], text: "", ts: 6 * MIN });

  it("arrivals skip a pin already unpinned (a wake or a reload), but still look at it", () => {
    const list = [mark(1), unpin(2)];
    const r = arrivals(list, -1, new Set(), guest, { now: 6 * MIN, phase: null, bsod: false, beats: new Map() });
    expect(r.moments).toEqual([]);
    expect(r.seen).toEqual([1, 2]);
    // Still up: a moment.
    expect(arrivals([mark(1)], -1, new Set(), guest, { now: 6 * MIN, phase: null, bsod: false, beats: new Map() }).moments.map((m) => m.seq)).toEqual([1]);
  });

  it("the retract action drops it from the queue, the missed list and the summary", () => {
    const pinned = moment(1, { channel: "lobby", text: "🚨 GO TO THE INTERNET" });
    let s = run([arrive([pinned, moment(2, { text: "Other." })])]);
    expect(surfacesOf(s, false).modal?.moment.seq).toBe(1);
    s = momentsReducer(s, { type: "retract", seqs: new Set([1]) });
    expect(s.queue.map((q) => q.moment.seq)).toEqual([2]);
    expect(surfacesOf(s, false).modalIndex).toBe(1);
    // Missed (locked phone): never replayed on wake.
    let t = run([arrive([pinned], { visible: false }), arrive([moment(3)], { visible: false })]);
    t = momentsReducer(t, { type: "retract", seqs: new Set([1]) });
    t = momentsReducer(t, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "hunt" });
    expect(t.queue.map((q) => q.moment.seq)).toEqual([3]);
    // Inside a summary: it leaves the list; the last one gone closes it.
    let u = run([1, 2, 3, 4].map((n) => arrive([moment(n, { channel: `dm:${n}` })], { visible: false })));
    u = momentsReducer(u, { type: "wake", level: "dialog", role: "guest", now: 0, phase: "hunt" });
    u = momentsReducer(u, { type: "retract", seqs: new Set([2]) });
    expect(u.summary?.moments.map((m) => m.seq)).toEqual([1, 3, 4]);
    expect(momentsReducer(u, { type: "retract", seqs: new Set([1, 3, 4]) }).summary).toBeNull();
    // Nothing to drop: the same state.
    expect(momentsReducer(u, { type: "retract", seqs: new Set([99]) })).toBe(u);
  });
});

describe("the loud objective", () => {
  const o = (id: string, over: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: `Do ${id}`, brief: "", checklist: [], buttons: [], act: null, ...over });

  it("a loud objective going live is one major moment, never again once announced", () => {
    const list = [o("a", { loud: true }), o("b"), o("c", { loud: true, buttons: ["pass"], brief: "Hold it up." })];
    const first = loudObjectives(list, new Set(), 0, "arrival");
    expect(first.map((m) => [m.key, m.severity, m.pass === true, m.channel])).toEqual([
      ["o:a", "major", false, null],
      ["o:c", "major", true, null],
    ]);
    expect(first[1]!.text).toBe("Do c\nHold it up.");
    expect(loudObjectives(list, new Set(["a", "c"]), 0, null)).toEqual([]);
  });
});

describe("the toast never replaces a moment", () => {
  it("the feedback toast is the alerts hook's; the queue is untouched by it", () => {
    const alerts: Alerts = {
      alert: { seq: -1, text: "✔ Done.", quiet: true },
      dismiss: () => {},
      raise: () => {},
      onHistory: () => {},
      rebase: () => {},
      mark: () => -1,
      settle: () => {},
      epoch: 0,
      recent: () => [],
    };
    const input: MomentsInput = { role: "guest", me: "g1", session: "t", messages: new Map(), alerts, alertLevel: "dialog", objectives: [], phase: null, clock: 0, openRoom: () => {}, sound: false };
    const html = renderToStaticMarkup(createElement(MomentsProvider, { ...input, children: createElement(MomentsLayer) }));
    expect(html).toContain('class="moments-toast"');
    expect(html).not.toMatch(/moments-(balloon|sticky|bsod)|w95-dialog/u);
  });

  it("a readout saying what your toast said is the same words (the provider drops the echo)", () => {
    expect(sameWords("✔ Done. Bathroom Mode engaged.", "Bathroom Mode engaged.")).toBe(true);
    expect(sameWords("  You are LATE ", "you are late")).toBe(true);
    expect(sameWords("✔ Done.", "⏰ You are late")).toBe(false);
    expect(sameWords("", "x")).toBe(false);
  });
});

describe("the glitch", () => {
  it("plays on a level change after the first view, never on the first snapshot", () => {
    expect(shouldGlitch(undefined, "sticky")).toBe(false);
    expect(shouldGlitch("sticky", "sticky")).toBe(false);
    expect(shouldGlitch("sticky", "dialog")).toBe(true);
    expect(shouldGlitch("dialog", undefined)).toBe(false);
  });

  it("is its own fixed overlay above everything, inert, still under reduced motion; nothing moves the app", () => {
    const css = readBundledCss();
    const rule = /\.moments-glitch \{[^}]*\}/u.exec(css)![0];
    expect(rule).toMatch(/position: fixed; inset: 0; z-index: var\(--z-glitch\); pointer-events: none/u);
    expect(css).toMatch(/\.moments-glitch\.still, \.moments-glitch\.still::before, \.moments-glitch\.still::after \{ animation: none; \}/u);
    const lane = css.slice(css.indexOf("/* moments lane"), css.indexOf("/* booth lane") > 0 ? css.indexOf("/* booth lane") : undefined);
    // No transform / filter on a layout ancestor from this lane.
    expect(lane).not.toMatch(/(^|[\s,}])\.(root|app-frame|app|screen)\b[^{]*\{[^}]*(transform|filter|perspective|will-change)/u);
  });
});

describe("the layers", () => {
  it("the takeover (50) sits above every moment (40); moments use the tokens", () => {
    const css = readBundledCss();
    expect(css).toMatch(/--z-moment: 40; --z-pass: 45; --z-takeover: 50; --z-glitch: 55;/u);
    expect(/\.takeover \{[^}]*z-index: 50/u.test(css)).toBe(true);
    for (const cls of ["moments-balloon", "moments-bsod"]) expect(new RegExp(`\\.${cls} \\{[^}]*z-index: var\\(--z-moment\\)`, "u").test(css)).toBe(true);
    expect(/\.w95-dialog-backdrop \{[^}]*z-index: var\(--z-moment\)/u.test(css)).toBe(true);
  });

  it("a balloon never covers a room's composer, and passes touches outside its controls", () => {
    const css = readBundledCss();
    expect(/:where\(\.root:has\(\.composer\)\) \.moments-balloon \{[^}]*bottom: calc\([^}]*var\(--moments-composer-h\)/u.test(css)).toBe(true);
    expect(/\.moments-balloon \{[^}]*pointer-events: none/u.test(css)).toBe(true);
    expect(/\.moments-balloon button \{[^}]*pointer-events: auto/u.test(css)).toBe(true);
  });

  it("every control a moment shows is a 44 px target", () => {
    const css = readBundledCss();
    for (const sel of ["moments-balloon-x", "moments-balloon-go", "moments-sticky-body", "moments-bsod-go", "moments-toast"]) {
      expect(new RegExp(`\\.${sel} \\{[^}]*(min-height|height): var\\(--tap\\)`, "u").test(css), sel).toBe(true);
    }
  });
});

describe("the surfaces' markup", () => {
  const q = (m: Moment, level: AlertLevel) => ({ moment: m, level, queuedAt: 0 });
  const noop = () => {};

  it("a balloon: caption, text, close, and 'Take me there' only with an exit", () => {
    const html = renderToStaticMarkup(createElement(Balloon, { q: q(moment(1, { severity: "minor" }), "balloon"), canGo: true, onGo: noop, onDismiss: noop }));
    expect(html).toContain('class="moments-balloon minor"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Take me there ›");
    expect(renderToStaticMarkup(createElement(Balloon, { q: q(moment(1), "balloon"), canGo: false, onGo: noop, onDismiss: noop }))).not.toContain("Take me there");
  });

  it("a sticky: major is an alert, counts its queue", () => {
    const html = renderToStaticMarkup(createElement(StickyBanner, { q: q(moment(1), "sticky"), count: 3, canGo: true, onGo: noop, onDismiss: noop }));
    expect(html).toContain('class="moments-sticky major"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("1 of 3");
  });

  it("a dialog: a Win95 message box with OK and n of m; the pass objective offers the pass", () => {
    const html = renderToStaticMarkup(createElement(MomentDialog, { q: q(moment(1, { kind: "objective", pass: true, channel: null, text: "Show your pass\nHold it up." }), "dialog"), index: 2, total: 3, canGo: true, onGo: noop, onDismiss: noop }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(">OK<");
    expect(html).toContain("2 of 3");
    expect(html).toContain("Show my pass");
    expect(html).toContain("<strong class=\"moments-objective-title\">Show your pass</strong>");
  });

  it("a blue screen: the caption inverted, a fault address, press any key", () => {
    const html = renderToStaticMarkup(createElement(BlueScreen, { q: q(moment(4, { kind: "beat", caption: "Trabolta", text: "Trabolta: I remember her." }), "bsod"), index: 1, total: 1, canGo: true, onGo: noop, onDismiss: noop }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain(">TRABOLTA<");
    expect(html).toContain(`at ${faultAddress("m:4")}`);
    expect(html).toContain("Press any key to continue");
    expect(html).toContain("Trabolta: I remember her.");
    expect(faultAddress("m:4")).toMatch(/^0028:C0[0-9A-F]{6}$/u);
  });

  it("the missed list names every moment with its exit", () => {
    const html = renderToStaticMarkup(createElement(MissedList, { moments: [moment(1), moment(2, { channel: null })], canGo: (m) => m.channel !== null, onGo: noop, onClose: noop }));
    expect(html).toContain("You missed 2 moments");
    expect(html.match(/moments-missed-row/gu)).toHaveLength(2);
    expect(html.match(/Go ›/gu)).toHaveLength(1);
  });

  it("the sticky summary: one bar, never a dialog, the list on a tap", () => {
    const html = renderToStaticMarkup(createElement(SummarySticky, { count: 4, onOpen: noop, onDismiss: noop }));
    expect(html).toContain("You missed 4 moments");
    expect(html).toContain('class="moments-sticky minor moments-summary-sticky"');
    expect(html).not.toContain('role="dialog"');
  });
});
