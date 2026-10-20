//! Wave 13 recheck: on a touch phone `:hover` sticks to the last thing
//! tapped (a room row stayed navy and read as the open room). The guest's
//! stylesheets hover only inside `@media (hover: hover)`; `:active` and
//! `:focus-visible` stay outside for touch and keyboard feedback.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["base", "themes", "chrome", "stream", "moments"] as const;

/** Selectors with `:hover` and the at-rules they sit in. */
function hoverRules(css: string): Array<{ sel: string; at: string[] }> {
  const out: Array<{ sel: string; at: string[] }> = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//gu, "")) {
    if (ch === "{") {
      stack.push(buf.trim());
      buf = "";
    } else if (ch === "}") {
      const sel = stack.pop() ?? "";
      if (!sel.startsWith("@") && sel.includes(":hover")) out.push({ sel, at: stack.filter((s) => s.startsWith("@")) });
      buf = "";
    } else if (ch === ";" && stack.length === 0) buf = "";
    else buf += ch;
  }
  return out;
}

describe("hover styles only where a pointer hovers", () => {
  for (const f of FILES) {
    it(`${f}.css: every :hover rule is inside @media (hover: hover)`, () => {
      const css = readFileSync(new URL(`../src/css/${f}.css`, import.meta.url), "utf8");
      // An armed story button and the open room keep their look on hover and off it alike (not a hover style).
      const bad = hoverRules(css).filter((r) => !r.at.some((a) => /@media\s*\(hover:\s*hover\)/u.test(a)) && !/\.(armed|active):hover/u.test(r.sel));
      expect(bad.map((r) => r.sel)).toEqual([]);
    });
  }

  it("the room row: the aol97 navy hover and the plain tint are both guarded", () => {
    const themes = hoverRules(readFileSync(new URL("../src/css/themes.css", import.meta.url), "utf8"));
    expect(themes.find((r) => r.sel.includes(".chrow:hover"))?.at.join(" ")).toMatch(/hover: hover/u);
    const base = hoverRules(readFileSync(new URL("../src/css/base.css", import.meta.url), "utf8")).filter((r) => r.sel === ".chrow:hover");
    expect(base.length).toBe(2);
    for (const r of base) expect(r.at[0]).toMatch(/hover: hover/u);
  });
});
