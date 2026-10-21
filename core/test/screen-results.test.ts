//! Wave 18b (Q6, R3, O2, O4): the results block on `/api/screen/state`.
//! The story publishes what has been read (`do fact_read …`) and the
//! verdict (`do fact_truth …`); the server builds the block off the facts
//! ledger (`FactsWatch` → `screenResultsOf`), never `Night.*`:
//! - before ⚖ only what is public — who filed, what they said, sure or not,
//!   accepted / guess / not counted, and Trabolta's stamp (D10, D11);
//! - a reading's rows are the TV's only, and only while its slide is up;
//! - at ⚖ (O2) the TV carries every question's key answer and the names of
//!   the programs who lied; a wall the truths and the counts only;
//! - nothing of it rides an agent request or `/api/agent/facts`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import type { AgentJudgeRequest } from "../server/agents.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { MAX_RESULT_ROWS, screenOutcome, screenRuled, type FactsFiling } from "../server/facts.ts";
import { MAX_VOICE_BLOCK, MAX_VOICE_TEXT, RESULTS_VERDICT_MS, resultIdsOf, truthStatusOf, voiceLinesOf, type ScreenResults, type ScreenState } from "../server/routes/screen.ts";
import type { ChatMessage } from "../server/chat.ts";
import { Store } from "../server/store.ts";

const CODES = { event: "EVT818", prime: "PRM818", mod: "MOD818" };

/** A made-up key (nothing from the show): three questions, two rounds. */
const FACTS = JSON.stringify({
  version: 1,
  questions: [
    { id: "Q1", round: 1, text: "How many rubber ducks?", answer: "seven", accept: ["7"] },
    { id: "Q2", round: 2, text: "Who is the cat?", answer: "Mister Pickles", accept: ["the tabby"] },
    { id: "Q3", round: 2, text: "What colour is the door?", answer: "teal", accept: [] },
  ],
  answers: [],
});

const LONG_CUE = "a_rather_long_admin_cue_for_the_moment_ring";

