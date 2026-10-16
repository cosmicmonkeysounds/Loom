//! The game itself — the imperative half (three.js, the DOM, the network);
//! everything it decides with is in the pure modules beside it
//! (`physics.ts`, `input.ts`, `pump.ts`, `hud.ts`).
//!
//! One `Game` per session: the house from `@loom/house/three` (the same
//! scene the terminals render), Gerald at the assignment's duck spot, the
//! golden chevron trail along `route()` (`trail.ts`: made walkable on a
//! stair) refreshed twice a second, the other
//! players as ghosts off the spatial stream, a first-person camera at eye
//! height. The pose goes out at 10 Hz through the pump. Reaching the duck
//! (≤ 0.9 m, same floor) posts `found`; the duck lays its egg and flies.
//! Rendering, the pose pump and the idle leash pause while the tab is
//! hidden (so the server's 60 s pose timeout drops a tab left hidden);
//! 120 s without input ends it; leaving the page ends it at once.

import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Group } from "three";
import { buildWalls, pathLength, spaceOf, toSpace, yawFromSpace, yawToSpace } from "@loom/house";
import type { Assignment, DuckSpot, FoundResult, HouseMap, PlayerPose, PlayerState, Prop, SpatialFrame, Vec3 } from "@loom/house";
import { applySpace, buildHouseScene, createAvatar, createDuck, createTrail, houseAtmosphere, PoseBuffer, spaceGroup } from "@loom/house/three";
import type { Avatar, Duck, HouseScene, King, Trail } from "@loom/house/three";
import { fetchHouse, postEnd, postFound, postPose, streamUrl } from "../api.ts";
import { applyFrame, duckToAdopt, houseVersionOf, openSpatialStream, type SpatialStreamHandle } from "../spatial.ts";
import type { Sfx } from "./audio.ts";
import { canHit, fell, hearts, hit as landHit, KING_HP, newFight, stageFor, STAGE_LINE, type Fight, type HitVerdict, type Stage } from "./fight.ts";
import { formatElapsed, foundRetryMs, heat, PAUSED_NOTICE, perchedOutOfReach, relativeBearing, roomTitle, withinReach, type Heat } from "./hud.ts";
import { combineInput, isActive, keyDown, keyUp, type StickVector } from "./input.ts";
import { IdleLeash } from "./leash.ts";
import { bodyAfterRemap, buildPhysicsWorld, eyeOf, move, NO_INPUT, spawnBody, type Body, type PhysicsOptions, type PhysicsWorld } from "./physics.ts";
import { NoRenderer } from "./no-start.ts";
import { PosePump } from "./pump.ts";
import { trail } from "./trail.ts";

export { IDLE_LIMIT_MS, IDLE_WARN_MS } from "./leash.ts";
const TRAIL_EVERY_MS = 500;
const HUD_EVERY_MS = 200;
const QUACK_RANGE = 7;
/** Start looking a little down, so the trail on the floor is in view. */
const START_PITCH = -8;
const DEG = Math.PI / 180;

export interface HudState {
  room: string;
  location: string | null;
  heat: Heat;
  /** Metres of route to the duck. */
  distance: number;
  elapsed: string;
  /** Compass bearing the player faces, degrees clockwise from north. */
  yaw: number;
  /** On-screen angle of the next waypoint (degrees, clockwise), null when none. */
  pip: number | null;
  /** Seconds left before the no-input leash ends the session (only near the end). */
  idleLeft: number | null;
  /** Other players in the simulation right now. */
  others: number;
  /** The spatial stream is up. */
  live: boolean;
  /** A passing message ("closer…"). */
  notice: string | null;
  /** The King (a `king` prop on this map), null when the map has none. */
  king: KingHud | null;
}

/** The King as the HUD shows him. */
export interface KingHud {
  id: string;
  label: string;
  hp: number;
  max: number;
  /** The hearts string (`fight.ts`). */
  hearts: string;
  stage: Stage;
  /** Whether a hit would land right now (the ⚔ / ♟ buttons show when near). */
  verdict: HitVerdict;
  fallen: boolean;
  /** The fight is armed (true) or practice (false); null = unknown / the prop declares no `armed`. */
  armed: boolean | null;
}

