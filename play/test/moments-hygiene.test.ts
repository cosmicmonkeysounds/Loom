//! Wave 18, the moments lane (GUEST-SPEC §5.5 + §7, CONTRACTS C1, the
//! user's "big decisions … need to be large popups that are un-ignorable"):
//! the big rung and the moment hygiene, as the reducer's rules.

import { describe, expect, it } from "vitest";
import {
  BIG_HOLD_MS,
  BIG_WINDOW_MS,
  BSOD_MAX,
  EMPTY_MOMENTS,
  MOMENT_WINDOW_MS,
  arrivals,
  isHouseAlert,
  momentOf,
  momentsReducer,
  rungFor,
  surfacesOf,
  wakeReplay,
  type Moment,
  type MomentsAction,
  type MomentsState,
  type Viewer,
} from "../src/moments/model.ts";
import type { AlertLevel, ChatMessage } from "../src/types.ts";
import { loadNow, nowSinceOnLoad, saveNow } from "../src/moments/memory.ts";

const MIN = 60_000;
function moment(seq: number, over: Partial<Moment> = {}): Moment {
  return { key: `m:${seq}`, seq, severity: "major", kind: "alert", caption: "Clippy", text: `moment ${seq}`, channel: "lobby", at: seq * 1000, phase: "bingo", ...over };
}
const big = (seq: number, over: Partial<Moment> = {}) => moment(seq, { severity: "big", kind: "readout", channel: "dm:Clippy", ...over });
const house = (seq: number, over: Partial<Moment> = {}) => moment(seq, { house: true, ...over });
const arrive = (moments: Moment[], over: Partial<Extract<MomentsAction, { type: "arrive" }>> = {}): MomentsAction => ({ type: "arrive", moments, visible: true, level: "sticky", role: "guest", now: 0, phase: "bingo", batch: false, ...over });
const run = (actions: MomentsAction[], from: MomentsState = EMPTY_MOMENTS) => actions.reduce(momentsReducer, from);
const guest: Viewer = { role: "guest", me: "g1" };

function msg(seq: number, over: Partial<ChatMessage> & Record<string, unknown> = {}): ChatMessage {
  return { seq, channel: "dm:Clippy", channelKind: "dm", title: "Clippy", from: "Clippy", kind: "line", text: "🎀 You won a Bingo Ribbon. Take a bow.", ts: seq * 1000, audience: ["g1"], parentSeq: null, hidden: false, ...over } as ChatMessage;
}

