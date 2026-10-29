// Wave 41 (docs/loom-w41-contract.md C1, C6): the upload form's write-in,
// the optional inbox card, every human_problem branch reading "other", and
// the night summary Trabolta's letter writer is given.

import { describe, expect, it } from "vitest";
import { scenarioSource } from "../examples/load.ts";
import { Sim, type SimEvent } from "../src/runtime/sim/index.ts";
import { awardsOf, highlightsOf, LETTER_ENDINGS, letterFactsOf } from "../server/letter-facts.ts";
import { computeRecap } from "../server/recap.ts";
import type { LetterEntry } from "../server/letters.ts";

const SRC = scenarioSource("trapped-in-the-internet");
/** A story rule standing in for the review's watcher, as trapped-w18b-ending
 *  does: plays Your File with `program` bound. */
const SRC_HOOKED = `${SRC}\n\n# ── w41-test-hooks.loom ──\nwhen w41_test_your_file for program:\n  -> Your File\n`;
type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => (sim.world.get(p) as { value?: unknown } | undefined)?.value;
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget") as Ev<"widget">[];
const lines = (evs: SimEvent[], speaker: string) => (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.speaker === speaker).map((e) => e.text);
const texts = (evs: SimEvent[]) => (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).map((e) => e.text);

/** Register and pass the CAPTCHA (to the problem form). */
function toForm(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
}

const entry = (id: string): LetterEntry => ({ key: `g:${id}`, kind: "guest", id, email: "guest@example.com", at: 0, draft: null, sent: null });

describe("wave 41: the problem form's write-in (C1)", () => {
  it("Something else deals a card and holds the deposit until it is answered", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Calculator");
    expect(sim.pendingChoiceFor("g1")).toEqual(["My debt.", "My career.", "My loneliness.", "My mortality.", "Something else."]);
    const other = sim.choose("g1", 4);
    expect(v(sim, "g1.human_problem")).toBe("other");
    const card = widgets(other).find((w) => w.widget === "answer")!;
    expect(card.text).toBe("Which problem did the invitation promise to solve?");
    expect(card.params["max"]).toBe("60");
    expect(card.params["stage"]).toBe("true"); // on the arrival stage, not the tray (play cutscene.tsx)
    expect(card.params["question"]).toBeUndefined(); // never judged by the facts book
    // No deposit menu, no inbox, no pass while the write-in is open.
    expect(sim.pendingChoiceFor("g1")).toBeNull();
    expect(widgets(other).some((w) => w.widget === "email" || w.widget === "pass")).toBe(false);
    expect(v(sim, "g1.uploaded")).not.toBe(true);

    const typed = sim.signal("answer answered", "g1", { text: "my landlord", card: 1 });
    expect(v(sim, "g1.human_problem_text")).toBe("my landlord");
    expect(lines(typed, "Task Manager")).toContain("Noted. Filed under other. It is not your concern now.");
    expect(texts(typed).some((t) => t.includes("my landlord"))).toBe(false); // never repeated back
    expect(sim.pendingChoiceFor("g1")).toEqual(["Deposited.", "I have nothing to leave."]);

    // The deposit's own record is not mistaken for the write-in.
    sim.choose("g1", 0);
    sim.signal("answer answered", "g1", { text: "my car keys", card: 2 });
    expect(v(sim, "g1.human_problem_text")).toBe("my landlord");
    expect(v(sim, "g1.left_behind_text")).toBe("my car keys");
    expect(v(sim, "g1.uploaded")).toBe(true);
  });

  it("a stock answer goes straight on to the deposit; a featured program is never asked", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Calculator");
    sim.choose("g1", 2);
    expect(v(sim, "g1.human_problem")).toBe("loneliness");
    expect(sim.pendingChoiceFor("g1")).toEqual(["Deposited.", "I have nothing to leave."]);
    toForm(sim, "g2", "Microsoft Excel");
    expect(v(sim, "g2.human_problem")).toBe("profile");
    expect(sim.pendingChoiceFor("g2")).toEqual(["Deposited.", "I have nothing to leave."]);
  });

  it("the write-in's words are secret: in Your File only, never another program's view", () => {
    const sim = Sim.fromSources(SRC);
    const secret = sim.model.roles.get("Program")!.secret;
    for (const slot of ["human_problem_text", "left_behind_text", "inbox"]) expect(secret.has(slot), slot).toBe(true);
  });
});

