import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AssembleFace, BingoBall, BottleTable, Chevrons, March, Redacted, WallCard } from "../src/cutscene/kit/tv1-parts.tsx";

beforeAll(() => {
  const error = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("useLayoutEffect")) return;
    error(...a);
  });
});

const html = (el: (p: any) => unknown, p: Record<string, unknown>) => renderToStaticMarkup(createElement(el as never, p as never));

describe("tv1 parts", () => {
  it("the wall card types its title, then its lines, and keeps its backdrop moving", () => {
    const at = (t: number) => html(WallCard, { t, title: "TIME IS UP", lines: ["Back to the Desktop."], reduced: false, footer: "★ GO ★" });
    expect(at(0)).not.toContain(">TIME IS UP<");
    expect(at(5000)).toContain("TIME IS UP");
    expect(at(5000)).toContain("Back to the Desktop.");
    expect(at(5000)).not.toBe(at(6000)); // the stripes drift
    // Reduced motion: the stripes hold still.
    const stripes = (t: number) => /a1w-stripes" style="([^"]*)"/u.exec(html(WallCard, { t, title: "A", reduced: true }))![1];
    expect(stripes(5000)).toBe(stripes(6000));
  });

  it("the bottle's table lifts and labels only the lit seat", () => {
    const out = html(BottleTable, { t: 1000, angle: 30, lit: 1, name: "Winamp", reduced: false });
    expect(out.match(/a1-seat on/gu)?.length).toBe(1);
    expect(out).toContain("Winamp");
    expect(html(BottleTable, { t: 1000, angle: 30, lit: null, name: null, reduced: false })).not.toContain("a1-seat-label");
    expect(out).toContain("rotate(30.00deg)");
  });

  it("the face assembles in order: outline, skin, eyes, then the mouth", () => {
    const at = (t: number) => html(AssembleFace, { t, start: 0, reduced: false });
    expect(at(0)).toMatch(/stroke-dasharray="0 /u); // nothing traced yet
    expect(at(1300)).toMatch(/stroke-dasharray="804/u); // the outline closed (2π·128 ≈ 804)
    expect(at(1000)).toMatch(/scale\(0\.000\)/u); // the eyes not yet in
    expect(at(5000)).toContain('fill="var(--mouth, #04110a)"'); // the mouth filled at the end
  });

  it("the marchers, chevrons, balls and redactions are pictures of t", () => {
    expect(html(March, { t: 1234, reduced: false })).toBe(html(March, { t: 1234, reduced: false }));
    expect(html(Chevrons, { t: 1234, reduced: false })).not.toBe(html(Chevrons, { t: 1834, reduced: false }));
    expect(html(BingoBall, { label: "WORD PRO-CESSOR" })).toContain(">WORD PRO<");
    expect(html(Redacted, { t: 99_999, seed: 3, reduced: false })).toBe(html(Redacted, { t: 99_999, seed: 3, reduced: false }));
    expect(html(Redacted, { t: 0, seed: 3, reduced: false })).toMatch(/scaleX\(0\.000\)/u);
  });
});