describe("the big rung (C1)", () => {
  it("a big moment is the big rung at every level, for a guest; a booth's (no adapter) is a major sticky", () => {
    for (const level of ["balloon", "sticky", "dialog", "bsod"] as AlertLevel[]) {
      expect(rungFor({ severity: "big", kind: "readout" }, level, "guest")).toBe("big");
      expect(rungFor({ severity: "big", kind: "readout" }, level, "booth")).toBe(level === "balloon" ? "balloon" : "sticky");
    }
  });

  it("the server's `moment: \"big\"`, its `go:` and `autoClose` reach the moment; autoClose only on a big one", () => {
    const go = [{ kind: "pass", label: "Show my pass" }];
    const m = momentOf(msg(4, { moment: "big", readout: true, go, autoClose: 6000, audience: "all" }), guest, "bingo")!;
    expect([m.severity, m.house, m.go, m.autoClose]).toEqual(["big", true, go, 6000]);
    expect(momentOf(msg(5, { moment: "major", autoClose: 6000 }), guest, null)?.autoClose).toBeUndefined();
    // A card knows its seq, kind and glyph; a codex / quest moment its entry / quest.
    const card = momentOf(msg(6, { moment: "big", kind: "widget", widget: { kind: "poll", text: "🍾 Truth or dare?", params: {} } }), guest, null)!;
    expect(card.card).toEqual({ seq: 6, kind: "poll", glyph: "🍾" });
  });

  it("full screen, ahead of everything; while it shows every other surface waits", () => {
    let s = run([arrive([house(1), moment(2, { severity: "minor" })], { level: "dialog" })]);
    s = run([arrive([big(3)], { level: "dialog" })], s);
    const v = surfacesOf(s, false);
    expect(v.big?.moment.seq).toBe(3);
    expect([v.modal, v.balloon, v.sticky, v.now]).toEqual([null, null, null, null]);
    s = momentsReducer(s, { type: "dismiss", key: "m:3", onScreenMs: 200, acted: true });
    expect(surfacesOf(s, false).modal?.moment.seq).toBe(1);
  });

  it("bigs queue in arrival order, `1 of 2` then `2 of 2`; never missed, however quick", () => {
    let s = run([arrive([big(5, { text: "🎱 Bingo!" }), big(6, { text: "🎀 You won." })])]);
    let v = surfacesOf(s, false);
    expect([v.big?.moment.seq, v.bigIndex, v.bigTotal]).toEqual([5, 1, 2]);
    s = momentsReducer(s, { type: "dismiss", key: "m:5", onScreenMs: 10 });
    v = surfacesOf(s, false);
    expect([v.big?.moment.seq, v.bigIndex, v.bigTotal]).toEqual([6, 2, 2]);
    s = momentsReducer(s, { type: "dismiss", key: "m:6", onScreenMs: 10 });
    expect(s.missed).toEqual([]);
    expect(s.bigBurst).toBe(0);
  });

  it("a hold (the pass, the scan sheet) delays a big at most 8 s, then it shows over it", () => {
    const s = run([arrive([big(1)], { now: 1_000 })]);
    expect(surfacesOf(s, true, false, 1_000 + BIG_HOLD_MS - 1).big).toBeNull();
    expect(surfacesOf(s, true, false, 1_000 + BIG_HOLD_MS).big?.moment.seq).toBe(1);
    expect(surfacesOf(s, false).big?.moment.seq).toBe(1);
    // …and a hold never moves it to missed.
    const t = momentsReducer(s, { type: "tick", now: 1_000 + 60_000, held: true });
    expect(t.queue).toHaveLength(1);
  });

  it("a big ignores a level change and is never a phase's to retire", () => {
    let s = run([arrive([big(1, { house: true, phase: "bingo" })])]);
    s = momentsReducer(s, { type: "relevel", level: "bsod", role: "guest", phase: "hunt" });
    s = momentsReducer(s, { type: "phase", phase: "hunt" });
    expect(s.queue.map((q) => [q.moment.seq, q.level])).toEqual([[1, "big"]]);
  });

  it("an unacknowledged big replays on a reload for 15 story-minutes (the 10-minute window is for the rest)", () => {
    const now = 60 * MIN;
    const list = [msg(1, { moment: "big", ts: now - MOMENT_WINDOW_MS - MIN }), msg(2, { moment: "major", alert: true, ts: now - MOMENT_WINDOW_MS - MIN }), msg(3, { moment: "big", ts: now - BIG_WINDOW_MS - 1 })];
    const r = arrivals(list, -1, new Set(), guest, { now, phase: null, bsod: false, beats: new Map() });
    expect(r.moments.map((m) => m.seq)).toEqual([1]);
    // A wake drops a big past its window.
    expect(wakeReplay([big(4, { at: 0 })], {}, null, BIG_WINDOW_MS + 1).show).toEqual([]);
    expect(wakeReplay([big(4, { at: 0 })], {}, null, BIG_WINDOW_MS - 1).show.map((m) => m.seq)).toEqual([4]);
  });
});

