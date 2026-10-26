//! The shared King in the tablet game (wave 11): ⚔ / Space asks the server
//! for this visit's one hit (the pose flushed first), the HUD and the scene
//! follow the server's `KingState`, and at 0 his door opens for everyone —
//! a restore shuts it, but never on a player still behind it or in it.
//! Driven on a bare Game (no canvas: the methods only touch the fields set
//! here), with the physics rebuild and the hit route stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { outsideGround } from "@loom/house";
import type { KingState, Prop, Vec3 } from "@loom/house";
import { Game } from "../src/game/engine.ts";
import { HIT_USED } from "../src/game/fight.ts";
import { THREE_FLOOR } from "./houses.ts";

const hits = vi.hoisted(() => ({ replies: [] as unknown[], calls: 0 }));
vi.mock("../src/api.ts", async (orig) => ({
  ...(await orig<object>()),
  postKingHit: async () => {
    hits.calls++;
    return hits.replies.shift() ?? { kind: "error", message: "no reply queued" };
  },
}));
// A remap rebuilds the scene: a stub one (no canvas here).
vi.mock("@loom/house/three", async (orig) => ({
  ...(await orig<object>()),
  buildHouseScene: () => ({ root: { removeFromParent: () => {} }, dispose: () => {}, walls: [], kings: new Map(), showKing: () => {}, setPickupTaken: () => false }),
  applySpace: () => {},
}));
const worlds = vi.hoisted(() => ({ built: [] as unknown[] }));
vi.mock("../src/game/physics.ts", async (orig) => ({
  ...(await orig<object>()),
  buildPhysicsWorld: (_h: unknown, _w: unknown, opts: unknown) => (worlds.built.push(opts), {}),
}));

const house = THREE_FLOOR();
const prop = house.props.find((p) => p.kind === "king") as Prop;
const door = house.doors.find((d) => d.guard === prop.id)!;
const WEST = 90;
const near: Vec3 = [prop.pos[0] + 0.7, prop.pos[1], prop.pos[2]];
const far: Vec3 = [prop.pos[0] + 3, prop.pos[1], prop.pos[2]];
const behind: Vec3 = [-4.5, prop.pos[1], prop.pos[2] + 0.4]; // in the Server Room
const full: KingState = { id: prop.id, hp: 15, max: 15, fallen: false };

type Bare = {
  kingState: KingState | null;
  doorOpen: boolean;
  hitUsed: boolean;
  hitting: boolean;
  hitQueued: boolean;
  phase: string;
  body: { p: Vec3; yaw: number; pitch: number; vy: number };
  trailHouse: unknown;
  hit(): void;
  tickKing(now: number): void;
  adoptKing(k: KingState | null | undefined, by?: string | null): void;
  refreshDoor(): void;
  kingHud(): Record<string, unknown> | null;
};

function game(king: KingState | null = full, feet: Vec3 = near) {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  const said: string[] = [];
  const shown: Array<[string, KingState, boolean]> = [];
  const staggers = { n: 0 };
  const sfx = { thud: vi.fn(), buzz: vi.fn(), fanfare: vi.fn() };
  const flush = vi.fn(async () => true);
  Object.assign(g, {
    phase: "playing",
    map: house,
    kingProp: prop,
    kingState: king,
    doorOpen: king?.fallen === true,
    kingShown: "",
    hitUsed: false,
    hitting: false,
    hitQueued: false,
    kingVerdict: "far",
    lastTrailAt: 0,
    body: { p: feet, yaw: WEST, pitch: 0, vy: 0 },
    house: { walls: [], showKing: (id: string, k: KingState, open: boolean) => shown.push([id, k, open]) },
    king: { hit: () => staggers.n++ },
    leash: { touch: () => {} },
    pump: { flush },
    o: { base: "/e/ev", assignment: { token: "sess", name: "Excel", session: "s-1" }, sfx },
    say: (line: string) => said.push(line),
    end: vi.fn(),
  });
  return { g: g as unknown as Bare, said, shown, staggers, sfx, flush };
}

