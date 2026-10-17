import { describe, expect, it } from "vitest";

import { ALERT_WINDOW_MS, READOUT_GRACE_MS, bannerAfterRetract, boothAlertFilter, initialMark, markAfterHistory, maxSeqOf, maxTsOf, nextAlert, pickAlerts, retractedPinSeqs, unsolicitedReadout } from "../src/alerts.ts";
import type { ChatMessage } from "../src/types.ts";

function msg(seq: number, alert: boolean, opts: { hidden?: boolean; ts?: number; audience?: ChatMessage["audience"]; room?: Pick<ChatMessage, "channel" | "channelKind" | "title"> } = {}): ChatMessage {
  return {
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "Lobby",
    ...opts.room,
    from: "",
    kind: "signal",
    text: `a${seq}`,
    ts: opts.ts ?? seq,
    audience: opts.audience ?? "all",
    parentSeq: null,
    hidden: opts.hidden ?? false,
    ...(alert ? { alert: true } : {}),
  };
}

const MIN = 60_000;

describe("picking alerts", () => {
  it("picks only new, visible alert broadcasts, oldest first", () => {
    const all = [msg(3, true), msg(1, true), msg(2, false), msg(4, true, { hidden: true }), msg(5, true)];
    expect(pickAlerts(all, 1).map((m) => m.seq)).toEqual([3, 5]);
    expect(pickAlerts(all, -1).map((m) => m.seq)).toEqual([1, 3, 5]);
    expect(pickAlerts(all, 5)).toEqual([]);
    expect(maxSeqOf(all)).toBe(5);
    expect(maxSeqOf([])).toBe(-1);
    expect(maxTsOf([msg(1, false, { ts: 9 }), msg(2, false, { ts: 4 })])).toBe(9);
  });

  it("a live alert banners and moves the mark", () => {
    const r = nextAlert([msg(0, false), msg(1, true, { ts: 50 * MIN })], 0, 50 * MIN);
    expect(r.alert?.seq).toBe(1);
    expect(r.mark).toBe(1);
    // Seen: nothing again.
    expect(nextAlert([msg(0, false), msg(1, true)], 1, 50 * MIN)).toEqual({ alert: null, mark: 1 });
  });

  it("on wake, only the newest unseen alert banners", () => {
    const list = [msg(0, true, { ts: 40 * MIN }), msg(1, true, { ts: 41 * MIN }), msg(2, false, { ts: 42 * MIN })];
    const r = nextAlert(list, -1, 43 * MIN);
    expect(r.alert?.seq).toBe(1);
    expect(r.mark).toBe(1);
  });

  it("an alert older than the window is skipped, but the mark still passes it", () => {
    const list = [msg(4, true, { ts: 10 * MIN })];
    const r = nextAlert(list, 3, 10 * MIN + ALERT_WINDOW_MS + 1);
    expect(r.alert).toBeNull();
    expect(r.mark).toBe(4);
    // Exactly at the window edge still counts.
    expect(nextAlert(list, 3, 10 * MIN + ALERT_WINDOW_MS).alert?.seq).toBe(4);
  });

  it("now is the later of the view clock and the newest message (views go stale)", () => {
    const list = [msg(1, true, { ts: 10 * MIN }), msg(2, false, { ts: 30 * MIN })];
    expect(nextAlert(list, -1, 12 * MIN).alert).toBeNull(); // newest message says it is 30 min
    expect(nextAlert(list, -1, null).alert).toBeNull();
    expect(nextAlert([msg(1, true, { ts: 10 * MIN })], -1, undefined).alert?.seq).toBe(1);
  });
});

describe("the mark across a reconnect", () => {
  it("a re-history keeps the mark (the screen-off bug: it used to jump to the replayed max)", () => {
    const replay = [msg(0, false), msg(1, false), msg(2, true, { ts: 5 * MIN }), msg(3, false, { ts: 5 * MIN })];
    const mark = markAfterHistory(replay, 1, false);
    expect(mark).toBe(1);
    expect(nextAlert(replay, mark, 7 * MIN).alert?.seq).toBe(2);
  });

  it("a restart (rebase, or seqs renumbered below the mark) makes the backlog old news", () => {
    const fresh = [msg(0, true), msg(1, false)];
    expect(markAfterHistory(fresh, 1, true)).toBe(1);
    expect(markAfterHistory(fresh, 40, false)).toBe(1);
    expect(nextAlert(fresh, markAfterHistory(fresh, 40, false), 2).alert).toBeNull();
    expect(markAfterHistory([], 5, true)).toBe(-1);
  });
});

