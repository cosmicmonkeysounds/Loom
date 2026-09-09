//! The Glass Orchard — the Loom 4 reference project (a garden-party
//! mystery, nothing to do with the Internet). Plays the example end to
//! end through the public `Sim` API the way the event server does.

import { describe, expect, it } from "vitest";
import { Sim, namedEvents } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles } from "../examples/load.ts";

function fresh(): Sim {
  return Sim.fromSources(...scenarioFiles("glass-orchard"));
}

function said(events: SimEvent[]): Array<[string, string]> {
  return events
    .filter((e) => e.type === "dialogue")
    .map((e) => [(e as { speaker: string }).speaker, (e as { text: string }).text]);
}
function narrated(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === "action").map((e) => (e as { text: string }).text);
}
function replies(events: SimEvent[]): string[] {
  return events.filter((e) => e.type === "respond").map((e) => (e as { text: string }).text);
}

describe("The Glass Orchard — compile", () => {
  it("indexes every declaration under its human name", () => {
    const sim = fresh();
    expect([...sim.model.factions.keys()].sort()).toEqual(["The Collectors", "The Gardeners", "The Society"]);
    expect(sim.model.factions.get("The Society")!.hidden).toBe(true);
    expect([...sim.model.locations.keys()].sort()).toEqual([
      "Orchard Gate",
      "The Cellar",
      "The Glasshouse",
      "The Long Table",
    ]);
    expect([...sim.model.characters.keys()].sort()).toEqual([
      "Dr Sable Quill",
      "Ivo Marsh",
      "Mara Vell",
      "The Cold Frame",
      "The Gatekeeper",
      "The Letterbox",
      "The Sundial",
      "The Wine Rack",
    ]);
    expect(sim.model.defaultRole).toBe("Guest");
    expect(sim.model.entry).toBe("The Front Gate");
    expect(sim.model.beats.has("Ivo Marsh.Receive")).toBe(true);
    expect(sim.model.beats.has("The Gatekeeper.Check")).toBe(true);
    expect(sim.model.beats.has("The Glasshouse at Night")).toBe(true);
  });

  it("enumerates the story's own events and keeps watchers out of the list", () => {
    const sim = fresh();
    expect(namedEvents(sim.model)).toEqual(["lock_the_cellar", "ring the bell", "the_toast", "unlocked", "whisper"]);
    expect([...sim.model.interactions.keys()]).toEqual(["whisper", "ring the bell"]);
    expect(sim.model.rules.map((r) => r.verb || r.condition)).toEqual(["ring the bell", "Tension > 80"]);
    expect(sim.model.theme).toBe("plain");
    const guest = sim.model.roles.get("Guest")!;
    expect(guest.hooks.filter((h) => h.condition !== null).map((h) => h.condition)).toEqual([
      "self.suspicion >= 70",
    ]);
  });

  it("applies a parameterised trait with a spaced beat name", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const ev = sim.scan("The Sundial", "g1");
    expect(ev.some((e) => e.type === "beatEntered" && e.beat === "The Sundial Speaks")).toBe(true);
    expect(sim.world.get("g1.suspicion")).toEqual({ kind: "number", value: 10 });
  });
});

