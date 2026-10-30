//! The descent, the web game's half (wave 49, `docs/loom-w49-contract.md` C2
//! + C5) — pure, node-tested. `@loom/house` decides what both games must
//! agree on (the level, the seeded plan, who wakes, how a talk walks); this
//! is when it happens on a web walk:
//!
//! - **The director** (`Director`): the walk's clock over `descentPlan` +
//!   `dueBeat`, the holds (an escape, a talk, a held walk, a vision still
//!   running, the King within `KING_HOLD_M`, the Hallway), the talk state
//!   machine over `openNode` / `pickOption`, and what is said when. Every
//!   effect goes through `DirectorHost`, so a whole walk is a test.
//! - **How a vision looks over time**, as numbers: `gradeOf` (the light),
//!   `flickerAt` (never faster than 3 Hz), `aliceAt` (the eye height),
//!   `FollowerSteps`.
//!
//! **Nothing here can stop a walk.** A vision or a talk never touches the
//! find, the King, the void, the heart or the disk: the engine runs those
//! whatever this says, and `interrupt` / `stop` get out of their way. Talking
//! never pauses walking: walking away ends a talk (`TALK_LEAVE_M`).
//!
//! The three.js half is `visions.ts` and `hallway.ts`.

import { ALICE_BIG, ALICE_EASE_S, ALICE_SMALL, DESCENT_LATE_S, HALLWAY_DOOR_M, HAZE_FOG_DENSITY, TALK_LEAVE_M, TALK_NEAR_M, VISION_S, clampDescent, descentPlan, doorSpot, dueBeat, faceAnchor, fillLine, floorOf, openNode, pickLine, pickOption, standable, stepPaceS, talkReach, wakeTalkers } from "@loom/house";
import type { DescentBeat, DescentLook, DescentScript, HouseMap, Prop, Talker, Vec3, VisionKind } from "@loom/house";
import { move, type Body, type PhysicsWorld } from "./physics.ts";

/** A beat waits while the player stands this close to the King (m). */
export const KING_HOLD_M = 3;
/** Walked off mid-talk: the prop leaves them alone this long (s). */
export const TALK_AGAIN_S = 30;
/** A question left unanswered this long ends the talk (s). */
export const TALK_PATIENCE_S = 45;
/** The last line of a talk stays this long after it is said (s). */
export const TALK_LINGER_S = 1;
/** An awake prop is heard mumbling within this (m, plan). */
export const MUMBLE_M = 6;
/** Eye height is this far under a ceiling at the least (m). */
export const CEILING_GAP_M = 0.12;
/** `dark`: the fog's density at its deepest: about 3 m of sight. */
export const DARK_DENSITY = 0.42;

/** When a vision says its line (s into it). None: it has none. */
export const VISION_LINE_AT: Readonly<Partial<Record<VisionKind, number>>> = { whisper: 0.8, whiteduck: 1.4, grin: 2.2, self: 5.4, small: 2, big: 2 };

/** A door spot, as `doorSpot` answers. */
export interface DoorAt {
  pos: Vec3;
  yaw: number;
}

/** The vision under way. */
export interface VisionRun {
  kind: VisionKind;
  n: number;
  /** Seconds since it started. */
  s: number;
  length: number;
  /** `door` only: where it stands. */
  door: DoorAt | null;
  said: boolean;
}

/** One awake prop. */
export interface AwakeTalker {
  prop: Prop;
  talker: Talker;
}

/** The talk under way, as the screen shows it. */
export interface TalkRun {
  prop: Prop;
  talker: Talker;
  node: string;
  /** `saying`: its lines are playing. `choosing`: the options are up. `closing`: said, going. */
  stage: "saying" | "choosing" | "closing";
  /** Seconds in this stage (`choosing`, `closing`). */
  s: number;
}

/** The world a tick reads. */
export interface WalkNow {
  feet: Vec3;
  /** Where the player faces (degrees). */
  yaw: number;
  /** An escape is under way. */
  escaping: boolean;
  /** Held under an overlay. */
  held: boolean;
  /** Within `KING_HOLD_M` of the King. */
  kingNear: boolean;
}

