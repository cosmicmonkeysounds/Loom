//! Wave 18b, Stage C1 (`integ`): the cross-lane checks on the merged show.
//!
//! - The whole night (Sim): clearance deals every program its ties (§4.6),
//!   founding opens at the Truther Download and the count waits for 🕚
//!   (O7), a founded faction wins, ⚖'s ending waits for the verdict's TV
//!   pages, the ceremony reads The Night In Review then the awards, every
//!   program still here gets its own file, Purgatory names the founded
//!   faction, and Lore Hoarder counts no ties.
//! - The results and the judge (EventRuntime + a fake worker voicing
//!   Trabolta, O4 / O2): non-exact filings queue one ruling at a time, a
//!   guest's DM goes before the next ruling, the round's settle falls back
//!   for what was left, his stamps ride the reads, 🧮 reads H4–H6, and at ⚖
//!   the TV (never a wall) carries every key answer and the liars, while an
//!   agent request after ⚖ carries neither.
//! - A guest can't post into a hidden lobby (`lobby: hidden`).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Sim } from "../src/runtime/sim/index.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { ChatStore, composeGuestMessages, type ChatMessage } from "../server/chat.ts";
import { guestView, notePress } from "../server/views.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentJudgeRequest, AgentRequest } from "../server/agents.ts";
import type { ScreenState } from "../server/routes/screen.ts";
import { parseFactsText, FACTS_FILE } from "../src/facts.ts";
import { withTestKeys } from "./fixtures/hunt-keys.ts";
import { TO_HUNT2 } from "../../scripts/accept/chains.ts";

const SHOW = "trapped-in-the-internet";
const SRC = scenarioSource(SHOW);
const FACTS_TEXT = withTestKeys(readFileSync(join(scenarioDir(SHOW), FACTS_FILE), "utf8"));
const FACTS = parseFactsText(FACTS_TEXT).facts!;
const CODES = { event: "EVT18B", prime: "PRM18B", mod: "MOD18B" };
const SLOW = 300_000;

const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const v = (sim: Sim, p: string): any => {
  const x = sim.world.get(p) as { value: unknown } | undefined;
  return x === undefined ? undefined : x.value;
};
type Dialogue = Extract<SimEvent, { type: "dialogue" }>;
const lines = (evs: readonly SimEvent[], speaker: string) => evs.filter((e): e is Dialogue => e.type === "dialogue" && e.speaker === speaker).map((e) => e.text.trim());
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const beats = (evs: readonly SimEvent[]) => evs.filter((e) => e.type === "beatEntered").map((e: any) => (e.beat ?? e.name) as string);

