import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Attract } from "../src/Attract.tsx";
import { MAX_POPUPS } from "../src/idle-show/field.ts";
import { IdleShow } from "../src/idle-show/IdleShow.tsx";
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
});
