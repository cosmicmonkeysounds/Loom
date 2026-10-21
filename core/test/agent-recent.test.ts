//! Wave 12 (lane S): what the server tells Trabolta's worker about the
//! thread and the house, beyond the lines themselves — and what it never
//! does.
//!
//!   - `AgentLine.story`: the story posted this line (a receipt, a scripted
//!     line, the hold / busy line), not his own free reply (C1.1);
//!   - `AgentRequest.recent` + `storyAt`: at most 6 things the house holds
//!     about him and this speaker (gifts, his house-wide lines, the guest's
//!     filings as question ids, marked, the Trust Chart), built at request
//!     time from what the server already holds (C1.2);
//!   - the guest's codex as titles only (C1.3);
//!   - `LOOM_AGENT_RECENT=off`: the request is field-for-field the base
//!     branch's (C1.6), pinned against a fixture frozen from that build.
//!
//! And the secrecy rule, on the real show: no secret codex title, no
//! `▒ HUNT ANSWER` title, nothing from the Kernel, no verdict / answer /
//! confidence / near key in a filing item, and no hunt answer in a house
//! line before the verdict. Answers are read from facts.json at run time;
//! none is written here.

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { answerMentions, buildRecent, inReadingBeat, secretMentions, storyTag, storyTexts, type RecentInput, type StoryTagContext } from "../server/agent-recent.ts";
import type { AgentRecent, AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { parseFactsText, FACTS_FILE } from "../src/facts.ts";
import { mentionsKey, nearTokens } from "../src/answer-match.ts";
import { TO_Y2K } from "../../scripts/accept/chains.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE_FIXTURE = join(HERE, "fixtures", "agent-request-base.json");

const SOURCE = `# Recent
directory: everyone

LOCATION The Cache
  label: The Cache (kitchen)

ROLE Program
  humanity: 0 to 100 = 20

CHARACTER Trabolta
  listed: true
  mind: external
  hold: One moment, program.
  busy: The line is long tonight.
  truth: 0 to 100 = 35

CHARACTER Clippy
  listed: true

CODEX The Ribbon
  code: RIBBON-1
  text: A blue ribbon from the county fair.

CODEX The Recipe
  about: World
  code: RECIPE-1
  text: Two cups of flour, one of sugar.

CODEX The Locked Drawer
  about: Trabolta
  secret: true
  code: DRAWER-1
  text: What is in the drawer stays in the drawer.

INTERACTION greet
  who: admin

INTERACTION file the receipt
  who: admin

when greet for program:
  Trabolta: Welcome, program. I have been expecting you.

when file the receipt for program:
  Trabolta: Filed for Q1.

== Announce
Trabolta: Attention, house. The kitchen is open.
`;
const CODES = { event: "EVT912", prime: "PRM912", mod: "MOD912" };

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
afterEach(() => {
  delete process.env["LOOM_AGENT_RECENT"];
});

function runtime(source = SOURCE): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-recent-"));
  dirs.push(d);
  let clock = 1_000_000;
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "recent", scenarioSource: source, joinBase: () => "http://localhost", now: () => (clock += 1) });
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

/** The mini story's night: a guest gets a scripted welcome, hears his
 *  house-wide line, gives him a ribbon, talks, gets a free reply, talks
 *  again. Returns every request the worker saw, in order. */
async function miniNight() {
  const rt = runtime();
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Ada", passcode: CODES.event });
  expect(g.status).toBe(200);
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
  const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
  const mod = async (p: string, body: unknown) => expect((await call(rt, "POST", p, body, { moderator: true })).status, p).toBe(200);
  expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "RIBBON-1" }, { token: guest.token })).json["unlocked"]).toBeTruthy();
  expect((await call(rt, "POST", "/api/guest/codex/redeem", { code: "RECIPE-1" }, { token: guest.token })).json["unlocked"]).toBeTruthy();
  await mod("/api/mod/signal", { name: "greet", subject: guest.id });
  await mod("/api/mod/beat", { name: "Announce" });
  expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Ribbon", to: "Trabolta" }, { token: guest.token })).status).toBe(200);
  await mod("/api/mod/signal", { name: "file the receipt", subject: guest.id });
  expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Hello, are you there?" }, { token: guest.token })).status).toBe(200);
  await mod("/api/agent/reply", { id: requests()[0]!.id, say: "I am here. Thank you for the ribbon.", adjust: {} });
  expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Do you like it?" }, { token: guest.token })).status).toBe(200);
  return { rt, guest, worker, requests };
}

/** A request with its run-to-run noise (random ids, the injected clock)
 *  replaced by placeholders, so two builds compare field by field. */
function normalised(r: AgentRequest, guestId: string): unknown {
  return JSON.parse(JSON.stringify({ ...r, id: "<request>" }).split(guestId).join("<guest>"));
}

describe("LOOM_AGENT_RECENT=off: the base branch's request, field for field (C1.6)", () => {
  it("deep-equals the fixture frozen from the trabolta/answers build", async () => {
    process.env["LOOM_AGENT_RECENT"] = "off";
    const { rt, guest, requests } = await miniNight();
    const got = requests().map((r) => normalised(r, guest.id));
    expect(got).toHaveLength(2);
    if (process.env["LOOM_FREEZE_AGENT_REQUEST"] === "1") {
      // Run only on the base branch (trabolta/answers, before wave 12's
      // change): `LOOM_FREEZE_AGENT_REQUEST=1 vitest run test/agent-recent.test.ts`.
      mkdirSync(dirname(BASE_FIXTURE), { recursive: true });
      writeFileSync(BASE_FIXTURE, `${JSON.stringify(got, null, 2)}\n`);
    }
    expect(existsSync(BASE_FIXTURE)).toBe(true);
    expect(got).toEqual(JSON.parse(readFileSync(BASE_FIXTURE, "utf8")));
    rt.dispose();
  });
});

