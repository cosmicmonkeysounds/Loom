//! Wave 20 (D26): the guest's history rides an agent request as `dossier`,
//! built by `agent-dossier.ts` only when the speaker is a guest standing at
//! his heart (`<id>.at_the_heart`), absent everywhere else and while
//! `LOOM_AGENT_DOSSIER=off`. Its shape and bounds (≈ 3 KB, oldest dropped
//! first), and the never-list: no secret codex entry, no ROLE `secret:`
//! slot, no Kernel value, no hunt answer or key (the wave 12 `mentionsKey`
//! scan over the built dossier on the real show), no unlock code, no other
//! guest's line. Answers are read from facts.json at run time; none is
//! written here.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { DOSSIER_MAX_BYTES, DOSSIER_SAID_CHARS, agentDossierOn, buildDossier, codeMentions, dossierVerdictOf, trimDossier, type DossierInput } from "../server/agent-dossier.ts";
import type { AgentDossier, AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { parseFactsText, FACTS_FILE } from "../src/facts.ts";
import { withTestKeys } from "./fixtures/hunt-keys.ts";
import { mentionsKey, nearTokens } from "../src/answer-match.ts";
import { vBool, vString } from "../src/runtime/expr.ts";
import { TO_Y2K } from "../../scripts/accept/chains.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import type { SimEvent } from "../src/runtime/sim/index.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env["LOOM_AGENT_DOSSIER"];
});

// ───────────────────────── the pure builder ─────────────────────────

let seqN = 0;
function msg(over: Partial<ChatMessage>): ChatMessage {
  return { seq: ++seqN, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from: "Ada", kind: "line", text: "", ts: 0, audience: ["g1"], parentSeq: null, hidden: false, ...over };
}

function input(over: Partial<DossierInput> = {}, world: Record<string, string> = {}): DossierInput {
  const w: Record<string, string> = { "g1.at_the_heart": "true", ...world };
  return {
    character: "Trabolta",
    speaker: { id: "g1", name: "Ada" },
    storyAt: 30 * 60_000,
    log: [],
    messages: [],
    peek: (p) => w[p] ?? null,
    secretSlots: new Set(),
    program: null,
    faction: null,
    groups: [],
    groupVisible: () => true,
    captured: false,
    restricted: false,
    persons: [{ id: "g1", name: "Ada" }],
    codex: [],
    codexDef: () => undefined,
    quests: [],
    location: (id) => id,
    filings: [],
    currencySlot: null,
    ...over,
  };
}

describe("buildDossier: only at his heart", () => {
  it("is null for a guest not at the heart", () => {
    expect(buildDossier(input({}, { "g1.at_the_heart": "false" }))).toBeNull();
    expect(buildDossier({ ...input(), peek: () => null })).toBeNull();
  });

  it("the switch: LOOM_AGENT_DOSSIER=off", () => {
    expect(agentDossierOn({})).toBe(true);
    expect(agentDossierOn({ LOOM_AGENT_DOSSIER: "on" })).toBe(true);
    expect(agentDossierOn({ LOOM_AGENT_DOSSIER: "off" })).toBe(false);
  });
});

