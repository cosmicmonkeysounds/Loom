//! The shared King and the ghosts' pictures on the wire (wave 11, C2 / C3):
//! `kingOf` (a missing field = an old server, no shared King), the
//! `POST /api/spatial/king/hit` replies, the map GET's `king`, the `avatar`
//! frame and the picture URL.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerState, SpatialFrame } from "@loom/house";
import { fetchHouse, postKingHit } from "../src/api.ts";
import { applyFrame, avatarKeyOf, avatarUrl, decodeFrame, FRAME_NAMES, kingOf } from "../src/spatial.ts";
import { SHOW } from "./houses.ts";

const KING = { id: "cold-lock-king", hp: 14, max: 15, fallen: false };

function stubFetch(status: number, body: unknown): { urls: string[]; inits: RequestInit[]; fetch: typeof fetch } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    inits.push(init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { urls, inits, fetch: f };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("kingOf", () => {
  it("a well-formed KingState; null for none / junk; undefined when the server said nothing", () => {
    expect(kingOf(KING)).toEqual(KING);
    expect(kingOf({ ...KING, hp: 0 })).toEqual({ ...KING, hp: 0, fallen: true }); // fallen ⇔ hp ≤ 0
    expect(kingOf({ ...KING, extra: 1, by: "Excel" })).toEqual(KING);
    expect(kingOf(null)).toBeNull();
    expect(kingOf({ id: "k", hp: "3", max: 15 })).toBeNull();
    expect(kingOf({ hp: 3, max: 15 })).toBeNull();
    expect(kingOf(undefined)).toBeUndefined();
  });
});

describe("postKingHit", () => {
  it("POSTs {} to the session's hit route with its token", async () => {
    const s = stubFetch(200, { ok: true, king: KING });
    expect(await postKingHit("/e/ev", "sess", s.fetch)).toEqual({ kind: "hit", king: KING });
    expect(s.urls).toEqual(["/e/ev/api/spatial/king/hit"]);
    expect(s.inits[0]!.method).toBe("POST");
    expect(s.inits[0]!.body).toBe("{}");
    expect((s.inits[0]!.headers as Record<string, string>)["x-loom-token"]).toBe("sess");
  });

  it("every refusal is a value: already hit, fallen, not near, doors closed, no king, gone", async () => {
    const at = (status: number, body: unknown) => postKingHit("/e/ev", "t", stubFetch(status, body).fetch);
    expect(await at(409, { error: "already hit", king: KING })).toEqual({ kind: "already", king: KING });
    expect(await at(409, { error: "fallen", king: { ...KING, hp: 0, fallen: true } })).toEqual({ kind: "fallen", king: { ...KING, hp: 0, fallen: true } });
    expect(await at(409, { error: "not near" })).toEqual({ kind: "far" });
    expect(await at(409, { error: "doors are closed" })).toEqual({ kind: "paused" });
    expect(await at(409, { error: "session not claimed" })).toEqual({ kind: "error", message: "session not claimed" });
    expect(await at(404, { error: "no king" })).toEqual({ kind: "none" });
    expect(await at(404, { error: "not found" })).toEqual({ kind: "none" }); // an old server: no such route
    expect(await at(410, { error: "gone" })).toEqual({ kind: "over", status: 410 });
    expect(await at(401, { error: "who?" })).toEqual({ kind: "over", status: 401 });
    expect(await at(500, { error: "boom" })).toEqual({ kind: "error", message: "boom" });
    expect(await at(200, { ok: true })).toEqual({ kind: "error", message: "no king in the answer" });
  });

  it("a network failure is an error, never a throw", async () => {
    const fail = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await postKingHit("/e/ev", "t", fail)).toEqual({ kind: "error", message: "offline" });
  });
});

describe("fetchHouse — the session token's read carries the shared King", () => {
  const house = SHOW();

  it("adopts `king` (null too: no King on the map); leaves it out when the server sent none", async () => {
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v1", source: "event", king: KING }).fetch);
    expect((await fetchHouse("/e/x", "sess")).king).toEqual(KING);
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v1", source: "event", king: null }).fetch);
    expect((await fetchHouse("/e/x", "sess")).king).toBeNull();
    vi.stubGlobal("fetch", stubFetch(200, { house, version: "v1", source: "event" }).fetch);
    expect("king" in (await fetchHouse("/e/x", "sess"))).toBe(false);
  });
});

describe("the stream's new frames", () => {
  const player = (session: string, avatar?: string | null): PlayerState =>
    ({
      session,
      guest: `g-${session}`,
      name: `P ${session}`,
      world: "web",
      device: "Tent tablet",
      p: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      room: "a",
      floor: "f",
      duck: { id: "d", room: "b", pos: [6, 0, 2] },
      found: false,
      startedAt: 1,
      ...(avatar !== undefined ? { avatar } : {}),
    }) as PlayerState;
  const table = (...ps: PlayerState[]) => new Map(ps.map((p) => [p.session, p]));

  it("king and avatar are ours to listen for and decode", () => {
    expect(FRAME_NAMES).toContain("king");
    expect(FRAME_NAMES).toContain("avatar");
    expect(decodeFrame("king", JSON.stringify({ ...KING, by: "Excel" }))).toEqual({ event: "king", data: { ...KING, by: "Excel" } });
    expect(decodeFrame("avatar", JSON.stringify({ session: "s-1", avatar: "0123456789abcdef" }))).toEqual({ event: "avatar", data: { session: "s-1", avatar: "0123456789abcdef" } });
  });

  it("avatar re-pictures that live player; an unknown session or the same key changes nothing; a king frame never touches the table", () => {
    const t0 = table(player("a"), player("b", "aaaaaaaaaaaaaaaa"));
    const t1 = applyFrame(t0, { event: "avatar", data: { session: "a", avatar: "0123456789abcdef" } } as SpatialFrame);
    expect(t1.get("a")!.avatar).toBe("0123456789abcdef");
    expect(t0.get("a")!.avatar).toBeUndefined(); // never mutated
    expect(applyFrame(t1, { event: "avatar", data: { session: "a", avatar: "0123456789abcdef" } } as SpatialFrame)).toBe(t1);
    expect(applyFrame(t1, { event: "avatar", data: { session: "ghost", avatar: "ffff" } } as SpatialFrame)).toBe(t1);
    const t2 = applyFrame(t1, { event: "avatar", data: { session: "b", avatar: null } } as SpatialFrame);
    expect(t2.get("b")!.avatar).toBeNull();
    expect(applyFrame(t2, { event: "king", data: { ...KING, by: null } } as SpatialFrame)).toBe(t2);
  });

  it("the picture URL is the event's public avatar route; no key (an old server: no field) is no picture", () => {
    expect(avatarUrl("/e/ev", "0123456789abcdef")).toBe("/e/ev/api/avatar/0123456789abcdef");
    expect(avatarUrl("/e/ev", null)).toBeNull();
    expect(avatarUrl("/e/ev", undefined)).toBeNull();
    expect(avatarUrl("/e/ev", "")).toBeNull();
    expect(avatarKeyOf(7)).toBeNull();
  });
});
