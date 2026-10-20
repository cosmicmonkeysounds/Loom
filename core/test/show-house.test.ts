//! The show's house map and its rain variant (`house.json` = the Internet in
//! the tent, `house.shed.json` = the Internet in the shed; CHECKLIST
//! SW-MAP-07 / SW-MAP-13). Both follow the floor plan the user drew in
//! /reinstall/map (wave 14), and their *structure* must match the story: every LOCATION has
//! a room, the tent (or shed) is out in the yard, the Server Room is behind
//! a door in the basement with no duck in it, and every duck spot is
//! walkable from the spawn — on either variant, with the same terminal ids
//! (the tablets are provisioned with `spot=<id>`).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { locate, pickDuckSpot, route, validateHouse, type HouseMap, type Room, type Vec2 } from "@loom/house";
import { houseWarnings } from "../server/spatial.ts";
import { Sim } from "../src/runtime/sim/index.ts";
import { scenarioSource } from "../examples/load.ts";

const file = (name: string): string =>
  fileURLToPath(new URL(`../examples/trapped-in-the-internet/${name}`, import.meta.url));

const load = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(file(name), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(`${name}: ${v.problems.join("\n")}`);
  return v.house;
};

const VARIANTS = { tent: load("house.json"), shed: load("house.shed.json") };
const LOCATIONS = [...Sim.fromSources(scenarioSource("trapped-in-the-internet")).model.locations.keys()];

/** How near the duck a player must stand to find it, on the plan — the web
 *  game's `REACH` (`reinstall/web/src/game/hud.ts`) and the headset's
 *  `Duck.FIND_RADIUS` (`reinstall/vr/game/duck.gd`). Neither checks walls. */
const REACH = 0.9;
/** The nearest a player's feet get to a wall line: the body's radius
 *  (`reinstall/web/src/game/physics.ts` `RADIUS`) plus half the wall. */
const CLEARANCE = (house: HouseMap) => 0.25 + (house.style?.wallThickness ?? 0.12) / 2;
/** A dealt duck should be a walk, not a doorstep (CHECKLIST SW-MAP-07). */
const MIN_WALK = 10;

/** Plan distance from `p` to the nearest edge of `poly`. */
const edgeDistance = (poly: Vec2[], p: Vec2): number => {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[(i + 1) % poly.length]!;
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - az) * (bz - az)) / len2));
    best = Math.min(best, Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (az + t * (bz - az))));
  }
  return best;
};

/** The one room bound to `location`. */
const roomFor = (house: HouseMap, location: string): Room => {
  const rooms = house.rooms.filter((r) => r.location === location);
  expect(rooms.map((r) => r.id), location).toHaveLength(1);
  return rooms[0]!;
};