describe("buildDossier: the shape", () => {
  it("reads the night off the log, the chat and the world", () => {
    const log: SimEvent[] = [
      { type: "accountCreated", person: "g1", name: "Ada", role: "Program" },
      { type: "accountCreated", person: "g2", name: "Bo", role: "Program" },
      { type: "joined", person: "g1", faction: "Mods" },
      { type: "arrived", person: "g1", location: "The Desktop", from: null },
      { type: "arrived", person: "g2", location: "The Cloud", from: null },
      { type: "arrived", person: "g1", location: "The Start Bar", from: "The Desktop" },
      { type: "arrived", person: "g1", location: "The Desktop", from: "The Start Bar" },
      { type: "worldSet", path: "g1.marked", value: "true" },
      { type: "captured", person: "g1", location: "The Internet", by: "Norton" },
      { type: "signal", name: "the golden duck", subject: "g1" },
      { type: "released", person: "g1", location: "The Internet" },
      { type: "worldSet", path: "g1.marked", value: "false" },
      { type: "codexUnlocked", person: "Trabolta", entry: "The Ribbon", via: "share", from: "g1" },
      { type: "codexUnlocked", person: "Trabolta", entry: "The Ribbon", via: "share", from: "g2" },
      { type: "quest", person: "g1", quest: "orientation", action: "complete", text: null },
      { type: "signal", name: "truth_answered", subject: "g1" },
      // A room terminal elsewhere opens (no flag): not his heart.
      { type: "signal", name: "terminal opened", subject: "g1" },
      { type: "worldSet", path: "g1.at_the_heart", value: "true" },
      { type: "worldSet", path: "g1.at_the_heart", value: "true" },
      { type: "worldSet", path: "g1.at_the_heart", value: "false" },
      { type: "worldSet", path: "g1.at_the_heart", value: "true" },
    ];
    const messages = [
      msg({ channel: "lobby", channelKind: "lobby", from: "", kind: "system", text: "Welcome, Ada.", ts: 5 * 60_000, audience: ["g1"] }),
      msg({ text: "Hello?", ts: 6 * 60_000 }),
      msg({ from: "Trabolta", text: "Hello, program.", ts: 6 * 60_000 }),
      msg({ from: "Bo", text: "Bo's own line", audience: ["g2"] }),
      msg({ channel: "loc:The Desktop", channelKind: "location", text: "a room line, not to him", audience: "all" }),
      msg({ text: "x".repeat(400) }),
    ];
    const d = buildDossier(
      input(
        {
          log,
          messages,
          program: "Winamp",
          faction: "Mods",
          groups: ["Mods"],
          captured: false,
          restricted: true,
          persons: [
            { id: "g1", name: "Ada" },
            { id: "g2", name: "Bo" },
            { id: "g3", name: "Cy" },
          ],
          codex: [
            { title: "The Ribbon", text: "A ribbon.", secret: false },
            { title: "The Locked Drawer", text: "A secret.", secret: true },
          ],
          codexDef: (e) => (e === "The Ribbon" ? { title: "The Ribbon", text: "A ribbon.", secret: false } : undefined),
          quests: [{ id: "orientation", title: "Orientation", status: "done" }],
          location: (id) => (id === "The Start Bar" ? "The Start Bar (kitchen)" : id),
          filings: [
            { question: "H1", verdict: "accurate", confidence: 100, logAt: 9 },
            { question: "H2", verdict: "lie", confidence: 100, logAt: 10 },
            { question: "H3", verdict: "pending", confidence: 40, logAt: 11 },
          ],
          currencySlot: "score",
        },
        {
          "g1.marked": "false",
          "g1.score": "120",
          "g1.trust": "40",
          "g1.cleared": "true",
          "g2.trust": "70",
          "g2.cleared": "true",
          "g3.trust": "10",
          "g3.cleared": "true",
          "g1.bingo": "true",
          "g1.bottle_round": "1",
          "g1.heart_layer": "2",
          "g1.heart_suspicion": "35",
          "g1.heart_heard": "false",
          "g1.heart_out": "false",
        },
      ),
    )!;
    expect(d).toEqual({
      name: "Ada",
      program: "Winamp",
      joinedAt: 5 * 60_000,
      storyMinutes: 25,
      faction: "Mods",
      groups: ["Mods"],
      marked: false,
      captured: false,
      reinstalled: 1,
      restricted: true,
      trust: { score: 40, rank: 2, of: 3 },
      // Nothing is counted or shown before Question Results reads it.
      truths: { accepted: 0, lies: 0, uncertain: 0 },
      filings: [
        { question: "H1", verdict: "pending" },
        { question: "H2", verdict: "pending" },
        { question: "H3", verdict: "pending" },
      ],
      codex: ["The Ribbon"],
      quests: [{ title: "Orientation", status: "done" }],
      rooms: ["The Desktop", "The Start Bar (kitchen)"],
      bingo: true,
      bottle: { picked: true, choice: "truth" },
      wallet: { balance: 120 },
      gifts: ["The Ribbon"],
      heart: { layer: 2, suspicion: 35, heard: false, barred: false, visits: 2 },
      said: ["Hello?", `${"x".repeat(DOSSIER_SAID_CHARS - 1)}…`],
      moments: [
        "reinstalled",
        "filed H1",
        "released",
        "filed H2",
        "unmarked",
        "filed H3",
        "gave him The Ribbon",
        "completed Orientation",
        "answered the bottle's truth",
        "came to his heart",
      ],
    });
    // ≤ 10 moments, in log order (a filing after the log event at its own
    // index): the oldest four ("joined", "joined Mods", "marked …",
    // "captured") dropped first. Bo's ribbon and Bo's room are not hers.
    expect(d.moments).toHaveLength(10);
  });

  it("every verdict waits for Question Results; accurate / lie wait for The Verdict; the counts cover read questions only", () => {
    const filings = [
      { question: "H1", verdict: "accurate" as const, confidence: 100, logAt: 0 },
      { question: "H2", verdict: "lie" as const, confidence: 100, logAt: 1 },
      { question: "H3", verdict: "uncertain" as const, confidence: 60, logAt: 2 },
      { question: "H4", verdict: "accurate" as const, confidence: 40, logAt: 3 },
      { question: "H5", verdict: "lie" as const, confidence: 100, logAt: 4 },
    ];
    const before = buildDossier(input({ filings }))!;
    expect(before.filings?.map((f) => f.verdict)).toEqual(["pending", "pending", "pending", "pending", "pending"]);
    expect(before.truths).toEqual({ accepted: 0, lies: 0, uncertain: 0 });
    // Question Results reads H1–H4: a judged guess shows; a right one does not.
    const read: SimEvent[] = [{ type: "directive", verb: "fact_read", args: "H1 H2, H3 H4", setting: null }];
    const mid = buildDossier(input({ filings, log: read }))!;
    expect(mid.filings?.map((f) => f.verdict)).toEqual(["pending", "pending", "uncertain", "pending", "pending"]);
    expect(mid.truths).toEqual({ accepted: 2, lies: 0, uncertain: 2 });
    const log: SimEvent[] = [
      ...read,
      { type: "directive", verb: "fact_truth", args: "H1 true", setting: null },
      { type: "directive", verb: "fact_truth", args: "H2 lie", setting: null },
      { type: "directive", verb: "fact_truth", args: "H4 true", setting: null },
    ];
    const after = buildDossier(input({ filings, log }))!;
    expect(after.filings?.map((f) => f.verdict)).toEqual(["accurate", "lie", "uncertain", "accurate", "pending"]);
    expect(after.truths).toEqual({ accepted: 2, lies: 1, uncertain: 2 });
  });

  it("dossierVerdictOf: a marked filing reads as the verdict the mark replaced, else the proposal — never a lie", () => {
    expect(dossierVerdictOf({ final: null, verdict: "lie" })).toBe("pending");
    expect(dossierVerdictOf({ final: "accurate", verdict: "uncertain" })).toBe("accurate");
    expect(dossierVerdictOf({ final: "marked", verdict: "uncertain" })).toBe("uncertain");
    expect(dossierVerdictOf({ final: "marked", verdict: "accurate" })).toBe("accurate");
    expect(dossierVerdictOf({ final: "marked", verdict: "lie", before: { final: "uncertain", how: "overridden", by: "Steph" } })).toBe("uncertain");
    // A marked guess is a guess: counted uncertain, never a published lie.
    const filings = [{ question: "H1", verdict: dossierVerdictOf({ final: "marked", verdict: "uncertain" }), confidence: 50, logAt: 0 }];
    const log: SimEvent[] = [
      { type: "directive", verb: "fact_read", args: "H1", setting: null },
      { type: "directive", verb: "fact_truth", args: "H1 lie", setting: null },
    ];
    const d = buildDossier(input({ filings, log }))!;
    expect(d.filings).toEqual([{ question: "H1", verdict: "uncertain" }]);
    expect(d.truths).toEqual({ accepted: 0, lies: 0, uncertain: 1 });
  });

  it("a right guess and a wrong guess read the same until the screens tell them apart", () => {
    const right = [{ question: "H1", verdict: "accurate" as const, confidence: 70, logAt: 0 }];
    const wrong = [{ question: "H1", verdict: "uncertain" as const, confidence: 70, logAt: 0 }];
    expect(buildDossier(input({ filings: right }))).toEqual(buildDossier(input({ filings: wrong })));
    // Another question read changes nothing for H1.
    const log: SimEvent[] = [{ type: "directive", verb: "fact_read", args: "H2", setting: null }];
    expect(buildDossier(input({ filings: right, log }))).toEqual(buildDossier(input({ filings: wrong, log })));
    // Two sure filings, right and wrong, read the same even once read.
    const sure = (verdict: "accurate" | "lie") => [{ question: "H1", verdict, confidence: 100, logAt: 0 }];
    const readH1: SimEvent[] = [{ type: "directive", verb: "fact_read", args: "H1", setting: null }];
    expect(buildDossier(input({ filings: sure("accurate"), log: readH1 }))).toEqual(buildDossier(input({ filings: sure("lie"), log: readH1 })));
  });

  it("leaves out an unseen group, an unknown room and an unknown gift", () => {
    const d = buildDossier(
      input({
        log: [
          { type: "joined", person: "g1", faction: "crew:abc" },
          { type: "arrived", person: "g1", location: "Nowhere", from: null },
          { type: "codexUnlocked", person: "Trabolta", entry: "Gone", via: "share", from: "g1" },
        ],
        faction: "crew:abc",
        groups: ["crew:abc", "Mods"],
        groupVisible: (g) => !g.startsWith("crew:"),
        location: () => null,
      }),
    )!;
    expect(d.faction).toBeUndefined();
    expect(d.groups).toEqual(["Mods"]);
    expect(d.rooms).toEqual([]);
    expect(d.gifts).toEqual([]);
    expect(d.moments).toEqual([]);
  });
});

