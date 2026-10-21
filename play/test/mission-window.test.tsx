//! Wave 18 (GUEST-SPEC §2): the Mission window draws its model — the quest
//! card (caption, glyph + title, the Where row, the to-dos with their block
//! bar, the big buttons), Your move, the three tiles, Also now folded.

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MissionWindow } from "../src/guest/mission.tsx";
import { missionOf } from "../src/guest/mission-model.ts";
import { blocksOf } from "../src/ui/progress.tsx";
import type { Channel, GuestView, ObjectiveView } from "../src/types.ts";

const noop = () => {};
const bingo: ObjectiveView = {
  id: "bingo",
  title: "🎱 Computer Bingo: find a program for each square",
  brief: "Mingle and find a program for every square.",
  checklist: [
    { label: "Picked up a card", done: true },
    { label: "A full row", done: false },
  ],
  buttons: ["scan"],
  act: "B",
};
const explore: ObjectiveView = { id: "explore", title: "Explore the computer", brief: "Meet the other programs.", checklist: [], buttons: ["scan"], act: null };

function view(o: Record<string, unknown> = {}): GuestView {
  return { id: "g-1", name: "Winamp", role: null, faction: null, score: 0, location: "The Desktop", captured: false, pendingChoice: null, decisionChannel: null, channels: [], spaces: [], roster: [], ...o } as GuestView;
}
const list: Channel[] = [{ id: "loc:The Desktop", kind: "location", title: "The Desktop (living room)", spaceId: "story", messages: [], unread: 0, decision: null, lastTs: 0 }];
const renderButton = (id: string): ReactElement | null => createElement("button", { className: "big-" + id }, id === "scan" ? "📷 SCAN A CODE" : id);

function render(v: GuestView, extra: Partial<Parameters<typeof MissionWindow>[0]> = {}) {
  const model = missionOf({ view: v, list, cards: [], decision: null });
  return renderToStaticMarkup(createElement(MissionWindow, { model, captured: false, onGo: noop, renderButton, onInvite: noop, peopleHere: 4, onPeople: noop, ...extra }));
}

describe("the Mission window", () => {
  it("the quest card: caption, glyph + title, YOU'RE HERE, to-dos, the bar, the big button", () => {
    const out = render(view({ objectives: [bingo, explore], mission: { objective: "bingo", place: { id: "loc:The Desktop", name: "The Desktop" } }, codexTotal: 3, codex: [] }));
    expect(out).toContain('data-tour="mission"');
    expect(out).toContain("Mission");
    expect(out).toContain('<span class="mission-glyph" aria-hidden="true">🎱</span>');
    expect(out).toContain("✓ YOU&#x27;RE HERE");
    expect(out).toContain("☑");
    expect(out).toContain("1 / 2");
    expect(out).toContain("📷 SCAN A CODE");
    // the evergreen never shows as Also now
    expect(out).not.toContain("Also now");
    expect(out).toContain("Codex");
    expect(out).toContain("0 found");
  });

  it("free roam: the kicker and WHO'S HERE", () => {
    const out = render(view({ objectives: [explore] }));
    expect(out).toContain("FREE ROAM · The house will call you.");
    expect(out).toContain("WHO&#x27;S HERE (4)");
  });

  it("paused and captured", () => {
    const out = render(view({ objectives: [bingo], paused: true }), { captured: true });
    expect(out).toContain("Mission (Paused)");
    expect(out).toContain("mission captured");
  });

  it("a decision docked on Mission renders its options inline", () => {
    const model = missionOf({ view: view({ objectives: [bingo] }), list, cards: [], decision: { channel: "mission", decision: { title: "Task Manager asks", options: [{ label: "Tell the truth", onClick: noop }, { label: "Lie", onClick: noop }] } } });
    const out = renderToStaticMarkup(createElement(MissionWindow, { model, captured: false, onGo: noop, renderButton, onInvite: noop, peopleHere: 0, onPeople: noop }));
    expect(out).toContain("YOUR MOVE");
    expect(out).toContain("Task Manager asks");
    expect(out).toContain("Tell the truth");
    expect(out).toContain("▶ 2");
  });

  it("the block bar never shows a sliver", () => {
    expect(blocksOf(0, 3)).toBe(0);
    expect(blocksOf(1, 100)).toBe(1);
    expect(blocksOf(1, 2)).toBe(10);
    expect(blocksOf(5, 2)).toBe(20);
  });
});