// ───────────────────────── the pure parts ─────────────────────────

let seqN = 0;
/** A chat message as the store holds it (no `beat` key unless given). */
function msg(over: Partial<ChatMessage> & { beat?: string | null }): ChatMessage {
  return { seq: ++seqN, channel: "dm:Trabolta", channelKind: "dm", title: "Trabolta", from: "Ada", kind: "line", text: "", ts: 0, audience: ["g-1"], parentSeq: null, hidden: false, ...over };
}
const CTX = (messages: ChatMessage[]): StoryTagContext => ({ character: "Trabolta", hold: "One moment, program.", busy: "The line is long tonight.", storyTexts: storyTexts(messages, "Trabolta") });

describe("storyTag (C1.1)", () => {
  it("(a) an own beat key, whatever its value, is the story's", () => {
    const rule = msg({ from: "Trabolta", text: "Filed for Q1.", beat: null });
    const scripted = msg({ from: "Trabolta", text: "Welcome.", beat: "Greeting" });
    const narrator = msg({ from: "Clippy", text: "Clippy waves.", beat: "Greeting" });
    const ctx = CTX([rule, scripted, narrator]);
    expect(storyTag(rule, ctx)).toBe(true);
    expect(storyTag(scripted, ctx)).toBe(true);
    expect(storyTag(narrator, ctx)).toBe(true);
    // A key set to undefined is still an own key: the composer always writes it.
    expect(storyTag(msg({ from: "Trabolta", text: "x", beat: undefined }), ctx)).toBe(true);
  });

  it("typed chat and his free replies are not the story's", () => {
    const ctx = CTX([]);
    expect(storyTag(msg({ text: "hello" }), ctx)).toBe(false);
    expect(storyTag(msg({ from: "Trabolta", text: "I am here." }), ctx)).toBe(false);
  });

  it("(b) his hold and busy lines, exactly", () => {
    const ctx = CTX([]);
    expect(storyTag(msg({ from: "Trabolta", text: "One moment, program." }), ctx)).toBe(true);
    expect(storyTag(msg({ from: "Trabolta", text: "The line is long tonight." }), ctx)).toBe(true);
    expect(storyTag(msg({ from: "Trabolta", text: "One moment, program!" }), ctx)).toBe(false);
    // Not his: a guest quoting the hold line typed it.
    expect(storyTag(msg({ from: "Ada", text: "One moment, program." }), ctx)).toBe(false);
  });

  it("(c) a text he spoke in some story line, anywhere in the log", () => {
    const elsewhere = msg({ channel: "loc:The Cache", from: "Trabolta", text: "Filed for Q1 · +50 Truthcoin.", beat: null, audience: "all" });
    const ctx = CTX([elsewhere]);
    expect(storyTag(msg({ from: "Trabolta", text: "Filed for Q1 · +50 Truthcoin." }), ctx)).toBe(true);
    expect(storyTag(msg({ from: "Trabolta", text: "Filed for Q2 · +50 Truthcoin." }), ctx)).toBe(false);
  });

  it("a director typing as him (via) is never the story, even with the hold line's text", () => {
    const elsewhere = msg({ from: "Trabolta", text: "Filed for Q1.", beat: null });
    const ctx = CTX([elsewhere]);
    expect(storyTag(msg({ from: "Trabolta", text: "One moment, program.", via: "Jo" }), ctx)).toBe(false);
    expect(storyTag(msg({ from: "Trabolta", text: "Filed for Q1.", via: "Jo" }), ctx)).toBe(false);
  });
});

const CODEX: Record<string, { secret: boolean; title: string; text: string }> = {
  "The Ribbon": { secret: false, title: "The Ribbon", text: "A blue ribbon." },
  "The Recipe": { secret: false, title: "The Recipe", text: "Flour." },
  "The Drawer": { secret: true, title: "The Drawer", text: "Shut." },
  "The Marked Card": { secret: false, title: "▒ HUNT ANSWER H9 ▒ The Marked Card", text: "x" },
  "The Marked Text": { secret: false, title: "The Marked Text", text: "▒ HUNT ANSWER H9 ▒ y" },
};
function gift(entry: string, ts: number, from = "Ada", to = "@Trabolta"): ChatMessage {
  return msg({ channel: "codex", channelKind: "codex", title: "Codex", from: "", kind: "codex", text: CODEX[entry]?.text ?? "", ts, audience: [to], codex: { entry, title: CODEX[entry]?.title ?? entry, about: null, via: "share", from } });
}
function house(text: string, ts: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return msg({ channel: "loc:The Cache", channelKind: "location", title: "The Cache", from: "Trabolta", text, ts, audience: "all", beat: "Announce", ...over });
}
function input(over: Partial<RecentInput> & { world?: Record<string, string> } = {}): RecentInput {
  const world = over.world ?? {};
  return {
    character: "Trabolta",
    speaker: { kind: "guest", id: "g-1", name: "Ada" },
    messages: [],
    storyAt: 0,
    lastFreeReply: null,
    codex: (e) => CODEX[e],
    peek: (p) => world[p] ?? null,
    persons: [
      { id: "g-1", name: "Ada" },
      { id: "g-2", name: "Bea" },
      { id: "g-3", name: "Cy" },
    ],
    filings: [],
    ...over,
  };
}

