//! The `self` vision's copy is a swarm: the vision builds on it (it once
//! painted a capsule's material, and a shader material has no colour), and
//! the copy keeps its clock and fades by losing shards.
import { describe, expect, it } from "vitest";
import { Color, FogExp2, Group, Scene, type ShaderMaterial } from "three";
import { Visions, type VisionsOptions } from "../src/game/visions.ts";

function visions(): { v: Visions; uniform: (name: string) => unknown } {
  const scene = new Scene();
  scene.fog = new FogExp2(0x101018, 0.02);
  scene.background = new Color(0x101018);
  const root = new Group();
  const o = { root, scene, lamps: {}, sfx: {}, level: 3, name: "Excel", guest: "g-1", picture: null, view: () => ({}), setExposure: () => {} };
  const v = new Visions(o as unknown as VisionsOptions);
  const body = v.object.getObjectByName("avatar:body") as unknown as { material: ShaderMaterial };
  return { v, uniform: (name) => (body.material.uniforms[name] as { value: unknown }).value };
}

describe("the program's own copy", () => {
  it("is built on the swarm", () => {
    expect(visions().uniform("uPresent")).toBe(1);
  });

  it("runs its clock and fades by losing shards while it walks", () => {
    const { v, uniform } = visions();
    const bare = v as unknown as { track: { p: number[]; yaw: number }[]; updateCopy(dt: number, run: { s: number }, view: { body: { p: number[] } }): void };
    bare.track = [{ p: [0, 0, 0], yaw: 0 }];
    bare.updateCopy(0.5, { s: 0 }, { body: { p: [1, 0, 1] } });
    const before = uniform("uTime") as number;
    bare.updateCopy(0.5, { s: 0 }, { body: { p: [1, 0, 1] } });
    expect(uniform("uTime") as number).toBeCloseTo(before + 0.5);
    expect(uniform("uPresent")).toBe(0);
  });
});
