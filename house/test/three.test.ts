// The three.js builders, constructed under node: no WebGL, no canvas (so no
// textures and no labels — `hasDom()` is false here). Nothing renders; the
// tests read the scene graph.

import { describe, expect, it } from "vitest";
import { BufferGeometry, DoubleSide, Group, InstancedMesh, LineSegments, Matrix4, Mesh, MeshLambertMaterial, Object3D, Vector3 } from "three";
import type { Material } from "three";
import { buildRamps, buildWalls, doorGap, forward, outsideGround, pointInPoly, pointInPolyStrict, roomById, route, toSpace } from "../src/index.ts";
import type { SpaceTransform, Vec3 } from "../src/index.ts";
import {
  buildHouseScene,
  createAvatar,
  createDuck,
  createHeart,
  createKing,
  createPickup,
  heartPulse,
  HEART_BEAT_S,
  PICKUP_HOVER,
  createTrail,
  hasDom,
  KING_KNEEL,
  planeGeometry,
  rampGeometry,
  spaceGroup,
  DUCK_FLIGHT,
  FEED_H,
  FEED_W,
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
    // The basement stair's ramp is the basement's, the upstairs one the main floor's.
    for (const floor of ["basement", "main"]) {
      const ramp = scene.floors.get(floor)!.getObjectByName(`ramps:${floor}`) as Mesh;
      expect(ramp, floor).toBeDefined();
      expect((ramp.material as Material).side).toBe(DoubleSide);
    }
    expect(scene.floors.get("top")!.getObjectByName("ramps:top")).toBeUndefined();
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
    const terminalMeshes = show.terminals.length * 6; // screen 4 + the camera window 2
    const heartMeshes = [...scene.hearts.values()].reduce((n, h) => n + meshes(h.object).length, 0); // wave 26: his heart's own object
    // walls/lintels/fences/rails + edges + floors + ceilings + props + screens, per floor.
    expect(meshes(scene.root).length - terminalMeshes - heartMeshes).toBeLessThanOrEqual(show.floors.length * 9);
    scene.dispose();
  });

  it("a terminal's camera window: hidden by default, a 4:3 picture over the screen while a feed shows", () => {
    const scene = buildHouseScene(show, { labels: false });
    const spot = show.terminals[0]!;
    const t = scene.terminals.get(spot.id)!;
    const window = t.getObjectByName("feed")!;
    expect(window.visible).toBe(false);
    const picture = window.getObjectByName("feed-picture") as Mesh;
    picture.geometry.computeBoundingBox();
    const size = picture.geometry.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(FEED_W);
    expect(size.y).toBeCloseTo(FEED_H);
    expect(FEED_W / FEED_H).toBeCloseTo(4 / 3);
    // Proud of the screen (local −z faces the room).
    expect(picture.geometry.boundingBox!.max.z).toBeLessThan(-0.002);
    // Under node there is no canvas: nothing shows, nothing throws.
    expect(scene.setTerminalFeed(spot.id, {} as CanvasImageSource)).toBe(false);
    expect(scene.setTerminalFeed("nope", null)).toBe(false);

    // With a (fake) canvas the frame is copied and the window replaces the screen.
    const drawn: unknown[] = [];
    const g = globalThis as { document?: unknown };
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (src: unknown) => drawn.push(src) }) }) };
    try {
      const frame = { frame: 1 } as unknown as CanvasImageSource;
      expect(scene.setTerminalFeed(spot.id, frame)).toBe(true);
      expect(drawn).toEqual([frame]);
      expect(window.visible).toBe(true);
      expect(t.getObjectByName("panel")!.visible).toBe(false);
      expect((picture.material as { map: unknown }).map).not.toBeNull();
      expect(scene.setTerminalFeed(spot.id, null)).toBe(false);
      expect(window.visible).toBe(false);
      expect(t.getObjectByName("panel")!.visible).toBe(true);
    } finally {
      delete g.document;
    }
    scene.dispose();
    expect(scene.setTerminalFeed(spot.id, null)).toBe(false);
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

  it("without a DOM a picture is asked for but never drawn: the plain capsule, nothing thrown", async () => {
    const a = createAvatar("Excel", "g-1", { picture: "/e/ev/api/avatar/0123456789abcdef" });
    expect(a.picture).toBe("/e/ev/api/avatar/0123456789abcdef");
    await new Promise((r) => setTimeout(r, 0));
    expect(a.object.getObjectByName("avatar:picture")).toBeUndefined();
    expect(a.object.getObjectByName("avatar:body")).toBeDefined();
    a.setPicture(null);
    expect(a.picture).toBeNull();
    a.setPicture("");
    expect(a.picture).toBeNull();
    a.dispose();
    a.setPicture("/e/ev/api/avatar/ffffffffffffffff"); // after dispose: ignored
    expect(a.picture).toBeNull();
    expect(createAvatar("Word").picture).toBeNull();
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

describe("createKing + guarded doors in buildHouseScene", () => {
  const kingProp = show.props.find((p) => p.kind === "king")!;
  const guarded = show.doors.filter((d) => d.guard !== undefined);

  it("a king prop is its own group (king:<id>) on its floor, never merged into props:<floor>; no bar sprite without a DOM", () => {
    const scene = buildHouseScene(show, { labels: false });
    expect(kingProp).toBeDefined();
    const k = scene.kings.get(kingProp.id)!;
    expect(k).toBeDefined();
    expect(k.object.name).toBe(`king:${kingProp.id}`);
    expect(k.object.parent).toBe(scene.floors.get(roomById(show, kingProp.room)!.floor));
    expect(k.object.position.toArray()).toEqual(kingProp.pos);
    expect(k.object.rotation.y).toBeCloseTo(((kingProp.yaw ?? 0) * Math.PI) / 180);
    expect(k.object.getObjectByName("king:bar")).toBeUndefined();
    expect(k.object.getObjectByName("king:mesh")).toBeDefined();
    // The floor's merged props carry one geometry less than the floor's non-king props would.
    const bare = { ...show, props: show.props.filter((p) => p.kind !== "king") };
    const plain = buildHouseScene(bare, { labels: false });
    const floorId = roomById(show, kingProp.room)!.floor;
    const count = (s: typeof scene) => (s.floors.get(floorId)!.getObjectByName(`props:${floorId}`) as Mesh).geometry.getAttribute("position").count;
    expect(count(scene)).toBe(count(plain));
    expect(plain.kings.size).toBe(0);
    scene.dispose();
    plain.dispose();
  });

  it("a guarded door has a door:<id> leaf in its gap; a map without guards has none; kings: false drops both", () => {
    const scene = buildHouseScene(show, { labels: false });
    expect(guarded.length).toBeGreaterThan(0);
    expect([...scene.doors.keys()]).toEqual(guarded.map((d) => d.id));
    for (const door of guarded) {
      const leaf = scene.doors.get(door.id)!;
      expect(leaf.name).toBe(`door:${door.id}`);
      expect(leaf.visible).toBe(true);
      const gap = doorGap(show, door)!;
      // Centred in the gap, floor to door top.
      if (gap.axis === "x") {
        expect(leaf.position.z).toBeCloseTo(gap.c);
        expect(leaf.position.x).toBeCloseTo((gap.lo + gap.hi) / 2);
      } else {
        expect(leaf.position.x).toBeCloseTo(gap.c);
        expect(leaf.position.z).toBeCloseTo((gap.lo + gap.hi) / 2);
      }
      expect(leaf.position.y).toBeCloseTo((gap.bottom + gap.top) / 2);
      leaf.geometry.computeBoundingBox();
      const size = leaf.geometry.boundingBox!.getSize(new Vector3());
      expect(size.y).toBeCloseTo(gap.top - gap.bottom);
      expect(gap.axis === "x" ? size.x : size.z).toBeCloseTo(gap.hi - gap.lo - 0.02);
      expect(leaf.parent).toBe(scene.floors.get(gap.floor));
    }
    scene.dispose();
    const none = buildHouseScene({ ...show, doors: show.doors.map((d) => ({ ...d, guard: undefined })) }, { labels: false });
    expect(none.doors.size).toBe(0);
    none.dispose();
    const off = buildHouseScene(show, { labels: false, kings: false });
    expect(off.kings.size).toBe(0);
    expect(off.doors.size).toBe(0);
    off.dispose();
  });

  it("king: setHp / hit / kneel drive the state machine on update(dt); reset stands him up", () => {
    const k = createKing(kingProp);
    const body = k.object.getObjectByName("king:body")!;
    expect(k.state).toBe("standing");
    k.setHp(4, 4); // no DOM: no bar, no throw
    k.setHp(11, 15); // past nine cells: still no throw
    k.update(0.1);
    k.hit();
    expect(k.state).toBe("staggering");
    k.update(0.1);
    expect(body.rotation.x).toBeLessThan(0); // tilted back
    for (let i = 0; i < 5; i++) k.update(0.1);
    expect(k.state).toBe("standing");
    expect(body.rotation.x).toBe(0);
    // Down on one knee: lower, squashed, bowed — the crown (the one mesh) kept.
    k.kneel(true);
    expect(k.state).toBe("kneeling");
    k.update(KING_KNEEL / 2);
    const half = body.scale.y;
    expect(half).toBeLessThan(1);
    for (let i = 0; i < 10; i++) k.update(0.1);
    expect(body.scale.y).toBeLessThan(half);
    expect(body.scale.y).toBeCloseTo(0.7);
    expect(body.rotation.x).toBeLessThan(-0.3);
    expect(body.position.y).toBeLessThan(0);
    expect(k.object.getObjectByName("king:mesh")!.visible).toBe(true);
    k.hit(); // a kneeling king takes no hits
    expect(k.state).toBe("kneeling");
    // Back up, the same way.
    k.kneel(false);
    expect(k.state).toBe("standing");
    k.update(KING_KNEEL / 2);
    expect(body.scale.y).toBeGreaterThan(0.7);
    expect(body.scale.y).toBeLessThan(1);
    k.hit(); // still getting up: no stagger yet
    expect(k.state).toBe("standing");
    for (let i = 0; i < 10; i++) k.update(0.1);
    expect(body.scale.y).toBe(1);
    expect(body.rotation.x).toBe(0);
    // reset is at once.
    k.kneel(true);
    k.update(1);
    k.reset();
    expect(k.state).toBe("standing");
    k.update(0.01);
    expect(body.scale.y).toBe(1);
    const geoms = geometries(k.object);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    k.dispose();
    expect(freed).toBe(geoms.size);
  });

  it("showKing: his bar, the kneel while fallen, and his doors' leaves hidden while open", () => {
    const scene = buildHouseScene(show, { labels: false });
    const k = scene.kings.get(kingProp.id)!;
    const leaves = guarded.map((d) => scene.doors.get(d.id)!);
    scene.showKing(kingProp.id, { hp: 3, max: 15, fallen: false });
    expect(k.state).toBe("standing");
    expect(leaves.every((l) => l.visible)).toBe(true);
    scene.showKing(kingProp.id, { hp: 0, max: 15, fallen: true });
    expect(k.state).toBe("kneeling");
    expect(leaves.every((l) => !l.visible)).toBe(true);
    // A restore with a player still in the doorway: he stands, the leaf stays open.
    scene.showKing(kingProp.id, { hp: 15, max: 15, fallen: false }, true);
    expect(k.state).toBe("standing");
    expect(leaves.every((l) => !l.visible)).toBe(true);
    scene.showKing(kingProp.id, { hp: 15, max: 15, fallen: false });
    expect(leaves.every((l) => l.visible)).toBe(true);
    scene.showKing("no-such-king", { hp: 0, max: 15, fallen: true }); // ignored
    expect(leaves.every((l) => l.visible)).toBe(true);
    scene.dispose();
  });

  it("the scene's update drives its kings and dispose frees them", () => {
    const scene = buildHouseScene(show, { labels: false });
    const k = scene.kings.get(kingProp.id)!;
    k.hit();
    scene.update(0.5);
    expect(k.state).toBe("standing");
    const geoms = geometries(k.object);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    scene.dispose();
    expect(freed).toBe(geoms.size);
  });
});

describe("wave 26: the heart, the pickups and the outside ground", () => {
  const kingProp = show.props.find((p) => p.kind === "king")!;
  const heartProp = show.props.find((p) => p.kind === "heart")!;
  const diskProp = show.props.find((p) => p.kind === "pickup")!;

  it("his heart is always built, hidden while the King stands, shown once he falls", () => {
    const scene = buildHouseScene(show, { labels: false });
    const h = scene.hearts.get(heartProp.id)!;
    expect(h.object.name).toBe(`heart:${heartProp.id}`);
    expect(h.object.parent?.name).toBe(`floor:${roomById(show, heartProp.room)!.floor}`);
    expect(h.object.position.toArray()).toEqual(heartProp.pos);
    expect(h.object.visible).toBe(false);
    scene.showKing(kingProp.id, { hp: 0, max: 15, fallen: true });
    expect(h.object.visible).toBe(true);
    scene.showKing(kingProp.id, { hp: 15, max: 15, fallen: false });
    expect(h.object.visible).toBe(false);
    scene.showKing("no-such-king", { hp: 0, max: 15, fallen: true }); // ignored
    expect(h.object.visible).toBe(false);
    scene.dispose();
  });

  it("…even with kings: false (the heart still follows the King's state); and shows on a map without a King", () => {
    const scene = buildHouseScene(show, { labels: false, kings: false });
    const h = scene.hearts.get(heartProp.id)!;
    expect(h.object.visible).toBe(false);
    scene.showKing(kingProp.id, { hp: 0, max: 15, fallen: true });
    expect(h.object.visible).toBe(true);
    scene.dispose();
    const noKing = { ...show, props: show.props.filter((p) => p.kind !== "king"), doors: show.doors.map(({ guard: _g, ...d }) => d) };
    const free = buildHouseScene(noKing, { labels: false });
    expect(free.hearts.get(heartProp.id)!.object.visible).toBe(true);
    free.dispose();
  });

  it("the heart beats slowly (no faster than its beat) and carries no label or text", () => {
    expect(heartPulse(0)).toBe(0);
    expect(heartPulse(0.09)).toBeCloseTo(1, 6);
    expect(heartPulse(0.8)).toBe(0); // the rest between beats
    expect(heartPulse(0.09 + HEART_BEAT_S)).toBeCloseTo(1, 6);
    expect(HEART_BEAT_S).toBeGreaterThanOrEqual(1 / 3);
    const h = createHeart(heartProp);
    const core = h.object.getObjectByName("heart:core")!;
    h.update(0.09);
    expect(h.pulse).toBeCloseTo(1, 6);
    const big = core.scale.x;
    h.update(0.7);
    expect(core.scale.x).toBeLessThan(big);
    const names: string[] = [];
    h.object.traverse((o) => names.push(o.name));
    expect(names.every((n) => !/label|sign|row|led|bay/i.test(n))).toBe(true);
    h.dispose();
  });

  it("pickups: none by default (the terminals, the map editor), spinning disks with pickups: true", () => {
    const plain = buildHouseScene(show, { labels: false });
    expect(plain.pickups.size).toBe(0);
    expect(plain.root.getObjectByName(`pickup:${diskProp.id}`)).toBeUndefined();
    expect(plain.setPickupTaken(diskProp.id, true)).toBe(false);
    plain.dispose();
    const game = buildHouseScene(show, { labels: false, pickups: true });
    const d = game.pickups.get(diskProp.id)!;
    expect(d.item).toBe("virus");
    expect(d.object.position.toArray()).toEqual(diskProp.pos);
    const disk = d.object.getObjectByName("pickup:disk")!;
    expect(disk.position.y).toBeCloseTo(PICKUP_HOVER, 6);
    game.update(0.5);
    expect(disk.rotation.y).not.toBe(0);
    expect(game.setPickupTaken(diskProp.id, true)).toBe(true);
    expect(d.object.visible).toBe(false);
    game.setPickupTaken(diskProp.id, false);
    expect(d.object.visible).toBe(true);
    expect(game.setPickupTaken("nope", true)).toBe(false);
    game.dispose();
  });

  it("createPickup: a floppy named for its item, freed on dispose", () => {
    const p = createPickup("virus");
    expect(p.object.name).toBe("pickup:virus");
    const geoms = geometries(p.object);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    p.dispose();
    expect(freed).toBe(geoms.size);
  });

  it("the outside ground: only with ground: true, at outsideGround's rect under the floors", () => {
    expect(buildHouseScene(show, { labels: false }).ground).toBeNull();
    const scene = buildHouseScene(show, { labels: false, ground: true });
    const g = outsideGround(show)!;
    expect(scene.ground).not.toBeNull();
    expect(scene.ground!.parent?.name).toBe(`floor:${g.floor}`);
    const plane = scene.ground!.getObjectByName("ground:plane") as Mesh;
    plane.geometry.computeBoundingBox();
    const bb = plane.geometry.boundingBox!;
    expect([bb.min.x, bb.min.z, bb.max.x, bb.max.z].map((v) => Math.round(v * 1000) / 1000)).toEqual(g.rect);
    expect(bb.max.y).toBeLessThan(g.y);
    expect(scene.ground!.getObjectByName("ground:grid")).toBeDefined();
    scene.dispose();
    // A map with no exterior door has no ground.
    expect(buildHouseScene(fixture("stair"), { labels: false, ground: true }).ground).toBeNull();
  });

  it("the outside ground has every room on its floor cut out, the stairwells included", () => {
    const scene = buildHouseScene(show, { labels: false, ground: true });
    const g = outsideGround(show)!;
    const rooms = show.rooms.filter((r) => r.floor === g.floor);
    const plane = scene.ground!.getObjectByName("ground:plane") as Mesh;
    const pos = plane.geometry.getAttribute("position");
    const index = plane.geometry.getIndex()!;
    // Each triangle on the ground: its centroid is outside every room, and it faces up.
    const tris: [number, number][][] = [];
    for (let t = 0; t < index.count; t += 3) {
      const v = [0, 1, 2].map((k) => {
        const i = index.getX(t + k);
        return [pos.getX(i), pos.getY(i), pos.getZ(i)] as const;
      });
      const c: [number, number] = [(v[0]![0] + v[1]![0] + v[2]![0]) / 3, (v[0]![2] + v[1]![2] + v[2]![2]) / 3];
      for (const r of rooms) expect(pointInPolyStrict(r.poly, c), `ground triangle in ${r.id}`).toBe(false);
      const ux = v[1]![0] - v[0]![0], uz = v[1]![2] - v[0]![2], wx = v[2]![0] - v[0]![0], wz = v[2]![2] - v[0]![2];
      expect(uz * wx - ux * wz, "faces +y").toBeGreaterThan(0);
      tris.push(v.map((q) => [q[0], q[2]] as [number, number]));
    }
    const covered = (p: [number, number]): boolean =>
      tris.some(([a, b, c]) => {
        const s = (u: [number, number], w: [number, number]) => (w[0] - u[0]) * (p[1] - u[1]) - (w[1] - u[1]) * (p[0] - u[0]);
        const d1 = s(a!, b!), d2 = s(b!, c!), d3 = s(c!, a!);
        return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
      });
    // The basement stairs go down from a room on the ground's floor: its rect is not covered.
    const stairs = show.stairs.filter((st) => rooms.some((r) => r.id === st.to));
    expect(stairs.length).toBeGreaterThan(0);
    for (const st of stairs) {
      const [x0, z0, x1, z1] = st.rect;
      expect(covered([(x0 + x1) / 2, (z0 + z1) / 2]), st.id).toBe(false);
      expect(covered([x0 + 0.05, z0 + 0.05]), st.id).toBe(false);
    }
    // Out past the front door, and at the rect's corners, it is.
    const front = show.doors.find((d) => d.b === null && rooms.some((r) => r.id === d.a))!;
    const [rx0, rz0, rx1, rz1] = g.rect;
    expect(covered([rx0 + 0.5, rz0 + 0.5])).toBe(true);
    expect(covered([rx1 - 0.5, rz1 - 0.5])).toBe(true);
    const off = [[0, -3], [0, 3], [-3, 0], [3, 0]].map(([dx, dz]) => [front.at[0] + dx!, front.at[1] + dz!] as [number, number]);
    expect(off.some((q) => !rooms.some((r) => pointInPoly(r.poly, q)) && covered(q))).toBe(true);
    // The grid never runs through a room.
    const grid = scene.ground!.getObjectByName("ground:grid") as LineSegments;
    const gp = grid.geometry.getAttribute("position");
    expect(gp.count).toBeGreaterThan(0);
    for (let i = 0; i < gp.count; i += 2) {
      const m: [number, number] = [(gp.getX(i) + gp.getX(i + 1)) / 2, (gp.getZ(i) + gp.getZ(i + 1)) / 2];
      for (const r of rooms) expect(pointInPolyStrict(r.poly, m), `grid line in ${r.id}`).toBe(false);
    }
    scene.dispose();
  });

  it("dispose frees the hearts and the disks", () => {
    const scene = buildHouseScene(show, { labels: false, pickups: true, ground: true });
    const geoms = new Set([...geometries(scene.hearts.get(heartProp.id)!.object), ...geometries(scene.pickups.get(diskProp.id)!.object), ...geometries(scene.ground!)]);
    let freed = 0;
    for (const g of geoms) g.addEventListener("dispose", () => freed++);
    scene.dispose();
    expect(freed).toBe(geoms.size);
  });
});
