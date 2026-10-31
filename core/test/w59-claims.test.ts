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
import { HELD_ERROR, REJOIN_RETRY_MS, RejoinDesk } from "../server/routes/rejoin.ts";
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
    // The phone reads this very string (`play/src/lifecycle.ts`).
    expect(old.json.error).toBe(SIGNED_OUT);
    expect(SIGNED_OUT).toBe("signed out on this phone");
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

    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got.json).toMatchObject({ state: "approved", id: a.id, name: "Calculator" });
    expect(feed.ended).toBe(true);
    expect((await guestState(rt, a.token)).status).toBe(401);
    const view = await guestState(rt, got.json.token);
    expect(view.json).toMatchObject({ id: a.id, name: "Calculator", score: 7 });
    expect(view.json.codex.map((e: { id: string }) => e.id)).toEqual(["The Secret"]);
    // One holder still: the badge is held by B now.
    expect((await enter(rt, { badge: code })).status).toBe(409);
    expect((await enter(rt, { badge: code }, got.json.token)).json.token).toBe(got.json.token);
  });

  it("asking by a program's name still works, and collecting it signs the old phone out", async () => {
    const rt = open();
    const a = await register(rt, "Winamp");
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, name: "Winamp" });
    await approve(rt, ask.json.request);
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect((await guestState(rt, a.token)).status).toBe(401);
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
    const feed = stream(rt, `role=prime&token=${a.json.token}`);
    expect((await staffBadge(rt, part)).status).toBe(409);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part });
    expect(ask.json).toMatchObject({ ok: true, name: "Clippy" });
    const row = await approve(rt, ask.json.request);
    expect(row).toMatchObject({ name: "Clippy", held: true, part: true });
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect(got.json).toMatchObject({ state: "approved", part: true, character: "Clippy", host: false });
    expect(feed.ended).toBe(true);
    expect(feed.frames.join("")).toContain('"kind":"released"');
    expect((await boothState(rt, a.json.token)).status).not.toBe(200);
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
    const got = await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request });
    expect(got.json).toMatchObject({ character: "Task Manager", host: true });
    expect((await boothState(rt, a.json.token)).status).not.toBe(200);
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
    expect(desk.decide("r", true, "Task Manager")?.state).toBe("approved");
    now = 12 * 60_000;
    expect(desk.get("r")?.state).toBe("approved");
    now = 20 * 60_000;
    expect(desk.get("r")).toBeNull();
  });

  it("a collected ask answers a retry for a minute, not for ten", () => {
    let now = 0;
    const desk = new RejoinDesk(() => now, () => "r");
    const r = desk.open("g-1", "Calculator");
    desk.decide("r", true, "Task Manager");
    r.token = "t";
    now = REJOIN_RETRY_MS - 1;
    expect(desk.get("r")?.token).toBe("t");
    now = REJOIN_RETRY_MS;
    expect(desk.get("r")).toBeNull();
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

describe("an ask nobody collects", () => {
  const approve = (rt: EventRuntime, request: string) => mod(rt, "/api/mod/guest/rejoin", { request, approve: true });
  const asks = async (rt: EventRuntime) => {
    const res = fakeRes();
    const url = new URL("http://x/api/state?role=mod&cues=1");
    await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: true, moderatorName: "Ada" });
    return (JSON.parse(res.body).rejoins ?? []) as Array<{ request: string; name: string; held?: boolean }>;
  };

  it("an Approve moves nothing until the waiting phone collects it", async () => {
    const rt = open();
    const code = await blank(rt, 20);
    const a = await register(rt, "Calculator", { badge: code });
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code });
    const request = ask.json.request as string;
    expect((await approve(rt, request)).json).toMatchObject({ ok: true, state: "approved" });
    // Nobody has collected: the phone in use carries on, and the card still refuses.
    expect((await guestState(rt, a.token)).status).toBe(200);
    expect((await enter(rt, { badge: code })).status).toBe(409);
    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got.json).toMatchObject({ state: "approved", id: a.id });
    expect((await guestState(rt, a.token)).status).toBe(401);
    expect((await guestState(rt, got.json.token)).status).toBe(200);
  });

  it("a poll answered into thin air is asked again: the same token, not a holder no phone has", async () => {
    const rt = open();
    const code = await blank(rt, 21);
    await register(rt, "Calculator", { badge: code });
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
    await approve(rt, request);
    const first = await post(rt, "/api/guest/rejoin/poll", { request });
    const again = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(again.json).toMatchObject({ state: "approved", token: first.json.token });
    expect((await guestState(rt, first.json.token)).status).toBe(200);
  });

  it("Cancel takes the ask off Needs; a stale Approve is refused and touches nobody", async () => {
    const rt = open();
    const code = await blank(rt, 22);
    const a = await register(rt, "Calculator", { badge: code });
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
    expect(await asks(rt)).toHaveLength(1);
    expect((await post(rt, "/api/guest/rejoin/cancel", { request })).status).toBe(200);
    expect(await asks(rt)).toHaveLength(0);
    expect((await approve(rt, request)).status).toBe(404);
    expect((await guestState(rt, a.token)).status).toBe(200);
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("expired");
  });

  it("Cancel after an Approve still changes nothing", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    const a = await staffBadge(rt, part);
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part })).json.request as string;
    await approve(rt, request);
    await post(rt, "/api/guest/rejoin/cancel", { request });
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("expired");
    expect((await boothState(rt, a.json.token)).status).toBe(200);
  });

  it("a release closes the Person's open ask, and the waiting phone hears it's free", async () => {
    const rt = open();
    const code = await blank(rt, 23);
    const a = await register(rt, "Calculator", { badge: code });
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
    await post(rt, "/api/guest/logout", {}, a.token);
    expect(await asks(rt)).toHaveLength(0);
    expect((await approve(rt, request)).status).toBe(404);
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("closed");
    // Once: the phone has gone back to its card.
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("expired");
    expect((await enter(rt, { badge: code })).json).toMatchObject({ resumed: true, id: a.id });
  });

  it("a plain sign-in closes an ask made before it, and a stale Approve can't sign that phone out", async () => {
    const rt = open();
    const code = await blank(rt, 24);
    const a = await register(rt, "Calculator", { badge: code });
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
    await mod(rt, "/api/mod/guest/release", { id: a.id });
    const b = await enter(rt, { badge: code });
    expect((await approve(rt, request)).status).toBe(404);
    expect((await guestState(rt, b.json.token)).status).toBe(200);
  });

  it("the same for a part: an old ask can't sign out the phone that took it plainly", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    const a = await staffBadge(rt, part);
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part })).json.request as string;
    await post(rt, "/api/prime/logout", {}, a.json.token);
    const b = await staffBadge(rt, part);
    expect(b.status).toBe(200);
    expect((await approve(rt, request)).status).toBe(404);
    expect((await boothState(rt, b.json.token)).status).toBe(200);
  });

  it("a booth moving to a free part frees the old one's ask too", async () => {
    const rt = open();
    const a = await staffBadge(rt, await partOf(rt, "Clippy"));
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part: await partOf(rt, "Clippy") })).json.request as string;
    await staffBadge(rt, await partOf(rt, "Task Manager"), a.json.token);
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("closed");
  });

  it("the holder's own re-scan is no sign-in: the ask stands", async () => {
    const rt = open();
    const code = await blank(rt, 25);
    const a = await register(rt, "Calculator", { badge: code });
    const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
    await enter(rt, { badge: code }, a.token);
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("pending");
  });
});

