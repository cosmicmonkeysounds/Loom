//! Wave 26 (C2, R1): the locked phone. The story's `lock:` header, held per
//! guest like `reinstall:`, locks a program's phone: `GuestView.locked`, the
//! buttons narrowed to the `restricted: allow` ones, and every state-changing
//! `/api/guest/*` POST answers `403 {"error": "locked"}` (DMs included)
//! before any check but the token's. `LOCKED_OPEN` lists the routes that
//! stay open; a route walk below proves every guest route is either on it
//! or refused, so a new route can't slip past. Release lifts the lock on
//! the next snapshot (it is derived, never journaled).

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { EventRuntime, LOCKED_OPEN } from "../server/event-runtime.ts";
import { Store } from "../server/store.ts";
import { guestView, isLocked, type GuestView } from "../server/views.ts";
import { CREW_GUEST_ROUTES } from "../server/routes/crews.ts";
import * as k13 from "../server/routes/k13.ts";
import * as k31b from "../server/routes/k31b.ts";
import * as n02 from "../server/routes/n02.ts";
import * as rejoin from "../server/routes/rejoin.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { Workspace } from "../src/lsp/index.ts";

const CODES = { event: "EVT926", prime: "PRM926", mod: "MOD926" };

const STORY = `# Lock
directory: everyone
lock: program.corrupted == true and Night.banish != true

ROLE Program
  corrupted: bool = false

CHARACTER Installation Wizard

LOCATION The Desktop

INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  restricted: allow
  while: program.afk != true

INTERACTION wave
  label: 👋 Wave
  who: guest

INTERACTION corrupt
  who: admin

INTERACTION clean
  who: admin

INTERACTION banish_all
  who: admin

when corrupt for program:
  set program.corrupted = true

when clean for program:
  set program.corrupted = false

when banish_all:
  set Night.banish = true

when go to the bathroom for program:
  set program.afk = true
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function freshRuntime(source = STORY): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-w26-lock-"));
  dirs.push(d);
  const rt = new EventRuntime({ eventId: "evt", store: new Store(d), codes: CODES, scenarioName: "lock", scenarioSource: source, joinBase: () => "http://localhost" });
  rt.openDoors();
  return rt;
}
function fakeReq(body: unknown, token?: string): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers: token ? { "x-loom-token": token } : {},
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
async function post(rt: EventRuntime, path: string, body: unknown, token?: string, moderator = false) {
  const res = fakeRes();
  await rt.handle(fakeReq(body, token), res, "POST", path, new URL(`http://x${path}`), { moderator });
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(res.body || "{}") as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.statusCode, json };
}
async function get(rt: EventRuntime, path: string) {
  const res = fakeRes();
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq({}), res, "GET", url.pathname, url, {});
  return { status: res.statusCode, json: JSON.parse(res.body || "{}") as Record<string, unknown> };
}
async function guest(rt: EventRuntime, name: string): Promise<{ id: string; token: string }> {
  const r = await post(rt, "/api/guest/register", { name, passcode: CODES.event });
  expect(r.status).toBe(200);
  return { id: r.json.id as string, token: r.json.token as string };
}
const signal = (rt: EventRuntime, name: string, subject = "") => post(rt, "/api/mod/signal", { name, subject }, undefined, true);
const stateOf = async (rt: EventRuntime, token: string) => (await get(rt, `/api/state?role=guest&token=${encodeURIComponent(token)}`)).json as unknown as GuestView;

describe("the lock: header (model, isLocked, GuestView)", () => {
  it("reads the first non-empty lock: line; no header = never locked", () => {
    const sim = Sim.fromSources(STORY);
    expect(sim.model.lock).toBe("program.corrupted == true and Night.banish != true");
    sim.createPerson("g-1", "Bugdom", "Program");
    expect(isLocked(sim, "g-1")).toBe(false);
    sim.signal("corrupt", "g-1");
    expect(isLocked(sim, "g-1")).toBe(true);
    expect(isLocked(sim, "nobody")).toBe(false);
    const open = Sim.fromSources(STORY.replace(/^lock: .*\n/mu, ""));
    expect(open.model.lock).toBeNull();
    open.createPerson("g-1", "Bugdom", "Program");
    open.signal("corrupt", "g-1");
    expect(isLocked(open, "g-1")).toBe(false);
    expect(guestView(open, "g-1").locked).toBe(false);
  });

  it("a locked guest keeps only the restricted: allow buttons; restricted stays false; a banished night does not lock", () => {
    const sim = Sim.fromSources(STORY);
    sim.createPerson("g-1", "Bugdom", "Program");
    expect(guestView(sim, "g-1").interactions.map((i) => i.id).sort()).toEqual(["go to the bathroom", "wave"]);
    sim.signal("corrupt", "g-1");
    const v = guestView(sim, "g-1");
    expect(v.locked).toBe(true);
    expect(v.restricted).toBe(false);
    expect(v.interactions.map((i) => i.id)).toEqual(["go to the bathroom"]);
    sim.signal("banish_all");
    expect(guestView(sim, "g-1").locked).toBe(false);
  });
});

