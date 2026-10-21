//! Wave 18b — faction mode (header `founding:`): founded crews race like the
//! declared sides, one faction at a time; a founder leaving disbands; the
//! majority is any race faction over the line; counts are private to each
//! faction's own members; and with no `founding:` line nothing changes.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { guestView, modView } from "../server/views.ts";
import { CREW_SOURCE } from "./crews.fixture.ts";
import { playJournal } from "./w18b-crews-journal.ts";

const FACTIONS = `# Faction Night
start: Hall
directory: everyone
majority: count([p for p in Persons where p.gone != true and p.persona != true]) / 2 + 1
founding: Night.open == true and program.cleared == true

GROUP Hosts
  joinable: false

GROUP Red
  ethos: stay forever
  hidden: true

GROUP Blue
  hidden: true

LOCATION Hall
LOCATION Jail
  prison: true

CHARACTER Night
  open: bool = false
  won: text? = none
  founder: text? = none
  name: text? = none
  wins: 0 to 99 = 0

ROLE Program
  cleared: bool = true
  mine: text? = none
  when majority_faction() != null:
    set self.mine = faction_of(self)

when Night.open == true and majority_faction() != null:
  set Night.won = majority_faction()
  set Night.founder = faction_founder(majority_faction())
  set Night.name = faction_name(majority_faction())
  set Night.wins = Night.wins + 1

== Hall
  setting: Hall
Narrator: The hall.
`;

function night(n = 5): Sim {
  const sim = Sim.fromSources(FACTIONS);
  for (let i = 1; i <= n; i++) sim.createPerson(`g${i}`, `P${i}`);
  return sim;
}
const str = (sim: Sim, path: string): string | null => {
  const v = sim.world.get(path);
  return v.kind === "string" ? v.value : null;
};

describe("faction mode: founding", () => {
  it("is off with no `founding:` line and on with one", () => {
    expect(Sim.fromSources(CREW_SOURCE).crews.factionMode).toBe(false);
    expect(night().crews.factionMode).toBe(true);
    expect(night().model.founding).toBe("Night.open == true and program.cleared == true");
  });

  it("founds only while the condition holds, and never a restricted, captured or leading program", () => {
    const sim = night();
    expect(sim.crews.mayFound("g1")).toBe(false);
    sim.crew({ op: "foundCrew", by: "g1", name: "Too Early" });
    expect(sim.crews.all()).toEqual([]);
    sim.setVar("Night.open", "true");
    expect(sim.crews.mayFound("g1")).toBe(true);
    expect(guestView(sim, "g1").canFound).toBe(true);
    sim.setVar("g2.cleared", "false");
    expect(sim.crews.mayFound("g2")).toBe(false);
    sim.restrict("g3");
    expect(sim.crews.mayFound("g3")).toBe(false);
    sim.capture("g4");
    expect(sim.crews.mayFound("g4")).toBe(false);
    sim.reveal("Red");
    sim.join("g5", "Red");
    sim.setVar("Red.leader", "g5");
    expect(sim.crews.mayFound("g5")).toBe(false);
    sim.crew({ op: "foundCrew", by: "g1", name: "The Night Shift" });
    expect(sim.crews.crewOf("g1")?.name).toBe("The Night Shift");
    expect(sim.crews.mayFound("g1")).toBe(false); // one live faction per founder
    expect(guestView(sim, "g1").canFound).toBe(false);
  });
});

