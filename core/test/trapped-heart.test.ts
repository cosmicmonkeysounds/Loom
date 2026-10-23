//! Trapped in the Internet — Trabolta's heart (wave 20, CONTRACT-w20 §3 + §7).
//!
//! The door (a sensor on the server-room terminal, the 🚪 buttons as its
//! fallback) plays The Heart on its first opening once he is awake; he
//! wants it shut; then a pass at the terminal opens a per-program talk in
//! four layers, like the Master in the cathedral. Played through the public
//! `Sim` API the way the event server drives it (signals posted by the
//! terminal, picks through `choose` with the menu's id), plus the server's
//! guest view for where each menu docks.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { FACTS_FILE, parseFactsText } from "../src/facts.ts";
import { mentionsKey } from "../src/answer-match.ts";
import { guestView } from "../server/views.ts";
import { menuChannelsFor } from "../server/chat.ts";
import { validateLights, planLook } from "@loom/house";
import type { HouseMap, LightsConfig } from "@loom/house";

// ───────────────────────── helpers ─────────────────────────

const SHOW = "trapped-in-the-internet";
const DIR = scenarioDir(SHOW);
const SRC = scenarioSource(SHOW);
const SLOW = 120_000;
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const said = (evs: SimEvent[]) => evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[];
const lines = (evs: SimEvent[], speaker = "Trabolta") => said(evs).filter((e) => e.speaker === speaker).map((e) => e.text);
const casts = (evs: SimEvent[]) => evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[];
const hosts = (evs: SimEvent[]) => casts(evs).filter((b) => b.scope === "channel(hosts)").map((b) => b.cue);
const cues = (evs: SimEvent[]) => (evs.filter((e) => e.type === "directive") as Ev<"directive">[]).filter((e) => e.verb === "cue").map((e) => e.args.trim());
const heartCues = (evs: SimEvent[]) => cues(evs).filter((c) => c.startsWith("heart_"));
const roomCues = (evs: SimEvent[]) => cues(evs).filter((c) => c.startsWith("room_"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);

function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}

