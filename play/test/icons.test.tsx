//! Wave 13 fix round (fguest): the chrome draws its icons — the taskbar's
//! Start / Pass / Scan, the tray, the Start menu's own items — never emoji;
//! a story button's own emoji (content) stays.

import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ICON_NAMES, Icon } from "../src/chrome/icons.tsx";
import { guestStartItems } from "../src/guest/frame.tsx";

const EMOJI = /\p{Extended_Pictographic}/u;

describe("the chrome's icons", () => {
  it("every icon is a decorative 16 × 16 drawing", () => {
    for (const name of ICON_NAMES) {
      const out = renderToStaticMarkup(createElement(Icon, { name }));
      expect(out, name).toMatch(/^<svg class="ico ico-[a-z-]+" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">/u);
      expect(out, name).toMatch(/<(path|rect|circle)/u);
    }
  });

  it("the guest's Start menu draws its own items; a story button keeps its emoji", () => {
    const items = guestStartItems({
      name: "Ada",
      faction: "Mods",
      interactions: [{ id: "bathroom", label: "🚻 Bathroom Mode" } as never],
      defectTo: ["Chatters"],
      wake: { supported: true, on: false },
      push: true,
      people: true,
      open: { picture: () => {}, wake: () => {}, alerts: () => {}, people: () => {}, help: () => {}, act: () => {}, defect: () => {}, leave: () => {} },
    });
    const story = items.find((i) => i.id === "act:bathroom")!;
    expect(story.icon).toBe("🚻");
    for (const i of items.filter((x) => !x.id.startsWith("act:"))) {
      expect(isValidElement(i.icon), i.id).toBe(true);
      expect(EMOJI.test(i.label), i.id).toBe(false);
    }
  });
});

describe("the guest chrome draws its utility icons (finish review #8)", () => {
  it("the who's-here count, the reply button, a thread's head and the pin rail carry no emoji", async () => {
    const { PresenceStrip } = await import("../src/stream/channel-view.tsx");
    const { MessageBubble } = await import("../src/stream/bubble.tsx");
    const { PinnedRail } = await import("../src/moments/pins-rail.tsx");
    const strip = renderToStaticMarkup(createElement(PresenceStrip, { people: [{ id: "g1", name: "Ada" }] as never, meId: "g1", onOpen: () => {} }));
    expect(strip).toContain("ico-people");
    expect(EMOJI.test(strip)).toBe(false);
    const line = { seq: 3, channel: "lobby", channelKind: "lobby", title: "Lobby", from: "Ada", kind: "line", text: "hi", ts: 3, audience: "all", parentSeq: null, hidden: false } as never;
    const reply = renderToStaticMarkup(createElement(MessageBubble, { msg: line, onOpenThread: () => {} }));
    expect(reply).toContain("ico-reply");
    expect(EMOJI.test(reply)).toBe(false);
    const pin = { seq: 4, channel: "lobby", channelKind: "lobby", title: "Lobby", from: "", kind: "signal", text: "Doors at nine.", ts: 4, audience: "all", parentSeq: null, hidden: false, pin: "" } as never;
    const rail = renderToStaticMarkup(createElement(PinnedRail, { pins: [pin] }));
    expect(rail).toContain("ico-pin");
    expect(EMOJI.test(rail)).toBe(false);
  });

  it("the shared set has what a booth's chrome needs", () => {
    for (const name of ["receipt", "cards", "shield", "codex", "quest", "reply", "pin", "help", "bell", "leave"] as const) expect(ICON_NAMES).toContain(name);
  });
});