describe("faction mode: one faction at a time", () => {
  function open(): Sim {
    const sim = night();
    sim.setVar("Night.open", "true");
    sim.reveal("Red");
    sim.reveal("Blue");
    return sim;
  }

  it("founding or joining a crew leaves the side, with `unaligned`", () => {
    const sim = open();
    sim.join("g1", "Red");
    const evs = sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    expect(sim.factionMembers("Red")).toEqual([]);
    expect(sim.crews.factionOf("g1")).toBe("crew-1");
    expect(evs.some((e) => e.type === "signal" && e.name === "unaligned")).toBe(true);
    sim.join("g2", "Blue");
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    expect(sim.factionMembers("Blue")).toEqual([]);
    expect(sim.crews.get("crew-1")?.members).toEqual(["g1", "g2"]);
  });

  it("joining a side (join, defect, add, an invitation's yes) leaves the crew", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    sim.crew({ op: "joinCrew", person: "g3", crew: "crew-1" });
    sim.join("g2", "Red");
    expect(sim.crews.crewOf("g2")).toBeNull();
    expect(sim.crews.takeNotices().map((n) => n.kind)).toContain("left");
    sim.signal("noop");
    sim.crew({ op: "recruit", by: "g2", to: "g3", side: "Red" });
    sim.crew({ op: "recruitAnswer", id: "inv-1", yes: true });
    expect(sim.crews.crewOf("g3")).toBeNull();
    expect(sim.factionMembers("Red").sort()).toEqual(["g2", "g3"]);
    // `add` to a race side leaves the other side too.
    sim.join("g4", "Blue");
    sim.fireBeat("Hall");
    (sim as unknown as { addToGroup(p: string, g: string): void }).addToGroup("g4", "Red");
    expect(sim.groupsOf("g4")).toEqual(["Red"]);
    expect(sim.crews.factionOf("g4")).toBe("Red");
  });

  it("a story join's `left` notice survives the next op until taken", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "One" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    sim.crews.takeNotices();
    sim.join("g2", "Red");
    sim.crew({ op: "joinCrew", person: "g5", crew: "crew-1" });
    expect(sim.crews.takeNotices().map((n) => [n.kind, "person" in n ? n.person : null])).toEqual([
      ["left", "g2"],
      ["joined", "g5"],
    ]);
    expect(sim.crews.takeNotices()).toEqual([]);
  });

  it("a non-race group (Hosts) never touches a crew", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    (sim as unknown as { addToGroup(p: string, g: string): void }).addToGroup("g2", "Hosts");
    expect(sim.crews.crewOf("g2")?.id).toBe("crew-1");
    expect(sim.groupsOf("g2")).toEqual(["Hosts"]);
  });

  it("the founder leaving disbands the faction; members go back to neither", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    sim.crews.takeNotices();
    sim.crew({ op: "leaveCrew", person: "g1", crew: "crew-1" });
    expect(sim.crews.all()).toEqual([]);
    expect(sim.crews.crewOf("g2")).toBeNull();
    expect(sim.world.get("g2.crew").kind).toBe("null");
    expect(sim.crews.takeNotices().map((n) => n.kind)).toEqual(["dissolved"]);
    // A founder joining a side disbands theirs too.
    sim.crew({ op: "foundCrew", by: "g3", name: "Second" });
    sim.crew({ op: "joinCrew", person: "g4", crew: "crew-2" });
    sim.join("g3", "Red");
    expect(sim.crews.all()).toEqual([]);
  });

  it("a walk-in join refuses a restricted, captured, leading or founding program", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "One" });
    sim.crew({ op: "foundCrew", by: "g2", name: "Two" });
    sim.restrict("g3");
    sim.crew({ op: "joinCrew", person: "g3", crew: "crew-1" });
    sim.join("g4", "Red");
    sim.setVar("Red.leader", "g4");
    sim.crew({ op: "joinCrew", person: "g4", crew: "crew-1" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    expect(sim.crews.get("crew-1")?.members).toEqual(["g1"]);
    expect(sim.crews.get("crew-2")?.members).toEqual(["g2"]);
  });

  it("an invitation's yes is held to the walk-in rules: a founder or a leader can't take it", () => {
    const sim = open();
    // A founder saying yes to another crew's invitation: void, theirs lives.
    sim.crew({ op: "foundCrew", by: "g1", name: "One" });
    sim.crew({ op: "joinCrew", person: "g3", crew: "crew-1" });
    sim.crew({ op: "foundCrew", by: "g2", name: "Two" });
    sim.crew({ op: "crewInvite", by: "g2", to: "g1", crew: "crew-2" });
    sim.crews.takeNotices();
    sim.crew({ op: "crewAnswer", id: "inv-1", yes: true });
    expect(sim.crews.invite("inv-1")?.state).toBe("void");
    expect(sim.crews.get("crew-1")?.members).toEqual(["g1", "g3"]);
    expect(sim.crews.get("crew-2")?.members).toEqual(["g2"]);
    expect(sim.crews.takeNotices().map((n) => n.kind)).toEqual(["answered"]);
    // A side's leader saying yes to a crew: void, still on the side.
    sim.join("g4", "Red");
    sim.setVar("Red.leader", "g4");
    sim.crew({ op: "crewInvite", by: "g1", to: "g4", crew: "crew-1" });
    sim.crew({ op: "crewAnswer", id: "inv-2", yes: true });
    expect(sim.crews.invite("inv-2")?.state).toBe("void");
    expect(sim.crews.crewOf("g4")).toBeNull();
    expect(sim.factionMembers("Red")).toEqual(["g4"]);
    expect(sim.crews.founderOf("Red")).toBe("g4");
    // A founder saying yes to a side: void, their faction lives.
    sim.crew({ op: "recruit", by: "g4", to: "g2", side: "Red" });
    sim.crew({ op: "recruitAnswer", id: "inv-3", yes: true });
    expect(sim.crews.invite("inv-3")?.state).toBe("void");
    expect(sim.crews.get("crew-2")?.members).toEqual(["g2"]);
    expect(sim.factionMembers("Red")).toEqual(["g4"]);
    // Another side's leader saying yes to a side: void.
    sim.join("g5", "Blue");
    sim.setVar("Blue.leader", "g5");
    sim.crew({ op: "recruit", by: "g4", to: "g5", side: "Red" });
    sim.crew({ op: "recruitAnswer", id: "inv-4", yes: true });
    expect(sim.crews.invite("inv-4")?.state).toBe("void");
    expect(sim.factionMembers("Blue")).toEqual(["g5"]);
  });

  it("founding settles the founder's open invitations, crew and side", () => {
    const sim = open();
    sim.crew({ op: "foundCrew", by: "g1", name: "One" });
    sim.join("g4", "Red");
    sim.crew({ op: "crewInvite", by: "g1", to: "g2", crew: "crew-1" });
    sim.crew({ op: "recruit", by: "g4", to: "g2", side: "Red" });
    sim.crew({ op: "crewInvite", by: "g1", to: "g3", crew: "crew-1" });
    sim.crews.takeNotices();
    sim.crew({ op: "foundCrew", by: "g2", name: "Two" });
    expect(sim.crews.invite("inv-1")?.state).toBe("void");
    expect(sim.crews.invite("inv-2")?.state).toBe("void");
    expect(sim.crews.invite("inv-3")?.state).toBe("open");
    expect(sim.crews.openInvitesTo("g2")).toEqual([]);
    expect(sim.crews.takeNotices().map((n) => n.kind)).toEqual(["founded", "answered", "answered"]);
  });
});