describe("hygiene (§7, G6)", () => {
  it("one house banner: a newer house alert replaces the older, which goes to missed (unread)", () => {
    let s = run([arrive([house(1, { text: "📣 Report to the Desktop." })])]);
    s = run([arrive([house(2, { text: "🎱 Bingo has begun." })])], s);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([2]);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
    // A personal alert is not a house banner; both stay.
    expect(isHouseAlert(moment(3))).toBe(false);
    expect(isHouseAlert(house(4))).toBe(true);
    expect(isHouseAlert(house(5, { severity: "big" }))).toBe(false);
  });

  it("a phase change retires every queued non-big house moment from the phase before", () => {
    let s = run([arrive([house(1, { phase: "bingo", kind: "other" }), moment(2, { phase: "bingo", channel: "dm:Clippy" }), big(3, { house: true, phase: "bingo" })], { level: "dialog" })]);
    s = momentsReducer(s, { type: "phase", phase: "bingo-time" });
    expect(s.queue.map((q) => q.moment.seq).sort()).toEqual([2, 3]);
    expect(s.missed.map((m) => m.seq)).toEqual([1]);
    // The same phase: nothing moves.
    expect(momentsReducer(s, { type: "phase", phase: "bingo-time" })).toBe(s);
  });

  it("at most three blue screens wait; older ones go to missed", () => {
    const beats = [1, 2, 3, 4, 5].map((n) => moment(n, { kind: "beat", severity: "minor", channel: `dm:${n}` }));
    const s = run([arrive(beats, { level: "bsod" })]);
    expect(s.queue.filter((q) => q.level === "bsod")).toHaveLength(BSOD_MAX);
    expect(s.missed.map((m) => m.seq).sort()).toEqual([1, 2]);
  });

  it("a quest-start balloon beside a sticky of the same cue (≤ 2 s) is dropped", () => {
    const quest = moment(2, { severity: "minor", kind: "quest", at: 10_000, channel: "quests" });
    const cue = moment(1, { kind: "other", at: 9_000, channel: "dm:Clippy" });
    let s = run([arrive([cue, quest])]);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([1]);
    expect(s.missed.map((m) => m.seq)).toEqual([2]);
    // The other way round: a quest balloon queued first leaves when the sticky lands.
    s = run([arrive([quest]), arrive([cue])]);
    expect(s.queue.map((q) => q.moment.seq)).toEqual([1]);
    // Far apart: both stay.
    s = run([arrive([moment(3, { kind: "other", at: 1_000, channel: "dm:Clippy" }), quest])]);
    expect(s.queue.map((q) => q.moment.seq).sort()).toEqual([2, 3]);
  });
});

describe("N3: a load after the NOW changed never brings back a banner from before it", () => {
  it("the backlog's newest house banner must be no older than the NOW's start", () => {
    const old = house(10, { at: 10_000 });
    expect(wakeReplay([old], {}, "bingo", 60_000, null).show.map((m) => m.seq)).toEqual([10]);
    expect(wakeReplay([old], {}, "bingo", 60_000, null, 30_000).show).toEqual([]);
    // Posted with the press that moved NOW (inside the 2 s echo window): stays.
    expect(wakeReplay([house(11, { at: 29_000 })], {}, "bingo", 60_000, null, 30_000).show.map((m) => m.seq)).toEqual([11]);
    const s = run([arrive([old], { batch: true, storyNow: 60_000, houseSince: 30_000 })]);
    expect(s.queue).toEqual([]);
    expect(s.missed.map((m) => m.seq)).toEqual([10]);
  });

  it("when the NOW began, on a load: its stored start, else the last time the phone looked", () => {
    const store = new Map<string, unknown>();
    const storage = { load: <T,>(k: string) => (store.get(k) ?? null) as T | null, save: (k: string, v: unknown) => void store.set(k, v), drop: (k: string) => void store.delete(k) };
    expect(loadNow(storage, "t")).toBeNull();
    expect(nowSinceOnLoad(null, "zip")).toBeNull();
    saveNow(storage, "t", { id: "beans", since: 5_000, seen: 9_000 });
    const r = loadNow(storage, "t");
    expect(r).toEqual({ id: "beans", since: 5_000, seen: 9_000 });
    expect(nowSinceOnLoad(r, "beans")).toBe(5_000);
    expect(nowSinceOnLoad(r, "zip")).toBe(9_000);
    store.set("loom.moments.now.t", { id: 3 });
    expect(loadNow(storage, "t")).toBeNull();
  });
});