describe("a fresh sign-in (L-1)", () => {
  it("keeps the same session's stored mark; a new sign-in baselines on its first history", () => {
    expect(initialMark({ session: "tok", mark: 7 }, "tok")).toEqual({ mark: 7, baseline: false });
    expect(initialMark({ session: "old", mark: 7 }, "tok")).toEqual({ mark: -1, baseline: true });
    expect(initialMark(null, "tok")).toEqual({ mark: -1, baseline: true });
    expect(initialMark(null, null)).toEqual({ mark: -1, baseline: false });
    // The performer signing in after go-live: the first history is old news…
    const replay = [msg(0, false), msg(1, true, { ts: 5 * MIN }), msg(2, false, { ts: 6 * MIN })];
    const { mark, baseline } = initialMark(null, "booth");
    const after = markAfterHistory(replay, mark, baseline);
    expect(after).toBe(2);
    expect(nextAlert(replay, after, 7 * MIN).alert).toBeNull();
    // …while the same session reconnecting after a screen-off still banners.
    expect(nextAlert(replay, markAfterHistory(replay, 0, false), 7 * MIN).alert?.seq).toBe(1);
  });
});

describe("booth readouts (N-07)", () => {
  it("a readout right after the booth's own scan is its answer; any other one is news", () => {
    const t = 1_000_000;
    expect(unsolicitedReadout(t, t + 500)).toBe(false);
    expect(unsolicitedReadout(t, t + READOUT_GRACE_MS)).toBe(false);
    expect(unsolicitedReadout(t, t + READOUT_GRACE_MS + 1)).toBe(true);
    expect(unsolicitedReadout(Number.NEGATIVE_INFINITY, t)).toBe(true); // never acted
  });
});

const HOSTS = { channel: "hosts", channelKind: "faction", title: "hosts" } as const;

