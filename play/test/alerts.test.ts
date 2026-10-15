import { describe, expect, it } from "vitest";

import { ALERT_WINDOW_MS, READOUT_GRACE_MS, markAfterHistory, maxSeqOf, maxTsOf, nextAlert, pickAlerts, unsolicitedReadout } from "../src/alerts.ts";
import type { ChatMessage } from "../src/types.ts";

function msg(seq: number, alert: boolean, opts: { hidden?: boolean; ts?: number } = {}): ChatMessage {
  return {
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "Lobby",
    from: "",
    kind: "signal",
    text: `a${seq}`,
    ts: opts.ts ?? seq,
    audience: "all",
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

describe("booth readouts (N-07)", () => {
  it("a readout right after the booth's own scan is its answer; any other one is news", () => {
    const t = 1_000_000;
    expect(unsolicitedReadout(t, t + 500)).toBe(false);
    expect(unsolicitedReadout(t, t + READOUT_GRACE_MS)).toBe(false);
    expect(unsolicitedReadout(t, t + READOUT_GRACE_MS + 1)).toBe(true);
    expect(unsolicitedReadout(Number.NEGATIVE_INFINITY, t)).toBe(true); // never acted
  });
});
