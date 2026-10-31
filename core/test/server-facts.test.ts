//! The facts judge wired into `EventRuntime` (Wave 4, lane B, stage 2;
//! `server/facts.ts`): a project's `facts.json` deals the key to the judge,
//! `/api/guest/widget` attaches a verdict to a 📝 `fact` filing (and to a
//! keyed free-text `answer` card) — journaled, never re-judged on replay —
//! review mode proposes instead, `ModView.facts` tallies, the reserved keys
//! are refused, a story with no key gets no verdict, `/api/mod/load {facts}`
//! swaps the key, the show file beside the house map is the LAN fallback
//! (re-read on mtime), and `do pick … from […] else …` draws one random
//! person through the injected seam.

import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime, RESERVED_WIDGET_KEYS, defaultFactsFile } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { FactsView } from "../server/views.ts";

const CODES = { event: "EVT444", prime: "PRM444", mod: "MOD444" };

/** A generic story (no show names): every joiner gets a 📝 fact card, a keyed
 *  free-text card and an un-keyed one; the hooks tell the ledger and echo the
 *  verdict back; a `draw` asks the server for one ready person. */
const SOURCE = `# Facts
start: Boot

LOCATION Lobby
  label: The Lobby

ROLE Program
  ready: bool = false
  chosen: bool = false
  when someone joins:
    -> Deal
  when fact answered for program:
    do fact_filed {program} {question} {confidence} {verdict} {answer}
    if Night.judge_mode == "review":
      The Oracle: Proposed: {verdict}.
    else:
      do fact_judged {program} {question} {verdict}
      The Oracle: Filed: {verdict}.
  when judge_accurate for program:
    do fact_judged {program} {question} accurate
    The Oracle: Confirmed accurate for {question}.
  when answer answered for program:
    The Oracle: Line: {verdict}.
  when picked for program:
    set program.chosen = true

CHARACTER The Oracle
  listed: true

when draw:
  do pick picked from {[p for p in Persons where p.ready == true]} else nobody

when nobody:
  set Night.nobody = true

== Boot
  setting: Lobby
Nothing yet.

== Deal
  setting: Lobby
The Oracle: Take a card.
show fact "File a fact" to program with thread: The Oracle, questions: "Q1: How many years? | Q2: Who wrote it?"
show answer "The line?" to program with thread: The Oracle, question: "P1"
show answer "Anything else?" to program with thread: The Oracle
`;

const FILE = {
  version: 1,
  questions: [
    { id: "Q1", round: 1, text: "How many years?", answer: "Eleven years", accept: ["11 years", "eleven", "11"] },
    { id: "Q2", round: 2, text: "Who wrote it?", answer: "Mister Pickles!", accept: [] },
  ],
  answers: [{ id: "P1", text: "The line.", answer: "You're the one that I want", accept: ["you are the one that i want"] }],
};
const TEXT = JSON.stringify(FILE);
/** A different key: Q1 is now "twelve", so a re-judge would flip a verdict. */
const OTHER = JSON.stringify({ ...FILE, questions: [{ id: "Q1", round: 1, text: "How many years?", answer: "twelve", accept: [] }, FILE.questions[1]] });

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-facts-rt-"));
  dirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Init = { facts?: string | null; factsFile?: string; random?: () => number; source?: string };
function runtimeIn(d: string, init: Init = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "facts",
    scenarioSource: init.source ?? SOURCE,
    joinBase: () => "http://localhost",
    // No key unless the case says so: the show's facts.json must never leak
    // into a generic story's runtime through the default sibling path.
    factsFile: init.factsFile ?? join(d, "no-such-facts.json"),
    ...(init.facts !== undefined ? { facts: init.facts } : {}),
    ...(init.random !== undefined ? { random: init.random } : {}),
  });
}
function fresh(init: Init = {}): { rt: EventRuntime; d: string } {
  const d = freshDir();
  const rt = runtimeIn(d, init);
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
const post = (rt: EventRuntime, path: string, body: unknown) => call(rt, "POST", path, body);
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, true);
const modView = async (rt: EventRuntime) => (await call(rt, "GET", "/api/state?role=mod", {}, true)).json as { facts?: FactsView };

