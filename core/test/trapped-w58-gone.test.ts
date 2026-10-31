//! Trapped in the Internet, wave 58: "HE DOES NOT RETURN". Once Combo A or B has
//! taken him, nothing a late press, a stale card or a walk in the games can do
//! makes the dead man speak, and the games stay a party favour. A live ending and
//! the night before his reveal keep what they always had.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const SLOW = 120_000;

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
const v = (sim: Sim, p: string) => (sim.world.get(p) as { value: unknown } | undefined)?.value;
const said = (evs: SimEvent[], speaker: string) => (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.speaker === speaker).map((e) => e.text);
const hosts = (evs: SimEvent[]) => (evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[]).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue);
const advance = (sim: Sim, seconds: number) => {
  for (let i = 0; i < seconds; i++) sim.tick(1000);
};

function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 5) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}

function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  upload(sim, "g1", "Calculator");
  upload(sim, "g2", "Microsoft Excel");
  upload(sim, "g3", "OpenOffice");
  return sim;
}

/** Into the Y2K hour, the one place Combo A and B count. The lid stays down if `lid` is false. */
function toY2K(lid = true): Sim {
  const sim = boot();
  for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) sim.signal(n);
  if (v(sim, "Night.filing_open") === true) sim.signal("close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && (v(sim, "Night.results_q") as number) < 3; i++) sim.signal("read_the_results");
  for (const n of ["second_hunt_preview", "start_the_second_hunt"]) sim.signal(n);
  advance(sim, 120);
  sim.choose("g2", 0);
  sim.choose("g3", 0);
  for (const n of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]) sim.signal(n);
  if (lid) sim.signal("printer_opened");
  for (const n of ["trabolta_overshares", "y2k_clock"]) sim.signal(n);
  advance(sim, 2);
  expect(v(sim, "Night.step")).toBeGreaterThanOrEqual(14);
  return sim;
}

const ESCAPE = "simulation escape attempt";

describe("he does not return (wave 58)", () => {
  it.each(["patch_combo_a", "patch_combo_b"])("after %s a walk into the void is silent and costs nothing, and # hosts hears of it", { timeout: SLOW }, (combo) => {
    const sim = toY2K();
    sim.signal(combo);
    expect(v(sim, "Trabolta.awake")).toBe(false);
    const trust = v(sim, "g1.trust");
    const e = sim.signal(ESCAPE, "g1");
    expect(said(e, "Trabolta")).toEqual([]);
    expect(v(sim, "g1.trust")).toBe(trust);
    expect(v(sim, "g1.escapes")).toBe(0);
    expect(hosts(e)).toEqual([expect.stringContaining("no trust lost")]);
  });

  it.each(["patch_combo_a", "patch_combo_b"])("a stale 📝 card answered after %s gets no line from him; a live ending still closes the record in his voice", { timeout: SLOW }, (combo) => {
    const FILING = { question: "F2", answer: "a guess", confidence: 80, verdict: "uncertain" };
    const dead = toY2K();
    dead.signal(combo);
    expect(said(dead.signal("fact answered", "g1", FILING), "Trabolta")).toEqual([]);
    const live = toY2K();
    live.setVar("Night.ended", "true");
    expect(said(live.signal("fact answered", "g1", FILING), "Trabolta")).toEqual([expect.stringContaining("The record is closed")]);
  });

  it.each(["patch_combo_a", "patch_combo_b"])("a late lid after %s plays no beans: nobody speaks, and the night stays ended", { timeout: SLOW }, (combo) => {
    const sim = toY2K(false);
    expect(v(sim, "Night.printer_called")).toBe(true);
    expect(v(sim, "Night.beans")).toBe(false);
    sim.signal(combo);
    const composure = v(sim, "Trabolta.composure");
    const e = sim.signal("printer_opened");
    expect(said(e, "Trabolta")).toEqual([]);
    expect(said(e, "Clippy")).toEqual([]);
    expect(v(sim, "Night.beans")).toBe(false);
    expect(v(sim, "Trabolta.composure")).toBe(composure);
  });

  it("the lid still plays the beans late, up to the ending", { timeout: SLOW }, () => {
    const sim = toY2K(false);
    expect(said(sim.signal("printer_opened"), "Trabolta")).not.toEqual([]);
    expect(v(sim, "Night.beans")).toBe(true);
    expect(v(sim, "Night.phase")).toBe("y2k");
  });

  it("Clippy's card at the ceremony names every ending she hosts", () => {
    const text = Sim.fromSources(SRC).model.objectives.get("Host The Ceremony")?.brief ?? "";
    expect(text).toContain("after Combo A, Combo B or the rave");
  });

  it("the walk still costs before his reveal (R4) and while he lives, in his voice", { timeout: SLOW }, () => {
    const before = boot();
    expect(v(before, "Trabolta.awake")).not.toBe(true);
    const e = before.signal(ESCAPE, "g1");
    expect(said(e, "Trabolta")).toHaveLength(3);
    expect(v(before, "g1.escapes")).toBe(1);
    expect(v(before, "g1.trust")).toBe(-5);
    expect(hosts(e)).toEqual([expect.stringContaining("trust −5")]);

    const during = toY2K();
    expect(said(during.signal(ESCAPE, "g1"), "Trabolta")).toHaveLength(3);
    expect(v(during, "g1.escapes")).toBe(1);
  });
});
