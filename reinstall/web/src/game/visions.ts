//! The descent's three.js half (wave 49, contract C2 + C5): what a program
//! sees and hears when the simulation stops holding together. `descent.ts`
//! decides when; this draws it.
//!
//! - **The light** (`gradeOf`, every frame): the level's steady wrongness, and
//!   `flicker`, `tint` and `dark` on top of it, all through what a tier change
//!   never recompiles: the fog's uniforms, the ambient, the neon's level and
//!   the tone map's exposure. The same on `low` as on `high`.
//! - **Things that are not there**: a pale Gerald, gone wrong (`createDuck`
//!   re-dressed: never the real duck, never findable), the grin with what it
//!   came attached to (`createAvatar` for the program's own pale copy),
//!   the door, and two eyes in the dark.
//! - **The faces**: two eyes that follow the player and a mouth on each awake
//!   prop, opening as you come within `FACE_NEAR_M`. Walk round the prop and
//!   it blinks, and when it opens its eyes it is on this side.
//!
//! Everything is built once at walk start and only shown and hidden after
//! that; a talker's face shares its geometry and materials. No new point
//! lights: the pool is fixed (a light-count change recompiles every material).
//! Nothing here forces the camera: `small` and `big` scale the eye height
//! alone, eased, and nothing flashes faster than 3 Hz (`flickerAt`).

import { AdditiveBlending, CanvasTexture, CircleGeometry, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial } from "three";
import type { FogExp2, Material, MeshLambertMaterial, Object3D, Scene } from "three";
import { VISION_S, descentLook, floorOf, locate, pathLength, roomById, roomElevation, roomHeight, sampleTrail, wrapYaw, yawToward } from "@loom/house";
import type { DescentLook, HouseMap, Vec3, VisionKind } from "@loom/house";
import { Bin, createAvatar, createDuck, hasDom } from "@loom/house/three";
import type { Avatar, Duck, HouseScene } from "@loom/house/three";
import type { Sfx } from "./audio.ts";
import { aliceAt, CEILING_GAP_M, envelope, faceSides, FollowerSteps, gradeOf, nearestSide, POCKET_GRADE, smooth, wayAhead, type AwakeTalker, type DoorAt, type Grade, type VisionRun, type WayAhead } from "./descent.ts";
import { createDoor, type Door } from "./hallway.ts";
import { relativeBearing } from "./hud.ts";
import type { HouseLamps } from "./lamps.ts";
import { EYE_HEIGHT, eyeOf, move, type Body, type MoveInput, type PhysicsWorld } from "./physics.ts";

const DEG = Math.PI / 180;

/** A face is drawn within this of the player (m, plan). */
export const FACE_NEAR_M = 8;
/** Its eyes finish opening over this much of the approach (m). */
const FACE_OPEN_M = 1.6;
/** A blink (s). */
const BLINK_S = 0.16;

/** The pale duck turns up this far off (m), this far at the least, and walks off at half a walk. */
const WHITE_AHEAD_M = 6;
const WHITE_LEAST_M = 3;
/** Where to look for it: never far outside the view. */
const IN_VIEW: readonly number[] = [0, 20, -20, 35, -35];
const WADDLE: MoveInput = { move: [0, 0.5], turn: 0, look: 0, run: false };
/** …until it stops and looks back at them (s). */
const WHITE_STOPS_S = 3.1;
/** The pale duck's size: Gerald, but too much of him. */
const WHITE_SCALE = 1.7;

/** The grin hangs this far off (m), this far at the least. */
const GRIN_AHEAD_M = 2.5;
const GRIN_LEAST_M = 1.2;

/** The program's copy walks this much of the way ahead of them (m), starting this far off. */
const SELF_NEAR_M = 5;
const SELF_WALK_M = 4.5;
const SELF_STEP_M = 0.25;
/** How long it walks, turns, and when it is suddenly gone (s). */
const SELF_WALKS_S = 4.2;
const SELF_TURNS_S = 1;
const SELF_GONE_S = 8;

