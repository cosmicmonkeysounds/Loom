//! `buildHouseScene` — a house map as a three.js scene graph, the one the
//! web game and the terminals' world view both render (so they always look
//! alike). `docs/loom-reinstall.md` §1.3.
//!
//! The house frame **is** three's frame (metres, Y up, `+z` south, yaw =
//! `rotation.y` for a `−z`-forward node), so geometry goes in untransformed;
//! a game with its own world frame parents `root` under `spaceGroup`.
//!
//! Draw calls stay low for a tablet: per floor one merged mesh per material
//! (walls, lintels, fences, rails, floors + ramps, ceilings, props, prop
//! screens) plus crisp edge lines; terminals share their geometries and
//! materials. Textures are procedural (`textures.ts`) and fall back to plain
//! colours without a DOM, so the whole builder constructs under node — only
//! creating a `WebGLRenderer` is the app's job.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Path,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { Camera, Material, Object3D, Scene, Texture } from "three";
import { forward } from "../frames.ts";
import { breakpoints, buildFloors, buildRamps, buildWalls, doorGap, pointInPolyStrict, roomById, roomElevation, roomHeight, stairWells, styleOf } from "../geometry.ts";
import type { FloorPlane, HouseMap, Ramp, TerminalSpot, Vec2, WallKind, WallSegment } from "../types.ts";
import { Bin, DEG, merge, paint, projectUvs } from "./dispose.ts";
import { outsideGround } from "../escape.ts";
import { createHeart, type Heart } from "./heart.ts";
import { createKing, type King } from "./king.ts";
import { createPickup, type Pickup } from "./pickup.ts";
import { labelPoint, wallBoxes } from "./layout.ts";
import {
  PALETTE,
  bevelTexture,
  captionScreenTexture,
  checkerTexture,
  desktopScreenTexture,
  desktopTexture,
  fenceTexture,
  glowTexture,
  hasDom,
  scanlineTexture,
  signTexture,
  starfieldTexture,
  stripesTexture,
  titleBarTexture,
  watchingTexture,
} from "./textures.ts";

export interface HouseSceneOptions {
  /** Room name labels + sign props (default: when a DOM exists — they need a canvas). */
  labels?: boolean;
  /** Procedural textures (default: when a DOM exists; else plain colours). */
  textures?: boolean;
  /** A hemisphere + a directional light inside `root` (default true). */
  lights?: boolean;
  /** Ceilings over indoor rooms (default true). */
  ceilings?: boolean;
  /** Crisp edge lines on walls (default true). */
  edges?: boolean;
  /** Terminal screens (default true). */
  terminals?: boolean;
  /** Each terminal (its screen, halo and camera window) drawn this many times
   *  its size across the wall, never deeper (default 1; the games pass
   *  `GAME_TERMINAL_SCALE`). */
  terminalScale?: number;
  /** Precomputed `buildWalls(house)`, to skip computing it again. */
  walls?: WallSegment[];
  /** `king` props as their own animated objects + a closed leaf in every guarded door (default true). */
  kings?: boolean;
  /** (wave 26, R4) A dark plane with a faint grid at `outsideGround` — the
   *  walkable outside past an exterior door (default false; the games pass true). */
  ground?: boolean;
  /** (wave 26, R7) `pickup` props as spinning disks (default false: only the
   *  games draw them — never the terminals or the map editor's preview). */
  pickups?: boolean;
}

