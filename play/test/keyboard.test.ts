//! Wave 13 (chrome): the keyboard rule. The taskbar steps aside while a
//! text field in the frame has focus, and comes back when the phone's
//! keyboard closes with the field still focused (Android's back key).

import { describe, expect, it } from "vitest";
import { isTextEntry, KEYBOARD_MIN_PX, KEYBOARD_REST, keyboardIsOpen, keyboardStep, noOnScreenKeyboard, type KeyboardInput, type KeyboardState } from "../src/chrome/keyboard.ts";

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
  it("focusing the composer hides the taskbar once the keyboard is up; blurring brings it back", () => {
    const focused = run([{ kind: "focus", text: true, height: 800 }]);
    expect(keyboardIsOpen(focused)).toBe(false); // the viewport hasn't shown a keyboard yet
    const typing = keyboardStep(focused, { kind: "resize", height: 480 });
    expect(keyboardIsOpen(typing)).toBe(true);
    expect(keyboardIsOpen(keyboardStep(typing, { kind: "focus", text: false, height: 480 }))).toBe(false);
  });

  it("a focused field that never shrinks the viewport is no keyboard (a hardware one): the taskbar stays", () => {
    const s = run([
      { kind: "focus", text: true, height: 800 },
      { kind: "resize", height: 790 },
    ]);
    expect(keyboardIsOpen(s)).toBe(false);
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
      { kind: "resize", height: 480 },
      { kind: "resize", height: 480 + KEYBOARD_MIN_PX - 1 },
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

describe("a tap in the footer never moves its own target (the lost first tap)", () => {
  const up = run([
    { kind: "focus", text: true, height: 800 },
    { kind: "resize", height: 480 },
  ]);

  it("a pointer down in the footer holds the open layout through the focus-out, until its click lands", () => {
    // pointerdown on File it → the field blurs (iOS: focus goes nowhere) → the click → let go
    let s = keyboardStep(up, { kind: "hold", on: true });
    s = keyboardStep(s, { kind: "focus", text: false, height: 480 });
    expect(keyboardIsOpen(s)).toBe(true); // the button stays where the finger is
    s = keyboardStep(s, { kind: "hold", on: false });
    s = keyboardStep(s, { kind: "focus", text: false, height: 800 }); // the read after the click
    expect(keyboardIsOpen(s)).toBe(false);
  });

  it("focus moving to a button in the field's own footer keeps the layout; the viewport growing back releases it", () => {
    let s = keyboardStep(up, { kind: "focus", text: false, height: 480, foot: true });
    expect(keyboardIsOpen(s)).toBe(true);
    s = keyboardStep(s, { kind: "resize", height: 800 }); // Android closes the keyboard
    expect(keyboardIsOpen(s)).toBe(false);
  });

  it("a hold only starts while the keyboard is open (a tap with no keyboard changes nothing)", () => {
    expect(keyboardStep(KEYBOARD_REST, { kind: "hold", on: true })).toBe(KEYBOARD_REST);
    const s = keyboardStep(keyboardStep(up, { kind: "hold", on: true }), { kind: "resize", height: 800 });
    expect([keyboardIsOpen(s), s.held]).toEqual([false, false]);
  });

  it("no on-screen keyboard (a fine pointer that hovers): the rule is off", () => {
    expect(noOnScreenKeyboard((q) => q === "(hover: hover) and (pointer: fine)")).toBe(true);
    expect(noOnScreenKeyboard(() => false)).toBe(false);
    expect(noOnScreenKeyboard(null)).toBe(false);
  });
});
