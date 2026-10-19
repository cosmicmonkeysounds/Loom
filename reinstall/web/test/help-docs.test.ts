//! The in-app help (`docs/help/`) against what the tablet really does — the
//! director and the guest read these mid-show, so a promise the game no
//! longer keeps is a bug. (The King's chess left the tablet in wave 11; the
//! help's King sections are rewritten by the docs pass, which re-pins them.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const help = (path: string): string => readFileSync(new URL(`../../../docs/help/${path}`, import.meta.url), "utf8").replace(/\s+/g, " ");

describe("the house docs say what the map page and the trail do", () => {
  const spec = readFileSync(new URL("../../../docs/loom-reinstall.md", import.meta.url), "utf8").replace(/\s+/g, " ");

  it("§1.2: a fallen King's door is routed over trailMap, not shut because \"no duck sits behind a guard\" (B17)", () => {
    expect(spec).not.toContain("no duck sits behind a guard");
    expect(spec).toContain("`trailMap`");
    expect(spec).toContain("a player can be behind his door");
  });

  it("a save's 409 is a changed map (a save or a variant switch), not only another director's save (B18)", () => {
    const map = help("authoring/39-house-map.md");
    expect(map).not.toContain("If another director saved since you loaded it");
    expect(map).toContain("If the map changed since you loaded it (a save or a variant switch)");
  });
});
