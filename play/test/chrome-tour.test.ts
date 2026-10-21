//! The guided tour and the pinned rooms' place in the list (split out of
//! onrails.test.ts and quests.test.ts in wave 13): the tutorial card walks
//! the guest frame in five steps (wave 18: Mission, Chats, Pass and Scan,
//! the 🔔, Start); the Quest Log + Codex keep a fixed order.

import { describe, expect, it } from "vitest";

import { roomOrder } from "../src/presence.ts";
import { buildGuestChannels } from "../src/session.ts";
import { groupBySpace } from "../src/threads.ts";
import { GUEST_TOUR_ANCHORS, TOUR_MAX, tourResult, tutorialSteps } from "../src/tutorial.tsx";
import type { ChatMessage, GuestView, ObjectiveView, WalletView } from "../src/types.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Taskbar } from "../src/chrome/taskbar.tsx";
import { TitleBar } from "../src/chrome/title-bar.tsx";
import { MeButton, guestTaskbarButtons } from "../src/guest/frame.tsx";
import { BellButton } from "../src/moments/provider.tsx";

const WALLET: WalletView = { name: "Truthcoin", balance: 100, escrowed: 0, maxTransfer: 50, transfers: [], requests: [], offers: [] };
import { WIDGETS } from "../src/widgets.tsx";

function msg(seq: number, channel: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { seq, channel, channelKind: "lobby", title: channel, from: "", kind: "line", text: `m${seq}`, ts: seq, audience: ["me"], parentSeq: null, hidden: false, ...extra };
}
function view(extra: Partial<GuestView> = {}): GuestView {
  return {
    id: "me",
    name: "Me",
    role: null,
    faction: null,
    score: 0,
    location: null,
    captured: false,
    pendingChoice: null,
    decisionChannel: null,
    channels: [],
    spaces: [],
    roster: [],
    codex: [{ id: "a", title: "A", about: null, text: "" }],
    codexTotal: 12,
    quests: [
      { id: "The Hunt", title: "The Hunt", giver: "Clippy", status: "active" },
      { id: "The Keys", title: "The Keys", giver: null, status: "done" },
    ],
    questTotal: 3,
    ...extra,
  };
}

describe("the tutorial", () => {
  it("is an overlay card in the registry", () => {
    expect(WIDGETS["tutorial"]).toMatchObject({ answerable: true, overlay: true });
    expect(WIDGETS["captcha"]?.overlay).toBeUndefined();
  });

  it("wave 18: exactly five steps, each on an anchor the frame renders", () => {
    const steps = tutorialSteps({ title: "Trapped in the Internet", hasCodex: true, hasPeople: true, hasActions: true, hasObjectives: true, hasWallet: true, hasQuests: true });
    expect(steps.map((s) => s.id)).toEqual(["mission", "chats", "pass", "bell", "start"]);
    expect(steps).toHaveLength(TOUR_MAX);
    expect(steps.map((s) => s.title)).toEqual(["Your mission", "Chats", "Pass and Scan", "Notifications", "Start"]);
    for (const s of steps) expect(GUEST_TOUR_ANCHORS).toContain(s.target);
    expect(tutorialSteps({ title: "T", hasCodex: false, hasPeople: false, hasActions: false })).toHaveLength(5);
  });

  it("the story's Bathroom Mode text replaces the Start step's", () => {
    const steps = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true, bathroom: "Tap 🚻 first." });
    expect(steps).toHaveLength(5);
    expect(steps[4]).toMatchObject({ target: "start", text: "Tap 🚻 first." });
    expect(tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true, bathroom: "" })[4]!.text).toBe("Bathroom Mode, people, help and you.");
  });

  it("the frame renders every anchor the tour may name", () => {
    const now: ObjectiveView = { id: "o", title: "Find the duck", brief: "", checklist: [], buttons: ["pass"], act: null };
    const tb = guestTaskbarButtons({ now, pressed: "mission", chatsDot: false, missionNew: false, mission: () => {}, chats: () => {}, pass: () => {}, scan: () => {} });
    const html =
      renderToStaticMarkup(
        createElement(TitleBar, { objectives: [now], fallback: "Lobby", onOpen: () => {}, lead: createElement(MeButton, { name: "Me", onOpen: () => {} }), trail: createElement(BellButton, { onOpen: () => {} }) }),
      ) + renderToStaticMarkup(createElement(Taskbar, { start: [], buttons: tb }));
    const rendered = new Set([...html.matchAll(/data-tour="([^"]+)"/gu)].map((m) => m[1]!));
    for (const a of GUEST_TOUR_ANCHORS) expect(rendered, a).toContain(a);
  });

  it("answers the card with what happened — the story hears `skipped`", () => {
    const steps = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true });
    expect(tourResult(steps, null)).toEqual({ completed: true, steps: 5 });
    expect(tourResult(steps, 2)).toEqual({ skipped: true, step: 2, steps: 5 });
  });
});

describe("pinned rooms", () => {
  it("the Quest Log + Codex are there from the start, pinned above the story, in a fixed order", () => {
    const messages = new Map<number, ChatMessage>([[1, msg(1, "lobby", { audience: "all" })]]);
    const list = buildGuestChannels(messages, null, view());
    const log = list.find((c) => c.id === "quests")!;
    const codex = list.find((c) => c.id === "codex")!;
    expect([log.kind, log.title, log.spaceId, log.canPost, log.threadable, log.subtitle, log.tour]).toEqual(["quests", "Quest Log", "pinned", false, true, "1 active · 1 done", "quests"]);
    expect([codex.kind, codex.title, codex.spaceId, codex.canPost, codex.threadable, codex.subtitle, codex.tour]).toEqual(["codex", "Codex", "pinned", true, false, "1 of 12 found", "codex"]);
    // Even when the Codex has unread news and the log doesn't, the order holds.
    const sorted = list.map((c) => ({ ...c, unread: c.id === "codex" ? 3 : 0 })).sort(roomOrder);
    // …in any input order, among rooms with news of their own.
    const busy = [...list].reverse().map((c) => ({ ...c, unread: c.id === "quests" ? 0 : 5, here: c.id === "lobby" }));
    expect(busy.sort(roomOrder).map((c) => c.id)).toEqual(["quests", "codex", "lobby"]);
    const spaces = groupBySpace(sorted);
    expect(spaces[0]!.id).toBe("pinned");
    expect(spaces[0]!.channels.map((c) => c.id)).toEqual(["quests", "codex"]);
  });
});
