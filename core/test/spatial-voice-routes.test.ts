//! The voice link's routes (wave 19, `docs/loom-reinstall.md` §2.4) on a
//! real `EventRuntime` with a fake clock: a terminal stream and a player
//! stream, uploads both ways, the spatial loop re-routing a move, every
//! refusal, a stream closing with its session and on a story reset.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { VOICE_MAX_BYTES } from "@loom/house";
import type { Assignment, Vec3 } from "@loom/house";
import { EventRuntime } from "../server/event-runtime.ts";
import { PayloadTooLarge } from "../server/http-util.ts";
import { wantsModRead } from "../server/routing.ts";
import { Store } from "../server/store.ts";
import { scenarioSource } from "../examples/load.ts";

/** Where the show map puts people (main floor y 0, basement −2.7). */
const AT = {
  hall: [-1, 0, 13] as Vec3,
  serverRoom: [3.9, -2.7, 25] as Vec3,
};

const SCENARIO = scenarioSource("trapped-in-the-internet");
const CODES = { event: "EVT224", prime: "PRM224", mod: "MOD224" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(clock: { t: number }): EventRuntime {
  const d = mkdtempSync(join(tmpdir(), "loom-voice-"));
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

function fakeReq(body: Buffer, headers: Record<string, string>, onClose: Array<() => void>): IncomingMessage {
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      if (body.length > 0) yield body;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") onClose.push(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
}

/** One SSE stream held open: its frames parsed as they are written. */
interface Stream {
  status: number;
  frames: Array<{ event: string; data: Record<string, unknown> }>;
  ended: boolean;
  close(): void;
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  let status = 0;
  let head: Record<string, string> = {};
  let raw = "";
  const res = {
    writeHead(s: number, h?: Record<string, string>) {
      status = s;
      head = h ?? {};
      return res;
    },
    write(c: string) {
      raw += c;
      return true;
    },
    end(b?: string | Buffer) {
      if (b !== undefined) raw += b.toString();
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body ?? {}));
  const handled = await rt.handle(fakeReq(buf, headers, []), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  const isJson = (head["content-type"] ?? "").includes("json");
  return { handled, status, head, json: isJson && raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

/** Open `GET /api/spatial/voice/stream…` and keep it. */
async function stream(rt: EventRuntime, path: string, auth: Auth = {}): Promise<Stream & { json: Record<string, unknown> }> {
  const closers: Array<() => void> = [];
  let buf = "";
  const s = {
    status: 0,
    frames: [] as Stream["frames"],
    ended: false,
    json: {} as Record<string, unknown>,
    close: () => {
      for (const f of closers) f();
    },
  };
  let isSse = false;
  const res = {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    writeHead(st: number, h?: Record<string, string>) {
      s.status = st;
      isSse = (h?.["content-type"] ?? "").includes("event-stream");
      return res;
    },
    write(c: string) {
      buf += c;
      let at: number;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const ev = /^event: (.+)$/mu.exec(block);
        const data = /^data: (.+)$/mu.exec(block);
        if (ev && data) s.frames.push({ event: ev[1]!, data: JSON.parse(data[1]!) as Record<string, unknown> });
      }
      return true;
    },
    end(b?: string) {
      if (b !== undefined && !isSse) s.json = JSON.parse(b) as Record<string, unknown>;
      s.ended = true;
      res.writableEnded = true;
      return res;
    },
    on() {
      return res;
    },
  };
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  await rt.handle(fakeReq(Buffer.alloc(0), headers, closers), res as unknown as ServerResponse, "GET", url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  return s;
}
const of = (s: Stream, event: string) => s.frames.filter((f) => f.event === event).map((f) => f.data);

async function setup(clock: { t: number }) {
  const rt = runtime(clock);
  rt.openDoors();
  const modToken = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
  const gid = ((await call(rt, "POST", "/api/mod/persona", { name: "Pinball" }, { moderator: true })).json.guest as { id: string }).id;
  await call(rt, "POST", "/api/mod/signal", { name: "send to the internet", subject: gid, actor: "Norton Anti-Virus" }, { moderator: true });
  const a = (await call(rt, "POST", "/api/mod/spatial/begin", { guest: gid, world: "vr", device: "Headset" }, { moderator: true })).json as unknown as Assignment;
  expect(typeof a.token).toBe("string");
  return { rt, modToken, a };
}
const pose = (rt: EventRuntime, token: string, p: Vec3) => call(rt, "POST", "/api/spatial/pose", { p, yaw: 0 }, { token });

describe("EventRuntime — the voice link", () => {
  it("a terminal and a player hear each other: hello, listen, voice both ways, bye", async () => {
    const clock = { t: 50_000 };
    const { rt, modToken, a } = await setup(clock);
    expect((await pose(rt, a.token, AT.hall)).status).toBe(204);

    const term = await stream(rt, `/api/spatial/voice/stream?token=${modToken}&spot=hall`);
    expect(term.status).toBe(200);
    expect(of(term, "hello")).toEqual([{ codec: "mulaw", rate: 16000, chunkMs: 200, as: "terminal", spot: "hall", listen: false }]);
    const player = await stream(rt, `/api/spatial/voice/stream?token=${a.token}`);
    expect(player.status).toBe(200);
    expect(of(player, "hello")).toEqual([{ codec: "mulaw", rate: 16000, chunkMs: 200, as: "player", session: a.session, listen: true }]);
    expect(of(term, "listen")).toEqual([{ on: true }]);

    // The terminal speaks: the player hears it at full gain (same room).
    const up = await call(rt, "POST", "/api/spatial/voice?seq=1&spot=hall", Buffer.alloc(3200, 0x80), { token: modToken });
    expect(up.status).toBe(200);
    expect(up.json).toEqual({ ok: true, listening: true });
    expect(of(player, "voice")).toEqual([{ from: "t:hall", kind: "terminal", spot: "hall", name: expect.any(String), gain: 1, seq: 1, data: Buffer.alloc(3200, 0x80).toString("base64") }]);
    // A stale seq: 200, dropped, nothing sent.
    expect((await call(rt, "POST", "/api/spatial/voice?seq=1&spot=hall", Buffer.alloc(3200), { token: modToken })).json).toEqual({ ok: true, listening: true, dropped: true });
    expect(of(player, "voice")).toHaveLength(1);

    // The player speaks back.
    const back = await call(rt, "POST", "/api/spatial/voice?seq=1", Buffer.alloc(1600, 0x7f), { token: a.token });
    expect(back.json).toEqual({ ok: true, listening: true });
    expect(of(term, "voice").map((v) => [v.from, v.kind, v.session, v.name, v.gain])).toEqual([[`s:${a.session}`, "player", a.session, "Pinball", 1]]);

    // Down the stairs: the spatial loop's next tick re-routes → bye + listen off.
    await pose(rt, a.token, AT.serverRoom);
    clock.t += 100;
    await new Promise((r) => setTimeout(r, 130));
    expect(of(player, "bye")).toEqual([{ from: "t:hall" }]);
    expect(of(term, "bye")).toEqual([{ from: `s:${a.session}` }]);
    expect(of(term, "listen")).toEqual([{ on: true }, { on: false }]);
    const away = await call(rt, "POST", "/api/spatial/voice?seq=2&spot=hall", Buffer.alloc(3200), { token: modToken });
    expect(away.json).toEqual({ ok: true, listening: false, dropped: true });

    // The session ends: the player's stream closes; its token is over (410).
    expect((await call(rt, "POST", "/api/spatial/end", {}, { token: a.token })).status).toBeLessThan(300);
    await new Promise((r) => setTimeout(r, 130));
    expect(player.ended).toBe(true);
    expect(term.ended).toBe(false);
    expect((await call(rt, "POST", "/api/spatial/voice?seq=3", Buffer.alloc(3200), { token: a.token })).status).toBe(410);
    expect((await stream(rt, `/api/spatial/voice/stream?token=${a.token}`)).status).toBe(410);

    rt.dispose();
    expect(term.ended).toBe(true);
  });

  it("refuses: 400 / 401 / 403 / 404 / 413", async () => {
    const clock = { t: 1_000 };
    const { rt, modToken, a } = await setup(clock);
    await pose(rt, a.token, AT.hall);
    const up = (path: string, body: Buffer, token?: string) => call(rt, "POST", path, body, token !== undefined ? { token } : {});
    const b = Buffer.alloc(3200);
    expect((await up("/api/spatial/voice?seq=1", b)).status).toBe(401);
    expect((await up("/api/spatial/voice?seq=1", b, "forged")).status).toBe(401);
    expect((await up("/api/spatial/voice?seq=x", b, a.token)).status).toBe(400);
    expect((await up("/api/spatial/voice?seq=1", Buffer.alloc(10), a.token)).status).toBe(400);
    expect((await up("/api/spatial/voice?seq=1&spot=hall", b, a.token)).json.error).toBe("moderators only");
    expect((await up("/api/spatial/voice?seq=1&spot=hall", b, "forged")).status).toBe(403);
    const moon = await up("/api/spatial/voice?seq=1&spot=the-moon", b, modToken);
    expect([moon.status, moon.json.error]).toEqual([404, "no such spot"]);
    const tent = await up("/api/spatial/voice?seq=1&spot=tent", b, modToken);
    expect([tent.status, tent.json.error]).toEqual([403, "voice is off at this terminal"]);
    // A mod token without a spot is no game session: name the spot.
    expect((await up("/api/spatial/voice?seq=1", b, modToken)).status).toBe(400);
    // Past the cap the body never reaches the parser (the router answers 413).
    await expect(up("/api/spatial/voice?seq=1", Buffer.alloc(VOICE_MAX_BYTES + 1), a.token)).rejects.toBeInstanceOf(PayloadTooLarge);

    // The stream: the same refusals as plain HTTP before it opens.
    expect((await stream(rt, "/api/spatial/voice/stream")).status).toBe(401);
    expect((await stream(rt, "/api/spatial/voice/stream?token=forged")).status).toBe(401);
    expect((await stream(rt, `/api/spatial/voice/stream?token=${a.token}&spot=hall`)).status).toBe(403);
    expect((await stream(rt, `/api/spatial/voice/stream?token=${modToken}&spot=the-moon`)).status).toBe(404);
    const t = await stream(rt, `/api/spatial/voice/stream?token=${modToken}&spot=tent`);
    expect([t.status, t.json.error]).toEqual([403, "voice is off at this terminal"]);
    expect((await stream(rt, `/api/spatial/voice/stream?token=${modToken}`)).status).toBe(400);
    // An author session (the editor) may listen as a terminal.
    expect((await stream(rt, "/api/spatial/voice/stream?spot=hall", { moderator: true })).status).toBe(200);
    rt.dispose();
  });

  it("a story reset closes every voice stream", async () => {
    const clock = { t: 5_000 };
    const { rt, modToken, a } = await setup(clock);
    await pose(rt, a.token, AT.hall);
    const term = await stream(rt, `/api/spatial/voice/stream?token=${modToken}&spot=hall`);
    const player = await stream(rt, `/api/spatial/voice/stream?token=${a.token}`);
    expect((await call(rt, "POST", "/api/mod/reset", {}, { moderator: true })).status).toBe(200);
    expect(term.ended && player.ended).toBe(true);
    rt.dispose();
  });

  it("the stream path is a mod read (the editor's cookie); the upload is not", () => {
    const p = new URLSearchParams();
    expect(wantsModRead("/api/spatial/voice/stream", p)).toBe(true);
    expect(wantsModRead("/api/spatial/voice", p)).toBe(false);
  });
});
