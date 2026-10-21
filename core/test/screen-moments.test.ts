//! Wave 17: the screen state's `moments` ring and `night` block — what the
//! terminals' cutscenes key on. Live moments only (a fold's first look is
//! history), house-wide only, never a secret; the public story vars, with
//! the award winner only while an award slide is up; and the answer stays
//! lean late at night with a full ring. Signals are allowlisted: admin cues
//! the story took, `do pick` draws and the devices' — never a guest's or a
//! booth's press, a check-in or a facts verdict (each about one person).

import { describe, expect, it } from "vitest";

import { MOMENT_RING, ScreenWatch, VERDICT_MS, momentOf, momentSignalsOf, pickNamesOf, secretMomentNames, type ScreenMoment } from "../server/routes/screen.ts";
import { scenarioSource } from "../examples/load.ts";
import { notePress } from "../server/views.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const WHO = { name: "Hall", spot: "hall", view: "auto", character: "" };

/** A watch on `sim` at a settable clock; `look()` = one poll's moments. */
function watch(sim: Sim, t0 = 10_000) {
  let t = t0;
  const w = new ScreenWatch({ now: () => t });
  return {
    w,
    at: (ms: number) => void (t = ms),
    poll: (view = "auto") => w.poll(sim, { ...WHO, view }, () => false),
    look: () => w.poll(sim, WHO, () => false).moments,
  };
}

const STORY = `# T

ROLE Program

LOCATION The Desktop

LOCATION The Server Room
  hidden: true

CHARACTER Vault
  secret: true

INTERACTION the big moment
  label: 🎬 The big moment
  who: admin

INTERACTION server_opens
  label: 🔓 Open the server room
  who: admin

INTERACTION vault opened
  label: Vault
  who: admin

INTERACTION spin
  label: 🍾 Spin
  who: admin

when spin:
  do pick bottle_landed from [g1] else bottle_empty

when server_opens:
  reveal The Server Room

when server_peeks for program:
  reveal The Server Room for program

when bottle_landed for program:
  set Night.bottle_pick = program.name
  -> Bottle Landed

when the big moment:
  -> The Big Moment

when vault opened:
  -> Vault.peek

== The Big Moment
  setting: The Desktop
sound printer_grind
Narrator: It happens.

== Bottle Landed
  setting: The Desktop
Narrator: The bottle stops.

== Boot
set Night.phase = "arrivals"
cue screens_screensaver
`;