export interface HouseScene {
  root: Group;
  /** Floor id → its group (every floor present, possibly empty). */
  floors: Map<string, Group>;
  /** Terminal id → its screen group (at the spot, facing its yaw/pitch). */
  terminals: Map<string, Group>;
  /** Room id → its name label. */
  labels: Map<string, Sprite>;
  /** Floor id → the merged ceiling mesh (hide it for a top-down view). */
  ceilings: Map<string, Mesh>;
  /** The wall segments the scene was built from (collision uses these). */
  walls: WallSegment[];
  /** Prop id → the King standing there (`kind: "king"` props, never merged with the floor's props). */
  kings: Map<string, King>;
  /** Door id → the closed leaf standing in a guarded door's gap (`door:<id>`); hide it when the guard falls. */
  doors: Map<string, Mesh>;
  /** (wave 26, R6) Prop id → Trabolta's heart (`kind: "heart"`, `heart:<id>`):
   *  always built, visible only while the map's King has fallen (or the map
   *  has none) — `showKing` drives it. */
  hearts: Map<string, Heart>;
  /** (wave 26, R7) Prop id → its disk (`kind: "pickup"`, `pickup:<id>`), with
   *  `pickups: true` only; empty otherwise. */
  pickups: Map<string, Pickup>;
  /** (wave 26, R4) The outside ground (`ground`), with `ground: true` on a map with an exterior door; else null. */
  ground: Group | null;
  /** Hide (taken) or show a pickup's disk for this viewer. False when the scene has no such disk. */
  setPickupTaken(id: string, taken: boolean): boolean;
  /**
   * Show King `id`'s shared state (the server's `KingState`): his bar at
   * `hp / max`, kneeling while `fallen`, and the leaf of every door he
   * guards hidden while `open` (default: while he has fallen — a game may
   * hold it open a little longer for a player still in the doorway). A
   * King not on this map is ignored. Hearts show once every King on the
   * map has fallen.
   */
  showKing(id: string, king: { hp: number; max: number; fallen: boolean }, open?: boolean): void;
  /**
   * Show terminal `id`'s live camera frame (wave 14, `docs/loom-reinstall.md`
   * §2.3) on a 4:3 window (`FEED_W` × `FEED_H`) in a thin Win98 bezel where
   * the terminal hangs, or `null` for the terminal's own screen look. The
   * source is copied at once (an `ImageBitmap` may be closed right after).
   * False when nothing is shown: no such terminal, `null`, or no canvas
   * (under node).
   */
  setTerminalFeed(id: string, source: CanvasImageSource | null): boolean;
  /**
   * Advance the animated bits (terminal scanlines + glow) by `dt` seconds.
   * With a `camera`, room labels fade out as it comes within ~2.5 m (a label
   * hangs near the ceiling — standing under it, it would fill the view).
   */
  update(dt: number, camera?: Camera): void;
  /** Free every geometry, material and texture, and detach `root`. */
  dispose(): void;
}

/** Terminal screen size (a wall tablet, a little larger so it reads at a distance). */
const SCREEN_W = 0.3;
const SCREEN_H = 0.21;
/** Room labels are hidden nearer than [0] metres, fully shown beyond [1]. */
const LABEL_FADE = [1.2, 2.6] as const;
/** A terminal's camera window (4:3), and the canvas its frames are drawn on. */
export const FEED_W = 0.48;
export const FEED_H = 0.36;
/** The canvas a camera window draws on: the terminals' frames at full size
 *  (`terminal/src/camfeed.ts` FEED_W × FEED_H). */
const FEED_PX: readonly [number, number] = [320, 240];
/** The games' terminals — their mirrors into the real house — at three times
 *  their size (wave 33b; VR: `HouseBuilder.TERMINAL_SCALE`). */
export const GAME_TERMINAL_SCALE = 3;

/** Background + fog for a scene showing a house (deep navy night, fog to match). */
export function houseAtmosphere(scene: Scene, opts: { color?: string; near?: number; far?: number } = {}): void {
  const color = new Color(opts.color ?? "#0b0b2e");
  scene.background = color;
  scene.fog = new Fog(color, opts.near ?? 7, opts.far ?? 32);
}

