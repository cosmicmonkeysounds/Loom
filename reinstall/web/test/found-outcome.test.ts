import { describe, expect, it } from "vitest";
import { findCopy, findFlash, findOutcome } from "../src/game/hud.ts";

// What a judged find means on the tablet: the server's `released` is the
// only proof of a release (wave 9, T3-reinstall-01 / R2-diff-clients-02).
describe("findOutcome — the tablet celebrates only a real release", () => {
  it("released → the reinstallation is complete", () => {
    expect(findOutcome({ released: true, captured: false }, true)).toBe("released");
    expect(findOutcome({ released: true }, true)).toBe("released");
  });

  it("captured and not released (the banishment) → refused, whatever the walk began with", () => {
    expect(findOutcome({ released: false, captured: true }, true)).toBe("refused");
    // An older server that doesn't say: the captured state at begin decides.
    expect(findOutcome({ released: false, captured: null }, true)).toBe("refused");
    expect(findOutcome({ released: false }, true)).toBe("refused");
  });

  it("a free program (never captured, or freed mid-walk) found Gerald", () => {
    expect(findOutcome({ released: false, captured: false }, false)).toBe("found");
    expect(findOutcome({ released: false }, false)).toBe("found");
    // Captured at begin, zipped out mid-walk: the server says captured false.
    expect(findOutcome({ released: false, captured: false }, true)).toBe("found");
  });

  it("the refused copy never reads as a release, and lays no egg", () => {
    const copy = findCopy("refused", "Microsoft Excel");
    expect(copy.heading).toBe("GERALD CAN'T HELP");
    expect(copy.egg).toBe(false);
    for (const text of [copy.title, copy.heading, copy.line, copy.progress, findFlash("refused", "Microsoft Excel").text]) {
      expect(text).not.toMatch(/reinstalled|reinstallation complete|releases you|golden egg|copying files/i);
    }
    expect(findFlash("refused", "Microsoft Excel").tone).toBe("bad");
  });

  it("a release and a plain find keep their copy", () => {
    expect(findCopy("released", "Ada")).toMatchObject({ heading: "REINSTALLATION COMPLETE", egg: true });
    expect(findCopy("released", "Ada").line).toContain("The Internet releases you.");
    expect(findCopy("found", "Ada")).toMatchObject({ heading: "YOU FOUND GERALD", egg: true });
    expect(findFlash("released", "Ada")).toEqual({ text: "Ada — reinstallation complete.", tone: "good" });
    expect(findFlash("found", "Ada")).toEqual({ text: "Ada found Gerald.", tone: "good" });
  });
});
