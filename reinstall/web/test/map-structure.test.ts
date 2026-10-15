import { describe, expect, it } from "vitest";
import { buildWalls, polyArea, roomAt, route, validateHouse } from "@loom/house";
import type { HouseMap } from "@loom/house";
import { unreachableDucks, unreachableRooms, foldName, locationProblems, selectionOf, structuredProblems, walkabilityProblems } from "../src/map/check.ts";
import { doorLine, moveDoorAlong, openEdge, patchDoor, placeDoor, resolveDoor, sidesAt, wallRun } from "../src/map/doors.ts";
import { moveRectEdge, moveRoom, moveTo, patchRoom, removeThing } from "../src/map/edit.ts";
import { EMPTY_HISTORY, HISTORY_DEPTH, pushed, redone, undone } from "../src/map/history.ts";
import { freshId, freshLabel, slug, uniqueId } from "../src/map/ids.ts";
import { edgeCoords, edgePull, panView, snapToNearest, zoomView } from "../src/map/plan.ts";
import {
  addFloor,
  addRoom,
  addStair,
  blankHouse,
  cascadeOf,
  cascadeText,
  deleteRoomText,
  deletesWith,
  floorDefaults,
  moveStair,
  patchFloor,
  placeRect,
  removeFloor,
  removeRoom,
  renameRoom,
  setRoomRect,
} from "../src/map/structure.ts";
import { fillYard, flapsAdded, gridFor, partition, patchYard, touchesIndoor, traceCells, yardClash, yardOf, yardParts, yardShare } from "../src/map/yards.ts";
import { floorOfSelection, isStep, parseNum, selectionExists } from "../src/map/tools.ts";
import { L_ROOM, SHOW, STAIR, TWO_ROOMS } from "./houses.ts";

/** The map is valid — or the test fails with `validateHouse`'s problems. */
function valid(h: HouseMap): HouseMap {
  const v = validateHouse(h);
  expect(v.problems).toEqual([]);
  return v.house!;
}

const area = (h: HouseMap, ids: readonly string[]) => ids.reduce((s, id) => s + Math.abs(polyArea(h.rooms.find((r) => r.id === id)!.poly)), 0);
const yardArea = (h: HouseMap) => area(h, yardOf(h, "yard"));
const room = (h: HouseMap, id: string) => h.rooms.find((r) => r.id === id)!;

