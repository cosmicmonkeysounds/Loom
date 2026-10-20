//! Wave 13: cards settle — a live card docks in the tray (a receipt stays),
//! an answered one is one line, a re-dealt one folds, the pass settles
//! once the guest is out of the cutscene.

import { describe, expect, it } from "vitest";
import { cardForm, receiptLine, settledLine, trayCaption, trayCards } from "../src/stream/settled.ts";
import type { ChatMessage, WidgetCard } from "../src/types.ts";

const card = (kind: string, text = "", params: Record<string, string> = {}): WidgetCard => ({ kind, text, params });
const room = { tray: true, settlePass: true, answerable: true, superseded: false, answered: null };
const cut = { ...room, tray: false, settlePass: false };

function widget(seq: number, c: WidgetCard, from = "Trabolta"): ChatMessage {
  return { seq, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from, kind: "widget", text: "", ts: 0, audience: ["g1"], parentSeq: null, hidden: false, widget: c };
}

describe("which form a card takes", () => {
  it("a live card in a room goes to the tray; in the cutscene it stays inline", () => {
    expect(cardForm({ ...room, card: card("captcha") })).toBe("tray");
    expect(cardForm({ ...cut, card: card("captcha") })).toBe("full");
    expect(cardForm({ ...room, card: card("fact", "📝 File a fact", { questions: "H1: one" }) })).toBe("tray");
  });

  it("answered, replaced, closed, or someone else's → one line", () => {
    expect(cardForm({ ...room, card: card("poll"), answered: { choice: "Truth" } })).toBe("settled");
    expect(cardForm({ ...cut, card: card("captcha"), answered: { passed: true } })).toBe("settled");
    expect(cardForm({ ...room, card: card("fact", "", { questions: "H1: x" }), superseded: true })).toBe("settled");
    expect(cardForm({ ...room, card: card("fact", "", { questions: "" }) })).toBe("settled"); // the round closed
    expect(cardForm({ ...room, card: card("captcha"), answerable: false })).toBe("settled"); // a booth reading a guest's thread
    expect(cardForm({ ...room, card: card("tutorial") })).toBe("settled"); // the tour answers itself over the app
  });

  it("the pass settles out of the cutscene; a picture is always whole", () => {
    expect(cardForm({ ...room, card: card("pass") })).toBe("settled");
    expect(cardForm({ ...cut, card: card("pass") })).toBe("full");
    expect(cardForm({ ...room, card: card("image", "https://x/y.png") })).toBe("full");
    expect(cardForm({ ...room, card: card("mystery") })).toBe("full"); // an unknown kind keeps its fallback
  });
});

describe("the one-line receipts", () => {
  it("one line per kind", () => {
    const s = (c: WidgetCard, answered: Record<string, string | number | boolean> | null, extra = {}) => settledLine({ card: c, answered, superseded: false, answerable: true, ...extra });
    expect(s(card("captcha"), { passed: false })).toBe("🛡️ Security check · submitted");
    expect(s(card("poll", "Truth or dare?"), { choice: "Truth" })).toBe("📊 Truth or dare? · you chose Truth");
    expect(s(card("answer", "Give me a pickup line."), { text: "hi" })).toBe("💬 Give me a pickup line. · sent");
    expect(s(card("fact", "📝 File a fact", { questions: "H1: q" }), { question: "H1", answer: "x", confidence: 100 })).toBe("📝 File a fact · sent for q · 100%");
    // The guest's name for the question, never the story's id ("H1").
    expect(s(card("fact", "📝 File a fact", { questions: "H1: Round 1 Q1. How many years…? | H2: Round 1 Q2. Who?" }), { question: "H2", answer: "x", confidence: 80 })).toBe("📝 File a fact · sent for Round 1 Q2 · 80%");
    expect(s(card("fact", "📝 File a fact", { questions: "H2: Round 1 Q2. Who?" }), { question: "H1", answer: "x", confidence: 80 })).toBe("📝 File a fact · sent for a question · 80%");
    expect(s(card("tutorial", "Clippy's orientation"), { skipped: true })).toBe("📘 Clippy's orientation · skipped");
    expect(s(card("pass", "Hold this up."), null)).toBe("🎟️ Your pass · tap to show it");
    expect(s(card("fact", "📝 File a fact", { questions: "H1: q" }), null, { superseded: true })).toBe("📝 File a fact · replaced by a newer card");
    expect(s(card("captcha"), null, { answerable: false })).toBe("🛡️ Security check · shown to a guest");
    expect(s(card("fact", "📝", { questions: "" }), null)).toContain("The filing is closed");
  });

  it("a receipt names who asks; the tray's caption too", () => {
    const m = widget(5, card("fact", "📝 File a fact", { questions: "H1: q" }));
    expect(receiptLine(m)).toBe("📝 File a fact · Trabolta asks · answer it below");
    expect(trayCaption(m)).toBe("📝 File a fact · Trabolta");
    expect(receiptLine(widget(6, card("captcha"), "Narrator"))).toBe("🛡️ Security check · answer it below");
  });
});

describe("the tray's cards", () => {
  it("live, unanswered, not replaced, oldest first", () => {
    const a = widget(1, card("fact", "", { questions: "H1: q" }));
    const b = widget(2, card("fact", "", { questions: "H2: q" }));
    const c = widget(3, card("poll", "Truth or dare?"));
    const d = widget(4, card("captcha"));
    const tour = widget(5, card("tutorial"));
    const answered = new Map([[4, { passed: true }]]);
    expect(trayCards([a, b, c, d, tour], answered, new Set([1])).map((m) => m.seq)).toEqual([2, 3]);
  });
});
