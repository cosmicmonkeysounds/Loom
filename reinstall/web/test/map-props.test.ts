import { describe, expect, it } from "vitest";
import { HEART_SIGNAL, validateHouse } from "@loom/house";
import type { HouseMap } from "@loom/house";
import { provisionLink, removeThing } from "../src/map/edit.ts";
import {
  addProp,
  duplicate,
  guardableDoors,
  guardedBy,
  isRoomlessView,
  mapLocations,
  onFloor,
  DEFAULT_PICKUP_ITEM,
  momentSignalOf,
  patchProp,
  propDefaults,
  PROP_KINDS,
  PROP_PALETTE,
  rotateBy,
  setGuard,
  snapTerminalToWall,
  snapYaw,
  ROOMLESS_TERMINAL_VIEWS,
  TERMINAL_VIEWS,
  WALL_INSET,
} from "../src/map/props.ts";
import { ROOMLESS_VIEWS } from "@loom/terminal/setup-map.ts";
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

  it("the views that belong to no room match the terminal's, the reinstallation station included", () => {
    expect([...ROOMLESS_TERMINAL_VIEWS]).toEqual([...ROOMLESS_VIEWS]);
    expect(isRoomlessView("reinstall")).toBe(true);
    expect(isRoomlessView("face")).toBe(false);
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

describe("the heart and the pickup (wave 26)", () => {
  it("are on the palette, with no label, a pickup with its item", () => {
    expect(PROP_KINDS).toContain("heart");
    expect(PROP_KINDS).toContain("pickup");
    expect(PROP_PALETTE.map((k) => k.kind)).toEqual([...PROP_KINDS]);
    expect(propDefaults("heart").label).toBeUndefined();
    expect(propDefaults("pickup")).toMatchObject({ item: DEFAULT_PICKUP_ITEM });
    expect(propDefaults("pickup").label).toBeUndefined();
    for (const kind of ["heart", "pickup"] as const) {
      const r = addProp(TWO_ROOMS(), kind, "f", [5.5, 1])!;
      expect(r.id.startsWith(kind)).toBe(true);
      expect(validateHouse(r.house).problems).toEqual([]);
    }
  });

  it("a box made a pickup gains the item and loses its label; made a box again, it loses the item", () => {
    const h = addProp(TWO_ROOMS(), "box", "f", [2.5, 1])!; // clear of the duck spot and the spawn
    let next = patchProp(h.house, h.id, { label: "CRATE" });
    next = patchProp(next, h.id, { kind: "pickup" });
    let p = next.props.find((x) => x.id === h.id)!;
    expect(p.item).toBe(DEFAULT_PICKUP_ITEM);
    expect("label" in p).toBe(false);
    expect(validateHouse(next).problems).toEqual([]);
    next = patchProp(next, h.id, { item: "codex" });
    expect(next.props.find((x) => x.id === h.id)!.item).toBe("codex");
    next = patchProp(next, h.id, { item: undefined }); // never without one
    expect(next.props.find((x) => x.id === h.id)!.item).toBe(DEFAULT_PICKUP_ITEM);
    next = patchProp(next, h.id, { kind: "box" });
    p = next.props.find((x) => x.id === h.id)!;
    expect("item" in p).toBe(false);
    expect(validateHouse(next).problems).toEqual([]);
  });

  it("a heart refuses a label from the inspector too", () => {
    const h = addProp(TWO_ROOMS(), "heart", "f", [5.5, 1])!;
    const next = patchProp(h.house, h.id, { label: "HEART" });
    expect("label" in next.props.find((x) => x.id === h.id)!).toBe(false);
    expect(validateHouse(next).problems).toEqual([]);
  });

  it("edits the moment's signal: its own, back to the default when blank or equal to it", () => {
    const h = addProp(TWO_ROOMS(), "heart", "f", [5.5, 1])!;
    let next = patchProp(h.house, h.id, { signal: "  heart found  " });
    let p = next.props.find((x) => x.id === h.id)!;
    expect(p.signals).toEqual({ reached: "heart found" });
    expect(momentSignalOf(p)).toEqual({ key: "reached", own: "heart found", fallback: HEART_SIGNAL });
    expect(validateHouse(next).problems).toEqual([]);
    next = patchProp(next, h.id, { signal: HEART_SIGNAL });
    expect("signals" in next.props.find((x) => x.id === h.id)!).toBe(false);
    next = patchProp(next, h.id, { signal: "x" });
    next = patchProp(next, h.id, { signal: "" });
    expect("signals" in next.props.find((x) => x.id === h.id)!).toBe(false);
    // A pickup's key is `taken`.
    const k = addProp(TWO_ROOMS(), "pickup", "f", [1, 1])!;
    p = patchProp(k.house, k.id, { signal: "grabbed" }).props.find((x) => x.id === k.id)!;
    expect(p.signals).toEqual({ taken: "grabbed" });
    expect(momentSignalOf({ ...p, kind: "box" })).toBeNull();
  });

  it("a kind change drops the signal keys the new kind doesn't take; a heart made King gets his defaults", () => {
    const h = addProp(TWO_ROOMS(), "heart", "f", [5.5, 1])!;
    let next = patchProp(h.house, h.id, { signal: "beat" });
    next = patchProp(next, h.id, { kind: "pickup" });
    let p = next.props.find((x) => x.id === h.id)!;
    expect("signals" in p).toBe(false);
    expect(validateHouse(next).problems).toEqual([]);
    next = patchProp(patchProp(h.house, h.id, { signal: "beat" }), h.id, { kind: "king" });
    p = next.props.find((x) => x.id === h.id)!;
    expect(p.signals).toEqual(propDefaults("king").signals);
    // A King made a heart keeps none of his.
    const king = withKing();
    const id = king.props.find((x) => x.kind === "king")!.id;
    next = patchProp(king, id, { kind: "heart" });
    p = next.props.find((x) => x.id === id)!;
    expect(p.signals).toBeUndefined();
    expect(p.hp).toBeUndefined();
    expect("label" in p).toBe(false);
    expect(validateHouse(next).problems).toEqual([]);
  });

  it("the show maps' heart and disk survive the inspector unchanged", () => {
    const show = SHOW();
    for (const id of ["server-heart", "virus-disk"]) {
      const before = show.props.find((p) => p.id === id)!;
      const after = patchProp(show, id, { color: before.color }).props.find((p) => p.id === id)!;
      expect(after).toEqual(before);
    }
  });
});
