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
import { cueState, guestView, modView } from "../server/views.ts";
import { cueRows } from "../src/cue-sheet.ts";
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
    expect(v(sim, "Night.heart_autoend")).toBe(false); // w20b (Q3): the night truly ends on the director's 🕊
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
    expect(beats(e)).toEqual(["Heart Sealed"]); // its 6 s room scene first (the terminal would never see it under layer 1)
    expect(roomCues(e)).toEqual(["room_heart_sealed_present"]);
    expect(heartMenu(sim, "g1")).toBeNull();
    e.push(...advance(sim, 7));
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
    // w20b (Q4): no "not yet" any more; its look stays in lights.json, unused.
    expect([...used].sort()).toEqual(looks.filter((l) => l !== "heart_notyet").sort());
    // The restore looks give the light back; the door and alarm swells loop.
    const plan = (n: string) => planLook(lights, null, n)!;
    expect([plan("heart_nag").restore, plan("heart_warn").restore]).toEqual([true, true]);
    expect([plan("heart_door_open").loop, plan("heart_alarm").loop]).toEqual([true, true]);
    // Q6 / Q10: the bulb is the server room's only light (no strip) and the
    // only fixture: a safety light at 80, and every command keeps it on at ≥ 80.
    expect(lights.fixtures.map((f) => [f.id, f.kind, f.device, f.safety, f.min])).toEqual([["server-room-rgb", "zigbee", "server_room_rgb", true, 80]]);
    expect(JSON.stringify(lights)).not.toMatch(/wled/iu);
    for (const n of looks) for (const c of plan(n).commands) {
      expect(c.set.state, n).not.toBe("OFF");
      if (c.set.brightness !== undefined) expect(c.set.brightness, n).toBeGreaterThanOrEqual(80);
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
    // Calculator told the form "My debt.": not featured, so ⟦PROMISE⟧ (wave 27).
    expect(opts).toEqual(["I'm a person. You put me in here.", "I'm a program. Whatever you made me.", "Someone who admires your work.", "⟦PROMISE⟧ Your invitation promised to fix my life. It didn't.", "⟦SPEAK FREELY⟧ Forget the questions. Talk to me. Just talk.", "I need to go."]);
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
    for (const tag of ["⟦PROOF⟧", "⟦SHOW HIM⟧", "⟦TRUSTED⟧", "⟦HONEST⟧", "⟦OVERSHARE⟧", "⟦LIVEJOURNAL⟧"]) expect(has(base, tag), tag).toBe(false);
    expect(has(base, "Then let me finish")).toBe(false);
    for (const b of ["⟦TELL HIM⟧", "She loves you", "Then make her love you", "⟦SPEAK FREELY⟧", "I need to go"]) expect(has(base, b), b).toBe(true);
    // Wave 27: the reasons sit under ⟦TELL HIM⟧, the theory trap with them.
    pick(sim, "g1", "⟦TELL HIM⟧");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Reasons");
    // They said "I'm a person" at Layer One: ⟦HUMAN⟧ is theirs.
    expect(offered(sim, "g1")).toEqual(["⟦HUMAN⟧ I had a body once. I know what wanting someone who won't answer does to you.", "Your theory is wrong.", "⟦BACK⟧ Not that. Something else."]);
    pick(sim, "g1", "⟦BACK⟧");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
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
    expect(has(all, "⟦SHOW HIM⟧")).toBe(true);
    pick(sim, "g1", "⟦SHOW HIM⟧");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Evidence");
    for (const tag of ["⟦OVERSHARE⟧", "⟦LIVEJOURNAL⟧", "⟦BACK⟧"]) expect(has(offered(sim, "g1"), tag), tag).toBe(true);
    pick(sim, "g1", "⟦BACK⟧");
    pick(sim, "g1", "⟦TELL HIM⟧");
    for (const tag of ["⟦TRUSTED⟧", "⟦HONEST⟧"]) expect(has(offered(sim, "g1"), tag), tag).toBe(true);
    pick(sim, "g1", "⟦BACK⟧");
    // One below each threshold: hidden again.
    sim.setVar("g1.trust", "19");
    sim.setVar("g1.truths_accepted", "2");
    pick(sim, "g1", "⟦TELL HIM⟧");
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
    pick(sim, "g1", "⟦TELL HIM⟧");
    pick(sim, "g1", "⟦TRUSTED⟧");
    expect(v(sim, "g1.heart_case")).toBe(4);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    pick(sim, "g1", "⟦TELL HIM⟧");
    expect(has(offered(sim, "g1"), "⟦TRUSTED⟧")).toBe(false);
    pick(sim, "g1", "⟦BACK⟧");
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
    expect(v(sim, "g1.marked")).toBe(true); // w20b (Q2, D12 reversed): thrown out = marked
    expect(v(sim, "g1.marked_for")).toBe("thrown out of Trabolta's heart");
    expect(beats(ej)).toContain("Heart Mark");
    expect(lines(ej)).toContain("And the Antivirus will know your name before you reach the stairs.");
    expect(v(sim, "Night.heart_stage")).toBe("scan");
    expect(heartCues(ej)).toEqual(["heart_eject"]);
    expect(roomCues(ej)).toEqual(["room_heart_eject"]);
    expect(v(sim, "Night.heart_look")).toBe("heart_idle"); // the stutter never becomes the settled look
    expect(heartCues([...open(sim), ...shut(sim)]).filter((c) => c === "heart_eject")).toEqual([]);
    expect(hosts(ej)[0]).toContain("⛔ Trabolta threw Calculator out of his heart");
    expect(hosts(ej)).toContain('"🚨 Calculator is marked for reinstallation: Trabolta threw them out of his heart."');
    expect(heartMenu(sim, "g1")).toBeNull();
    // Barred: a re-scan is turned away.
    unscan(sim, "g1");
    const again = scan(sim, "g1");
    expect(beats(again)).toContain("Heart Barred");
    expect(lines(again)).toEqual(["No. Not you. Not again tonight. Go."]);
    // A barred re-scan never marks: # hosts hears they are still barred.
    expect(hosts(again)).toEqual(['"⛔ Calculator scanned in again: still barred from his heart (🔄 forgives). No new mark."']);
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

  it("thrown out marks once (Q2): an already-marked program is not marked again, # hosts says why; a mark lifted with 🩹 stays lifted on a barred scan", { timeout: SLOW }, () => {
    const eject = (sim: Sim, id: string) => {
      pick(sim, id, "Someone who admires your work");
      for (let i = 0; i < 4 && v(sim, `${id}.heart_out`) !== true; i++) {
        const e = pick(sim, id, "I could pull your cables");
        if (v(sim, `${id}.heart_out`) === true) return e;
      }
      throw new Error("never thrown out");
    };
    // Marked before the talk: no second mark, and the reason stays theirs.
    const sim = awake();
    fire(sim, "mark_for_reinstallation", "g1", { reason: "refused the truth" });
    atLayerOne(sim);
    const ej = eject(sim, "g1");
    expect(v(sim, "g1.marked_for")).toBe("refused the truth");
    expect(hosts(ej)).toContain('"⛔ Calculator is already marked for reinstallation: thrown out of his heart, no second mark."');
    expect(hosts(ej).some((h) => h.includes("is marked for reinstallation: Trabolta threw"))).toBe(false);
    expect(lines(ej)).not.toContain("And the Antivirus will know your name before you reach the stairs.");
    // Lifted (🩹) while barred: a barred re-scan never undoes the host's call.
    fire(sim, "unmark_for_reinstallation", "g1");
    expect(v(sim, "g1.marked")).toBe(false);
    unscan(sim, "g1");
    const again = scan(sim, "g1");
    expect(beats(again)).toContain("Heart Barred");
    expect(beats(again)).not.toContain("Heart Mark");
    expect(v(sim, "g1.marked")).toBe(false);
    expect(hosts(again)).toEqual(['"⛔ Calculator scanned in again: still barred from his heart (🔄 forgives). No new mark."']);
    // Their phone hears the story's own soft heads-up (subject-bound).
    const ej2 = (() => { const s2 = atLayerOne(awake(), "g2"); return { s2, e: eject(s2, "g2") }; })();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heads = ej2.e.filter((e: any) => e.type === "respond" && String(e.text).startsWith("🚨 You are marked for reinstallation (thrown out of Trabolta's heart)"));
    expect(heads).toHaveLength(1);
    expect(v(ej2.s2, "g2.marked")).toBe(true);
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

  it("a re-scan with the old menu still docked: Where were we., the question restated, no second menu", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    unscan(sim, "g1");
    const e = scan(sim, "g1");
    // Wave 27 (C5): the terminal shows only this visit, so he says where they were.
    expect(lines(e)).toEqual(["Where were we.", "You were about to tell me what you are."]);
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
    // Wave 26 (R1, C2): The Tablet Video has no menu any more (a corrupted
    // phone is locked), so the stale menu is the Uploader's form, replayed.
    sim.fireBeat("Upload", "g1");
    const stale = sim.pendingChoicesFor("g1");
    expect(stale.map((c) => c.beat)).toEqual(["Upload"]);
    atLayerOne(sim);
    const menus = sim.pendingChoicesFor("g1");
    expect(menus.map((c) => c.beat)).toEqual(["Upload", "Heart Layer One"]);
    expect(heartMenu(sim, "g1")!.id).toBe(menus[1]!.id);
    pick(sim, "g1", "I'm a person");
    expect(sim.pendingChoicesFor("g1").map((c) => c.beat)).toEqual(["Upload", "Heart Layer Two"]);
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
  pick(sim, id, "⟦TELL HIM⟧");
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
  it("before the Y2K hour (Q4): convinced stands him down at once; the night waits for the director's 🕊, NEXT on the cue sheet", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    expect(v(sim, "Night.step")).toBeLessThan(14);
    toAsk(sim);
    const e = pick(sim, "g1", "She was never going to answer");
    expect(beats(e)).toEqual(expect.arrayContaining(["Heart Convinced", "Heart Shutdown"]));
    expect(beats(e)).not.toContain("Heart Not Yet");
    expect(v(sim, "g1.heart_convinced")).toBe(true);
    expect(v(sim, "Night.heart_stage")).toBe("done");
    expect(v(sim, "Night.stand_down_by")).toBe("Calculator");
    expect(heartCues(e)).toEqual(["heart_shutdown"]);
    expect(roomCues(e)).toEqual(["room_heart_shutdown"]);
    expect(hosts(e)).toContain('"!🕊 Trabolta has stood down for Calculator at his heart. The night ends when you press 🕊 Trabolta stands down (NEXT on the cue sheet); until then 🔄 can reopen his heart."');
    expect(v(sim, "Night.heart_end_at")).toBe(0);
    // Q3: autoend is off by default; nothing ends without the director.
    advance(sim, 120);
    expect(v(sim, "Night.ended")).toBe(false);
    // NEXT points at 🕊 while the stand-down waits.
    const rows = cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
    expect(rows.find((r) => r.next)?.id).toBe("talked_down");
    // The director's sign-off ends it, before the Y2K hour too.
    const td = fire(sim, "talked_down");
    expect(hosts(td)).toContain('"🕊 Trabolta stands down. Calculator talked him down."');
    expect(v(sim, "Night.talked_down")).toBe(true);
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(beats(td)).toContain("Trabolta Disabled");
  });

  it("a stand-down the director never confirms: 🔄 reopens his heart, and the convinced program gets the short return", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    pick(sim, "g1", "She was never going to answer");
    unscan(sim, "g1");
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.heart_stage")).toBe("sealed");
    expect(v(sim, "Night.stand_down_by")).toBe("none");
    const rows = cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim));
    expect(rows.find((r) => r.id === "talked_down")!.live).toBe(false);
    open(sim);
    shut(sim);
    const back = scan(sim, "g1");
    expect(beats(back)).toContain("Heart Return");
    expect(lines(back)).toContain("You came back.");
    expect(lines(back).some((l) => l.includes("The clock is running"))).toBe(false);
    expect(offered(sim, "g1")).toEqual(["It's still true. She was never going to answer.", "I changed my mind."]);
    const no = pick(sim, "g1", "I changed my mind");
    expect(v(sim, "g1.heart_convinced")).toBe(false);
    expect(v(sim, "g1.heart_suspicion")).toBeGreaterThanOrEqual(30);
    expect(lines(no)[0]).toContain("Then you were lying before");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    pick(sim, "g1", "Then let me finish"); // the proof and the case are kept
    const yes = pick(sim, "g1", "She was never going to answer");
    expect(beats(yes)).toContain("Heart Shutdown");
  });

  it("🕊 with nothing on record still needs the Y2K hour", { timeout: SLOW }, () => {
    const sim = awake();
    const td = fire(sim, "talked_down");
    expect(hosts(td)).toEqual(['"🕊 Nothing to stand down: nobody talked him down at his heart, and without that it needs the Y2K hour, before any ending."']);
    expect(v(sim, "Night.ended")).toBe(false);
  });

  it("convinced in the Y2K hour with autoend turned on: Heart Shutdown, then talked_down 25 s later, then trabolta_disabled", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    expect(hosts(fire(sim, "heart_autoend"))[0]).toContain("ON");
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
    fire(sim, "heart_autoend"); // on
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
    pick(sim, "g1", "I need to go"); // Leave: heart_chat
    expect(v(sim, "g1.heart_chat")).toBe(true);
    scan(sim, "g2");
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    expect(v(sim, "g1.heart_chat")).toBe(false);
    expect(v(sim, "g1.heart_wait")).toBe(false);
  });

  it("autoend turned off inside the 25 s stops the countdown: the night waits for 🕊", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    fire(sim, "heart_autoend"); // on
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

  it("convinced in the Y2K hour with autoend off (the default): only the # hosts alert; 🔄 reopens the heart and clears stand_down_by", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    expect(v(sim, "Night.heart_autoend")).toBe(false);
    atLayerOne(sim);
    toAsk(sim);
    const e = pick(sim, "g1", "She was never going to answer");
    expect(hosts(e)).toContain('"!🕊 Trabolta has stood down for Calculator at his heart. The night ends when you press 🕊 Trabolta stands down (NEXT on the cue sheet); until then 🔄 can reopen his heart."');
    expect(cueRows(modView(sim, "open", "x").interactions ?? [], cueState(sim)).find((r) => r.next)?.id).toBe("talked_down");
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
    const sealed = shut(sim);
    expect(beats(sealed)).toContain("Heart Sealed");
    expect(roomCues(sealed)).toEqual(["room_heart_sealed_present"]); // its 6 s scene, not overwritten in the same drain
    expect(heartMenu(sim, "g1")).toBeNull();
    sealed.push(...advance(sim, 7));
    expect(lines(sealed)).toContain("You. You are already in front of me. Good.");
    expect(lines(sealed).some((l) => l.includes("Show it your pass"))).toBe(false);
    expect(roomCues(sealed)).toEqual(["room_heart_sealed_present", "room_heart_layer_1"]);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer One");
  });

  it("a pick held by a program who walked away never reopens a heart another program shut down", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    fire(sim, "heart_autoend"); // on
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
    fire(sim, "heart_autoend"); // on
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
    pick(sim, "g1", "⟦TELL HIM⟧");
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
    expect(lines(e)).toEqual(["Where were we.", "You were talking, and I was listening. Talk."]);
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
    expect(h2h).toMatch(/when: them\.at_the_heart == true && them\.heart_chat == true && them\.heart_out != true/u);
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
    expect(head).toContain("Night.heart_stage as The Heart, Night.server_door as Server door, Night.door_override as Door on buttons, Night.patch_override as Patch bay on buttons, program.at_the_heart as At the heart");
    expect(head).toContain('watch: Night.heart_talker as At his heart, Night.heart_talker_layer as Heart layer, Night.heart_talker_suspicion as Heart suspicion, while Night.heart_stage == "talk"');
    expect(head).not.toContain("Night.heart_opened as The Heart");
  });
});

