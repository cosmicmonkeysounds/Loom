//! Trapped in the Internet — the patch bay judges itself (wave 22). The
//! bay is 15 jacks on the Grand Central M4 (8 sources V1–V8, 7 inputs
//! D1–D7) read by the server-room terminal, which posts `patch_changed
//! {combo}` for each new complete patch. Combo A moved to
//! V2-D5,V4-D1,V6-D7,V7-D3 (no D8 any more). Two inputs, one bay, like the
//! door's D19: a 🔌 💥 ❌ press (a director's, or the room Antivirus'
//! `radio_*`) in the Y2K hour hands the bay to the buttons
//! (`Night.patch_override`) until 🔌 Trust the patch bay, and a ❌ pressed
//! right after the bay's own rejection is that same patch, never counted
//! twice. Played through the public `Sim` API (helpers copied from
//! trapped-w20b-no-esp32.test.ts so the files stay independent), plus one
//! run over the event server's `/api/mod/signal`.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { cueState, notePress, pressRefused } from "../server/views.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const SLOW = 120_000;
const A = "V2-D5,V4-D1,V6-D7,V7-D3";
const B = "V1-D6,V3-D2,V5-D7,V8-D4";
const WRONG = "V1-D1,V2-D2,V3-D3,V4-D4";
const WRONG_2 = "V1-D2,V2-D3,V3-D4,V4-D5";

type Ev<T extends SimEvent["type"]> = Extract<SimEvent, { type: T }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
const beats = (evs: SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e) => (e as { beat?: string; name?: string }).beat ?? (e as { name?: string }).name);
const hosts = (evs: SimEvent[]) => (evs.filter((e) => e.type === "broadcast") as Ev<"broadcast">[]).filter((e) => e.scope === "channel(hosts)").map((e) => e.cue);
const trabolta = (evs: SimEvent[]) => (evs.filter((e) => e.type === "dialogue") as Ev<"dialogue">[]).filter((e) => e.speaker === "Trabolta").map((e) => e.text);

function advance(sim: Sim, seconds: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < seconds; i++) out.push(...sim.tick(1000));
  return out;
}
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
const fire = (sim: Sim, name: string, subject: string | null = null, actor?: string) => sim.signal(name, subject ?? undefined, null, actor);
const fireAll = (sim: Sim, ...names: string[]) => names.flatMap((n) => sim.signal(n));
const bay = (sim: Sim, combo: string) => sim.signal("patch_changed", undefined, { combo });
const TO_OVERSHARE = ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened", "trabolta_overshares"];
function toOvershare(sim: Sim): void {
  fireAll(sim, "call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth");
  if (v(sim, "Night.filing_open") === true) fire(sim, "close_the_filing");
  for (let i = 0; i < 3 && v(sim, "Night.phase") === "truth_1" && v(sim, "Night.results_q") < 3; i++) fire(sim, "read_the_results");
  fireAll(sim, "second_hunt_preview", "start_the_second_hunt");
  advance(sim, 120);
  sim.choose("g2", 0);
  sim.choose("g3", 0);
  fireAll(sim, ...TO_OVERSHARE);
}
function toY2K(sim: Sim): void {
  toOvershare(sim);
  fire(sim, "y2k_clock");
  advance(sim, 2);
}

