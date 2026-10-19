//! Wave 11, lane server-a (C5): the guest-facing engine pieces.
//!
//! - Reserved programs (W-03): a `reserved: true` program is locked on the
//!   picker and refused at register without its claim; the claim is stable
//!   across a restart (the state dir) and End → relaunch (the row's secret);
//!   `/api/mod/codes` lists the invitations; a director's unlock window
//!   opens and closes on the clock.
//! - lastSeen + "went home" (W-04 / OP-11): the roster's `lastSeen`, the
//!   journaled `/api/mod/guest/gone`, a Run persona's `<id>.persona`.
//! - Guest countdowns (W-06): `countdown: … for guests` on the phone, never
//!   a secret head, `paused` while the clock is stopped.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime, type EventRuntimeInit } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { claimMatches, claimToken, guestNameRefusal, reservedDefFor, RESERVED } from "../server/identity.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { foldName } from "../src/parser/names.ts";

const CODES = { event: "EVT411", prime: "PRM411", mod: "MOD411" };

const STORY = `# Claims
start: Doors
countdown: Night.summons_end as Summons for guests
countdown: Night.y2k_end as Midnight
countdown: Kernel.deadline as Lock, for guests

CHARACTER Kernel
  playable: false
  secret: true

CHARACTER Microsoft Excel
  reserved: true

CHARACTER Runescape
  reserved: true

CHARACTER Calculator

CHARACTER Clippy
  listed: true

== Doors
Hello.
`;

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-claims-"));
  dirs.push(d);
  return d;
}
function runtime(dir = tempDir(), extra: Partial<EventRuntimeInit> = {}): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(dir),
    codes: CODES,
    scenarioName: "claims",
    scenarioSource: STORY,
    joinBase: () => "http://party.test",
    limits: { register: { max: 1000, windowMs: 60_000 } },
    ...extra,
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