/** What the board needs when a challenge opens. */
export interface ChessContext {
  stage: Stage;
  label: string;
  armed: boolean | null;
}

export type ChessResult = "won" | "lost" | "drawn" | "abandoned";

export type GameEnd = { kind: "over"; reason: string } | { kind: "idle" };

export interface GameOptions {
  canvas: HTMLCanvasElement;
  house: HouseMap;
  /** The version of `house` — the assignment's `houseVersion` (`fetchDealtHouse`). */
  houseVersion: string;
  assignment: Assignment;
  /** The event-scoped API base (`/e/<id>`). */
  base: string;
  /** This device's name (the stream subscriber's name). */
  device: string;
  arrowsTurn: boolean;
  /** The on-screen sticks, read every frame. */
  sticks: () => { left: StickVector; right: StickVector };
  sfx: Sfx;
  onHud: (h: HudState) => void;
  /** The duck was reached and the server agreed — the egg is being laid. */
  onFound: (r: FoundResult) => void;
  /** The session ended without a find (the run restarted, the leash ran out). */
  onEnd: (e: GameEnd) => void;
  /** A challenge opened (the board) or closed (null). */
  onChess?: (c: ChessContext | null) => void;
  /** Fire a story signal as this device (`postSignal`); resolves whether it landed. */
  signal?: (name: string) => Promise<boolean>;
  /** Is the fight armed? (`fetchArmed`; null = unknown.) */
  armed?: (path: string, min: number) => Promise<boolean | null>;
}

interface Ghost {
  avatar: Avatar;
  buffer: PoseBuffer;
}

const LEAVE_REASON: Record<string, string> = {
  replaced: "This program was started again on another device.",
  timeout: "The connection timed out.",
  reset: "The system restarted — scan the pass again.",
  ended: "A director ended this session.",
};

