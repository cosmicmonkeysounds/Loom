//! Wave 17: `sound X in <Place>` / `sound X with rooms: …` lower to an `sfx`
//! directive whose args carry `rooms` (the long form `<sfx: X, rooms: …>`,
//! which stagehand's `parse_directive` reads as a kwarg), and every story
//! directive carries its enclosing beat's `setting` so the house router can
//! play an unrouted sound where its beat is set.

import { describe, expect, it } from "vitest";

import { lowerSoundArgs, roomsWords, statementToDirective } from "../src/parser/statements.ts";
import { Workspace } from "../src/lsp/index.ts";
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

  it("a comma-free rooms value: each lowercase word is a target, a Capitalised run one place", () => {
    expect(statementToDirective("sound x with rooms: The Start Bar")).toBe("sfx: x, rooms: The_Start_Bar");
    expect(statementToDirective("sound x with rooms: desktop The Start Bar hall")).toBe("sfx: x, rooms: desktop The_Start_Bar hall");
    expect(statementToDirective("sound x with rooms: The Desktop")).toBe("sfx: x, rooms: The_Desktop");
    expect(roomsWords("Desktop living")).toEqual(["Desktop", "living"]);
    expect(roomsWords("  ")).toEqual([]);
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

describe("L1213: a several-word sound target that names no LOCATION", () => {
  const lint = (line: string): string[] => {
    const ws = new Workspace();
    ws.open("file:///main.loom", `# T\nstart: A\n\nLOCATION The Start Bar\n\nLOCATION The Desktop\n\n== A\n  setting: The Desktop\n${line}\nHello.\n`);
    return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === "L1213").map((d) => d.message);
  };

  it("places that are LOCATIONs, one-word targets and a plain sound say nothing", () => {
    for (const line of ["sound x", "sound x in The Start Bar", "sound x with rooms: The Start Bar", "sound x with rooms: desktop, The Desktop", "sound x with rooms: living upstairs-hall", "sound x in desktop"]) {
      expect([line, lint(line)]).toEqual([line, []]);
    }
  });

  it("two Capitalised zones side by side, or a misspelt place, are flagged with the comma rule", () => {
    const [msg, ...rest] = lint("sound x with rooms: Living Upstairs");
    expect(rest).toEqual([]);
    expect(msg).toContain("`Living Upstairs` is no LOCATION");
    expect(msg).toContain("separate several names with commas");
    expect(lint("sound x in The Start Barn")).toHaveLength(1);
    expect(lint("sound x with rooms: hall, The Kitchen")).toHaveLength(1);
  });
});