describe("the moments ring", () => {
  it("history is never a moment; a house-wide beat, its sounds and a public signal are", () => {
    const sim = Sim.fromSources(STORY);
    sim.fireBeat("Boot");
    const s = watch(sim);
    expect(s.look()).toEqual([]); // the first look is the boot's history
    sim.signal("the big moment");
    s.at(11_000);
    const ms = s.look();
    expect(ms.map((m) => [m.kind, m.name, m.who, m.at])).toEqual([
      ["signal", "the big moment", null, 11_000],
      ["beat", "The Big Moment", null, 11_000],
      ["sfx", "printer_grind", null, 11_000],
    ]);
    // seq is the sim log's (1-based), monotonic.
    expect(ms.map((m) => m.seq)).toEqual([...ms.map((m) => m.seq)].sort((a, b) => a - b));
    expect(sim.log.all()[ms[0]!.seq - 1]).toMatchObject({ type: "signal", name: "the big moment" });
    expect(s.look()).toEqual(ms); // stable between polls
  });

  it("a per-guest beat is not a moment; the signal about one program names them", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Winamp", "Program");
    const s = watch(sim);
    s.look();
    sim.signal("spin"); // the runtime draws the pick as its own signal
    sim.signal("bottle_landed", "g1");
    s.at(12_000);
    expect(s.look().filter((m) => m.kind === "signal")).toEqual([
      { seq: expect.any(Number), at: 12_000, kind: "signal", name: "spin", who: null },
      { seq: expect.any(Number), at: 12_000, kind: "signal", name: "bottle_landed", who: "Winamp" },
    ]);
    expect(s.poll().night.bottle_pick).toBe("Winamp");
  });

  it("a reveal to everyone is a moment, a reveal for one program is not", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Winamp", "Program");
    const s = watch(sim);
    s.look();
    sim.signal("server_peeks", "g1");
    sim.signal("server_opens");
    const ms = s.look().filter((m) => m.kind === "reveal");
    expect(ms.map((m) => m.name)).toEqual(["The Server Room"]);
  });

  it("a phone's own card answer is never a moment; a secret character's name never is", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g1", "Winamp", "Program");
    const s = watch(sim);
    s.look();
    sim.signal("captcha answered", "g1");
    sim.signal("vault opened");
    sim.signal("Kernel.combo", "g1");
    expect(s.look()).toEqual([]);
    expect(secretMomentNames(sim.model)).toEqual(["kernel", "vault"]);
  });

  it("a find is one `found` moment with the finder; a kept one reads `golden duck kept`", () => {
    const sim = Sim.fromSources(`# T\n\nROLE Program\n\nLOCATION The Internet\n  prison: true\n\nwhen hold_them for program:\n  capture program into The Internet\n`);
    sim.createPerson("g1", "Winamp", "Program");
    sim.createPerson("g2", "Napster", "Program");
    const s = watch(sim);
    s.look();
    sim.signal("the simulation completed", "g1");
    sim.signal("the golden duck", "g1");
    sim.signal("hold_them", "g2");
    expect(sim.isCaptured("g2")).toBe(true);
    sim.signal("the simulation completed", "g2");
    sim.signal("the golden duck", "g2");
    s.w.catchUp(sim); // what the runtime does right after a find
    expect(s.look().filter((m) => m.kind === "found").map((m) => [m.name, m.who])).toEqual([
      ["golden duck", "Winamp"],
      ["golden duck kept", "Napster"],
    ]);
  });

  it(`keeps the last MOMENT_RING (${MOMENT_RING}), oldest first; a restart (a new sim) starts over`, () => {
    const sim = Sim.fromSources(STORY + Array.from({ length: MOMENT_RING + 5 }, (_, i) => `\nINTERACTION cue_${i}\n  label: ${i}\n  who: admin\n`).join(""));
    const s = watch(sim);
    s.look();
    for (let i = 0; i < MOMENT_RING + 5; i++) sim.signal(`cue_${i}`);
    const ms = s.look();
    expect(ms).toHaveLength(MOMENT_RING);
    expect(ms[0]!.name).toBe("cue_5");
    expect(ms[MOMENT_RING - 1]!.name).toBe(`cue_${MOMENT_RING + 4}`);
    const e1 = s.poll().announceEpoch;
    const next = Sim.fromSources(STORY);
    next.signal("cue_x");
    const r = s.w.poll(next, WHO, () => false);
    expect(r.moments).toEqual([]); // the new sim's first look is history
    expect(r.announceEpoch).not.toBe(e1);
  });

  it("momentOf ignores everything else", () => {
    const sim = Sim.fromSources(STORY);
    const no = (e: Parameters<typeof momentOf>[0]) => momentOf(e, 1, 1, sim, []);
    expect(no({ type: "directive", verb: "cue", args: "screens_y2k" })).toBeNull();
    expect(no({ type: "worldSet", path: "Night.phase", value: "y2k" })).toBeNull();
    expect(no({ type: "beatEntered", beat: "Login", setting: null, subject: "g1" })).toBeNull();
    expect(no({ type: "signal", name: "the simulation completed", subject: null })).toBeNull();
    expect(no({ type: "directive", verb: "sfx", args: "zip, rooms: The_Desktop", setting: null })).toMatchObject({ kind: "sfx", name: "zip" });
  });
});

