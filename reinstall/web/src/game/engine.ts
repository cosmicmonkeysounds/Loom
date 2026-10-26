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
//! 120 s without input ends it; leaving the page ends it at once. A walk
//! can also be **held** (`hold(on)`, wave 18b: a story overlay over the tent
//! laptop): the leash pauses and input is ignored, but the pose pump keeps
//! its keepalives going, so the server never drops a held player.
//!
//! The King (`fight.ts`) stands in the Server Room's doorway with the one
//! health bar every guest shares (the server's `KingState`, off `hello`,
//! `king` frames and the map GET), drawn only over his head (wave 26, R3:
//! no King bar on the HUD): ⚔ / Space asks the server for this
//! visit's one hit; at 0 he kneels and his door opens for everyone. An old
//! server sends no King state: then he just stands, with no ⚔. Ghosts wear
//! the guest's profile picture (`/api/avatar/<key>`, the `avatar` frame).
//!
//! The moments (wave 26, C6, `moments.ts`): out through an exterior door onto
//! the outside ground and `ESCAPE_M` into the void, a jump scare, the escape
//! posted and a teleport back to the spawn whatever the answer (R4); in
//! Trabolta's heart's room once the King has fallen, the heart (R6); within
//! reach of a floppy disk, the pickup (R7). The story's lines in a moment's
//! answer are captioned and spoken in-game (`lines.ts`), the mic held while
//! they play. The camera feeds follow the player's presence room (C7).
//!
//! With the voice link on (`config.voice`, wave 19, `voice.ts`) the terminals
//! near the player are heard at their screens and the player's mic (opened
//! in the Play here tap) on the terminals near them; M / the 🎤 button mutes.
//! It runs on the same gate as the camera feeds and stops (tracks and all)
//! when the session does.

import { PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import type { Group } from "three";
import { buildWalls, heartProps, heartReached, outsideGround, pathLength, pickupProps, pickupReach, presenceRoom, spaceOf, toSpace, yawFromSpace, yawToSpace } from "@loom/house";
import type { Assignment, DuckSpot, HouseMap, KingState, PlayerPose, PlayerState, Prop, Spawn, SpatialFrame, Vec3 } from "@loom/house";
import { applySpace, buildHouseScene, createAvatar, createDuck, createTrail, houseAtmosphere, PoseBuffer, spaceGroup } from "@loom/house/three";
import type { Avatar, Duck, HouseScene, King, Trail } from "@loom/house/three";
import { fetchHouse, postEnd, postFound, postKingHit, postMoment, postPose, streamProbe, streamUrl, type FoundAnswer, type MomentLine, type MomentReply } from "../api.ts";
import { CamFeeds } from "./cams.ts";
import { createVoiceSink, earsFor, micSourceOf, stopStream, VoiceLink, type VoiceHudState } from "./voice.ts";
import { applyFrame, avatarUrl, duckToAdopt, houseVersionOf, kingOf, openSpatialStream, type SpatialStreamHandle } from "../spatial.ts";
import type { Sfx } from "./audio.ts";
import { HIT_USED, hitSpentAtStart, keepDoorOpen, kingReach, nudgeFor, type KingReach } from "./fight.ts";
import {
  duckMovedNotice,
  findOutcome,
  formatElapsed,
  foundRetryMs,
  heat,
  heldFind,
  PATH_REVEAL_NOTICE,
  pathShown,
  PAUSED_NOTICE,
  perchedOutOfReach,
  relativeBearing,
  roomTitle,
  withinReach,
  type Heat,
} from "./hud.ts";
import { combineInput, isActive, keyDown, keyUp, type StickVector } from "./input.ts";
import { IdleLeash } from "./leash.ts";
import { deviceSpeaker, LinePlayer } from "./lines.ts";
import { escapeDue, escapeStep, heartStep, PICKUP_NOTICE, pickupStep, SCARE_MS, SCARE_WAIT_MS } from "./moments.ts";
import { bodyAfterRemap, buildPhysicsWorld, eyeOf, move, NO_INPUT, spawnBody, type Body, type PhysicsOptions, type PhysicsWorld } from "./physics.ts";
import { NoRenderer } from "./no-start.ts";
import { PosePump } from "./pump.ts";
import { trail, trailMap } from "./trail.ts";

export { IDLE_LIMIT_MS, IDLE_WARN_MS } from "./leash.ts";
const TRAIL_EVERY_MS = 500;
const HUD_EVERY_MS = 200;
const QUACK_RANGE = 7;
/** Start looking a little down, so the trail on the floor is in view. */
const START_PITCH = -8;
const DEG = Math.PI / 180;
/** While a line plays, the mic is held this far ahead, every frame (ms). */
const SPEAKING_HOLD_MS = 250;

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface HudState {
  room: string;
  location: string | null;
  heat: Heat;
  /** Metres of route to the duck. */
  distance: number;
  elapsed: string;
  /** Compass bearing the player faces, degrees clockwise from north. */
  yaw: number;
  /** On-screen angle of the next waypoint (degrees, clockwise), null when
   *  none — and before the path reveal. */
  pip: number | null;
  /** The way to Gerald is shown (wave 26, R2: hidden for the first
   *  `PATH_REVEAL_MS` of the session). Until then the heat box reads just
   *  FIND GERALD: no label, no distance, no hint. */
  path: boolean;
  /** Seconds left before the no-input leash ends the session (only near the end). */
  idleLeft: number | null;
  /** Other players in the simulation right now. */
  others: number;
  /** The spatial stream is up. */
  live: boolean;
  /** A passing message ("closer…"). */
  notice: string | null;
  /** The shared King (a `king` prop on this map), null when the map has
   *  none or the server shares no King state (an old server). */
  king: KingHud | null;
  /** The voice link, null when it is off on this device. */
  voice: VoiceHudState | null;
  /** The void's jump scare is on screen (wave 26, R4). */
  scare: boolean;
  /** The line being said in-game (a moment's answer, wave 26), null when none. */
  caption: MomentLine | null;
}


/** The King as the HUD knows him: only what the ⚔ HIT button needs (wave
 *  26, R3 — the bar over his head is the only display of his points). */
export interface KingHud {
  id: string;
  /** Whether a hit could be asked for from here (the ⚔ button shows when near). */
  verdict: KingReach;
  fallen: boolean;
  /** This visit has hit him (⚔ is spent until the next reinstallation). */
  hitUsed: boolean;
  /** A hit is on its way to the server. */
  hitting: boolean;
}

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
  onFound: (r: FoundAnswer) => void;
  /** The session ended without a find (the run restarted, the leash ran out). */
  onEnd: (e: GameEnd) => void;
  /** The shared King off the dealt map's GET (`LoadedHouse.king`; absent = an old server). */
  king?: KingState | null;
  /** The voice link is on for this device (`config.voice`). */
  voice?: boolean;
  /** The mic opened in the Play here tap (null: none to be had). The game
   *  owns it: its tracks stop when the session does. */
  mic?: Promise<MediaStream | null> | null;
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
  // Wave 18b (R16): the program was unmarked mid-walk (a director's release).
  unmarked: "No longer marked for reinstallation — the simulation ended.",
};