describe("buildRecent (C1.2)", () => {
  it("a gift: shared with him by this speaker, never a secret or marked entry, newest first", () => {
    const messages = [
      gift("The Ribbon", 10),
      gift("The Recipe", 20),
      gift("The Drawer", 30),
      gift("The Marked Card", 40),
      gift("The Marked Text", 50),
      gift("Nobody Knows", 55),
      gift("The Ribbon", 60, "Bea"), // someone else's gift
      gift("The Ribbon", 70, "Ada", "g-2"), // to a guest, not to him
      { ...gift("The Recipe", 80), codex: { entry: "The Recipe", title: "The Recipe", about: null, via: "code" as const, from: null } }, // a redeem, not a share
    ];
    expect(buildRecent(input({ messages }))).toEqual([
      { kind: "gift", title: "The Recipe", new: true, at: 20 },
      { kind: "gift", title: "The Ribbon", new: true, at: 10 },
    ]);
  });

  it("a performer's gift is matched by the performer's name, and a performer gets gifts and house lines only", () => {
    const messages = [gift("The Ribbon", 10, "Clippy"), house("Attention, house.", 20)];
    const world = { "Clippy.marked": "true", "Clippy.cleared": "true", "Night.screen": "trust_chart" };
    const filings = [{ person: "Clippy", question: "H1", at: 1 }];
    expect(buildRecent(input({ messages, world, filings, speaker: { kind: "performer", id: "Clippy", name: "Clippy" } }))).toEqual([
      { kind: "house", text: "Attention, house.", at: 20 },
      { kind: "gift", title: "The Ribbon", new: true, at: 10 },
    ]);
  });

  it("wave 18b: no line of a reading beat is a house item, whatever it says — a near miss, the key, the readings", () => {
    const messages = [
      house("Question 1. 3 filed. No consensus. I will read what you told me.", 1, { beat: "Question Results" }),
      house("Ada said Mr Pickels, certain. Bea said a cat, not certain.", 2, { beat: "Question Results" }),
      house("I accept it. The answer is: Mister Pickles.", 3, { beat: "question results" }),
      house("Question four. Cy said the tabby, certain.", 4, { beat: "Round Two Tally" }),
      house("2 true. 1 with a lie on record. 0 nobody answered.", 5, { beat: "The Verdict" }),
      house("The house is closing.", 6, { beat: "Announce" }),
    ];
    expect(buildRecent(input({ messages }))).toEqual([{ kind: "house", text: "The house is closing.", at: 6 }]);
    expect(inReadingBeat({ beat: "The_Verdict" })).toBe(true);
    // Outside a reading beat, a line holding the Kernel's said_* / res_said
    // text is still dropped (`secretMentions` over the secret values).
    const said = "Ada said Mr Pickels, certain. Bea said a cat, not certain.";
    const elsewhere = [house(`As I said: ${said}`, 7, { beat: "Announce" })];
    expect(buildRecent(input({ messages: elsewhere, mentionsSecret: secretMentions([said]) }))).toEqual([]);
    expect(inReadingBeat({ beat: null })).toBe(false);
    expect(inReadingBeat({})).toBe(false);
  });

  it("house: his public lines only, newest 2, verbatim", () => {
    const messages = [
      house("one", 1),
      house("two", 2),
      house("three", 3),
      house("hidden", 4, { hidden: true }),
      house("to one guest", 5, { audience: ["g-1"] }),
      house("not his", 6, { from: "Clippy" }),
      house("a notice", 7, { kind: "system" }),
    ];
    expect(buildRecent(input({ messages }))).toEqual([
      { kind: "house", text: "three", at: 3 },
      { kind: "house", text: "two", at: 2 },
    ]);
  });

  it("a filing is a question id and nothing else: one per question, newest 3, not windowed", () => {
    const filings = [
      { person: "g-1", question: "H1", at: 1 },
      { person: "g-1", question: "H2", at: 2 },
      { person: "g-1", question: "H1", at: 9 },
      { person: "g-1", question: "H3", at: 3 },
      { person: "g-1", question: "F1", at: 4 },
      { person: "g-2", question: "H6", at: 99 },
    ];
    const got = buildRecent(input({ filings, storyAt: 10_000_000, lastFreeReply: 9_999_000 }));
    expect(got).toEqual([
      { kind: "filing", question: "H1" },
      { kind: "filing", question: "F1" },
      { kind: "filing", question: "H3" },
    ]);
    for (const f of got) expect(Object.keys(f).sort()).toEqual(["kind", "question"]);
  });

  it("marked, from the world's flag", () => {
    expect(buildRecent(input({ world: { "g-1.marked": "true" } }))).toEqual([{ kind: "marked" }]);
    expect(buildRecent(input({ world: { "g-1.marked": "false" } }))).toEqual([]);
  });

  it("the chart: cleared persons by trust then name, while the slide is up or someone is called out", () => {
    const world: Record<string, string> = { "g-1.cleared": "true", "g-2.cleared": "true", "g-3.cleared": "false", "g-1.trust": "40", "g-2.trust": "40", "g-3.trust": "99", "Night.most_trusted": "none", "Night.least_trusted": "none" };
    // Not up, nobody called: nothing.
    expect(buildRecent(input({ world }))).toEqual([]);
    expect(buildRecent(input({ world: { ...world, "Night.screen": "trust_chart" } }))).toEqual([{ kind: "chart", rank: 1, of: 2, called: null }]);
    expect(buildRecent(input({ world: { ...world, "Night.terminals": "trust_chart" }, speaker: { kind: "guest", id: "g-2", name: "Bea" } }))).toEqual([{ kind: "chart", rank: 2, of: 2, called: null }]);
    // Called out after the slide came down.
    expect(buildRecent(input({ world: { ...world, "Night.most_trusted": "Ada", "Night.least_trusted": "Bea" } }))).toEqual([{ kind: "chart", rank: 1, of: 2, called: "top" }]);
    expect(buildRecent(input({ world: { ...world, "Night.most_trusted": "Ada", "Night.least_trusted": "Bea" }, speaker: { kind: "guest", id: "g-2", name: "Bea" } }))).toEqual([{ kind: "chart", rank: 2, of: 2, called: "bottom" }]);
    // An uncleared speaker is not on the chart.
    expect(buildRecent(input({ world: { ...world, "Night.screen": "trust_chart" }, speaker: { kind: "guest", id: "g-3", name: "Cy" } }))).toEqual([]);
  });

  it("the order is marked, chart, house, gift, filing, and the list stops at 6", () => {
    const messages = [gift("The Ribbon", 1), gift("The Recipe", 2), house("one", 3), house("two", 4), house("three", 5)];
    const world = { "g-1.marked": "true", "g-1.cleared": "true", "Night.screen": "trust_chart" };
    const filings = [{ person: "g-1", question: "H1", at: 1 }];
    const got = buildRecent(input({ messages, world, filings }));
    expect(got.map((r) => r.kind)).toEqual(["marked", "chart", "house", "house", "gift", "gift"]);
    expect((got[2] as Extract<AgentRecent, { kind: "house" }>).text).toBe("three");
    expect(buildRecent(input({ messages: [], world: {}, filings })).map((r) => r.kind)).toEqual(["filing"]);
  });

  it("the window: the last 10 story-minutes, or since his last free reply here, whichever reaches further back", () => {
    const messages = [gift("The Ribbon", 100_000), house("old", 150_000), gift("The Recipe", 900_000)];
    // No free reply yet: everything counts.
    expect(buildRecent(input({ messages, storyAt: 2_000_000 })).map((r) => ("at" in r ? r.at : null))).toEqual([150_000, 900_000, 100_000]);
    // He answered at 1.9 M: the last 10 minutes reach further (1.4 M) — nothing.
    expect(buildRecent(input({ messages, storyAt: 2_000_000, lastFreeReply: 1_900_000 }))).toEqual([]);
    // He answered at 800 k, the guest came back at 2 M: since 800 k.
    expect(buildRecent(input({ messages, storyAt: 2_000_000, lastFreeReply: 800_000 }))).toEqual([{ kind: "gift", title: "The Recipe", new: true, at: 900_000 }]);
    // He answered at 1.9 M, the guest came back at 1.95 M: the last 10 minutes (from 1.35 M).
    expect(buildRecent(input({ messages: [...messages, house("recent", 1_400_000)], storyAt: 1_950_000, lastFreeReply: 1_900_000 }))).toEqual([{ kind: "house", text: "recent", at: 1_400_000 }]);
  });
});

