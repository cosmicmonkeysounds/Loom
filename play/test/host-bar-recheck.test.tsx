//! The NEXT bar and the console (wave 13 recheck): the countdown a phone
//! reads once, the paused bar (D3), the TV voice turning with its toast,
//! and Escape heard inside a Run → Players pane.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { nextBar, sheetLayout, type CueDesk } from "../src/director.tsx";
import { HostNextBar, PAUSED_MARK, hostPaused } from "../src/host/dock.tsx";
import { OPTIMISTIC_MS, barLine, hostStrip, optimisticValue, tvVoiceLabel } from "../src/host/model.ts";
import { hostFixture } from "./host-fixture.ts";

function desk(over: Partial<CueDesk> = {}): CueDesk {
  return { armed: null, pending: null, cooling: false, toast: null, setToast: () => {}, picking: null, value: "", setValue: () => {}, subjectName: null, tap: () => {}, pick: () => {}, closePicker: () => {}, locked: () => false, ...over };
}

const line2 = barLine({ toast: null, connected: true, error: null, receivedAt: 0, now: 0, armed: false, subjectName: null, refused: null, reason: null });

describe("a phone reads the countdown once", () => {
  const v = hostFixture({ interactions: [] });
  const layout = sheetLayout([]);
  it("with the bar reading it, the strip's copy is the one a phone drops (the phase stays)", () => {
    const strip = hostStrip(v, layout, 60_000, 0, true);
    expect(strip.find((s) => s.kind === "countdown")?.optional).toBe(true);
    expect(strip.find((s) => s.kind === "phase")?.optional).toBeUndefined();
  });
  it("with a cue on the bar, the phase gives way as before", () => {
    const strip = hostStrip(v, layout, 60_000, 0);
    expect(strip.find((s) => s.kind === "countdown")?.optional).toBeUndefined();
    expect(strip.find((s) => s.kind === "phase")?.optional).toBe(true);
  });
  it("the bar's own countdown turns red under a minute", () => {
    const html = renderToStaticMarkup(createElement(HostNextBar, { bar: { kind: "countdown", label: "Hunt", left: 30 }, desk: desk(), open: false, stale: false, line2, strip: [], onToggle: () => {} }));
    expect(html).toMatch(/class="host-bar-title quiet urgent"/u);
  });
});

describe("a paused show on the NEXT bar (D3)", () => {
  const v = hostFixture();
  const rows = cueRows(v.interactions, v.cues);
  const bar = nextBar(rows, v.countdowns, 0);
  it("greys and says (Paused) after the cue; FIRE stays", () => {
    const html = renderToStaticMarkup(createElement(HostNextBar, { bar, desk: desk(), open: false, stale: false, paused: true, line2, strip: [], onToggle: () => {} }));
    expect(html).toMatch(/class="host-bar next[^"]*paused/u);
    expect(html).toContain(PAUSED_MARK.trim());
    expect(html).toMatch(/data-testid="host-fire"[^>]*>ARM</u);
    expect(html).not.toMatch(/data-testid="host-fire" disabled/u);
  });
  it("paused means the doors are open and the clock stopped", () => {
    expect(hostPaused({ runtime: "paused" })).toBe(true);
    expect(hostPaused({ runtime: "open", paused: true })).toBe(true);
    expect(hostPaused({ runtime: "open" })).toBe(false);
    expect(hostPaused({ runtime: "idle" })).toBe(false);
    expect(hostPaused({ runtime: "paused", doorsClosed: true })).toBe(false);
  });
  it("running: no mark", () => {
    const html = renderToStaticMarkup(createElement(HostNextBar, { bar, desk: desk(), open: false, stale: false, line2, strip: [], onToggle: () => {} }));
    expect(html).not.toContain("(Paused)");
  });
});

describe("the TV voice turns with its toast", () => {
  it("the flip stands until the view agrees, or for OPTIMISTIC_MS", () => {
    expect(optimisticValue(false, null, 0)).toBe(false);
    expect(optimisticValue(false, { value: true, at: 1000 }, 1500)).toBe(true);
    expect(optimisticValue(false, { value: true, at: 1000 }, 1000 + OPTIMISTIC_MS + 1)).toBe(false);
    expect(tvVoiceLabel(true)).toBe("🔇 TV voice muted: unmute");
    expect(tvVoiceLabel(false)).toBe("🔊 Mute the TV voice");
  });
});

describe("Escape closes the console inside a Run → Players pane", () => {
  it("the dock listens on its own root (the pane's shadow root), never only the document", () => {
    const src = readFileSync(new URL("../src/host/dock.tsx", import.meta.url), "utf8");
    expect(src).toContain("const root = eventRoot(dockNode);");
    expect(src).not.toMatch(/document\.addEventListener\("keydown"/u);
  });
});