/** Why the server ended this game's session, in the HUD's words. */
export function leaveText(reason: string): string {
  return LEAVE_REASON[reason] ?? "This session is over.";
}

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
  /** The terminals' live camera windows (wave 14, `cams.ts`). */
  private feeds: CamFeeds | null = null;
  /** The voice link with the terminals (wave 19, `voice.ts`), null when off. */
  private voice: VoiceLink | null = null;
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
  /** The path to Gerald is shown (wave 26, R2): false for the first
   *  `PATH_REVEAL_MS` of this session — the trail is still routed (the
   *  distance, the autopilot), just not drawn. */
  private pathRevealed = false;
  private lastHudAt = Number.NEGATIVE_INFINITY;
  private nextQuackAt = performance.now() + 2500;
  private path: Vec3[] = [];
  private distance = 0;
  private distHistory: Array<{ t: number; d: number }> = [];
  private live = false;
  private notice: { text: string; until: number } | null = null;
  private phase: "playing" | "finding" | "found" | "ended" = "playing";
  // The King (`fight.ts`): one health bar shared by every guest (the server's).
  private kingProp: Prop | null = null;
  /** The server's King state; null = none shared (an old server, no King on the map). */
  private kingState: KingState | null = null;
  /** His door is open in this game: he has fallen, or he stood up again
   *  while this player was behind it or in it (`keepDoorOpen`). */
  private doorOpen = false;
  /** What the scene shows of him (`showKing`), so it is redrawn only on a change. */
  private kingShown = "";
  /** `this.map` with his doors open while `doorOpen` (`trailMap`): what the trail routes over. */
  private trailHouse: HouseMap;
  private king: King | null = null;
  private hitQueued = false;
  // The moments (wave 26, C6).
  /** The player's presence room (`presenceRoom`, re-read with the trail): the camera feeds follow it (C7). */
  private presence: string | null = null;
  /** An escape is under way (the scare, then the teleport): no input, no other moment. */
  private escaping = false;
  /** The jump scare is on screen. */
  private scare = false;
  /** Trabolta's heart on this map (the first `heart` prop), null when none. */
  private heartProp: Prop | null = null;
  /** The heart is done with for this session: heard (tonight), or this server can't. */
  private heartDone = false;
  /** Asked on this entry into his room (the next entry asks again). */
  private heartAsked = false;
  private heartBusy = false;
  private heartRetryAt = 0;
  private heartRefusals = 0;
  /** The floppy disks on this map (`pickup` props). */
  private pickups: Prop[] = [];
  /** Disks this program has taken (the assignment's `picked`, then this walk's). */
  private readonly taken = new Set<string>();
  /** Disks this server can't hand out (no route, no such prop). */
  private readonly pickupGivenUp = new Set<string>();
  private pickupBusy = false;
  private readonly pickupRetryAt = new Map<string, number>();
  private pickupRefusals = 0;
  /** In-game speech (`lines.ts`): the caption on screen and whether a line plays. */
  private caption: MomentLine | null = null;
  private speaking = false;
  private speaker: { speak(text: string): Promise<void>; stop(): void } | null = null;
  private lines: LinePlayer | null = null;
  /** Held by the host (`hold`): no input, no leash, the pump still alive. */
  private held = false;
  /** This visit's one hit is spent (the assignment's `kingHit`, a 200, or the server's "already hit"). */
  private hitUsed = false;
  private hitting = false;
  private kingVerdict: KingReach = "far";
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
    this.kingState = this.ownKing(opts.king ?? null);
    this.doorOpen = this.kingState?.fallen === true;
    this.trailHouse = trailMap(this.map, this.kingProp?.id ?? null, this.doorOpen);
    const walls = buildWalls(opts.house);
    this.world = buildPhysicsWorld(opts.house, walls, this.physicsOptions());
    const root = spaceGroup(spaceOf(opts.house, "web"));
    this.root = root;
    this.scene.add(root);
    this.house = buildHouseScene(opts.house, { walls, ground: true, pickups: true });
    root.add(this.house.root);
    for (const id of opts.assignment.picked ?? []) this.taken.add(id);
    this.heartDone = opts.assignment.heartHeard === true;
    this.bindMoments();
    this.bindKing();
    this.duck = createDuck();
    this.duckSpot = opts.assignment.duck;
    this.hitUsed = hitSpentAtStart(opts.assignment);
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
    const speaker = deviceSpeaker();
    this.speaker = speaker;
    this.lines = new LinePlayer({
      speak: (text) => speaker.speak(text),
      show: (line) => {
        this.caption = line;
        this.lastHudAt = Number.NEGATIVE_INFINITY;
      },
      sleep: wait,
      speaking: (on) => {
        this.speaking = on;
        if (on) this.voice?.holdFor(SPEAKING_HOLD_MS);
      },
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
    // A proxy's 502 while loom restarts closes the stream: reopen it while
    // the session token still reads (the pose pump ends a dead session).
    this.stream = openSpatialStream(
      streamUrl(this.o.base, this.o.assignment.token, this.o.device),
      {
        onFrame: (f) => this.onFrame(f),
        onState: (up) => (this.live = up),
      },
      { probe: streamProbe(this.o.base, this.o.assignment.token) },
    );
    this.feeds = new CamFeeds({
      base: this.o.base,
      token: this.o.assignment.token,
      sink: (spot, source) => void this.house.setTerminalFeed(spot, source),
      where: () => ({ terminals: this.map.terminals, at: this.body.p, room: this.presence }),
    });
    this.voice = this.startVoice();
    this.syncFeeds();
    this.loop(performance.now());
  }

  /** The voice link on the effects' context, when this device has it on. */
  private startVoice(): VoiceLink | null {
    const mic = this.o.mic ?? null;
    const audio = this.o.voice === true ? this.o.sfx.context() : null;
    if (audio === null) {
      void mic?.then(stopStream);
      return null;
    }
    const { ctx } = audio;
    return new VoiceLink({
      base: this.o.base,
      token: this.o.assignment.token,
      house: () => this.map,
      sink: createVoiceSink(ctx, ctx.destination),
      mic:
        mic === null
          ? null
          : mic.then((stream) => {
              if (stream === null) return null;
              // Opening the mic may interrupt the context on iOS: wake it.
              this.o.sfx.resume();
              try {
                return micSourceOf(ctx, stream);
              } catch {
                stopStream(stream);
                return null;
              }
            }),
    });
  }

  /** Camera feeds poll (and the voice link runs) only while someone plays
   *  on screen; once the session is over the voice link stops for good. */
  private syncFeeds(): void {
    const on = !document.hidden && (this.phase === "playing" || this.phase === "finding");
    this.feeds?.setActive(on);
    if (this.phase === "found" || this.phase === "ended") this.voice?.stop();
    else this.voice?.setActive(on);
  }

  /** The 🎤 button / M: mute or unmute this player's mic. */
  toggleMute(): void {
    this.voice?.toggleMute();
  }

  /**
   * Hold the walk (`on`) or let it go (wave 18b): something covers the game
   * (a story overlay on the tent laptop). Held, the idle leash stops counting,
   * input is ignored (no stuck keys, no walking blind), Gerald is never found
   * and never quacks (nobody can see him under the overlay), while the pose
   * pump keeps sending — the server's 60 s pose timeout never fires on a
   * held player. Letting go resumes the leash where it stopped (unless the
   * tab is hidden, which holds it on its own).
   */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    const now = performance.now();
    if (on) {
      this.leash.hide(now);
      this.keys.clear();
      this.dragPointer = null;
      this.drag = [0, 0];
      this.hitQueued = false;
    } else if (!document.hidden) this.leash.show(now);
  }

  /** Whether the walk is held (`hold`). */
  get isHeld(): boolean {
    return this.held;
  }

  /** The player gave up (the ✕ button): end the session on the server. */
  quit(): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.pump.stop();
    this.syncFeeds();
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
    this.feeds?.dispose();
    this.voice?.stop();
    this.lines?.stop();
    this.speaker?.stop();
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
      if (this.held) return;
      if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && this.phase === "playing" && e.code === "Space") this.hitQueued = true;
      if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && e.code === "KeyM") this.voice?.toggleMute();
      if (keyDown(this.keys, e)) e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => keyUp(this.keys, e);
    const blur = (): void => {
      this.keys.clear();
      this.dragPointer = null;
    };
    const canvas = this.o.canvas;
    const pdown = (e: PointerEvent): void => {
      if (this.dragPointer !== null || this.held) return;
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
      this.syncFeeds();
      if (document.hidden) {
        // No keepalives while nobody can play: the server's 60 s pose
        // timeout drops a tab left hidden. The idle leash pauses too.
        this.leash.hide(now);
        window.clearInterval(this.pumpTimer);
        return;
      }
      if (!this.held) this.leash.show(now);
      if (this.phase === "playing" || this.phase === "finding") {
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
      if (this.phase === "playing" || this.phase === "finding") void postEnd(this.o.base, this.o.assignment.token);
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
    const input = playing && !this.held && !this.escaping ? combineInput({ keys: this.keys, left: sticks.left, right: sticks.right, drag: this.drag, arrowsTurn: this.o.arrowsTurn }) : NO_INPUT;
    this.drag = [0, 0];
    if (isActive(input)) this.leash.touch(now);
    this.body = move(this.body, input, dt, this.world);
    if (this.phase === "found") this.watchDuck(dt);

    if (playing) {
      this.pump.set(this.pose());
      if (!this.pathRevealed && pathShown(now - this.startedAt)) this.revealPath();
      if (now - this.lastTrailAt >= TRAIL_EVERY_MS) {
        // Held open for a player behind (or in) his door: shut once they are clear.
        if (this.doorOpen && this.kingState?.fallen !== true) this.refreshDoor();
        this.refreshTrail(now);
        this.presence = presenceRoom(this.map, this.body.p, this.presence);
      }
      // Held (an overlay over the game): Gerald keeps quiet under it too.
      if (!this.held) this.maybeQuack(now);
      if (this.kingProp !== null && this.phase === "playing" && !this.escaping) this.tickKing(now);
      // The void, the heart and the disks (never under an overlay, never mid-escape).
      if (this.phase === "playing" && !this.held && !this.escaping) this.tickMoments(now);
      // Held (an overlay over the game): nobody can see Gerald, so no find.
      if (this.phase === "playing" && this.duck.state === "idle" && !this.held && !this.escaping) {
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
    // The ears, in house metres (the voices hang there too).
    this.voice?.listen(eyeOf(this.body), this.body.yaw, this.body.pitch);
    // The game is speaking: the terminals must never hear it back.
    if (this.speaking) this.voice?.holdFor(SPEAKING_HOLD_MS);

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
    this.path = trail(this.trailHouse, this.body.p, this.duckSpot.pos);
    this.distance = pathLength(this.path);
    this.trail.set(this.pathRevealed ? this.path : []);
    this.distHistory.push({ t: now, d: this.distance });
    while (this.distHistory.length > 0 && now - this.distHistory[0]!.t > 4000) this.distHistory.shift();
  }

  /** The minute is up (R2): say so once and draw the trail at once. */
  private revealPath(): void {
    this.pathRevealed = true;
    this.lastTrailAt = Number.NEGATIVE_INFINITY;
    this.say(PATH_REVEAL_NOTICE, 3500);
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
      pip: this.pathRevealed && next !== undefined ? relativeBearing(this.body.p, next, this.body.yaw) : null,
      path: this.pathRevealed,
      idleLeft: this.phase === "playing" ? this.leash.warning(now) : null,
      others: [...this.players.keys()].filter((s) => s !== this.o.assignment.session).length,
      live: this.live,
      notice: this.notice?.text ?? null,
      king: this.kingHud(),
      voice: this.voiceHud(),
      scare: this.scare,
      caption: this.caption,
    });
  }

  private voiceHud(): VoiceHudState | null {
    if (this.voice === null) return null;
    const hud = this.voice.hud;
    if (!hud.listening) return { ...hud, ears: 0 };
    // The server counts the terminals that hear us; an older one doesn't
    // say, so count who would by its rule (every voice-on spot in reach).
    if (hud.heardBy !== null) return { ...hud, ears: Math.max(1, hud.heardBy) };
    const mine = this.o.assignment.session;
    const players = [...this.players.values()].filter((p) => p.session !== mine).map((p) => ({ session: p.session, p: p.p }));
    players.push({ session: mine, p: this.body.p });
    return { ...hud, ears: Math.max(1, earsFor(this.map, mine, players)) };
  }

  // --- the King ------------------------------------------------------------

  /** The HUD button / Space: ask for this visit's hit (on the next frame, if he is in reach). */
  hit(): void {
    if (this.phase === "playing") this.hitQueued = true;
  }

  /** The guarded doors stay shut and the King blocks, unless his door is open here. */
  private physicsOptions(): PhysicsOptions {
    // The outside ground (wave 26, R4): an exterior door leads out into the void.
    const ground = outsideGround(this.map);
    const out: PhysicsOptions = ground !== null ? { ground } : {};
    const id = this.kingProp?.id;
    if (id === undefined) return out;
    if (this.doorOpen) return { ...out, omitProps: new Set([id]) };
    return { ...out, closedDoors: new Set(this.map.doors.filter((d) => d.guard === id).map((d) => d.id)) };
  }

  /** A King state that is about this map's King, else null. */
  private ownKing(k: KingState | null): KingState | null {
    return k !== null && this.kingProp !== null && k.id === this.kingProp.id ? k : null;
  }

  /** Bind the scene's King (after a build / remap) and show him as he is. */
  private bindKing(): void {
    this.trailHouse = trailMap(this.map, this.kingProp?.id ?? null, this.doorOpen);
    this.king = this.kingProp !== null ? (this.house.kings.get(this.kingProp.id) ?? null) : null;
    this.kingShown = "";
    this.showKing();
  }

  /** The bar, the kneel and his doors' leaves in the scene — redrawn only on a change. */
  private showKing(): void {
    const prop = this.kingProp;
    const k = this.kingState;
    if (prop === null || k === null) return;
    const key = `${k.hp}/${k.max}/${k.fallen}/${this.doorOpen}`;
    if (key === this.kingShown) return;
    this.kingShown = key;
    this.house.showKing(prop.id, k, this.doorOpen);
  }

  /**
   * Open or shut his door in this game: open while he has fallen; once he
   * stands again (a director's restore), shut — unless this player is behind
   * it or in the doorway (`keepDoorOpen`), then it stays open for them until
   * they are clear (re-checked with the trail, twice a second).
   */
  private refreshDoor(): void {
    const prop = this.kingProp;
    const fallen = this.kingState?.fallen === true;
    const open = prop !== null && (fallen || (this.doorOpen && keepDoorOpen(this.map, prop, this.body.p)));
    if (open !== this.doorOpen) {
      this.doorOpen = open;
      this.world = buildPhysicsWorld(this.map, this.house.walls, this.physicsOptions());
      this.trailHouse = trailMap(this.map, prop?.id ?? null, open);
      this.lastTrailAt = Number.NEGATIVE_INFINITY;
    }
    this.showKing();
  }

  /**
   * The server's word on the King (`hello`, a `king` frame, the map GET, a
   * hit's answer). `undefined` = it said nothing (keep what we know). `by`
   * names whose hit changed it (a director's edit has none).
   */
  private adoptKing(next: KingState | null | undefined, by: string | null = null): void {
    if (next === undefined) return;
    const k = this.ownKing(next);
    const prev = this.kingState;
    this.kingState = k;
    if (k !== null && prev !== null && this.phase !== "ended") {
      if (k.hp < prev.hp && !k.fallen) {
        this.king?.hit();
        if (by !== null && by !== this.o.assignment.name) this.say(`${by} hit the King.`, 2500);
      }
      if (k.fallen && !prev.fallen) {
        this.o.sfx.fanfare();
        this.say("The King kneels. His door stands open.", 4000);
      } else if (!k.fallen && prev.fallen) this.say("The King stands again.", 3000);
    }
    this.refreshDoor();
  }

  private kingHud(): KingHud | null {
    const p = this.kingProp;
    const k = this.kingState;
    if (p === null || k === null) return null;
    return {
      id: p.id,
      verdict: this.kingVerdict,
      fallen: k.fallen,
      hitUsed: this.hitUsed,
      hitting: this.hitting,
    };
  }

  private tickKing(now: number): void {
    const king = this.kingProp;
    if (king === null) return;
    this.kingVerdict = kingReach(this.map, this.body.p, this.body.yaw, king);
    if (!this.hitQueued) return;
    this.hitQueued = false;
    const k = this.kingState;
    if (k === null || k.fallen || this.hitting) return;
    this.leash.touch(now);
    if (this.hitUsed) this.say(HIT_USED, 3500);
    else if (this.kingVerdict !== "ok") this.say(nudgeFor(this.kingVerdict), 1500);
    else void this.hitKing();
  }

  /** Ask the server for this visit's hit — it judges the reach on its own
   *  copy of the pose, so that is flushed first. */
  private async hitKing(): Promise<void> {
    this.hitting = true;
    try {
      if (!(await this.pump.flush())) return;
      const reply = await postKingHit(this.o.base, this.o.assignment.token);
      if (this.phase === "ended") return;
      switch (reply.kind) {
        case "hit":
          this.hitUsed = true;
          this.o.sfx.thud();
          this.say("⚔ You hit the King!", 2500);
          this.adoptKing(reply.king, this.o.assignment.name);
          return;
        case "already":
          this.hitUsed = true;
          this.say(HIT_USED, 3500);
          this.adoptKing(reply.king ?? undefined);
          return;
        case "fallen":
          this.adoptKing(reply.king ?? undefined);
          return;
        case "far":
          this.o.sfx.buzz();
          this.say("Get closer to the King and face him.", 2000);
          return;
        case "paused":
          this.say(PAUSED_NOTICE, 2500);
          return;
        case "none":
          this.adoptKing(null);
          return;
        case "over":
          this.end({ kind: "over", reason: "This session is over." });
          return;
        case "error":
          this.say("The connection hiccupped — try again.", 2500);
          return;
      }
    } finally {
      this.hitting = false;
    }
  }

  // --- the moments (wave 26, C6) -------------------------------------------

  /** This map's heart and disks (after a build / remap), the taken disks hidden. */
  private bindMoments(): void {
    this.heartProp = heartProps(this.map)[0] ?? null;
    this.heartAsked = false;
    this.heartRetryAt = 0;
    this.pickups = pickupProps(this.map);
    for (const id of this.taken) this.house.setPickupTaken(id, true);
  }

  private tickMoments(now: number): void {
    if (escapeDue(this.map, this.body.p)) {
      void this.escape();
      return;
    }
    this.tickHeart(now);
    this.tickPickups(now);
  }

  /**
   * Out in the void (R4): the jump scare, the escape posted (the newest pose
   * flushed first), and after `SCARE_MS` a teleport back to the spawn —
   * whatever the server answered, or if it said nothing within
   * `SCARE_WAIT_MS`. A dead session ends the game instead. Then the story's
   * lines, if the escape counted.
   */
  private async escape(): Promise<void> {
    if (this.escaping) return;
    this.escaping = true;
    this.scare = true;
    this.keys.clear();
    this.hitQueued = false;
    this.o.sfx.scare();
    this.voice?.holdFor(SCARE_MS);
    const started = performance.now();
    this.leash.touch(started);
    this.emitHud(started);
    const reply = this.postEscape();
    // The scare holds SCARE_MS, and as long as the answer takes up to SCARE_WAIT_MS.
    const [answer] = await Promise.all([Promise.race([reply, wait(SCARE_WAIT_MS).then(() => null)]), wait(SCARE_MS)]);
    const step = escapeStep(answer);
    this.scare = false;
    this.escaping = false;
    if (this.phase === "ended") return;
    if (step.over) {
      this.end({ kind: "over", reason: "This session is over." });
      return;
    }
    this.teleport(step.spawn);
    this.emitHud(performance.now());
    if (answer === null) {
      // The answer came late: its lines still play; a dead session still ends.
      void reply.then((late) => {
        const s = escapeStep(late);
        if (this.phase === "ended") return;
        if (s.over) this.end({ kind: "over", reason: "This session is over." });
        else void this.lines?.play(s.lines);
      });
    } else void this.lines?.play(step.lines);
  }

  private async postEscape(): Promise<MomentReply> {
    await this.pump.flush();
    return postMoment(this.o.base, this.o.assignment.token, { kind: "escape" });
  }

  /** Back to the spawn (the server's word on it, else the map's), facing its way. */
  private teleport(spawn: Spawn | null): void {
    const at = spawn ?? this.map.spawn;
    this.body = { ...spawnBody(this.map, at), pitch: START_PITCH };
    this.distHistory = [];
    this.lastTrailAt = Number.NEGATIVE_INFINITY;
    this.presence = null;
    this.perchedSaid = false;
    this.leash.touch(performance.now());
    this.pump.set(this.pose());
    void this.pump.tick();
  }

  /** In Trabolta's heart's room, once the King has fallen (or the map has none): ask once per entry (R6). */
  private tickHeart(now: number): void {
    const heart = this.heartProp;
    if (heart === null || this.heartDone) return;
    // Sealed while the King stands — and while the server hasn't said (an old server).
    const open = this.kingProp === null || this.kingState?.fallen === true;
    // An exit counts even while a request waits: the next entry is a new one,
    // asked at once (no backoff left over from the last).
    if (!open || !heartReached(this.map, this.body.p, heart)) {
      this.heartAsked = false;
      this.heartRefusals = 0;
      this.heartRetryAt = 0;
      return;
    }
    if (this.heartBusy || this.heartAsked || now < this.heartRetryAt) return;
    this.heartAsked = true;
    void this.reachHeart(heart);
  }

  private async reachHeart(heart: Prop): Promise<void> {
    this.heartBusy = true;
    try {
      if (!(await this.pump.flush())) return;
      const reply = await postMoment(this.o.base, this.o.assignment.token, { kind: "heart", prop: heart.id });
      if (this.phase === "ended") return;
      const step = heartStep(reply, this.heartRefusals);
      switch (step.kind) {
        case "speak":
          this.heartDone = true;
          void this.lines?.play(step.lines);
          return;
        case "done":
          this.heartDone = true;
          return;
        case "reenter":
          return;
        case "retry":
          // Left while it waited (`heartAsked` cleared): the next entry asks at once.
          if (!this.heartAsked) return;
          if (reply.kind === "paused") this.heartRefusals += 1;
          this.heartAsked = false;
          this.heartRetryAt = performance.now() + step.ms;
          return;
        case "over":
          this.end({ kind: "over", reason: "This session is over." });
          return;
      }
    } finally {
      this.heartBusy = false;
    }
  }

  /** Within reach of a disk not yet taken: ask for it (R7). */
  private tickPickups(now: number): void {
    if (this.pickupBusy) return;
    let near = false;
    for (const prop of this.pickups) {
      if (this.taken.has(prop.id) || this.pickupGivenUp.has(prop.id)) continue;
      if (!pickupReach(this.map, this.body.p, prop)) continue;
      near = true;
      if ((this.pickupRetryAt.get(prop.id) ?? 0) > now) continue;
      void this.pickUp(prop);
      return;
    }
    if (!near) this.pickupRefusals = 0;
  }

  private async pickUp(prop: Prop): Promise<void> {
    this.pickupBusy = true;
    try {
      if (!(await this.pump.flush())) return;
      const reply = await postMoment(this.o.base, this.o.assignment.token, { kind: "pickup", prop: prop.id });
      if (this.phase === "ended") return;
      const step = pickupStep(reply, this.pickupRefusals);
      switch (step.kind) {
        case "take":
          this.take(prop.id);
          this.o.sfx.pickup();
          this.say(PICKUP_NOTICE, 3000);
          void this.lines?.play(step.lines);
          return;
        case "hide":
          this.take(prop.id);
          return;
        case "retry":
          this.pickupRefusals += 1;
          this.pickupRetryAt.set(prop.id, performance.now() + step.ms);
          return;
        case "giveUp":
          this.pickupGivenUp.add(prop.id);
          return;
        case "over":
          this.end({ kind: "over", reason: "This session is over." });
          return;
      }
    } finally {
      this.pickupBusy = false;
    }
  }

  /** A disk is this program's: hidden for good (this walk, and a re-scan's `picked`). */
  private take(id: string): void {
    this.taken.add(id);
    this.house.setPickupTaken(id, true);
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
        this.syncFeeds();
        this.pump.stop();
        window.clearInterval(this.pumpTimer);
        this.trail.set([]);
        this.o.sfx.quack(1);
        // A refused find (the story keeps them captured): no fanfare, no
        // egg, Gerald stays put — nothing that reads as a release.
        if (findOutcome(reply.result, this.o.assignment.captured) !== "refused") {
          window.setTimeout(() => this.o.sfx.fanfare(), 650);
          void this.duck.layEgg();
        }
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
        // A held find is the player still being there: it touches the leash.
        const held = heldFind(performance.now(), this.foundRefusals, this.leash);
        this.say(held.notice, held.noticeMs);
        this.foundCooldownUntil = held.cooldownUntil;
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
    if (loaded.version !== this.mapVersion) this.swapMap(loaded.house, loaded.version, loaded.king);
    this.adoptDuck(loaded.duck);
    this.adoptKing(loaded.king);
  }

  private swapMap(house: HouseMap, version: string, incoming?: KingState | null): void {
    const walls = buildWalls(house);
    const scene = buildHouseScene(house, { walls, ground: true, pickups: true });
    this.house.root.removeFromParent();
    this.house.dispose();
    this.house = scene;
    this.feeds?.forget();
    this.root.add(scene.root);
    applySpace(this.root, spaceOf(house, "web"));
    this.map = house;
    this.mapVersion = version;
    this.voice?.remap();
    // The King on the new map: the same prop id keeps the shared state; a
    // new one waits for the server's word on him (the GET / a frame); none drops it.
    const king = house.props.find((p) => p.kind === "king") ?? null;
    if (king === null || king.id !== this.kingProp?.id) {
      this.kingState = null;
      this.doorOpen = false;
    }
    this.kingProp = king;
    this.world = buildPhysicsWorld(house, walls, this.physicsOptions());
    this.presence = null;
    this.bindMoments();
    this.bindKing();
    this.lastTrailAt = Number.NEGATIVE_INFINITY;
    // Standing somewhere the new map has no floor for (the shed is a solid
    // box on the tent map): back to the start, as the server re-seats too.
    // A fallen King is out of the way (he kneels, his box is no prop): judge
    // with him down, as the server does, by the GET's word on him if it
    // has one, else what we knew (the same prop id keeps the shared state).
    const known = incoming === undefined ? this.kingState : this.ownKing(incoming);
    const fallen = king !== null && known?.fallen === true ? new Set([king.id]) : new Set<string>();
    const after = bodyAfterRemap(house, this.body, fallen);
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
    this.say(duckMovedNotice(this.pathRevealed), 3500);
  }

  private say(text: string, ms: number): void {
    this.notice = { text, until: performance.now() + ms };
  }

  private end(e: GameEnd): void {
    if (this.phase === "ended" || this.phase === "found") return;
    this.phase = "ended";
    this.lines?.stop();
    this.speaker?.stop();
    this.pump.stop();
    window.clearInterval(this.pumpTimer);
    this.syncFeeds();
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
      this.end({ kind: "over", reason: leaveText(f.data.reason) });
      return;
    }
    // A director saved (`house`), or the stream (re)connected (`hello`) —
    // a `house` frame lost while it was down is caught up here.
    const v = houseVersionOf(f);
    if (v !== null && v !== this.mapVersion) void this.remap();
    // The shared King: every (re)connect's `hello`, and a `king` frame on every change.
    if (f.event === "hello") this.adoptKing(kingOf((f.data as { king?: unknown }).king));
    if (f.event === "king") this.adoptKing(kingOf(f.data), typeof f.data.by === "string" ? f.data.by : null);
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
      if (p.session === mine) continue;
      const picture = avatarUrl(this.o.base, p.avatar);
      const had = this.ghosts.get(p.session);
      if (had !== undefined) {
        // A new picture (an `avatar` frame, or a hello / join that says so).
        had.avatar.setPicture(picture);
        continue;
      }
      const avatar = createAvatar(p.name, p.guest, { picture });
      const buffer = new PoseBuffer();
      buffer.push(now, p);
      avatar.setPose(p.p, p.yaw, p.pitch);
      this.root.add(avatar.object);
      this.ghosts.set(p.session, { avatar, buffer });
    }
  }
}
