// Wave 48 (docs/loom-w48-contract.md C2) and 48b (C8–C11): the Password
// Manager's filter on the server. A guest's line the filter catches at the
// censor's strength is flagged (journaled as `swear_flagged`) and listed on
// her booth; ✂ (`POST /api/prime/censor`) journals `swear_censored` with
// what it paid, masks the line for everyone and re-sends it; `POST
// /api/prime/filter` sets the strength; a slur is starred before the line
// is stored; a restart rebuilds it all from the journal. No slur is
// written here: the slur cases read `FILTER_SLURS`.

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { EventRuntime } from "../server/event-runtime.ts";
import { FILTER_VIEW_MAX, FilterBook } from "../server/language-filter.ts";
import { Store } from "../server/store.ts";
import { FILTER_SLURS, UNSAID_WORD, filterHits } from "../src/language-filter.ts";
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
  paid: text = "none"

CHARACTER Censor
  listed: true

  when swear_censored for program:
    set program.censored_n += words
    set program.heard = list + " | " + fresh
    set program.paid = points + " x " + mult + " = " + stars + " | " + unsaid + " | " + top
    reply ✂ {program.name}: {list}.

CHARACTER Clerk
  listed: true

when swear_flagged for program:
  set program.flagged_n += words

when swear_filter:
  set Night.strength = level
  set Night.moves += 1

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

  it("only reads what a guest sent: never a director speaking as them, never a character (48b)", async () => {
    const { rt, guest, censor } = await setup();
    expect((await call(rt, "POST", "/api/mod/say", { as: guest.id, channel: "lobby", text: "what the hell" }, { moderator: true })).status).toBe(200);
    expect((await call(rt, "POST", "/api/mod/say", { as: "Clerk", channel: "lobby", text: "what the hell" }, { moderator: true })).status).toBe(200);
    expect((await boothView(rt, censor)).filter?.lines).toEqual([]);
    await say(rt, guest.token, "what the hell");
    expect((await boothView(rt, censor)).filter?.lines.map((l) => l.name)).toEqual(["Calculator"]);
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
    // hello (1) + password (1), rested: ×3.
    expect(r.json).toEqual({ ok: true, seq, text: "****o! My p***word is 1234.", points: 2, mult: 3, stars: 6 });
    const mine = (await history(rt, guest.token)).find((m) => m.seq === seq)!;
    expect(mine).toMatchObject({ text: "****o! My p***word is 1234.", censored: true });
    // The guest's open stream got a silent upsert, never a new `message`.
    const moderated = stream.res.frames().filter(([e]) => e === "messageModerated").map(([, d]) => d as M);
    expect(moderated.map((m) => [m.seq, m.text])).toEqual([[seq, "****o! My p***word is 1234."]]);
    expect(slot(rt, `${guest.id}.censored_n`)).toBe(2);
    expect(slot(rt, `${guest.id}.heard`)).toBe("hello, password | hello, password");
    const view = await boothView(rt, censor);
    expect(view.filter).toMatchObject({ flagged: 2, censored: 2, stars: 6, lines: [] });
    expect(slot(rt, `${guest.id}.paid`)).toBe("2 x 3 = 6 | 0 | hello, password");
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
    expect((await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: censor })).status).toBe(200);
    const before = await boothView(rt, censor);
    const historyBefore = await history(rt, guest.token);
    rt.dispose();
    const again = runtime(dir);
    expect(again.restore()).not.toBeNull();
    const after = await boothView(again, censor);
    const { combo: comboAfter, ...restAfter } = after.filter!;
    const { combo: comboBefore, ...restBefore } = before.filter!;
    expect(restAfter).toEqual(restBefore);
    expect(comboAfter.heat).toBeCloseTo(comboBefore.heat, 1);
    expect(after.filter).toMatchObject({ flagged: 3, censored: 2, level: 25, muted: 1, stars: 6 });
    expect((await history(again, guest.token)).map((m) => [m.seq, m.text, m.censored ?? false])).toEqual(historyBefore.map((m) => [m.seq, m.text, m.censored ?? false]));
    again.dispose();
  });
});