const SOURCE = `# Results
start: Boot
judge: The Oracle
set Night.judge_mode = "auto"

LOCATION The Desktop
  label: The Desktop

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
    else:
      set program.v = verdict
      do fact_judged {program} {question} {verdict}
    show fact "File another" to program with thread: The Oracle, questions: "Q1: Ducks? | Q2: The cat? | Q3: The door?"
  when fact_accurate for program:
    set program.v = "accurate"
    do fact_judged {program} {program.q} accurate
  when fact_lie for program:
    set program.v = "lie"
    do fact_judged {program} {program.q} lie
  when fact_uncertain for program:
    set program.v = "uncertain"
    do fact_judged {program} {program.q} uncertain

CHARACTER The Oracle
  listed: true
  mind: external

INTERACTION read_one
  who: admin
INTERACTION read_two
  who: admin
INTERACTION the_verdict
  who: admin
INTERACTION review_mode
  who: admin
  sequence: false
INTERACTION ${LONG_CUE}
  who: admin
  sequence: false

when read_one:
  cue screens_hunt_results
  do fact_read Q1

when read_two:
  cue screens_tally
  do fact_read Q2 Q3

when the_verdict:
  cue tv_truth_txt
  do fact_truth Q1 accurate
  do fact_truth Q2 lie
  do fact_truth Q3 none

when review_mode:
  set Night.judge_mode = "review"

== Boot
  setting: The Desktop
Nothing yet.

== Deal
  setting: The Desktop
show fact "File a fact" to program with thread: The Oracle, questions: "Q1: Ducks? | Q2: The cat? | Q3: The door?"
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtimeIn(d: string, clock: { t: number }): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "results", scenarioSource: SOURCE, joinBase: () => "http://localhost", factsFile: join(d, "none.json"), facts: FACTS, now: () => clock.t, limits: { register: { max: 1000, windowMs: 60_000 }, widgets: { max: 1000, windowMs: 60_000 } } });
}
function fresh(): { rt: EventRuntime; d: string; clock: { t: number } } {
  const d = mkdtempSync(join(tmpdir(), "loom-results-"));
  dirs.push(d);
  const clock = { t: 5_000_000 };
  const rt = runtimeIn(d, clock);
  rt.openDoors();
  return { rt, d, clock };
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
function fakeRes() {
  let buf = "";
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
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
  return { status: res.statusCode, json, res, close, body: res.body };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, true);
const cue = (rt: EventRuntime, name: string) => mod(rt, "/api/mod/signal", { name });
type Guest = { id: string; token: string; name: string };
async function guest(rt: EventRuntime, name: string): Promise<Guest> {
  const r = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string, name };
}
function file(rt: EventRuntime, g: Guest, question: string, answer: string, confidence: number) {
  const card = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact").at(-1)!;
  return call(rt, "POST", "/api/guest/widget", { token: g.token, seq: card.seq, result: { question, answer, confidence } });
}
async function poll(rt: EventRuntime, view: "tv" | "auto"): Promise<{ state: ScreenState; body: string }> {
  const name = view === "tv" ? "TV" : "Kitchen";
  const r = await call(rt, "GET", `/api/screen/state?name=${name}&view=${view}`, {}, true);
  return { state: r.json as unknown as ScreenState, body: r.body };
}
async function worker(rt: EventRuntime) {
  const w = await call(rt, "GET", `/api/agent/stream?characters=${encodeURIComponent("The Oracle")}&name=laptop`, {}, true);
  const hello = w.res.frames().find(([e]) => e === "hello")![1] as { worker: string };
  return { id: hello.worker, close: w.close, judges: () => w.res.frames().filter(([e]) => e === "judge").map(([, d]) => d as AgentJudgeRequest) };
}

describe("the pure pieces", () => {
  it("reads the directives' args", () => {
    expect(resultIdsOf("Q1 Q2,Q3  Q1")).toEqual(["Q1", "Q2", "Q3"]);
    expect(resultIdsOf("")).toEqual([]);
    expect(["accurate", "true", "TRUE", "lie", "none", "", "pending"].map(truthStatusOf)).toEqual(["true", "true", "true", "lie", "none", "none", "none"]);
  });

  it("maps a filing to its public outcome and his stamp", () => {
    const f = (o: Partial<FactsFiling>): FactsFiling => ({ person: "g", name: "G", question: "Q1", answer: "x", confidence: 80, verdict: "uncertain", final: null, how: null, by: null, at: 0, ...o });
    expect(screenOutcome(f({ final: "accurate" }))).toBe("a");
    expect(screenOutcome(f({ final: "lie", verdict: "lie" }))).toBe("a");
    expect(screenOutcome(f({ final: "uncertain" }))).toBe("g");
    expect(screenOutcome(f({ final: "marked", verdict: "uncertain" }))).toBe("g");
    expect(screenOutcome(f({ final: "marked", verdict: "lie" }))).toBe("u");
    expect(screenOutcome(f({ final: null }))).toBe("p");
    const ruling = { by: "The Oracle", same: true, why: "spelling", at: 0 };
    expect(screenRuled(f({ final: "accurate", how: "auto" }))).toBe("");
    expect(screenRuled(f({ final: null, asking: true }))).toBe("?");
    expect(screenRuled(f({ final: null, asking: true, queued: true }))).toBe("?");
    expect(screenRuled(f({ final: "accurate", by: "The Oracle", ruling }))).toBe("s");
    expect(screenRuled(f({ final: "uncertain", by: "The Oracle", ruling: { ...ruling, same: false } }))).toBe("n");
    expect(screenRuled(f({ final: "lie", confidence: 100, by: "The Oracle", ruling: { ...ruling, same: false } }))).toBe("r");
    expect(screenRuled(f({ final: "accurate", confidence: 100, by: "The Oracle", ruling }))).toBe("r");
    // A director's later verdict: his ruling no longer stands on the screen.
    expect(screenRuled(f({ final: "lie", by: "Ada", ruling }))).toBe("");
  });

  it("a voice answer carries long lines and drops the oldest past the block cap", () => {
    const line = (seq: number, n: number): ChatMessage => ({ seq, channel: "loc:The Desktop", channelKind: "location", title: "The Desktop", from: "Trabolta", kind: "line", text: "x".repeat(n), ts: 0, audience: "all", parentSeq: null, hidden: false }) as unknown as ChatMessage;
    const one = voiceLinesOf([line(1, 5000)], "loc:The Desktop", 0, () => true);
    expect(one.lines[0]!.text).toHaveLength(MAX_VOICE_TEXT);
    const many = voiceLinesOf([1, 2, 3, 4, 5, 6].map((s) => line(s, 3900)), "loc:The Desktop", 0, () => true);
    expect(many.lines.map((l) => l.seq)).toEqual([3, 4, 5, 6]);
    expect(many.lines.reduce((n, l) => n + l.text.length, 0)).toBeLessThanOrEqual(MAX_VOICE_BLOCK);
  });
});

describe("the results block", () => {
  it("nothing before a read; a read shows only its ids, rows on the TV only, while its slide is up", async () => {
    const { rt } = fresh();
    const a = await guest(rt, "Winamp");
    const b = await guest(rt, "Excel");
    await file(rt, a, "Q1", "seven", 100);
    await file(rt, b, "Q1", "six", 80);
    await file(rt, a, "Q2", "Mister Pickles", 100);
    expect((await poll(rt, "tv")).state.results).toBeUndefined();
    await cue(rt, "read_one");
    const tv = (await poll(rt, "tv")).state.results!;
    expect(tv).toMatchObject({ kind: "read" });
    expect(tv.at).toBeGreaterThan(0);
    expect(tv.questions).toEqual([
      {
        id: "Q1",
        n: 1,
        round: 1,
        text: "How many rubber ducks?",
        filed: 2,
        accepted: 1,
        guesses: 1,
        uncounted: 0,
        consensus: false,
        answer: null,
        rows: [
          ["Winamp", "seven", 1, "a", ""],
          ["Excel", "six", 0, "g", ""],
        ],
      },
    ]);
    const wall = (await poll(rt, "auto")).state.results!;
    expect(wall.questions[0]).not.toHaveProperty("rows");
    expect(wall.questions[0]).toMatchObject({ filed: 2, accepted: 1, guesses: 1 });
    // The wire never tells accurate from a confident lie.
    for (const body of [(await poll(rt, "tv")).body, (await poll(rt, "auto")).body]) {
      const block = JSON.stringify(JSON.parse(body).results);
      expect(block).not.toMatch(/accurate|"lie"|verdict|confidence|why|near/u);
    }
    // The slide moves on: the block is gone.
    await mod(rt, "/api/mod/signal", { name: "review_mode" });
    await cue(rt, "read_two");
    const two = (await poll(rt, "tv")).state.results!;
    expect(two.questions.map((q) => q.id)).toEqual(["Q2", "Q3"]);
    expect(two.seq).toBeGreaterThan(tv.seq);
  });

  it("a consensus read names the key's answer", async () => {
    const { rt } = fresh();
    const a = await guest(rt, "Winamp");
    const b = await guest(rt, "Excel");
    await file(rt, a, "Q1", "7", 100);
    await file(rt, b, "Q1", "seven", 100);
    await cue(rt, "read_one");
    expect((await poll(rt, "tv")).state.results!.questions[0]).toMatchObject({ consensus: true, answer: "seven" });
    expect((await poll(rt, "auto")).state.results!.questions[0]).toMatchObject({ consensus: true, answer: "seven" });
  });

  it("his stamps: ? while asking, s / n below 100, r at 100, nothing for an exact match", async () => {
    const { rt } = fresh();
    const w = await worker(rt);
    const a = await guest(rt, "Winamp");
    const b = await guest(rt, "Excel");
    const c = await guest(rt, "Paint");
    await file(rt, a, "Q2", "Mr Pickels", 80); // a near miss: asked
    await file(rt, b, "Q2", "Mister Pickels", 100); // a near miss at 100: asked
    await file(rt, c, "Q2", "Mister Pickles", 100); // exact
    await cue(rt, "read_two");
    const stamps = () => poll(rt, "tv").then((p) => p.state.results!.questions[0]!.rows!.map((r) => [r[0], r[3], r[4]]));
    expect(await stamps()).toEqual([
      ["Winamp", "p", "?"],
      ["Excel", "p", "?"],
      ["Paint", "a", ""],
    ]);
    // One ruling out at a time (the judge queue): answer them in turn.
    const [ja] = w.judges();
    expect((await call(rt, "POST", "/api/agent/judge", { id: ja!.id, worker: w.id, same: false, why: "" }, true)).status).toBe(200);
    const jb = w.judges()[1];
    expect((await call(rt, "POST", "/api/agent/judge", { id: jb!.id, worker: w.id, same: false, why: "" }, true)).status).toBe(200);
    expect(await stamps()).toEqual([
      ["Winamp", "g", "n"],
      ["Excel", "a", "r"], // a confident lie, held until the verdict
      ["Paint", "a", ""],
    ]);
    w.close();
  });

  it("the verdict (O2): every key answer and the liars on the TV, the truths and counts on a wall, for its window only", async () => {
    const { rt, clock } = fresh();
    const [a, b, c, d, e] = await Promise.all(["Winamp", "Excel", "Paint", "Word", "Doom"].map((n) => guest(rt, n)));
    // Nobody to rule yet: the house judges these at once.
    await file(rt, a!, "Q1", "seven", 100); // accurate
    await file(rt, b!, "Q1", "eight", 100); // the house's lie
    await file(rt, c!, "Q1", "six", 70); // a guess: never a liar
    const w = await worker(rt);
    await file(rt, d!, "Q2", "Mister Pickels", 100); // near miss: his ruling's lie
    const [j] = w.judges();
    await call(rt, "POST", "/api/agent/judge", { id: j!.id, worker: w.id, same: false, why: "" }, true);
    await file(rt, e!, "Q2", "Mister Pickles", 100); // accurate, then a director's lie
    await mod(rt, "/api/mod/signal", { name: "fact_lie", subject: e!.id, args: { question: "Q2" } });
    await mod(rt, "/api/mod/signal", { name: "review_mode" });
    await file(rt, c!, "Q3", "red", 100); // pending, proposed a lie
    // Before ⚖ nothing names a liar or an answer beyond consensus.
    await cue(rt, "read_two");
    const before = (await poll(rt, "tv")).state.results!;
    expect(before.kind).toBe("read");
    expect(before.questions.every((q) => q.answer === null && q.liars === undefined)).toBe(true);
    const agentFacts = async () => {
      const { at: _at, ...rest } = (await call(rt, "GET", "/api/agent/facts", {}, true)).json;
      return JSON.stringify(rest);
    };
    const facts0 = await agentFacts();
    await cue(rt, "the_verdict");
    const tv = (await poll(rt, "tv")).state.results!;
    expect(tv.kind).toBe("verdict");
    expect(tv.questions).toEqual([
      { id: "Q1", n: 1, round: 1, filed: 3, accepted: 2, guesses: 1, uncounted: 0, consensus: false, answer: "seven", truth: "true", liars: [["Excel", 0]] },
      { id: "Q2", n: 2, round: 2, filed: 2, accepted: 2, guesses: 0, uncounted: 0, consensus: false, answer: "Mister Pickles", truth: "lie", liars: [["Word", 1], ["Doom", 0]] },
      { id: "Q3", n: 3, round: 2, filed: 1, accepted: 0, guesses: 0, uncounted: 0, consensus: false, answer: "teal", truth: "none", liars: [["Paint", 0]] },
    ]);
    const wall = (await poll(rt, "auto")).state.results!;
    expect(wall.kind).toBe("verdict");
    for (const q of wall.questions) {
      expect(q.answer).toBeNull();
      expect(q).not.toHaveProperty("liars");
      expect(q).not.toHaveProperty("rows");
    }
    expect(wall.questions.map((q) => q.truth)).toEqual(["true", "lie", "none"]);
    // Nothing of it reaches the agent's facts.
    const facts1 = await agentFacts();
    expect(facts1).toBe(facts0);
    expect(facts1).not.toMatch(/Mister Pickles|teal|"seven"/u);
    // The window closes.
    clock.t += RESULTS_VERDICT_MS;
    expect((await poll(rt, "tv")).state.results).toBeUndefined();
    w.close();
  });

  it("a restart replays the log: a reading still up is history (at 0), the verdict's window is shut", async () => {
    const { rt, d, clock } = fresh();
    const a = await guest(rt, "Winamp");
    await file(rt, a, "Q1", "seven", 100);
    await cue(rt, "read_one");
    expect((await poll(rt, "tv")).state.results!.at).toBeGreaterThan(0);
    rt.dispose();
    const back = runtimeIn(d, clock);
    back.restore();
    const again = (await poll(back, "tv")).state.results!;
    expect(again).toMatchObject({ kind: "read", at: 0 });
    expect(again.questions[0]!.rows).toEqual([["Winamp", "seven", 1, "a", ""]]);
    await cue(back, "the_verdict");
    expect((await poll(back, "tv")).state.results!.kind).toBe("verdict");
    back.dispose();
    const third = runtimeIn(d, clock);
    third.restore();
    expect((await poll(third, "tv")).state.results).toBeUndefined();
    third.dispose();
  });

  it("sizes: walls round 2 with 45 filers + a full ring < 4 KB, the TV at the row cap < 12 KB, the TV verdict at the name cap < 12 KB", async () => {
    const { rt } = fresh();
    const guests: Guest[] = [];
    for (let i = 0; i < 45; i++) guests.push(await guest(rt, `Program With A Long Name ${String(i).padStart(2, "0")}`));
    for (const g of guests) for (const q of ["Q2", "Q3"]) await file(rt, g, q, "an answer of forty characters, near enough ok", 100);
    for (let i = 0; i < 12; i++) await cue(rt, LONG_CUE);
    await cue(rt, "read_two");
    const wall = await poll(rt, "auto");
    expect(wall.state.moments).toHaveLength(12);
    expect(wall.body.length).toBeLessThan(4096);
    const tv = await poll(rt, "tv");
    expect(tv.state.results!.questions[0]!.rows).toHaveLength(MAX_RESULT_ROWS);
    expect(tv.state.results!.questions[0]!.more).toBe(5);
    expect(tv.body.length).toBeLessThan(12_288);
    await cue(rt, "the_verdict");
    const verdict = await poll(rt, "tv");
    const v = verdict.state.results as ScreenResults;
    expect(v.questions[1]!.liars).toHaveLength(MAX_RESULT_ROWS);
    expect(v.questions[1]!.liarsMore).toBe(5);
    expect(verdict.body.length).toBeLessThan(12_288);
    expect((await poll(rt, "auto")).body.length).toBeLessThan(4096);
  });
});
