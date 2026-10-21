import { describe, expect, it } from "vitest";
import { validateHouse } from "@loom/house";
import type { HouseMap } from "@loom/house";
import { provisionLink, removeThing } from "../src/map/edit.ts";
import {
  addProp,
  duplicate,
  guardableDoors,
  guardedBy,
  mapLocations,
  onFloor,
  patchProp,
  propDefaults,
  PROP_KINDS,
  rotateBy,
  setGuard,
  snapTerminalToWall,
  snapYaw,
  TERMINAL_VIEWS,
  WALL_INSET,
} from "../src/map/props.ts";
import { SHOW, STAIR, TWO_ROOMS } from "./houses.ts";

const withKing = (): HouseMap => {
  const r = addProp(TWO_ROOMS(), "king", "f", [2, 1.5])!;
  return r.house;
};

describe("props palette", () => {
  it("places each kind in the room under the click, on its floor", () => {
    for (const kind of PROP_KINDS) {
      const r = addProp(TWO_ROOMS(), kind, "f", [5.5, 1]);
      expect(r).not.toBeNull();
      const p = r!.house.props.find((x) => x.id === r!.id)!;
      expect(p.kind).toBe(kind);
      expect(p.room).toBe("b");
      expect(p.pos).toEqual([5.5, 0, 1]);
      expect(validateHouse(r!.house).ok).toBe(true);
    }
  });

  it("lands on the floor's elevation (the cellar)", () => {
    const r = addProp(STAIR(), "box", STAIR().floors.find((f) => f.elevation < 0)!.id, [0.5, 3.5])!;
    expect(r.house.props.at(-1)!.pos[1]).toBe(-3);
  });

  it("refuses a click outside every room", () => {
    expect(addProp(TWO_ROOMS(), "box", "f", [20, 20])).toBeNull();
  });

  it("gives the King the show's defaults", () => {
    const show = SHOW().props.find((p) => p.kind === "king")!;
    const d = propDefaults("king");
    expect(d.hp).toBe(15);
    expect(d.health).toBe(show.health);
    expect(d.signals).toEqual(show.signals);
    expect(d.armed).toEqual(show.armed);
  });

  it("never reuses an id", () => {
    const a = addProp(TWO_ROOMS(), "box", "f", [1, 1])!;
    const b = addProp(a.house, "box", "f", [2, 1])!;
    expect(a.id).not.toBe(b.id);
  });
});

describe("patchProp", () => {
  it("sets size / colour / label / solid and clears with undefined", () => {
    const h = addProp(TWO_ROOMS(), "box", "f", [1, 1])!;
    let next = patchProp(h.house, h.id, { size: [1, 2, 3], color: "#ff0000", label: "X", solid: false });
    let p = next.props[0]!;
    expect(p).toMatchObject({ size: [1, 2, 3], color: "#ff0000", label: "X", solid: false });
    next = patchProp(next, h.id, { label: undefined, solid: undefined });
    p = next.props[0]!;
    expect("label" in p).toBe(false);
    expect("solid" in p).toBe(false);
  });

  it("refuses a size that isn't positive", () => {
    const h = addProp(TWO_ROOMS(), "box", "f", [1, 1])!;
    expect(patchProp(h.house, h.id, { size: [0, 1, 1] })).toBe(h.house);
  });

  it("a box made a King gains the King's fields; a King made a box drops them and its door", () => {
    const h = addProp(TWO_ROOMS(), "box", "f", [1, 1])!;
    const king = patchProp(h.house, h.id, { kind: "king" });
    expect(king.props[0]).toMatchObject({ hp: 15, health: "Night.king_hp" });
    const guarded = setGuard(king, h.id, "ab");
    expect(guardedBy(guarded, h.id)).toEqual(["ab"]);
    const box = patchProp(guarded, h.id, { kind: "box" });
    expect(box.props[0]!.hp).toBeUndefined();
    expect(box.props[0]!.signals).toBeUndefined();
    expect(guardedBy(box, h.id)).toEqual([]);
  });

  it("keeps hp a whole number in 1–99", () => {
    const h = withKing();
    expect(patchProp(h, "king-1", { hp: 150 }).props[0]!.hp).toBe(99);
    expect(patchProp(h, "king-1", { hp: 2.6 }).props[0]!.hp).toBe(3);
  });
});

describe("turning, the floor, duplicating", () => {
  it("rotates by a step, wrapped", () => {
    const h = withKing();
    const sel = { kind: "prop" as const, id: "king-1" };
    expect(rotateBy(h, sel, 15).props[0]!.yaw).toBe(15);
    expect(rotateBy(rotateBy(h, sel, -15), sel, -180).props[0]!.yaw).toBe(165);
    expect(rotateBy(h, { kind: "spawn" }, 90).spawn.yaw).toBe(90);
  });

  it("snaps a yaw to a step", () => {
    expect(snapYaw(22, 15)).toBe(15);
    expect(snapYaw(23, 15)).toBe(30);
    expect(snapYaw(179, 15)).toBe(-180);
  });

  it("puts a raised thing back on the floor", () => {
    const h = withKing();
    const raised: HouseMap = { ...h, props: h.props.map((p) => ({ ...p, pos: [p.pos[0], 0.8, p.pos[2]] })) };
    expect(onFloor(raised, { kind: "prop", id: "king-1" }).props[0]!.pos[1]).toBe(0);
    expect(onFloor(h, { kind: "prop", id: "king-1" })).toBe(h);
  });

  it("duplicates a prop with a fresh id, offset, its room following", () => {
    const h = addProp(TWO_ROOMS(), "box", "f", [3.9, 1])!;
    const d = duplicate(h.house, { kind: "prop", id: h.id }, 0.25)!;
    expect(d.sel).toEqual({ kind: "prop", id: "box-2" });
    const copy = d.house.props.find((p) => p.id === "box-2")!;
    expect(copy.pos).toEqual([4.15, 0, 1.25]);
    expect(copy.room).toBe("b");
    expect(d.house.props).toHaveLength(2);
  });

  it("duplicates a terminal and a duck spot; not the spawn", () => {
    const t = duplicate(TWO_ROOMS(), { kind: "terminal", id: "t" }, 0.1)!;
    expect(t.house.terminals.map((x) => x.id)).toEqual(["t", "t-1"]);
    const d = duplicate(TWO_ROOMS(), { kind: "duck", id: "in-a" }, 0.1)!;
    expect(d.house.duck.spots).toHaveLength(4);
    expect(duplicate(TWO_ROOMS(), { kind: "spawn" }, 0.1)).toBeNull();
  });
});