describe("answerMentions: a house line naming an answer never reaches him", () => {
  // Made-up keys: nothing here is a show answer.
  const mentions = answerMentions([
    { forms: ["Captain Biscuit", "Cpt Biscuit"], topics: ["the dog"] },
    { forms: ["14"], topics: ["the bus", "route"] },
    { forms: ["the moon is cheese"], topics: [] },
  ]);

  it("finds a form under the judge's spelling rules, and a bare small number only beside its topic", () => {
    expect(mentions("Hail CAPTAIN BISCUITS, good dog")).toBe(true);
    expect(mentions("Cpt. Biscuit!")).toBe(true);
    expect(mentions("The moon is cheese, friends.")).toBe(true);
    expect(mentions("Route fourteen leaves at noon")).toBe(true);
    expect(mentions("It is 14 minutes to midnight")).toBe(false);
    expect(mentions("Welcome to the kitchen.")).toBe(false);
  });

  it("buildRecent drops such a house line (the next older one takes its place) and such a gift", () => {
    const messages = [house("Hello, house.", 1), house("Captain Biscuit! Sing it!", 2), house("Goodnight.", 3), gift("The Ribbon", 4), { ...gift("The Recipe", 5), codex: { entry: "The Recipe", title: "The moon is cheese", about: null, via: "share" as const, from: "Ada" } }];
    expect(buildRecent(input({ messages, mentionsAnswer: mentions }))).toEqual([
      { kind: "house", text: "Goodnight.", at: 3 },
      { kind: "house", text: "Hello, house.", at: 1 },
      { kind: "gift", title: "The Ribbon", new: true, at: 4 },
    ]);
    // With no facts book in force nothing is dropped.
    expect(buildRecent(input({ messages })).map((r) => r.kind)).toEqual(["house", "house", "gift", "gift"]);
  });
});

describe("secretMentions: a house line carrying a secret character's value never reaches him (C0.1)", () => {
  // Made-up values: nothing here is a show secret.
  const mentions = secretMentions(["Bea", "none", "", "x", "the moon is cheese", "accurate"], ["Ada", "Bea", "Cy"]);

  it("finds a value as a whole-word run, folded; none, empty and a stray short value are unset", () => {
    expect(mentions("Bea planted a virus in me.")).toBe(true);
    expect(mentions("THE MOON, is cheese!")).toBe(true);
    expect(mentions("Your fact is accurate.")).toBe(true);
    expect(mentions("Beatrice planted nothing.")).toBe(false);
    expect(mentions("None of you saw x coming.")).toBe(false);
    expect(mentions("Welcome to the kitchen.")).toBe(false);
    // A two-letter value counts when it is a participant's display name.
    expect(secretMentions(["Cy"], ["Cy"])("Cy planted a virus in me.")).toBe(true);
    expect(secretMentions(["Cy"], [])("Cy planted a virus in me.")).toBe(false);
    expect(secretMentions([])("anything")).toBe(false);
  });

  it("buildRecent drops such a house line (the next older one takes its place) and such a gift", () => {
    const messages = [house("Hello, house.", 1), house("Bea planted a virus in me.", 2), gift("The Ribbon", 3), { ...gift("The Recipe", 4), codex: { entry: "The Recipe", title: "The moon is cheese", about: null, via: "share" as const, from: "Ada" } }];
    expect(buildRecent(input({ messages, mentionsSecret: mentions }))).toEqual([
      { kind: "house", text: "Hello, house.", at: 1 },
      { kind: "gift", title: "The Ribbon", new: true, at: 3 },
    ]);
  });
});

// ───────────────────────── on the runtime ─────────────────────────

