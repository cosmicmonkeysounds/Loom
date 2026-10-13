//! Other players as ghosts: a translucent capsule tinted by a seed, a
//! glowing visor that shows where they look, a soft ring on the floor under
//! them, and a name tag styled as a Windows 98 title bar (canvas — skipped
//! without a DOM). Feed it interpolated poses (`PoseBuffer`) in house
//! coordinates; `p` is the body's base (the feet, floor level), as on the
//! wire.

import {
  AdditiveBlending,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  Sprite,
  SpriteMaterial,
} from "three";
import { fnv1a32 } from "../duck.ts";
import type { Vec3 } from "../types.ts";
import { Bin, DEG } from "./dispose.ts";
import { titleBarTexture } from "./textures.ts";

/** Body height (the top of the capsule). */
export const AVATAR_HEIGHT = 1.6;
const RADIUS = 0.22;
const EYE = 1.42;
const TAG_HEIGHT = 0.16;

export interface Avatar {
  object: Group;
  /** The name tag sprite (null without a DOM). */
  tag: Sprite | null;
  /** House-frame pose: base position, yaw + pitch in degrees (pitch > 0 looks up). */
  setPose(p: Vec3, yaw: number, pitch?: number): void;
  /** Ghostly shimmer; `dt` seconds. */
  update(dt: number): void;
  dispose(): void;
}

/** The ghost colour for a seed (a guest id, a session id, …): a bright hue. */
export function avatarColor(seed: string | number): Color {
  const h = typeof seed === "number" ? Math.abs(Math.floor(seed)) : fnv1a32(seed);
  return new Color().setHSL((h % 360) / 360, 0.75, 0.62);
}

export function createAvatar(name: string, colorSeed: string | number = name): Avatar {
  const bin = new Bin();
  const color = avatarColor(colorSeed);
  const object = new Group();
  object.name = `avatar:${name}`;
  /** Yaw turns the body; the head pitches inside it. */
  const body = new Group();
  object.add(body);

  const ghostMat = bin.add(
    new MeshLambertMaterial({
      color,
      emissive: color.clone().multiplyScalar(0.35),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  const length = AVATAR_HEIGHT - 2 * RADIUS;
  const capsule = new Mesh(bin.add(new CapsuleGeometry(RADIUS, length, 4, 12)), ghostMat);
  capsule.name = "avatar:body";
  capsule.position.y = AVATAR_HEIGHT / 2;
  capsule.renderOrder = 3;
  body.add(capsule);

  // The visor: a curved band on the front (−z) of the head; cylinder angle
  // θ puts a vertex at (sin θ, ·, cos θ), so the front is θ = π.
  const head = new Group();
  head.name = "avatar:head";
  head.position.y = EYE;
  body.add(head);
  const visorMat = bin.add(
    new MeshBasicMaterial({ color: 0x9ffcff, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false }),
  );
  const visor = new Mesh(bin.add(new CylinderGeometry(RADIUS + 0.012, RADIUS + 0.012, 0.09, 12, 1, true, Math.PI - 0.95, 1.9)), visorMat);
  visor.name = "avatar:visor";
  visor.renderOrder = 4;
  head.add(visor);

  const ringMat = bin.add(
    new MeshBasicMaterial({ color, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  const ring = new Mesh(bin.add(new RingGeometry(RADIUS + 0.04, RADIUS + 0.14, 24).rotateX(-Math.PI / 2)), ringMat);
  ring.name = "avatar:ring";
  ring.position.y = 0.02;
  object.add(ring);

  let tag: Sprite | null = null;
  const made = titleBarTexture(name, undefined, { buttons: true });
  if (made) {
    bin.add(made.texture);
    tag = new Sprite(bin.add(new SpriteMaterial({ map: made.texture, depthTest: false, depthWrite: false, transparent: true })));
    tag.name = "avatar:tag";
    tag.scale.set(TAG_HEIGHT * made.aspect, TAG_HEIGHT, 1);
    tag.position.y = AVATAR_HEIGHT + 0.25;
    tag.renderOrder = 10;
    object.add(tag);
  }

  let time = fnv1a32(String(colorSeed)) % 1000;
  return {
    object,
    tag,
    setPose(p: Vec3, yaw: number, pitch = 0) {
      object.position.set(p[0], p[1], p[2]);
      body.rotation.y = yaw * DEG;
      head.rotation.x = Math.max(-80, Math.min(80, pitch)) * DEG;
    },
    update(dt: number) {
      if (!Number.isFinite(dt)) return;
      time += dt;
      ghostMat.opacity = 0.4 + 0.08 * Math.sin(time * 2.1);
      capsule.position.y = AVATAR_HEIGHT / 2 + 0.025 * Math.sin(time * 1.4);
      ringMat.opacity = 0.35 + 0.2 * Math.sin(time * 3);
    },
    dispose() {
      object.removeFromParent();
      bin.dispose();
    },
  };
}
