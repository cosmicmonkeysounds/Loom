//! Gerald can be seen (wave 59): at every spot of both show maps, clean and at
//! the deepest level, from the floor around him, and on the way to him his
//! floor is never hidden. The VR half of this is `game.gd`'s next-walk check.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Raycaster, Vector3 } from "three";
import type { Material, Mesh } from "three";
import { describe, expect, it } from "vitest";

import { buildWalls, DESCENT_MAX, heightAt, hiddenFloors, locate, presenceRoom, route, spaceOf, standable, toSpace, validateHouse } from "@loom/house";
import type { HouseMap, Vec3 } from "@loom/house";
import { buildHouseScene, GAME_TERMINAL_SCALE, spaceGroup } from "@loom/house/three";

import { buriedDucks, walkabilityProblems } from "../src/map/check.ts";

const show = (name: string): HouseMap => {
  const v = validateHouse(JSON.parse(readFileSync(fileURLToPath(new URL(`../../../core/examples/trapped-in-the-internet/${name}.json`, import.meta.url)), "utf8")));
  if (!v.ok || v.house === undefined) throw new Error(v.problems.join("\n"));
  return v.house;
};

/** Of the floor points around a spot, in its room, how many have a clear line from the eye to him. */
function sight(house: HouseMap, level: number): Array<{ id: string; points: number; clear: number }> {
  const root = spaceGroup(spaceOf(house, "web"));
  const scene = buildHouseScene(house, { walls: buildWalls(house), ground: true, pickups: true, terminalScale: GAME_TERMINAL_SCALE, neon: true, descent: level });
  root.add(scene.root);
  root.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh === true && (m.material as Material).transparent !== true) meshes.push(m);
  });
  const space = spaceOf(house, "web");
  const ray = new Raycaster();
  return house.duck.spots.map((s) => {
    const [x, y, z] = s.pos;
    const him = new Vector3(...toSpace(space, [x, y + 0.25, z]));
    let points = 0;
    let clear = 0;
    for (const r of [0.8, 1.2, 1.8, 2.5]) {
      for (let a = 0; a < 16; a++) {
        const plan: [number, number] = [x + Math.cos((a * Math.PI) / 8) * r, z + Math.sin((a * Math.PI) / 8) * r];
        const h = heightAt(house, plan, y);
        if (h === null) continue;
        const feet: Vec3 = [plan[0], h, plan[1]];
        if (!standable(house, feet) || locate(house, feet).room !== s.room) continue;
        points += 1;
        const eye = new Vector3(...toSpace(space, [plan[0], h + 1.6, plan[1]]));
        const to = him.clone().sub(eye);
        ray.set(eye, to.clone().normalize());
        ray.far = to.length() - 0.3;
        if (ray.intersectObjects(meshes, false).length === 0) clear += 1;
      }
    }
    return { id: s.id, points, clear };
  });
}

describe("Gerald can be seen", () => {
  for (const name of ["house", "house.shed"]) {
    for (const level of [0, DESCENT_MAX]) {
      it(`${name}, level ${level}: from most of the floor around every spot`, () => {
        for (const s of sight(show(name), level)) {
          expect(s.points, s.id).toBeGreaterThan(10);
          expect(s.clear / s.points, s.id).toBeGreaterThan(0.75);
        }
      });
    }

    it(`${name}: no prop stands over him`, () => {
      expect(buriedDucks(show(name))).toEqual([]);
    });

    it(`${name}: his floor is never hidden on the last of the way to him`, () => {
      const house = show(name);
      for (const s of house.duck.spots) {
        const way = route(house, house.spawn.pos, s.pos);
        let room: string | null = null;
        for (let i = 1; i < way.length; i++) {
          const [a, b] = [way[i - 1]!, way[i]!];
          const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 0.1));
          for (let k = 0; k <= steps; k++) {
            const t = k / steps;
            const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
            room = presenceRoom(house, p, room);
            const near = Math.hypot(p[0] - s.pos[0], p[2] - s.pos[2]) < 4 && Math.abs(p[1] - s.pos[1]) < 1.5;
            if (near) expect(hiddenFloors(house, room), `${s.id} at ${p.join(",")}`).not.toContain(locate(house, s.pos).floor);
          }
        }
      }
    });
  }

  it("the map's Check warns of a spot with a prop drawn over him", () => {
    const house = show("house");
    const s = house.duck.spots[0]!;
    const over = { id: "over-him", room: s.room, kind: "box" as const, pos: [s.pos[0], s.pos[1], s.pos[2]] as Vec3, size: [0.8, 1, 0.8] as Vec3, color: "#000000", solid: false };
    const map = { ...house, props: [...house.props, over] };
    expect(buriedDucks(map)).toEqual([{ duck: s.id, prop: "over-him" }]);
    expect(walkabilityProblems(map).some((p) => p.text.includes(`duck spot "${s.id}"`) && p.text.includes("over-him"))).toBe(true);
    // Resting on a prop's top is what a spot on a desk is.
    expect(buriedDucks({ ...house, props: [...house.props, { ...over, pos: [s.pos[0], s.pos[1] - 1, s.pos[2]] as Vec3 }] })).toEqual([]);
  });
});