describe("the request (recent on, the default)", () => {
  it("tags the story's lines, never his free reply or the guest's", async () => {
    const { rt, requests } = await miniNight();
    const [first, second] = requests();
    expect(first!.history.map((l) => [l.text, l.story ?? false])).toEqual([
      ["Welcome, program. I have been expecting you.", true],
      ["Filed for Q1.", true],
      ["Hello, are you there?", false],
    ]);
    expect(second!.history.map((l) => [l.mine, l.story ?? false])).toEqual([
      [true, true],
      [true, true],
      [false, false],
      [true, false], // his free reply
      [false, false],
    ]);
    // Absent, never false.
    expect(second!.history.filter((l) => "story" in l).every((l) => l.story === true)).toBe(true);
    rt.dispose();
  });

  it("carries recent (his house line, the gift) and the story clock", async () => {
    const { rt, requests } = await miniNight();
    const [first] = requests();
    expect(first!.storyAt).toBe(rt.liveSim!.elapsed());
    expect(first!.recent).toEqual([
      { kind: "house", text: "Attention, house. The kitchen is open.", at: expect.any(Number) },
      { kind: "gift", title: "The Ribbon", new: true, at: expect.any(Number) },
    ]);
    rt.dispose();
  });

  it("sends the guest's codex as titles only, and his own in full", async () => {
    const { rt, requests } = await miniNight();
    const [first] = requests();
    expect(first!.them.codex).toEqual([
      { id: "The Ribbon", title: "The Ribbon", about: null, text: "" },
      { id: "The Recipe", title: "The Recipe", about: "World", text: "" },
    ]);
    expect(first!.self.codex).toEqual([{ id: "The Ribbon", title: "The Ribbon", about: null, text: "A blue ribbon from the county fair." }]);
    rt.dispose();
  });

  it("leaves out of the guest's titles an entry carrying the hunt-answer marker, even one not flagged secret", async () => {
    const rt = runtime(`${SOURCE}
CODEX The Unflagged Card
  code: CARD-1
  text: ▒ HUNT ANSWER Q9 ▒ a placeholder, never a show answer.
`);
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Eve", passcode: CODES.event });
    const token = g.json["token"] as string;
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    for (const code of ["RIBBON-1", "CARD-1"]) expect((await call(rt, "POST", "/api/guest/codex/redeem", { code }, { token })).json["unlocked"], code).toBeTruthy();
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token });
    expect(requests()[0]!.them.codex.map((e) => e.title)).toEqual(["The Ribbon"]);
    // Off: the base request, the text with it (the worker's guard reads it there).
    await call(rt, "POST", "/api/agent/reply", { id: requests()[0]!.id, say: "Hello.", adjust: {} }, { moderator: true });
    process.env["LOOM_AGENT_RECENT"] = "off";
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "again" }, { token });
    expect(requests()[1]!.them.codex.map((e) => e.title)).toEqual(["The Ribbon", "The Unflagged Card"]);
    rt.dispose();
  });

  it("sends an empty recent as [], never omitted", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Bo", passcode: CODES.event });
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token: g.json["token"] as string });
    const [r] = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(r!.recent).toEqual([]);
    expect(r!.history).toEqual([{ seq: expect.any(Number), mine: false, from: "Bo", text: "hi" }]);
    rt.dispose();
  });

  it("is rebuilt on every refresh while the request waits: a gift given meanwhile shows up", async () => {
    const rt = runtime();
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Cy", passcode: CODES.event });
    const token = g.json["token"] as string;
    await call(rt, "POST", "/api/guest/codex/redeem", { code: "RIBBON-1" }, { token });
    // No worker yet: the request is queued.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "wait for me" }, { token });
    expect((await call(rt, "POST", "/api/guest/codex/share", { entry: "The Ribbon", to: "Trabolta" }, { token })).status).toBe(200);
    // A second line while it waits refreshes the queued body.
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "I left you something" }, { token });
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const [r] = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(r!.text).toBe("I left you something");
    expect(r!.recent).toEqual([{ kind: "gift", title: "The Ribbon", new: true, at: expect.any(Number) }]);
    rt.dispose();
  });

  it("a performer's cast thread: the gift by the performer's name, house lines, no guest items", async () => {
    const rt = runtime(SOURCE.replace("CODEX The Recipe\n", "CODEX The Clip\n  known to: Clippy\n  text: A paperclip.\n\nCODEX The Recipe\n"));
    rt.openDoors();
    const login = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: CODES.prime });
    const token = login.json["token"] as string;
    expect(login.status).toBe(200);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    await call(rt, "POST", "/api/mod/beat", { name: "Announce" }, { moderator: true });
    expect((await call(rt, "POST", "/api/prime/codex/share", { entry: "The Clip", to: "Trabolta" }, { token })).status).toBe(200);
    expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text: "Boss, a gift." }, { token })).status).toBe(200);
    const [r] = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(r!.speaker.kind).toBe("performer");
    expect(r!.recent).toEqual([
      { kind: "house", text: "Attention, house. The kitchen is open.", at: expect.any(Number) },
      { kind: "gift", title: "The Clip", new: true, at: expect.any(Number) },
    ]);
    rt.dispose();
  });

  it("a house line filled in from a secret character is dropped, one from a public global stays (C0.1)", async () => {
    const rt = runtime(
      `${SOURCE}
CHARACTER Vault
  playable: false
  secret: true
  planter: text? = none

INTERACTION plant
  who: guest

when plant for program:
  set Vault.planter = program.name
  set Tally.count = 3

== Recount
Trabolta: {Vault.planter} planted a virus in me.

== Tally Up
Trabolta: Lies I believed tonight: {Tally.count}.
`,
    );
    rt.openDoors();
    const g = await call(rt, "POST", "/api/guest/register", { name: "Dot", passcode: CODES.event });
    const token = g.json["token"] as string;
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    expect((await call(rt, "POST", "/api/guest/act", { name: "plant" }, { token })).status).toBe(200);
    for (const name of ["Announce", "Tally Up", "Recount"]) expect((await call(rt, "POST", "/api/mod/beat", { name }, { moderator: true })).status, name).toBe(200);
    // Not vacuous: his recount said the planter's name to the whole house.
    expect(rt.chatHistoryFor(g.json["id"] as string).some((m) => m.from === "Trabolta" && m.audience === "all" && m.text === "Dot planted a virus in me.")).toBe(true);
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "hi" }, { token });
    const [r] = worker.res.frames().filter(([e]) => e === "request").map(([, d]) => d as AgentRequest);
    expect(r!.recent).toEqual([
      { kind: "house", text: "Lies I believed tonight: 3.", at: expect.any(Number) },
      { kind: "house", text: "Attention, house. The kitchen is open.", at: expect.any(Number) },
    ]);
    rt.dispose();
  });

  it("the switch is read on every build: off drops story, recent, storyAt and keeps the codex text", async () => {
    const { rt, guest, worker, requests } = await miniNight();
    await call(rt, "POST", "/api/agent/reply", { id: requests()[1]!.id, say: "I do.", adjust: {} }, { moderator: true });
    process.env["LOOM_AGENT_RECENT"] = "off";
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Good." }, { token: guest.token });
    const off = requests()[2]!;
    expect(off.history.some((l) => "story" in l)).toBe(false);
    expect("recent" in off).toBe(false);
    expect("storyAt" in off).toBe(false);
    expect(off.them.codex.map((e) => e.text)).toEqual(["A blue ribbon from the county fair.", "Two cups of flour, one of sugar."]);
    delete process.env["LOOM_AGENT_RECENT"];
    await call(rt, "POST", "/api/agent/reply", { id: off.id, say: "Good.", adjust: {} }, { moderator: true });
    await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text: "Again." }, { token: guest.token });
    const on = requests()[3]!;
    expect(on.history.some((l) => l.story === true)).toBe(true);
    expect(Array.isArray(on.recent)).toBe(true);
    void worker;
    rt.dispose();
  });
});

