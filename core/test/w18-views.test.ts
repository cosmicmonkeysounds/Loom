//! Wave 18 on the pure views: OBJECTIVE `go:` → `GuestView.mission` and
//! header `archive:` → `GuestView.archived` (C11), `evergreen:` (A7),
//! booth objectives' `target:` / `pick:` (C5), the header lines on the model
//! (`wanted:`, `reinstall:`, `archive:`), and an old story untouched.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, primeView } from "../server/views.ts";
import { parseArchive, parseWanted } from "../src/runtime/sim/model.ts";
import { W18 } from "./w18-harness.ts";

function night(): Sim {
  const sim = Sim.fromSources(W18);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bo");
  sim.createPerson("g3", "Cy");
  return sim;
}

describe("the header lines compile onto the model", () => {
  it("wanted:, reinstall: and archive:", () => {
    const sim = night();
    expect(sim.model.wanted).toEqual({ flag: "marked", reason: "marked_for", claim: "escort_by", for: ["Antivirus"] });
    expect(sim.model.reinstall).toBe("program.marked == true or program.corrupted == true or Night.ended == true");
    expect(sim.model.archive).toEqual([
      { channel: "dm:The Uploader", when: "program.cleared == true" },
      { channel: "room:arrival", when: "program.cleared == true" },
    ]);
  });

  it("parseWanted takes the flag alone, refuses a head that is no ROLE path, needs `for`", () => {
    const roles = Sim.fromSources(W18).model;
    expect(parseWanted(roles, "program.marked, for Norton, McAfee")).toEqual({ flag: "marked", reason: null, claim: null, for: ["Norton", "McAfee"] });
    expect(parseWanted(roles, "Night.marked, for Antivirus")).toBeNull();
    expect(parseWanted(roles, "program.marked")).toBeNull();
    expect(parseArchive(roles, "Nowhere when true")).toBeNull();
    expect(parseArchive(roles, "The Desktop when program.cleared")).toEqual({ channel: "loc:The Desktop", when: "program.cleared" });
  });
});

describe("C11: the mission and the archived rooms", () => {
  it("the NOW objective and its go: place; an evergreen objective says so (A7)", () => {
    const sim = night();
    const v = guestView(sim, "g1");
    expect(v.mission).toEqual({ objective: "Explore The Computer", place: { id: "loc:The Desktop", name: "The Desktop" } });
    expect(v.objectives![0]).toMatchObject({ id: "Explore The Computer", evergreen: true });
    expect(v.objectives![0]!.target).toBeUndefined();
    expect(v.objectives![0]!.pick).toBeUndefined();
    expect(v.archived).toBeUndefined();
  });

  it("archive: lines tuck rooms away per guest once their condition holds", () => {
    const sim = night();
    sim.setVar("g1.cleared", "true");
    expect(guestView(sim, "g1").archived).toEqual(["dm:The Uploader", "room:arrival"]);
    expect(guestView(sim, "g2").archived).toBeUndefined();
  });

  it("a story with no OBJECTIVE and no archive: carries neither key", () => {
    const sim = Sim.fromSources(`# Plain\nstart: A\n\nROLE Guest\n\n== A\nHi.\n`);
    sim.createPerson("g1", "Ada");
    const v = guestView(sim, "g1");
    expect("mission" in v).toBe(false);
    expect("archived" in v).toBe(false);
  });
});

describe("C5: a booth objective's target and pick", () => {
  it("pick: the guests the condition holds for, those in the booth's room first, then by name", () => {
    const sim = night();
    for (const [id, at] of [["g1", "The Desktop"], ["g2", "The Desktop"], ["g3", "The Internet"]] as const) sim.setVar(`${id}.location`, at);
    const o = primeView(sim, "Clippy").objectives!.find((x) => x.id === "Celebrate The Winners")!;
    expect(o.pick).toEqual(["g1", "g2"]);
    sim.setVar("Clippy.location", "The Desktop");
    sim.setVar("g3.location", "The Desktop");
    expect(primeView(sim, "Clippy").objectives!.find((x) => x.id === "Celebrate The Winners")!.pick).toEqual(["g1", "g2", "g3"]);
  });

  it("target: an expression naming a guest by id or by name; nothing when it names nobody", () => {
    const sim = night();
    const target = () => primeView(sim, "Clippy").objectives!.find((x) => x.id === "Celebrate The Winners")!.target;
    expect(target()).toBeUndefined();
    sim.setVar("Night.bottle_pick", "g2");
    expect(target()).toEqual({ id: "g2", name: "Bo", location: null });
    sim.setVar("Night.bottle_pick", '"cy"');
    expect(target()).toMatchObject({ id: "g3", name: "Cy" });
  });

  it("a booth objective without target: / pick: carries neither", () => {
    const sim = night();
    const hunt = primeView(sim, "Norton").objectives!.find((x) => x.id === "Hunt")!;
    expect("target" in hunt || "pick" in hunt).toBe(false);
  });
});
