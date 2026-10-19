import { describe, expect, it } from "vitest";
import type { SpatialFrame } from "@loom/house";
import { CELEBRATION_MS, EMPTY_WORLD, avatarUrl, byActivity, celebrationLine, decodeFrame, kingOf, laysEgg, moved, prune, reduce, type WorldState } from "../src/world/state.ts";
import { playerState } from "./world-fixture.ts";

const fold = (frames: Array<[SpatialFrame, number]>, start: WorldState = EMPTY_WORLD) => frames.reduce((s, [f, t]) => reduce(s, f, t), start);

describe("world state", () => {
  it("seeds from hello, adds on join, drops on leave, clears on reset", () => {
    let s = fold([
      [{ event: "hello", data: { eventId: "e", houseVersion: "v1", players: [playerState("s1", [1, 0, 1])] } }, 0],
      [{ event: "join", data: { player: playerState("s2", [5, 0, 1]) } }, 100],
    ]);
    expect(s.houseVersion).toBe("v1");
    expect([...s.players.keys()]).toEqual(["s1", "s2"]);
    expect(s.players.get("s2")).toMatchObject({ name: "Prog s2", room: "b", lastActive: 100, found: false });
    s = reduce(s, { event: "leave", data: { session: "s1", reason: "ended" } }, 200);
    expect([...s.players.keys()]).toEqual(["s2"]);
    expect(reduce(s, { event: "leave", data: { session: "nobody", reason: "ended" } }, 200)).toBe(s);
    s = reduce(s, { event: "reset", data: { kind: "reset" } }, 300);
    expect(s.players.size).toBe(0);
    expect(s.resetAt).toBe(300);
  });

  it("buffers poses (interpolated behind), tracking room and real activity only", () => {
    let s = fold([[{ event: "join", data: { player: playerState("s1", [1, 0, 1]) } }, 0]]);
    const buffer = s.players.get("s1")!.buffer;
    // A wobble in place is not activity…
    s = reduce(s, { event: "poses", data: { t: 1, players: [{ session: "s1", p: [1.05, 0, 1], yaw: 5, pitch: 0, room: "a", floor: "g" }] } }, 100);
    expect(s.players.get("s1")!.lastActive).toBe(0);
    // …a step is.
    s = reduce(s, { event: "poses", data: { t: 2, players: [{ session: "s1", p: [1.5, 0, 1], yaw: 5, pitch: 0, room: "a", floor: "g" }] } }, 200);
    expect(s.players.get("s1")).toMatchObject({ lastActive: 200, pose: { p: [1.5, 0, 1] } });
    s = reduce(s, { event: "poses", data: { t: 3, players: [{ session: "s1", p: [4.5, 0, 1], yaw: 5, pitch: 0, room: "b", floor: "g" }] } }, 300);
    expect(s.players.get("s1")!.room).toBe("b");
    // The same buffer, carried by reference; sampled 120 ms behind.
    expect(s.players.get("s1")!.buffer).toBe(buffer);
    expect(buffer.sample(380)!.p[0]).toBeCloseTo(1.5 + (4.5 - 1.5) * 0.6);
    // A pose for a session never seen is ignored (same state back).
    expect(reduce(s, { event: "poses", data: { t: 4, players: [{ session: "ghost", p: [0, 0, 0], yaw: 0, pitch: 0, room: null, floor: "g" }] } }, 400)).toBe(s);
  });

  it("a turn counts as activity", () => {
    const at = { p: [0, 0, 0] as [number, number, number], yaw: 170, pitch: 0 };
    expect(moved(at, { ...at, yaw: -175 })).toBe(false); // 15° across the wrap
    expect(moved(at, { ...at, yaw: -160 })).toBe(true); // 30°
  });

  it("keeps a session's buffer across a reconnect's hello", () => {
    const s = fold([[{ event: "join", data: { player: playerState("s1", [1, 0, 1]) } }, 0]]);
    const again = reduce(s, { event: "hello", data: { eventId: "e", houseVersion: "v2", players: [playerState("s1", [2, 0, 1])] } }, 500);
    expect(again.players.get("s1")!.buffer).toBe(s.players.get("s1")!.buffer);
    expect(again.houseVersion).toBe("v2");
  });

  it("celebrates a found duck, then lets the celebration go", () => {
    let s = fold([
      [{ event: "join", data: { player: playerState("s1", [6.5, 0, 2]) } }, 0],
      [{ event: "found", data: { session: "s1", guest: "g-s1", name: "Prog s1", duck: { id: "s", room: "b", pos: [7, 0, 2] }, released: true, captured: false } }, 1000],
    ]);
    expect(s.players.get("s1")).toMatchObject({ found: true, foundAt: 1000 });
    expect(s.celebrations).toEqual([{ session: "s1", guest: "g-s1", name: "Prog s1", released: true, kept: false, at: 1000 }]);
    expect(prune(s, 1000 + CELEBRATION_MS - 1)).toBe(s);
    s = prune(s, 1000 + CELEBRATION_MS);
    expect(s.celebrations).toEqual([]);
  });

  it("a find the story kept (released nobody, still captured) lays no egg and says Gerald can't help (T3-reinstall-01)", () => {
    const duck = { id: "s", room: "b", pos: [7, 0, 2] as [number, number, number] };
    let s = fold([
      [{ event: "join", data: { player: playerState("s1", [6.5, 0, 2]) } }, 0],
      [{ event: "join", data: { player: playerState("s2", [6.5, 0, 2]) } }, 0],
      [{ event: "join", data: { player: playerState("s3", [6.5, 0, 2]) } }, 0],
    ]);
    // The banishment: the server keeps them captured.
    s = reduce(s, { event: "found", data: { session: "s1", guest: "g-s1", name: "Prog s1", duck, released: false, captured: true } }, 1000);
    // A free program (never captured, or freed mid-walk), and an older server that doesn't say.
    s = reduce(s, { event: "found", data: { session: "s2", guest: "g-s2", name: "Prog s2", duck, released: false, captured: false } }, 1000);
    // (a pre-wave-9 server: no `captured` on the frame)
    s = reduce(s, { event: "found", data: { session: "s3", guest: "g-s3", name: "Prog s3", duck, released: false } as never }, 1000);
    expect(s.players.get("s1")).toMatchObject({ found: true, kept: true });
    expect(laysEgg(s.players.get("s1")!)).toBe(false);
    expect(laysEgg(s.players.get("s2")!)).toBe(true);
    expect(laysEgg(s.players.get("s3")!)).toBe(true);
    const lines = Object.fromEntries(s.celebrations.map((c) => [c.session, celebrationLine(c)]));
    expect(lines).toEqual({ s1: "GERALD CAN'T HELP", s2: "FOUND THE GOLDEN DUCK", s3: "FOUND THE GOLDEN DUCK" });
    expect(celebrationLine({ released: true, kept: false })).toBe("HAS BEEN REINSTALLED");
    // A reconnect's hello (found, lingering) keeps what the frame said.
    const again = reduce(s, { event: "hello", data: { eventId: "e", houseVersion: "v1", players: [{ ...playerState("s1", [6.5, 0, 2]), found: true }] } }, 2000);
    expect(laysEgg(again.players.get("s1")!)).toBe(false);
  });

  it("moves a player's duck when a map save re-deals it", () => {
    let s = fold([
      [{ event: "join", data: { player: playerState("s1", [1, 0, 1]) } }, 0],
      [{ event: "join", data: { player: playerState("s2", [5, 0, 1]) } }, 0],
    ]);
    const before = s.players.get("s1")!;
    const other = s.players.get("s2")!;
    const moved = { id: "sofa", room: "a", pos: [2, 0.4, 3] as [number, number, number] };
    s = reduce(s, { event: "duck", data: { session: "s1", duck: moved } }, 100);
    expect(s.players.get("s1")!.duck).toEqual(moved);
    // Only that player changes; the buffer and activity are untouched.
    expect(s.players.get("s1")!.buffer).toBe(before.buffer);
    expect(s.players.get("s1")!.lastActive).toBe(before.lastActive);
    expect(s.players.get("s2")).toBe(other);
    // The same spot again, or a session we don't know, is a no-op.
    expect(reduce(s, { event: "duck", data: { session: "s1", duck: { ...moved, pos: [2, 0.4, 3] } } }, 200)).toBe(s);
    expect(reduce(s, { event: "duck", data: { session: "ghost", duck: moved } }, 200)).toBe(s);
    // A found duck stays where it was found.
    s = reduce(s, { event: "found", data: { session: "s2", guest: "g-s2", name: "Prog s2", duck: other.duck, released: false, captured: false } }, 300);
    expect(reduce(s, { event: "duck", data: { session: "s2", duck: moved } }, 400)).toBe(s);
    // The frame decodes off the wire.
    expect(decodeFrame("duck", JSON.stringify({ session: "s1", duck: moved }))).toEqual({ event: "duck", data: { session: "s1", duck: moved } });
  });

  it("notes a new map version once", () => {
    const s = reduce(EMPTY_WORLD, { event: "house", data: { version: "v9" } }, 0);
    expect(s.houseVersion).toBe("v9");
    expect(reduce(s, { event: "house", data: { version: "v9" } }, 1)).toBe(s);
  });

  it("orders players freshest first, deterministically", () => {
    const s = fold([
      [{ event: "join", data: { player: playerState("s2", [1, 0, 1], { name: "Zed" }) } }, 0],
      [{ event: "join", data: { player: playerState("s1", [1, 0, 1], { name: "Amy" }) } }, 0],
      [{ event: "join", data: { player: playerState("s3", [1, 0, 1], { name: "Bob" }) } }, 50],
    ]);
    expect(byActivity(s).map((p) => p.name)).toEqual(["Bob", "Amy", "Zed"]);
  });

  it("decodes frames, refusing unknown events and junk", () => {
    expect(decodeFrame("leave", '{"session":"s1","reason":"found"}')).toEqual({ event: "leave", data: { session: "s1", reason: "found" } });
    expect(decodeFrame("message", "{}")).toBeNull();
    expect(decodeFrame("poses", "{nope")).toBeNull();
    expect(decodeFrame("poses", "3")).toBeNull();
  });
});