describe("wave 48: the book", () => {
  it("keeps the newest waiting lines, oldest first", () => {
    const book = new FilterBook();
    for (let seq = 0; seq < FILTER_VIEW_MAX + 5; seq++) book.flag({ seq, guest: "g", where: "# lobby", text: "hell", hits: filterHits("hell"), ts: 0 });
    book.censor(FILTER_VIEW_MAX + 4, filterHits("hell"), { stars: 6, heat: 1, at: 0 });
    const v = book.view({ hidden: () => false, nameOf: () => "G", avatarOf: () => null, now: 0 });
    expect(v.lines).toHaveLength(FILTER_VIEW_MAX);
    expect(v.lines[0]!.seq).toBe(4);
    expect(v.lines[FILTER_VIEW_MAX - 1]!.seq).toBe(FILTER_VIEW_MAX + 3);
    expect(v.flagged).toBe(FILTER_VIEW_MAX + 5);
    expect(v.censored).toBe(1);
  });
});

describe("wave 48b: the strength (C8)", () => {
  it("starts at 100, moves in steps of 5, and only the censor moves it", async () => {
    const { rt, guest, censor } = await setup();
    expect((await boothView(rt, censor)).filter?.level).toBe(100);
    for (const level of [-5, 7, 105, "50", null]) expect((await call(rt, "POST", "/api/prime/filter", { level }, { token: censor })).json).toEqual({ error: "level is 0–100 in steps of 5" });
    expect((await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: guest.token })).status).toBe(403);
    const clerk = (await call(rt, "POST", "/api/prime/login", { character: "Clerk", passcode: CODES.prime })).json["token"] as string;
    expect((await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: clerk })).json).toEqual({ error: "not the censor" });
    expect((await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: censor })).json).toEqual({ ok: true, level: 25 });
    expect((await boothView(rt, censor)).filter?.level).toBe(25);
    expect(slot(rt, "Night.strength")).toBe(25);
    // The same strength again journals nothing.
    expect((await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: censor })).json).toEqual({ ok: true, level: 25 });
    expect(slot(rt, "Night.moves")).toBe(1);
    rt.dispose();
  });

  it("flags only what the strength catches, counts the words caught at the time, and mutes what it no longer catches", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "hello there");
    await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: censor });
    let view = await boothView(rt, censor);
    expect(view.filter).toMatchObject({ flagged: 1, muted: 1, lines: [] });
    // A new hello is not caught at 25 (never re-read later); a shit is.
    await say(rt, guest.token, "hello again");
    await say(rt, guest.token, "oh shit, hello");
    view = await boothView(rt, censor);
    expect(view.filter?.flagged).toBe(2);
    expect(view.filter?.lines.map((l) => [l.words, l.points, l.hits.map((h) => h.tier)])).toEqual([[["shit"], 5, [25]]]);
    expect(slot(rt, `${guest.id}.flagged_n`)).toBe(2);
    // Back up to 100: the first hello shows again; "hello again" was never caught.
    await call(rt, "POST", "/api/prime/filter", { level: 100 }, { token: censor });
    view = await boothView(rt, censor);
    expect(view.filter?.lines.map((l) => l.text)).toEqual(["hello there", "oh shit, hello"]);
    expect(view.filter?.lines[1]?.words).toEqual(["shit"]);
    rt.dispose();
  });

  it("censors only what the strength catches now, and refuses a line it no longer catches", async () => {
    const { rt, guest, censor } = await setup();
    await say(rt, guest.token, "hello shit");
    await say(rt, guest.token, "check");
    const [both, check] = (await boothView(rt, censor)).filter!.lines;
    await call(rt, "POST", "/api/prime/filter", { level: 25 }, { token: censor });
    expect((await call(rt, "POST", "/api/prime/censor", { seq: check!.seq }, { token: censor })).json).toEqual({ error: "the filter no longer catches it" });
    const r = await call(rt, "POST", "/api/prime/censor", { seq: both!.seq }, { token: censor });
    expect(r.json).toMatchObject({ text: "hello ****", points: 5, mult: 3, stars: 15 });
    expect(slot(rt, `${guest.id}.heard`)).toBe("shit | shit");
    expect((await boothView(rt, censor)).filter).toMatchObject({ flagged: 3, censored: 1 });
    rt.dispose();
  });
});

