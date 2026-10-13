// The three.js builders, constructed under node: no WebGL, no canvas (so no
// textures and no labels — `hasDom()` is false here). Nothing renders; the
// tests read the scene graph.

import { describe, expect, it } from "vitest";
import { BufferGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Object3D, Vector3 } from "three";
import type { Material } from "three";
import { buildRamps, buildWalls, forward, roomById, route, toSpace } from "../src/index.ts";
import type { SpaceTransform, Vec3 } from "../src/index.ts";
import {
  buildHouseScene,
  createAvatar,
  createDuck,
  createTrail,
  hasDom,
  planeGeometry,
  rampGeometry,
  spaceGroup,
  DUCK_FLIGHT,
} from "../src/three/index.ts";
import { buildFloors } from "../src/index.ts";
import { fixture, loadHouse, SHOW_HOUSE } from "./golden.ts";

const show = loadHouse(SHOW_HOUSE);

function meshes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

function geometries(root: Object3D): Set<BufferGeometry> {
  const out = new Set<BufferGeometry>();
  root.traverse((o) => {
    const g = (o as Mesh).geometry;
    if (g) out.add(g);
  });
  return out;
}

describe("buildHouseScene (the show's map, headless)", () => {
  it("runs without a DOM", () => {
    expect(hasDom()).toBe(false);
  });

  it("one wall box per buildWalls segment, grouped by floor and kind", () => {
    const scene = buildHouseScene(show, { labels: false });
    const walls = buildWalls(show);
    expect(scene.walls).toEqual(walls);
    let segments = 0;
    let vertices = 0;
    for (const [floorId, group] of scene.floors) {
      for (const child of group.children) {
        const segs = child.userData.segments as typeof walls | undefined;
        if (!segs) continue;
        expect(segs.every((s) => s.floor === floorId && s.kind === child.userData.kind)).toBe(true);
        segments += segs.length;
        vertices += (child as Mesh).geometry.getAttribute("position").count;
      }
    }
    expect(segments).toBe(walls.length);
    expect(vertices).toBe(walls.length * 24); // a BoxGeometry has 24 vertices
    scene.dispose();
  });

  it("every floor has a group; every terminal a screen facing its yaw", () => {
    const scene = buildHouseScene(show, { labels: false });
    expect([...scene.floors.keys()]).toEqual(show.floors.map((f) => f.id));
    expect(scene.terminals.size).toBe(show.terminals.length);
    for (const spot of show.terminals) {
      const t = scene.terminals.get(spot.id)!;
      expect(t).toBeDefined();
      const floor = roomById(show, spot.room)!.floor;
      expect(t.parent).toBe(scene.floors.get(floor));
      expect(t.getObjectByName("panel")).toBeDefined();
      // The panel's normal (local −z) points along forward(yaw, pitch), into the room.
      t.updateMatrixWorld(true);
      const n = new Vector3(0, 0, -1).transformDirection(t.matrixWorld);
      const f = forward(spot.yaw, spot.pitch ?? 0);
      expect(n.x).toBeCloseTo(f[0]);
      expect(n.y).toBeCloseTo(f[1]);
      expect(n.z).toBeCloseTo(f[2]);
      // It stands a little proud of the wall, not inside it.
      const d = t.position.clone().sub(new Vector3(...spot.pos));
      expect(d.length()).toBeGreaterThan(0.05);
      expect(d.length()).toBeLessThan(0.15);
    }
    scene.dispose();
  });

  it("floors face up and ceilings face down at their elevations", () => {
    const scene = buildHouseScene(show, { labels: false });
    for (const f of show.floors) {
      const group = scene.floors.get(f.id)!;
      const floor = group.getObjectByName(`floors:${f.id}`) as Mesh;
      const normals = floor.geometry.getAttribute("normal");
      for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeGreaterThan(0);
      const ceiling = scene.ceilings.get(f.id)!;
      const cn = ceiling.geometry.getAttribute("normal");
      for (let i = 0; i < cn.count; i++) expect(cn.getY(i)).toBeCloseTo(-1);
    }
    scene.dispose();
  });

  it("ramps are their own double-sided mesh on the lower floor (visible from underneath)", () => {
    const scene = buildHouseScene(show, { labels: false });
    const ramp = scene.floors.get("basement")!.getObjectByName("ramps:basement") as Mesh;
    expect(ramp).toBeDefined();
    expect((ramp.material as Material).side).toBe(DoubleSide);
    expect(scene.floors.get("ground")!.getObjectByName("ramps:ground")).toBeUndefined();
    scene.dispose();
  });

  it("dispose frees every geometry and material and detaches the root", () => {
    const parent = new Group();
    const scene = buildHouseScene(show, { labels: false });
    parent.add(scene.root);
    const geoms = geometries(scene.root);
    const mats = new Set<Material>();
    for (const m of meshes(scene.root)) mats.add(m.material as Material);
    const freed = new Set<object>();
    for (const g of geoms) g.addEventListener("dispose", () => freed.add(g));
    for (const m of mats) m.addEventListener("dispose", () => freed.add(m));
    expect(geoms.size).toBeGreaterThan(5);
    scene.dispose();
    for (const g of geoms) expect(freed.has(g)).toBe(true);
    for (const m of mats) expect(freed.has(m)).toBe(true);
    expect(scene.root.parent).toBeNull();
    scene.dispose(); // idempotent
  });

  it("keeps draw calls low (merged per material)", () => {
    const scene = buildHouseScene(show, { labels: false });
    const terminalMeshes = show.terminals.length * 4;
    // walls/lintels/fences/rails + edges + floors + ceilings + props + screens, per floor.
    expect(meshes(scene.root).length - terminalMeshes).toBeLessThanOrEqual(show.floors.length * 9);
    scene.dispose();
  });

  it("options drop parts; update animates without throwing", () => {
    const scene = buildHouseScene(show, { labels: false, ceilings: false, terminals: false, lights: false, edges: false });
    expect(scene.ceilings.size).toBe(0);
    expect(scene.terminals.size).toBe(0);
    expect(scene.labels.size).toBe(0);
    let lines = 0;
    scene.root.traverse((o) => {
      if ((o as { isLineSegments?: boolean }).isLineSegments) lines++;
    });
    expect(lines).toBe(0);
    scene.update(0.016);
    scene.dispose();
  });

  it("builds every fixture", () => {
    for (const name of ["two-rooms", "l-room", "yard", "stair", "tie"]) {
      const house = fixture(name);
      const scene = buildHouseScene(house, { labels: false });
      expect(scene.walls.length).toBe(buildWalls(house).length);
      scene.update(0.1);
      scene.dispose();
    }
  });
});

