//! The run reset (wave 59): the hold, what counts as typing, and the page's
//! promise that a line said in the game sits over the rest of the screen, the
//! void's scare aside.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { HoldMeter, keyTarget, movedOverReset, RESET_DONE, RESET_HOLD_MS, typingIn } from "../src/game/reset.ts";

describe("HoldMeter", () => {
  it("fills over five seconds, and letting go empties it", () => {
    expect(RESET_HOLD_MS).toBe(5000);
    const m = new HoldMeter();
    expect(m.update(false, 0)).toBe(0);
    expect(m.update(true, 100)).toBe(0);
    expect(m.update(true, 2600)).toBe(0.5);
    expect(m.update(false, 2700)).toBe(0);
    expect(m.update(true, 2800)).toBe(0);
    expect(m.update(true, 2800 + 4999)).toBeLessThan(1);
    expect(m.update(true, 2800 + 5000)).toBe(1);
    expect(m.update(true, 2800 + 9000)).toBe(1);
  });

  it("once spent it does nothing until it has been let go", () => {
    const m = new HoldMeter(1000);
    m.update(true, 0);
    expect(m.update(true, 1000)).toBe(1);
    m.spend();
    expect(m.update(true, 1100)).toBe(0);
    expect(m.update(true, 9000)).toBe(0);
    m.update(false, 9100);
    m.update(true, 9200);
    expect(m.update(true, 10200)).toBe(1);
  });
});

describe("typing", () => {
  it("is a field, however the event reached the window", () => {
    expect(typingIn({ tagName: "INPUT" })).toBe(true);
    expect(typingIn({ tagName: "TEXTAREA" })).toBe(true);
    expect(typingIn({ tagName: "SELECT" })).toBe(true);
    expect(typingIn({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(typingIn({ tagName: "CANVAS" })).toBe(false);
    expect(typingIn(null)).toBe(false);
  });

  it("reads through the tent laptop's shadow root", () => {
    const input = { tagName: "INPUT" };
    const host = { tagName: "DIV" };
    expect(typingIn(keyTarget({ target: host as unknown as EventTarget, composedPath: () => [input as unknown as EventTarget, host as unknown as EventTarget] }))).toBe(true);
    expect(typingIn(keyTarget({ target: input as unknown as EventTarget }))).toBe(true);
  });

  it("is only a field that takes text: ⚙ Graphics leaves a radio holding the focus", () => {
    for (const type of ["radio", "checkbox", "range", "button", "submit", "reset", "color", "file", "image"]) {
      expect(typingIn({ tagName: "INPUT", type })).toBe(false);
    }
    for (const type of ["text", "search", "password", "number", "email"]) {
      expect(typingIn({ tagName: "INPUT", type })).toBe(true);
    }
    const radio = { tagName: "INPUT", type: "radio" };
    const host = { tagName: "DIV" };
    expect(typingIn(keyTarget({ target: host as unknown as EventTarget, composedPath: () => [radio as unknown as EventTarget, host as unknown as EventTarget] }))).toBe(false);
  });
});

describe("Gerald moving over the reset's notice", () => {
  it("adds to it, so the reset's own word is not lost", () => {
    expect(movedOverReset(RESET_DONE, "Gerald moved.")).toBe(`${RESET_DONE} Gerald moved.`);
  });

  it("is the plain line over anything else", () => {
    expect(movedOverReset(null, "Gerald moved.")).toBe("Gerald moved.");
    expect(movedOverReset("The house was remapped.", "Gerald moved.")).toBe("Gerald moved.");
  });
});

describe("the play screen's stacking", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  const z = (selector: string): number => {
    const rule = new RegExp(`(?:^|\\n)${selector.replace(".", "\\.")} \\{([^}]*)\\}`).exec(css);
    return Number(/z-index:\s*(\d+)/.exec(rule?.[1] ?? "")?.[1] ?? 0);
  };

  const lines = [".hud-caption", ".talk-window", ".hud-notice", ".hud-reset"];

  it("puts the lines said in the game over everything else there but the scare", () => {
    const all = [...css.matchAll(/z-index:\s*(\d+)/g)].map((m) => Number(m[1]));
    const scare = z(".scare");
    const next = Math.max(...all.filter((n) => n !== scare));
    for (const s of lines) expect(z(s)).toBe(next);
  });

  it("leaves the void's scare on top of them: a notice left up must not sit on his face", () => {
    for (const s of lines) expect(z(".scare")).toBeGreaterThan(z(s));
  });
});
