// From the Oct 31 browser walkthrough (split out of walkthrough.test.ts in
// wave 13, blocks unchanged): the stream that sticks to its newest line, a
// hold-line character that is never "away", re-dealt cards, closed fact cards.
import { describe, expect, it } from "vitest";

import { atBottom } from "../src/chat.tsx";
import { hasPendingCard, withAgents } from "../src/session.ts";
import type { Channel, ChatMessage, GuestView } from "../src/types.ts";
import { FACT_CLOSED_NOTE, WIDGETS, cardAsks, supersededCards } from "../src/widgets.tsx";
import { renderToStaticMarkup } from "react-dom/server";

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "dm", title: channel, from: "Trabolta", kind: "line", text: `line ${seq}`, ts: seq, audience: ["g-1"], parentSeq: null, hidden: false, ...extra };
}
function ch(id: string): Channel {
  return { id, kind: "dm", title: id, spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0 };
}

describe("the stream sticks to its newest line", () => {
  it("counts the last ~80 px as the bottom", () => {
    expect(atBottom({ scrollTop: 760, scrollHeight: 1000, clientHeight: 240 })).toBe(true);
    expect(atBottom({ scrollTop: 700, scrollHeight: 1000, clientHeight: 240 })).toBe(true); // 60 px off
    expect(atBottom({ scrollTop: 594, scrollHeight: 1000, clientHeight: 240 })).toBe(false); // the walkthrough's 166 px
  });
});

describe("a character with a hold: line is never away", () => {
  it("shows no presence to the guest — the row previews the last message", () => {
    const view = {
      people: [
        { id: "Trabolta", name: "Trabolta", kind: "character", faction: null, known: [], location: null, agent: { online: false, hold: true } },
        { id: "Oracle", name: "Oracle", kind: "character", faction: null, known: [], location: null, agent: { online: false } },
      ],
    } as unknown as GuestView;
    const out = withAgents([ch("dm:Trabolta"), ch("dm:Oracle")], view, new Map([["dm:Trabolta", "Trabolta"]]));
    expect(out[0]!.subtitle).toBeUndefined();
    expect(out[0]!.typing).toBe("Trabolta"); // still says when a worker composes
    expect(out[1]!.subtitle).toMatch(/away/);
  });
});

describe("a re-dealt card replaces the earlier one", () => {
  it("marks every fact card but the newest per room", () => {
    const fact = (seq: number, channel = "dm:Trabolta") => msg(seq, channel, { kind: "widget", widget: { kind: "fact", text: "📝", params: {} } });
    const old = supersededCards([fact(3), msg(4, "dm:Trabolta"), fact(7), fact(9), fact(5, "dm:Clippy"), msg(10, "dm:Trabolta", { kind: "widget", widget: { kind: "captcha", text: "", params: {} } })]);
    expect([...old].sort((a, b) => a - b)).toEqual([3, 7]);
  });
});

describe("a fact card with no open questions is closed, not a task (B14)", () => {
  const fact = (seq: number, questions: string) => msg(seq, "dm:Trabolta", { kind: "widget", widget: { kind: "fact", text: "📝 File a fact", params: { questions } } });

  it("a trailing empty card supersedes the stale one and asks nothing", () => {
    const stale = fact(3, "H2: Round 1 Q2.");
    const closed = fact(9, "");
    expect(hasPendingCard([stale], new Set())).toBe(true);
    const room = [stale, msg(5, "dm:Trabolta"), closed];
    expect([...supersededCards(room)]).toEqual([3]);
    // Trabolta's DM row loses "your move".
    expect(hasPendingCard(room, new Set())).toBe(false);
    expect(cardAsks(closed.widget!)).toBe(false);
    expect(cardAsks(stale.widget!)).toBe(true);
  });

  it("renders as a note, not a form", () => {
    const html = renderToStaticMarkup(WIDGETS.fact!.render({ card: fact(9, "").widget!, seed: 9, onAnswer: () => {} }) as never);
    expect(html).toContain(FACT_CLOSED_NOTE);
    expect(html).not.toContain("<textarea");
    expect(renderToStaticMarkup(WIDGETS.fact!.render({ card: fact(3, "H2: Round 1 Q2.").widget!, seed: 3, onAnswer: () => {} }) as never)).toContain("<textarea");
  });

  it("a card with one question left shows it picked, and says what File it waits for (T5-04)", () => {
    const html = renderToStaticMarkup(WIDGETS.fact!.render({ card: fact(3, "H2: Round 1 Q2.").widget!, seed: 3, onAnswer: () => {} }) as never);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Type your answer");
    const two = renderToStaticMarkup(WIDGETS.fact!.render({ card: fact(4, "H2: Q2 | H3: Q3").widget!, seed: 4, onAnswer: () => {} }) as never);
    expect(two).not.toContain('aria-pressed="true"');
    expect(two).toContain("Pick a question above");
  });
});

describe("the stick-to-bottom observers stay cheap", () => {
  it("only the box's own rows are watched; a crawl tick inside a row adds none", async () => {
    const { rowChanges } = await import("../src/stream/list.tsx");
    const box = {};
    const row = { nodeType: 1 };
    const old = { nodeType: 1 };
    const text = { nodeType: 3 };
    const inner = {};
    const records = [
      { type: "characterData", target: text, addedNodes: [], removedNodes: [] },
      { type: "childList", target: inner, addedNodes: [{ nodeType: 1 }], removedNodes: [] }, // a span inside a crawling row
      { type: "childList", target: box, addedNodes: [row, text], removedNodes: [old] },
    ];
    expect(rowChanges(records, box)).toEqual({ added: [row], removed: [old] });
    expect(rowChanges(records.slice(0, 2), box)).toEqual({ added: [], removed: [] });
  });
});
