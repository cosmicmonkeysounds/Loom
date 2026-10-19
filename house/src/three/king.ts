//! The King — a `king` prop: the chess boss who stands in a doorway (the
//! show's cold-storage lock). A body from primitives in emissive gold (a
//! cylinder base, a tapered torso, a sphere head, a four-point crown), black
//! eyes, and a health bar sprite over the head styled as a Windows 98 title
//! bar (canvas — skipped without a DOM). Sized to the prop's `size`; place
//! `object` at `pos` (the base centre) and turn it to `yaw`.
//!
//! Everything is driven by `update(dt)` — no timers — so the app's render
//! loop is the clock (and a test's loop is a fake one). `hit()` staggers him
//! for `KING_STAGGER` seconds; `kneel(true)` brings him down to one knee
//! over `KING_KNEEL` seconds (lower, bowed, his crown on) and `kneel(false)`
//! stands him back up the same way; `reset()` stands him up at once. His
//! health is shared by every guest (the server's `KingState`): the web game
//! and the terminals call `setHp` off it and kneel him while he has fallen.

import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, Sprite, SpriteMaterial, Vector3 } from "three";
import type { Camera } from "three";
import type { Prop } from "../types.ts";
import { Bin, merge } from "./dispose.ts";
import { healthBarTexture } from "./textures.ts";

/** Seconds to go down on one knee (and to stand back up). */
export const KING_KNEEL = 0.8;
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
  /** Redraw the bar: a cell per hp (red) and per lost (grey), "PAWNS ONLY"
   *  at 0; past `BAR_CELLS_MAX` one fill reading "n / max". */
  setHp(hp: number, max: number): void;
  /** A hit landed: a short stagger (tilt back, flash white, the bar shakes). Ignored while he kneels. */
  hit(): void;
  /** Down on one knee (true) or back up (false), over `KING_KNEEL` seconds. */
  kneel(on: boolean): void;
  /** Stand him back up at once. */
  reset(): void;
  readonly state: "standing" | "staggering" | "kneeling";
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
  // per state is cheap: one per hit point).
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
  let state: "standing" | "staggering" = "standing";
  let stagger = 0;
  /** Asked to kneel; `down` runs 0 (standing) → 1 (on one knee) towards it. */
  let kneeling = false;
  let down = 0;
  const camPos = new Vector3();
  const barPos = new Vector3();

  const idle = (t: number): void => {
    body.rotation.z = 0.035 * Math.sin(t * 2.5);
    body.rotation.x = 0;
    body.position.y = 0;
    body.scale.y = 1;
  };
  idle(0);
  /** The kneel at `k` (0 standing … 1 down): lower, squashed, bowed, dimmer. */
  const pose = (k: number): void => {
    const e = k * k * (3 - 2 * k);
    body.rotation.x = -0.38 * e;
    body.rotation.z = 0.035 * (1 - e) * Math.sin(clock * 2.5);
    body.position.y = -0.04 * e;
    body.scale.y = 1 - 0.3 * e;
    gold.emissiveIntensity = 0.35 - 0.2 * e;
  };

  return {
    object,
    get state() {
      return kneeling ? "kneeling" : state;
    },
    setHp(hp: number, max: number) {
      drawBar(Math.max(0, Math.min(max, hp)), Math.max(1, max));
    },
    hit() {
      if (kneeling || down > 0) return;
      state = "staggering";
      stagger = KING_STAGGER;
    },
    kneel(on: boolean) {
      kneeling = on;
      if (on) {
        state = "standing";
        stagger = 0;
        if (bar) bar.position.x = 0;
      }
    },
    reset() {
      kneeling = false;
      down = 0;
      state = "standing";
      stagger = 0;
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
      if (camera && bar !== null && barMat !== null) {
        camera.getWorldPosition(camPos);
        const dist = bar.getWorldPosition(barPos).distanceTo(camPos);
        const o = Math.min(Math.max((dist - BAR_FADE[0]) / (BAR_FADE[1] - BAR_FADE[0]), 0), 1);
        barMat.opacity = o;
        bar.visible = o > 0.01;
      }
      if (kneeling || down > 0) {
        // Going down (or getting back up): the kneel, nothing else.
        down = Math.min(1, Math.max(0, down + (kneeling ? dt : -dt) / KING_KNEEL));
        if (down > 0) {
          pose(down);
          return;
        }
        gold.emissiveIntensity = 0.35;
      }
      if (state === "standing") {
        idle(clock);
        return;
      }
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
    },
    dispose() {
      object.removeFromParent();
      bin.dispose();
    },
  };
}
