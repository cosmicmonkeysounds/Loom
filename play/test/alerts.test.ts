import { describe, expect, it } from "vitest";

import { READOUT_GRACE_MS, boothAlertFilter, initialMark, markAfterHistory, maxSeqOf, unsolicitedReadout } from "../src/alerts.ts";
import { retractedPinSeqs } from "../src/pins.ts";
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

describe("the mark", () => {
  it("is the highest seq seen", () => {
    expect(maxSeqOf([msg(3, true), msg(1, true), msg(5, false)])).toBe(5);
    expect(maxSeqOf([])).toBe(-1);
  });

  it("a re-history keeps the mark (the screen-off bug: it used to jump to the replayed max)", () => {
    const replay = [msg(0, false), msg(1, false), msg(2, true, { ts: 5 * MIN }), msg(3, false, { ts: 5 * MIN })];
    expect(markAfterHistory(replay, 1, false)).toBe(1);
  });

  it("a restart (rebase, or seqs renumbered below the mark) makes the backlog old news", () => {
    const fresh = [msg(0, true), msg(1, false)];
    expect(markAfterHistory(fresh, 1, true)).toBe(1);
    expect(markAfterHistory(fresh, 40, false)).toBe(1);
    expect(markAfterHistory([], 5, true)).toBe(-1);
  });
});

describe("a fresh sign-in (L-1)", () => {
  it("keeps the same session's stored mark; a new sign-in baselines on its first history", () => {
    expect(initialMark({ session: "tok", mark: 7 }, "tok")).toEqual({ mark: 7, baseline: false });
    expect(initialMark({ session: "old", mark: 7 }, "tok")).toEqual({ mark: -1, baseline: true });
    expect(initialMark(null, "tok")).toEqual({ mark: -1, baseline: true });
    expect(initialMark(null, null)).toEqual({ mark: -1, baseline: false });
    // The performer signing in after go-live: the first history is old news.
    const replay = [msg(0, false), msg(1, true, { ts: 5 * MIN }), msg(2, false, { ts: 6 * MIN })];
    const { mark, baseline } = initialMark(null, "booth");
    expect(markAfterHistory(replay, mark, baseline)).toBe(2);
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
  const mine = (list: ChatMessage[]) => list.filter(norton).map((m) => m.seq);

  it("a `!` whose scope reached nobody (an empty room's lights-out) is no booth's", () => {
    // `broadcast "!💡 The lights in {room} go out…" to location(room)` on an
    // empty room: a lobby line with audience [].
    const lightsOut = msg(12, true, { ts: 5 * MIN, audience: [] });
    // An empty location room or DM is nobody too; `# hosts` with [] is staff.
    const emptyRoom = msg(13, true, { ts: 5 * MIN, audience: [], room: { channel: "loc:The RAM", channelKind: "location", title: "The RAM" } });
    const staff = msg(14, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    expect(mine([lightsOut, emptyRoom, staff])).toEqual([14]);
  });

  it("a `!` to an empty faction (a derived `faction:X` mirror with []) is no booth's; `# hosts` still is", () => {
    const emptyFaction = msg(15, true, { ts: 5 * MIN, audience: [], room: { channel: "faction:The Way Out", channelKind: "faction", title: "#the way out" } });
    const staff = msg(16, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    expect(mine([emptyFaction, staff])).toEqual([16]);
    // A member of that faction is addressed by id: a guest's, not a booth's.
    const members = msg(17, true, { ts: 5 * MIN, audience: ["g-1"], room: { channel: "faction:The Way Out", channelKind: "faction", title: "#the way out" } });
    expect(mine([members])).toEqual([]);
  });

  it("`all`, `@<Character>` and staff (empty audience) alerts are the booth's; a guest's own pin and another character's are not", () => {
    // The guest's own "🚨 GO TO THE INTERNET" pin: a lobby line to one guest.
    const guestPin = msg(7, true, { ts: 5 * MIN, audience: ["g-491630"] });
    const all = msg(8, true, { ts: 5 * MIN });
    const me = msg(9, true, { ts: 5 * MIN, audience: ["@Norton"] });
    const staff = msg(10, true, { ts: 5 * MIN, audience: [], room: HOSTS });
    const other = msg(11, true, { ts: 5 * MIN, audience: ["@McAfee"] });
    expect(mine([guestPin, all, me, staff, other])).toEqual([8, 9, 10]);
  });
});

describe("a `!` pin taken down (T5-02)", () => {
  const pin = (seq: number, key: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ ...msg(seq, true, { ts: 50 * MIN, audience: ["vlc"] }), pin: key, ...extra });
  const unpin = (seq: number, key: string): ChatMessage => ({ ...msg(seq, false, { ts: 51 * MIN, audience: ["vlc"] }), unpin: key });

  it("an unpinned mark is retracted; a lifted !! takeover too; a pin still up is not", () => {
    expect(retractedPinSeqs([msg(0, false), pin(1, "marked"), unpin(2, "marked")])).toEqual(new Set([1]));
    expect(retractedPinSeqs([pin(3, "takeover", { takeover: true }), unpin(4, "takeover")])).toEqual(new Set([3]));
    expect(retractedPinSeqs([pin(5, "marked")]).size).toBe(0);
  });

  it("a second pin with the same key retracts the first, never itself", () => {
    expect(retractedPinSeqs([pin(10, "marked"), pin(12, "marked")])).toEqual(new Set([10]));
  });

  it("an unpin in another room or with another key takes nothing down", () => {
    const other = { ...unpin(2, "marked"), channel: "dm:Clippy", channelKind: "dm" as const };
    expect(retractedPinSeqs([pin(1, "marked"), other, unpin(3, "escort")]).size).toBe(0);
  });
});
