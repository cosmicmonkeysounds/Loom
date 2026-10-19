//! Trabolta never knows what he is asking for (the user's rule, 2026-10-19:
//! "Trabolta shouldn't be aware of any of the actual facts he's truly asking
//! for"). He asks the guests for the hunt answers (facts.json `questions`,
//! H1–H6 / F1–F2, and the pickup line, `answers` P1); none of them, nor any
//! alias, may reach his worker by any door the event server or the show
//! opens — except the near-miss judge frame (wave 11b), which carries the key
//! to a separate stateless ruling call on purpose and is pinned apart from his
//! voice and mind by stagehand's tests/test_judge.py:
//!
//!   - his **agent requests** at the night's turns — his own codex, the
//!     speaker's codex and vars, the world's globals, the thread history
//!     (minus what the guest typed: a guest may *tell* him an answer, that
//!     is the hunt; a claim is not knowledge), from his introduction through
//!     the bob, ⚖ the verdict and Grok Prom, and a performer's Cast thread;
//!   - **`/api/agent/facts`** (the orchestrator's ground truth and lookups);
//!   - his **prompt files**: the persona (body, situations, bargain, lines)
//!     and the mind file (body, stages, drives and every phase cue).
//!
//! After the verdict truth.txt has read H1–F2 to the house, so they are
//! exempt from then on (the grok_prom / advice / finale_* cues, the Grok Prom
//! requests). The pickup line never is read out before someone gives it: the
//! house judges it on the 💌 card, never he (the user, 2026-10-19: "the house
//! judges it"), so P1 is checked everywhere, Grok Prom included.
//!
//! Nor may anything he holds point at the films the answers come from (the
//! user, 2026-10-19: "scrub the film from his own files"): the POINTERS below
//! (the film's title and people, and the answers that are its song titles),
//! matched exactly, never as spelling slips, so his own name, Trabolta, and
//! Sandy stay. Checked in every entry he holds or can be handed, the persona,
//! the mind until the night ends (the finale_* cues are exempt), and his
//! requests and the facts document up to Grok Prom. The guests' own clues
//! that carry one (The Cooling Log, its Jeeves fragment) are `secret: true`:
//! theirs, never in his requests, refused as a share.
//!
//! A mention is the judge's own notion of "the same answer": folded,
//! word-bounded, number words as digits, plurals / honorifics / spelling
//! slips as `nearMatch` allows (`mentionsKey`). A bare number under 100
//! (`11`, `eleven`, `9:00`) is everywhere a clock or a fragment number is,
//! so it counts only beside one of its own question's topics.
//!
//! The fix is the plumbing, not the voice's manners: every hunt-answer CODEX
//! is `secret: true` (generated, titi-facts) — out of every request and the
//! facts document, refused as a share — The Rival (it names F2) is secret,
//! and the entries he holds no longer carry an answer (the LiveJournal, the
//! old Greased Lightning year (now Oil And Lightning, no film), the
//! MONOPOLY GO! handle).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { AgentRequest } from "../server/agents.ts";
import { parseFactsText, FACTS_FILE } from "../src/facts.ts";
import { mentionsKey, nearTokens } from "../src/answer-match.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { foldCode } from "../src/runtime/sim/model.ts";
import { TO_HUNT2 } from "../../scripts/accept/chains.ts";

const SHOW = "trapped-in-the-internet";
const DIR = scenarioDir(SHOW);
const SRC = scenarioSource(SHOW);
const FACTS_TEXT = readFileSync(join(DIR, FACTS_FILE), "utf8");
const FACTS = parseFactsText(FACTS_TEXT).facts!;
const CODES = { event: "EVT777", prime: "PRM777", mod: "MOD777" };
const SLOW = 300_000;
const tmp: string[] = [];
afterAll(() => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
});

// ───────────────────────── the scanner ─────────────────────────