describe("an invited badge is its own program's", () => {
  it("a signed-in stranger can't link it: refused by name, and the real invitee still joins", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    const stranger = await register(rt, "Calculator");
    const r = await post(rt, "/api/guest/badge", { badge: l.badge }, stranger.token);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ reserved: true, name: "Microsoft Excel" });
    expect(r.json.holder).toBeUndefined();
    const real = await register(rt, "Microsoft Excel", { claim: l.claim, badge: l.badge });
    expect((await enter(rt, { badge: l.badge }, real.token)).json).toMatchObject({ resumed: true, id: real.id });
  });

  it("no claim behaves as a claim: a joined program signs in or refuses, never `fresh`", async () => {
    const rt = open();
    const l = await invited(rt, "OpenOffice");
    const g = await register(rt, "OpenOffice", { claim: l.claim });
    const refused = await enter(rt, { badge: l.badge });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ held: true, name: "OpenOffice", ref: l.ref });
    await post(rt, "/api/guest/logout", {}, g.token);
    expect((await enter(rt, { badge: l.badge })).json).toMatchObject({ resumed: true, id: g.id });
  });

  it("no claim on a program nobody has joined hands the join its invitation", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    expect((await enter(rt, { badge: l.badge })).json).toMatchObject({ resumed: false, claim: l.claim });
    const g = await register(rt, "Microsoft Excel", { badge: l.badge });
    expect((await enter(rt, { badge: l.badge }, g.token)).json).toMatchObject({ resumed: true, id: g.id });
  });

  it("register refuses it for any other program and creates nobody", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    const r = await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event, badge: l.badge });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ reserved: true, name: "Microsoft Excel" });
    expect(rt.liveSim!.persons.size).toBe(0);
  });

  it("a mod's list and a pass still read it once its program has joined", async () => {
    const rt = open();
    const l = await invited(rt, "OpenOffice");
    const g = await register(rt, "OpenOffice", { claim: l.claim, badge: l.badge });
    const stranger = await register(rt, "Calculator");
    const seen = await post(rt, "/api/guest/badge", { badge: l.badge }, stranger.token);
    expect(seen.json).toMatchObject({ holder: g.id, name: "OpenOffice" });
  });

  it("a program that joined by a bare invitation can link its own badge later, and only it", async () => {
    const rt = open();
    const l = await invited(rt, "OpenOffice");
    const g = await register(rt, "OpenOffice", { claim: l.claim });
    const stranger = await register(rt, "Calculator");
    expect((await post(rt, "/api/guest/badge", { badge: l.badge }, stranger.token)).json).toMatchObject({ holder: g.id, name: "OpenOffice" });
    expect((await post(rt, "/api/guest/badge", { badge: l.badge }, g.token)).status).toBe(200);
  });
});

