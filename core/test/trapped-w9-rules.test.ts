//! Trapped in the Internet — the wave 9 story-rule fixes (OCT31 §5), played
//! through the public `Sim` API like the main show test
//! (trapped-in-the-internet.test.ts, whose drive helpers are copied here so
//! the two files stay independent).

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { FACTS_FILE } from "../src/facts.ts";
import { judgeAnswer, parseFactsBook } from "../server/facts.ts";
import { liesByPerson } from "../server/recap.ts";

// ───────────────────────── helpers ─────────────────────────

const SRC = scenarioSource("trapped-in-the-internet");
const fresh = (): Sim => Sim.fromSources(SRC);
/** The server's answer key: the tests attach the verdict the event server would. */
const BOOK = parseFactsBook(readFileSync(join(scenarioDir("trapped-in-the-internet"), FACTS_FILE), "utf8")).book!;
const SLOW = 120_000;

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
type Args = Record<string, string | number | boolean>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const said = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const lines = (evs: SimEvent[], speaker: string) => said(evs).filter((e) => e.speaker === speaker).map((e) => e.text);
const casts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[];
const cues = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).map((e) => `${e.verb} ${e.args}`.trim());
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e) => (e as { beat?: string; name?: string }).beat ?? (e as { name?: string }).name);
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
  if (p && p.length === 5) out.push(...sim.choose(id, 0));
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
/** Wave 59a: ⚖ plays the full truth, then 8-A or 8-B follow by themselves, so a
 *  press of it here ticks past them to the song. */
const VERDICT_PAGES_S = [831, 77]; // the full truth, then 8-A, to the song
const pastTheVerdict = (sim: Sim, name: string): SimEvent[] => {
  const out: SimEvent[] = [];
  if (name === "the_verdict") for (const seconds of VERDICT_PAGES_S) out.push(...sim.tick(seconds * 1000));
  return out;
};
const fire = (sim: Sim, name: string, subject: string | null = null, args: Args | null = null, actor?: string) => [...sim.signal(name, subject ?? undefined, args, actor), ...pastTheVerdict(sim, name)];
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
/** Through the first Moment of Truth (round-1 judging open). */
const toTruth1 = (sim: Sim) => fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
/** ⏱ (if the window is open) and 📋 until the three results are read:
 *  📺 refuses before them (wave 9 story-cues, T5-crew-cards-04). */
function readResults(sim: Sim) {
  if (v(sim, "Night.filing_open") === true) fire(sim, "close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && v(sim, "Night.results_q") < 3; i++) fire(sim, "read_the_results");
}
/** Hunt 2 through the Truther Download; Excel + OpenOffice answer `ex` / `oo`. */
function toHunt2(sim: Sim, ex = 0, oo = 0) {
  readResults(sim);
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

/** 📄 truth.txt, then ⚖ the verdict once the bobber has read it. */
const truthTxt = (sim: Sim): SimEvent[] => [...fire(sim, "read_truth_txt"), ...fire(sim, "the_verdict")];

/** Judge all eight questions accurately (or one lie), through the bob (the main show test's `toBobbing`). */
function toBobbing(sim: Sim, opts: { lie?: boolean; retract?: boolean } = {}) {
  toTruth1(sim);
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, opts.lie || opts.retract ? "confident_q3" : "accurate_q3", "g3", null, "Clippy");
  // A 😤 meant as ✅: the host presses ✅ for the same answer.
  if (opts.retract) fire(sim, "accurate_q3", "g3", null, "Clippy");
  toHunt2(sim);
  fire(sim, "five_minute_warning");
  for (const [g] of PROGRAMS) fire(sim, "check_in_at_desktop", g, null, "Task Manager");
  fireAll(sim, "summons_closed", "truth_pong");
  for (const [g, q] of [["g4", "accurate_q1"], ["g5", "accurate_q2"], ["g6", "accurate_q3"]] as const) {
    fire(sim, "made_the_cup", g, null, "Clippy");
    fire(sim, q, g, null, "Clippy");
  }
  fireAll(sim, "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
  advance(sim, 3600);
  expect(v(sim, "Night.phase")).toBe("final_reveal");
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, "bobbing_for_truth");
  fire(sim, "failed_the_bob", "g5", null, "Adobe Acrobat");
  fire(sim, "send to the internet", "g5", null, "Norton Anti-Virus");
  fire(sim, "brought_up_the_bag", "g4", null, "Clippy");
  expect(v(sim, "Night.bobber")).toBe("MS Paint");
}

// ───────────────────────── 💡 holds the dance (D2) ─────────────────────────

describe("wave 9 — 💡 Restore the house lights holds a pending dance (ALL STOP, D2)", () => {
  for (const ending of ["patch_combo_a", "patch_combo_b"]) {
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
    fire(sim, "checked_in", "g3", { at: "The Power Supply" });
    expect(v(sim, "g1.location")).toBe("The CPU");
    fireAll(sim, "hunt_time_up", "first_moment_of_truth");
    expect(v(sim, "g1.location")).toBe("The CPU"); // C2 / V6 move nobody
    // One captured, one marked, one away: the rest are the pool.
    sim.setVar("g4.marked", "true");
    sim.setVar("g5.afk", "true");
    sim.capture("g6");
    expect(v(sim, "g6.location")).toBe("The Internet");
    advance(sim, 120);
    for (let q = 0; q < 3; q++) fire(sim, "read_the_results"); // wave 18b: the bottle after Q3
    expect(pool(fire(sim, "spin_the_bottle"))).toEqual(["g1", "g2", "g3"]);
  });
});

