//! Trapped in the Internet — the server room without the ESP32 box (wave 20b,
//! Q7: "No, just the Grand Central M4"). Nothing scans the patch bay and
//! there is no box siren or ring, so the whole patch-bay path has to run
//! from the Antivirus watch's booth buttons (`radio_*`): every patch_*
//! event, the forgiven first wrong combination, the second one's alarm with
//! the house router's siren and the room's bulb, and both endings. Played
//! through the public `Sim` API (helpers copied from trapped-heart.test.ts
//! so the files stay independent).

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const ROOM = ["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const directives = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).map((e) => `${e.verb} ${e.args}`.trim());
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e) => (e as { beat?: string; name?: string }).beat ?? (e as { name?: string }).name);

function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}
function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 5) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}
const PROGRAMS: Array<[string, string]> = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of PROGRAMS) upload(sim, id, name);
  return sim;
}
const fire = (sim: Sim, name: string, subject: string | null = null, actor?: string) => sim.signal(name, subject ?? undefined, null, actor);
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
function toY2K(sim: Sim): void {
  fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
  if (v(sim, "Night.filing_open") === true) fire(sim, "close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && v(sim, "Night.results_q") < 3; i++) fire(sim, "read_the_results");
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", 0);
  sim.choose("g3", 0);
  fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
  advance(sim, 2);
}

describe("the server room with no ESP32 (Q7)", () => {
  it("every patch-bay event has a booth button for the four room Antivirus", () => {
    const m = Sim.fromSources(SRC).model;
    for (const [button, event] of [["radio_combo_a", "patch_combo_a"], ["radio_combo_b", "patch_combo_b"], ["radio_wrong_patch", "patch_rejected"]] as const) {
      const i = m.interactions.get(button)!;
      expect(i, button).toBeTruthy();
      expect(i.who, button).toBe("performer");
      expect(i.by, button).toEqual(ROOM);
      // …and the director's own fallback cue for the same event.
      expect(m.interactions.get(event)?.who, event).toBe("admin");
    }
  });

  it("❌ twice from the watch's booth: the first is forgiven, the second trips the alarm with the router's siren and the room's bulb; then 🔌 ends the night", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    expect(v(sim, "Night.step")).toBeGreaterThanOrEqual(14);
    const first = fire(sim, "radio_wrong_patch", "g1", "CRA Agent Software");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.alarm_on")).not.toBe(true);
    expect(directives(first)).not.toContain("sfx alarm_siren");
    const second = fire(sim, "radio_wrong_patch", "g1", "Norton Anti-Virus");
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(beats(second)).toContain("Server Room Alarm");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    // No box siren: the alarm is the story's sound (the audio router) and its looks.
    expect(directives(second)).toEqual(expect.arrayContaining(["sfx alarm_siren", "cue lights_alarm", "cue heart_alarm"]));
    const end = fire(sim, "radio_combo_a", "g1", "Password Manager");
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(beats(end).length).toBeGreaterThan(0);
  });

  it("💥 from the watch's booth self-destructs the computer", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    fire(sim, "radio_combo_b", "g2", "McAfee Anti-Virus");
    expect(v(sim, "Night.ending")).toBe("destroyed");
  });
});
