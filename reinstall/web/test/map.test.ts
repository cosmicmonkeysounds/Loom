import { describe, expect, it } from "vitest";
import { DEFAULT_SPOT_FOV, horizontalFov, pointInPoly, roomAt, validateHouse } from "@loom/house";
import type { HouseMap } from "@loom/house";
import {
  addDuckSpot,
  addTerminal,
  aimAt,
  draftFromText,
  editableSource,
  MIN_ROOM,
  moveRectEdge,
  moveRoom,
  moveTo,
  patchRoom,
  patchTerminal,
  positionOf,
  provisionLink,
  remoteMapAction,
  removeThing,
  saveBaseOf,
  saveStateOf,
  conflictText,
  setHeight,
  setYaw,
  TERMINAL_HEIGHT,
  uniqueId,
  yawOf,
} from "../src/map/edit.ts";
import { along, clientToPlan, hitRectEdge, labelSpot, planBounds, playerColor, pointsAttr, propCorners, rectOf, roomUnder, snap, snap2, stairArrow, viewBoxOf, viewCone } from "../src/map/plan.ts";
import { L_ROOM, STAIR, TWO_FLOOR as SHOW, TWO_ROOMS } from "./houses.ts";
import { voiceProblems } from "../src/map/check.ts";

describe("plan — the SVG frame", () => {
  it("bounds every floor, and pads the viewBox", () => {
    expect(planBounds(SHOW())).toEqual([-4, 0, 6, 23]);
    expect(viewBoxOf([0, 0, 4, 3], 1)).toEqual([-1, -1, 6, 5]);
  });

  it("maps a client point to the plan through a letterboxed viewBox", () => {
    // 10 × 5 m shown in a 200 × 200 px box: 20 px/m, 50 px bars top and bottom.
    const rect = { left: 10, top: 20, width: 200, height: 200 };
    expect(clientToPlan(110, 120, rect, [0, 0, 10, 5])).toEqual([5, 2.5]);
    expect(clientToPlan(10, 70, rect, [0, 0, 10, 5])).toEqual([0, 0]);
    expect(clientToPlan(110, 120, rect, [-2, 3, 10, 5])).toEqual([3, 5.5]);
  });

  it("snaps to 5 cm without float dust or −0", () => {
    expect(snap(0.123)).toBe(0.1);
    expect(snap(0.126)).toBe(0.15);
    expect(snap(1.0000001)).toBe(1);
    expect(Object.is(snap(-0.01), 0)).toBe(true);
    expect(snap2([0.31, -0.29])).toEqual([0.3, -0.3]);
    expect(snap(0.7, 0.25)).toBe(0.75);
  });

  it("draws the house frame's yaw: 0 = north (up), + = counter-clockwise", () => {
    const n = along([0, 0], 0, 1);
    expect(n[0]).toBeCloseTo(0);
    expect(n[1]).toBeCloseTo(-1);
    expect(along([0, 0], 90, 2)[0]).toBeCloseTo(-2); // west
  });

  it("a terminal's view cone opens around its yaw", () => {
    const cone = viewCone({ pos: [1, 1.4, 1], yaw: -90, fov: 90 }, 2);
    expect(cone[0]).toEqual([1, 1]);
    const mid = cone[1 + 4]!; // the middle ray of 9
    expect(mid[0]).toBeCloseTo(3); // facing east
    expect(mid[1]).toBeCloseTo(1);
    // yaw − hfov/2 is clockwise: south of east, as wide as the tablet sees.
    const half = (horizontalFov(90) / 2) * (Math.PI / 180);
    expect(cone[1]![0]).toBeCloseTo(1 + 2 * Math.cos(half));
    expect(cone[1]![1]).toBeCloseTo(1 + 2 * Math.sin(half));
  });

  it("the cone is the terminal's real view: fov is vertical (three.js), default 70", () => {
    expect(DEFAULT_SPOT_FOV).toBe(70);
    expect(horizontalFov(70, 1)).toBeCloseTo(70);
    expect(horizontalFov(70, 4 / 3)).toBeCloseTo(86.07, 1);
    expect(horizontalFov(70)).toBeCloseTo(96.5, 0); // 16:10
    const wedge = (c: ReturnType<typeof viewCone>) => {
      const a = Math.atan2(c[1]![1] - c[0]![1], c[1]![0] - c[0]![0]);
      const b = Math.atan2(c[c.length - 1]![1] - c[0]![1], c[c.length - 1]![0] - c[0]![0]);
      return Math.abs(((((a - b) * 180) / Math.PI + 540) % 360) - 180);
    };
    // Unset = the terminal's default, not a narrower 60.
    expect(wedge(viewCone({ pos: [0, 1.4, 0], yaw: 0 }))).toBeCloseTo(horizontalFov(70), 6);
    expect(wedge(viewCone({ pos: [0, 1.4, 0], yaw: 0, fov: 60 }))).toBeCloseTo(horizontalFov(60), 6);
  });

  it("a prop's footprint turns like the scene and the physics turn it", () => {
    const c = propCorners({ pos: [2, 0, 1.5], size: [2, 0.5, 0.2], yaw: 90 });
    const xs = c.map((p) => p[0]);
    const zs = c.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(1.9);
    expect(Math.max(...xs)).toBeCloseTo(2.1);
    expect(Math.min(...zs)).toBeCloseTo(0.5);
    expect(Math.max(...zs)).toBeCloseTo(2.5);
  });

  it("points a stair's arrow up its slope", () => {
    expect(stairArrow(STAIR().stairs[0]!)).toEqual({ from: [1, 1.5], to: [4, 1.5] }); // up east
    expect(stairArrow({ id: "s", from: "a", to: "b", rect: [0, 0, 1, 4], up: "n" })).toEqual({ from: [0.5, 4], to: [0.5, 0] });
  });

  it("recognises rectangular rooms", () => {
    expect(rectOf(TWO_ROOMS().rooms[0]!.poly)).toEqual([0, 0, 4, 3]);
    expect(rectOf([[0, 3], [0, 0], [4, 0], [4, 3]])).toEqual([0, 0, 4, 3]); // either winding / start
    expect(rectOf(L_ROOM().rooms[0]!.poly)).toBeNull();
    expect(rectOf([[0, 0], [2, 0], [2, 2], [0, 1]])).toBeNull();
  });

  it("hit-tests a rectangular room's edges", () => {
    const room = TWO_ROOMS().rooms[0]!;
    expect(hitRectEdge(room, [2, 0.05], 0.18)).toBe("n");
    expect(hitRectEdge(room, [4.1, 1], 0.18)).toBe("e");
    expect(hitRectEdge(room, [-0.1, 2.85], 0.18)).toBe("w"); // near a corner: the nearer edge
    expect(hitRectEdge(room, [-0.1, 2.95], 0.18)).toBe("s");
    expect(hitRectEdge(room, [2, 1.5], 0.18)).toBeNull();
    expect(hitRectEdge(room, [9, 0], 0.18)).toBeNull();
  });

  it("finds the room under a point on one floor", () => {
    const house = SHOW();
    expect(roomUnder(house, "ground", [3, 3])?.id).toBe("living");
    expect(roomUnder(house, "basement", [3, 3])?.id).toBe("registry");
    expect(roomUnder(house, "ground", [4, 21])?.id).toBe("tent");
    expect(roomUnder(house, "ground", [50, 50])).toBeNull();
  });

  it("puts a room's label well inside it, even for an L", () => {
    const l = L_ROOM().rooms[0]!;
    expect(pointInPoly(l.poly, labelSpot(l.poly))).toBe(true);
    for (const r of SHOW().rooms) expect(pointInPoly(r.poly, labelSpot(r.poly))).toBe(true);
  });

  it("formats SVG points and colours players stably", () => {
    expect(pointsAttr([[0.12345, 1], [2, 3]])).toBe("0.123,1 2,3");
    expect(playerColor("g-abc123")).toBe(playerColor("g-abc123"));
    expect(playerColor("g-abc123")).toMatch(/^hsl\(\d+ 75% 62%\)$/);
  });
});