// ───────────────────────── a stale bottle card in the advice poll ─────────────────────────

describe("wave 9 — only the advice card votes in the advice poll (T2-facts-03)", () => {
  it("a late tap on a bottle card left on the phone votes nothing and keeps the program's real vote", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { lie: true });
    truthTxt(sim);
    fire(sim, "ask_for_advice");
    expect(v(sim, "Night.poll")).toBe("advice");
    // The bottle's Truth | Dare card, never tapped in round 1, tapped now.
    fire(sim, "poll answered", "g1", { choice: "Dare", index: 1, card: 252 });
    fire(sim, "poll answered", "g2", { choice: "Truth", index: 0, card: 253 });
    expect(v(sim, "Night.help_votes")).toBe(0);
    expect(v(sim, "Night.thwart_votes")).toBe(0);
    expect(v(sim, "g1.advice")).toBe("none");
    expect(v(sim, "g1.marked")).not.toBe(true);
    // Their real advice votes still count.
    fire(sim, "poll answered", "g1", { choice: "Help him", index: 0, card: 674 });
    fire(sim, "poll answered", "g2", { choice: "Thwart him", index: 1, card: 675 });
    expect(v(sim, "Night.help_votes")).toBe(1);
    expect(v(sim, "Night.thwart_votes")).toBe(1);
    expect(v(sim, "g1.advice")).toBe("help");
    expect(v(sim, "g2.advice")).toBe("thwart");
  });
});

// ───────────────────────── an ending closes the 📝 cards ─────────────────────────