/** A Sim plus the chat the event server would compose from it. */
class Night {
  readonly sim = Sim.fromSources(SRC);
  readonly chat = new ChatStore();
  constructor() {
    this.take(this.sim.fireBeat("Power On"));
  }
  take(events: SimEvent[]): ChatMessage[] {
    return this.chat.append(composeGuestMessages(this.sim, events));
  }
  tick(seconds: number): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = 0; i < seconds; i++) {
      const ev = this.sim.tick(1000);
      this.take(ev);
      out.push(...ev);
    }
    return out;
  }
  raw(name: string, subject?: string, args?: Record<string, unknown>, actor?: string): SimEvent[] {
    const ev = this.sim.signal(name, subject, args as never, actor);
    notePress(this.sim, ev);
    this.take(ev);
    return ev;
  }
  upload(id: string, name: string): void {
    this.take(this.sim.createPerson(id, name));
    this.raw("captcha answered", id, { passed: true });
    this.raw("captcha answered", id, { passed: false });
    const p = this.sim.pendingChoiceFor(id);
    if (p && p.length === 5) this.take(this.sim.choose(id, 0)); // a pool program's problem: debt
    this.take(this.sim.choose(id, 0));
    this.take(this.sim.scan("Norton Anti-Virus", id));
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
const TO_HOUR = ["call_to_the_desktop", "start_the_bingo", "bingo_time", "introduce_trabolta", "start_the_hunt", "hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results", "second_hunt_preview", "start_the_second_hunt"];
const TO_Y2K_REST = ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"];

describe("wave 18b integration — the whole night on the merged show (C1)", () => {
  it("ties at clearance, a founded faction's win, ⚖ waiting for its pages, the review before the awards, a file per program, Purgatory's founded line", { timeout: SLOW }, () => {
    const n = new Night();
    for (const [id, name] of PROGRAMS) n.upload(id, name);

    // §4.6: every cleared program's ties were dealt at clearance, privately.
    for (const [id] of PROGRAMS) expect(v(n.sim, `${id}.ties_dealt`), id).toBe(true);
    for (const t of ["The Old Machines", "Debt Notices"]) expect(n.sim.holdsCodex("g1", t), t).toBe(true);
    for (const t of ["Juniors Contacts", "Forever", "The Ladies In Finance"]) expect(n.sim.holdsCodex("g2", t), t).toBe(true);
    expect(n.sim.holdsCodex("g5", "Juniors Contacts")).toBe(false);
    const briefings = n.chat.historyFor("g1", false).filter((m) => m.beat === "Program Briefing");
    expect(briefings.length).toBeGreaterThan(0);
    for (const m of n.chat.historyFor("g2", false)) if (m.beat === "Program Briefing") expect(m.audience).toEqual(["g2"]);

    // O7: no founding before the Truther Download; founding after it.
    for (const c of TO_HOUR) n.raw(c);
    expect(guestView(n.sim, "g1").canFound).toBe(false);
    n.tick(125); // 📥
    for (const g of ["g2", "g3"]) n.take(n.sim.choose(g, 0));
    expect(guestView(n.sim, "g1").canFound).toBe(true);
    n.take(n.sim.crew({ op: "foundCrew", by: "g1", name: "The Calculators" }));
    const id = n.sim.crews.factionOf("g1")!;
    for (const g of ["g4", "g5", "g6"]) n.take(n.sim.crew({ op: "joinCrew", person: g, crew: id }));
    // Over the line before the clock, but nothing is counted until 🕚.
    expect(v(n.sim, "Kernel.majority_reached")).not.toBe(true);
    for (const c of TO_Y2K_REST) n.raw(c);
    expect(v(n.sim, "Kernel.majority")).toBe("founded");
    expect(v(n.sim, "Kernel.majority_name")).toBe("The Calculators");

    // Midnight → the bob → truth.txt → ⚖: the ending waits for the TV's pages.
    n.tick(3601);
    expect(v(n.sim, "Night.phase")).toBe("final_reveal");
    n.raw("bobbing_for_truth");
    n.raw("brought_up_the_bag", "g5", undefined, "Clippy");
    n.raw("read_truth_txt");
    // Wave 59a: nobody found the last answer, so 8-B plays and the verdict waits for it.
    expect(beats(n.raw("the_verdict"))).toContain("Nobody Found It");
    expect(beats(n.raw("the_verdict"))).toEqual([]);
    const verdict = n.tick(71);
    expect(beats(verdict)).toContain("The Verdict");
    expect(lines(verdict, "Trabolta").some((l) => /true\. .* with a lie on record\./u.test(l))).toBe(true);
    expect(beats(verdict)).not.toContain("Song Ending");
    expect(v(n.sim, "Night.ended")).not.toBe(true);
    // A second ⚖ meanwhile only tells # hosts.
    expect(beats(n.raw("the_verdict"))).toEqual([]);
    expect(beats(n.tick(30))).not.toContain("Song Ending");
    expect(beats(n.tick(5))).toContain("Song Ending"); // nobody filed a lie: the song
    expect(v(n.sim, "Night.ending")).toBe("song");

    // The ceremony: The Night In Review first, then the awards; a file each.
    n.sim.setVar("g6.gone", "true");
    const before = n.chat.historyFor("g1", false).length;
    n.raw("start_the_ceremony"); // wave 58: the first press only asks
    const cer = n.raw("start_the_ceremony");
    const order = beats(cer);
    expect(order.indexOf("The Night In Review")).toBeGreaterThan(-1);
    expect(order.indexOf("The Night In Review")).toBeLessThan(order.indexOf("The Ceremony"));
    for (const [g] of PROGRAMS.slice(0, 5)) {
      const file = n.chat.historyFor(g, false).filter((m) => m.beat === "Your File");
      expect(file.length, g).toBeGreaterThan(0);
      for (const m of file) {
        expect(m.channel, g).toBe("dm:The Uploader");
        expect(m.audience, g).toEqual([g]);
      }
    }
    expect(n.chat.historyFor("g6", false).some((m) => m.beat === "Your File")).toBe(false); // went home
    expect(n.chat.historyFor("g1", false).length).toBeGreaterThan(before);
    // The founded faction's name is Clippy's (Purgatory) or The Uploader's, never Trabolta's.
    expect(lines(cer, "Trabolta").join("\n")).not.toContain("The Calculators");

    // Lore Hoarder counts what a program found, never its ties.
    const codex = v(n.sim, "g1.codex") as number;
    const ties = v(n.sim, "g1.codex_in.connections") as number;
    expect(ties).toBe(2);
    n.raw("award_lore_hoarder", "g1");
    expect(Number(v(n.sim, "Night.award_value"))).toBe(codex - ties);

    // Purgatory (the destroyed ending's) names the founded faction.
    n.sim.setVar("Night.ending", "destroyed");
    expect(lines(n.sim.fireBeat("Purgatory"), "Clippy")).toContain("The Calculators won the majority, a faction founded tonight.");
  });
});

// ───────────────────────── the runtime half ─────────────────────────

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
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
    setHeader() {},
    flushHeaders() {},
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    write(chunk: string) {
      buf += chunk;
      return true;
    },
    end(b?: string) {
      if (typeof b === "string") res.body = b;
      return res;
    },
    on() {
      return res;
    },
    once() {
      return res;
    },
    frames(): Array<[string, unknown]> {
      return buf
        .split("\n\n")
        .map((bl) => {
          const ev = /^event: (.*)$/mu.exec(bl)?.[1];
          const d = /^data: (.*)$/mu.exec(bl)?.[1];
          return ev !== undefined && d !== undefined ? ([ev, JSON.parse(d)] as [string, unknown]) : null;
        })
        .filter((f): f is [string, unknown] => f !== null);
    },
  };
  return res as typeof res & ServerResponse;
}
async function call(rt: EventRuntime, method: string, p: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res, body: res.body };
}
interface Guest {
  id: string;
  token: string;
  name: string;
}
const codeOf = (q: string) => FACTS.questions.find((x) => x.id === q)!.codex!.code;
const KEY_ANSWERS = FACTS.questions.map((q) => q.answer);

