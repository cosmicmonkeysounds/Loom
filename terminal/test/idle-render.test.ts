import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Attract } from "../src/Attract.tsx";
import { MAX_POPUPS } from "../src/idle-show/field.ts";
import { setMomentUp, momentUp } from "../src/cutscene/moment-bus.ts";
import { IDLE_ADS } from "../src/idle-show/ads.ts";
import { AdArtView, DuckTarget, IdleShow } from "../src/idle-show/IdleShow.tsx";
import { ScanBox } from "../src/idle-show/ScanBox.tsx";
import { parseScreenState } from "../src/screen.ts";

// A server render runs no effects; `useLayoutEffect` only warns there.
vi.spyOn(console, "error").mockImplementation(() => {});

const awake = parseScreenState({ attract: false, now: 1, character: { id: "Trabolta", hidden: false, awake: true }, night: { phase: "hunt_1" } }, 1);

describe("the scan box", () => {
  it("says where the pass is now (the taskbar's 🎟 Pass, never ☰) and keeps the typed fallback a tap away", () => {
    const html = renderToStaticMarkup(createElement(ScanBox, { boxRef: { current: null }, scanner: createElement("video", { className: "cam" }), listen: null, problem: null, typedOpen: false, onToggleTyped: () => {}, typed: createElement("form", { className: "typed" }) }));
    expect(html).toContain("SCAN YOUR PASS");
    expect(html).toContain("🎟 Pass");
    expect(html).not.toContain("☰");
    expect(html).toContain("no camera? type your program name");
    expect(html).toContain('<video class="cam">'); // the camera is drawn, never hidden
    expect(html).not.toContain("display:none");
    expect(html).not.toContain('class="typed"');
    const open = renderToStaticMarkup(createElement(ScanBox, { boxRef: { current: null }, scanner: null, listen: "TRABOLTA IS SPEAKING", problem: "No camera on this device.", typedOpen: true, onToggleTyped: () => {}, typed: createElement("form", { className: "typed" }) }));
    expect(open).toContain("LISTEN");
    expect(open).toContain("No camera on this device.");
    expect(open).toContain('class="typed"');
  });
});

describe("the idle show", () => {
  it("draws a pool of six window slots, whatever is up", () => {
    const html = renderToStaticMarkup(createElement(IdleShow, { name: "Kitchen", state: null, asleep: true, character: "Trabolta", target: "wall", active: true }));
    expect(html.match(/class="idle-pop /gu)?.length).toBe(MAX_POPUPS);
    expect(html).toContain('data-pool="early"');
  });

  it("never names the character asleep or before the first answer, on any terminal", () => {
    for (let i = 0; i < 60; i++) {
      const name = `Terminal ${i}`;
      for (const target of ["wall", "tv"] as const) {
        expect(renderToStaticMarkup(createElement(Attract, { name, state: null, character: "Trabolta", target, corner: null }))).not.toMatch(/trabolta/iu);
        expect(renderToStaticMarkup(createElement(IdleShow, { name, state: awake, asleep: true, character: "Trabolta", target, active: true }))).not.toMatch(/trabolta/iu);
      }
    }
  });

  it("puts itself away (hidden, paused) when inactive", () => {
    expect(renderToStaticMarkup(createElement(IdleShow, { name: "Kitchen", state: awake, asleep: false, character: "Trabolta", target: "wall", active: false }))).toContain('data-active="false"');
  });

  it("pauses under a moment's scene — still drawn, frozen, nothing to tap under it", () => {
    const props = { name: "Kitchen", state: awake, asleep: false, character: "Trabolta", target: "wall" as const, active: true };
    expect(renderToStaticMarkup(createElement(IdleShow, props))).not.toContain("data-paused");
    setMomentUp(true);
    try {
      expect(momentUp()).toBe(true);
      const html = renderToStaticMarkup(createElement(IdleShow, props));
      expect(html).toContain('data-paused=""');
      expect(html).toContain('data-active="true"'); // not put away: a popup moment shows what's under it
    } finally {
      setMomentUp(false);
    }
    expect(renderToStaticMarkup(createElement(IdleShow, props))).not.toContain("data-paused");
  });
});

describe("an ad's art", () => {
  const svg = IDLE_ADS.find((a) => a.art !== undefined)!;
  it("draws its PNG when it has one, else its SVG art", () => {
    const png = renderToStaticMarkup(createElement(AdArtView, { ad: { ...svg, png: true }, className: "idle-ad-art" }));
    expect(png).toContain(`ads/${svg.id}.png`);
    expect(png).toContain("idle-ad-png");
    const plain = renderToStaticMarkup(createElement(AdArtView, { ad: svg, className: "idle-ad-art" }));
    expect(plain).not.toContain("<img");
    expect(plain).toContain("<svg");
  });
});

describe("the punch-the-duck target", () => {
  it("ping-pongs on a transform (never left:), held mid-lane under reduced motion", () => {
    const at = (now: number, reduced: boolean) => renderToStaticMarkup(createElement(DuckTarget, { now, reduced }));
    expect(at(0, false)).toContain("translateX(0.0%)");
    expect(at(1_300, false)).toContain("translateX(100.0%)");
    expect(at(1_950, false)).toContain("translateX(50.0%)");
    for (const now of [0, 650, 1_300, 2_000]) expect(at(now, true)).toContain("translateX(50.0%)");
    expect(at(650, false)).not.toMatch(/left:/u);
  });
});

describe("the idle show's stylesheet", () => {
  const css = readFileSync(fileURLToPath(new URL("../src/styles.css", import.meta.url)), "utf8");
  it("keeps TOUCH ME tappable in the face layout (pointer-events is inherited)", () => {
    const rule = css.split("\n").find((l) => l.includes('.idle-show[data-layout="face"] .idle-touch-me'));
    expect(rule).toMatch(/pointer-events: auto/u);
  });
  it("fades the banner ads (and the hijack jitter) under reduced motion", () => {
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.idle-banner-ad[,\s]/u);
    expect(reduced).toContain('.idle-show[data-pool="malware"] .idle-banner-ad');
    expect(reduced).toContain(".idle-duck-runner { transition: none; }");
  });
  it("freezes its animations while paused under a moment", () => {
    expect(css).toMatch(/\.idle-show\[data-paused\] \*[^{]*\{ animation-play-state: paused !important; \}/u);
  });
});