describe("wave 9 — a server-room ending closes every live 📝 card (T7-02)", () => {
  const facts = (evs: SimEvent[], g: string) => widgets(evs).filter((w) => w.widget === "fact" && w.audience[0] === g);
  const qs = (w: { params: Record<string, string> }) => (w.params["questions"] ?? "").split("|").map((q) => q.trim()).filter(Boolean);

  for (const ending of ["patch_combo_a", "patch_combo_b"]) {
    it(`${ending}: the round-3 card becomes the closing card, once, and nothing after deals another`, { timeout: SLOW }, () => {
      const sim = boot();
      // Everyone checks in at the summons, so nobody is late and marked: a
      // marked program is dealt no 📝 card (w13 Q35).
      toTruth1(sim);
      toHunt2(sim);
      fire(sim, "five_minute_warning");
      for (const [g] of PROGRAMS) fire(sim, "check_in_at_desktop", g, null, "Task Manager");
      fireAll(sim, "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
      for (const [g] of PROGRAMS) expect(v(sim, `${g}.marked`), g).not.toBe(true);
      for (const [g] of PROGRAMS) expect(v(sim, `${g}.fact_card_live`), g).toBe(true);
      const end = [...fire(sim, ending), ...advance(sim, 15)];
      expect(v(sim, "Night.ended")).toBe(true);
      for (const [g] of PROGRAMS) {
        const closed = facts(end, g);
        expect(closed.map((w) => w.text), g).toEqual(["📝 The filing is closed"]);
        expect(qs(closed[0]!), g).toEqual([]);
        expect(closed[0]!.params["thread"], g).toBe("Trabolta");
        expect(v(sim, `${g}.fact_card_live`), g).toBe(false);
      }
      const after = fireAll(sim, "clippy_reads_summary", "tell_the_truth", "start_the_ceremony", "start_the_ceremony", "resurrection", "resurrection");
      expect(widgets(after).filter((w) => w.widget === "fact")).toEqual([]);
    });
  }
});

// ───────────────────────── featured goals met early ─────────────────────────

describe("wave 9 — a featured goal met before the Truther Download completes its quest when it starts (T10-01)", () => {
  it("Bugdom's four secrets, Jeeves' five originals and Excel's plant, all before the download → done; Purgatory says so", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g8", "Bugdom");
    upload(sim, "g9", "Broken Ask Jeeves");
    for (const code of ["MINIATURE-DOSES", "LAMBORGHINI-CERT", "HAMTARO", "DECIMAL-POINT"]) sim.redeem("g8", code);
    for (const code of ["MAPSANDDUCKS-COM", "CASINO-DEED", sim.model.codex.get("The Billboard On Lower Water")!.code!, "SAVE-THE-PETS", "WHOIS-1999"]) sim.redeem("g9", code);
    for (const e of ["Miniature Doses", "The Lamborghini Certificate", "What Happened To Hamtaro", "The Decimal Point"]) expect(sim.holdsCodex("g8", e), e).toBe(true);
    toTruth1(sim);
    // Excel brings the virus back in hunt 1 and plants it.
    sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
    fire(sim, "plant_the_virus", "g2");
    expect(v(sim, "Kernel.excel_planted")).toBe(true);
    for (const [g, q] of [["g2", "Excel Mission"], ["g8", "Master Of The Bugs"], ["g9", "Unscramble"]] as const) expect(sim.questStatus(g, q), q).toBe(null);
    const dl: SimEvent[] = [];
    readResults(sim);
    dl.push(...fireAll(sim, "second_hunt_preview", "start_the_second_hunt"));
    dl.push(...advance(sim, 120));
    dl.push(...sim.choose("g2", 0)); // sabotage
    dl.push(...sim.choose("g3", 0));
    expect(v(sim, "g2.excel_choice")).toBe("sabotage");
    for (const [g, q] of [["g2", "Excel Mission"], ["g8", "Master Of The Bugs"], ["g9", "Unscramble"]] as const) expect(sim.questStatus(g, q), q).toBe("done");
    // Excel's thread ends on the plant, not on an order to go and do it.
    const steps = dl.filter((e) => e.type === "quest" && (e as { person: string }).person === "g2").map((e) => (e as { text: string | null }).text);
    expect(steps.at(-1)).toBe("Virus planted.");
    toBeans(sim);
    fireAll(sim, "trabolta_overshares", "y2k_clock", "patch_combo_b");
    advance(sim, 15);
    const sum = fire(sim, "clippy_reads_summary");
    const clippy = lines(sum, "Clippy");
    for (const who of ["Microsoft Excel", "Bugdom"]) expect(clippy, who).toContain(`${who} met their goal tonight.`);
  });

  it("the late order still completes on the goal itself (Jeeves' fifth original after the download)", { timeout: SLOW }, () => {
    const sim = boot();
    upload(sim, "g9", "Broken Ask Jeeves");
    for (const code of ["MAPSANDDUCKS-COM", "CASINO-DEED", sim.model.codex.get("The Billboard On Lower Water")!.code!, "SAVE-THE-PETS"]) sim.redeem("g9", code);
    toTruth1(sim);
    toHunt2(sim);
    expect(sim.questStatus("g9", "Unscramble")).toBe("active");
    sim.redeem("g9", "WHOIS-1999");
    expect(sim.questStatus("g9", "Unscramble")).toBe("done");
  });
});

// ───────────────────────── the King after 📄 ─────────────────────────