describe("faction mode: the race", () => {
  it("any faction over the line wins, present programs only, and the story reads it", () => {
    const sim = night(5); // needs 5 / 2 + 1 = 3
    sim.setVar("Night.open", "true");
    sim.reveal("Red");
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    expect(sim.crews.needs()).toBe(3);
    expect(sim.crews.winner()).toBeNull();
    expect(str(sim, "Night.won")).toBe("none");
    sim.setVar("g5.gone", "true"); // 4 present: needs 3 still
    expect(sim.crews.presentTotal()).toBe(4);
    sim.setVar("g4.persona", "true"); // 3 present: needs 2
    expect(sim.crews.needs()).toBe(2);
    expect(sim.crews.winner()).toBe("crew-1");
    expect(str(sim, "Night.won")).toBe("crew-1");
    expect(str(sim, "Night.founder")).toBe("g1");
    expect(str(sim, "Night.name")).toBe("Night Shift");
    expect(str(sim, "g2.mine")).toBe("crew-1");
    expect(sim.crews.raceView()).toEqual({
      needs: 2,
      present: 3,
      winner: "crew-1",
      factions: [
        { id: "Red", name: "Red", kind: "side", founder: null, present: 0 },
        { id: "crew-1", name: "Night Shift", kind: "founded", founder: "P1", present: 2 },
      ],
    });
    expect(modView(sim, "open", null).race?.winner).toBe("crew-1");
  });

  it("a side wins the same way, and its leader is its founder", () => {
    const sim = night(3); // needs 2
    sim.setVar("Night.open", "true");
    sim.reveal("Blue");
    sim.join("g3", "Blue");
    sim.setVar("Blue.leader", "P3");
    expect(sim.crews.winner()).toBeNull();
    sim.join("g2", "Blue");
    expect(sim.crews.winner()).toBe("Blue");
    expect(sim.crews.founderOf("Blue")).toBe("g3");
    expect(str(sim, "Night.founder")).toBe("g3");
  });

  it("a hidden side does not race until revealed", () => {
    const sim = night(3);
    sim.join("g1", "Red");
    sim.join("g2", "Red");
    expect(sim.crews.raceFactions()).toEqual([]);
    expect(sim.crews.winner()).toBeNull();
    sim.reveal("Red");
    expect(sim.crews.winner()).toBe("Red");
  });
});

