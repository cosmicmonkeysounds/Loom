//! Wave 13 (chrome): the keyboard rule. The taskbar steps aside while a
//! text field in the frame has focus, and comes back when the phone's
//! keyboard closes with the field still focused (Android's back key).

import { describe, expect, it } from "vitest";
import { isTextEntry, KEYBOARD_MIN_PX, KEYBOARD_REST, keyboardIsOpen, keyboardStep, type KeyboardInput, type KeyboardState } from "../src/chrome/keyboard.ts";

const run = (events: KeyboardInput[], from: KeyboardState = KEYBOARD_REST) => events.reduce(keyboardStep, from);
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as Element;

describe("isTextEntry", () => {
  it("text fields and textareas open the keyboard; buttons and checkboxes don't", () => {
    expect(isTextEntry(el("TEXTAREA"))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTextEntry(el("INPUT", { type: "Checkbox" }))).toBe(false);
    expect(isTextEntry(el("INPUT", { type: "range" }))).toBe(false);
    expect(isTextEntry(el("BUTTON"))).toBe(false);
    expect(isTextEntry(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTextEntry(el("DIV"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});

describe("the keyboard rule", () => {
  it("focusing the composer hides the taskbar at once; blurring brings it back", () => {
    const typing = run([{ kind: "focus", text: true, height: 800 }]);
    expect(keyboardIsOpen(typing)).toBe(true);
    expect(keyboardIsOpen(keyboardStep(typing, { kind: "focus", text: false, height: 800 }))).toBe(false);
  });

  it("the keyboard closing with the field still focused (Android back) brings the taskbar back", () => {
    const up = run([
      { kind: "focus", text: true, height: 800 },
      { kind: "resize", height: 480 },
    ]);
    expect(keyboardIsOpen(up)).toBe(true);
    const down = keyboardStep(up, { kind: "resize", height: 790 });
    expect(keyboardIsOpen(down)).toBe(false);
    // Tapping the field again: the keyboard rises, the taskbar steps aside.
    expect(keyboardIsOpen(keyboardStep(down, { kind: "resize", height: 480 }))).toBe(true);
  });

  it("the browser's toolbars moving the viewport a little is not the keyboard", () => {
    const s = run([
      { kind: "focus", text: true, height: 800 },
      { kind: "resize", height: 800 - KEYBOARD_MIN_PX + 1 },
      { kind: "resize", height: 800 },
    ]);
    expect(keyboardIsOpen(s)).toBe(true);
  });

  it("moving between fields with the keyboard up keeps the height at rest", () => {
    const s = run([
      { kind: "focus", text: true, height: 800 },
      { kind: "resize", height: 480 },
      { kind: "focus", text: true, height: 480 },
      { kind: "resize", height: 800 },
    ]);
    expect(keyboardIsOpen(s)).toBe(false);
  });

  it("no visualViewport: focus alone decides", () => {
    const s = run([
      { kind: "focus", text: true, height: null },
      { kind: "resize", height: null },
    ]);
    expect(keyboardIsOpen(s)).toBe(true);
  });
});
