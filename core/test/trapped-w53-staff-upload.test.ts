// Wave 53 (docs/loom-w53-contract.md C1–C3): everyone uploads. Clippy, the
// Antivirus and the hosts play the guests' own Login / Upload / Upload
// Deposit beats on their characters, on rails in their booths, and leave by
// the staff door. Nobody becomes a Person.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const STAFF = ["Clippy", "Task Manager", "Adobe Acrobat", "Recycling Bin", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget") as Ev<"widget">[];
const lines = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const says = (evs: SimEvent[]) => lines(evs).map((e) => e.text);

/** The server's `/api/prime/widget`: the part is subject and actor. */
const answer = (sim: Sim, who: string, kind: string, args: Record<string, string | number | boolean>) => sim.signal(`${kind} answered`, who, args, who);
const arrive = (sim: Sim, who: string) => sim.signal("booth_arrived", who, {}, who);

/** Through the CAPTCHA to the problem form. */
function toForm(sim: Sim, who: string): void {
  arrive(sim, who);
  answer(sim, who, "captcha", { passed: true });
  answer(sim, who, "captcha", { passed: false });
}

/** All the way to the cards at the end (nothing left behind). */
function toCards(sim: Sim, who: string): SimEvent[] {
  toForm(sim, who);
  sim.choose(who, 0);
  return sim.choose(who, 1);
}

describe("wave 53: the arrival header and the rails (C1, C2)", () => {
  it("is due for every staff part and for nobody else", () => {
    const sim = Sim.fromSources(SRC);
    for (const who of STAFF) expect(sim.holds(sim.model.arrival!, who, who), who).toBe(true);
    arrive(sim, "Clippy");
    expect(sim.holds(sim.model.arrival!, "Clippy", "Clippy")).toBe(false);
    expect(sim.holds(sim.model.arrival!, "Norton Anti-Virus", "Norton Anti-Virus")).toBe(true);
  });

  it("stands the part in the Optical Drive, on rails, as no Person", () => {
    const sim = Sim.fromSources(SRC);
    const evs = arrive(sim, "Norton Anti-Virus");
    expect(sim.cutsceneFor("Norton Anti-Virus")).toBe(true);
    expect(sim.locationOf("Norton Anti-Virus")).toBe("The Optical Drive");
    expect(sim.persons.size).toBe(0);
    // The Uploader's own words, to this part alone.
    const said = lines(evs);
    expect(said[0]!.text).toContain("Welcome to the computer");
    expect(said.every((l) => l.audience.length === 1 && l.audience[0] === "Norton Anti-Virus")).toBe(true);
    const card = widgets(evs).find((w) => w.widget === "captcha")!;
    expect(card.audience).toEqual(["Norton Anti-Virus"]);
  });

  it("arrives once, whatever the booth reports", () => {
    const sim = Sim.fromSources(SRC);
    arrive(sim, "Clippy");
    expect(says(arrive(sim, "Clippy"))).toEqual([]);
  });

  it("keeps a character off rails out of every line it never heard before", () => {
    const sim = Sim.fromSources(SRC);
    // A character not on rails is never a subject: nothing is addressed to it.
    expect(sim.cutsceneFor("Clippy")).toBe(false);
    sim.createPerson("g1", "Calculator");
    const evs = sim.signal("captcha answered", "g1", { passed: true });
    expect(lines(evs).every((l) => l.audience.every((a) => a === "g1"))).toBe(true);
  });
});

