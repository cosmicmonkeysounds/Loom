//! Wave 23 — getting back in without a director (`server/routes/rejoin.ts`):
//! printed badges (link at join, enter by badge, the badge as a pass),
//! featured invitations re-entering, the host-approved ask, and the
//! per-part cast card that takes a part back from a lost booth.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { BADGE_MAX, BadgeBook, REJOIN_MAX, REJOIN_TTL_MS, RejoinDesk, badgeCode, badgeFromText, partCode, printedCode } from "../server/routes/rejoin.ts";

const CODES = { event: "EVT523", prime: "PRM523", mod: "MOD523" };

const SOURCE = `# Rejoin
start: Opening

LOCATION Hall

CHARACTER Microsoft Excel
  reserved: true

CHARACTER Calculator

CHARACTER Clippy
  when scanned by guest:
    Clippy: It looks like you're scanning.

CHARACTER Task Manager
  faction: Hosts
  admin: true
  when scanned by guest:
    Task Manager: Watching.

== Opening
  setting: Hall
The lights come on.
`;

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-rejoin-"));
  dirs.push(d);
  return d;
}
function runtimeAt(d: string, now?: () => number): EventRuntime {
  return new EventRuntime({
    ...(now !== undefined ? { now } : {}),
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "rejoin",
    scenarioSource: SOURCE,
    joinBase: () => "https://app.example.com",
  });
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
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
    setHeader() {},
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
async function get(rt: EventRuntime, query: string) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?${query}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function register(rt: EventRuntime, name: string, extra: Record<string, unknown> = {}) {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event, ...extra });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string, badge: r.json.badge as number | undefined };
}
/** Badge `n`'s code, off the runtime's own print list. */
async function badge(rt: EventRuntime, n: number): Promise<{ code: string; url: string }> {
  const r = await mod(rt, "/api/mod/badges", { from: n, count: 1 });
  expect(r.status).toBe(200);
  return { code: r.json.badges[0].code as string, url: r.json.badges[0].url as string };
}

describe("codes", () => {
  it("badge codes are stable, distinct and read back from a link or a typed code", () => {
    const a = badgeCode("s", 1);
    expect(a).toHaveLength(8);
    expect(badgeCode("s", 1)).toBe(a);
    expect(badgeCode("s", 2)).not.toBe(a);
    expect(badgeCode("t", 1)).not.toBe(a);
    expect(badgeFromText(printedCode(a))).toBe(a);
    expect(badgeFromText(` ${a.toUpperCase()} `)).toBe(a);
    expect(badgeFromText(`https://app.example.com/?code=E&badge=${a}`)).toBe(a);
    expect(badgeFromText("g-3f9a1c")).toBeNull();
    expect(badgeFromText("https://app.example.com/?code=E")).toBeNull();
    expect(partCode("s", "Clippy")).toBe(partCode("s", "clippy"));
  });
  it("the book knows only the badges it prints, and one badge per person", () => {
    const book = new BadgeBook(() => "s");
    expect(book.numberOf(badgeCode("s", 7))).toBe(7);
    expect(book.numberOf(badgeCode("s", BADGE_MAX + 1))).toBeNull();
    expect(book.numberOf(badgeCode("other", 7))).toBeNull();
    book.link(7, "g-1");
    book.link(8, "g-1");
    expect(book.holder(7)).toBeNull();
    expect(book.badgeOf("g-1")).toBe(8);
  });
  it("the desk expires asks, replaces a person's older ask and caps the queue", () => {
    let now = 0;
    let n = 0;
    const desk = new RejoinDesk(() => now, () => `r${++n}`);
    const a = desk.open("g-1", "Winamp");
    const b = desk.open("g-1", "Winamp");
    expect(desk.get(a.request)).toBeNull();
    expect(desk.pending().map((r) => r.request)).toEqual([b.request]);
    now = REJOIN_TTL_MS;
    expect(desk.get(b.request)).toBeNull();
    for (let i = 0; i < REJOIN_MAX + 3; i++) desk.open(`g-${i}`, `P${i}`);
    expect(desk.pending()).toHaveLength(REJOIN_MAX);
  });
});