/** Register → CAPTCHA → the problem → deposit → the door scan (as the show test). */
function upload(sim: Sim, id: string, name: string): void {
  sim.createPerson(id, name);
  sim.signal("captcha answered", id, { passed: true });
  sim.signal("captcha answered", id, { passed: false });
  const p = sim.pendingChoiceFor(id);
  if (p && p.length === 4) sim.choose(id, 0);
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
const fire = (sim: Sim, name: string, subject: string | null = null, args: Record<string, string | number | boolean> | null = null, actor?: string) => sim.signal(name, subject ?? undefined, args, actor);
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
const toTruth1 = (sim: Sim) => fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
function readResults(sim: Sim) {
  if (v(sim, "Night.filing_open") === true) fire(sim, "close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && v(sim, "Night.results_q") < 3; i++) fire(sim, "read_the_results");
}
function toY2K(sim: Sim) {
  readResults(sim);
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", 0);
  sim.choose("g3", 0);
  fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares", "y2k_clock");
  advance(sim, 2);
}
/** Trabolta awake, the heart sealed: the first Moment of Truth. */
function awake(): Sim {
  const sim = boot();
  toTruth1(sim);
  expect(v(sim, "Trabolta.awake")).toBe(true);
  return sim;
}

const open = (sim: Sim) => fire(sim, "door_sensor_opened", null, { level: 30 }, "Terminal · Server Room");
const shut = (sim: Sim) => fire(sim, "door_sensor_closed", null, { level: 2400 }, "Terminal · Server Room");
const scan = (sim: Sim, id: string) => fire(sim, "terminal opened", id, { at: "The Server Room" }, "Terminal · Server Room");
const unscan = (sim: Sim, id: string) => fire(sim, "terminal closed", id, { at: "The Server Room" }, "Terminal · Server Room");

/** The menu the terminal docks: the newest `Heart …` menu (D18). */
function heartMenu(sim: Sim, id: string) {
  const all = sim.pendingChoicesFor(id).filter((c) => c.beat.startsWith("Heart "));
  return all.length === 0 ? null : all[all.length - 1]!;
}
const heartMenus = (sim: Sim, id: string) => sim.pendingChoicesFor(id).filter((c) => c.beat.startsWith("Heart "));
/** Picks the docked heart option whose text contains `text`, by the menu's id. */
function pick(sim: Sim, id: string, text: string): SimEvent[] {
  const m = heartMenu(sim, id);
  expect(m, `no heart menu for ${id} (wanted "${text}")`).not.toBeNull();
  const i = m!.options.findIndex((o) => o.includes(text));
  expect(i, `"${text}" not offered: ${JSON.stringify(m!.options)}`).toBeGreaterThanOrEqual(0);
  return sim.choose(id, i, m!.id);
}
const offered = (sim: Sim, id: string) => heartMenu(sim, id)?.options ?? [];
const has = (opts: string[], needle: string) => opts.some((o) => o.includes(needle));

/** Awake, opened, shut, scanned in: Layer One is docked for `id`. */
function atLayerOne(sim = awake(), id = "g1"): Sim {
  open(sim);
  shut(sim);
  scan(sim, id);
  expect(heartMenu(sim, id)?.beat).toBe("Heart Layer One");
  return sim;
}
/** Through Layer Two to the argument (asks why, then argues). */
function toLayerThree(sim: Sim, id = "g1"): void {
  pick(sim, id, "I'm a person");
  pick(sim, id, "Why do you need the theory");
  pick(sim, id, "Then listen to me");
  expect(heartMenu(sim, id)?.beat).toBe("Heart Layer Three");
}

// ───────────────────────── the door ─────────────────────────

describe("The Heart — the door (wave 20)", () => {
  it("heart_pick starts \"none\", the heart sealed, the door shut, on the 🚪 sensor", { timeout: SLOW }, () => {
    const sim = boot();
    expect(v(sim, "g1.heart_pick")).toBe("none");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(v(sim, "Night.server_door")).toBe("closed");
    expect(v(sim, "Night.door_override")).toBe(false);
    expect(v(sim, "Night.heart_autoend")).toBe(true);
    expect(v(sim, "Night.her")).toBe("her");
  });

  it("before Trabolta is awake an opening only tells # hosts (the door still reads open)", { timeout: SLOW }, () => {
    const sim = boot();
    const e = open(sim);
    expect(beats(e)).toEqual([]);
    expect(lines(e)).toEqual([]);
    expect(hosts(e)).toEqual(['"🚪 The server-room door opened before Trabolta is awake. Nothing happens in the story."']);
    expect(v(sim, "Night.server_door")).toBe("open");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(heartCues(e)).toEqual([]);
  });

  it("the first opening once he is awake plays The Heart: stage door, the wake look and scene, a quiet notice", { timeout: SLOW }, () => {
    const sim = awake();
    const e = open(sim);
    expect(beats(e)).toEqual(["The Heart"]);
    expect(v(sim, "Night.heart_stage")).toBe("door");
    expect(v(sim, "Night.heart_opened")).toBe(true);
    expect(heartCues(e)).toEqual(["heart_wake"]);
    expect(roomCues(e)).toEqual(["room_heart_wake"]);
    expect(v(sim, "Night.heart_look")).toBe("heart_wake");
    expect(lines(e).join(" ")).toContain("Close the door.");
    const notice = casts(e).filter((b) => b.scope === "everyone").map((b) => b.cue);
    expect(notice).toHaveLength(1);
    expect(notice[0]!.startsWith('"🚪')).toBe(true); // no `!`: no chime, no banner
    expect(hosts(e)).toContain('"🚪 The server-room door opened. The Heart plays: he wants the door shut."');
    for (const [g] of PROGRAMS) expect(sim.isRevealedTo("The Server Room", g)).toBe(true);
  });

  it("left open it nags at 15 s, then every 20 s; # hosts hears at the third", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    const at = (n: number) => beats(advance(sim, n));
    expect(at(14)).toEqual([]);
    const first = advance(sim, 1);
    expect(beats(first)).toEqual(["Heart Nag"]);
    expect(lines(first)).toEqual(["The door. Please."]);
    expect(heartCues(first)).toEqual(["heart_nag"]);
    expect(at(19)).toEqual([]);
    expect(beats(advance(sim, 1))).toEqual(["Heart Nag"]);
    const third = advance(sim, 20);
    expect(beats(third)).toEqual(["Heart Nag"]);
    expect(hosts(third).some((h) => h.includes("open a minute"))).toBe(true);
    expect(v(sim, "Night.door_nags")).toBe(3);
    // The nag look is a short swell that gives the light back: never settled.
    expect(v(sim, "Night.heart_look")).toBe("heart_wake");
  });

  it("shut: Heart Sealed, stage scan, he asks for a pass at the camera", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    const e = shut(sim);
    expect(beats(e)).toEqual(["Heart Sealed"]);
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    expect(v(sim, "Night.server_door")).toBe("closed");
    expect(heartCues(e)).toEqual(["heart_sealed"]);
    expect(roomCues(e)).toEqual(["room_heart_sealed"]);
    expect(lines(e).join(" ")).toContain("Show it your pass.");
    expect(lines(e).join(" ")).toContain("The bay is cold tonight."); // before the Y2K hour
    expect(hosts(e)).toContain('"🚪 Door shut. Trabolta waits for a pass at the server-room terminal."');
    // No more nags once shut.
    expect(beats(advance(sim, 60))).toEqual([]);
  });

  it("a scan while the door is still open waits for it, then the talk opens when it shuts", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    const s = scan(sim, "g1");
    expect(beats(s)).toEqual(["Heart Shut It"]);
    expect(lines(s)).toEqual(["Close the door first, Calculator. Then we talk. Not before."]);
    expect(v(sim, "g1.heart_wait")).toBe(true);
    expect(heartMenu(sim, "g1")).toBeNull();
    const e = shut(sim);
    expect(beats(e)).toEqual(expect.arrayContaining(["Heart Sealed", "Heart Talk", "Heart Layer One"]));
    expect(roomCues(e)).toEqual(["room_heart_sealed_present", "room_heart_layer_1"]);
    expect(v(sim, "Night.heart_stage")).toBe("talk");
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("the door bouncing five times in 10 s: one Door Again, one Good., the stage and the door right after every edge", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    const all: SimEvent[] = [];
    for (let i = 0; i < 5; i++) {
      all.push(...open(sim));
      expect(v(sim, "Night.server_door")).toBe("open");
      expect(v(sim, "Night.heart_stage")).toBe("talk");
      all.push(...advance(sim, 1));
      all.push(...shut(sim));
      expect(v(sim, "Night.server_door")).toBe("closed");
      expect(v(sim, "Night.heart_stage")).toBe("talk");
      all.push(...advance(sim, 1));
    }
    expect(beats(all).filter((b) => b === "Heart Door Again")).toHaveLength(1);
    expect(beats(all).filter((b) => b === "Heart Door Shut")).toHaveLength(1);
    expect(lines(all).filter((l) => l === "Good.")).toHaveLength(1);
    // The light follows every edge: the door loop on each opening, the look back on each shut.
    expect(heartCues(all).filter((c) => c === "heart_door_open")).toHaveLength(5);
    expect(heartCues(all).filter((c) => c === "heart_listen")).toHaveLength(5);
    expect(hosts(all).filter((h) => h.includes("The talk waits"))).toHaveLength(1);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("a 🚪 press puts the door on the buttons: the sensor changes nothing until 🚪 Trust the door sensor", { timeout: SLOW }, () => {
    const sim = awake();
    const press = fire(sim, "server_door_opened");
    expect(v(sim, "Night.door_override")).toBe(true);
    expect(beats(press)).toEqual(["The Heart"]);
    expect(hosts(press)[0]).toContain("follows the 🚪 buttons");
    // The sensor reads shut: ignored.
    expect(beats(shut(sim))).toEqual([]);
    expect(v(sim, "Night.server_door")).toBe("open");
    // A button shuts it (no second override notice).
    const c = fire(sim, "server_door_closed");
    expect(beats(c)).toEqual(["Heart Sealed"]);
    expect(hosts(c).filter((h) => h.includes("follows the 🚪 buttons"))).toEqual([]);
    expect(beats(open(sim))).toEqual([]);
    expect(v(sim, "Night.server_door")).toBe("closed");
    // Trust: the sensor again.
    expect(hosts(fire(sim, "server_door_trust"))).toEqual(['"🚪 The story follows the door sensor again."']);
    expect(v(sim, "Night.door_override")).toBe(false);
    open(sim);
    expect(v(sim, "Night.server_door")).toBe("open");
    // The booth's radio buttons do the same.
    fire(sim, "radio_door_closed", "g1", null, "Norton Anti-Virus");
    expect(v(sim, "Night.door_override")).toBe(true);
    expect(v(sim, "Night.server_door")).toBe("closed");
  });

  it("the admin and booth door buttons are declared as §3.9 says", () => {
    const m = Sim.fromSources(SRC).model;
    for (const id of ["server_door_opened", "server_door_closed", "server_door_trust", "heart_autoend"]) {
      const i = m.interactions.get(id)!;
      expect(i.who, id).toBe("admin");
      expect(i.sequence, id).toBe(false);
    }
    expect(m.interactions.get("server_door_trust")!.while).toBe("Night.door_override == true");
    const r = m.interactions.get("radio_door_closed")!;
    expect(r.who).toBe("performer");
    expect(r.by).toEqual(["Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"]);
    expect(r.arm).toBe(true);
    expect(r.while).toBe('Night.ended != true and Night.server_door == "open"');
  });
});

// ───────────────────────── the lights ─────────────────────────

describe("The Heart — the light in his heart (wave 20)", () => {
  it("an alarm before The Heart ends on the idle look, never the red swell", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    fire(sim, "patch_rejected");
    const a = fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    expect(heartCues(a)).toEqual(["heart_alarm"]);
    expect(v(sim, "Night.heart_look")).toBe("none");
    const end = advance(sim, 121);
    expect(heartCues(end)).toEqual(["heart_idle"]);
  });

  it("no heart look plays while the alarm is up; the latch's end puts the room back", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    fire(sim, "patch_rejected");
    fire(sim, "patch_rejected");
    expect(v(sim, "Night.alarm_on")).toBe(true);
    const during = [...pick(sim, "g1", "I'm a person"), ...open(sim), ...shut(sim)];
    expect(heartCues(during)).toEqual([]);
    expect(v(sim, "Night.heart_look")).toBe("heart_listen"); // kept for the latch's end
    expect(heartCues(advance(sim, 121))).toEqual(["heart_listen"]);
  });

  it("an alarm with the door open on his heart ends on the door loop", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    fire(sim, "patch_rejected");
    fire(sim, "patch_rejected");
    open(sim);
    expect(heartCues(advance(sim, 121))).toEqual(["heart_door_open"]);
  });

  it("lights.json is valid on both show maps, every heart cue in the story is one of its looks, and its looks are §4's", () => {
    const lights = JSON.parse(read("lights.json")) as LightsConfig;
    for (const map of ["house.json", "house.shed.json"]) {
      const house = JSON.parse(read(map)) as HouseMap;
      expect(validateLights(lights, house), map).toEqual({ ok: true, problems: [], warnings: [] });
    }
    const looks = ["heart_wake", "heart_nag", "heart_door_open", "heart_sealed", "heart_listen", "heart_argue", "heart_proof", "heart_warn", "heart_eject", "heart_notyet", "heart_shutdown", "heart_idle", "heart_alarm"];
    expect(Object.keys(lights.looks).sort()).toEqual([...looks].sort());
    expect(lights.boot).toBe("heart_idle");
    const used = new Set([...SRC.matchAll(/^\s*cue (heart_[a-z_]+)\s*$/gmu)].map((m) => m[1]!));
    expect([...used].sort()).toEqual([...looks].sort());
    // The restore looks give the light back; the door and alarm swells loop.
    const plan = (n: string) => planLook(lights, null, n)!;
    expect([plan("heart_nag").restore, plan("heart_warn").restore]).toEqual([true, true]);
    expect([plan("heart_door_open").loop, plan("heart_alarm").loop]).toEqual([true, true]);
    // Never dark: every command keeps the bulb on at ≥ 40.
    for (const n of looks) for (const c of plan(n).commands) {
      expect(c.set.state, n).not.toBe("OFF");
      if (c.set.brightness !== undefined) expect(c.set.brightness, n).toBeGreaterThanOrEqual(40);
    }
  });

  it("the restore and loop looks never become Night.heart_look", { timeout: SLOW }, () => {
    expect(SRC).not.toMatch(/heart_look = "heart_(nag|warn|door_open|alarm)"/u);
  });
});

