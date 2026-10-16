//! The King — a `king` prop: the chess boss who stands in a doorway (the
//! show's cold-storage lock). A body from primitives in emissive gold (a
//! cylinder base, a tapered torso, a sphere head, a four-point crown), black
//! eyes, and a health bar sprite over the head styled as a Windows 98 title
//! bar (canvas — skipped without a DOM). Sized to the prop's `size`; place
//! `object` at `pos` (the base centre) and turn it to `yaw`.
//!
//! Everything is driven by `update(dt)` — no timers — so the app's render
//! loop is the clock (and a test's loop is a fake one). `hit()` staggers him
//! for `KING_STAGGER` seconds; `fall()` topples him over `KING_FALL` seconds
//! and resolves; `reset()` stands him back up. The web game fights him; the
//! terminals and VR only show him standing.

import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from "three";
import type { Camera } from "three";
import type { Prop } from "../types.ts";
import { Bin, merge } from "./dispose.ts";
import { healthBarTexture } from "./textures.ts";

/** Seconds from `fall()` to the king down (and the promise resolved). */
export const KING_FALL = 1.6;
/** Seconds a hit staggers him. */
export const KING_STAGGER = 0.35;
/** The default colour (gold). */
export const KING_COLOR = "#d4af37";
/** The bar is hidden nearer than [0] metres, fully shown beyond [1] (like room labels). */
const BAR_FADE = [0.5, 0.8] as const;
const BAR_HEIGHT = 0.14;

export interface King {
  /** Place at the prop's `pos` (the base centre); `rotation.y` = yaw. */
  object: Group;
  /** Redraw the bar: ♥ per hp, ♡ per lost; "PAWNS ONLY" at 0. */
  setHp(hp: number, max: number): void;
  /** A hit landed: a short stagger (tilt back, flash white, the bar shakes). */
  hit(): void;
  /** Topple over `KING_FALL` seconds and fade; resolves when down (the same promise if called again). */
  fall(): Promise<void>;
  /** Stand him back up at full opacity (for reuse across sessions). */
  reset(): void;
  readonly state: "standing" | "staggering" | "fallen";
  /** Advance by `dt` seconds; with a `camera`, the bar fades out as it comes within a metre. */
  update(dt: number, camera?: Camera): void;
  dispose(): void;
}