/** A small deterministic PRNG for the fuzz. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

describe("ids", () => {
  it("slugs labels and never collides", () => {
    expect(slug("The Server Room")).toBe("server-room");
    expect(slug("Café  (back)")).toBe("cafe-back");
    expect(slug("!!!", "room")).toBe("room");
    expect(freshId("yard", ["yard", "yard-2"])).toBe("yard-3");
    expect(freshId("tent", [])).toBe("tent");
    expect(uniqueId("terminal", ["terminal-1"])).toBe("terminal-2");
    expect(freshLabel("Room", ["Room", "Room 2"])).toBe("Room 3");
  });
});

describe("history", () => {
  it("undoes and redoes, and a new edit clears the redo stack", () => {
    const a = blankHouse("A");
    const b = { ...a, name: "B" };
    const c = { ...a, name: "C" };
    let h = pushed(EMPTY_HISTORY, a); // a → b
    const u = undone(h, b)!;
    expect(u.present).toBe(a);
    const r = redone(u.history, a)!;
    expect(r.present).toBe(b);
    h = pushed(u.history, a); // a → c instead
    expect(h.future).toEqual([]);
    expect(undone(h, c)!.present).toBe(a);
    expect(undone(EMPTY_HISTORY, a)).toBeNull();
    expect(redone(EMPTY_HISTORY, a)).toBeNull();
  });

  it("forgets past the depth", () => {
    let h = EMPTY_HISTORY;
    const a = blankHouse("A");
    for (let i = 0; i < HISTORY_DEPTH + 20; i++) h = pushed(h, a);
    expect(h.past.length).toBe(HISTORY_DEPTH);
  });
});

describe("the plan view", () => {
  it("zooms about a point that stays put, and pans", () => {
    const vb = zoomView([0, 0, 10, 8], [5, 4], 0.5);
    expect(vb).toEqual([2.5, 2, 5, 4]);
    expect(zoomView([0, 0, 10, 8], [0, 0], 2)).toEqual([0, 0, 20, 16]);
    expect(panView([0, 0, 10, 8], 1, -2)).toEqual([1, -2, 10, 8]);
  });

  it("pulls a moving edge onto a neighbour's", () => {
    const coords = edgeCoords(TWO_ROOMS(), "f", "b");
    expect(coords.xs.sort((p, q) => p - q)).toEqual([0, 4]);
    expect(snapToNearest(4.08, coords.xs, 0.1)).toBe(4);
    expect(snapToNearest(4.3, coords.xs, 0.1)).toBe(4.3);
    const pull = edgePull([4.1, 0.05, 7, 3], coords, 0.15);
    expect(pull[0]).toBeCloseTo(-0.1);
    expect(pull[1]).toBeCloseTo(-0.05);
  });
});

describe("doors", () => {
  it("reads the rooms either side of a wall off the plan", () => {
    const h = TWO_ROOMS();
    expect(sidesAt(h, "f", { axis: "z", c: 4 }, 1.5)).toEqual(["a", "b"]);
    expect(sidesAt(h, "f", { axis: "x", c: 0 }, 2)).toEqual([null, "a"]);
    const run = wallRun(h, "f", { axis: "z", c: 4 }, 1)!;
    expect([run.lo, run.hi, run.sides]).toEqual([0, 3, ["a", "b"]]);
    expect(wallRun(h, "f", { axis: "z", c: 2 }, 1)).toBeNull(); // the middle of room a
  });

  it("places a door on the nearest wall, between the rooms there", () => {
    const h = TWO_ROOMS();
    h.doors = [];
    const r = placeDoor(h, "f", [3.9, 2.03], { tol: 0.3 })!;
    const d = r.house.doors.find((x) => x.id === r.id)!;
    expect(d).toMatchObject({ a: "a", b: "b", at: [4, 2.05], width: 0.9 });
    valid(r.house);
    // Clicked from inside b: b is a.
    expect(placeDoor(h, "f", [4.1, 1], { tol: 0.3 })!.house.doors[0]).toMatchObject({ a: "b", b: "a" });
    // An outer wall: to the outside, kept inside the run.
    const out = placeDoor(h, "f", [0.1, 0.02], { tol: 0.3 })!;
    expect(out.house.doors[0]).toMatchObject({ a: "a", b: null, at: [0.45, 0], width: 0.9 });
    valid(out.house);
    expect(placeDoor(h, "f", [2, 1.5], { tol: 0.3 })).toBeNull(); // no wall near
  });

  it("slides a door along its wall, re-linking to the next room", () => {
    const h = TWO_ROOMS();
    // The north wall of a then b: slide the front door from a's stretch onto b's.
    const moved = moveDoorAlong(h, "front", [5.5, 0.3]);
    expect(moved.doors.find((d) => d.id === "front")).toMatchObject({ a: "b", b: null, at: [5.5, 0] });
    valid(moved);
    // Clamped at the end of the wall.
    expect(moveDoorAlong(h, "ab", [4, 9]).doors.find((d) => d.id === "ab")!.at).toEqual([4, 2.5]);
    expect(moveDoorAlong(h, "nope", [0, 0])).toBe(h);
  });

  it("opens a whole edge, and edits the width", () => {
    const h = openEdge(TWO_ROOMS(), "ab");
    expect(h.doors.find((d) => d.id === "ab")).toMatchObject({ at: [4, 1.5], width: 3 });
    valid(h);
    expect(patchDoor(h, "ab", { width: 1.2 }).doors.find((d) => d.id === "ab")!.width).toBe(1.2);
    const tall = patchDoor(h, "front", { height: undefined });
    expect("height" in tall.doors.find((d) => d.id === "front")!).toBe(false);
  });

  it("finds a door's wall line, and none for a door off every wall", () => {
    const h = TWO_ROOMS();
    expect(doorLine(h, h.doors[0]!)).toEqual({ axis: "z", c: 4 });
    const off = { ...h.doors[0]!, at: [2, 1.5] as [number, number] };
    expect(doorLine(h, off)).toBeNull();
    expect(resolveDoor(h, off)).toBe(off);
  });
});

describe("doors follow their room", () => {
  it("a moved room carries its doors, which re-link where they land", () => {
    const h = TWO_ROOMS();
    const away = moveRoom(h, "b", 1, 0);
    expect(away.doors.find((d) => d.id === "ab")).toMatchObject({ a: "b", b: null, at: [5, 1.5] });
    valid(away);
    const back = moveRoom(away, "b", -1, 0);
    expect(back.doors.find((d) => d.id === "ab")).toMatchObject({ a: "b", b: "a", at: [4, 1.5] });
    valid(back);
  });

  it("a resized edge carries the doors on it and keeps the others on their side", () => {
    const h = TWO_ROOMS();
    // a's north edge moves south: the front door goes with it.
    const n = moveRectEdge(h, "a", "n", -1);
    expect(n.doors.find((d) => d.id === "front")!.at).toEqual([2, -1]);
    // a's west edge moves east past the front door: it slides to stay on the north side.
    const w = moveRectEdge(h, "a", "w", 2.5);
    expect(w.doors.find((d) => d.id === "front")!.at).toEqual([2.95, 0]);
    // (What stood in the cut-off part is outside now — the problem list says so.)
    expect(validateHouse(w).problems.every((p) => /in-a|spawn/.test(p))).toBe(true);
  });

  it("a polygon room (from the JSON) still moves with its things and stays valid", () => {
    const h = L_ROOM();
    const id = h.rooms[0]!.id;
    const moved = valid(moveRoom(h, id, 1.5, -0.5));
    expect(moved.rooms[0]!.poly).toEqual(h.rooms[0]!.poly.map(([x, z]) => [x + 1.5, z - 0.5]));
    expect(moved.spawn.pos[0]).toBeCloseTo(h.spawn.pos[0] + 1.5);
    expect(moveRectEdge(h, id, "e", 9)).toBe(h); // edges resize rectangles only
  });

  it("a wall terminal rides the edge it hangs on", () => {
    const h = TWO_ROOMS();
    const e = moveRectEdge(h, "b", "e", 8);
    expect(e.terminals[0]!.pos).toEqual([8, 1.4, 1.5]);
    valid(e);
  });
});

describe("yards", () => {
  it("a blank house is valid: one floor, a yard, the spawn and a duck in it", () => {
    const h = valid(blankHouse("Test"));
    expect(h.floors).toHaveLength(1);
    expect(h.rooms[0]!.outdoor).toBe(true);
    expect(buildWalls(h).every((w) => w.kind === "fence")).toBe(true);
  });

  it("traces cells and refuses a hole or a pinch", () => {
    const g = gridFor([], [0, 0, 3, 3]);
    expect(g.xs).toEqual([0, 3]);
    const g3 = { xs: [0, 1, 2, 3], zs: [0, 1, 2, 3] };
    const ring = new Set([0, 1, 2, 3, 5, 6, 7, 8]); // all but the middle
    expect(traceCells(ring, g3)).toBeNull();
    expect(traceCells(new Set([0, 4]), g3)).toBeNull(); // corner to corner
    expect(traceCells(new Set([0, 1, 3]), g3)).toEqual([
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ]);
    const parts = partition(ring, g3);
    expect(parts.length).toBe(2);
    for (const p of parts) expect(traceCells(p, g3)).not.toBeNull();
  });

  it("a tent drawn in the middle of the yard splits it around the tent, joined by openings, with a flap", () => {
    const before = blankHouse("Test");
    const total = yardArea(before);
    const r = addRoom(before, "ground", [-2, -2, 2, 1], { label: "The Tent" });
    const h = valid(r.house);
    expect(r.id).toBe("tent");
    const pieces = yardOf(h, "yard");
    expect(pieces.length).toBe(2);
    expect(area(h, pieces) + 12).toBeCloseTo(total);
    for (const id of pieces) expect(room(h, id)).toMatchObject({ label: "Yard", outdoor: true });
    // Openings between the pieces, one flap from the tent into the yard.
    const openings = h.doors.filter((d) => pieces.includes(d.a) && d.b !== null && pieces.includes(d.b));
    expect(openings.length).toBeGreaterThan(0);
    const flaps = h.doors.filter((d) => d.a === "tent");
    expect(flaps).toHaveLength(1);
    expect(flaps[0]!.width).toBe(0.9);
    // The duck in the yard is reachable, and so is one in the tent.
    const withDuck = moveTo(h, { kind: "duck", id: "duck-yard-1" }, [0, -1]);
    expect(withDuck.duck.spots[0]!.room).toBe("tent");
    expect(unreachableDucks(valid(withDuck))).toEqual([]);
    expect(route(withDuck, withDuck.spawn.pos, withDuck.duck.spots[0]!.pos).length).toBeGreaterThan(2);
  });

  it("a tent against the fence notches the yard into one piece", () => {
    const h = valid(addRoom(blankHouse("Test"), "ground", [6, -6, 10, -2]).house);
    expect(yardOf(h, "yard")).toEqual(["yard"]);
    expect(room(h, "yard").poly.length).toBe(6);
  });

  it("the spawn under a new tent moves into it", () => {
    const h = valid(addRoom(blankHouse("Test"), "ground", [-1, 1, 1, 3], { label: "Tent" }).house);
    expect(h.spawn.room).toBe("tent");
  });

  it("moving the tent keeps the yard's area; moving it out gives it all back", () => {
    let h = addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    const total = yardArea(blankHouse("Test"));
    for (const [dx, dz] of [
      [1, 0],
      [0.5, 2],
      [-3, -1],
      [2.25, 0.75],
    ] as const) {
      h = valid(moveRoom(h, "tent", dx, dz));
      expect(area(h, yardOf(h, "yard")) + 12).toBeCloseTo(total);
      expect(h.doors.filter((d) => d.a === "tent" || d.b === "tent")).toHaveLength(1);
    }
    // Right out of the yard: the whole yard comes back as one rectangle.
    const out = valid(moveRoom(h, "tent", 30, 0));
    expect(yardOf(out, "yard")).toEqual(["yard"]);
    expect(area(out, ["yard"])).toBeCloseTo(total);
    expect(out.doors.find((d) => d.a === "tent")!.b).toBeNull();
  });

  it("deleting the tent gives the yard its footprint back", () => {
    const h = addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    const r = removeRoom(h, "tent");
    expect("house" in r).toBe(true);
    const back = valid((r as { house: HouseMap }).house);
    expect(yardOf(back, "yard")).toEqual(["yard"]);
    expect(back.doors).toEqual([]);
  });

  it("resizing the tent re-cuts the yard", () => {
    let h = addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    h = valid(moveRectEdge(h, "tent", "e", 4));
    expect(area(h, yardOf(h, "yard")) + 18).toBeCloseTo(yardArea(blankHouse("Test")));
    h = valid(moveRectEdge(h, "tent", "e", 1));
    expect(area(h, yardOf(h, "yard")) + 9).toBeCloseTo(yardArea(blankHouse("Test")));
  });

  it("any tent anywhere in the yard (fuzz) leaves a valid map", () => {
    const next = rng(31);
    const pick = (lo: number, hi: number, step: number) => Math.round((lo + next() * (hi - lo)) / step) * step;
    for (let i = 0; i < 120; i++) {
      const w = pick(1, 6, 0.25);
      const d = pick(1, 6, 0.25);
      const x = pick(-12, 10 - w + 2, 0.25);
      const z = pick(-8, 10 - d + 2, 0.25);
      const base = blankHouse("Fuzz");
      const r = addRoom(base, "ground", [x, z, x + w, z + d], { label: "Tent" });
      const v = validateHouse(r.house);
      expect(v.problems, `tent [${x}, ${z}, ${x + w}, ${z + d}]`).toEqual([]);
      // And a second room beside it, and a move.
      const r2 = addRoom(r.house, "ground", [pick(-9, 7, 0.5), pick(-5, 7, 0.5), 0, 0].map((v2, k, a) => (k < 2 ? v2 : a[k - 2]! + 2)) as [number, number, number, number], { label: "Shed" });
      if (validateHouse(r2.house).problems.some((p) => p.includes("overlap"))) continue; // drawn over the tent
      expect(validateHouse(r2.house).problems, `shed ${i}`).toEqual([]);
      expect(validateHouse(moveRoom(r2.house, "tent", 0.5, -0.75)).problems.filter((p) => !p.includes("overlap")), `move ${i}`).toEqual([]);
    }
  });

  it("random draws, moves, resizes and deletes (fuzz) never leave a broken door or yard", () => {
    const fails: string[] = [];
    for (let seed = 1; seed < 300; seed++) {
      const next = rng(seed);
      const pick = (lo: number, hi: number, step: number) => Math.round((lo + next() * (hi - lo)) / step) * step;
      let h: HouseMap = seed % 2 ? blankHouse("F") : SHOW();
      const floor = h.floors[0]!.id;
      const yard = seed % 2 ? [-10, -6, 10, 10] : [-4, 12, 6, 20];
      const w = pick(1, 5, 0.05);
      const d = pick(1, 5, 0.05);
      const x = pick(yard[0]! - 1, yard[2]! - w + 1, 0.05);
      const z = pick(yard[1]! - 1, yard[3]! - d + 1, 0.05);
      const r = addRoom(h, floor, [x, z, x + w, z + d], { label: "Tent" });
      const ok = (hh: HouseMap) => validateHouse(hh).problems.filter((p) => !/overlap|outside room|locates to|rises above|inside solid|needs at least 1|on floor "basement"/.test(p));
      let pr = ok(r.house);
      if (validateHouse(r.house).problems.some((p) => /overlap/.test(p))) continue;
      if (pr.length) fails.push(`seed ${seed} add: ${pr.join("; ")}`);
      h = r.house;
      for (let step = 0; step < 6; step++) {
        const op = next();
        let n: HouseMap;
        const target = seed % 2 === 0 && next() < 0.3 ? (["start-bar", "desktop", "optical-drive"] as const)[Math.floor(next() * 3)]! : r.id;
        if (op < 0.5) n = moveRoom(h, target, pick(-2, 2, 0.05), pick(-2, 2, 0.05));
        else n = moveRectEdge(h, target, (["n", "s", "e", "w"] as const)[Math.floor(next() * 4)]!, pick(-10, 20, 0.05));
        if (validateHouse(n).problems.some((p) => /overlap/.test(p))) continue;
        pr = ok(n);
        if (pr.length) {
          fails.push(`seed ${seed} step ${step}: ${pr.join("; ")}`);
          break;
        }
        h = n;
      }
      const del = removeRoom(h, r.id);
      if ("house" in del) {
        pr = ok(del.house);
        if (pr.length) fails.push(`seed ${seed} delete: ${pr.join("; ")}`);
      }
    }
    expect(fails.slice(0, 15)).toEqual([]);
  });

  it("a tent in the show's backyard leaves the show valid, every duck still walkable", () => {
    const show = SHOW();
    const r = addRoom(show, "main", [0, 14, 3, 17], { label: "Tent" });
    const h = valid(r.house);
    expect(yardOf(h, "backyard").length).toBeGreaterThan(1);
    expect(h.doors.find((d) => d.id === "back")!.b).toMatch(/^backyard/);
    expect(unreachableDucks(h)).toEqual(unreachableDucks(show));
  });

  it("a yard drawn around the house is cut around it, and the front door opens onto it", () => {
    const h = TWO_ROOMS();
    const r = addRoom(h, "f", [-3, -3, 10, 6], { outdoor: true });
    const out = valid(r.house);
    const pieces = yardOf(out, r.id);
    expect(area(out, pieces)).toBeCloseTo(13 * 9 - 21);
    expect(out.doors.find((d) => d.id === "front")!.b).toMatch(/^yard/);
  });

  it("fills a yard back out to its box", () => {
    const h = addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    const removed = (removeRoom(h, "tent") as { house: HouseMap }).house;
    expect(yardOf(removed, "yard")).toEqual(["yard"]);
    // A notched yard (tent at the fence), the tent then deleted without give-back: fill restores it.
    const notched = addRoom(blankHouse("Test"), "ground", [6, -6, 10, -2], { label: "Tent" }).house;
    const plain = { ...notched, rooms: notched.rooms.filter((x) => x.id !== "tent"), doors: [] };
    const filled = valid(fillYard(plain, "yard"));
    expect(area(filled, yardOf(filled, "yard"))).toBeCloseTo(320);
  });

  it("a room that only borders a yard never gives it ground", () => {
    const show = SHOW();
    expect(yardShare(show, "start-bar", yardOf(show, "backyard"))).toBeLessThan(0.5);
    const shrunk = moveRectEdge(show, "start-bar", "s", 11);
    expect(room(shrunk, "backyard").poly).toEqual(room(show, "backyard").poly);
    expect(shrunk.doors.find((d) => d.id === "back")).toMatchObject({ a: "start-bar", b: null, at: [-4.5, 11] });
  });

  it("making a yard indoor cuts it from yards it overlaps; toggling outdoor keeps the polygon", () => {
    const h = TWO_ROOMS();
    const o = patchRoom(h, "b", { outdoor: true });
    expect(room(o, "b").outdoor).toBe(true);
    const i = patchRoom(o, "b", { outdoor: false });
    expect("outdoor" in room(i, "b")).toBe(false);
  });
});

describe("yards — flaps only where a way in is missing", () => {
  /** A survey drawn room by room into a blank house's yard. */
  const HOUSE: [string, [number, number, number, number]][] = [
    ["Mud", [-4, 0, 0.5, 2.5]],
    ["Bath", [-4, 2.5, 0.5, 5]],
    ["Living", [0.5, 0, 6, 6.5]],
    ["Kitchen", [0.5, 6.5, 6, 12]],
    ["Hall", [-4, 5, 0.5, 8]],
    ["Back", [-4, 8, 0.5, 12]],
  ];

  it("house rooms drawn into the yard get no exterior doors nobody placed — only the first, free-standing one a flap", () => {
    let h = blankHouse("Survey");
    const added: string[] = [];
    for (const [label, rect] of HOUSE) {
      const next = addRoom(h, "ground", rect, { label }).house;
      added.push(...flapsAdded(h, next).map((d) => d.a));
      h = next;
    }
    valid(h);
    expect(added).toEqual(["mud"]);
    expect(h.doors.map((d) => d.id)).toEqual(["mud-flap"]);
    expect(touchesIndoor(h, "bath")).toBe(true);
    expect(touchesIndoor(h, "yard")).toBe(true);
    // The rooms the director hasn't put doors in yet are flagged.
    expect(unreachableRooms(h)).toEqual(["bath", "living", "kitchen", "hall", "back"]);
    expect(walkabilityProblems(h).filter((p) => p.sel?.kind === "room")).toHaveLength(5);
  });

  it("a tent cutting the yard in two opens into both parts, never sealing one off", () => {
    const h = valid(addRoom(blankHouse("Test"), "ground", [-1, -6, 2, 10], { label: "Tent" }).house);
    const pieces = yardOf(h, "yard");
    expect(pieces).toHaveLength(2);
    expect(yardParts(h, pieces)).toHaveLength(2); // no opening between them: the tent is in the way
    for (const id of pieces) expect(h.doors.some((d) => d.a === "tent" && d.b === id)).toBe(true);
    expect(unreachableRooms(h)).toEqual([]);
  });

  it("a shed from the house to the fence: the part it seals off opens through the shed", () => {
    // A yard strip along TWO_ROOMS' north wall; the front door opens onto it.
    const yard = addRoom(TWO_ROOMS(), "f", [-3, -3, 10, 0], { outdoor: true });
    const before = valid(yard.house);
    expect(before.doors.find((d) => d.id === "front")!.b).toBe(yard.id);
    // The shed touches the house (b), so it is no free-standing tent — but it cuts the strip in two.
    const h = valid(addRoom(before, "f", [5, -3, 6, 0], { label: "Shed" }).house);
    const parts = yardParts(h, yardOf(h, yard.id));
    expect(parts).toHaveLength(2);
    // West keeps the front door; east is reached through the shed, which opens on both.
    expect(h.doors.filter((d) => d.a === "shed").map((d) => d.b).sort()).toEqual(yardOf(h, yard.id).sort());
    expect(unreachableRooms(h)).toEqual([]);
    expect(unreachableDucks(h)).toEqual([]);
  });

  it("a part that keeps its own door gets no extra flap", () => {
    // Doors at both ends of the strip: the east part keeps one, so the shed (touching the house) gets none.
    const yard = addRoom(TWO_ROOMS(), "f", [-3, -3, 10, 0], { outdoor: true });
    const withBack = { ...yard.house, doors: [...yard.house.doors, { id: "east", a: "b", b: yard.id, at: [6.5, 0] as [number, number], width: 0.9 }] };
    const h = valid(addRoom(valid(withBack), "f", [5, -3, 6, 0], { label: "Shed" }).house);
    expect(h.doors.filter((d) => d.a === "shed" || d.b === "shed")).toEqual([]);
    expect(unreachableRooms(h)).toEqual(["shed"]);
  });

  it("a free-standing tent still gets its flap, said by flapsAdded", () => {
    const before = blankHouse("Test");
    const after = addRoom(before, "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    expect(flapsAdded(before, after).map((d) => d.id)).toEqual(["tent-flap"]);
    expect(flapsAdded(after, moveRoom(after, "tent", 1, 0))).toEqual([]);
  });
});