describe("badges", () => {
  it("a badge scanned at join links; entering by it on another phone is the same guest", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const b1 = await badge(rt, 1);
    // Blank: the phone goes on to join.
    const blank = await post(rt, "/api/guest/enter", { passcode: CODES.event, badge: b1.url });
    expect(blank.json).toEqual({ ok: true, resumed: false, badge: 1 });
    const ana = await register(rt, "Calculator", { badge: b1.code });
    expect(ana.badge).toBe(1);
    const back = await post(rt, "/api/guest/enter", { passcode: CODES.event, badge: b1.code });
    expect(back.status).toBe(200);
    expect(back.json).toMatchObject({ ok: true, resumed: true, id: ana.id, name: "Calculator", badge: 1 });
    expect(back.json.token).not.toBe(ana.token);
    const view = await get(rt, `role=guest&token=${back.json.token}`);
    expect(view.json).toMatchObject({ id: ana.id, badge: 1 });
    // The print list names who holds it.
    const listed = await mod(rt, "/api/mod/badges", { count: 2 });
    expect(listed.json.badges[0]).toMatchObject({ ref: "B001", holder: ana.id, name: "Calculator" });
    expect(listed.json.badges[1]).toMatchObject({ ref: "B002", holder: null });
  });

  it("links later from the guest's token; someone else's badge answers with its holder", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const ana = await register(rt, "Calculator");
    const bob = await register(rt, "Winamp");
    const b2 = await badge(rt, 2);
    expect((await post(rt, "/api/guest/badge", { badge: b2.code }, ana.token)).json).toEqual({ ok: true, badge: 2 });
    expect((await post(rt, "/api/guest/badge", { badge: b2.code }, ana.token)).json).toEqual({ ok: true, badge: 2, already: true });
    const theirs = await post(rt, "/api/guest/badge", { badge: b2.url }, bob.token);
    expect(theirs.status).toBe(409);
    expect(theirs.json).toMatchObject({ holder: ana.id, name: "Calculator" });
    expect((await post(rt, "/api/guest/badge", { badge: "ZZZZ-ZZZZ" }, bob.token)).status).toBe(404);
    expect((await post(rt, "/api/guest/badge", { badge: b2.code })).status).toBe(401);
  });

  it("a badge is a pass at a booth and from the director", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const b3 = await badge(rt, 3);
    const ana = await register(rt, "Calculator", { badge: b3.code });
    const scanned = await mod(rt, "/api/mod/scan", { as: "Clippy", target: b3.url });
    expect(scanned.status).toBe(200);
    expect(scanned.json.guest.id).toBe(ana.id);
    const booth = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" });
    const viaBooth = await post(rt, "/api/scan", { target: b3.code }, booth.json.token);
    expect(viaBooth.status).toBe(200);
  });

  it("a wrong badge, a wrong event code, and a story restart", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const b4 = await badge(rt, 4);
    expect((await post(rt, "/api/guest/enter", { passcode: CODES.event, badge: "abcd-efgh" })).status).toBe(404);
    expect((await post(rt, "/api/guest/enter", { passcode: "NOPE", badge: b4.code })).status).toBe(403);
    await register(rt, "Calculator", { badge: b4.code });
    await mod(rt, "/api/mod/reset", {});
    // The person is gone with the run: the badge is blank again.
    expect((await post(rt, "/api/guest/enter", { passcode: CODES.event, badge: b4.code })).json).toMatchObject({ resumed: false, badge: 4 });
  });

  it("links survive a process restart", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const b5 = await badge(rt, 5);
    const ana = await register(rt, "Calculator", { badge: b5.code });
    const again = runtimeAt(d);
    expect(again.restore()).not.toBeNull();
    const back = await post(again, "/api/guest/enter", { passcode: CODES.event, badge: b5.code });
    expect(back.json).toMatchObject({ resumed: true, id: ana.id });
  });
});