/** `dark`: when the growl comes (s). */
const GROWL_S = 3.2;
/** The eyes it belongs to stand this far behind the player (m). */
const BEHIND_M = 6;

/** How quickly the light follows what it is told (per s). */
const GRADE_RATE = 7;
/** How quickly the eye follows `aliceAt` (per s): only an interruption shows it. */
const EYE_RATE = 4;

export interface VisionView {
  map: HouseMap;
  world: PhysicsWorld;
  body: Body;
  /** The way to Gerald once it is shown (no vision gives away more than the trail does). */
  route: Vec3[] | null;
  house: HouseScene;
}

export interface VisionsOptions {
  root: Object3D;
  scene: Scene;
  lamps: HouseLamps;
  sfx: Sfx;
  level: number;
  /** The program, for its own copy. */
  name: string;
  guest: string;
  picture: string | null;
  view: () => VisionView;
  /** × the game's tone map exposure. */
  setExposure: (x: number) => void;
}

interface Face {
  prop: AwakeTalker["prop"];
  object: Group;
  /** The sides it can be on; `side` is where it is. */
  sides: DoorAt[];
  side: number;
  radius: number;
  lids: Group[];
  pupils: Mesh[];
  mouth: Mesh;
  teeth: Mesh;
  t: number;
  blinkIn: number;
  blinkFor: number;
}

interface Grin {
  object: Group;
  head: Sprite;
  eyes: Sprite;
  smile: Sprite;
}

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (!hasDom()) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  return g === null ? null : { canvas, g };
}