const PRESSES = `# T

ROLE Program

LOCATION The Desktop

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

CHARACTER Norton

INTERACTION plant_the_virus
  label: 💾 Insert a disk
  who: guest

INTERACTION scan_ok
  label: ✅ Scan OK
  who: performer
  by: Norton

INTERACTION fact_lie
  label: 📝 Filed fact: confident lie
  who: performer

INTERACTION y2k_midnight
  label: 🎆 Midnight
  who: admin

INTERACTION lights
  label: 💡 Lights (stagehand only)
  who: admin

when plant_the_virus for program:
  set Night.virus = 1

when scan_ok for program:
  set Night.scans += 1

when checked_in for program:
  set Night.checkins += 1

when fact_lie for program:
  set Night.lies += 1

when y2k_midnight:
  if Night.phase == "y2k":
    -> Midnight
  else:
    broadcast "🎆 Not the Y2K hour yet." to channel(hosts)

== Midnight
  setting: The Desktop
Narrator: The year will not render.
`;

describe("signals are allowlisted", () => {
  const night = () => {
    const sim = Sim.fromSources(PRESSES);
    sim.createPerson("g1", "Excel", "Program");
    const s = watch(sim);
    s.look();
    /** A press the way the runtime journals it (noted, so refusal is judged per batch). */
    const press = (name: string, subject?: string, actor?: string) => notePress(sim, sim.signal(name, subject, {}, actor ?? null));
    return { sim, s, press };
  };

  it("a guest's press, a booth's press, a check-in and a facts verdict are never a moment, nor is who made them", () => {
    const { s, press } = night();
    press("plant_the_virus", "g1");
    press("scan_ok", "g1", "Norton");
    press("checked_in", "g1");
    press("fact_lie", "g1");
    press("fact_accurate", "g1");
    const ms = s.look();
    expect(ms).toEqual([]);
    expect(JSON.stringify(s.poll())).not.toContain("Excel");
  });

  it("an admin cue the story refused (only a # hosts line) is no moment; the same cue taken is, without a who", () => {
    const { sim, s, press } = night();
    press("y2k_midnight");
    expect(s.look()).toEqual([]);
    sim.setVar("Night.phase", '"y2k"');
    press("y2k_midnight", "g1");
    expect(s.look().map((m) => [m.kind, m.name, m.who])).toEqual([
      ["signal", "y2k_midnight", null],
      ["beat", "Midnight", null],
    ]);
    // A cue no rule hears (stagehand's own) always counts.
    press("lights");
    expect(s.look().map((m) => m.name)).toContain("lights");
  });

  it("the devices' signals carry the player; a runtime's quiet names (the facts book's confirm events) never show", () => {
    const sim = Sim.fromSources(PRESSES);
    sim.createPerson("g1", "Excel", "Program");
    let t = 10_000;
    const w = new ScreenWatch({ now: () => t, signals: () => ({ devices: ["king struck"], quiet: ["lights"] }) });
    w.poll(sim, WHO, () => false);
    sim.signal("king hit", "g1", { hp: 3, max: 15 });
    sim.signal("king struck", "g1");
    sim.signal("chess won", "g1");
    sim.signal("reinstallation begun", "g1");
    sim.signal("lights");
    t = 11_000;
    // A checkmate never shows (it would hint who holds the door code).
    expect(w.poll(sim, WHO, () => false).moments.map((m) => [m.name, m.who])).toEqual([
      ["king hit", "Excel"],
      ["king struck", "Excel"],
      ["reinstallation begun", "Excel"],
    ]);
  });

  it("a checkmate is never a moment, by the device or by the admin cue", () => {
    const sim = Sim.fromSources(PRESSES + "\nINTERACTION chess_won\n  label: ♟ Chess won\n  who: admin\n");
    sim.createPerson("g1", "Excel", "Program");
    const s = watch(sim);
    s.look();
    sim.signal("chess won", "g1");
    notePress(sim, sim.signal("chess_won", "g1"));
    sim.signal("chess lost", "g1");
    expect(s.look().map((m) => m.name)).toEqual(["chess lost"]);
    expect(JSON.stringify(s.poll())).not.toContain("chess won");
  });

  it("an admin cue whose rule writes a secret character's var never shows its name", () => {
    const story = `${STORY}
INTERACTION force_majority_leave
  label: 🗳 Force the majority: leave
  who: admin

when force_majority_leave:
  set Vault.majority = "leave"
  fire majority_reached

when majority_reached:
  -> Majority Reached

== Majority Reached
  setting: The Desktop
Narrator: Nobody announces it.
`;
    const sim = Sim.fromSources(story);
    const s = watch(sim);
    s.look();
    notePress(sim, sim.signal("force_majority_leave"));
    const ms = s.look();
    expect(ms.map((m) => [m.kind, m.name])).toEqual([["beat", "Majority Reached"]]);
  });

  it("the show: a forced majority puts no side on the screens; the bottle's verdicts are 🗣 / 🙅 / 🎩 only", () => {
    const sim = Sim.fromSources(scenarioSource("trapped-in-the-internet"));
    const sig = momentSignalsOf(sim.model);
    expect(sig.admin.has("force majority leave")).toBe(false);
    expect(sig.admin.has("force majority stay")).toBe(false);
    expect(sig.admin.has("introduce trabolta")).toBe(true);
    expect([...(sig.verdicts ?? [])].sort()).toEqual(["chose dare", "truth answered", "truth refused"]);
  });

  it("pickNamesOf reads a draw and its else", () => {
    expect(pickNamesOf("bottle_landed from [g1, g2] else bottle_empty")).toEqual(["bottle_landed", "bottle_empty"]);
    expect(pickNamesOf("chosen from []")).toEqual(["chosen"]);
    expect(pickNamesOf("nonsense")).toEqual([]);
  });
});

