//! Loom 4 — Slice 2 (docs/loom-4.md §9.2, §9.3, §8, §13).
//!
//! Story-level `when` rules, event arguments, additive group membership,
//! loose-spelling rename, INTERACTION declarations, and the workspace
//! name lints.

import { describe, expect, it } from "vitest";
import { parse, Code } from "../src/parser/index.ts";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { Workspace } from "../src/lsp/index.ts";

function said(events: SimEvent[]): Array<[string, string]> {
  return events
    .filter((e) => e.type === "dialogue")
    .map((e) => [(e as { speaker: string }).speaker, (e as { text: string }).text]);
}
function narrated(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === "action").map((e) => (e as { text: string }).text);
}

const RULES = `# Rules
start: Gate

GROUP Rebels
  ethos: freedom

LOCATION Cellar
  label: Cellar

ROLE Guest
  heat: 0 to 100 = 0

CHARACTER Warden
  when alarm:
    Warden: Level {level}. {who.name} tripped it.

INTERACTION knock
  label: Knock on the door
  who: guest

// Story-level rules — no owner, no self.
when lockdown:
  Narrator: Every door in the house locks at once.

when guest arrives at Cellar:
  set guest.heat += 10

when Tension > 80:
  fire lockdown

when knock for guest:
  reply Nobody answers.

== Gate
Narrator: The gate.
* Raise the alarm.
  fire alarm for guest with level: 3, who: guest
`;

describe("story-level when rules (§9.3)", () => {
  it("parses a top-level `when …:` into a rule item, and keeps it prose inside a beat", () => {
    const [file, diags] = parse(`when lockdown:
  Narrator: Doors.

== Beat
when the bell rang, nobody moved.
`);
    expect(diags).toHaveLength(0);
    const rule = file.items[0]!;
    expect(rule.kind).toBe("rule");
    if (rule.kind !== "rule") throw new Error("rule");
    expect(rule.value.event).toBe("lockdown");
    expect(rule.value.body).toHaveLength(1);
    const beat = file.items[1]!;
    if (beat.kind !== "beat") throw new Error("beat");
    expect(beat.value.body[0]).toMatchObject({ kind: "action", value: { value: "when the bell rang, nobody moved." } });
  });

  it("compiles rules into ownerless hooks and lists their events for the director", () => {
    const sim = Sim.fromSources(RULES);
    expect(sim.model.rules.map((r) => [r.verb, r.param, r.filter, r.condition])).toEqual([
      ["lockdown", null, null, null],
      ["enters", "guest", "Cellar", null],
      ["", null, null, "Tension > 80"],
      ["knock", "guest", null, null],
    ]);
    expect(namedEvents(sim.model)).toEqual(["alarm", "knock", "lockdown"]);
  });

  it("runs event rules, movement rules, and condition rules with no self", () => {
    const sim = Sim.fromSources(RULES);
    sim.createPerson("g1", "Ada");
    const ev = sim.arrive("g1", "Cellar");
    expect(sim.world.get("g1.heat")).toEqual({ kind: "number", value: 10 });
    expect(ev.some((e) => e.type === "diagnostic")).toBe(false);
    const locked = sim.setVar("Tension", "90");
    expect(narrated(locked)).toContain("Every door in the house locks at once.");
    // The watcher re-arms only once the condition drops.
    expect(narrated(sim.setVar("Tension", "95"))).toEqual([]);
    sim.setVar("Tension", "10");
    expect(narrated(sim.setVar("Tension", "85"))).toContain("Every door in the house locks at once.");
  });
});

describe("event arguments (§9.2)", () => {
  it("`fire x with k: v` binds the arguments in every listening body", () => {
    const sim = Sim.fromSources(RULES);
    sim.createPerson("g1", "Ada");
    sim.fireBeat("Gate", "g1");
    const ev = sim.choose("g1", 0);
    expect(said(ev)).toContainEqual(["Warden", "Level 3. Ada tripped it."]);
    // The argument keys stay out of the director's world view.
    expect(sim.worldEntries().some((e) => e.path.startsWith("event#"))).toBe(false);
  });

  it("the operator's signal() carries JSON arguments the same way", () => {
    const sim = Sim.fromSources(RULES);
    sim.createPerson("g1", "Ada");
    const ev = sim.signal("alarm", "g1", { level: 7, who: "g1" });
    expect(said(ev)).toContainEqual(["Warden", "Level 7. Ada tripped it."]);
  });

  it("a declared INTERACTION is a named event the app fires for a participant", () => {
    const sim = Sim.fromSources(RULES);
    expect([...sim.model.interactions.values()]).toEqual([
      { id: "knock", label: "Knock on the door", who: "guest", description: null },
    ]);
    sim.createPerson("g1", "Ada");
    const ev = sim.signal("knock", "g1");
    expect(ev.find((e) => e.type === "respond")).toMatchObject({ to: "g1", text: "Nobody answers." });
  });
});

