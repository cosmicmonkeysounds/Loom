//! Gerald, gilded — the golden duck both games hide and the terminals watch.
//! A low-poly duck from primitives (body, head, bill, tail, wings, eyes) in
//! emissive gold, bobbing, slowly turning, ringed by twinkling sparkles.
//! `layEgg()` plays the ending: a golden egg drops to the floor and the duck
//! flies up and away over `DUCK_FLIGHT` seconds.
//!
//! Everything is driven by `update(dt)` — no timers — so the app's render
//! loop is the clock (and a test's loop is a fake one). Place `object` at the
//! duck spot's `pos` (its feet); it faces local `−z` like every node here.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
} from "three";
import { Bin, merge } from "./dispose.ts";
import { glowTexture } from "./textures.ts";

/** Seconds from `layEgg()` to the duck gone (and the promise resolved). */
export const DUCK_FLIGHT = 2.5;
/** When the duck takes off, seconds into `layEgg()`. */
const TAKEOFF = 0.45;
const SPARKLES = 22;

export interface Duck {
  /** Place at the duck spot (feet); the egg stays here when the duck flies. */
  object: Group;
  /** Advance by `dt` seconds; `t` (seconds) phases the bob, else internal time. */
  update(dt: number, t?: number): void;
  /** Drop an egg and fly away; resolves when the flight is over (same promise if called again). */
  layEgg(): Promise<void>;
  /** Back on its spot, no egg (for reuse across sessions). */
  reset(): void;
  readonly state: "idle" | "laying" | "gone";
  dispose(): void;
}