describe.each(Object.entries(VARIANTS))("the show's house map (%s)", (variant, house) => {
  it("validates, and every room is a LOCATION the story declares", () => {
    expect(validateHouse(JSON.parse(readFileSync(file(variant === "tent" ? "house.json" : "house.shed.json"), "utf8"))).problems).toEqual([]);
    expect(house.name).not.toMatch(/PLACEHOLDER/); // measured (wave 14)
    expect(houseWarnings(house, (name) => LOCATIONS.includes(name))).toEqual([]);
    // Every LOCATION has geometry, the Server Room included.
    expect([...new Set(house.rooms.map((r) => r.location))].sort()).toEqual([...LOCATIONS].sort());
  });

  it(`puts the Internet in the ${variant}, out in the backyard`, () => {
    const inet = roomFor(house, "The Internet");
    const yard = roomFor(house, "The Cloud");
    expect(inet.id).toBe(variant);
    expect(inet.outdoor ?? false).toBe(false); // it has a roof
    expect(yard.outdoor).toBe(true);
    expect(inet.floor).toBe(yard.floor);
    // Its only door opens onto the yard.
    const doors = house.doors.filter((d) => d.a === inet.id || d.b === inet.id);
    expect(doors.map((d) => [d.a, d.b].sort())).toEqual([[inet.id, yard.id].sort()]);
    // The spawn, the station mats and the `tent` terminal are all in it.
    expect(house.spawn.room).toBe(inet.id);
    expect(locate(house, house.spawn.pos).room).toBe(inet.id);
    expect(house.terminals.find((t) => t.id === "tent")?.room).toBe(inet.id);
    for (const id of ["vr-station-1", "vr-station-2", "tablet-stand", "tablet"]) {
      expect(house.props.find((p) => p.id === id)?.room, id).toBe(inet.id);
    }
  });

  it("puts the Server Room behind a door in the basement, with its patch bay, lock ring and the King guarding its door", () => {
    const server = roomFor(house, "The Server Room");
    expect(server.floor).toBe("basement");
    const doors = house.doors.filter((d) => d.a === server.id || d.b === server.id);
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    const outside = door.a === server.id ? door.b : door.a;
    expect(outside).not.toBeNull();
    expect(house.props.find((p) => p.id === "patch-bay")?.room).toBe(server.id);
    // The lock ring hangs outside its door. There is no chess phone any more: the chess game is
    // only on the Server Door terminal (the `server-room-door` spot), so no `chess-phone` prop.
    expect(house.props.find((p) => p.id === "lock-ring")?.room).toBe(outside);
    expect(house.props.find((p) => p.id === "chess-phone")).toBeUndefined();
    expect(house.duck.spots.filter((s) => s.room === server.id)).toEqual([]);
    // The King: a `king` prop in the doorway, in the hall, with one shared 15-HP bar for the night
    // in `Night.king_hp`. The reinstallation games hit him and the server judges each hit (C2). He
    // is checkmated only at the Server Door terminal, which posts `chess won`, and a checkmate
    // counts while `Night.king_armed` ≥ 1. Once he falls his guarded door opens for everyone.
    expect(door.guard).toBe("cold-lock-king");
    const king = house.props.find((p) => p.id === "cold-lock-king");
    // One shared bar for the night (C1): 15 HP in Night.king_hp, a checkmate counting while Night.king_armed.
    expect(king).toMatchObject({
      kind: "king",
      room: outside,
      hp: 15,
      health: "Night.king_hp",
      signals: { won: "chess won", lost: "chess lost", drawn: "chess drawn", hit: "king hit", fallen: "king fallen" },
      armed: { path: "Night.king_armed", min: 1 },
    });
    expect(Math.hypot(king!.pos[0] - door.at[0], king!.pos[2] - door.at[1])).toBeLessThan(0.5);
    // Nothing routes through a guarded door: the Server Room is unreachable for the golden trail…
    expect(route(house, house.spawn.pos, [4.8, -2.7, 24.5])).toHaveLength(2);
    // …until he falls: then his door is open for everyone.
    expect(route(house, house.spawn.pos, [4.8, -2.7, 24.5], { fallen: new Set(["cold-lock-king"]) }).length).toBeGreaterThan(2);
    // The Server Door terminal hangs in the hall, looking at him.
    expect(house.terminals.find((t) => t.id === "server-room-door")).toMatchObject({ name: "Server Door", room: outside });
  });

  it("stacks the real house's three levels, each room on its own floor, joined by the basement stairs up into the kitchen and the hall's upstairs", () => {
    expect(house.floors.map((f) => [f.id, f.elevation])).toEqual([
      ["basement", -2.7],
      ["main", 0],
      ["top", 2.8],
    ]);
    const on = (floor: string) =>
      house.rooms
        .filter((r) => r.floor === floor && r.location !== "The Tube")
        .map((r) => r.location!)
        .sort();
    // The user's floor plan (2026-10-15); both bathrooms are Disk Cleanup.
    expect(on("basement")).toEqual(["Disk Cleanup", "The Fan Closet", "The RAM", "The Server Room"]);
    expect(on("main").filter((l) => l !== "The Cloud" && l !== "The Internet")).toEqual(
      ["The CPU", "The Desktop", "The Optical Drive", "The Start Bar", "The Steam Room"],
    );
    expect(on("top")).toEqual(["Disk Cleanup", "The Graphics Card", "The Hard Drive"]);
    expect(house.stairs.map((s) => [s.from, s.to])).toEqual([
      ["basement-hall", "start-bar"],
      ["hall", "upstairs-hall"],
    ]);
  });

  it("puts the Truth Pong folding table in the backyard", () => {
    const table = house.props.find((p) => p.id === "truth-pong");
    expect(table?.room).toBe(roomFor(house, "The Cloud").id);
    expect(table?.size).toEqual([1.83, 0.76, 0.76]);
  });

  it("maps the Tube: front door → the mud room → the living room → the hall, and out the back door to the yard", () => {
    expect(house.rooms.filter((r) => r.location === "The Tube").map((r) => [r.id, r.floor])).toEqual([
      ["hall", "main"],
      ["basement-hall", "basement"],
      ["upstairs-hall", "top"],
    ]);
    expect(house.doors.find((d) => d.id === "front")).toMatchObject({ a: "optical-drive", b: null });
    expect(house.doors.find((d) => d.id === "mud-living")).toMatchObject({ a: "optical-drive", b: "desktop" });
    expect(house.doors.find((d) => d.id === "hall-living")).toMatchObject({ a: "hall", b: "desktop" });
    expect(house.doors.find((d) => d.id === "hall-back")).toMatchObject({ a: "hall", b: "backyard" });
    // The LED run marks the way on: down the hall and across the yard.
    expect(house.props.find((p) => p.id === "tube-hall")?.room).toBe("hall");
    expect(house.props.find((p) => p.id === "tube-yard")?.room).toBe("backyard");
  });

  it("hides 8–12 ducks on every floor and in the yard, none in the spawn room or the Server Room, each walkable from the spawn", () => {
    const spots = house.duck.spots;
    expect(spots.length).toBeGreaterThanOrEqual(8);
    expect(spots.length).toBeLessThanOrEqual(12);
    const floorOf = (room: string) => house.rooms.find((r) => r.id === room)!.floor;
    expect([...new Set(spots.map((s) => floorOf(s.room)))].sort()).toEqual([...house.floors.map((f) => f.id)].sort());
    expect(spots.some((s) => s.room === roomFor(house, "The Cloud").id), "a duck in the yard").toBe(true);
    const server = roomFor(house, "The Server Room").id;
    for (const s of spots) {
      expect(s.room, s.id).not.toBe(house.spawn.room);
      expect(s.room, s.id).not.toBe(server);
      expect(locate(house, s.pos).room, s.id).toBe(s.room);
      // A route that found no way is just [from, to]; every spot is in another room.
      const path = route(house, house.spawn.pos, s.pos);
      expect(path.length, s.id).toBeGreaterThan(2);
      expect(path[path.length - 1], s.id).toEqual(s.pos);
    }
    for (let i = 0; i < 50; i++) expect(pickDuckSpot(house, `session-${i}`).room).not.toBe(house.spawn.room);
  });

  it(`deals every duck at least ${MIN_WALK} m of walking from the spawn`, () => {
    for (const s of house.duck.spots) {
      const path = route(house, house.spawn.pos, s.pos);
      let walk = 0;
      for (let i = 1; i < path.length; i++) walk += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![2] - path[i - 1]![2]);
      expect(walk, s.id).toBeGreaterThanOrEqual(MIN_WALK);
    }
  });

  it("never lets a duck be found through a wall from the next room", () => {
    // The find is plan distance + floor only, so a duck within REACH of a
    // wall can be picked up from the room behind it. Sample everywhere a
    // player's feet can stand within REACH and insist it is the duck's room.
    const step = 0.05;
    const leaks = new Set<string>();
    for (const s of house.duck.spots) {
      const own = house.rooms.find((r) => r.id === s.room)!;
      const feet = house.floors.find((f) => f.id === own.floor)!.elevation;
      for (let dx = -REACH; dx <= REACH; dx += step) {
        for (let dz = -REACH; dz <= REACH; dz += step) {
          if (Math.hypot(dx, dz) > REACH) continue;
          const p: Vec2 = [s.pos[0] + dx, s.pos[2] + dz];
          if (edgeDistance(own.poly, p) < CLEARANCE(house)) continue; // against the wall line: no feet fit
          const at = locate(house, [p[0], feet, p[1]]);
          if (at.room !== null && at.room !== s.room && at.floor === own.floor) leaks.add(`${s.id} from ${at.room}`);
        }
      }
    }
    expect([...leaks]).toEqual([]);
  });
});

