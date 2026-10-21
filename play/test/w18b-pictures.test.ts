//! Wave 18b (R19): Trabolta's two pictures, shipped by the play app
//! (`public/pictures/` → `dist/pictures/`, which the server serves for an
//! authored `avatar: picture:<file>`): a green grinning face, and a
//! broken-image thumbnail while most programs distrust him.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCAL_PICTURE_FILE } from "../../core/server/avatars.ts";

const FILES = ["trabolta.svg", "trabolta-broken.svg"] as const;
const read = (f: string) => readFileSync(new URL(`../public/pictures/${f}`, import.meta.url), "utf8");
/** The terminal face's palette (`terminal/src/face/Face.tsx`). */
const PALETTE = ["#9cf5b8", "#17c45a", "#3dff7a", "#04110a", "#e9fff1"];

describe("Trabolta's pictures", () => {
  it("are names the server's picture route serves", () => {
    for (const f of FILES) expect(LOCAL_PICTURE_FILE.test(f), f).toBe(true);
  });

  it("are plain, sized SVGs: no script, no foreignObject, no link out", () => {
    for (const f of FILES) {
      const svg = read(f);
      expect(svg.startsWith("<svg "), f).toBe(true);
      expect(svg, f).toMatch(/<svg [^>]*width="256" height="256" viewBox="0 0 256 256"/u);
      expect(svg, f).not.toMatch(/<script|foreignObject|href|on[a-z]+=|@import|url\((?!#)/iu);
    }
  });

  it("are drawn in the face's palette only (literal colours, no CSS variables)", () => {
    for (const f of FILES) {
      const svg = read(f);
      const colours = new Set((svg.match(/#[0-9a-f]{6}\b/giu) ?? []).map((c) => c.toLowerCase()));
      expect([...colours].every((c) => PALETTE.includes(c)), `${f}: ${[...colours].join(" ")}`).toBe(true);
      expect(svg, f).not.toContain("var(");
    }
    // The face: its skin gradient and the ring.
    expect(read("trabolta.svg")).toMatch(/stop-color="#9cf5b8"[\s\S]*stop-color="#17c45a"/u);
  });
});
