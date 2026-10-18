//! Trapped in the Internet — wave 9, the cue sheet's lane: the director's
//! sheet walked press by press through a whole night, so NEXT always names
//! the cue that plays next (never a timer's own fallback), a cue pressed
//! too early refuses in # hosts, and the ceremony's NEXT follows tonight's
//! cast.

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { cueState, modView, notePress, pressRefused } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

/** Ticks one second at a time, like the server's clock. */
function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

/** Register → CAPTCHA → the problem (if asked) → deposit → the door scan. */
function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) sim.choose(id, 0);
  sim.choose(id, 0);
  sim.scan("Norton Anti-Virus", id);
}

const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];

function boot(programs = PROGRAMS): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of programs) upload(sim, id, name);
  return sim;
}

/** A director's press, noted the way the event server notes it. */
function press(sim: Sim, name: string, subject?: string, args: Record<string, string | number | boolean> | null = null) {
  const out = sim.signal(name, subject, args);
  notePress(sim, out);
  return { out, refused: pressRefused(sim, out) };
}

/** The cue sheet's LAST / NEXT, as the editor and the phone render it. */
function sheet(sim: Sim) {
  const rows = cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
  return { last: rows.find((r) => r.last)?.id ?? null, next: rows.find((r) => r.next)?.id ?? null };
}

/** What the press told # hosts. */
const hosts = (evs: SimEvent[]) =>
  evs.filter((e): e is Extract<SimEvent, { type: "broadcast" }> => e.type === "broadcast" && e.scope === "channel(hosts)").map((e) => e.cue);

describe("Trapped in the Internet — wave 9 (the cue sheet)", () => {
  it("R2-diff-clients-01: the Act II timers' own steps are off-sequence", () => {
    const m = Sim.fromSources(SRC).model;
    for (const id of ["hunt_time_up", "truther_download", "five_minute_warning", "summons_closed"]) {
      expect(m.interactions.get(id)!.sequence, id).toBe(false);
    }
  });

  it("R2-diff-clients-01: walked press by press, NEXT names the cue that plays next and stays empty while a timer runs", { timeout: SLOW }, () => {
    const sim = boot();
    const step = (name: string, next: string | null) => {
      const r = press(sim, name);
      expect(r.refused, name).toBe(false);
      expect(sheet(sim).next, `NEXT after ${name}`).toBe(next);
    };
    expect(sheet(sim)).toEqual({ last: null, next: "call_to_the_desktop" });
    step("call_to_the_desktop", "start_the_bingo");
    step("start_the_bingo", "bingo_time");
    step("bingo_time", "introduce_trabolta");
    step("introduce_trabolta", "start_the_hunt");
    // Hunt 1: fifteen minutes on the clock, nothing to suggest.
    step("start_the_hunt", null);
    advance(sim, 600);
    expect(sheet(sim).next).toBe(null);
    advance(sim, 300); // the timer's C2 ⏰
    expect(v(sim, "Night.phase")).toBe("truth_1");
    expect(sheet(sim)).toEqual({ last: "start_the_hunt", next: "first_moment_of_truth" });
    step("first_moment_of_truth", "close_the_filing");
    step("close_the_filing", "read_the_results");
    step("read_the_results", "read_the_results");
    step("read_the_results", "read_the_results");
    step("read_the_results", "second_hunt_preview");
    step("second_hunt_preview", "start_the_second_hunt");
    // Hunt 2's hour, then the summons: the timers run it all.
    step("start_the_second_hunt", null);
    advance(sim, 130); // 📥
    expect(v(sim, "Night.truther_sent")).toBe(true);
    expect(sheet(sim).next).toBe(null);
    advance(sim, 590); // +12 min
    expect(sheet(sim).next).toBe(null);
    advance(sim, 3300 - 720); // the timer's ⏳
    expect(v(sim, "Night.phase")).toBe("summons");
    expect(sheet(sim).next).toBe(null);
    advance(sim, 301); // the timer's 🚨
    expect(v(sim, "Night.summons_closed")).toBe(true);
    expect(sheet(sim)).toEqual({ last: "start_the_second_hunt", next: "truth_pong" });
    step("truth_pong", "round_two_tally");
    step("round_two_tally", "trust_chart");
    step("trust_chart", "show_the_rankings");
    step("show_the_rankings", "trabolta_overshares");
    press(sim, "printer_opened"); // the lid sensor (off-sequence)
    expect(sheet(sim).next).toBe("trabolta_overshares");
    step("trabolta_overshares", "y2k_clock");
    // The Y2K hour (wave 8): nothing until midnight fires 🌑 itself.
    step("y2k_clock", null);
    advance(sim, 3600);
    expect(v(sim, "Night.phase")).toBe("final_reveal");
    expect(sheet(sim)).toEqual({ last: "final_reveal", next: "bobbing_for_truth" });
  });

  it("T5-crew-cards-05: the two-minute timer closes the filing as ⏱, so NEXT moves on to 📋", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt"]) press(sim, n);
    advance(sim, 900);
    press(sim, "first_moment_of_truth");
    expect(sheet(sim).next).toBe("close_the_filing");
    advance(sim, 121);
    expect(v(sim, "Night.r1_closed")).toBe(true);
    expect(v(sim, "Night.filing_open")).toBe(false);
    expect(cueState(sim).fired).toContain("close_the_filing");
    expect(sheet(sim)).toEqual({ last: "close_the_filing", next: "read_the_results" });
    // A late ⏱ is refused in # hosts and changes nothing.
    const late = press(sim, "close_the_filing");
    expect(late.refused).toBe(true);
    expect(hosts(late.out)).toEqual(["\"⏱ No filing window is open.\""]);
    expect(sheet(sim)).toEqual({ last: "close_the_filing", next: "read_the_results" });
    expect(press(sim, "read_the_results").refused).toBe(false);
    expect(v(sim, "Night.results_q")).toBe(1);
  });

  it("R2-diff-clients-01: 🌑's while: never holds before the Y2K clock (hunt 2's hour suggests nothing)", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt"]) press(sim, n);
    advance(sim, 900);
    for (const n of ["first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"]) press(sim, n);
    advance(sim, 720);
    const live = (modView(sim, "open", "x").interactions ?? []).filter((i) => i.who === "admin" && i.sequence !== false && i.live !== false).map((i) => i.id);
    // Only the cues already behind LAST (or before 🔎) are still live; nothing ahead.
    expect(live).not.toContain("final_reveal");
    expect(live).not.toContain("truth_pong");
    expect(sheet(sim).next).toBe(null);
  });
});