describe("wave 53: the same upload (C3)", () => {
  it("fails the CAPTCHA the guests' way, with the part's name in Task Manager's mouth", () => {
    const sim = Sim.fromSources(SRC);
    arrive(sim, "Clippy");
    const passed = answer(sim, "Clippy", "captcha", { passed: true });
    expect(says(passed).some((t) => t.startsWith("INCORRECT."))).toBe(true);
    const next = answer(sim, "Clippy", "captcha", { passed: false });
    expect(says(next)).toContain("Clippy. Task Manager. I keep things running. I will be running your installation. Per the agenda.");
    expect(sim.pendingChoiceFor("Clippy")).toEqual(["My debt.", "My career.", "My loneliness.", "My mortality.", "Something else."]);
  });

  it("takes the form, the deposit and both write-ins", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "McAfee Anti-Virus");
    const other = sim.choose("McAfee Anti-Virus", 4);
    expect(widgets(other).find((w) => w.widget === "answer")!.params["stage"]).toBe("true");
    expect(sim.pendingChoiceFor("McAfee Anti-Virus")).toBeNull();
    const filed = answer(sim, "McAfee Anti-Virus", "answer", { text: "My subscription" });
    expect(v(sim, "McAfee Anti-Virus.human_problem_text")).toBe("My subscription");
    expect(says(filed)).toContain("Noted. Filed under other. It is not your concern now.");
    expect(sim.pendingChoiceFor("McAfee Anti-Virus")).toEqual(["Deposited.", "I have nothing to leave."]);
    sim.choose("McAfee Anti-Virus", 0);
    expect(v(sim, "McAfee Anti-Virus.left_behind")).toBe("deposited");
    answer(sim, "McAfee Anti-Virus", "answer", { text: "A coaster" });
    expect(v(sim, "McAfee Anti-Virus.left_behind_text")).toBe("A coaster");
  });

  it("deals no pass, no Truthcoin and no door queue", () => {
    const sim = Sim.fromSources(SRC);
    const evs = toCards(sim, "Norton Anti-Virus");
    expect(widgets(evs).map((w) => w.widget)).toEqual(["poll", "poll", "email"]);
    expect(says(evs).join(" ")).not.toContain("Truthcoin credited");
    expect(says(evs)).toContain("Staff are not paid in Truthcoin. Noted. Fine.");
    expect(says(evs).join(" ")).not.toContain("Antivirus, confirm");
    expect(v(sim, "Norton Anti-Virus.score")).toBe(0);
    expect(v(sim, "Norton Anti-Virus.uploaded")).toBe(true);
    expect(evs.filter((e) => e.type === "respond")).toEqual([]);
    expect(sim.codexFor("Norton Anti-Virus").map((e) => e.id)).toContain("The Terms Of Service");
  });

  it("leaves by the staff door on the inbox card, video and voice on file", () => {
    const sim = Sim.fromSources(SRC);
    toCards(sim, "Recycling Bin");
    expect(sim.cutsceneFor("Recycling Bin")).toBe(true);
    const no = answer(sim, "Recycling Bin", "poll", { choice: "No, leave me out", index: 1 });
    expect(v(sim, "Recycling Bin.video")).toBe("out");
    expect(lines(no)[0]!.audience).toEqual(["Recycling Bin"]);
    const voice = answer(sim, "Recycling Bin", "poll", { choice: "Yes, say them out loud", index: 0 });
    expect(says(voice)[0]).toContain("This phone speaks when the house speaks.");
    const out = answer(sim, "Recycling Bin", "email", { given: false });
    expect(v(sim, "Recycling Bin.inbox")).toBe("skipped");
    expect(says(out).at(-1)).toContain("Staff door, Recycling Bin. Nobody scans the scanners.");
    expect(sim.cutsceneFor("Recycling Bin")).toBe(false);
    expect(v(sim, "Kernel.staff_uploaded")).toBe(1);
  });

  it("gives every part the same run", () => {
    const sim = Sim.fromSources(SRC);
    for (const who of STAFF) {
      toCards(sim, who);
      answer(sim, who, "poll", { choice: "Yes, use video of me", index: 0 });
      answer(sim, who, "poll", { choice: "No, keep it quiet", index: 1 });
      answer(sim, who, "email", { given: true });
      expect(sim.cutsceneFor(who), who).toBe(false);
    }
    expect(v(sim, "Kernel.staff_uploaded")).toBe(8);
    expect(sim.persons.size).toBe(0);
  });

  it("never lets a guest's answer reach a part's hooks", () => {
    const sim = Sim.fromSources(SRC);
    arrive(sim, "Clippy");
    sim.createPerson("g1", "Calculator");
    sim.signal("captcha answered", "g1", { passed: true });
    expect(v(sim, "Clippy.captchas")).toBe(0);
    expect(v(sim, "g1.captchas")).toBe(1);
  });

  it("still pays a guest, at the door, with a pass", () => {
    const sim = Sim.fromSources(SRC);
    sim.createPerson("g1", "Calculator");
    sim.signal("captcha answered", "g1", { passed: false });
    sim.choose("g1", 0);
    const evs = sim.choose("g1", 1);
    expect(says(evs)).toContain("100 Truthcoin credited. I am also the bank. Keep track. I will.");
    expect(widgets(evs).map((w) => w.widget)).toEqual(["poll", "poll", "email", "pass"]);
    expect(v(sim, "g1.score")).toBe(100);
    const voice = sim.signal("poll answered", "g1", { choice: "No, keep it quiet", index: 1 });
    expect(says(voice)[0]).toContain("This phone stays quiet.");
  });
});

describe("wave 53: a director's ⏭ (C3)", () => {
  it("frees a part on rails and spares one not yet signed in", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "Clippy");
    const evs = sim.signal("wave_staff_through");
    expect(says(evs)).toEqual([]);
    expect(sim.cutsceneFor("Clippy")).toBe(false);
    expect(v(sim, "Clippy.uploaded")).toBe(true);
    for (const who of STAFF) expect(sim.holds(sim.model.arrival!, who, who), who).toBe(false);
    expect(v(sim, "Kernel.staff_uploaded")).toBe(8);
  });

  it("leaves a part already through alone, and says nothing to the room after", () => {
    const sim = Sim.fromSources(SRC);
    toCards(sim, "Adobe Acrobat");
    answer(sim, "Adobe Acrobat", "poll", { choice: "Yes, use video of me", index: 0 });
    answer(sim, "Adobe Acrobat", "poll", { choice: "No, keep it quiet", index: 1 });
    answer(sim, "Adobe Acrobat", "email", { given: true });
    sim.signal("wave_staff_through");
    expect(v(sim, "Kernel.staff_uploaded")).toBe(8);
  });

  it("keeps a card left open on the stage quiet", () => {
    const sim = Sim.fromSources(SRC);
    toCards(sim, "Task Manager");
    sim.signal("wave_staff_through");
    // A late answer from the booth's Readouts: kept, but it plays nothing.
    expect(lines(answer(sim, "Task Manager", "poll", { choice: "No, leave me out", index: 1 }))).toEqual([]);
    expect(v(sim, "Task Manager.video")).toBe("out");
    expect(lines(answer(sim, "Task Manager", "email", { given: true }))).toEqual([]);
  });

  it("keeps a write-in left open on the stage quiet too", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "Task Manager");
    sim.choose("Task Manager", 4);
    sim.signal("wave_staff_through");
    const late = answer(sim, "Task Manager", "answer", { text: "Too many agendas" });
    expect(lines(late)).toEqual([]);
    expect(v(sim, "Task Manager.human_problem_text")).toBe("Too many agendas");
    expect(sim.pendingChoiceFor("Task Manager")).toBeNull();
  });
});
