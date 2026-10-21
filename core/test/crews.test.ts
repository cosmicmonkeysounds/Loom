//! Wave 18 (C10) — crews + recruiting at the sim layer (`crews.ts`): one
//! `Sim.crew(op)` per change, a members-only `crew:<id>` room, the story
//! events, the caps, and that nothing a crew does touches a side or the
//! majority.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { MAX_CREWS, crewRoom, type CrewOp } from "../src/runtime/sim/crews.ts";
import { guestView } from "../server/views.ts";

export const CREW_SOURCE = `# Crew Night
start: Hall
directory: everyone
majority: Night.present / 2 + 1

GROUP Hosts
  joinable: false

GROUP Red
  rival: Blue
  hidden: true

GROUP Blue
  rival: Red
  hidden: true

LOCATION Hall
LOCATION Jail
  prison: true

CHARACTER Night
  present: 0 to 100 = 0
  founded: 0 to 100 = 0
  joins: 0 to 100 = 0
  crew_joins: 0 to 100 = 0
  side_joins: 0 to 100 = 0
  recruited: 0 to 100 = 0
  left: 0 to 100 = 0

ROLE Guest
  recruits: 0 to 100 = 0

when founded for guest:
  set Night.founded = Night.founded + 1

when guest joins:
  set Night.joins = Night.joins + 1

when guest joins Red:
  set Night.side_joins = Night.side_joins + 1

when recruited for guest:
  set Night.recruited = Night.recruited + 1
  set by.recruits = by.recruits + 1

when unaligned for guest:
  set Night.left = Night.left + 1

== Hall
  setting: Hall
Narrator: The hall.
`;

function night(): { sim: Sim; a: string; b: string; c: string } {
  const sim = Sim.fromSources(CREW_SOURCE);
  sim.createPerson("g1", "Ada");
  sim.createPerson("g2", "Bob");
  sim.createPerson("g3", "Cy");
  return { sim, a: "g1", b: "g2", c: "g3" };
}

const num = (sim: Sim, path: string): number => {
  const v = sim.world.get(path);
  return v.kind === "number" ? v.value : 0;
};