/** Build a three.js scene graph for a (valid, normalized) house map. */
export function buildHouseScene(house: HouseMap, opts: HouseSceneOptions = {}): HouseScene {
  const bin = new Bin();
  const dom = hasDom();
  const useTextures = (opts.textures ?? dom) && dom;
  const useLabels = (opts.labels ?? dom) && dom;
  const style = styleOf(house);
  const walls = opts.walls ?? buildWalls(house);

  const root = new Group();
  root.name = "house";
  const floors = new Map<string, Group>();
  for (const f of house.floors) {
    const g = new Group();
    g.name = `floor:${f.id}`;
    g.userData.floor = f.id;
    floors.set(f.id, g);
    root.add(g);
  }
  const floorGroup = (id: string): Group | undefined => floors.get(id);
  const roomFloor = (roomId: string): Group | undefined => {
    const room = roomById(house, roomId);
    return room ? floorGroup(room.floor) : undefined;
  };

  if (opts.lights !== false) {
    const hemi = new HemisphereLight(0xdff2ff, 0x2a2a4a, 2.2);
    hemi.name = "house:hemi";
    const sun = new DirectionalLight(0xffffff, 0.9);
    sun.name = "house:sun";
    sun.position.set(4, 10, 3);
    root.add(hemi, sun);
  }

  // ── Materials ─────────────────────────────────────────────────────
  const tex = <T extends Texture | null>(make: () => T): T | null => (useTextures ? bin.add(make()) : null);
  const textured = (map: Texture | null, fallback: string) => (map ? { map, color: 0xffffff } : { color: fallback });

  const ceilingTex = tex(starfieldTexture);
  ceilingTex?.repeat.set(0.25, 0.25);
  const checker = tex(checkerTexture);
  const mats = {
    wall: bin.add(new MeshLambertMaterial(textured(tex(desktopTexture), PALETTE.desktop))),
    lintel: bin.add(new MeshLambertMaterial(textured(tex(bevelTexture), PALETTE.face))),
    fence: (() => {
      const map = tex(fenceTexture);
      return bin.add(new MeshLambertMaterial({ ...textured(map, PALETTE.face), side: DoubleSide, alphaTest: map ? 0.5 : 0 }));
    })(),
    rail: bin.add(new MeshLambertMaterial(textured(tex(stripesTexture), PALETTE.stripeYellow))),
    edge: bin.add(new LineBasicMaterial({ color: PALETTE.edge, transparent: true, opacity: 0.55 })),
    floor: bin.add(new MeshLambertMaterial({ ...textured(checker, "#ffffff"), vertexColors: true })),
    // Ramps are seen from below too (walking under one on the lower floor).
    ramp: bin.add(new MeshLambertMaterial({ ...textured(checker, "#ffffff"), vertexColors: true, side: DoubleSide })),
    ceiling: bin.add(new MeshBasicMaterial(textured(ceilingTex, PALETTE.night))),
    prop: bin.add(new MeshLambertMaterial({ vertexColors: true, flatShading: true })),
    propScreen: bin.add(new MeshBasicMaterial(textured(tex(desktopScreenTexture), PALETTE.desktop))),
  } satisfies Record<string, Material>;
  const wallMat: Record<WallKind, Material> = { wall: mats.wall, lintel: mats.lintel, fence: mats.fence, rail: mats.rail };

  // ── Walls ─────────────────────────────────────────────────────────
  const boxes = wallBoxes(walls, style.wallThickness);
  for (const [floorId, group] of floors) {
    for (const kind of ["wall", "lintel", "fence", "rail"] as const) {
      const segments: WallSegment[] = [];
      const geoms: BufferGeometry[] = [];
      walls.forEach((w, i) => {
        if (w.floor !== floorId || w.kind !== kind) return;
        const b = boxes[i]!;
        const g = new BoxGeometry(b.size[0], b.size[1], b.size[2]);
        g.translate(b.center[0], b.center[1], b.center[2]);
        geoms.push(projectUvs(g));
        segments.push(w);
      });
      const merged = bin.add(merge(geoms));
      if (!merged) continue;
      const mesh = new Mesh(merged, wallMat[kind]);
      mesh.name = `${kind}s:${floorId}`;
      mesh.userData = { kind, segments };
      group.add(mesh);
      if (opts.edges !== false && (kind === "wall" || kind === "lintel")) {
        const lines = new LineSegments(bin.add(new EdgesGeometry(merged, 20)), mats.edge);
        lines.name = `edges:${kind}:${floorId}`;
        group.add(lines);
      }
    }
  }

  // ── Floors, ramps, ceilings ───────────────────────────────────────
  const ceilings = new Map<string, Mesh>();
  const planes = buildFloors(house);
  const ramps = buildRamps(house);
  for (const [floorId, group] of floors) {
    const floorGeoms: BufferGeometry[] = [];
    const ceilGeoms: BufferGeometry[] = [];
    for (const plane of planes) {
      if (plane.floor !== floorId) continue;
      if (plane.kind === "floor") floorGeoms.push(paint(planeGeometry(plane), floorTint(plane)));
      else if (opts.ceilings !== false) ceilGeoms.push(planeGeometry(plane));
    }
    const rampGeoms: BufferGeometry[] = [];
    for (const ramp of ramps) {
      if (roomById(house, ramp.from)?.floor === floorId) rampGeoms.push(paint(rampGeometry(ramp), PALETTE.ramp));
    }
    const floorMerged = bin.add(merge(floorGeoms));
    if (floorMerged) {
      const mesh = new Mesh(floorMerged, mats.floor);
      mesh.name = `floors:${floorId}`;
      group.add(mesh);
    }
    const rampMerged = bin.add(merge(rampGeoms));
    if (rampMerged) {
      const mesh = new Mesh(rampMerged, mats.ramp);
      mesh.name = `ramps:${floorId}`;
      group.add(mesh);
    }
    const ceilMerged = bin.add(merge(ceilGeoms));
    if (ceilMerged) {
      const mesh = new Mesh(ceilMerged, mats.ceiling);
      mesh.name = `ceilings:${floorId}`;
      ceilings.set(floorId, mesh);
      group.add(mesh);
    }
  }

  // The band between a ceiling and the floor above it, round each stair's
  // hole (`stairWells`): thin skins just outside the rect, a hair past both
  // planes so no crack shows at either edge.
  const SKIN = 0.02;
  for (const [floorId, group] of floors) {
    const geoms: BufferGeometry[] = [];
    for (const w of stairWells(house)) {
      if (w.floor !== floorId) continue;
      const [x0, z0, x1, z1] = w.rect;
      const lo = w.bottom - 0.01;
      const h = w.top + 0.01 - lo;
      const sides: [number, number, number, number][] = [
        [x1 - x0 + 2 * SKIN, SKIN, (x0 + x1) / 2, z0 - SKIN / 2],
        [x1 - x0 + 2 * SKIN, SKIN, (x0 + x1) / 2, z1 + SKIN / 2],
        [SKIN, z1 - z0, x0 - SKIN / 2, (z0 + z1) / 2],
        [SKIN, z1 - z0, x1 + SKIN / 2, (z0 + z1) / 2],
      ];
      for (const [sx, sz, cx, cz] of sides) geoms.push(projectUvs(new BoxGeometry(sx, h, sz).translate(cx, lo + h / 2, cz)));
    }
    const merged = bin.add(merge(geoms));
    if (!merged) continue;
    const mesh = new Mesh(merged, mats.wall);
    mesh.name = `wells:${floorId}`;
    group.add(mesh);
  }

  // ── Props ─────────────────────────────────────────────────────────
  const propGeoms = new Map<string, BufferGeometry[]>();
  const screenGeoms = new Map<string, BufferGeometry[]>();
  const push = (m: Map<string, BufferGeometry[]>, floor: string, g: BufferGeometry) => {
    const list = m.get(floor) ?? [];
    list.push(g);
    m.set(floor, list);
  };
  const kings = new Map<string, King>();
  const useKings = opts.kings !== false;
  const hearts = new Map<string, Heart>();
  const pickups = new Map<string, Pickup>();
  /** King prop id → fallen, as `showKing` last said (each starts standing). */
  const kingFallen = new Map(house.props.filter((p) => p.kind === "king").map((p) => [p.id, false]));
  const heartsShown = (): boolean => [...kingFallen.values()].every((f) => f);
  for (const prop of house.props) {
    const room = roomById(house, prop.room);
    const group = roomFloor(prop.room);
    if (!room || !group) continue;
    const place = (g: BufferGeometry) => g.rotateY((prop.yaw ?? 0) * DEG).translate(prop.pos[0], prop.pos[1], prop.pos[2]);
    const [w, h, d] = prop.size;
    if (prop.kind === "heart") {
      // His heart: its own animated object, shown once the King has fallen.
      const ht = createHeart(prop);
      ht.object.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      ht.object.rotation.y = (prop.yaw ?? 0) * DEG;
      ht.object.name = `heart:${prop.id}`;
      ht.object.visible = heartsShown();
      hearts.set(prop.id, ht);
      group.add(ht.object);
    } else if (prop.kind === "pickup") {
      if (opts.pickups !== true) continue;
      const pk = createPickup(prop.item ?? "");
      pk.object.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      pk.object.name = `pickup:${prop.id}`;
      pickups.set(prop.id, pk);
      group.add(pk.object);
    } else if (prop.kind === "king") {
      // His own animated object (health bar, hit, fall) — never merged.
      if (!useKings) continue;
      const k = createKing(prop);
      k.object.position.set(prop.pos[0], prop.pos[1], prop.pos[2]);
      k.object.rotation.y = (prop.yaw ?? 0) * DEG;
      k.object.name = `king:${prop.id}`;
      kings.set(prop.id, k);
      group.add(k.object);
    } else if (prop.kind === "box") {
      push(propGeoms, room.floor, paint(place(new BoxGeometry(w, h, d).translate(0, h / 2, 0)), prop.color ?? PALETTE.face));
    } else if (prop.kind === "cylinder") {
      const g = new CylinderGeometry(0.5, 0.5, 1, 12).scale(w, h, d).translate(0, h / 2, 0);
      push(propGeoms, room.floor, paint(place(g), prop.color ?? PALETTE.face));
    } else if (prop.kind === "screen") {
      const depth = Math.max(d, 0.03);
      push(propGeoms, room.floor, paint(place(new BoxGeometry(w, h, depth).translate(0, h / 2, 0)), prop.color ?? "#202020"));
      // The panel faces local −z, i.e. the prop's yaw (like a terminal).
      const panel = place(new PlaneGeometry(w * 0.88, h * 0.82).rotateY(Math.PI).translate(0, h / 2, -depth / 2 - 0.003));
      const caption = prop.label && useLabels ? bin.add(captionScreenTexture(prop.label)) : null;
      if (caption) {
        const mesh = new Mesh(bin.add(panel), bin.add(new MeshBasicMaterial({ map: caption })));
        mesh.name = `screen:${prop.id}`;
        group.add(mesh);
      } else push(screenGeoms, room.floor, panel);
    } else if (prop.kind === "label" && useLabels && prop.label) {
      const ph = Math.max(h, 0.05);
      const map = bin.add(signTexture(prop.label, w / ph, prop.color ?? PALETTE.title));
      const geom = bin.add(place(new PlaneGeometry(w, ph).rotateY(Math.PI).translate(0, ph / 2, -d / 2 - 0.002)));
      const mesh = new Mesh(geom, bin.add(new MeshBasicMaterial(map ? { map } : { color: prop.color ?? PALETTE.title })));
      mesh.name = `sign:${prop.id}`;
      group.add(mesh);
    }
  }
  for (const [floorId, geoms] of propGeoms) {
    const merged = bin.add(merge(geoms));
    if (!merged) continue;
    const mesh = new Mesh(merged, mats.prop);
    mesh.name = `props:${floorId}`;
    floorGroup(floorId)?.add(mesh);
  }
  for (const [floorId, geoms] of screenGeoms) {
    const merged = bin.add(merge(geoms));
    if (!merged) continue;
    const mesh = new Mesh(merged, mats.propScreen);
    mesh.name = `screens:${floorId}`;
    floorGroup(floorId)?.add(mesh);
  }

  // ── Door leaves ───────────────────────────────────────────────────
  // A guarded door is shut: a dark leaf fills its gap (a hair narrower
  // than the gap, so it never z-fights the jambs) until the guard falls.
  const doors = new Map<string, Mesh>();
  if (useKings) {
    const leafTex = useLabels ? bin.add(captionScreenTexture("LOCKED")) : null;
    const leafMat = bin.add(new MeshLambertMaterial({ ...(leafTex ? { map: leafTex, color: 0x9a9fa8 } : { color: 0x3a3f47 }), side: DoubleSide }));
    for (const door of house.doors) {
      if (door.guard === undefined) continue;
      const gap = doorGap(house, door);
      const group = roomFloor(door.a);
      if (gap === null || !group) continue;
      const width = Math.max(0.02, gap.hi - gap.lo - 0.02);
      const height = Math.max(0.02, gap.top - gap.bottom);
      const geom = bin.add(new PlaneGeometry(width, height));
      // An "x" wall runs along x: the leaf faces ±z (the plane's default);
      // a "z" wall runs along z: turn the leaf to face ±x.
      if (gap.axis === "z") geom.rotateY(Math.PI / 2);
      const mesh = new Mesh(geom, leafMat);
      const mid = (gap.lo + gap.hi) / 2;
      mesh.position.set(gap.axis === "x" ? mid : gap.c, gap.bottom + height / 2, gap.axis === "x" ? gap.c : mid);
      mesh.name = `door:${door.id}`;
      mesh.userData.door = door.id;
      doors.set(door.id, mesh);
      group.add(mesh);
    }
  }

  // ── The outside ground (wave 26) ──────────────────────────────────
  // A dark plane a hair under the floors with a faint metre grid, so a
  // program who walks out of the front door has something to walk on —
  // the same rect as VR's ground, with every room on that floor cut out of
  // it (`groundCells`, VR's `HouseGeometry.cells`): a stairwell going down
  // from a room shows the stairs, never the ground.
  let ground: Group | null = null;
  const out = opts.ground === true ? outsideGround(house) : null;
  const outFloor = out ? floorGroup(out.floor) : undefined;
  if (out && outFloor) {
    const holes = house.rooms.filter((r) => r.floor === out.floor).map((r) => r.poly);
    const cells = groundCells(out.rect, holes);
    ground = new Group();
    ground.name = "ground";
    const planeGeom = merge(
      cells.map(([x0, z0, x1, z1]) => new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, out.y - 0.01, (z0 + z1) / 2)),
    );
    if (planeGeom) {
      const plane = new Mesh(bin.add(planeGeom), bin.add(new MeshLambertMaterial({ color: "#07081a" })));
      plane.name = "ground:plane";
      ground.add(plane);
    }
    // The grid, cell by cell (half-open, so no line is drawn twice).
    const pts: number[] = [];
    const y = out.y - 0.005;
    for (const [x0, z0, x1, z1] of cells) {
      for (let x = Math.ceil(x0 - 1e-9); x < x1 - 1e-9; x++) pts.push(x, y, z0, x, y, z1);
      for (let z = Math.ceil(z0 - 1e-9); z < z1 - 1e-9; z++) pts.push(x0, y, z, x1, y, z);
    }
    const gridGeom = bin.add(new BufferGeometry());
    gridGeom.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    const grid = new LineSegments(gridGeom, bin.add(new LineBasicMaterial({ color: "#2a3a7a", transparent: true, opacity: 0.35 })));
    grid.name = "ground:grid";
    ground.add(grid);
    outFloor.add(ground);
  }

  // ── Terminal screens ──────────────────────────────────────────────
  const terminals = new Map<string, Group>();
  const scanTex = tex(scanlineTexture);
  const haloTex = tex(() => glowTexture(false));
  const term = {
    bezel: bin.add(new BoxGeometry(SCREEN_W + 0.04, SCREEN_H + 0.04, 0.03).translate(0, 0, 0.015)),
    panel: bin.add(new PlaneGeometry(SCREEN_W, SCREEN_H).rotateY(Math.PI).translate(0, 0, -0.002)),
    scan: bin.add(new PlaneGeometry(SCREEN_W, SCREEN_H).rotateY(Math.PI).translate(0, 0, -0.004)),
    glow: bin.add(new PlaneGeometry(SCREEN_W + 0.5, SCREEN_H + 0.45).rotateY(Math.PI).translate(0, 0, 0.031)),
    bezelMat: bin.add(new MeshLambertMaterial({ color: PALETTE.face })),
    panelMat: bin.add(new MeshBasicMaterial(textured(tex(watchingTexture), PALETTE.watch))),
    scanMat: bin.add(
      new MeshBasicMaterial({
        ...(scanTex ? { map: scanTex } : { color: PALETTE.watch }),
        transparent: true,
        opacity: scanTex ? 1 : 0.15,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
    glowMat: bin.add(
      new MeshBasicMaterial({
        color: PALETTE.watch,
        ...(haloTex ? { map: haloTex } : {}),
        transparent: true,
        opacity: 0.25,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
  };
  // A camera window per terminal (hidden until a frame arrives): a Win98
  // bezel and a picture, proud of the screen. Unlit, so it reads in a dark room.
  const feedParts = {
    bezel: bin.add(new BoxGeometry(FEED_W + 0.03, FEED_H + 0.03, 0.012).translate(0, 0, -0.008)),
    plane: bin.add(new PlaneGeometry(FEED_W, FEED_H).rotateY(Math.PI).translate(0, 0, -0.0145)),
    bezelMat: bin.add(new MeshLambertMaterial({ color: PALETTE.face, emissive: PALETTE.shadow, emissiveIntensity: 0.35 })),
  };
  const feeds = new Map<string, { window: Group; screen: Object3D[]; mat: MeshBasicMaterial; tex: CanvasTexture | null; ctx: CanvasRenderingContext2D | null }>();
  if (opts.terminals !== false) {
    for (const spot of house.terminals) {
      const group = roomFloor(spot.room);
      if (!group) continue;
      const t = terminalGroup(spot, style.wallThickness, term);
      const k = opts.terminalScale ?? 1;
      if (Number.isFinite(k) && k > 0) t.scale.set(k, k, 1);
      const window = new Group();
      window.name = "feed";
      window.visible = false;
      const mat = bin.add(new MeshBasicMaterial({ color: "#ffffff" }));
      const bezel = new Mesh(feedParts.bezel, feedParts.bezelMat);
      bezel.name = "feed-bezel";
      const picture = new Mesh(feedParts.plane, mat);
      picture.name = "feed-picture";
      picture.renderOrder = 3;
      window.add(bezel, picture);
      t.add(window);
      feeds.set(spot.id, { window, screen: t.children.filter((c) => c.name === "panel" || c.name === "scanlines"), mat, tex: null, ctx: null });
      terminals.set(spot.id, t);
      group.add(t);
    }
  }

  // ── Room labels ───────────────────────────────────────────────────
  const labels = new Map<string, Sprite>();
  if (useLabels) {
    for (const room of house.rooms) {
      const group = floorGroup(room.floor);
      const made = titleBarTexture(room.label, room.location && room.location !== room.label ? room.location : undefined);
      if (!group || !made) continue;
      bin.add(made.texture);
      const sprite = new Sprite(bin.add(new SpriteMaterial({ map: made.texture, transparent: true, depthWrite: false })));
      const [x, z] = labelPoint(room.poly);
      // Under the ceiling, clear of a standing head (eye height 1.6).
      const top = room.outdoor ? 2.4 : roomHeight(house, room);
      const height = room.location && room.location !== room.label ? 0.36 : 0.22;
      sprite.scale.set(height * made.aspect, height, 1);
      sprite.position.set(x, roomElevation(house, room) + Math.min(Math.max(top - 0.08, 1.85 + height) - height / 2, top - 0.01 - height / 2), z);
      sprite.name = `label:${room.id}`;
      sprite.userData.room = room.id;
      labels.set(room.id, sprite);
      group.add(sprite);
    }
  }

  let time = 0;
  let disposed = false;
  const eye = new Vector3();
  const at = new Vector3();
  return {
    root,
    floors,
    terminals,
    labels,
    ceilings,
    walls,
    kings,
    doors,
    hearts,
    pickups,
    ground,
    showKing(id: string, king: { hp: number; max: number; fallen: boolean }, open = king.fallen) {
      if (disposed || !kingFallen.has(id)) return;
      kingFallen.set(id, king.fallen);
      const shown = heartsShown();
      for (const ht of hearts.values()) ht.object.visible = shown;
      const k = kings.get(id);
      if (k === undefined) return;
      k.setHp(king.hp, king.max);
      k.kneel(king.fallen);
      for (const door of house.doors) {
        if (door.guard !== id) continue;
        const leaf = doors.get(door.id);
        if (leaf !== undefined) leaf.visible = !open;
      }
    },
    setPickupTaken(id: string, taken: boolean): boolean {
      const pk = pickups.get(id);
      if (pk === undefined || disposed) return false;
      pk.object.visible = !taken;
      return true;
    },
    setTerminalFeed(id: string, source: CanvasImageSource | null): boolean {
      const f = feeds.get(id);
      if (f === undefined || disposed) return false;
      const show = (on: boolean): boolean => {
        f.window.visible = on;
        for (const o of f.screen) o.visible = !on;
        return on;
      };
      if (source === null) return show(false);
      if (f.ctx === null) {
        if (!hasDom()) return show(false);
        const c = document.createElement("canvas");
        [c.width, c.height] = FEED_PX;
        const ctx = c.getContext("2d");
        if (ctx === null) return show(false);
        f.ctx = ctx;
        f.tex = bin.add(new CanvasTexture(c));
        f.tex.colorSpace = SRGBColorSpace;
        f.mat.map = f.tex;
        f.mat.needsUpdate = true;
      }
      try {
        f.ctx.drawImage(source, 0, 0, FEED_PX[0], FEED_PX[1]);
      } catch {
        return show(false); // a closed bitmap, a broken image
      }
      if (f.tex !== null) f.tex.needsUpdate = true;
      return show(true);
    },
    update(dt: number, camera?: Camera) {
      if (disposed || !Number.isFinite(dt)) return;
      time += dt;
      for (const k of kings.values()) k.update(dt, camera);
      for (const ht of hearts.values()) if (ht.object.visible) ht.update(dt);
      for (const pk of pickups.values()) if (pk.object.visible) pk.update(dt);
      if (camera) {
        camera.getWorldPosition(eye);
        for (const sprite of labels.values()) {
          const d = sprite.getWorldPosition(at).distanceTo(eye);
          const o = Math.min(Math.max((d - LABEL_FADE[0]) / (LABEL_FADE[1] - LABEL_FADE[0]), 0), 1);
          sprite.material.opacity = o;
          sprite.visible = o > 0.01;
        }
      }
      if (scanTex) scanTex.offset.y = (time * 0.35) % 1;
      else term.scanMat.opacity = 0.12 + 0.06 * Math.sin(time * 9);
      // "Watching": a slow breathing glow with a faint flicker.
      const base = haloTex ? 0.7 : 0.22;
      term.glowMat.opacity = base + 0.1 * Math.sin(time * 2.2) + 0.03 * Math.sin(time * 31);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      for (const k of kings.values()) k.dispose();
      for (const ht of hearts.values()) ht.dispose();
      for (const pk of pickups.values()) pk.dispose();
      bin.dispose();
    },
  };
}

function floorTint(plane: FloorPlane): string {
  return plane.color ?? (plane.outdoor ? PALETTE.grass : PALETTE.floor);
}

/**
 * The outside ground's cells: `rect` (`[x0, z0, x1, z1]`) less the `holes`
 * (the rooms on its floor), as axis-aligned `[x0, z0, x1, z1]` cells on the
 * breakpoint grid, runs merged along x — a port of VR's
 * `HouseGeometry.cells(outer, holes)` for `_build_ground`.
 */
function groundCells(rect: readonly [number, number, number, number], holes: Vec2[][]): [number, number, number, number][] {
  const [rx0, rz0, rx1, rz1] = rect;
  const xs = breakpoints([rx0, rx1, ...holes.flatMap((h) => h.map((q) => q[0]))]);
  const zs = breakpoints([rz0, rz1, ...holes.flatMap((h) => h.map((q) => q[1]))]);
  const out: [number, number, number, number][] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    let start = -1;
    for (let i = 0; i < xs.length; i++) {
      let inside = false;
      if (i + 1 < xs.length) {
        const c: Vec2 = [(xs[i]! + xs[i + 1]!) / 2, (zs[j]! + zs[j + 1]!) / 2];
        inside = c[0] > rx0 && c[0] < rx1 && c[1] > rz0 && c[1] < rz1 && !holes.some((h) => pointInPolyStrict(h, c));
      }
      if (inside && start < 0) start = i;
      else if (!inside && start >= 0) {
        out.push([xs[start]!, zs[j]!, xs[i]!, zs[j + 1]!]);
        start = -1;
      }
    }
  }
  return out;
}

/**
 * A room's floor (facing up) or ceiling (facing down) as a flat mesh at its
 * `y`. The shape is drawn in a 2-D plane and turned into XZ: a floor maps
 * shape `(x, −z)` through `rotateX(−90°)` (`(x, y, 0) → (x, 0, −y)`), a
 * ceiling maps `(x, z)` through `rotateX(+90°)` (`(x, y, 0) → (x, 0, y)`).
 * Both land on the plan point `[x, z]`; the rotation picks the facing.
 * UVs are the shape coordinates — metres.
 */
export function planeGeometry(plane: FloorPlane): BufferGeometry {
  const up = plane.kind === "floor";
  const to = (p: Vec2): [number, number] => (up ? [p[0], -p[1]] : [p[0], p[1]]);
  const shape = new Shape();
  plane.poly.forEach((p, i) => (i === 0 ? shape.moveTo(...to(p)) : shape.lineTo(...to(p))));
  shape.closePath();
  for (const hole of plane.holes) {
    const path = new Path();
    hole.forEach((p, i) => (i === 0 ? path.moveTo(...to(p)) : path.lineTo(...to(p))));
    path.closePath();
    shape.holes.push(path);
  }
  const g = new ShapeGeometry(shape);
  g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  g.translate(0, plane.y, 0);
  return g;
}

/** A stair's sloped quad, facing up, UVs in metres like the floors. */
export function rampGeometry(ramp: Ramp): BufferGeometry {
  const g = new BufferGeometry();
  const pos = new Float32Array(12);
  const uv = new Float32Array(8);
  ramp.corners.forEach((c, i) => {
    pos.set(c, i * 3);
    uv.set([c[0], -c[2]], i * 2);
  });
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("uv", new BufferAttribute(uv, 2));
  // Plan order [x0,z0] [x1,z0] [x1,z1] [x0,z1]: (0,2,1) + (0,3,2) face +y.
  g.setIndex([0, 2, 1, 0, 3, 2]);
  g.computeVertexNormals();
  return g;
}

/** A terminal's screen: bezel + "watching" panel + scanlines + a halo on the wall. */
function terminalGroup(
  spot: TerminalSpot,
  wallThickness: number,
  parts: {
    bezel: BufferGeometry;
    panel: BufferGeometry;
    scan: BufferGeometry;
    glow: BufferGeometry;
    bezelMat: Material;
    panelMat: Material;
    scanMat: Material;
    glowMat: Material;
  },
): Group {
  const g = new Group();
  g.name = `terminal:${spot.id}`;
  g.userData.spot = spot;
  // Stand proud of the (rendering-only) wall box the spot sits on.
  const f = forward(spot.yaw, spot.pitch ?? 0);
  const out = wallThickness / 2 + 0.035;
  g.position.set(spot.pos[0] + f[0] * out, spot.pos[1] + f[1] * out, spot.pos[2] + f[2] * out);
  g.rotation.order = "YXZ";
  g.rotation.y = spot.yaw * DEG;
  g.rotation.x = (spot.pitch ?? 0) * DEG;
  const mesh = (geom: BufferGeometry, mat: Material, name: string, order = 0): Object3D => {
    const m = new Mesh(geom, mat);
    m.name = name;
    m.renderOrder = order;
    return m;
  };
  g.add(
    mesh(parts.glow, parts.glowMat, "glow", 1),
    mesh(parts.bezel, parts.bezelMat, "bezel"),
    mesh(parts.panel, parts.panelMat, "panel"),
    mesh(parts.scan, parts.scanMat, "scanlines", 2),
  );
  return g;
}

