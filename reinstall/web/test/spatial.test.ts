import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuckSpot, PlayerState, SpatialFrame } from "@loom/house";
import { applyFrame, decodeFrame, duckToAdopt, houseVersionOf, isDuckSpot } from "../src/spatial.ts";
import { fetchDealtHouse, fetchHouse, postFound, saveHouse, type LoadedHouse } from "../src/api.ts";
import type { ReinstallConfig } from "../src/config.ts";
import { SHOW } from "./houses.ts";

const player = (session: string, x = 0): PlayerState => ({
  session,
  guest: `g-${session}`,
  name: `P ${session}`,
  world: "web",
  device: "Tent tablet",
  p: [x, 0, 0],
  yaw: 0,
  pitch: 0,
  room: "a",
  floor: "f",
  duck: { id: "d", room: "b", pos: [6, 0, 2] },
  found: false,
  startedAt: 1,
});
const table = (...ps: PlayerState[]) => new Map(ps.map((p) => [p.session, p]));

describe("applyFrame", () => {
  it("hello replaces the table; join adds", () => {
    let t = applyFrame(table(player("x")), { event: "hello", data: { eventId: "e", houseVersion: "v", players: [player("a")] } });
    expect([...t.keys()]).toEqual(["a"]);
    t = applyFrame(t, { event: "join", data: { player: player("b") } });
    expect([...t.keys()]).toEqual(["a", "b"]);
  });

  it("poses move known players only, and keep the table when nobody known moved", () => {
    const t0 = table(player("a"));
    const t1 = applyFrame(t0, { event: "poses", data: { t: 1, players: [{ session: "a", p: [2, 0, 1], yaw: 45, pitch: 5, room: "b", floor: "f" }] } });
    expect(t1.get("a")).toMatchObject({ p: [2, 0, 1], yaw: 45, pitch: 5, room: "b", name: "P a" });
    expect(t0.get("a")!.p).toEqual([0, 0, 0]); // never mutated
    const t2 = applyFrame(t1, { event: "poses", data: { t: 2, players: [{ session: "ghost", p: [9, 0, 9], yaw: 0, pitch: 0, room: null, floor: "f" }] } });
    expect(t2).toBe(t1);
  });

  it("found marks; leave removes; reset clears; house changes nothing", () => {
    let t = applyFrame(table(player("a"), player("b")), { event: "found", data: { session: "a", guest: "g-a", name: "P a", duck: player("a").duck, released: true, captured: false } });
    expect(t.get("a")!.found).toBe(true);
    t = applyFrame(t, { event: "leave", data: { session: "a", reason: "found" } });
    expect([...t.keys()]).toEqual(["b"]);
    expect(applyFrame(t, { event: "house", data: { version: "v2" } })).toBe(t);
    expect(applyFrame(t, { event: "reset", data: { kind: "reset" } }).size).toBe(0);
    const empty = new Map<string, PlayerState>();
    expect(applyFrame(empty, { event: "reset", data: { kind: "reset" } })).toBe(empty);
  });
});

describe("decodeFrame", () => {
  it("decodes our frames and ignores the rest", () => {
    const f = decodeFrame("leave", '{"session":"s-1","reason":"timeout"}') as SpatialFrame;
    expect(f).toEqual({ event: "leave", data: { session: "s-1", reason: "timeout" } });
    expect(decodeFrame("message", "{}")).toBeNull();
    expect(decodeFrame("poses", "{not json")).toBeNull();
  });
});

describe("houseVersionOf — a map change is caught up on reconnect", () => {
  it("reads `house` and `hello` (the reconnect frame), nothing else", () => {
    expect(houseVersionOf({ event: "house", data: { version: "v2" } } as SpatialFrame)).toBe("v2");
    expect(houseVersionOf({ event: "hello", data: { houseVersion: "v3", players: [] } } as unknown as SpatialFrame)).toBe("v3");
    expect(houseVersionOf({ event: "hello", data: { houseVersion: "", players: [] } } as unknown as SpatialFrame)).toBeNull();
    expect(houseVersionOf({ event: "reset", data: {} } as unknown as SpatialFrame)).toBeNull();
    expect(houseVersionOf({ event: "leave", data: { session: "s", reason: "ended" } } as unknown as SpatialFrame)).toBeNull();
  });
});