describe("wave 9 — a King win after truth.txt gives no door code (R2-diff-clients-03)", () => {
  const guestCasts = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope !== "channel(hosts)");

  it("Grok Prom and the banishment: a checkmate tells # hosts only; Night.king_armed is 1 from Power On to 📄 (wave 11)", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "Night.king_armed")).toBe(1);
    toBobbing(sim, { lie: true });
    // The King plays for the code all night, until 📄.
    expect(v(sim, "Night.king_armed")).toBe(1);
    truthTxt(sim);
    expect(v(sim, "Night.r3_closed")).toBe(true);
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(v(sim, "Night.king_armed")).toBe(0);
    const after = "♟ A King win after truth.txt: the verdict is in, no door code. Nothing happens in the story.";
    const w = fire(sim, "chess won", "g1", null, "Terminal · Server Door");
    expect(hostsSaid(w)).toEqual([after]);
    expect(guestCasts(w)).toEqual([]);
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(false);
    fireAll(sim, "ask_for_advice", "advice_thwarted");
    expect(v(sim, "Night.ending")).toBe("banished");
    const w2 = fire(sim, "chess_won", "g6");
    expect(hostsSaid(w2)).toEqual([after]);
    expect(guestCasts(w2)).toEqual([]);
    expect(sim.holdsCodex("g6", "The Door Code")).toBe(false);
  });

  it("from the Y2K hour, before 📄, a win still gives the code; an ending disarms the King", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    expect(v(sim, "Night.king_armed")).toBe(1);
    fire(sim, "chess won", "g1");
    expect(sim.holdsCodex("g1", "The Door Code")).toBe(true);
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.king_armed")).toBe(0);
  });
});

// ───────────────────────── the 90 s restore after a room-scoped look ─────────────────────────