// ───────────────────────── the talk ─────────────────────────

describe("The Heart — the talk (wave 20)", () => {
  it("Layer One: who are you; the talker mirrored on Night for the glance", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    expect(v(sim, "Night.heart_stage")).toBe("talk");
    expect(v(sim, "Night.heart_talker")).toBe("Calculator");
    expect(v(sim, "Night.heart_talker_layer")).toBe(1);
    expect(v(sim, "Night.heart_talks")).toBe(1);
    expect(v(sim, "g1.heart_menu")).toBe(true);
    const opts = offered(sim, "g1");
    expect(opts).toEqual(["I'm a person. You put me in here.", "I'm a program. Whatever you made me.", "Someone who admires your work.", "⟦SPEAK FREELY⟧ Forget the questions. Talk to me. Just talk.", "I need to go."]);
    // The menu docks in their own Trabolta thread.
    const view = guestView(sim, "g1", null, undefined, menuChannelsFor(sim.log.all()));
    const heart = (view.choices ?? []).find((c) => c.beat === "Heart Layer One");
    expect(heart?.channel).toBe("dm:Trabolta");
  });

  it("a marked program sees ⟦MARKED⟧ and starts at suspicion 10", { timeout: SLOW }, () => {
    const sim = awake();
    sim.setVar("g1.marked", "true");
    atLayerOne(sim);
    expect(v(sim, "g1.heart_suspicion")).toBe(10);
    expect(has(offered(sim, "g1"), "⟦MARKED⟧")).toBe(true);
    pick(sim, "g1", "⟦MARKED⟧");
    expect(v(sim, "g1.heart_suspicion")).toBe(0);
    expect(v(sim, "g1.heart_case")).toBe(1);
    expect(has(offered(awakeAt("g2"), "g2"), "⟦MARKED⟧")).toBe(false);
  });

  it("Layer Two: questions shown once each, \"Tell me about her\" only once her name is out or a proof is held", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    const e = pick(sim, "g1", "I'm a person");
    expect(lines(e)[0]).toBe("A person. Yes. Most of you were, before tonight.");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
    expect(roomCues(e)).toEqual(["room_heart_layer_2"]);
    let opts = offered(sim, "g1");
    expect(has(opts, "What are you, really?")).toBe(true);
    expect(has(opts, "Then listen to me")).toBe(false);
    pick(sim, "g1", "What are you, really?");
    opts = offered(sim, "g1");
    expect(has(opts, "What are you, really?")).toBe(false);
    const why = pick(sim, "g1", "Why do you need the theory");
    expect(lines(why).join(" ")).toContain("It was for her.");
    opts = offered(sim, "g1");
    expect(has(opts, "Then listen to me")).toBe(true);
    expect(has(opts, "Tell me about her")).toBe(false);
    // A Sandy proof they found themselves opens it.
    sim.unlock("g1", "The Sandy File");
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    pick(sim, "g1", "⟦BACK⟧");
    expect(has(offered(sim, "g1"), "Tell me about her")).toBe(true);
  });

  it("\"Tell me about her\" opens once the house has said her name (Night.her)", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    sim.setVar("Night.recount", "true");
    advance(sim, 1);
    expect(v(sim, "Night.her")).toBe("Sandy");
    pick(sim, "g1", "I'm a person");
    const why = pick(sim, "g1", "Why do you need the theory");
    expect(lines(why).join(" ")).toContain("It was for Sandy.");
    expect(has(offered(sim, "g1"), "Tell me about her")).toBe(true);
  });

  it("Layer Three: every check shows its tagged option only when it passes, and a proof from him never shows", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim);
    const base = offered(sim, "g1");
    for (const tag of ["⟦PROOF⟧", "⟦TRUSTED⟧", "⟦HONEST⟧", "⟦OVERSHARE⟧", "⟦LIVEJOURNAL⟧"]) expect(has(base, tag), tag).toBe(false);
    expect(has(base, "Then let me finish")).toBe(false);
    for (const b of ["She loves you", "Your theory is wrong", "Then make her love you", "⟦SPEAK FREELY⟧", "I need to go"]) expect(has(base, b), b).toBe(true);
    // Every check passes: each option shows.
    sim.setVar("g1.trust", "25");
    sim.setVar("g1.truths_accepted", "3");
    sim.setVar("Night.scenario", "1");
    sim.setVar("g1.read_livejournal", "true");
    sim.unlock("g1", "What Sandy Says");
    sim.unlock("g1", "The Sandy File");
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    pick(sim, "g1", "⟦BACK⟧");
    const all = offered(sim, "g1");
    expect(all.filter((o) => o.startsWith("⟦PROOF⟧"))).toHaveLength(2);
    for (const tag of ["⟦TRUSTED⟧", "⟦HONEST⟧", "⟦OVERSHARE⟧", "⟦LIVEJOURNAL⟧"]) expect(has(all, tag), tag).toBe(true);
    // One below each threshold: hidden again.
    sim.setVar("g1.trust", "19");
    sim.setVar("g1.truths_accepted", "2");
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    pick(sim, "g1", "⟦BACK⟧");
    expect(has(offered(sim, "g1"), "⟦TRUSTED⟧")).toBe(false);
    expect(has(offered(sim, "g1"), "⟦HONEST⟧")).toBe(false);
    // A proof he handed over himself never counts.
    const other = atLayerOne(awake(), "g4");
    toLayerThree(other, "g4");
    other.share("Trabolta", "g4", "The Sandy File");
    expect(v(other, "g4.sandy_file_from_him")).toBe(true);
    pick(other, "g4", "⟦SPEAK FREELY⟧");
    pick(other, "g4", "⟦BACK⟧");
    expect(has(offered(other, "g4"), "⟦PROOF⟧")).toBe(false);
  });

  it("a proof plus one more point opens the ask; each shown option goes once", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    sim.unlock("g1", "The Sandy File");
    sim.setVar("g1.trust", "25");
    toLayerThree(sim);
    const p = pick(sim, "g1", "⟦PROOF⟧ Show him the Sandy File");
    expect(heartCues(p)).toEqual(["heart_proof"]);
    expect(roomCues(p)).toContain("room_heart_proof");
    expect(v(sim, "g1.heart_case")).toBe(3);
    expect(v(sim, "g1.heart_proof")).toBe(true);
    expect(has(offered(sim, "g1"), "⟦PROOF⟧")).toBe(false);
    expect(has(offered(sim, "g1"), "Then let me finish")).toBe(false);
    // The argue look does not cut the proof's long fall.
    expect(heartCues(p)).not.toContain("heart_argue");
    pick(sim, "g1", "⟦TRUSTED⟧");
    expect(v(sim, "g1.heart_case")).toBe(4);
    expect(has(offered(sim, "g1"), "⟦TRUSTED⟧")).toBe(false);
    const ask = pick(sim, "g1", "Then let me finish");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Four");
    expect(roomCues(ask)).toEqual(["room_heart_layer_4"]);
    expect(v(sim, "Night.heart_talker_layer")).toBe(4);
  });

  it("suspicion: the arithmetic, one warning at 50, thrown out at 80, barred on a re-scan, 🔄 forgives", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "Someone who admires your work"); // +15
    expect(v(sim, "g1.heart_suspicion")).toBe(15);
    pick(sim, "g1", "I could pull your cables"); // +20 → 35
    expect(v(sim, "g1.heart_suspicion")).toBe(35);
    const warn = pick(sim, "g1", "I could pull your cables"); // +20 → 55: the warning
    expect(v(sim, "g1.heart_suspicion")).toBe(55);
    expect(beats(warn)).toContain("Heart Warn");
    expect(heartCues(warn)).toEqual(["heart_warn"]);
    expect(roomCues(warn)).toEqual(["room_heart_warn"]);
    expect(hosts(warn)).toEqual(['"⚠ Calculator is losing Trabolta at his heart (suspicion 55)."']);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two"); // and the talk goes on
    const once = pick(sim, "g1", "What are you, really?"); // no change
    expect(beats(once)).not.toContain("Heart Warn");
    const out = pick(sim, "g1", "I could pull your cables"); // → 75
    expect(beats(out)).not.toContain("Heart Warn");
    const ej = pick(sim, "g1", "I could pull your cables"); // → 95
    expect(beats(ej)).toContain("Heart Eject");
    expect(v(sim, "g1.heart_suspicion")).toBe(95);
    expect(v(sim, "g1.heart_out")).toBe(true);
    expect(v(sim, "g1.heart_menu")).toBe(false);
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(v(sim, "g1.marked")).toBe(false); // D12: no mark
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    expect(heartCues(ej)).toEqual(["heart_eject"]);
    expect(roomCues(ej)).toEqual(["room_heart_eject"]);
    expect(v(sim, "Night.heart_look")).toBe("heart_idle"); // the stutter never becomes the settled look
    expect(heartCues([...open(sim), ...shut(sim)]).filter((c) => c === "heart_eject")).toEqual([]);
    expect(hosts(ej)[0]).toContain("⛔ Trabolta threw Calculator out of his heart");
    expect(heartMenu(sim, "g1")).toBeNull();
    // Barred: a re-scan is turned away.
    unscan(sim, "g1");
    const again = scan(sim, "g1");
    expect(beats(again)).toContain("Heart Barred");
    expect(lines(again)).toEqual(["No. Not you. Not again tonight. Go."]);
    expect(heartMenu(sim, "g1")).toBeNull();
    // 🔄 forgives: suspicion back to 0, the layer kept.
    unscan(sim, "g1");
    fire(sim, "reset_server_room");
    expect(v(sim, "g1.heart_out")).toBe(false);
    expect(v(sim, "g1.heart_suspicion")).toBe(0);
    expect(v(sim, "g1.heart_warned")).toBe(false);
    expect(v(sim, "g1.heart_layer")).toBe(2);
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    open(sim);
    shut(sim);
    scan(sim, "g1");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
  });

  it("suspicion never drops under 0, and the goods take it down", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    expect(v(sim, "g1.heart_suspicion")).toBe(0);
  });

  it("the door opening mid-talk: a pick waits, the shut plays it", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    open(sim);
    const held = pick(sim, "g1", "I'm a person");
    expect(lines(held)).toEqual(["Not with the door open. Close it, and I will hear that."]);
    expect(v(sim, "g1.heart_pick")).toBe("who_human");
    expect(v(sim, "g1.heart_wait")).toBe(true);
    expect(heartMenu(sim, "g1")).toBeNull();
    const e = shut(sim);
    expect(lines(e)).toContain("A person. Yes. Most of you were, before tonight.");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
    expect(heartMenus(sim, "g1")).toHaveLength(1);
    expect(v(sim, "g1.heart_pick")).toBe("none");
  });

  it("a pick held with the door open, a closed terminal, a re-scan with the door shut: one menu, the pick applied once", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    open(sim);
    pick(sim, "g1", "Someone who admires your work");
    unscan(sim, "g1");
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    shut(sim);
    expect(v(sim, "g1.heart_pick")).toBe("who_flatter"); // not at the terminal: still held
    const e = scan(sim, "g1");
    expect(lines(e).filter((l) => l.startsWith("Everyone admires my work"))).toHaveLength(1);
    expect(v(sim, "g1.heart_suspicion")).toBe(15);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
    advance(sim, 5);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("a pick from the phone, off the terminal: Not out there, and the menu comes back on the next scan", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    unscan(sim, "g1");
    const e = pick(sim, "g1", "I'm a person");
    expect(lines(e)).toEqual(["Not out there. Come to my heart and say it to my face."]);
    expect(v(sim, "g1.heart_pick")).toBe("none");
    expect(v(sim, "g1.heart_suspicion")).toBe(0);
    scan(sim, "g1");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer One");
  });

  it("a re-scan with the old menu still docked: Where were we., no second menu", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    unscan(sim, "g1");
    const e = scan(sim, "g1");
    expect(lines(e)).toEqual(["Where were we."]);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("Leave: stage scan, the leave scene, idle look, and they may keep talking (heart_chat)", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    const e = pick(sim, "g1", "I need to go");
    expect(beats(e)).toContain("Heart Leave");
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    expect(roomCues(e)).toEqual(["room_heart_leave"]);
    expect(heartCues(e)).toEqual(["heart_idle"]);
    expect(v(sim, "g1.heart_chat")).toBe(true);
    expect(v(sim, "g1.heart_menu")).toBe(false);
    expect(heartMenu(sim, "g1")).toBeNull();
    unscan(sim, "g1");
    expect(v(sim, "g1.heart_chat")).toBe(false);
  });

  it("a stale non-heart menu queued before the heart: the heart menu is the newest Heart entry, answering it leaves the stale one", { timeout: SLOW }, () => {
    const sim = awake();
    sim.capture("g1");
    sim.scan("The Tablet", "g1");
    const stale = sim.pendingChoicesFor("g1");
    expect(stale.map((c) => c.beat)).toEqual(["The Tablet Video"]);
    sim.release("g1");
    atLayerOne(sim);
    const menus = sim.pendingChoicesFor("g1");
    expect(menus.map((c) => c.beat)).toEqual(["The Tablet Video", "Heart Layer One"]);
    expect(heartMenu(sim, "g1")!.id).toBe(menus[1]!.id);
    pick(sim, "g1", "I'm a person");
    expect(sim.pendingChoicesFor("g1").map((c) => c.beat)).toEqual(["The Tablet Video", "Heart Layer Two"]);
  });

  it("a second program after the first: per-program progress, Another one., one heart at a time", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    unscan(sim, "g1");
    const e = scan(sim, "g4");
    expect(lines(e)[0]).toBe("Another one. Come in. Shut the world out.");
    expect(heartMenu(sim, "g4")?.beat).toBe("Heart Layer One");
    expect(v(sim, "Night.heart_talker")).toBe("MS Paint");
    expect(v(sim, "Night.heart_talks")).toBe(2);
    expect(v(sim, "g1.heart_layer")).toBe(2);
    expect(v(sim, "g4.heart_layer")).toBe(1);
    // A third scans in without the second closing: the second is pushed out.
    scan(sim, "g5");
    expect(v(sim, "g4.at_the_heart")).toBe(false);
    expect(v(sim, "g5.at_the_heart")).toBe(true);
  });
});