/** Everything a `Director` does to the world. */
export interface DirectorHost {
  /** Draw a vision. False: it can't be drawn here (it is skipped; the rest keep their time). */
  start(kind: VisionKind, n: number, door: DoorAt | null): boolean;
  /** Take a vision down (its time ran out, or it was cut). */
  stop(kind: VisionKind): void;
  /** Caption and voice; resolves when said, or cut. */
  say(lines: readonly string[]): Promise<void>;
  /** Cut what the descent is saying (never the story's own lines). */
  hush(): void;
  /** Remember what a talker was told (`POST /api/spatial/told`). */
  tell(talker: string, mark: string): void;
  /** The talk changed: redraw it. */
  talkChanged(): void;
  /** Through the door. */
  enterHallway(door: DoorAt, n: number): void;
  /** An awake prop mumbles (`closeness` 0 … 1). */
  mumble(prop: Prop, closeness: number): void;
}

export interface DirectorOptions {
  host: DirectorHost;
  level: number;
  /** The plan's and the wake's seed: the session id. */
  seed: string;
  house: HouseMap;
  /** `{name}` and `{visit}` in the lines. */
  who: { name: string; visit: number };
  /** The assignment's `told`. */
  told?: Record<string, string> | undefined;
}

/** Plan distance within this of a door, on its floor? */
export function atDoor(house: HouseMap, feet: Vec3, door: DoorAt, radius = HALLWAY_DOOR_M): boolean {
  return floorOf(house, feet[1]) === floorOf(house, door.pos[1]) && Math.hypot(door.pos[0] - feet[0], door.pos[2] - feet[2]) <= radius;
}

/** The line a vision says at `n`, filled in; null when it has none. */
export function visionLine(script: DescentScript | null, kind: VisionKind, n: number, level: number, who: { name: string; visit: number }): string | null {
  if (script === null) return null;
  const list = kind === "whisper" ? script.whispers[String(clampDescent(level))] : kind === "grin" || kind === "whiteduck" || kind === "self" || kind === "small" || kind === "big" ? script[kind] : undefined;
  const line = pickLine(list, n);
  return line === null ? null : fillLine(line, who);
}

/** What Gerald says at the find on this walk, filled in; null: nothing. */
export function foundLine(script: DescentScript | null, level: number, n: number, who: { name: string; visit: number }): string | null {
  const line = pickLine(script?.found[String(clampDescent(level))], n);
  return line === null ? null : fillLine(line, who);
}

/** Keys 1–4 (top row or keypad) as an option's index, else null. */
export function talkKey(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-4])$/u.exec(code);
  return m === null ? null : Number(m[1]) - 1;
}

/**
 * A walk's descent: the clock, the plan, the holds and the talks. `tick` it
 * every play frame once the intro is over.
 */
export class Director {
  readonly level: number;
  private readonly host: DirectorHost;
  private readonly seed: string;
  private readonly who: { name: string; visit: number };
  private readonly told: Record<string, string>;
  private readonly plan: readonly DescentBeat[];
  private house: HouseMap;
  private script: DescentScript | null = null;
  private next = 0;
  private clock = 0;
  private turn = 0;
  /** A vision a talker set off, waiting for its turn. */
  private pending: { kind: VisionKind; at: number } | null = null;
  private lastDoorN = 0;
  private mumbleAt = 0;
  private mumbles = 0;
  /** Prop id → the clock it may talk again (Infinity: done for this walk). */
  private readonly quiet = new Map<string, number>();
  /** Bumped by every new node or end: a line finishing late is ignored. */
  private talkGen = 0;
  private over = false;
  run: VisionRun | null = null;
  talk: TalkRun | null = null;
  /** In the pocket: every beat waits. */
  hallway = false;
  awake: AwakeTalker[] = [];

  constructor(o: DirectorOptions) {
    this.level = clampDescent(o.level);
    this.host = o.host;
    this.seed = o.seed;
    this.who = o.who;
    this.told = { ...(o.told ?? {}) };
    this.house = o.house;
    this.plan = descentPlan(o.seed, this.level);
  }

  /** The words arrived (null: none: the visions play without them). */
  setScript(script: DescentScript | null): void {
    this.script = script;
    this.wake();
  }