describe("crews — found, invite, join", () => {
  it("founds a namespaced crew, mirrors it in the world and fires `founded`", () => {
    const { sim, a } = night();
    sim.crew({ op: "foundCrew", by: a, name: "  The   Night Shift " });
    const crew = sim.crews.crewOf(a)!;
    expect(crew.id).toBe("crew-1");
    expect(crew.name).toBe("The Night Shift");
    expect(sim.world.get("crew-1.name")).toEqual({ kind: "string", value: "The Night Shift" });
    expect(sim.world.get(`${a}.crew`)).toEqual({ kind: "string", value: "crew-1" });
    expect(num(sim, "Night.founded")).toBe(1);
    // A crew is never a group: no side, no `who.groups` entry.
    expect(sim.factionOf(a)).toBeNull();
    expect(sim.groupsOf(a)).toEqual([]);
  });

  it("gives the crew a members-only room", () => {
    const { sim, a, b } = night();
    sim.crew({ op: "foundCrew", by: a, name: "Night Shift" });
    const room = crewRoom("crew-1");
    expect(sim.canSeeChannel(a, room)).toBe(true);
    expect(sim.canSeeChannel(b, room)).toBe(false);
    expect(sim.canPost(a, room)).toBe(true);
    expect(sim.canPost(b, room)).toBe(false);
    expect(sim.visibleChannelsFor(a).some((c) => c.id === room && c.kind === "faction" && c.title === "Night Shift")).toBe(true);
    expect(sim.visibleChannelsFor(b).some((c) => c.id === room)).toBe(false);
    expect(sim.channelHead(room)).toMatchObject({ channel: room, channelKind: "faction", title: "Night Shift" });
    const said = sim.say(a, room, "hi crew");
    const chat = said.find((e) => e.type === "chat");
    expect(chat).toMatchObject({ channel: room, audience: [a] });
  });

  it("an invitation's yes joins the crew, fires `join` + `recruited` (by the inviter)", () => {
    const { sim, a, b } = night();
    sim.crew({ op: "foundCrew", by: a, name: "Night Shift" });
    sim.crew({ op: "crewInvite", by: a, to: b, crew: "crew-1" });
    const view = guestView(sim, b);
    expect(view.invites).toEqual([{ id: "inv-1", from: a, fromName: "Ada", kind: "crew", target: "crew-1", targetName: "Night Shift" }]);
    expect(sim.crews.takeNotices().map((n) => n.kind)).toEqual(["invite"]); // what the route posts…
    expect(sim.crews.takeNotices()).toEqual([]); // …once
    sim.crew({ op: "crewAnswer", id: "inv-1", yes: true });
    expect(sim.crews.crewOf(b)?.id).toBe("crew-1");
    expect(num(sim, "Night.joins")).toBe(1); // `when guest joins:` hears a crew join
    expect(num(sim, "Night.side_joins")).toBe(0); // a side's filtered hook never does
    expect(num(sim, "Night.recruited")).toBe(1);
    expect(num(sim, `${a}.recruits`)).toBe(1);
    expect(guestView(sim, b).invites).toEqual([]);
    expect(guestView(sim, b).crew).toMatchObject({ id: "crew-1", name: "Night Shift", founder: a, members: [a, b], memberNames: ["Ada", "Bob"], room: "crew:crew-1" });
    expect(sim.say(b, crewRoom("crew-1"), "yo").find((e) => e.type === "chat")).toMatchObject({ audience: [a, b] });
  });

  it("a no closes the invitation and changes nothing", () => {
    const { sim, a, b } = night();
    sim.crew({ op: "foundCrew", by: a, name: "Night Shift" });
    sim.crew({ op: "crewInvite", by: a, to: b, crew: "crew-1" });
    sim.crew({ op: "crewAnswer", id: "inv-1", yes: false });
    expect(sim.crews.crewOf(b)).toBeNull();
    expect(sim.crews.invite("inv-1")?.state).toBe("no");
    // An answered invitation can't be answered again.
    sim.crew({ op: "crewAnswer", id: "inv-1", yes: true });
    expect(sim.crews.crewOf(b)).toBeNull();
  });

  it("a guest is in one crew: joining another leaves the first, and an empty crew dissolves", () => {
    const { sim, a, b, c } = night();
    sim.crew({ op: "foundCrew", by: a, name: "One" });
    sim.crew({ op: "foundCrew", by: b, name: "Two" });
    sim.crew({ op: "crewInvite", by: a, to: c, crew: "crew-1" });
    sim.crew({ op: "crewAnswer", id: "inv-1", yes: true });
    sim.crew({ op: "crewInvite", by: b, to: c, crew: "crew-2" });
    sim.crew({ op: "crewAnswer", id: "inv-2", yes: true });
    expect(sim.crews.crewOf(c)?.id).toBe("crew-2");
    expect(sim.crews.get("crew-1")?.members).toEqual([a]);
    sim.crew({ op: "leaveCrew", person: a, crew: "crew-1" });
    expect(sim.crews.get("crew-1")).toBeNull();
    expect(sim.world.peek("crew-1.name")).toBeNull();
    expect(sim.world.get(`${a}.crew`)).toEqual({ kind: "null" });
  });

  it("dissolve voids its open invitations; rename keeps the id", () => {
    const { sim, a, b } = night();
    sim.crew({ op: "foundCrew", by: a, name: "One" });
    sim.crew({ op: "renameCrew", crew: "crew-1", name: "Uno" });
    expect(sim.crews.get("crew-1")?.name).toBe("Uno");
    expect(sim.channelHead(crewRoom("crew-1")).title).toBe("Uno");
    sim.crew({ op: "crewInvite", by: a, to: b, crew: "crew-1" });
    sim.crew({ op: "dissolveCrew", crew: "crew-1" });
    expect(sim.crews.all()).toEqual([]);
    expect(sim.crews.invite("inv-1")?.state).toBe("void");
    expect(sim.canSeeChannel(a, crewRoom("crew-1"))).toBe(false);
  });
});

describe("crews — caps", () => {
  it("one live crew founded per guest, unique names, at most eight", () => {
    const sim = Sim.fromSources(CREW_SOURCE);
    for (let i = 1; i <= 10; i++) sim.createPerson(`g${i}`, `Guest ${i}`);
    sim.crew({ op: "foundCrew", by: "g1", name: "First" });
    sim.crew({ op: "foundCrew", by: "g1", name: "Second" }); // already founded one
    expect(sim.crews.all().map((c) => c.name)).toEqual(["First"]);
    sim.crew({ op: "foundCrew", by: "g2", name: "first" }); // same name, folded
    expect(sim.crews.all()).toHaveLength(1);
    for (let i = 2; i <= 10; i++) sim.crew({ op: "foundCrew", by: `g${i}`, name: `Crew ${i}` });
    expect(sim.crews.all()).toHaveLength(MAX_CREWS);
    expect(sim.crews.foundedBy("g10")).toBeNull();
  });

  it("an invitation twice is one invitation", () => {
    const { sim, a, b } = night();
    sim.crew({ op: "foundCrew", by: a, name: "One" });
    sim.crew({ op: "crewInvite", by: a, to: b, crew: "crew-1" });
    sim.crew({ op: "crewInvite", by: a, to: b, crew: "crew-1" });
    expect(sim.crews.openInvitesTo(b)).toHaveLength(1);
  });
});

