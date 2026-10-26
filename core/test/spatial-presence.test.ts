//! Wave 26 (C8, C4, C7): per-room presence on the server. `SpatialHub`
//! keeps each session's presence room (`presenceRoom`, with its doorway
//! hysteresis) beside the raw `locate` room the stream draws; the voice
//! relay routes by it (`voicePlayers`), the screen state's `spot.here`
//! counts it (`spotHere`), and the camera feeds follow it: a game session
//! lists only its own room's feeds (never the tent's), and a terminal's
//! upload hears whether anyone is watching (`watched`).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import { afterAll, describe, expect, it } from "vitest";

import { validateHouse, type Assignment, type HouseMap, type TerminalSpot } from "@loom/house";
import { EventRuntime } from "../server/event-runtime.ts";
import { SpatialHub } from "../server/spatial.ts";
import { Store } from "../server/store.ts";

const fixture = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../house/test/fixtures/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

/** two-rooms (a [0..4]×[0..3] with the spawn, b [4..7]×[0..3], door `ab` at
 *  [4, 1.5]) with three terminals: `t` in b (as the fixture has it), `ta` in
 *  a with its voice on, and the tent station `tent` in a (`view: reinstall`). */
function presenceHouse(): HouseMap {
  const base = fixture("two-rooms");
  const extra: TerminalSpot[] = [
    { id: "ta", name: "Terminal A", room: "a", pos: [0, 1.4, 1.5], yaw: -90, voice: true },
    { id: "tent", name: "Tent", room: "a", pos: [0, 1.4, 2.5], yaw: -90, view: "reinstall" },
  ];
  const v = validateHouse({ ...base, terminals: [...base.terminals, ...extra] });
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
}

type V3 = [number, number, number];
const pose = (p: V3) => ({ p, yaw: 0, pitch: 0 });
const IN_A: V3 = [3.5, 0, 1.5];
/** In room b, 0.3 m past door `ab`: a player who came from a is still in a. */
const B_DOORWAY: V3 = [4.3, 0, 1.5];
/** Well into room b. */
const IN_B: V3 = [5.5, 0, 1.5];

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

function hub(house: HouseMap | null = presenceHouse()) {
  let ids = 0;
  const hub = new SpatialHub({ eventId: "evt", now: () => 1_000, newSessionId: () => `s-${++ids}`, newToken: () => `tok-${ids}` });
  if (house !== null) hub.setHouse(house, "show", false);
  const begin = (guest: string, station: string | null = null): Assignment =>
    hub.begin({ guest, name: guest.toUpperCase(), world: station === null ? "web" : "vr", device: "Tent tablet", station, captured: false })!;
  return { hub, begin };
}