describe("the patch bay judges itself (wave 22)", () => {
  it("combo A is the M4 bay's: V6 → D7, the codex halves still spell the Kernel", () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    expect(v(sim, "Kernel.combo_a")).toBe(A);
    expect(v(sim, "Kernel.combo_b")).toBe(B);
    expect(v(sim, "Night.patch_override")).toBe(false);
    // Every pair is on the 8 + 7 bay: no D8 anywhere.
    for (const c of [A, B]) for (const pair of c.split(",")) expect(pair, c).toMatch(/^V[1-8]-D[1-7]$/u);
    const text = (title: string) => sim.model.codex.get(title)?.text ?? "";
    const pairs = (t: string) => [...t.matchAll(/V(\d) → D(\d)/gu)].map((m) => `V${m[1]}-D${m[2]}`);
    expect([...pairs(text("Combo A First Half")), ...pairs(text("Combo A Second Half"))].join(",")).toBe(A);
    expect([...pairs(text("Combo B First Half")), ...pairs(text("Combo B Second Half"))].join(",")).toBe(B);
  });

  it("in the Y2K hour combo A off the bay disables Trabolta, and the bay keeps the cables (no override)", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    const out = bay(sim, A);
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(v(sim, "Night.patch_override")).toBe(false);
    expect(hosts(out).some((h) => h.includes("follows the 🔌 💥 ❌"))).toBe(false);
  });

  it("combo B off the bay self-destructs the computer", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    bay(sim, B);
    expect(v(sim, "Night.ending")).toBe("destroyed");
  });

  it("two wrong patches off the bay: the first is forgiven, the second trips the alarm", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    expect(trabolta(bay(sim, WRONG))).toEqual(["Stop touching me."]);
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.alarm_on")).not.toBe(true);
    const second = bay(sim, WRONG_2);
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(beats(second)).toContain("Server Room Alarm");
    expect(v(sim, "Night.alarm_on")).toBe(true);
  });

  it("before 🕚 or after an ending a patch from the bay does nothing (and says nothing)", { timeout: SLOW }, () => {
    const sim = boot();
    toOvershare(sim);
    for (const c of [A, B, WRONG]) {
      const out = bay(sim, c);
      expect(beats(out), c).toEqual([]);
      expect(hosts(out), c).toEqual([]);
    }
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(v(sim, "Night.wrong_combos")).toBe(0);
    fire(sim, "y2k_clock");
    bay(sim, B);
    expect(v(sim, "Night.ending")).toBe("destroyed");
    for (const c of [A, WRONG]) expect(beats(bay(sim, c)), c).toEqual([]);
    expect(v(sim, "Night.ending")).toBe("destroyed");
    expect(v(sim, "Night.wrong_combos")).toBe(0);
  });

  it("a ❌ from the watch's booth hands the bay to the buttons: the bay is ignored (one # hosts line) until 🔌 Trust the patch bay", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    const press = fire(sim, "radio_wrong_patch", "g1", "Norton Anti-Virus");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.patch_override")).toBe(true);
    expect(hosts(press).filter((h) => h.includes("now follows the 🔌 💥 ❌ patch buttons"))).toHaveLength(1);
    // A second press says it no more.
    const again = fire(sim, "patch_rejected");
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(hosts(again).filter((h) => h.includes("now follows"))).toEqual([]);
    fire(sim, "reset_server_room");
    expect(v(sim, "Night.wrong_combos")).toBe(0);
    expect(v(sim, "Night.patch_override")).toBe(true); // 🔄 leaves the bay on the buttons, like 🚪
    // Combo A off the bay is ignored: # hosts hears why, nothing ends.
    const ignored = bay(sim, A);
    expect(v(sim, "Night.ended")).not.toBe(true);
    expect(beats(ignored)).toEqual([]);
    expect(hosts(ignored)).toEqual([expect.stringContaining("🔌 Trust the patch bay")]);
    expect(bay(sim, WRONG) && v(sim, "Night.wrong_combos")).toBe(0);
    // 🔌 Trust: the bay judges again.
    expect(hosts(fire(sim, "trust_patch_bay"))).toEqual([expect.stringContaining("🔌 The story follows the patch bay again.")]);
    expect(v(sim, "Night.patch_override")).toBe(false);
    bay(sim, A);
    expect(v(sim, "Night.ending")).toBe("disabled");
  });

  it("a ❌ pressed right after the bay's own rejection is that same patch: not counted twice (no alarm), the next one is", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    bay(sim, WRONG);
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    advance(sim, 10);
    const press = fire(sim, "radio_wrong_patch", "g1", "Password Manager");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(v(sim, "Night.alarm_on")).not.toBe(true);
    expect(beats(press)).toEqual([]);
    expect(hosts(press)).toEqual(expect.arrayContaining([expect.stringContaining("already counted that wrong combination")]));
    expect(v(sim, "Night.patch_override")).toBe(true);
    // A second ❌ is a new wrong patch: the alarm.
    const second = fire(sim, "radio_wrong_patch", "g1", "Password Manager");
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(beats(second)).toContain("Server Room Alarm");
  });

  it("⭐ a watch's press pays only when the story took it: a ❌ swallowed as the bay's own rejection pays nothing and tells the presser", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    const score = () => v(sim, "Norton_Anti_Virus.score") ?? 0;
    const trust = () => v(sim, "Norton_Anti_Virus.trust") ?? 0;
    const s0 = score();
    const t0 = trust();
    bay(sim, WRONG);
    expect(score()).toBe(s0); // the bay judged itself: nobody pressed
    const swallowed = fire(sim, "radio_wrong_patch", "g1", "Norton Anti-Virus");
    expect(v(sim, "Night.wrong_combos")).toBe(1);
    expect(score()).toBe(s0);
    expect(trust()).toBe(t0);
    const replies = (evs: SimEvent[]) => (evs.filter((e) => e.type === "respond") as Ev<"respond">[]).map((r) => `${r.to}: ${r.text}`);
    expect(replies(swallowed)).toEqual(expect.arrayContaining([expect.stringMatching(/^Norton Anti-Virus: ❌ Not counted/u)]));
    // The next ❌ is a new wrong patch: taken, +10 and +5 trust.
    expect(replies(fire(sim, "radio_wrong_patch", "g1", "Norton Anti-Virus"))).toContain("Norton Anti-Virus: ⭐ +10");
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(score()).toBe(s0 + 10);
    expect(trust()).toBe(t0 + 5);
    // A director's 🔌 pays nobody, not even the last presser.
    fire(sim, "patch_combo_a");
    expect(v(sim, "Night.ending")).toBe("disabled");
    expect(score()).toBe(s0 + 10);
  });

  it("⭐ a 🔌 press out of turn pays nothing", { timeout: SLOW }, () => {
    const sim = boot();
    toOvershare(sim);
    const s0 = v(sim, "Norton_Anti_Virus.score") ?? 0;
    for (const name of ["radio_combo_a", "radio_combo_b", "radio_wrong_patch"]) fire(sim, name, "g1", "Norton Anti-Virus");
    expect(v(sim, "Norton_Anti_Virus.score") ?? 0).toBe(s0);
    expect(v(sim, "Night.patch_override")).toBe(false);
  });

  it("a ❌ more than a minute after the bay's rejection counts", { timeout: SLOW }, () => {
    const sim = boot();
    toY2K(sim);
    bay(sim, WRONG);
    advance(sim, 61);
    fire(sim, "patch_rejected");
    expect(v(sim, "Night.wrong_combos")).toBe(2);
    expect(v(sim, "Night.alarm_on")).toBe(true);
  });

  it("an out-of-turn 🔌 / 💥 / ❌ takes nothing: no override, the press refused with its # hosts reason", { timeout: SLOW }, () => {
    const sim = boot();
    toOvershare(sim);
    for (const name of ["patch_combo_a", "patch_combo_b", "patch_rejected"]) {
      const out = sim.signal(name);
      notePress(sim, out);
      expect(pressRefused(sim, out), name).toBe(true);
    }
    expect(v(sim, "Night.patch_override")).toBe(false);
  });

  it("🔌 Trust the patch bay is an E aside, NEXT only while the bay is on the buttons", () => {
    const sim = boot();
    const cue = sim.model.interactions.get("trust_patch_bay")!;
    expect(cue.who).toBe("admin");
    expect(cue.sequence).toBe(false);
    expect(cue.act).toMatch(/^E · /u);
    expect(cueState(sim).fired).not.toContain("trust_patch_bay");
    // The glance shows the bay on the buttons beside the door's.
    expect(SRC).toContain("Night.door_override as Door on buttons, Night.patch_override as Patch bay on buttons");
  });
});

