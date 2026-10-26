//! Wave 26 (T2, CONTRACTS C3): the story's first glitch takes the phone over
//! — once, live. Guests and player booths get ~6 s that swallows taps; a
//! host booth 2.5 s, look only; the director phone and Run → Players never.
//! A reload, a late reconnect or a restart replay never plays it.

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TAKEOVER_CAPTION, TAKEOVER_TEXT, TAKEOVER_WINDOWS, GlitchTakeover, cascadeAt } from "../src/moments/glitch-takeover.tsx";
import { TAKEOVER_FRESH_MS, TAKEOVER_LIGHT_MS, TAKEOVER_MS, takeoverDue } from "../src/moments/model.ts";
import { readBundledCss } from "./css.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const G = (at: number) => ({ at, text: "000. 000. 000." });

describe("takeoverDue: plays once, live", () => {
  it("a new glitch within 15 s of the story clock plays", () => {
    expect(takeoverDue(null, G(600_000), 600_400, false, false)).toBe(true);
    expect(takeoverDue(null, G(600_000), 600_000 + TAKEOVER_FRESH_MS, false, false)).toBe(true);
  });
  it("never embedded (Run → Players)", () => {
    expect(takeoverDue(null, G(600_000), 600_400, false, true)).toBe(false);
  });
  it("never on a first view (a reload, a new sign-in)", () => {
    expect(takeoverDue(null, G(600_000), 600_400, true, false)).toBe(false);
  });
  it("never twice for the same glitch", () => {
    expect(takeoverDue(600_000, G(600_000), 600_400, false, false)).toBe(false);
    expect(takeoverDue(600_000, G(900_000), 900_100, false, false)).toBe(true);
  });
  it("never stale (a phone waking a minute later), never history, never none", () => {
    expect(takeoverDue(null, G(600_000), 600_001 + TAKEOVER_FRESH_MS, false, false)).toBe(false);
    expect(takeoverDue(null, G(600_000), 599_000, false, false)).toBe(false);
    expect(takeoverDue(null, G(0), 1_000, false, false)).toBe(false);
    expect(takeoverDue(null, undefined, 1_000, false, false)).toBe(false);
    expect(takeoverDue(null, null, 1_000, false, false)).toBe(false);
    expect(takeoverDue(null, G(600_000), undefined, false, false)).toBe(false);
  });
  it("lengths: ~6 s full, 2.5 s for a host", () => {
    expect(TAKEOVER_MS).toBe(6_000);
    expect(TAKEOVER_LIGHT_MS).toBe(2_500);
  });
});

describe("the takeover's look", () => {
  it("full: an alert of cascading error windows with the story's text", () => {
    const html = renderToStaticMarkup(<GlitchTakeover text="000. 000. 000." />);
    expect(html).toContain('class="moments-takeover"');
    expect(html).toContain('role="alert"');
    expect(html.split("moments-takeover-win").length - 1).toBe(TAKEOVER_WINDOWS);
    expect(html).toContain("000. 000. 000.");
    expect(html).toContain(TAKEOVER_CAPTION);
  });
  it("light: look only, two windows; no text → the hijack's zeroes", () => {
    const html = renderToStaticMarkup(<GlitchTakeover text={null} light />);
    expect(html).toContain("moments-takeover light");
    expect(html).not.toContain('role="alert"');
    expect(html.split("moments-takeover-win").length - 1).toBe(2);
    expect(html).toContain(TAKEOVER_TEXT);
  });
  it("the cascade stays on screen", () => {
    for (let n = 0; n < TAKEOVER_WINDOWS; n++) {
      const at = cascadeAt(n);
      expect(at.top).toBeGreaterThanOrEqual(0);
      expect(at.top).toBeLessThan(75);
      // ≤ 72 % wide: it never runs off the right edge.
      expect(at.left + 72).toBeLessThanOrEqual(100);
    }
  });
  it("CSS: over everything, swallows taps; the host's lets them through; reduced motion is still", () => {
    const css = readBundledCss().replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(css).toMatch(/\.moments-takeover \{[^}]*z-index: var\(--z-glitch\);[^}]*pointer-events: auto;[^}]*animation: moments-takeover-life 6s/u);
    expect(css).toMatch(/\.moments-takeover\.light \{ pointer-events: none; animation-duration: 2\.5s;/u);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.moments-takeover, \.moments-takeover-bands, \.moments-takeover-roll \{ animation: none; \}/u);
    // ≤ 3 Hz: the bands change three times in 1.05 s.
    expect(css).toMatch(/animation: moments-takeover-jitter 1\.05s steps\(3, end\) infinite;/u);
    // Never a red veil.
    expect(css).toMatch(/--moments-takeover-veil: rgba\(0, 0, 16, 0\.62\);/u);
  });
  it("its caption is marked DRAFT for the sign-off", () => {
    expect(src("moments/glitch-takeover.tsx")).toMatch(/\/\/ DRAFT w26 \(T2\)[^\n]*\nexport const TAKEOVER_CAPTION/u);
  });
});

describe("the wiring", () => {
  it("the provider loads it lazily, with the 600 ms glitch as its fallback, and holds the queue", () => {
    const p = src("moments/provider.tsx");
    expect(p).toContain('import("./glitch-takeover.tsx")');
    expect(p).not.toMatch(/^import [^;]*from "\.\/glitch-takeover\.tsx"/mu);
    expect(p).toMatch(/<ChunkBoundary fallback=\{\(\) => <Glitch \/>\}>\s*<Suspense fallback=\{<Glitch \/>\}>/u);
    expect(p).toMatch(/takeoverDue\(r\.at, input\.glitch, input\.clock, r\.first, host\.embedded\)/u);
    expect(p).toMatch(/setHolds\(\(h\) => h \+ 1\)/u);
  });
  it("guests (featured programs too) get the full one; player booths full, host booths light; the director phone none", () => {
    expect(src("guest/app.tsx")).toMatch(/glitch: st\.night\?\.glitch,\s*takeover: "full",/u);
    expect(src("booth/app.tsx")).toMatch(/glitch: s\.view\?\.night\?\.glitch,\s*takeover: player \? "full" : "light",/u);
    expect(src("director.tsx")).not.toContain("MomentsProvider");
  });
});