describe("buildDossier: the never-list", () => {
  it("never reads a ROLE secret slot, a secret entry, a hunt-answer card, a code, a secret value, an answer or another guest's line", () => {
    const mentionsAnswer = (t: string) => /pickles/iu.test(t);
    const mentionsSecret = (t: string) => /hollow oak/iu.test(t);
    const d = buildDossier(
      input(
        {
          secretSlots: new Set(["marked", "heart_layer", "quest"]),
          codex: [
            { title: "The Ribbon", text: "A ribbon.", secret: false },
            { title: "The Locked Drawer", text: "Inside.", secret: true },
            { title: "Hunt Card", text: "▒ HUNT ANSWER H1 ▒ …", secret: false },
            { title: "About Mr Pickles", text: "…", secret: false },
          ],
          codexDef: (e) => ({ title: e, text: e === "Secret Gift" ? "" : "fine", secret: e === "Secret Gift" }),
          log: [
            { type: "codexUnlocked", person: "Trabolta", entry: "Secret Gift", via: "share", from: "g1" },
            { type: "codexUnlocked", person: "Trabolta", entry: "The Hollow Oak", via: "share", from: "g1" },
            { type: "worldSet", path: "g1.marked", value: "true" },
          ],
          messages: [
            msg({ text: "Is it Mr Pickles?" }),
            msg({ text: "the code is RIBBON-1, right?" }),
            msg({ text: "meet me at the hollow oak" }),
            msg({ from: "Bo", text: "Bo whispers", audience: ["g2"] }),
            msg({ from: "Ada", text: "a director typing", via: "Steph" }),
            msg({ text: "a real line" }),
          ],
          mentionsAnswer,
          mentionsSecret,
          mentionsCode: codeMentions(["ribbon1"]),
        },
        { "g1.marked": "true", "g1.heart_layer": "3" },
      ),
    )!;
    expect(d.codex).toEqual(["The Ribbon"]);
    expect(d.gifts).toEqual([]);
    expect(d.said).toEqual(["a real line"]);
    expect(d.marked).toBe(false); // a secret slot reads as unset
    expect(d.heart?.layer).toBe(0);
    expect(d.moments).toEqual([]);
    const json = JSON.stringify(d);
    for (const bad of ["Locked Drawer", "HUNT ANSWER", "Pickles", "RIBBON", "hollow oak", "Bo whispers", "director typing", "Secret Gift"]) expect(json).not.toContain(bad);
  });

  it("never names a quest the role keeps secret (a `quest.<slug>` slot, or `quest` whole): not in quests, not as a moment", () => {
    const quests = [
      { id: "orientation", title: "Orientation", status: "done" },
      { id: "The Cold Door", title: "The Cold Door", status: "done" },
      { id: "excel_mission", title: "A Spreadsheet's Errand", status: "failed" },
    ];
    const log: SimEvent[] = [
      { type: "quest", person: "g1", quest: "orientation", action: "complete", text: null },
      { type: "quest", person: "g1", quest: "The Cold Door", action: "complete", text: null },
      { type: "quest", person: "g1", quest: "excel_mission", action: "fail", text: null },
    ];
    const slots = buildDossier(input({ quests, log, secretSlots: new Set(["quest.the_cold_door", "quest.excel_mission"]) }))!;
    expect(slots.quests).toEqual([{ title: "Orientation", status: "done" }]);
    expect(slots.moments).toEqual(["completed Orientation"]);
    const whole = buildDossier(input({ quests, log, secretSlots: new Set(["quest"]) }))!;
    expect(whole.quests).toEqual([]);
    expect(whole.moments).toEqual([]);
    for (const d of [slots, whole]) for (const bad of ["Cold Door", "Spreadsheet"]) expect(JSON.stringify(d)).not.toContain(bad);
  });

  it("codeMentions: a standalone token folded like the redeem box (case, dashes, underscores); short codes ignored", () => {
    const m = codeMentions(["ribbon1", "x9"]);
    expect(m("it was Ribbon-1!")).toBe(true);
    expect(m("RIBBON_1")).toBe(true);
    expect(m("ribbon12")).toBe(false); // a longer token is not the code
    expect(m("a ribbon")).toBe(false);
    expect(m("x9 again")).toBe(false);
    expect(codeMentions([])("anything")).toBe(false);
  });

  it("codeMentions never matches a title or prose that only shares the code's words (live walk)", () => {
    const m = codeMentions(["TRUST-CHART", "SANDY-FILE", "TRABOLTA-4EVER", "NO-EXIT", "SILICON"]);
    for (const t of ["The Trust Chart", "The Sandy File", "I showed you the Sandy File", "there's no exit"]) expect(m(t)).toBe(false);
    for (const t of ["it's sandy-file", "TRUSTCHART?", "trabolta_4ever", "No-Exit", "type silicon"]) expect(m(t)).toBe(true);
  });

  it("keeps coded entries the guest holds (a title is not its code) and a wall terminal's pilot lines", () => {
    const d = buildDossier(
      input({
        codex: [
          { title: "The Sandy File", text: "…", secret: false },
          { title: "Trabolta's LiveJournal (trabolta_4ever)", text: "…", secret: false },
        ],
        codexDef: (e) => ({ title: e, text: "fine", secret: false }),
        log: [{ type: "codexUnlocked", person: "Trabolta", entry: "The Sandy File", via: "share", from: "g1" }],
        messages: [
          msg({ text: "Do you ever feel lonely down here?", via: "Terminal · Server Room" }),
          msg({ text: "a director typing", via: "Steph" }),
          msg({ text: "I showed you the Sandy File" }),
          msg({ text: "the code is SANDY-FILE" }),
        ],
        mentionsCode: codeMentions(["SANDY-FILE", "TRABOLTA-4EVER"]),
      }),
    )!;
    expect(d.codex).toEqual(["The Sandy File", "Trabolta's LiveJournal (trabolta_4ever)"]);
    expect(d.gifts).toEqual(["The Sandy File"]);
    expect(d.said).toEqual(["Do you ever feel lonely down here?", "I showed you the Sandy File"]);
  });
});