describe("yards — one place, not its pieces", () => {
  const split = () => addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;

  it("deleting a yard deletes every piece (and asks about all of them)", () => {
    const h = moveTo(split(), { kind: "spawn" }, [0, -1]); // the spawn into the tent
    const pieces = yardOf(h, "yard");
    expect(pieces.length).toBeGreaterThan(1);
    expect(deletesWith(h, pieces[1]!)).toEqual(pieces);
    expect(deletesWith(h, "tent")).toEqual(["tent"]);
    const c = cascadeOf(h, deletesWith(h, pieces[1]!));
    expect(deleteRoomText(room(h, pieces[1]!), c)).toMatch(/^Delete the yard “Yard” \(all 2 pieces\)/);
    const out = removeRoom(h, pieces[1]!) as { house: HouseMap };
    expect(out.house.rooms.map((r) => r.id)).toEqual(["tent"]);
    expect(out.house.duck.spots).toEqual([]); // the yard's duck went with it
  });

  it("a yard in pieces can't be made indoor one piece at a time", () => {
    const h = split();
    const pieces = yardOf(h, "yard");
    expect(patchRoom(h, pieces[1]!, { outdoor: false })).toBe(h);
    const whole = blankHouse("Test");
    expect(room(patchRoom(whole, "yard", { outdoor: false }), "yard").outdoor).toBeUndefined();
  });

  it("a label or LOCATION that would merge two yards is caught", () => {
    const h = addRoom(blankHouse("Test"), "ground", [12, -6, 20, 2], { outdoor: true }).house;
    expect(room(h, "yard-2").label).toBe("Yard 2");
    expect(yardClash(h, "yard-2", { label: "Yard" })).toBe(true);
    expect(yardClash(h, "yard-2", { label: "Yard back" })).toBe(false);
    expect(yardClash(h, "yard-2", { label: "Yard", location: "The Cloud" })).toBe(false);
    expect(yardClash(h, "yard", { label: "Yard" })).toBe(false); // its own name
    // A committed rename touches only its own yard.
    const renamed = patchYard(h, "yard-2", { label: "Yard back" });
    expect(room(renamed, "yard").label).toBe("Yard");
  });
});

