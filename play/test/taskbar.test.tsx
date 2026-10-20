//! Wave 13 (chrome): the guest taskbar — ⊞ Start, 🎟 Pass (primary), 📷
//! Scan, the tray with its live-dot edge — and the width and keyboard
//! rules it lives by.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Taskbar, TrayItem, taskbarButtonClass } from "../src/chrome/taskbar.tsx";
import { isTextEntry, KEYBOARD_REST, keyboardIsOpen, keyboardStep } from "../src/chrome/keyboard.ts";
import { FrameLayout } from "../src/guest/app.tsx";
import { guestTaskbarButtons } from "../src/guest/frame.tsx";
import type { ObjectiveView } from "../src/types.ts";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
// chrome.css with its whitespace folded, so a reformat never fails a rule check.
const chrome = readFileSync(new URL("../src/css/chrome.css", import.meta.url), "utf8").replace(/\s+/gu, " ");
const app = readFileSync(new URL("../src/guest/app.tsx", import.meta.url), "utf8");

/** The body of the first `@media (max-width: <px>px)` block in chrome.css. */
function narrow(px: number): string {
  const at = chrome.indexOf(`@media (max-width: ${px}px)`);
  expect(at, `chrome.css has a ${px} px block`).toBeGreaterThan(-1);
  return chrome.slice(at, chrome.indexOf(" } }", at) + 4);
}

const objective = (buttons: string[]): ObjectiveView => ({ id: "o", title: "Get scanned", brief: "", checklist: [], buttons, act: null });

describe("the guest taskbar", () => {
  it("Pass is the primary button, Scan next to it; both carry their tour anchors", () => {
    const buttons = guestTaskbarButtons({ now: null, pass: () => {}, scan: () => {} });
    expect(buttons.map((b) => [b.id, b.icon, b.primary === true, b.tour])).toEqual([
      ["pass", "🎟", true, "pass"],
      ["scan", "📷", false, "scan"],
    ]);
    const out = html(createElement(Taskbar, { start: [], buttons }));
    expect(out).toContain('data-tour="start"');
    expect(out).toContain('aria-label="Pass"');
    expect(out).toContain('aria-label="Scan"');
    expect(out).toContain('class="w95-btn taskbar-btn primary"');
  });

  it("the objective's buttons light the matching taskbar button", () => {
    const lit = guestTaskbarButtons({ now: objective(["scan", "greet"]), pass: () => {}, scan: () => {} });
    expect(lit.map((b) => b.active)).toEqual([false, true]);
    expect(taskbarButtonClass(lit[1]!)).toBe("w95-btn taskbar-btn attn");
    expect(taskbarButtonClass({ primary: true })).toBe("w95-btn taskbar-btn primary");
    expect(html(createElement(Taskbar, { start: [], buttons: lit }))).toContain('class="w95-btn taskbar-btn attn"');
  });

  it("the tray's leading edge is the live dot, never an item", () => {
    for (const conn of ["live", "reconnecting", "offline"] as const) {
      const out = html(createElement(Taskbar, { start: [], buttons: [], tray: createElement(TrayItem, { text: "1" }), conn }));
      expect(out).toContain(`class="taskbar-tray ${conn}"`);
    }
    expect(chrome).toMatch(/\.taskbar-tray\.live::before \{ background: var\(--live\); \}/u);
  });

  it("at 360 px: icon-only buttons except the primary, at most 3 tray items", () => {
    const block = narrow(399);
    expect(block).toContain(".taskbar-btn:not(.primary):not(.taskbar-start) .taskbar-label { display: none; }");
    expect(block).toContain(".taskbar-tray > :nth-child(n+4) { display: none; }");
    expect(narrow(379)).toContain(".taskbar-start .taskbar-label { display: none; }");
    // The label stays for screen readers at any width.
    const out = html(createElement(Taskbar, { start: [], buttons: guestTaskbarButtons({ now: null, pass: () => {}, scan: () => {} }) }));
    expect(out).toContain('aria-label="Scan"');
  });

  it("every taskbar control reaches the 44 px floor", () => {
    // The bevel is 38 px; the hit area reaches the bar's edges (3 px each side).
    expect(chrome).toMatch(/\.taskbar-btn \{[^}]*min-height: 38px/u);
    expect(chrome).toContain(".taskbar-btn::after { content: \"\"; position: absolute; top: -3px; bottom: -3px;");
    expect(chrome).toMatch(/min-height: calc\(var\(--taskbar-h\) \+ var\(--safe-bottom\)\)/u);
    expect(chrome).toContain("button.tray-item::after");
  });

  it("the Start menu fits the visible height on iOS: dvh after its vh fallback", () => {
    const rule = chrome.slice(chrome.indexOf(".start-menu {"), chrome.indexOf("}", chrome.indexOf(".start-menu {")));
    const vh = rule.indexOf("max-height: calc(100vh");
    const dvh = rule.indexOf("max-height: calc(100dvh");
    expect(vh).toBeGreaterThan(-1);
    expect(dvh).toBeGreaterThan(vh);
  });

  it("the keyboard rule: the frame drops the taskbar while the keyboard is open, and brings it back", () => {
    const frame = (typing: boolean) =>
      html(
        createElement(FrameLayout, {
          className: "root app-frame",
          typing,
          head: createElement("header", { className: "title-bar" }),
          taskbar: createElement(Taskbar, { start: [], buttons: guestTaskbarButtons({ now: null, pass: () => {}, scan: () => {} }) }),
        }),
      );
    expect(frame(false)).toContain('aria-label="Taskbar"');
    expect(frame(false).indexOf("title-bar")).toBeLessThan(frame(false).indexOf("taskbar"));
    expect(frame(true)).not.toContain('aria-label="Taskbar"');
    expect(frame(true)).toContain('class="title-bar"');
    // What decides `typing`: a focused composer once the viewport shows the
    // keyboard, until the keyboard is seen to close.
    const focused = keyboardStep(KEYBOARD_REST, { kind: "focus", text: isTextEntry({ tagName: "TEXTAREA" } as Element), height: 800 });
    const typed = keyboardStep(focused, { kind: "resize", height: 480 });
    expect(keyboardIsOpen(typed)).toBe(true);
    expect(keyboardIsOpen(keyboardStep(typed, { kind: "focus", text: false, height: 800 }))).toBe(false);
  });

  it("the guest frame is [title bar][pins][shell][taskbar] on every screen", () => {
    expect(app).toMatch(/className=\{`root app-frame/u);
    const head = app.slice(app.indexOf("head={"), app.indexOf("</FrameRoot>"));
    const order = ["<MomentsLayer />", "<NowBar", "<PinnedRail", "<Shell"].map((tag) => head.indexOf(tag));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The old identity card, the countdown strip and the alerts bar are gone from the frame.
    expect(app).not.toContain("<IdentityCard");
    expect(app).not.toContain("<CountdownStrip");
    expect(app).not.toContain("<PushCard");
  });
});
