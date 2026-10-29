//! (wave 39, C2.2–C2.3) What the real house lights show, for the games.
//!
//! The reinstallation games light their virtual house with the real one:
//! the spatial stream's `lights` frame (`GameLights`, `@loom/house`
//! `lights-presence.ts`) carries every placed fixture's colour and level now
//! and whether a program is under it (the presence pulse).
//!
//! Where a fixture's state comes from (`LightsHub.gameSource`):
//! - **house**: the lights module's own model of every fixture
//!   (`POST /api/mod/lights/shown`), while the module is online and its
//!   report is fresh. A fixture the report lacks falls back to the estimate.
//! - **estimate**: the server's replay (`LightsEstimate`): per fixture the
//!   last look or test that reached it, replayed with `planLook` +
//!   `previewAt` at `now − start` from what the fixture showed when it
//!   started (a `restore` look gives that back). Fed by a live batch's
//!   `cue X` naming a look, every `LightsHub.test` with a look or a
//!   `{fixture, set}` (a desk cue's burst too), and the config's `boot` look
//!   at start and after a story reset. An identify test is ignored.
//!
//! `GameLightsFeed` decides when the frame goes out: after each `hello`
//! (the hub asks `hello()`), on any change at most once per
//! `GAME_LIGHTS_MIN_MS` (the trailing edge kept), every `GAME_LIGHTS_MIN_MS`
//! while an estimate fades, loops or runs an effect (sent only when it
//! changed: a settled house sends nothing), and when a `house` report goes
//! stale by itself. No timer runs while nobody listens. Transport-free: an
//! injected clock, sender and listener count.

import {
  LAMP_SETTLED,
  clampForSafety,
  gameLight,
  lampOf,
  planLook,
  previewAt,
  previewLength,
  presenceSettings,
  type GameLight,
  type GameLights,
  type GameLightsSource,
  type HouseMap,
  type LampShown,
  type LightPlan,
  type LightState,
  type LightsConfig,
} from "@loom/house";

/** The games' frame goes out at most this often (ms), and an animating
 *  estimate is re-computed this often. */
export const GAME_LIGHTS_MIN_MS = 250;

/** One look (or test) as it plays on the fixtures it reached. */
interface Run {
  plan: LightPlan;
  /** When it started (server ms). */
  t0: number;
  /** What each of its fixtures showed when it started. */
  starts: Record<string, LampShown>;
}

/** The fields a fixture's caps can't do, dropped (as `planLook` does). */
function forCaps(caps: { color?: boolean; ct?: boolean; dim?: boolean } | undefined, s: LightState): LightState {
  const out: LightState = { ...s };
  if (caps?.color !== true) delete out.color;
  if (caps?.ct !== true) delete out.color_temp;
  if (caps?.dim !== true) delete out.brightness;
  return out;
}

/** The server's own replay of the last look per fixture. */
export class LightsEstimate {
  /** Fixture id → the run that reached it last. */
  private readonly runs = new Map<string, Run>();

  /** One fixture at `t` (server ms): its run replayed, else `LAMP_SETTLED`. */
  lampAt(id: string, t: number): LampShown {
    const run = this.runs.get(id);
    if (run === undefined) return LAMP_SETTLED;
    return previewAt(run.plan, [id], t - run.t0, run.starts)[id] ?? LAMP_SETTLED;
  }

  /** Start `plan` at `t` on `fixtures` (each from what it shows then). */
  private start(plan: LightPlan, fixtures: readonly string[], t: number): void {
    const starts: Record<string, LampShown> = {};
    for (const id of fixtures) starts[id] = this.lampAt(id, t);
    const run: Run = { plan, t0: t, starts };
    for (const id of fixtures) this.runs.set(id, run);
  }