describe("The Glass Orchard — an evening", () => {
  it("welcomes a new guest through the role's `someone joins` hook", () => {
    const sim = fresh();
    const ev = sim.createPerson("g1", "Ada");
    expect(replies(ev)).toEqual(["Welcome to the orchard. Keep your invitation where it can be scanned."]);
    expect(sim.world.get("g1.suspicion")).toEqual({ kind: "number", value: 0 });
    expect(sim.world.get("g1.favour")).toEqual({ kind: "number", value: 10 });
  });

  it("opens with the gate, the table, and a side to choose", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const ev = sim.fireBeat("The Front Gate", "g1");
    expect(narrated(ev)[0]).toContain("The gate is open.");
    expect(said(ev)).toContainEqual(["Ivo Marsh", "Sit anywhere. Not there. Anywhere but there."]);
    // `each visit` → first arm on the first visit.
    expect(narrated(ev)).toContain("A place is laid at the head of the table. Nobody sits in it.");
    const prompt = ev.find((e) => e.type === "choicePrompted") as { options: string[] };
    expect(prompt.options).toEqual([
      "Ask a Gardener about the rosemary.",
      "Ask a Collector about the keys.",
      "Say nothing and eat.",
    ]);
    // Take a side: the group hook pins the rosemary.
    const after = sim.choose("g1", 0);
    expect(after.some((e) => e.type === "choicePrompted")).toBe(true);
    const chosen = sim.choose("g1", 0); // Rosemary.
    expect(sim.factionOf("g1")).toBe("The Gardeners");
    expect(replies(chosen)).toContain("A sprig of rosemary is pinned to your lapel.");
    // Back at the table: second visit → `then` arm.
    expect(narrated(chosen)).toContain("The place at the head of the table has been cleared away.");
  });

  it("scanning Ivo runs his owned beat as himself, and his calm watcher fires the toast", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const ev = sim.scan("Ivo Marsh", "g1");
    expect(said(ev)[0]).toEqual(["Ivo Marsh", "Ada. You came. She'd have been glad."]);
    expect(sim.world.get("Ivo Marsh.trusts.g1")).toEqual({ kind: "number", value: 35 });
    // Ask the question twice: calm 60 → 45 → 30 … the third asks trips the toast.
    sim.choose("g1", 0);
    sim.scan("Ivo Marsh", "g1");
    sim.choose("g1", 0);
    sim.scan("Ivo Marsh", "g1");
    const third = sim.choose("g1", 0);
    expect(said(third)).toContainEqual(["Ivo Marsh", "A toast. To my sister, wherever she has got to."]);
    expect(sim.world.get("Ivo Marsh.calm")).toEqual({ kind: "number", value: 60 });
  });

  it("too much suspicion sends a guest below, with a private reply and a scene", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.scan("The Letterbox", "g1");
    const take = sim.choose("g1", 0); // Take one. (+15)
    expect(replies(take)).toContain("You slip an invitation into your pocket. It is addressed to nobody.");
    sim.scan("The Sundial", "g1"); // +10 → 25
    sim.arrive("g1", "The Glasshouse"); // +5 → 30
    sim.scan("The Cold Frame", "g1"); // +10 → 40
    sim.scan("Dr Sable Quill", "g1"); // no side → +0
    const roots = sim.choose("g1", 0); // Look at the roots. (+25 → 65)
    expect(narrated(roots)).toContain("They run in one direction, all of them. Down.");
    expect(sim.world.get("g1.below")).toEqual({ kind: "bool", value: false });
    const over = sim.scan("The Sundial", "g1"); // +10 → 75 ≥ 70: the watcher fires
    expect(replies(over)).toContain('Someone takes your elbow. "This way. Mind the step."');
    expect(sim.locationOf("g1")).toBe("The Cellar");
    expect(sim.world.get("g1.below")).toEqual({ kind: "bool", value: true });
    expect(sim.world.get("g1.suspicion")).toEqual({ kind: "number", value: 0 });
    expect(over.find((e) => e.type === "broadcast")).toMatchObject({ cue: "lantern_low", audience: ["g1"] });
    expect(said(over)).toContainEqual([
      "Mara Vell",
      "You found me. Everyone finds me eventually. The trick is getting out again.",
    ]);
  });

  it("a Collector below can free Mara: named event, group moves, and the reveal", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.join("g1", "The Collectors");
    sim.setVar("g1.suspicion", "70"); // straight to the cellar via the watcher
    expect(sim.locationOf("g1")).toBe("The Cellar");
    const ev = sim.choose("g1", 0); // Give her the key.
    expect(said(ev)).toContainEqual(["Mara Vell", "Ada? Is that you? Bring the key."]);
    expect(sim.factionOf("g1")).toBe("The Society");
    expect(sim.factionMembers("The Collectors")).toEqual([]);
    expect(sim.factionRevealed("The Society")).toBe(true);
    expect(narrated(ev).at(-1)).toContain("The lantern goes out");
  });

  it("the Gatekeeper's patience watcher chains into a story-wide event", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    expect(sim.world.get("The Gatekeeper.patience")).toEqual({ kind: "number", value: 3 });
    for (let i = 0; i < 3; i++) {
      sim.arrive("g1", "The Cellar");
      sim.arrive("g1", "The Long Table");
    }
    expect(sim.world.get("The Gatekeeper.patience")).toEqual({ kind: "number", value: 0 });
    const line = sim.log.all().find((e) => e.type === "dialogue" && e.speaker === "Dr Sable Quill");
    expect(line).toMatchObject({ text: "Someone has locked the cellar. From the inside." });
  });

  it("a guest interaction runs a house rule; a performer interaction runs as that character", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    sim.arrive("g1", "Orchard Gate");
    const bell = sim.signal("ring the bell", "g1");
    expect(bell.find((e) => e.type === "broadcast")).toMatchObject({
      cue: '"The bell by the gate rings. Ada is standing under it."',
      audience: ["g1"],
    });
    expect(sim.world.get("g1.suspicion")).toEqual({ kind: "number", value: 5 });
    // Whispered as the Gatekeeper: only the Gatekeeper's hook answers.
    const w = sim.signal("whisper", "g1", null, "The Gatekeeper");
    expect(said(w)).toEqual([["The Gatekeeper", "Not here. After the toast, by the cold frame."]]);
    expect(sim.world.get("g1.suspicion")).toEqual({ kind: "number", value: 15 });
  });

  it("a whole-line `cycle` advances per visit", () => {
    const sim = fresh();
    sim.createPerson("g1", "Ada");
    const a = narrated(sim.scan("The Wine Rack", "g1"));
    const b = narrated(sim.scan("The Wine Rack", "g1"));
    expect(a).toContain("One bottle is warm.");
    expect(b).toContain("One bottle is missing.");
  });
});
