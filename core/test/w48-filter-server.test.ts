// Wave 48 (docs/loom-w48-contract.md C2): the Password Manager's filter on
// the server. A guest's line with a swear stem is flagged (journaled as
// `swear_flagged`) and listed on the censor's booth; ✂ (`POST
// /api/prime/censor`) journals `swear_censored`, masks the line for everyone
// and re-sends it; a restart rebuilds both from the journal.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import { FILTER_VIEW_MAX, FilterBook } from "../server/language-filter.ts";
import { Store } from "../server/store.ts";
import { filterHits } from "../src/language-filter.ts";
import type { PrimeView } from "../server/views.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CODES = { event: "EVT648", prime: "PRM648", mod: "MOD648" };
const STORY = `# Filter
start: Boot
censor: Censor

LOCATION Lobby
  label: The Lobby

ROLE Program
  flagged_n: 0 to 1000 = 0
  censored_n: 0 to 1000 = 0
  heard: text = "none"

CHARACTER Censor
  listed: true

  when swear_censored for program:
    set program.censored_n += words
    set program.heard = list + " | " + fresh
    reply ✂ {program.name}: {list}.

CHARACTER Clerk
  listed: true

when swear_flagged for program:
  set program.flagged_n += words

== Boot
  setting: Lobby
Nothing yet.
`;

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

/** A response that records SSE frames as `[event, data]`. */
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

async function call(rt: EventRuntime, method: string, path: string, body: unknown = {}, o: { moderator?: boolean; token?: string } = {}) {
  const url = new URL(`http://x${path}`);
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

function runtime(dir: string, source = STORY): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(join(dir, "state")), codes: CODES, scenarioName: "filter", scenarioSource: source, joinBase: () => "http://localhost", houseFile: join(dir, "nowhere", "house.json") });
}

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-w48-"));
  dirs.push(d);
  return d;
}

async function setup(source = STORY) {
  const dir = tmp();
  const rt = runtime(dir, source);
  rt.openDoors();
  const g = await call(rt, "POST", "/api/guest/register", { name: "Calculator", passcode: CODES.event });
  const guest = { id: g.json["id"] as string, token: g.json["token"] as string };
  const login = await call(rt, "POST", "/api/prime/login", { character: "Censor", passcode: CODES.prime });
  const censor = login.json["token"] as string;
  return { dir, rt, guest, censor };
}

const say = (rt: EventRuntime, token: string, text: string, channel = "lobby") => call(rt, "POST", "/api/guest/say", { channel, text }, { token });
const boothView = async (rt: EventRuntime, token: string) => (await call(rt, "GET", `/api/state?role=prime&token=${token}`)).json as unknown as PrimeView;
type M = { seq: number; from: string; text: string; censored?: true };
const history = async (rt: EventRuntime, token: string) => (await call(rt, "GET", "/api/history", {}, { token })).json["messages"] as M[];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const slot = (rt: EventRuntime, path: string): any => ((rt as unknown as { sim: { world: { get(p: string): { value?: unknown } | undefined } } }).sim.world.get(path) as { value?: unknown } | undefined)?.value;

describe("wave 48: flagging a guest's line (C2)", () => {
  it("lists a line with a stem on the censor's booth only, and the story counts its words", async () => {
    const { rt, guest, censor } = await setup();
    expect((await say(rt, guest.token, "Hello! My password is 1234.")).status).toBe(200);
    expect((await say(rt, guest.token, "All clean here.")).status).toBe(200);
    const view = await boothView(rt, censor);
    expect(view.filter?.flagged).toBe(2);
    expect(view.filter?.censored).toBe(0);
    expect(view.filter?.lines).toHaveLength(1);
    const line = view.filter!.lines[0]!;
    expect(line).toMatchObject({ guest: guest.id, name: "Calculator", text: "Hello! My password is 1234.", words: ["hello", "password"] });
    expect(line.hits.map((h) => line.text.slice(h.start, h.end))).toEqual(["Hell", "ass"]);
    expect(line.where).toBeTruthy();
    expect(slot(rt, `${guest.id}.flagged_n`)).toBe(2);
    // Another part's booth never sees the filter.
    const clerk = (await call(rt, "POST", "/api/prime/login", { character: "Clerk", passcode: CODES.prime })).json["token"] as string;
    expect((await boothView(rt, clerk)).filter).toBeUndefined();
    rt.dispose();
  });

  it("flags a director speaking as a guest, never a character's line", async () => {
    const { rt, guest, censor } = await setup();
    expect((await call(rt, "POST", "/api/mod/say", { as: guest.id, channel: "lobby", text: "what the hell" }, { moderator: true })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/say", { as: "Clerk", channel: "lobby", text: "what the hell" }, { moderator: true })).status).toBe(200);
    const view = await boothView(rt, censor);
    expect(view.filter?.lines.map((l) => l.name)).toEqual(["Calculator"]);
    rt.dispose();
  });

  it("says where a DM to a character was typed", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "darn it", "dm:Clerk");
    expect((await boothView(rt, censor)).filter?.lines[0]?.where).toBe("DM to Clerk");
    rt.dispose();
  });

  it("does nothing at all without a censor: header", async () => {
    const { dir, rt, guest } = await setup(STORY.replace("censor: Censor\n", ""));
    await say(rt, guest.token, "my password");
    const clerk = (await call(rt, "POST", "/api/prime/login", { character: "Censor", passcode: CODES.prime })).json["token"] as string;
    expect((await boothView(rt, clerk)).filter).toBeUndefined();
    expect(slot(rt, `${guest.id}.flagged_n`)).toBe(0);
    rt.dispose();
    void dir;
  });
});