async function showRuntime() {
  const dir = mkdtempSync(join(tmpdir(), "loom-w18b-integ-"));
  tmp.push(dir);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(dir), codes: CODES, scenarioName: SHOW, scenarioSource: SRC, facts: FACTS_TEXT, joinBase: () => "http://localhost" });
  rt.openDoors();
  const mod = async (name: string, extra: Record<string, unknown> = {}) => {
    const r = await call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
    expect(r.status, name).toBe(200);
    return r;
  };
  const guests: Guest[] = [];
  for (const name of ["Calculator", "Winamp", "Notepad"]) {
    const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
    expect(g.status, name).toBe(200);
    const id = g.json["id"] as string;
    const token = g.json["token"] as string;
    await mod("captcha answered", { subject: id, args: { passed: false } });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
    await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
    guests.push({ id, token, name });
  }
  const poll = async (view: "tv" | "auto") => {
    const name = view === "tv" ? "TV" : "Kitchen";
    const r = await call(rt, "GET", `/api/screen/state?name=${name}&view=${view}`, {}, { moderator: true });
    return { state: r.json as unknown as ScreenState, body: r.body };
  };
  return { rt, mod, guests, poll };
}

function file(rt: EventRuntime, g: Guest, question: string, answer: string, confidence: number) {
  const card = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact").at(-1);
  expect(card, `${g.name}'s fact card`).toBeDefined();
  return call(rt, "POST", "/api/guest/widget", { seq: card!.seq, result: { question, answer, confidence } }, { token: g.token });
}

