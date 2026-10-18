import type { SpatialCandidate } from "@loom/house";
import { describe, expect, it } from "vitest";
import { toProgram } from "../src/api.ts";
import { programState, programStatus, quickPicks, type Program } from "../src/program.ts";

const p = (name: string, captured: boolean, restricted: boolean): Program => ({ id: `g-${name}`, name, captured, restricted, location: null });

// A restricted program (not captured yet) is no healthy one: a marked one
// is captured by Play here's `reinstallation begun` (wave 9,
// T3-reinstall-03), but a director's Restrict is restricted too and Play
// here captures nobody then — so the copy never promises it.
describe("the wizard's program status", () => {
  it("corrupted, restricted, healthy", () => {
    expect(programStatus({ captured: true, restricted: false }).status).toBe("STATUS: CORRUPTED — requires reinstallation");
    expect(programStatus({ captured: true, restricted: true }).heading).toBe("Corrupted program detected");
    expect(programStatus({ captured: false, restricted: true })).toEqual({ heading: "Restricted program detected", icon: "🚨", status: "STATUS: RESTRICTED — if marked, Play here begins the reinstallation" });
    expect(programStatus({ captured: false, restricted: false }).status).toBe("STATUS: healthy — Gerald is waiting anyway");
    expect(programState({ captured: false, restricted: true })).toBe("restricted");
  });

  it("quick picks: the Internet now, then the restricted ones, each by name; the healthy never", () => {
    const roster = [p("Winamp", false, true), p("Excel", true, false), p("Clippy", false, false), p("Access", false, true), p("Bonzi", true, true)];
    const picks = quickPicks(roster);
    expect(picks.corrupted.map((c) => c.name)).toEqual(["Bonzi", "Excel"]);
    expect(picks.restricted.map((c) => c.name)).toEqual(["Access", "Winamp"]);
    expect(quickPicks(roster, 1).restricted.map((c) => c.name)).toEqual(["Access"]);
  });

  it("a candidate row without `restricted` (an older server) reads as not restricted", () => {
    expect(toProgram({ id: "g-1", name: "Excel", captured: false, location: "The Desktop" } as SpatialCandidate).restricted).toBe(false);
    const row = { id: "g-1", name: "Excel", captured: false, location: "The Desktop", restricted: true };
    expect(toProgram(row)).toEqual({ id: "g-1", name: "Excel", captured: false, restricted: true, location: "The Desktop" });
  });
});