interface FakeRes {
  statusCode: number;
  body: string;
}
function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    socket: { remoteAddress: "1.2.3.4" },
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & FakeRes {
  const res = {
    statusCode: 0,
    body: "",
    headersSent: false,
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
  return res as unknown as ServerResponse & FakeRes;
}
async function post(rt: EventRuntime, path: string, body: unknown, opts: { moderator?: boolean; token?: string } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(body, opts.token ? { "x-loom-token": opts.token } : {}), res, "POST", path, url, { moderator: opts.moderator ?? false });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function mod(rt: EventRuntime, path: string, body: unknown = {}) {
  return post(rt, path, body, { moderator: true });
}
async function state(rt: EventRuntime, query: string, opts: { moderator?: boolean; token?: string } = {}) {
  const res = fakeRes();
  const url = new URL(`http://x/api/state?${query}${opts.token ? `&token=${opts.token}` : ""}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator: opts.moderator ?? false });
  return JSON.parse(res.body || "{}");
}
async function register(rt: EventRuntime, name: string, claim?: string) {
  return post(rt, "/api/guest/register", { passcode: CODES.event, name, ...(claim !== undefined ? { claim } : {}) });
}
async function claimsOf(rt: EventRuntime): Promise<Array<{ character: string; claim: string; url: string }>> {
  return (await mod(rt, "/api/mod/codes")).json.claims;
}
const row = (rows: Array<{ name: string; reserved: boolean }>, name: string) => rows.find((r) => r.name === name)!;

// ---------------------------------------------------------------------------

describe("claim tokens (identity.ts)", () => {
  it("are an HMAC of the secret and the folded name: stable, distinct, forgiving to type", () => {
    const a = claimToken("s3cret", "Microsoft Excel");
    expect(a).toMatch(/^[0-9a-hjkmnp-tv-z]{10}$/u);
    expect(claimToken("s3cret", "microsoft  excel")).toBe(a);
    expect(claimToken("s3cret", "Runescape")).not.toBe(a);
    expect(claimToken("other", "Microsoft Excel")).not.toBe(a);
    expect(claimMatches("s3cret", "Microsoft Excel", a.toUpperCase())).toBe(true);
    expect(claimMatches("s3cret", "Microsoft Excel", `${a.slice(0, 5)} ${a.slice(5)}`)).toBe(true);
    expect(claimMatches("s3cret", "Microsoft Excel", a.slice(1))).toBe(false);
    expect(claimMatches("s3cret", "Microsoft Excel", "é".repeat(10))).toBe(false);
    expect(claimMatches("s3cret", "Microsoft Excel", null)).toBe(false);
  });

  it("a reserved program is refused `reserved` unless the caller may claim it", () => {
    const model = Sim.fromSources(STORY).model;
    expect(guestNameRefusal(model, "Microsoft Excel", new Set())).toBe(RESERVED);
    expect(guestNameRefusal(model, "microsoft excel", new Set(), (c) => c === "Microsoft Excel")).toBeNull();
    expect(guestNameRefusal(model, "Calculator", new Set())).toBeNull();
    // Taken beats reserved: a held program says so, claim or not.
    expect(guestNameRefusal(model, "Microsoft Excel", new Set([foldName("Microsoft Excel")]), () => true)).toMatch(/already here/u);
  });
});

describe("reservedDefFor (identity.ts)", () => {
  it("finds a reserved program by its name or its `wiki:` article, never an unreserved one", () => {
    const sim = Sim.fromSources(`# R
start: Go

CHARACTER VLC
  reserved: true
  wiki: VLC media player

CHARACTER MS Paint
  wiki: Microsoft Paint

== Go
Hi.
`);
    expect(reservedDefFor(sim.model, "VLC")?.name).toBe("VLC");
    expect(reservedDefFor(sim.model, "vlc media player")?.name).toBe("VLC");
    expect(reservedDefFor(sim.model, "Microsoft Paint")).toBeNull();
    expect(guestNameRefusal(sim.model, "VLC media player", new Set())).toBe(RESERVED);
    expect(guestNameRefusal(sim.model, "VLC media player", new Set(), () => true)).toBeNull();
    expect(guestNameRefusal(sim.model, "Microsoft Paint", new Set())).toBeNull();
  });
});

describe("reserved programs at the door (W-03)", () => {
  it("the picker locks a reserved program for a caller without its claim, and opens it with one", async () => {
    const rt = runtime();
    rt.openDoors();
    const plain = (await post(rt, "/api/identities", { passcode: CODES.event })).json.identities;
    expect(row(plain, "Microsoft Excel").reserved).toBe(true);
    expect(row(plain, "Runescape").reserved).toBe(true);
    expect(row(plain, "Calculator").reserved).toBe(false);
    const excel = rt.claimFor("Microsoft Excel");
    const mine = (await post(rt, "/api/identities", { passcode: CODES.event, claim: excel })).json.identities;
    expect(row(mine, "Microsoft Excel").reserved).toBe(false);
    expect(row(mine, "Runescape").reserved).toBe(true); // one claim, one program
    const parts = (await post(rt, "/api/identities", { passcode: CODES.prime })).json.identities;
    expect(parts.every((r: { reserved: boolean }) => r.reserved === false)).toBe(true);
  });

  it("register refuses a reserved program without its claim (409 reserved) and takes it with one", async () => {
    const rt = runtime();
    rt.openDoors();
    expect(await register(rt, "Microsoft Excel")).toMatchObject({ status: 409, json: { error: "reserved" } });
    expect(await register(rt, "Microsoft Excel", "wrongwrong")).toMatchObject({ status: 409, json: { error: "reserved" } });
    expect(await register(rt, "Microsoft Excel", rt.claimFor("Runescape"))).toMatchObject({ status: 409, json: { error: "reserved" } });
    const ok = await register(rt, "microsoft excel", rt.claimFor("Microsoft Excel").toUpperCase());
    expect(ok.status).toBe(200);
    // Typed in another case, the guest is still the story's own CHARACTER
    // (its `program.name ==` checks hear them).
    expect(ok.json.name).toBe("Microsoft Excel");
    expect(rt.liveSim!.persons.get(ok.json.id as string)?.name).toBe("Microsoft Excel");
    // Once held, the program is taken for everyone (the claim is no second ticket).
    const again = await register(rt, "Microsoft Excel", rt.claimFor("Microsoft Excel"));
    expect(again.status).toBe(409);
    expect(again.json.error).toMatch(/already here/u);
    // An unreserved program needs nothing, and a pool name is spelled the story's way too.
    expect(await register(rt, "calculator")).toMatchObject({ status: 200, json: { name: "Calculator" } });
  });

  it("the claim is stable across a process restart (the state dir) and pinned by the row", async () => {
    const dir = tempDir();
    const minted: string[] = [];
    const first = runtime(dir, { onClaimSecret: (s) => minted.push(s) });
    expect(minted).toHaveLength(1); // no row secret: minted once, offered back to the row
    const before = await claimsOf(first);
    const second = runtime(dir, { onClaimSecret: (s) => minted.push(s) });
    expect(await claimsOf(second)).toEqual(before);
    expect(minted).toEqual([minted[0], minted[0]]); // the same secret, read back from disk
    second.restore();
    second.openDoors();
    expect((await register(second, "Runescape", before.find((c) => c.character === "Runescape")!.claim)).status).toBe(200);

    // A fresh state dir (End → relaunch) with the row's secret keeps every invitation.
    const relaunch = runtime(tempDir(), { claimSecret: minted[0]!, onClaimSecret: (s) => minted.push(s) });
    expect(await claimsOf(relaunch)).toEqual(before);
    expect(minted).toHaveLength(2); // a row secret is never offered back
    // Another event's secret gives other tokens.
    expect((await claimsOf(runtime())).map((c) => c.claim)).not.toEqual(before.map((c) => c.claim));
    // The row wins over a stale state-dir copy.
    const row = claimToken("from-the-row", "Microsoft Excel");
    const over = runtime(dir, { claimSecret: "from-the-row" });
    expect(over.claimFor("Microsoft Excel")).toBe(row);
    expect(runtime(dir).claimFor("Microsoft Excel")).toBe(row); // and is kept there
  });

  it("/api/mod/codes lists each reserved program's invitation (before the doors too)", async () => {
    const rt = runtime();
    const claims = await claimsOf(rt); // doors still closed: off the declared story
    expect(claims.map((c) => c.character)).toEqual(["Microsoft Excel", "Runescape"]);
    for (const c of claims) {
      expect(c.claim).toBe(rt.claimFor(c.character));
      expect(c.url).toBe(`http://party.test/?code=${CODES.event}&claim=${c.claim}`);
    }
    rt.openDoors();
    expect(await claimsOf(rt)).toEqual(claims);
    expect((await post(rt, "/api/mod/codes", {})).status).toBe(403);
  });

  it("a director's unlock opens a reserved program to anyone for N minutes, on the clock", async () => {
    let now = 1_000_000;
    const rt = runtime(tempDir(), { now: () => now });
    rt.openDoors();
    expect((await post(rt, "/api/mod/claim/unlock", { character: "Runescape" })).status).toBe(403);
    expect((await mod(rt, "/api/mod/claim/unlock", { character: "Calculator" })).status).toBe(404);
    expect((await mod(rt, "/api/mod/claim/unlock", { character: "Nobody" })).status).toBe(404);
    expect((await mod(rt, "/api/mod/claim/unlock", { character: "Runescape", minutes: -1 })).status).toBe(400);

    const open = await mod(rt, "/api/mod/claim/unlock", { character: "runescape" });
    expect(open).toMatchObject({ status: 200, json: { ok: true, character: "Runescape", until: now + 120_000 } });
    const cast = (await state(rt, "role=mod", { moderator: true })).cast;
    expect(cast.find((c: { id: string }) => c.id === "Runescape")).toMatchObject({ reserved: true, unlockedUntil: now + 120_000 });
    expect(cast.find((c: { id: string }) => c.id === "Microsoft Excel")).not.toHaveProperty("unlockedUntil");
    expect(row((await post(rt, "/api/identities", { passcode: CODES.event })).json.identities, "Runescape").reserved).toBe(false);

    now += 120_001; // the window closed
    expect(row((await post(rt, "/api/identities", { passcode: CODES.event })).json.identities, "Runescape").reserved).toBe(true);
    expect(await register(rt, "Runescape")).toMatchObject({ status: 409, json: { error: "reserved" } });
    expect((await state(rt, "role=mod", { moderator: true })).cast.find((c: { id: string }) => c.id === "Runescape")).not.toHaveProperty("unlockedUntil");

    await mod(rt, "/api/mod/claim/unlock", { character: "Runescape", minutes: 5 });
    now += 60_000;
    expect((await register(rt, "Runescape")).status).toBe(200);

    // `minutes: 0` shuts a window; the longest is an hour.
    expect((await mod(rt, "/api/mod/claim/unlock", { character: "Microsoft Excel", minutes: 600 })).json.until).toBe(now + 3_600_000);
    expect((await mod(rt, "/api/mod/claim/unlock", { character: "Microsoft Excel", minutes: 0 })).json.until).toBeNull();
    expect(await register(rt, "Microsoft Excel")).toMatchObject({ status: 409, json: { error: "reserved" } });
  });

  it("a story with no reserved program changes nothing", async () => {
    const rt = runtime(tempDir(), { scenarioSource: STORY.replace(/ {2}reserved: true\n/gu, "") });
    rt.openDoors();
    expect(await claimsOf(rt)).toEqual([]);
    expect((await register(rt, "Microsoft Excel")).status).toBe(200);
  });

  it("a reserved program's `wiki:` article is held too: locked in the search, refused at register, the claim holder becomes the program", async () => {
    const story = `# Alias
start: Doors

CHARACTER VLC
  reserved: true
  wiki: VLC media player

CHARACTER Calculator

== Doors
Hello.
`;
    const hit = { title: "VLC media player", description: "Media player software", image: "https://img.test/vlc.png" };
    // Only what the door calls: the directory search and the title lookup.
    const wiki = {
      search: async () => [hit, { title: "Winamp", description: "Media player", image: null }],
      lookup: async (t: string) => (foldName(t) === foldName(hit.title) ? hit : null),
      pictures: async () => [],
      avatarFor: async () => null,
    } as unknown as NonNullable<EventRuntimeInit["wiki"]>;
    const rt = runtime(tempDir(), { scenarioSource: story, wiki });
    rt.openDoors();
    const search = async (claim?: string) =>
      (await post(rt, "/api/identities/search", { passcode: CODES.event, q: "vlc", ...(claim !== undefined ? { claim } : {}) })).json.results as Array<{ name: string; reserved: boolean; claimed: boolean }>;
    expect(row(await search(), "VLC media player").reserved).toBe(true);
    expect(row(await search(), "Winamp").reserved).toBe(false);
    const claim = (await claimsOf(rt)).find((c) => c.character === "VLC")!.claim;
    expect(row(await search(claim), "VLC media player").reserved).toBe(false);
    // Without the claim: refused by the article name, by `wiki` or typed.
    expect(await post(rt, "/api/guest/register", { passcode: CODES.event, name: "VLC media player", wiki: "VLC media player" })).toMatchObject({ status: 409, json: { error: "reserved" } });
    expect(await register(rt, "vlc media player")).toMatchObject({ status: 409, json: { error: "reserved" } });
    // With it: the guest is the featured CHARACTER, not a lookalike.
    const ok = await post(rt, "/api/guest/register", { passcode: CODES.event, name: "VLC media player", wiki: "VLC media player", claim });
    expect(ok).toMatchObject({ status: 200, json: { name: "VLC" } });
    expect((await search(claim)).find((r) => r.name === "VLC media player")!.claimed).toBe(true);
    expect((await register(rt, "VLC media player", claim)).status).toBe(409);
  });
});

