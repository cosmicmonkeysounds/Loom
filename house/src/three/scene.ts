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
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { Camera, Material, Object3D, Scene, Texture } from "three";
import { forward } from "../frames.ts";
import { buildFloors, buildRamps, buildWalls, roomById, roomElevation, roomHeight, styleOf } from "../geometry.ts";
import type { FloorPlane, HouseMap, Ramp, TerminalSpot, Vec2, WallKind, WallSegment } from "../types.ts";
import { Bin, DEG, merge, paint, projectUvs } from "./dispose.ts";
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
  /** Precomputed `buildWalls(house)`, to skip computing it again. */
  walls?: WallSegment[];
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

  // ── Props ─────────────────────────────────────────────────────────
  const propGeoms = new Map<string, BufferGeometry[]>();
  const screenGeoms = new Map<string, BufferGeometry[]>();
  const push = (m: Map<string, BufferGeometry[]>, floor: string, g: BufferGeometry) => {
    const list = m.get(floor) ?? [];
    list.push(g);
    m.set(floor, list);
  };
  for (const prop of house.props) {
    const room = roomById(house, prop.room);
    const group = roomFloor(prop.room);
    if (!room || !group) continue;
    const place = (g: BufferGeometry) => g.rotateY((prop.yaw ?? 0) * DEG).translate(prop.pos[0], prop.pos[1], prop.pos[2]);
    const [w, h, d] = prop.size;
    if (prop.kind === "box") {
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
  if (opts.terminals !== false) {
    for (const spot of house.terminals) {
      const group = roomFloor(spot.room);
      if (!group) continue;
      const t = terminalGroup(spot, style.wallThickness, term);
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
    update(dt: number, camera?: Camera) {
      if (disposed || !Number.isFinite(dt)) return;
      time += dt;
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
      bin.dispose();
    },
  };
}

function floorTint(plane: FloorPlane): string {
  return plane.color ?? (plane.outdoor ? PALETTE.grass : PALETTE.floor);
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

