//! Near-miss judging (wave 11, C6; `server/facts.ts` `judgeFiling` +
//! `EventRuntime.commitUnderReview`): a 📝 filing close to the key (`Mr
//! Pickels`) is never judged a lie or a guess by itself. It is proposed
//! accurate and, in `auto` mode too, takes the story's review path for that
//! one filing — pending on Run → Mind → Judging with `near: {key}`, one
//! `# hosts` line from the story — while exact hits and clear misses stay
//! automatic. A director decides it like any pending verdict; left alone,
//! a settle takes the proposal.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it, vi } from "vitest";

import type { ChatMessage } from "../server/chat.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { nearMatch } from "../src/answer-match.ts";
import { FactsWatch, bookOf, judgeFiling, nearKey } from "../server/facts.ts";
import { Store } from "../server/store.ts";
import type { FactsView } from "../server/views.ts";
import { validateFacts, type FactsFile } from "../src/facts.ts";

// A pass-through spy, so a test can count the near-miss look's work.
vi.mock("../src/answer-match.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/answer-match.ts")>();
  return { ...real, nearMatch: vi.fn(real.nearMatch) };
});

const CODES = { event: "EVT555", prime: "PRM555", mod: "MOD555" };

/** A generic story shaped like the show's filing rules: the mode var decides
 *  at filing whether the verdict stands or waits; the confirm events and a
 *  settle decide a pending one. */
const SOURCE = `# Near
start: Boot
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
  when settle for program:
    if program.v == "pending":
      set program.v = program.j
      do fact_judged {program} {program.q} {program.v}

CHARACTER The Oracle
  listed: true

== Boot
  setting: Lobby
Nothing yet.

== Deal
  setting: Lobby
show fact "File a fact" to program with thread: The Oracle, questions: "Q1: How many years? | Q2: Who is it?"
`;

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
function runtimeIn(d: string): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "near",
    scenarioSource: SOURCE,
    joinBase: () => "http://localhost",
    factsFile: join(d, "no-such-facts.json"),
    facts: TEXT,
  });
}
function fresh(): { rt: EventRuntime; d: string } {
  const d = mkdtempSync(join(tmpdir(), "loom-facts-near-"));
  dirs.push(d);
  const rt = runtimeIn(d);
  rt.openDoors();
  return { rt, d };
}

function fakeReq(body: unknown): IncomingMessage {
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
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
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
  return res as unknown as ServerResponse & { statusCode: number; body: string };
}
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, moderator = false) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body), res, method, url.pathname, url, moderator ? { moderator: true, moderatorName: "Ada" } : {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, true);
const facts = async (rt: EventRuntime) => ((await call(rt, "GET", "/api/state?role=mod", {}, true)).json as { facts?: FactsView }).facts!;

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
const mode = (rt: EventRuntime) => rt.liveSim!.world.peek("Night.judge_mode");
const rows = (v: FactsView) => v.questions.flatMap((q) => q.filings.map((f) => [f.name, q.id, f.answer, f.verdict, f.final, f.near?.key ?? null]));

describe("judgeFiling — the pure judge", () => {
  const v = validateFacts(FILE);
  if (!v.ok) throw new Error("bad fixture");
  const book = bookOf(v.facts as FactsFile);
  it("a near miss is proposed accurate with the key form it is near; exact and far are as before", () => {
    expect(judgeFiling(book, "Q2", "Mr Pickels", 100)).toEqual({ verdict: "accurate", near: "Mister Pickles", ask: true });
    expect(judgeFiling(book, "Q2", "Mr Pickels", 40)).toEqual({ verdict: "accurate", near: "Mister Pickles", ask: true });
    expect(judgeFiling(book, "Q2", "tabbby", 100)).toEqual({ verdict: "accurate", near: "tabby", ask: true });
    expect(judgeFiling(book, "Q1", "1,997", 100)).toEqual({ verdict: "accurate", near: "1997", ask: true });
    expect(judgeFiling(book, "Q2", "Mister Pickles", 100)).toEqual({ verdict: "accurate", near: null, ask: false });
    expect(judgeFiling(book, "Q2", "Mister Whiskers", 100)).toEqual({ verdict: "lie", near: null, ask: true });
    expect(judgeFiling(book, "Q1", "1996", 100)).toEqual({ verdict: "lie", near: null, ask: true });
    expect(judgeFiling(book, "Q1", "1996", 99)).toEqual({ verdict: "uncertain", near: null, ask: true });
    expect(judgeFiling(book, "Q9", "x", 100)).toBeNull();
    expect(nearKey(book, "Q2", "the mister pickles")).toBeNull(); // exact after folding
  });

  it("FactsWatch memoises the near look per book: every mod view would redo it", () => {
    const watch = new FactsWatch();
    const spy = vi.mocked(nearMatch);
    spy.mockClear();
    expect(watch.nearOf(book, "Q2", "Mr Pickels")).toBe("Mister Pickles");
    expect(watch.nearOf(book, "Q2", "Mister Whiskers")).toBeNull();
    const once = spy.mock.calls.length;
    expect(once).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      expect(watch.nearOf(book, "Q2", "Mr Pickels")).toBe("Mister Pickles");
      expect(watch.nearOf(book, "Q2", "Mister Whiskers")).toBeNull();
    }
    expect(spy.mock.calls.length).toBe(once);
    // Another book (a reload) looks again.
    expect(watch.nearOf(bookOf(v.facts as FactsFile), "Q2", "Mr Pickels")).toBe("Mister Pickles");
    expect(spy.mock.calls.length).toBeGreaterThan(once);
  });
});

