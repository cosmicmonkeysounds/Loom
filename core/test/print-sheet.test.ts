import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioFactsFile, scenarioSource } from "../examples/load.ts";
import { checkinSigns, checkinSlug, CLUE_COLOUR, CLUE_STACK, codexStacks, HUNT_COLOUR, printExtras } from "../server/routes/k12.ts";
import { foldName } from "../src/parser/names.ts";
import { parseFactsText, type FactsFile } from "../src/facts.ts";

describe("K-12 print extras", () => {
  it("slugs fold back onto the LOCATION name", () => {
    for (const n of ["The Desktop", "Disk Cleanup", "The Server Room", "Café_Room  2"]) {
      expect(foldName(checkinSlug(n))).toBe(foldName(n.replace(/_/g, " ")));
    }
    expect(checkinSlug("The Server Room")).toBe("the-server-room");
  });

  it("skips prisons, cutscenes and `checkin: false` rooms, keeps hidden rooms flagged", () => {
    const loc = (id: string, o: Partial<{ prison: boolean; cutscene: boolean; hidden: boolean; checkin: boolean; label: string }> = {}) => ({
      id,
      label: o.label ?? null,
      prison: o.prison ?? false,
      sealed: false,
      hidden: o.hidden ?? false,
      cutscene: o.cutscene ?? false,
      checkin: o.checkin ?? true,
      capacity: null,
      contains: [],
    });
    const model = {
      locations: new Map([
        ["The Desktop", loc("The Desktop", { label: "The Desktop (living room)" })],
        ["The Mud Room", loc("The Mud Room", { cutscene: true })],
        ["The Internet", loc("The Internet", { prison: true, hidden: true })],
        ["The Cache", loc("The Cache", { hidden: true })],
        ["The Server Room", loc("The Server Room", { hidden: true, checkin: false })],
      ]),
    };
    const signs = checkinSigns(model, "https://app.example.com", "EVT 1");
    expect(signs.map((s) => [s.id, s.label, s.hidden])).toEqual([
      ["The Desktop", "The Desktop (living room)", false],
      ["The Cache", "The Cache", true],
    ]);
    expect(signs[1]!.url).toBe("https://app.example.com/?code=EVT%201&checkin=the-cache");
    expect(printExtras(null, "https://x", "E").checkin).toEqual([]);
  });

  it("the show prints a sign for every room the check-in rule handles", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const ids = checkinSigns(sim.model, "https://a", "E").map((s) => s.id);
    for (const room of ["The Desktop", "The Start Bar", "The CPU", "The Steam Room", "The Tube", "Disk Cleanup", "The Cloud", "The RAM", "The Fan Closet", "The Graphics Card", "The Hard Drive"]) expect(ids).toContain(room);
    expect(ids).not.toContain("The Optical Drive");
    expect(ids).not.toContain("The Internet");
    expect(ids).not.toContain("The Server Room"); // locked: a visit would reveal it early
  });

  it("lists a cast card per performer part — never a program, an agent or a prop", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const { cast } = printExtras(sim.model, "https://a", "E");
    for (const part of ["Clippy", "Task Manager", "Norton Anti-Virus", "CRA Agent Software", "Recycling Bin"]) expect(cast).toContain(part);
    expect(cast).not.toContain("Trabolta"); // mind: external
    expect(cast).not.toContain("Installation Wizard"); // playable: false
    expect(cast).not.toContain("Kernel");
    expect(printExtras(null, "https://x", "E").cast).toEqual([]);
  });

  it("places each codex entry on its fact stack: hunt answers gold, facts by category, hand-written ones already placed", () => {
    const facts = {
      version: 1,
      categories: { main: { colour: "green", stack: "shelf" }, trabolta: { colour: "blue", stack: "mantel" } },
      questions: [
        { id: "H1", round: 1, text: "q", answer: "a", accept: [], where: "volume B", codex: { id: "The Lease", title: "The Lease", code: "LEASE", text: "t" } },
        { id: "H2", round: 1, text: "q", answer: "a", accept: [] },
      ],
      answers: [],
      facts: [
        { id: "M01", category: "main", text: "x", codex: { id: "Silicon", title: "Silicon", code: "SILICON", text: "t" } },
        { id: "M02", category: "main", text: "x", existing: "The Theory", code: "THEORY" },
        { id: "T1", category: "trabolta", text: "x", existing: "The Theory" }, // first claim wins
        { id: "X1", category: "nowhere", text: "x", codex: { id: "Lost", title: "Lost", code: "LOST", text: "t" } },
      ],
      truths: [],
      door: { code: "12", codex: { id: "Door", title: "Door", text: "12" }, clues: [{ id: "Digit One", title: "One", code: "ONE", where: "the kitchen", text: "first {digit}" }] },
    } as FactsFile;
    expect(codexStacks(facts)).toEqual({
      "The Lease": { colour: HUNT_COLOUR, stack: "hunt answers", where: "volume B" },
      "Digit One": { colour: CLUE_COLOUR, stack: CLUE_STACK, where: "the kitchen" },
      Silicon: { colour: "green", stack: "shelf", where: null },
      "The Theory": { colour: "green", stack: "shelf", where: "already placed" },
    });
    expect(codexStacks(null)).toEqual({});
    expect(printExtras(null, "https://x", "E").stacks).toEqual({});
  });

  it("the show's stacks name real codex entries with codes, every hunt answer gold", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const facts = parseFactsText(scenarioFactsFile("trapped-in-the-internet")!.source).facts!;
    const stacks = printExtras(sim.model, "https://a", "E", facts).stacks;
    for (const q of facts.questions) {
      if (!q.codex) continue;
      expect(stacks[q.codex.id]).toEqual({ colour: "gold", stack: "hunt answers", where: q.where ?? null });
    }
    // every id is a real entry (one without a code just never gets a poster)
    for (const id of Object.keys(stacks)) expect(sim.model.codex.has(id), id).toBe(true);
    const colours = new Set(Object.values(stacks).map((s) => s.colour));
    expect([...colours].sort()).toEqual(["blue", "gold", "green", "red", "silver"]);
    // The door's digit notes: their own silver pile, one room each, each a
    // coded secret entry; the door code itself never gets a poster.
    const clues = facts.door!.clues!;
    expect(clues).toHaveLength(facts.door!.code.length);
    for (const c of clues) {
      expect(stacks[c.id]).toEqual({ colour: "silver", stack: "the cold door's digits", where: c.where });
      expect(sim.model.codex.get(c.id)!.secret).toBe(true);
      expect(sim.model.codex.get(c.id)!.code).toBeTruthy();
    }
    expect(new Set(clues.map((c) => c.where.split(" (")[0])).size).toBe(clues.length);
    expect(stacks[facts.door!.codex.id]).toBeUndefined();
  });
});
