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

  /** Through V6 and the auto C2 (the presses a director makes). */
  const toTruth1 = (sim: Sim) => {
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) press(sim, n);
  };
  /** A refused press: only # hosts hears, nothing moves, LAST stays. */
  function refuses(sim: Sim, name: string, line: string) {
    const before = { phase: v(sim, "Night.phase"), step: v(sim, "Night.step"), round: v(sim, "Night.round"), last: sheet(sim).last };
    const r = press(sim, name);
    expect(r.refused, name).toBe(true);
    expect(hosts(r.out), name).toEqual([JSON.stringify(line)]);
    expect(r.out.filter((e) => e.type === "beatEntered" || (e.type === "directive" && e.verb === "cue")), name).toEqual([]);
    expect({ phase: v(sim, "Night.phase"), step: v(sim, "Night.step"), round: v(sim, "Night.round"), last: sheet(sim).last }, name).toEqual(before);
  }

  it("T5-crew-cards-04: 📺 refuses until the three results are read, and the next 📋 still settles", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    refuses(sim, "second_hunt_preview", "📺 Not yet: close the filings (⏱), then read the three results (📋). Nothing happens.");
    refuses(sim, "start_the_second_hunt", "📓 Not yet: 📺 the hunt 2 preview (the ad hijack) first. Nothing happens.");
    refuses(sim, "five_minute_warning", "⏳ Not yet: the summons ends hunt 2's hour (📓 first). Nothing happens.");
    press(sim, "close_the_filing");
    press(sim, "read_the_results");
    refuses(sim, "second_hunt_preview", "📺 Not yet: read Q2's results first (📋). Nothing happens.");
    expect(sheet(sim)).toEqual({ last: "read_the_results", next: "read_the_results" });
    expect(press(sim, "read_the_results").refused).toBe(false);
    expect(v(sim, "Night.results_q")).toBe(2);
    press(sim, "read_the_results");
    expect(sheet(sim).next).toBe("second_hunt_preview");
    expect(press(sim, "second_hunt_preview").refused).toBe(false);
    expect(v(sim, "Night.phase")).toBe("malware");
    refuses(sim, "second_hunt_preview", "📺 Not again: the ad hijack has already played. Nothing happens.");
  });

  it("T5-crew-cards-04: before Truth Pong a director's 📺 / 📊 / 🕚 refuse in order, never skipping a step's work", { timeout: SLOW }, () => {
    const sim = boot();
    refuses(sim, "second_hunt_preview", "📺 Too early: the First Moment of Truth (⚖️) and its results come first. Nothing happens.");
    toTruth1(sim);
    for (const n of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong"]) {
      expect(press(sim, n).refused, n).toBe(false);
    }
    // 📊 before 🧮: round 2 is never lost.
    refuses(sim, "trust_chart", "📊 Not yet: 🏓 Truth Pong, then 🧮 the tally first. Nothing happens.");
    refuses(sim, "trabolta_overshares", "🤖 Not yet: 📊 the Trust Chart first. Nothing happens.");
    refuses(sim, "y2k_clock", "🕚 Not yet: 🤖 Trabolta shares the next facts first (round 3 opens there). Nothing happens.");
    expect(sheet(sim)).toEqual({ last: "truth_pong", next: "round_two_tally" });
    press(sim, "round_two_tally");
    expect(v(sim, "Night.tallied")).toBe(true);
    expect(press(sim, "trust_chart").refused).toBe(false);
    expect(v(sim, "Night.phase")).toBe("trust_chart");
    press(sim, "show_the_rankings");
    // 🗜 then 🕚 (skipping 🤖): refused, round 3 still opens at 🤖.
    press(sim, "zip_everyone_out");
    refuses(sim, "y2k_clock", "🕚 Not yet: 🤖 Trabolta shares the next facts first (round 3 opens there). Nothing happens.");
    expect(v(sim, "Night.round")).toBe(2);
    expect(sheet(sim)).toEqual({ last: "show_the_rankings", next: "trabolta_overshares" });
    expect(press(sim, "trabolta_overshares").refused).toBe(false);
    expect(v(sim, "Night.round")).toBe(3);
    expect(v(sim, "Night.scenario")).not.toBe(0);
    expect(sheet(sim)).toEqual({ last: "trabolta_overshares", next: "y2k_clock" });
    // A printer lid opened late sets the step back to the beans: the
    // overshare still never replays, and NEXT stays on 🕚.
    press(sim, "printer_opened");
    refuses(sim, "trabolta_overshares", "🤖 Not again: the overshare has already played. Nothing happens.");
    expect(sheet(sim)).toEqual({ last: "trabolta_overshares", next: "y2k_clock" });
    expect(press(sim, "y2k_clock").refused).toBe(false);
    expect(v(sim, "Night.phase")).toBe("y2k");
    expect(sheet(sim)).toEqual({ last: "y2k_clock", next: null });
  });

  /** A director's whole night to the Y2K clock, the timers' steps pressed by hand. */
  function toY2k(sim: Sim) {
    toTruth1(sim);
    for (const n of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock"]) {
      expect(press(sim, n).refused, n).toBe(false);
    }
  }
  /** Combo A → the dance → 🏍 → G1 → G2–G9 on Calculator. */
  function throughG9(sim: Sim) {
    toY2k(sim);
    press(sim, "patch_combo_a");
    advance(sim, 11);
    for (const n of ["trabolta_recounts", "start_the_ceremony"]) expect(press(sim, n).refused, n).toBe(false);
    for (const n of ["award_most_trusted", "award_least_trusted", "award_frequent_flyer", "award_lore_hoarder", "award_truthcoin_tycoon", "award_best_liar", "award_duck_speedrun", "award_quest_completionist"]) {
      expect(press(sim, n, "g1").refused, n).toBe(false);
    }
  }
  const live = (sim: Sim, id: string) => (modView(sim, "open", "x").interactions ?? []).find((i) => i.id === id)?.live !== false;

  it("T5-crew-cards-08 / R2-diff-clients-04: with no MS Paint at the party NEXT after G9 is G11, never G10", { timeout: SLOW }, () => {
    const sim = boot(PROGRAMS.filter(([id]) => id !== "g4"));
    throughG9(sim);
    expect(v(sim, "Night.painting")).toBe(false);
    expect(live(sim, "award_the_painting")).toBe(false);
    expect(sheet(sim)).toEqual({ last: "award_quest_completionist", next: "resurrection" });
    expect(press(sim, "resurrection").refused).toBe(false);
    expect(v(sim, "Night.resurrected")).toBe(true);
    expect(sheet(sim)).toEqual({ last: "resurrection", next: null });
  });

  it("T5-crew-cards-08 / R2-diff-clients-04: with MS Paint cleared NEXT after G9 is G10, then G11", { timeout: SLOW }, () => {
    const sim = boot();
    throughG9(sim);
    expect(v(sim, "Night.painting")).toBe(true);
    expect(sheet(sim)).toEqual({ last: "award_quest_completionist", next: "award_the_painting" });
    expect(press(sim, "award_the_painting", "g4").refused).toBe(false);
    expect(v(sim, "Night.ceremony_done")).toBe(true);
    expect(sheet(sim)).toEqual({ last: "award_the_painting", next: "resurrection" });
    expect(press(sim, "resurrection").refused).toBe(false);
    expect(v(sim, "Night.resurrected")).toBe(true);
  });

  it("O1-open-issues-02 (C3): G11's ask before the last award writes only `_` bookkeeping and # hosts; a second press within 30 s ends the show", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    press(sim, "patch_combo_a");
    advance(sim, 11);
    press(sim, "trabolta_recounts");
    press(sim, "start_the_ceremony");
    press(sim, "award_most_trusted", "g1");
    const ask = sim.signal("resurrection");
    notePress(sim, ask);
    expect(v(sim, "Night.resurrected")).toBe(false);
    expect(hosts(ask)[0]).toContain("Press G11 again within 30 seconds");
    // Everything the ask did besides # hosts is a world write whose last
    // segment starts with `_` — cue-sheet bookkeeping refusedPress skips (C3).
    const rest = ask.slice(1).filter((e) => !(e.type === "broadcast" && e.scope === "channel(hosts)") && e.type !== "diagnostic");
    expect(rest.length).toBeGreaterThan(0);
    for (const e of rest) {
      expect(e.type).toBe("worldSet");
      expect((e as Extract<SimEvent, { type: "worldSet" }>).path.split(".").at(-1)!.startsWith("_")).toBe(true);
    }
    expect(v(sim, "Night._resurrect_ask_at")).toBeGreaterThan(0);
    advance(sim, 10);
    expect(press(sim, "resurrection").refused).toBe(false);
    expect(v(sim, "Night.resurrected")).toBe(true);
    expect(sheet(sim).last).toBe("resurrection");
  });
});