describe("wave 9 — a cut room comes back on unless the next look re-lit it (T8-stagehand-01)", () => {
  const on = (room: string) => `cue lights, room: ${room}, state: on`;
  const cut = (sim: Sim, room: string) => {
    expect(cues(fire(sim, "cut_the_lights", "g1", { room }, "Trabolta"))).toContain(`cue lights, room: ${room}, state: off`);
  };
  /** Hunt 2 through the summons: the cut window is open, the look is the hunt's. */
  const toSummons = (sim: Sim) => {
    toTruth1(sim);
    toHunt2(sim);
    fireAll(sim, "five_minute_warning", "summons_closed");
  };

  it("🏓 pong (backyard only) after a RAM cut: the RAM comes back on at 90 s", { timeout: SLOW }, () => {
    const sim = boot();
    toSummons(sim);
    cut(sim, "The RAM");
    advance(sim, 20);
    expect(cues(fire(sim, "truth_pong"))).toContain("cue lights_pong");
    const back = cues(advance(sim, 75));
    expect(back).toContain(on("The RAM"));
    expect(v(sim, "Night.lights_back_at")).toBe(0);
    expect(v(sim, "Night.lit_scene")).toBe("pong"); // the catch-up replays the room-on only under pong
  });

  it("🫘 the glitch (an effect, no state) after a Desktop cut: the Desktop comes back on", { timeout: SLOW }, () => {
    const sim = boot();
    toSummons(sim);
    fireAll(sim, "truth_pong", "round_two_tally", "trust_chart");
    cut(sim, "The Desktop");
    advance(sim, 20);
    fire(sim, "show_the_rankings");
    expect(cues(fire(sim, "printer_opened"))).toContain("cue lights_glitch");
    expect(cues(advance(sim, 75))).toContain(on("The Desktop"));
  });

  it("a living-room look re-lights the Desktop (no room-on) but not the RAM (room-on)", { timeout: SLOW }, () => {
    for (const [room, relit] of [["The Desktop", true], ["The RAM", false]] as const) {
      const sim = boot();
      toSummons(sim);
      fireAll(sim, "truth_pong", "round_two_tally");
      cut(sim, room);
      advance(sim, 20);
      expect(cues(fire(sim, "trust_chart"))).toContain("cue lights_trust_chart");
      expect(cues(advance(sim, 75)).includes(on(room)), room).toBe(!relit);
    }
  });

  it("a whole-house look still wins: no room-on over the dance or the blackout", { timeout: SLOW }, () => {
    for (const look of ["lights_dance", "patch_combo_a"]) {
      const sim = boot();
      toY2k(sim);
      cut(sim, "The RAM");
      advance(sim, 20);
      fire(sim, look);
      expect(cues(advance(sim, 75)).some((c) => c.includes("room: The RAM, state: on")), look).toBe(false);
    }
  });

  it("the patch-bay alarm over the server-room look: a Start Bar cut during it stays with the Y2K look the latch puts back", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    fire(sim, "force_majority_leave");
    fireAll(sim, "patch_rejected", "patch_rejected");
    expect([v(sim, "Night.lights"), v(sim, "Night.lights_before_alarm")]).toEqual(["alarm", "server_open"]);
    advance(sim, 60);
    cut(sim, "The Start Bar");
    const after = cues(advance(sim, 95)).filter((c) => c.startsWith("cue lights"));
    expect(after).toEqual(["cue lights_y2k", "cue lights_server_open"]);
    expect(v(sim, "Night.lights")).toBe("server_open");
    expect(v(sim, "Night.lights_back_at")).toBe(0);
    expect(v(sim, "Night.lit_scene")).toBe("none"); // the latch skipped the room restore: nothing to replay
  });

  it("Night.lit_scene names the look a cut room came back on under, \"none\" when it didn't, and Power On starts it at \"none\" (T8 recheck)", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "Night.lit_scene")).toBe("none");
    toSummons(sim);
    fireAll(sim, "truth_pong", "round_two_tally");
    // Restored under the hunt's living-room look over a RAM cut.
    const look = v(sim, "Night.lights");
    cut(sim, "The RAM");
    expect(cues(advance(sim, 95))).toContain(on("The RAM"));
    expect(v(sim, "Night.lit_scene")).toBe(look);
    // A Desktop cut under the Trust Chart's living-room look: re-lit, no room-on.
    advance(sim, 5);
    cut(sim, "The Desktop");
    advance(sim, 20);
    fire(sim, "trust_chart");
    expect(cues(advance(sim, 75)).includes(on("The Desktop"))).toBe(false);
    expect(v(sim, "Night.lit_scene")).toBe("none");
  });

  it("the mark ends with its look: a RAM cut restored under the glitch is not re-armed when the glitch comes back at the beans (review 2)", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    expect(v(sim, "Night.lights")).toBe("glitch");
    cut(sim, "The RAM");
    expect(cues(advance(sim, 95))).toContain(on("The RAM"));
    expect(v(sim, "Night.lit_scene")).toBe("glitch");
    // call_desktop is a whole-house look: it re-lit the RAM, the mark is history.
    fireAll(sim, "five_minute_warning", "summons_closed");
    expect(v(sim, "Night.lights")).not.toBe("glitch");
    expect(v(sim, "Night.lit_scene")).toBe("none");
    fireAll(sim, "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings");
    expect(cues(fire(sim, "printer_opened"))).toContain("cue lights_glitch");
    // The same look name again: stagehand's room-on rule stays false.
    expect([v(sim, "Night.lights"), v(sim, "Night.lights_back_at"), v(sim, "Night.lit_scene")]).toEqual(["glitch", 0, "none"]);
  });

  it("the mark outlives a room-scoped look: a RAM cut restored under pong keeps it through the Trust Chart and the beans' glitch, so a lost restore is still replayed (review 3)", { timeout: SLOW }, () => {
    const sim = boot();
    toSummons(sim);
    cut(sim, "The RAM");
    advance(sim, 20);
    fire(sim, "truth_pong");
    expect(cues(advance(sim, 75))).toContain(on("The RAM"));
    expect(v(sim, "Night.lit_scene")).toBe("pong");
    fireAll(sim, "round_two_tally", "trust_chart");
    expect(v(sim, "Night.lights")).toBe("trust_chart"); // the living room only: the RAM is still the restore's
    expect(v(sim, "Night.lit_scene")).toBe("pong");
    fire(sim, "show_the_rankings");
    expect(cues(fire(sim, "printer_opened"))).toContain("cue lights_glitch");
    expect(v(sim, "Night.lit_scene")).toBe("pong");
  });

  it("the Y2K hour: a RAM cut, then the majority's server-room look → the RAM comes back on", { timeout: SLOW }, () => {
    const sim = boot();
    toY2k(sim);
    cut(sim, "The RAM");
    advance(sim, 20);
    fire(sim, "force_majority_leave");
    expect(v(sim, "Night.lights")).toBe("server_open");
    expect(cues(advance(sim, 75))).toContain(on("The RAM"));
    expect(v(sim, "Night.lit_scene")).toBe("server_open");
  });
});