describe("wave 48b: the ⭐ mini-game (C10)", () => {
  it("pays less the faster she censors", async () => {
    const { rt, guest, censor } = await setup();
    for (const t of ["shit", "shit", "shit"]) await say(rt, guest.token, t);
    const lines = (await boothView(rt, censor)).filter!.lines;
    const paid = [];
    for (const l of lines) paid.push((await call(rt, "POST", "/api/prime/censor", { seq: l.seq }, { token: censor })).json);
    expect(paid.map((p) => [p["mult"], p["stars"]])).toEqual([
      [3, 15],
      [2, 10],
      [1.5, 7],
    ]);
    const view = await boothView(rt, censor);
    expect(view.filter?.stars).toBe(32);
    expect(view.filter?.combo.heat).toBeGreaterThan(2.9);
    expect(view.filter?.combo).toMatchObject({ coolMs: 20_000, mults: [3, 2, 1.5, 1, 0.5, 0.25] });
    rt.dispose();
  });
});

/** Every file the runtime wrote under its state directory, as text. */
function stateText(dir: string): string {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join(dir, "state"));
  return out.join("\n");
}

describe("wave 48b: slurs (C9)", () => {
  const slur = FILTER_SLURS[9]!;

  it("stars a slur before the line is stored, still alerts the censor, and never journals it", async () => {
    const { dir, rt, guest, censor } = await setup();
    await call(rt, "POST", "/api/prime/filter", { level: 0 }, { token: censor });
    await say(rt, guest.token, `you ${slur}, hello`);
    const starred = `you ${"*".repeat(slur.length)}, hello`;
    expect((await history(rt, guest.token)).at(-1)?.text).toBe(starred);
    const line = (await boothView(rt, censor)).filter!.lines[0]!;
    expect(line).toMatchObject({ text: starred, words: [UNSAID_WORD], points: 12 });
    const r = await call(rt, "POST", "/api/prime/censor", { seq: line.seq }, { token: censor });
    expect(r.json).toMatchObject({ text: starred, points: 12, mult: 3, stars: 36 });
    expect(slot(rt, `${guest.id}.heard`)).toBe(`${UNSAID_WORD} | `);
    expect(slot(rt, `${guest.id}.paid`)).toBe("12 x 3 = 36 | 1 | ");
    rt.dispose();
    expect(stateText(dir)).not.toContain(slur);
  });

  it("stars a slur a director types as a guest too, without flagging it", async () => {
    const { rt, guest, censor } = await setup();
    await call(rt, "POST", "/api/mod/say", { as: guest.id, channel: "lobby", text: `a ${slur}` }, { moderator: true });
    expect((await history(rt, guest.token)).at(-1)?.text).toBe(`a ${"*".repeat(slur.length)}`);
    expect((await boothView(rt, censor)).filter?.lines).toEqual([]);
    rt.dispose();
  });

  it("leaves a story without a censor: header alone", async () => {
    const { rt, guest } = await setup(STORY.replace("censor: Censor\n", ""));
    await say(rt, guest.token, `a ${slur}`);
    expect((await history(rt, guest.token)).at(-1)?.text).toBe(`a ${slur}`);
    rt.dispose();
  });
});

describe("wave 48b: the book's tallies", () => {
  it("counts each censored word, most first, never a slur", () => {
    const book = new FilterBook();
    const lines = ["hello", "hello password", "shit hello", FILTER_SLURS[0]!];
    lines.forEach((text, seq) => book.flag({ seq, guest: "g", where: "# lobby", text, hits: filterHits(text), ts: 0 }));
    lines.forEach((text, seq) => book.censor(seq, filterHits(text), { stars: 1, heat: 1, at: 0 }));
    expect(book.wordCounts()).toEqual([
      { word: "hello", n: 3 },
      { word: "password", n: 1 },
      { word: "shit", n: 1 },
    ]);
    expect(book.top(2)).toBe("hello, password");
    expect(book.unsaid).toBe(1);
    expect(book.stars).toBe(4);
    expect(book.fresh(filterHits(`hello button ${FILTER_SLURS[0]!}`))).toEqual(["button"]);
  });
});