  /** The map changed: nobody is mid-sentence on a prop that may have moved. */
  setHouse(house: HouseMap): void {
    this.house = house;
    this.interrupt();
    this.wake();
  }

  private wake(): void {
    this.awake = [];
    for (const w of wakeTalkers(this.house, this.script, this.level, this.seed)) {
      const prop = this.house.props.find((p) => p.id === w.prop);
      const talker = this.script?.talkers.find((t) => t.id === w.talker);
      if (prop !== undefined && talker !== undefined) this.awake.push({ prop, talker });
    }
  }

  /** The walk's clock (s), from the end of the intro. */
  get time(): number {
    return this.clock;
  }

  /** Something the walk needs right now: anything the descent is doing gives way (it may go on later). */
  interrupt(): void {
    this.pending = null;
    this.endRun();
    this.endTalk(TALK_AGAIN_S);
    this.host.hush();
  }

  /** The walk is over: nothing more happens. */
  stop(): void {
    this.interrupt();
    this.hallway = false;
    this.over = true;
  }

  /** The story has something to say: the descent falls silent for it. */
  hush(): void {
    if (this.talk !== null) this.endTalk(TALK_AGAIN_S);
    this.host.hush();
  }

  tick(dt: number, w: WalkNow): void {
    if (this.over) return;
    this.clock += dt;
    this.tickRun(dt, w);
    if (this.hallway) return;
    this.tickTalk(dt, w);
    this.tickMumble(w);
    if (this.run === null) this.nextVision(w);
  }

  private tickRun(dt: number, w: WalkNow): void {
    const r = this.run;
    if (r === null) return;
    r.s += dt;
    const at = VISION_LINE_AT[r.kind];
    if (!r.said && at !== undefined && r.s >= at) {
      r.said = true;
      // A talk's own words stand for a vision it set off.
      const line = this.talk === null ? visionLine(this.script, r.kind, r.n, this.level, this.who) : null;
      if (line !== null) void this.host.say([line]);
    }
    if (r.door !== null && atDoor(this.house, w.feet, r.door)) {
      const door = r.door;
      this.lastDoorN = r.n;
      this.endRun();
      this.endTalk(TALK_AGAIN_S);
      this.pending = null;
      this.hallway = true;
      this.host.hush();
      this.host.enterHallway(door, this.lastDoorN);
      void this.host.say(this.fill(this.script?.hallway.enter));
      return;
    }
    if (r.s >= r.length) this.endRun();
  }

  private fill(lines: readonly string[] | undefined): string[] {
    return (lines ?? []).map((l) => fillLine(l, this.who));
  }

  private endRun(): void {
    const r = this.run;
    if (r === null) return;
    this.run = null;
    this.host.stop(r.kind);
  }

  private nextVision(w: WalkNow): void {
    const hold = w.escaping || w.held || w.kingNear;
    const p = this.pending;
    if (p !== null) {
      if (this.clock - p.at > DESCENT_LATE_S) this.pending = null;
      else if (!hold) {
        this.pending = null;
        this.turn += 1;
        this.begin(p.kind, this.turn, w);
        return;
      }
    }
    if (hold || this.talk !== null) return;
    const i = dueBeat(this.plan, this.next, this.clock);
    if (i < 0) return;
    this.next = i + 1;
    this.begin(this.plan[i]!.vision, this.plan[i]!.n, w);
  }

  private begin(kind: VisionKind, n: number, w: WalkNow): void {
    let door: DoorAt | null = null;
    if (kind === "door") {
      door = doorSpot(this.house, w.feet, w.yaw);
      if (door === null) return;
    }
    if (!this.host.start(kind, n, door)) return;
    this.run = { kind, n, s: 0, length: VISION_S[kind], door, said: false };
  }

  private tickTalk(dt: number, w: WalkNow): void {
    const t = this.talk;
    if (t === null) {
      if (!w.escaping && !w.held) this.maybeOpen(w);
      return;
    }
    if (w.escaping || w.held || !talkReach(this.house, w.feet, t.prop, TALK_LEAVE_M)) {
      this.host.hush();
      this.endTalk(t.stage === "closing" ? Infinity : TALK_AGAIN_S);
      return;
    }
    t.s += dt;
    if (t.stage === "closing" && t.s >= TALK_LINGER_S) this.endTalk(Infinity);
    else if (t.stage === "choosing" && t.s >= TALK_PATIENCE_S) this.endTalk(TALK_AGAIN_S);
  }

