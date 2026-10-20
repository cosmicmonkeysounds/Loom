//! Wave 13: barks leave the stream; a run of notices about other people
//! folds into one line.

import { describe, expect, it } from "vitest";
import { latestAmbient, namesViewer, noticeNoun, noticeSummary, streamItems } from "../src/stream/notices.ts";
import type { ChatMessage } from "../src/types.ts";

let seq = 1;
const m = (extra: Partial<ChatMessage>): ChatMessage => ({
  seq: seq++, channel: "lobby", channelKind: "lobby", title: "Lobby", from: "", kind: "signal", text: "x", ts: 0, audience: "all", parentSeq: null, hidden: false, ...extra,
});

describe("stream items", () => {
  it("a run of two or more notices folds; a lone one reads as itself", () => {
    const items = streamItems([
      m({ text: "Time is up.", alert: true }),
      m({ notice: "✅", text: "✅ Ada's answer is accepted." }),
      m({ notice: "✅", text: "✅ Bo's answer is accepted." }),
      m({ notice: "🤷", text: "🤷 Cy filed a guess." }),
      m({ kind: "line", from: "Clippy", text: "Pencils down." }),
      m({ notice: "🎀", text: "🎀 Di wins a Bingo Ribbon!" }),
    ]);
    expect(items.map((i) => i.type)).toEqual(["run", "notices", "run", "run"]);
    const folded = items[1]!;
    expect(folded.type === "notices" && noticeSummary(folded.messages)).toBe("✅ 2 · 🤷 1");
  });

  it("barks never become rows; the ticker reads the newest", () => {
    const bark1 = m({ kind: "narration", ambient: true, text: "A fan spins up." });
    const bark2 = m({ kind: "narration", ambient: true, text: "An LED goes amber." });
    const items = streamItems([bark1, m({ text: "Open now." }), bark2]);
    expect(items).toHaveLength(1);
    expect(latestAmbient([bark1, m({}), bark2])?.text).toBe("An LED goes amber.");
    expect(latestAmbient([m({})])).toBeNull();
  });

  it("an alert is never folded into notices, even with a key", () => {
    const items = streamItems([m({ notice: "✅", alert: true }), m({ notice: "✅", alert: true })]);
    expect(items.every((i) => i.type === "run")).toBe(true);
  });

  it("a notice with no glyph counts under •", () => {
    expect(noticeSummary([m({ notice: "" }), m({ notice: "" })])).toBe("• 2");
  });

  it("a notice naming the viewer stays its own row and splits the run", () => {
    const items = streamItems(
      [
        m({ notice: "🗣", text: "🗣 Ada answered. Trabolta is satisfied." }),
        m({ notice: "🗣", text: "🗣 Bo answered. Trabolta is satisfied." }),
        m({ notice: "🗣", text: "🗣 Calculator answered. Trabolta is satisfied." }),
        m({ notice: "🗣", text: "🗣 Cy answered. Trabolta is satisfied." }),
      ],
      "Calculator",
    );
    expect(items.map((i) => i.type)).toEqual(["notices", "run", "run"]);
    expect(items[0]!.type === "notices" && items[0]!.messages.length).toBe(2);
    expect(namesViewer("Winamp → Calculator: 5 Truthcoin", "calculator")).toBe(true);
    expect(namesViewer("Calculators unite", "Calculator")).toBe(false);
    expect(namesViewer("anything", "")).toBe(false);
    expect(namesViewer("Mr. (Paint) wins", "(Paint)")).toBe(true); // regex characters in a name
  });

  it("the folded line says what it holds", () => {
    expect(noticeNoun([m({ text: "🗣 Ada answered." }), m({ text: "🗣 Bo answered." })])).toBe("2 updates about others");
    expect(noticeNoun([m({ text: "🪙 Ada → Bo: 5 Truthcoin" }), m({ text: "💱 Cy ⇄ Di: a fact for 5 Truthcoin" })])).toBe("2 transfers between others");
  });
});
