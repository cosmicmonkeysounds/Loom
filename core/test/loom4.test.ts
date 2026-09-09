//! Loom 4 — the human-first surface (docs/loom-4.md, Slice 1).
//!
//! Human names, `Name:` dialogue, keyword statements, `when` hooks with
//! the filler grammar, condition watchers, the generic world verbs, and
//! speaker canonicalisation. Every v3 form keeps parsing alongside.

import { describe, expect, it } from "vitest";
import {
  foldName,
  parse,
  scan,
  statementToDirective,
  type DialogueBlock,
  type LineKind,
} from "../src/parser/index.ts";
import { Sim, isConditionTrigger, namedEvents, parseTrigger } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";

function first(text: string): LineKind {
  const [lines] = scan(text);
  return lines[0]!.kind;
}

function dialogue(events: SimEvent[]): Array<{ speaker: string; text: string }> {
  return events
    .filter((e) => e.type === "dialogue")
    .map((e) => e as { speaker: string; text: string });
}

// ---------------------------------------------------------------------------
// §3 Names
// ---------------------------------------------------------------------------

describe("names fold loosely", () => {
  it("ignores case, underscores, hyphens, and runs of spaces", () => {
    expect(foldName("The Bell Tower at Dawn")).toBe("the bell tower at dawn");
    expect(foldName("the_bell-tower   at dawn")).toBe("the bell tower at dawn");
    expect(foldName("Cookie_Banner")).toBe(foldName("cookie banner"));
  });
});

// ---------------------------------------------------------------------------
// §4 Dialogue
// ---------------------------------------------------------------------------