describe("number fields — commit a value, not its prefixes", () => {
  it("parses what a field holds", () => {
    expect(parseNum("10.5")).toBe(10.5);
    expect(parseNum("  ")).toBeNull();
    expect(parseNum("-")).toBeUndefined();
    expect(parseNum("1e")).toBeUndefined();
  });

  it("applies a step at once, typing on Enter / blur", () => {
    expect(isStep(new Event("input"))).toBe(true); // the spinner, ↑ / ↓
    expect(isStep({ type: "input", inputType: "insertText" } as unknown as Event)).toBe(false);
    expect(isStep({ type: "input", inputType: "deleteContentBackward" } as unknown as Event)).toBe(false);
  });

  it("why: a typed width applied keystroke by keystroke would drag the doors", () => {
    // "10.5" typed into the backyard's W field: 1, then 10.5. Applied once, the back door stays.
    const show = SHOW();
    const r = room(show, "backyard").poly;
    const [x0, z0, , z1] = [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), 0, Math.max(...r.map((p) => p[1]))];
    const once = setRoomRect(show, "backyard", [x0, z0, x0 + 10.5, z1]);
    expect(once.doors.find((d) => d.id === "back")!.at).toEqual(show.doors.find((d) => d.id === "back")!.at);
  });
});

describe("floors", () => {
  it("adds a floor above the top one with a unique slugged id", () => {
    const h = TWO_ROOMS();
    const d = floorDefaults(h);
    expect(d.elevation).toBe(2.75);
    const r = addFloor(h, { label: "Upstairs", elevation: 3, height: 2.4 });
    expect(r.id).toBe("upstairs");
    expect(addFloor(r.house, { label: "Upstairs", elevation: 6, height: 2.4 }).id).toBe("upstairs-2");
    valid(r.house);
  });

  it("a floor's things ride its elevation", () => {
    const h = patchFloor(TWO_ROOMS(), "f", { elevation: 1, label: "Raised" });
    expect(h.floors[0]).toMatchObject({ elevation: 1, label: "Raised" });
    expect(h.spawn.pos[1]).toBe(1);
    expect(h.terminals[0]!.pos[1]).toBe(2.4);
    valid(h);
  });

  it("deletes a floor with everything on it, but never the last or the spawn's", () => {
    const h = STAIR(); // the spawn is in the hall, upstairs
    expect(removeFloor(h, "upper")).toEqual({ error: expect.stringContaining("spawn") });
    const r = removeFloor(h, "lower") as { house: HouseMap };
    expect(r.house.floors).toHaveLength(1);
    expect(r.house.stairs).toEqual([]);
    expect(r.house.rooms.map((x) => x.id)).toEqual(["hall"]);
    // Its only duck spot was in the cellar: the problem list asks for one.
    expect(validateHouse(r.house).problems).toEqual(["duck.spots needs at least 1"]);
    expect("error" in removeFloor(r.house, r.house.floors[0]!.id)).toBe(true);
  });
});