// ───────────────────────── the ask, the endings ─────────────────────────

/** To the ask with the Sandy File and trust. */
function toAsk(sim: Sim, id = "g1") {
  sim.unlock(id, "The Sandy File");
  sim.setVar(`${id}.trust`, "25");
  toLayerThree(sim, id);
  pick(sim, id, "⟦PROOF⟧");
  pick(sim, id, "⟦TRUSTED⟧");
  pick(sim, id, "Then let me finish");
  expect(heartMenu(sim, id)?.beat).toBe("Heart Layer Four");
}

describe("The Heart — the ask (wave 20)", () => {
  it("back from the ask to Three, heart_layer stays 4 (it only ever rises)", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    expect(v(sim, "g1.heart_layer")).toBe(4);
    pick(sim, "g1", "Come out with us");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    expect(v(sim, "g1.heart_layer")).toBe(4);
    expect(v(sim, "Night.heart_talker_layer")).toBe(4);
  });
});

describe("The Heart — convinced (wave 20)", () => {
  it("before the Y2K hour: not yet, remembered; the clock's call; the short return; both return options", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    const e = pick(sim, "g1", "She was never going to answer");
    expect(beats(e)).toEqual(expect.arrayContaining(["Heart Convinced", "Heart Not Yet"]));
    expect(v(sim, "g1.heart_convinced")).toBe(true);
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    expect(v(sim, "g1.heart_chat")).toBe(true); // D24: the heart to heart after not yet
    expect(heartCues(e)).toEqual(["heart_notyet"]);
    expect(roomCues(e)).toEqual(["room_heart_notyet"]);
    expect(hosts(e).some((h) => h.includes("before the Y2K hour"))).toBe(true);
    expect(v(sim, "Night.ended")).toBe(false);
    // A re-scan before the hour: one short line, no menu.
    unscan(sim, "g1");
    const early = scan(sim, "g1");
    expect(lines(early)).toEqual(["Not yet. Soon. When the clock starts counting, come back."]);
    expect(heartMenu(sim, "g1")).toBeNull();
    unscan(sim, "g1");
    // The Y2K hour: he calls them, once.
    const y = [] as SimEvent[];
    readResults(sim);
    fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
    advance(sim, 120);
    sim.choose("g2", 0);
    sim.choose("g3", 0);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares");
    y.push(...fire(sim, "y2k_clock"));
    y.push(...advance(sim, 2));
    expect(beats(y)).toContain("Heart Call");
    const call = said(y).filter((d) => d.speaker === "Trabolta" && d.text.startsWith("The clock is running."));
    expect(call).toHaveLength(1);
    expect(call[0]!.audience).toEqual(["g1"]);
    expect(v(sim, "g1.heart_called")).toBe(true);
    expect(hosts(y).some((h) => h.includes("Calculator convinced Trabolta before the Y2K hour"))).toBe(true);
    // The short return: both options.
    const back = scan(sim, "g1");
    expect(beats(back)).toContain("Heart Return");
    expect(offered(sim, "g1")).toEqual(["It's still true. She was never going to answer.", "I changed my mind."]);
    const no = pick(sim, "g1", "I changed my mind");
    expect(v(sim, "g1.heart_convinced")).toBe(false);
    expect(v(sim, "g1.heart_suspicion")).toBeGreaterThanOrEqual(30);
    expect(lines(no)[0]).toContain("Then you were lying before");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
  });

  it("still at his heart when the Y2K hour starts: no call to come back down, the short return there and then", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    expect(v(sim, "g1.heart_chat")).toBe(true);
    expect(v(sim, "g1.at_the_heart")).toBe(true);
    const y = [] as SimEvent[];
    readResults(sim);
    fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
    advance(sim, 120);
    sim.choose("g2", 0);
    sim.choose("g3", 0);
    fireAll(sim, "five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares");
    y.push(...fire(sim, "y2k_clock"));
    y.push(...advance(sim, 2));
    expect(beats(y)).not.toContain("Heart Call");
    expect(beats(y)).toContain("Heart Return");
    expect(lines(y).some((l) => l.startsWith("The clock is running. You told me"))).toBe(false);
    expect(hosts(y).some((h) => h.includes("is at his heart now"))).toBe(true);
    expect(v(sim, "g1.heart_called")).toBe(true);
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(v(sim, "Night.heart_stage")).toBe("talk");
    expect(heartMenus(sim, "g1")).toHaveLength(1);
    expect(offered(sim, "g1")).toEqual(["It's still true. She was never going to answer.", "I changed my mind."]);
    advance(sim, 5);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("convinced in the Y2K hour with autoend on: Heart Shutdown, then talked_down 25 s later, then trabolta_disabled", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    toAsk(sim);
    const e = pick(sim, "g1", "She was never going to answer");
    expect(beats(e)).toEqual(expect.arrayContaining(["Heart Convinced", "Heart Shutdown"]));
    expect(v(sim, "Night.heart_stage")).toBe("done");
    expect(v(sim, "Night.stand_down_by")).toBe("Calculator");
    expect(heartCues(e)).toEqual(["heart_shutdown"]);
    expect(roomCues(e)).toEqual(["room_heart_shutdown"]);
    expect(hosts(e)).toContain('"🕊 Trabolta stands down for Calculator. The night ends in 25 s (🕊 to end it now)."');
    expect(v(sim, "Night.ended")).toBe(false);
    const wait = advance(sim, 24);
    expect(v(sim, "Night.ended")).toBe(false);
    const end = [...wait, ...advance(sim, 1)];
    expect(v(sim, "Night.talked_down")).toBe(true);
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(beats(end)).toContain("Trabolta Disabled");
  });

  it("🔄 inside the autoend's 25 s keeps the stand-down: the heart stays done and the night still ends", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    advance(sim, 10);
    const r = fire(sim, "reset_server_room");
    expect(hosts(r)[0]).toContain("His stand-down stands");
    expect(v(sim, "Night.heart_stage")).toBe("done");
    expect(v(sim, "Night.stand_down_by")).toBe("Calculator");
    expect(v(sim, "Night.heart_end_at")).toBeGreaterThan(0);
    advance(sim, 15);
    expect(v(sim, "Night.talked_down")).toBe(true);
    expect(v(sim, "Night.ending")).toBe("disabled");
  });

  it("another program scanning in ends the first one's heart to heart (a lost terminal closed)", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer"); // not yet: heart_chat
    expect(v(sim, "g1.heart_chat")).toBe(true);
    scan(sim, "g2");
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(v(sim, "g1.heart_wait")).toBe(false);
  });

  it("autoend turned off inside the 25 s stops the countdown: the night waits for 🕊", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    advance(sim, 10);
    const t = fire(sim, "heart_autoend");
    expect(hosts(t)[0]).toContain("countdown is stopped");
    expect(v(sim, "Night.heart_end_at")).toBe(0);
    advance(sim, 30);
    expect(v(sim, "Night.ended")).toBe(false);
    expect(v(sim, "Night.heart_stage")).toBe("done");
  });

  it("convinced in the Y2K hour with autoend off: only the # hosts alert; 🔄 reopens the heart and clears stand_down_by", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    const t = fire(sim, "heart_autoend");
    expect(v(sim, "Night.heart_autoend")).toBe(false);
    expect(hosts(t)[0]).toContain("OFF");
    atLayerOne(sim);
    toAsk(sim);
    const e = pick(sim, "g1", "She was never going to answer");
    expect(hosts(e)).toContain('"!🕊 Trabolta offers to stand down for Calculator. Press 🕊 to end it."');
    advance(sim, 60);
    expect(v(sim, "Night.ended")).toBe(false);
    expect(v(sim, "Night.heart_end_at")).toBe(0);
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(v(sim, "Night.stand_down_by")).toBe("none");
    expect(v(sim, "Night.heart_opened")).toBe(false);
    expect(beats(open(sim))).toEqual(["The Heart"]);
  });

  it("a menu left docked across 🔄 picks nothing: Not now., and the next door plays The Heart", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person"); // Layer Two docked
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    const e = pick(sim, "g1", "What are you, really?");
    expect(lines(e)).toEqual(["Not now."]);
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(v(sim, "g1.heart_pick")).toBe("none");
    expect(heartMenu(sim, "g1")).toBeNull();
    expect(beats(open(sim))).toEqual(["The Heart"]);
    shut(sim);
    unscan(sim, "g1");
    scan(sim, "g1");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
  });

  it("🔄 with a program still at the terminal: The Heart, then the sealed line greets them and their talk resumes", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    fire(sim, "reset_server_room");
    expect(v(sim, "g1.at_the_heart")).toBe(true);
    expect(v(sim, "Night.heart_present")).toBe(true);
    pick(sim, "g1", "I'm a person"); // the old menu: Not now.
    expect(beats(open(sim))).toEqual(["The Heart"]);
    const sealed = [...shut(sim), ...advance(sim, 8)];
    expect(beats(sealed)).toContain("Heart Sealed");
    expect(lines(sealed)).toContain("You. You are already in front of me. Good.");
    expect(lines(sealed).some((l) => l.includes("Show it your pass"))).toBe(false);
    expect(roomCues(sealed)[0]).toBe("room_heart_sealed_present");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer One");
  });

  it("a pick held by a program who walked away never reopens a heart another program shut down", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim, "g4");
    open(sim);
    pick(sim, "g4", "I'm a person"); // held for the shut door
    expect(v(sim, "g4.heart_wait")).toBe(true);
    unscan(sim, "g4");
    shut(sim);
    scan(sim, "g1");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer One");
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    expect(v(sim, "Night.heart_stage")).toBe("done");
    unscan(sim, "g1");
    const e = scan(sim, "g4"); // inside the 25 s
    expect(beats(e)).not.toContain("Heart Pick");
    expect(beats(e)).not.toContain("Heart Talk");
    expect(v(sim, "Night.heart_stage")).toBe("done");
    expect(heartMenu(sim, "g4")).toBeNull();
    advance(sim, 25);
    expect(v(sim, "Night.talked_down")).toBe(true);
    expect(v(sim, "Night.heart_stage")).toBe("done");
  });

  it("🔄 drops a pick held for the shut door", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    open(sim);
    pick(sim, "g1", "I'm a person");
    expect(v(sim, "g1.heart_wait")).toBe(true);
    fire(sim, "reset_server_room");
    expect(v(sim, "g1.heart_wait")).toBe(true); // still at the terminal: the talk (not the pick) waits for the reopened heart
    expect(v(sim, "g1.heart_pick")).toBe("none");
    const e = shut(sim);
    expect(beats(e)).not.toContain("Heart Pick");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(v(sim, "g1.heart_layer")).toBe(1);
  });

  it("the autoend watcher after Combo A does nothing; the heart is done and the bulb fades", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    expect(v(sim, "Night.heart_end_at")).toBeGreaterThan(0);
    const a = fire(sim, "patch_combo_a");
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(v(sim, "Night.heart_end_at")).toBe(0);
    expect(v(sim, "Night.talked_down")).toBe(false);
    expect(beats(advance(sim, 30))).not.toContain("Trabolta Disabled");
    expect(heartCues(a)).toEqual([]); // the shutdown look already played
    // Combo A with no talk: the shutdown look.
    const other = awake();
    toY2K(other);
    const b = fire(other, "patch_combo_a");
    expect(heartCues(b)).toEqual(["heart_shutdown"]);
    expect(v(other, "Night.heart_stage")).toBe("done");
  });

  it("after truth.txt or an ending nothing in the tree moves", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    sim.setVar("Night.r3_closed", "true");
    const e = pick(sim, "g1", "I'm a person");
    expect(lines(e)).toEqual(["It is over. Go upstairs."]);
    expect(v(sim, "g1.heart_layer")).toBe(1);
    expect(v(sim, "g1.heart_suspicion")).toBe(0);
    expect(heartMenu(sim, "g1")).toBeNull();
    // The door only tells # hosts, and no stage moves.
    const d = open(sim);
    expect(beats(d)).toEqual([]);
    expect(hosts(d)[0]).toContain("after truth.txt");
    expect(v(sim, "Night.heart_stage")).toBe("talk");
    // A scan after truth.txt opens nothing new.
    unscan(sim, "g1");
    expect(beats(scan(sim, "g1"))).toEqual([]);
  });
});

