//! The host console's live-check fixes (wave 13): the stale arm's toast,
//! the strip's words, the doors and a pause, the answer sheet's labels and
//! the queue's clock.

import { describe, expect, it } from "vitest";
import { agentQueue, barLine, countdownLeft, phaseLabel, showControl, threadLine } from "../src/host/model.ts";
import type { ChatMessage } from "../src/types.ts";

describe("a stale arm, then a new one", () => {
  const base = { connected: true, error: null, receivedAt: 0, now: 0, subjectName: null, refused: null, reason: null };
  it("the armed prompt outranks the 'Cues moved' toast that asked for it", () => {
    expect(barLine({ ...base, toast: "Cues moved — tap again", armed: false })).toEqual({ kind: "toast", text: "Cues moved — tap again" });
    expect(barLine({ ...base, toast: "Cues moved — tap again", armed: true })).toEqual({ kind: "armed", text: "Tap FIRE within 4 s to fire" });
  });
  it("on a stale view a toast still shows first, then the stale line", () => {
    expect(barLine({ ...base, connected: false, toast: "✓ Fired", armed: true }).kind).toBe("toast");
    expect(barLine({ ...base, connected: false, toast: null, armed: true }).kind).toBe("stale");
  });
});

describe("the strip's words", () => {
  it("a phase id reads as a label", () => {
    expect(phaseLabel("hunt_1")).toBe("Hunt 1");
    expect(phaseLabel("truth_pong")).toBe("Truth Pong");
    expect(phaseLabel("finale_killed")).toBe("Finale Killed");
    expect(phaseLabel("y2k")).toBe("Y2K");
    expect(phaseLabel("arrivals")).toBe("Arrivals");
  });
  it("a countdown is time left, never a time of day", () => {
    expect(countdownLeft("Hunt 1 ends", 299)).toBe("⏳ Hunt 1 ends, 4:59 left");
    expect(countdownLeft("Midnight", 3725)).toBe("⏳ Midnight, 1:02:05 left");
  });
});

describe("More › The show (C2)", () => {
  it("doors before the doors, pause while running, resume while paused", () => {
    expect(showControl({ runtime: "idle" }).id).toBe("doors");
    expect(showControl({ runtime: "idle" }).label).toBe("🚪 Open the doors");
    expect(showControl({ runtime: "paused", doorsClosed: true }).id).toBe("doors");
    expect(showControl({ runtime: "open" }).id).toBe("pause");
    expect(showControl({ runtime: "paused" })).toMatchObject({ id: "resume", label: "▶ Resume the show", state: "⏸ paused" });
  });
});

describe("the answer-as-Trabolta thread", () => {
  const m = (from: string, kind: ChatMessage["kind"], text: string, widget?: ChatMessage["widget"]) => ({ from, kind, text, ...(widget !== undefined ? { widget } : {}) });
  it("labels each line by who really sent it", () => {
    expect(threadLine(m("Trabolta", "line", "Hello."), "Trabolta", "Solitaire")).toEqual({ who: "Trabolta", text: "Hello.", tone: "them" });
    expect(threadLine(m("Solitaire", "line", "are you there"), "Trabolta", "Solitaire")).toEqual({ who: "Solitaire", text: "are you there", tone: "guest" });
    // The story's fact card is a card, never the guest's own words.
    expect(threadLine(m("", "widget", "", { kind: "fact", text: "📝 File a fact", params: {} }), "Trabolta", "Solitaire")).toEqual({ who: "card", text: "📝 File a fact", tone: "story" });
    expect(threadLine(m("", "narration", "The lights flicker."), "Trabolta", "Solitaire")).toEqual({ who: "story", text: "The lights flicker.", tone: "story" });
  });
});

describe("the queue's oldest wait and each guest's", () => {
  it("both read the rows' `since`", () => {
    const a = { queue: { depth: 2, oldestMs: 26_000, stalled: false }, waiting: [{ guest: "g1", name: "A", since: 1_000, text: "x" }, { guest: "g2", name: "B", since: 4_000, text: "y" }] };
    expect(agentQueue(a, 8_000)).toEqual({ depth: 2, oldestMs: 7_000, stalled: false });
    // 4.9 s reads 0:04 in both places (floored), never 0:05 beside 0:04.
    expect(agentQueue(a, 5_900)!.oldestMs).toBe(4_000);
  });
  it("no guest rows: the server's own number stands", () => {
    expect(agentQueue({ queue: { depth: 1, oldestMs: 5_000, stalled: true }, waiting: [] }, 9_000)).toEqual({ depth: 1, oldestMs: 5_000, stalled: true });
    expect(agentQueue({ queue: null, waiting: [] }, 0)).toBeNull();
  });
});

