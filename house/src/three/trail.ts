//! The indicator trail — "follow the indicators": golden chevrons every
//! 0.75 m along a route polyline (`route(house, player, duck)`), just above
//! the floor, each pointing the way to walk, a pulse running through them in
//! sequence toward the duck. One `InstancedMesh`, so the whole trail is a
//! single draw call; `set()` is cheap enough to call twice a second.
//!
//! Positions come from `trailPoints` (anchored at the duck end, so the
//! chevrons ahead stand still while the player walks).

import { AdditiveBlending, Color, DoubleSide, Group, InstancedMesh, MeshBasicMaterial, Object3D, Shape, ShapeGeometry } from "three";
import type { Vec3 } from "../types.ts";
import { Bin, DEG } from "./dispose.ts";
import { trailPoints } from "./layout.ts";
import type { TrailPoint } from "./layout.ts";

/** Metres between chevrons. */
export const TRAIL_STEP = 0.75;
/** Height above the path (the floor) a chevron floats. */
export const TRAIL_LIFT = 0.04;

export interface TrailOptions {
  step?: number;
  lift?: number;
  /** Chevron colour (default gold). */
  color?: string;
}

export interface Trail {
  object: Group;
  /** Lay the trail along a route polyline (house frame); `[]` clears it. */
  set(points: readonly Vec3[]): void;
  /** Advance the pulse by `dt` seconds. */
  update(dt: number): void;
  /** The chevrons currently shown, in walking order. */
  readonly points: readonly TrailPoint[];
  dispose(): void;
}

/**
 * A flat chevron lying in XZ, its tip toward local `−z` (forward): the
 * outline is drawn in shape space with the tip at `+y`, then `rotateX(−90°)`
 * maps shape `(x, y)` to `(x, 0, −y)`, facing up.
 */
export function chevronGeometry(): ShapeGeometry {
  const s = new Shape();
  s.moveTo(0, 0.1);
  s.lineTo(-0.18, -0.08);
  s.lineTo(-0.18, -0.17);
  s.lineTo(0, 0.01);
  s.lineTo(0.18, -0.17);
  s.lineTo(0.18, -0.08);
  s.closePath();
  const g = new ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
}

export function createTrail(opts: TrailOptions = {}): Trail {
  const step = opts.step ?? TRAIL_STEP;
  const lift = opts.lift ?? TRAIL_LIFT;
  const bin = new Bin();
  const geom = bin.add(chevronGeometry());
  const mat = bin.add(
    new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }),
  );
  const gold = new Color(opts.color ?? "#ffc83d");
  const object = new Group();
  object.name = "trail";

  let mesh: InstancedMesh | null = null;
  let capacity = 0;
  let points: TrailPoint[] = [];
  let time = 0;
  const dummy = new Object3D();
  const tint = new Color();

  const ensure = (n: number): InstancedMesh => {
    if (mesh && n <= capacity) return mesh;
    if (mesh) {
      object.remove(mesh);
      mesh.dispose();
    }
    capacity = Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(n, 1))));
    mesh = new InstancedMesh(geom, mat, capacity);
    mesh.name = "trail:chevrons";
    mesh.frustumCulled = false;
    object.add(mesh);
    return mesh;
  };

  const paint = () => {
    if (!mesh) return;
    // A bright pulse travelling toward the duck, ~2 chevrons/s.
    for (let i = 0; i < points.length; i++) {
      const phase = time * 1.6 - i * 0.14;
      const b = 0.28 + 0.72 * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2)) ** 6;
      mesh.setColorAt(i, tint.copy(gold).multiplyScalar(b));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  return {
    object,
    get points() {
      return points;
    },
    set(path: readonly Vec3[]) {
      points = trailPoints(path, step);
      const m = ensure(points.length);
      points.forEach((pt, i) => {
        dummy.position.set(pt.p[0], pt.p[1] + lift, pt.p[2]);
        dummy.rotation.set(0, pt.yaw * DEG, 0);
        dummy.updateMatrix();
        m.setMatrixAt(i, dummy.matrix);
      });
      m.count = points.length;
      m.instanceMatrix.needsUpdate = true;
      paint();
    },
    update(dt: number) {
      if (!Number.isFinite(dt)) return;
      time += dt;
      paint();
    },
    dispose() {
      object.removeFromParent();
      mesh?.dispose();
      mesh = null;
      bin.dispose();
    },
  };
}