describe("rooms", () => {
  it("adds a rectangle with a fresh label and id, and refuses an empty one", () => {
    const h = TWO_ROOMS();
    const r = addRoom(h, "f", [7, 0, 9.5, 3]);
    expect(room(r.house, r.id)).toMatchObject({ id: "room", label: "Room", poly: [[7, 0], [9.5, 0], [9.5, 3], [7, 3]] });
    expect(addRoom(r.house, "f", [10, 0, 12, 3]).id).toBe("room-2");
    expect(addRoom(h, "f", [1, 1, 1, 3]).house).toBe(h);
    valid(r.house);
  });

  it("places a typed W × D east of the selected room", () => {
    const h = TWO_ROOMS();
    expect(placeRect(h, 3, 2.5, "b", [0, 0])).toEqual([7, 0, 10, 2.5]);
    expect(placeRect(h, 3, 2.5, null, [1, 2])).toEqual([1, 2, 4, 4.5]);
  });

  it("deletes a room with its doors and what stands in it, but not the spawn's", () => {
    const h = TWO_ROOMS();
    const c = cascadeOf(h, ["b"]);
    expect(c).toMatchObject({ doors: ["ab"], terminals: ["t"], duckSpots: ["in-b", "b-corner"], spawn: false });
    expect(cascadeText(c)).toBe("1 door, 1 terminal and 2 duck spots");
    const r = removeRoom(h, "b") as { house: HouseMap };
    expect(r.house.rooms.map((x) => x.id)).toEqual(["a"]);
    expect(r.house.doors.map((d) => d.id)).toEqual(["front"]);
    valid(r.house);
    expect(removeRoom(h, "a")).toEqual({ error: expect.stringContaining("spawn") });
  });

  it("renames a room id everywhere", () => {
    const h = renameRoom(TWO_ROOMS(), "b", "kitchen");
    expect(h.doors[0]!.b).toBe("kitchen");
    expect(h.terminals[0]!.room).toBe("kitchen");
    valid(h);
    expect(renameRoom(h, "a", "kitchen")).toBe(h); // taken
  });

  it("sets a rect from typed numbers: a move or a resize", () => {
    const h = TWO_ROOMS();
    const moved = setRoomRect(h, "b", [4, 1, 7, 4]);
    expect(room(moved, "b").poly).toEqual([[4, 1], [7, 1], [7, 4], [4, 4]]);
    expect(moved.terminals[0]!.pos).toEqual([7, 1.4, 2.5]);
    const grown = valid(setRoomRect(h, "b", [4, 0, 9, 3]));
    expect(room(grown, "b").poly).toEqual([[4, 0], [9, 0], [9, 3], [4, 3]]);
  });

  it("removes doors, stairs and props as things", () => {
    const h = TWO_ROOMS();
    expect(removeThing(h, { kind: "door", id: "ab" }).doors.map((d) => d.id)).toEqual(["front"]);
    expect(removeThing(h, { kind: "door", id: "zz" })).toBe(h);
    expect(removeThing(STAIR(), { kind: "stair", id: STAIR().stairs[0]!.id }).stairs).toEqual([]);
  });
});