export function createKing(prop: Prop): King {
  const bin = new Bin();
  const [w, h, d] = prop.size;
  const color = prop.color ?? KING_COLOR;
  const label = prop.label ?? "THE KING";
  const gold = bin.add(new MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true, transparent: true, opacity: 1 }));
  const black = bin.add(new MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 1 }));

  const object = new Group();
  object.name = "king";
  /** Everything that sways, staggers and topples. */
  const body = new Group();
  body.name = "king:body";
  object.add(body);

  // Proportions of the prop's box: base 0.55 w, torso tapering to the
  // head, the head a sphere of 0.22 w, the crown four cones on it.
  const r = Math.max(w, d) / 2;
  const headR = r * 0.44;
  const headY = h - headR * 1.6;
  const torsoTop = headY - headR * 0.9;
  const bodyGeom = bin.add(
    merge([
      new CylinderGeometry(r * 0.75, r, h * 0.18, 12).translate(0, h * 0.09, 0),
      new CylinderGeometry(r * 0.45, r * 0.7, torsoTop - h * 0.18, 10).translate(0, (torsoTop + h * 0.18) / 2, 0),
      new SphereGeometry(headR, 10, 8).translate(0, headY, 0),
      ...[0, 1, 2, 3].map((k) =>
        new ConeGeometry(headR * 0.28, headR * 0.8, 5).translate(Math.cos((k * Math.PI) / 2) * headR * 0.55, headY + headR * 1.1, Math.sin((k * Math.PI) / 2) * headR * 0.55),
      ),
      new CylinderGeometry(headR * 0.9, headR * 0.9, headR * 0.3, 10).translate(0, headY + headR * 0.85, 0),
    ]),
  )!;
  const bodyMesh = new Mesh(bodyGeom, gold);
  bodyMesh.name = "king:mesh";
  body.add(bodyMesh);
  // Eyes on the face (local −z, the way he looks).
  const eyes = bin.add(
    merge([
      new SphereGeometry(headR * 0.14, 6, 4).translate(headR * 0.35, headY + headR * 0.15, -headR * 0.85),
      new SphereGeometry(headR * 0.14, 6, 4).translate(-headR * 0.35, headY + headR * 0.15, -headR * 0.85),
    ]),
  )!;
  const eyeMesh = new Mesh(eyes, black);
  eyeMesh.name = "king:eyes";
  body.add(eyeMesh);

  // The health bar: a sprite over the head, redrawn per setHp (a texture
  // per state is cheap: at most ten).
  let bar: Sprite | null = null;
  let barMat: SpriteMaterial | null = null;
  const barY = h + 0.25;
  const drawBar = (hp: number, max: number): void => {
    const made = healthBarTexture(label, hp, max);
    if (!made) return;
    if (bar === null || barMat === null) {
      barMat = bin.add(new SpriteMaterial({ map: made.texture, depthTest: false, depthWrite: false, transparent: true }));
      bar = new Sprite(barMat);
      bar.name = "king:bar";
      bar.renderOrder = 10;
      object.add(bar);
    } else {
      barMat.map?.dispose();
      barMat.map = made.texture;
      barMat.needsUpdate = true;
    }
    bin.add(made.texture);
    bar.scale.set(BAR_HEIGHT * made.aspect, BAR_HEIGHT, 1);
    bar.position.set(0, barY, 0);
  };

  let clock = 0;
  let state: King["state"] = "standing";
  let stagger = 0;
  let fallSince = 0;
  let falling: Promise<void> | null = null;
  let resolve: (() => void) | null = null;
  const camPos = new Vector3();
  const barPos = new Vector3();

  const idle = (t: number): void => {
    body.rotation.z = 0.035 * Math.sin(t * 2.5);
    body.rotation.x = 0;
    body.position.y = 0;
  };
  idle(0);

  return {
    object,
    get state() {
      return state;
    },
    setHp(hp: number, max: number) {
      drawBar(Math.max(0, Math.min(max, hp)), Math.max(1, max));
    },
    hit() {
      if (state === "fallen") return;
      state = "staggering";
      stagger = KING_STAGGER;
    },
    fall() {
      if (falling) return falling;
      state = "fallen";
      fallSince = 0;
      falling = new Promise<void>((r) => (resolve = r));
      return falling;
    },
    reset() {
      const done = resolve;
      resolve = null;
      done?.();
      falling = null;
      state = "standing";
      stagger = 0;
      fallSince = 0;
      gold.opacity = 1;
      black.opacity = 1;
      gold.emissiveIntensity = 0.35;
      bodyMesh.visible = true;
      eyeMesh.visible = true;
      if (bar) bar.visible = true;
      idle(clock);
    },
    update(dt: number, camera?: Camera) {
      if (!Number.isFinite(dt) || dt < 0) return;
      clock += dt;
      if (camera && bar !== null && barMat !== null && state !== "fallen") {
        camera.getWorldPosition(camPos);
        const dist = bar.getWorldPosition(barPos).distanceTo(camPos);
        const o = Math.min(Math.max((dist - BAR_FADE[0]) / (BAR_FADE[1] - BAR_FADE[0]), 0), 1);
        barMat.opacity = o;
        bar.visible = o > 0.01;
      }
      if (state === "standing") {
        idle(clock);
        return;
      }
      if (state === "staggering") {
        stagger -= dt;
        const k = Math.max(0, stagger / KING_STAGGER);
        // Tilt back (away from whoever faces him), flash, and shake the bar.
        body.rotation.x = -0.21 * Math.sin(k * Math.PI);
        body.rotation.z = 0.035 * Math.sin(clock * 2.5);
        gold.emissiveIntensity = 0.35 + 1.4 * k;
        if (bar) bar.position.x = 0.03 * Math.sin(k * 40);
        if (stagger <= 0) {
          state = "standing";
          gold.emissiveIntensity = 0.35;
          if (bar) bar.position.x = 0;
          idle(clock);
        }
        return;
      }
      // Fallen: topple 90° forward, sink a little, fade; then resolve.
      fallSince += dt;
      const e = Math.min(fallSince / KING_FALL, 1);
      const ease = 1 - (1 - e) * (1 - e);
      body.rotation.x = -(Math.PI / 2) * ease;
      body.rotation.z = 0;
      body.position.y = -0.05 * ease;
      const fade = Math.max(0, 1 - Math.max(0, e - 0.55) / 0.45);
      gold.opacity = fade;
      black.opacity = fade;
      if (bar) bar.visible = false;
      if (e >= 1) {
        bodyMesh.visible = false;
        eyeMesh.visible = false;
        const done = resolve;
        resolve = null;
        done?.();
      }
    },
    dispose() {
      const done = resolve;
      resolve = null;
      done?.();
      object.removeFromParent();
      bin.dispose();
    },
  };
}
