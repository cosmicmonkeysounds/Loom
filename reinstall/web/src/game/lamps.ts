//! (wave 39, C4) The real house lights drawn in the game — the three.js
//! half of `house-lights.ts`. Every fixture of the `lights` frame is a bulb:
//! a small emissive sphere and an additive glow sprite in its colour × level
//! (cheap, always drawn, bright enough to bloom), breathing while a program
//! is under it. A fixed pool of `PointLight`s (`setPool`, sized by the
//! quality tier and changed only with the tier: three recompiles every
//! material when the light count changes) goes to the nearest lit fixtures,
//! the player's floor first; a spare one sits at intensity 0. With a frame
//! the house's own hemisphere + sun dim toward a night floor
//! (`ambientFactor`); without one the house looks as it always did.
//!
//! Everything hangs under the game's space group, in house metres.

import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PointLight, SphereGeometry, Sprite, SpriteMaterial } from "three";
import type { Light, Object3D } from "three";
import type { GameLight, GameLights, HouseMap, Vec3 } from "@loom/house";
import { ambientFactor, animationClock, easeToward, lampFloors, lampLevel, pickLamps } from "./house-lights.ts";

/** A point light's intensity (candela) at level 1, and its reach (m). */
export const LAMP_CANDELA = 18;
export const LAMP_RANGE = 7;
/** The point light hangs this far under its bulb (off the ceiling plane). */
const LAMP_DROP = 0.18;
const BULB_RADIUS = 0.06;
const DARK_BULB = new Color("#3a3a44");

interface Bulb {
  light: GameLight;
  mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  glow: Sprite;
  color: Color;
}

