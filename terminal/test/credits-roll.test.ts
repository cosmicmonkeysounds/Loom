// Wave 44 (C8): the credits roll's timing — where the column is at `t`, when
// the end card comes, and Reduce Motion's pages.

import { describe, expect, it } from "vitest";
import { creditsRollMs, creditsRows, type CreditsRow } from "../../core/src/credits.ts";
import { fakeCredits } from "../src/cutscene/fake.ts";
import { CREDITS_FALLBACK_END, CREDITS_FALLBACK_TITLE, END_FADE_MS, PAGE_FADE_MS, PAGE_METRICS, ROLL_FADE_IN_MS, ROLL_START, creditsPages, endCard, pageFrame, rollFrame, rollMsOf, rowWeight } from "../src/cutscene/credits-roll.ts";

const VIEW = 1080;
const CONTENT = 3000;

describe("the roll (rollFrame)", () => {
  const ms = 30_000;

  it("starts with the title on screen, above the middle, and fades in", () => {
    const f = rollFrame(0, ms, CONTENT, VIEW);
    expect(f.y).toBeCloseTo(VIEW * ROLL_START);
    expect(f.phase).toBe("roll");
    expect(f.rollOpacity).toBe(0);
    expect(f.endOpacity).toBe(0);
    expect(rollFrame(ROLL_FADE_IN_MS, ms, CONTENT, VIEW).rollOpacity).toBe(1);
  });

  it("moves up at one speed and has every row gone at the roll's end", () => {
    const a = rollFrame(5000, ms, CONTENT, VIEW).y;
    const b = rollFrame(10_000, ms, CONTENT, VIEW).y;
    const c = rollFrame(15_000, ms, CONTENT, VIEW).y;
    expect(a).toBeGreaterThan(b);
    expect(a - b).toBeCloseTo(b - c);
    expect(rollFrame(ms, ms, CONTENT, VIEW).y).toBeCloseTo(-CONTENT);
    // Never past it: the column waits above the screen while the end card holds.
    expect(rollFrame(ms * 10, ms, CONTENT, VIEW).y).toBeCloseTo(-CONTENT);
  });

  it("is a pure function of t: a reload mid-roll lands on the same frame", () => {
    expect(rollFrame(12_345, ms, CONTENT, VIEW)).toEqual(rollFrame(12_345, ms, CONTENT, VIEW));
  });

  it("then fades the end card in and holds it for the rest of the slide", () => {
    expect(rollFrame(ms - 1, ms, CONTENT, VIEW).phase).toBe("roll");
    expect(rollFrame(ms, ms, CONTENT, VIEW).phase).toBe("end");
    const mid = rollFrame(ms + END_FADE_MS / 2, ms, CONTENT, VIEW);
    expect(mid.endOpacity).toBeCloseTo(0.5);
    expect(mid.rollOpacity).toBeCloseTo(0.5);
    const held = rollFrame(ms + 3_600_000, ms, CONTENT, VIEW);
    expect(held.endOpacity).toBe(1);
    expect(held.rollOpacity).toBe(0);
  });

  it("sits at its start until the column is measured", () => {
    expect(rollFrame(20_000, ms, 0, VIEW).y).toBeCloseTo(VIEW * ROLL_START);
  });

  it("takes creditsRollMs over the view's rows", () => {
    const rows = creditsRows(fakeCredits());
    expect(rollMsOf(rows)).toBe(creditsRollMs(rows.length));
    expect(rollMsOf([])).toBe(20_000);
  });
});

describe("the end card", () => {
  it("is the view's title and end lines", () => {
    const v = fakeCredits();
    expect(endCard(v)).toEqual({ title: v.title, lines: v.end });
  });

  it("falls back to the built-in words with no view, or a view with no end lines", () => {
    expect(endCard(null)).toEqual({ title: CREDITS_FALLBACK_TITLE, lines: CREDITS_FALLBACK_END });
    expect(CREDITS_FALLBACK_END).toEqual(["Thank you for playing."]);
    const v = { ...fakeCredits(), end: [] };
    expect(endCard(v)).toEqual({ title: v.title, lines: CREDITS_FALLBACK_END });
    expect(endCard({ ...v, title: "  " }).title).toBe(CREDITS_FALLBACK_TITLE);
  });
});

describe("Reduce Motion's pages", () => {
  const rows = creditsRows(fakeCredits(40));

  for (const target of ["tv", "wall"] as const) {
    const m = PAGE_METRICS[target];
    const pages = creditsPages(rows, m);

    it(`(${target}) keep every row but the gaps between pages, in order`, () => {
      const flat = pages.flat();
      expect(flat.filter((r) => r.kind !== "gap")).toEqual(rows.filter((r) => r.kind !== "gap"));
      expect(pages.length).toBeGreaterThan(1);
    });

    it(`(${target}) fit a page, never start with a gap, never end on a heading or a gap`, () => {
      for (const p of pages) {
        expect(p[0]!.kind).not.toBe("gap");
        expect(["heading", "gap"]).not.toContain(p[p.length - 1]!.kind);
        const used = p.reduce((n, r) => n + rowWeight(r, m), 0);
        if (p.length > 1) expect(used).toBeLessThanOrEqual(m.capacity + 1e-9);
      }
    });
  }

  it("give a row too big for a page a page of its own", () => {
    const huge: CreditsRow[] = [{ kind: "line", text: "x".repeat(2000) }, { kind: "line", text: "next" }];
    expect(creditsPages(huge, PAGE_METRICS.tv)).toEqual([[huge[0]], [huge[1]]]);
  });

  it("weigh a wall's stacked person as two lines and a long line by its wraps", () => {
    const p: CreditsRow = { kind: "person", role: "Clippy", name: "Alex" };
    expect(rowWeight(p, PAGE_METRICS.wall)).toBeCloseTo(1.8);
    expect(rowWeight(p, PAGE_METRICS.tv)).toBe(1);
    expect(rowWeight({ kind: "line", text: "y".repeat(PAGE_METRICS.tv.perLine * 2 + 1) }, PAGE_METRICS.tv)).toBe(3);
  });

  it("each page an equal share of the roll, cross-faded in, then the end card", () => {
    const ms = 30_000;
    expect(pageFrame(0, ms, 3)).toEqual({ index: 0, opacity: 0, phase: "roll", endOpacity: 0 });
    expect(pageFrame(PAGE_FADE_MS, ms, 3).opacity).toBe(1);
    expect(pageFrame(10_000, ms, 3).index).toBe(1);
    expect(pageFrame(29_999, ms, 3).index).toBe(2);
    const end = pageFrame(ms + END_FADE_MS, ms, 3);
    expect(end).toMatchObject({ index: 2, phase: "end", endOpacity: 1, opacity: 0 });
    expect(pageFrame(5000, ms, 0).index).toBe(0);
  });
});