// ───────────────────────── a booth's 📝 with several filings waiting (D5) ─────────────────────────

describe("wave 9 — a booth's 📝 never judges a filing the host did not mean (T2-facts-02, T5-crew-cards-03, D5)", () => {
  let card = 1;
  const file = (sim: Sim, g: string, question: string, answer: string, confidence = 100) =>
    sim.signal("fact answered", g, { question, answer, confidence, card: card++, verdict: judgeAnswer(BOOK, question, answer, confidence)! });
  const refusal = (name: string, label: string) =>
    `📝 Not judged: ${name} has an earlier filing still waiting for a verdict. Judge it on Run → Mind → Judging, which names the question (their card's 📝 judges only their latest, ${label}). Nothing changed.`;

  it("review mode: two pending filings → a booth press with no question refuses, changes nothing; Run's named question still judges", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    sim.setVar("Night.judge_mode", "review");
    const f2 = file(sim, "g1", "H2", "Mister Whiskers");
    expect(hostsSaid(f2)[0]).toBe("📝 Calculator filed H2 (round 1 Q2): Mister Whiskers — certain. Proposed: lie. Confirm on Run → Mind → Judging (their card's 📝 judges their latest filing only).");
    file(sim, "g1", "H3", "9am");
    expect([v(sim, "g1.fact_v2"), v(sim, "g1.fact_v3")]).toEqual(["pending", "pending"]);
    for (const press of ["fact_accurate", "fact_lie", "fact_uncertain"]) {
      const p = fire(sim, press, "g1", null, "Clippy");
      expect(hostsSaid(p), press).toEqual([refusal("Calculator", "round 1 Q3")]);
      expect([v(sim, "g1.fact_v2"), v(sim, "g1.fact_v3")], press).toEqual(["pending", "pending"]);
      expect([v(sim, "Kernel.q2"), v(sim, "Kernel.q3"), v(sim, "Kernel.lies_accepted")], press).toEqual(["none", "none", 0]);
    }
    // Run's Judging card names the question.
    expect(hostsSaid(fire(sim, "fact_lie", "g1", { question: "H2" }))).toEqual(["📝 Calculator's H2 is judged a confident lie."]);
    expect(v(sim, "g1.fact_v2")).toBe("lie");
    expect(v(sim, "g1.fact_v3")).toBe("pending");
    // Only the latest left waiting: the card's press judges it (the old behaviour).
    expect(hostsSaid(fire(sim, "fact_accurate", "g1", null, "Clippy"))).toEqual(["📝 Calculator's H3 is judged accurate."]);
    expect(v(sim, "g1.fact_v3")).toBe("accurate");
  });

  it("review mode: one pending filing → the booth press judges it", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    sim.setVar("Night.judge_mode", "review");
    file(sim, "g1", "H2", "Mister Whiskers");
    expect(hostsSaid(fire(sim, "fact_lie", "g1", null, "Clippy"))).toEqual(["📝 Calculator's H2 is judged a confident lie."]);
    expect(v(sim, "Kernel.q2")).toBe("lie");
  });

  it("auto mode: nothing is pending, so a booth press still overrides the latest filing", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    file(sim, "g1", "H1", "Elevn years", 90);
    file(sim, "g1", "H2", "Mister Whiskers");
    expect(v(sim, "g1.fact_v1")).toBe("uncertain");
    expect(hostsSaid(fire(sim, "fact_accurate", "g1", null, "Clippy"))).toEqual(["📝 Calculator's H2 is judged accurate."]);
    expect(v(sim, "g1.fact_v2")).toBe("accurate");
    // Run names H1: the typo the key did not know is put right, H2 untouched.
    fire(sim, "fact_accurate", "g1", { question: "H1" });
    expect(v(sim, "g1.fact_v1")).toBe("accurate");
    expect(v(sim, "g1.fact_v2")).toBe("accurate");
  });
});