describe("the shared King (wave 11)", () => {
  const KING = { id: "cold-lock-king", hp: 15, max: 15, fallen: false };
  const hello = (extra: Record<string, unknown>): SpatialFrame => ({ event: "hello", data: { eventId: "e", houseVersion: "v1", players: [], ...extra } }) as unknown as SpatialFrame;
  const king = (data: Record<string, unknown>): SpatialFrame => ({ event: "king", data }) as unknown as SpatialFrame;

  it("starts from hello's king; an old server's hello (no field) keeps what we had", () => {
    expect(EMPTY_WORLD.king).toBeNull();
    let s = reduce(EMPTY_WORLD, hello({ king: KING }), 0);
    expect(s.king).toEqual(KING);
    s = reduce(s, hello({}), 1);
    expect(s.king).toEqual(KING);
    expect(reduce(s, hello({ king: null }), 2).king).toBeNull(); // none on the map
  });

  it("follows every king frame; the same state again is the same object; a reset keeps his bar", () => {
    let s = reduce(EMPTY_WORLD, king({ ...KING, hp: 14, by: "Excel" }), 0);
    expect(s.king).toEqual({ ...KING, hp: 14 });
    expect(reduce(s, king({ ...KING, hp: 14, by: null }), 1)).toBe(s);
    s = reduce(s, king({ ...KING, hp: 0, fallen: true, by: "Winamp" }), 2);
    expect(s.king).toEqual({ ...KING, hp: 0, fallen: true });
    s = reduce(s, { event: "reset", data: { kind: "reset" } }, 3);
    expect(s.king).toEqual({ ...KING, hp: 0, fallen: true });
    expect(decodeFrame("king", JSON.stringify(KING))).toEqual({ event: "king", data: KING });
  });

  it("kingOf: fallen ⇔ hp ≤ 0; junk is none", () => {
    expect(kingOf({ ...KING, hp: 0 })).toEqual({ ...KING, hp: 0, fallen: true });
    expect(kingOf({ id: "k", hp: "x", max: 15 })).toBeNull();
    expect(kingOf(undefined)).toBeUndefined();
  });
});