describe("lastSeen, went home, personas (W-04)", () => {
  it("the roster's lastSeen stamps a guest's registration, own requests and stream, not a director's", async () => {
    let now = 5_000_000;
    const rt = runtime(tempDir(), { now: () => now });
    rt.openDoors();
    const { id, token } = (await register(rt, "Calculator")).json as { id: string; token: string };
    const seen = async () => (await state(rt, "role=mod", { moderator: true })).roster.find((r: { id: string }) => r.id === id).lastSeen;
    expect(await seen()).toBe(now); // registering is being here
    const first = now;
    now += 1_000;
    await state(rt, "role=guest", { token }); // under 15 s: no new stamp
    expect(await seen()).toBe(first);
    now += 20_000;
    await post(rt, "/api/guest/say", { channel: "lobby", text: "hi" }, { token });
    expect(await seen()).toBe(now);

    // The stream opening and closing always stamps.
    let onClose: (() => void) | undefined;
    const req = { headers: {}, on: (ev: string, fn: () => void) => (ev === "close" ? (onClose = fn) : undefined) } as unknown as IncomingMessage;
    const stream = { writeHead: () => stream, write: () => true, end: () => stream } as unknown as ServerResponse;
    now += 1_000;
    await rt.handle(req, stream, "GET", "/events", new URL(`http://x/events?role=guest&token=${token}`), {});
    expect(await seen()).toBe(now);
    now += 2_000;
    onClose!();
    expect(await seen()).toBe(now);

    // A director's play-as session for them is not them.
    const imp = (await mod(rt, "/api/mod/impersonate", { role: "guest", id })).json.token as string;
    const before = await seen();
    now += 60_000;
    await state(rt, "role=guest", { token: imp });
    expect(await seen()).toBe(before);
  });

  it("/api/mod/guest/gone is a journaled world set by the director, and replays", async () => {
    const dir = tempDir();
    const rt = runtime(dir);
    rt.openDoors();
    const { id } = (await register(rt, "Calculator")).json as { id: string };
    expect((await post(rt, "/api/mod/guest/gone", { id, gone: true })).status).toBe(403);
    expect((await mod(rt, "/api/mod/guest/gone", { id: "g-nobody", gone: true })).status).toBe(404);
    expect((await mod(rt, "/api/mod/guest/gone", { id, gone: "yes" })).status).toBe(400);
    expect(await post(rt, "/api/mod/guest/gone", { id, gone: true }, { moderator: true })).toMatchObject({ status: 200, json: { ok: true, id, gone: true } });
    const view = await state(rt, "role=mod", { moderator: true });
    expect(view.roster.find((r: { id: string }) => r.id === id).gone).toBe(true);
    expect(view.world).toContainEqual({ path: `${id}.gone`, value: "true" });
    const line = new Store(dir).readJournal().find((e) => e.m === "setVar" && e.a[0] === `${id}.gone`);
    expect(line).toEqual({ m: "setVar", a: [`${id}.gone`, "true"], by: "Director" });

    rt.pause();
    const again = runtime(dir);
    again.restore();
    expect((await state(again, "role=mod", { moderator: true })).roster.find((r: { id: string }) => r.id === id).gone).toBe(true);
    await mod(again, "/api/mod/guest/gone", { id, gone: false });
    expect((await state(again, "role=mod", { moderator: true })).roster.find((r: { id: string }) => r.id === id)).not.toHaveProperty("gone");
  });

  it("a Run persona carries `<id>.persona = true` from its creation (journaled)", async () => {
    const dir = tempDir();
    const rt = runtime(dir);
    rt.openDoors();
    const r = await mod(rt, "/api/mod/persona", { name: "Rehearsal" });
    const id = r.json.guest.id as string;
    expect(r.json.guest.persona).toBe(true);
    expect(rt.liveSim!.world.get(`${id}.persona`)).toEqual({ kind: "bool", value: true });
    expect(new Store(dir).readJournal().filter((e) => e.a[0] === `${id}.persona`)).toEqual([{ m: "setVar", a: [`${id}.persona`, "true"], by: "Director" }]);
    const guest = (await register(rt, "Calculator")).json.id as string;
    expect(rt.liveSim!.world.get(`${guest}.persona`)).toEqual({ kind: "null" });
  });

  it("the persona flag is set before the join's own hooks run (a join rule can leave it out)", async () => {
    const story = `# Joins
start: Doors

ROLE Guest
  when someone joins:
    if guest.persona == true:
      set Night.persona_joins += 1
    else:
      set Night.real_joins += 1

CHARACTER Calculator

== Doors
Hello.
`;
    const dir = tempDir();
    const rt = runtime(dir, { scenarioSource: story });
    rt.openDoors();
    const id = (await mod(rt, "/api/mod/persona", { name: "Ana" })).json.guest.id as string;
    await register(rt, "Calculator");
    expect(rt.liveSim!.world.get("Night.persona_joins")).toEqual({ kind: "number", value: 1 });
    expect(rt.liveSim!.world.get("Night.real_joins")).toEqual({ kind: "number", value: 1 });
    // The flag is journaled ahead of the creation, so a replay agrees.
    const ops = new Store(dir).readJournal().filter((e) => e.a[0] === id || e.a[0] === `${id}.persona`).map((e) => e.m);
    expect(ops).toEqual(["setVar", "createPerson"]);
    const again = runtime(dir, { scenarioSource: story });
    again.restore();
    expect(again.liveSim!.world.get("Night.persona_joins")).toEqual({ kind: "number", value: 1 });
    expect(again.liveSim!.world.get(`${id}.persona`)).toEqual({ kind: "bool", value: true });
  });

  it("a ROLE that seeds a `persona` default does not clear a Run persona's flag", async () => {
    const story = `# Roles
start: Doors

ROLE Guest
  persona: bool = false

CHARACTER Calculator

== Doors
Hello.
`;
    const rt = runtime(tempDir(), { scenarioSource: story });
    rt.openDoors();
    const id = (await mod(rt, "/api/mod/persona", { name: "Ana" })).json.guest.id as string;
    expect(rt.liveSim!.world.get(`${id}.persona`)).toEqual({ kind: "bool", value: true });
    const guest = (await register(rt, "Calculator")).json.id as string;
    expect(rt.liveSim!.world.get(`${guest}.persona`)).toEqual({ kind: "bool", value: false });
  });
});