// ─────────────────────── over the event server ───────────────────────

const CODES = { event: "EVT722", prime: "PRM722", mod: "MOD722" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fakeReq(body: unknown) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write() {
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
  };
  return res as typeof res & ServerResponse;
}
async function mod(rt: EventRuntime, body: Record<string, unknown>) {
  const res = fakeRes();
  const url = new URL("http://x/api/mod/signal");
  await rt.handle(fakeReq(body), res, "POST", url.pathname, url, { moderator: true });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}

describe("the patch bay over /api/mod/signal (the server-room terminal's post)", () => {
  it("patch_changed {combo: A} in the Y2K hour ends the night disabled; a device post is never refused", { timeout: SLOW }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "loom-w22-bay-"));
    dirs.push(dir);
    const facts = readFileSync(join(import.meta.dirname, "..", "examples", SHOW, "facts.json"), "utf8");
    const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, joinBase: () => "http://localhost", factsFile: join(dir, "no-such-facts.json"), facts });
    rt.openDoors();
    const sim = rt.liveSim!;
    const night = (p: string) => v(sim, p);
    for (const name of ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"]) await mod(rt, { name });
    if (night("Night.filing_open") === true) await mod(rt, { name: "close_the_filing" });
    for (let i = 0; i < 3 && night("Night.phase") === "truth_1" && night("Night.results_q") < 3; i++) await mod(rt, { name: "read_the_results" });
    for (const name of ["second_hunt_preview", "start_the_second_hunt"]) await mod(rt, { name });
    rt.tickOnce(120_000);
    for (const name of TO_OVERSHARE) await mod(rt, { name });
    // Before 🕚 the bay's post lands and does nothing.
    const early = await mod(rt, { name: "patch_changed", args: { combo: A }, label: "Terminal · Server Room" });
    expect(early.status).toBe(200);
    expect(early.json["refused"]).not.toBe(true);
    expect(night("Night.ended")).not.toBe(true);
    await mod(rt, { name: "y2k_clock" });
    expect(night("Night.step")).toBeGreaterThanOrEqual(14);
    const post = await mod(rt, { name: "patch_changed", args: { combo: A }, label: "Terminal · Server Room" });
    expect(post.status).toBe(200);
    expect(post.json["refused"]).not.toBe(true);
    expect(night("Night.ending")).toBe("disabled");
    expect(night("Night.patch_override")).toBe(false);
  });
});