describe("the two variants", () => {
  const { tent, shed } = VARIANTS;

  it("share the terminal ids, the duck spots and the LOCATIONs", () => {
    const ids = (h: HouseMap) => h.terminals.map((t) => t.id).sort();
    expect(ids(tent)).toEqual([
      "backyard", "bathroom-1-door", "cpu", "desktop-tv", "graphics-card", "hall", "optical-drive", "ram", "server-room",
      "server-room-door", "start-bar", "steam-room", "tent", "upstairs-hall",
    ]);
    expect(ids(shed)).toEqual(ids(tent));
    expect(shed.duck.spots).toEqual(tent.duck.spots);
    const locations = (h: HouseMap) => h.rooms.map((r) => r.location).sort();
    expect(locations(shed)).toEqual(locations(tent));
  });

  it("hang the server-room terminal in The Server Room on both variants (wave 7: room=The Server Room)", () => {
    for (const h of [tent, shed]) {
      const t = h.terminals.find((x) => x.id === "server-room");
      expect(t, h.variant ?? "map").toMatchObject({ name: "Server Room", room: "server-room", pos: [3.9, -1.3, 26], yaw: 0 });
      expect(h.rooms.find((r) => r.id === t!.room)?.location).toBe("The Server Room");
    }
  });

  it("differ only where the Internet is", () => {
    const moved = new Set(["tent", "shed", "backyard"]);
    const keep = (h: HouseMap) => h.rooms.filter((r) => !moved.has(r.id));
    expect(keep(shed)).toEqual(keep(tent));
    const fixed = (h: HouseMap) => h.terminals.filter((t) => t.id !== "tent");
    expect(fixed(shed)).toEqual(fixed(tent));
    const doors = (h: HouseMap) => h.doors.filter((d) => d.a !== "tent" && d.a !== "shed");
    expect(doors(shed)).toEqual(doors(tent));
    expect(shed.stairs).toEqual(tent.stairs);
    expect(shed.floors).toEqual(tent.floors);
    // The tent's corner of the yard is lawn again; the shed is a room, not a prop.
    expect(shed.rooms.some((r) => r.id === "tent")).toBe(false);
    expect(shed.props.some((p) => p.id === "shed")).toBe(false);
    expect(tent.props.find((p) => p.id === "shed")?.room).toBe("backyard");
  });
});
