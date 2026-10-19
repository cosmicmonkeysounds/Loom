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

import { buildRecent, storyTag, storyTexts, type RecentInput, type StoryTagContext } from "../server/agent-recent.ts";
import type { AgentRecent, AgentRequest } from "../server/agents.ts";
import type { ChatMessage } from "../server/chat.ts";
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
    expect(buildRecent(input({ messages, storyAt: 2_000_000 })).map((r) => r.at)).toEqual([150_000, 900_000, 100_000]);
    // He answered at 1.9 M: the last 10 minutes reach further (1.4 M) — nothing.
    expect(buildRecent(input({ messages, storyAt: 2_000_000, lastFreeReply: 1_900_000 }))).toEqual([]);
    // He answered at 800 k, the guest came back at 2 M: since 800 k.
    expect(buildRecent(input({ messages, storyAt: 2_000_000, lastFreeReply: 800_000 }))).toEqual([{ kind: "gift", title: "The Recipe", new: true, at: 900_000 }]);
    // He answered at 1.9 M, the guest came back at 1.95 M: the last 10 minutes (from 1.35 M).
    expect(buildRecent(input({ messages: [...messages, house("recent", 1_400_000)], storyAt: 1_950_000, lastFreeReply: 1_900_000 }))).toEqual([{ kind: "house", text: "recent", at: 1_400_000 }]);
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