describe("fetchDealtHouse — play only on the map the session was dealt on", () => {
  const house = SHOW();
  const got = (version: string, source: LoadedHouse["source"] = "event"): LoadedHouse => ({ house, version, source });
  const sleep = async () => {};

  it("retries past the bundled stand-in (a blip) until the dealt version arrives", async () => {
    const replies = [got("bundled", "bundled"), got("bundled", "bundled"), got("v7")];
    let calls = 0;
    const r = await fetchDealtHouse("/e/x", "tok", "v7", { fetch: async () => replies[calls++]!, sleep });
    expect(calls).toBe(3);
    expect(r?.version).toBe("v7");
  });

  it("gives up (null) when the server stays away — never the bundled map", async () => {
    let calls = 0;
    const r = await fetchDealtHouse("/e/x", "tok", "v7", { attempts: 3, fetch: async () => (calls++, got("bundled", "bundled")), sleep });
    expect(calls).toBe(3);
    expect(r).toBeNull();
  });

  it("another version (a director saved in between) is refused at once", async () => {
    let calls = 0;
    const r = await fetchDealtHouse("/e/x", "tok", "v7", { fetch: async () => (calls++, got("v8")), sleep });
    expect(calls).toBe(1);
    expect(r).toBeNull();
  });
});

describe("duck — a map save moved (or re-dealt) a live player's duck", () => {
  const moved: DuckSpot = { id: "d2", room: "a", pos: [1, 0, 1] };

  it("replaces that player's duck; an unknown session, a malformed or unchanged spot changes nothing", () => {
    const t0 = table(player("a"), player("b"));
    const t1 = applyFrame(t0, { event: "duck", data: { session: "a", duck: moved } });
    expect(t1.get("a")!.duck).toEqual(moved);
    expect(t1.get("b")!.duck).toEqual(player("b").duck);
    expect(t0.get("a")!.duck).toEqual(player("a").duck); // never mutated
    expect(applyFrame(t1, { event: "duck", data: { session: "ghost", duck: moved } })).toBe(t1);
    expect(applyFrame(t1, { event: "duck", data: { session: "a", duck: { ...moved } } })).toBe(t1);
    expect(applyFrame(t1, { event: "duck", data: { session: "a", duck: { id: "x" } as unknown as DuckSpot } })).toBe(t1);
  });

  it("is one of our stream frames", () => {
    expect(decodeFrame("duck", JSON.stringify({ session: "s-1", duck: moved }))).toEqual({ event: "duck", data: { session: "s-1", duck: moved } });
  });

  it("duckToAdopt: a well-formed, different spot — else null (Gerald stays put)", () => {
    const cur = player("a").duck;
    expect(duckToAdopt(cur, moved)).toEqual(moved);
    expect(duckToAdopt(cur, { ...cur, pos: [6, 0, 2.5] })).toEqual({ ...cur, pos: [6, 0, 2.5] });
    expect(duckToAdopt(cur, { ...cur, room: "c" })).toEqual({ ...cur, room: "c" });
    expect(duckToAdopt(cur, { ...cur, pos: [...cur.pos] })).toBeNull();
    expect(duckToAdopt(cur, undefined)).toBeNull();
    expect(duckToAdopt(cur, { id: "d", room: "b", pos: [6, 0] })).toBeNull();
    expect(duckToAdopt(cur, { id: "d", room: "b", pos: [6, Number.NaN, 2] })).toBeNull();
    expect(isDuckSpot(moved)).toBe(true);
    expect(isDuckSpot(null)).toBe(false);
  });
});

