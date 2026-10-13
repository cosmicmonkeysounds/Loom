//! Small shared helpers for the builders: a disposal bin (everything a
//! builder allocates goes in, `dispose()` frees it once), degree → radian,
//! vertex colours, metre-scaled box-projected UVs, and a merge that frees
//! its sources.

import { BufferAttribute, Color } from "three";
import type { BufferGeometry } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface Disposable {
  dispose(): void;
}

/** Collects GPU-backed objects; `dispose()` frees each once. */
export class Bin {
  private items = new Set<Disposable>();

  add<T extends Disposable | null>(item: T): T {
    if (item) this.items.add(item);
    return item;
  }

  dispose(): void {
    for (const item of this.items) item.dispose();
    this.items.clear();
  }

  get size(): number {
    return this.items.size;
  }
}

export const DEG = Math.PI / 180;

/** Paint every vertex of `geom` one colour (a `color` attribute, linear). */
export function paint(geom: BufferGeometry, color: string | Color): BufferGeometry {
  const c = color instanceof Color ? color : new Color(color);
  const n = geom.getAttribute("position").count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  geom.setAttribute("color", new BufferAttribute(data, 3));
  return geom;
}

/**
 * Box-project UVs from world positions (one UV unit = one metre): faces
 * pointing along y map `(x, z)`, along x map `(z, y)`, along z map `(x, y)`.
 * Run after the geometry is placed, so neighbouring walls tile seamlessly.
 */
export function projectUvs(geom: BufferGeometry, scale = 1): BufferGeometry {
  const pos = geom.getAttribute("position");
  const nor = geom.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) [u, v] = [x, z];
    else if (nx >= nz) [u, v] = [z, y];
    else [u, v] = [x, y];
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  geom.setAttribute("uv", new BufferAttribute(uv, 2));
  return geom;
}

/** Merge geometries (same attribute set) into one and dispose the sources; null when empty. */
export function merge(geoms: BufferGeometry[]): BufferGeometry | null {
  if (geoms.length === 0) return null;
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  if (!merged) throw new Error("@loom/house/three: geometries could not be merged (mismatched attributes)");
  return merged;
}