describe("a booth's alerts are its own (B1)", () => {
  const norton = boothAlertFilter("Norton");

  it("a `!` whose scope reached nobody (an empty room's lights-out) banners no booth", () => {
    // `broadcast "!💡 The lights in {room} go out…" to location(room)` on an
    // empty room: a lobby line with audience [].
    const lightsOut = msg(12, true, { ts: 5 * MIN, audience: [] });
    expect(pickAlerts([lightsOut], -1, norton)).toEqual([]);
    expect(nextAlert([lightsOut], 11, 5 * MIN, norton)).toEqual({ alert: null, mark: 12 });
    // An empty location room or DM is nobody too; `# hosts` with [] is staff.
    const emptyRoom = msg(13, true, { ts: 5 * MIN, audience: [], room: { channel: "loc:The RAM", channelKind: "location", title: "The RAM" } });
    const staff = msg(14, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    expect(pickAlerts([lightsOut, emptyRoom, staff], -1, norton).map((m) => m.seq)).toEqual([14]);
  });
  it("a `!` to an empty faction (a derived `faction:X` mirror with []) banners no booth; `# hosts` still does", () => {
    // `broadcast "!…" to faction(The Way Out)` while nobody has joined it:
    // the mirror's audience is the faction's members, i.e. [].
    const emptyFaction = msg(15, true, { ts: 5 * MIN, audience: [], room: { channel: "faction:The Way Out", channelKind: "faction", title: "#the way out" } });
    const staff = msg(16, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    expect(pickAlerts([emptyFaction], -1, norton)).toEqual([]);
    expect(nextAlert([emptyFaction], 14, 5 * MIN, norton)).toEqual({ alert: null, mark: 15 });
    expect(pickAlerts([emptyFaction, staff], -1, norton).map((m) => m.seq)).toEqual([16]);
    // A member of that faction is addressed by id and still gets it on the phone.
    const members = msg(17, true, { ts: 5 * MIN, audience: ["g-1"], room: { channel: "faction:The Way Out", channelKind: "faction", title: "#the way out" } });
    expect(pickAlerts([members], -1, norton)).toEqual([]);
    expect(nextAlert([members], 16, 5 * MIN).alert?.seq).toBe(17);
  });
  // The guest's own "🚨 GO TO THE INTERNET" pin: a lobby line to one guest.
  const guestPin = msg(7, true, { ts: 5 * MIN, audience: ["g-491630"] });

  it("a guest-addressed `!` pin gives a booth no alert, but the mark passes it", () => {
    expect(pickAlerts([guestPin], -1, norton)).toEqual([]);
    expect(nextAlert([msg(6, false), guestPin], 6, 5 * MIN, norton)).toEqual({ alert: null, mark: 7 });
    // The guest's own phone (no filter) still banners it.
    expect(nextAlert([guestPin], 6, 5 * MIN).alert?.seq).toBe(7);
  });

  it("`all`, `@<Character>` and staff (empty audience) alerts still banner", () => {
    const all = msg(8, true, { ts: 5 * MIN });
    const mine = msg(9, true, { ts: 5 * MIN, audience: ["@Norton"] });
    const staff = msg(10, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    const other = msg(11, true, { ts: 5 * MIN, audience: ["@McAfee"] });
    expect(pickAlerts([guestPin, all, mine, staff, other], -1, norton).map((m) => m.seq)).toEqual([8, 9, 10]);
    expect(nextAlert([all], 7, 5 * MIN, norton).alert?.seq).toBe(8);
    expect(nextAlert([mine], 7, 5 * MIN, norton).alert?.seq).toBe(9);
  });

  it("the guest pin landing with the booth's readout leaves the readout up", () => {
    // `onResponse` raises the readout; the pin's message batch then runs the
    // hook's effect, which only replaces the banner when it picks an alert.
    const batch = [msg(6, false, { ts: 5 * MIN }), guestPin, msg(12, true, { ts: 5 * MIN, audience: ["g-77"] })];
    const r = nextAlert(batch, 6, 5 * MIN, norton);
    expect(r.alert).toBeNull();
    expect(r.mark).toBe(12);
  });
});

describe("a `!` pin taken down before the phone woke (T5-02)", () => {
  const pin = (seq: number, key: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ ...msg(seq, true, { ts: 50 * MIN, audience: ["vlc"] }), pin: key, ...extra });
  const unpin = (seq: number, key: string): ChatMessage => ({ ...msg(seq, false, { ts: 51 * MIN, audience: ["vlc"] }), unpin: key });

  it("an unpinned mark never banners on wake, and the mark moves past both", () => {
    const list = [msg(0, false), pin(1, "marked"), unpin(2, "marked")];
    expect(retractedPinSeqs(list)).toEqual(new Set([1]));
    expect(nextAlert(list, 0, 52 * MIN)).toEqual({ alert: null, mark: 1 });
  });

  it("a lifted !! takeover is not news either; a pin still up still banners", () => {
    const lifted = [pin(3, "takeover", { takeover: true }), unpin(4, "takeover")];
    expect(nextAlert(lifted, 0, 52 * MIN).alert).toBeNull();
    const up = [pin(5, "marked")];
    expect(nextAlert(up, 0, 52 * MIN).alert?.seq).toBe(5);
    expect(retractedPinSeqs(up).size).toBe(0);
  });

  it("a second pin with the same key replaces the banner, never wipes it", () => {
    // Pin 10's banner is up; pin 12 (same key) lands. The raise effect sets
    // banner 12 while the retract effect still sees banner 10 — it must
    // check the latest banner, so 12 stays.
    const list = [pin(10, "marked"), pin(12, "marked")];
    const gone = retractedPinSeqs(list);
    expect(gone).toEqual(new Set([10]));
    const twelve = { seq: 12, text: "🚨 again" };
    expect(bannerAfterRetract(twelve, gone)).toBe(twelve);
    expect(bannerAfterRetract({ seq: 10, text: "🚨" }, gone)).toBeNull();
    expect(nextAlert(list, 10, 52 * MIN).alert?.seq).toBe(12);
  });

  it("a readout banner is never a pin to take down", () => {
    const readout = { seq: -1, text: "✅ scanned" };
    expect(bannerAfterRetract(readout, new Set([-1]))).toBe(readout);
    expect(bannerAfterRetract(null, new Set([1]))).toBeNull();
  });

  it("an unpin in another room or with another key takes nothing down", () => {
    const other = { ...unpin(2, "marked"), channel: "dm:Clippy", channelKind: "dm" as const };
    expect(nextAlert([pin(1, "marked"), other, unpin(3, "escort")], 0, 52 * MIN).alert?.seq).toBe(1);
  });
});
