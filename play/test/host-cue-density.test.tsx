//! The cue sheet's density and the FIRE window (wave 13 recheck): an aside
//! or a cue not on offer folds to one 44 px line, and an armed cue drains
//! its 4 s window as Win95 progress blocks (a "4 s" countdown under
//! reduced motion), in the row and on the NEXT bar's FIRE.

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cueRows, type CueRow } from "../../core/src/cue-sheet.ts";
import { ARM_MS, ARM_PICK_MS, ArmDrain, CueButton, armFor, armWindow, DRAIN_SEGMENTS, compactCue, cueRowClass, drainSeconds, nextBar, sheetLayout, type CueDesk } from "../src/director.tsx";
import { HostNextBar } from "../src/host/dock.tsx";
import { barLine, hostStrip } from "../src/host/model.ts";
import { hostFixture } from "./host-fixture.ts";

function row(over: Partial<CueRow> = {}): CueRow {
  return { id: "x", n: 1, code: null, title: "🍾 Spin the bottle", act: null, sequence: true, subject: false, live: true, last: false, next: false, fired: false, ...over } as CueRow;
}

function desk(over: Partial<CueDesk> = {}): CueDesk {
  return { armed: null, pending: null, cooling: false, toast: null, setToast: () => {}, picking: null, value: "", setValue: () => {}, subjectName: null, tap: () => {}, pick: () => {}, closePicker: () => {}, locked: () => false, ...over };
}

const line2 = barLine({ toast: null, connected: true, error: null, receivedAt: 0, now: 0, armed: false, subjectName: null, refused: null, reason: null });

describe("asides and cues not on offer fold to one line", () => {
  it("an aside or a not-on-offer cue is compact; NEXT, LAST and an armed one never are", () => {
    expect(compactCue(row({ sequence: false }), false)).toBe(true);
    expect(compactCue(row({ live: false }), false)).toBe(true);
    expect(compactCue(row(), false)).toBe(false);
    expect(compactCue(row({ sequence: false, next: true }), false)).toBe(false);
    expect(compactCue(row({ sequence: false, last: true }), false)).toBe(false);
    expect(compactCue(row({ sequence: false }), true)).toBe(false);
    expect(cueRowClass(row({ sequence: false }), false, false)).toContain("host-compact");
    expect(cueRowClass(row({ sequence: false }), true, false)).not.toContain("host-compact");
  });
  it("the compact row keeps its tags, with the redundant 'aside' marked to hide", () => {
    const html = renderToStaticMarkup(createElement(CueButton, { row: row({ sequence: false }), armed: null, locked: false, sending: false, warnings: [], onTap: () => {} }));
    expect(html).toContain("host-compact");
    expect(html).toContain('class="cue-tag host-aside">aside');
  });
  it("host.css folds the compact row to the 44 px floor on one line", () => {
    const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.host-compact\.cue-row \{[^}]*min-height: var\(--tap\)/u);
    expect(css).toMatch(/\.host-compact \.cue-title \{[^}]*white-space: nowrap/u);
  });
});

describe("the FIRE window drains", () => {
  it("whole seconds left: 4 s at the arm, 1 s in the last second, 0 once lapsed", () => {
    expect(ARM_MS).toBe(4000);
    expect(drainSeconds(1000, 1000)).toBe(4);
    expect(drainSeconds(1000, 1001)).toBe(4);
    expect(drainSeconds(1000, 4100)).toBe(1);
    expect(drainSeconds(1000, 5000)).toBe(0);
    expect(drainSeconds(1000, 9000)).toBe(0);
  });
  it("the bar runs ARM_MS in DRAIN_SEGMENTS steps from the arm's own moment, hidden from a screen reader", () => {
    const html = renderToStaticMarkup(createElement(ArmDrain, { at: Date.now() }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`animation-duration:${ARM_MS}ms`);
    expect(html).toContain(`steps(${DRAIN_SEGMENTS}, end)`);
    expect(html).toMatch(/host-drain-secs">4 s/u);
  });
  it("a row armed for a picked person drains over 10 s (wave 28)", () => {
    const at = Date.now();
    const ms = armWindow(armFor("award_most_trusted", "g1", at));
    expect(ms).toBe(ARM_PICK_MS);
    const html = renderToStaticMarkup(createElement(ArmDrain, { at, ms }));
    expect(html).toContain(`animation-duration:${ARM_PICK_MS}ms`);
    expect(html).toMatch(/host-drain-secs">10 s/u);
    // The armed row itself passes the picked window down.
    const award = row({ id: "award_most_trusted", title: "🏆 Most trusted", subject: true });
    const cue = renderToStaticMarkup(createElement(CueButton, { row: award, armed: armFor("award_most_trusted", "g1", at), locked: false, sending: false, warnings: [], onTap: () => {} }));
    expect(cue).toMatch(/host-drain-secs">10 s/u);
  });
  it("the armed row and the bar's FIRE both carry it; ARM never does", () => {
    const v = hostFixture();
    const rows = cueRows(v.interactions, v.cues);
    const bar = nextBar(rows, v.countdowns, 0);
    const strip = hostStrip(v, sheetLayout(rows), 0, 0);
    const armed = { id: "call_everyone", subject: null, at: Date.now() };
    const fire = renderToStaticMarkup(createElement(HostNextBar, { bar, desk: desk({ armed }), open: false, stale: false, line2, strip, onToggle: () => {} }));
    expect(fire).toMatch(/>FIRE<span class="host-drain host-drain-fire"/u);
    const arm = renderToStaticMarkup(createElement(HostNextBar, { bar, desk: desk(), open: false, stale: false, line2, strip, onToggle: () => {} }));
    expect(arm).not.toContain("host-drain");
    const r = rows.find((x) => x.id === "call_everyone")!;
    const cue = renderToStaticMarkup(createElement(CueButton, { row: r, armed, locked: false, sending: false, warnings: [], onTap: () => {} }));
    expect(cue).toContain("host-drain");
  });
  it("reduced motion: no bar, the seconds in text", () => {
    const css = readFileSync(new URL("../src/css/host.css", import.meta.url), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.host-drain-track \{ display: none; \}\s*\.host-drain-secs \{ display: inline; \}/u);
  });
});