export function createDuck(): Duck {
  const bin = new Bin();
  const gold = bin.add(new MeshLambertMaterial({ color: 0xffc83d, emissive: 0x8a5a00, flatShading: true }));
  const orange = bin.add(new MeshLambertMaterial({ color: 0xff8c1a, emissive: 0x803000, flatShading: true }));
  const black = bin.add(new MeshBasicMaterial({ color: 0x111111 }));
  const eggMat = bin.add(new MeshLambertMaterial({ color: 0xffe066, emissive: 0xb07a00, flatShading: true }));

  const object = new Group();
  object.name = "duck";
  /** Everything that bobs, turns and flies (the egg is not in here). */
  const bird = new Group();
  bird.name = "duck:bird";
  object.add(bird);

  const body = bin.add(
    merge([
      new SphereGeometry(0.2, 8, 6).scale(1, 0.75, 1.35).translate(0, 0.18, 0),
      new SphereGeometry(0.11, 8, 6).translate(0, 0.38, -0.17),
      new ConeGeometry(0.075, 0.16, 5).rotateX(Math.PI / 2 - 0.6).translate(0, 0.27, 0.27),
    ]),
  )!;
  bird.add(named(new Mesh(body, gold), "duck:body"));
  const bill = bin.add(new ConeGeometry(0.05, 0.13, 6).scale(1, 1, 0.5).rotateX(-Math.PI / 2).translate(0, 0.36, -0.31));
  bird.add(named(new Mesh(bill, orange), "duck:bill"));
  const eyes = bin.add(
    merge([
      new SphereGeometry(0.018, 6, 4).translate(0.065, 0.41, -0.24),
      new SphereGeometry(0.018, 6, 4).translate(-0.065, 0.41, -0.24),
    ]),
  )!;
  bird.add(named(new Mesh(eyes, black), "duck:eyes"));
  // Wings hinge at the shoulder so they can flap.
  const wingGeom = bin.add(new SphereGeometry(0.15, 6, 4).scale(0.28, 0.5, 1).translate(0.035, 0, 0.02));
  const wings: Group[] = [-1, 1].map((side) => {
    const hinge = new Group();
    hinge.name = side < 0 ? "duck:wing-left" : "duck:wing-right";
    hinge.position.set(side * 0.17, 0.22, 0);
    const wing = new Mesh(wingGeom, gold);
    wing.scale.x = side;
    hinge.add(wing);
    bird.add(hinge);
    return hinge;
  });

  // Sparkles: points orbiting the duck, twinkling through vertex colours.
  const sparkleGeom = bin.add(new BufferGeometry());
  const sparklePos = new Float32Array(SPARKLES * 3);
  const sparkleCol = new Float32Array(SPARKLES * 3);
  sparkleGeom.setAttribute("position", new BufferAttribute(sparklePos, 3));
  sparkleGeom.setAttribute("color", new BufferAttribute(sparkleCol, 3));
  const sparkleTex = bin.add(glowTexture());
  const sparkles = new Points(
    sparkleGeom,
    bin.add(
      new PointsMaterial({
        size: sparkleTex ? 0.09 : 0.03,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        ...(sparkleTex ? { map: sparkleTex } : {}),
      }),
    ),
  );
  sparkles.name = "duck:sparkles";
  sparkles.frustumCulled = false;
  bird.add(sparkles);

  const egg = new Mesh(bin.add(new SphereGeometry(0.07, 10, 8).scale(1, 1.3, 1)), eggMat);
  egg.name = "duck:egg";
  egg.visible = false;
  object.add(egg);

  let clock = 0;
  let state: Duck["state"] = "idle";
  let since = 0;
  let laying: Promise<void> | null = null;
  let resolve: (() => void) | null = null;

  const pose = (t: number) => {
    // Idle: bob 0–6 cm, a slow turn handled incrementally in update().
    bird.position.y = 0.03 + 0.03 * (Math.sin(t * 2.2) + 1);
    bird.rotation.x = 0.04 * Math.sin(t * 2.2 + 1);
    for (const [i, w] of wings.entries()) w.rotation.z = (i ? -1 : 1) * 0.08 * Math.sin(t * 1.3);
    for (let i = 0; i < SPARKLES; i++) {
      const a = (i / SPARKLES) * Math.PI * 2 + t * (0.4 + (i % 3) * 0.15);
      const r = 0.34 + 0.08 * Math.sin(i * 1.7 + t);
      sparklePos[i * 3] = Math.cos(a) * r;
      sparklePos[i * 3 + 1] = 0.12 + ((i * 0.37) % 1) * 0.5 + 0.04 * Math.sin(t * 3 + i);
      sparklePos[i * 3 + 2] = Math.sin(a) * r;
      const b = Math.max(0, Math.sin(t * 5 + i * 2.3)) ** 3;
      sparkleCol[i * 3] = b;
      sparkleCol[i * 3 + 1] = b * 0.85;
      sparkleCol[i * 3 + 2] = b * 0.35;
    }
    sparkleGeom.attributes.position!.needsUpdate = true;
    sparkleGeom.attributes.color!.needsUpdate = true;
  };
  pose(0);

  const fly = (s: number, t: number) => {
    // The egg: appears under the body, drops, one small bounce, then glows.
    egg.visible = true;
    const drop = Math.min(s / 0.35, 1);
    const bounce = s > 0.35 && s < 0.6 ? 0.03 * Math.sin(((s - 0.35) / 0.25) * Math.PI) : 0;
    egg.position.y = 0.16 - (0.16 - 0.091) * drop * drop + bounce;
    eggMat.emissiveIntensity = 1 + 0.4 * Math.sin(t * 4);
    if (s < TAKEOFF) {
      bird.scale.set(1, 1 - 0.12 * Math.sin((s / TAKEOFF) * Math.PI), 1);
      return;
    }
    const e = Math.min((s - TAKEOFF) / (DUCK_FLIGHT - TAKEOFF), 1);
    bird.scale.setScalar(e > 0.75 ? Math.max(0.0001, 1 - (e - 0.75) / 0.25) : 1);
    // Up and forward along its facing (local −z), nose raised.
    const yaw = bird.rotation.y;
    const along = 2.6 * e * e;
    bird.position.set(-Math.sin(yaw) * along, 0.06 + 3.2 * e * e + 0.3 * e, -Math.cos(yaw) * along);
    bird.rotation.x = 0.35 * Math.min(e * 4, 1);
    for (const [i, w] of wings.entries()) w.rotation.z = (i ? -1 : 1) * (0.2 + 0.9 * Math.sin(s * 28));
  };

  return {
    object,
    get state() {
      return state;
    },
    update(dt: number, t?: number) {
      if (!Number.isFinite(dt) || dt < 0) return;
      clock += dt;
      const now = t ?? clock;
      if (state === "idle") {
        bird.rotation.y += dt * 0.35;
        pose(now);
        return;
      }
      if (state === "laying") {
        since += dt;
        fly(since, now);
        if (since >= DUCK_FLIGHT) {
          state = "gone";
          bird.visible = false;
          const done = resolve;
          resolve = null;
          done?.();
        }
        return;
      }
      eggMat.emissiveIntensity = 1 + 0.4 * Math.sin(now * 4);
    },
    layEgg() {
      if (laying) return laying;
      state = "laying";
      since = 0;
      laying = new Promise<void>((r) => (resolve = r));
      return laying;
    },
    reset() {
      const done = resolve;
      resolve = null;
      done?.();
      laying = null;
      state = "idle";
      since = 0;
      bird.visible = true;
      bird.position.set(0, 0, 0);
      bird.rotation.set(0, bird.rotation.y, 0);
      bird.scale.setScalar(1);
      egg.visible = false;
      pose(clock);
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

function named<T extends { name: string }>(o: T, name: string): T {
  o.name = name;
  return o;
}
