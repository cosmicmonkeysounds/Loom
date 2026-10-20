import { describe, expect, it } from "vitest";
import { parse } from "../src/parser/index.ts";
import type { Declaration, ObjectiveBody } from "../src/parser/index.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { resolveObjectiveAudience, resolveObjectiveButtons } from "../src/runtime/sim/model.ts";
import { guestView, objectivesFor, primeView, type ObjectiveView } from "../server/views.ts";

function objectiveOf(src: string, name?: string): ObjectiveBody {
  const [file] = parse(src);
  const decl = file.items
    .filter((i): i is { kind: "declaration"; value: Declaration } => i.kind === "declaration")
    .map((i) => i.value)
    .find((d) => d.kind === "objective" && (name === undefined || d.name === name));
  if (!decl?.objective) throw new Error("no objective");
  return decl.objective;
}

describe("OBJECTIVE — parse", () => {
  it("reads every key, the brief and the checklist", () => {
    const o = objectiveOf(`OBJECTIVE Show Your Pass
  for: Program, Antivirus
  while: program.uploaded == true and program.cleared != true
  act: Doors
  title: Show your pass to an Antivirus at the door
  text:
    An Antivirus in the Optical Drive scans it.
    Hold it up, screen bright.
    - Upload finished, done when program.uploaded == true
    - Scanned at the door, DONE WHEN program.cleared == true
    - Smile
  buttons: pass, the golden duck, scan
  loud: TRUE
`);
    expect(o.title).toBe("Show your pass to an Antivirus at the door");
    expect(o.for).toEqual(["Program", "Antivirus"]);
    expect(o.while).toBe("program.uploaded == true and program.cleared != true");
    expect(o.act).toBe("Doors");
    expect(o.brief).toBe("An Antivirus in the Optical Drive scans it. Hold it up, screen bright.");
    expect(o.checklist.map((c) => [c.label, c.done])).toEqual([
      ["Upload finished", "program.uploaded == true"],
      ["Scanned at the door", "program.cleared == true"],
      ["Smile", null],
    ]);
    expect(o.buttons).toEqual(["pass", "the golden duck", "scan"]);
    expect(o.loud).toBe(true);
  });

  it("defaults: no title, no while, no act, empty text, quiet", () => {
    const o = objectiveOf("OBJECTIVE Bare\n  for: guests\n");
    expect(o.title).toBeNull();
    expect(o.while).toBeNull();
    expect(o.act).toBeNull();
    expect(o.brief).toBe("");
    expect(o.checklist).toEqual([]);
    expect(o.buttons).toEqual([]);
    expect(o.loud).toBe(false);
  });

  it("takes the aliases label: / brief: and folds key case", () => {
    const o = objectiveOf("OBJECTIVE A\n  FOR: everyone\n  Label: The label\n  brief: First line.\n    Second line.\n  Loud: false\n");
    expect(o.title).toBe("The label");
    expect(o.for).toEqual(["everyone"]);
    expect(o.brief).toBe("First line. Second line.");
    expect(o.loud).toBe(false);
  });

  it("keeps an empty while: / done when as \"\" (for the lint)", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  while:\n  text:\n    - Do it, done when\n");
    expect(o.while).toBe("");
    expect(o.checklist[0]).toMatchObject({ label: "Do it", done: "" });
  });

  it("a checklist-only text block has an empty brief", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  text:\n    - one\n    - two\n");
    expect(o.brief).toBe("");
    expect(o.checklist.map((c) => c.label)).toEqual(["one", "two"]);
  });

  it("splits buttons on top-level commas only", () => {
    const o = objectiveOf("OBJECTIVE A\n  for: guests\n  buttons: a(b, c), d\n");
    expect(o.buttons).toEqual(["a(b, c)", "d"]);
  });
});

const MODEL_SRC = `# Night
start: opening
alerts: Night.level

ROLE Program
  cleared: bool = false

GROUP Antivirus

GROUP Hosts

GROUP Unlimited Power
  hidden: true

CHARACTER Norton
  faction: Antivirus

CHARACTER Clippy
  faction: Hosts

CHARACTER Task Manager
  faction: Hosts
  admin: true
  crawl: fx

INTERACTION send to the internet
  who: performer

INTERACTION the golden duck
  who: guest

CODEX The Kernel
  category: People
  text: hi

CODEX The Plain
  text: hi

OBJECTIVE First
  for: program, Norton, antivirus, guests, nobody here
  buttons: Send To The Internet, pass, SCAN, the_golden_duck, not a button, pass

OBJECTIVE Second
  for: everyone
  title: Two

OBJECTIVE Third
  for: performers

== opening
Hi.
`;