  /** A look played (a story cue, a test, a desk cue, the boot look). False:
   *  no such look, or it reaches nothing. */
  playLook(lights: LightsConfig, house: HouseMap | null | undefined, name: string, t: number): boolean {
    const plan = planLook(lights, house, name);
    if (plan === null) return false;
    const fixtures = [...new Set(plan.commands.map((c) => c.fixture))];
    if (fixtures.length === 0) return false;
    this.start(plan, fixtures, t);
    return true;
  }

  /** One state published on one fixture (a `{fixture, set}` test): safety
   *  clamped and cut to the fixture's caps, like a look's command. */
  set(lights: LightsConfig, fixture: string, state: LightState, t: number): boolean {
    const f = lights.fixtures.find((x) => x.id === fixture);
    if (f === undefined) return false;
    const set = forCaps(f.caps, clampForSafety(f, state));
    const plan: LightPlan = { commands: [{ at: 0, fixture, set }], loop: false, period: null, repeat: 1, restore: false };
    this.start(plan, [fixture], t);
    return true;
  }

  /** The config's `boot` look (at start, after a story reset). */
  boot(lights: LightsConfig, house: HouseMap | null | undefined, t: number): boolean {
    return typeof lights.boot === "string" && lights.boot !== "" ? this.playLook(lights, house, lights.boot, t) : false;
  }

  /** Every fixture of `ids` at `t` (one `previewAt` per run). */
  shown(ids: readonly string[], t: number): Record<string, LampShown> {
    const out: Record<string, LampShown> = {};
    const byRun = new Map<Run, string[]>();
    for (const id of ids) {
      const run = this.runs.get(id);
      if (run === undefined) out[id] = LAMP_SETTLED;
      else {
        const list = byRun.get(run);
        if (list === undefined) byRun.set(run, [id]);
        else list.push(id);
      }
    }
    for (const [run, list] of byRun) Object.assign(out, previewAt(run.plan, list, t - run.t0, run.starts));
    return out;
  }

  /** Is anything still moving at `t` (a fade, a repeat, an effect, a loop)? */
  animating(t: number): boolean {
    for (const run of new Set(this.runs.values())) {
      if (run.plan.loop) return true;
      const len = previewLength(run.plan);
      if (len === null || t - run.t0 < len) return true;
    }
    return false;
  }

  /** Fixtures with a run (tests). */
  get size(): number {
    return this.runs.size;
  }
}

/** What a `lights` frame is built from. */
export interface GameLightsInput {
  lights: LightsConfig;
  /** The map in force: a fixture whose room it lacks is left out (none: no lights). */
  house: HouseMap | null;
  source: GameLightsSource;
  /** The module's report (read under `house`; a fixture it lacks is estimated). */
  reported: Readonly<Record<string, LightState>> | null;
  estimate: LightsEstimate;
  /** The fixtures a program is under now. */
  pulsed: ReadonlySet<string>;
  now: number;
}

/** The `lights` frame: every fixture of the config in force whose room is on
 *  the map (file order), its colour and level, `pulse` per the presence map;
 *  top-level `pulse` = the presence effect, null when presence is off. */
export function buildGameLights(i: GameLightsInput): GameLights {
  const rooms = new Set((i.house?.rooms ?? []).map((r) => r.id));
  const placed = i.lights.fixtures.filter((f) => rooms.has(f.room));
  const settings = presenceSettings(i.lights);
  const reported = i.source === "house" ? i.reported : null;
  const need = placed.filter((f) => reported?.[f.id] === undefined).map((f) => f.id);
  const est = need.length > 0 ? i.estimate.shown(need, i.now) : {};
  const lights: GameLight[] = placed.map((f) => {
    const r = reported?.[f.id];
    const lamp = r !== undefined ? lampOf(r) : (est[f.id] ?? LAMP_SETTLED);
    return gameLight(f, lamp, i.pulsed.has(f.id));
  });
  return { at: i.now, source: i.source, pulse: settings.enabled ? settings.effect : null, lights };
}

