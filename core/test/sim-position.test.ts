//! Story-position + world-snapshot projections — the data behind the
//! director's console: `beatEntered.subject`, `lastBeatOf`,
//! `visitedBeatsFor`, and `worldEntries`.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");

function fresh(): Sim {
  return Sim.fromSources(SCENARIO);
}

function entered(events: SimEvent[]): Array<{ beat: string; subject: string | null }> {
  return events
    .filter((e): e is Extract<SimEvent, { type: "beatEntered" }> => e.type === "beatEntered")
    .map((e) => ({ beat: e.beat, subject: e.subject }));
}

describe("per-person story position", () => {
  it("beatEntered carries the subject when a beat plays for a guest", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    const beat = sim.model.entry ?? [...sim.model.beats.keys()][0]!;
    const evs = entered(sim.fireBeat(beat, "g1"));
    expect(evs.length).toBeGreaterThan(0);
    expect(evs[0]).toEqual({ beat, subject: "g1" });
  });

  it("a subject-less global beat carries subject: null", () => {
    const sim = fresh();
    const beat = sim.model.entry ?? [...sim.model.beats.keys()][0]!;
    const evs = entered(sim.fireBeat(beat));
    expect(evs[0]!.subject).toBeNull();
  });

  it("lastBeatOf tracks the most recent beat entered for a person", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    expect(sim.lastBeatOf("g1")).toBeNull();
    const beat = sim.model.entry ?? [...sim.model.beats.keys()][0]!;
    sim.fireBeat(beat, "g1");
    // The position is wherever the run ended up — the LAST beat entered
    // for g1 (the entry may divert onward), never null once one played.
    const all = entered([...sim.log.all()]).filter((e) => e.subject === "g1");
    expect(sim.lastBeatOf("g1")).toBe(all[all.length - 1]!.beat);
  });

  it("visitedBeatsFor accumulates per-person visit counts", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    sim.createPerson("g2", "Bob");
    const beat = sim.model.entry ?? [...sim.model.beats.keys()][0]!;
    sim.fireBeat(beat, "g1");
    sim.fireBeat(beat, "g1");
    const visited = sim.visitedBeatsFor("g1");
    expect(visited[beat]).toBe(2);
    // Bob never moved — his trail is empty, not shared with Alice's.
    expect(sim.visitedBeatsFor("g2")).toEqual({});
  });
});

describe("setVar — the director's debugger write", () => {
  it("parses numbers, bools, and strings into typed world values", () => {
    const sim = fresh();
    sim.setVar("alarm_level", "3");
    sim.setVar("doors_sealed", "true");
    sim.setVar("weather", '"neon rain"');
    const entries = new Map(sim.worldEntries().map((e) => [e.path, e.value]));
    expect(entries.get("alarm_level")).toBe("3");
    expect(entries.get("doors_sealed")).toBe("true");
    expect(entries.get("weather")).toBe("neon rain"); // display() renders strings bare
  });

  it("routes person-standard fields through the real mutators", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    const moved = sim.setVar("g1.location", "Servers");
    expect(moved.some((e) => e.type === "arrived")).toBe(true);
    expect(sim.locationOf("g1")).toBe("Servers");
    // Occupancy bookkeeping stayed in sync (a raw world.set would not).
    const joined = sim.setVar("g1.faction", "Mods");
    expect(joined.some((e) => e.type === "joined")).toBe(true);
    expect(sim.factionMembers("Mods")).toContain("g1");
    sim.setVar("g1.captured", "true");
    expect(sim.isCaptured("g1")).toBe(true);
    sim.setVar("g1.score", "77");
    expect(sim.scoreOf("g1")).toBe(77);
  });

  it("a custom per-person variable lands as a plain worldSet", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    const evs = sim.setVar("g1.suspicion", "9");
    expect(evs.some((e) => e.type === "worldSet" && e.path === "g1.suspicion")).toBe(true);
    expect(new Map(sim.worldEntries().map((e) => [e.path, e.value])).get("g1.suspicion")).toBe("9");
  });
});

describe("world snapshot", () => {
  it("worldEntries lists every scalar as a display string, sorted", () => {
    const sim = fresh();
    sim.createPerson("g1", "Alice");
    sim.setScore("g1", 42);
    const entries = sim.worldEntries();
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("g1.name");
    expect(entries.find((e) => e.path === "g1.score")!.value).toBe("42");
    // Sorted by path (the World's BTreeMap contract).
    expect([...paths].sort()).toEqual(paths);
  });
});