describe("faction mode: who sees what", () => {
  function race(): Sim {
    const sim = night(5);
    sim.setVar("Night.open", "true");
    sim.reveal("Red");
    sim.join("g4", "Red");
    sim.setVar("Red.leader", "g4");
    sim.join("g5", "Red");
    sim.crew({ op: "foundCrew", by: "g1", name: "Night Shift" });
    sim.crew({ op: "joinCrew", person: "g2", crew: "crew-1" });
    return sim;
  }

  it("counts, threshold and `more` only on the viewer's own row", () => {
    const sim = race();
    const g2 = guestView(sim, "g2").sides!;
    expect(g2).toEqual([
      { id: "Red", name: "Red", leader: "P4", mine: false, kind: "side", ethos: "stay forever", founder: "P4" },
      { id: "crew-1", name: "Night Shift", leader: "P1", members: 2, needs: 3, more: 1, mine: true, kind: "founded", founder: "P1" },
    ]);
    const g5 = guestView(sim, "g5").sides!;
    expect(g5[0]).toMatchObject({ id: "Red", members: 2, needs: 3, more: 1, mine: true });
    expect(g5[1]).not.toHaveProperty("members");
    expect(g5[1]).not.toHaveProperty("needs");
    const g3 = guestView(sim, "g3").sides!;
    for (const row of g3) expect(row).not.toHaveProperty("members");
    expect(guestView(sim, "g3").canFound).toBe(true);
  });

  it("People cards show a faction only to its own members, or for its founder / leader", () => {
    const sim = race();
    const card = (viewer: string, who: string) => guestView(sim, viewer).people.find((p) => p.id === who)!;
    // g3 (in nothing) sees the founder and the leader, nobody else's faction.
    expect(card("g3", "g1").groups).toEqual(["Night Shift"]);
    expect(card("g3", "g4")).toMatchObject({ faction: "Red", groups: ["Red"] });
    expect(card("g3", "g2")).toMatchObject({ groups: [] });
    expect(card("g3", "g5")).toMatchObject({ faction: null, groups: [] });
    // A member sees their own faction's members.
    expect(card("g1", "g2").groups).toEqual(["Night Shift"]);
    expect(card("g4", "g5")).toMatchObject({ faction: "Red", groups: ["Red"] });
    expect(card("g4", "g2").groups).toEqual([]);
  });
});

describe("faction mode: replay", () => {
  it("the same journal plays the same night", () => {
    const steps = [
      { m: "person", id: "g1", name: "P1" },
      { m: "person", id: "g2", name: "P2" },
      { m: "person", id: "g3", name: "P3" },
      { m: "set", path: "Night.open", value: "true" },
      { m: "reveal", target: "Red" },
      { m: "join", person: "g3", faction: "Red" },
      { m: "crew", op: { op: "foundCrew", by: "g1", name: "Night Shift" } },
      { m: "crew", op: { op: "crewInvite", by: "g1", to: "g3", crew: "crew-1" } },
      { m: "crew", op: { op: "crewAnswer", id: "inv-1", yes: true } },
      { m: "crew", op: { op: "joinCrew", person: "g2", crew: "crew-1" } },
      { m: "crew", op: { op: "leaveCrew", person: "g1", crew: "crew-1" } },
    ] as const;
    const play = (): Sim => {
      const sim = Sim.fromSources(FACTIONS);
      playJournal(sim, steps as never);
      return sim;
    };
    const a = play();
    const b = play();
    expect(["g1", "g2", "g3"].map((g) => guestView(a, g))).toEqual(["g1", "g2", "g3"].map((g) => guestView(b, g)));
    expect(modView(a, "open", null)).toEqual(modView(b, "open", null));
    expect(a.log.all()).toEqual(b.log.all());
    expect(a.crews.all()).toEqual([]); // the founder left: disbanded
  });
});

describe("no `founding:` line: a wave 18 night is unchanged", () => {
  it("replays the crews journal to the views master (30ef8aa) built", () => {
    const want = JSON.parse(readFileSync(new URL("./fixtures/w18-crews-views.json", import.meta.url), "utf8")) as { guests: unknown[]; mod: unknown; log: unknown[] };
    const sim = Sim.fromSources(CREW_SOURCE);
    playJournal(sim);
    const got = JSON.parse(JSON.stringify({ guests: ["g1", "g2", "g3", "g4"].map((g) => guestView(sim, g)), mod: modView(sim, "open", null), log: sim.log.all() }));
    expect(got.log).toEqual(want.log);
    expect(got.guests).toEqual(want.guests);
    expect(got.mod).toEqual(want.mod);
    expect(modView(sim, "open", null)).not.toHaveProperty("race");
  });
});
