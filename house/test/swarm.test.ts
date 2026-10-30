// The swarm's layout and trail (pure), and the Godot port kept in step: the
// shader itself only runs on a GPU, so the VR copy is compared by its numbers.

import { readFileSync } from "node:fs";
import { Color } from "three";
import { describe, expect, it } from "vitest";
import { swarmLayout, swarmMaterial, swarmRadiusAt, SwarmTrail, SWARM_BODY_SHARDS, SWARM_FACE_GRID, SWARM_FACE_SIZE, SWARM_FACE_Y, SWARM_HEIGHT, SWARM_RADIUS, SWARM_SHARDS, SWARM_STEP_HZ, SWARM_STORM_S, SWARM_TELEPORT_M, SWARM_TRAIL, SWARM_TRAIL_STEP_S } from "../src/three/swarm.ts";
import type { Vec3 } from "../src/types.ts";

const faceOf = (s: { rand: number[] }) => s.rand[3]! >= 1;
const godot = (name: string) => readFileSync(new URL(`../../reinstall/vr/game/${name}`, import.meta.url), "utf8");

describe("the swarm's layout", () => {
  const shards = swarmLayout();

  it("is the same every time, and the face's first", () => {
    expect(swarmLayout()).toEqual(shards);
    expect(shards).toHaveLength(SWARM_SHARDS);
    expect(shards.slice(0, SWARM_FACE_GRID ** 2).every(faceOf)).toBe(true);
    expect(shards.slice(SWARM_FACE_GRID ** 2).some(faceOf)).toBe(false);
    expect(SWARM_BODY_SHARDS).toBeGreaterThan(0);
  });

  it("the face is the whole picture, cell by cell, once", () => {
    const area = shards.filter(faceOf).reduce((a, s) => a + s.cell[2] * s.cell[3], 0);
    expect(area).toBeCloseTo(1);
    const keys = new Set(shards.filter(faceOf).map((s) => `${s.cell[0].toFixed(4)},${s.cell[1].toFixed(4)}`));
    expect(keys.size).toBe(SWARM_FACE_GRID ** 2);
  });

  it("every shard rests inside the collider, and shows a piece inside the picture", () => {
    for (const s of shards) {
      expect(Math.hypot(s.home[0], s.home[2])).toBeLessThanOrEqual(SWARM_RADIUS * 1.2 + 1e-9);
      expect(s.home[1]).toBeGreaterThan(0);
      expect(s.home[1]).toBeLessThanOrEqual(SWARM_HEIGHT);
      expect(s.cell[0] + s.cell[2]).toBeLessThanOrEqual(1 + 1e-9);
      expect(s.cell[1] + s.cell[3]).toBeLessThanOrEqual(1 + 1e-9);
    }
    expect(swarmRadiusAt(0.9)).toBeGreaterThan(swarmRadiusAt(0));
    expect(swarmRadiusAt(0.9)).toBeLessThanOrEqual(SWARM_RADIUS);
  });

  it("pins two shards, the same ones reinstall/vr/test/game.gd pins", () => {
    expect(shards[0]!.home[1]).toBeCloseTo(0.9204645976540632, 6);
    expect(shards[0]!.rand[0]).toBeCloseTo(0.4209635134320706, 6);
    expect(shards[100]!.size[0]).toBeCloseTo(0.023696090903909256, 6);
    expect(shards[100]!.cell[0]).toBeCloseTo(0.5556649875167446, 6);
  });
});

