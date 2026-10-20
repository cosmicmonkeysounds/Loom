import type { SpatialCandidate } from "@loom/house";
import { describe, expect, it } from "vitest";
import { toProgram } from "../src/api.ts";
import { beginErrorText, isEligible, NOT_MARKED, NOT_MARKED_ERROR, programState, programStatus, quickPicks, type Program } from "../src/program.ts";

const p = (name: string, captured: boolean, restricted: boolean): Program => ({ id: `g-${name}`, name, captured, restricted, eligible: captured || restricted, location: null });

// A restricted program (not captured yet) is no healthy one: a marked one
// is captured by Play here's `reinstallation begun` (wave 9,
// T3-reinstall-03), but a director's Restrict is restricted too and Play
// here captures nobody then — so the copy never promises it.
describe("the wizard's program status", () => {
  it("corrupted, restricted, healthy", () => {
    expect(programStatus({ captured: true, restricted: false }).status).toBe("STATUS: CORRUPTED — requires reinstallation");
    expect(programStatus({ captured: true, restricted: true }).heading).toBe("Corrupted program detected");
    expect(programStatus({ captured: false, restricted: true })).toEqual({ heading: "Restricted program detected", icon: "🚨", status: "STATUS: RESTRICTED — marked for reinstallation" });
    expect(programStatus({ captured: false, restricted: false }).status).toBe("STATUS: healthy — not marked for reinstallation");
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
    expect(toProgram(row)).toEqual({ id: "g-1", name: "Excel", captured: false, restricted: true, eligible: true, location: "The Desktop" });
  });

  it("eligible (wave 16): the server's flag wins; an older server's row is captured || restricted", () => {
    expect(toProgram({ id: "g-1", name: "Excel", captured: false, restricted: false, eligible: false, location: null }).eligible).toBe(false);
    expect(toProgram({ id: "g-1", name: "Excel", captured: false, restricted: true, eligible: false, location: null }).eligible).toBe(false);
    expect(toProgram({ id: "g-1", name: "Excel", captured: true, location: null } as SpatialCandidate).eligible).toBe(true);
    expect(toProgram({ id: "g-1", name: "Excel", captured: false, location: null } as SpatialCandidate).eligible).toBe(false);
    expect(isEligible({ captured: false, restricted: true })).toBe(true);
    expect(isEligible({ captured: false, restricted: false })).toBe(false);
  });

  it("a refused begin says why: the server's 409 for an unmarked program is the wizard's not-marked line, never the closed-doors one", () => {
    expect(NOT_MARKED).toBe("Not marked — an Antivirus marks programs for reinstallation.");
    expect(beginErrorText(409, NOT_MARKED_ERROR)).toBe(NOT_MARKED);
    expect(beginErrorText(409, "no scenario loaded")).toBe("The story isn't running yet — start the event first.");
    expect(beginErrorText(404, "unknown guest")).toBe("Unknown program — register on your phone first.");
    expect(beginErrorText(null, "Failed to fetch")).toBe("Couldn't start the simulation — Failed to fetch");
  });
});