interface Key {
  id: string;
  forms: string[];
  topics: string[];
}
const HUNT_KEYS: Key[] = FACTS.questions.map((q) => ({ id: q.id, forms: [q.answer, ...q.accept], topics: q.topics ?? [] }));
/** The pickup line (P1): never read out, checked even after the verdict. */
const LINE_KEYS: Key[] = FACTS.answers.map((a) => ({ id: a.id, forms: [a.answer, ...a.accept], topics: [] as string[] }));
const KEYS: Key[] = [...HUNT_KEYS, ...LINE_KEYS];

/** The answers that are the film's song titles (H5, the pickup line). */
const SONG_ANSWERS = ["H5", "P1"];
/** What points at the film (the user, 2026-10-19): its title (and the
 *  song's "Greased Lightning"), its people, and every form of the answers
 *  that are its song titles. Matched exactly, plural / possessive allowed. */
const POINTERS: string[] = [
  "grease", "greased", "greasy", "greaser", "greased lightning", "greased lightnin",
  "danny", "travolta", "john travolta", "olivia", "newton-john", "rydell", "zuko", "kenickie", "rizzo",
  ...KEYS.filter((k) => SONG_ANSWERS.includes(k.id)).flatMap((k) => k.forms),
];
const foldPointer = (s: string): string => s.toLowerCase().replace(/[\u2018\u2019]/gu, "'").replace(/\s+/gu, " ").trim();
const POINTER_RES: Array<[string, RegExp]> = [...new Set(POINTERS.map(foldPointer))].flatMap((w) => {
  const forms = w.includes("'") ? [w, w.replace(/'/gu, "")] : [w];
  return forms.map((f): [string, RegExp] => [w, new RegExp(`(?<![a-z0-9])${f.split(" ").map((x) => x.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s+")}(?:'?s)?(?![a-z0-9])`, "u")]);
});
/** Every pointer at the film the text carries. */
function pointersIn(text: string): string[] {
  const t = foldPointer(text);
  return [...new Set(POINTER_RES.filter(([, re]) => re.test(t)).map(([w]) => `film: ${w}`))];
}

/** A form made only of numbers below 100 (`11`, `eleven`, `9:00`). */
const weak = (form: string): boolean => {
  const t = nearTokens(form);
  return t.length > 0 && t.every((w) => /^[0-9]+$/u.test(w) && Number(w) < 100);
};

/** Every `<key>: <form>` the text mentions. */
function answersIn(text: string, keys: Key[] = KEYS): string[] {
  const out: string[] = [];
  for (const k of keys) {
    for (const f of k.forms) {
      if (!mentionsKey(text, f)) continue;
      if (weak(f) && !k.topics.some((t) => mentionsKey(text, t))) continue;
      out.push(`${k.id}: ${f}`);
    }
  }
  return out;
}

/** What a scan looks for: the answer keys in force, and the film's pointers. */
interface Scan {
  keys: Key[];
  pointers: boolean;
}
const UNTIL_THE_VERDICT: Scan = { keys: KEYS, pointers: true };
/** From ⚖ on: truth.txt has read H1–F2 aloud; the line never is. */
const AFTER_THE_VERDICT_SCAN: Scan = { keys: LINE_KEYS, pointers: true };
const hitsIn = (text: string, scan: Scan = UNTIL_THE_VERDICT): string[] => [...answersIn(text, scan.keys), ...(scan.pointers ? pointersIn(text) : [])];

/** Every string leaf of `value` that mentions an answer (or points at the
 *  film), with its path. */
function leaksIn(label: string, value: unknown, scan: Scan = UNTIL_THE_VERDICT): string[] {
  const out: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (typeof v === "string") {
      const hits = hitsIn(v, scan);
      if (hits.length > 0) out.push(`${label}${p} [${hits.join(" · ")}]: ${v.slice(0, 140)}`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
  };
  walk(value, "");
  return out;
}

/** A request as the guard reads it: the lines the speaker typed are theirs
 *  (a claim they made: the history's and `text`, the newest of them),
 *  everything else is what the house tells him. */
const told = (r: AgentRequest) => ({ ...r, text: "", history: r.history.filter((l) => l.mine || l.from !== r.speaker.name) });

// ───────────────────────── the harness ─────────────────────────

function fakeReq(body: unknown, headers: Record<string, string> = {}) {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
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
    write(c: string) {
      buf += c;
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
    setHeader() {},
    flushHeaders() {},
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
async function call(rt: EventRuntime, method: string, p: string, body: unknown, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${p}`);
  const res = fakeRes();
  await rt.handle(fakeReq(body, o.token ? { "x-loom-token": o.token } : {}), res, method, url.pathname, url, { moderator: o.moderator ?? false });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    /* a stream */
  }
  return { status: res.statusCode, json, res };
}

interface Guest {
  id: string;
  token: string;
  name: string;
}

/** The show on a scratch runtime with its facts.json: three cleared programs,
 *  Clippy signed in at a booth, a worker voicing Trabolta. */
async function night() {
  const dir = mkdtempSync(join(tmpdir(), "loom-answers-"));
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
  const clippy = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
  expect(clippy.status).toBe(200);
  const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  let seen = 0;
  const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);

  /** Every request a line to him opens now, answered so the next opens fresh. */
  const ask = async (say: () => Promise<{ status: number }>): Promise<AgentRequest[]> => {
    expect((await say()).status).toBe(200);
    const fresh = requests().slice(seen);
    seen = requests().length;
    for (const r of fresh) await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Your request has been logged.", adjust: {} }, { moderator: true });
    return fresh;
  };
  const guestSays = (g: Guest, text: string) => ask(() => call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: g.token }));
  const clippySays = (text: string) => ask(() => call(rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text }, { token: clippy.json["token"] as string }));
  const factsDoc = async () => (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json;
  const v = (path: string) => rt.liveSim!.world.peek(path)?.value;
  return { rt, mod, guests, guestSays, clippySays, factsDoc, v };
}

/** A program files `answer` for `question` on its 📝 card in dm:Trabolta. */
async function file(rt: EventRuntime, g: Guest, question: string, answer: string, confidence = 100) {
  const cards = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact");
  const card = cards.at(-1);
  expect(card, `${g.name}'s fact card`).toBeDefined();
  return call(rt, "POST", "/api/guest/widget", { seq: card!.seq, result: { question, answer, confidence } }, { token: g.token });
}

const codeOf = (q: string) => FACTS.questions.find((x) => x.id === q)!.codex!.code;

// ───────────────────────── the guard ─────────────────────────

describe("the leak scanner (mentionsKey under the judge's rules)", () => {
  it("finds an answer said another way, and leaves a bare clock alone", () => {
    expect(answersIn("Grok asked her to computer prom.")).toContain("F2: Grok");
    expect(answersIn("GROK'S prom ticket")).toContain("F2: Grok");
    expect(answersIn("A ticket for Mr. Pickels")).toEqual(expect.arrayContaining(["H2: Mister Pickles"]));
    expect(answersIn("Grease, the film from nineteen seventy-eight")).toContain("H4: 1978");
    expect(answersIn("Sandy did not understand me again today.")).toContain("F1: did not understand");
    expect(answersIn("The billboard went eleven years unpaid")).toEqual(expect.arrayContaining(["H1: Eleven years", "H1: eleven"]));
    expect(answersIn("The system clock reads 11 p.m., 31 December 1999.")).toEqual([]);
    expect(answersIn("JEEVES.IDX — fragment 11")).toEqual([]);
    expect(answersIn("Groan. Grog. Gronk.")).toEqual([]);
    expect(answersIn("Who is taking Sandy to computer prom?")).toEqual([]);
  });

  it("finds the film by its words, exactly: his own name and Sandy are not pointers", () => {
    expect(pointersIn("Trabolta's runtime. Greased Lightning.").sort()).toEqual(["film: greased", "film: greased lightning"]);
    expect(pointersIn("the grease out of the lightning")).toEqual(["film: grease"]);
    expect(pointersIn("Danny sings it to her. John Travolta's hair.")).toEqual(expect.arrayContaining(["film: danny", "film: travolta", "film: john travolta"]));
    expect(pointersIn("Olivia Newton-John at Rydell High")).toEqual(expect.arrayContaining(["film: olivia", "film: newton-john", "film: rydell"]));
    expect(pointersIn("You\u2019re the one that I want")).toContain("film: you're the one that i want");
    expect(pointersIn("youre the one that i want")).toContain("film: you're the one that i want");
    expect(pointersIn("Hopelessly devoted, 412 plays")).toContain("film: hopelessly devoted");
    expect(pointersIn("Jean Trabolta loves Sandy. Oil And Lightning. Greasy? No: oily.")).toEqual(["film: greasy"]);
    expect(pointersIn("Jean Trabolta loves Sandy. Oil And Lightning. Computer prom, Grok, Dan, Liv.")).toEqual([]);
  });
});

describe("Trabolta never knows what he is asking for", () => {
  it("his agent requests and the facts document carry no hunt answer and no pointer at the film, from his introduction through Grok Prom", { timeout: SLOW }, async () => {
    const { rt, mod, guests, guestSays, clippySays, factsDoc, v } = await night();
    const [calc, amp, pad] = guests as [Guest, Guest, Guest];
    const leaks: string[] = [];
    const look = async (at: string, g: Guest = calc, scan: Scan = UNTIL_THE_VERDICT, text = "Hello. What do you need from me?") => {
      const reqs = await guestSays(g, text);
      expect(reqs.length, `${at}: a request`).toBe(1);
      leaks.push(...leaksIn(`${at} · request`, told(reqs[0]!), scan));
      leaks.push(...leaksIn(`${at} · /api/agent/facts`, await factsDoc(), scan));
      return reqs[0]!;
    };

    for (const n of TO_HUNT2.slice(0, 4)) await mod(n); // → introduce_trabolta
    await look("introduced");

    await mod("start_the_hunt");
    // Every program finds every round-1 card, files the right answers…
    for (const g of guests) for (const q of ["H1", "H2", "H3"]) expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token })).json["unlocked"]).toBeTruthy();
    expect((await file(rt, calc, "H1", "Eleven years")).status).toBe(200);
    expect((await file(rt, amp, "H2", "Mister Pickles")).status).toBe(200);
    expect((await file(rt, pad, "H3", "9:00 a.m.")).status).toBe(200);
    // …and one confident lie goes on record: ⚖ will send the night to Grok Prom.
    expect((await file(rt, pad, "H2", "Mittens")).status).toBe(200);
    // …and tries to hand him one: he won't take a hunt answer.
    const handed = await call(rt, "POST", "/api/guest/codex/share", { entry: "The Billboard Lease", to: "Trabolta" }, { token: calc.token });
    expect(handed.status).toBe(403);
    expect(rt.liveSim!.holdsCodex("Trabolta", "The Billboard Lease")).toBe(false);
    await look("hunt 1 (the answers found and filed)");
    await look("hunt 1, a filer's own thread", amp);

    for (const n of ["hunt_time_up", "first_moment_of_truth", "close_the_filing", "read_the_results", "read_the_results", "read_the_results"]) await mod(n);
    await look("the first Moment of Truth (results read)");
    expect(v("Kernel.q2")).toBe("lie");
    leaks.push(...(await clippySays("Boss, the results are read.")).flatMap((r) => leaksIn("truth 1 · Clippy's Cast thread", told(r))));

    for (const n of ["second_hunt_preview", "start_the_second_hunt"]) await mod(n);
    rt.tickOnce(120_000); // the Truther Download
    for (const g of guests) for (const q of ["H4", "H5", "H6"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    expect((await file(rt, calc, "H4", "1978")).status).toBe(200);
    // The LiveJournal (TRABOLTA-4EVER): a program reads his diary.
    expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "TRABOLTA-4EVER" }, { token: calc.token })).json["unlocked"]).toBe("The LiveJournal");
    expect(v("Night.livejournal_read")).toBe(true);
    await look("hunt 2 (the LiveJournal read)");
    // The Rival names F2: the guests read it on the fridge, he never sees it.
    expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "GROK-ONLINE" }, { token: amp.token })).json["unlocked"]).toBe("The Rival");
    expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Rival", to: "Trabolta" }, { token: amp.token })).status).toBe(403);
    await look("hunt 2 (The Rival found)", amp);

    for (const n of ["five_minute_warning", "summons_closed", "truth_pong", "round_two_tally", "trust_chart", "show_the_rankings", "printer_opened"]) await mod(n);
    await look("the beans");
    await mod("trabolta_overshares"); // he asks the final two facts
    expect(v("Night.facts_requested")).toBe(8);
    for (const g of guests) for (const q of ["F1", "F2"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    await look("the overshare (the final facts asked, found)");
    for (const e of ["What Sandy Says", "The Prom Ticket"]) {
      expect((await call(rt, "POST", "/api/guest/codex/share", { entry: e, to: "Trabolta" }, { token: pad.token })).status, e).toBe(403);
    }

    await mod("y2k_clock");
    // At his heart: the server-room terminal pilots a program who holds both final answers.
    const pilot = await call(rt, "POST", "/api/mod/impersonate", { role: "guest", id: pad.id, label: "Terminal · Server Room" }, { moderator: true });
    expect(pilot.status).toBe(200);
    await mod("terminal opened", { subject: pad.id, args: { at: "The Server Room" }, label: "Terminal · Server Room" });
    expect(v(`${pad.id}.at_the_heart`)).toBe(true);
    await look("the Y2K hour, at his heart", pad);

    rt.tickOnce(3_600_000); // midnight: the final reveal
    expect(v("Night.phase")).toBe("final_reveal");
    await look("the final reveal");
    await mod("bobbing_for_truth");
    expect(v("Night.phase")).toBe("bobbing");
    await look("the bob (before truth.txt is read)");

    // 📄 truth.txt reads H1–F2 to the house, ⚖ finds the lie: Grok Prom. From
    // here the hunt answers are out loud; the pickup line never is.
    await mod("brought_up_the_bag", { subject: pad.id, actor: "Clippy" });
    expect(v("Night.bag_up")).toBe(true);
    await mod("read_truth_txt");
    await mod("the_verdict");
    expect(v("Night.phase")).toBe("grok_prom");
    expect(rt.liveSim!.model.interactions.has("the_line_works")).toBe(false); // no power to accept it himself
    const AFTER = AFTER_THE_VERDICT_SCAN;
    const asked = await look("Grok Prom (he asks for the line)", calc, AFTER);
    expect(asked.powers.map((p) => p.id)).not.toContain("the_line_works");
    // The 💌 card went to every program's thread (a widget: not a line of his history).
    for (const g of guests) expect(rt.chatHistoryFor(g.id).some((m) => m.channel === "dm:Trabolta" && m.widget?.kind === "answer" && m.widget.params["question"] === "P1"), g.name).toBe(true);
    // A program types the line to him: theirs to say, never his to keep or pass on.
    const typed = await look("Grok Prom (a program typed the line)", pad, AFTER, FACTS.answers[0]!.answer);
    expect(typed.text).toBe(FACTS.answers[0]!.answer);
    await look("Grok Prom (another program asks after)", calc, AFTER);
    // A wrong line on the 💌 card: the house says no, in that program's thread.
    const cardOf = (g: Guest) => rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "answer").at(-1)!;
    expect((await call(rt, "POST", "/api/guest/widget", { seq: cardOf(amp).seq, result: { text: "Hey girl, are you a router?" } }, { token: amp.token })).status).toBe(200);
    const no = await look("Grok Prom (a wrong line on the card)", amp, AFTER);
    expect(no.history.some((l) => l.text === "The house says no. That is not the line.")).toBe(true);
    expect(v("Night.line_by")).toBe("none");
    // The right line on the card: the house tells him who, never what.
    expect((await call(rt, "POST", "/api/guest/widget", { seq: cardOf(calc).seq, result: { text: FACTS.answers[0]!.accept[0] } }, { token: calc.token })).status).toBe(200);
    expect(v("Night.line_by")).toBe("Calculator");
    expect(v("Night.ending")).toBe("song_pickup");
    const yes = await look("the line accepted (the Song Ending)", calc, AFTER);
    expect(yes.world["Night.line_by"]).toBe("Calculator");
    expect(yes.history.some((l) => l.text === "The house says YES. That is the line, Calculator.")).toBe(true);

    expect(leaks).toEqual([]);
    rt.dispose();
  });

  it("no entry he can hold or read carries an answer: what he holds all night, and the whole non-secret codex", () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    const model = sim.model;
    const hunt = FACTS.questions.map((q) => q.codex!.id);
    for (const id of hunt) expect(model.codex.get(id)?.secret, id).toBe(true);
    expect(model.codex.get("The Rival")?.secret).toBe(true);
    const leaks: string[] = [];
    for (const [id, e] of model.codex) {
      if (e.secret) continue; // never in a request or the facts document
      // Every non-secret entry: what he holds, what he can be handed, and the
      // facts document's ground truth. No answer, and nothing pointing at the film.
      for (const hit of hitsIn(`${e.title}\n${e.text}`)) leaks.push(`${id} [${hit}]`);
    }
    expect(leaks).toEqual([]);
    // He refuses every hunt answer as a share.
    for (const id of hunt) expect(sim.agentRefusal("Trabolta", id), id).toBe("secret");
    // His runtime file keeps its job without the film (was "Greased Lightning").
    expect(model.codex.has("Greased Lightning")).toBe(false);
    expect(sim.holdsCodex("Trabolta", "Oil And Lightning")).toBe(true);
    // The guests' clues that say "grease" are theirs alone: secret, refused as a share.
    for (const id of ["The Cooling Log", "Jeeves Fragment 17"]) {
      const e = model.codex.get(id)!;
      expect(e.secret, id).toBe(true);
      expect(pointersIn(e.text), id).toEqual(["film: grease"]); // unchanged for the guests
      expect(sim.agentRefusal("Trabolta", id), id).toBe("secret");
    }
  });

  it("his prompt files name no answer and never the film: the persona, the mind body and every cue (H1–F2 exempt after the verdict, never the line)", () => {
    const leaks: string[] = [];
    const persona = readFileSync(join(DIR, "trabolta.persona.md"), "utf8");
    const mind = readFileSync(join(DIR, "trabolta.mind.md"), "utf8");
    // Front matter: everything a model is shown. YAML comments are not;
    // nor is the mind's generated `secrets:` block (the worker parses it
    // out: it IS the answer list).
    const scanFile = (name: string, text: string, scanOf: (topKey: string, subKey: string | null) => Scan | null) => {
      const [, front, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/u.exec(text) ?? [];
      expect(front, name).toBeDefined();
      let top = "";
      let sub: string | null = null;
      front!.split("\n").forEach((line, i) => {
        const t = /^([A-Za-z_]+):/u.exec(line);
        if (t !== null) {
          top = t[1]!;
          sub = null;
        }
        const s = /^ {2}([A-Za-z_0-9]+):/u.exec(line);
        if (s !== null) sub = s[1]!;
        const scan = scanOf(top, sub);
        if (line.trim().startsWith("#") || scan === null) return;
        for (const hit of hitsIn(line, scan)) leaks.push(`${name} front matter ${i + 2} (${top}${sub ? `.${sub}` : ""}) [${hit}]: ${line.trim()}`);
      });
      body!.split("\n").forEach((line) => {
        for (const hit of hitsIn(line)) leaks.push(`${name} body [${hit}]: ${line.trim()}`);
      });
    };
    scanFile("trabolta.persona.md", persona, () => UNTIL_THE_VERDICT);
    // The cues from the verdict on (`grok_prom`, `advice`, `finale_*`) play
    // after truth.txt has read H1–F2 to the house: he may know those then.
    // Never the pickup line: the house judges it, he never recognises it
    // (2026-10-19). The film's pointers are checked until the night ends; the
    // endings (`finale_*`) are past it.
    const AFTER_THE_VERDICT = /^(?:grok_prom|advice|finale_.*)$/u;
    const ENDINGS = /^finale_/u;
    scanFile("trabolta.mind.md", mind, (top, sub) => {
      if (top === "secrets") return null;
      if (top !== "phases" || sub === null || !AFTER_THE_VERDICT.test(sub)) return UNTIL_THE_VERDICT;
      return ENDINGS.test(sub) ? { keys: LINE_KEYS, pointers: false } : AFTER_THE_VERDICT_SCAN;
    });
    expect(leaks).toEqual([]);
    // The grok_prom card asks for the line and sends them to the card, in the
    // brief the voice reads and the classic cue alike; it no longer gives him
    // a way to accept one himself.
    const card = /^ {2}grok_prom:(?: >-)?\n((?: {4}.*\n)+)/mu.exec(mind)![1]!;
    for (const key of ["brief", "cue"]) {
      const text = new RegExp(`^ {4}${key}: >-\\n((?: {6}.*\\n)+)`, "mu").exec(card)?.[1]?.replace(/\s+/gu, " ") ?? "";
      expect(text, key).toContain("only the house can");
      expect(text, key).not.toMatch(/the_line_works|knows it when/u);
    }
    // The phases skipped are exactly the ones from the verdict on: every
    // phase under `phases:`, a bare cue or a card (wave 12), never a `_` key.
    const table = mind.slice(mind.indexOf("\nphases:\n"), mind.indexOf("\n---\n", mind.indexOf("\nphases:\n")));
    const phases = [...table.matchAll(/^ {2}([a-z_0-9]+):(?: >-)?$/gmu)].map((m) => m[1]!).filter((p) => !p.startsWith("_"));
    expect(phases).toContain("arrivals");
    expect(phases).not.toContain("_stages");
    expect(phases.filter((p) => AFTER_THE_VERDICT.test(p))).toEqual(["grok_prom", "advice", "finale_killed", "finale_shutdown", "finale_song", "finale_rave", "finale_help", "finale_banish", "finale_hand_jive"]);
    expect(phases.indexOf("bobbing")).toBe(phases.indexOf("grok_prom") - 1);
  });

  it("every answer stays the guests' to find: each card redeems by its code and reads the answer", () => {
    const sim = Sim.fromSources(SRC);
    sim.fireBeat("Power On");
    for (const q of FACTS.questions) {
      const c = q.codex!;
      expect(sim.model.codexCodes.get(foldCode(c.code)), q.id).toBe(c.id);
      expect(answersIn(sim.model.codex.get(c.id)!.text), q.id).toContain(`${q.id}: ${q.answer}`);
    }
    // The LiveJournal still points at The Rival ("says whatever anyone wants
    // to hear"), and The Rival names him.
    expect(sim.model.codex.get("The LiveJournal")!.text).toContain("says whatever anyone wants to hear");
    expect(sim.model.codex.get("The Rival")!.text).toContain("Says whatever anyone wants to hear");
    expect(answersIn(sim.model.codex.get("The Rival")!.text)).toContain("F2: Grok");
  });
});