// ───────────────────────── the heart to heart (§7) ─────────────────────────

describe("The Heart — the heart to heart (wave 20, §7)", () => {
  it("⟦SPEAK FREELY⟧ is on every layer's menu", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    const seen: string[] = [];
    const check = () => {
      const m = heartMenu(sim, "g1")!;
      seen.push(m.beat);
      expect(m.options.filter((o) => o.startsWith("⟦SPEAK FREELY⟧")), m.beat).toHaveLength(1);
    };
    sim.unlock("g1", "The Sandy File");
    sim.setVar("g1.trust", "25");
    check();
    pick(sim, "g1", "I'm a person");
    check();
    pick(sim, "g1", "Why do you need the theory");
    pick(sim, "g1", "Then listen to me");
    check();
    pick(sim, "g1", "⟦PROOF⟧");
    pick(sim, "g1", "⟦TRUSTED⟧");
    pick(sim, "g1", "Then let me finish");
    check();
    expect(seen).toEqual(["Heart Layer One", "Heart Layer Two", "Heart Layer Three", "Heart Layer Four"]);
  });

  it("⟦BACK⟧ returns to the same layer with suspicion unchanged; heart_chat set and cleared", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "Someone who admires your work"); // 15, layer 2
    const s = pick(sim, "g1", "⟦SPEAK FREELY⟧");
    expect(v(sim, "g1.heart_chat")).toBe(true);
    expect(beats(s)).toContain("Heart Speak");
    expect(offered(sim, "g1")).toEqual(["⟦BACK⟧ Let's go back to it."]);
    expect(v(sim, "g1.heart_menu")).toBe(true);
    expect(v(sim, "g1.heart_suspicion")).toBe(15);
    expect(v(sim, "g1.heart_layer")).toBe(2);
    pick(sim, "g1", "⟦BACK⟧");
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
    expect(v(sim, "g1.heart_suspicion")).toBe(15);
    expect(v(sim, "g1.heart_layer")).toBe(2);
    // A tree option clears it too; a closed terminal and an ending clear it.
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    unscan(sim, "g1");
    expect(v(sim, "g1.heart_chat")).toBe(false);
  });

  it("a re-scan after ⟦SPEAK FREELY⟧: back in the heart to heart, ⟦BACK⟧ still the one menu", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    unscan(sim, "g1");
    expect(v(sim, "g1.heart_chat")).toBe(false);
    const e = scan(sim, "g1");
    expect(lines(e)).toEqual(["Where were we."]);
    expect(v(sim, "g1.heart_chat")).toBe(true);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
    expect(offered(sim, "g1")).toEqual(["⟦BACK⟧ Let's go back to it."]);
    // ⟦BACK⟧ then a tree menu: heart_go moves on, so a re-scan is the plain resume.
    pick(sim, "g1", "⟦BACK⟧");
    unscan(sim, "g1");
    scan(sim, "g1");
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer One");
  });

  it("an eject never opens the heart to heart", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    sim.setVar("g1.heart_suspicion", "70");
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    expect(v(sim, "g1.heart_chat")).toBe(true);
    pick(sim, "g1", "⟦BACK⟧");
    pick(sim, "g1", "Someone who admires your work"); // 85
    expect(v(sim, "g1.heart_out")).toBe(true);
    expect(v(sim, "g1.heart_chat")).toBe(false);
  });

  it("🔄 clears heart_chat for a program still at the terminal", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    expect(v(sim, "g1.heart_chat")).toBe(true);
    expect(v(sim, "g1.at_the_heart")).toBe(true);
    fire(sim, "reset_server_room");
    expect(v(sim, "g1.heart_chat")).toBe(false);
  });

  it("an ending clears heart_chat", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    atLayerOne(sim);
    pick(sim, "g1", "⟦SPEAK FREELY⟧");
    expect(v(sim, "g1.heart_chat")).toBe(true);
    fire(sim, "patch_combo_b");
    expect(v(sim, "g1.heart_chat")).toBe(false);
  });
});