const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  hits.replies = [];
  hits.calls = 0;
  worlds.built = [];
});

describe("⚔ HIT — once per reinstallation visit, judged by the server", () => {
  it("in reach: flushes the pose, posts the hit, spends the visit's hit and shows the new bar", async () => {
    const { g, said, shown, staggers, sfx, flush } = game();
    hits.replies.push({ kind: "hit", king: { ...full, hp: 14 } });
    g.hit();
    g.tickKing(0);
    await settle();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(hits.calls).toBe(1);
    expect(g.hitUsed).toBe(true);
    expect(g.kingState).toEqual({ ...full, hp: 14 });
    expect(shown.at(-1)).toEqual([prop.id, { ...full, hp: 14 }, false]);
    expect(staggers.n).toBe(1);
    expect(sfx.thud).toHaveBeenCalled();
    expect(said).toEqual(["⚔ You hit the King!"]); // never "Excel hit the King." for our own
    expect(g.kingHud()).toMatchObject({ hitUsed: true });
    // Wave 26 (R3): the HUD carries no meter, label or stage — the bar over his head shows the points.
    for (const gone of ["meter", "label", "stage", "hp", "max"]) expect(g.kingHud(), gone).not.toHaveProperty(gone);
    // Again: spent until the next reinstallation, nothing posted.
    g.hit();
    g.tickKing(1);
    await settle();
    expect(hits.calls).toBe(1);
    expect(said.at(-1)).toBe(HIT_USED);
  });

  it("out of reach: a nudge, nothing posted", async () => {
    const { g, said } = game(full, far);
    g.hit();
    g.tickKing(0);
    expect(said).toEqual(["Get closer to the King."]);
    const facing = game(full, near);
    facing.g.body.yaw = -90;
    facing.g.hit();
    facing.g.tickKing(0);
    expect(facing.said).toEqual(["Face him."]);
    await settle();
    expect(hits.calls).toBe(0);
  });

  it("the server says this visit already hit (a re-scan mid-walk): spent", async () => {
    const { g, said } = game();
    hits.replies.push({ kind: "already", king: { ...full, hp: 9 } });
    g.hit();
    g.tickKing(0);
    await settle();
    expect(g.hitUsed).toBe(true);
    expect(g.kingState?.hp).toBe(9);
    expect(said).toEqual([HIT_USED]);
  });

  it("paused / not near / a hiccup leave the hit unspent; gone ends the session", async () => {
    const { g, said } = game();
    hits.replies.push({ kind: "paused" }, { kind: "far" }, { kind: "error", message: "x" }, { kind: "over", status: 410 });
    for (let i = 0; i < 4; i++) {
      g.hit();
      g.tickKing(i);
      await settle();
    }
    expect(hits.calls).toBe(4);
    expect(g.hitUsed).toBe(false);
    expect(said.slice(0, 3)).toEqual(["The simulation is paused — Gerald will wait for you.", "Get closer to the King and face him.", "The connection hiccupped — try again."]);
    expect((g as unknown as { end: ReturnType<typeof vi.fn> }).end).toHaveBeenCalledWith({ kind: "over", reason: "This session is over." });
  });

  it("an old server (no shared King): no HUD, no hit; 404 no king drops him", async () => {
    const { g } = game(null);
    expect(g.kingHud()).toBeNull();
    g.hit();
    g.tickKing(0);
    await settle();
    expect(hits.calls).toBe(0);
    const b = game();
    hits.replies.push({ kind: "none" });
    b.g.hit();
    b.g.tickKing(0);
    await settle();
    expect(b.g.kingState).toBeNull();
    expect(b.g.kingHud()).toBeNull();
  });
});

