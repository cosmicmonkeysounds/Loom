//! Wave 13 (chrome): the NOW title bar — the first live objective, else the
//! open room, else the story; the tone of a captured / restricted guest.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TitleBar, titleBarSub, titleBarText } from "../src/chrome/title-bar.tsx";
import { whereLine } from "../src/guest/frame.tsx";
import type { ObjectiveView } from "../src/types.ts";

const o = (id: string, title: string): ObjectiveView => ({ id, title, brief: "", checklist: [], buttons: [], act: null });

describe("the NOW title bar", () => {
  it("names the first live objective, else falls back", () => {
    expect(titleBarText([o("a", "Get scanned"), o("b", "Find Gerald")], "Lobby")).toEqual({ title: "▣ NOW: Get scanned ›", now: o("a", "Get scanned") });
    expect(titleBarText([], "The Desktop").title).toBe("The Desktop");
    expect(titleBarText(undefined, "Trapped in the Internet")).toEqual({ title: "Trapped in the Internet", now: null });
  });

  it("captured and restricted mark the title with ⛔ and tint the bar", () => {
    expect(titleBarText([o("a", "Run")], "x", "alarm").title).toBe("⛔ ▣ NOW: Run ›");
    expect(titleBarText(undefined, "Lobby", "restricted").title).toBe("⛔ Lobby");
    expect(renderToStaticMarkup(createElement(TitleBar, { objectives: undefined, fallback: "Lobby", onOpen: () => {}, tone: "restricted" }))).toContain('class="title-bar restricted"');
  });

  it("a tappable objective opens its card; the fallback is plain text", () => {
    const now = renderToStaticMarkup(createElement(TitleBar, { objectives: [o("a", "Get scanned")], fallback: "Lobby", onOpen: () => {}, sub: "📍 The Desktop" }));
    expect(now).toMatch(/^<header class="title-bar "><button type="button" class="title-bar-btn" data-tour="now"/u);
    expect(now).toContain("📍 The Desktop");
    const none = renderToStaticMarkup(createElement(TitleBar, { objectives: [], fallback: "Lobby", onOpen: () => {} }));
    expect(none).not.toContain("<button");
    expect(none).toContain('data-tour="now"');
  });

  it("says how many more objectives wait behind the first", () => {
    const out = renderToStaticMarkup(createElement(TitleBar, { objectives: [o("a", "A"), o("b", "B"), o("c", "C")], fallback: "", onOpen: () => {}, sub: "📍 Hall" }));
    expect(out).toContain("📍 Hall · +2 more");
  });

  it("the sub-line says where you stand, or that you can't move", () => {
    expect(whereLine({ captured: false, restricted: false, location: "The Desktop" })).toBe("📍 The Desktop");
    expect(whereLine({ captured: false, restricted: false, location: null })).toBe("📍 nowhere yet");
    expect(whereLine({ captured: true, restricted: true, location: "The Internet" })).toBe("🔒 captured");
    expect(whereLine({ captured: false, restricted: true, location: "The Desktop" })).toBe("⛔ restricted");
  });

  it("a restricted guest's sub-line doesn't repeat the title's ⛔", () => {
    expect(titleBarSub("⛔ restricted", "restricted")).toBe("restricted");
    expect(titleBarSub("🔒 captured", "alarm")).toBe("🔒 captured");
    expect(titleBarSub("📍 Hall")).toBe("📍 Hall");
    const out = renderToStaticMarkup(createElement(TitleBar, { objectives: [o("a", "Go to the Internet")], fallback: "", onOpen: () => {}, sub: "⛔ restricted", tone: "restricted" }));
    expect(out.match(/⛔/gu)?.length).toBe(1);
  });

  it("the sub-line is white on the alarm and restricted captions (4.5:1 at both gradient ends)", () => {
    const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8").replace(/\s+/gu, " ");
    expect(css).toContain(".title-bar.alarm .title-bar-sub, .title-bar.restricted .title-bar-sub { color: var(--title-ink); }");
  });
});