describe("stairs", () => {
  it("draws a stair between this floor's room and the one above", () => {
    const h = STAIR();
    const lower = [...h.floors].sort((a, b) => a.elevation - b.elevation)[0]!;
    const r = addStair({ ...h, stairs: [] }, lower.id, [1, 1, 4, 2]);
    const s = r.house.stairs[0]!;
    expect(s.from).toBe(roomAt(h, [2, 1.5], lower.id)!.id);
    expect(s.up).toBe("e");
    expect(s.to).not.toBe("");
    const moved = moveStair(r.house, r.id, 0.5, 0);
    expect(moved.stairs[0]!.rect).toEqual([1.5, 1, 4.5, 2]);
  });
});

describe("selections", () => {
  it("know their floor, and whether they still exist", () => {
    const h = STAIR();
    const stair = h.stairs[0]!.id;
    expect(floorOfSelection(h, { kind: "stair", id: stair })).toBe("lower");
    expect(floorOfSelection(h, { kind: "spawn" })).toBe("upper");
    expect(floorOfSelection(h, { kind: "room", id: "cellar" })).toBe("lower");
    expect(floorOfSelection(h, { kind: "floor", id: "upper" })).toBe("upper");
    expect(floorOfSelection(TWO_ROOMS(), { kind: "door", id: "ab" })).toBe("f");
    expect(selectionExists(h, { kind: "stair", id: stair })).toBe(true);
    expect(selectionExists(removeThing(h, { kind: "stair", id: stair }), { kind: "stair", id: stair })).toBe(false);
  });

  it("a yard's label, LOCATION and colour change on every piece at once", () => {
    const h = addRoom(blankHouse("Test"), "ground", [-2, -2, 2, 1], { label: "Tent" }).house;
    const pieces = yardOf(h, "yard");
    const next = patchYard(h, pieces[1]!, { label: "Lawn", location: "The Cloud" });
    expect(yardOf(next, "yard")).toEqual(pieces);
    for (const id of pieces) expect(room(next, id)).toMatchObject({ label: "Lawn", location: "The Cloud" });
    expect(room(patchYard(h, "tent", { label: "Big top" }), "tent").label).toBe("Big top");
  });
});