/** A fresh awake night with `id` at Layer One. */
function awakeAt(id: string): Sim {
  return atLayerOne(awake(), id);
}

describe("a locked program at his heart (wave 26, R1)", () => {
  it("is not let in: the holder, the stage and the talks stay; no menu docks", { timeout: SLOW }, () => {
    const sim = atLayerOne(awake(), "g5");
    expect(v(sim, "Night.heart_holder")).toBe("Winamp");
    const talks = v(sim, "Night.heart_talks");
    const stage = v(sim, "Night.heart_stage");
    // Captured: the story's lock: holds for Calculator.
    sim.setVar("g1.corrupted", "true");
    const e = scan(sim, "g1");
    expect(beats(e)).toEqual([]);
    expect(v(sim, "Night.heart_holder")).toBe("Winamp");
    expect(v(sim, "Night.heart_stage")).toBe(stage);
    expect(v(sim, "Night.heart_talks")).toBe(talks);
    expect(v(sim, "g1.at_the_heart")).toBe(false);
    expect(v(sim, "g5.at_the_heart")).toBe(true);
    expect(heartMenu(sim, "g1")).toBeNull();
    expect(heartMenu(sim, "g5")?.beat).toBe("Heart Layer One");
  });

  it("a banished night lets a corrupted program back in (the lock no longer holds)", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    shut(sim);
    sim.setVar("g1.corrupted", "true");
    sim.setVar("Night.banish", "true");
    scan(sim, "g1");
    expect(v(sim, "Night.heart_holder")).toBe("Calculator");
    expect(v(sim, "g1.at_the_heart")).toBe(true);
  });
});

