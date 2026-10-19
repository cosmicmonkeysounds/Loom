import { describe, expect, it } from "vitest";
import {
  KING_CONE_DEG,
  KING_HP,
  KING_REACH,
  KING_SIGNALS,
  guardedDoors,
  kingMax,
  kingProps,
  kingReach,
  kingSignal,
  kingStateOf,
  route,
  routeNodes,
  withFallenKings,
} from "../src/index.ts";
import type { HouseMap, Prop, Vec3 } from "../src/index.ts";
import { SHOW_HOUSE, fixture, loadHouse } from "./golden.ts";

/** two-rooms with a king in door `ab`'s gap (at [4, 1.5], room a), guarding it. */
function guarded(over: Partial<Prop> = {}): { house: HouseMap; king: Prop } {
  const base = fixture("two-rooms");
  const king: Prop = { id: "king", room: "a", kind: "king", pos: [3.6, 0, 1.5], size: [0.6, 1.9, 0.6], yaw: -90, ...over };
  const house: HouseMap = {
    ...base,
    doors: base.doors.map((d) => (d.id === "ab" ? { ...d, guard: "king" } : d)),
    props: [...base.props, king],
  };
  return { house, king };
}

describe("kingReach — the hit rule both games and the server judge by", () => {
  const { house, king } = guarded();
  // West of him, facing east (yaw −90 faces +x).
  const near: Vec3 = [2.6, 0, 1.5];

  it("ok in reach and facing him, from any side", () => {
    expect(kingReach(house, near, -90, king)).toBe("ok");
    expect(kingReach(house, [3.6, 0, 0.5], 180, king)).toBe("ok"); // north of him, facing south
    expect(kingReach(house, [3.6, 0, 2.5], 0, king)).toBe("ok"); // south of him, facing north
    expect(kingReach(house, [3.6, 0, 1.5], 123, king)).toBe("ok"); // on his very centre
  });

  it("far past KING_REACH (plan distance), the slack widening it", () => {
    const edge: Vec3 = [3.6 - KING_REACH, 0, 1.5];
    expect(kingReach(house, edge, -90, king)).toBe("ok");
    const past: Vec3 = [3.6 - KING_REACH - 0.2, 0, 1.5];
    expect(kingReach(house, past, -90, king)).toBe("far");
    expect(kingReach(house, past, -90, king, { reach: 0.35 })).toBe("ok");
    // Height is no part of the distance: a head-height pose still reaches.
    expect(kingReach(house, [2.6, 0.4, 1.5], -90, king)).toBe("ok");
  });

  it("facing past KING_CONE_DEG off the bearing, the slack widening it", () => {
    expect(kingReach(house, near, -90 + KING_CONE_DEG - 1, king)).toBe("ok");
    expect(kingReach(house, near, -90 - KING_CONE_DEG + 1, king)).toBe("ok");
    expect(kingReach(house, near, -90 + KING_CONE_DEG + 5, king)).toBe("facing");
    expect(kingReach(house, near, -90 + KING_CONE_DEG + 5, king, { cone: 25 })).toBe("ok");
    expect(kingReach(house, near, 90, king)).toBe("facing"); // back to him
    // The yaw wraps: −90 and 270 are the same facing.
    expect(kingReach(house, near, 270, king)).toBe("ok");
  });

  it("floor before far: a player on another floor never reaches", () => {
    const show = loadHouse(SHOW_HOUSE);
    const showKing = kingProps(show)[0]!;
    const above: Vec3 = [showKing.pos[0] + 0.5, 0, showKing.pos[2]];
    expect(kingReach(show, above, 90, showKing)).toBe("floor");
    expect(kingReach(show, [showKing.pos[0] + 0.8, showKing.pos[1], showKing.pos[2]], 90, showKing)).toBe("ok");
  });
});

describe("the King's defaults and state", () => {
  it("max hp: the prop's, else KING_HP; signals: the prop's, else the defaults", () => {
    expect(kingMax(guarded({ hp: 15 }).king)).toBe(15);
    expect(kingMax(guarded().king)).toBe(KING_HP);
    expect(kingSignal(guarded({ signals: { hit: "king hit hard" } }).king, "hit")).toBe("king hit hard");
    expect(kingSignal(guarded({ signals: { hit: "x" } }).king, "fallen")).toBe(KING_SIGNALS.fallen);
    expect(KING_SIGNALS).toEqual({ won: "chess won", lost: "chess lost", drawn: "chess drawn", hit: "king hit", fallen: "king fallen" });
  });

  it("kingStateOf: a missing or non-number value is full; clamped and rounded; fallen at 0", () => {
    const { king } = guarded({ hp: 15 });
    expect(kingStateOf(king, undefined)).toEqual({ id: "king", hp: 15, max: 15, fallen: false });
    expect(kingStateOf(king, "7")).toEqual({ id: "king", hp: 15, max: 15, fallen: false });
    expect(kingStateOf(king, Number.NaN).hp).toBe(15);
    expect(kingStateOf(king, 7)).toEqual({ id: "king", hp: 7, max: 15, fallen: false });
    expect(kingStateOf(king, 6.6).hp).toBe(7);
    expect(kingStateOf(king, 40).hp).toBe(15);
    expect(kingStateOf(king, 0)).toEqual({ id: "king", hp: 0, max: 15, fallen: true });
    expect(kingStateOf(king, -3)).toEqual({ id: "king", hp: 0, max: 15, fallen: true });
  });

  it("guardedDoors lists the doors a king guards", () => {
    const { house } = guarded();
    expect(guardedDoors(house, "king").map((d) => d.id)).toEqual(["ab"]);
    expect(guardedDoors(house, "nobody")).toEqual([]);
  });
});

describe("a fallen King opens his doors for routing", () => {
  const { house } = guarded();
  const a: Vec3 = [1, 0, 1];
  const b: Vec3 = [6, 0, 2];

  it("standing, his door is shut: no route from a to b", () => {
    expect(route(house, a, b)).toEqual([a, b]);
    expect(route(house, a, b, { fallen: new Set() })).toEqual([a, b]);
    expect(route(house, a, b, { fallen: new Set(["someone-else"]) })).toEqual([a, b]);
  });

  it("fallen, the route goes through his door, past where he kneels", () => {
    const path = route(house, a, b, { fallen: new Set(["king"]) });
    expect(path.length).toBeGreaterThan(2);
    expect(path.some((p) => p[0] === 4 && p[2] === 1.5)).toBe(true);
    // The same as the map with no guard and no king at all.
    const bare = fixture("two-rooms");
    expect(path).toEqual(route(bare, a, b));
  });

  it("withFallenKings: a copy without the guard, the king no longer solid; untouched otherwise", () => {
    const open = withFallenKings(house, new Set(["king"]));
    expect(open).not.toBe(house);
    expect(open.doors.find((d) => d.id === "ab")!.guard).toBeUndefined();
    expect(open.props.find((p) => p.id === "king")!.solid).toBe(false);
    expect(house.doors.find((d) => d.id === "ab")!.guard).toBe("king");
    expect(house.props.find((p) => p.id === "king")!.solid).toBeUndefined();
    expect(withFallenKings(house, new Set())).toBe(house);
    expect(withFallenKings(house, new Set(["nobody"]))).toBe(house);
    expect(routeNodes(open).some((n) => n.kind === "door" && n.id === "ab")).toBe(true);
    expect(routeNodes(house).some((n) => n.kind === "door" && n.id === "ab")).toBe(false);
  });
});