describe("SwarmTrail", () => {
  const walk = (t: SwarmTrail, from: number, frames: number, dx: number, dt: number): Vec3 => {
    let x = from;
    for (let i = 0; i < frames; i++) {
      x += dx;
      t.step([x, 0, 0], dt);
    }
    return [x, 0, 0];
  };

  it("starts on the body, and stays there standing still", () => {
    const t = new SwarmTrail();
    t.step([4, 0, 2], 0.016);
    t.step([4, 0, 2], 0.016);
    expect(t.offsets).toHaveLength(SWARM_TRAIL);
    for (const o of t.offsets) expect(o).toEqual([0, 0, 0]);
  });

  it("hangs behind a walk, further back the older the point, and catches up when it stops", () => {
    const t = new SwarmTrail();
    t.step([0, 0, 0], 0.016);
    const at = walk(t, 0, 60, 0.02, 0.016);
    expect(t.offsets[0]).toEqual([0, 0, 0]);
    expect(t.offsets[SWARM_TRAIL - 1]![0]).toBeLessThan(-0.5);
    expect(t.offsets[4]![0]).toBeGreaterThan(t.offsets[SWARM_TRAIL - 1]![0]);
    walk(t, at[0], Math.ceil((SWARM_TRAIL * SWARM_TRAIL_STEP_S) / 0.016) + 2, 0, 0.016);
    for (const o of t.offsets) expect(o[0]).toBeCloseTo(0);
  });

  it("a teleport starts it again: no shard flies across the house", () => {
    const t = new SwarmTrail();
    t.step([0, 0, 0], 0.016);
    walk(t, 0, 30, 0.02, 0.016);
    t.step([SWARM_TELEPORT_M + 5, 0, 0], 0.016);
    for (const o of t.offsets) expect(o).toEqual([0, 0, 0]);
  });
});

describe("the Godot port", () => {
  const shader = godot("swarm.gdshader");
  const constant = (name: string) => Number(new RegExp(`const float ${name} = ([0-9.]+);`, "u").exec(shader)?.[1]);

  it("shares the shader's constants", () => {
    expect(constant("STEP_HZ")).toBe(SWARM_STEP_HZ);
    expect(constant("STORM_S")).toBe(SWARM_STORM_S);
    expect(constant("FACE_GRID")).toBe(SWARM_FACE_GRID);
    expect(constant("FACE_SIZE")).toBe(SWARM_FACE_SIZE);
    expect(constant("FACE_Y")).toBe(SWARM_FACE_Y);
    expect(constant("HEIGHT")).toBe(SWARM_HEIGHT);
    expect(Number(/const int TRAIL = (\d+);/u.exec(shader)?.[1])).toBe(SWARM_TRAIL);
  });

  it("shares the layout's constants", () => {
    const script = godot("swarm.gd");
    const of = (name: string) => Number(new RegExp(`const ${name} := ([0-9.]+)`, "u").exec(script)?.[1]);
    expect(of("FACE_GRID")).toBe(SWARM_FACE_GRID);
    expect(of("BODY_SHARDS")).toBe(SWARM_BODY_SHARDS);
    expect(of("RADIUS")).toBe(SWARM_RADIUS);
    expect(of("TRAIL_STEP_S")).toBe(SWARM_TRAIL_STEP_S);
    expect(of("TELEPORT_M")).toBe(SWARM_TELEPORT_M);
  });

  it("every tuning number in main() is in vertex(), and the other way round", () => {
    const numbers = (code: string) =>
      (code.match(/\d+\.\d+/gu) ?? [])
        .map((n) => Number(n))
        .sort((a, b) => a - b);
    const three = swarmMaterial(0, new Color()).vertexShader;
    const ts = three.slice(three.indexOf("void main()"));
    const gd = shader.slice(shader.indexOf("void vertex()"), shader.indexOf("void fragment()"));
    // Only three has: `here` (a shard dropped, the shadow view's), the flip; only Godot: the v flip.
    const threeOnly = ts.replace(/float here = .*\n/u, "").replace(/vUv = .*\n/u, "");
    const named = /\b(STEP_HZ|STORM_S|FACE_GRID|FACE_SIZE|FACE_Y|HEIGHT)\b/gu;
    const inlined = gd.replace(named, (n) => String(constant(n)).replace(/^(\d+)$/u, "$1.0")).replace(/v_uv = .*\n/u, "");
    expect(numbers(threeOnly)).toEqual(numbers(inlined));
  });
});