const NIGHT = `# T

when award:
  set Night.award_winner = "Winamp"
  set Night.award_value = 42
  cue screens_award_most_trusted

when bonus:
  set Night.award_winner = "Napster"
  set Night.award_value = "none"
  cue screens_award_best_liar

when after:
  cue screens_screensaver

when tally:
  set Night.collection_complete = true
  set Night.scenario = 3

when curtain_call:
  set Night.ended = true

== Boot
set Night.phase = "advice"
set Night.step = 18
set Night.bottle_pick = "none"
set Night.bottle_open = false
set Night.results_q = 2
set Night.award_winner = "none"
set Night.award_value = "none"
set Night.help_votes = 7
set Night.thwart_votes = 3
set Night.alerts = "sticky"
set Night.ended = false
set Night.collection_complete = false
set Night.scenario = 0
`;

const VERDICT = `# T

ROLE Program

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

INTERACTION spin
  label: 🍾 Spin
  who: admin

INTERACTION truth_answered
  label: 🗣 Truth answered
  who: performer

INTERACTION truth_refused
  label: 🙅 Truth refused
  who: performer

INTERACTION scan_ok
  label: ✅ Scan OK
  who: performer

INTERACTION accuse
  label: 👁 Accuse
  who: performer

INTERACTION fact_lie
  label: 📝 Filed fact: confident lie
  who: performer

when accuse for program:
  set program.accused = true

when fact_lie for program:
  set program.lies += 1

when spin:
  set Night.bottle_open = true
  do pick bottle_landed from [g1] else bottle_empty

when bottle_landed for program:
  set Night.bottle_pick = program.name

when truth_answered for program:
  if Night.bottle_open == true and program.name == Night.bottle_pick:
    set Night.bottle_open = false
    set program.score += 50
  else:
    broadcast "🗣 The bottle is not on {program.name}." to channel(hosts)

when truth_refused for program:
  if Night.bottle_open == true and program.name == Night.bottle_pick:
    set Night.bottle_open = false
  else:
    broadcast "🙅 The bottle is not on {program.name}." to channel(hosts)

when scan_ok for program:
  set Night.scans += 1
`;