describe("register with a card", () => {
  it("the loser of a blank badge is refused the plain way, naming only the badge", async () => {
    const rt = open();
    const code = await blank(rt, 30);
    await register(rt, "Calculator", { badge: code });
    const r = await post(rt, "/api/guest/register", { name: "Winamp", passcode: CODES.event, badge: code });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ error: HELD_ERROR, held: true, ref: "B030" });
    expect(rt.liveSim!.persons.size).toBe(1);
  });

  it("the loser of an invitation gets the refused screen, and a held program's name", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    await register(rt, "Microsoft Excel", { claim: l.claim, badge: l.badge });
    const byBadge = await post(rt, "/api/guest/register", { name: "Microsoft Excel", passcode: CODES.event, claim: l.claim, badge: l.badge });
    expect(byBadge.status).toBe(409);
    expect(byBadge.json).toMatchObject({ held: true, name: "Microsoft Excel", ref: l.ref });
    const byClaim = await post(rt, "/api/guest/register", { name: "Microsoft Excel", passcode: CODES.event, claim: l.claim });
    expect(byClaim.json).toMatchObject({ held: true, name: "Microsoft Excel" });
  });

  it("a claim for one program doesn't stop a phone picking another", async () => {
    const rt = open();
    const l = await invited(rt, "Microsoft Excel");
    await register(rt, "Microsoft Excel", { claim: l.claim });
    expect((await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event, claim: l.claim })).status).toBe(200);
  });

  it("a card whose Person a release freed signs in as that Person, never as a second one", async () => {
    const rt = open();
    const code = await blank(rt, 31);
    const a = await register(rt, "Calculator", { badge: code });
    await post(rt, "/api/guest/logout", {}, a.token);
    const r = await post(rt, "/api/guest/register", { name: "Winamp", passcode: CODES.event, badge: code });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: a.id, name: "Calculator" });
    expect(rt.liveSim!.persons.size).toBe(1);
  });

  it("a program picked with no card keeps its plain taken answer", async () => {
    const rt = open();
    await register(rt, "Calculator");
    const r = await post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event });
    expect(r.status).toBe(409);
    expect(r.json.held).toBeUndefined();
  });

  it("two phones racing a picture wiki call can't both become one program", async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const wiki = { lookup: async () => null, avatarFor: async () => null, pictures: async () => (await delay(20), [{ url: "https://x.test/p.png", file: "File:p.png" }]) };
    const rt = new EventRuntime({ eventId: "evt", store: new Store(freshDir()), codes: CODES, scenarioName: "claims", scenarioSource: SOURCE, joinBase: () => "https://app.example.com", wiki: wiki as never });
    rt.openDoors();
    const key = (await post(rt, "/api/identities/pictures", { passcode: CODES.event, name: "Calculator" })).json.options[0].key as string;
    const [a, b] = await Promise.all([post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event, picture: key }), post(rt, "/api/guest/register", { name: "Calculator", passcode: CODES.event, picture: key })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(rt.liveSim!.persons.size).toBe(1);
  });
});

