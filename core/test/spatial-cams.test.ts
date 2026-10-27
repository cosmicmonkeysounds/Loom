//! The wall terminals' camera feeds (wave 14, `docs/loom-reinstall.md` §2.3):
//! the pure store + upload parser, then the three routes on a real
//! `EventRuntime` (upload by mod token, list + frame by a game session or a
//! moderator, 15 s freshness, a spot that leaves the map).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import type { Assignment, HouseMap } from "@loom/house";
import { CAM_FRESH_MS, CAM_MAX_BYTES, CAM_MIN_GAP_MS, CamStore, parseCamUpload } from "../server/spatial-cams.ts";
import { EventRuntime } from "../server/event-runtime.ts";
import { PayloadTooLarge } from "../server/http-util.ts";
import { wantsModRead } from "../server/routing.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

/** A tiny "JPEG": the SOI marker + filler (the server never decodes it). */
function jpeg(n = 64, fill = 7): Buffer {
  const b = Buffer.alloc(n, fill);
  b[0] = 0xff;
  b[1] = 0xd8;
  return b;
}
const frame = (spot: string, b = jpeg()) => ({ spot, jpeg: b.toString("base64"), w: 160, h: 120 });

describe("parseCamUpload", () => {
  it("takes {spot, jpeg, w, h}", () => {
    const out = parseCamUpload(frame("hall"));
    expect(out).toMatchObject({ ok: true, spot: "hall", w: 160, h: 120 });
    if (out.ok) expect(out.jpeg.equals(jpeg())).toBe(true);
  });

  it("400 a bad body: no spot, no jpeg, bad dims, not base64, not a JPEG", () => {
    expect(parseCamUpload({})).toMatchObject({ ok: false, status: 400 });
    expect(parseCamUpload({ ...frame("hall"), spot: " " })).toMatchObject({ ok: false, status: 400 });
    expect(parseCamUpload({ ...frame("hall"), w: 0 })).toMatchObject({ ok: false, status: 400 });
    expect(parseCamUpload({ ...frame("hall"), h: "120" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCamUpload({ ...frame("hall"), jpeg: "data:image/jpeg;base64,AAAA" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCamUpload({ ...frame("hall"), jpeg: Buffer.from("hello world").toString("base64") })).toMatchObject({ ok: false, status: 400 });
  });

  it("413 a JPEG over 96 KB decoded; exactly 96 KB passes", () => {
    expect(parseCamUpload(frame("hall", jpeg(CAM_MAX_BYTES)))).toMatchObject({ ok: true });
    expect(parseCamUpload(frame("hall", jpeg(CAM_MAX_BYTES + 1)))).toMatchObject({ ok: false, status: 413 });
  });
});

describe("CamStore", () => {
  it("keeps the latest frame per spot, drops a burst < 150 ms, forgets after 15 s", () => {
    const clock = { t: 1000 };
    const s = new CamStore({ now: () => clock.t });
    expect(s.put("hall", jpeg(10, 1), 160, 120)).toEqual({ at: 1000, dropped: false });
    clock.t += CAM_MIN_GAP_MS - 1;
    expect(s.put("hall", jpeg(10, 2), 160, 120)).toEqual({ at: 1000, dropped: true });
    expect(s.get("hall")!.jpeg[5]).toBe(1);
    clock.t = 1000 + CAM_MIN_GAP_MS;
    expect(s.put("hall", jpeg(10, 3), 80, 60)).toEqual({ at: clock.t, dropped: false });
    expect(s.list()).toEqual([{ spot: "hall", at: clock.t, w: 80, h: 60 }]);
    // Another spot is its own rate.
    expect(s.put("tent", jpeg(), 160, 120).dropped).toBe(false);
    clock.t += CAM_FRESH_MS;
    expect(s.list().map((c) => c.spot)).toEqual(["hall", "tent"]);
    clock.t += 1;
    expect(s.get("hall")).toBeNull();
    expect(s.list()).toEqual([]);
    expect(s.size).toBe(0);
  });

  it("retain drops spots no longer on the map", () => {
    const s = new CamStore({ now: () => 0 });
    s.put("hall", jpeg(), 1, 1);
    s.put("gone", jpeg(), 1, 1);
    s.retain(new Set(["hall"]));
    expect(s.list().map((c) => c.spot)).toEqual(["hall"]);
  });
});

// ---------------------------------------------------------------------------

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT223", prime: "PRM223", mod: "MOD223" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(clock: { t: number }): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-cams-"));
  dirs.push(d);
  return new EventRuntime({
    eventId: "evt",
    store: new Store(d),
    codes: CODES,
    scenarioName: "trapped-in-the-internet",
    scenarioSource: SCENARIO,
    joinBase: () => "http://localhost",
    now: () => clock.t,
  });
}

function fakeReq(body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const buf = Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on() {},
    destroy() {},
  } as unknown as IncomingMessage;
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  let status = 0;
  let head: Record<string, string> = {};
  let raw: Buffer = Buffer.alloc(0);
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      head = h ?? {};
      return res;
    },
    write() {
      return true;
    },
    end(b?: string | Buffer) {
      if (b !== undefined) raw = Buffer.isBuffer(b) ? b : Buffer.from(b);
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  const handled = await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  const isJson = (head["content-type"] ?? "").includes("json") || !(head["content-type"] ?? "").includes("image");
  return { handled, status, head, raw, json: isJson && raw.length > 0 ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>) : {} };
}