describe("Name: dialogue", () => {
  it("lexes a one-line speech, a block cue, and a parenthetical head", () => {
    expect(first("Ivo: You came back.\n")).toEqual({
      kind: "speaker",
      text: "Ivo",
      inline: "You came back.",
      parenthetical: null,
    });
    expect(first("Ivo Marsh:\n")).toEqual({
      kind: "speaker",
      text: "Ivo Marsh",
      inline: null,
      parenthetical: null,
    });
    expect(first("Ivo (quietly): I wasn't sure.\n")).toEqual({
      kind: "speaker",
      text: "Ivo",
      inline: "I wasn't sure.",
      parenthetical: "quietly",
    });
    expect(first("Ivo | Mara: We both did.\n")).toMatchObject({ kind: "speaker", text: "Ivo | Mara" });
  });

  it("keeps lowercase keys as properties and ALL CAPS as a cue", () => {
    expect(first("cast: Wren, Player\n")).toEqual({ kind: "property", key: "cast", value: "Wren, Player" });
    expect(first("setting: Lighthouse\n").kind).toBe("property");
    expect(first("WREN\n")).toMatchObject({ kind: "speaker", text: "WREN", inline: null });
  });

  it("`\\\\` forces prose", () => {
    expect(first("\\Note: the bell has not rung.\n")).toEqual({
      kind: "prose",
      text: "Note: the bell has not rung.",
    });
  });

  it("parses inline speech as the block's first line, with continuation", () => {
    const [file, diags] = parse(`== Gate
Ivo (quietly): You came back.
  I wasn't sure you would.
Mara: I know.
`);
    expect(diags).toHaveLength(0);
    const item = file.items[0]!;
    if (item.kind !== "beat") throw new Error("beat");
    const beat = item.value;
    expect(beat.name).toBe("Gate");
    const [a, b] = beat.body as Array<{ kind: "dialogue"; value: DialogueBlock }>;
    expect(a!.value.speaker).toBe("Ivo");
    expect(a!.value.parenthetical).toBe("quietly");
    // A wrapped continuation joins the speech, as wrapped prose does under a cue.
    expect(a!.value.body.map((i) => (i.kind === "action" ? i.value.value : "?"))).toEqual([
      "You came back. I wasn't sure you would.",
    ]);
    expect(b!.value.speaker).toBe("Mara");
    expect(b!.value.body).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// §6 Statements
// ---------------------------------------------------------------------------

describe("keyword statements lower to directive text", () => {
  it("maps each verb onto the v3 directive it replaces", () => {
    expect(statementToDirective("set coins = 10")).toBe("set: coins = 10");
    expect(statementToDirective("set Ivo.trusts.Player += 5")).toBe("set: Ivo.trusts.Player += 5");
    expect(statementToDirective("if coins > 5:")).toBe("if: coins > 5");
    expect(statementToDirective("else if coins > 0:")).toBe("else if: coins > 0");
    expect(statementToDirective("else:")).toBe("else");
    expect(statementToDirective("else")).toBe("else");
    expect(statementToDirective("match weather:")).toBe("match: weather");
    expect(statementToDirective("each visit:")).toBe("each visit");
    expect(statementToDirective("after Mara.knows.truth:")).toBe("after: Mara.knows.truth");
    expect(statementToDirective("otherwise:")).toBe("otherwise");
    expect(statementToDirective("cue lx_dawn")).toBe("cue: lx_dawn");
    expect(statementToDirective("sound bell_toll")).toBe("sfx: bell_toll");
    expect(statementToDirective("pause")).toBe("pause");
    expect(statementToDirective("fire lockdown")).toBe("fire: lockdown");
    expect(statementToDirective("reply You pushed it too far.")).toBe("respond: You pushed it too far.");
    expect(statementToDirective("move guest to Cellar")).toBe("move: guest to Cellar");
    expect(statementToDirective("add guest to Rebels")).toBe("add: guest to Rebels");
    expect(statementToDirective("remove guest from Rebels")).toBe("remove: guest from Rebels");
    expect(statementToDirective("broadcast lights_out to group(Mods)")).toBe(
      "broadcast: lights_out to group(Mods)",
    );
    expect(statementToDirective("cycle Quiet. | Stars. | Calm.")).toBe("cycle: Quiet. | Stars. | Calm.");
    expect(statementToDirective("do haze 30%")).toBe("haze: 30%");
  });

  it("accepts the scope-only block form of broadcast", () => {
    expect(statementToDirective("broadcast to location(The Long Table):")).toBe(
      "broadcast: to location(The Long Table)",
    );
    const sim = Sim.fromSources(`LOCATION The Long Table
  label: x

ROLE Guest
  x: 0 to 1 = 0

== Table
  setting: The Long Table
broadcast to location(The Long Table):
  Narrator: Welcome to the orchard.
Fisher:
  cycle Quiet night. | Stars are out.
`);
    sim.createPerson("g1", "Ada");
    sim.arrive("g1", "The Long Table");
    const ev = sim.fireBeat("Table", "g1");
    expect(ev.find((e) => e.type === "broadcast")).toMatchObject({ cue: "", audience: ["g1"] });
    expect(ev.find((e) => e.type === "action")).toMatchObject({ text: "Welcome to the orchard." });
    expect(dialogue(ev).map((d) => [d.speaker, d.text])).toEqual([["Fisher", "Quiet night."]]);
  });

  it("leaves prose alone when a verb fails its shape", () => {
    expect(statementToDirective("if only she had stayed.")).toBeNull();
    expect(statementToDirective("set the table for two.")).toBeNull();
    expect(statementToDirective("move slowly through the dark.")).toBeNull();
    expect(statementToDirective("run!")).toBeNull();
    expect(statementToDirective("shuffle the deck")).toBeNull();
    expect(statementToDirective("fire and smoke everywhere")).toBeNull();
    expect(statementToDirective("If you look closely.")).toBeNull();
    expect(statementToDirective("pause for a beat")).toBeNull();
  });

  it("parses if / else if / else, match, each visit, and let inside a beat", () => {
    const [file, diags] = parse(`== Coins
if coins > 5:
  Ivo: Keep them.
else if coins > 0:
  Ivo: Not far.
else:
  Ivo: Broke.
match weather:
  storm:
    Sideways rain.
  heavy fog:
    No harbour wall.
each visit:
  first:
    Ivo: Who are you?
  then:
    Ivo: You again.
  finally:
    Ivo: Enough.
let tense = Tension > 60
return
`);
    expect(diags).toHaveLength(0);
    const item = file.items[0]!;
    if (item.kind !== "beat") throw new Error("beat");
    const beat = item.value;
    const kinds = beat.body.map((i) => i.kind);
    expect(kinds).toEqual(["conditional", "match", "eachVisit", "inlineLet", "divert"]);
    const cond = beat.body[0]!;
    if (cond.kind !== "conditional") throw new Error("cond");
    expect(cond.value.arms.map((a) => a.condition)).toEqual(["coins > 5", "coins > 0", null]);
    const match = beat.body[1]!;
    if (match.kind !== "match") throw new Error("match");
    expect(match.value.scrutinee).toBe("weather");
    expect(match.value.arms.map((a) => a.pattern)).toEqual(["storm", "heavy fog"]);
    const ev = beat.body[2]!;
    if (ev.kind !== "eachVisit") throw new Error("eachVisit");
    expect(ev.value.first).toHaveLength(1);
    expect(ev.value.then).toHaveLength(1);
    expect(ev.value.finally).toHaveLength(1);
    const ret = beat.body[4]!;
    expect(ret.kind === "divert" && ret.value.kind).toBe("return");
  });
});

// ---------------------------------------------------------------------------
// §9 when — triggers, fillers, watchers
// ---------------------------------------------------------------------------

describe("when — the trigger grammar", () => {
  it("understands human phrasings and the v3 spelling alike", () => {
    expect(parseTrigger("scan guest")).toEqual({ verb: "scan", param: "guest", filter: null });
    expect(parseTrigger("scanned by a guest")).toEqual({ verb: "scan", param: "guest", filter: null });
    expect(parseTrigger("guest arrives at Cellar")).toEqual({ verb: "enters", param: "guest", filter: "Cellar" });
    expect(parseTrigger("enters Cellar captive")).toEqual({ verb: "enters", param: "captive", filter: "Cellar" });
    expect(parseTrigger("guest leaves the Cellar")).toEqual({ verb: "exits", param: "guest", filter: "Cellar" });
    expect(parseTrigger("guest joins Rebels")).toEqual({ verb: "join", param: "guest", filter: "Rebels" });
    expect(parseTrigger("is captured")).toEqual({ verb: "captured", param: null, filter: null });
    expect(parseTrigger("lockdown")).toEqual({ verb: "lockdown", param: null, filter: null });
    expect(parseTrigger("rally for guest")).toEqual({ verb: "rally", param: "guest", filter: null });
    expect(parseTrigger("someone joins")).toEqual({ verb: "account_created", param: null, filter: null });
  });

  it("tells a condition from an event", () => {
    expect(isConditionTrigger("self.heat >= 75")).toBe(true);
    expect(isConditionTrigger("Tension > 60")).toBe(true);
    expect(isConditionTrigger("Mara.knows.the_truth")).toBe(true);
    expect(isConditionTrigger("visits(Gate) > 2")).toBe(true);
    expect(isConditionTrigger("scanned by guest")).toBe(false);
    expect(isConditionTrigger("guest arrives at Cellar")).toBe(false);
    expect(isConditionTrigger("lockdown")).toBe(false);
  });
});

const ORCHARD = `# The Glass Orchard
start: The Front Gate

GROUP The Society
  hidden: true

LOCATION Orchard Gate
  label: The Front Gate

LOCATION The Cellar
  label: The Cellar

ROLE Guest
  heat: 0 to 100 = 0
  captured: bool = false
  when self.heat >= 75:
    set self.captured = true
    move self to The Cellar
    set self.heat = 0
    reply You pushed it too far.
  when arrives at The Cellar:
    broadcast lights_down to participant(self)

CHARACTER Ivo Marsh
  trusts Guest: 30 of 100
  when scanned by a guest:
    set guest.heat += 40
    -> self.Confront
  when lockdown:
    Ivo Marsh: Nobody moves.
  beat Confront(guest)
    Self: Heat on file: {guest.heat}.

CHARACTER The Gatekeeper
  patience: 0 to 10 = 3
  when Tension > 60:
    fire the_room_turns
  when the_room_turns:
    set self.patience -= 1

== The Front Gate
  setting: Orchard Gate

The gate is open. It should not be.

Ivo marsh: You came back.
Ivo Marsh (quietly): I wasn't sure you would.

* Say nothing.
  -> the front gate
* "Where is she?"
  set Tension = 70
  -> END
`;

describe("Loom 4 end to end", () => {
  it("compiles GROUP, start:, spaced names, and watchers", () => {
    const sim = Sim.fromSources(ORCHARD);
    expect([...sim.model.factions.keys()]).toEqual(["The Society"]);
    expect(sim.model.entry).toBe("The Front Gate");
    expect(sim.model.beats.has("The Front Gate")).toBe(true);
    expect(sim.model.beats.has("Ivo Marsh.Confront")).toBe(true);
    // Watchers are not named events; `lockdown` and `the_room_turns` are.
    expect(namedEvents(sim.model)).toEqual(["lockdown", "the_room_turns"]);
    const guest = sim.model.roles.get("Guest")!;
    expect(guest.hooks.map((h) => h.condition)).toEqual(["self.heat >= 75", null]);
    expect(guest.hooks[1]).toMatchObject({ verb: "enters", filter: "The Cellar", param: null });
  });

  it("canonicalises every spelling of a speaker to the declared name", () => {
    const sim = Sim.fromSources(ORCHARD);
    const ev = sim.fireBeat("the front gate"); // loose divert spelling
    expect(dialogue(ev).map((d) => d.speaker)).toEqual(["Ivo Marsh", "Ivo Marsh"]);
    expect(dialogue(ev)[0]!.text).toBe("You came back.");
  });

  it("fires a role watcher per participant on the false→true edge, then re-arms", () => {
    const sim = Sim.fromSources(ORCHARD);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bo");
    // Two scans push g1 over 75; the watcher captures them and resets heat.
    sim.scan("Ivo Marsh", "g1");
    expect(sim.world.get("g1.captured")).toEqual({ kind: "bool", value: false });
    const ev = sim.scan("Ivo Marsh", "g1");
    expect(sim.world.get("g1.captured")).toEqual({ kind: "bool", value: true });
    expect(sim.locationOf("g1")).toBe("The Cellar");
    expect(sim.world.get("g1.heat")).toEqual({ kind: "number", value: 0 });
    expect(ev.some((e) => e.type === "respond" && e.text === "You pushed it too far.")).toBe(true);
    // g2 is untouched (per-participant evaluation).
    expect(sim.world.get("g2.captured")).toEqual({ kind: "bool", value: false });
    expect(sim.locationOf("g2")).toBeNull();
    // The heat reset re-armed the watcher: two more scans capture again.
    sim.setVar("g1.captured", "false");
    sim.scan("Ivo Marsh", "g1");
    sim.scan("Ivo Marsh", "g1");
    expect(sim.world.get("g1.captured")).toEqual({ kind: "bool", value: true });
  });

  it("chains a character watcher into a named event", () => {
    const sim = Sim.fromSources(ORCHARD);
    sim.createPerson("g1", "Ada");
    expect(sim.world.get("The Gatekeeper.patience")).toEqual({ kind: "number", value: 3 });
    sim.fireBeat("The Front Gate");
    sim.choose("__global", 1); // sets Tension = 70
    expect(sim.world.get("The Gatekeeper.patience")).toEqual({ kind: "number", value: 2 });
    // Tension stays high → the watcher does not refire on the next drain.
    sim.signal("lockdown");
    expect(sim.world.get("The Gatekeeper.patience")).toEqual({ kind: "number", value: 2 });
  });

  it("`move` is plain movement: arrival hooks fire, nothing is implied about capture", () => {
    const sim = Sim.fromSources(ORCHARD);
    sim.createPerson("g1", "Ada");
    const ev = sim.scan("Ivo Marsh", "g1");
    expect(ev.some((e) => e.type === "broadcast")).toBe(false);
    const ev2 = sim.scan("Ivo Marsh", "g1");
    const b = ev2.find((e) => e.type === "broadcast");
    expect(b).toMatchObject({ cue: "lights_down", audience: ["g1"] });
  });

  it("`add` / `remove` manage group membership; `group()` scopes a broadcast", () => {
    const sim = Sim.fromSources(`GROUP Rebels
  ethos: freedom

ROLE Guest
  when joins Rebels:
    broadcast welcome to group(Rebels)

CHARACTER Marshal
  when purge for guest:
    remove guest from Rebels
  when recruit for guest:
    add guest to Rebels

== x
  Nothing.
`);
    sim.createPerson("g1", "Ada");
    const ev = sim.signal("recruit", "g1");
    expect(sim.factionMembers("Rebels")).toEqual(["g1"]);
    expect(ev.find((e) => e.type === "broadcast")).toMatchObject({ cue: "welcome", audience: ["g1"] });
    sim.signal("purge", "g1");
    expect(sim.factionMembers("Rebels")).toEqual([]);
    expect(sim.factionOf("g1")).toBeNull();
  });
});
