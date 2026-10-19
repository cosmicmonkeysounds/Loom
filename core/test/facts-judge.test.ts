//! The `judge:` character rules on near misses (wave 11b, contract J): the
//! story header names an agent-voiced CHARACTER; in `auto` mode a 📝 near
//! miss (wave 11, C6) is put to that character's worker as a `judge` frame
//! — never a `request`, never in the DM queue — and the worker's
//! `POST /api/agent/judge {id, worker, same, why}` is applied through the
//! same journaled confirm signal a director's Judging-card verdict fires,
//! `by: agent:<Character>`. A director's verdict first cancels the ruling
//! (410 for the late answer), a later one overrides it, and no answer
//! (no worker, expiry) leaves wave 11's fallback: pending, credited at the
//! settle. A replay rebuilds the ruling off the journal and never re-asks a
//! judged filing.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { AGENT_JUDGE_TIMEOUT_MS, AgentHub, agentThought, type AgentJudgeRequest, type AgentWorker } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime, nearNotice, rulingNotice } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { FactsView, ModView } from "../server/views.ts";
import { Workspace } from "../src/lsp/index.ts";
import { Sim } from "../src/runtime/sim/index.ts";

const CODES = { event: "EVT557", prime: "PRM557", mod: "MOD557" };

/** The facts-near story (a generic copy of the show's filing rules) with a
 *  `judge:` header naming an agent-voiced character. */
const story = (header: string) => `# Judge
start: Boot
${header}
set Night.judge_mode = "auto"

LOCATION Lobby
  label: The Lobby

GROUP Hosts
  joinable: false

CHANNEL hosts
  kind: faction
  faction: Hosts

ROLE Program
  v: text = "none"
  j: text = "none"
  q: text = "none"
  when someone joins:
    -> Deal
  when fact answered for program:
    set program.j = verdict
    set program.q = question
    do fact_filed {program} {question} {confidence} {verdict} {answer}
    if Night.judge_mode == "review":
      set program.v = "pending"
      broadcast "📝 {program.name} filed {question}: {answer}. Proposed: {verdict}." to channel(hosts)
    else:
      set program.v = verdict
      do fact_judged {program} {question} {verdict}
      broadcast "📝 {program.name} filed {question}: {answer}. Judged {verdict}." to channel(hosts)
  when fact_accurate for program:
    set program.v = "accurate"
    do fact_judged {program} {program.q} accurate
  when fact_lie for program:
    set program.v = "lie"
    do fact_judged {program} {program.q} lie
  when fact_uncertain for program:
    set program.v = "uncertain"
    do fact_judged {program} {program.q} uncertain
  when settle for program:
    if program.v == "pending":
      set program.v = program.j
      do fact_judged {program} {program.q} {program.v}

CHARACTER The Oracle
  listed: true
  mind: external

CHARACTER Clerk
  listed: true

== Boot
  setting: Lobby
Nothing yet.

== Deal
  setting: Lobby
show fact "File a fact" to program with thread: The Oracle, questions: "Q1: How many years? | Q2: Who is it?"
`;
const SOURCE = story("judge: The Oracle");

const FILE = {
  version: 1,
  questions: [
    { id: "Q1", round: 1, text: "How many years?", answer: "1997", accept: [] },
    { id: "Q2", round: 1, text: "Who is it?", answer: "Mister Pickles", accept: ["tabby"] },
  ],
  answers: [],
};
const TEXT = JSON.stringify(FILE);

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtimeIn(d: string, source = SOURCE, now?: () => number): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "judge", scenarioSource: source, joinBase: () => "http://localhost", factsFile: join(d, "no-such-facts.json"), facts: TEXT, ...(now !== undefined ? { now } : {}) });
}
function fresh(source = SOURCE, now?: () => number): { rt: EventRuntime; d: string } {
  const d = mkdtempSync(join(tmpdir(), "loom-facts-judge-"));
  dirs.push(d);
  const rt = runtimeIn(d, source, now);
  rt.openDoors();
  return { rt, d };
}