  private maybeOpen(w: WalkNow): void {
    for (const a of this.awake) {
      if ((this.quiet.get(a.prop.id) ?? 0) > this.clock) continue;
      if (!talkReach(this.house, w.feet, a.prop, TALK_NEAR_M)) continue;
      this.talk = { prop: a.prop, talker: a.talker, node: openNode(a.talker, this.told), stage: "saying", s: 0 };
      this.host.talkChanged();
      this.sayNode();
      return;
    }
  }

  private sayNode(): void {
    const t = this.talk!;
    const node = t.talker.nodes[t.node];
    const gen = ++this.talkGen;
    if (node?.do !== undefined) this.pending = { kind: node.do, at: this.clock };
    void this.host.say(this.fill(node?.say)).then(() => {
      if (gen !== this.talkGen || this.talk === null) return;
      this.talk.stage = (node?.options?.length ?? 0) > 0 ? "choosing" : "closing";
      this.talk.s = 0;
      this.host.talkChanged();
    });
  }

  /** The options on screen, filled in; null while none are up. */
  get options(): string[] | null {
    const t = this.talk;
    if (t === null || t.stage !== "choosing") return null;
    return (t.talker.nodes[t.node]?.options ?? []).map((o) => fillLine(o.text, this.who));
  }

  /** The player picked an option: true when it was one. */
  pick(index: number): boolean {
    const t = this.talk;
    if (t === null || t.stage !== "choosing") return false;
    const r = pickOption(t.talker, t.node, index);
    if (r === null) return false;
    if (r.tell !== null) {
      this.told[t.talker.id] = r.tell;
      this.host.tell(t.talker.id, r.tell);
    }
    if (r.vision !== null) this.pending = { kind: r.vision, at: this.clock };
    if (r.to === null) {
      this.endTalk(Infinity);
      return true;
    }
    t.node = r.to;
    t.stage = "saying";
    t.s = 0;
    this.host.talkChanged();
    this.sayNode();
    return true;
  }

  private endTalk(quietFor: number): void {
    const t = this.talk;
    if (t === null) return;
    this.talkGen += 1;
    this.talk = null;
    this.quiet.set(t.prop.id, this.clock + quietFor);
    this.host.talkChanged();
  }

  private tickMumble(w: WalkNow): void {
    if (this.talk !== null || this.clock < this.mumbleAt) return;
    this.mumbles += 1;
    this.mumbleAt = this.clock + 2.4 + (this.mumbles % 4) * 0.7;
    let best: { prop: Prop; closeness: number } | null = null;
    for (const a of this.awake) {
      if ((this.quiet.get(a.prop.id) ?? 0) === Infinity) continue;
      if (!talkReach(this.house, w.feet, a.prop, MUMBLE_M)) continue;
      const d = Math.hypot(a.prop.pos[0] - w.feet[0], a.prop.pos[2] - w.feet[2]);
      const closeness = Math.max(0, 1 - d / (MUMBLE_M + 1));
      if (best === null || closeness > best.closeness) best = { prop: a.prop, closeness };
    }
    if (best !== null) this.host.mumble(best.prop, best.closeness);
  }

  /** What Gerald says at this walk's find, null: nothing. */
  lineAtFind(): string | null {
    return foundLine(this.script, this.level, this.plan[0]?.n ?? 0, this.who);
  }

  /** Part way down the Hallway. */
  hallwayFar(): void {
    const line = pickLine(this.script?.hallway.far, this.lastDoorN);
    if (line !== null) void this.host.say([fillLine(line, this.who)]);
  }

  /** Back in the house (`quiet`: the session is over, or the map moved: no words). */
  leftHallway(quiet: boolean): void {
    this.hallway = false;
    if (quiet) return;
    this.host.hush();
    void this.host.say(this.fill(this.script?.hallway.out));
  }
}

// --- the shape of a vision, in numbers ----------------------------------------