describe("wave 41: the optional inbox card (C1, C2)", () => {
  it("ends the upload for everyone, before the pass, and hears only given / skipped", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Calculator");
    sim.choose("g1", 0);
    const nothing = sim.choose("g1", 1); // I have nothing to leave: no deposit card
    const kinds = widgets(nothing).map((w) => w.widget);
    expect(kinds).toEqual(["email", "pass"]);
    const card = widgets(nothing)[0]!;
    expect(card.params).toEqual({ button: "Send me the letter", skip: "No thanks", placeholder: "you@example.com" });
    expect(card.audience).toEqual(["g1"]);
    const given = sim.signal("email answered", "g1", { given: true, card: 3 });
    expect(v(sim, "g1.inbox")).toBe("given");
    expect(lines(given, "Task Manager")[0]).toMatch(/^Inbox on file\./u);
    // Once: a second answer changes nothing.
    sim.signal("email answered", "g1", { skipped: true, card: 3 });
    expect(v(sim, "g1.inbox")).toBe("given");

    toForm(sim, "g2", "Notepad");
    sim.choose("g2", 0);
    sim.choose("g2", 1);
    const skipped = sim.signal("email answered", "g2", { skipped: true, card: 9 });
    expect(v(sim, "g2.inbox")).toBe("skipped");
    expect(lines(skipped, "Task Manager")).toContain("No inbox. Noted. Not flagged.");
  });
});

describe("wave 41: every human_problem branch reads other", () => {
  it("Your File quotes the write-in to its own program", () => {
    const sim = Sim.fromSources(SRC_HOOKED);
    toForm(sim, "g1", "Calculator");
    sim.choose("g1", 4);
    sim.signal("answer answered", "g1", { text: "my landlord", card: 1 });
    sim.choose("g1", 1);
    const file = sim.signal("w41_test_your_file", "g1");
    const said = lines(file, "The Uploader");
    expect(said).toContain("You came because of something the form did not list: my landlord.");
  });
});

describe("wave 41: the letter writer's facts (C6)", () => {
  it("a pool program's write-in, deposit and stats; no address", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Calculator");
    sim.choose("g1", 4);
    sim.signal("answer answered", "g1", { text: "my landlord", card: 1 });
    sim.choose("g1", 0);
    sim.signal("answer answered", "g1", { text: "a red scarf", card: 2 });
    const recap = computeRecap(sim);
    const made = letterFactsOf(entry("g1"), { sim, recap, date: "October 31, 2026" })!;
    expect(made.to).toEqual({ kind: "guest", name: "Calculator" });
    const program = made.facts["program"] as Record<string, unknown>;
    expect(program["came_for_in_their_words"]).toBe("my landlord");
    expect(program["came_for"]).toBeNull();
    expect(program["left_behind"]).toBe("a red scarf");
    expect(program["truthcoin"]).toBe(100);
    expect(made.facts["date"]).toBe("October 31, 2026");
    expect(JSON.stringify(made)).not.toContain("example.com");
  });

  it("a featured program is told who they really were", () => {
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Microsoft Excel");
    sim.choose("g1", 1);
    const made = letterFactsOf(entry("g1"), { sim, recap: computeRecap(sim), date: "x" })!;
    const program = made.facts["program"] as Record<string, unknown>;
    expect(program["who"]).toMatch(/^Randy Barkmore Sr\./u);
    expect(program["left_nothing"]).toBe(true);
  });

  it("a performer's part; a gone person or part gives nothing", () => {
    const sim = Sim.fromSources(SRC);
    const perf: LetterEntry = { ...entry("x"), key: "p:Clippy", kind: "performer", id: "Clippy" };
    const made = letterFactsOf(perf, { sim, recap: computeRecap(sim), date: "x" })!;
    expect(made.to).toEqual({ kind: "performer", name: "Clippy", part: "Clippy" });
    expect(letterFactsOf({ ...perf, id: "Nobody" }, { sim, recap: computeRecap(sim), date: "x" })).toBeNull();
    expect(letterFactsOf(entry("g9"), { sim, recap: computeRecap(sim), date: "x" })).toBeNull();
  });

  it("every ending the story sets has a note, and awards / highlights read the log", () => {
    for (const e of ["disabled", "destroyed", "song", "song_pickup", "rave", "help", "banished", "hand_jive"]) expect(LETTER_ENDINGS[e], e).toBeTruthy();
    const sim = Sim.fromSources(SRC);
    toForm(sim, "g1", "Calculator");
    sim.choose("g1", 0);
    sim.choose("g1", 1);
    expect(awardsOf(sim, "Calculator")).toEqual([]);
    expect(highlightsOf(computeRecap(sim), "g1").some((h) => h.includes("Truthcoin"))).toBe(true);
  });
});
