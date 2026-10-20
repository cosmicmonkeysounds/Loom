//! Wave 13: the Quest Log puts what is in progress first, with its latest
//! step; done and failed fold away.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestRoom } from "../src/stream/codex-room.tsx";
import { questSections } from "../src/stream/codex-groups.ts";
import type { ChatMessage, QuestAction } from "../src/types.ts";

let seq = 1;
function q(quest: string, action: QuestAction, text: string, parentSeq: number | null = null): ChatMessage {
  return { seq: seq++, channel: "quests", channelKind: "quests", title: "Quest Log", from: "Clippy", kind: "quest", text, ts: 0, audience: ["g1"], parentSeq, hidden: false, quest: { quest, title: quest.replace(/_/g, " "), action } };
}

function log() {
  const orient = q("Orientation", "start", "Take the tour.");
  const bingo = q("Computer_Bingo", "start", "Find the squares.");
  const hunt = q("The_Hunt", "start", "Find the facts, file them with Trabolta. ".repeat(4));
  return [
    orient,
    bingo,
    q("Orientation", "complete", "", orient.seq),
    hunt,
    q("Computer_Bingo", "fail", "Too slow.", bingo.seq),
    q("The_Hunt", "update", "Round 2 is open: three questions.", hunt.seq),
  ];
}

describe("the sections", () => {
  it("active first with its latest step, then done, then failed", () => {
    const s = questSections(log());
    expect(s.active.map((r) => [r.root.quest!.quest, r.latest])).toEqual([["The_Hunt", "Round 2 is open: three questions."]]);
    expect(s.done.map((r) => [r.root.quest!.quest, r.latest])).toEqual([["Orientation", "Quest complete."]]);
    expect(s.failed.map((r) => r.root.quest!.quest)).toEqual(["Computer_Bingo"]);
  });

  it("a quest nothing has happened to yet has no latest step", () => {
    expect(questSections([q("Solo", "start", "Brief.")]).active[0]!.latest).toBe("");
  });
});

describe("the room", () => {
  const html = renderToStaticMarkup(createElement(QuestRoom, { messages: log(), empty: "No quests yet." }));
  it("in progress is open, the brief folded; done and failed are folded headers", () => {
    expect(html).toContain("In progress");
    expect(html).toContain("Round 2 is open");
    expect(html).not.toContain("Find the facts"); // the brief waits for a tap
    expect(html).toContain("Done");
    expect(html).toContain("Failed");
    expect(html).not.toContain("Orientation"); // folded
    expect(html).not.toContain("Too slow");
  });

  it("nothing in progress: says so above the folded sections", () => {
    const orient = q("Orientation", "start", "Take the tour.");
    const html = renderToStaticMarkup(createElement(QuestRoom, { messages: [orient, q("Orientation", "complete", "", orient.seq)], empty: "No quests yet." }));
    expect(html).toContain("Nothing in progress right now.");
  });

  it("empty: says how quests arrive", () => {
    expect(renderToStaticMarkup(createElement(QuestRoom, { messages: [], empty: "No quests yet." }))).toContain("No quests yet.");
  });
});
