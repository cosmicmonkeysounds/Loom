//! Wave 59 — one holder (`server/routes/rejoin.ts`, its One holder header):
//! once a printed card is claimed it can't be claimed until it's released.
//! Every path goes through a real `EventRuntime`.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { HELD_ERROR, RejoinDesk } from "../server/routes/rejoin.ts";
import { SIGNED_OUT } from "../server/routes/n02.ts";

const CODES = { event: "EVT559", prime: "PRM559", mod: "MOD559" };

const SOURCE = `# Claims
start: Opening
currency: Truthcoin
wallet: 10

LOCATION Hall

CHARACTER Microsoft Excel
  reserved: true

CHARACTER OpenOffice
  reserved: true

CHARACTER Calculator

CHARACTER Winamp

CHARACTER Clippy
  when scanned by guest:
    Clippy: It looks like you're scanning.

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when scanned by guest:
    Task Manager: Watching.

CODEX The Secret
  code: SECRET-59
  A thing to know.

== Opening
  setting: Hall
The lights come on.
`;

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-claims-"));
  dirs.push(d);
  return d;
}
function runtimeAt(d: string): EventRuntime {
  return new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "claims", scenarioSource: SOURCE, joinBase: () => "https://app.example.com" });
}
function open(): EventRuntime {
  const rt = runtimeAt(freshDir());
  rt.openDoors();
  return rt;
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    socket: { remoteAddress: "10.0.0.9" },
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string; frames: string[]; ended: boolean } {
  const res = {
    statusCode: 0,
    body: "",
    frames: [] as string[],
    ended: false,
    setHeader() {},
    writeHead(s: number) {
      res.statusCode = s;
      return res;
    },
    flushHeaders() {},
    write(chunk: string) {
      res.frames.push(String(chunk));
      return true;
    },
    end(b?: string) {
      res.ended = true;
      if (typeof b === "string") res.body = b;
      return res;
    },
    on() {},
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; frames: string[]; ended: boolean };
}
async function mod(rt: EventRuntime, path: string, body: unknown) {
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, "POST", path, new URL(`http://x${path}`), { moderator: true, moderatorName: "Ada" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function post(rt: EventRuntime, path: string, body: Record<string, unknown>, token?: string) {
  const res = fakeRes();
  await rt.handle(fakeReq(token !== undefined ? { ...body, token } : body), res, "POST", path, new URL(`http://x${path}`), {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function state(rt: EventRuntime, query: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?${query}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
function stream(rt: EventRuntime, query: string) {
  const res = fakeRes();
  const url = new URL(`http://x/events?${query}`);
  void rt.handle(fakeReq({}), res, "GET", "/events", url, {});
  return res;
}
const guestState = (rt: EventRuntime, token: string) => state(rt, `role=guest&token=${token}`);
const boothState = (rt: EventRuntime, token: string) => state(rt, `role=prime&token=${token}`);

async function register(rt: EventRuntime, name: string, extra: Record<string, unknown> = {}) {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event, ...extra });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
async function blank(rt: EventRuntime, n: number): Promise<string> {
  const r = await mod(rt, "/api/mod/badges", { from: n, count: 1 });
  return r.json.badges[0].code as string;
}
type Invited = { character: string; claim: string; ref: string; code: string; url: string };
async function invited(rt: EventRuntime, who: string): Promise<Invited & { badge: string }> {
  const l = ((await mod(rt, "/api/mod/codes", {})).json.claims as Invited[]).find((c) => c.character === who)!;
  return { ...l, badge: new URL(l.url).searchParams.get("badge")! };
}
async function partOf(rt: EventRuntime, who: string): Promise<string> {
  return ((await mod(rt, "/api/mod/codes", {})).json.castLinks as Array<{ character: string; part: string }>).find((c) => c.character === who)!.part;
}
const enter = (rt: EventRuntime, body: Record<string, unknown>, token?: string) => post(rt, "/api/guest/enter", { passcode: CODES.event, ...body }, token);
const staffBadge = (rt: EventRuntime, part: string, token?: string) => post(rt, "/api/prime/login", { passcode: CODES.event, part }, token);

describe("one holder", () => {
  it("a linked blank badge refuses a second phone, in any form, and names nobody", async () => {
    const rt = open();
    const code = await blank(rt, 3);
    await register(rt, "Calculator", { badge: code });
    for (const form of [code, code.toLowerCase(), code.replace("-", " ")]) {
      const r = await enter(rt, { badge: form });
      expect(r.status).toBe(409);
      expect(r.json).toEqual({ error: HELD_ERROR, held: true, ref: "B003" });
    }
    // No token was minted: nobody but the one phone can read the guest.
    expect(rt.liveSim!.persons.size).toBe(1);
  });

  it("an invited badge and a bare claim refuse with the name printed on them", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    await register(rt, "Microsoft Excel", { claim: l.claim, badge: l.badge });
    const byBadge = await enter(rt, { badge: l.badge, claim: l.claim });
    expect(byBadge.status).toBe(409);
    expect(byBadge.json).toMatchObject({ held: true, name: "Microsoft Excel", ref: l.ref });
    const byClaim = await enter(rt, { claim: l.claim });
    expect(byClaim.status).toBe(409);
    expect(byClaim.json).toMatchObject({ held: true, name: "Microsoft Excel" });
    expect(byClaim.json.token).toBeUndefined();
  });

  it("a staff badge refuses while a booth holds the part; the old booth is untouched", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    const a = await staffBadge(rt, part);
    expect(a.status).toBe(200);
    for (const code of [part, part.toUpperCase()]) {
      const b = await staffBadge(rt, code);
      expect(b.status).toBe(409);
      expect(b.json).toMatchObject({ held: true, name: "Clippy" });
    }
    expect((await boothState(rt, a.json.token)).status).toBe(200);
  });

  it("the picker agrees: a held part refuses, a freed one signs in", async () => {
    const rt = open();
    const a = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" });
    const b = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" });
    expect(b.status).toBe(409);
    expect(b.json).toMatchObject({ held: true, name: "Clippy" });
    expect(b.json.error).toMatch(/already taken/u);
    await post(rt, "/api/prime/logout", {}, a.json.token);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" })).status).toBe(200);
  });

  it("a guest's picker stays taken: a released program is reached by its card, never by its name", async () => {
    const rt = open();
    const g = await register(rt, "Calculator");
    await post(rt, "/api/guest/logout", {}, g.token);
    expect((await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event })).status).toBe(409);
  });

  it("a badge used as a pass reads through a held badge", async () => {
    const rt = open();
    const code = await blank(rt, 4);
    const g = await register(rt, "Calculator", { badge: code });
    expect((await enter(rt, { badge: code })).status).toBe(409);
    const scan = await mod(rt, "/api/mod/scan", { as: "Task Manager", target: code });
    expect(scan.status).toBe(200);
    expect(scan.json.guest.id).toBe(g.id);
    expect((await guestState(rt, g.token)).status).toBe(200);
  });
});

describe("the holder's own phone", () => {
  it("a re-scan carries on with the same token; nothing new is minted", async () => {
    const rt = open();
    const l = await invited(rt, "OpenOffice");
    const g = await register(rt, "OpenOffice", { claim: l.claim, badge: l.badge });
    const again = await enter(rt, { badge: l.badge, claim: l.claim }, g.token);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ resumed: true, id: g.id, token: g.token });
    expect((await enter(rt, { claim: l.claim }, g.token)).json.token).toBe(g.token);
  });

  it("someone else's token proves nothing", async () => {
    const rt = open();
    const code = await blank(rt, 5);
    await register(rt, "Calculator", { badge: code });
    const other = await register(rt, "Winamp");
    expect((await enter(rt, { badge: code }, other.token)).status).toBe(409);
  });

  it("a booth re-scanning its own staff badge stays signed in on its token", async () => {
    const rt = open();
    const part = await partOf(rt, "Task Manager");
    const a = await staffBadge(rt, part);
    const again = await staffBadge(rt, part, a.json.token);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ token: a.json.token, character: "Task Manager", host: true });
  });

  it("a booth scanning a free part's badge switches, and frees its old part", async () => {
    const rt = open();
    const a = await staffBadge(rt, await partOf(rt, "Clippy"));
    const moved = await staffBadge(rt, await partOf(rt, "Task Manager"), a.json.token);
    expect(moved.json).toMatchObject({ token: a.json.token, character: "Task Manager", host: true });
    expect((await staffBadge(rt, await partOf(rt, "Clippy"))).status).toBe(200);
  });
});