describe("the problem list", () => {
  it("reads validation problems back to the thing they name", () => {
    const h = TWO_ROOMS();
    expect(selectionOf(h, 'doors[0] "ab": [3, 1.5] is not on a wall')).toEqual({ kind: "door", id: "ab" });
    expect(selectionOf(h, 'rooms "a" and "b" overlap on floor "f"')).toEqual({ kind: "room", id: "a" });
    expect(selectionOf(h, "spawn: y 3 must be within")).toEqual({ kind: "spawn" });
    expect(selectionOf(h, 'duck.spots[1] "in-b": outside')).toEqual({ kind: "duck", id: "in-b" });
    expect(selectionOf(h, 'terminals[0] "gone": …')).toBeNull();
    expect(selectionOf(h, "version must be 1")).toBeNull();
    const broken = { ...h, doors: [{ ...h.doors[0]!, at: [2, 1.5] as [number, number] }] };
    const ps = structuredProblems(broken, validateHouse(broken).problems);
    expect(ps[0]).toMatchObject({ sel: { kind: "door", id: "ab" }, level: "error" });
  });

  it("flags a duck spot nobody can walk to", () => {
    const h = TWO_ROOMS();
    expect(unreachableDucks(h)).toEqual([]);
    const shut = { ...h, doors: h.doors.filter((d) => d.id !== "ab") };
    expect(unreachableDucks(shut)).toEqual(["in-b", "b-corner"]);
    expect(walkabilityProblems(shut)[0]).toMatchObject({ sel: { kind: "duck", id: "in-b" }, level: "warning" });
  });

  it("checks rooms against the story's LOCATIONs", () => {
    const h = SHOW();
    expect(locationProblems(h, null)).toEqual([]);
    const locs = [
      "The Desktop", "The Optical Drive", "The Tube", "The Internet", "The Start Bar", "The CPU", "The Steam Room", "Disk Cleanup",
      "The Cloud", "The RAM", "The Fan Closet", "The Graphics Card", "The Hard Drive", "The Server Room",
    ].map((id) => ({ id, label: null }));
    // The show map has a room for every LOCATION (the real house's names since wave 3)…
    expect(locationProblems(h, locs)).toEqual([]);
    // …and one the story declares but the map lacks is named.
    expect(locationProblems(h, [...locs, { id: "The Attic", label: null }]).map((p) => p.text)).toEqual(["LOCATION The Attic has no room on the map"]);
    const typo = patchRoom(h, "start-bar", { location: "The Start Bra" });
    expect(locationProblems(typo, locs)[0]).toMatchObject({ sel: { kind: "room", id: "start-bar" }, level: "warning" });
    expect(foldName("  the_mud-ROOM ")).toBe("the mud room");
  });
});