describe("edit — every op returns a copy", () => {
  const frozen = (): HouseMap => {
    const h = SHOW();
    return structuredClone(h);
  };

  it("moves a duck spot across rooms (its room follows), never mutating the input", () => {
    const house = frozen();
    const before = JSON.stringify(house);
    const next = moveTo(house, { kind: "duck", id: "living-couch" }, [3, 8]); // clear of the kitchen table
    expect(JSON.stringify(house)).toBe(before);
    const spot = next.duck.spots.find((d) => d.id === "living-couch")!;
    expect(spot.room).toBe("kitchen");
    expect(spot.pos[0]).toBe(3);
    expect(spot.pos[2]).toBe(8);
    expect(validateHouse(next).ok).toBe(true);
  });

  it("keeps a thing's room when moved off every room (a problem the director sees)", () => {
    const next = moveTo(frozen(), { kind: "terminal", id: "kitchen" }, [40, 40]);
    expect(next.terminals.find((t) => t.id === "kitchen")!.room).toBe("kitchen");
    expect(validateHouse(next).ok).toBe(false);
  });

  it("moves the spawn on its own floor", () => {
    // The tent is on the ground floor: [3, 3] is the Living Room, not the Rec Room below it.
    const next = moveTo(frozen(), { kind: "spawn" }, [3, 3]);
    expect(next.spawn.room).toBe("living");
    expect(next.spawn.pos[1]).toBe(0);
    const basement = moveTo({ ...frozen(), spawn: { room: "registry", pos: [0, -2.7, 4], yaw: 0 } }, { kind: "spawn" }, [3, 3]);
    expect(basement.spawn.room).toBe("registry");
    expect(basement.spawn.pos[1]).toBe(-2.7);
  });

  it("turns things: setYaw wraps, aimAt points (in 5° steps)", () => {
    const house = frozen();
    expect(setYaw(house, { kind: "spawn" }, 190).spawn.yaw).toBe(-170);
    expect(setYaw(house, { kind: "terminal", id: "kitchen" }, 12.3).terminals.find((t) => t.id === "kitchen")!.yaw).toBe(12.5);
    const t = house.terminals.find((x) => x.id === "kitchen")!;
    const aimed = aimAt(house, { kind: "terminal", id: "kitchen" }, [t.pos[0] + 3, t.pos[2] + 0.1]);
    expect(yawOf(aimed, { kind: "terminal", id: "kitchen" })).toBe(-90); // east
    expect(setYaw(house, { kind: "duck", id: "hall-end" }, 10)).toBe(house); // a duck has no yaw
    expect(yawOf(house, { kind: "room", id: "hall" })).toBeNull();
  });

  it("adds a terminal / duck spot inside the room, with fresh ids, still valid", () => {
    const house = frozen();
    const t = addTerminal(house, "tent");
    expect(t.id).toBe("terminal-1");
    const spot = t.house.terminals.find((x) => x.id === t.id)!;
    expect(spot.room).toBe("tent");
    expect(spot.pos[1]).toBeCloseTo(TERMINAL_HEIGHT);
    expect(addTerminal(t.house, "tent").id).toBe("terminal-2");
    const d = addDuckSpot(t.house, "tent");
    expect(d.id).toBe("duck-tent-1");
    expect(roomAt(d.house, [d.house.duck.spots.at(-1)!.pos[0], d.house.duck.spots.at(-1)!.pos[2]], "ground")?.id).toBe("tent");
    expect(validateHouse(d.house).ok).toBe(true);
    expect(addTerminal(house, "nowhere")).toEqual({ house, id: "" });
    expect(uniqueId("x", ["x-1", "x-3"])).toBe("x-2");
  });

  it("removes terminals and duck spots, but never the last duck spot", () => {
    const house = frozen();
    expect(removeThing(house, { kind: "terminal", id: "tent" }).terminals.some((t) => t.id === "tent")).toBe(false);
    const one = { ...house, duck: { spots: [house.duck.spots[0]!] } };
    expect(removeThing(one, { kind: "duck", id: one.duck.spots[0]!.id })).toBe(one);
    expect(removeThing(house, { kind: "spawn" })).toBe(house);
  });

  it("resizes a rectangular room by one edge, keeping its winding and a minimum size", () => {
    const house = frozen();
    const living = house.rooms.find((r) => r.id === "living")!;
    const wider = moveRectEdge(house, "living", "e", 7);
    const poly = wider.rooms.find((r) => r.id === "living")!.poly;
    expect(poly).toEqual(living.poly.map(([x, z]) => [x === 6 ? 7 : x, z]));
    const squashed = moveRectEdge(house, "living", "w", 50);
    expect(rectOf(squashed.rooms.find((r) => r.id === "living")!.poly)).toEqual([6 - MIN_ROOM, 0, 6, 6.5]);
    expect(moveRectEdge(house, "hall", "n", 0)).toBe(house); // not a rectangle
  });

  it("moves a room with what stands in it", () => {
    const house = frozen();
    const next = moveRoom(house, "tent", 0.5, -0.25);
    expect(rectOf(next.rooms.find((r) => r.id === "tent")!.poly)).toEqual([2.5, 18.75, 6.5, 22.75]);
    const t0 = house.terminals.find((t) => t.id === "tent")!.pos;
    expect(next.terminals.find((t) => t.id === "tent")!.pos).toEqual([t0[0] + 0.5, t0[1], t0[2] - 0.25]);
    expect(next.spawn.pos).toEqual([house.spawn.pos[0] + 0.5, house.spawn.pos[1], house.spawn.pos[2] - 0.25]);
    for (const p of house.props.filter((x) => x.room === "tent")) expect(next.props.find((x) => x.id === p.id)!.pos[0]).toBeCloseTo(p.pos[0] + 0.5);
    expect(next.terminals.find((t) => t.id === "kitchen")).toEqual(house.terminals.find((t) => t.id === "kitchen"));
    expect(moveRoom(house, "tent", 0, 0)).toBe(house);
  });

  it("patches terminals and rooms, dropping cleared optional fields", () => {
    const house = frozen();
    const t = patchTerminal(patchTerminal(house, "kitchen", { fov: 90, name: "Kitchen tablet" }), "kitchen", { fov: undefined });
    const screen = patchTerminal(house, "kitchen", { view: "casino", speaks: true });
    expect(screen.terminals.find((x) => x.id === "kitchen")).toMatchObject({ view: "casino", speaks: true });
    expect(house.terminals.find((x) => x.id === "kitchen")!.view).toBeUndefined();
    const back = patchTerminal(screen, "kitchen", { view: "auto", speaks: false }).terminals.find((x) => x.id === "kitchen")!;
    expect("view" in back || "speaks" in back).toBe(false);
    expect("voice" in back).toBe(false);
    const k = t.terminals.find((x) => x.id === "kitchen")!;
    expect(k.name).toBe("Kitchen tablet");
    expect("fov" in k).toBe(false);
    const r = patchRoom(house, "tent", { location: "" }).rooms.find((x) => x.id === "tent")!;
    expect("location" in r).toBe(false);
    expect(patchRoom(house, "nope", { label: "x" })).toBe(house);
  });

  it("keeps an explicit voice off always, an on only where the default is off (S5)", () => {
    const house = frozen();
    const spawnRoom = house.spawn.room;
    const inSpawn = house.terminals.find((x) => x.room === spawnRoom)!;
    const elsewhere = house.terminals.find((x) => x.room !== spawnRoom)!;
    const spot = (h: HouseMap, id: string) => h.terminals.find((x) => x.id === id)!;
    expect("voice" in inSpawn || "voice" in elsewhere).toBe(false);
    // Off elsewhere / on in the spawn room are stored; the defaults are not.
    expect(spot(patchTerminal(house, elsewhere.id, { voice: false }), elsewhere.id).voice).toBe(false);
    expect("voice" in spot(patchTerminal(house, elsewhere.id, { voice: true }), elsewhere.id)).toBe(false);
    expect(spot(patchTerminal(house, inSpawn.id, { voice: true }), inSpawn.id).voice).toBe(true);
    // An explicit off is kept even where it is the default (the tent): ticked
    // on and off again, the tent still says voice: false.
    expect(spot(patchTerminal(house, inSpawn.id, { voice: false }), inSpawn.id).voice).toBe(false);
    const toggled = patchTerminal(patchTerminal(house, inSpawn.id, { voice: true }), inSpawn.id, { voice: false });
    expect(spot(toggled, inSpawn.id).voice).toBe(false);
    // An on back where the default is on drops it; undefined drops it.
    const off = patchTerminal(house, elsewhere.id, { voice: false });
    expect("voice" in spot(patchTerminal(off, elsewhere.id, { voice: true }), elsewhere.id)).toBe(false);
    expect("voice" in spot(patchTerminal(off, elsewhere.id, { voice: undefined }), elsewhere.id)).toBe(false);
    // Another field's patch leaves an explicit flag alone (the show's tent: voice: false in the spawn room).
    const explicit = structuredClone(house);
    spot(explicit, inSpawn.id).voice = false;
    expect(spot(patchTerminal(explicit, inSpawn.id, { name: "Tent tablet" }), inSpawn.id).voice).toBe(false);
    expect(spot(patchTerminal(off, elsewhere.id, { pitch: -5 }), elsewhere.id).voice).toBe(false);
    expect(validateHouse(patchTerminal(house, inSpawn.id, { voice: true })).ok).toBe(true);
    // The problem list warns of a spawn-room terminal with the link on.
    expect(voiceProblems(house)).toEqual([]);
    expect(voiceProblems(patchTerminal(house, inSpawn.id, { voice: true }))).toEqual([expect.objectContaining({ level: "warning", sel: { kind: "terminal", id: inSpawn.id } })]);
  });

  it("sets a height", () => {
    const next = setHeight(frozen(), { kind: "duck", id: "kitchen-counter" }, 0.95);
    expect(positionOf(next, { kind: "duck", id: "kitchen-counter" })![1]).toBe(0.95);
  });

  it("offers a terminal's provisioning link without the passcode", () => {
    const link = provisionLink("http://10.0.0.5:7000", { id: "kitchen" });
    const url = new URL(link);
    expect(url.pathname).toBe("/terminal/");
    expect(url.searchParams.get("spot")).toBe("kitchen");
    // The tablet takes its name, screen and room from the map's entry.
    expect([...url.searchParams.keys()]).toEqual(["spot"]);
  });
});

