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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { ModView } from "../server/views.ts";
import { TO_Y2K } from "../../scripts/accept/chains.ts";

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

  it("T5-crew-cards-04: after the timer's ⏰ with no ⚖️, 📺 points at ⚖️ (never at a ⏱ that refuses)", { timeout: SLOW }, () => {
    const sim = boot();
    for (const n of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt"]) press(sim, n);
    advance(sim, 900); // the timer's C2 ⏰
    expect(v(sim, "Night.phase")).toBe("truth_1");
    expect(v(sim, "Night.judging")).toBe(false);
    refuses(sim, "second_hunt_preview", "📺 Not yet: ⚖️ the First Moment of Truth first, then close the filings (⏱) and read the three results (📋). Nothing happens.");
    expect(press(sim, "first_moment_of_truth").refused).toBe(false);
    refuses(sim, "second_hunt_preview", "📺 Not yet: close the filings (⏱), then read the three results (📋). Nothing happens.");
  });

  it("T5-crew-cards-04: 🏓 before 📓 refuses (hunt 2's deal, the Truther Download and the summons are never skipped); in the hour it still cuts it short", { timeout: SLOW }, () => {
    const sim = boot();
    const line = "🏓 Not yet: hunt 2 (📓) and its summons come first. Nothing happens.";
    refuses(sim, "truth_pong", line);
    toTruth1(sim);
    refuses(sim, "truth_pong", line);
    for (const n of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview"]) press(sim, n);
    expect(v(sim, "Night.step")).toBe(7);
    refuses(sim, "truth_pong", line);
    expect(press(sim, "start_the_second_hunt").refused).toBe(false);
    expect(v(sim, "Night.hunt2_on")).toBe(true);
    // Hunt 2's hour: 🏓 may still end it early on purpose.
    expect(press(sim, "truth_pong").refused).toBe(false);
    expect(v(sim, "Night.phase")).toBe("truth_pong");
    expect(v(sim, "Night.hunt2_on")).toBe(false);
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
    // A printer lid opened late never sets the step back to the beans
    // (wave 9 integration): the overshare still never replays, and NEXT
    // stays on 🕚.
    press(sim, "printer_opened");
    expect([v(sim, "Night.step"), v(sim, "Night.phase"), v(sim, "Night.beans")]).toEqual([13, "overshare", true]);
    refuses(sim, "trabolta_overshares", "🤖 Not again: the overshare has already played. Nothing happens.");
    expect(sheet(sim)).toEqual({ last: "trabolta_overshares", next: "y2k_clock" });
    expect(press(sim, "y2k_clock").refused).toBe(false);
    expect(v(sim, "Night.phase")).toBe("y2k");
    expect(sheet(sim)).toEqual({ last: "y2k_clock", next: null });
  });

  it("T5-crew-cards-04: a printer lid first opened in the Y2K hour never re-arms 🕚 (no second hour, no second −25)", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    for (const n of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"]) {
      expect(press(sim, n).refused, n).toBe(false);
    }
    const clock = press(sim, "y2k_clock");
    expect(clock.refused).toBe(false);
    // Clippy's booth readout rides the accepted press.
    expect(JSON.stringify(clock.out)).toContain("📋 7/X is in What Clippy knows.");
    const end = v(sim, "Night.y2k_end");
    const composure = v(sim, "Trabolta.composure");
    advance(sim, 60);
    expect(press(sim, "printer_opened").refused).toBe(false);
    // The lid's beans play, but the Y2K hour keeps its step and phase.
    expect([v(sim, "Night.step"), v(sim, "Night.phase"), v(sim, "Night.beans")]).toEqual([14, "y2k", true]);
    refuses(sim, "y2k_clock", "🕚 Not again: the clock has already been reset. Nothing happens.");
    expect(live(sim, "y2k_clock")).toBe(false);
    expect(v(sim, "Night.y2k_end")).toBe(end);
    expect(v(sim, "Night.final_round")).toBe(true);
    expect(v(sim, "Trabolta.composure")).toBe(composure - 20); // the beans only
  });

  it("T5-crew-cards-04: 🤖 never plays past the clock, even with Night.step hand-set from World", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    for (const n of ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt", "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]) {
      expect(press(sim, n).refused, n).toBe(false);
    }
    expect(live(sim, "trabolta_overshares")).toBe(true);
    // A director's World recovery: the step jumped to the Y2K hour.
    sim.setVar("Night.step", "14");
    expect(live(sim, "trabolta_overshares")).toBe(false);
    refuses(sim, "trabolta_overshares", "🤖 Too late: the clock has already been reset. Nothing happens.");
    expect(v(sim, "Night.scenario")).toBe(0);
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
    // server-b's `_` skip: the ask is refused — never fired, never LAST.
    expect(pressRefused(sim, ask)).toBe(true);
    expect(cueState(sim).fired).not.toContain("resurrection");
    expect(sheet(sim).last).toBe("award_most_trusted");
    advance(sim, 10);
    expect(press(sim, "resurrection").refused).toBe(false);
    expect(v(sim, "Night.resurrected")).toBe(true);
    expect(sheet(sim).last).toBe("resurrection");
  });

  /** Dialogue lines in The Desktop by `speaker`. */
  const desktop = (evs: SimEvent[], speaker: string) =>
    (evs.filter((e) => e.type === "dialogue") as Extract<SimEvent, { type: "dialogue" }>[]).filter((e) => e.speaker === speaker && e.setting === "The Desktop").map((e) => e.text);
  const directives = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Extract<SimEvent, { type: "directive" }>[]).map((e) => `${e.verb} ${e.args}`.trim());

  it("T5-crew-cards-07 (D4): ✍ makes the director's own award lines replace Trabolta's template line; the fanfare and the slide stay", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    press(sim, "patch_combo_a");
    advance(sim, 11);
    press(sim, "trabolta_recounts");
    press(sim, "start_the_ceremony");
    expect(v(sim, "Night.ceremony_host")).toBe("Trabolta");
    expect(v(sim, "Night.award_lines")).toBe("template");
    // The template line by default.
    const g2 = press(sim, "award_most_trusted", "g1").out;
    expect(desktop(g2, "Trabolta").some((t) => t.startsWith("Most Trusted."))).toBe(true);
    // ✍: no Trabolta line, the fanfare + the slide still play.
    const on = press(sim, "own_award_lines");
    expect(on.refused).toBe(false);
    expect(hosts(on.out)[0]).toContain("✍ Award lines: yours.");
    expect(v(sim, "Night.award_lines")).toBe("director");
    const g3 = press(sim, "award_least_trusted", "g1").out;
    expect(desktop(g3, "Trabolta")).toEqual([]);
    expect(directives(g3)).toContain("sfx award_fanfare");
    expect(directives(g3)).toContain("cue screens_award_least_trusted");
    expect(v(sim, "Night.screen")).toBe("award_least_trusted");
    // The cue sheet: ✍ is off-sequence, NEXT is the next award.
    expect(sheet(sim)).toEqual({ last: "award_least_trusted", next: "award_frequent_flyer" });
    // Again: the template is back.
    press(sim, "own_award_lines");
    expect(v(sim, "Night.award_lines")).toBe("template");
    expect(desktop(press(sim, "award_frequent_flyer", "g1").out, "Trabolta").length).toBe(1);
  });

  it("T5-crew-cards-07 (D4): ✍ never silences Clippy, who reads every line after destroyed", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    press(sim, "patch_combo_b");
    advance(sim, 11);
    press(sim, "clippy_reads_summary");
    press(sim, "start_the_ceremony");
    expect(v(sim, "Night.ceremony_host")).toBe("Clippy");
    press(sim, "own_award_lines");
    const g2 = press(sim, "award_most_trusted", "g1").out;
    expect(desktop(g2, "Clippy").some((t) => t.startsWith("Award. Most Trusted."))).toBe(true);
    expect(desktop(g2, "Trabolta")).toEqual([]);
  });
});

