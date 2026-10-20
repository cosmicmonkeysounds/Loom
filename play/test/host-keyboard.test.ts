//! Typing in the host console (wave 13, the live check's blocker): a field
//! in the console hides only the NEXT bar, never the drawer or the field,
//! and the drawer sits above the phone's keyboard; a balloon never covers
//! the open console.

import { describe, expect, it } from "vitest";
import { balloonClearance, BALLOON_ROOM_MIN, dockKeyboard, keyboardFit, revealsField, sheetCloseIn } from "../src/host/viewport.ts";
import { keyboardIsOpen, keyboardStep, KEYBOARD_REST, type KeyboardState } from "../src/chrome/keyboard.ts";

describe("typing in the host console (the blocker)", () => {
  it("a field in the room hides the dock; a field in the console hides only the NEXT bar", () => {
    expect(dockKeyboard(false, false, false)).toEqual({ render: true, bar: true });
    expect(dockKeyboard(true, false, false)).toEqual({ render: false, bar: false }); // the composer
    expect(dockKeyboard(true, true, true)).toEqual({ render: true, bar: false }); // Announce, in the open drawer
    expect(dockKeyboard(true, true, false)).toEqual({ render: true, bar: false }); // the award picker's value box, drawer shut
    expect(dockKeyboard(true, false, true)).toEqual({ render: true, bar: true });
  });

  it("the real sequence: tap the Announce box, the keyboard comes up, type, the keyboard stays", () => {
    // Focus lands on the drawer's textarea (in the dock): the frame's rule
    // says keyboard, the dock's says inside — the drawer stays mounted, so
    // focus never falls to <body> and the frame's rule never flips back.
    let s: KeyboardState = keyboardStep(KEYBOARD_REST, { kind: "focus", text: false, height: 844 });
    s = keyboardStep(s, { kind: "focus", text: true, height: 844 });
    let k = dockKeyboard(keyboardIsOpen(s), true, true);
    expect(k).toEqual({ render: true, bar: false });
    // The keyboard slides up (the visual viewport shrinks), the field keeps focus.
    s = keyboardStep(s, { kind: "resize", height: 508 });
    k = dockKeyboard(keyboardIsOpen(s), true, true);
    expect(k.render).toBe(true);
    // Typing resizes nothing: still open, still rendered.
    s = keyboardStep(s, { kind: "resize", height: 508 });
    expect(keyboardIsOpen(s)).toBe(true);
    expect(dockKeyboard(keyboardIsOpen(s), true, true).render).toBe(true);
    // Send: focus leaves the field, the bar comes back.
    s = keyboardStep(s, { kind: "focus", text: false, height: 508 });
    expect(dockKeyboard(keyboardIsOpen(s), false, true)).toEqual({ render: true, bar: true });
  });

  it("the drawer lifts by what the keyboard covers and fits the visible height", () => {
    // Dock top at 790 (a 844 px phone, the taskbar gone), keyboard up: the
    // visible viewport is 0–508.
    expect(keyboardFit(790, 0, 508)).toEqual({ lift: 282, height: 500 });
    // iOS panned the page by 120: what is visible is 120–628.
    expect(keyboardFit(790, 120, 508)).toEqual({ lift: 162, height: 500 });
    // No keyboard (a desktop, a Players pane): nothing moves.
    expect(keyboardFit(790, 0, 844)).toBeNull();
  });

  it("hiding the NEXT bar and the taskbar never slides the drawer: it keeps its bottom", () => {
    // At rest the dock's top is 692 (bar 52 + taskbar 44 + 56 px of edge
    // above an 844 px screen, say); typing hides both, the dock drops to 790.
    expect(keyboardFit(790, 0, 844, 692)).toEqual({ lift: 98, height: null });
    // And with the keyboard up the drawer still rises to the keyboard's top.
    expect(keyboardFit(790, 0, 508, 692)).toEqual({ lift: 282, height: 500 });
    // Nothing hidden, no keyboard: nothing to do.
    expect(keyboardFit(692, 0, 844, 692)).toBeNull();
  });
});


describe("a balloon while the console is open", () => {
  it("phone: above the drawer's top edge; tight when there is little room", () => {
    expect(balloonClearance({ top: 0, bottom: 844, right: 390 }, { top: 240, left: 0 }, false)).toEqual({ mode: "above", lift: 604, room: 212, right: 390 });
    const tight = balloonClearance({ top: 0, bottom: 667, right: 375 }, { top: 120, left: 0 }, false);
    expect(tight.mode).toBe("tight");
    expect(tight.room).toBeLessThan(BALLOON_ROOM_MIN);
  });
  it("wide: beside the drawer, to its left", () => {
    expect(balloonClearance({ top: 0, bottom: 800, right: 1280 }, { top: 120, left: 752 }, true)).toMatchObject({ mode: "beside", right: 528 });
  });
});

describe("Escape over a sheet in the console", () => {
  it("finds the open sheet's close button, else nothing (the console closes)", () => {
    const x = { tag: "sheet-x" } as unknown as HTMLElement;
    const asked: string[] = [];
    const dock = { querySelector: (sel: string) => (asked.push(sel), x) } as unknown as Pick<ParentNode, "querySelector">;
    expect(sheetCloseIn(dock)).toBe(x);
    expect(asked).toEqual([".sheet-backdrop .sheet-x"]);
    expect(sheetCloseIn({ querySelector: () => null } as unknown as Pick<ParentNode, "querySelector">)).toBeNull();
    expect(sheetCloseIn(null)).toBeNull();
  });
});

describe("the focused field is scrolled into view", () => {
  it("when typing starts and when the keyboard moves, never on a re-render or a viewport scroll", () => {
    expect(revealsField("start")).toBe(true);
    expect(revealsField("resize")).toBe(true);
    // The console re-renders every second: a host who scrolled the drawer
    // away from the field (Announce, the filter) stays where they scrolled.
    expect(revealsField("render")).toBe(false);
    expect(revealsField("scroll")).toBe(false);
  });
});
