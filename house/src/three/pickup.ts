//! A pickup (wave 26, R7) — a `pickup` prop: the thing a program walks up
//! to and takes. Every item is drawn as a 3.5" floppy disk (the show's one
//! pickup is the virus), spinning and bobbing over its spot with a sickly
//! green glow, sized up so it reads across a room. Its label is a plain
//! blank sticker — the map carries no text for it. Place `object` at the
//! prop's `pos` (the floor under it); the disk floats `PICKUP_HOVER` above.
//! Only the games draw it (`buildHouseScene({pickups: true})`).
//!
//! Driven by `update(dt)` — no timers.

import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, Sprite, SpriteMaterial } from "three";
import { Bin, merge } from "./dispose.ts";
import { glowTexture } from "./textures.ts";

/** The disk's centre, metres above the spot (at a hand's height). */
export const PICKUP_HOVER = 0.75;
/** How far it bobs up and down, metres. */
export const PICKUP_BOB = 0.06;
/** Turns per second. */
export const PICKUP_SPIN = 0.25;
/** The glow's colour (a sickly green). */
export const PICKUP_GLOW = "#7dff3a";
/** A real 3.5" disk is 90 × 94 × 3.3 mm; drawn this many times larger. */
const SCALE = 2.6;

export interface Pickup {
  /** Place at the prop's `pos`. */
  object: Group;
  /** What it is (the prop's `item`). */
  readonly item: string;
  /** Advance by `dt` seconds (spin + bob + glow). */
  update(dt: number): void;
  dispose(): void;
}

export function createPickup(item: string): Pickup {
  const bin = new Bin();
  const w = 0.09 * SCALE;
  const hgt = 0.094 * SCALE;
  const t = 0.0033 * SCALE;
  const shellMat = bin.add(new MeshLambertMaterial({ color: 0x1c1f1a, emissive: 0x1f4a10, emissiveIntensity: 0.6, flatShading: true }));
  const metal = bin.add(new MeshLambertMaterial({ color: 0xb8bcc0, emissive: 0x2a3a20, flatShading: true }));
  const sticker = bin.add(new MeshLambertMaterial({ color: 0xe9eee0, emissive: 0x334422 }));
  const halo = glowTexture(false);
  bin.add(halo);
  // The halo needs a canvas (a sprite's geometry is three's shared one): none under node.
  const glow = halo ? bin.add(new SpriteMaterial({ color: PICKUP_GLOW, map: halo, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })) : null;
  const shadow = bin.add(new MeshBasicMaterial({ color: PICKUP_GLOW, transparent: true, opacity: 0.18, blending: AdditiveBlending, depthWrite: false }));

  const object = new Group();
  object.name = `pickup:${item}`;
  /** Everything that spins and bobs. */
  const disk = new Group();
  disk.name = "pickup:disk";
  disk.position.y = PICKUP_HOVER;
  object.add(disk);

  // Stood on its edge, facing ±z: the shell, the metal shutter at the top,
  // the hub on the back, a blank sticker on the front.
  const shell = new Mesh(bin.add(new BoxGeometry(w, hgt, t)), shellMat);
  shell.name = "pickup:shell";
  disk.add(shell);
  const shutter = new Mesh(
    bin.add(
      merge([
        new BoxGeometry(w * 0.55, hgt * 0.36, t * 1.15).translate(w * 0.05, hgt * 0.32, 0),
        new BoxGeometry(w * 0.2, w * 0.2, t * 1.15).translate(0, -hgt * 0.05, 0),
      ]),
    )!,
    metal,
  );
  shutter.name = "pickup:shutter";
  disk.add(shutter);
  const label = new Mesh(bin.add(new BoxGeometry(w * 0.78, hgt * 0.45, t * 1.1).translate(0, -hgt * 0.22, 0)), sticker);
  label.name = "pickup:sticker";
  disk.add(label);

  if (glow) {
    const sprite = new Sprite(glow);
    sprite.name = "pickup:glow";
    const glowSize = Math.max(w, hgt) * 2.6;
    sprite.scale.set(glowSize, glowSize, 1);
    disk.add(sprite);
  }

  // A faint green pool on the floor under it.
  const pool = new Mesh(bin.add(new BoxGeometry(w * 1.6, 0.002, w * 1.6)), shadow);
  pool.name = "pickup:pool";
  pool.position.y = 0.004;
  object.add(pool);

  let clock = 0;
  const apply = (): void => {
    disk.rotation.y = clock * PICKUP_SPIN * Math.PI * 2;
    disk.position.y = PICKUP_HOVER + PICKUP_BOB * Math.sin(clock * 1.7);
    const g = 0.5 + 0.5 * Math.sin(clock * 1.3);
    if (glow) glow.opacity = 0.4 + 0.3 * g;
    shellMat.emissiveIntensity = 0.45 + 0.35 * g;
    shadow.opacity = 0.12 + 0.1 * g;
  };
  apply();

  return {
    object,
    item,
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
