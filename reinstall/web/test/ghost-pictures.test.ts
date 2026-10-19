//! Ghosts wear the guest's profile picture (wave 11, C3): `syncGhosts`
//! builds each ghost with its `/api/avatar/<key>` URL and re-pictures it
//! when an `avatar` frame (or a hello / join) brings another key. Driven on
//! a bare Game; the ghosts are real `@loom/house/three` avatars (no DOM, so
//! the tile never draws — the URL each one asked for is what is checked).
import { describe, expect, it } from "vitest";
import { Group } from "three";
import type { PlayerState, SpatialFrame } from "@loom/house";
import type { Avatar } from "@loom/house/three";
import { Game } from "../src/game/engine.ts";
import { applyFrame } from "../src/spatial.ts";

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

type Bare = { players: ReadonlyMap<string, PlayerState>; ghosts: Map<string, { avatar: Avatar }>; syncGhosts(now: number): void };

function game(...ps: PlayerState[]): Bare {
  const g = Object.create(Game.prototype) as Record<string, unknown>;
  Object.assign(g, { players: new Map(ps.map((p) => [p.session, p])), ghosts: new Map(), root: new Group(), o: { base: "/e/ev", assignment: { session: "me" } } });
  return g as unknown as Bare;
}

describe("ghost pictures", () => {
  it("each ghost asks for its own picture; no key (an old server) is the plain capsule; never our own ghost", () => {
    const g = game(player("a", "0123456789abcdef"), player("b"), player("me", "ffffffffffffffff"));
    g.syncGhosts(0);
    expect([...g.ghosts.keys()]).toEqual(["a", "b"]);
    expect(g.ghosts.get("a")!.avatar.picture).toBe("/e/ev/api/avatar/0123456789abcdef");
    expect(g.ghosts.get("b")!.avatar.picture).toBeNull();
  });

  it("an avatar frame re-pictures the live ghost in place", () => {
    const g = game(player("a"), player("b", "aaaaaaaaaaaaaaaa"));
    g.syncGhosts(0);
    const ghost = g.ghosts.get("a")!;
    g.players = applyFrame(g.players, { event: "avatar", data: { session: "a", avatar: "0123456789abcdef" } } as SpatialFrame);
    g.players = applyFrame(g.players, { event: "avatar", data: { session: "b", avatar: null } } as SpatialFrame);
    g.syncGhosts(1);
    expect(g.ghosts.get("a")).toBe(ghost); // the same ghost, not a rebuilt one
    expect(ghost.avatar.picture).toBe("/e/ev/api/avatar/0123456789abcdef");
    expect(g.ghosts.get("b")!.avatar.picture).toBeNull();
  });
});
