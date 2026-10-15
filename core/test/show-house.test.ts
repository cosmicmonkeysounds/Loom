//! The show's house map and its rain variant (`house.json` = the Internet in
//! the tent, `house.shed.json` = the Internet in the shed; CHECKLIST
//! SW-MAP-07 / SW-MAP-13). Both are placeholders until the house is
//! surveyed, but their *structure* must match the story: every LOCATION has
//! a room, the tent (or shed) is out in the yard, the Server Room is behind
//! a door in the basement with no duck in it, and every duck spot is
//! walkable from the spawn — on either variant, with the same terminal ids
//! (the tablets are provisioned with `spot=<id>`).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { locate, pickDuckSpot, route, validateHouse, type HouseMap, type Room } from "@loom/house";
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

/** The one room bound to `location`. */
const roomFor = (house: HouseMap, location: string): Room => {
  const rooms = house.rooms.filter((r) => r.location === location);
  expect(rooms.map((r) => r.id), location).toHaveLength(1);
  return rooms[0]!;
};

describe.each(Object.entries(VARIANTS))("the show's house map (%s)", (variant, house) => {
  it("validates, and every room is a LOCATION the story declares", () => {
    expect(validateHouse(JSON.parse(readFileSync(file(variant === "tent" ? "house.json" : "house.shed.json"), "utf8"))).problems).toEqual([]);
    expect(house.name).toMatch(/PLACEHOLDER/);
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

  it("puts the Server Room behind a door in the basement, with its patch bay, lock ring and chess phone", () => {
    const server = roomFor(house, "The Server Room");
    expect(server.floor).toBe("basement");
    const doors = house.doors.filter((d) => d.a === server.id || d.b === server.id);
    expect(doors).toHaveLength(1);
    const outside = doors[0]!.a === server.id ? doors[0]!.b : doors[0]!.a;
    expect(outside).not.toBeNull();
    expect(house.props.find((p) => p.id === "patch-bay")?.room).toBe(server.id);
    // The lock ring and the chess phone hang outside its door (HW-CHESS-01).
    for (const id of ["lock-ring", "chess-phone"]) expect(house.props.find((p) => p.id === id)?.room, id).toBe(outside);
    expect(house.duck.spots.filter((s) => s.room === server.id)).toEqual([]);
  });

  it("puts the Truth Pong folding table in the backyard", () => {
    const table = house.props.find((p) => p.id === "truth-pong");
    expect(table?.room).toBe(roomFor(house, "The Cloud").id);
    expect(table?.size).toEqual([1.83, 0.76, 0.76]);
  });

  it("maps the Tube: front door → the hall → the living room, and out the back door to the yard", () => {
    expect(house.rooms.filter((r) => r.location === "The Tube").map((r) => r.id)).toEqual(["hall", "landing"]);
    expect(house.doors.find((d) => d.id === "mud-hall")).toMatchObject({ a: "mudroom", b: "hall" });
    expect(house.doors.find((d) => d.id === "hall-living")).toMatchObject({ a: "hall", b: "living" });
    expect(house.doors.find((d) => d.id === "hall-back")).toMatchObject({ a: "hall", b: "backyard" });
    // The LED run marks the way on: down the hall and across the yard.
    expect(house.props.find((p) => p.id === "tube-hall")?.room).toBe("hall");
    expect(house.props.find((p) => p.id === "tube-yard")?.room).toBe("backyard");
  });

  it("hides 6–10 ducks, none in the spawn room or the Server Room, each walkable from the spawn", () => {
    const spots = house.duck.spots;
    expect(spots.length).toBeGreaterThanOrEqual(6);
    expect(spots.length).toBeLessThanOrEqual(10);
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
});

describe("the two variants", () => {
  const { tent, shed } = VARIANTS;

  it("share the terminal ids, the duck spots and the LOCATIONs", () => {
    const ids = (h: HouseMap) => h.terminals.map((t) => t.id).sort();
    expect(ids(tent)).toEqual(["bathroom", "desktop-tv", "hall", "kitchen", "mudroom", "registry", "tent"]);
    expect(ids(shed)).toEqual(ids(tent));
    expect(shed.duck.spots).toEqual(tent.duck.spots);
    const locations = (h: HouseMap) => h.rooms.map((r) => r.location).sort();
    expect(locations(shed)).toEqual(locations(tent));
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