describe("draftFromText — the JSON tab", () => {
  it("adopts a valid map", () => {
    const r = draftFromText(JSON.stringify(SHOW()));
    expect(r.ok && validateHouse(r.house).ok).toBe(true);
  });

  it("adopts a drawable-but-invalid map (the problems are shown, not hidden)", () => {
    const h = TWO_ROOMS();
    h.doors[0]!.at = [3, 1.5]; // off the wall
    const r = draftFromText(JSON.stringify(h));
    expect(r.ok).toBe(true);
    expect(r.ok && validateHouse(r.house).ok).toBe(false);
  });

  it("fills the optional lists", () => {
    const h = TWO_ROOMS() as Partial<HouseMap>;
    delete h.doors;
    delete h.props;
    const r = draftFromText(JSON.stringify(h));
    expect(r.ok && r.house.doors).toEqual([]);
    expect(r.ok && r.house.props).toEqual([]);
  });

  it("refuses what isn't JSON, or can't be drawn", () => {
    expect(draftFromText("{").ok).toBe(false);
    const bad = draftFromText("{");
    expect(!bad.ok && bad.error).toMatch(/^JSON:/);
    expect(draftFromText("[]").ok).toBe(false);
    const h = TWO_ROOMS() as unknown as { rooms: Array<{ poly: unknown }> };
    h.rooms[1]!.poly = [[0, "x"]];
    const r = draftFromText(JSON.stringify(h));
    expect(!r.ok && r.error).toMatch(/rooms\[1\]/);
    const noSpawn = { ...TWO_ROOMS(), spawn: null };
    expect(draftFromText(JSON.stringify(noSpawn)).ok).toBe(false);
  });
});