/** A soft round glow (white; the sprite tints it). Null under node. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    if (g === null) return null;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.2, "rgba(255,255,255,0.55)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.12)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new CanvasTexture(c);
  } catch {
    return null;
  }
}

export class HouseLamps {
  readonly object = new Group();
  private readonly geometry = new SphereGeometry(BULB_RADIUS, 10, 8);
  private readonly glowMap = glowTexture();
  private bulbs = new Map<string, Bulb>();
  private pool: PointLight[] = [];
  /** Fixture id per pool light (null: spare, intensity 0). */
  private assigned: Array<string | null> = [];
  private frame: GameLights | null = null;
  private floors = new Map<string, string | null>();
  private clock = new Map<string, number>();
  private house: HouseMap;
  /** The house scene's own ambient lights and their built intensities. */
  private ambient: Array<{ light: Light; base: number }> = [];
  private dim = 1;

  constructor(house: HouseMap, poolSize: number) {
    this.house = house;
    this.object.name = "house-lights";
    this.setPool(poolSize);
  }

  /** The pool's size (a quality tier change only). */
  setPool(n: number): void {
    if (n === this.pool.length) return;
    for (const l of this.pool) {
      l.removeFromParent();
      l.dispose();
    }
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new PointLight(0xffffff, 0, LAMP_RANGE, 2);
      l.name = `house-light:${i}`;
      this.pool.push(l);
      this.object.add(l);
    }
    this.assigned = this.pool.map(() => null);
  }

  get poolSize(): number {
    return this.pool.length;
  }

  /** A new map (or a rebuilt house scene): its hemisphere + sun, its rooms. */
  bindHouse(house: HouseMap, sceneRoot: Object3D): void {
    for (const a of this.ambient) a.light.intensity = a.base;
    this.house = house;
    this.ambient = [];
    for (const name of ["house:hemi", "house:sun"]) {
      const l = sceneRoot.getObjectByName(name) as Light | undefined;
      if (l !== undefined && (l as { isLight?: boolean }).isLight === true) this.ambient.push({ light: l, base: l.intensity });
    }
    for (const a of this.ambient) a.light.intensity = a.base * this.dim;
    this.floors = this.frame === null ? new Map() : lampFloors(house, this.frame.lights);
  }

  /** The newest `lights` frame (null: none — the house as it always was). */
  set(frame: GameLights | null, nowS: number): void {
    this.frame = frame;
    const lights = frame?.lights ?? [];
    this.clock = animationClock(this.clock, lights, nowS);
    this.floors = lampFloors(this.house, lights);
    const seen = new Set<string>();
    for (const l of lights) {
      seen.add(l.id);
      let b = this.bulbs.get(l.id);
      if (b === undefined) {
        const mesh = new Mesh(this.geometry, new MeshBasicMaterial({ color: DARK_BULB }));
        mesh.name = `bulb:${l.id}`;
        const glow = new Sprite(new SpriteMaterial({ map: this.glowMap, color: 0xffffff, blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
        glow.name = `bulb-glow:${l.id}`;
        glow.renderOrder = 2;
        this.object.add(mesh, glow);
        b = { light: l, mesh, glow, color: new Color() };
        this.bulbs.set(l.id, b);
      }
      b.light = l;
      b.color.set(l.color);
      b.mesh.position.set(l.pos.x, l.pos.y, l.pos.z);
      b.glow.position.set(l.pos.x, l.pos.y - 0.02, l.pos.z);
    }
    for (const [id, b] of this.bulbs) {
      if (seen.has(id)) continue;
      this.dropBulb(b);
      this.bulbs.delete(id);
    }
    // A fixture that left the frame gives its point light back.
    this.assigned = this.assigned.map((id) => (id !== null && seen.has(id) ? id : null));
  }

  /** Give the point lights to the nearest lit fixtures (twice a second is plenty). */
  repick(at: Vec3, floor: string | null): void {
    const lights = this.frame?.lights ?? [];
    const want = pickLamps(lights, at, floor, this.floors, this.pool.length);
    // Keep a light on the fixture it already has (no jump), fill the rest.
    const next: Array<string | null> = this.assigned.map((id) => (id !== null && want.includes(id) ? id : null));
    for (const id of want) {
      if (next.includes(id)) continue;
      const free = next.indexOf(null);
      if (free < 0) break;
      next[free] = id;
    }
    this.assigned = next;
    for (let i = 0; i < this.pool.length; i++) {
      const id = next[i] ?? null;
      const b = id === null ? undefined : this.bulbs.get(id);
      const l = this.pool[i]!;
      if (b === undefined) {
        l.intensity = 0;
        continue;
      }
      l.color.copy(b.color);
      l.position.set(b.light.pos.x, b.light.pos.y - LAMP_DROP, b.light.pos.z);
    }
  }

  /** Every frame: the bulbs' brightness (the breathing), the point lights, the ambient. */
  update(nowS: number, dt: number): void {
    const level = new Map<string, number>();
    for (const [id, b] of this.bulbs) {
      const since = this.clock.get(id);
      const lv = lampLevel(b.light, since === undefined ? 0 : nowS - since);
      level.set(id, lv);
      if (lv <= 0.001) {
        b.mesh.material.color.copy(DARK_BULB);
        b.glow.visible = false;
        continue;
      }
      // Over 1 in linear light: the bulb blooms (and tone-maps to near white).
      b.mesh.material.color.copy(b.color).multiplyScalar(0.5 + 2.5 * lv);
      b.glow.visible = this.glowMap !== null;
      b.glow.material.color.copy(b.color);
      b.glow.material.opacity = Math.min(1, 0.2 + 0.6 * lv);
      const s = 0.35 + 0.75 * lv;
      b.glow.scale.set(s, s, 1);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const id = this.assigned[i] ?? null;
      this.pool[i]!.intensity = id === null ? 0 : LAMP_CANDELA * (level.get(id) ?? 0);
    }
    this.dim = easeToward(this.dim, ambientFactor(this.frame), dt);
    for (const a of this.ambient) a.light.intensity = a.base * this.dim;
  }

  private dropBulb(b: Bulb): void {
    b.mesh.removeFromParent();
    b.glow.removeFromParent();
    b.mesh.material.dispose();
    b.glow.material.dispose();
  }

  dispose(): void {
    for (const b of this.bulbs.values()) this.dropBulb(b);
    this.bulbs.clear();
    for (const l of this.pool) l.dispose();
    this.pool = [];
    this.geometry.dispose();
    this.glowMap?.dispose();
    this.object.removeFromParent();
  }
}
