//! The host's windows and the Show window's rules (wave 25,
//! docs/loom-house-desk.md §6.2): which window is on screen and when the
//! slim NEXT bar shows, the sections and their folds, where a jump lands,
//! the night strip, and *Coming up*.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cueRows } from "../../core/src/cue-sheet.ts";
import { sheetLayout } from "../src/director.tsx";
import { hostStrip } from "../src/host/model.ts";
import { asksLine, COMING_CUES, comingUp, hostBarShown, hostWindowShown, nightStrip, sectionHead, sectionOpen, showClockChip, showSections, showTarget } from "../src/host/show-model.ts";
import { hostFixture } from "./host-fixture.ts";

describe("the host's windows", () => {
  it("a phone shows the picked window until a room covers it; wide, the room sits beside it", () => {
    expect(hostWindowShown("show", false, null)).toBe("show");
    expect(hostWindowShown("show", false, "lobby")).toBeNull();
    expect(hostWindowShown("desk", true, "lobby")).toBe("desk");
  });
  it("the slim NEXT bar shows only while Show is off screen", () => {
    expect(hostBarShown("show", false, null)).toBe(false);
    expect(hostBarShown("show", true, "lobby")).toBe(false);
    expect(hostBarShown("show", false, "lobby")).toBe(true); // a room on a phone
    expect(hostBarShown("chats", false, null)).toBe(true);
    expect(hostBarShown("desk", true, null)).toBe(true);
  });
});

describe("Show's sections", () => {
  it("in order (wave 37: Needs you first); jobs and coming up open, needs and judge open while something waits, the long ones folded", () => {
    const s = showSections({ jobs: 1, needs: 2, judging: { pending: 0 }, people: 40 });
    expect(s.map((x) => x.id)).toEqual(["needs", "jobs", "coming", "judge", "cues", "people", "more"]);
    expect(s.filter((x) => x.open).map((x) => x.id)).toEqual(["needs", "jobs", "coming"]);
    // Nothing waiting: Needs stays first, folded to its head, so Your jobs
    // is the first open section and the head never moves.
    const quiet = showSections({ jobs: 1, needs: 0, judging: null, people: 0 });
    expect(quiet.map((x) => x.id)).toEqual(["needs", "jobs", "coming", "cues", "people", "more"]);
    expect(quiet.filter((x) => x.open).map((x) => x.id)).toEqual(["jobs", "coming"]);
    expect(showSections({ jobs: 0, needs: 0, judging: null, people: 0 }).map((x) => x.id)).not.toContain("judge");
    expect(showSections({ jobs: 0, needs: 0, judging: { pending: 3 }, people: 0 }).find((x) => x.id === "judge")!.open).toBe(true);
  });
  it("heads count what waits; a fold wins over the default", () => {
    const [needs, jobs] = showSections({ jobs: 2, needs: 0, judging: null, people: 0 });
    expect(sectionHead(jobs!)).toBe("Your jobs (2)");
    expect(sectionHead(needs!)).toBe("Needs you · nothing");
    expect(sectionHead({ id: "cues", title: "Cue sheet", open: false })).toBe("Cue sheet");
    expect(sectionOpen(needs!, {})).toBe(false);
    expect(sectionOpen(needs!, { needs: true })).toBe(true);
    expect(sectionOpen(jobs!, { jobs: false })).toBe(false);
  });
  it("a jump to the drawer's old tabs lands on its section (Cues: the top)", () => {
    expect(showTarget("cues")).toBe("top");
    expect(showTarget("needs")).toBe("needs");
    expect(showTarget("more")).toBe("more");
    expect(showTarget("people")).toBe("people");
    expect(showTarget("judge")).toBe("judge");
  });
});

describe("an ask that waits (wave 59)", () => {
  it("says so in one line, and nothing with none", () => {
    expect(asksLine(0)).toBeNull();
    expect(asksLine(1)).toBe("🔁 1 wants back in");
    expect(asksLine(3)).toBe("🔁 3 want back in");
  });
  it("sits above NEXT, and its tap goes to Needs", () => {
    const show = readFileSync(new URL("../src/host/show.tsx", import.meta.url), "utf8");
    expect(show.indexOf('data-testid="host-show-asks"')).toBeGreaterThan(-1);
    expect(show.indexOf('data-testid="host-show-asks"')).toBeLessThan(show.indexOf("<NextBox big"));
    expect(show).toContain('onClick={() => c.ctx?.go("needs")}');
  });
});

describe("the night strip", () => {
  const v = hostFixture();
  const rows = cueRows(v.interactions, v.cues);
  it("the bar's strip with the show clock after the phase, and no ⚠ count", () => {
    const strip = hostStrip(v, sheetLayout(rows), 0, 2, false, "📣 Nobody calling");
    const out = nightStrip(strip, showClockChip("7:42 PM", true));
    expect(out.map((x) => x.kind)).toEqual(["caller", "act", "phase", "show-clock", "countdown"]);
    expect(out[3]!.text).toBe("🕐 7:42 PM");
    expect(out.some((x) => x.kind === "needs")).toBe(false);
  });
  it("a paused clock says so; no clock, no chip", () => {
    expect(showClockChip("7:42 PM", false)).toBe("🕐 ⏸ 7:42 PM");
    expect(showClockChip(null, true)).toBeNull();
    expect(nightStrip([{ text: "B · Act I", kind: "act" }], null).map((x) => x.text)).toEqual(["B · Act I"]);
    expect(nightStrip([], "🕐 7 PM").map((x) => x.text)).toEqual(["🕐 7 PM"]);
  });
});

describe("Coming up", () => {
  const v = hostFixture({
    interactions: [
      { id: "a1", label: "A1 · One", who: "admin", act: "A · First" },
      { id: "a2", label: "A2 · Two", who: "admin" },
      { id: "a3", label: "A3 · Three (optional)", who: "admin" },
      { id: "aside", label: "Aside", who: "admin", sequence: false },
      { id: "a4", label: "A4 · Four", who: "admin" },
      { id: "a5", label: "A5 · Five", who: "admin" },
      { id: "b1", label: "B1 · Next act", who: "admin", act: "B · Second" },
    ],
    cues: { last: "a1", fired: ["a1"], presses: 1, pressed: null },
  });
  const rows = cueRows(v.interactions, v.cues);
  it("the next few in-sequence cues after NEXT, in the act, never an aside", () => {
    const c = comingUp(rows, sheetLayout(rows), v.countdowns, 0);
    expect(rows.find((r) => r.next)!.id).toBe("a2");
    expect(c.cues.map((x) => x.id)).toEqual(["a3", "a4", "a5"]);
    expect(c.cues).toHaveLength(COMING_CUES);
    expect(c.cues[0]!.title).toBe("Three");
    expect(comingUp(rows, sheetLayout(rows), [], 0, 10).cues.map((x) => x.id)).not.toContain("b1");
  });
  it("countdowns soonest first, urgent under a minute, gone once over", () => {
    const c = comingUp(rows, sheetLayout(rows), [{ label: "Hunt", endsAt: 600 }, { label: "Midnight", endsAt: 30 }, { label: "Gone", endsAt: 1 }], 2_000);
    expect(c.countdowns.map((x) => x.label)).toEqual(["Midnight", "Hunt"]);
    expect(c.countdowns[0]).toMatchObject({ urgent: true, text: "⏳ Midnight in 0:28" });
    expect(c.countdowns[1]!.urgent).toBe(false);
  });
});