describe("the map page following the event's map", () => {
  it("a clean page reloads on any new version — a `hello` after a blip included", () => {
    expect(remoteMapAction("v2", "v1", { saving: false, dirty: false })).toBe("reload");
    // Came up on the bundled stand-in; the server is back.
    expect(remoteMapAction("v2", "bundled", { saving: false, dirty: false })).toBe("reload");
  });

  it("a dirty page warns instead (never overwrites edits); our own save and the same version do nothing", () => {
    expect(remoteMapAction("v2", "v1", { saving: false, dirty: true })).toBe("warn");
    expect(remoteMapAction("v2", "v1", { saving: true, dirty: false })).toBeNull();
    expect(remoteMapAction("v1", "v1", { saving: false, dirty: true })).toBeNull();
    expect(remoteMapAction(null, "v1", { saving: false, dirty: false })).toBeNull();
    // Before the first load: the load will get it.
    expect(remoteMapAction("v1", null, { saving: false, dirty: false })).toBeNull();
  });

  it("the bundled stand-in is read-only (saving it would replace the event's map)", () => {
    expect(editableSource("bundled")).toBe(false);
    expect(editableSource("event")).toBe(true);
    expect(editableSource("show")).toBe(true);
  });
});

describe("saving — never over another director's save", () => {
  it("saveBaseOf: the loaded version, never the bundled stand-in's", () => {
    expect(saveBaseOf({ source: "event", version: "v4" })).toBe("v4");
    expect(saveBaseOf({ source: "show", version: "show-1" })).toBe("show-1");
    expect(saveBaseOf({ source: "bundled", version: "bundled" })).toBeNull();
    expect(saveBaseOf(null)).toBeNull();
  });

  it("the conflict line names a save or a variant switch (B18)", () => {
    expect(conflictText("d59883e0")).toContain("the map changed since you loaded it (a save or a variant switch)");
    expect(conflictText("d59883e0")).toContain(", now vd59883e0.");
    expect(conflictText(null)).not.toContain("now v");
    expect(conflictText(null)).not.toContain("another director");
  });

  it("saveStateOf: ok · conflict (409, with their version) · error (problems)", () => {
    expect(saveStateOf({ ok: true, result: { ok: true, version: "v2", warnings: ["w"] } })).toEqual({ kind: "ok", version: "v2", warnings: ["w"] });
    expect(saveStateOf({ ok: false, status: 409, error: "the map changed — reload", problems: [], conflict: true, version: "v5" })).toEqual({ kind: "conflict", version: "v5" });
    expect(saveStateOf({ ok: false, status: 400, error: "invalid", problems: ["p"], conflict: false, version: null })).toEqual({ kind: "error", error: "invalid", problems: ["p"] });
  });
});
