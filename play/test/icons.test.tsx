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
