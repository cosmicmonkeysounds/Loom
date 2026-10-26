//! Trabolta's heart (wave 26, R6) — a `heart` prop: a dark rack standing in
//! the in-game server room with a slowly beating, glowing core behind a
//! smoked front. Deliberately plain: no labels, no rows, no coloured lights
//! — nothing that could read as the real room's patch bay. Sized to the
//! prop's `size` (a 0.6 × 1.7 × 0.6 rack when it has none); place `object`
//! at `pos` (the base centre) and turn it to `yaw` (the core faces local
//! `−z`, the prop's yaw).
//!
//! Driven by `update(dt)` — no timers — like the duck and the King. The
//! beat is a slow "lub-dub" every `HEART_BEAT_S` seconds.

import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Sprite, SpriteMaterial } from "three";
import type { Prop, Vec3 } from "../types.ts";
import { Bin, merge } from "./dispose.ts";
import { glowTexture } from "./textures.ts";

/** Seconds per heartbeat (a resting 50 bpm: slow, heavy). */
export const HEART_BEAT_S = 1.2;
/** The core's colour (a deep ember red). */
export const HEART_COLOR = "#c8102e";
const DEFAULT_SIZE: Vec3 = [0.6, 1.7, 0.6];

export interface Heart {
  /** Place at the prop's `pos` (the base centre); `rotation.y` = yaw. */
  object: Group;
  /** Advance by `dt` seconds (the beat). */
  update(dt: number): void;
  /** 0 … 1: how hard the core glows now (1 at the top of a beat). */
  readonly pulse: number;
  dispose(): void;
}

/** The beat's shape at phase `t` (seconds into a beat): two thumps, then rest. */
export function heartPulse(t: number): number {
  const p = ((t % HEART_BEAT_S) + HEART_BEAT_S) % HEART_BEAT_S;
  const thump = (at: number, width: number, height: number): number => {
    const x = (p - at) / width;
    return x < 0 || x > 1 ? 0 : height * Math.sin(x * Math.PI);
  };
  return Math.min(1, thump(0, 0.18, 1) + thump(0.24, 0.22, 0.65));
}

export function createHeart(prop?: Pick<Prop, "size" | "color">): Heart {
  const bin = new Bin();
  const [w, h, d] = prop?.size ?? DEFAULT_SIZE;
  const shell = bin.add(new MeshLambertMaterial({ color: prop?.color ?? "#141418", flatShading: true }));
  const smoke = bin.add(new MeshBasicMaterial({ color: 0x0a0a10, transparent: true, opacity: 0.55, depthWrite: false }));
  const core = bin.add(new MeshBasicMaterial({ color: HEART_COLOR, transparent: true, opacity: 0.85 }));
  const halo = glowTexture(false);
  bin.add(halo);
  // The halo needs a canvas (a sprite's geometry is three's shared one): none under node.
  const glow = halo ? bin.add(new SpriteMaterial({ color: HEART_COLOR, map: halo, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false })) : null;

  const object = new Group();
  object.name = "heart";

  // The rack: a dark cabinet on a plinth, a recess for the core on its face.
  const body = bin.add(
    merge([
      new BoxGeometry(w, h * 0.04, d).translate(0, h * 0.02, 0),
      new BoxGeometry(w * 0.94, h * 0.92, d * 0.94).translate(0, h * 0.5, 0),
      new BoxGeometry(w, h * 0.04, d).translate(0, h * 0.98, 0),
    ]),
  )!;
  const cabinet = new Mesh(body, shell);
  cabinet.name = "heart:rack";
  object.add(cabinet);

  const coreY = h * 0.55;
  const coreR = Math.min(w, h) * 0.2;
  const coreMesh = new Mesh(bin.add(new SphereGeometry(coreR, 14, 10)), core);
  coreMesh.name = "heart:core";
  coreMesh.position.set(0, coreY, -d * 0.2);
  object.add(coreMesh);

  const front = new Mesh(bin.add(new BoxGeometry(w * 0.8, h * 0.55, 0.01)), smoke);
  front.name = "heart:front";
  front.position.set(0, coreY, -d * 0.47 - 0.006);
  object.add(front);

  const glowSize = coreR * 5;
  const sprite = glow ? new Sprite(glow) : null;
  if (sprite) {
    sprite.name = "heart:glow";
    sprite.position.set(0, coreY, -d * 0.5 - 0.02);
    sprite.scale.set(glowSize, glowSize, 1);
    object.add(sprite);
  }

  let clock = 0;
  let pulse = 0;
  const apply = (): void => {
    pulse = heartPulse(clock);
    const s = 1 + 0.14 * pulse;
    coreMesh.scale.set(s, s, s);
    core.opacity = 0.7 + 0.3 * pulse;
    if (glow) glow.opacity = 0.35 + 0.55 * pulse;
    sprite?.scale.set(glowSize * (1 + 0.25 * pulse), glowSize * (1 + 0.25 * pulse), 1);
  };
  apply();

  return {
    object,
    get pulse() {
      return pulse;
    },
    update(dt: number) {
      if (!Number.isFinite(dt) || dt < 0) return;
      clock += dt;
      apply();
    },
    dispose() {
      object.removeFromParent();
      bin.dispose();
    },
  };
}