function textureOf(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Far too many teeth, in a crescent that ends well past where a mouth should. */
function smileTexture(): CanvasTexture | null {
  const c = canvasOf(512, 256);
  if (c === null) return null;
  const { g } = c;
  const [left, right, top] = [14, 498, 46];
  const crescent = new Path2D();
  crescent.moveTo(left, top);
  crescent.quadraticCurveTo(256, 300, right, top);
  crescent.quadraticCurveTo(256, 138, left, top);
  crescent.closePath();
  g.fillStyle = "#fbf8ee";
  g.shadowColor = "rgba(255, 240, 255, 0.9)";
  g.shadowBlur = 14;
  g.fill(crescent);
  g.shadowBlur = 0;
  g.save();
  g.clip(crescent);
  g.strokeStyle = "#1c0a24";
  g.lineWidth = 5;
  for (let x = left; x < right; x += 24) {
    g.beginPath();
    g.moveTo(x + (256 - x) * 0.1, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  // The bite, between the upper teeth and the lower.
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(left, top);
  g.quadraticCurveTo(256, 216, right, top);
  g.stroke();
  g.restore();
  return textureOf(c.canvas);
}

/** Two slit eyes (white: a sprite tints them). */
function eyesTexture(): CanvasTexture | null {
  const c = canvasOf(256, 128);
  if (c === null) return null;
  const { g } = c;
  for (const cx of [62, 194]) {
    const eye = new Path2D();
    eye.moveTo(cx - 54, 64);
    eye.quadraticCurveTo(cx, 8, cx + 54, 54);
    eye.quadraticCurveTo(cx, 112, cx - 54, 64);
    g.fillStyle = "#ffffff";
    g.shadowColor = "#ffffff";
    g.shadowBlur = 10;
    g.fill(eye);
    g.shadowBlur = 0;
    g.fillStyle = "#08040c";
    g.beginPath();
    g.ellipse(cx, 60, 7, 30, 0, 0, Math.PI * 2);
    g.fill();
  }
  return textureOf(c.canvas);
}

/** What the grin came with: a striped, eared blur, gone long before it is. */
function headTexture(): CanvasTexture | null {
  const c = canvasOf(256, 256);
  if (c === null) return null;
  const { g } = c;
  const head = new Path2D();
  head.arc(128, 146, 92, 0, Math.PI * 2);
  head.moveTo(48, 104);
  head.lineTo(50, 12);
  head.lineTo(118, 58);
  head.moveTo(208, 104);
  head.lineTo(206, 12);
  head.lineTo(138, 58);
  g.save();
  g.clip(head);
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = i % 2 === 0 ? "#b0389f" : "#4e1a78";
    g.lineWidth = 15;
    g.beginPath();
    g.arc(128, 300, 20 + i * 22, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  return textureOf(c.canvas);
}

/** The material's full opacity, kept while a fade works on it. */
function fadeAll(object: Object3D, v: number): void {
  object.traverse((o) => {
    const m = (o as Mesh | Sprite).material as Material | undefined;
    if (m === undefined) return;
    m.opacity = v * ((m.userData["full"] as number | undefined) ?? 1);
  });
}

/** Gerald with the gold let out of him: bloodless, red pinprick eyes, and the
 *  haze does not touch him. */
function dressPale(duck: Duck): void {
  duck.object.scale.setScalar(WHITE_SCALE);
  duck.object.traverse((o) => {
    if (o.name === "duck:sparkles") {
      o.visible = false;
      return;
    }
    const m = (o as Mesh).material as MeshLambertMaterial | undefined;
    if (m === undefined) return;
    m.transparent = true;
    m.fog = false;
    if (o.name === "duck:eyes") m.color.set("#e8001c");
    else if (o.name === "duck:bill") {
      m.color.set("#8d857a");
      m.emissive?.set("#2a2522");
    } else {
      m.color.set("#e9e7e1");
      m.emissive?.set("#6c7078");
    }
    m.needsUpdate = true;
  });
}

/** The program's copy: pale, with nobody behind the visor. */
function dressSelf(avatar: Avatar): void {
  avatar.object.traverse((o) => {
    if (o.name === "avatar:ring") o.visible = false;
    const m = (o as Mesh).material as MeshLambertMaterial | undefined;
    if (m === undefined) return;
    m.fog = false;
    m.needsUpdate = true;
    if (o.name === "avatar:body") {
      m.color.set("#e9eef2");
      m.emissive?.set("#6c747e");
      m.userData["full"] = 0.85;
    }
    if (o.name === "avatar:visor") m.color.set("#050508");
  });
}

export class Visions {
  readonly object = new Group();
  private readonly o: VisionsOptions;
  private readonly bin = new Bin();
  private readonly look: DescentLook;
  private readonly fogBase: number;
  private readonly fogColor: Color;
  private readonly tint = new Color();
  private readonly tintTo = new Color();
  private grade: Grade;
  /** The eye height's scale. */
  private eyeK = 1;
  /** The picture coming back after the Hallway, 0 … 1. */
  private lift = 1;
  private lastFeet: Vec3 | null = null;

  private readonly pale: Duck;
  private readonly paleBird: Object3D;
  private paleBody: Body | null = null;
  private paleS = 0;
  private quacks = 0;
  private readonly grin: Grin | null;
  private readonly copy: Avatar;
  private track: { p: Vec3; yaw: number }[] = [];
  private readonly door: Door;
  private doorAt: DoorAt | null = null;
  private readonly behind: Sprite | null;
  private growled = false;
  private growlPan = 0.5;
  private follower: FollowerSteps | null = null;
  private followerPan = 0.3;
  /** Something else is walking in the Hallway too (`hallwayFollower`). */
  private pocketSteps: FollowerSteps | null = null;
  private pocketS = 0;

  private faces: Face[] = [];
  private speaking: string | null = null;
  private readonly disc = this.bin.add(new CircleGeometry(1, 20).rotateY(Math.PI));
  private readonly strip = this.bin.add(new PlaneGeometry(1, 1).rotateY(Math.PI));
  private readonly white = this.bin.add(new MeshBasicMaterial({ color: "#d8d5cc" }));
  private readonly ink = this.bin.add(new MeshBasicMaterial({ color: "#07070b" }));
  private readonly maw = this.bin.add(new MeshBasicMaterial({ color: "#1c0508" }));

  constructor(o: VisionsOptions) {
    this.o = o;
    this.object.name = "descent:visions";
    this.look = descentLook(o.level);
    this.grade = gradeOf(this.look, null);
    const fog = o.scene.fog as FogExp2;
    this.fogBase = fog.density;
    this.fogColor = fog.color.clone();
    this.tint.set(this.look.tint);

    this.pale = createDuck();
    dressPale(this.pale);
    this.paleBird = this.pale.object.getObjectByName("duck:bird") ?? this.pale.object;
    this.pale.object.visible = false;
    this.object.add(this.pale.object);

    this.grin = this.buildGrin();

    this.copy = createAvatar(o.name, o.guest, { picture: o.picture });
    dressSelf(this.copy);
    this.copy.object.visible = false;
    this.object.add(this.copy.object);

    this.door = createDoor();
    this.door.object.visible = false;
    this.object.add(this.door.object);

    const eyes = this.bin.add(eyesTexture());
    this.behind = eyes === null ? null : new Sprite(this.bin.add(new SpriteMaterial({ map: eyes, color: "#ff2030", transparent: true, depthWrite: false, fog: false, opacity: 0 })));
    if (this.behind !== null) {
      this.behind.scale.set(0.42, 0.21, 1);
      this.behind.visible = false;
      this.object.add(this.behind);
    }
    o.root.add(this.object);
  }

  private buildGrin(): Grin | null {
    const smile = this.bin.add(smileTexture());
    const eyes = this.bin.add(eyesTexture());
    const head = this.bin.add(headTexture());
    if (smile === null || eyes === null || head === null) return null;
    const sprite = (map: CanvasTexture, color: string, order: number): Sprite => {
      const s = new Sprite(this.bin.add(new SpriteMaterial({ map, color, transparent: true, depthWrite: false, fog: false, opacity: 0 })));
      s.renderOrder = order;
      return s;
    };
    const object = new Group();
    object.name = "descent:grin";
    object.visible = false;
    const h = sprite(head, "#ffffff", 3);
    h.material.blending = AdditiveBlending;
    h.scale.set(1.25, 1.25, 1);
    h.position.y = 0.06;
    const e = sprite(eyes, "#d6ff5a", 4);
    e.scale.set(0.66, 0.33, 1);
    e.position.y = 0.2;
    const m = sprite(smile, "#ffffff", 5);
    m.scale.set(0.9, 0.45, 1);
    m.position.y = -0.16;
    object.add(h, e, m);
    this.object.add(object);
    return { object, head: h, eyes: e, smile: m };
  }

  /** Who is awake: a face on each (a remap wakes them again). */
  setAwake(awake: readonly AwakeTalker[], map: HouseMap): void {
    for (const f of this.faces) f.object.removeFromParent();
    this.faces = awake.map((a) => this.buildFace(a, map));
    this.speaking = null;
  }

  private buildFace(a: AwakeTalker, map: HouseMap): Face {
    const sides = faceSides(map, a.prop);
    const spot = sides[0]!;
    const [w, h] = a.prop.size;
    const r = Math.max(0.045, Math.min(0.1, Math.min(w, h) * 0.17));
    const object = new Group();
    object.name = `descent:face:${a.prop.id}`;
    object.position.set(spot.pos[0], spot.pos[1], spot.pos[2]);
    object.rotation.y = spot.yaw * DEG;
    object.visible = false;
    const lids: Group[] = [];
    const pupils: Mesh[] = [];
    for (const side of [-1, 1]) {
      const lid = new Group();
      lid.position.set(side * r * 1.25, r * 0.7, 0);
      const ball = new Mesh(this.disc, this.white);
      ball.scale.setScalar(r);
      const pupil = new Mesh(this.disc, this.ink);
      pupil.scale.setScalar(r * 0.42);
      lid.add(ball, pupil);
      object.add(lid);
      lids.push(lid);
      pupils.push(pupil);
    }
    const mouth = new Mesh(this.disc, this.maw);
    mouth.position.y = -r * 1.1;
    const teeth = new Mesh(this.strip, this.white);
    object.add(mouth, teeth);
    this.object.add(object);
    return { prop: a.prop, object, sides, side: 0, radius: r, lids, pupils, mouth, teeth, t: fnvish(a.prop.id), blinkIn: 2, blinkFor: 0 };
  }

  /** The prop whose mouth is moving (null: none). */
  setSpeaking(prop: string | null): void {
    this.speaking = prop;
  }

  /** Draw a vision. False when it can't be drawn from here. */
  start(kind: VisionKind, n: number, door: DoorAt | null): boolean {
    const v = this.o.view();
    const { sfx } = this.o;
    switch (kind) {
      case "flicker":
        sfx.mains();
        return true;
      case "follower":
        this.follower = new FollowerSteps(VISION_S.follower);
        this.followerPan = n % 2 === 0 ? 0.3 : -0.3;
        return true;
      case "whisper":
        sfx.breath();
        return true;
      case "tint":
        sfx.sour();
        return true;
      case "whiteduck":
        return this.showPale(v);
      case "grin":
        return this.showGrin(v);
      case "dark":
        this.growled = false;
        this.growlPan = n % 2 === 0 ? 0.55 : -0.55;
        return true;
      case "self":
        return this.showCopy(v);
      case "small":
        sfx.slide(false);
        return true;
      case "big":
        sfx.slide(true);
        return true;
      case "door":
        if (door === null) return false;
        this.doorAt = door;
        this.door.object.position.set(door.pos[0], door.pos[1], door.pos[2]);
        this.door.object.rotation.y = door.yaw * DEG;
        this.door.setOpacity(0);
        this.door.object.visible = true;
        sfx.doorArrives();
        return true;
    }
  }

  private showPale(v: VisionView): boolean {
    const way = wayAhead(v.world, v.body, WHITE_AHEAD_M, WHITE_LEAST_M, IN_VIEW);
    if (way === null) return false;
    this.paleBody = { p: way.end, yaw: way.yaw, pitch: 0, vy: 0 };
    this.paleS = 0;
    this.quacks = 0;
    this.pale.object.position.set(way.end[0], way.end[1], way.end[2]);
    this.pale.object.rotation.set(0, way.yaw * DEG, 0);
    this.pale.object.visible = true;
    fadeAll(this.pale.object, 0);
    return true;
  }

  private showGrin(v: VisionView): boolean {
    const g = this.grin;
    if (g === null) return false;
    const way = wayAhead(v.world, v.body, GRIN_AHEAD_M, GRIN_LEAST_M, IN_VIEW);
    if (way === null) return false;
    g.object.position.set(way.end[0], way.end[1] + EYE_HEIGHT, way.end[2]);
    g.object.visible = true;
    return true;
  }

  private showCopy(v: VisionView): boolean {
    // Before the trail shows, it goes the way they are looking, never the way to Gerald.
    let way: Vec3[] | null = v.route !== null && pathLength(v.route) >= SELF_NEAR_M + 1 ? v.route : null;
    if (way === null) {
      const ahead: WayAhead | null = wayAhead(v.world, v.body, SELF_NEAR_M + SELF_WALK_M, SELF_NEAR_M, IN_VIEW);
      way = ahead?.points ?? null;
    }
    if (way === null) return false;
    const track = sampleTrail(way, SELF_STEP_M).slice(Math.round(SELF_NEAR_M / SELF_STEP_M));
    if (track.length === 0) return false;
    this.track = track.slice(0, Math.round(SELF_WALK_M / SELF_STEP_M) + 1);
    const first = this.track[0]!;
    this.copy.setPose(first.p, first.yaw, 0);
    this.copy.object.visible = true;
    fadeAll(this.copy.object, 0);
    return true;
  }

  /** Take a vision down. */
  stop(kind: VisionKind): void {
    switch (kind) {
      case "follower":
        this.follower = null;
        break;
      case "whiteduck":
        this.pale.object.visible = false;
        this.paleBody = null;
        break;
      case "grin":
        if (this.grin !== null) this.grin.object.visible = false;
        break;
      case "dark":
        if (this.behind !== null) this.behind.visible = false;
        break;
      case "self":
        this.copy.object.visible = false;
        break;
      case "door":
        this.door.object.visible = false;
        this.doorAt = null;
        break;
      default:
        break;
    }
  }

  /** The Hallway's other walker starts, far behind. */
  hallwayFollower(): void {
    this.pocketSteps = new FollowerSteps(Number.POSITIVE_INFINITY);
    this.pocketS = 0;
  }

  /** Back in the house: the picture comes up from black. */
  reveal(): void {
    this.lift = 0;
    this.pocketSteps = null;
  }

  /** Where the camera is for a body: its eye, at the height `small` / `big` leave it. */
  eye(body: Body, map: HouseMap): Vec3 {
    const e = eyeOf(body);
    if (this.eyeK === 1) return e;
    let y = body.p[1] + EYE_HEIGHT * this.eyeK;
    if (this.eyeK > 1) {
      const id = locate(map, body.p).room;
      const room = id === null ? undefined : roomById(map, id);
      if (room !== undefined && room.outdoor !== true) y = Math.min(y, roomElevation(map, room) + roomHeight(map, room) - CEILING_GAP_M);
    }
    return [e[0], y, e[2]];
  }

  /**
   * Every frame. `run`: the vision under way. `pocket`: in the Hallway, the
   * picture's brightness and the body walking there; else null.
   */
  update(dt: number, run: VisionRun | null, pocket: { light: number; body: Body } | null): void {
    const v = this.o.view();
    this.updateFaces(dt, v, pocket !== null);
    if (pocket === null) {
      const moved = this.speedOf(v.body, dt);
      if (run !== null) this.updateRun(dt, run, v, moved);
    } else this.updatePocket(dt, pocket.body);
    this.updateGrade(dt, run, pocket, v);
    const target = run === null ? 1 : aliceAt(run.kind, run.s, run.length);
    this.eyeK += (target - this.eyeK) * (1 - Math.exp(-dt * EYE_RATE));
    if (Math.abs(this.eyeK - 1) < 0.002) this.eyeK = 1;
  }

  private speedOf(body: Body, dt: number): number {
    const last = this.lastFeet;
    this.lastFeet = body.p;
    if (last === null || !(dt > 0)) return 0;
    return Math.hypot(body.p[0] - last[0], body.p[2] - last[2]) / dt;
  }

  private updatePocket(dt: number, body: Body): void {
    const steps = this.pocketSteps;
    if (steps === null) return;
    this.pocketS += dt;
    const speed = this.speedOf(body, dt);
    const vol = steps.tick(dt, speed, this.pocketS);
    if (vol !== null) this.o.sfx.step(vol * (0.5 + Math.min(1, this.pocketS / 30)), 0.12);
  }

  private updateRun(dt: number, run: VisionRun, v: VisionView, speed: number): void {
    const { sfx } = this.o;
    switch (run.kind) {
      case "follower": {
        const vol = this.follower?.tick(dt, speed, run.s) ?? null;
        if (vol !== null) sfx.step(vol, this.followerPan);
        return;
      }
      case "whiteduck":
        this.updatePale(dt, run, v);
        return;
      case "grin":
        this.updateGrin(run, v);
        return;
      case "dark":
        this.updateDark(run, v);
        return;
      case "self":
        this.updateCopy(run, v);
        return;
      case "door":
        this.door.setOpacity(envelope(run.s, run.length, 1.2, 1.5));
        return;
      default:
        return;
    }
  }

  private updatePale(dt: number, run: VisionRun, v: VisionView): void {
    const b = this.paleBody;
    if (b === null) return;
    this.paleS += dt;
    const s = this.paleS;
    const going = s < WHITE_STOPS_S;
    if (going) this.paleBody = move(b, WADDLE, dt, v.world);
    const p = this.paleBody!.p;
    this.pale.update(dt, s);
    const bird = this.paleBird;
    bird.rotation.y = Math.PI * smooth((s - WHITE_STOPS_S) / 0.7);
    bird.scale.set(0.9, 1.3, 0.9);
    this.pale.object.position.set(p[0], p[1], p[2]);
    // The waddle: from foot to foot, a little too far each way.
    this.pale.object.rotation.z = going ? Math.sin(s * 6.5) * 0.2 : 0;
    fadeAll(this.pale.object, envelope(s, run.length, 0.8, 1.4));
    const quackAt = [0.5, 3.6];
    if (this.quacks < quackAt.length && s >= quackAt[this.quacks]!) {
      this.quacks += 1;
      const rel = relativeBearing(v.body.p, p, v.body.yaw);
      this.o.sfx.wrongQuack(0.8, Math.sin(rel * DEG) * 0.7);
    }
  }

  private updateGrin(run: VisionRun, v: VisionView): void {
    const g = this.grin;
    if (g === null) return;
    const s = run.s;
    const near = smooth((Math.hypot(g.object.position.x - v.body.p[0], g.object.position.z - v.body.p[2]) - 0.45) / 0.8);
    // The cat goes first, its eyes next; the grin fades last.
    g.head.material.opacity = 0.34 * envelope(s, 4.6, 1, 1.8) * near;
    g.eyes.material.opacity = envelope(s, 5.9, 1, 1.4) * near;
    g.smile.material.opacity = envelope(s, run.length, 1.4, 1.6) * near;
    const tilt = Math.sin(s * 0.8) * 0.1;
    g.smile.material.rotation = tilt;
    g.eyes.material.rotation = tilt * 0.6;
    // It says its line with the whole of its teeth.
    const talking = s > 2.2 && s < 4.6;
    const open = talking ? 1 + 0.16 * Math.abs(Math.sin(s * 7)) : 1;
    g.smile.scale.set(0.9, 0.45 * open, 1);
    g.object.position.y += Math.sin(s * 1.1) * 0.0006;
  }

  private updateDark(run: VisionRun, v: VisionView): void {
    const eyes = this.behind;
    const after = run.s - GROWL_S;
    if (after >= 0 && !this.growled) {
      this.growled = true;
      this.o.sfx.growl(this.growlPan);
      if (eyes !== null) {
        // Standing back there the whole time: only those who turn round see it.
        const way = wayAhead(v.world, { ...v.body, yaw: wrapYaw(v.body.yaw + 180) }, BEHIND_M, 2.5, [0, 25, -25]);
        if (way !== null) {
          eyes.position.set(way.end[0], way.end[1] + 1.15, way.end[2]);
          eyes.visible = true;
        }
      }
    }
    if (eyes !== null && eyes.visible) eyes.material.opacity = envelope(after, 4.5, 0.5, 1.2);
  }

  private updateCopy(run: VisionRun, v: VisionView): void {
    const walked = (Math.min(run.s, SELF_WALKS_S) / SELF_WALKS_S) * (this.track.length - 1);
    const at = this.track[Math.round(walked)];
    if (at === undefined) return;
    const toward = yawToward(at.p, v.body.p);
    const turn = smooth((run.s - SELF_WALKS_S) / SELF_TURNS_S);
    const yaw = wrapYaw(at.yaw + wrapYaw(toward - at.yaw) * turn);
    this.copy.setPose(at.p, yaw, 0);
    fadeAll(this.copy.object, envelope(run.s, SELF_GONE_S, 0.9, 0.22));
  }

  private updateFaces(dt: number, v: VisionView, hidden: boolean): void {
    if (this.faces.length === 0) return;
    const eye = eyeOf(v.body);
    const floor = floorOf(v.map, v.body.p[1]);
    for (const f of this.faces) {
      const d = Math.hypot(f.prop.pos[0] - eye[0], f.prop.pos[2] - eye[2]);
      const show = !hidden && d < FACE_NEAR_M && floorOf(v.map, f.prop.pos[1]) === floor;
      f.object.visible = show;
      if (!show) continue;
      f.t += dt;
      f.blinkIn -= dt;
      if (f.blinkIn <= 0) {
        f.blinkFor = BLINK_S;
        f.blinkIn = 1.8 + ((f.t * 7.3) % 3.4);
      }
      if (f.blinkFor > 0) f.blinkFor -= dt;
      // Walked round it: it shuts its eyes, and opens them on this side.
      const best = nearestSide(f.sides, eye);
      if (best !== f.side) {
        if (f.blinkFor <= 0) f.blinkFor = BLINK_S;
        else if (f.blinkFor < BLINK_S / 2) {
          f.side = best;
          const s = f.sides[best]!;
          f.object.position.set(s.pos[0], s.pos[1], s.pos[2]);
          f.object.rotation.y = s.yaw * DEG;
        }
      }
      const lid = Math.max(0.06, smooth((FACE_NEAR_M - d) / FACE_OPEN_M) * (f.blinkFor > 0 ? 0.08 : 1));
      // The player in the face's own frame: both eyes on them, always.
      const at = f.sides[f.side]!;
      const r = at.yaw * DEG;
      const vx = eye[0] - at.pos[0];
      const vy = eye[1] - at.pos[1];
      const vz = eye[2] - at.pos[2];
      const lx = vx * Math.cos(r) - vz * Math.sin(r);
      const lz = vx * Math.sin(r) + vz * Math.cos(r);
      const len = Math.hypot(lx, vy, lz) || 1;
      const k = f.radius * 0.72;
      f.lids.forEach((l, i) => {
        l.scale.y = lid;
        f.pupils[i]!.position.set((lx / len) * k, (vy / len) * k, -0.004);
      });
      const speaking = this.speaking === f.prop.id;
      const open = speaking ? 0.3 + 0.7 * Math.abs(Math.sin(f.t * 8.5 + Math.sin(f.t * 2.9) * 1.8)) : 0.1;
      const mw = f.radius * 1.5;
      const mh = f.radius * 0.95 * open;
      f.mouth.scale.set(mw, mh, 1);
      f.teeth.visible = open > 0.25;
      f.teeth.scale.set(mw * 1.2, f.radius * 0.22, 1);
      f.teeth.position.set(0, f.mouth.position.y + mh * 0.68, -0.003);
    }
  }

  private updateGrade(dt: number, run: VisionRun | null, pocket: { light: number } | null, v: VisionView): void {
    const want = pocket !== null ? POCKET_GRADE : gradeOf(this.look, run);
    // Everything eases but a stutter, so a vision cut short never snaps back.
    const k = run?.kind === "flicker" ? 1 : 1 - Math.exp(-dt * GRADE_RATE);
    const g = this.grade;
    g.fog += (want.fog - g.fog) * k;
    g.ambient += (want.ambient - g.ambient) * k;
    g.exposure += (want.exposure - g.exposure) * k;
    g.neon += (want.neon - g.neon) * k;
    g.tintBy += (want.tintBy - g.tintBy) * k;
    g.dark += (want.dark - g.dark) * k;
    this.tintTo.set(want.tint);
    this.tint.lerp(this.tintTo, k);
    const fog = this.o.scene.fog as FogExp2;
    fog.density = this.fogBase * g.fog;
    fog.color.copy(this.fogColor).lerp(this.tint, g.tintBy * 0.7).multiplyScalar(1 - g.dark * 0.96);
    (this.o.scene.background as Color).copy(fog.color);
    this.o.lamps.setGrade(g.ambient, this.tint, g.tintBy);
    v.house.tuneNeon(this.look.flicker, g.neon);
    this.lift = Math.min(1, this.lift + dt / 0.9);
    let shown = g.exposure * smooth(this.lift);
    if (pocket !== null) shown *= pocket.light;
    // Walking up to the door takes the picture down with it.
    else if (this.doorAt !== null && run?.kind === "door") {
      shown *= smooth((Math.hypot(this.doorAt.pos[0] - v.body.p[0], this.doorAt.pos[2] - v.body.p[2]) - 0.7) / 1);
    }
    this.o.setExposure(shown);
  }

  dispose(): void {
    for (const f of this.faces) f.object.removeFromParent();
    this.faces = [];
    this.pale.dispose();
    this.copy.dispose();
    this.door.dispose();
    this.bin.dispose();
    this.object.removeFromParent();
  }
}

/** A prop's own phase, so two faces never blink together. */
function fnvish(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 100;
}