describe("planeGeometry / rampGeometry", () => {
  it("maps plan [x, z] onto world (x, y, z) without flipping z", () => {
    const house = fixture("two-rooms");
    for (const plane of buildFloors(house)) {
      const g = planeGeometry(plane);
      g.computeBoundingBox();
      const xs = plane.poly.map((p) => p[0]);
      const zs = plane.poly.map((p) => p[1]);
      expect(g.boundingBox!.min.x).toBeCloseTo(Math.min(...xs));
      expect(g.boundingBox!.max.x).toBeCloseTo(Math.max(...xs));
      expect(g.boundingBox!.min.z).toBeCloseTo(Math.min(...zs));
      expect(g.boundingBox!.max.z).toBeCloseTo(Math.max(...zs));
      expect(g.boundingBox!.min.y).toBeCloseTo(plane.y);
      expect(g.boundingBox!.max.y).toBeCloseTo(plane.y);
      g.dispose();
    }
  });

  it("a ramp faces up and spans its corners", () => {
    const house = fixture("stair");
    for (const ramp of buildRamps(house)) {
      const g = rampGeometry(ramp);
      const n = g.getAttribute("normal");
      for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0);
      g.computeBoundingBox();
      expect(g.boundingBox!.min.y).toBeCloseTo(ramp.low);
      expect(g.boundingBox!.max.y).toBeCloseTo(ramp.high);
      g.dispose();
    }
  });
});

describe("createDuck", () => {
  it("bobs and turns while idle", () => {
    const duck = createDuck();
    const bird = duck.object.getObjectByName("duck:bird")!;
    const ys = new Set<number>();
    for (let i = 0; i < 20; i++) {
      duck.update(0.1);
      ys.add(+bird.position.y.toFixed(4));
    }
    expect(ys.size).toBeGreaterThan(5);
    expect(bird.rotation.y).toBeCloseTo(0.7);
    expect(duck.state).toBe("idle");
    duck.dispose();
  });

  it("layEgg resolves after the flight on a fake clock; the egg stays, the duck is gone", async () => {
    const duck = createDuck();
    const bird = duck.object.getObjectByName("duck:bird")!;
    const egg = duck.object.getObjectByName("duck:egg")!;
    let done = false;
    const p = duck.layEgg().then(() => (done = true));
    expect(duck.layEgg()).toBe(duck.layEgg()); // the same promise
    let t = 0;
    const tick = async (dt: number) => {
      duck.update(dt);
      t += dt;
      await Promise.resolve();
    };
    while (t < DUCK_FLIGHT - 0.2) await tick(0.1);
    expect(done).toBe(false);
    expect(egg.visible).toBe(true);
    expect(egg.position.y).toBeLessThan(0.1); // on the floor
    expect(bird.position.y).toBeGreaterThan(1); // up and away
    for (let i = 0; i < 5; i++) await tick(0.1);
    await p;
    expect(done).toBe(true);
    expect(duck.state).toBe("gone");
    expect(bird.visible).toBe(false);
    duck.reset();
    expect(duck.state).toBe("idle");
    expect(bird.visible).toBe(true);
    expect(egg.visible).toBe(false);
    duck.dispose();
  });

  it("dispose settles a pending egg and frees its geometries", async () => {
    const duck = createDuck();
    const geoms = geometries(duck.object);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    const p = duck.layEgg();
    duck.dispose();
    await p;
    expect(freed).toBe(geoms.size);
  });
});

