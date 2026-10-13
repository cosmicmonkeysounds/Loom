import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forward, heightAt, inPropFootprint, locate, pickDuckSpot, propSolid, roomById, route, validateHouse } from "../src/index.ts";
import type { HouseMap, Vec2, Vec3 } from "../src/index.ts";
import { ROOT, SHOW_HOUSE, loadHouse, samplePoint } from "./golden.ts";

/** The show's house map (core/examples/trapped-in-the-internet/house.json). */
describe("the show's house map", () => {
  const house: HouseMap = loadHouse(SHOW_HOUSE);

  it("validates with zero problems", () => {
    expect(validateHouse(JSON.parse(readFileSync(SHOW_HOUSE, "utf8"))).problems).toEqual([]);
  });

  it("names only LOCATIONs the story declares", () => {
    const main = readFileSync(join(ROOT, "..", "core", "examples", "trapped-in-the-internet", "main.loom"), "utf8");
    const declared = new Set([...main.matchAll(/^LOCATION (.+)$/gm)].map((m) => m[1]!.trim()));
    for (const room of house.rooms) {
      expect(room.location, room.id).toBeDefined();
      expect(declared.has(room.location!), `${room.id}: ${room.location}`).toBe(true);
    }
  });

  it("reaches every room from the spawn", () => {
    for (const room of house.rooms) {
      const [x, z] = samplePoint(house, room);
      const y = house.floors.find((f) => f.id === room.floor)!.elevation;
      const to: Vec3 = [x, y, z];
      expect(locate(house, to).room).toBe(room.id);
      const path = route(house, house.spawn.pos, to);
      if (room.id === house.spawn.room) expect(path).toHaveLength(2);
      else expect(path.length, room.id).toBeGreaterThan(2);
    }
  });

  it("puts every terminal on a wall, facing into its room", () => {
    for (const t of house.terminals) {
      const f = forward(t.yaw);
      const ahead: Vec3 = [t.pos[0] + f[0] * 0.5, t.pos[1], t.pos[2] + f[2] * 0.5];
      const behind: Vec3 = [t.pos[0] - f[0] * 0.5, t.pos[1], t.pos[2] - f[2] * 0.5];
      expect(locate(house, ahead).room, `${t.id} faces into its room`).toBe(t.room);
      expect(locate(house, behind).room, `${t.id} hangs on a wall`).not.toBe(t.room);
    }
    expect(house.terminals.map((t) => t.id).sort()).toEqual(
      ["bathroom", "desktop-tv", "hall", "kitchen", "mudroom", "registry", "tent"].sort(),
    );
  });

  it("gives every terminal's mount camera a clear half metre ahead", () => {
    // The terminal's mount shot (terminal/src/world/director.ts mountCamera):
    // the camera stands 0.15 m in front of the screen, looking along its yaw.
    // No solid prop spanning the camera's height may sit within 0.5 m ahead.
    for (const t of house.terminals) {
      const f = forward(t.yaw);
      const cam: Vec3 = [t.pos[0] + f[0] * 0.15, t.pos[1], t.pos[2] + f[2] * 0.15];
      for (let k = 0; k <= 50; k++) {
        const q: Vec2 = [cam[0] + f[0] * (k / 100), cam[2] + f[2] * (k / 100)];
        const hit = house.props.find(
          (p) => propSolid(p) && p.pos[1] <= cam[1] && cam[1] <= p.pos[1] + p.size[1] && inPropFootprint(p, q),
        );
        expect(hit?.id, `${t.id}: ${k} cm ahead of the camera`).toBeUndefined();
      }
    }
  });

  it("hides the duck in every room but the tent, on something to stand on", () => {
    const rooms = new Set(house.duck.spots.map((s) => s.room));
    for (const room of house.rooms) expect(rooms.has(room.id), room.id).toBe(room.id !== "tent");
    for (const s of house.duck.spots) {
      expect(locate(house, s.pos).room, s.id).toBe(s.room);
      expect(heightAt(house, [s.pos[0], s.pos[2]], s.pos[1]), s.id).not.toBeNull();
    }
    expect(house.spawn.room).toBe("tent");
    expect(roomById(house, "tent")?.location).toBe("The Internet");
    // Never the spawn room.
    for (let i = 0; i < 50; i++) expect(pickDuckSpot(house, `session-${i}`).room).not.toBe("tent");
  });

  it("climbs the basement stairs into the hall", () => {
    const mm3 = (p: Vec3): Vec3 => p.map((v) => Math.round(v * 1000) / 1000 + 0) as Vec3;
    expect(route(house, house.spawn.pos, [-0.5, 0, 6]).map(mm3)).toEqual([
      house.spawn.pos,
      [1.5, -2.7, 4.5], // the tent flap
      [-1.5, -2.7, 9], // landing ⇄ rec room
      [-2.55, -2.7, 11.35], // round the ramp's south-east corner
      [-3.4, -2.7, 11], // the stair's foot
      [-3.4, 0, 7], // its head, in the hall
      [-0.5, 0, 6],
    ]);
  });
});
