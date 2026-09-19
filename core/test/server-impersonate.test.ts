//! Operator play-as sessions (`/api/mod/impersonate`) — the editor's Run →
//! Players page embeds one play app per rehearsal participant, each on a
//! session that IS that participant's own: exact capabilities (a booth is
//! never a moderator), journaled as the director, in memory only, and cut by
//! the same restarts that cut the real thing.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { EventRuntime } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

const SCENARIO = scenarioSource("escape-the-internet");
const CODES = { event: "EVT111", prime: "PRM111", mod: "MOD111" };

const dirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "loom-imp-"));
  dirs.push(d);
  return d;
}
function runtimeAt(d: string): EventRuntime {
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "escape-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
  });
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fakeReq(body: unknown, onClose?: (fn: () => void) => void): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: {},
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") onClose?.(fn);
    },
  } as unknown as IncomingMessage;
}
function fakeRes(): ServerResponse & { statusCode: number; body: string } {
  const res = {
    statusCode: 0,
    body: "",
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

/** POST as the director `Ada` (author session). */
async function mod(rt: EventRuntime, path: string, body: unknown) {
  const res = fakeRes();
  await rt.handle(fakeReq(body), res, "POST", path, new URL(`http://x${path}`), { moderator: true, moderatorName: "Ada" });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
/** POST with a capability token and no session. */
async function asToken(rt: EventRuntime, path: string, body: Record<string, unknown>, token: string) {
  const res = fakeRes();
  await rt.handle(fakeReq({ ...body, token }), res, "POST", path, new URL(`http://x${path}`), {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
async function getWith(rt: EventRuntime, path: string, moderator: boolean) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, { moderator });
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") };
}
/** Open an SSE stream; `close()` simulates the client going away. */
function stream(rt: EventRuntime, query: string) {
  let closer: (() => void) | undefined;
  let ended = false;
  const res = {
    writeHead() {
      return res;
    },
    write() {
      return true;
    },
    end() {
      ended = true;
      return res;
    },
  } as unknown as ServerResponse;
  const open = rt.handle(fakeReq(null, (fn) => (closer = fn)), res, "GET", "/events", new URL(`http://x/events?${query}`), {});
  return { open, close: () => closer?.(), isEnded: () => ended };
}

async function persona(rt: EventRuntime, name = "Puppet"): Promise<string> {
  return (await mod(rt, "/api/mod/persona", { name })).json.guest.id as string;
}
async function playAs(rt: EventRuntime, role: "guest" | "prime", id: string): Promise<string> {
  const r = await mod(rt, "/api/mod/impersonate", { role, id });
  expect(r.status).toBe(200);
  return r.json.token as string;
}

describe("operator play-as sessions", () => {
  it("a guest session acts exactly as the guest, attributed to the director", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const pid = await persona(rt);
    const minted = await mod(rt, "/api/mod/impersonate", { role: "guest", id: pid });
    expect(minted.json).toMatchObject({ role: "guest", id: pid, name: "Puppet", eventId: "evt" });
    const token = minted.json.token as string;

    // Their own view, over their own token.
    const view = await getWith(rt, `/api/state?role=guest&token=${token}`, false);
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({ id: pid, name: "Puppet" });

    expect((await asToken(rt, "/api/guest/say", { channel: "lobby", text: "typed in a pane" }, token)).status).toBe(200);
    const line = (await getWith(rt, `/api/history?id=${pid}`, true)).json.messages.find((m: { text: string }) => m.text === "typed in a pane");
    expect(line.from).toBe("Puppet");
    expect(line.via).toBe("Ada");
    const say = new Store(d).readJournal().find((l) => l.m === "say");
    expect(say?.by).toBe("Ada");
  });

  it("a wall terminal names itself: `label` becomes the journal's `by` and the feed's `via`", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const pid = await persona(rt);
    // A terminal holds a mod token, not an author session — so `by` would
    // otherwise be the generic "Director".
    const login = await asToken(rt, "/api/mod/login", { passcode: "MOD111" }, "");
    const modToken = login.json.token as string;
    const minted = await asToken(rt, "/api/mod/impersonate", { role: "guest", id: pid, label: "Terminal · Kitchen" }, modToken);
    expect(minted.status).toBe(200);
    const token = minted.json.token as string;
    expect((await asToken(rt, "/api/guest/say", { channel: "dm:Sysadmin", text: "typed at the wall" }, token)).status).toBe(200);
    const line = (await getWith(rt, `/api/history?id=${pid}`, true)).json.messages.find((m: { text: string }) => m.text === "typed at the wall");
    expect(line.via).toBe("Terminal · Kitchen");
    expect(new Store(d).readJournal().find((l) => l.m === "say")?.by).toBe("Terminal · Kitchen");
    // A director's own session keeps their name when no label is given.
    const own = await mod(rt, "/api/mod/impersonate", { role: "guest", id: pid });
    expect((await asToken(rt, "/api/guest/say", { channel: "lobby", text: "from the editor" }, own.json.token as string)).status).toBe(200);
    expect((await getWith(rt, `/api/history?id=${pid}`, true)).json.messages.find((m: { text: string }) => m.text === "from the editor").via).toBe("Ada");
  });

  it("a booth session performs as the character and is never a moderator", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = await persona(rt);
    const token = await playAs(rt, "prime", "Recruiter");

    expect((await asToken(rt, "/api/prime/say", { channel: "lobby", text: "in the booth" }, token)).status).toBe(200);
    const scan = await asToken(rt, "/api/scan", { target: pid }, token);
    expect(scan.status).toBe(200);
    expect(scan.json).toMatchObject({ scannedAs: "Recruiter", canModerate: false });
    // `as` needs the moderator capability — a booth can't borrow another character.
    expect((await asToken(rt, "/api/scan", { target: pid, as: "Sysadmin" }, token)).json.scannedAs).toBe("Recruiter");
    expect((await asToken(rt, "/api/mod/say", { channel: "lobby", text: "x" }, token)).status).toBe(403);
    expect((await getWith(rt, `/api/state?role=mod&token=${token}`, false)).status).toBe(403);
    // Roles don't cross: a booth token is no guest, a guest token no booth.
    expect((await asToken(rt, "/api/guest/say", { channel: "lobby", text: "x" }, token)).status).toBe(401);
    const guestToken = await playAs(rt, "guest", pid);
    expect((await asToken(rt, "/api/prime/say", { channel: "lobby", text: "x" }, guestToken)).status).toBe(403);
  });

  it("only a moderator can mint one, and only for someone who exists", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = await persona(rt);
    const res = fakeRes();
    const body = { role: "guest", id: pid };
    await rt.handle(fakeReq(body), res, "POST", "/api/mod/impersonate", new URL("http://x/api/mod/impersonate"), {});
    expect(res.statusCode).toBe(403);
    expect((await mod(rt, "/api/mod/impersonate", { role: "guest", id: "p-nobody" })).status).toBe(404);
    expect((await mod(rt, "/api/mod/impersonate", { role: "prime", id: "Nobody" })).status).toBe(404);
  });

  it("is never persisted — a server restart forgets it", async () => {
    const d = freshDir();
    const rt = runtimeAt(d);
    rt.openDoors();
    const pid = await persona(rt);
    const token = await playAs(rt, "guest", pid);
    for (const f of readdirSync(d)) expect(readFileSync(join(d, f), "utf8")).not.toContain(token);
    rt.pause();
    const rt2 = runtimeAt(d);
    expect(rt2.restore()).not.toBeNull();
    expect((await asToken(rt2, "/api/guest/say", { channel: "lobby", text: "ghost" }, token)).status).toBe(401);
  });

  it("follows the real session's lifetime: a restart cuts guests, going live cuts booths", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = await persona(rt);
    const guest = await playAs(rt, "guest", pid);
    const booth = await playAs(rt, "prime", "Recruiter");
    const g = stream(rt, `role=guest&token=${guest}`);
    const b = stream(rt, `role=prime&token=${booth}`);
    await Promise.all([g.open, b.open]);

    rt.restart();
    expect(g.isEnded()).toBe(true);
    expect(b.isEnded()).toBe(false);
    expect((await asToken(rt, "/api/guest/say", { channel: "lobby", text: "x" }, guest)).status).toBe(401);
    expect((await asToken(rt, "/api/prime/say", { channel: "lobby", text: "still here" }, booth)).status).toBe(200);

    rt.restart(rt.source, "escape-the-internet", { kind: "golive" });
    expect(b.isEnded()).toBe(true);
    expect((await asToken(rt, "/api/prime/say", { channel: "lobby", text: "x" }, booth)).status).toBe(403);
  });

  it("closing the pane ends the session and its stream", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const pid = await persona(rt);
    const token = await playAs(rt, "guest", pid);
    const s = stream(rt, `role=guest&token=${token}`);
    await s.open;
    expect((await mod(rt, "/api/mod/impersonate/end", { session: token })).status).toBe(200);
    expect(s.isEnded()).toBe(true);
    expect((await asToken(rt, "/api/guest/say", { channel: "lobby", text: "x" }, token)).status).toBe(401);
  });

  it("looking through a real guest's eyes doesn't mark them online; a played persona is present", async () => {
    const rt = runtimeAt(freshDir());
    rt.openDoors();
    const reg = await asToken(rt, "/api/guest/register", { name: "Alice", passcode: CODES.event }, "");
    const gid = reg.json.id as string;
    const pid = await persona(rt);
    const g = stream(rt, `role=guest&token=${await playAs(rt, "guest", gid)}`);
    const p = stream(rt, `role=guest&token=${await playAs(rt, "guest", pid)}`);
    await Promise.all([g.open, p.open]);
    const roster = (await getWith(rt, "/api/state?role=mod", true)).json.roster as Array<{ id: string; online: boolean }>;
    expect(roster.find((r) => r.id === gid)?.online).toBe(false);
    expect(roster.find((r) => r.id === pid)?.online).toBe(true);
  });
});