type Guest = { id: string; token: string };
async function guest(rt: EventRuntime, name: string): Promise<Guest> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
/** The seq of the card of this kind dealt to the guest (the un-keyed answer card is the second one). */
function cardSeq(rt: EventRuntime, g: Guest, kind: string, nth = 0): number {
  const cards = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === kind);
  const card = cards[nth];
  if (card === undefined) throw new Error(`no ${kind} card #${nth} for ${g.id}`);
  return card.seq;
}
const answer = (rt: EventRuntime, g: Guest, seq: number, result: unknown) => post(rt, "/api/guest/widget", { token: g.token, seq, result });
const replies = (rt: EventRuntime, g: Guest): string[] =>
  rt
    .chatHistoryFor(g.id)
    .filter((m) => m.kind === "line" && m.from === "The Oracle")
    .map((m) => m.text);
/** The journaled `<kind> answered` signal args for this guest. */
function journaled(d: string, kind: string, id: string): Array<Record<string, unknown>> {
  return new Store(d)
    .readJournal()
    .filter((e) => e.m === "signal" && e.a[0] === `${kind} answered` && e.a[1] === id)
    .map((e) => e.a[2] as Record<string, unknown>);
}

describe("the judge hop — /api/guest/widget with a facts.json", () => {
  it("a 📝 fact filing is judged accurate / lie / uncertain, journaled with its verdict, and echoed to the ledger", async () => {
    const { rt, d } = fresh({ facts: TEXT });
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    const cy = await guest(rt, "Cy");
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q1", answer: " eleven ", confidence: 100 })).status).toBe(200);
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    expect((await answer(rt, cy, cardSeq(rt, cy, "fact"), { question: "Q2", answer: "Doctor Seuss", confidence: 40 })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Filed: accurate.");
    expect(replies(rt, ben).at(-1)).toBe("Filed: lie.");
    expect(replies(rt, cy).at(-1)).toBe("Filed: uncertain.");
    // The journal carries the verdict beside the answer and the card.
    // An accurate filing also carries the key's canonical answer (W6 B13).
    expect(journaled(d, "fact", ada.id)).toEqual([{ question: "Q1", answer: " eleven ", confidence: 100, verdict: "accurate", key_answer: "Eleven years", card: cardSeq(rt, ada, "fact") }]);
    expect(journaled(d, "fact", ben.id)[0]).toMatchObject({ verdict: "lie" });
    expect(journaled(d, "fact", ben.id)[0]).not.toHaveProperty("key_answer");
    expect(journaled(d, "fact", cy.id)[0]).toMatchObject({ verdict: "uncertain" });
    expect(journaled(d, "fact", cy.id)[0]).not.toHaveProperty("key_answer");
    // ModView.facts tallies, in the key's order, mode auto by default.
    const facts = (await modView(rt)).facts!;
    expect(facts.mode).toBe("auto");
    expect(facts.modeVar).toBe("Night.judge_mode");
    expect(facts.confirm).toEqual({ accurate: "fact_accurate", lie: "fact_lie", uncertain: "fact_uncertain" });
    expect(facts.pending).toBe(0);
    expect(facts.questions.map((q) => q.id)).toEqual(["Q1", "Q2", "P1"]);
    expect(facts.questions[0]!.tally).toEqual({ filed: 2, accurate: 1, lie: 1, uncertain: 0, consensus: false });
    // (the ledger reads the `do fact_filed` line, so the answer is trimmed there)
    expect(facts.questions[0]!.filings.map((f) => [f.name, f.answer, f.confidence, f.verdict, f.final])).toEqual([
      ["Ada", "eleven", 100, "accurate", "accurate"],
      ["Ben", "twelve", 100, "lie", "lie"],
    ]);
    expect(facts.questions[1]!.tally).toEqual({ filed: 1, accurate: 0, lie: 0, uncertain: 1, consensus: false });
    // The key itself never reaches the world or a message, and the journal
    // only on a filing that already got it right (Q2 never did).
    const world = JSON.stringify(rt.liveSim!.worldEntries());
    expect(world).not.toContain("Eleven years");
    expect(JSON.stringify(new Store(d).readJournal())).not.toContain("Mister Pickles");
    expect(JSON.stringify(rt.chatHistoryFor(ada.id))).not.toContain("Eleven years");
    rt.dispose();
  });

  it("two accurate filings in different aliases both give the story the key's canonical answer (W6 B13)", async () => {
    const source = SOURCE.replace(
      "  when fact answered for program:\n",
      "  when fact answered for program:\n    if verdict == \"accurate\":\n      The Oracle: The answer is: {key_answer}.\n",
    );
    const { rt, d } = fresh({ facts: TEXT, source });
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q1", answer: "11", confidence: 100 })).status).toBe(200);
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "ELEVEN", confidence: 60 })).status).toBe(200);
    expect(replies(rt, ada)).toContain("The answer is: Eleven years.");
    expect(replies(rt, ben)).toContain("The answer is: Eleven years.");
    expect(journaled(d, "fact", ben.id)[0]).toMatchObject({ answer: "ELEVEN", verdict: "accurate", key_answer: "Eleven years" });
    rt.dispose();
  });

  it("review mode (Night.judge_mode via /api/mod/var): the verdict is proposed, pending until a director confirms with {question}", async () => {
    const { rt } = fresh({ facts: TEXT });
    expect((await mod(rt, "/api/mod/var", { path: "Night.judge_mode", value: "review" })).status).toBe(200);
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "11 years", confidence: 100 })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Proposed: lie.");
    let facts = (await modView(rt)).facts!;
    expect(facts.mode).toBe("review");
    expect(facts.pending).toBe(2);
    expect(facts.questions[0]!.filings.map((f) => f.final)).toEqual([null, null]);
    expect(facts.questions[0]!.tally).toEqual({ filed: 2, accurate: 1, lie: 1, uncertain: 0, consensus: false });
    // The Run card confirms / overrides through the ordinary signal route.
    expect((await mod(rt, "/api/mod/signal", { name: "judge_accurate", subject: ada.id, args: { question: "Q1" } })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Confirmed accurate for Q1.");
    facts = (await modView(rt)).facts!;
    expect(facts.pending).toBe(1);
    expect(facts.questions[0]!.filings[0]!.final).toBe("accurate");
    expect(facts.questions[0]!.tally).toEqual({ filed: 2, accurate: 2, lie: 0, uncertain: 0, consensus: true });
    expect((await mod(rt, "/api/mod/var", { path: "Night.judge_mode", value: "auto" })).status).toBe(200);
    expect((await modView(rt)).facts!.mode).toBe("auto");
    rt.dispose();
  });

  it("ModView.facts records how each final was reached and who confirmed it — and a restart keeps both (wave 5 issue 8)", async () => {
    const keyed = JSON.stringify({ ...FILE, judge: { confirm: { accurate: "judge_accurate", lie: "judge_lie", uncertain: "judge_uncertain" } } });
    const { rt, d } = fresh({ facts: keyed });
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    // auto: the judge's verdict stands at once, nobody confirmed it
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q2", answer: "Mister Pickles", confidence: 100 })).status).toBe(200);
    // review: Ben's lie is a proposal until the director (moderatorName "Ada") confirms it accurate
    expect((await mod(rt, "/api/mod/var", { path: "Night.judge_mode", value: "review" })).status).toBe(200);
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    const rows = (v: FactsView) => v.questions.flatMap((q) => q.filings.map((f) => [f.name, q.id, f.verdict, f.final, f.how, f.by]));
    expect(rows((await modView(rt)).facts!)).toEqual([
      ["Ben", "Q1", "lie", null, null, null],
      ["Ada", "Q2", "accurate", "accurate", "auto", null],
    ]);
    expect((await mod(rt, "/api/mod/signal", { name: "judge_accurate", subject: ben.id, args: { question: "Q1" } })).status).toBe(200);
    const live = rows((await modView(rt)).facts!);
    expect(live).toEqual([
      ["Ben", "Q1", "lie", "accurate", "overridden", "Ada"],
      ["Ada", "Q2", "accurate", "accurate", "auto", null],
    ]);
    rt.dispose();
    // The journal's `by` rebuilds the same provenance after a restart.
    const again = runtimeIn(d, { facts: keyed });
    expect(again.restore()).not.toBeNull();
    expect(rows((await modView(again)).facts!)).toEqual(live);
    again.dispose();
  });

  it("a keyed `answer` card is judged on its own `question` param; `text` may name anyone; an un-keyed one passes untouched", async () => {
    const { rt, d } = fresh({ facts: TEXT });
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    expect((await answer(rt, ada, cardSeq(rt, ada, "answer", 0), { text: "The Oracle" })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Line: lie.");
    expect(journaled(d, "answer", ada.id)[0]).toEqual({ text: "The Oracle", verdict: "lie", question: "P1", card: cardSeq(rt, ada, "answer", 0) });
    expect((await answer(rt, ben, cardSeq(rt, ben, "answer", 0), { text: "you ARE the one that I want!" })).status).toBe(200);
    expect(replies(rt, ben).at(-1)).toBe("Line: accurate.");
    // The client cannot re-key the card.
    expect((await answer(rt, ada, cardSeq(rt, ada, "answer", 1), { text: "x", question: "Q1" })).status).toBe(200);
    const unkeyed = journaled(d, "answer", ada.id)[1]!;
    expect(unkeyed).not.toHaveProperty("verdict");
    expect(unkeyed.question).toBe("Q1"); // the client's own arg, as before — nothing judged on it
    const facts = (await modView(rt)).facts!;
    expect(facts.questions[2]!.id).toBe("P1");
    expect(facts.questions[2]!.filings).toEqual([]); // the story told the ledger nothing for answers
    rt.dispose();
  });

  it("refuses a forged verdict / card, a bad confidence, an empty answer and an unknown question — with a key", async () => {
    const { rt } = fresh({ facts: TEXT });
    const ada = await guest(rt, "Ada");
    const seq = cardSeq(rt, ada, "fact");
    expect([...RESERVED_WIDGET_KEYS].sort()).toEqual(["card", "key_answer", "verdict"]);
    for (const forged of [
      { question: "Q1", answer: "eleven", confidence: 100, verdict: "accurate" },
      { question: "Q1", answer: "eleven", confidence: 100, card: 3 },
      // A miss the judge won't key: a forged key would survive the merge.
      { question: "Q1", answer: "x", confidence: 50, key_answer: "Eleven years" },
    ]) {
      const r = await answer(rt, ada, seq, forged);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("bad widget result");
    }
    for (const bad of [
      { question: "Q1", answer: "eleven", confidence: 0 },
      { question: "Q1", answer: "eleven", confidence: 101 },
      { question: "Q1", answer: "eleven", confidence: 1.5 },
      { question: "Q1", answer: "eleven", confidence: "100" },
      { question: "Q1", answer: "eleven" },
      { question: "Q1", answer: "   ", confidence: 100 },
      { question: "Q9", answer: "eleven", confidence: 100 },
      { answer: "eleven", confidence: 100 },
    ]) {
      const r = await answer(rt, ada, seq, bad);
      expect(r.status).toBe(400);
      expect(r.json.error).toBe("bad fact filing");
    }
    // A refusal spends nothing: the card is still answerable.
    expect((await answer(rt, ada, seq, { question: "Q1", answer: "11", confidence: 1 })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Filed: accurate.");
    // A keyed answer card refuses empty text.
    expect((await answer(rt, ada, cardSeq(rt, ada, "answer", 0), { text: " " })).status).toBe(400);
    rt.dispose();
  });

  it("a key still owed (`placeholder`) judges nobody: however sure, even in the stand-in's own words, the filing reaches the story with no verdict; the other questions judge as ever", async () => {
    const owed = JSON.stringify({ ...FILE, questions: [{ id: "Q1", round: 1, text: "How many years?", answer: "PLACEHOLDER Q1 ANSWER OWED", accept: [], placeholder: true }, FILE.questions[1]] });
    const { rt, d } = fresh({ facts: owed });
    const [ada, ben, cy, di] = [await guest(rt, "Ada"), await guest(rt, "Ben"), await guest(rt, "Cy"), await guest(rt, "Di")];
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q1", answer: "Eleven years", confidence: 100 })).status).toBe(200);
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "a guess", confidence: 40 })).status).toBe(200);
    expect((await answer(rt, cy, cardSeq(rt, cy, "fact"), { question: "Q1", answer: "PLACEHOLDER Q1 ANSWER OWED", confidence: 100 })).status).toBe(200);
    for (const g of [ada, ben, cy]) {
      expect(journaled(d, "fact", g.id)[0], g.id).not.toHaveProperty("verdict");
      expect(journaled(d, "fact", g.id)[0], g.id).not.toHaveProperty("key_answer");
    }
    expect((await answer(rt, di, cardSeq(rt, di, "fact"), { question: "Q2", answer: "nobody", confidence: 100 })).status).toBe(200);
    expect(journaled(d, "fact", di.id)[0]).toMatchObject({ verdict: "lie" });
    rt.dispose();
  });

  it("a story without a facts.json gets no verdict and no ModView.facts (back-compat): any question passes", async () => {
    const { rt, d } = fresh({ facts: null });
    const ada = await guest(rt, "Ada");
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q9", answer: "whatever", confidence: 5 })).status).toBe(200);
    const args = journaled(d, "fact", ada.id)[0]!;
    expect(args).toMatchObject({ question: "Q9", answer: "whatever", confidence: 5 });
    expect(args).not.toHaveProperty("verdict");
    expect((await modView(rt)).facts).toBeUndefined();
    // …but the reserved keys are refused everywhere, key or no key.
    expect((await answer(rt, ada, cardSeq(rt, ada, "answer", 0), { text: "x", verdict: "accurate" })).status).toBe(400);
    expect((await answer(rt, ada, cardSeq(rt, ada, "answer", 0), { text: "The Oracle" })).status).toBe(200);
    expect(journaled(d, "answer", ada.id)[0]).not.toHaveProperty("verdict");
    rt.dispose();
  });

  it("a restart replays the journaled verdicts — never re-judged, even against a different key", async () => {
    const { rt, d } = fresh({ facts: TEXT });
    const ada = await guest(rt, "Ada");
    const seq = cardSeq(rt, ada, "fact");
    expect((await answer(rt, ada, seq, { question: "Q1", answer: "eleven", confidence: 100 })).status).toBe(200);
    const before = rt.chatHistoryFor(ada.id).map((m) => [m.seq, m.kind, m.text]);
    rt.dispose();

    // The row now carries another key (a sync while the server was down).
    const again = runtimeIn(d, { facts: OTHER });
    expect(again.restore()).not.toBeNull();
    expect(again.facts).toBe(OTHER);
    expect(again.chatHistoryFor(ada.id).map((m) => [m.seq, m.kind, m.text])).toEqual(before);
    const facts = (await modView(again)).facts!;
    expect(facts.questions[0]!.filings.map((f) => [f.name, f.verdict, f.final])).toEqual([["Ada", "accurate", "accurate"]]);
    expect(facts.questions[0]!.tally.consensus).toBe(true);
    // A fresh filing is judged by the new key.
    const ben = await guest(again, "Ben");
    expect((await answer(again, ben, cardSeq(again, ben, "fact"), { question: "Q1", answer: "eleven", confidence: 100 })).status).toBe(200);
    expect(replies(again, ben).at(-1)).toBe("Filed: lie.");
    again.dispose();

    // No row snapshot at all (the LAN default event): the state dir's copy.
    const lan = runtimeIn(d);
    expect(lan.restore()).not.toBeNull();
    expect(lan.facts).toBe(OTHER);
    lan.dispose();
  });

  it("/api/mod/load {facts}: refuses a broken key before restarting, swaps a good one, null clears to the show file", async () => {
    const { rt, d } = fresh({ facts: TEXT });
    const ada = await guest(rt, "Ada");
    const broken = await mod(rt, "/api/mod/load", { source: SOURCE, facts: "{ not json" });
    expect(broken.status).toBe(400);
    expect(broken.json.error).toBe("invalid facts.json");
    expect((broken.json.problems as string[]).length).toBeGreaterThan(0);
    expect(rt.facts).toBe(TEXT);
    expect(rt.chatHistoryFor(ada.id).length).toBeGreaterThan(0); // nothing restarted
    expect((await mod(rt, "/api/mod/load", { source: SOURCE, facts: 5 })).status).toBe(400);

    expect((await mod(rt, "/api/mod/load", { source: SOURCE, facts: OTHER })).status).toBe(200);
    expect(rt.facts).toBe(OTHER);
    expect(new Store(d).loadFacts()).toBe(OTHER);
    const ben = await guest(rt, "Ben");
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    expect(replies(rt, ben).at(-1)).toBe("Filed: accurate.");

    // Absent → untouched; null → the project has none (no show file here → nothing judged).
    expect((await mod(rt, "/api/mod/load", { source: SOURCE })).status).toBe(200);
    expect(rt.facts).toBe(OTHER);
    expect((await mod(rt, "/api/mod/load", { source: SOURCE, facts: null })).status).toBe(200);
    expect(rt.facts).toBeNull();
    expect((await modView(rt)).facts).toBeUndefined();
    rt.dispose();
  });

  it("the LAN fallback: the show's facts.json beside the house map, re-read on mtime, the last good key kept over a broken edit", async () => {
    const d = freshDir();
    const file = join(d, "facts.json");
    writeFileSync(file, TEXT);
    utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const rt = runtimeIn(d, { factsFile: file });
    rt.openDoors();
    expect(rt.facts).toBeNull();
    expect((await modView(rt)).facts?.questions.map((q) => q.id)).toEqual(["Q1", "Q2", "P1"]);
    const ada = await guest(rt, "Ada");
    expect((await answer(rt, ada, cardSeq(rt, ada, "fact"), { question: "Q1", answer: "eleven", confidence: 100 })).status).toBe(200);
    expect(replies(rt, ada).at(-1)).toBe("Filed: accurate.");

    // A hand edit is picked up on the next look.
    writeFileSync(file, OTHER);
    utimesSync(file, new Date(1_700_000_001_000), new Date(1_700_000_001_000));
    const ben = await guest(rt, "Ben");
    expect((await answer(rt, ben, cardSeq(rt, ben, "fact"), { question: "Q1", answer: "eleven", confidence: 100 })).status).toBe(200);
    expect(replies(rt, ben).at(-1)).toBe("Filed: lie.");

    // A half-saved file never sticks: the last good key keeps serving.
    writeFileSync(file, "{ \"version\": 1, ");
    utimesSync(file, new Date(1_700_000_002_000), new Date(1_700_000_002_000));
    const cy = await guest(rt, "Cy");
    expect((await answer(rt, cy, cardSeq(rt, cy, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    expect(replies(rt, cy).at(-1)).toBe("Filed: accurate.");

    // A project snapshot outranks the show file.
    expect((await mod(rt, "/api/mod/load", { source: SOURCE, facts: TEXT })).status).toBe(200);
    const di = await guest(rt, "Di");
    expect((await answer(rt, di, cardSeq(rt, di, "fact"), { question: "Q1", answer: "twelve", confidence: 100 })).status).toBe(200);
    expect(replies(rt, di).at(-1)).toBe("Filed: lie.");
    rt.dispose();

    expect(defaultFactsFile("/config/house.json")).toBe(process.env.LOOM_FACTS ?? "/config/facts.json");
  });
});

describe("do pick … from […] else … — the server's random draw", () => {
  it("commits signal(<event>, <one ready person>) through the injected seam; an empty pool fires the else event; a restart replays the same pick", async () => {
    let roll = 0.99;
    const { rt, d } = fresh({ random: () => roll });
    const ada = await guest(rt, "Ada");
    const ben = await guest(rt, "Ben");
    // Nobody ready: the else branch.
    expect((await mod(rt, "/api/mod/signal", { name: "draw" })).status).toBe(200);
    expect(rt.liveSim!.world.get("Night.nobody")).toEqual({ kind: "bool", value: true });
    expect(new Store(d).readJournal().some((e) => e.m === "signal" && e.a[0] === "nobody")).toBe(true);

    for (const g of [ada, ben]) expect((await mod(rt, "/api/mod/var", { path: `${g.id}.ready`, value: "true" })).status).toBe(200);
    expect((await mod(rt, "/api/mod/signal", { name: "draw" })).status).toBe(200);
    const chosen = (g: Guest) => rt.liveSim!.world.get(`${g.id}.chosen`);
    expect(chosen(ben)).toEqual({ kind: "bool", value: true });
    expect(chosen(ada)).toEqual({ kind: "bool", value: false });
    // The pick is an ordinary journaled signal on that person.
    const picks = new Store(d).readJournal().filter((e) => e.m === "signal" && e.a[0] === "picked");
    expect(picks.map((e) => e.a[1])).toEqual([ben.id]);

    roll = 0;
    expect((await mod(rt, "/api/mod/signal", { name: "draw" })).status).toBe(200);
    expect(chosen(ada)).toEqual({ kind: "bool", value: true });
    rt.dispose();

    // Replay: the journal holds the draws, so no seam is consulted.
    const again = runtimeIn(d, {
      random: () => {
        throw new Error("the replay must never draw");
      },
    });
    expect(again.restore()).not.toBeNull();
    expect(again.liveSim!.world.get(`${ben.id}.chosen`)).toEqual({ kind: "bool", value: true });
    expect(again.liveSim!.world.get(`${ada.id}.chosen`)).toEqual({ kind: "bool", value: true });
    again.dispose();
  });
});