/** 0 → 1 with a soft start and a soft end. */
export function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/** Eased in over `inS`, out over `outS` (the last of `length`). */
export function envelope(s: number, length: number, inS: number, outS: number): number {
  return Math.min(smooth(s / inS), smooth((length - s) / outS));
}

/** `flicker`'s stutters, as `[seconds, level]`. A dip and the light after it
 *  always make at least a third of a second: never faster than 3 Hz. */
const STUTTERS: readonly (readonly (readonly [number, number])[])[] = [
  [[0.16, 0.2], [0.2, 0.85], [0.2, 0.3], [0.46, 1], [0.42, 0.12], [0.3, 0.7], [0.34, 0.35]],
  [[0.4, 0.15], [0.24, 0.9], [0.17, 0.25], [0.17, 0.8], [0.2, 0.2], [0.5, 1], [0.3, 0.3]],
  [[0.18, 0.3], [0.16, 0.9], [0.5, 0.1], [0.3, 0.75], [0.17, 0.2], [0.2, 0.95], [0.4, 0.4]],
];

/** The lights' level `s` into a `flicker`. */
export function flickerAt(s: number, n: number): number {
  let t = s;
  for (const [len, level] of STUTTERS[Math.abs(Math.trunc(n)) % STUTTERS.length]!) {
    if (t < len) return level;
    t -= len;
  }
  return 1;
}

/** The eye height's scale `s` into a `small` / `big`, eased `ALICE_EASE_S` each way. Else 1. */
export function aliceAt(kind: VisionKind, s: number, length: number): number {
  if (kind !== "small" && kind !== "big") return 1;
  const to = kind === "small" ? ALICE_SMALL : ALICE_BIG;
  return 1 + (to - 1) * envelope(s, length, ALICE_EASE_S, ALICE_EASE_S);
}

/** The colours `tint` goes, by `n`: none of them a colour the house ever is. */
export const WRONG_TINTS: readonly string[] = ["#ff2140", "#2bff77", "#7a2bff", "#ffb000"];

/** How the house is lit right now: each multiplies the game's own. */
export interface Grade {
  /** × the fog's density. */
  fog: number;
  /** × the hemisphere and the sun. */
  ambient: number;
  /** × the tone map's exposure. */
  exposure: number;
  /** × the neon's brightness. */
  neon: number;
  /** Mixed into the light and the fog by `tintBy`. */
  tint: string;
  tintBy: number;
  /** 0 … 1: the fog and the sky go to black. */
  dark: number;
}

/** The level's steady look with the running vision over it. */
export function gradeOf(look: DescentLook, run: Pick<VisionRun, "kind" | "n" | "s" | "length"> | null): Grade {
  const g: Grade = { fog: look.fog, ambient: look.ambient, exposure: 1, neon: 1, tint: look.tint, tintBy: look.tintBy, dark: 0 };
  if (run === null) return g;
  if (run.kind === "flicker") {
    const v = flickerAt(run.s, run.n);
    g.exposure = 0.35 + 0.65 * v;
    g.ambient *= v;
    g.neon = v;
  } else if (run.kind === "tint") {
    const e = envelope(run.s, run.length, 2.2, 2.6);
    g.tint = WRONG_TINTS[Math.abs(Math.trunc(run.n)) % WRONG_TINTS.length]!;
    g.tintBy = look.tintBy + (0.82 - look.tintBy) * e;
  } else if (run.kind === "dark") {
    const e = envelope(run.s, run.length, 1.6, 2);
    g.dark = e;
    g.fog = look.fog + (DARK_DENSITY / HAZE_FOG_DENSITY - look.fog) * e;
    g.ambient = look.ambient * (1 - 0.45 * e);
    g.exposure = 1 - 0.15 * e;
    g.neon = 1 - 0.93 * e;
  }
  return g;
}

/** How the Hallway is lit: black but for the one light that goes with them. */
export const POCKET_GRADE: Grade = { fog: 0.13 / HAZE_FOG_DENSITY, ambient: 0, exposure: 1, neon: 0, tint: "#000000", tintBy: 0, dark: 1 };

/**
 * The sides of a prop a face can be on: `faceAnchor` on its front, and on
 * every other side a program can stand at (a plant in a corner never faces
 * the wall). Always at least its front.
 */