describe("wave 48: ✂ the censor (C2)", () => {
  it("masks the line for everyone, journals the story's signal and drops it from the list", async () => {
    const { rt, guest, censor } = await setup();
    const stream = await call(rt, "GET", `/events?role=guest&token=${guest.token}`);
    await say(rt, guest.token, "Hello! My password is 1234.");
    const seq = (await boothView(rt, censor)).filter!.lines[0]!.seq;
    const r = await call(rt, "POST", "/api/prime/censor", { seq }, { token: censor });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, seq, text: "****o! My p***word is 1234." });
    const mine = (await history(rt, guest.token)).find((m) => m.seq === seq)!;
    expect(mine).toMatchObject({ text: "****o! My p***word is 1234.", censored: true });
    // The guest's open stream got a silent upsert, never a new `message`.
    const moderated = stream.res.frames().filter(([e]) => e === "messageModerated").map(([, d]) => d as M);
    expect(moderated.map((m) => [m.seq, m.text])).toEqual([[seq, "****o! My p***word is 1234."]]);
    expect(slot(rt, `${guest.id}.censored_n`)).toBe(2);
    expect(slot(rt, `${guest.id}.heard`)).toBe("hello, password | hello, password");
    const view = await boothView(rt, censor);
    expect(view.filter).toMatchObject({ flagged: 2, censored: 2, lines: [] });
    // Again: already censored. Unknown: not flagged.
    expect((await call(rt, "POST", "/api/prime/censor", { seq }, { token: censor })).json).toEqual({ error: "already censored" });
    expect((await call(rt, "POST", "/api/prime/censor", { seq: 9999 }, { token: censor })).status).toBe(404);
    rt.dispose();
  });

  it("passes only the words nobody censored before as fresh", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "hello");
    await say(rt, guest.token, "hello button");
    const [a, b] = (await boothView(rt, censor)).filter!.lines;
    await call(rt, "POST", "/api/prime/censor", { seq: a!.seq }, { token: censor });
    await call(rt, "POST", "/api/prime/censor", { seq: b!.seq }, { token: censor });
    expect(slot(rt, `${guest.id}.heard`)).toBe("hello, button | button");
    rt.dispose();
  });

  it("is the censor's alone, and refuses a hidden line", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "crap");
    const seq = (await boothView(rt, censor)).filter!.lines[0]!.seq;
    const clerk = (await call(rt, "POST", "/api/prime/login", { character: "Clerk", passcode: CODES.prime })).json["token"] as string;
    expect((await call(rt, "POST", "/api/prime/censor", { seq }, { token: clerk })).json).toEqual({ error: "not the censor" });
    expect((await call(rt, "POST", "/api/prime/censor", { seq })).status).toBe(403);
    // A director hides it: it leaves the booth's list and can't be censored.
    expect((await call(rt, "POST", "/api/mod/message", { seq, hidden: true }, { moderator: true })).status).toBe(200);
    expect((await boothView(rt, censor)).filter?.lines).toEqual([]);
    expect((await call(rt, "POST", "/api/prime/censor", { seq }, { token: censor })).json).toEqual({ error: "not flagged" });
    rt.dispose();
  });
});

describe("wave 48: a restart (C2)", () => {
  it("rebuilds the flags and the masks from the journal", async () => {
    const { dir, rt, guest, censor } = await setup();
    await say(rt, guest.token, "Hello! My password is 1234.");
    await say(rt, guest.token, "check this");
    const [first] = (await boothView(rt, censor)).filter!.lines;
    await call(rt, "POST", "/api/prime/censor", { seq: first!.seq }, { token: censor });
    const before = await boothView(rt, censor);
    const historyBefore = await history(rt, guest.token);
    rt.dispose();
    const again = runtime(dir);
    expect(again.restore()).not.toBeNull();
    const after = await boothView(again, censor);
    expect(after.filter).toEqual(before.filter);
    expect(after.filter).toMatchObject({ flagged: 3, censored: 2 });
    expect((await history(again, guest.token)).map((m) => [m.seq, m.text, m.censored ?? false])).toEqual(historyBefore.map((m) => [m.seq, m.text, m.censored ?? false]));
    again.dispose();
  });
});

describe("wave 48: the book", () => {
  it("keeps the newest waiting lines, oldest first", () => {
    const book = new FilterBook();
    for (let seq = 0; seq < FILTER_VIEW_MAX + 5; seq++) book.flag({ seq, guest: "g", where: "# lobby", text: "hell", hits: filterHits("hell"), ts: 0 });
    book.censor(FILTER_VIEW_MAX + 4);
    const v = book.view({ hidden: () => false, nameOf: () => "G", avatarOf: () => null });
    expect(v.lines).toHaveLength(FILTER_VIEW_MAX);
    expect(v.lines[0]!.seq).toBe(4);
    expect(v.lines[FILTER_VIEW_MAX - 1]!.seq).toBe(FILTER_VIEW_MAX + 3);
    expect(v.flagged).toBe(FILTER_VIEW_MAX + 5);
    expect(v.censored).toBe(1);
  });
});