// ───────────────────────── a 😤 meant as ✅ ─────────────────────────

describe("wave 9 — ✅ takes back a 😤 pressed for the same answer (T2-facts-04)", () => {
  const corrected = (name: string, round: number, q: number) => `⚖️ Corrected: ${name}'s answer to round ${round} Q${q} is accurate, not a confident lie. Nothing is paid twice.`;

  it("Truth Pong: 😤 then ✅ for the same cup → the question reads accurate, no lie on record, +100 once", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    toHunt2(sim);
    fire(sim, "five_minute_warning");
    for (const [g] of PROGRAMS) fire(sim, "check_in_at_desktop", g, null, "Task Manager");
    fireAll(sim, "summons_closed", "truth_pong");
    fire(sim, "made_the_cup", "g1", null, "Clippy");
    const s0 = sim.scoreOf("g1");
    const t0 = v(sim, "g1.truths_accepted");
    fire(sim, "confident_q1", "g1", null, "Clippy");
    expect([v(sim, "Kernel.q4"), v(sim, "Kernel.q4_hunt"), v(sim, "Kernel.lies_accepted")]).toEqual(["lie", "lie", 1]);
    const fix = fire(sim, "accurate_q1", "g1", null, "Clippy");
    expect(hostsSaid(fix)).toEqual([corrected("Calculator", 2, 1)]);
    expect(casts(fix).filter((b) => b.scope !== "channel(hosts)")).toEqual([]);
    expect([v(sim, "Kernel.q4"), v(sim, "Kernel.q4_hunt"), v(sim, "Kernel.lies_accepted")]).toEqual(["accurate", "accurate", 0]);
    expect(liesByPerson(sim).get("g1") ?? 0).toBe(0);
    expect(sim.scoreOf("g1")).toBe(s0 + 100);
    expect(v(sim, "g1.truths_accepted")).toBe(t0 + 1);
    // Taken back once: ✅ again is the ordinary "already accepted", and 😤 after ✅ stays refused.
    expect(hostsSaid(fire(sim, "accurate_q1", "g1", null, "Clippy"))).toEqual(["⚖️ Calculator has not made a cup yet: no answer recorded."]);
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
  });

  it("round 1: another program's real lie on the same question survives the correction", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    fire(sim, "confident_q2", "g3", null, "Clippy");
    fire(sim, "confident_q2", "g2", null, "Clippy");
    expect(v(sim, "Kernel.lies_accepted")).toBe(2);
    expect(hostsSaid(fire(sim, "accurate_q2", "g2", null, "Clippy"))).toEqual([corrected("Microsoft Excel", 1, 2)]);
    expect(v(sim, "Kernel.q2")).toBe("lie");
    expect(v(sim, "Kernel.q2_hunt")).toBe("lie");
    expect(v(sim, "Kernel.lies_accepted")).toBe(1);
    const lies = liesByPerson(sim);
    expect(lies.get("g3")).toBe(1);
    expect(lies.get("g2") ?? 0).toBe(0);
    // ✅ for another question is an ordinary acceptance, not a correction.
    expect(hostsSaid(fire(sim, "accurate_q1", "g3", null, "Clippy"))).toEqual([]);
    expect(v(sim, "Kernel.q2")).toBe("lie");
  });

  it("round 1: 😤 Q1, then ✅ Q2, then ✅ Q1 still takes the Q1 lie back; nothing is paid twice", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const s0 = sim.scoreOf("g1");
    fire(sim, "confident_q1", "g1", null, "Clippy");
    fire(sim, "accurate_q2", "g1", null, "Clippy");
    const fix = fire(sim, "accurate_q1", "g1", null, "Clippy");
    expect(hostsSaid(fix)).toEqual([corrected("Calculator", 1, 1)]);
    expect(casts(fix).filter((b) => b.scope !== "channel(hosts)")).toEqual([]);
    expect([v(sim, "Kernel.q1"), v(sim, "Kernel.q1_hunt"), v(sim, "Kernel.lies_accepted")]).toEqual(["accurate", "accurate", 0]);
    expect(liesByPerson(sim).get("g1") ?? 0).toBe(0);
    expect(sim.scoreOf("g1")).toBe(s0 + 200);
    expect(v(sim, "g1.truths_accepted")).toBe(2);
  });

  it("round 1: a question already judged is never credited again, whatever was pressed in between", { timeout: SLOW }, () => {
    const sim = boot();
    toTruth1(sim);
    const s0 = sim.scoreOf("g1");
    const already = ["⚖️ Calculator's answer to that question is already accepted."];
    fire(sim, "accurate_q1", "g1", null, "Clippy");
    fire(sim, "accurate_q2", "g1", null, "Clippy");
    expect(hostsSaid(fire(sim, "accurate_q1", "g1", null, "Clippy"))).toEqual(already);
    // ✅ then 😤 for the same question, another press between: still refused, no lie on record.
    expect(hostsSaid(fire(sim, "confident_q1", "g1", null, "Clippy"))).toEqual(already);
    // A corrected question is settled too.
    fire(sim, "confident_q3", "g1", null, "Clippy");
    fire(sim, "accurate_q3", "g1", null, "Clippy");
    fire(sim, "accurate_q2", "g1", null, "Clippy");
    expect(hostsSaid(fire(sim, "accurate_q3", "g1", null, "Clippy"))).toEqual(already);
    expect(sim.scoreOf("g1")).toBe(s0 + 300);
    expect(v(sim, "g1.truths_accepted")).toBe(3);
    expect(v(sim, "Kernel.lies_accepted")).toBe(0);
    expect([v(sim, "Kernel.q1"), v(sim, "Kernel.q2"), v(sim, "Kernel.q3")]).toEqual(["accurate", "accurate", "accurate"]);
  });

  it("the verdict after a taken-back 😤 is the Song Ending", { timeout: SLOW }, () => {
    const sim = boot();
    toBobbing(sim, { retract: true });
    expect(["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"].map((q) => v(sim, `Kernel.${q}`))).toEqual(Array(8).fill("accurate"));
    expect(beats(truthTxt(sim))).toContain("Song Ending");
  });
});