describe("guest countdowns (W-06)", () => {
  it("only `for guests` lines reach the phone, never a secret head; `paused` while the clock stops", async () => {
    const rt = runtime();
    rt.openDoors();
    const { token } = (await register(rt, "Calculator")).json as { token: string };
    expect(await state(rt, "role=guest", { token })).not.toHaveProperty("countdowns");
    expect(await state(rt, "role=guest", { token })).not.toHaveProperty("paused");
    rt.tickOnce(10_000);
    await mod(rt, "/api/mod/var", { path: "Night.summons_end", value: "70" });
    await mod(rt, "/api/mod/var", { path: "Night.y2k_end", value: "3000" });
    await mod(rt, "/api/mod/var", { path: "Kernel.deadline", value: "4242" });
    const view = await state(rt, "role=guest", { token });
    expect(view.countdowns).toEqual([{ label: "Summons", path: "Night.summons_end", endsAt: 70 }]);
    expect(JSON.stringify(view)).not.toContain("4242");
    expect((await state(rt, "role=mod", { moderator: true })).countdowns.map((c: { label: string }) => c.label)).toEqual(["Summons", "Midnight"]);

    rt.pause();
    const paused = await state(rt, "role=guest", { token });
    expect(paused.paused).toBe(true);
    expect(paused.countdowns).toEqual(view.countdowns);
    rt.openDoors();
    expect(await state(rt, "role=guest", { token })).not.toHaveProperty("paused");
    rt.tickOnce(61_000); // past the deadline
    expect(await state(rt, "role=guest", { token })).not.toHaveProperty("countdowns");
  });
});
