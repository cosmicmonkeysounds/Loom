//! Wave 13 (chrome): the NOW title bar — the first live objective, else the
//! open room, else the story; the tone of a captured / restricted guest.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PAUSED_CLASS, PAUSED_WORD, PausedTag, TITLE_CHEVRON, TitleBar, flashLine, moreObjectives, pausedClass, pausedTitle, titleBarSub, titleBarText, titleFallback } from "../src/chrome/title-bar.tsx";
import { nowFlashOf, whereLine } from "../src/guest/frame.tsx";
import type { ObjectiveView } from "../src/types.ts";

const o = (id: string, title: string): ObjectiveView => ({ id, title, brief: "", checklist: [], buttons: [], act: null });

describe("the NOW title bar", () => {
  it("names the first live objective, else falls back", () => {
    expect(titleBarText([o("a", "Get scanned"), o("b", "Find Gerald")], "Lobby")).toEqual({ title: "▣ NOW: Get scanned\u00a0›", now: o("a", "Get scanned") });
    expect(titleBarText([], "The Desktop").title).toBe("The Desktop");
    expect(titleBarText(undefined, "Trapped in the Internet")).toEqual({ title: "Trapped in the Internet", now: null });
  });

  it("with no objective: the open room's name, else the story's title (D4)", () => {
    expect(titleFallback("The Steam Room", "Trapped in the Internet")).toBe("The Steam Room");
    expect(titleFallback(null, "Trapped in the Internet")).toBe("Trapped in the Internet");
    expect(titleFallback("", "Trapped in the Internet")).toBe("Trapped in the Internet");
    expect(titleFallback(undefined, null)).toBe("");
  });

  it("captured and restricted mark the title with ⛔ and tint the bar", () => {
    expect(titleBarText([o("a", "Run")], "x", "alarm").title).toBe("⛔ ▣ NOW: Run\u00a0›");
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
    expect(out).toContain("📍 Hall · +2 objectives");
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

describe("the NOW bar's states (fguest)", () => {
  it("a paused show greys the caption and says (Paused), the Win95 way", () => {
    expect(titleBarText([o("a", "Hunt")], "x", undefined, true).title).toBe("▣ NOW: Hunt (Paused)\u00a0›");
    expect(titleBarText([], "Lobby", undefined, true).title).toBe("Lobby (Paused)");
    const html = renderToStaticMarkup(createElement(TitleBar, { objectives: [o("a", "Hunt")], fallback: "", onOpen: () => {}, paused: true }));
    expect(html).toContain('class="title-bar  paused title-bar-paused"');
  });

  it("the chevron is bound to the last word: a wrapped title never leaves › alone on its own line", () => {
    const { title } = titleBarText([o("a", "Go to the Desktop: a game is about to begin")], "x");
    expect(title.endsWith("begin\u00a0›")).toBe(true);
    expect(title).not.toMatch(/ ›$/u);
    expect(TITLE_CHEVRON).toBe("\u00a0›");
  });

  it("D3: what a booth's and a host's NOW bars use for a paused show", () => {
    expect(PAUSED_WORD).toBe("(Paused)");
    expect(pausedTitle("Hold the door", true)).toBe("Hold the door (Paused)");
    expect(pausedTitle("Hold the door", false)).toBe("Hold the door");
    expect(pausedClass("booth-now-bar", true)).toBe(`booth-now-bar ${PAUSED_CLASS}`);
    expect(pausedClass("booth-now-bar", false)).toBe("booth-now-bar");
    expect(renderToStaticMarkup(createElement(PausedTag, { paused: true }))).toBe('<span class="title-bar-paused-tag"> (Paused)</span>');
    expect(renderToStaticMarkup(createElement(PausedTag, { paused: false }))).toBe("");
    // The grey wins over a later lane file's bar background (doubled class) and whitens the sub-ink.
    const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.title-bar-paused\.title-bar-paused \{[^}]*background: linear-gradient\(90deg, var\(--paused-1\), var\(--paused-2\)\);[^}]*--on-bar: var\(--title-ink\)/u);
  });

  it("a loud objective flashes it open with its brief instead of a banner", () => {
    const flash = { id: "a", title: "Show your pass", brief: "Hold it up to an Antivirus." };
    const html = renderToStaticMarkup(createElement(TitleBar, { objectives: [o("a", "Show your pass")], fallback: "", onOpen: () => {}, sub: "📍 Hall", flash }));
    expect(html).toContain(" flash");
    expect(html).toContain('<span class="title-bar-news" role="status">Hold it up to an Antivirus.</span>');
    expect(html).not.toContain("📍 Hall"); // the brief takes the sub-line's place while it flashes
    expect(flashLine(flash, o("b", "Other"))).toBe("Show your pass — Hold it up to an Antivirus.");
    expect(nowFlashOf({ key: "o:a", text: "Show your pass\nHold it up." })).toEqual({ id: "a", title: "Show your pass", brief: "Hold it up." });
    expect(nowFlashOf({ key: "m:4", text: "x" })).toBeNull();
    expect(moreObjectives(1)).toBe("+1 objective");
  });

  it("the title wraps to two lines before any ellipsis", () => {
    const css = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.title-bar-title \{[^}]*-webkit-line-clamp: 2/u);
  });
});
