//! Trapped in the Internet — wave 21 (story lane): performers play.
//!
//! - Clippy and the four Antivirus are `player: true`; no admin cue names a
//!   player (`by:`), the three hosts keep `admin: true`, and the show lints
//!   clean (no L1222 / L1223 / L1225).
//! - A player booth's PrimeView: `player`, the ⭐ stats, a mission, only its
//!   own buttons, never a caller.
//! - Scoring: Clippy's game buttons pay Clippy only when Clippy pressed;
//!   the Antivirus earn for clearances, captures and releases.
//! - Covert favours stay out of Trabolta's agent request; every third is
//!   caught (−20 trust, a private warning).
//! - 📢 Defect openly: a house-wide big moment, Trabolta answers as an ally.
//! - Staff rows on the Trust Chart; the three staff awards, ceremony_done on
//!   The Mole, G11 after it.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { Workspace } from "../src/lsp/index.ts";
import { scenarioFiles, scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { callsCue, cueCallers, isCaller, notePress, primeView } from "../server/views.ts";
import type { AgentRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const SRC = scenarioSource("trapped-in-the-internet");
const SLOW = 120_000;
const PLAYERS = ["Clippy", "Norton Anti-Virus", "McAfee Anti-Virus", "Password Manager", "CRA Agent Software"];
const HOSTS = ["Task Manager", "Adobe Acrobat", "Recycling Bin"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};

class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  signal(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): ChatMessage[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    return this.take(ev);
  }
  press(name: string, subject?: string): ChatMessage[] {
    return this.signal(name, subject);
  }
  scan(scanner: string, id: string): ChatMessage[] {
    return this.take(this.sim.scan(scanner, id));
  }
  upload(id: string, name: string, scanner: string | null = "Norton Anti-Virus"): ChatMessage[] {
    const out: ChatMessage[] = [];
    out.push(...this.take(this.sim.createPerson(id, name)));
    out.push(...this.signal("captcha answered", id, { passed: true }));
    out.push(...this.signal("captcha answered", id, { passed: false }));
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 4) out.push(...this.take(this.sim.choose(id, 0)));
    out.push(...this.take(this.sim.choose(id, 0)));
    if (scanner !== null) out.push(...this.scan(scanner, id));
    return out;
  }
}