describe("a draw's verdict", () => {
  const night = () => {
    const sim = Sim.fromSources(VERDICT);
    sim.createPerson("g1", "Excel", "Program");
    sim.createPerson("g2", "Winamp", "Program");
    const s = watch(sim);
    s.look();
    let seen = 0;
    /** The moments since the last call (the ring is the last 12, every poll). */
    const fresh = () => {
      const ms = s.look().filter((m) => m.seq > seen);
      seen = Math.max(seen, ...ms.map((m) => m.seq));
      return ms.map((m) => [m.name, m.who]);
    };
    const press = (name: string, subject?: string, actor?: string) => notePress(sim, sim.signal(name, subject, {}, actor ?? null));
    /** 🍾: the admin cue, then the runtime's draw as its own signal. */
    const spin = (pick = "g1") => {
      press("spin");
      sim.signal("bottle_landed", pick);
    };
    return { sim, s, press, spin, fresh };
  };

  it("the first booth press the story takes about the pick is a moment with the pick; one verdict a draw", () => {
    const { press, spin, fresh } = night();
    spin();
    expect(fresh()).toEqual([
      ["spin", null],
      ["bottle_landed", "Excel"],
    ]);
    press("truth_answered", "g1", "Clippy");
    expect(fresh()).toEqual([["truth_answered", "Excel"]]);
    // The draw's verdict is spent: no other booth press about them reaches the screens.
    press("scan_ok", "g1", "Norton");
    press("truth_refused", "g1", "Clippy");
    expect(fresh()).toEqual([]);
  });

  it("a verdict about someone else, or one the story refused, never shows", () => {
    const { press, spin, fresh } = night();
    spin();
    fresh();
    press("truth_answered", "g2", "Clippy"); // not the pick: the story refuses it too
    press("scan_ok", "g2", "Norton"); // not the pick
    expect(fresh()).toEqual([]);
    press("truth_refused", "g1", "Clippy");
    expect(fresh()).toEqual([["truth_refused", "Excel"]]);
    // The next draw: a press the story turns down (only a # hosts line) is no verdict.
    spin();
    fresh();
    press("truth_answered", "g1", "Clippy");
    expect(fresh()).toEqual([["truth_answered", "Excel"]]);
  });

  it("only a declared verdict (🗣 / 🙅 / 🎩) stands: another booth press the story takes about the pick neither shows nor spends the draw", () => {
    const { press, spin, fresh } = night();
    spin();
    fresh();
    press("accuse", "g1", "Norton");
    press("fact_lie", "g1", "Clippy");
    press("scan_ok", "g1", "Norton");
    expect(fresh()).toEqual([]);
    press("truth_answered", "g1", "Clippy");
    expect(fresh()).toEqual([["truth_answered", "Excel"]]);
  });

  it("a press long after the draw is no verdict", () => {
    const { s, press, spin, fresh } = night();
    spin();
    fresh();
    s.at(10_000 + VERDICT_MS + 1000);
    press("truth_answered", "g1", "Clippy");
    expect(fresh()).toEqual([]);
  });

  it("a refused press about the pick leaves the verdict due", () => {
    const { sim, press, spin, fresh } = night();
    spin();
    fresh();
    sim.setVar("Night.bottle_open", "false"); // closed by hand: 🗣 is refused (# hosts only)
    press("truth_answered", "g1", "Clippy");
    expect(fresh()).toEqual([]);
    sim.setVar("Night.bottle_open", "true");
    press("truth_refused", "g1", "Clippy");
    expect(fresh()).toEqual([["truth_refused", "Excel"]]);
  });
});