/** A frame's content for "did it change" (everything but `at`). */
export function gameLightsKey(f: GameLights): string {
  return JSON.stringify([f.source, f.pulse, f.lights]);
}

/** Timers, injectable for tests. */
export interface FeedTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: FeedTimers = {
  set: (fn, ms) => {
    const h = setTimeout(fn, ms);
    (h as { unref?: () => void }).unref?.();
    return h;
  },
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface GameLightsFeedOptions {
  now: () => number;
  /** The frame as it stands now. */
  build: () => GameLights;
  /** Broadcast to every stream subscriber. */
  send: (frame: GameLights) => void;
  /** How many stream subscribers there are. */
  listeners: () => number;
  /** Is the estimate moving now (only asked while the source is `estimate`)? */
  animating: () => boolean;
  /** When a `house` source goes stale by itself (`LightsHub.sourceFlipAt`). */
  flipAt: () => number | null;
  timers?: FeedTimers;
}

/** When the `lights` frame goes out (see the module doc). */
export class GameLightsFeed {
  private readonly o: GameLightsFeedOptions;
  private readonly timers: FeedTimers;
  private timer: unknown = null;
  /** A change waits for the throttle. */
  private dirty = false;
  /** The last broadcast's content (null: nobody heard one yet). */
  private lastKey: string | null = null;
  private lastSendAt = -Infinity;
  private disposed = false;

  constructor(o: GameLightsFeedOptions) {
    this.o = o;
    this.timers = o.timers ?? REAL_TIMERS;
  }

  /** The frame for a new subscriber (after its `hello`); null when there
   *  are no lights to draw. The first listener's frame is the baseline the
   *  next broadcasts compare with. */
  hello(): GameLights | null {
    if (this.disposed) return null;
    const frame = this.o.build();
    if (this.o.listeners() <= 1 && this.timer === null) this.lastKey = gameLightsKey(frame);
    this.arm();
    return frame.lights.length > 0 ? frame : null;
  }

  /** Something the frame reads changed (a report, presence, a cue or test,
   *  the config, the map), or a listener left. */
  changed(): void {
    if (this.disposed) return;
    if (this.o.listeners() === 0) {
      this.idle();
      return;
    }
    this.dirty = true;
    if (this.o.now() - this.lastSendAt >= GAME_LIGHTS_MIN_MS) this.fire();
    else this.arm();
  }

  /** Stop every timer for good. */
  dispose(): void {
    this.disposed = true;
    this.idle();
  }

  /** Is a timer pending (tests)? */
  get pending(): boolean {
    return this.timer !== null;
  }

  private idle(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.dirty = false;
    this.lastKey = null;
  }

  private fire(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    if (this.disposed) return;
    if (this.o.listeners() === 0) {
      this.idle();
      return;
    }
    this.dirty = false;
    const frame = this.o.build();
    const key = gameLightsKey(frame);
    // Never an empty frame to games that never had lights.
    if (key !== this.lastKey && !(this.lastKey === null && frame.lights.length === 0)) {
      this.lastKey = key;
      this.lastSendAt = this.o.now();
      this.o.send(frame);
    }
    this.arm();
  }

  /** Schedule the next fire: a waiting change (after the throttle), the
   *  next animation step, or a `house` report going stale. */
  private arm(): void {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    if (this.disposed || this.o.listeners() === 0) return;
    const now = this.o.now();
    const earliest = this.lastSendAt + GAME_LIGHTS_MIN_MS;
    let due = Infinity;
    if (this.dirty) due = Math.max(now, earliest);
    if (this.o.animating()) due = Math.min(due, Math.max(now + GAME_LIGHTS_MIN_MS, earliest));
    const flip = this.o.flipAt();
    if (flip !== null && flip > now) due = Math.min(due, Math.max(flip, earliest));
    if (!Number.isFinite(due)) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.fire();
    }, Math.max(0, due - now));
  }
}