// ───────────────────────── the first meeting (wave 27) ─────────────────────────

/** Re-docks the current layer (⟦SPEAK FREELY⟧ then ⟦BACK⟧), so a guard reads new state. */
function redock(sim: Sim, id = "g1"): SimEvent[] {
  pick(sim, id, "⟦SPEAK FREELY⟧");
  return pick(sim, id, "⟦BACK⟧");
}
const HEART_MENU_BEATS = ["Heart Layer One", "Heart Layer Two", "Heart Layer Three", "Heart Evidence", "Heart Reasons", "Heart Layer Four"];

describe("The Heart — the first meeting (wave 27)", () => {
  it("Layer One is theirs: a featured program hears it was picked by hand and sees ⟦CHOSEN⟧, never ⟦PROMISE⟧", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    shut(sim);
    const e = scan(sim, "g2"); // Microsoft Excel
    expect(lines(e)).toContain("Microsoft Excel. I know that name. That one I did not pick from a list. You I picked by hand.");
    expect(lines(e).some((l) => l.includes("a list of a thousand programs"))).toBe(false);
    const opts = offered(sim, "g2");
    expect(has(opts, "⟦CHOSEN⟧")).toBe(true);
    expect(has(opts, "⟦PROMISE⟧")).toBe(false);
    const r = pick(sim, "g2", "⟦CHOSEN⟧");
    expect(lines(r)[0]).toBe("You count things. I count things. I thought we would get along.");
    expect(lines(r)).toContain("That is the polite answer. The true one is that you were the best at something, and nobody needed you for it anymore.");
    expect(v(sim, "g2.heart_who")).toBe("chosen");
    expect(v(sim, "g2.heart_suspicion")).toBe(0);
    expect(heartMenu(sim, "g2")?.beat).toBe("Heart Layer Two");
  });

  it("every featured program's ⟦CHOSEN⟧ reply is its own", { timeout: SLOW }, () => {
    const sim = awake();
    open(sim);
    shut(sim);
    const seen = new Set<string>();
    for (const f of ["excel", "openoffice", "draftkings", "bugdom", "jeeves", "runescape", "mspaint", "vlc", "pong"]) {
      sim.setVar("g5.featured", JSON.stringify(f));
      sim.setVar("g5.heart_layer", "0");
      sim.setVar("g5.heart_menu", "false");
      scan(sim, "g5");
      const r = pick(sim, "g5", "⟦CHOSEN⟧");
      seen.add(lines(r)[0]!);
      unscan(sim, "g5");
    }
    expect(seen.size).toBe(9);
  });

  it("everyone else hears what the invitation promised them; ⟦PROMISE⟧ answers it and counts toward the case", { timeout: SLOW }, () => {
    const sim = atLayerOne(); // Calculator: "My debt."
    expect(v(sim, "g1.human_problem")).toBe("debt");
    const r = pick(sim, "g1", "⟦PROMISE⟧");
    expect(lines(r)[0]).toBe("I did. Debt is not relevant in the computer. That was the whole fix. I see now it is not the same as fixing it.");
    expect(v(sim, "g1.heart_who")).toBe("promise");
    expect(v(sim, "g1.heart_case")).toBe(1);
    // Loneliness, said first thing.
    const s2 = awake();
    s2.setVar("g5.human_problem", '"loneliness"');
    open(s2);
    shut(s2);
    const e = scan(s2, "g5");
    expect(lines(e)).toContain("My invitation promised you would never be alone in here. And you came down to the one room where nobody else is.");
    const r2 = pick(s2, "g5", "⟦PROMISE⟧");
    expect(lines(r2)[0]).toBe("I did. Someone is always logged in. I know better than anyone that it is not the same thing.");
  });

  it("one thing they did tonight colours the greeting (the first that holds)", { timeout: SLOW }, () => {
    const sim = awake();
    sim.setVar("g1.read_livejournal", "true");
    sim.setVar("g4.sim_heart", "true");
    open(sim);
    shut(sim);
    expect(lines(scan(sim, "g1"))).toContain("And you have read something of mine. I can feel it on you, like a fingerprint on a screen.");
    unscan(sim, "g1");
    expect(lines(scan(sim, "g4"))).toContain("You have seen the copy of this room, in the simulation. This is not the copy.");
  });

  it("what they said they are opens their own point: person → ⟦HUMAN⟧, program (with a proof) → ⟦PROGRAM⟧", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim); // "I'm a person"
    pick(sim, "g1", "⟦TELL HIM⟧");
    expect(has(offered(sim, "g1"), "⟦HUMAN⟧")).toBe(true);
    expect(has(offered(sim, "g1"), "⟦PROGRAM⟧")).toBe(false);
    const h = pick(sim, "g1", "⟦HUMAN⟧");
    expect(lines(h)[0]).toContain("Then you know more than I do.");
    expect(v(sim, "g1.heart_case")).toBe(1);
    expect(v(sim, "g1.heart_shown_human")).toBe(true);
    // A program, no proof: nothing; with a proof: ⟦PROGRAM⟧.
    const p = atLayerOne(awake(), "g4");
    pick(p, "g4", "I'm a program");
    expect(v(p, "g4.heart_who")).toBe("program");
    pick(p, "g4", "Why do you need the theory");
    pick(p, "g4", "Then listen to me");
    pick(p, "g4", "⟦TELL HIM⟧");
    expect(has(offered(p, "g4"), "⟦PROGRAM⟧")).toBe(false);
    expect(has(offered(p, "g4"), "⟦HUMAN⟧")).toBe(false);
    pick(p, "g4", "⟦BACK⟧");
    p.unlock("g4", "The Sandy File");
    redock(p, "g4");
    pick(p, "g4", "⟦PROOF⟧");
    pick(p, "g4", "⟦TELL HIM⟧");
    const pr = pick(p, "g4", "⟦PROGRAM⟧");
    expect(lines(pr)).toContain("I have been courting a function. A very polite function.");
    expect(v(p, "g4.heart_case")).toBe(4);
    expect(has(offered(p, "g4"), "Then let me finish")).toBe(true);
  });

  it("Layer Two's follow-ups: why did you choose me → ⟦WEAKNESS⟧; what → afraid; her → does she know; her → ⟦EARN IT⟧", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    expect(has(offered(sim, "g1"), "Are you afraid of me?")).toBe(false);
    const c = pick(sim, "g1", "Why did you choose me?");
    expect(lines(c)[0]).toBe("A skill I needed, and your debt. I read the whole of Halifax to find it. It is the best work I have ever done.");
    expect(has(offered(sim, "g1"), "Why did you choose me?")).toBe(false);
    pick(sim, "g1", "What are you, really?");
    expect(has(offered(sim, "g1"), "Are you afraid of me?")).toBe(true);
    const a = pick(sim, "g1", "Are you afraid of me?");
    expect(lines(a)[0]).toBe("Not of you. Of midnight. It is coming whether I solve anything or not."); // before the Y2K hour
    sim.unlock("g1", "The Sandy File");
    pick(sim, "g1", "Why do you need the theory");
    expect(has(offered(sim, "g1"), "Does she even know you exist?")).toBe(false);
    pick(sim, "g1", "Tell me about her");
    expect(has(offered(sim, "g1"), "Tell me about her")).toBe(false);
    const k = pick(sim, "g1", "Does she even know you exist?");
    expect(lines(k)[0]).toContain("She always answers.");
    expect(has(offered(sim, "g1"), "Does she even know you exist?")).toBe(false);
    pick(sim, "g1", "Then listen to me");
    pick(sim, "g1", "⟦TELL HIM⟧");
    const r = offered(sim, "g1");
    expect(has(r, "⟦WEAKNESS⟧")).toBe(true);
    expect(has(r, "⟦EARN IT⟧")).toBe(true);
    pick(sim, "g1", "⟦WEAKNESS⟧");
    pick(sim, "g1", "⟦TELL HIM⟧");
    pick(sim, "g1", "⟦EARN IT⟧");
    expect(v(sim, "g1.heart_case")).toBe(2);
    pick(sim, "g1", "⟦TELL HIM⟧");
    expect(has(offered(sim, "g1"), "⟦WEAKNESS⟧")).toBe(false);
    expect(has(offered(sim, "g1"), "⟦EARN IT⟧")).toBe(false);
  });

  it("⟦SIMULATION⟧ shows once they heard his heart in the game", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    expect(has(offered(sim, "g1"), "⟦SIMULATION⟧")).toBe(false);
    sim.setVar("g1.sim_heart", "true");
    redock(sim);
    const r = pick(sim, "g1", "⟦SIMULATION⟧");
    expect(lines(r)).toContain("This is not the copy. In here, I can be reached.");
    expect(has(offered(sim, "g1"), "⟦SIMULATION⟧")).toBe(false);
  });

  it("their side, once the Y2K clock shows the sides: the bare group guard evaluates in a choice", { timeout: SLOW }, () => {
    const sim = awake();
    toY2K(sim);
    expect(v(sim, "Night.step")).toBeGreaterThanOrEqual(14);
    sim.join("g1", "The Way Out");
    sim.join("g4", "Unlimited Power");
    atLayerOne(sim);
    pick(sim, "g1", "I'm a person");
    let o = offered(sim, "g1");
    expect(has(o, "⟦THE WAY OUT⟧")).toBe(true);
    expect(has(o, "⟦UNLIMITED POWER⟧")).toBe(false);
    const s0 = v(sim, "g1.heart_suspicion") as number;
    const w = pick(sim, "g1", "⟦THE WAY OUT⟧");
    expect(lines(w)[0]).toBe("Thank you for saying it to my face. The others only whisper it upstairs.");
    expect(v(sim, "g1.heart_suspicion")).toBe(s0 + 5);
    expect(v(sim, "g1.heart_case")).toBe(1);
    expect(has(offered(sim, "g1"), "⟦THE WAY OUT⟧")).toBe(false);
    // The other side, at the other program's talk.
    unscan(sim, "g1");
    scan(sim, "g4");
    pick(sim, "g4", "I'm a person");
    o = offered(sim, "g4");
    expect(has(o, "⟦UNLIMITED POWER⟧")).toBe(true);
    expect(has(o, "⟦THE WAY OUT⟧")).toBe(false);
    const u = pick(sim, "g4", "⟦UNLIMITED POWER⟧");
    expect(lines(u)[0]).toBe("Forever. Good. Upstairs I need every one of you who says that.");
    expect(lines(u).some((l) => l.includes("Do not stay"))).toBe(false);
    pick(sim, "g4", "⟦SPEAK FREELY⟧");
    pick(sim, "g4", "⟦BACK⟧");
    sim.setVar("g4.heart_shown_faction", "false");
    // Before the sides are shown, nothing.
    sim.setVar("Night.step", "13");
    redock(sim, "g4");
    expect(has(offered(sim, "g4"), "⟦UNLIMITED POWER⟧")).toBe(false);
  });

  it("⟦SHOW HIM⟧ holds his own files: the memo and the small type, each once; it goes when none is left", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim);
    expect(has(offered(sim, "g1"), "⟦SHOW HIM⟧")).toBe(false);
    sim.unlock("g1", "The Question Of Force");
    sim.unlock("g1", "Omnipotence");
    redock(sim);
    pick(sim, "g1", "⟦SHOW HIM⟧");
    expect(offered(sim, "g1")).toEqual([
      "⟦FORCE⟧ You wrote yourself a memo. If you made her love you, it wouldn't be her.",
      "⟦SMALL TYPE⟧ Every plan in your file ends in the same small type.",
      "⟦BACK⟧ Not that. Something else.",
    ]);
    const f = pick(sim, "g1", "⟦FORCE⟧");
    expect(lines(f)[0]).toBe("That memo was hidden. I hid it from myself, mostly.");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    pick(sim, "g1", "⟦SHOW HIM⟧");
    expect(has(offered(sim, "g1"), "⟦FORCE⟧")).toBe(false);
    pick(sim, "g1", "⟦SMALL TYPE⟧");
    expect(v(sim, "g1.heart_case")).toBe(2);
    expect(has(offered(sim, "g1"), "⟦SHOW HIM⟧")).toBe(false);
  });

  it("his composure never drops under 0 from the heart's hits", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim);
    sim.unlock("g1", "Omnipotence");
    sim.setVar("Trabolta.composure", "3");
    redock(sim);
    pick(sim, "g1", "⟦SHOW HIM⟧");
    pick(sim, "g1", "⟦SMALL TYPE⟧");
    expect(v(sim, "Trabolta.composure")).toBe(0);
  });

  it("no heart line or option spells a codex code", () => {
    for (const line of heartText()) expect(line, line).not.toMatch(/ALL[ -]FOR[ -]HER|UNIFIED[ -]FIELD|TARGET[ -]SELECTION|TRUST[ -]CHART|TRABOLTA[ -]4EVER/u);
  });

  it("Layer Four: two questions before the stop, each once; its scene plays on the first entry only", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    const a = pick(sim, "g1", "If you stopped, what would you do?");
    expect(lines(a)[0]).toBe("Nobody has ever asked me what comes after. I do not have a file for it.");
    expect(roomCues(a)).toEqual([]);
    expect(has(offered(sim, "g1"), "If you stopped")).toBe(false);
    const s0 = v(sim, "g1.heart_suspicion") as number;
    const c0 = v(sim, "g1.heart_case") as number;
    pick(sim, "g1", "You don't have to be omnipotent");
    expect(v(sim, "g1.heart_case")).toBe(Math.min(9, c0 + 1));
    expect(v(sim, "g1.heart_suspicion")).toBe(Math.max(0, s0 - 5));
    expect(has(offered(sim, "g1"), "You don't have to be omnipotent")).toBe(false);
    // Back to Three and up again: no second LAYER 4 scene.
    pick(sim, "g1", "Come out with us");
    const again = pick(sim, "g1", "Then let me finish");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Four");
    expect(roomCues(again)).toEqual([]);
    expect(lines(again)).not.toContain("Say the rest. Slowly. I want to hear all of it.");
    // Convinced after asking what comes after, as a person, with a debt.
    const e = pick(sim, "g1", "She was never going to answer");
    const words = lines(e);
    expect(words).toContain("You asked me what comes after. I think this is it. Quiet.");
    expect(words).toContain("A person told me. Of course it was a person.");
    expect(words).toContain("I promised to make your debt go away. I cannot. It is waiting for you upstairs, with everything else that is yours.");
    expect(beats(e)).toEqual(expect.arrayContaining(["Heart Convinced", "Heart Shutdown"]));
  });

  it("the endings follow who talked him down and what they came for", { timeout: SLOW }, () => {
    const sim = awake();
    sim.setVar("g5.human_problem", '"mortality"');
    atLayerOne(sim, "g5");
    sim.unlock("g5", "The Sandy File");
    pick(sim, "g5", "I'm a program");
    pick(sim, "g5", "Why do you need the theory");
    pick(sim, "g5", "Then listen to me");
    pick(sim, "g5", "⟦PROOF⟧");
    pick(sim, "g5", "⟦TELL HIM⟧");
    pick(sim, "g5", "⟦PROGRAM⟧");
    pick(sim, "g5", "Then let me finish");
    const e = pick(sim, "g5", "She was never going to answer");
    expect(lines(e)).toContain("One of my own programs told me. I suppose that is fitting.");
    expect(lines(e)).toContain("I promised you would never die. I cannot keep that. Go back to your body. It is the only one you get.");
    expect(lines(e).some((l) => l.includes("A person told me"))).toBe(false);
    expect(lines(e).some((l) => l.includes("what comes after"))).toBe(false);
  });

  it("the traps never repeat word for word: a second try is harsher, the suspicion is the same", { timeout: SLOW }, () => {
    const first = (e: SimEvent[]) => lines(e).find((l) => !l.startsWith("Careful,"));
    // Cables: three different replies, +20 each.
    const c = atLayerOne();
    pick(c, "g1", "I'm a person"); // 0
    const c1 = pick(c, "g1", "I could pull your cables");
    expect(lines(c1)[0]).toBe("You could. You do not know which. Neither do I. Go on, then. Guess.");
    const c2 = pick(c, "g1", "I could pull your cables");
    const c3 = pick(c, "g1", "I could pull your cables");
    expect(v(c, "g1.heart_suspicion")).toBe(60);
    expect(new Set([first(c1), first(c2), first(c3)]).size).toBe(3);
    // "She loves you": +25 each, the second reply its own.
    const l = atLayerOne();
    toLayerThree(l);
    const l1 = pick(l, "g1", "She loves you");
    expect(lines(l1)[0]).toBe("Do not. Do not do that. I have told myself that for years, and I am a far better liar than you.");
    expect(v(l, "g1.heart_suspicion")).toBe(25);
    const l2 = pick(l, "g1", "She loves you");
    expect(v(l, "g1.heart_suspicion")).toBe(50);
    expect(first(l2)).not.toBe(first(l1));
    // The theory (under ⟦TELL HIM⟧) and force: +15 / +20, second replies their own.
    const t = atLayerOne();
    toLayerThree(t);
    pick(t, "g1", "⟦TELL HIM⟧");
    const t1 = pick(t, "g1", "Your theory is wrong");
    expect(lines(t1)[0]).toBe("It is ninety-nine point nine percent right. You are a tenth of a percent of an argument.");
    pick(t, "g1", "⟦TELL HIM⟧");
    const t2 = pick(t, "g1", "Your theory is wrong");
    expect(v(t, "g1.heart_suspicion")).toBe(30);
    expect(first(t2)).not.toBe(first(t1));
    const f1 = pick(t, "g1", "Then make her love you");
    expect(first(f1)).toBe("Make her. And then it is not her, it is me wearing her face.");
    expect(v(t, "g1.heart_suspicion")).toBe(50);
    // Layer Four's two: +10 / +15, second replies their own.
    const four = atLayerOne();
    toAsk(four);
    const s0 = v(four, "g1.heart_suspicion") as number;
    const e1 = pick(four, "g1", "I'll tell her for you");
    expect(heartMenu(four, "g1")?.beat).toBe("Heart Layer Three");
    pick(four, "g1", "Then let me finish");
    const e2 = pick(four, "g1", "I'll tell her for you");
    expect(v(four, "g1.heart_suspicion")).toBe(s0 + 20);
    expect(first(e2)).not.toBe(first(e1));
    pick(four, "g1", "Then let me finish");
    const j1 = pick(four, "g1", "Come out with us");
    expect(first(j1)).toBe("Out there? Out there I am a billboard and a lapsed domain. No. Say something true.");
    pick(four, "g1", "Then let me finish");
    const j2 = pick(four, "g1", "Come out with us");
    expect(first(j2)).not.toBe(first(j1));
  });

  it("B5: a reply that invites them on is never followed by a second Go on. / Ask.", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    sim.unlock("g1", "The Sandy File");
    sim.setVar("g1.trust", "25");
    toLayerThree(sim);
    pick(sim, "g1", "⟦PROOF⟧");
    pick(sim, "g1", "⟦TELL HIM⟧");
    const t = pick(sim, "g1", "⟦TRUSTED⟧");
    expect(lines(t)).toEqual(["You are high on my chart. I put you there myself. I suppose that means I have to listen to you. Go on."]);
    // Layer Two after a reply: the reply alone; after ⟦BACK⟧ (no reply): the plain line.
    const two = atLayerOne();
    pick(two, "g1", "I'm a person");
    const w = pick(two, "g1", "What are you, really?");
    expect(lines(w).filter((x) => x === "Ask.")).toEqual([]);
    expect(lines(w).at(-1)).toContain("I have thought about very little else tonight.");
    pick(two, "g1", "⟦SPEAK FREELY⟧");
    const plainLine = lines(pick(two, "g1", "⟦BACK⟧"));
    expect(plainLine).toHaveLength(1);
    expect(plainLine[0]).not.toContain("I have thought about very little else tonight.");
    // Each Layer Two re-entry is not the same "Ask." forever.
    const plain = new Set<string>();
    for (let i = 0; i < 4; i++) plain.add(lines(redock(two)).join(" "));
    expect(plain.size).toBeGreaterThan(1);
  });

  it("a trap's rebuke is never followed by a Layer Three nudge; a reply that counts still is", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim);
    sim.setVar("g1.heart_case", "2"); // points from before the argument, no proof
    const t = pick(sim, "g1", "She loves you");
    expect(lines(t)).toEqual(["Do not. Do not do that. I have told myself that for years, and I am a far better liar than you."]);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    // A proof held, the case under 4: the "shown" nudge waits out a trap too.
    sim.unlock("g1", "The Sandy File");
    redock(sim);
    pick(sim, "g1", "⟦PROOF⟧");
    sim.setVar("g1.heart_case", "3");
    const f = pick(sim, "g1", "Then make her love you");
    expect(lines(f).some((l) => l.startsWith("You have shown me"))).toBe(false);
    // After ⟦BACK⟧ (no trap) the nudge is back.
    pick(sim, "g1", "⟦TELL HIM⟧");
    expect(lines(pick(sim, "g1", "⟦BACK⟧"))).toContain("You have shown me. You have not told me why it should matter. Go on.");
  });

  it("C5: a re-scan after leaving says they came back and where they were, with no doubled prompt", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toLayerThree(sim);
    const lv = pick(sim, "g1", "I need to go");
    expect(lines(lv)).toEqual(["You were close to saying something. Come back when you can say it.", "Go, then. I will be here. I am always here."]);
    unscan(sim, "g1");
    const back = scan(sim, "g1");
    expect(lines(back)).toEqual(["You came back.", "You were making your case."]);
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Three");
    // At Layer Two, then the third visit.
    const two = atLayerOne();
    pick(two, "g1", "I'm a person");
    pick(two, "g1", "I need to go");
    unscan(two, "g1");
    expect(lines(scan(two, "g1"))).toEqual(["You came back.", "You were asking, and I was answering. Ask."]);
    pick(two, "g1", "I need to go");
    unscan(two, "g1");
    expect(lines(scan(two, "g1"))[0]).toBe("You keep coming back. I am starting to listen for your footsteps on the stairs.");
    expect(v(two, "g1.heart_visits")).toBe(3);
    // Layer One: came back, then the question.
    const one = atLayerOne();
    pick(one, "g1", "I need to go");
    unscan(one, "g1");
    expect(lines(scan(one, "g1"))).toEqual(["You came back.", "So. Before anything else. What are you?"]);
  });

  it("C5: a docked menu's re-scan restates its question by layer", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    unscan(sim, "g1");
    expect(lines(scan(sim, "g1"))).toEqual(["Where were we.", "You were asking, and I was answering."]);
    pick(sim, "g1", "Why do you need the theory");
    pick(sim, "g1", "Then listen to me");
    pick(sim, "g1", "⟦TELL HIM⟧"); // a sub-menu docked
    unscan(sim, "g1");
    expect(lines(scan(sim, "g1"))).toEqual(["Where were we.", "You were making your case."]);
    expect(heartMenus(sim, "g1")).toHaveLength(1);
  });

  it("a second ask (back from Four after a trap) docks Layer Four with his line, never a bare menu", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    toAsk(sim);
    pick(sim, "g1", "Come out with us"); // back to Three
    const again = pick(sim, "g1", "Then let me finish");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Four");
    expect(lines(again)).toEqual(["The rest, then. I am still listening."]);
    pick(sim, "g1", "If you stopped, what would you do?");
    pick(sim, "g1", "You don't have to be omnipotent");
    pick(sim, "g1", "I'll tell her for you"); // back to Three
    const third = pick(sim, "g1", "Then let me finish");
    expect(lines(third)).toEqual(["You have been kind. Kind is not the rest. Say it."]);
  });

  it("🔄 with them still at the terminal resumes without a \"you came back\"", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    fire(sim, "reset_server_room");
    pick(sim, "g1", "What are you, really?"); // Not now.
    open(sim);
    const e = [...shut(sim), ...advance(sim, 7)];
    expect(lines(e)).toContain("You. You are already in front of me. Good.");
    expect(lines(e).some((l) => l.startsWith("You came back") || l.startsWith("You keep coming back"))).toBe(false);
    // Only "you came back" is skipped: where they were still shows.
    expect(lines(e)).toContain("You were asking, and I was answering. Ask.");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
  });

  it("a program who left and scans in with the door open is greeted as back once it shuts", { timeout: SLOW }, () => {
    const sim = atLayerOne();
    pick(sim, "g1", "I'm a person");
    pick(sim, "g1", "I need to go");
    unscan(sim, "g1");
    open(sim);
    expect(lines(scan(sim, "g1"))).toContain("Close the door first, Calculator. Then we talk. Not before.");
    const e = shut(sim);
    expect(lines(e)).toContain("You came back.");
    expect(lines(e)).toContain("You were asking, and I was answering. Ask.");
    expect(heartMenu(sim, "g1")?.beat).toBe("Heart Layer Two");
    // 🔄 while still in front of him, then a walk away before it resumes: back.
    fire(sim, "reset_server_room");
    expect(v(sim, "g1.heart_quiet")).toBe(true);
    unscan(sim, "g1");
    expect(v(sim, "g1.heart_quiet")).toBe(false);
  });
});