describe("the King's door", () => {
  it("guards one door at a time, and can let go", () => {
    let h = setGuard(withKing(), "king-1", "ab");
    expect(guardedBy(h, "king-1")).toEqual(["ab"]);
    h = setGuard(h, "king-1", "front");
    expect(guardedBy(h, "king-1")).toEqual(["front"]);
    h = setGuard(h, "king-1", null);
    expect(guardedBy(h, "king-1")).toEqual([]);
    expect(h.doors.every((d) => !("guard" in d))).toBe(true);
  });

  it("offers only the doors on his own room (plus the one he guards)", () => {
    const r = addProp(TWO_ROOMS(), "king", "f", [5.5, 1])!;
    expect(guardableDoors(r.house, r.id).map((d) => d.id)).toEqual(["ab"]);
    expect(guardableDoors(withKing(), "king-1").map((d) => d.id).sort()).toEqual(["ab", "front"]);
    const h = setGuard(r.house, r.id, "ab");
    expect(validateHouse(h).ok).toBe(true);
    expect(guardableDoors(h, "nope")).toEqual([]);
  });

  it("lets his door go when he is deleted, so the map stays valid", () => {
    const h = setGuard(withKing(), "king-1", "ab");
    const gone = removeThing(h, { kind: "prop", id: "king-1" });
    expect(gone.props.some((p) => p.id === "king-1")).toBe(false);
    expect(gone.doors.every((d) => !("guard" in d))).toBe(true);
    expect(validateHouse(gone).ok).toBe(true);
  });

  it("refuses a non-King or an unknown door", () => {
    const h = withKing();
    expect(setGuard(h, "nope", "ab")).toBe(h);
    expect(setGuard(h, "king-1", "nope")).toBe(h);
  });
});

describe("snapTerminalToWall", () => {
  it("hangs a terminal on its room's nearest wall, facing in", () => {
    // Room b [4..7]×[0..3]: near the north wall (z 0) → faces south (yaw 180).
    const h: HouseMap = { ...TWO_ROOMS(), terminals: [{ id: "t", name: "T", room: "b", pos: [5.5, 1.4, 0.3], yaw: 0 }] };
    const t = snapTerminalToWall(h, "t").terminals[0]!;
    expect(t.pos).toEqual([5.5, 1.4, WALL_INSET]);
    expect(Math.abs(t.yaw)).toBe(180);
    // Near the west wall (x 4) → faces east (yaw −90).
    const w = snapTerminalToWall({ ...h, terminals: [{ ...h.terminals[0]!, pos: [4.2, 1.4, 1.5] }] }, "t").terminals[0]!;
    expect(w.pos).toEqual([4 + WALL_INSET, 1.4, 1.5]);
    expect(w.yaw).toBe(-90);
  });

  it("only within the reach when one is given", () => {
    const h: HouseMap = { ...TWO_ROOMS(), terminals: [{ id: "t", name: "T", room: "b", pos: [5.5, 1.4, 1.5], yaw: 0 }] };
    expect(snapTerminalToWall(h, "t", 0.4)).toBe(h);
    expect(snapTerminalToWall(h, "t")).not.toBe(h);
  });

  it("leaves an already hung terminal alone", () => {
    const h: HouseMap = { ...TWO_ROOMS(), terminals: [{ id: "t", name: "T", room: "b", pos: [7 - WALL_INSET, 1.4, 1.5], yaw: 90 }] };
    expect(snapTerminalToWall(h, "t")).toBe(h);
    expect(validateHouse(h).ok).toBe(true);
  });
});

describe("the provisioning link's enums", () => {
  it("lists every terminal view, shadow included", () => {
    expect(TERMINAL_VIEWS).toEqual(["auto", "world", "face", "mirror", "tv", "chess", "shadow", "casino", "reinstall"]);
  });

  it("the link names only the spot (the screen and room live on the map)", () => {
    const url = new URL(provisionLink("http://x", { id: "server-room" }));
    expect(url.search).toBe("?spot=server-room");
  });

  it("offers the map's LOCATIONs once each, sorted", () => {
    const locs = mapLocations(SHOW());
    expect(locs.length).toBeGreaterThan(3);
    expect(new Set(locs).size).toBe(locs.length);
    expect([...locs].sort((a, b) => a.localeCompare(b))).toEqual(locs);
  });
});