// --- the routes, against a stubbed fetch -------------------------------------

type Call = { url: string; init: RequestInit | undefined };
function stubFetch(status: number, body: unknown): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetch: f };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchHouse — a session token's read carries its duck", () => {
  const house = SHOW();
  const spot = house.duck.spots[0]!;
  const duck: DuckSpot = { id: spot.id, room: spot.room, pos: spot.pos };

  it("adopts `duck` when the server sends one, and only a well-formed one", async () => {
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v9", source: "event", duck }).fetch);
    expect(await fetchHouse("/e/x", "sess-tok")).toMatchObject({ version: "v9", source: "event", duck });
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v9", source: "event", duck: { id: 3 } }).fetch);
    expect("duck" in (await fetchHouse("/e/x", "sess-tok"))).toBe(false);
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v9", source: "show" }).fetch);
    expect("duck" in (await fetchHouse("/e/x", "mod-tok"))).toBe(false);
  });
});

describe("postFound — a closed door is not a miss", () => {
  it("409 doors are closed → paused; 409 not near → far (with the distance)", async () => {
    expect(await postFound("/e/x", "t", stubFetch(409, { error: "doors are closed" }).fetch)).toEqual({ kind: "paused" });
    expect(await postFound("/e/x", "t", stubFetch(409, { error: "not near the duck", distance: 2.4 }).fetch)).toEqual({ kind: "far", distance: 2.4 });
    expect(await postFound("/e/x", "t", stubFetch(409, {}).fetch)).toEqual({ kind: "far", distance: null });
    expect(await postFound("/e/x", "t", stubFetch(200, { ok: true, released: true }).fetch)).toEqual({ kind: "found", result: { ok: true, released: true, already: false, captured: null } });
    // The server says whether the program is still captured after the find.
    expect(await postFound("/e/x", "t", stubFetch(200, { ok: true, released: false, captured: true }).fetch)).toEqual({ kind: "found", result: { ok: true, released: false, already: false, captured: true } });
    expect(await postFound("/e/x", "t", stubFetch(410, { error: "over" }).fetch)).toEqual({ kind: "over", status: 410 });
    expect(await postFound("/e/x", "t", stubFetch(500, { error: "boom" }).fetch)).toEqual({ kind: "error", message: "boom" });
  });
});

describe("saveHouse — based on the version the editor loaded", () => {
  const config = { eventId: "ev", token: "mod" } as ReinstallConfig;
  const house = SHOW();

  it("sends `base` (and leaves it out when there is none)", async () => {
    const s = stubFetch(200, { ok: true, version: "v2", warnings: [] });
    const r = await saveHouse(config, house, "v1", s.fetch);
    expect(r).toEqual({ ok: true, result: { ok: true, version: "v2", warnings: [] } });
    expect(s.calls[0]!.url).toBe("/e/ev/api/mod/spatial/house");
    expect(JSON.parse(String(s.calls[0]!.init!.body))).toMatchObject({ base: "v1" });
    const n = stubFetch(200, { ok: true, version: "v3", warnings: [] });
    await saveHouse(config, house, null, n.fetch);
    expect("base" in JSON.parse(String(n.calls[0]!.init!.body))).toBe(false);
  });

  it("409 the map changed → a conflict carrying the server's version; 400 → the problem list", async () => {
    const c = await saveHouse(config, house, "v1", stubFetch(409, { error: "the map changed — reload", version: "v5" }).fetch);
    expect(c).toEqual({ ok: false, status: 409, error: "the map changed — reload", problems: [], conflict: true, version: "v5" });
    const bad = await saveHouse(config, house, "v1", stubFetch(400, { error: "invalid house", problems: ["a door is off its wall"] }).fetch);
    expect(bad).toMatchObject({ ok: false, status: 400, conflict: false, problems: ["a door is off its wall"], version: null });
  });
});
