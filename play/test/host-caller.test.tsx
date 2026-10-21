//! Who is calling the show (wave 18 B8, Q1): the caller claim as every
//! console reads it — feature-detected off `cues.caller`, the chip, the
//! Cues tab's line, who is asked before a FIRE, the flip that reads back —
//! plus a press's `said` / `staff` lines through `fireCue`, and the
//! director phone's strip.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { fireCue, pressLines, sheetLayout, stripItems, type DirectorView } from "../src/director.tsx";
import { asksBeforeFire, callerIsMe, callerKnown, callerLine, callerText, cueCaller, fireAnywayText, shownCaller } from "../src/host/caller.ts";
import { FireAnywayBox, askCue } from "../src/host/fire-anyway.tsx";

const tm = { name: "Task Manager", at: 5 };

describe("cues.caller, feature-detected", () => {
  it("reads a caller, and nobody for an older server or a malformed one", () => {
    expect(cueCaller({ last: null, fired: [], caller: tm })).toEqual(tm);
    expect(cueCaller({ last: null, fired: [], caller: { name: "  Sam " } })).toEqual({ name: "Sam", at: 0 });
    expect(cueCaller({ last: null, fired: [] })).toBeNull();
    expect(cueCaller({ last: null, fired: [], caller: null })).toBeNull();
    expect(cueCaller({ caller: { name: "" } })).toBeNull();
    expect(cueCaller({ caller: "Task Manager" })).toBeNull();
    expect(cueCaller(undefined)).toBeNull();
  });
  it("knows whether the server has callers at all", () => {
    expect(callerKnown({ last: null, fired: [], caller: null })).toBe(true);
    expect(callerKnown({ last: null, fired: [] })).toBe(false);
    expect(callerKnown(null)).toBe(false);
  });
});

describe("the caller chip and line", () => {
  it("says You, the part, Run for a director at the laptop, a phone as it is, nobody", () => {
    const parts = ["Task Manager", "Adobe Acrobat", "Recycling Bin"];
    expect(callerText(tm, ["Task Manager"], parts)).toBe("📣 You");
    expect(callerText(tm, ["Adobe Acrobat"], parts)).toBe("📣 Task Manager");
    expect(callerText({ name: "task manager", at: 0 }, ["Task Manager"], parts)).toBe("📣 You");
    expect(callerText({ name: "Sam Rivera", at: 0 }, ["Adobe Acrobat"], parts)).toBe("📣 Run");
    expect(callerText({ name: "Phone · Sam", at: 0 }, ["Adobe Acrobat"], parts)).toBe("📣 Phone · Sam");
    expect(callerText(null, ["Adobe Acrobat"], parts)).toBe("📣 nobody");
    // The director phone has no part list: every name as it is.
    expect(callerText({ name: "Sam Rivera", at: 0 }, ["Jo"])).toBe("📣 Sam Rivera");
  });
  it("words the Cues tab's Who's calling box", () => {
    expect(callerLine(tm, ["Adobe Acrobat"])).toBe("📣 Task Manager is calling.");
    expect(callerLine(tm, ["Task Manager"])).toBe("📣 You're calling.");
    expect(callerLine(null, ["Task Manager"])).toBe("📣 Nobody is calling.");
  });
  it("matches a phone by its typed name or its label", () => {
    expect(callerIsMe({ name: "Phone · Sam", at: 0 }, ["Sam", "Phone · Sam"])).toBe(true);
    expect(callerIsMe({ name: "Sam", at: 0 }, ["Sam", "Phone · Sam"])).toBe(true);
    expect(callerIsMe({ name: "Jo", at: 0 }, ["", null, undefined])).toBe(false);
  });
});

describe("FIRE by a non-caller asks once", () => {
  it("asks only while someone else calls", () => {
    expect(asksBeforeFire(tm, ["Adobe Acrobat"])).toBe(true);
    expect(asksBeforeFire(tm, ["Task Manager"])).toBe(false);
    expect(asksBeforeFire(null, ["Task Manager"])).toBe(false);
  });
  it("uses the copy deck's words, Cancel the default", () => {
    const rows = cueRows([{ id: "truth_pong", label: "D · 🏓 Truth Pong", who: "admin" }], { last: null, fired: [] });
    const cue = askCue(rows[0]!);
    expect(cue).toBe("D 🏓 Truth Pong");
    expect(fireAnywayText(tm, cue)).toEqual({ title: "Fire D 🏓 Truth Pong?", body: "Task Manager is calling the show. Fire it anyway? They'll see you did." });
    const html = renderToStaticMarkup(createElement(FireAnywayBox, { caller: tm, cue, onFire: () => {}, onCancel: () => {} }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Fire anyway");
    expect(html).toContain("Cancel");
    // Cancel comes last (the default, on the right) and carries the ring.
    expect(html.indexOf("Fire anyway")).toBeLessThan(html.indexOf(">Cancel<"));
    expect(html).toMatch(/class="w95-btn host-ask-cancel"/u);
  });
});

describe("a claim reads back before the next poll", () => {
  it("shows the console's own flip while it is fresh, else the view", () => {
    expect(shownCaller(null, { on: true, at: 100 }, "Adobe Acrobat", 200, 10_000)).toEqual({ name: "Adobe Acrobat", at: 0 });
    expect(shownCaller(tm, { on: true, at: 100 }, "Adobe Acrobat", 200, 10_000)).toEqual({ name: "Adobe Acrobat", at: 5 });
    expect(shownCaller({ name: "Adobe Acrobat", at: 1 }, { on: false, at: 100 }, "Adobe Acrobat", 200, 10_000)).toBeNull();
    // Letting go never hides someone else's claim.
    expect(shownCaller(tm, { on: false, at: 100 }, "Adobe Acrobat", 200, 10_000)).toEqual(tm);
    expect(shownCaller(tm, { on: true, at: 100 }, "Adobe Acrobat", 20_200, 10_000)).toEqual(tm);
  });
});

describe("a press's lines (did:)", () => {
  it("keeps strings, drops the rest, absent when none", () => {
    expect(pressLines(["the summons opened", "", 3, " 7 not checked in "])).toEqual(["the summons opened", "7 not checked in"]);
    expect(pressLines([])).toBeUndefined();
    expect(pressLines(undefined)).toBeUndefined();
  });
  it("rides fireCue's taken outcome, never a refused one", async () => {
    const body = { name: "x", label: "Phone" };
    expect(await fireCue(async () => ({ said: ["Hi"], staff: ["📣 done"] }), body, () => {})).toEqual({ ok: true, said: ["Hi"], staff: ["📣 done"] });
    expect(await fireCue(async () => ({ refused: true, staff: ["why"] }), body, () => {})).toEqual({ ok: true, refused: true });
    expect(await fireCue(async () => ({}), body, () => {})).toEqual({ ok: true });
  });
});

describe("the director phone's strip", () => {
  it("shows the caller after the clock, only when given", () => {
    const view: DirectorView = { interactions: [{ id: "a", label: "A", who: "admin" }], cues: { last: null, fired: [] }, phase: "open" };
    const layout = sheetLayout(cueRows(view.interactions!, view.cues!));
    expect(stripItems(view, layout, 0, { minutes: 19 * 60, running: true }, "📣 Task Manager").map((i) => i.text)).toEqual(["🕐 7:00 PM", "📣 Task Manager"]);
    expect(stripItems(view, layout, 0, null, null)).toEqual([]);
  });
});
