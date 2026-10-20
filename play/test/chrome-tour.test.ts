//! The guided tour and the pinned rooms' place in the list (split out of
//! onrails.test.ts and quests.test.ts in wave 13): the tutorial card walks
//! the guest frame (the NOW bar, the rooms, the taskbar's Pass / Scan /
//! Start); the Quest Log + Codex keep a fixed order.

import { describe, expect, it } from "vitest";

import { roomOrder } from "../src/presence.ts";
import { buildGuestChannels } from "../src/session.ts";
import { groupBySpace } from "../src/threads.ts";
import { GUEST_TOUR_ANCHORS, tourResult, tutorialSteps } from "../src/tutorial.tsx";
import type { ChatMessage, GuestView, ObjectiveView, WalletView } from "../src/types.ts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Taskbar } from "../src/chrome/taskbar.tsx";
import { TitleBar } from "../src/chrome/title-bar.tsx";
import { guestTaskbarButtons } from "../src/guest/frame.tsx";
import { SpaceList } from "../src/rooms/list.tsx";

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

  it("walks the frame's controls, trimmed to what the story turns on", () => {
    const full = tutorialSteps({ title: "Trapped in the Internet", hasCodex: true, hasPeople: true, hasActions: true });
    expect(full.map((s) => s.id)).toEqual(["welcome", "rooms", "codex", "pass", "scan", "start", "cards", "done"]);
    expect(full[0]!.text).toContain("Trapped in the Internet");
    expect(full.find((s) => s.id === "start")!.text).toContain("the story's own buttons");
    expect(full.find((s) => s.id === "start")!.text).toContain("who's here");
    const bare = tutorialSteps({ title: "T", hasCodex: false, hasPeople: false, hasActions: false });
    expect(bare.map((s) => s.id)).toEqual(["welcome", "rooms", "pass", "scan", "start", "cards", "done"]);
    expect(bare.find((s) => s.id === "start")!.text).not.toContain("buttons");
    // Every anchored step names a real `data-tour` anchor the frame renders.
    for (const s of full) if (s.target !== null) expect(GUEST_TOUR_ANCHORS).toContain(s.target);
  });

  it("Pass and Scan each get a step, on the taskbar's own anchors", () => {
    const steps = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true });
    expect(steps.find((s) => s.id === "pass")).toMatchObject({ target: "pass", title: "Your pass" });
    expect(steps.find((s) => s.id === "scan")).toMatchObject({ target: "scan", title: "Scan" });
    expect(steps.find((s) => s.id === "scan")!.text).toContain("Codex");
  });

  it("a NOW step leads when the story gives objectives; a wallet step after the rooms", () => {
    const base = { title: "T", hasCodex: true, hasPeople: true, hasActions: true };
    expect(tutorialSteps({ ...base, hasObjectives: true }).map((s) => s.id)).toEqual(["welcome", "now", "rooms", "codex", "pass", "scan", "start", "cards", "done"]);
    const coin = tutorialSteps({ ...base, hasWallet: true });
    expect(coin.map((s) => s.id)).toEqual(["welcome", "rooms", "wallet", "codex", "pass", "scan", "start", "cards", "done"]);
    const step = coin.find((s) => s.id === "wallet")!;
    expect(step.target).toBe("wallet"); // the Wallet room's row carries `data-tour="wallet"`
    expect(step.text).toContain("balance");
    expect(tutorialSteps({ ...base, hasWallet: false }).map((s) => s.id)).not.toContain("wallet");
    // With every optional step on: the final order the stories may name.
    expect(tutorialSteps({ ...base, hasObjectives: true, hasWallet: true, hasQuests: true, bathroom: "Tap 🚻 first." }).map((s) => s.id)).toEqual([
      "welcome", "now", "rooms", "wallet", "quests", "codex", "pass", "scan", "start", "bathroom", "cards", "done",
    ]);
  });

  it("adds a Bathroom Mode step over ⊞ Start when the story supplies the blurb", () => {
    const full = { title: "Trapped in the Internet", hasCodex: true, hasPeople: true, hasActions: true };
    const bath = tutorialSteps({ ...full, bathroom: "Tap 🚻 first." });
    expect(bath.map((s) => s.id)).toEqual(["welcome", "rooms", "codex", "pass", "scan", "start", "bathroom", "cards", "done"]);
    const step = bath.find((s) => s.id === "bathroom")!;
    expect(step.target).toBe("start");
    expect(step.text).toBe("Tap 🚻 first.");
    expect(tourResult(bath, null)).toEqual({ completed: true, steps: 9 });
    // No blurb (or an empty one) → no step.
    expect(tutorialSteps({ ...full, bathroom: null }).map((s) => s.id)).not.toContain("bathroom");
    expect(tutorialSteps({ ...full, bathroom: "" }).map((s) => s.id)).not.toContain("bathroom");
  });

  it("every step id is one the stories may name (the final list, optional steps included)", () => {
    const KNOWN = ["welcome", "now", "rooms", "wallet", "quests", "codex", "pass", "scan", "start", "bathroom", "cards", "done"];
    const all = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true, hasObjectives: true, hasWallet: true, hasQuests: true, bathroom: "Tap 🚻 first." });
    for (const s of all) expect(KNOWN).toContain(s.id);
    expect(all.map((s) => s.id)).toEqual(KNOWN.filter((id) => all.some((s) => s.id === id)));
  });

  it("the frame renders every anchor the tour may name", () => {
    const now: ObjectiveView = { id: "o", title: "Find the duck", brief: "", checklist: [], buttons: ["pass"], act: null };
    const html =
      renderToStaticMarkup(createElement(TitleBar, { objectives: [now], fallback: "Lobby", onOpen: () => {} })) +
      renderToStaticMarkup(createElement(Taskbar, { start: [], buttons: guestTaskbarButtons({ now, pass: () => {}, scan: () => {} }) })) +
      renderToStaticMarkup(createElement(SpaceList, { spaces: [], onOpen: () => {} }));
    const rendered = new Set([...html.matchAll(/data-tour="([^"]+)"/gu)].map((m) => m[1]!));
    // The pinned rows' anchors ride on the channels themselves (`Channel.tour`).
    for (const c of buildGuestChannels(new Map(), null, view({ wallet: WALLET }))) if (c.tour !== undefined) rendered.add(c.tour);
    for (const a of GUEST_TOUR_ANCHORS) expect(rendered, a).toContain(a);
  });

  it("answers the card with what happened — the story hears `skipped`", () => {
    const steps = tutorialSteps({ title: "T", hasCodex: true, hasPeople: true, hasActions: true });
    expect(tourResult(steps, null)).toEqual({ completed: true, steps: 8 });
    expect(tourResult(steps, 2)).toEqual({ skipped: true, step: 2, steps: 8 });
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

  it("the tour points at the Quest Log and the Codex rows when the story has them", () => {
    const ids = (o: { hasCodex: boolean; hasQuests?: boolean }) => tutorialSteps({ title: "T", hasPeople: false, hasActions: false, ...o }).map((s) => s.target);
    expect(ids({ hasCodex: true, hasQuests: true })).toContain("quests");
    expect(ids({ hasCodex: true, hasQuests: true })).toContain("codex");
    expect(ids({ hasCodex: false })).not.toContain("quests");
  });
});