describe("invitations", () => {
  it("a featured guest's claim gets them back in once they have joined", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const claim = rt.claimFor("Microsoft Excel");
    expect((await post(rt, "/api/guest/enter", { passcode: CODES.event, claim })).json).toEqual({ ok: true, resumed: false });
    const ex = await register(rt, "Microsoft Excel", { claim });
    const back = await post(rt, "/api/guest/enter", { passcode: CODES.event, claim: claim.toUpperCase() });
    expect(back.json).toMatchObject({ resumed: true, id: ex.id, name: "Microsoft Excel" });
    expect((await post(rt, "/api/guest/enter", { passcode: CODES.event, claim: "0000000000" })).status).toBe(404);
  });
});

describe("ask a host", () => {
  it("lists joined programs, waits, and hands the token over once on approve", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const ana = await register(rt, "Calculator");
    const names = await post(rt, "/api/guest/rejoin/names", { passcode: CODES.event });
    expect(names.json.names).toEqual(["Calculator"]);
    expect((await post(rt, "/api/guest/rejoin", { passcode: CODES.event, name: "Winamp" })).status).toBe(404);
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, name: "calculator" });
    expect(ask.status).toBe(200);
    const request = ask.json.request as string;
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json).toMatchObject({ state: "pending", name: "Calculator" });

    // A host booth sees it and approves it.
    const host = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Task Manager" });
    expect(host.json.host).toBe(true);
    const panel = await get(rt, `role=mod&host=1&token=${host.json.token}`);
    expect(panel.json.rejoins).toEqual([expect.objectContaining({ request, id: ana.id, name: "Calculator" })]);
    const decided = await post(rt, "/api/mod/guest/rejoin", { request, approve: true }, host.json.token);
    expect(decided.json).toMatchObject({ ok: true, state: "approved" });
    expect((await get(rt, `role=mod&host=1&token=${host.json.token}`)).json.rejoins).toEqual([]);

    const got = await post(rt, "/api/guest/rejoin/poll", { request });
    expect(got.json).toMatchObject({ state: "approved", id: ana.id, by: "Task Manager" });
    expect((await get(rt, `role=guest&token=${got.json.token}`)).json).toMatchObject({ id: ana.id });
    // Once.
    expect((await post(rt, "/api/guest/rejoin/poll", { request })).json.state).toBe("expired");
  });

  it("a deny says so; the director phone sees asks too", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    await register(rt, "Calculator");
    const ask = await post(rt, "/api/guest/rejoin", { passcode: CODES.event, name: "Calculator" });
    const login = await post(rt, "/api/mod/login", { passcode: CODES.mod });
    const cues = await get(rt, `role=mod&cues=1&token=${login.json.token}`);
    expect(cues.json.rejoins).toHaveLength(1);
    expect((await mod(rt, "/api/mod/guest/rejoin", { request: ask.json.request, approve: false })).json.state).toBe("denied");
    expect((await mod(rt, "/api/mod/guest/rejoin", { request: ask.json.request, approve: true })).status).toBe(404);
    expect((await post(rt, "/api/guest/rejoin/poll", { request: ask.json.request })).json).toMatchObject({ state: "denied", by: "Ada" });
  });
});

describe("cast cards", () => {
  it("each part's card signs in as it and takes it back from a lost booth", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const codes = await mod(rt, "/api/mod/codes", {});
    const card = (codes.json.castLinks as Array<{ character: string; part: string; url: string }>).find((c) => c.character === "Clippy")!;
    expect(card.url).toBe(`https://app.example.com/?code=PRM523&part=${card.part}`);
    const lost = await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" });
    expect(lost.status).toBe(200);
    // The picker still can't take it…
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, character: "Clippy" })).status).toBe(409);
    // …the card can.
    const back = await post(rt, "/api/prime/login", { passcode: CODES.prime, part: card.part.toUpperCase() });
    expect(back.status).toBe(200);
    expect(back.json.character).toBe("Clippy");
    expect((await get(rt, `role=prime&token=${lost.json.token}`)).status).not.toBe(200);
    expect((await get(rt, `role=prime&token=${back.json.token}`)).status).toBe(200);
    expect((await post(rt, "/api/prime/login", { passcode: CODES.prime, part: "nope" })).status).toBe(404);
    expect((await post(rt, "/api/prime/login", { passcode: "WRONG", part: card.part })).status).toBe(403);
  });
});
