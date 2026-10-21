//! Wave 17: the screen state's `moments` ring and `night` block — what the
//! terminals' cutscenes key on. Live moments only (a fold's first look is
//! history), house-wide only, never a secret; the public story vars, with
//! the award winner only while an award slide is up; and the answer stays
//! lean late at night with a full ring.

import { describe, expect, it } from "vitest";

import { MOMENT_RING, ScreenWatch, momentOf, secretMomentNames, type ScreenMoment } from "../server/routes/screen.ts";
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
    sim.signal("bottle_landed", "g1");
    s.at(12_000);
    expect(s.look()).toEqual([{ seq: expect.any(Number), at: 12_000, kind: "signal", name: "bottle_landed", who: "Winamp" }]);
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
    const sim = Sim.fromSources(STORY);
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

== Boot
set Night.phase = "advice"
set Night.step = 18
set Night.bottle_pick = "none"
set Night.award_winner = "none"
set Night.award_value = "none"
set Night.help_votes = 7
set Night.thwart_votes = 3
set Night.alerts = "sticky"
`;

describe("the night block", () => {
  it("reads the public vars; 'none' is null; the award only while an award slide is up", () => {
    const sim = Sim.fromSources(NIGHT);
    sim.fireBeat("Boot");
    const s = watch(sim);
    expect(s.poll().night).toEqual({ screen: null, terminals: null, phase: "advice", step: 18, bottle_pick: null, award_winner: null, award_value: null, help_votes: 7, thwart_votes: 3, alerts: "sticky" });
    sim.signal("award");
    expect(s.poll().night).toMatchObject({ award_winner: "Winamp", award_value: 42 });
    expect(s.poll("tv").night).toMatchObject({ award_winner: "Winamp", award_value: 42 });
    sim.signal("bonus");
    expect(s.poll().night).toMatchObject({ award_winner: "Napster", award_value: null });
    sim.signal("after");
    expect(s.poll().night).toMatchObject({ award_winner: null, award_value: null });
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