describe("ghost pictures (wave 11)", () => {
  it("a player's picture key rides hello / join and changes on an avatar frame; none is null", () => {
    let s = fold([
      [{ event: "join", data: { player: { ...playerState("s1", [1, 0, 1]), avatar: "0123456789abcdef" } as never } }, 0],
      [{ event: "join", data: { player: playerState("s2", [1, 0, 1]) } }, 0],
    ]);
    expect(s.players.get("s1")!.avatar).toBe("0123456789abcdef");
    expect(s.players.get("s2")!.avatar).toBeNull(); // an old server: no field
    const avatar = (session: string, key: string | null): SpatialFrame => ({ event: "avatar", data: { session, avatar: key } }) as unknown as SpatialFrame;
    const buffer = s.players.get("s2")!.buffer;
    s = reduce(s, avatar("s2", "aaaaaaaaaaaaaaaa"), 10);
    expect(s.players.get("s2")!.avatar).toBe("aaaaaaaaaaaaaaaa");
    expect(s.players.get("s2")!.buffer).toBe(buffer);
    expect(reduce(s, avatar("s2", "aaaaaaaaaaaaaaaa"), 11)).toBe(s);
    expect(reduce(s, avatar("ghost", "bbbbbbbbbbbbbbbb"), 11)).toBe(s);
    expect(reduce(s, avatar("s1", null), 12).players.get("s1")!.avatar).toBeNull();
    expect(decodeFrame("avatar", '{"session":"s1","avatar":"0123456789abcdef"}')).toEqual({ event: "avatar", data: { session: "s1", avatar: "0123456789abcdef" } });
  });

  it("the URL is the event's public avatar route", () => {
    expect(avatarUrl("/e/ev", "0123456789abcdef")).toBe("/e/ev/api/avatar/0123456789abcdef");
    expect(avatarUrl("/e/ev", null)).toBeNull();
  });
});
