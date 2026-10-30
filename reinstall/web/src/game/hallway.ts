//! The Hallway (wave 49, contract C2): the door that was not there, and the
//! pocket behind it. A dark corridor off the map, longer than the house, with
//! the far door backing away for as long as `HALLWAY_RETREAT_S` lets it, and
//! the walls closing in by a hand's width while nobody is measuring.
//!
//! `HallwayWalk` is the pure half (node-tested): the far door, the clock and
//! `HALLWAY_MAX_S`, so nobody is ever stuck in here. `Hallway` is the pocket
//! itself: a one-room map through `buildPhysicsWorld` (the player walks in it
//! with the game's own `move`), four quads and two doors, built once at walk
//! start. **The real body never moves**: `engine.ts` leaves `Game.body` at
//! the door, so the pose pump, the voice link and the cameras all keep
//! reading the door's room while the camera is in here.
//!
//! Lit by the point light pool's first light (`HouseLamps.borrow`): the pool
//! is fixed, and a light-count change would recompile every material.

import { AdditiveBlending, BoxGeometry, BufferAttribute, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from "three";
import type { BufferGeometry, Material } from "three";
import { HALLWAY_DOOR_M, HALLWAY_FAR_M, HALLWAY_HEIGHT_M, HALLWAY_MAX_S, HALLWAY_RETREAT, HALLWAY_RETREAT_S, HALLWAY_WIDTH_M, ROLE_COLORS, buildWalls, normalizeHouse, partsOf } from "@loom/house";
import type { HouseMap, Vec3 } from "@loom/house";
import { Bin, hasDom, merge } from "@loom/house/three";
import { smooth } from "./descent.ts";
import { buildPhysicsWorld, EYE_HEIGHT, move, RUN_FACTOR, WALK_SPEED, type Body, type MoveInput, type PhysicsWorld } from "./physics.ts";

/** The pocket's floor, well clear of any house (m). */
export const HALL_Y = 400;
/** The corridor's length: past where a runner can push the far door to (m). */
export const HALL_LENGTH_M = HALLWAY_FAR_M + HALLWAY_RETREAT_S * HALLWAY_RETREAT * WALK_SPEED * RUN_FACTOR + 12;
/** Room behind the door they came in by (m). */
const HALL_BACK_M = 0.55;
/** The far door's line is said this far in (s). */
export const HALL_FAR_LINE_S = 9;
/** How far the walls close in by the end of the retreat (× width, × height). */
export const HALL_SQUEEZE: readonly [number, number] = [0.82, 0.93];
/** A strip of the door to nowhere. */
const DOOR_SIZE: Vec3 = [1, 2.1, 0.12];
/** The red under a door, in linear light: over 1, so it blooms. */
const SLIT_GAIN = 2.4;

export type HallEnd = "reached" | "timeout";

/** One step of the pocket. */
export interface HallStep {
  end: HallEnd | null;
  /** The far line is due, once. */
  far: boolean;
}

/** The far door and the clock. `z` is the walker's along the corridor (ahead is −z). */
export class HallwayWalk {
  s = 0;
  /** The far door's z. */
  farZ = -HALLWAY_FAR_M;
  private z = 0;
  private farSaid = false;

  /** `dt` seconds later the walker is at `z`. */
  step(dt: number, z: number): HallStep {
    const walked = this.z - z;
    this.z = z;
    this.s += dt;
    if (this.s <= HALLWAY_RETREAT_S && walked > 0) this.farZ -= walked * HALLWAY_RETREAT;
    const far = !this.farSaid && this.s >= HALL_FAR_LINE_S;
    if (far) this.farSaid = true;
    const end: HallEnd | null = Math.abs(z - this.farZ) <= HALLWAY_DOOR_M ? "reached" : this.s >= HALLWAY_MAX_S ? "timeout" : null;
    return { end, far };
  }

  /** How far the walker is from the far door (m). */
  get left(): number {
    return Math.abs(this.z - this.farZ);
  }

  /** The picture's brightness: up from black on the way in, and down to black at the far door. */
  get light(): number {
    return Math.min(smooth(this.s / 1.1), smooth((this.left - HALLWAY_DOOR_M) / 1.6));
  }
}

/** The pocket as a map: one room, nothing else. */
export function hallwayMap(): HouseMap {
  const w = HALLWAY_WIDTH_M / 2;
  return normalizeHouse({
    version: 1,
    name: "The Hallway",
    origin: "",
    floors: [{ id: "hall", label: "Hall", elevation: HALL_Y, height: HALLWAY_HEIGHT_M }],
    rooms: [{ id: "hall", label: "Hall", floor: "hall", poly: [[-w, -HALL_LENGTH_M], [w, -HALL_LENGTH_M], [w, HALL_BACK_M], [-w, HALL_BACK_M]] }],
    doors: [],
    stairs: [],
    terminals: [],
    duck: { spots: [{ id: "none", room: "hall", pos: [0, HALL_Y, -1] }] },
    spawn: { room: "hall", pos: [0, HALL_Y, 0], yaw: 0 },
    props: [],
    spaces: {},
  } as unknown as HouseMap);
}

/** A door to nowhere (`door` in `PROP_MODELS`): the white frame, a black leaf,
 *  the red slit under it and the red it throws on the floor. Base at y 0, front −z. */
export interface Door {
  object: Group;
  setOpacity(v: number): void;
  dispose(): void;
}

export function createDoor(): Door {
  const bin = new Bin();
  const object = new Group();
  object.name = "descent:door";
  const [w, h, d] = DOOR_SIZE;
  const parts = partsOf("door", w, h, d);
  const of = (roles: string[]): BufferGeometry[] => parts.filter((p) => roles.includes(p.role)).map((p) => new BoxGeometry(p.s[0], p.s[1], p.s[2]).translate(p.c[0], p.c[1], p.c[2]));
  const mats: Material[] = [];
  const add = (geoms: BufferGeometry[], mat: MeshBasicMaterial | MeshLambertMaterial): void => {
    const g = merge(geoms);
    if (g === null) return;
    bin.add(g);
    bin.add(mat);
    mat.transparent = true;
    mats.push(mat);
    object.add(new Mesh(g, mat));
  };
  add(of(["body", "trim"]), new MeshLambertMaterial({ color: "#d9d6cf" }));
  add(of(["dark"]), new MeshBasicMaterial({ color: ROLE_COLORS.dark }));
  const slit = new MeshBasicMaterial({ color: "#ff1a2e", fog: false });
  slit.color.multiplyScalar(SLIT_GAIN);
  add(of(["neon"]), slit);
  // The red on the floor: strongest at the door, gone a metre out.
  const spill = new PlaneGeometry(w * 0.84, 1.15).rotateX(-Math.PI / 2).translate(0, 0.012, -d / 2 - 0.575);
  const colors = new Float32Array(spill.getAttribute("position").count * 3);
  const pos = spill.getAttribute("position");
  for (let i = 0; i < pos.count; i++) colors[i * 3] = pos.getZ(i) > -0.3 ? 0.55 : 0;
  spill.setAttribute("color", new BufferAttribute(colors, 3));
  const glow = bin.add(new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false }));
  bin.add(spill);
  mats.push(glow);
  const glowMesh = new Mesh(spill, glow);
  glowMesh.renderOrder = 1;
  object.add(glowMesh);
  return {
    object,
    setOpacity(v: number) {
      for (const m of mats) m.opacity = v;
    },
    dispose() {
      object.removeFromParent();
      bin.dispose();
    },
  };
}