describe("recruiting into a side", () => {
  it("a side invitation's yes is the switching join; from the other side, a defect", () => {
    const { sim, a, b, c } = night();
    sim.reveal("Red");
    sim.reveal("Blue");
    sim.join(a, "Red");
    sim.join(c, "Blue");
    sim.crew({ op: "recruit", by: a, to: b, side: "Red" });
    expect(guestView(sim, b).invites).toEqual([{ id: "inv-1", from: a, fromName: "Ada", kind: "side", target: "Red", targetName: "Red" }]);
    const out = sim.crew({ op: "recruitAnswer", id: "inv-1", yes: true });
    expect(out.some((e) => e.type === "joined" && e.person === b && e.faction === "Red")).toBe(true);
    expect(sim.factionOf(b)).toBe("Red");
    expect(num(sim, "Night.side_joins")).toBe(2); // Ada's own join, then Bob's
    expect(num(sim, `${a}.recruits`)).toBe(1);
    sim.crew({ op: "recruit", by: a, to: c, side: "Red" });
    const out2 = sim.crew({ op: "recruitAnswer", id: "inv-2", yes: true });
    expect(out2.some((e) => e.type === "defected" && e.person === c && e.from === "Blue" && e.to === "Red")).toBe(true);
    expect(sim.factionMembers("Blue")).toEqual([]);
    expect(sim.factionMembers("Red").sort()).toEqual([a, b, c].sort());
  });

  it("leaving a side is back to neither", () => {
    const { sim, a } = night();
    sim.reveal("Red");
    sim.join(a, "Red");
    sim.crew({ op: "leaveSide", person: a });
    expect(sim.factionOf(a)).toBeNull();
    expect(sim.factionMembers("Red")).toEqual([]);
    expect(sim.groupsOf(a)).toEqual([]);
    expect(num(sim, "Night.left")).toBe(1);
  });

  it("crews never touch a side or its members (the majority is untouched)", () => {
    const { sim, a, b, c } = night();
    sim.reveal("Red");
    sim.join(a, "Red");
    sim.join(b, "Red");
    const before = { red: sim.factionMembers("Red"), fa: sim.factionOf(a), ga: sim.groupsOf(a), wg: sim.world.get(`${a}.groups`) };
    const ops: CrewOp[] = [
      { op: "foundCrew", by: a, name: "Shift" },
      { op: "crewInvite", by: a, to: b, crew: "crew-1" },
      { op: "crewAnswer", id: "inv-1", yes: true },
      { op: "crewInvite", by: a, to: c, crew: "crew-1" },
      { op: "crewAnswer", id: "inv-2", yes: true },
      { op: "renameCrew", crew: "crew-1", name: "Graveyard" },
      { op: "leaveCrew", person: b, crew: "crew-1" },
      { op: "dissolveCrew", crew: "crew-1" },
    ];
    for (const op of ops) sim.crew(op);
    expect(sim.factionMembers("Red")).toEqual(before.red);
    expect(sim.factionOf(a)).toBe(before.fa);
    expect(sim.groupsOf(a)).toEqual(before.ga);
    expect(sim.world.get(`${a}.groups`)).toEqual(before.wg);
    expect(sim.factionOf(c)).toBeNull();
  });
});

describe("crews — views", () => {
  it("sides lists only open sides with present counts, leader and the header's majority", () => {
    const { sim, a, b } = night();
    expect(guestView(sim, a).sides).toEqual([]); // both hidden, Hosts not joinable
    sim.reveal("Red");
    sim.join(a, "Red");
    sim.join(b, "Red");
    sim.setVar(`${b}.gone`, "true");
    sim.setVar("Night.present", "5");
    sim.setVar("Red.leader", a);
    const sides = guestView(sim, a).sides!;
    expect(sides).toEqual([{ id: "Red", name: "Red", leader: "Ada", members: 1, needs: 3, mine: true }]);
    expect(guestView(sim, b).sides![0]!.mine).toBe(true);
  });

  it("a story with no `majority:` line omits needs", () => {
    const sim = Sim.fromSources(CREW_SOURCE.replace("majority: Night.present / 2 + 1\n", ""));
    sim.createPerson("g1", "Ada");
    sim.reveal("Red");
    expect(guestView(sim, "g1").sides).toEqual([{ id: "Red", name: "Red", leader: null, members: 0, mine: false }]);
  });

  it("person cards carry every visible group plus the crew's name", () => {
    const { sim, a, b } = night();
    sim.join(a, "Red"); // hidden: not a badge until revealed
    sim.crew({ op: "foundCrew", by: a, name: "Shift" });
    const card = () => guestView(sim, b).people.find((p) => p.id === a)!;
    expect(card().groups).toEqual(["Shift"]);
    sim.reveal("Red");
    expect(card().groups).toEqual(["Red", "Shift"]);
  });
});