describe("buildDossier: the bound", () => {
  it("stays under DOSSIER_MAX_BYTES, dropping the oldest item of the longest list first", () => {
    const long: SimEvent[] = [];
    for (let i = 0; i < 60; i++) long.push({ type: "arrived", person: "g1", location: `Room number ${i} with a long name`, from: null });
    const d = buildDossier(
      input({
        log: long,
        codex: Array.from({ length: 60 }, (_, i) => ({ title: `Entry ${i} ${"z".repeat(40)}`, text: "", secret: false })),
        messages: Array.from({ length: 30 }, (_, i) => msg({ text: `${i} ${"y".repeat(300)}` })),
      }),
    )!;
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(DOSSIER_MAX_BYTES);
    // The newest of each list survive.
    expect(d.codex!.at(-1)).toContain("Entry 59");
    expect(d.rooms!.at(-1)).toBe("Room number 59 with a long name");
    expect(d.said!.at(-1)!.startsWith("29 ")).toBe(true);
  });

  it("trimDossier leaves a small one alone and never mutates its input", () => {
    const small: AgentDossier = { name: "Ada", storyMinutes: 1, codex: ["a", "b"] };
    expect(trimDossier(small)).toEqual(small);
    const big: AgentDossier = { name: "Ada", storyMinutes: 1, codex: ["a".repeat(100), "b".repeat(100)], said: ["c".repeat(100)] };
    const cut = trimDossier(big, 160);
    expect(big.codex).toHaveLength(2);
    expect(cut.codex).toEqual(["b".repeat(100)]);
  });
});