describe("a locked phone's writes are refused (the server)", () => {
  it("DMs, room posts and buttons answer 403 locked; Bathroom Mode and the GETs work; release unlocks", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Bugdom");
    expect((await post(rt, "/api/guest/say", { channel: "dm:Installation Wizard", text: "hi" }, a.token)).status).toBe(200);
    expect((await signal(rt, "corrupt", a.id)).status).toBe(200);
    const view = await stateOf(rt, a.token);
    expect(view.locked).toBe(true);
    expect(view.interactions.map((i) => i.id)).toEqual(["go to the bathroom"]);
    for (const channel of ["dm:Installation Wizard", "lobby"]) {
      const r = await post(rt, "/api/guest/say", { channel, text: "help" }, a.token);
      expect([r.status, r.json.error]).toEqual([403, "locked"]);
    }
    expect((await post(rt, "/api/guest/act", { name: "wave" }, a.token)).json).toEqual({ error: "locked" });
    expect((await post(rt, "/api/guest/act", { name: "no such thing" }, a.token)).json).toEqual({ error: "locked" });
    expect((await post(rt, "/api/guest/act", { name: "go to the bathroom" }, a.token)).status).toBe(200);
    // A dead token is the route's own 401, never "locked".
    expect((await post(rt, "/api/guest/say", { channel: "lobby", text: "x" }, "not-a-token")).status).toBe(401);
    // Release (the story clears the slot): the next call is open again.
    expect((await signal(rt, "clean", a.id)).status).toBe(200);
    expect((await stateOf(rt, a.token)).locked).toBe(false);
    expect((await post(rt, "/api/guest/say", { channel: "dm:Installation Wizard", text: "back" }, a.token)).status).toBe(200);
    expect((await post(rt, "/api/guest/act", { name: "wave" }, a.token)).status).toBe(200);
  });

  it("another guest is never refused for the locked one", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Bugdom");
    const b = await guest(rt, "Clippit");
    await signal(rt, "corrupt", a.id);
    expect((await post(rt, "/api/guest/say", { channel: "lobby", text: "hello" }, b.token)).status).toBe(200);
  });
});

/** Every guest POST route the server knows, from the runtime's source and the route modules. */
function everyGuestRoute(): string[] {
  const here = new URL("../server/", import.meta.url);
  const runtime = readFileSync(new URL("event-runtime.ts", here), "utf8");
  const push = readFileSync(new URL("routes/k31.ts", here), "utf8");
  const out = new Set<string>();
  for (const m of runtime.matchAll(/"(\/api\/guest\/[A-Za-z0-9/_-]*)"/gu)) if (!m[1]!.endsWith("/")) out.add(m[1]!);
  for (const m of push.matchAll(/case "(\/api\/push\/[a-z]+)"/gu)) out.add(m[1]!);
  for (const r of CREW_GUEST_ROUTES) out.add(r);
  for (const mod of [k13, k31b, n02, rejoin] as unknown as Array<Record<string, unknown>>) {
    for (const v of Object.values(mod)) if (typeof v === "string" && /^\/api\/(guest|push)\//u.test(v)) out.add(v);
  }
  out.add(n02.LOGOUT_ROUTE);
  return [...out].sort();
}

describe("the route walk: every guest route is open or refused", () => {
  it("finds the routes the contract names", () => {
    const routes = everyGuestRoute();
    for (const r of ["/api/guest/say", "/api/guest/choose", "/api/guest/widget", "/api/guest/escape", "/api/guest/join", "/api/guest/defect", "/api/guest/channel/invite", "/api/guest/channel/leave", "/api/guest/codex/redeem", "/api/guest/codex/share", "/api/guest/wallet/send", "/api/guest/picture", "/api/guest/checkin", "/api/guest/act", ...CREW_GUEST_ROUTES]) {
      expect(routes, r).toContain(r);
    }
    // The open set is exactly the session housekeeping the contract lists.
    expect([...LOCKED_OPEN].sort()).toEqual(
      ["/api/guest/register", "/api/guest/resume", "/api/guest/enter", "/api/guest/rejoin", "/api/guest/rejoin/names", "/api/guest/rejoin/poll", "/api/guest/badge", "/api/guest/homescreen", "/api/prime/logout", "/api/push/subscribe", "/api/push/unsubscribe", "/api/push/visible"].sort(),
    );
  });

  it("each route answers 403 locked for a locked guest, unless it is in LOCKED_OPEN", async () => {
    const rt = freshRuntime();
    const a = await guest(rt, "Bugdom");
    await guest(rt, "Clippit");
    await signal(rt, "corrupt", a.id);
    const routes = everyGuestRoute();
    const refused = routes.filter((r) => !LOCKED_OPEN.includes(r));
    // The open ones last (logout at the very end: it ends the session).
    const open = routes.filter((r) => LOCKED_OPEN.includes(r)).sort((x, y) => Number(x === n02.LOGOUT_ROUTE) - Number(y === n02.LOGOUT_ROUTE));
    expect(refused.length).toBeGreaterThan(30);
    for (const r of refused) {
      const res = await post(rt, r, { name: "wave", channel: "lobby", text: "x" }, a.token);
      expect([r, res.status, res.json.error]).toEqual([r, 403, "locked"]);
    }
    for (const r of open) {
      const res = await post(rt, r, {}, a.token);
      expect([r, res.json.error]).not.toEqual([r, "locked"]);
    }
  });
});

describe("L1216: the lock: header", () => {
  const diags = (source: string) => {
    const ws = new Workspace();
    ws.open("file:///main.loom", source);
    return (ws.diagnosticsFor("file:///main.loom")?.diagnostics ?? []).filter((d) => d.code === "L1216");
  };
  it("a lock: line that is no expression is an error; a good one is clean", () => {
    expect(diags(STORY)).toEqual([]);
    const bad = diags(STORY.replace(/^lock: .*$/mu, "lock: (("));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.message).toContain("`lock: ((` is no expression");
    expect(bad[0]!.severity).toBe(1);
  });
});
