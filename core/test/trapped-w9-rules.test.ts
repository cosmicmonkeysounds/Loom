//! Trapped in the Internet — the wave 9 story-rule fixes (OCT31 §5), played
//! through the public `Sim` API like the main show test
//! (trapped-in-the-internet.test.ts, whose drive helpers are copied here so
//! the two files stay independent).

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

// ───────────────────────── helpers ─────────────────────────

const SRC = scenarioSource("trapped-in-the-internet");
const fresh = (): Sim => Sim.fromSources(SRC);
const SLOW = 120_000;

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Args = Record<string, string | number | boolean>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const casts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[];
const cues = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).map((e) => `${e.verb} ${e.args}`.trim());
const widgets = (evs: SimEvent[]) => evs.filter((e) => e.type === "widget") as Ev<"widget">[];
/** What the crew's # hosts room hears. */
const hostsSaid = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue.replace(/^"|"$/gu, ""));

function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

/** Register → CAPTCHA → the problem (not asked of a featured name) → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string, scanner = "Norton Anti-Virus"): SimEvent[] {
  const out: SimEvent[] = [];
  out.push(...sim.createPerson(id, name));
  out.push(...sim.signal("captcha answered", id, { passed: true }));
  out.push(...sim.signal("captcha answered", id, { passed: false }));
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) out.push(...sim.choose(id, 0));
  out.push(...sim.choose(id, 0));
  out.push(...sim.scan(scanner, id));
  return out;
}

const PROGRAMS: Array<[string, string]> = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
function boot(programs: Array<[string, string]> = PROGRAMS): Sim {
  const sim = fresh();
  sim.fireBeat("Power On");
  for (const [id, name] of programs) upload(sim, id, name);
  return sim;
}
const fire = (sim: Sim, name: string, subject: string | null = null, args: Args | null = null, actor?: string) => sim.signal(name, subject ?? undefined, args, actor);
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
/** Through the first Moment of Truth (round-1 judging open). */
const toTruth1 = (sim: Sim) => fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
/** Hunt 2 through the Truther Download; Excel + OpenOffice answer `ex` / `oo`. */
function toHunt2(sim: Sim, ex = 0, oo = 0) {
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", ex);
  sim.choose("g3", oo);
}
/** Summons → pong → chart → rankings → printer. */
const toBeans = (sim: Sim) => fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened");
/** Through the Y2K clock (Night.step 14), no majority yet. */
function toY2k(sim: Sim) {
  toTruth1(sim);
  toHunt2(sim);
  toBeans(sim);
  fireAll(sim, "trabolta_overshares", "y2k_clock");
}

// ───────────────────────── 💡 holds the dance (D2) ─────────────────────────

describe("wave 9 — 💡 Restore the house lights holds a pending dance (ALL STOP, D2)", () => {
  for (const ending of ["patch_combo_a", "patch_combo_b", "talked_down"]) {
    it(`${ending}: 💡 inside the ten-second blackout cancels the automatic dance; 🪩 plays it later`, { timeout: SLOW }, () => {
      const sim = boot();
      toY2k(sim);
      fire(sim, ending);
      expect(v(sim, "Night.dance_at")).toBeGreaterThan(0);
      advance(sim, 3);
      const stop = fire(sim, "restore_the_lights");
      expect(cues(stop)).toContain("cue lights_restore");
      expect(hostsSaid(stop)).toContain("💡 The dance is held: press 🪩 when the house manager says go.");
      expect(v(sim, "Night.dance_at")).toBe(0);
      // Nothing automatic re-lights the house, and the takeover stays up (🪩 lifts it).
      expect(cues(advance(sim, 15)).filter((c) => c.startsWith("cue lights_"))).toEqual([]);
      expect(v(sim, "Night.lights")).toBe("restore");
      expect(v(sim, "Night.takeover")).toBe(true);
      const go = fire(sim, "lights_dance");
      expect(cues(go)).toContain("cue lights_dance");
      expect(v(sim, "Night.lights")).toBe("dance");
      expect(v(sim, "Night.takeover")).toBe(false);
    });
  }

  it("without 💡 the dance still lands ten seconds after the blackout; a 💡 with no dance pending says nothing about one", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    const quiet = fire(sim, "restore_the_lights");
    expect(hostsSaid(quiet)).toEqual([]);
    fire(sim, "patch_combo_a");
    expect(cues(advance(sim, 11))).toContain("cue lights_dance");
    expect(v(sim, "Night.lights")).toBe("dance");
  });
});

// ───────────────────────── 🍾 the bottle's pool (D3) ─────────────────────────

describe("wave 9 — the bottle picks any cleared, free program (T5-crew-cards-02, D3)", () => {
  /** The ids the server's `do pick` would choose from. */
  const pool = (evs: SimEvent[]) => {
    const pick = cues(evs).find((c) => c.startsWith("pick "))!;
    return pick.slice(pick.indexOf("[") + 1, pick.indexOf("]")).split(",").map((s) => s.trim()).filter((s) => s !== "").sort();
  };

  it("a program whose last check-in was another room is still pickable; the Internet, the corrupted, the marked and the away are not", { timeout: SLOW }, () => {
    const sim = boot();
    fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt");
    // Hunt 1 sends them round the house: room-sign check-ins move them.
    fire(sim, "checked_in", "g1", { at: "The CPU" });
    fire(sim, "checked_in", "g2", { at: "The Start Bar" });
    fire(sim, "checked_in", "g3", { at: "The Steam Room" });
    expect(v(sim, "g1.location")).toBe("The CPU");
    fireAll(sim, "hunt_time_up", "first_moment_of_truth");
    expect(v(sim, "g1.location")).toBe("The CPU"); // C2 / V6 move nobody
    // One captured, one marked, one away: the rest are the pool.
    sim.setVar("g4.marked", "true");
    sim.setVar("g5.afk", "true");
    sim.capture("g6");
    expect(v(sim, "g6.location")).toBe("The Internet");
    advance(sim, 120);
    fire(sim, "read_the_results");
    expect(pool(fire(sim, "spin_the_bottle"))).toEqual(["g1", "g2", "g3"]);
  });
});
