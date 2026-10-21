//! Wave 17: `sound X in <Place>` / `sound X with rooms: …` lower to an `sfx`
//! directive whose args carry `rooms` (the long form `<sfx: X, rooms: …>`,
//! which stagehand's `parse_directive` reads as a kwarg), and every story
//! directive carries its enclosing beat's `setting` so the house router can
//! play an unrouted sound where its beat is set.

import { describe, expect, it } from "vitest";

import { lowerSoundArgs, statementToDirective } from "../src/parser/statements.ts";
import { Sim } from "../src/runtime/sim/index.ts";

describe("sound … in / with rooms", () => {
  it("lowers a place and a rooms list onto comma-separated args", () => {
    expect(statementToDirective("sound bell_toll")).toBe("sfx: bell_toll");
    expect(statementToDirective("sound dance_song in The Desktop")).toBe("sfx: dance_song, rooms: The_Desktop");
    expect(statementToDirective("sound dance_song with rooms: desktop start-bar")).toBe("sfx: dance_song, rooms: desktop start-bar");
    expect(statementToDirective("sound x with rooms: The Desktop, The Start Bar, gain: -6")).toBe("sfx: x, rooms: The_Desktop The_Start_Bar, gain: -6");
    expect(statementToDirective("sound x in The Desktop with gain: -3")).toBe("sfx: x, rooms: The_Desktop, gain: -3");
    expect(statementToDirective("sfx x in The RAM")).toBe("sfx: x, rooms: The_RAM");
    expect(statementToDirective("sound x with fade: 2")).toBe("sfx: x, fade: 2");
  });

  it("anything else stays prose", () => {
    expect(statementToDirective("sound x in")).toBeNull();
    expect(statementToDirective("sound of rain in the hall")).toBeNull();
    expect(lowerSoundArgs("x")).toBe("x");
  });

  it("the sim's directive event carries the args and the beat's setting", () => {
    const sim = Sim.fromSources(
      `# T\n\nLOCATION The Desktop\n\nwhen loud:\n  sound siren\n\n== Boot\n  setting: The Desktop\nsound modem in The RAM\nsound chime\n`,
    );
    sim.fireBeat("Boot");
    sim.signal("loud");
    const sfx = sim.log.all().filter((e) => e.type === "directive" && e.verb === "sfx");
    expect(sfx).toEqual([
      { type: "directive", verb: "sfx", args: "modem, rooms: The_RAM", setting: "The Desktop" },
      { type: "directive", verb: "sfx", args: "chime", setting: "The Desktop" },
      { type: "directive", verb: "sfx", args: "siren", setting: null },
    ]);
  });
});