describe("wave 18b integration — results, rulings and the verdict on the merged show (C1, O2, O4)", () => {
  it("a round of non-exact filings queues one ruling at a time behind a guest's DM; the settle falls back; the reads, 🧮 and ⚖ show the results; the TV alone names answers and liars", { timeout: SLOW }, async () => {
    const { rt, mod, guests, poll } = await showRuntime();
    const [calc, amp, pad] = guests as [Guest, Guest, Guest];
    const w = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const hello = w.res.frames().find(([e]) => e === "hello")![1] as { worker: string };
    const judges = () => w.res.frames().filter(([e]) => e === "judge").map(([, d]) => d as AgentJudgeRequest);
    const requests = () => w.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);

    for (const c of TO_HUNT2.slice(0, TO_HUNT2.indexOf("introduce_trabolta") + 1)) await mod(c); // → introduce_trabolta
    await mod("start_the_hunt");
    for (const g of guests) for (const q of ["H1", "H2", "H3"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    const h1 = FACTS.questions.find((q) => q.id === "H1")!;

    // An exact match: accepted at once, nothing asked.
    expect((await file(rt, calc, "H1", h1.answer, 100)).status).toBe(200);
    expect(judges()).toHaveLength(0);
    // Three non-exact filings: one ruling out, the rest queued.
    expect((await file(rt, amp, "H1", "a dozen years", 100)).status).toBe(200);
    expect((await file(rt, pad, "H1", "twelve years", 60)).status).toBe(200);
    expect((await file(rt, calc, "H2", "Mittens", 100)).status).toBe(200);
    expect(judges()).toHaveLength(1);

    // A guest's DM: the voice goes first, the next ruling waits for it.
    const asked = requests().length;
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Are you there?" }, { token: amp.token })).status).toBe(200);
    expect(requests().length).toBe(asked + 1);
    const j1 = judges()[0]!;
    expect((await call(rt, "POST", "/api/agent/judge", { id: j1.id, worker: hello.worker, same: false, why: "" }, { moderator: true })).status).toBe(200);
    expect(judges()).toHaveLength(1); // the voice request is still open
    const r1 = requests().at(-1)!;
    expect((await call(rt, "POST", "/api/agent/reply", { id: r1.id, worker: hello.worker, say: "I am here.", adjust: {} }, { moderator: true })).status).toBe(200);
    expect(judges()).toHaveLength(2); // the next ruling goes out once he has answered
    // That one is never answered: the round's settle falls back for it and the queued one.

    // 📋×3: every read carries his stamps; nothing is left asking after the settle.
    for (const c of ["hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results"]) await mod(c);
    const read = (await poll("tv")).state.results!;
    expect(read.kind).toBe("read");
    const q1 = read.questions.find((q) => q.id === "H1")!;
    const row = (who: string) => q1.rows!.find((r) => r[0] === who)!;
    expect(row("Calculator")[4]).toBe(""); // an exact match: no stamp
    expect(row("Winamp")[4]).toBe("r"); // ruled at 100: held until ⚖
    expect(q1.rows!.some((r) => r[4] === "?")).toBe(false);
    expect(q1.answer).toBeNull(); // no consensus: no answer before ⚖
    const wall = (await poll("auto")).state.results!;
    expect(wall.questions.find((q) => q.id === "H1")).not.toHaveProperty("rows");
    for (const c of ["read_the_results", "read_the_results"]) await mod(c);

    // Hunt 2 → 🧮, which reads nothing now (wave 59a).
    for (const c of ["second_hunt_preview", "start_the_second_hunt"]) await mod(c);
    rt.tickOnce(120_000); // 📥
    for (const g of guests) for (const q of ["H4", "H5", "H6"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    expect((await file(rt, calc, "H4", FACTS.questions.find((q) => q.id === "H4")!.answer, 100)).status).toBe(200);
    for (const c of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally"]) await mod(c);
    expect((await poll("tv")).state.results).toBeUndefined();

    // On to ⚖: every key answer and the liars, on the TV only.
    for (const c of ["trust_chart", "show_the_rankings", "trabolta_overshares", "y2k_clock"]) await mod(c);
    rt.tickOnce(3_600_000); // midnight
    await mod("bobbing_for_truth");
    await mod("brought_up_the_bag", { subject: pad.id, actor: "Clippy" });
    await mod("read_truth_txt");
    await mod("the_verdict");
    const tv = await poll("tv");
    const vd = tv.state.results!;
    expect(vd.kind).toBe("verdict");
    for (const q of vd.questions) expect(q.answer, q.id).toBe(FACTS.questions.find((k) => k.id === q.id)!.answer);
    const liarsOf = (id: string) => (vd.questions.find((q) => q.id === id)!.liars ?? []).map((l) => l[0]);
    expect(liarsOf("H1")).toEqual(["Winamp"]); // ruled not the same at 100
    expect(liarsOf("H2")).toEqual(["Calculator"]); // the house rule at the settle: a plain miss at 100
    expect(vd.questions.find((q) => q.id === "H1")!.truth).toBe("lie");
    const wallVd = await poll("auto");
    for (const q of wallVd.state.results!.questions) {
      expect(q.answer, q.id).toBeNull();
      expect(q, q.id).not.toHaveProperty("liars");
    }
    // The ending waits for the TV's pages.
    expect(rt.liveSim!.world.peek("Night.ended")).not.toMatchObject({ value: true });
    rt.tickOnce(34_000);
    expect(rt.liveSim!.world.peek("Night.phase")).toMatchObject({ value: "grok_prom" });

    // An agent request after ⚖ carries no key answer and no liar.
    expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "What now?" }, { token: pad.token })).status).toBe(200);
    const after = JSON.stringify(requests().at(-1)!);
    for (const a of KEY_ANSWERS) expect(after, a).not.toContain(a);
    expect(after).not.toMatch(/liar|"lied"/iu);
    rt.dispose();
  });

  it("a guest can't post into the hidden lobby; a room they can see still takes their line", async () => {
    const { rt, guests } = await showRuntime();
    const [calc] = guests as [Guest];
    const lobby = await call(rt, "POST", "/api/guest/say", { channel: "lobby", text: "hello lobby" }, { token: calc.token });
    expect(lobby.status).toBe(404);
    expect(lobby.json["error"]).toBe("no such room");
    const here = await call(rt, "POST", "/api/guest/say", { channel: "loc:The Desktop", text: "hello room" }, { token: calc.token });
    expect([200, 403]).toContain(here.status); // presence decides, never "no such room"
    expect(here.json["error"]).not.toBe("no such room");
    rt.dispose();
  });
});