export function faceSides(house: HouseMap, prop: Prop): DoorAt[] {
  const yaw = prop.yaw ?? 0;
  const out: DoorAt[] = [];
  for (const turn of [0, 180, 90, -90]) {
    const [w, h, d] = prop.size;
    const a = faceAnchor({ ...prop, yaw: yaw + turn, size: turn % 180 === 0 ? [w, h, d] : [d, h, w] });
    const r = (a.yaw * Math.PI) / 180;
    if (standable(house, [a.pos[0] - Math.sin(r) * 0.5, prop.pos[1], a.pos[2] - Math.cos(r) * 0.5])) out.push(a);
  }
  return out.length > 0 ? out : [faceAnchor(prop)];
}

/** Which of `sides` faces a program at `at`: the one it is most in front of. */
export function nearestSide(sides: readonly DoorAt[], at: Vec3): number {
  let best = 0;
  let score = Number.NEGATIVE_INFINITY;
  sides.forEach((side, i) => {
    const r = (side.yaw * Math.PI) / 180;
    const facing = -Math.sin(r) * (at[0] - side.pos[0]) - Math.cos(r) * (at[2] - side.pos[2]);
    if (facing > score) {
      score = facing;
      best = i;
    }
  });
  return best;
}

/** The way ahead of a body, walked for real: what it can reach in a line. */
export interface WayAhead {
  /** The walked points, from the body. */
  points: Vec3[];
  /** Where it ended. */
  end: Vec3;
  /** The way it walked (degrees). */
  yaw: number;
  /** How far it got (m). */
  walked: number;
}

/**
 * Up to `metres` along `yaw` with the game's own `move`: walls stop it, so a
 * vision never stands behind one. `at least` metres, or look a little to
 * either side; null when nothing that far can be walked to.
 */
export function wayAhead(world: PhysicsWorld, body: Body, metres: number, least: number, turns: readonly number[] = [0, 30, -30, 60, -60]): WayAhead | null {
  const input = { move: [0, 1] as [number, number], turn: 0, look: 0, run: false };
  for (const turn of turns) {
    const yaw = body.yaw + turn;
    let b: Body = { p: [body.p[0], body.p[1], body.p[2]], yaw, pitch: 0, vy: 0 };
    const points: Vec3[] = [b.p];
    let walked = 0;
    while (walked < metres) {
      const next = move(b, input, 0.05, world);
      const d = Math.hypot(next.p[0] - b.p[0], next.p[2] - b.p[2]);
      if (d < 0.02) break;
      walked += d;
      b = next;
      points.push(b.p);
    }
    if (walked >= least) return { points, end: b.p, yaw, walked };
  }
  return null;
}

/** The pause between the follower's last step and the end (s). */
const LAST_STEP_S = 0.45;
/** When the player stops, it takes one more step this much later (s). */
const LATE_STEP_S = 0.22;

/**
 * `follower`: the steps behind the player, a volume to play or null, every
 * frame. They walk when the player walks, a little out of time, growing;
 * when the player stops, they take one late step and stop; and at the very
 * end, wherever the player is, one step more.
 */
export class FollowerSteps {
  private readonly length: number;
  private sinceStep = 0;
  private moving = false;
  private late = -1;
  private ended = false;

  constructor(length: number) {
    this.length = length;
  }

  tick(dt: number, speed: number, s: number): number | null {
    if (!this.ended && s >= this.length - LAST_STEP_S) {
      this.ended = true;
      return 0.9;
    }
    if (this.ended) return null;
    const moving = speed > 0.25;
    if (this.moving && !moving) this.late = LATE_STEP_S;
    this.moving = moving;
    if (!moving) {
      if (this.late < 0) return null;
      this.late -= dt;
      if (this.late >= 0) return null;
      return this.volume(s);
    }
    this.late = -1;
    this.sinceStep += dt;
    if (this.sinceStep < stepPaceS(speed)) return null;
    this.sinceStep = 0;
    return this.volume(s);
  }

  private volume(s: number): number {
    return 0.25 + 0.4 * Math.min(1, s / this.length);
  }
}