describe("the night block", () => {
  it("reads the public vars; 'none' is null; the award only while an award slide is up", () => {
    const sim = Sim.fromSources(NIGHT);
    sim.fireBeat("Boot");
    const s = watch(sim);
    expect(s.poll().night).toEqual({ screen: null, terminals: null, phase: "advice", step: 18, bottle_pick: null, bottle_open: false, results_q: 2, award_winner: null, award_value: null, help_votes: 7, thwart_votes: 3, alerts: "sticky", ended: false, collection_complete: false, scenario: null });
    sim.signal("award");
    expect(s.poll().night).toMatchObject({ award_winner: "Winamp", award_value: 42 });
    expect(s.poll("tv").night).toMatchObject({ award_winner: "Winamp", award_value: 42 });
    sim.signal("bonus");
    expect(s.poll().night).toMatchObject({ award_winner: "Napster", award_value: null });
    sim.signal("after");
    expect(s.poll().night).toMatchObject({ award_winner: null, award_value: null });
  });

  it("carries the tally's outcome, the overshare's scenario and the ending (all said aloud by the story)", () => {
    const sim = Sim.fromSources(NIGHT);
    sim.fireBeat("Boot");
    const s = watch(sim);
    sim.signal("tally");
    expect(s.poll().night).toMatchObject({ collection_complete: true, scenario: 3, ended: false });
    sim.signal("curtain_call");
    expect(s.poll("tv").night.ended).toBe(true);
  });

  it("a story without the vars reads null everywhere", () => {
    const sim = Sim.fromSources(`# T\n\n== Boot\nHi.\n`);
    const n = watch(sim).poll().night;
    expect(Object.values(n).every((v) => v === null)).toBe(true);
  });
});

describe("the late-night answer stays lean", () => {
  it(`a full ring (${MOMENT_RING}), three announcements, an award up and the house's 14 terminals polling: under 4 KB`, () => {
    // The show's own sizes: its longest announcement, beat names, program names.
    const src = `# T

ROLE Program

LOCATION The Desktop

INTERACTION present
  label: 🏆 Present
  who: admin

INTERACTION call
  label: 📣 Call
  who: admin

INTERACTION ending
  label: ⏻ Ending
  who: admin

when present:
  set Night.award_winner = "Microsoft Internet Explorer"
  set Night.award_value = 187
  cue screens_award_truthcoin_tycoon

when call:
  do announce "All programs, report to the Desktop. A game is about to begin."
  do announce "Five minutes. Everyone to the Desktop."
  do announce "Go to the living room."

when ending:
  set Night.final_round = true
  set Night.y2k_end = 3600
  -> Trabolta Disabled Forever And Ever

== Trabolta Disabled Forever And Ever
  setting: The Desktop
sound windows_shutdown
sound dance_song

== Boot
set Night.phase = "finale_hand_jive"
set Night.step = 19
set Night.bottle_pick = "Adobe Photoshop Elements"
set Night.help_votes = 31
set Night.thwart_votes = 12
set Night.alerts = "sticky"
`;
    const sim = Sim.fromSources(src);
    sim.fireBeat("Boot");
    sim.createPerson("g1", "Microsoft Internet Explorer", "Program");
    let t = 1_760_000_000_000;
    const w = new ScreenWatch({ now: () => t });
    const terminals = ["Optical Drive", "Hall", "TV", "Steam Room", "CPU", "Start Bar", "Backyard", "Bathroom 1 door", "RAM", "Server Room", "Server Door", "Upstairs hall", "Casino", "Tent"];
    for (const name of terminals) w.poll(sim, { name, spot: name.toLowerCase(), view: "auto", character: "Trabolta", device: { audio: true, visible: true, battery: 88, charging: true, version: "w17-1021.abcdef" } }, () => false);
    sim.signal("call");
    sim.signal("present");
    for (let i = 0; i < 4; i++) sim.signal("ending");
    for (let i = 0; i < 4; i++) sim.signal("the golden duck", "g1");
    t += 500;
    const s = w.poll(sim, { name: "Upstairs hall", spot: "upstairs-hall", view: "auto", character: "Trabolta" }, () => false);
    expect(s.moments).toHaveLength(MOMENT_RING);
    expect(s.announces).toHaveLength(3);
    expect(s.night.award_winner).toBe("Microsoft Internet Explorer");
    const bytes = JSON.stringify(s).length;
    expect(bytes).toBeLessThan(4096);
    const ring = s.moments satisfies ScreenMoment[];
    expect(ring.every((m) => m.at === t)).toBe(true);
  });
});