// ───────────────────────── bets settle player to player (D1) ─────────────────────────

describe("wave 9 — no story text sends coin to a character (T1-wallet-01, T10-02, D1)", () => {
  /** A promise the wallet can't keep: a performer has no Wallet (wallet.ts sends between programs only). */
  const POT = /stake to McAfee|send (?:your |their )?stakes?\b|send (?:it )?to (?:you|McAfee)|send you their|held pot|take your cut/iu;

  it("the codex, the quests and McAfee's booth line settle a bet by the winner's 🙏 Request; Pay / Charge are still on McAfee's card", { timeout: SLOW }, () => {
    const sim = fresh();
    const m = sim.model;
    for (const [id, e] of m.codex) expect(e.text, id).not.toMatch(POT);
    for (const [id, q] of m.quests) expect(q.text, id).not.toMatch(POT);
    expect(m.codex.get("DraftKings Orders")!.text).toMatch(/the winner sends a 🙏 Request and the loser\s+pays/u);
    expect(m.quests.get("The Exchange")!.text).toMatch(/You have no Wallet: you hold no pot and take no cut/u);
    // McAfee's booth hears it at the Truther Download.
    const booth = boot();
    toTruth1(booth);
    readResults(booth);
    fireAll(booth, "second_hunt_preview", "start_the_second_hunt");
    const evs = advance(booth, 120);
    const mcafee = (evs.filter((e) => e.type === "respond") as Ev<"respond">[]).filter((r) => r.to === "McAfee Anti-Virus").map((r) => r.text);
    expect(mcafee.some((t) => t.startsWith("🪙 The # truthcoin-exchange is open."))).toBe(true);
    expect(mcafee.some((t) => t.includes("referee bets and call the winner in # truthcoin-exchange."))).toBe(true);
    for (const t of mcafee) expect(t).not.toMatch(POT);
    for (const id of ["pay_truthcoin", "charge_truthcoin"]) expect(m.interactions.get(id)!.by, id).toContain("McAfee Anti-Virus");
  });
});