describe("groups are additive (§8)", () => {
  const SRC = `GROUP Gardeners
  ethos: tend
GROUP Collectors
  ethos: take
GROUP Society
  hidden: true

ROLE Guest
  x: 0 to 1 = 0

CHARACTER Host
  when enlist for guest:
    add guest to Gardeners
  when initiate for guest:
    add guest to Society
  when expel for guest:
    remove guest from Gardeners

== x
  Nothing.
`;
  it("`add` keeps existing memberships; `group` is the primary, `groups` lists all", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    sim.signal("enlist", "g1");
    sim.signal("initiate", "g1");
    expect(sim.factionOf("g1")).toBe("Gardeners");
    expect(sim.groupsOf("g1")).toEqual(["Gardeners", "Society"]);
    expect(sim.world.get("g1.groups")).toEqual({
      kind: "list",
      items: [
        { kind: "string", value: "Gardeners" },
        { kind: "string", value: "Society" },
      ],
    });
    expect(sim.factionMembers("Society")).toEqual(["g1"]);
    // The public view still masks the hidden group.
    expect(sim.publicFactionOf("g1")).toBe("Gardeners");
  });

  it("`remove` of the primary promotes the next membership; v3 `join` still switches", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Ada");
    sim.signal("enlist", "g1");
    sim.signal("initiate", "g1");
    sim.signal("expel", "g1");
    expect(sim.factionOf("g1")).toBe("Society");
    expect(sim.groupsOf("g1")).toEqual(["Society"]);
    sim.join("g1", "Collectors");
    expect(sim.factionOf("g1")).toBe("Collectors");
    expect(sim.groupsOf("g1")).toEqual(["Collectors"]);
  });
});

describe("workspace: loose rename + name lints (§3, §13)", () => {
  it("renames a beat with a spaced name and rewrites loosely spelled references", () => {
    const ws = new Workspace();
    ws.open("file:///main.loom", `start: the front gate

== The Front Gate
Ivo: Hello.
-> the_front_gate

== Other
-> The Front Gate
`);
    const edits = ws.renameBeat("The Front Gate", "The Orchard Gate");
    const doc = edits.get("file:///main.loom")!;
    expect(doc.map((e) => e.replacement)).toEqual(["The Orchard Gate", "The Orchard Gate", "The Orchard Gate", "The Orchard Gate"]);
  });

  it("warns on an undeclared `Name:` speaker only once characters are declared, and on ambiguous names", () => {
    const ws = new Workspace();
    const uri = "file:///main.loom";
    ws.open(uri, `CHARACTER Ivo Marsh
  voice: low

CHARACTER ivo_marsh
  voice: high

== Gate
Ivo Marsh: Hello.
IVO MARSH: Hello again.
Narrator: A gate.
Note: this one is not a person.
Self: Fine.

== gate
Nothing.
`);
    const diags = ws.diagnosticsFor(uri)!.diagnostics;
    const codes = diags.map((d) => d.code);
    expect(codes.filter((c) => c === Code.L1201UnknownSpeaker)).toHaveLength(1);
    expect(diags.find((d) => d.code === Code.L1201UnknownSpeaker)!.message).toContain("`Note`");
    // Two declarations and two beats fold to the same name.
    expect(codes.filter((c) => c === Code.L1202AmbiguousName)).toHaveLength(2);
  });

  it("stays silent about speakers when the project declares no characters", () => {
    const ws = new Workspace();
    ws.open("file:///a.loom", `== Gate
Note: nothing declared here.
`);
    expect(ws.diagnosticsFor("file:///a.loom")!.diagnostics).toHaveLength(0);
  });
});
