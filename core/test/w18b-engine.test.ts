//! Wave 18b — the engine lane's smaller additions: the `names()` builtin,
//! the `badge:` header, `lobby: hidden`, the approver's `as` / `audit`
//! clauses and conditional avatars.

import { describe, expect, it } from "vitest";
import { Sim, joinNames } from "../src/runtime/sim/sim.ts";

describe("names() (wave 18b)", () => {
  const SRC = `# Roll Call
CHARACTER Night
  said: text? = none
  none: text? = none

ROLE Program
  problem: text? = none

when roll_call:
  set Night.said = names([p for p in Persons where p.problem == "slow"])
  set Night.none = names([p for p in Persons where p.problem == "nobody"])
`;

  it("joins display names for speech, and is empty for an empty list", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B and C");
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Winamp");
    sim.createPerson("g2", "Clippy Two");
    sim.createPerson("g3", "Excel");
    sim.setVar("g1.problem", "slow");
    sim.setVar("g3.problem", "slow");
    sim.signal("roll_call");
    expect(sim.world.get("Night.said")).toEqual({ kind: "string", value: "Winamp and Excel" });
    expect(sim.world.get("Night.none")).toEqual({ kind: "string", value: "" });
  });
});