describe("SpatialHub — presence (C8)", () => {
  it("the doorway hysteresis holds the presence room; the stream keeps the raw room", () => {
    const h = hub();
    const a = h.begin("g-1");
    h.hub.pose(a.token, pose(IN_A));
    h.hub.pose(a.token, pose(B_DOORWAY));
    // The stream draws where the player really is …
    expect(h.hub.players()[0]!.room).toBe("b");
    expect(h.hub.flush()?.players[0]).toMatchObject({ room: "b" });
    // … the link judges by the presence room.
    expect(h.hub.voicePlayers()).toEqual([{ session: a.session, name: "G-1", p: B_DOORWAY, floor: "f", room: "a" }]);
    expect(h.hub.spotHere("t")).toBe(0);
    expect(h.hub.spotHere("ta")).toBe(1);
    h.hub.pose(a.token, pose(IN_B));
    expect(h.hub.voicePlayers()[0]!.room).toBe("b");
    expect([h.hub.spotHere("t"), h.hub.spotHere("ta")]).toEqual([1, 0]);
    // Back into the doorway from b: now b holds them.
    h.hub.pose(a.token, pose(B_DOORWAY));
    expect(h.hub.voicePlayers()[0]!.room).toBe("b");
  });

  it("a begin starts in the spawn's room; a map swap forgets the hysteresis", () => {
    const h = hub();
    const a = h.begin("g-1");
    expect(h.hub.voicePlayers()[0]!.room).toBe("a");
    h.hub.pose(a.token, pose(IN_A));
    h.hub.pose(a.token, pose(B_DOORWAY));
    expect(h.hub.voicePlayers()[0]!.room).toBe("a");
    const moved = presenceHouse();
    h.hub.setHouse({ ...moved, name: "Two rooms, edited" }, "event");
    expect(h.hub.voicePlayers()[0]!.room).toBe("b");
  });

  it("spotHere: counts joined players per spot room; 0 for the tent station; null for an unknown spot or no map", () => {
    const h = hub();
    h.begin("g-1");
    h.begin("g-2");
    h.begin("g-3", "quest-1"); // parked: not in the simulation yet
    expect(h.hub.spotHere("ta")).toBe(2);
    expect(h.hub.spotHere("tent")).toBe(0);
    expect(h.hub.spotHere("t")).toBe(0);
    expect(h.hub.spotHere("nowhere")).toBeNull();
    expect(hub(null).hub.spotHere("ta")).toBeNull();
  });

  it("linked(): the spots in an occupied presence room, never the tent; camSpotsFor: the session's own room only", () => {
    const h = hub();
    expect(h.hub.linked()).toEqual(new Set());
    const a = h.begin("g-1");
    expect(h.hub.linked()).toEqual(new Set(["ta"]));
    expect(h.hub.camSpotsFor(a.token)).toEqual(new Set(["ta"]));
    h.hub.pose(a.token, pose(IN_B));
    expect(h.hub.linked()).toEqual(new Set(["t"]));
    expect(h.hub.camSpotsFor(a.token)).toEqual(new Set(["t"]));
    const b = h.begin("g-2");
    expect(h.hub.linked()).toEqual(new Set(["t", "ta"]));
    expect(h.hub.camSpotsFor(b.token)).toEqual(new Set(["ta"]));
    // A parked assignment sees no feed yet; a dead token is null.
    const parked = h.begin("g-3", "quest-1");
    expect(h.hub.camSpotsFor(parked.token)).toEqual(new Set());
    expect(h.hub.camSpotsFor("nope")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The runtime: the voice link, spot.here, the cameras
// ---------------------------------------------------------------------------

const STORY = `# Presence
directory: everyone

ROLE Program
  seen: bool = false
`;
const CODES = { event: "EVT727", prime: "PRM727", mod: "MOD727" };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function runtime(): EventRuntime {
  const dir = mkdtempSync(join(tmpdir(), "loom-presence-"));
  dirs.push(dir);
  const houseFile = join(dir, "house.json");
  writeFileSync(houseFile, JSON.stringify(presenceHouse()));
  return new EventRuntime({ eventId: "evt", store: new Store(join(dir, "state")), codes: CODES, scenarioName: "presence", scenarioSource: STORY, houseFile, joinBase: () => "http://localhost" });
}

function fakeReq(body: unknown, headers: Record<string, string>, closers: Array<() => void> = []): IncomingMessage {
  const buf = Buffer.from(JSON.stringify(body ?? {}));
  return {
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield buf;
    },
    on(ev: string, fn: () => void) {
      if (ev === "close") closers.push(fn);
    },
    destroy() {},
  } as unknown as IncomingMessage;
}

type Auth = { moderator?: boolean; token?: string };
async function call(rt: EventRuntime, method: "GET" | "POST", path: string, body: unknown = {}, auth: Auth = {}) {
  let status = 0;
  let raw = "";
  let head: Record<string, string> = {};
  const res = {
    setHeader() {},
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
      if (b !== undefined) raw += typeof b === "string" ? b : "";
      return res;
    },
  } as unknown as ServerResponse;
  const url = new URL(`http://x${path}`);
  const headers: Record<string, string> = auth.token !== undefined ? { "x-loom-token": auth.token } : {};
  await rt.handle(fakeReq(body, headers), res, method, url.pathname, url, auth.moderator === true ? { moderator: true, moderatorName: "Ada" } : {});
  const isJson = (head["content-type"] ?? "application/json").includes("json");
  return { status, head, json: isJson && raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}
const mod = (rt: EventRuntime, path: string, body: unknown = {}) => call(rt, "POST", path, body, { moderator: true });

/** Open `GET /api/spatial/voice/stream…` and keep its frames. */
async function voiceStream(rt: EventRuntime, path: string) {
  const frames: Array<{ event: string; data: Record<string, unknown> }> = [];
  let buf = "";
  const res = {
    destroyed: false,
    writableEnded: false,
    writableLength: 0,
    writeHead() {
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
        if (ev && data) frames.push({ event: ev[1]!, data: JSON.parse(data[1]!) as Record<string, unknown> });
      }
      return true;
    },
    end() {
      res.writableEnded = true;
      return res;
    },
    on() {
      return res;
    },
  };
  const url = new URL(`http://x${path}`);
  await rt.handle(fakeReq(null, {}), res as unknown as ServerResponse, "GET", url.pathname, url, {});
  return (event: string) => frames.filter((f) => f.event === event).map((f) => f.data);
}

async function walker(rt: EventRuntime, name: string): Promise<Assignment> {
  const id = ((await mod(rt, "/api/mod/persona", { name })).json.guest as { id: string }).id;
  const a = (await mod(rt, "/api/mod/spatial/begin", { guest: id, world: "web", device: "Tent tablet", force: true })).json as unknown as Assignment;
  expect(a.token).toEqual(expect.any(String));
  return a;
}
const poseAt = (rt: EventRuntime, token: string, p: V3) => call(rt, "POST", "/api/spatial/pose", pose(p), { token });
/** A 1×1 JPEG-ish frame (SOI marker first). */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");

describe("EventRuntime — presence on the link", () => {
  it("the voice relay routes by the presence room: a player in b's doorway, come from a, still hears a's terminal", async () => {
    const rt = runtime();
    rt.openDoors();
    const modToken = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    const a = await walker(rt, "Pinball");
    await poseAt(rt, a.token, IN_A);
    await poseAt(rt, a.token, B_DOORWAY);
    const term = await voiceStream(rt, `/api/spatial/voice/stream?token=${modToken}&spot=ta`);
    const player = await voiceStream(rt, `/api/spatial/voice/stream?token=${a.token}`);
    expect(player("hello")[0]).toMatchObject({ as: "player", ears: 1 });
    expect(term("listen")).toEqual([{ on: true, ears: 1 }]);
    rt.dispose();
  });

  it("the screen state's spot.here counts the players in that spot's room (0 at the tent)", async () => {
    const rt = runtime();
    rt.openDoors();
    const modToken = (await call(rt, "POST", "/api/mod/login", { passcode: CODES.mod })).json.token as string;
    const here = async (spot: string) => ((await call(rt, "GET", `/api/screen/state?token=${modToken}&name=T&spot=${spot}`)).json.spot as { here?: number } | undefined)?.here;
    expect(await here("ta")).toBe(0);
    const a = await walker(rt, "Pinball");
    expect([await here("ta"), await here("t"), await here("tent")]).toEqual([1, 0, 0]);
    await poseAt(rt, a.token, IN_B);
    expect([await here("ta"), await here("t")]).toEqual([0, 1]);
    // A spot the map lacks: `here` left out (the terminal falls back).
    expect(await here("nowhere")).toBeUndefined();
    rt.dispose();
  });

  it("cams: a game session lists and fetches only its own room's feeds (never the tent); a moderator sees all; the upload says watched", async () => {
    const rt = runtime();
    rt.openDoors();
    const up = async (spot: string) => mod(rt, "/api/mod/spatial/cam", { spot, jpeg: JPEG, w: 1, h: 1 });
    // Nobody in the game: every upload is unwatched.
    expect((await up("t")).json).toMatchObject({ ok: true, watched: false });
    expect((await up("ta")).json).toMatchObject({ ok: true, watched: false });
    expect((await up("tent")).json).toMatchObject({ ok: true, watched: false });
    const a = await walker(rt, "Pinball");
    const list = async (auth: Auth) => ((await call(rt, "GET", "/api/spatial/cams", {}, auth)).json.cams as Array<{ spot: string }>).map((c) => c.spot);
    expect(await list({ moderator: true })).toEqual(["t", "ta", "tent"]);
    expect(await list({ token: a.token })).toEqual(["ta"]);
    expect((await call(rt, "GET", "/api/spatial/cam?spot=ta", {}, { token: a.token })).status).toBe(200);
    expect(await call(rt, "GET", "/api/spatial/cam?spot=t", {}, { token: a.token })).toMatchObject({ status: 404, json: { error: "no feed" } });
    expect(await call(rt, "GET", "/api/spatial/cam?spot=tent", {}, { token: a.token })).toMatchObject({ status: 404, json: { error: "no feed" } });
    expect((await call(rt, "GET", "/api/spatial/cam?spot=t", {}, { moderator: true })).status).toBe(200);
    // Uploads (spaced past the store's minimum gap) say who is watched.
    await new Promise((r) => setTimeout(r, 160));
    expect((await up("ta")).json).toMatchObject({ watched: true });
    expect((await up("tent")).json).toMatchObject({ watched: false });
    expect((await up("t")).json).toMatchObject({ watched: false });
    await poseAt(rt, a.token, IN_B);
    expect(await list({ token: a.token })).toEqual(["t"]);
    await new Promise((r) => setTimeout(r, 160));
    expect((await up("t")).json).toMatchObject({ watched: true });
    expect((await up("ta")).json).toMatchObject({ watched: false });
    rt.dispose();
  });
});