/** Six metres of wall with a shut door in it, tiled along the corridor. Null under node. */
function wallTexture(): CanvasTexture | null {
  if (!hasDom()) return null;
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 256;
  const g = c.getContext("2d");
  if (g === null) return null;
  g.fillStyle = "#34323a";
  g.fillRect(0, 0, 1024, 256);
  // The paper's pinstripe, and a dado that never quite lines up.
  g.fillStyle = "#3d3a44";
  for (let x = 0; x < 1024; x += 14) g.fillRect(x, 0, 3, 256);
  g.fillStyle = "#1f1e24";
  g.fillRect(0, 150, 1024, 5);
  // A door nobody opens.
  const [x, w, top] = [430, 150, 28];
  g.fillStyle = "#6f6c67";
  g.fillRect(x - 10, top - 10, w + 20, 256 - top + 10);
  g.fillStyle = "#121116";
  g.fillRect(x, top, w, 256 - top);
  g.fillStyle = "#6b1016";
  g.fillRect(x, 250, w, 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.repeat.set(HALL_LENGTH_M / 6, 1);
  return t;
}

/** What the corridor's one light is doing, for `HouseLamps.borrow`. */
export interface HallLight {
  pos: Vec3;
  color: string;
  intensity: number;
}

export class Hallway {
  readonly object = new Group();
  private readonly bin = new Bin();
  private readonly world: PhysicsWorld = (() => {
    const map = hallwayMap();
    return buildPhysicsWorld(map, buildWalls(map));
  })();
  private readonly corridor = new Group();
  private readonly near: Door;
  private readonly far: Door;
  walk = new HallwayWalk();
  body: Body = { p: [0, HALL_Y, 0], yaw: 0, pitch: 0, vy: 0 };
  private clock = 0;

  constructor() {
    this.object.name = "descent:hallway";
    this.object.visible = false;
    const tex = this.bin.add(wallTexture());
    const wall = this.bin.add(new MeshLambertMaterial(tex !== null ? { map: tex } : { color: "#34323a" }));
    const floor = this.bin.add(new MeshLambertMaterial({ color: "#2a1a1c" }));
    const ceiling = this.bin.add(new MeshLambertMaterial({ color: "#1a191e" }));
    const [W, H] = [HALLWAY_WIDTH_M, HALLWAY_HEIGHT_M];
    const L = HALL_LENGTH_M + HALL_BACK_M;
    const mid = (HALL_BACK_M - HALL_LENGTH_M) / 2;
    const quad = (g: BufferGeometry, m: MeshLambertMaterial): void => {
      this.corridor.add(new Mesh(this.bin.add(g), m));
    };
    quad(new PlaneGeometry(L, H).rotateY(Math.PI / 2).translate(-W / 2, H / 2, mid), wall);
    quad(new PlaneGeometry(L, H).rotateY(-Math.PI / 2).translate(W / 2, H / 2, mid), wall);
    quad(new PlaneGeometry(W, L).rotateX(-Math.PI / 2).translate(0, 0, mid), floor);
    quad(new PlaneGeometry(W, L).rotateX(Math.PI / 2).translate(0, H, mid), ceiling);
    this.corridor.position.y = HALL_Y;
    this.object.add(this.corridor);
    this.near = createDoor();
    this.near.object.position.set(0, HALL_Y, HALL_BACK_M - DOOR_SIZE[2]);
    this.far = createDoor();
    this.far.object.rotation.y = Math.PI;
    this.far.object.position.set(0, HALL_Y, this.walk.farZ);
    this.object.add(this.near.object, this.far.object);
  }

  /** In through the door, turned the way they were walking. */
  enter(yaw: number, pitch: number): void {
    this.walk = new HallwayWalk();
    this.body = { p: [0, HALL_Y, 0], yaw, pitch, vy: 0 };
    this.clock = 0;
    this.corridor.scale.set(1, 1, 1);
    this.far.object.position.z = this.walk.farZ;
    this.object.visible = true;
  }

  leave(): void {
    this.object.visible = false;
  }

  update(dt: number, input: MoveInput): HallStep {
    this.clock += dt;
    this.body = move(this.body, input, dt, this.world);
    const step = this.walk.step(dt, this.body.p[2]);
    this.far.object.position.z = this.walk.farZ;
    const k = smooth(this.walk.s / HALLWAY_RETREAT_S);
    this.corridor.scale.set(1 + (HALL_SQUEEZE[0] - 1) * k, 1 + (HALL_SQUEEZE[1] - 1) * k, 1);
    return step;
  }

  /** The light that goes with them: a bare bulb on a long flex, always a little ahead. */
  light(): HallLight {
    const [x, , z] = this.body.p;
    return {
      pos: [x + Math.sin(this.clock * 0.7) * 0.22, HALL_Y + EYE_HEIGHT + 0.42, z - 0.9 + Math.cos(this.clock * 0.53) * 0.3],
      color: "#ffd9b0",
      intensity: 7 + Math.sin(this.clock * 1.9) * 0.9,
    };
  }

  dispose(): void {
    this.near.dispose();
    this.far.dispose();
    this.object.removeFromParent();
    this.bin.dispose();
  }
}