describe("near misses on the event — auto mode routes them to review", () => {
  it("a near miss at confidence 100 is pending with near, the mode var is put back, one # hosts line; exact and far stay automatic", async () => {
    const { rt, d } = fresh();
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    const cy = await guest(rt, "Cy");
    expect((await file(rt, ada, "Q2", "Mr Pickels", 100)).status).toBe(200);
    expect((await file(rt, ben, "Q2", "Mister Pickles", 100)).status).toBe(200);
    expect((await file(rt, cy, "Q1", "1996", 100)).status).toBe(200);
    const v = await facts(rt);
    expect(v.mode).toBe("auto");
    expect(mode(rt)).toEqual({ kind: "string", value: "auto" });
    expect(v.pending).toBe(1);
    expect(rows(v)).toEqual([
      ["Cy", "Q1", "1996", "lie", "lie", null],
      ["Ada", "Q2", "Mr Pickels", "accurate", null, "Mister Pickles"],
      ["Ben", "Q2", "Mister Pickles", "accurate", "accurate", null],
    ]);
    expect(hostsLines(rt)).toEqual([
      "📝 Ada filed Q2: Mr Pickels. Proposed: accurate.",
      // The server says the proposal is the near-miss rule's (wave 11 review).
      '⚠ Near miss, not an exact match: Ada\'s Q2 filing "Mr Pickels" is close to "Mister Pickles", so it is proposed accurate and is credited if nobody judges it. Judge it on Run → Mind → Judging.',
      "📝 Ben filed Q2: Mister Pickles. Judged accurate.",
      "📝 Cy filed Q1: 1996. Judged lie.",
    ]);
    // The flip is journaled around Ada's filing only, by the judge.
    const journal = new Store(d).readJournal();
    const flips = journal.filter((e) => e.m === "setVar" && e.a[0] === "Night.judge_mode");
    expect(flips.map((e) => [e.a[1], e.by])).toEqual([
      ["review", "Judge"],
      ["auto", "Judge"],
    ]);
    const i = journal.indexOf(flips[0]!);
    expect([journal[i + 1]!.m, journal[i + 1]!.a[0], journal[i + 1]!.a[1]]).toEqual(["signal", "fact answered", ada.id]);
    expect(journal[i + 1]!.a[2]).toMatchObject({ verdict: "accurate", key_answer: "Mister Pickles" });
    expect(journal[i + 2]).toBe(flips[1]);
    expect([journal[i + 3]!.m, journal[i + 3]!.by]).toEqual(["broadcast", "Judge"]);
    rt.dispose();
  });

  it("left alone, a near miss at 100 settles accurate — never a lie", async () => {
    const { rt } = fresh();
    const ada = await guest(rt, "Ada");
    expect((await file(rt, ada, "Q2", "mister pickels", 100)).status).toBe(200);
    expect((await mod(rt, "/api/mod/signal", { name: "settle", subject: ada.id })).status).toBe(200);
    const f = (await facts(rt)).questions[1]!.filings[0]!;
    expect([f.verdict, f.final, f.near]).toEqual(["accurate", "accurate", { key: "Mister Pickles" }]);
    expect(rt.liveSim!.world.peek(`${ada.id}.v`)).toEqual({ kind: "string", value: "accurate" });
    rt.dispose();
  });

  it("a director decides a near miss on the Judging card like any pending verdict, and a restart replays it", async () => {
    const { rt, d } = fresh();
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    expect((await file(rt, ada, "Q2", "Mrs Pickles", 100)).status).toBe(200);
    expect((await file(rt, ben, "Q1", "1,997", 60)).status).toBe(200);
    expect((await facts(rt)).pending).toBe(2);
    expect((await mod(rt, "/api/mod/signal", { name: "fact_lie", subject: ada.id, args: { question: "Q2" } })).status).toBe(200);
    expect((await mod(rt, "/api/mod/signal", { name: "fact_accurate", subject: ben.id, args: { question: "Q1" } })).status).toBe(200);
    const v = await facts(rt);
    expect(v.pending).toBe(0);
    const how = (x: FactsView) => x.questions.flatMap((q) => q.filings.map((f) => [f.name, f.final, f.how, f.by, f.near?.key]));
    expect(how(v)).toEqual([
      ["Ben", "accurate", "confirmed", "Ada", "1997"],
      ["Ada", "lie", "overridden", "Ada", "Mister Pickles"],
    ]);
    rt.dispose();
    const again = runtimeIn(d);
    expect(again.restore()).not.toBeNull();
    expect(how(await facts(again))).toEqual(how(v));
    expect(again.liveSim!.world.peek("Night.judge_mode")).toEqual({ kind: "string", value: "auto" });
    again.dispose();
  });

  it("in review mode a near miss is pending like any filing — no flip", async () => {
    const { rt, d } = fresh();
    expect((await mod(rt, "/api/mod/var", { path: "Night.judge_mode", value: "review" })).status).toBe(200);
    const ada = await guest(rt, "Ada");
    expect((await file(rt, ada, "Q2", "Mr Pickels", 100)).status).toBe(200);
    expect(rows(await facts(rt))).toEqual([["Ada", "Q2", "Mr Pickels", "accurate", null, "Mister Pickles"]]);
    expect(new Store(d).readJournal().filter((e) => e.by === "Judge")).toEqual([]);
    expect(hostsLines(rt)).toEqual(["📝 Ada filed Q2: Mr Pickels. Proposed: accurate."]); // every filing waits: no ⚠
    expect(mode(rt)).toEqual({ kind: "string", value: "review" });
    rt.dispose();
  });
});