describe("a Home Screen nonce and a move", () => {
  it("an approved ask voids the old phone's nonces, so one Person has one holder", async () => {
    const before = process.env["LOOM_HOMESCREEN"];
    process.env["LOOM_HOMESCREEN"] = "on";
    try {
      const rt = open();
      const code = await blank(rt, 32);
      const a = await register(rt, "Calculator", { badge: code });
      const nonce = await post(rt, "/api/guest/homescreen", {}, a.token);
      expect(nonce.status).toBe(200);
      const request = (await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code })).json.request as string;
      await mod(rt, "/api/mod/guest/rejoin", { request, approve: true });
      await post(rt, "/api/guest/rejoin/poll", { request });
      expect((await post(rt, "/api/guest/resume", { pair: nonce.json.pair })).status).toBe(410);
    } finally {
      if (before === undefined) delete process.env["LOOM_HOMESCREEN"];
      else process.env["LOOM_HOMESCREEN"] = before;
    }
  });
});

// Every call here comes from one address, as a house on one Wi-Fi does.
describe("the house is one IP", () => {
  const WRONG_BADGE = "ABCD-EFGH";
  const lockOut = async (rt: EventRuntime) => {
    for (let i = 0; i < 11; i++) await post(rt, "/api/mod/login", { passcode: `WRONG${i}` });
  };
  const locked = async (rt: EventRuntime) => (await post(rt, "/api/mod/login", { passcode: CODES.mod })).status === 429;

  it("thirty mistyped badges at enter lock nobody out", async () => {
    const rt = open();
    const code = await blank(rt, 3);
    for (let i = 0; i < 30; i++) expect((await enter(rt, { badge: `ABCD-${1000 + i}` })).status).toBe(404);
    expect(await locked(rt)).toBe(false);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" })).status).toBe(200);
    expect((await enter(rt, { badge: code })).status).toBe(200);
  });

  it("text with no badge's shape reads the same and counts the same: nothing", async () => {
    const rt = open();
    for (const badge of ["hello", "1234", "not a badge at all"]) expect((await enter(rt, { badge })).status).toBe(404);
    for (let i = 0; i < 12; i++) await enter(rt, { badge: "hello" });
    expect(await locked(rt)).toBe(false);
  });

  it("nor does a mistyped badge on an ask", async () => {
    const rt = open();
    for (let i = 0; i < 12; i++) expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: WRONG_BADGE })).status).toBe(404);
    expect(await locked(rt)).toBe(false);
  });

  it("a house already locked out can still enter by badge and ask a host, start to finish", async () => {
    const rt = open();
    const code = await blank(rt, 5);
    const a = await register(rt, "Calculator", { badge: code });
    const free = await blank(rt, 6);
    await lockOut(rt);
    expect(await locked(rt)).toBe(true);
    // A free badge goes straight in; a held one gets its refused screen, not a 429.
    expect((await enter(rt, { badge: free })).status).toBe(200);
    expect((await enter(rt, { badge: code })).status).toBe(409);
    const names = await post(rt, "/api/guest/rejoin/names", { passcode: CODES.event });
    expect(names.json.names).toEqual(["Calculator"]);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: code });
    expect(ask.status).toBe(200);
    const request = ask.json.request as string;
    expect(await post(rt, "/api/guest/rejoin/poll", { request })).toMatchObject({ status: 200, json: { state: "pending" } });
    await mod(rt, "/api/mod/guest/rejoin", { request, approve: true });
    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got).toMatchObject({ status: 200, json: { state: "approved", id: a.id } });
    expect((await guestState(rt, got.json.token as string)).status).toBe(200);
    expect((await guestState(rt, a.token)).status).toBe(401);
    expect((await post(rt, "/api/guest/rejoin/cancel", { request: "gone" })).status).toBe(200);
  });

  it("the crew's codes stay behind the lockout, on every road to them", async () => {
    const rt = open();
    const part = await partOf(rt, "Clippy");
    await lockOut(rt);
    expect((await post(rt, "/api/mod/login", { passcode: CODES.mod })).status).toBe(429);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" })).status).toBe(429);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, part })).status).toBe(429);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.event, character: "Clippy" })).status).toBe(429);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.event, part: "wrongpart" })).status).toBe(429);
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part: "wrongpart" })).status).toBe(429);
    expect((await enter(rt, { claim: "wrongclaim" })).status).toBe(429);
    expect((await post(rt, "/api/guest/enter", { passcode: "WRONG", badge: WRONG_BADGE })).status).toBe(429);
    expect((await post(rt, "/api/guest/enter", { passcode: "WRONG", badge: WRONG_BADGE, claim: "wrongclaim" })).status).toBe(429);
    expect((await post(rt, "/api/guest/rejoin", { passcode: "WRONG", part })).status).toBe(429);
    // A real card with a wrong one beside it is still a guess.
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part, claim: "wrongclaim" })).status).toBe(429);
  });

  it("a lost staff badge's phone is never stranded by a lockout: a sign-in, a refusal, and Ask a host to the end", async () => {
    const rt = open();
    const free = await partOf(rt, "Clippy");
    const heldPart = await partOf(rt, "Task Manager");
    const old = (await post(rt, "/api/prime/login", { passcode: CODES.event, part: heldPart })).json.token as string;
    await lockOut(rt);
    expect(await locked(rt)).toBe(true);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.event, part: free })).status).toBe(200);
    expect(await post(rt, "/api/prime/login", { passcode: CODES.event, part: heldPart })).toMatchObject({ status: 409, json: { held: true } });
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part: heldPart });
    expect(ask.status).toBe(200);
    const request = ask.json.request as string;
    await mod(rt, "/api/mod/guest/rejoin", { request, approve: true });
    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got).toMatchObject({ status: 200, json: { state: "approved", part: true } });
    expect(got.json.token).not.toBe(old);
    expect(await locked(rt)).toBe(true);
  });

  it("nor an invited badge's: a fresh one joins, a held one is refused, and its ask goes through", async () => {
    const rt = open();
    const held = await invited(rt, "Microsoft Excel");
    const free = await invited(rt, "OpenOffice");
    const a = await register(rt, "Microsoft Excel", { badge: held.badge, claim: held.claim });
    await lockOut(rt);
    expect(await locked(rt)).toBe(true);
    expect((await enter(rt, { badge: free.badge, claim: free.claim })).status).toBe(200);
    expect((await enter(rt, { claim: free.claim })).status).toBe(200);
    expect(await enter(rt, { badge: held.badge, claim: held.claim })).toMatchObject({ status: 409, json: { held: true } });
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, badge: held.badge, claim: held.claim });
    expect(ask.status).toBe(200);
    const request = ask.json.request as string;
    await mod(rt, "/api/mod/guest/rejoin", { request, approve: true });
    expect(await post(rt, "/api/guest/rejoin/poll", { request })).toMatchObject({ status: 200, json: { state: "approved", id: a.id } });
  });

  it("a wrong part is a guess at a performer's credential, and still counts", async () => {
    const rt = open();
    for (let i = 0; i < 10; i++) expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, part: `wrongpart${i}` })).status).toBe(404);
    expect(await locked(rt)).toBe(true);
  });

  it("so do a wrong event code and a wrong claim", async () => {
    const wrongCode = open();
    for (let i = 0; i < 10; i++) expect((await post(wrongCode, "/api/guest/enter", { passcode: `WRONG${i}`, badge: WRONG_BADGE })).status).toBe(403);
    expect(await locked(wrongCode)).toBe(true);
    const wrongClaim = open();
    for (let i = 0; i < 10; i++) expect((await enter(wrongClaim, { claim: `wrongclaim${i}` })).status).toBe(404);
    expect(await locked(wrongClaim)).toBe(true);
  });
});