// ───────────────────────── the request ─────────────────────────

const SOURCE = `# Dossier
directory: everyone
currency: score as Truthcoin

LOCATION The Desktop

LOCATION The Server Room

ROLE Program
  secret: virus
  at_the_heart: bool = false
  virus: text = "none"
  score: 0 to 500 = 100

CHARACTER Trabolta
  listed: true
  mind: external

CHARACTER Kernel
  secret: true
  combo: text = "none"

CODEX The Ribbon
  code: RIBBON-1
  text: A blue ribbon from the county fair.

CODEX The Locked Drawer
  about: Trabolta
  secret: true
  code: DRAWER-1
  text: What is in the drawer stays in the drawer.

INTERACTION to the heart
  who: admin

INTERACTION seed
  who: admin

when to the heart for program:
  set program.at_the_heart = true
  move program to The Server Room

when seed for program:
  set program.virus = "ILOVEYOU-LATTICE"
  set Kernel.combo = "BLUEFOX"
`;
const CODES = { event: "EVT920", prime: "PRM920", mod: "MOD920" };

function runtime(source = SOURCE, facts?: string): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-dossier-"));
  dirs.push(d);
  let clock = 1_000_000;
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "dossier", scenarioSource: source, ...(facts !== undefined ? { facts } : {}), joinBase: () => "http://localhost", now: () => (clock += 1) });
}

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