describe("released means", () => {
  it("the guest's own Leave the event: the phone is out and the card signs in plain", async () => {
    const rt = open();
    const code = await blank(rt, 6);
    const a = await register(rt, "Calculator", { badge: code });
    const feed = stream(rt, `role=guest&token=${a.token}`);
    expect((await post(rt, "/api/guest/logout", {}, a.token)).json).toEqual({ ok: true });
    expect(feed.ended).toBe(true);
    expect(feed.frames.join("")).toContain('"kind":"released"');
    const old = await guestState(rt, a.token);
    expect(old.status).toBe(401);
    expect(old.json.error).toBe(SIGNED_OUT);
    const b = await enter(rt, { badge: code });
    expect(b.status).toBe(200);
    expect(b.json).toMatchObject({ resumed: true, id: a.id });
    expect((await guestState(rt, b.json.token)).json.id).toBe(a.id);
  });

  it("logging out is always 200: a dead or absent token, and a play-as token, change nothing", async () => {
    const rt = open();
    const g = await register(rt, "Calculator");
    expect((await post(rt, "/api/guest/logout", {})).status).toBe(200);
    expect((await post(rt, "/api/guest/logout", {}, "nobody")).status).toBe(200);
    const pane = await mod(rt, "/api/mod/impersonate", { role: "guest", id: g.id });
    expect((await post(rt, "/api/guest/logout", {}, pane.json.token)).status).toBe(200);
    expect((await guestState(rt, g.token)).status).toBe(200);
  });

  it("a director's ⏏ Release of a guest; a persona is refused, an unknown guest is 404", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    const a = await register(rt, "Microsoft Excel", { claim: l.claim, badge: l.badge });
    const r = await mod(rt, "/api/mod/guest/release", { id: a.id });
    expect(r.json).toMatchObject({ ok: true, id: a.id, name: "Microsoft Excel", released: 1 });
    expect((await guestState(rt, a.token)).status).toBe(401);
    expect((await enter(rt, { claim: l.claim })).json).toMatchObject({ resumed: true, id: a.id });
    expect((await mod(rt, "/api/mod/guest/release", { id: "g-nobody" })).status).toBe(404);
  });

  it("a host's release: on the allowlist for a guest and for a part", async () => {
    const rt = open();
    const host = await staffBadge(rt, await partOf(rt, "Task Manager"));
    const g = await register(rt, "Calculator");
    const code = await blank(rt, 7);
    await post(rt, "/api/guest/badge", { badge: code }, g.token);
    expect((await post(rt, "/api/mod/guest/release", { id: g.id }, host.json.token)).json).toMatchObject({ ok: true, released: 1 });
    expect((await enter(rt, { badge: code })).status).toBe(200);
    const clippy = await staffBadge(rt, await partOf(rt, "Clippy"));
    expect((await post(rt, "/api/mod/prime/release", { character: "Clippy" }, host.json.token)).status).toBe(200);
    expect((await boothState(rt, clippy.json.token)).status).not.toBe(200);
  });

  it("a guest or a plain booth can't release anyone", async () => {
    const rt = open();
    const g = await register(rt, "Calculator");
    const other = await register(rt, "Winamp");
    const clippy = await staffBadge(rt, await partOf(rt, "Clippy"));
    expect((await post(rt, "/api/mod/guest/release", { id: g.id }, other.token)).status).toBe(403);
    expect((await post(rt, "/api/mod/guest/release", { id: g.id }, clippy.json.token)).status).toBe(403);
    expect((await guestState(rt, g.token)).status).toBe(200);
  });

  it("a story restart frees the guests; a booth stays signed in until Go live", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    const booth = await staffBadge(rt, part);
    const g = await register(rt, "Calculator");
    expect((await mod(rt, "/api/mod/reset", {})).status).toBe(200);
    expect((await guestState(rt, g.token)).status).toBe(401);
    expect((await boothState(rt, booth.json.token)).status).toBe(200);
    expect((await staffBadge(rt, part)).status).toBe(409);
    rt.restart(undefined, undefined, { kind: "golive" });
    expect((await boothState(rt, booth.json.token)).status).not.toBe(200);
    expect((await staffBadge(rt, part)).status).toBe(200);
  });

  it("offline is no release: a closed stream holds, and so does a process restart", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const code = await blank(rt, 8);
    await register(rt, "Calculator", { badge: code });
    const part = await partOf(rt, "Clippy");
    await staffBadge(rt, part);
    const again = runtimeAt(d);
    expect(again.restore()).not.toBeNull();
    expect((await enter(again, { badge: code })).status).toBe(409);
    expect((await staffBadge(again, part)).status).toBe(409);
  });

  it("a spent re-pair is a release; an unspent one leaves the phone signed in", async () => {
    const rt = open();
    const code = await blank(rt, 9);
    const a = await register(rt, "Calculator", { badge: code });
    const paired = await mod(rt, "/api/mod/guest/pair", { id: a.id });
    expect((await guestState(rt, a.token)).status).toBe(200);
    const b = await post(rt, "/api/guest/resume", { pair: paired.json.pair });
    expect(b.status).toBe(200);
    expect((await guestState(rt, a.token)).status).toBe(401);
    expect((await enter(rt, { badge: code })).status).toBe(409);
  });
});