// ───────── G11's ask over HTTP: what the director phone is answered ─────────

describe("wave 9 — G11's first press reaches the phone as refused (O1-open-issues-02, C3)", () => {
  const CODES = { event: "EVTG11", prime: "PRMG11", mod: "MODG11" };
  function fakeReq(body: unknown, headers: Record<string, string>): IncomingMessage {
    const buf = Buffer.from(JSON.stringify(body ?? {}));
    return { headers, [Symbol.asyncIterator]: async function* () { yield buf; }, on() {} } as unknown as IncomingMessage;
  }
  async function call(rt: EventRuntime, method: string, p: string, body: unknown, token?: string) {
    const url = new URL(`http://x${p}`);
    const res = {
      statusCode: 0,
      body: "",
      setHeader() {},
      writeHead(st: number) { res.statusCode = st; return res; },
      write() { return true; },
      end(b?: string) { if (typeof b === "string") res.body = b; return res; },
    };
    await rt.handle(fakeReq(body, token ? { "x-loom-token": token } : {}), res as unknown as ServerResponse, method, url.pathname, url, { moderator: false });
    return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
  }

  it("/api/mod/signal answers refused: true for the ask, the sheet keeps LAST, and the second press fires", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-g11-"));
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SRC, joinBase: () => "http://localhost" });
    try {
      rt.openDoors();
      const guest = (await call(rt, "POST", "/api/guest/register", { passcode: CODES.event, name: "Calculator" })).json;
      const token = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json["token"] as string;
      const signal = (name: string, subject?: string) => call(rt, "POST", "/api/mod/signal", { name, label: "Phone · Ana", ...(subject ? { subject } : {}) }, token);
      for (const n of TO_Y2K) expect((await signal(n)).json, n).toEqual({ ok: true });
      expect((await signal("patch_combo_a")).json).toEqual({ ok: true });
      for (let i = 0; i < 11; i++) rt.tickOnce(1000);
      for (const n of ["trabolta_recounts", "start_the_ceremony"]) expect((await signal(n)).json, n).toEqual({ ok: true });
      expect((await signal("award_most_trusted", String(guest["id"]))).json).toEqual({ ok: true });
      const ask = await signal("resurrection");
      expect(ask.status).toBe(200);
      expect(ask.json).toEqual({ ok: true, refused: true }); // the phone's "Not taken — G11 …"
      const view = (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ModView;
      expect(view.cues?.last).toBe("award_most_trusted");
      expect(view.cues?.fired).not.toContain("resurrection");
      expect(cueRows(view.interactions ?? [], view.cues!).find((r) => r.id === "resurrection")?.code).toBe("G11");
      expect((await signal("resurrection")).json).toEqual({ ok: true });
      const after = (await call(rt, "GET", "/api/state?role=mod&cues=1", {}, token)).json as unknown as ModView;
      expect(after.cues?.last).toBe("resurrection");
    } finally {
      rt.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
