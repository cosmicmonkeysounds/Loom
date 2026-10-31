// Wave 18 (lane edges): the house's big wins on the TV and the wall
// terminals — a big house broadcast of a win (the Bingo Ribbon, an award)
// pops a short Win98 "Congratulations!" over whatever is up. The wire
// shape is read generously (the core lane builds it in parallel).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fakeState } from "../src/cutscene/fake.ts";
import { MomentQueue, componentFor, pickScene, sceneForMoment } from "../src/cutscene/pick.ts";
import { SCENES } from "../src/cutscene/registry.ts";
import { SCENES as HOUSE, WIN_GLYPHS, WIN_MS, isWinLine, splitWin, winnerName } from "../src/cutscene/scenes/house.tsx";
import type { SceneProps, SceneTarget } from "../src/cutscene/types.ts";
import { bigLineOf, type ScreenMoment } from "../src/screen.ts";

const T0 = 9_000_000;
const big = (seq: number, at: number, name: string, who: string | null = null): ScreenMoment => ({ seq, at, kind: "big", name, who, kept: false });

describe("which big lines are wins", () => {
  it("led by a win glyph", () => {
    expect(isWinLine("🎀 Encarta wins a Bingo Ribbon!")).toBe(true);
    expect(isWinLine("🏆 Most Trusted: Excel")).toBe(true);
    expect(isWinLine("🚨 CORRUPTION DETECTED")).toBe(false);
    expect(isWinLine("Encarta 🎀")).toBe(false);
  });

  it("splitWin takes the glyph off (and a variation selector)", () => {
    expect(splitWin("🎀 Encarta wins a Bingo Ribbon!")).toEqual({ glyph: "🎀", text: "Encarta wins a Bingo Ribbon!" });
    expect(splitWin("🏆️ Excel")).toEqual({ glyph: "🏆", text: "Excel" });
    expect(winnerName(" Encarta 95 ")).toBe("ENCARTA 95");
    expect(winnerName(null)).toBeNull();
  });
});

describe("the house_win scene", () => {
  it("is in the show's registry and matches a big win on the TV and the wall — never a non-win big line", () => {
    expect(SCENES.some((s) => s.id === "house_win")).toBe(true);
    for (const target of ["tv", "wall"] as SceneTarget[]) {
      for (const g of WIN_GLYPHS) expect(sceneForMoment(SCENES, big(1, T0, `${g} Encarta wins`), target)?.id).toBe("house_win");
      expect(sceneForMoment(SCENES, big(1, T0, "🚨 Norton found you"), target)).toBeNull();
    }
    // Only big moments: a signal that happens to start with 🎀 is not one.
    expect(sceneForMoment(SCENES, { seq: 1, at: T0, kind: "signal", name: "🎀 ribbon", who: null, kept: false }, "tv")).toBeNull();
  });

  it("pops over the slide that is up (the Bingo Time slide stays under it), then the slide goes on", () => {
    const queue = new MomentQueue();
    const s = fakeState({ now: T0, moments: [big(5, T0, "🎀 Encarta wins a Bingo Ribbon!", "Encarta")] });
    queue.update(s, T0, SCENES, "tv");
    const slide = { value: "bingo_time", seq: 2, at: T0 - 60_000 } as never;
    const pick = pickScene({ state: s, now: T0 + 1000, layers: { overlay: null, slide }, bare: false, target: "tv", scenes: SCENES, queue });
    expect(pick.top?.def.id).toBe("house_win");
    expect(pick.base).not.toBeNull();
    const later = pickScene({ state: s, now: T0 + WIN_MS + 10, layers: { overlay: null, slide }, bare: false, target: "tv", scenes: SCENES, queue });
    expect(later.top).toBeNull();
  });

  it("a pilot / room terminal (bare) shows nothing", () => {
    const queue = new MomentQueue();
    const s = fakeState({ now: T0, moments: [big(5, T0, "🎀 Encarta wins a Bingo Ribbon!")] });
    queue.update(s, T0, SCENES, "wall");
    expect(pickScene({ state: s, now: T0 + 500, layers: { overlay: null, slide: null }, bare: true, target: "wall", scenes: SCENES, queue }).top).toBeNull();
  });

  it("draws the winner and the line at its key frames on both targets, and under Reduce Motion", () => {
    const def = HOUSE[0]!;
    const sfx = Object.assign(vi.fn(() => true), {}) as unknown as SceneProps["sfx"];
    for (const target of ["tv", "wall"] as SceneTarget[]) {
      const C = componentFor(def, target)!;
      for (const reduced of [false, true]) {
        for (const t of [0, 400, 1500, 4000, 6000, WIN_MS - 50]) {
          const state = fakeState({ now: T0 });
          const html = renderToStaticMarkup(createElement(C, { t, at: T0, seq: 1, value: "🎀 Encarta wins a Bingo Ribbon! Everyone cheer!", state, night: state.night, who: "Encarta", target, sfx, done: () => {}, reduced }));
          if (t === WIN_MS - 50) {
            expect(html).not.toContain("Congratulations!"); // closed itself
            continue;
          }
          if (t >= 1500) {
            expect(html).toContain("ENCARTA");
            expect(html).toContain("Congratulations!");
            expect(html).toContain("🎀");
          }
          if (t >= 4000) expect(html).toContain("Encarta wins a Bingo Ribbon! Everyone cheer!");
        }
      }
    }
  });

  it("its CSS is old-tablet safe: no inset, no flex gap, no :has()", () => {
    const css = readFileSync(join(__dirname, "../src/cutscene/scenes/house.css"), "utf8");
    expect(css).not.toMatch(/\binset\s*:/u);
    expect(css).not.toMatch(/(^|[\s;{])gap\s*:/u);
    expect(css).not.toMatch(/:has\(/u);
  });
});

// The story's win broadcasts lead with a win glyph, so the screens can tell
// a win from any other big line (pinned against the show's own text).
describe("the story's wins lead with a win glyph", () => {
  const SHOW = join(__dirname, "../../core/examples/trapped-in-the-internet");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".loom") ? [join(dir, f)] : []));
  const story = files(SHOW)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it("the Bingo Floppy Disk's house line", () => {
    // Wave 18: the house cheer is a story rule's big broadcast that closes itself
    // (`broadcast "!!🎀 … won the Bingo Floppy Disk …" to everyone with close: 6s`).
    const ribbon = [...story.matchAll(/broadcast "(!![^"]*(?:won|wins) (?:the|a) Bingo Floppy Disk[^"]*)" to everyone with close: 6s/gu)].map((m) => bigLineOf(m[1]!));
    expect(ribbon.length).toBeGreaterThan(0);
    for (const line of ribbon) expect(isWinLine(line), line).toBe(true);
  });
});