describe("createTrail", () => {
  const chevrons = (trail: ReturnType<typeof createTrail>): InstancedMesh =>
    trail.object.getObjectByName("trail:chevrons") as InstancedMesh;

  it("lays a chevron every 0.75 m along a route, lifted, pointing along the path", () => {
    const trail = createTrail();
    const path: Vec3[] = [
      [0, 0, 0],
      [0, 0, -3],
      [3, 0, -3],
    ];
    trail.set(path);
    const mesh = chevrons(trail);
    expect(mesh.count).toBe(trail.points.length);
    expect(mesh.count).toBe(7); // 6 m from the end at 0.75, minus the one underfoot
    const m = new Matrix4();
    const pos = (i: number) => new Vector3().setFromMatrixPosition((mesh.getMatrixAt(i, m), m));
    const dir = (i: number) => new Vector3(0, 0, -1).transformDirection((mesh.getMatrixAt(i, m), m));
    for (let i = 0; i < mesh.count; i++) {
      expect(pos(i).y).toBeCloseTo(0.04);
      const d = dir(i);
      const p = pos(i);
      // First leg runs north (−z), the second east (+x).
      if (p.z > -3 + 1e-6) expect([d.x, d.z].map((v) => +v.toFixed(6) + 0)).toEqual([0, -1]);
      else expect([d.x, d.z].map((v) => +v.toFixed(6) + 0)).toEqual([1, 0]);
    }
    for (let i = 1; i < mesh.count; i++) {
      const gap = pos(i).distanceTo(pos(i - 1));
      if (pos(i).z > -3 + 1e-6 || pos(i - 1).z < -3 + 1e-6) expect(gap).toBeCloseTo(0.75);
    }
    trail.dispose();
  });

  it("pulses in sequence, grows, and clears", () => {
    const trail = createTrail();
    trail.set([
      [0, 0, 0],
      [0, 0, -60],
    ]);
    const mesh = chevrons(trail);
    expect(mesh.count).toBe(79);
    trail.update(0.2);
    const a = mesh.instanceColor!.getX(0);
    const b = mesh.instanceColor!.getX(3);
    expect(a).not.toBeCloseTo(b);
    trail.set([]);
    expect(chevrons(trail).count).toBe(0);
    trail.dispose();
  });

  it("follows a real route through the show's house", () => {
    const trail = createTrail();
    const spawn = show.spawn.pos;
    const duck = show.duck.spots[0]!.pos;
    const path = route(show, spawn, duck);
    trail.set(path);
    expect(trail.points.length).toBeGreaterThan(0);
    trail.dispose();
  });
});

describe("createAvatar", () => {
  it("places the ghost at the pose and turns it to the yaw", () => {
    const a = createAvatar("Winamp", "g-abc123");
    expect(a.tag).toBeNull(); // no DOM, no name tag
    a.setPose([2, -2.7, 3], 90, 20);
    a.update(0.1);
    a.object.updateMatrixWorld(true);
    expect(a.object.position.toArray()).toEqual([2, -2.7, 3]);
    const visor = a.object.getObjectByName("avatar:visor")!;
    const f = new Vector3(0, 0, -1).transformDirection(visor.matrixWorld);
    const want = forward(90, 20);
    expect(f.x).toBeCloseTo(want[0]);
    expect(f.y).toBeCloseTo(want[1]);
    expect(f.z).toBeCloseTo(want[2]);
    const geoms = geometries(a.object);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    a.dispose();
    expect(freed).toBe(geoms.size);
  });

  it("tints by seed, stably", () => {
    const tint = (seed: string) => {
      const body = createAvatar("x", seed).object.getObjectByName("avatar:body") as Mesh<BufferGeometry, MeshLambertMaterial>;
      return body.material.color.getHex();
    };
    expect(tint("g-1")).toBe(tint("g-1"));
    expect(tint("g-1")).not.toBe(tint("g-2"));
  });
});

describe("spaceGroup", () => {
  it("applies world = Ry(yaw) · (scale · house) + offset, like toSpace", () => {
    const t: SpaceTransform = { offset: [1, 2, -3], yaw: 37, scale: 1.5 };
    const g = spaceGroup(t);
    const child = new Object3D();
    child.position.set(4, 0.5, -2);
    g.add(child);
    g.updateMatrixWorld(true);
    const w = new Vector3().setFromMatrixPosition(child.matrixWorld);
    const want = toSpace(t, [4, 0.5, -2]);
    expect(w.x).toBeCloseTo(want[0]);
    expect(w.y).toBeCloseTo(want[1]);
    expect(w.z).toBeCloseTo(want[2]);
    const id = spaceGroup(undefined);
    expect(id.position.toArray()).toEqual([0, 0, 0]);
    expect(id.scale.toArray()).toEqual([1, 1, 1]);
  });
});