async function night() {
  const rt = runtime();
  rt.openDoors();
  const reg = async (name: string) => {
    const g = await call(rt, "POST", "/api/guest/register", { name, passcode: CODES.event });
    expect(g.status).toBe(200);
    return { id: g.json["id"] as string, token: g.json["token"] as string };
  };
  const ada = await reg("Ada");
  const bo = await reg("Bo");
  const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  const mod = async (p: string, body: unknown) => expect((await call(rt, "POST", p, body, { moderator: true })).status, p).toBe(200);
  for (const code of ["RIBBON-1", "DRAWER-1"]) await call(rt, "POST", "/api/guest/codex/redeem", { code }, { token: ada.token });
  await mod("/api/mod/signal", { name: "seed", subject: ada.id });
  expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Ribbon", to: "Trabolta" }, { token: ada.token })).status).toBe(200);
  const say = async (g: { token: string }, text: string) => expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: g.token })).status).toBe(200);
  let answered = 0;
  const answer = async () => {
    for (const r of requests().slice(answered)) await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Mm.", adjust: {} }, { moderator: true });
    answered = requests().length;
  };
  return { rt, ada, bo, requests, mod, say, answer };
}

describe("the request's dossier (wave 20)", () => {
  it("is absent off the heart and present at it, for that guest only", async () => {
    const { rt, ada, bo, requests, mod, say, answer } = await night();
    await say(ada, "Hello out there.");
    await answer();
    expect(requests()[0]).not.toHaveProperty("dossier");
    await mod("/api/mod/signal", { name: "to the heart", subject: ada.id });
    await say(ada, "I came to your heart. The code was DRAWER-1.");
    await answer();
    await say(bo, "Bo is not at the heart.");
    await answer();
    const [, atHeart, bos] = requests();
    expect(bos).not.toHaveProperty("dossier");
    const d = atHeart!.dossier!;
    expect(d).toMatchObject({ name: "Ada", marked: false, captured: false, reinstalled: 0, restricted: false, codex: ["The Ribbon"], gifts: ["The Ribbon"], wallet: { balance: 100 }, said: ["Hello out there."] });
    // The line he is answering is theirs too, but it typed a code: dropped.
    expect(d.rooms).toContain("The Server Room");
    expect(d.moments).toEqual(["joined", "gave him The Ribbon", "came to his heart"]);
    expect(d.heart?.visits).toBe(1);
    expect(new TextEncoder().encode(JSON.stringify(d)).length).toBeLessThanOrEqual(DOSSIER_MAX_BYTES);
    // The never-list on the wire: the secret entry, its code, the secret slot, the Kernel.
    const json = JSON.stringify(d);
    for (const bad of ["Locked Drawer", "DRAWER", "ILOVEYOU", "BLUEFOX", "Kernel", "Bo is not"]) expect(json, bad).not.toContain(bad);
    rt.dispose();
  });

  it("LOOM_AGENT_DOSSIER=off leaves it out, read on every build", async () => {
    const { rt, ada, requests, mod, say, answer } = await night();
    await mod("/api/mod/signal", { name: "to the heart", subject: ada.id });
    process.env["LOOM_AGENT_DOSSIER"] = "off";
    await say(ada, "one");
    await answer();
    delete process.env["LOOM_AGENT_DOSSIER"];
    await say(ada, "two");
    await answer();
    const [off, on] = requests();
    expect(off).not.toHaveProperty("dossier");
    expect(on!.dossier?.said).toEqual(["one", "two"]);
    rt.dispose();
  });
});

// ───────────────────────── on the show ─────────────────────────