const PROGRAMS: [string, string][] = [
  ["g1", "Calculator"],
  ["g2", "Microsoft Excel"],
  ["g3", "OpenOffice"],
  ["g4", "MS Paint"],
  ["g5", "Winamp"],
  ["g6", "VLC"],
];
const TO_BINGO = ["call_to_the_desktop", "start_the_bingo", "bingo_time"];
const TO_TRUTH_1 = [...TO_BINGO, "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth"];
const TO_HOUR = [...TO_TRUTH_1, "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];

function boot(): Night {
  const n = new Night();
  for (const [id, name] of PROGRAMS) n.upload(id, name);
  return n;
}
/** Through the Truther Download (defection opens). */
function toTruther(n: Night): void {
  for (const c of [...TO_HOUR, "truther_download"]) n.press(c);
}
const to = (ms: readonly ChatMessage[], id: string) => ms.filter((m) => m.audience === "all" || (Array.isArray(m.audience) && m.audience.includes(id)));
const readouts = (ms: readonly ChatMessage[], who: string) => ms.filter((m) => m.channel === `dm:${who}` && m.readout === true);

describe("Trapped in the Internet — wave 21: who plays (S1, S2)", () => {
  it("Clippy and the four Antivirus are players; the hosts keep admin; nobody calls a cue but the hosts and directors", () => {
    const m = Sim.fromSources(SRC).model;
    for (const p of PLAYERS) {
      expect(m.characters.get(p)?.player, p).toBe(true);
      expect(m.characters.get(p)?.privateSlots, p).toEqual(["covert", "caught"]);
      expect(isCaller(m, p), p).toBe(false);
    }
    for (const h of HOSTS) {
      expect(m.characters.get(h)?.player, h).toBe(false);
      expect(m.characters.get(h)?.admin, h).toBe(true);
    }
    // Clippy left GROUP Hosts (D6): no faction, so no `# hosts`.
    expect(m.characters.get("Clippy")?.faction).toBeNull();
    // No admin cue names anyone at all (every `by: Clippy` dropped).
    expect([...cueCallers(m).values()].flat()).toEqual([]);
    for (const id of ["start_the_bingo", "bingo_time", "start_the_ceremony", "award_most_trusted", "award_staff_mole"]) expect(callsCue(m, "Clippy", id), id).toBe(false);
  });

  it("the show lints clean of the wave 21 codes", () => {
    const ws = new Workspace();
    const files = scenarioFiles("trapped-in-the-internet");
    for (const f of files) ws.open(`file:///${f.path}`, f.source);
    const found: string[] = [];
    for (const f of files) for (const d of ws.diagnosticsFor(`file:///${f.path}`)?.diagnostics ?? []) if (/^L12(19|2[2-5])$/u.test(String(d.code))) found.push(`${f.path}: ${d.code} ${d.message}`);
    expect(found).toEqual([]);
  }, 60_000);

  it("each game a host calls pops YOUR GAME IS ON in Clippy's booth, once", () => {
    const n = boot();
    n.press("call_to_the_desktop");
    const bingo = readouts(n.press("start_the_bingo"), "Clippy");
    expect(bingo.some((m) => m.text.includes("YOUR GAME IS ON") && m.moment === "big")).toBe(true);
    expect(readouts(n.press("start_the_bingo"), "Clippy").some((m) => m.text.includes("YOUR GAME IS ON"))).toBe(false);
    const results = readouts(n.press("bingo_time"), "Clippy");
    expect(results.some((m) => m.text.includes("YOUR GAME IS ON · The Bingo results"))).toBe(true);
    // Nothing in Clippy's notes mentions a 🎤 bar any more.
    expect(n.chat.all().filter((m) => m.channel === "dm:Clippy").some((m) => m.text.includes("🎤"))).toBe(false);
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: a player's booth (C4 on the show)", () => {
  it("Clippy's PrimeView: player, ⭐ stats, a mission, only Clippy's buttons, no calls", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const pv = primeView(n.sim, "Clippy");
    expect(pv.player).toBe(true);
    expect(pv.stats?.map((s) => s.label)).toEqual(["Points", "Answers judged"]);
    expect(pv.stats?.[0]?.value).toBe("0");
    expect(pv.mission?.objective).toBeTruthy();
    expect(pv.calls ?? []).toEqual([]);
    const ids = (pv.interactions ?? []).map((i) => i.id);
    expect(ids).toContain("bingo_winner");
    expect(ids).not.toContain("send to the internet");
    expect(ids).not.toContain("frame_for_bingo");
    expect(ids).not.toContain("look_the_other_way");
  }, SLOW);

  it("an Antivirus booth: ⭐ and 🛡 captures, its own buttons", () => {
    const n = boot();
    const pv = primeView(n.sim, "Norton Anti-Virus");
    expect(pv.player).toBe(true);
    expect(pv.stats?.map((s) => s.label)).toEqual(["Points", "Captures"]);
    // Six door clearances by Norton: ⭐ +5 each.
    expect(pv.stats?.[0]?.value).toBe("30");
    const ids = (pv.interactions ?? []).map((i) => i.id);
    expect(ids).toContain("look_the_other_way");
    expect(ids).not.toContain("bingo_winner");
    expect(ids).not.toContain("slip_coin");
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: points (S3)", () => {
  it("Clippy's game buttons pay Clippy; a host pressing the same button pays nobody", () => {
    const n = boot();
    for (const c of TO_BINGO) n.press(c);
    const win = n.signal("bingo_winner", "g1", undefined, "Clippy");
    expect(v(n.sim, "Clippy.score")).toBe(10);
    expect(readouts(win, "Clippy").some((m) => m.text.includes("⭐ +10"))).toBe(true);
    n.signal("bingo_winner", "g1", undefined, "Clippy"); // a repeat counts nothing
    expect(v(n.sim, "Clippy.score")).toBe(10);
    n.signal("award_the_ribbon", "g1", undefined, "Task Manager"); // a host's ribbon
    expect(v(n.sim, "Clippy.score")).toBe(10);
    n.signal("bingo_winner", "g2", undefined, "Clippy");
    n.signal("award_the_ribbon", "g2", undefined, "Clippy");
    expect(v(n.sim, "Clippy.score")).toBe(25);
    n.signal("named_at_bingo", "g3", undefined, "Clippy");
    expect(v(n.sim, "Clippy.score")).toBe(35);
    expect(v(n.sim, "Clippy.trust")).toBe(5);
  }, SLOW);

  it("judging: ✅ / 😤 follow 🔢, and pay Clippy per answer it judged", () => {
    const n = boot();
    for (const c of TO_HOUR) n.press(c);
    for (const c of ["five_minute_warning"]) n.press(c);
    for (const [g] of PROGRAMS) n.signal("checked_in", g, { at: "The Desktop" });
    n.press("summons_closed");
    n.press("truth_pong");
    n.signal("made_the_cup", "g1", undefined, "Clippy");
    n.signal("made_the_cup", "g2", undefined, "Clippy");
    expect(v(n.sim, "Clippy.score")).toBe(10);
    expect(v(n.sim, "Night.judge_now")).toBe(1);
    n.signal("judging_q2", undefined, undefined, "Clippy");
    expect(v(n.sim, "Night.judge_now")).toBe(2);
    n.signal("judge_accurate", "g1", undefined, "Clippy");
    expect(v(n.sim, "g1.judged_q5")).toBe(true);
    expect(v(n.sim, "Clippy.judged")).toBe(1);
    expect(v(n.sim, "Clippy.score")).toBe(15);
    n.signal("judge_confident", "g2", undefined, "Adobe Acrobat"); // a host judged it
    expect(v(n.sim, "g2.judged_q5")).toBe(true);
    expect(v(n.sim, "Clippy.judged")).toBe(1);
  }, SLOW);

  it("the Antivirus: a capture is ⭐ +20 and +5 trust, a release ⭐ +5; mercy in the open costs trust", () => {
    const n = boot();
    const before = v(n.sim, "McAfee_Anti_Virus.score");
    n.signal("send to the internet", "g1", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "McAfee_Anti_Virus.score")).toBe(before + 20);
    expect(v(n.sim, "McAfee_Anti_Virus.captures")).toBe(1);
    expect(v(n.sim, "McAfee_Anti_Virus.trust")).toBe(5);
    n.signal("mark as reinstalled", "g1", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "McAfee_Anti_Virus.score")).toBe(before + 25);
    n.signal("mark_for_reinstallation", "g2", { reason: "a test" });
    n.signal("unmark_for_reinstallation", "g2", undefined, "Password Manager");
    expect(v(n.sim, "Password_Manager.trust")).toBe(-5);
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: the audit and the exchange (S3)", () => {
  it("CRA's denial from its own booth is ⭐ +3 and +3 trust; a director's is nobody's; McAfee brokers once per program", () => {
    const n = boot();
    toTruther(n);
    n.signal("transfer_denied", "g1", { to: "g2", amount: 10, tx: "t1", by: "CRA Agent Software" });
    expect(v(n.sim, "CRA_Agent_Software.score")).toBe(3);
    expect(v(n.sim, "CRA_Agent_Software.trust")).toBe(3);
    n.signal("transfer_denied", "g1", { to: "g2", amount: 10, tx: "t2", by: "Director" });
    expect(v(n.sim, "CRA_Agent_Software.score")).toBe(3);
    n.signal("transfer_approved", "g1", { to: "g2", amount: 10, tx: "t3", by: "CRA Agent Software" });
    expect(v(n.sim, "CRA_Agent_Software.score")).toBe(6);
    const before = v(n.sim, "McAfee_Anti_Virus.score");
    n.signal("broker_deal", "g3", undefined, "McAfee Anti-Virus");
    n.signal("broker_deal", "g3", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "McAfee_Anti_Virus.score")).toBe(before + 10);
    const pm = v(n.sim, "Password_Manager.score");
    n.signal("verify_password", "g3", undefined, "Password Manager");
    expect(v(n.sim, "Password_Manager.score")).toBe(pm + 5);
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: quiet favours and the open defection (S4, S5)", () => {
  it("🤫 Look the other way lifts a claimed mark quietly; covert is never in an agent request; the third is caught", () => {
    const n = boot();
    toTruther(n);
    for (const g of ["g1", "g2", "g3"]) {
      n.signal("mark_for_reinstallation", g, { reason: "a test" });
      n.signal("claim_escort", g, undefined, "Norton Anti-Virus");
    }
    const quiet = n.signal("look_the_other_way", "g1", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "g1.marked")).toBe(false);
    expect(v(n.sim, "Norton_Anti_Virus.covert")).toBe(1);
    // No "Off the escort list" readout to the other Antivirus.
    expect(readouts(quiet, "McAfee Anti-Virus")).toEqual([]);
    // A booth without the claim can't (the hook refuses).
    n.signal("look_the_other_way", "g2", undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "g2.marked")).toBe(true);
    n.signal("look_the_other_way", "g2", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "Norton_Anti_Virus.trust")).toBe(0);
    const caught = n.signal("look_the_other_way", "g3", undefined, "Norton Anti-Virus");
    expect(v(n.sim, "Norton_Anti_Virus.covert")).toBe(3);
    expect(v(n.sim, "Norton_Anti_Virus.caught")).toBe(1);
    expect(v(n.sim, "Norton_Anti_Virus.trust")).toBe(-20);
    expect(readouts(caught, "Norton Anti-Virus").some((m) => m.text.includes("Trabolta noticed something"))).toBe(true);
    // Nothing reached the house: no line to everyone.
    expect(caught.filter((m) => m.audience === "all")).toEqual([]);
  }, SLOW);

  it("McAfee and CRA slip coin; Clippy and Password Manager tip off; Clippy lets a guess slide", () => {
    const n = boot();
    toTruther(n);
    const coin = v(n.sim, "g4.score");
    n.signal("slip_coin", "g4", undefined, "McAfee Anti-Virus");
    n.signal("slip_coin", "g4", undefined, "CRA Agent Software"); // once per program
    expect(v(n.sim, "g4.score")).toBe(coin + 50);
    expect(v(n.sim, "McAfee_Anti_Virus.covert")).toBe(1);
    expect(v(n.sim, "CRA_Agent_Software.covert")).toBe(0);
    n.signal("mark_for_reinstallation", "g5", { reason: "a test" });
    const tip = n.signal("tip_off", "g5", undefined, "Clippy");
    expect(to(tip, "g5").some((m) => m.channel === "dm:Clippy" && m.text.includes("You didn't hear it from me"))).toBe(true);
    expect(v(n.sim, "Clippy.covert")).toBe(1);
    n.signal("tip_off", "g5", undefined, "Password Manager");
    expect(v(n.sim, "Password_Manager.covert")).toBe(0);
  }, SLOW);

  it("📢 Defect openly: a big moment to everyone, Trabolta keeps them as allies, once, −50 trust", () => {
    const n = boot();
    toTruther(n);
    const out = n.signal("defect_openly", undefined, undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "McAfee_Anti_Virus.defected")).toBe("open");
    expect(v(n.sim, "McAfee_Anti_Virus.trust")).toBe(-50);
    expect(v(n.sim, "Norton_Anti_Virus.defected")).toBe("none");
    const big = out.filter((m) => m.audience === "all" && m.moment === "big");
    expect(big.map((m) => m.text)).toEqual(["📢 McAfee Anti-Virus HAS DEFECTED. In front of everyone: not on Trabolta's side any more."]);
    const him = out.filter((m) => m.from === "Trabolta" && m.channel === "loc:The Desktop").map((m) => m.text);
    expect(him.join(" ")).toContain("we are still allies");
    n.signal("defect_openly", undefined, undefined, "McAfee Anti-Virus");
    expect(v(n.sim, "Night.defections")).toBe(1);
  }, SLOW);

  it("before the Truther Download a defection does nothing", () => {
    const n = boot();
    n.signal("defect_openly", undefined, undefined, "Clippy");
    expect(v(n.sim, "Clippy.defected")).toBe("none");
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: the staff awards (S7)", () => {
  function toCeremony(n: Night): void {
    toTruther(n);
    n.take(n.sim.setVar("Night.ended", "true"));
    n.take(n.sim.setVar("Night.ending", "song"));
    n.press("start_the_ceremony");
  }

  it("Favourite Staff, Staff Player Of The Night and The Mole name the players; The Mole closes the ceremony", () => {
    const n = boot();
    n.signal("send to the internet", "g1", undefined, "CRA Agent Software");
    n.take(n.sim.setVar("Clippy.covert", "2"));
    n.take(n.sim.setVar("Password_Manager.covert", "4"));
    toCeremony(n);
    n.press("award_staff_trusted");
    expect(v(n.sim, "Night.award")).toBe("staff_trusted");
    expect(v(n.sim, "Night.award_winner")).toBe("CRA Agent Software");
    expect(v(n.sim, "Night.ceremony_done")).toBe(false);
    const pts = n.press("award_staff_points");
    expect(v(n.sim, "Night.award_winner")).toBe("Norton Anti-Virus");
    expect(readouts(pts, "Norton Anti-Virus").some((m) => m.moment === "big" && m.text.includes("Staff Player Of The Night"))).toBe(true);
    // G11 before The Mole asks again.
    n.press("resurrection");
    expect(v(n.sim, "Night.resurrected")).toBe(false);
    const mole = n.press("award_staff_mole");
    expect(v(n.sim, "Night.award_winner")).toBe("Password Manager");
    expect(v(n.sim, "Night.award_value")).toBe(4);
    expect(v(n.sim, "Night.ceremony_done")).toBe(true);
    expect(mole.some((m) => m.text.includes("The Mole"))).toBe(true);
    n.press("resurrection");
    expect(v(n.sim, "Night.resurrected")).toBe(true);
  }, SLOW);

  it("The Mole with no quiet favours names nobody", () => {
    const n = boot();
    toCeremony(n);
    n.press("award_staff_mole");
    expect(v(n.sim, "Night.award_winner")).toBe("Nobody");
    expect(v(n.sim, "Night.ceremony_done")).toBe(true);
  }, SLOW);
});

// ── Over the wire: Trabolta's worker never reads a quiet favour ──────

const CODES = { event: "EVT021", prime: "PRM021", mod: "MOD021" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    setHeader() {},
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((block) => {
          const ev = /^event: (.*)$/mu.exec(block)?.[1];
          const data = /^data: (.*)$/mu.exec(block)?.[1];
          return ev !== undefined && data !== undefined ? ([ev, JSON.parse(data)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, pathAndQuery: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${pathAndQuery}`);
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, o.moderator ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

describe("Trapped in the Internet — wave 21: what Trabolta's worker reads (D3, S8)", () => {
  it("a player's request carries trust and defected, never covert / caught; a guest's never carries tipped / slipped", async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-trapped-w21-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "trapped-in-the-internet", scenarioSource: SRC, joinBase: () => "http://localhost" });
    rt.openDoors();
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, x]) => x as AgentRequest);
    const sim = rt.liveSim!;
    sim.setVar("Trabolta.awake", "true");
    sim.setVar("Clippy.covert", "2");
    sim.setVar("Clippy.trust", "12");
    const login = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    expect(login.status).toBe(200);
    expect(login.json["caller"]).toBe(false);
    const clippy = login.json["token"] as string;
    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text: "Boss, a word?" }, { token: clippy })).status).toBe(200);
    const r = requests().find((q) => q.speaker.id === "Clippy")!;
    expect(r.speaker).toMatchObject({ kind: "performer", player: true });
    expect(r.them.vars).toHaveProperty("trust");
    expect(r.them.vars).toHaveProperty("defected");
    expect(r.them.vars).not.toHaveProperty("covert");
    expect(r.them.vars).not.toHaveProperty("caught");
    expect(Object.keys(r.them.ranges ?? {})).toContain("trust");
    expect(JSON.stringify(r.world)).not.toContain("pressed_by");
    // His voice may move a player's trust (them.trust), clamped; never covert.
    const reply = await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Back to work.", adjust: { "them.trust": 5, "them.covert": 3 } }, { moderator: true });
    expect(reply.json["applied"]).toEqual({ "them.trust": 17 });
    expect(sim.world.get("Clippy.trust")).toEqual({ kind: "number", value: 17 });
    expect(sim.world.get("Clippy.covert")).toEqual({ kind: "number", value: 2 });

    const g = await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event });
    const gid = g.json["id"] as string;
    sim.setVar(`${gid}.tipped`, "true");
    sim.setVar(`${gid}.slipped`, "true");
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hello" }, { token: g.json["token"] as string });
    const gr = requests().find((q) => q.speaker.kind === "guest");
    if (gr !== undefined) {
      expect(gr.them.vars).not.toHaveProperty("tipped");
      expect(gr.them.vars).not.toHaveProperty("slipped");
    }
    const facts = await call(rt, "GET", "/api/agent/facts", {}, { moderator: true });
    expect(JSON.stringify(facts.json)).not.toMatch(/"(covert|caught|tipped|slipped|slid)"/u);
  }, SLOW);
});

describe("Trapped in the Internet — wave 21: the sign-off sheet", () => {
  it("SIGNOFF-w21.md is a DRAFT that lists every new wave 21 objective", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(join(__dirname, "../examples/trapped-in-the-internet/SIGNOFF-w21.md"), "utf8");
    expect(sheet).toMatch(/DRAFT/u);
    const src = scenarioFiles("trapped-in-the-internet").find((f) => f.path === "objectives.loom")!.source;
    const fresh = [...src.matchAll(/^\/\/ DRAFT w21\nOBJECTIVE (.+)$/gmu)].map((x) => x[1]!.trim());
    expect(fresh.length).toBeGreaterThan(0);
    for (const id of fresh) expect(sheet, id).toContain(id);
  });
});