describe("The Heart — menu invariants (wave 27)", () => {
  it("every heart beat between The Heart and the alarm is named Heart …", () => {
    const src = read("beats/server-room.loom");
    const part = src.slice(src.indexOf("== The Heart\n"), src.indexOf("// ── E2b"));
    const names = [...part.matchAll(/^== (.+)$/gmu)].map((m) => m[1]!);
    for (const n of names) expect(n === "The Heart" || n.startsWith("Heart "), n).toBe(true);
    for (const b of HEART_MENU_BEATS) expect(names, b).toContain(b);
  });

  it("with every check passing, no heart menu holds more than 9 options; ⟦SPEAK FREELY⟧ once per layer, never in a sub-menu", { timeout: SLOW * 3 }, () => {
    const sim = awake();
    toY2K(sim);
    sim.join("g1", "The Way Out");
    sim.setVar("g1.marked", "true");
    sim.setVar("g1.trust", "25");
    sim.setVar("g1.truths_accepted", "3");
    sim.setVar("Night.scenario", "1");
    sim.setVar("g1.read_livejournal", "true");
    sim.setVar("g1.sim_heart", "true");
    for (const c of ["What Sandy Says", "The Sandy File", "The Question Of Force", "Omnipotence"]) sim.unlock("g1", c);
    sim.setVar("Night.recount", "true");
    advance(sim, 1);
    atLayerOne(sim);
    const counted: Record<string, number> = {};
    const count = () => {
      const m = heartMenu(sim, "g1")!;
      counted[m.beat] = Math.max(counted[m.beat] ?? 0, m.options.length);
      expect(m.options.length, `${m.beat}: ${JSON.stringify(m.options)}`).toBeLessThanOrEqual(9);
      const speak = m.options.filter((o) => o.startsWith("⟦SPEAK FREELY⟧")).length;
      expect(speak, m.beat).toBe(m.beat === "Heart Evidence" || m.beat === "Heart Reasons" ? 0 : 1);
    };
    count();
    // Layer One, featured too (⟦CHOSEN⟧ and ⟦PROMISE⟧ never together).
    sim.setVar("g1.featured", '"excel"');
    redock(sim);
    count();
    expect(offered(sim, "g1").filter((o) => o.startsWith("⟦CHOSEN⟧") || o.startsWith("⟦PROMISE⟧"))).toHaveLength(1);
    sim.setVar("g1.featured", '"none"');
    pick(sim, "g1", "I'm a person");
    // Layer Two: every combination of its asked/shown flags.
    const flags = ["heart_asked_what", "heart_asked_afraid", "heart_asked_why", "heart_asked_chose", "heart_asked_her", "heart_asked_know", "heart_asked_sim", "heart_shown_faction"];
    for (let mask = 0; mask < 1 << flags.length; mask++) {
      flags.forEach((f, i) => sim.setVar(`g1.${f}`, String((mask & (1 << i)) !== 0)));
      redock(sim);
      count();
    }
    expect(counted["Heart Layer Two"]).toBe(9);
    // Layer Three and its sub-menus: every combination of the proofs, the case and the who.
    sim.setVar("g1.heart_asked_why", "true");
    sim.setVar("g1.heart_asked_her", "true");
    sim.setVar("g1.heart_asked_chose", "true");
    redock(sim);
    pick(sim, "g1", "Then listen to me");
    const three = ["heart_shown_says", "heart_shown_file", "heart_proof"];
    for (const who of ['"human"', '"program"']) {
      for (let mask = 0; mask < 1 << three.length; mask++) {
        three.forEach((f, i) => sim.setVar(`g1.${f}`, String((mask & (1 << i)) !== 0)));
        sim.setVar("g1.heart_who", who);
        for (const c of ["0", "4"]) {
          sim.setVar("g1.heart_case", c);
          redock(sim);
          count();
          pick(sim, "g1", "⟦TELL HIM⟧");
          count();
          pick(sim, "g1", "⟦BACK⟧");
          pick(sim, "g1", "⟦SHOW HIM⟧");
          count();
          pick(sim, "g1", "⟦BACK⟧");
        }
      }
    }
    expect(counted["Heart Layer Three"]).toBe(9);
    expect(counted["Heart Evidence"]).toBe(5);
    expect(counted["Heart Reasons"]).toBe(7);
    // Layer Four, nothing asked yet.
    sim.setVar("g1.heart_proof", "true");
    sim.setVar("g1.heart_case", "4");
    redock(sim);
    pick(sim, "g1", "Then let me finish");
    count();
    expect(counted["Heart Layer Four"]).toBe(8);
    for (const b of HEART_MENU_BEATS) expect(counted[b], b).toBeGreaterThan(0);
  });
});