describe("OBJECTIVE — compile", () => {
  const sim = Sim.fromSources(MODEL_SRC);
  const m = sim.model;

  it("keeps model order and resolves for: — reserved → ROLE → CHARACTER → GROUP", () => {
    expect([...m.objectives.keys()]).toEqual(["First", "Second", "Third"]);
    const first = m.objectives.get("First")!;
    expect(first.title).toBe("First");
    expect(first.audience).toEqual({ guests: true, performers: false, roles: ["Program"], characters: ["Norton"], groups: ["Antivirus"] });
    expect(m.objectives.get("Second")!.audience).toMatchObject({ guests: true, performers: true });
    expect(m.objectives.get("Second")!.title).toBe("Two");
    expect(m.objectives.get("Third")!.audience).toMatchObject({ guests: false, performers: true });
  });

  it("resolves buttons to canonical ids and pass / scan, dropping unknowns and repeats", () => {
    expect(m.objectives.get("First")!.buttons).toEqual(["send to the internet", "pass", "scan", "the golden duck"]);
  });

  it("reports unresolved names for the lints", () => {
    expect(resolveObjectiveAudience(m, ["nobody here", "Hosts"]).unresolved).toEqual(["nobody here"]);
    expect(resolveObjectiveButtons(m, ["not a button"]).unknown).toEqual(["not a button"]);
  });

  it("reads admin: / crawl: on characters, category: on codex entries and the header alerts:", () => {
    expect(m.characters.get("Task Manager")).toMatchObject({ admin: true, crawl: "fx" });
    expect(m.characters.get("Clippy")).toMatchObject({ admin: false, crawl: null });
    expect(m.codex.get("The Kernel")!.category).toBe("People");
    expect(m.codex.get("The Plain")!.category).toBeNull();
    expect(m.alerts).toBe("Night.level");
  });

  it("defaults alerts to Night.alerts, also for a value that is not a dotted path", () => {
    expect(Sim.fromSources("# A\n\n== a\nhi\n").model.alerts).toBe("Night.alerts");
    expect(Sim.fromSources("# A\nalerts: loud\n\n== a\nhi\n").model.alerts).toBe("Night.alerts");
  });

  it("only the story header's alerts: counts — a later file's line is not a header", () => {
    const s = Sim.fromSources("# A\n\n== a\nhi\n", "# B\nalerts: Night.other\n\n== b\nhi\n");
    expect(s.model.alerts).toBe("Night.alerts");
  });
});

const VIEW_SRC = `# Night
start: opening

ROLE Program
  cleared: bool = false
  marked: bool = false

GROUP Antivirus
  joinable: false

GROUP Hosts
  joinable: false

GROUP Rebels

GROUP Unlimited Power
  hidden: true

CHARACTER Norton
  faction: Antivirus
  when scanned by program:
    reply Clean.

CHARACTER McAfee
  faction: Antivirus

CHARACTER Clippy
  faction: Hosts

INTERACTION wave
  who: guest

INTERACTION bathroom
  who: guest
  restricted: allow

INTERACTION hidden button
  who: guest
  while: Night.never == true

INTERACTION send to the internet
  who: performer
  by: Norton

INTERACTION greet
  who: performer

INTERACTION open the doors
  who: admin

OBJECTIVE Show Your Pass
  for: Program
  while: program.cleared != true
  title: Show your pass
  text:
    Hold it up.
    - Uploaded, done when program.uploaded == true
    - Smile
  buttons: pass, wave, bathroom, hidden button, greet
  loud: true

OBJECTIVE Escort
  for: Antivirus
  buttons: scan, send to the internet, greet

OBJECTIVE Host Duty
  for: Hosts
  while: Night.phase == "bingo"

OBJECTIVE Rebel Plan
  for: Rebels

OBJECTIVE Power Plan
  for: Unlimited Power

OBJECTIVE Everyone Dance
  for: everyone

OBJECTIVE Broken
  for: guests
  while: 1 +

OBJECTIVE Norton Only
  for: Norton

== opening
Hi.
`;

