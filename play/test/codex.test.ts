import { describe, expect, it } from "vitest";

import { groupCodex, maxSeqOf, pickAlerts, pmChannelId, pmOtherParty, unlockFromSearch, withoutUnlock } from "../src/codex.ts";
import type { ChatMessage } from "../src/types.ts";

function msg(seq: number, alert: boolean, hidden = false): ChatMessage {
  return {
    seq,
    channel: "lobby",
    channelKind: "lobby",
    title: "Lobby",
    from: "",
    kind: "signal",
    text: `a${seq}`,
    ts: seq,
    audience: "all",
    parentSeq: null,
    hidden,
    ...(alert ? { alert: true } : {}),
  };
}

describe("private threads", () => {
  it("one id whoever opens it, and the other party from my side", () => {
    expect(pmChannelId("g-b", "g-a")).toBe("pm:g-a:g-b");
    expect(pmChannelId("g-a", "g-b")).toBe("pm:g-a:g-b");
    expect(pmOtherParty("pm:g-a:g-b", "g-a")).toBe("g-b");
    expect(pmOtherParty("pm:g-a:g-b", "g-b")).toBe("g-a");
    expect(pmOtherParty("pm:g-a:g-b", "g-c")).toBeNull();
    expect(pmOtherParty("dm:Trabolta", "g-a")).toBeNull();
  });
});

describe("unlock deep link", () => {
  it("reads the code off a scanned QR's link and can strip it for reload safety", () => {
    expect(unlockFromSearch("?code=EVT1&unlock=SANDY-1997")).toBe("SANDY-1997");
    expect(unlockFromSearch("?code=EVT1")).toBeNull();
    expect(unlockFromSearch("?unlock=")).toBeNull();
    expect(withoutUnlock("?code=EVT1&unlock=SANDY-1997")).toBe("?code=EVT1");
    expect(withoutUnlock("?unlock=X")).toBe("");
  });
});

describe("codex grouping", () => {
  it("groups by subject in first-seen order; unattributed lore under ''", () => {
    const groups = groupCodex([
      { id: "a", title: "A", about: "Trabolta", text: "" },
      { id: "b", title: "B", about: "World", text: "" },
      { id: "c", title: "C", about: "Trabolta", text: "" },
      { id: "d", title: "D", about: null, text: "" },
    ]);
    expect(groups.map((g) => [g.about, g.entries.map((e) => e.id)])).toEqual([
      ["Trabolta", ["a", "c"]],
      ["World", ["b"]],
      ["", ["d"]],
    ]);
  });
});

describe("alerts", () => {
  it("picks only new, visible alert broadcasts, oldest first", () => {
    const all = [msg(3, true), msg(1, true), msg(2, false), msg(4, true, true), msg(5, true)];
    expect(pickAlerts(all, 1).map((m) => m.seq)).toEqual([3, 5]);
    expect(pickAlerts(all, -1).map((m) => m.seq)).toEqual([1, 3, 5]);
    expect(pickAlerts(all, 5)).toEqual([]);
    expect(maxSeqOf(all)).toBe(5);
    expect(maxSeqOf([])).toBe(-1);
  });
});
