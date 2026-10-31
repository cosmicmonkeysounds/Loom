//! Trapped in the Internet — wave 10, the Director page's show tagging: the
//! eight `act:` lines split the 66 admin cues into the README's sections
//! (display only — no cue moved, every number kept), the focus act follows
//! NEXT / LAST along the night, and the header's `watch:` / `countdown:`
//! lines give the board (the Kernel's values masked, the countdowns live
//! only while their window runs, no line that throws, no L1205).

import { describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { boardFor, cueState, guestView, modView, notePress, pressRefused } from "../server/views.ts";
import { cueActs, cueRows, cueSheetView, focusActIndex, previousActIndex } from "../src/cue-sheet.ts";
import type { CueAct, CueRow } from "../src/cue-sheet.ts";
import { Workspace } from "../src/lsp/index.ts";

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
  if (p && p.length === 5) sim.choose(id, 0);
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

function boot(): Sim {
  const sim = Sim.fromSources(SRC);
  sim.fireBeat("Power On");
  for (const [id, name] of PROGRAMS) upload(sim, id, name);
  return sim;
}

/** A director's press, noted the way the event server notes it. */
function press(sim: Sim, name: string, subject?: string): boolean {
  const out = sim.signal(name, subject);
  notePress(sim, out);
  const refused = pressRefused(sim, out);
  expect(refused, name).toBe(false);
  return refused;
}
const pressAll = (sim: Sim, names: readonly string[]) => names.forEach((n) => press(sim, n));

const rowsOf = (sim: Sim): CueRow[] => cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));

/** The sheet as both screens group it: LAST / NEXT by number, the focus act's code. */
function sheet(sim: Sim) {
  const rows = rowsOf(sim);
  const acts = cueActs(rows);
  const focus = focusActIndex(acts);
  return {
    last: rows.find((r) => r.last)?.n ?? null,
    next: rows.find((r) => r.next)?.n ?? null,
    focus: focus < 0 ? null : acts[focus]!.code,
    starting: focus < 0 ? false : acts[focus]!.starting,
  };
}