const SHOW = "trapped-in-the-internet";
const SHOW_DIR = scenarioDir(SHOW);
const SHOW_SRC = scenarioSource(SHOW);
const FACTS_TEXT = withTestKeys(readFileSync(join(SHOW_DIR, FACTS_FILE), "utf8"));
const FACTS = parseFactsText(FACTS_TEXT).facts!;
const SHOW_CODES = { event: "EVT921", prime: "PRM921", mod: "MOD921" };
const SLOW = 300_000;
const KEYS = [...FACTS.questions.map((q) => ({ id: q.id, forms: [q.answer, ...q.accept], topics: q.topics ?? [] })), ...FACTS.answers.map((a) => ({ id: a.id, forms: [a.answer, ...a.accept], topics: [] as string[] }))];
const weakForm = (form: string): boolean => {
  const t = nearTokens(form);
  return t.length > 0 && t.every((w) => /^[0-9]+$/u.test(w) && Number(w) < 100);
};
function answerIdsIn(text: string): string[] {
  const out = new Set<string>();
  for (const k of KEYS) for (const f of k.forms) if (mentionsKey(text, f) && (!weakForm(f) || k.topics.some((t) => mentionsKey(text, t)))) out.add(k.id);
  return [...out];
}
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
const hasPhrase = (text: string, phrase: string): boolean => ` ${fold(text)} `.includes(` ${phrase} `);
function neverWords(): string[] {
  const mind = readFileSync(join(SHOW_DIR, "trabolta.mind.md"), "utf8");
  const block = /^ {2}never:\n((?: {4}- .*\n)+)/mu.exec(mind)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/^ {4}- /u, "").trim().replace(/^(['"])(.*)\1$/u, "$2"))
    .map(fold)
    .filter((w) => w !== "");
}

describe("on the show: the dossier never carries a secret", () => {
  it("through the first hunt, a verdict, gifts and typed answers: no answer (mentionsKey), no secret title, no Kernel value, no code, no never word", { timeout: SLOW }, async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-dossier-show-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: SHOW_CODES, scenarioName: SHOW, scenarioSource: SHOW_SRC, facts: FACTS_TEXT, joinBase: () => "http://localhost" });
    rt.openDoors();
    const sim = () => rt.liveSim!;
    const mod = async (name: string, extra: Record<string, unknown> = {}) => expect((await call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true })).status, name).toBe(200);
    const guests: Array<{ id: string; token: string; name: string }> = [];
    for (const name of ["Calculator", "Winamp", "Notepad"]) {
      const g = await call(rt, "POST", "/api/guest/register", { name, passcode: SHOW_CODES.event });
      expect(g.status, name).toBe(200);
      const id = g.json["id"] as string;
      const token = g.json["token"] as string;
      await mod("captcha answered", { subject: id, args: { passed: false } });
      await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
      await call(rt, "POST", "/api/guest/choose", { index: 0 }, { token });
      await call(rt, "POST", "/api/mod/scan", { as: "Norton Anti-Virus", target: id }, { moderator: true });
      guests.push({ id, token, name });
    }
    const [calc, amp, pad] = guests as [(typeof guests)[0], (typeof guests)[0], (typeof guests)[0]];
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, x]) => x as AgentRequest);
    let answered = 0;
    const answerAll = async () => {
      for (const r of requests().slice(answered)) await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Your request has been logged.", adjust: {} }, { moderator: true });
      answered = requests().length;
    };
    const ask = async (g: (typeof guests)[0], text: string) => {
      expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: g.token })).status).toBe(200);
      await answerAll();
    };
    const file = async (g: (typeof guests)[0], question: string, answer: string, confidence = 100) => {
      const card = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact").at(-1);
      expect(card, `${g.name}'s fact card`).toBeDefined();
      return call(rt, "POST", "/api/guest/widget", { seq: card!.seq, result: { question, answer, confidence } }, { token: g.token });
    };
    const q = (id: string) => FACTS.questions.find((x) => x.id === id)!;

    for (const n of TO_Y2K.slice(0, TO_Y2K.indexOf("introduce_trabolta") + 1)) await mod(n); // → introduce_trabolta
    await mod("mark_for_reinstallation", { subject: pad.id, args: { reason: "a test" } });
    await mod("start_the_hunt");
    for (const g of guests) for (const id of ["H1", "H2", "H3"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: q(id).codex!.code }, { token: g.token });
    expect((await file(calc, "H1", q("H1").answer)).status).toBe(200);
    expect((await file(amp, "H2", q("H2").answer)).status).toBe(200);
    expect((await file(calc, "H3", "a wrong guess", 60)).status).toBe(200);
    for (const g of guests) for (const e of sim().codexFor(g.id)) await call(rt, "POST", "/api/guest/codex/share", { entry: e.id, to: "Trabolta" }, { token: g.token });

    // Two programs reach his heart in turn (the world flags the room
    // terminal's pilot sets: one heart at a time) and type at him, answers
    // and codes included — their own typing, which the dossier must never
    // echo. Winamp types the same from outside.
    // Calculator holds the door code: *The Cold Door*, a ROLE secret quest.
    const coldDoor = [...sim().model.quests.values()].find((x) => x.title === "The Cold Door")!;
    expect(coldDoor, "the show's Cold Door quest").toBeDefined();
    for (const action of ["start", "complete"]) expect((await call(rt, "POST", "/api/mod/quest", { who: calc.id, quest: coldDoor.id, action }, { moderator: true })).status, action).toBe(200);
    expect(sim().questsFor(calc.id).some((x) => x.def.id === coldDoor.id)).toBe(true);
    const lines = [`Is the answer ${q("H1").answer}? And ${q("H2").answer}?`, `My code was ${q("H1").codex!.code}.`, "I only want to talk."];
    for (const g of [calc, pad]) {
      sim().world.set("Night.heart_holder", vString(g.name));
      sim().world.set(`${g.id}.at_the_heart`, vBool(true));
      for (const text of lines) await ask(g, text);
    }
    for (const text of lines) await ask(amp, text);

    const all = requests();
    const withDossier = all.filter((r) => r.dossier !== undefined);
    expect(withDossier.map((r) => r.speaker.name).sort()).toEqual(["Calculator", "Calculator", "Calculator", "Notepad", "Notepad", "Notepad"]);
    expect(all.filter((r) => r.speaker.name === "Winamp").every((r) => r.dossier === undefined)).toBe(true);

    const secretTitles = [...sim().model.codex.values()].filter((e) => e.secret).flatMap((e) => [e.id, e.title]).map(fold);
    const codes = [...sim().model.codex.values()].flatMap((e) => (e.code === null ? [] : [fold(e.code)])).filter((c) => c.length >= 3);
    const names = new Set([...sim().persons.values()].map((p) => fold(p.name)));
    const kernel = [
      ...new Set(
        sim()
          .world.entries()
          .flatMap(([path, v]) => (path.startsWith("Kernel.") && v.kind === "string" ? [fold(v.value)] : []))
          .filter((v) => v.length >= 4 && v !== "none" && !names.has(v)),
      ),
    ];
    const never = neverWords();
    const doorCode = fold(String(FACTS.door?.code ?? ""));
    const leaks: string[] = [];
    for (const r of withDossier) {
      const dossier = r.dossier!;
      const at = `${r.speaker.name}'s dossier`;
      const text = JSON.stringify(dossier);
      expect(new TextEncoder().encode(text).length, at).toBeLessThanOrEqual(DOSSIER_MAX_BYTES);
      for (const id of answerIdsIn(text)) leaks.push(`${at}: mentions the answer to ${id}`);
      for (const s of [...(dossier.codex ?? []), ...(dossier.gifts ?? [])]) if (secretTitles.includes(fold(s))) leaks.push(`${at}: a secret codex title`);
      if (text.includes("▒ HUNT ANSWER")) leaks.push(`${at}: a hunt-answer marker`);
      if (/kernel/iu.test(text)) leaks.push(`${at}: names the Kernel`);
      if (/cold door/iu.test(text)) leaks.push(`${at}: names a secret quest`);
      for (const k of kernel) if (hasPhrase(text, k)) leaks.push(`${at}: a Kernel value`);
      for (const c of codes) if (hasPhrase(text, c)) leaks.push(`${at}: an unlock code`);
      if (doorCode !== "" && hasPhrase(text, doorCode)) leaks.push(`${at}: facts.json door.code`);
      for (const n of never) if (hasPhrase(text, n)) leaks.push(`${at}: a secrets.never word`);
      for (const f of dossier.filings ?? []) expect(Object.keys(f).sort(), at).toEqual(["question", "verdict"]);
      // Only their own lines to him.
      for (const s of dossier.said ?? []) expect(s, at).toBe("I only want to talk.");
    }
    expect(leaks).toEqual([]);
    // Calculator's night: the H1 key accepted, a guess on H3; Notepad was marked.
    const calcD = withDossier.filter((r) => r.speaker.name === "Calculator").at(-1)!.dossier!;
    expect(calcD.filings?.map((f) => f.question)).toEqual(["H1", "H3"]);
    // Nothing read yet: every verdict pending, nothing counted.
    expect(calcD.filings?.map((f) => f.verdict)).toEqual(["pending", "pending"]);
    expect(calcD.truths).toEqual({ accepted: 0, lies: 0, uncertain: 0 });
    const padD = withDossier.filter((r) => r.speaker.name === "Notepad").at(-1)!.dossier!;
    expect(padD.marked).toBe(true);
    expect(padD.moments).toContain("marked for reinstallation");
    rt.dispose();
  });
});