describe("the shared bar — everyone's hits, the kneel, the restore", () => {
  it("someone else's hit staggers him and says who; undefined keeps what we know; another King's id is none", () => {
    const { g, said, staggers } = game();
    g.adoptKing({ ...full, hp: 13 }, "Winamp");
    expect(said).toEqual(["Winamp hit the King."]);
    expect(staggers.n).toBe(1);
    g.adoptKing(undefined);
    expect(g.kingState?.hp).toBe(13);
    g.adoptKing({ ...full, hp: 13 }, null); // a director's edit to the same value: nothing said
    expect(said).toHaveLength(1);
    g.adoptKing({ ...full, id: "another-king" });
    expect(g.kingState).toBeNull();
  });

  it("at 0 he kneels and his door opens: the leaf hidden, his box out of the physics, the trail through", () => {
    const { g, said, shown, sfx } = game({ ...full, hp: 1 });
    g.adoptKing({ ...full, hp: 0, fallen: true }, "Winamp");
    expect(g.doorOpen).toBe(true);
    expect(shown.at(-1)).toEqual([prop.id, { ...full, hp: 0, fallen: true }, true]);
    // (+ the outside ground, wave 26 R4: an exterior door leads into the void.)
    expect(worlds.built.at(-1)).toEqual({ ground: outsideGround(house), omitProps: new Set([prop.id]) });
    expect((g.trailHouse as { doors: Array<{ id: string; guard?: string }> }).doors.find((d) => d.id === door.id)?.guard).toBeUndefined();
    expect(said).toContain("The King kneels. His door stands open.");
    expect(sfx.fanfare).toHaveBeenCalled();
    // No hit on a kneeling King.
    g.hit();
    g.tickKing(0);
    expect(hits.calls).toBe(0);
  });

  it("a restore shuts his door — but not on a player behind it, until they come out", () => {
    const { g, said, shown } = game({ ...full, hp: 0, fallen: true }, behind);
    g.adoptKing(full);
    expect(said).toContain("The King stands again.");
    expect(g.doorOpen).toBe(true); // held open: they'd be locked in
    expect(shown.at(-1)).toEqual([prop.id, full, true]);
    // Still in the doorway.
    g.body.p = [door.at[0], prop.pos[1], door.at[1]];
    g.refreshDoor();
    expect(g.doorOpen).toBe(true);
    // Out and clear on his side: it shuts, he blocks again.
    g.body.p = [prop.pos[0] + 1.6, prop.pos[1], prop.pos[2]];
    g.refreshDoor();
    expect(g.doorOpen).toBe(false);
    expect(shown.at(-1)).toEqual([prop.id, full, false]);
    expect(worlds.built.at(-1)).toEqual({ ground: outsideGround(house), closedDoors: new Set([door.id]) });
  });

  it("a remap with the King down keeps a player on his spot there, as the server does; standing, back to the start", () => {
    const swap = (king: KingState, incoming?: KingState | null) => {
      const { g, said } = game(king, [prop.pos[0], prop.pos[1], prop.pos[2]]);
      Object.assign(g, { root: { add: () => {} }, distHistory: [], mapVersion: "v1", taken: new Set<string>() });
      Object.assign((g as unknown as { house: object }).house, { root: { removeFromParent: () => {} }, dispose: () => {} });
      (g as unknown as { swapMap(h: unknown, v: string, k?: KingState | null): void }).swapMap(THREE_FLOOR(), "v2", incoming);
      return { g, said };
    };
    const down: KingState = { ...full, hp: 0, fallen: true };
    // What we knew (no word from the GET): down, so his spot is floor.
    const kept = swap(down);
    expect(kept.g.body.p).toEqual([prop.pos[0], prop.pos[1], prop.pos[2]]);
    expect(kept.said).toContain("The house was remapped.");
    // The GET's word wins: he stood up meanwhile, so he is solid again.
    const restored = swap(down, full);
    expect(restored.g.body.p).not.toEqual([prop.pos[0], prop.pos[1], prop.pos[2]]);
    expect(restored.said).toContain("The house was remapped — you're back at the start.");
    // Standing all along: back to the start.
    expect(swap(full).said).toContain("The house was remapped — you're back at the start.");
  });

  it("a restore with the player clear shuts it at once", () => {
    const { g } = game({ ...full, hp: 0, fallen: true }, far);
    g.adoptKing(full);
    expect(g.doorOpen).toBe(false);
  });
});