describe("EventRuntime — the camera feeds", () => {
  it("a terminal uploads by mod token; a game session lists and reads the frame", async () => {
    const clock = { t: 50_000 };
    const rt = runtime(clock);
    rt.openDoors();
    const modToken = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;

    const up = await call(rt, "POST", "/api/mod/spatial/cam", frame("hall", jpeg(200, 9)), { token: modToken });
    expect(up.status).toBe(200);
    // Wave 26 (C7): nobody is in the hall in the game, so nobody watches it.
    expect(up.json).toEqual({ ok: true, at: 50_000, watched: false });

    // A game session (a captured persona's begin) reads them like the map.
    const gid = ((await call(rt, "POST", "/api/mod/persona", { name: "Pinball" }, { moderator: true })).json.guest as { id: string }).id;
    await call(rt, "POST", "/api/mod/signal", { name: "send to the internet", subject: gid, actor: "Norton Anti-Virus" }, { moderator: true });
    const a = (await call(rt, "POST", "/api/mod/spatial/begin", { guest: gid, world: "web", device: "Tent tablet" }, { moderator: true })).json as unknown as Assignment;
    expect(typeof a.token).toBe("string");

    // Wave 26 (C7): only its own (presence) room's feeds. In the tent at
    // the spawn, the hall's feed is neither listed nor served.
    expect((await call(rt, "GET", "/api/spatial/cams", {}, { token: a.token })).json).toEqual({ cams: [] });
    expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { token: a.token })).json).toEqual({ error: "no feed" });
    expect((await call(rt, "POST", "/api/spatial/pose", { p: [-1, 0, 13], yaw: 0 }, { token: a.token })).status).toBe(204);

    const list = await call(rt, "GET", "/api/spatial/cams", {}, { token: a.token });
    expect(list.status).toBe(200);
    expect(list.json).toEqual({ cams: [{ spot: "hall", at: 50_000, w: 160, h: 120 }] });

    const one = await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { token: a.token });
    expect(one.status).toBe(200);
    expect(one.head).toMatchObject({ "content-type": "image/jpeg", "cache-control": "no-store", "x-cam-at": "50000" });
    expect(one.raw.equals(jpeg(200, 9))).toBe(true);

    // A moderator (token or author session) reads them too; the token in the query works.
    expect((await call(rt, "GET", `/api/spatial/cams?token=${modToken}`)).status).toBe(200);
    expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { moderator: true })).status).toBe(200);
    expect((await call(rt, "GET", "/api/spatial/cam?spot=tent", {}, { moderator: true })).status).toBe(404);

    // Someone in the hall watches it now (C7).
    clock.t += 200;
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall", jpeg(200, 9)), { token: modToken })).json).toMatchObject({ watched: true });

    // 15 s later the feed is gone from the list and the frame route.
    clock.t += 15_001;
    expect((await call(rt, "GET", "/api/spatial/cams", {}, { token: a.token })).json).toEqual({ cams: [] });
    expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { token: a.token })).status).toBe(404);
    rt.dispose();
  });

  it("refuses: no token, a game token uploading, a bad body, an unknown spot, oversize", async () => {
    const clock = { t: 1_000 };
    const rt = runtime(clock);
    const modToken = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall"))).status).toBe(403);
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall"), { token: "forged" })).status).toBe(403);
    expect((await call(rt, "GET", "/api/spatial/cams")).status).toBe(401);
    expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { token: "forged" })).status).toBe(401);
    expect((await call(rt, "POST", "/api/mod/spatial/cam", { spot: "hall" }, { token: modToken })).status).toBe(400);
    const nope = await call(rt, "POST", "/api/mod/spatial/cam", frame("the-moon"), { token: modToken });
    expect(nope.status).toBe(404);
    expect(nope.json.error).toBe("no such spot");
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall", jpeg(CAM_MAX_BYTES + 10)), { token: modToken })).status).toBe(413);
    // A body past the cap never parses (the router answers 413).
    await expect(call(rt, "POST", "/api/mod/spatial/cam", { ...frame("hall"), pad: "x".repeat(200 * 1024) }, { token: modToken })).rejects.toBeInstanceOf(PayloadTooLarge);
    rt.dispose();
  });

  it("a burst < 150 ms keeps the first frame (200, dropped); a spot leaving the map drops its feed", async () => {
    const clock = { t: 10_000 };
    const rt = runtime(clock);
    rt.openDoors();
    const m = { moderator: true };
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall", jpeg(30, 1)), m)).json).toEqual({ ok: true, at: 10_000, watched: false });
    clock.t += 100;
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall", jpeg(30, 2)), m)).json).toEqual({ ok: true, at: 10_000, dropped: true, watched: false });
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("tent"), m)).status).toBe(200);
    expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, m)).raw[5]).toBe(1);

    const show = (await call(rt, "GET", "/api/spatial/house", {}, m)).json.house as HouseMap;
    const edited: HouseMap = { ...show, terminals: show.terminals.filter((t) => t.id !== "hall") };
    expect((await call(rt, "POST", "/api/mod/spatial/house", { house: edited }, m)).status).toBe(200);
    expect(((await call(rt, "GET", "/api/spatial/cams", {}, m)).json.cams as Array<{ spot: string }>).map((c) => c.spot)).toEqual(["tent"]);
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall"), m)).status).toBe(404);
    rt.dispose();
  });

  it("a host booth, a performer or a guest never uploads or reads a feed", async () => {
    const clock = { t: 20_000 };
    const rt = runtime(clock);
    rt.openDoors();
    expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall"), { moderator: true })).status).toBe(200);
    const login = await call(rt, "POST", "/api/prime/login", { character: "Task Manager", passcode: CODES.prime });
    expect(login.json.host).toBe(true);
    const host = login.json.token as string;
    const norton = (await call(rt, "POST", "/api/prime/login", { character: "Norton Anti-Virus", passcode: CODES.prime })).json.token as string;
    const guest = (await call(rt, "POST", "/api/guest/register", { name: "Winamp", passcode: CODES.event })).json.token as string;
    for (const token of [host, norton, guest]) {
      expect(typeof token).toBe("string");
      expect((await call(rt, "POST", "/api/mod/spatial/cam", frame("hall"), { token })).status).toBe(403);
      expect((await call(rt, "GET", "/api/spatial/cams", {}, { token })).status).toBe(401);
      expect((await call(rt, "GET", "/api/spatial/cam?spot=hall", {}, { token })).status).toBe(401);
    }
    rt.dispose();
  });

  it("the editor reads the feeds on its author session", () => {
    expect(wantsModRead("/api/spatial/cams", new URLSearchParams())).toBe(true);
    expect(wantsModRead("/api/spatial/cam", new URLSearchParams("spot=hall"))).toBe(true);
  });
});
