import { describe, expect, it } from "vitest";

import { crawl } from "../src/chat.tsx";
import { CAPTCHA_TILES, WIDGETS, captchaGrid, captchaPassed, widgetLabel } from "../src/widgets.tsx";

describe("captcha grid", () => {
  it("is deterministic per seed and always has 2–4 target squares", () => {
    for (let seed = 0; seed < 50; seed++) {
      const g = captchaGrid("traffic light", seed);
      expect(g.tiles).toHaveLength(9);
      expect(g.answer.length).toBeGreaterThanOrEqual(2);
      expect(g.answer.length).toBeLessThanOrEqual(4);
      for (let i = 0; i < 9; i++) expect(g.tiles[i] === "traffic light").toBe(g.answer.includes(i));
      expect(captchaGrid("traffic light", seed)).toEqual(g);
    }
    expect(captchaGrid("traffic light", 1)).not.toEqual(captchaGrid("traffic light", 2));
  });

  it("matches a target loosely and tolerates an unknown one (no right squares)", () => {
    expect(captchaGrid("Traffic Lights", 3).target).toBe("traffic light");
    const none = captchaGrid("a submarine", 3);
    expect(none.answer).toEqual([]);
    expect(none.tiles.every((t) => CAPTCHA_TILES.some((c) => c.key === t))).toBe(true);
  });

  it("passes only an exact selection", () => {
    const g = captchaGrid("bus", 7);
    expect(captchaPassed(g, g.answer)).toBe(true);
    expect(captchaPassed(g, [...g.answer].reverse())).toBe(true);
    expect(captchaPassed(g, [])).toBe(false);
    expect(captchaPassed(g, g.answer.slice(1))).toBe(false);
    const extra = [0, 1, 2, 3, 4, 5, 6, 7, 8].find((i) => !g.answer.includes(i))!;
    expect(captchaPassed(g, [...g.answer, extra])).toBe(false);
  });
});

describe("widget registry", () => {
  it("labels known kinds and falls back for unknown ones", () => {
    expect(WIDGETS["captcha"]?.answerable).toBe(true);
    expect(WIDGETS["image"]?.answerable).toBe(false);
    expect(widgetLabel({ kind: "captcha", text: "Pick the lights", params: {} })).toBe("🛡️ security check — Pick the lights");
    expect(widgetLabel({ kind: "minesweeper", text: "", params: {} })).toBe("🧩 minesweeper");
  });
});

describe("typewriter crawl policy", () => {
  it("never crawls the backlog, crawls a fresh line once, and resets per sign-in", () => {
    crawl.reset();
    expect(crawl.claim(5)).toBe(false); // nothing loaded yet: nothing is "new"
    crawl.loaded(10);
    expect(crawl.claim(10)).toBe(false);
    expect(crawl.claim(11)).toBe(true);
    expect(crawl.claim(11)).toBe(false); // re-opening the room must not replay it
    crawl.reset();
    crawl.loaded(-1);
    expect(crawl.claim(0)).toBe(true);
  });
});
