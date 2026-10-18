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
const said = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const lines = (evs: SimEvent[], speaker: string) => said(evs).filter((e) => e.speaker === speaker).map((e) => e.text);
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

/** 📄 truth.txt, then ⚖ the verdict once the bobber has read it. */
const truthTxt = (sim: Sim): SimEvent[] => [...fire(sim, "read_truth_txt"), ...fire(sim, "the_verdict")];

/** Judge all eight questions accurately (or one lie), through the bob (the main show test's `toBobbing`). */
function toBobbing(sim: Sim, opts: { lie?: boolean } = {}) {
  toTruth1(sim);
  fire(sim, "accurate_q1", "g1", null, "Clippy");
  fire(sim, "accurate_q2", "g2", null, "Clippy");
  fire(sim, opts.lie ? "confident_q3" : "accurate_q3", "g3", null, "Clippy");
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

  for (const ending of ["patch_combo_a", "patch_combo_b", "talked_down"]) {
    it(`${ending}: the round-3 card becomes the closing card, once, and nothing after deals another`, { timeout: SLOW }, () => {
      const sim = boot();
      toY2k(sim);
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
      const after = fireAll(sim, "trabolta_recounts", "clippy_reads_summary", "start_the_ceremony", "resurrection", "resurrection");
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
    for (const code of ["MAPSANDDUCKS-COM", "CASINO-DEED", "BARRINGTON-ST", "SAVE-THE-PETS", "WHOIS-1999"]) sim.redeem("g9", code);
    for (const e of ["Miniature Doses", "The Lamborghini Certificate", "What Happened To Hamtaro", "The Decimal Point"]) expect(sim.holdsCodex("g8", e), e).toBe(true);
    toTruth1(sim);
    // Excel brings the virus back in hunt 1 and plants it.
    sim.redeem("g2", "LOVE-LETTER-FOR-YOU");
    fire(sim, "plant_the_virus", "g2");
    expect(v(sim, "Kernel.excel_planted")).toBe(true);
    for (const [g, q] of [["g2", "Excel Mission"], ["g8", "Master Of The Bugs"], ["g9", "Unscramble"]] as const) expect(sim.questStatus(g, q), q).toBe(null);
    const dl: SimEvent[] = [];
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
    for (const code of ["MAPSANDDUCKS-COM", "CASINO-DEED", "BARRINGTON-ST", "SAVE-THE-PETS"]) sim.redeem("g9", code);
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

  it("Grok Prom and the banishment: a checkmate tells # hosts only; Night.king_armed is 1 only from the Y2K hour to 📄", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "Night.king_armed")).toBe(0);
    toBobbing(sim, { lie: true });
    // toBobbing passes the Y2K clock: the King played for the code until 📄.
    expect(v(sim, "Night.king_armed")).toBe(1);
    truthTxt(sim);
    expect(v(sim, "Night.r3_closed")).toBe(true);
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(v(sim, "Night.king_armed")).toBe(0);
    const after = "♟ A King win after truth.txt: the verdict is in, no door code. Nothing happens in the story.";
    const w = fire(sim, "chess won", "g1", null, "Tent tablet");
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