function fakeReq(body: unknown) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  const closers: Array<() => void> = [];
  const req = {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") closers.push(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
  return { req, close: () => closers.forEach((f) => f()) };
}
/** A response that also records SSE frames as `[event, data]`. */
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
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
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  const { req, close } = fakeReq(body);
  await rt.handle(req, res, method, url.pathname, url, moderator ? { moderator: true, moderatorName: "Ada" } : {});
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res, close };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, true);
const modView = async (rt: EventRuntime) => (await call(rt, "GET", "/api/state?role=mod", {}, true)).json as unknown as ModView;
const facts = async (rt: EventRuntime) => (await modView(rt)).facts as FactsView;

type Guest = { id: string; token: string };
async function guest(rt: EventRuntime, name: string): Promise<Guest> {
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
function file(rt: EventRuntime, g: Guest, question: string, answer: string, confidence: number) {
  const card = rt.chatHistoryFor(g.id).find((m) => m.kind === "widget" && m.widget?.kind === "fact")!;
  return call(rt, "POST", "/api/guest/widget", { token: g.token, seq: card.seq, result: { question, answer, confidence } });
}
const hostsLines = (rt: EventRuntime): string[] =>
  (rt as unknown as { chat: { all(): ChatMessage[] } }).chat
    .all()
    .filter((m) => m.channel === "room:hosts")
    .map((m) => m.text);
async function worker(rt: EventRuntime, characters = "The Oracle") {
  const w = await call(rt, "GET", `/api/agent/stream?characters=${encodeURIComponent(characters)}&name=laptop`, {}, true);
  const hello = w.res.frames().find(([e]) => e === "hello")![1] as { worker: string };
  return {
    id: hello.worker,
    close: w.close,
    frames: (kind: string) => w.res.frames().filter(([e]) => e === kind).map(([, d]) => d),
    judges: () => w.res.frames().filter(([e]) => e === "judge").map(([, d]) => d as AgentJudgeRequest),
  };
}
const filingOf = (v: FactsView, q: string, name: string) => v.questions.find((x) => x.id === q)!.filings.find((f) => f.name === name)!;

describe("the judge: header (model + lint L1206)", () => {
  const modelOf = (src: string) => Sim.fromSources(src).model;
  const lints = (src: string) => {
    const w = new Workspace();
    w.updateMany([["file:///main.loom", src]]);
    return (w.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === "L1206").map((d) => d.message);
  };
  it("names an agent-voiced CHARACTER by its canonical id (names fold); no key → null", () => {
    expect(modelOf(SOURCE).judge).toBe("The Oracle");
    expect(modelOf(story("judge: the oracle")).judge).toBe("The Oracle");
    expect(modelOf(story("")).judge).toBeNull();
    expect(lints(SOURCE)).toEqual([]);
    expect(lints(story(""))).toEqual([]);
  });
  it("a name that is no CHARACTER, or one no agent voices, is no judge, and says so", () => {
    expect(modelOf(story("judge: Nobody")).judge).toBeNull();
    expect(modelOf(story("judge: Clerk")).judge).toBeNull();
    expect(lints(story("judge: Nobody"))).toEqual([expect.stringMatching(/names no CHARACTER \(`Nobody`\)/u)]);
    expect(lints(story("judge: Clerk"))).toEqual([expect.stringMatching(/names Clerk, who is not `mind: external`/u)]);
  });
});

describe("AgentHub rulings", () => {
  const body = { character: "The Oracle", filing: { id: "g1:Q2", person: "g1", name: "Ada", question: "Q2" }, question: { id: "Q2", text: "Who?" }, key: { answer: "Mister Pickles", aliases: ["tabby"] }, answer: "Mr Pickels", confidence: 100 };
  const hub = (now: { t: number }, gone: string[] = []) => new AgentHub({ build: () => null, now: () => now.t, judgeGone: (r, why) => gone.push(`${r.id}:${why}`) });
  const workerOf = (id: string, sent: Array<[string, unknown]>, characters = ["The Oracle"]): AgentWorker => ({ id, name: id, characters: new Set(characters), send: (e, d) => sent.push([e, d]) });
  it("asks only an online worker voicing the judge, apart from the DM queue; a ruling is never queued", () => {
    const now = { t: 0 };
    const h = hub(now);
    expect(h.judge(body)).toBeNull(); // nobody online: never queued
    const sent: Array<[string, unknown]> = [];
    h.attach(workerOf("w1", sent, ["Somebody Else"]));
    expect(h.judge(body)).toBeNull();
    h.attach(workerOf("w2", sent));
    const id = h.judge(body)!;
    expect(id).toMatch(/^jr-/u);
    expect(sent.map(([e]) => e)).toEqual(["judge"]);
    expect(sent[0]![1]).toMatchObject({ ...body, id });
    expect(h.queue("The Oracle")).toEqual({ depth: 0, oldestMs: null, stalled: false });
    expect(h.pending).toEqual([]);
    expect(h.judging.map((j) => j.id)).toEqual([id]);
    expect(h.judgeSettle(id, "w1")).toBeNull(); // another worker's answer
    expect(h.judgeSettle(id, "w2")?.id).toBe(id);
    expect(h.judgeSettle(id, "w2")).toBeNull(); // answered already
  });
  it("expires after 60 s (a pause excluded), cancelling it on the worker; a leaving worker and a restart drop theirs", () => {
    const now = { t: 0 };
    const gone: string[] = [];
    const h = hub(now, gone);
    const sent: Array<[string, unknown]> = [];
    h.attach(workerOf("w", sent));
    const a = h.judge(body)!;
    now.t = 30_000;
    h.shift(30_000, 50_000); // a 20 s pause
    now.t = 50_000 + AGENT_JUDGE_TIMEOUT_MS - 30_000;
    h.sweep();
    expect(h.judging).toHaveLength(1);
    now.t += 1;
    h.sweep();
    expect(h.judging).toEqual([]);
    expect(sent.at(-1)).toEqual(["cancel", { id: a }]);
    expect(gone).toEqual([`${a}:expired`]);
    const b = h.judge(body)!;
    h.detach("w");
    expect(gone.at(-1)).toBe(`${b}:offline`);
    h.attach(workerOf("w3", sent));
    const c = h.judge(body)!;
    h.reset();
    expect(h.judging).toEqual([]);
    expect(sent.filter(([e, d]) => e === "cancel" && (d as { id: string }).id === c)).toHaveLength(1);
    const d = h.judge(body)!;
    expect(h.cancelJudge(d)).toBe(true);
    expect(h.cancelJudge(d)).toBe(false);
    expect(gone.at(-1)).toBe(`${d}:cancelled`);
  });
  it("a stalled worker never gets a ruling", () => {
    const now = { t: 0 };
    const sent: Array<[string, unknown]> = [];
    const h = new AgentHub({ build: (thread, id) => ({ id, character: thread.character, thread, speaker: { kind: "guest", id: "g", name: "G", faction: null }, text: "hi", history: [], self: { vars: {}, ranges: {}, codex: [] }, them: { vars: {}, codex: [], location: null }, world: {}, powers: [], at: 0 }), now: () => now.t });
    h.attach(workerOf("w", sent));
    h.line({ character: "The Oracle", channel: "dm:The Oracle", audience: ["g"] });
    now.t = 61_000;
    h.sweep(); // the head unanswered past the stall
    expect(h.queue("The Oracle").stalled).toBe(true);
    expect(h.canJudge("The Oracle")).toBe(false);
    expect(h.judge(body)).toBeNull();
  });
  it("a worker's judge thought is accepted for the Mind page", () => {
    expect(agentThought({ id: "th-j", character: "The Oracle", kind: "judge" }, "laptop")?.kind).toBe("judge");
  });
});

describe("the event — the judge character rules on near misses", () => {
  it("a near miss in auto mode goes to the judge's worker as a judge frame, never a request; the # hosts line says so; the card shows asking", async () => {
    const { rt } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    expect((await file(rt, ada, "Q2", "Mr Pickels", 100)).status).toBe(200);
    const judges = w.judges();
    expect(judges).toHaveLength(1);
    expect(judges[0]).toMatchObject({
      character: "The Oracle",
      filing: { id: `${ada.id}:Q2`, person: ada.id, name: "Ada", question: "Q2" },
      question: { id: "Q2", text: "Who is it?" },
      key: { answer: "Mister Pickles", aliases: ["tabby"] },
      answer: "Mr Pickels",
      confidence: 100,
    });
    expect(w.frames("request")).toEqual([]);
    expect(hostsLines(rt)).toEqual(["📝 Ada filed Q2: Mr Pickels. Proposed: accurate.", nearNotice("Ada", { question: "Q2", answer: "Mr Pickels" }, "Mister Pickles", "The Oracle")]);
    expect(hostsLines(rt)[1]).toMatch(/^⚠ Near miss, not an exact match: .* — asked The Oracle to rule\./u);
    const view = await modView(rt);
    expect(view.facts!.judge).toBe("The Oracle");
    expect(filingOf(view.facts!, "Q2", "Ada")).toMatchObject({ final: null, asking: true, near: { key: "Mister Pickles" } });
    expect(view.cast.find((c) => c.id === "The Oracle")?.agentQueue).toMatchObject({ depth: 0 });
    // Exact hits and clear misses are never put to the judge.
    const ben = await guest(rt, "Ben");
    expect((await file(rt, ben, "Q1", "1996", 100)).status).toBe(200);
    expect(w.judges()).toHaveLength(1);
    rt.dispose();
  });

  it("same → accurate through the confirm signal by agent:<Character>, the ruling on the filing, one 🤖 line; a second answer is 410", async () => {
    const { rt, d } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    const [j] = w.judges();
    expect((await call(rt, "POST", "/api/agent/judge", { id: j!.id, worker: w.id, same: true, why: "x" })).status).toBe(403);
    expect((await mod(rt, "/api/agent/judge", { id: j!.id, worker: w.id, same: "yes" })).status).toBe(400);
    const r = await mod(rt, "/api/agent/judge", { id: j!.id, worker: w.id, same: true, why: "  A typo of the cat's name.  " });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, verdict: "accurate" });
    expect(rt.liveSim!.world.peek(`${ada.id}.v`)).toEqual({ kind: "string", value: "accurate" });
    const f = filingOf(await facts(rt), "Q2", "Ada");
    expect(f).toMatchObject({ final: "accurate", how: "confirmed", by: "The Oracle", ruling: { by: "The Oracle", same: true, why: "A typo of the cat's name." } });
    expect(f.asking).toBeUndefined();
    expect(hostsLines(rt).at(-1)).toBe('🤖 The Oracle ruled Ada\'s Q2 filing "Mr Pickels": the same as "Mister Pickles" (accurate). A typo of the cat\'s name.');
    expect(hostsLines(rt).at(-1)).toBe(rulingNotice("The Oracle", "Ada", "Q2", "Mr Pickels", "Mister Pickles", true, "accurate", "A typo of the cat's name."));
    // The same journaled path as a director's verdict, named for the agent.
    const journal = new Store(d).readJournal();
    const ruled = journal.find((e) => e.m === "signal" && e.a[0] === "fact_accurate")!;
    expect([ruled.a[1], ruled.a[2], ruled.by]).toEqual([ada.id, { question: "Q2", ruling: "same", ruling_why: "A typo of the cat's name." }, "agent:The Oracle"]);
    expect((await mod(rt, "/api/agent/judge", { id: j!.id, worker: w.id, same: true, why: "" })).status).toBe(410);
    rt.dispose();
  });

  it("not the same → a lie at confidence 100, uncertain below; the why is cut to 200 characters", async () => {
    const { rt } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    await file(rt, ben, "Q1", "1,997", 60);
    const [a, b] = w.judges();
    expect((await mod(rt, "/api/agent/judge", { id: a!.id, worker: w.id, same: false, why: "x".repeat(300) })).json).toEqual({ ok: true, verdict: "lie" });
    expect((await mod(rt, "/api/agent/judge", { id: b!.id, worker: w.id, same: false, why: "A different year." })).json).toEqual({ ok: true, verdict: "uncertain" });
    const v = await facts(rt);
    expect(filingOf(v, "Q2", "Ada")).toMatchObject({ final: "lie", how: "overridden", ruling: { same: false } });
    expect(filingOf(v, "Q2", "Ada").ruling!.why).toHaveLength(200);
    expect(filingOf(v, "Q1", "Ben")).toMatchObject({ final: "uncertain", how: "overridden", ruling: { same: false, why: "A different year." } });
    expect(hostsLines(rt).at(-1)).toBe('🤖 The Oracle ruled Ben\'s Q1 filing "1,997": not "1997" (uncertain). A different year.');
    rt.dispose();
  });

  it("a director's verdict first cancels the ruling (its late answer 410); a director's verdict after it wins, the ruling kept", async () => {
    const { rt } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    await file(rt, ben, "Q2", "Mrs Pickles", 100);
    const [a, b] = w.judges();
    expect((await mod(rt, "/api/mod/signal", { name: "fact_lie", subject: ada.id, args: { question: "Q2" } })).status).toBe(200);
    expect(w.frames("cancel")).toEqual([{ id: a!.id }]);
    expect((await mod(rt, "/api/agent/judge", { id: a!.id, worker: w.id, same: true, why: "late" })).status).toBe(410);
    expect(filingOf(await facts(rt), "Q2", "Ada")).toMatchObject({ final: "lie", how: "overridden", by: "Ada" });
    expect(filingOf(await facts(rt), "Q2", "Ada").ruling).toBeUndefined();
    expect(hostsLines(rt).some((l) => l.startsWith("🤖"))).toBe(false);
    // Ben: ruled the same, then a director overrides to a lie.
    expect((await mod(rt, "/api/agent/judge", { id: b!.id, worker: w.id, same: true, why: "Close enough." })).status).toBe(200);
    expect((await mod(rt, "/api/mod/signal", { name: "fact_lie", subject: ben.id, args: { question: "Q2" } })).status).toBe(200);
    expect(filingOf(await facts(rt), "Q2", "Ben")).toMatchObject({ final: "lie", how: "overridden", by: "Ada", ruling: { by: "The Oracle", same: true, why: "Close enough." } });
    rt.dispose();
  });

  it("filed again with another answer, the open ruling is cancelled; the new near miss is asked afresh", async () => {
    const { rt } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    const [a] = w.judges();
    // The story files again for the same question (the story's own rule,
    // straight on the sim — the generic story deals one card per guest).
    rt.liveSim!.signal("fact answered", ada.id, { question: "Q2", answer: "Mister Pickels", confidence: 100, verdict: "accurate" });
    await mod(rt, "/api/mod/broadcast", { scope: "channel(hosts)", cue: "nudge" }); // any fanout looks again
    expect(w.frames("cancel")).toEqual([{ id: a!.id }]);
    expect((await mod(rt, "/api/agent/judge", { id: a!.id, worker: w.id, same: true })).status).toBe(410);
    rt.dispose();
  });

  it("no worker online: wave 11's wording and fallback — a worker that connects later is never asked, the filing settles accurate", async () => {
    const { rt } = fresh();
    const ada = await guest(rt, "Ada");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    expect(hostsLines(rt)[1]).toBe(nearNotice("Ada", { question: "Q2", answer: "Mr Pickels" }, "Mister Pickles"));
    expect(hostsLines(rt)[1]).toMatch(/is credited if nobody judges it\. Judge it on Run → Mind → Judging\.$/u);
    expect(filingOf(await facts(rt), "Q2", "Ada").asking).toBeUndefined();
    const w = await worker(rt);
    for (let i = 0; i < 3; i++) rt.tickOnce(1000);
    // # hosts was promised the credit: no late ruling may turn it into a lie.
    expect(w.judges()).toEqual([]);
    expect(filingOf(await facts(rt), "Q2", "Ada").asking).toBeUndefined();
    expect(hostsLines(rt).some((l) => l.startsWith("🤖"))).toBe(false);
    expect((await mod(rt, "/api/mod/signal", { name: "settle", subject: ada.id })).status).toBe(200);
    expect(filingOf(await facts(rt), "Q2", "Ada").final).toBe("accurate");
    // A near miss filed once the worker is online is still asked.
    const ben = await guest(rt, "Ben");
    await file(rt, ben, "Q2", "Mister Pickels", 100);
    expect(w.judges().map((j) => j.filing.person)).toEqual([ben.id]);
    rt.dispose();
  });

  it("no answer in 60 s: the ruling expires (cancelled on the worker), the filing stays pending and settles accurate as in wave 11", async () => {
    const clock = { t: 1_000_000 };
    const { rt } = fresh(SOURCE, () => clock.t);
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    const [a] = w.judges();
    for (let i = 0; i < 62; i++) {
      clock.t += 1000;
      rt.tickOnce(1000);
    }
    expect(w.frames("cancel")).toContainEqual({ id: a!.id });
    expect(w.judges()).toHaveLength(1); // never asked twice
    const f = filingOf(await facts(rt), "Q2", "Ada");
    expect([f.final, f.asking]).toEqual([null, undefined]);
    expect((await mod(rt, "/api/agent/judge", { id: a!.id, worker: w.id, same: false })).status).toBe(410);
    expect((await mod(rt, "/api/mod/signal", { name: "settle", subject: ada.id })).status).toBe(200);
    expect(filingOf(await facts(rt), "Q2", "Ada").final).toBe("accurate");
    rt.dispose();
  });

  it("review mode, or a story with no judge: nothing is put to a worker", async () => {
    for (const source of [SOURCE, story("")]) {
      const { rt } = fresh(source);
      const w = await worker(rt);
      if (source === SOURCE) expect((await mod(rt, "/api/mod/var", { path: "Night.judge_mode", value: "review" })).status).toBe(200);
      const ada = await guest(rt, "Ada");
      await file(rt, ada, "Q2", "Mr Pickels", 100);
      for (let i = 0; i < 3; i++) rt.tickOnce(1000);
      expect(w.judges()).toEqual([]);
      if (source !== SOURCE) expect((await facts(rt)).judge).toBeUndefined();
      rt.dispose();
    }
  });

  it("a restart replays the ruling off the journal and never re-asks a judged filing; a near miss still pending is asked again", async () => {
    const { rt, d } = fresh();
    const w = await worker(rt);
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    await file(rt, ada, "Q2", "Mr Pickels", 100);
    await file(rt, ben, "Q2", "Mister Pickels", 100);
    const [a] = w.judges();
    expect((await mod(rt, "/api/agent/judge", { id: a!.id, worker: w.id, same: true, why: "A typo." })).status).toBe(200);
    const before = await facts(rt);
    rt.dispose();
    const again = runtimeIn(d);
    expect(again.restore()).not.toBeNull();
    const after = await facts(again);
    expect(filingOf(after, "Q2", "Ada")).toMatchObject({ final: "accurate", how: "confirmed", by: "The Oracle", ruling: { by: "The Oracle", same: true, why: "A typo." } });
    expect(filingOf(after, "Q2", "Ben").final).toBeNull();
    expect(filingOf(before, "Q2", "Ada").final).toBe("accurate");
    const w2 = await worker(again);
    expect(w2.judges().map((j) => j.filing.person)).toEqual([ben.id]);
    again.dispose();
  });
});