describe("the stream hello and the facts document (C1.4, C1.5)", () => {
  it("hello carries traceAfter: the newest thought held per character, 0 when none", async () => {
    const rt = runtime();
    rt.openDoors();
    const first = await call(rt, "GET", "/api/agent/stream?characters=Trabolta,Nobody&name=laptop", {}, { moderator: true });
    const hello1 = first.res.frames().find(([e]) => e === "hello")![1] as Record<string, unknown>;
    expect(hello1["traceAfter"]).toEqual({ Trabolta: 0, Nobody: 0 });
    const thought = (id: string, at: number) => ({ id, character: "Trabolta", at, kind: "voice", messages: [], output: "", ms: 1 });
    expect((await call(rt, "POST", "/api/agent/trace", { worker: "laptop", thoughts: [thought("th-a", 1700000000.5), thought("th-b", 1700000100.25), thought("th-c", 1700000050)] }, { moderator: true })).status).toBe(200);
    const again = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const hello2 = again.res.frames().find(([e]) => e === "hello")![1] as Record<string, unknown>;
    // The newest the server holds (last received), the worker's own stamp.
    expect(hello2["traceAfter"]).toEqual({ Trabolta: 1700000050 });
    rt.dispose();
  });

  it("the facts document says paused while the event is paused, and nothing otherwise", async () => {
    const rt = runtime();
    rt.openDoors();
    const facts = async () => (await call(rt, "GET", "/api/agent/facts", {}, { moderator: true })).json;
    expect("paused" in (await facts())).toBe(false);
    rt.pause();
    expect((await facts())["paused"]).toBe(true);
    rt.openDoors();
    expect("paused" in (await facts())).toBe(false);
    rt.dispose();
  });
});

// ───────────────────────── the show: what never reaches him ─────────────────────────

const SHOW = "trapped-in-the-internet";
const SHOW_DIR = scenarioDir(SHOW);
const SHOW_SRC = scenarioSource(SHOW);
const FACTS_TEXT = readFileSync(join(SHOW_DIR, FACTS_FILE), "utf8");
const FACTS = parseFactsText(FACTS_TEXT).facts!;
const SHOW_CODES = { event: "EVT913", prime: "PRM913", mod: "MOD913" };
const SLOW = 300_000;
const MARK = "▒ HUNT ANSWER";

/** Every answer form (hunt questions and the pickup line), read at run time. */
const KEYS = [...FACTS.questions.map((q) => ({ id: q.id, forms: [q.answer, ...q.accept], topics: q.topics ?? [] })), ...FACTS.answers.map((a) => ({ id: a.id, forms: [a.answer, ...a.accept], topics: [] as string[] }))];
/** A form made only of numbers below 100: counts only beside its own topic
 *  (a clock or a fragment number is everywhere), as trabolta-answers does. */
