import type { SpatialCandidate } from "@loom/house";
import { describe, expect, it } from "vitest";
import { toProgram } from "../src/api.ts";
import { beginErrorText, isEligible, isMarked, markedLegend, NOT_MARKED, NOT_MARKED_ERROR, programPitch, programState, programStatus, quickPicks, startingHeading, type Program } from "../src/program.ts";

const p = (name: string, captured: boolean, restricted: boolean, marked = restricted && !captured): Program => ({ id: `g-${name}`, name, captured, restricted, eligible: captured || restricted || marked, marked, favour: false, location: null });

// A marked program (not captured yet) is no healthy one: Play here's
// `reinstallation begun` captures them (wave 9, T3-reinstall-03). Wave 18
// (C7): the server names the marked (`marked`) — a mark no longer
// restricts — and a director's Restrict alone is no mark.
describe("the wizard's program status", () => {
  it("corrupted, marked, held, healthy", () => {
    expect(programStatus({ captured: true, restricted: false }).status).toBe("STATUS: CORRUPTED — requires reinstallation");
    expect(programStatus({ captured: true, restricted: true }).heading).toBe("Corrupted program detected");
    // An older server: restricted is the marked state.
    expect(programStatus({ captured: false, restricted: true })).toEqual({ heading: "Marked program detected", icon: "🚨", status: "STATUS: MARKED — marked for reinstallation" });
    expect(programStatus({ captured: false, restricted: false }).status).toBe("STATUS: healthy — not marked for reinstallation");
    expect(programState({ captured: false, restricted: true })).toBe("marked");
    // Wave 18: `marked` with no restriction; a director's hold that isn't a mark.
    expect(programState({ captured: false, restricted: false, eligible: true, marked: true })).toBe("marked");
    expect(programState({ captured: false, restricted: true, eligible: false, marked: false })).toBe("held");
    expect(programStatus({ captured: false, restricted: true, eligible: false, marked: false }).heading).toBe("Program held");
    expect(programStatus({ captured: false, restricted: true, eligible: false, marked: false }).status).toBe("STATUS: RESTRICTED — held, not marked");
    expect(programState({ captured: false, restricted: false, eligible: false, marked: false })).toBe("healthy");
  });

  it("isMarked reads the server's flag, else restricted; never a captured program", () => {
    expect(isMarked({ captured: false, restricted: false, eligible: true, marked: true })).toBe(true);
    expect(isMarked({ captured: false, restricted: true, eligible: false, marked: false })).toBe(false);
    expect(isMarked({ captured: false, restricted: true, eligible: true, marked: false })).toBe(true);
    expect(isMarked({ captured: false, restricted: true })).toBe(true);
    expect(isMarked({ captured: false })).toBe(false);
    expect(isMarked({ captured: true, restricted: true, marked: true })).toBe(false);
  });

  it("after an ending (S1): a party favour, never corrupted framing — but a captured one stays in the Internet", () => {
    const favour = programStatus({ captured: false, restricted: false, eligible: true, marked: true }, true);
    expect(favour).toEqual({ heading: "Party favour unlocked", icon: "🎉", status: "STATUS: the night is over — anyone may play" });
    expect(`${favour.heading} ${favour.status}`).not.toMatch(/corrupt|marked/iu);
    expect(programState({ captured: false, restricted: false, eligible: true, marked: false }, true)).toBe("favour");
    expect(programState({ captured: true, restricted: false, eligible: true }, true)).toBe("corrupted");
    // The server still decides: one it won't let in is not a favour.
    expect(programState({ captured: false, restricted: false, eligible: false, marked: false }, true)).toBe("healthy");
    expect(programPitch("favour")).toMatch(/party favour/u);
    expect(programPitch("favour")).not.toMatch(/corrupt|reinstalled/iu);
    expect(programPitch("marked")).toMatch(/^To be reinstalled/u);
    expect(startingHeading("favour", "Winamp")).toBe("Party favour for Winamp");
    expect(startingHeading("marked", "Winamp")).toBe("Reinstalling Winamp");
  });

  it("quick picks: the Internet now, then the marked, each by name; the healthy and the held never", () => {
    const roster = [p("Winamp", false, true), p("Excel", true, false), p("Clippy", false, false), p("Access", false, false, true), p("Bonzi", true, true), { ...p("Held", false, true, false), eligible: false }];
    const picks = quickPicks(roster);
    expect(picks.corrupted.map((c) => c.name)).toEqual(["Bonzi", "Excel"]);
    expect(picks.marked.map((c) => c.name)).toEqual(["Access", "Winamp"]);
    expect(quickPicks(roster, 1).marked.map((c) => c.name)).toEqual(["Access"]);
    expect(markedLegend(false)).toBe("Marked for reinstallation");
  });

  it("quick picks after an ending: everyone the server lets in, under a party-favour legend", () => {
    const everyone = [p("Winamp", false, false, true), p("Clippy", false, false, true), p("Excel", true, false)];
    const picks = quickPicks(everyone, 8, true);
    expect(picks.corrupted.map((c) => c.name)).toEqual(["Excel"]);
    expect(picks.marked.map((c) => c.name)).toEqual(["Clippy", "Winamp"]);
    expect(markedLegend(true)).toBe("Anyone may play — the night is over");
  });

  it("a candidate row without `restricted` (an older server) reads as not restricted", () => {
    expect(toProgram({ id: "g-1", name: "Excel", captured: false, location: "The Desktop" } as SpatialCandidate).restricted).toBe(false);
    const row = { id: "g-1", name: "Excel", captured: false, location: "The Desktop", restricted: true };
    expect(toProgram(row)).toEqual({ id: "g-1", name: "Excel", captured: false, restricted: true, eligible: true, marked: true, favour: false, location: "The Desktop" });
  });

  it("marked (wave 18, C7): the server's flag labels the program, not restricted", () => {
    const row = { id: "g-1", name: "Excel", captured: false, restricted: false, eligible: true, marked: true, location: null } as SpatialCandidate;
    expect(toProgram(row).marked).toBe(true);
    const held = { id: "g-2", name: "Word", captured: false, restricted: true, eligible: false, marked: false, location: null } as SpatialCandidate;
    expect(toProgram(held).marked).toBe(false);
    expect(programState(toProgram(held))).toBe("held");
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
    // Wave 26 (C12, G2): the line states no rule.
    expect(NOT_MARKED).toBe("Not marked for reinstallation.");
    expect(beginErrorText(409, NOT_MARKED_ERROR)).toBe(NOT_MARKED);
    expect(beginErrorText(409, "no scenario loaded")).toBe("The story isn't running yet — start the event first.");
    expect(beginErrorText(404, "unknown guest")).toBe("Unknown program — register on your phone first.");
    expect(beginErrorText(null, "Failed to fetch")).toBe("Couldn't start the simulation — Failed to fetch");
  });
});

// Wave 18 (integration): after an ending the server tags nobody marked and
// says `favour` on every program it lets in; the tablet reads that alone.
describe("a party favour from the candidates", () => {
  it("toProgram reads `favour`; the state is a favour even before the screen poll says the night ended", () => {
    const row = { id: "g-1", name: "Winamp", captured: false, restricted: false, eligible: true, marked: false, favour: true, location: null } as unknown as SpatialCandidate;
    const prog = toProgram(row);
    expect(prog).toMatchObject({ favour: true, marked: false, eligible: true });
    expect(programState(prog)).toBe("favour");
    expect(programStatus(prog).heading).toBe("Party favour unlocked");
    expect(quickPicks([prog]).marked.map((x) => x.name)).toEqual(["Winamp"]);
    // A server that doesn't say: no favour.
    expect(toProgram({ ...row, favour: undefined } as unknown as SpatialCandidate).favour).toBe(false);
  });
});