describe("a lost phone", () => {
  /** Approve from a host booth: the row it reads, then the decision. */
  const approve = async (rt: EventRuntime, request: string) => {
    const host = await staffBadge(rt, await partOf(rt, "Task Manager"));
    const row = (await state(rt, `role=mod&host=1&token=${host.json.token}`)).json.rejoins.find((r: { request: string }) => r.request === request);
    expect(row).toBeDefined();
    const decided = await post(rt, "/api/mod/guest/rejoin", { request, approve: true }, host.json.token);
    expect(decided.json).toMatchObject({ ok: true, state: "approved" });
    return row as { name: string; held: boolean; part?: boolean };
  };

  it("B asks by the refused badge, a host approves: A is out, B is in with the same score and codex", async () => {
    const rt = open();
    const code = await blank(rt, 10);
    const a = await register(rt, "Calculator", { badge: code });
    expect((await post(rt, "/api/guest/codex/redeem", { code: "SECRET-59" }, a.token)).status).toBe(200);
    expect((await mod(rt, "/api/mod/set", { id: a.id, field: "score", value: 7 })).status).toBe(200);
    const feed = stream(rt, `role=guest&token=${a.token}`);
    expect((await enter(rt, { badge: code })).status).toBe(409);

    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code });
    expect(ask.status).toBe(200);
    // A blank badge's ask doesn't name its program to the phone holding it…
    expect(ask.json.name).toBe("");
    const request = ask.json.request as string;
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json).toMatchObject({ state: "pending", name: "" });

    // …a host does read it, and is told a phone holds them.
    const row = await approve(rt, request);
    expect(row).toMatchObject({ name: "Calculator", held: true });
    expect(feed.ended).toBe(true);
    expect((await guestState(rt, a.token)).status).toBe(401);

    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got.json).toMatchObject({ state: "approved", id: a.id, name: "Calculator" });
    const view = await guestState(rt, got.json.token);
    expect(view.json).toMatchObject({ id: a.id, name: "Calculator", score: 7 });
    expect(view.json.codex.map((e: { id: string }) => e.id)).toEqual(["The Secret"]);
    // One holder still: the badge is held by B now.
    expect((await enter(rt, { badge: code })).status).toBe(409);
    expect((await enter(rt, { badge: code }, got.json.token)).json.token).toBe(got.json.token);
  });

  it("asking by a program's name still works, and an approve signs the old phone out", async () => {
    const rt = open();
    const a = await register(rt, "Winamp");
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, name: "Winamp" });
    await approve(rt, ask.json.request);
    expect((await guestState(rt, a.token)).status).toBe(401);
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect((await guestState(rt, got.json.token)).json.id).toBe(a.id);
  });

  it("a deny leaves the holder alone", async () => {
    const rt = open();
    const code = await blank(rt, 11);
    const a = await register(rt, "Calculator", { badge: code });
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code });
    expect((await mod(rt, "/api/mod/guest/rejoin", { request: ask.json.request, approve: false })).status).toBe(200);
    expect((await guestState(rt, a.token)).status).toBe(200);
  });

  it("a staff badge asks too: approve moves the booth, capabilities and all", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    const a = await staffBadge(rt, part);
    expect((await staffBadge(rt, part)).status).toBe(409);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part });
    expect(ask.json).toMatchObject({ ok: true, name: "Clippy" });
    const row = await approve(rt, ask.json.request);
    expect(row).toMatchObject({ name: "Clippy", held: true, part: true });
    expect((await boothState(rt, a.json.token)).status).not.toBe(200);
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect(got.json).toMatchObject({ state: "approved", part: true, character: "Clippy", host: false });
    expect((await boothState(rt, got.json.token)).status).toBe(200);
    // Held again: by the new phone.
    expect((await staffBadge(rt, part)).status).toBe(409);
  });

  it("a host's own part moves with its host capability", async () => {
    const rt = open();
    const part = await partOf(rt, "Task Manager");
    const a = await staffBadge(rt, part);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part });
    const decided = await mod(rt, "/api/mod/guest/rejoin", { request: ask.json.request, approve: true });
    expect(decided.json.state).toBe("approved");
    expect((await boothState(rt, a.json.token)).status).not.toBe(200);
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect(got.json).toMatchObject({ character: "Task Manager", host: true });
    expect((await state(rt, `role=mod&host=1&token=${got.json.token}`)).status).toBe(200);
  });

  it("the booth's picker asks on the performer code, the guest code alone doesn't", async () => {
    const rt = open();
    await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" });
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, character: "Clippy" })).status).toBe(403);
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.prime, character: "Nobody" })).status).toBe(404);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.prime, character: "Clippy" });
    expect(ask.status).toBe(200);
    expect(ask.json.name).toBe("Clippy");
  });

  it("a wrong code or a card that isn't tonight's opens no ask", async () => {
    const rt = open();
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part: "nope" })).status).toBe(404);
    expect((await post(rt, "/api/guest/rejoin", { passcode: "WRONG", part: await partOf(rt, "Clippy") })).status).toBe(403);
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: "ZZZZ-ZZZZ" })).status).toBe(404);
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: await blank(rt, 12) })).status).toBe(404);
  });

  it("a late Approve still leaves the waiting phone its full window to collect", () => {
    let now = 0;
    const desk = new RejoinDesk(() => now, () => "r");
    desk.open("g-1", "Calculator");
    now = 9 * 60_000;
    expect(desk.decide("r", true, "Task Manager", () => "t")?.token).toBe("t");
    now = 12 * 60_000;
    expect(desk.get("r")?.token).toBe("t");
  });
});