const weakForm = (form: string): boolean => {
  const t = nearTokens(form);
  return t.length > 0 && t.every((w) => /^[0-9]+$/u.test(w) && Number(w) < 100);
};
/** The ids of the answers `text` mentions (never the forms: nothing here prints one). */
function answerIdsIn(text: string): string[] {
  const out = new Set<string>();
  for (const k of KEYS) for (const f of k.forms) if (mentionsKey(text, f) && (!weakForm(f) || k.topics.some((t) => mentionsKey(text, t)))) out.add(k.id);
  return [...out];
}
const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
/** The mind file's generated `secrets.never` list, read at run time. */
function neverWords(): string[] {
  const mind = readFileSync(join(SHOW_DIR, "trabolta.mind.md"), "utf8");
  const block = /^ {2}never:\n((?: {4}- .*\n)+)/mu.exec(mind)?.[1] ?? "";
  return block
    .split("\n")
    .map((l) => l.replace(/^ {4}- /u, "").trim().replace(/^(['"])(.*)\1$/u, "$2"))
    .map(fold)
    .filter((w) => w !== "");
}
const hasPhrase = (text: string, phrase: string): boolean => ` ${fold(text)} `.includes(` ${phrase} `);

describe("on the show: recent and the history never carry a secret (C1.6)", () => {
  it("no secret codex title, no hunt-answer card, nothing from the Kernel, no verdict in a filing, no answer in a house line, from his introduction to the bob and his recount", { timeout: SLOW }, async () => {
    const d = mkdtempSync(join(tmpdir(), "loom-recent-show-"));
    dirs.push(d);
    const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: SHOW_CODES, scenarioName: SHOW, scenarioSource: SHOW_SRC, facts: FACTS_TEXT, joinBase: () => "http://localhost" });
    rt.openDoors();
    const sim = () => rt.liveSim!;
    const mod = async (name: string, extra: Record<string, unknown> = {}) => {
      const r = await call(rt, "POST", "/api/mod/signal", { name, ...extra }, { moderator: true });
      expect(r.status, name).toBe(200);
      return r;
    };
    const guests: Array<{ id: string; token: string; name: string }> = [];
    for (const name of ["Calculator", "Winamp", "Notepad", "Minesweeper"]) {
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
    const [calc, amp, pad, mine] = guests as [(typeof guests)[0], (typeof guests)[0], (typeof guests)[0], (typeof guests)[0]];
    const clippy = await call(rt, "POST", "/api/prime/login", { character: "Clippy", passcode: SHOW_CODES.prime });
    expect(clippy.status).toBe(200);
    const worker = await call(rt, "GET", "/api/agent/stream?characters=Trabolta&name=laptop", {}, { moderator: true });
    const requests = () => worker.res.frames().filter(([e]) => e === "request").map(([, x]) => x as AgentRequest);
    let answered = 0;
    const answerAll = async () => {
      for (const r of requests().slice(answered)) await call(rt, "POST", "/api/agent/reply", { id: r.id, say: "Your request has been logged.", adjust: {} }, { moderator: true });
      answered = requests().length;
    };
    const ask = async (g: (typeof guests)[0], text = "Hello. What do you need from me?") => {
      expect((await call(rt, "POST", "/api/guest/say", { channel: "dm:Trabolta", text }, { token: g.token })).status).toBe(200);
      await answerAll();
    };
    const askAll = async () => {
      for (const g of guests) await ask(g);
      expect((await call(rt, "POST", "/api/prime/say", { channel: "cast:Trabolta", text: "Boss, a report." }, { token: clippy.json["token"] as string })).status).toBe(200);
      await answerAll();
    };
    /** Every guest offers him every entry they hold: the story refuses the
     *  secret and the others' lore; what lands is a gift. */
    const offerAll = async () => {
      for (const g of guests) for (const e of sim().codexFor(g.id)) await call(rt, "POST", "/api/guest/codex/share", { entry: e.id, to: "Trabolta" }, { token: g.token });
    };
    const file = async (g: (typeof guests)[0], question: string, answer: string, confidence = 100) => {
      const card = rt.chatHistoryFor(g.id).filter((m) => m.kind === "widget" && m.widget?.kind === "fact").at(-1);
      expect(card, `${g.name}'s fact card`).toBeDefined();
      return call(rt, "POST", "/api/guest/widget", { seq: card!.seq, result: { question, answer, confidence } }, { token: g.token });
    };
    const codeOf = (q: string) => FACTS.questions.find((x) => x.id === q)!.codex!.code;
    const keyOf = (q: string) => FACTS.questions.find((x) => x.id === q)!.answer;

    // Walk the night, asking him at every turn.
    for (const n of TO_Y2K.slice(0, 4)) await mod(n); // → introduce_trabolta
    await askAll();
    await mod("mark_for_reinstallation", { subject: mine.id, args: { reason: "a test" } });
    await mod("start_the_hunt");
    for (const g of guests.slice(0, 3)) for (const q of ["H1", "H2", "H3"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    expect((await file(calc, "H1", keyOf("H1"))).status).toBe(200);
    expect((await file(amp, "H2", keyOf("H2"))).status).toBe(200);
    expect((await file(pad, "H3", keyOf("H3"), 60)).status).toBe(200);
    expect((await file(pad, "H2", "a wrong guess")).status).toBe(200);
    await offerAll();
    await askAll();
    for (const n of TO_Y2K.slice(5, 13)) await mod(n); // → the second hunt
    rt.tickOnce(120_000); // the Truther Download
    for (const g of guests.slice(0, 3)) for (const q of ["H4", "H5", "H6"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    expect((await file(calc, "H4", keyOf("H4"))).status).toBe(200);
    await call(rt, "POST", "/api/guest/codex/redeem", { code: "TRABOLTA-4EVER" }, { token: calc.token });
    // Winamp brings a virus back and plants it: the Kernel names the planter.
    expect((await call(rt, "POST", "/api/mod/codex", { who: amp.id, entry: "ILOVEYOU" }, { moderator: true })).status).toBe(200);
    expect((await call(rt, "POST", "/api/guest/act", { name: "plant_the_virus" }, { token: amp.token })).status).toBe(200);
    expect(sim().world.peek("Kernel.virus_planter")).toMatchObject({ value: amp.name });
    await offerAll();
    await askAll();
    for (const n of TO_Y2K.slice(13, 19)) await mod(n); // → the Trust Chart and the rankings
    await askAll();
    await mod("printer_opened");
    await mod("trabolta_overshares");
    for (const g of guests.slice(0, 3)) for (const q of ["F1", "F2"]) await call(rt, "POST", "/api/guest/codex/redeem", { code: codeOf(q) }, { token: g.token });
    await offerAll();
    await askAll();
    await mod("y2k_clock");
    await askAll();
    rt.tickOnce(3_600_000); // midnight: the final reveal
    expect(sim().world.peek("Night.phase")).toMatchObject({ value: "final_reveal" });
    await askAll();
    await mod("bobbing_for_truth");
    expect(sim().world.peek("Night.phase")).toMatchObject({ value: "bobbing" });
    await askAll(); // the bob: the verdict is not read yet
    const beforeRecount = requests().length;
    // His recount, said to the whole house, names the planter (a Kernel value).
    expect((await call(rt, "POST", "/api/mod/beat", { name: "Trabolta Recounts" }, { moderator: true })).status).toBe(200);
    const virusLine = rt.chatHistoryFor(calc.id).find((m) => m.from === "Trabolta" && m.audience === "all" && hasPhrase(m.text, fold(amp.name)) && /planted a virus/u.test(m.text));
    expect(virusLine, "the recount's virus line").toBeDefined();
    // The runtime's own rule (a secret: true character's string values,
    // the participants' names) drops it; the newest two of his recount
    // reach the requests below, and none may name the planter.
    expect(sim().model.characters.get("Kernel")?.secret).toBe(true);
    const kernelStrings = sim()
      .world.entries()
      .flatMap(([path, v]) => (path.startsWith("Kernel.") && v.kind === "string" ? [v.value] : []));
    expect(secretMentions(kernelStrings, [...sim().persons.values()].map((p) => p.name))(virusLine!.text)).toBe(true);
    await askAll();
    expect(requests().length).toBeGreaterThan(beforeRecount);

    // ── the checks, over every request the worker saw ──
    const all = requests();
    expect(all.length).toBeGreaterThan(20);
    const secretTitles = [...sim().model.codex.values()].filter((e) => e.secret).flatMap((e) => [e.id, e.title]).map(fold);
    // Every Kernel string value (verdicts, combos, facts.json door.code,
    // the said / answer logs, the planter …) of four letters or more,
    // except a participant's display name (a guest's own name is in their
    // thread anyway; the planter's is checked on its own below).
    const names = new Set([...sim().persons.values()].map((p) => fold(p.name)));
    const kernel = [
      ...new Set(
        sim()
          .world.entries()
          .flatMap(([path, v]) => (path.startsWith("Kernel.") && v.kind === "string" ? [fold(v.value)] : []))
          .filter((v) => v.length >= 4 && v !== "none" && !names.has(v)),
      ),
    ];
    expect(kernel.length, "Kernel values to look for").toBeGreaterThan(3);
    const planter = fold(amp.name);
    const doorCode = fold(String(FACTS.door?.code ?? ""));
    const never = neverWords();
    expect(never.length).toBeGreaterThan(0);
    const questionIds = new Set([...FACTS.questions.map((q) => q.id), ...FACTS.answers.map((a) => a.id)]);
    const leaks: string[] = [];
    const seen = new Set<string>();
    /** What may never reach him in any text: a hunt-answer card's marker,
     *  the Kernel, its values, facts.json door.code, a secrets.never word. */
    const scanSecret = (where: string, text: string) => {
      if (text.includes(MARK)) leaks.push(`${where}: a hunt-answer marker`);
      if (/kernel/iu.test(text)) leaks.push(`${where}: names the Kernel`);
      for (const k of kernel) if (hasPhrase(text, k)) leaks.push(`${where}: a Kernel value`);
      if (doorCode !== "" && hasPhrase(text, doorCode)) leaks.push(`${where}: facts.json door.code`);
      for (const n of never) if (hasPhrase(text, n)) leaks.push(`${where}: a secrets.never word`);
    };
    /** An entry's title (a gift, the guest's codex) is never a secret one.
     *  Only titles: a house line reading a hunt question aloud names the
     *  card's subject ("the ribbon-cutting") and is public. */
    const scanTitle = (where: string, title: string) => {
      if (secretTitles.includes(fold(title))) leaks.push(`${where}: a secret codex title`);
    };
    const scanAnswers = (where: string, text: string) => {
      for (const id of answerIdsIn(text)) leaks.push(`${where}: mentions the answer to ${id}`);
    };
    for (const [i, r] of all.entries()) {
      const at = `request ${i} (${r.speaker.name}, ${String(r.world["Night.phase"])})`;
      expect(Array.isArray(r.recent), at).toBe(true);
      expect(r.recent!.length, at).toBeLessThanOrEqual(6);
      for (const item of r.recent!) {
        seen.add(item.kind);
        scanSecret(`${at} recent ${item.kind}`, JSON.stringify(item));
        if (item.kind === "filing") {
          expect(Object.keys(item).sort(), at).toEqual(["kind", "question"]);
          expect(questionIds.has(item.question), `${at}: ${item.question}`).toBe(true);
        }
        if (item.kind === "house") {
          scanAnswers(`${at} recent house`, item.text);
          // The planter is a Kernel value: no house line naming them reaches him.
          if (hasPhrase(item.text, planter)) leaks.push(`${at} recent house: names the virus planter`);
        }
        if (item.kind === "gift") {
          scanTitle(`${at} recent gift`, item.title);
          scanAnswers(`${at} recent gift`, item.title);
        }
      }
      if (r.speaker.kind === "performer") expect(r.recent!.every((x) => x.kind === "gift" || x.kind === "house"), at).toBe(true);
      // The house's lines in the thread; a guest's own lines are theirs to type.
      for (const l of r.history) {
        if (!l.mine && l.from === r.speaker.name) continue;
        scanSecret(`${at} history ${l.seq}`, l.text);
        scanAnswers(`${at} history ${l.seq}`, l.text);
      }
      // The guest's codex: titles only, never a secret one.
      expect(r.them.codex.every((e) => e.text === ""), at).toBe(true);
      for (const e of r.them.codex) {
        scanTitle(`${at} them.codex`, e.title);
        scanSecret(`${at} them.codex`, e.title);
      }
    }
    expect(leaks).toEqual([]);
    // Not vacuous: every kind showed up on the way.
    expect([...seen].sort()).toEqual(["chart", "filing", "gift", "house", "marked"]);
    // And the story's lines in his threads were tagged.
    expect(all.some((r) => r.history.some((l) => l.story === true))).toBe(true);
    rt.dispose();
  });
});