const TO_TRUTH_1 = ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"];
const TO_HOUR = [...TO_TRUTH_1, "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];
const TO_OVERSHARE = [...TO_HOUR, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"];
const TO_Y2K = [...TO_OVERSHARE, "y2k_clock"];

const countdowns = (sim: Sim) => boardFor(sim).countdowns.map((c) => c.label);

describe("Trapped in the Internet — wave 10 (the Director page's acts and board)", () => {
  it("every admin cue has an act", () => {
    const rows = rowsOf(Sim.fromSources(SRC));
    expect(rows).toHaveLength(87); // wave 58 music: 🔒 🔓 appended last, after 🎭; wave 59: 🎭 appended last, rejoining Anytime; wave 58: 🏅 G9a in the spine; 🎤 in the spine and 📺 an aside, both in B before 🤖; G0 📜 and its fallback in G; 🕊, its autoend and 🏍 gone; wave 53: ⏭ appended last, rejoining Anytime; wave 50: 🌀 appended last, rejoining Anytime; wave 48: 🔑 G14 appended last, rejoining G; wave 45: 🚻 G13 appended last, rejoining G; wave 44: 🎬 G12 appended last, rejoining G; wave 32: ⚡ ad_burst appended to Anytime; wave 26: the games' three moments appended to Anytime; wave 11: 👑 and 🔧 appended to Anytime; wave 18b: −☎️ −🪅; wave 20: 🚪 closed / trust + 🕊 autoend appended to E; wave 21: the three staff awards in G, before G11; wave 22: 🔌 Trust the patch bay appended to E
    for (const r of rows) expect(r.act, r.id).not.toBe(null);
    // `act:` rides admin cues only — never a performer's or a guest's button.
    const others = (modView(Sim.fromSources(SRC), "open", "x").interactions ?? []).filter((i) => i.who !== "admin");
    for (const i of others) expect(i.act, i.id).toBeUndefined();
  });

  it("the act split is B12 C5 D8 E15 Anytime15 F11 G21 with 45 spine and 42 asides", () => {
    const acts = cueActs(rowsOf(Sim.fromSources(SRC)));
    const shape = (a: CueAct) => [a.code ?? a.title, a.rows.length, a.spine.length, a.asides.length];
    expect(acts.map(shape)).toEqual([
      ["B", 12, 10, 2], // wave 18b: 🍾 is a spine row after 📋 ×3; ☎️ / 🪅 are gone; wave 58: 🎤, and 📺 an aside
      ["C", 5, 2, 3],
      ["D", 8, 5, 3],
      ["E", 15, 1, 14], // wave 20: three door / heart asides appended (no cue number moved); wave 22: 🔌 Trust the patch bay; wave 58: 🕊 and its autoend are gone
      ["Anytime", 15, 0, 15], // wave 58 music: 🔒 🔓 Trabolta off the music; wave 59: 🎭 costume_flicker; wave 26: the games' three moments (escape, heart, pickup); wave 32: ⚡ ad_burst; wave 50: 🌀 dream_toggle; wave 53: ⏭ wave_staff_through
      ["F", 11, 11, 0], // wave 58: 🏍 is gone
      ["G", 21, 16, 5], // wave 58: 🏅 G9a before G10; wave 21: G10a–c before G11; wave 44: 🎬 G12, an aside; wave 45: 🚻 G13, an aside; wave 48: 🔑 G14, an aside; wave 58: G0 📜 and its fallback, an aside
    ]);
    expect(acts.reduce((s, a) => s + a.spine.length, 0)).toBe(45);
    expect(acts.reduce((s, a) => s + a.asides.length, 0)).toBe(42);
    // The two `act: Anytime` lines are one act (💡, the reinstallation cues,
    // and wave 11's 👑 / 🔧, appended last so no cue number moved).
    const anytime = acts.find((a) => a.state === "anytime")!;
    expect(anytime.rows.map((r) => r.id)).toEqual(["restore_the_lights", "the simulation completed", "the golden duck", "reinstallation begun", "restore_the_king", "crew_through_the_door", "simulation escape attempt", "simulation heart reached", "simulation pickup taken", "ad_burst", "dream_toggle", "wave_staff_through", "costume_flicker", "trabolta_music_lock", "trabolta_music_unlock"]);
    // Titles keep the README's wording.
    expect(acts.map((a) => a.title)).toEqual([
      "Act I: the Desktop, Bingo and the first truth",
      "Act II: the ad hijack, Hunt 2, the Truther Download, the summons",
      "Act II: Truth Pong, the Trust Chart, the beans",
      "Act III: the Y2K hour and the server room",
      "Anytime",
      "The final reveal and the endings",
      "The awards ceremony",
    ]);
    // ⏳ and 🚨 sit in C, 🕚 opens E, 🪩 / 🔌 are E's fallbacks.
    const actOf = (id: string) => acts.find((a) => a.rows.some((r) => r.id === id))!.code;
    expect(["five_minute_warning", "summons_closed"].map(actOf)).toEqual(["C", "C"]);
    expect(["y2k_clock", "lights_dance", "patch_combo_a"].map(actOf)).toEqual(["E", "E", "E"]);
  });

  it("cue numbers (wave 18b: −2 after #10, ☎️ / 🪅 are gone; wave 21: +3 from G11; wave 58: +2 from 🤖, +1 from G10)", () => {
    const n = new Map(rowsOf(Sim.fromSources(SRC)).map((r) => [r.id, r.n]));
    expect(n.get("call_to_the_desktop")).toBe(1);
    expect(n.get("second_hunt_preview")).toBe(13);
    expect(n.get("truth_pong")).toBe(18);
    expect(n.get("y2k_clock")).toBe(26);
    expect(n.get("restore_the_lights")).toBe(38);
    expect(n.get("final_reveal")).toBe(39);
    expect(n.get("own_award_lines")).toBe(50);
    expect(n.get("tell_the_truth")).toBe(51);
    expect(n.get("start_the_ceremony")).toBe(53);
    // Wave 58: 🏅 G9a sits before G10, so everything from G10 on moves down one.
    expect(n.get("award_most_correct")).toBe(62);
    // Wave 21: the staff awards G10a–c sit before G11, which moves down three.
    expect(["award_staff_trusted", "award_staff_points", "award_staff_mole"].map((id) => n.get(id))).toEqual([64, 65, 66]);
    expect(n.get("resurrection")).toBe(67);
    expect(n.get("reinstallation begun")).toBe(70);
    // Wave 20: appended after 👑 / 🔧, in act E.
    expect(["server_door_closed", "server_door_trust"].map((id) => n.get(id))).toEqual([73, 74]);
    // Wave 22: appended after 🚪 Trust, in act E.
    expect(n.get("trust_patch_bay")).toBe(75);
    // Wave 26: appended after 🔌, rejoining Anytime.
    expect(["simulation escape attempt", "simulation heart reached", "simulation pickup taken"].map((id) => n.get(id))).toEqual([76, 77, 78]);
    // Wave 32: ⚡ appended last, rejoining Anytime.
    expect(n.get("ad_burst")).toBe(79);
    // Wave 44: 🎬 appended last, rejoining G.
    expect(n.get("roll_the_credits")).toBe(80);
    // Wave 45: 🚻 appended last, rejoining G.
    expect(n.get("bathroom_report")).toBe(81);
  });

  it("focus act along the night", { timeout: SLOW }, () => {
    const sim = boot();
    // Doors, nothing fired.
    expect(sheet(sim)).toEqual({ last: null, next: 1, focus: "B", starting: true });
    // Hunt 1 running (⚖️ needs the timer).
    pressAll(sim, ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt"]);
    expect(sheet(sim)).toMatchObject({ last: 7, next: null, focus: "B", starting: false });
    advance(sim, 900); // the timer's C2 ⏰
    pressAll(sim, ["first_moment_of_truth", "close_the_filing", "read_the_results"]);
    // 📋 between questions: it stays NEXT.
    expect(sheet(sim)).toMatchObject({ last: 11, next: 11, focus: "B" });
    pressAll(sim, ["read_the_results", "read_the_results"]);
    // After 📋 ×3: NEXT is 🍾 Truth or Dare (wave 18b, R21), still B.
    expect(sheet(sim)).toMatchObject({ last: 11, next: 12, focus: "B" });
    pressAll(sim, ["second_hunt_preview", "start_the_second_hunt"]);
    // The hour: the timers run it, nothing to press.
    expect(sheet(sim)).toMatchObject({ last: 14, next: null, focus: "C" });
    advance(sim, 3300); // ⏳ at 55 min
    expect(sheet(sim)).toMatchObject({ last: 14, next: null, focus: "C" });
    advance(sim, 301); // 🚨 (auto)
    expect(v(sim, "Night.summons_closed")).toBe(true);
    expect(sheet(sim)).toEqual({ last: 14, next: 18, focus: "D", starting: true });
    pressAll(sim, ["truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares"]);
    // After 🤖 overshares: E is starting.
    expect(sheet(sim)).toEqual({ last: 25, next: 26, focus: "E", starting: true });
    press(sim, "y2k_clock");
    // The Y2K hour: no NEXT (🌑 waits for midnight).
    expect(sheet(sim)).toMatchObject({ last: 26, next: null, focus: "E" });
    advance(sim, 3600);
    // Midnight fires 🌑 itself.
    expect(cueState(sim).lastBy).toBe("story");
    expect(sheet(sim)).toMatchObject({ last: 39, next: 40, focus: "F" });
  });

  it("focus act along the night: Combo A inside the hour, then the ceremony", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, TO_Y2K);
    press(sim, "patch_combo_a");
    advance(sim, 11);
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(sheet(sim)).toMatchObject({ last: 26, next: 51, focus: "G" });
    press(sim, "tell_the_truth");
    advance(sim, 840);
    // After any ending: 📜, then G1.
    expect(sheet(sim)).toMatchObject({ last: 51, next: 53, focus: "G" });
  });

  it("an out-of-turn 🔌 / 💥 / ❌ is refused with a # hosts reason", { timeout: SLOW }, () => {
    const sim = boot();
    for (const [name, glyph] of [["patch_combo_a", "🔌"], ["patch_combo_b", "💥"], ["patch_rejected", "❌"]] as const) {
      const out = sim.signal(name);
      notePress(sim, out);
      expect(pressRefused(sim, out), name).toBe(true);
      const why = out.filter((e): e is Extract<SimEvent, { type: "broadcast" }> => e.type === "broadcast" && e.scope === "channel(hosts)");
      expect(why.map((e) => e.cue), name).toEqual([expect.stringMatching(new RegExp(`^"?${glyph}.*Y2K hour`, "u"))]);
    }
    expect(v(sim, "Night.wrong_combos") ?? 0).toBe(0);
    expect(v(sim, "Night.ended")).not.toBe(true);
  });

  it("E asides are the previous act's while F is focus", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, TO_Y2K);
    advance(sim, 3600); // midnight → 🌑
    const acts = cueActs(rowsOf(sim));
    const focus = focusActIndex(acts);
    expect(acts[focus]!.code).toBe("F");
    const prev = previousActIndex(acts, focus);
    // Anytime sits between E and F but is never the "from" act.
    expect(acts[prev]!.code).toBe("E");
    expect(acts[prev]!.state).toBe("past");
    expect(acts[prev]!.asides.map((r) => r.id)).toEqual([
      "y2k_midnight", "server_door_opened", "reset_server_room", "chess_won",
      "force_majority_stay", "force_majority_leave", "force_their_majority", "patch_combo_a", "patch_combo_b", "patch_rejected",
      "lights_dance", "server_door_closed", "server_door_trust", "trust_patch_bay",
    ]);
    expect(acts.map((a) => a.state)).toEqual(["past", "past", "past", "past", "anytime", "focus", "future"]);
  });

  it("Midnight countdown only during the final round", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, TO_OVERSHARE);
    expect(countdowns(sim)).not.toContain("Midnight");
    press(sim, "y2k_clock");
    const midnight = boardFor(sim).countdowns.find((c) => c.label === "Midnight")!;
    expect(midnight.path).toBe("Night.y2k_end");
    expect(midnight.endsAt).toBe(v(sim, "Night.y2k_end"));
    expect(midnight.endsAt).toBeGreaterThan(sim.elapsed() / 1000);
    advance(sim, 600);
    expect(countdowns(sim)).toContain("Midnight");
    // Combo A ends the night: the countdown goes with it.
    press(sim, "patch_combo_a");
    advance(sim, 11);
    expect(v(sim, "Night.ended")).toBe(true);
    expect(countdowns(sim)).not.toContain("Midnight");
  });

  it("Midnight countdown is gone once midnight has passed", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, TO_Y2K);
    advance(sim, 3600);
    expect(v(sim, "Night.phase")).toBe("final_reveal");
    expect(countdowns(sim)).not.toContain("Midnight");
  });

  it("Hunt 1 countdown gone after an early V6", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, ["call_to_the_desktop", "start_the_bingo"]);
    expect(countdowns(sim)).toEqual(["Bingo ends"]);
    pressAll(sim, ["bingo_time", "introduce_trabolta"]);
    expect(countdowns(sim)).not.toContain("Bingo ends");
    press(sim, "start_the_hunt");
    expect(countdowns(sim)).toEqual(["Hunt 1 ends"]);
    advance(sim, 120);
    expect(countdowns(sim)).toEqual(["Hunt 1 ends"]);
    // V6 before the timer: the hunt is over, so is its countdown.
    press(sim, "first_moment_of_truth");
    expect(v(sim, "Night.hunt_on")).toBe(false);
    expect(countdowns(sim)).not.toContain("Hunt 1 ends");
    expect(countdowns(sim)).toContain("Filings close");
  });

  it("guests see only the clocks they are told about (wave 11, `, for guests`)", { timeout: SLOW }, () => {
    const sim = boot();
    // Bingo, hunt 1, the last-chance filing, the summons and midnight; never
    // the surprises (the Truther Download, the five-minute warning, the dance).
    expect(sim.model.countdowns.filter((l) => l.guests === true).map((l) => l.items[0]!.label))
      .toEqual(["Bingo ends", "Hunt 1 ends", "Filings close", "Hunt 2 ends", "Summons closes", "Midnight"]);
    const theirs = () => (guestView(sim, "g1").countdowns ?? []).map((c) => c.label);
    expect(guestView(sim, "g1").countdowns).toBeUndefined(); // nothing running: no field
    press(sim, "call_to_the_desktop");
    press(sim, "start_the_bingo");
    expect(theirs()).toEqual(["Bingo ends"]);
    pressAll(sim, ["bingo_time", "introduce_trabolta", "start_the_hunt"]);
    expect(theirs()).toEqual(["Hunt 1 ends"]);
    pressAll(sim, ["hunt_time_up", "first_moment_of_truth"]);
    expect(theirs()).toEqual(["Filings close"]);
    pressAll(sim, ["close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"]);
    // Hunt 2's hour: the director counts down to the Truther Download and the
    // five-minute warning (surprises); the phones show only the hour the
    // house announced out loud (wave 18 fix GN-F13).
    expect(countdowns(sim)).toContain("Truther Download");
    expect(countdowns(sim)).toContain("Five-minute warning");
    expect(theirs()).toEqual(["Hunt 2 ends"]);
    press(sim, "five_minute_warning");
    expect(theirs()).toEqual(["Summons closes"]);
    pressAll(sim, ["summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"]);
    expect(theirs()).toEqual(["Midnight"]);
    expect(guestView(sim, "g1").countdowns![0]!.endsAt).toBe(v(sim, "Night.y2k_end"));
  });

  it("Kernel watch items are secret", { timeout: SLOW }, () => {
    const sim = boot();
    pressAll(sim, TO_Y2K);
    const watch = boardFor(sim).watch;
    const kernel = watch.filter((w) => w.path?.startsWith("Kernel."));
    expect(kernel.map((w) => w.label)).toEqual(["Majority", "Lies accepted", "Door code", "Combo A", "Combo B", "Staff uploaded"]);
    for (const w of kernel) expect(w.secret, w.label).toBe(true);
    for (const w of watch.filter((x) => !x.path?.startsWith("Kernel."))) expect(w.secret, w.label).toBeUndefined();
    // The roles count over guests; the featured programs are person rows.
    expect(watch.filter((w) => w.scope === "role").map((w) => w.label)).toEqual(["Cleared", "Marked", "At the door", "Bathroom Mode", "Late", "In the Internet", "Checked in", "At the heart", "Have the door code"]);
    expect(watch.filter((w) => w.scope === "person").map((w) => w.person)).toEqual(["Microsoft Excel", "OpenOffice", "MS Paint"]);
    // The phone's lean view never carries a secret (nor a role / person row).
    const lean = cueSheetView(modView(sim, "open", "x"));
    const leanLabels = (lean.watch ?? []).map((w) => w.label);
    expect(leanLabels.length).toBeLessThanOrEqual(3);
    for (const l of ["Majority", "Lies accepted", "Door code", "Combo A", "Combo B", "Cleared", "Marked", "At the heart"]) expect(leanLabels).not.toContain(l);
    expect(JSON.stringify(lean)).not.toContain(String(v(sim, "Kernel.door_code")));
  });

  it("the board has no throwing lines", { timeout: SLOW }, () => {
    const sim = boot();
    // Every header line was read (all of them sit above the first item).
    expect(sim.model.watch).toHaveLength(15); // wave 13: the booth card's ROLE flags; wave 20: the heart's talker; wave 53: Staff uploaded
    expect(sim.model.countdowns).toHaveLength(9);
    const check = (when: string) => {
      for (const l of [...sim.model.watch, ...sim.model.countdowns]) {
        if (l.while === null) continue;
        expect(() => sim.holds(l.while!, null, null), `${when}: ${l.raw}`).not.toThrow();
      }
      expect(boardFor(sim).watch.length, when).toBeGreaterThan(0);
    };
    check("doors");
    pressAll(sim, TO_HOUR);
    check("the hour");
    advance(sim, 3601);
    check("after the summons");
    pressAll(sim, ["truth_pong", "round_two_tally", "trust_chart", "show_the_rankings"]);
    check("the rankings");
    // Before Power On Night.scenario is unset: the line stays off too.
    expect(boardFor(Sim.fromSources(SRC)).watch.map((w) => w.label)).not.toContain("Overshare scenario");
    // No scenario yet (Night.scenario is 0 until 🤖): the line stays off.
    expect(boardFor(sim).watch.map((w) => w.label)).not.toContain("Overshare scenario");
    press(sim, "trabolta_overshares");
    check("the overshare");
    expect(boardFor(sim).watch.map((w) => w.label)).toContain("Overshare scenario");
    press(sim, "y2k_clock");
    check("the Y2K hour");
    // The scenario stays up through the hour; "At the heart" counts the
    // programs at the terminal now (a ROLE path), not the last holder.
    expect(boardFor(sim).watch.map((w) => w.label)).toContain("Overshare scenario");
    const heart = boardFor(sim).watch.find((w) => w.label === "At the heart");
    expect(heart?.scope).toBe("role");
    expect(heart?.path?.toLowerCase()).toBe("program.at_the_heart");
    press(sim, "patch_combo_a");
    advance(sim, 11);
    check("after the ending");
    expect(boardFor(sim).watch.map((w) => w.label)).toContain("Ending");
    expect(boardFor(sim).watch.map((w) => w.label)).not.toContain("At the heart");
  });

  it("no L1205 lints", () => {
    const w = new Workspace();
    const files = scenarioFiles("trapped-in-the-internet").map((f) => [`file:///${f.path}`, f.source] as [string, string]);
    w.updateMany(files);
    const l1205 = files.flatMap(([uri]) => (w.diagnosticsFor(uri)?.diagnostics ?? []).filter((d) => d.code === "L1205").map((d) => `${uri}:${d.range.start.line} ${d.message}`));
    expect(l1205).toEqual([]);
  });
});