describe("a host's or a director's own sign-ins", () => {
  it("a director's play-as of a held part or guest takes nothing and is refused nothing", async () => {
    const rt = open();
    const booth = await staffBadge(rt, await partOf(rt, "Clippy"));
    const g = await register(rt, "Calculator");
    const asPart = await mod(rt, "/api/mod/impersonate", { role: "prime", id: "Clippy" });
    expect(asPart.status).toBe(200);
    const asGuest = await mod(rt, "/api/mod/impersonate", { role: "guest", id: g.id });
    expect(asGuest.status).toBe(200);
    expect((await boothState(rt, booth.json.token)).status).toBe(200);
    expect((await guestState(rt, g.token)).status).toBe(200);
  });

  it("a director's pane holds no claim: a card still signs in beside it", async () => {
    const rt = open();
    await mod(rt, "/api/mod/impersonate", { role: "prime", id: "Clippy" });
    expect((await staffBadge(rt, await partOf(rt, "Clippy"))).status).toBe(200);
  });

  it("a moderator session can take a free part on its own token and keeps admin", async () => {
    const rt = open();
    const m = await post(rt, "/api/mod/login", { passcode: CODES.mod });
    const r = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" }, m.json.token);
    expect(r.json).toMatchObject({ token: m.json.token, character: "Clippy", admin: true });
    expect((await mod(rt, "/api/mod/prime/release", { character: "Clippy" })).status).toBe(200);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" })).status).toBe(200);
    // The director is still a director.
    expect((await state(rt, `role=mod&cues=1&token=${m.json.token}`)).status).toBe(200);
  });
});