// ───────────────────────── secrets, the fiction, the persona ─────────────────────────

/** Every line a program or the room can see from the heart: Trabolta's and
 *  the narrator's lines, the options, the notices (beats/server-room.loom,
 *  The Heart … Heart Shutdown). */
function heartText(): string[] {
  const src = read("beats/server-room.loom");
  const from = src.indexOf("== The Heart\n");
  const to = src.indexOf("// ── E2b");
  expect(from).toBeGreaterThan(0);
  const out: string[] = [];
  for (const raw of src.slice(from, to).split("\n")) {
    const l = raw.trim();
    if (l.startsWith("//")) continue;
    const m = /^(?:Trabolta(?: \([a-z ]+\))?|Narrator):\s*(.+)$/u.exec(l);
    if (m) out.push(m[1]!);
    else if (l.startsWith("+ ")) out.push(l.replace(/^\+ (?:\(if .*?\)\s)?/u, ""));
    else if (l.startsWith("broadcast ")) out.push(/"(.*)"/u.exec(l)?.[1] ?? "");
  }
  return out;
}
/** A YAML block list under `key:` (two-space `- item` lines). */
function blockList(text: string, key: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => new RegExp(`^\\s*${key}:\\s*(#.*)?$`, "u").test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s*-\s+(.*?)\s*(#.*)?$/u.exec(l);
    if (!m) break;
    out.push(m[1]!.replace(/^["']|["']$/gu, ""));
  }
  return out;
}
const PERSONA = read("trabolta.persona.md");
const MIND = read("trabolta.mind.md");
const OUTSIDE = blockList(PERSONA, "outside");
const wordHit = (text: string, word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(text);

describe("The Heart — secrets and the fiction (wave 20, D29)", () => {
  const facts = parseFactsText(read(FACTS_FILE)).facts!;
  const keys = [
    ...facts.questions.flatMap((q) => [q.answer, ...(q.accept ?? [])]),
    ...(facts.answers ?? []).flatMap((a) => [a.answer, ...(a.accept ?? [])]),
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
  const never = blockList(MIND, "never");
  const match = blockList(MIND, "match");

  it("the scan covers the heart's lines", () => {
    const t = heartText();
    expect(t.length).toBeGreaterThan(60);
    expect(t).toContain("Close the door.");
    expect(never.length).toBeGreaterThan(10);
    expect(match.length).toBeGreaterThan(10);
    expect(keys.length).toBeGreaterThanOrEqual(9);
  });

  it("no heart line names a hunt answer, a key, a never word or a hunt-answer word", () => {
    for (const line of heartText()) {
      for (const k of keys) expect(mentionsKey(line, k), `${line} ~ ${k}`).toBe(false);
      for (const w of never) expect(line.toLowerCase().includes(w.toLowerCase()), `${line} ~ ${w}`).toBe(false);
      for (const w of match) expect(mentionsKey(line, w), `${line} ~ ${w}`).toBe(false);
      // F1 is never hinted: no quoting her, no "only ever said", no ferry.
      expect(line, line).not.toMatch(/only (ever )?said|ever said|ferry|crossing|live agent/iu);
    }
  });

  it("no heart line, option or notice names anything outside his world (the persona's outside: list)", () => {
    expect(OUTSIDE).toEqual(expect.arrayContaining(["Steph", "Jesse", "Arduino", "Zigbee", "Loom"]));
    for (const line of heartText()) for (const w of OUTSIDE) expect(wordHit(line, w), `${line} ~ ${w}`).toBe(false);
  });

  it("outside: never names something of his own world (John McAfee, the fundraiser party, any codex text)", () => {
    expect(OUTSIDE).not.toContain("John");
    expect(OUTSIDE).not.toContain("party");
    expect(OUTSIDE).not.toContain("parties");
    const own = ["John McAfee", "a special fundraiser party to restore the sign"];
    for (const f of readdirSync(join(DIR, "codex"))) {
      for (const raw of read(join("codex", f)).split("\n")) {
        const l = raw.trim();
        if (l !== "" && !l.startsWith("//")) own.push(l);
      }
    }
    for (const raw of read("beats/review.loom").split("\n")) if (raw.trim().startsWith("Trabolta:")) own.push(raw.trim());
    for (const line of own) for (const w of OUTSIDE) expect(wordHit(line, w), `${line} ~ ${w}`).toBe(false);
    expect(PERSONA).toMatch(/fundraiser\nparty to restore the sign/u);
  });

  it("the persona's own spoken lines and the new situations stay inside his world", () => {
    const front = PERSONA.split("\n---\n")[0]!;
    const body = PERSONA.slice(PERSONA.indexOf("\n---\n") + 5);
    const situations = front.slice(front.indexOf("\nsituations:\n"));
    for (const w of OUTSIDE) {
      expect(wordHit(body, w), `body ~ ${w}`).toBe(false);
      expect(wordHit(situations, w), `situations ~ ${w}`).toBe(false);
    }
  });

  it("stand_down is gone from the model, the persona and the mind's powers", () => {
    const m = Sim.fromSources(SRC).model;
    expect(m.interactions.has("stand_down")).toBe(false);
    expect(SRC).not.toMatch(/when stand_down/u);
    expect(PERSONA).not.toMatch(/name: standing down|STANDING DOWN|fire stand_down/u);
    expect(MIND).not.toMatch(/powers: \[[^\]]*stand_down/u);
  });

  it("the persona: them: and facts: carry the heart; the heart-to-heart situation is last, 4 sentences, no acts", () => {
    const front = PERSONA.split("\n---\n")[0]!;
    const them = /^them: (.*)$/mu.exec(front)![1]!.split(",").map((s) => s.trim());
    expect(them).toEqual(expect.arrayContaining(["at_the_heart", "heart_layer", "heart_menu", "heart_convinced", "heart_chat", "heart_out"]));
    const facts2 = /^facts: (.*)$/mu.exec(front)![1]!.split(",").map((s) => s.trim());
    expect(facts2).toEqual(expect.arrayContaining(["Night.heart_stage", "Night.server_door"]));
    const names = [...front.slice(front.indexOf("\nsituations:\n")).matchAll(/^ {2}- name: (.+)$/gmu)].map((m) => m[1]!);
    expect(names).toEqual(["at your heart", "marked at your heart", "a choice is open", "her name has been said", "her name is still blacked out", "heart to heart"]);
    const h2h = front.slice(front.indexOf("  - name: heart to heart"));
    expect(h2h).toMatch(/when: them\.at_the_heart == true && them\.heart_chat == true/u);
    expect(h2h).toMatch(/max_sentences: 4/u);
    expect(h2h).toMatch(/acts: none/u);
    expect(h2h).toMatch(/Halifax/u);
    const choice = front.slice(front.indexOf("  - name: a choice is open"), front.indexOf("  - name: her name has been said"));
    expect(choice).toMatch(/them\.heart_menu == true && them\.heart_chat != true/u);
    expect(choice).toMatch(/Promise nothing\. Decide nothing; no cables, codes or her line\./u);
  });
});

// ───────────────────────── the glance ─────────────────────────

describe("The Heart — the header (wave 20, §3.10)", () => {
  it("the watch lines carry the heart's stage, the door, the override and the talker", () => {
    const head = SRC.slice(0, SRC.indexOf("\n\n"));
    expect(head).toContain("Night.heart_stage as The Heart, Night.server_door as Server door, Night.door_override as Door on buttons, program.at_the_heart as At the heart");
    expect(head).toContain('watch: Night.heart_talker as At his heart, Night.heart_talker_layer as Heart layer, Night.heart_talker_suspicion as Heart suspicion, while Night.heart_stage == "talk"');
    expect(head).not.toContain("Night.heart_opened as The Heart");
  });
});

/** A fresh awake night with `id` at Layer One. */
function awakeAt(id: string): Sim {
  return atLayerOne(awake(), id);
}