export class Game {
  private readonly o: GameOptions;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.05, 80);
  /** The map being played — swapped in place when a director saves a new one. */
  private map: HouseMap;
  private mapVersion: string;
  private house: HouseScene;
  private readonly duck: Duck;
  /** Where Gerald sits — the assignment's spot until a map save moves or
   *  re-deals it (`duck` on the map GET / a `duck` stream frame, §2.2). */
  private duckSpot: DuckSpot;
  private readonly trail: Trail;
  private world: PhysicsWorld;
  private readonly root: Group;
  private readonly pump: PosePump;
  private stream: SpatialStreamHandle | null = null;
  private body: Body;
  private keys = new Set<string>();
  private drag: [number, number] = [0, 0];
  private dragPointer: number | null = null;
  private dragLast: [number, number] = [0, 0];
  private ghosts = new Map<string, Ghost>();
  private players: ReadonlyMap<string, PlayerState> = new Map();
  private raf = 0;
  private last = 0;
  private startedAt = performance.now();
  private readonly leash = new IdleLeash(performance.now());
  /** A remap is being fetched / another frame asked for one meanwhile. */
  private remapping = false;
  private remapAgain = false;
  /** "Gerald is out of reach" was said for this approach. */
  private perchedSaid = false;
  private lastTrailAt = Number.NEGATIVE_INFINITY;
  private lastHudAt = Number.NEGATIVE_INFINITY;
  private nextQuackAt = performance.now() + 2500;
  private path: Vec3[] = [];
  private distance = 0;
  private distHistory: Array<{ t: number; d: number }> = [];
  private live = false;
  private notice: { text: string; until: number } | null = null;
  private phase: "playing" | "finding" | "found" | "ended" | "chess" = "playing";
  // The King (`fight.ts`): per session, nothing shared.
  private fight: Fight = newFight();
  private kingProp: Prop | null = null;
  private king: King | null = null;
  private hitQueued = false;
  private challengeQueued = false;
  private kingVerdict: HitVerdict = "far";
  private armedState: boolean | null = null;
  private foundCooldownUntil = 0;
  /** Refusals since the player last stepped out of reach (the backoff exponent). */
  private foundRefusals = 0;
  private pumpTimer = 0;
  private resizeObserver: ResizeObserver | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: GameOptions) {
    this.o = opts;
    const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    const dpr = window.devicePixelRatio || 1;
    // A cheap tablet at DPR 1 pays for MSAA it can't afford.
    try {
      this.renderer = new WebGLRenderer({ canvas: opts.canvas, antialias: !(coarse && dpr < 2), powerPreference: "high-performance" });
    } catch (e) {
      throw new NoRenderer(e);
    }
    this.renderer.setPixelRatio(Math.min(dpr, 1.5));
    houseAtmosphere(this.scene);
    this.camera.rotation.order = "YXZ";

    this.map = opts.house;
    this.mapVersion = opts.houseVersion;
    this.kingProp = opts.house.props.find((p) => p.kind === "king") ?? null;
    this.fight = newFight(this.kingProp?.hp ?? KING_HP);
    const walls = buildWalls(opts.house);
    this.world = buildPhysicsWorld(opts.house, walls, this.physicsOptions());
    const root = spaceGroup(spaceOf(opts.house, "web"));
    this.root = root;
    this.scene.add(root);
    this.house = buildHouseScene(opts.house, { walls });
    root.add(this.house.root);
    this.bindKing();
    this.duck = createDuck();
    this.duckSpot = opts.assignment.duck;
    this.duck.object.position.set(...this.duckSpot.pos);
    root.add(this.duck.object);
    this.trail = createTrail();
    root.add(this.trail.object);

    this.body = { ...spawnBody(opts.house, opts.assignment.spawn), pitch: START_PITCH };
    this.pump = new PosePump({
      send: (body) => postPose(opts.base, opts.assignment.token, body),
      now: () => performance.now(),
      onOver: (status) => this.end({ kind: "over", reason: status === 410 ? "This session is over." : "The system restarted — scan the pass again." }),
    });
  }

  /** Start rendering, listening and streaming. */
  start(): void {
    this.listen();
    this.resize();
    this.pump.set(this.pose());
    void this.pump.tick(); // the first pose claims the session at once
    if (document.hidden) this.leash.hide(performance.now());
    else this.startPump();
    this.stream = openSpatialStream(streamUrl(this.o.base, this.o.assignment.token, this.o.device), {
      onFrame: (f) => this.onFrame(f),
      onState: (up) => (this.live = up),
    });
    this.loop(performance.now());
  }

  /** The player gave up (the ✕ button): end the session on the server. */
  quit(): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.pump.stop();
    void postEnd(this.o.base, this.o.assignment.token);
  }

  /** The 50 ms pump tick (sends at most at 10 Hz, keepalives every 5 s). */
  private startPump(): void {
    window.clearInterval(this.pumpTimer);
    this.pumpTimer = window.setInterval(() => void this.pump.tick(), 50);
  }

  dispose(): void {
    this.phase = this.phase === "found" ? "found" : "ended";
    cancelAnimationFrame(this.raf);
    window.clearInterval(this.pumpTimer);
    this.pump.stop();
    this.stream?.close();
    this.resizeObserver?.disconnect();
    for (const c of this.cleanups) c();
    for (const g of this.ghosts.values()) g.avatar.dispose();
    this.ghosts.clear();
    this.duck.dispose();
    this.trail.dispose();
    this.house.dispose();
    this.renderer.dispose();
    // `dispose()` keeps the WebGL context (and its MSAA buffers) alive until
    // the detached canvas is collected — a context per session piles up on
    // a tablet over a night. Release it now (dispose already unhooked the
    // renderer's own context-lost listener).
    this.renderer.forceContextLoss();
    this.o.canvas.width = 0;
    this.o.canvas.height = 0;
  }

  // --- input ---------------------------------------------------------------

  private listen(): void {
    const typing = (e: Event): boolean => {
      const t = e.target as HTMLElement | null;
      return t !== null && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent): void => {
      if (typing(e)) return;
      if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && this.phase === "playing") {
        if (e.code === "Space") this.hitQueued = true;
        if (e.code === "KeyC") this.challengeQueued = true;
      }
      if (keyDown(this.keys, e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => keyUp(this.keys, e);
    const blur = (): void => {
      this.keys.clear();
      this.dragPointer = null;
    };
    const canvas = this.o.canvas;
    const pdown = (e: PointerEvent): void => {
      if (this.dragPointer !== null) return;
      this.dragPointer = e.pointerId;
      this.dragLast = [e.clientX, e.clientY];
      canvas.setPointerCapture?.(e.pointerId);
    };
    const pmove = (e: PointerEvent): void => {
      if (e.pointerId !== this.dragPointer) return;
      this.drag[0] += e.clientX - this.dragLast[0];
      this.drag[1] += e.clientY - this.dragLast[1];
      this.dragLast = [e.clientX, e.clientY];
    };
    const pup = (e: PointerEvent): void => {
      if (e.pointerId === this.dragPointer) this.dragPointer = null;
    };
    const visibility = (): void => {
      cancelAnimationFrame(this.raf);
      const now = performance.now();
      if (document.hidden) {
        // No keepalives while nobody can play: the server's 60 s pose
        // timeout drops a tab left hidden. The idle leash pauses too.
        this.leash.hide(now);
        window.clearInterval(this.pumpTimer);
        return;
      }
      this.leash.show(now);
      if (this.phase === "playing" || this.phase === "finding" || this.phase === "chess") {
        this.startPump();
        void this.pump.tick(); // timed out meanwhile → the 410 ends it as "over"
      }
      this.last = now;
      this.loop(now);
    };
    // Leaving the page (reload, close, navigate) ends the session at once —
    // a keepalive fetch outlives the unload — instead of a frozen ghost
    // lingering on every terminal for the 60 s timeout.
    const hide = (): void => {
      if (this.phase === "playing" || this.phase === "finding" || this.phase === "chess") void postEnd(this.o.base, this.o.assignment.token);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    canvas.addEventListener("pointerdown", pdown);
    canvas.addEventListener("pointermove", pmove);
    canvas.addEventListener("pointerup", pup);
    canvas.addEventListener("pointercancel", pup);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", hide);
    this.cleanups.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("pointerdown", pdown);
      canvas.removeEventListener("pointermove", pmove);
      canvas.removeEventListener("pointerup", pup);
      canvas.removeEventListener("pointercancel", pup);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", hide);
    });
    const parent = canvas.parentElement;
    if (parent !== null && typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(parent);
    }
  }

  private resize(): void {
    const el = this.o.canvas.parentElement ?? this.o.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // A portrait tablet sees more ceiling than room at 70°: widen a little.
    this.camera.fov = w < h ? 78 : 70;
    this.camera.updateProjectionMatrix();
  }

  // --- the loop ------------------------------------------------------------

  private loop = (now: number): void => {
    if (document.hidden || this.phase === "ended") return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0, (now - (this.last || now)) / 1000));
    this.last = now;
    this.frame(now, dt);
  };

  private frame(now: number, dt: number): void {
    const playing = this.phase === "playing" || this.phase === "finding";
    const sticks = this.o.sticks();
    const input = playing ? combineInput({ keys: this.keys, left: sticks.left, right: sticks.right, drag: this.drag, arrowsTurn: this.o.arrowsTurn }) : NO_INPUT;
    this.drag = [0, 0];
    if (isActive(input)) this.leash.touch(now);
    this.body = move(this.body, input, dt, this.world);
    if (this.phase === "found") this.watchDuck(dt);
    // The board is modal, but the pose keeps going out: the server's 60 s
    // pose timeout must never end a game mid-mate.
    if (this.phase === "chess") this.pump.set(this.pose());

    if (playing) {
      this.pump.set(this.pose());
      if (now - this.lastTrailAt >= TRAIL_EVERY_MS) this.refreshTrail(now);
      this.maybeQuack(now);
      if (this.kingProp !== null && this.phase === "playing") this.tickKing(now);
      if (this.phase === "playing" && this.duck.state === "idle") {
        if (!withinReach(this.map, this.body.p, this.duckSpot)) {
          this.foundRefusals = 0;
          // Right under him but he sits higher than the server allows (a map
          // problem): say so rather than "burning hot" with nothing happening.
          const perched = perchedOutOfReach(this.map, this.body.p, this.duckSpot);
          if (perched && !this.perchedSaid) this.say("Gerald is perched out of reach — ask a director to move him.", 5000);
          this.perchedSaid = perched;
        } else if (now >= this.foundCooldownUntil) void this.found();
      }
      if (this.leash.expired(now)) {
        void postEnd(this.o.base, this.o.assignment.token);
        this.end({ kind: "idle" });
        return;
      }
    }

    // Camera: the eye, in the web space.
    const space = spaceOf(this.map, "web");
    const eye = toSpace(space, eyeOf(this.body));
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.rotation.set(this.body.pitch * DEG, yawToSpace(space, this.body.yaw) * DEG, 0);

    this.duck.update(dt);
    this.trail.update(dt);
    this.house.update(dt, this.camera);
    for (const g of this.ghosts.values()) {
      const s = g.buffer.sample(now);
      if (s !== null) g.avatar.setPose(s.p, s.yaw, s.pitch);
      g.avatar.update(dt);
    }
    this.renderer.render(this.scene, this.camera);

    if (now - this.lastHudAt >= HUD_EVERY_MS) {
      this.lastHudAt = now;
      this.emitHud(now);
    }
  }

  private pose(): PlayerPose {
    return { p: [this.body.p[0], this.body.p[1], this.body.p[2]], yaw: this.body.yaw, pitch: this.body.pitch };
  }

  private refreshTrail(now: number): void {
    this.lastTrailAt = now;
    this.path = trail(this.map, this.body.p, this.duckSpot.pos);
    this.distance = pathLength(this.path);
    this.trail.set(this.path);
    this.distHistory.push({ t: now, d: this.distance });
    while (this.distHistory.length > 0 && now - this.distHistory[0]!.t > 4000) this.distHistory.shift();
  }

  /** The distance about two seconds ago (the warmer/colder baseline). */
  private previousDistance(now: number): number | null {
    let best: { t: number; d: number } | null = null;
    for (const h of this.distHistory) if (now - h.t >= 1800 && (best === null || h.t > best.t)) best = h;
    return best?.d ?? null;
  }

  private maybeQuack(now: number): void {
    if (now < this.nextQuackAt || this.duck.state !== "idle") return;
    const d = this.duckSpot.pos;
    const plan = Math.hypot(d[0] - this.body.p[0], d[2] - this.body.p[2]);
    const sameLevel = Math.abs(d[1] - this.body.p[1]) < 2;
    if (plan > QUACK_RANGE || !sameLevel) {
      this.nextQuackAt = now + 1500;
      return;
    }
    const closeness = 1 - plan / QUACK_RANGE;
    const rel = relativeBearing(this.body.p, d, this.body.yaw);
    this.o.sfx.quack(0.25 + 0.75 * closeness, Math.sin(rel * DEG) * 0.8);
    this.nextQuackAt = now + 1600 + (1 - closeness) * 3200 + Math.random() * 900;
  }

  private emitHud(now: number): void {
    const t = roomTitle(this.map, this.body.p);
    const next = this.path[1];
    if (this.notice !== null && now > this.notice.until) this.notice = null;
    this.o.onHud({
      room: t.room,
      location: t.location,
      heat: this.phase === "found" ? "found" : heat(this.distance, this.previousDistance(now)),
      distance: this.distance,
      elapsed: formatElapsed(now - this.startedAt),
      yaw: this.body.yaw,
      pip: next !== undefined ? relativeBearing(this.body.p, next, this.body.yaw) : null,
      idleLeft: this.phase === "playing" ? this.leash.warning(now) : null,
      others: [...this.players.keys()].filter((s) => s !== this.o.assignment.session).length,
      live: this.live,
      notice: this.notice?.text ?? null,
      king: this.kingHud(),
    });
  }

  // --- the King ------------------------------------------------------------

  /** The HUD button / Space: hit him (lands on the next frame if he is in reach). */
  hit(): void {
    if (this.phase === "playing") this.hitQueued = true;
  }

  /** The HUD button / C: challenge him to the board. */
  challenge(): void {
    if (this.phase === "playing") this.challengeQueued = true;
  }

  /** Something happened on the board: the idle leash is touched. */
  touch(): void {
    this.leash.touch(performance.now());
  }

  /** The guarded doors stay shut and the King blocks until he falls. */
  private physicsOptions(): PhysicsOptions {
    const id = this.kingProp?.id;
    if (id === undefined) return {};
    if (this.fight.fallen) return { omitProps: new Set([id]) };
    return { closedDoors: new Set(this.map.doors.filter((d) => d.guard === id).map((d) => d.id)) };
  }

  /** Bind the scene's King to the fight (after a build / remap). */
  private bindKing(): void {
    this.king = this.kingProp !== null ? (this.house.kings.get(this.kingProp.id) ?? null) : null;
    this.king?.setHp(this.fight.hp, this.fight.max);
    if (this.fight.fallen) {
      // A remap mid-fight: he is already down (animated again, it is short).
      void this.king?.fall();
      this.openGuardedDoors();
    }
  }

  /** Hide the leaf of every door the King guards (he has fallen). */
  private openGuardedDoors(): void {
    for (const door of this.map.doors) {
      if (door.guard !== this.kingProp?.id) continue;
      const leaf = this.house.doors.get(door.id);
      if (leaf !== undefined) leaf.visible = false;
    }
  }

  private kingHud(): KingHud | null {
    const p = this.kingProp;
    if (p === null) return null;
    return {
      id: p.id,
      label: p.label ?? "THE KING",
      hp: this.fight.hp,
      max: this.fight.max,
      hearts: hearts(this.fight),
      stage: stageFor(this.fight.hp, this.fight.max),
      verdict: this.kingVerdict,
      fallen: this.fight.fallen,
      armed: this.armedState,
    };
  }

  private tickKing(now: number): void {
    const king = this.kingProp;
    if (king === null) return;
    const verdict = canHit(this.fight, now, this.map, this.body.p, this.body.yaw, king);
    this.kingVerdict = verdict;
    const nudge = (): void => this.say("Get closer to the King and face him.", 1500);
    if (this.hitQueued) {
      this.hitQueued = false;
      if (verdict === "ok") {
        const before = stageFor(this.fight.hp, this.fight.max);
        this.fight = landHit(this.fight, now);
        this.king?.hit();
        this.king?.setHp(this.fight.hp, this.fight.max);
        this.o.sfx.thud();
        this.leash.touch(now);
        const after = stageFor(this.fight.hp, this.fight.max);
        if (after !== before) this.say(STAGE_LINE[after], 2500);
      } else if (verdict !== "cooldown" && verdict !== "fallen") nudge();
    }
    if (this.challengeQueued) {
      this.challengeQueued = false;
      if (verdict === "ok" || verdict === "cooldown") this.enterChess();
      else if (verdict !== "fallen") nudge();
    }
  }

  private enterChess(): void {
    const king = this.kingProp;
    if (king === null || this.phase !== "playing") return;
    this.phase = "chess";
    this.keys.clear();
    this.leash.touch(performance.now());
    const stage = stageFor(this.fight.hp, this.fight.max);
    const label = king.label ?? "THE KING";
    this.o.onChess?.({ stage, label, armed: this.armedState });
    // The badge: fetched in the background, shown when it lands.
    if (king.armed !== undefined && this.o.armed !== undefined) {
      void this.o.armed(king.armed.path, king.armed.min).then((armed) => {
        if (this.phase !== "chess") return;
        this.armedState = armed;
        this.o.onChess?.({ stage, label, armed });
      });
    }
  }

  /** The board closed: a checkmate fells him and opens the door; anything else leaves the fight as it was. */
  chessResult(r: ChessResult): void {
    if (this.phase !== "chess") return;
    this.phase = "playing";
    this.leash.touch(performance.now());
    this.o.onChess?.(null);
    const king = this.kingProp;
    if (king === null) return;
    const signals = king.signals ?? {};
    switch (r) {
      case "won": {
        this.fight = fell(this.fight);
        void this.king?.fall();
        this.openGuardedDoors();
        this.world = buildPhysicsWorld(this.map, this.house.walls, this.physicsOptions());
        this.lastTrailAt = Number.NEGATIVE_INFINITY;
        this.o.sfx.fanfare();
        this.say("CHECKMATE — the door opens.", 4000);
        void this.o.signal?.(signals.won ?? "chess won");
        return;
      }
      case "lost":
        this.o.sfx.buzz();
        this.say("The King holds. Hit him again.", 3000);
        void this.o.signal?.(signals.lost ?? "chess lost");
        return;
      case "drawn":
        this.say("A draw is not a win.", 3000);
        void this.o.signal?.(signals.drawn ?? "chess drawn");
        return;
      case "abandoned":
        return;
    }
  }

  // --- found ---------------------------------------------------------------

  private async found(): Promise<void> {
    this.phase = "finding";
    // The server judges by the last pose it has: make sure that is this one.
    if (!(await this.pump.flush())) return;
    const reply = await postFound(this.o.base, this.o.assignment.token);
    if (this.phase !== "finding") return;
    switch (reply.kind) {
      case "found":
        this.phase = "found";
        this.pump.stop();
        window.clearInterval(this.pumpTimer);
        this.trail.set([]);
        this.o.sfx.quack(1);
        window.setTimeout(() => this.o.sfx.fanfare(), 650);
        void this.duck.layEgg();
        this.o.onFound(reply.result);
        return;
      case "far":
        // The server judges by its own copy of the pose; standing still in
        // reach retries at 1.5 s, 3 s, 6 s, then every 10 s.
        this.o.sfx.buzz();
        this.say("Closer — Gerald is just out of reach.", 2500);
        this.foundCooldownUntil = performance.now() + foundRetryMs(this.foundRefusals);
        this.foundRefusals += 1;
        this.phase = "playing";
        return;
      case "paused": {
        // The run is paused (or its doors aren't open yet): nothing was
        // judged and the session stays un-found. Keep saying so, and keep
        // asking on the same backoff — the first retry after resume wins.
        const wait = foundRetryMs(this.foundRefusals);
        this.say(PAUSED_NOTICE, wait + 1000);
        this.foundCooldownUntil = performance.now() + wait;
        this.foundRefusals += 1;
        this.phase = "playing";
        return;
      }
      case "over":
        this.end({ kind: "over", reason: "This session is over." });
        return;
      case "error":
        this.say("The connection hiccupped — hold still…", 2500);
        this.foundCooldownUntil = performance.now() + 2000;
        this.phase = "playing";
        return;
    }
  }

  /** After the find: turn to watch Gerald fly off. */
  private watchDuck(dt: number): void {
    const bird = this.duck.object.getObjectByName("duck:bird") ?? this.duck.object;
    const at = bird.getWorldPosition(new Vector3());
    const space = spaceOf(this.map, "web");
    const eye = toSpace(space, eyeOf(this.body));
    const dx = at.x - eye[0];
    const dy = at.y - eye[1];
    const dz = at.z - eye[2];
    const yaw = yawFromSpace(space, (Math.atan2(-dx, -dz) * 180) / Math.PI);
    const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
    const k = Math.min(1, dt * 2.5);
    const dyaw = ((((yaw - this.body.yaw + 180) % 360) + 360) % 360) - 180;
    this.body = { ...this.body, yaw: this.body.yaw + dyaw * k, pitch: this.body.pitch + (Math.max(-60, Math.min(70, pitch)) - this.body.pitch) * k };
  }

  /**
   * A director saved a new map (§1.3: refetch on a `house` frame): rebuild
   * the scene and the walls in place. The player stays where they stand
   * (re-settled by the next frame) — unless that is no longer `standable`
   * on the new map, then they go back to its spawn (`bodyAfterRemap`). Gerald moves only when the server says
   * so — the session-token GET carries this session's `duck`, which a save
   * may have moved or re-dealt; the server judges the find against that.
   */
  private async remap(): Promise<void> {
    // One at a time: a `hello` and a `house` back to back fetch once more,
    // not twice in parallel (two rebuilds of the scene and the walls).
    if (this.remapping) {
      this.remapAgain = true;
      return;
    }
    this.remapping = true;
    try {
      do {
        this.remapAgain = false;
        await this.remapOnce();
      } while (this.remapAgain && this.phase !== "ended");
    } finally {
      this.remapping = false;
    }
  }

  private async remapOnce(): Promise<void> {
    const loaded = await fetchHouse(this.o.base, this.o.assignment.token);
    if (this.phase === "ended" || loaded.source === "bundled") return;
    if (loaded.version !== this.mapVersion) this.swapMap(loaded.house, loaded.version);
    this.adoptDuck(loaded.duck);
  }

  private swapMap(house: HouseMap, version: string): void {
    const walls = buildWalls(house);
    const scene = buildHouseScene(house, { walls });
    this.house.root.removeFromParent();
    this.house.dispose();
    this.house = scene;
    this.root.add(scene.root);
    applySpace(this.root, spaceOf(house, "web"));
    this.map = house;
    this.mapVersion = version;
    // The King on the new map (the same prop id keeps the fight's hp; a new
    // one deals a fresh fight; none drops it).
    const king = house.props.find((p) => p.kind === "king") ?? null;
    if (king === null || king.id !== this.kingProp?.id) this.fight = newFight(king?.hp ?? KING_HP);
    this.kingProp = king;
    this.world = buildPhysicsWorld(house, walls, this.physicsOptions());
    this.bindKing();
    this.lastTrailAt = Number.NEGATIVE_INFINITY;
    // Standing somewhere the new map has no floor for (the shed is a solid
    // box on the tent map): back to the start, as the server re-seats too.
    const after = bodyAfterRemap(house, this.body);
    this.body = after.body;
    if (after.respawned) this.distHistory = [];
    this.say(after.respawned ? "The house was remapped — you're back at the start." : "The house was remapped.", after.respawned ? 4000 : 3000);
  }

  /** Move Gerald to the spot the server now judges against (no-op when it
   *  is the one already hunted, malformed, or the hunt is over). */
  private adoptDuck(incoming: unknown): void {
    if (this.phase === "ended" || this.phase === "found" || this.duck.state !== "idle") return;
    const next = duckToAdopt(this.duckSpot, incoming);
    if (next === null) return;
    this.duckSpot = next;
    this.duck.object.position.set(...next.pos);
    // A fresh route, a fresh warmer/colder baseline, a fresh approach.
    this.lastTrailAt = Number.NEGATIVE_INFINITY;
    this.distHistory = [];
    this.perchedSaid = false;
    this.foundRefusals = 0;
    this.foundCooldownUntil = 0;
    this.say("Gerald moved — follow the golden arrows.", 3500);
  }

  private say(text: string, ms: number): void {
    this.notice = { text, until: performance.now() + ms };
  }

  private end(e: GameEnd): void {
    if (this.phase === "ended" || this.phase === "found") return;
    this.phase = "ended";
    this.pump.stop();
    window.clearInterval(this.pumpTimer);
    this.o.onEnd(e);
  }

  // --- the stream ----------------------------------------------------------

  private onFrame(f: SpatialFrame): void {
    const mine = this.o.assignment.session;
    if (f.event === "reset") {
      this.end({ kind: "over", reason: LEAVE_REASON["reset"]! });
      return;
    }
    if (f.event === "leave" && f.data.session === mine && f.data.reason !== "found") {
      this.end({ kind: "over", reason: LEAVE_REASON[f.data.reason] ?? "This session is over." });
      return;
    }
    // A director saved (`house`), or the stream (re)connected (`hello`) —
    // a `house` frame lost while it was down is caught up here.
    const v = houseVersionOf(f);
    if (v !== null && v !== this.mapVersion) void this.remap();
    this.players = applyFrame(this.players, f);
    const now = performance.now();
    if (f.event === "poses") {
      for (const u of f.data.players) this.ghosts.get(u.session)?.buffer.push(now, u);
    }
    // A save moved (or re-dealt) our own duck.
    if (f.event === "duck" && f.data.session === mine) this.adoptDuck(f.data.duck);
    if (f.event === "found" && f.data.session !== mine) this.say(`${f.data.name} found Gerald!`, 3500);
    this.syncGhosts(now);
  }

  private syncGhosts(now: number): void {
    const mine = this.o.assignment.session;
    for (const [session, g] of this.ghosts) {
      if (this.players.has(session)) continue;
      g.avatar.object.removeFromParent();
      g.avatar.dispose();
      this.ghosts.delete(session);
    }
    for (const p of this.players.values()) {
      if (p.session === mine || this.ghosts.has(p.session)) continue;
      const avatar = createAvatar(p.name, p.guest);
      const buffer = new PoseBuffer();
      buffer.push(now, p);
      avatar.setPose(p.p, p.yaw, p.pitch);
      this.root.add(avatar.object);
      this.ghosts.set(p.session, { avatar, buffer });
    }
  }
}