describe("OBJECTIVE — views", () => {
  const fresh = () => {
    const sim = Sim.fromSources(VIEW_SRC);
    sim.createPerson("g1", "Ada");
    sim.createPerson("g2", "Bo");
    return sim;
  };
  const ids = (os: ObjectiveView[]) => os.map((o) => o.id);

  it("a guest sees ROLE, everyone and GROUP-member objectives in model order, the guest bound", () => {
    const sim = fresh();
    expect(ids(objectivesFor(sim, { guest: "g1" }))).toEqual(["Show Your Pass", "Everyone Dance"]);
    sim.join("g1", "Rebels");
    expect(ids(objectivesFor(sim, { guest: "g1" }))).toEqual(["Show Your Pass", "Rebel Plan", "Everyone Dance"]);
    // The while: reads the guest's own slot — clearing g1 hides it for g1 only.
    sim.setVar("g1.cleared", "true");
    expect(ids(objectivesFor(sim, { guest: "g1" }))).toEqual(["Rebel Plan", "Everyone Dance"]);
    expect(ids(objectivesFor(sim, { guest: "g2" }))).toEqual(["Show Your Pass", "Everyone Dance"]);
  });

  it("a hidden GROUP never matches before its reveal", () => {
    const sim = fresh();
    sim.join("g1", "Unlimited Power");
    expect(ids(objectivesFor(sim, { guest: "g1" }))).not.toContain("Power Plan");
    sim.reveal("Unlimited Power");
    expect(ids(objectivesFor(sim, { guest: "g1" }))).toContain("Power Plan");
  });

  it("checklist: a condition reads true / false with the guest bound, a plain to-do null", () => {
    const sim = fresh();
    const o = () => objectivesFor(sim, { guest: "g1" })[0]!;
    expect(o().checklist).toEqual([
      { label: "Uploaded", done: false },
      { label: "Smile", done: null },
    ]);
    sim.setVar("g1.uploaded", "true");
    expect(o().checklist[0]!.done).toBe(true);
    expect(o()).toMatchObject({ title: "Show your pass", brief: "Hold it up.", loud: true, act: null });
  });

  it("a guest's buttons are its live, restriction-filtered guest buttons plus pass / scan", () => {
    const sim = fresh();
    expect(objectivesFor(sim, { guest: "g1" })[0]!.buttons).toEqual(["pass", "wave", "bathroom"]);
    sim.restrict("g1");
    expect(objectivesFor(sim, { guest: "g1" })[0]!.buttons).toEqual(["pass", "bathroom"]);
  });

  it("a booth sees its name, its GROUP (by faction) and performers / everyone; self is the character", () => {
    const sim = fresh();
    expect(ids(objectivesFor(sim, { character: "Norton" }))).toEqual(["Escort", "Everyone Dance", "Norton Only"]);
    expect(ids(objectivesFor(sim, { character: "Clippy" }))).toEqual(["Everyone Dance"]);
    sim.setVar("Night.phase", '"bingo"');
    expect(ids(objectivesFor(sim, { character: "Clippy" }))).toEqual(["Host Duty", "Everyone Dance"]);
  });

  it("a booth drops another character's by: button unless it is host", () => {
    const sim = fresh();
    expect(objectivesFor(sim, { character: "Norton" })[0]!.buttons).toEqual(["scan", "send to the internet", "greet"]);
    expect(objectivesFor(sim, { character: "McAfee" })[0]!.buttons).toEqual(["scan", "greet"]);
    expect(objectivesFor(sim, { character: "McAfee", host: true })[0]!.buttons).toEqual(["scan", "send to the internet", "greet"]);
  });

  it("a while: that throws is not live", () => {
    const sim = fresh();
    expect(ids(objectivesFor(sim, { guest: "g1" }))).not.toContain("Broken");
  });

  it("guest / prime views carry objectives, night and alertLevel", () => {
    const sim = fresh();
    const g = guestView(sim, "g1");
    expect(ids(g.objectives!)).toEqual(["Show Your Pass", "Everyone Dance"]);
    expect(g.night).toEqual({ act: null, phase: null, step: null });
    expect(g.alertLevel).toBe("sticky");
    const p = primeView(sim, "McAfee", undefined, { host: true });
    expect(p.objectives![0]!.buttons).toContain("send to the internet");
    expect(p.night).toBeDefined();
    expect(p.alertLevel).toBe("sticky");
  });
});
