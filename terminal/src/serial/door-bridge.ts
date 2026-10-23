//! The door bridge's decisions (wave 20, CONTRACT-w20 §2.5, D1, D19): what the
//! heart terminal tells the story about the server-room door, and what it
//! reports on its heartbeat. Pure — fed the sensor's lines, the screen
//! state's `night` and a clock; the post is injected (`door-serial.ts` wires
//! the real port, the real `POST /api/mod/signal` and real timers).
//!
//! - **Gate:** nothing is posted until a screen poll has said
//!   `night.server_door !== null` (before Power On the story's own init would
//!   overwrite it), nor while `night.door_override === true` (a director's 🚪
//!   press: the story ignores the sensor until 🚪 Trust the door sensor).
//! - **Edges:** the firmware's `open` changing with no blocking fault (a
//!   warning such as `ldr_open` doesn't block) posts `door_sensor_opened` /
//!   `door_sensor_closed` once, retried 1 s / 2 s / 4 s on a network error.
//! - **Reconcile:** on each screen poll, a fresh sensor in no blocking fault,
//!   nothing in flight, ≥ 4 s since the last post, the gate open, and the
//!   story's door different from the sensor's → post the sensor's edge. That
//!   repairs a missed edge, a boot, and the end of an override.
//! - **Fault:** post nothing (D1).

import type { DoorReading } from "./door-protocol.ts";

/** A sensor with no `door` line for this long is stale (the firmware sends one a second; a restart may be silent ≤ 2 s). */
export const DOOR_STALE_MS = 3000;
/** The reconcile never posts within this long of the last post (ms). */
export const RECONCILE_GAP_MS = 4000;
/** A post lost to the network is tried again after these waits (ms). */
export const DOOR_RETRY_MS: readonly number[] = [1000, 2000, 4000];

export type DoorSignal = "door_sensor_opened" | "door_sensor_closed";

/** What the story says about the door (the screen state's `night`). */
export interface StoryDoor {
  server_door: "open" | "closed" | null;
  door_override: boolean | null;
}

/** The sensor as last read. */
export interface SensorState {
  open: boolean;
  level: number;
  fault: string | null;
  warn: string | null;
  /** Local ms of the line. */
  at: number;
}

/** A post's outcome: taken, refused by the server (no retry: the reconcile
 *  covers it), or lost to the network (retried). */
export type PostOutcome = "ok" | "refused" | "network";

/** The heartbeat's door keys (`door`, `dlv`, `dft`, `dwn`; §2.4). */
export interface DoorReport {
  door: "open" | "closed" | "fault";
  level?: number;
  fault?: string;
  warn?: string;
}

export function isBlockingFault(fault: string | null): boolean {
  return fault !== null;
}

export function signalFor(open: boolean): DoorSignal {
  return open ? "door_sensor_opened" : "door_sensor_closed";
}

/** The local reading is one to trust: fresh, in no blocking fault. */
export function sensorUsable(s: SensorState | null, now: number): s is SensorState {
  return s !== null && now - s.at <= DOOR_STALE_MS && !isBlockingFault(s.fault);
}

/** The heartbeat's door keys for a configured bridge. */
export function doorReport(o: { connected: boolean; sensor: SensorState | null; now: number }): DoorReport {
  if (!o.connected) return { door: "fault", fault: "no_port" };
  const s = o.sensor;
  if (s === null || o.now - s.at > DOOR_STALE_MS) return { door: "fault", fault: "stale", ...(s === null ? {} : { level: s.level }) };
  const r: DoorReport = s.fault !== null ? { door: "fault", level: s.level, fault: s.fault } : { door: s.open ? "open" : "closed", level: s.level };
  if (s.warn !== null) r.warn = s.warn;
  return r;
}

/** The heartbeat query (`door=` `dlv=` `dft=` `dwn=`); nothing when no sensor is configured. */
export function doorQuery(r: DoorReport | null): Record<string, string> {
  if (r === null) return {};
  const q: Record<string, string> = { door: r.door };
  if (r.level !== undefined) q["dlv"] = String(Math.max(0, Math.min(4095, Math.round(r.level))));
  if (r.fault !== undefined && /^[a-z_]{1,24}$/u.test(r.fault)) q["dft"] = r.fault;
  if (r.warn !== undefined && /^[a-z_]{1,24}$/u.test(r.warn)) q["dwn"] = r.warn;
  return q;
}

/**
 * Is the door open, as the heart's choice panel and its overlay should read
 * it? The local sensor only when it is fresh, has no blocking fault and no
 * director has the door on the 🚪 buttons; else the story's own
 * `night.server_door` (null: nobody knows yet).
 */
export function doorOpenNow(local: SensorState | null, night: StoryDoor | null, now: number): boolean | null {
  if (sensorUsable(local, now) && night?.door_override !== true) return local.open;
  const story = night?.server_door ?? null;
  return story === null ? null : story === "open";
}

export interface BridgeIo {
  post(signal: DoorSignal, level: number): Promise<PostOutcome>;
  now(): number;
  later(fn: () => void, ms: number): () => void;
}

/** The bridge's state machine. */
export class DoorBridge {
  private sensor: SensorState | null = null;
  /** The last clean reading's `open` (null: none since connect / a fault). */
  private lastOpen: boolean | null = null;
  private story: StoryDoor | null = null;
  private inFlight = false;
  /** An edge that came while a post was in flight: posted when it lands. */
  private pending: boolean | null = null;
  private lastPostAt = Number.NEGATIVE_INFINITY;
  private cancelRetry: (() => void) | null = null;
  private stopped = false;
  /** Every post's signal, oldest first (tests, ⚙'s last line). */
  readonly posted: DoorSignal[] = [];

  constructor(private readonly io: BridgeIo) {}

  /** The sensor as last read (null: nothing yet). */
  get reading(): SensorState | null {
    return this.sensor;
  }

  /** May anything be posted to the story now? */
  private gateOpen(): boolean {
    return this.story !== null && this.story.server_door !== null && this.story.door_override !== true;
  }

  /** A `door` line from the firmware. */
  line(r: DoorReading): void {
    if (this.stopped) return;
    this.sensor = { open: r.open, level: r.level, fault: r.fault, warn: r.warn, at: this.io.now() };
    if (isBlockingFault(r.fault)) {
      // A blocking fault forces `open` on the firmware side: never an edge.
      this.lastOpen = null;
      this.dropRetry();
      return;
    }
    const was = this.lastOpen;
    this.lastOpen = r.open;
    if (was === null || was === r.open) return;
    this.edge(r.open);
  }

  /** The port closed or the board went away. */
  disconnected(): void {
    this.lastOpen = null;
    this.dropRetry();
  }

  /** A screen poll answered: the story's door, then the reconcile. */
  screen(night: StoryDoor): void {
    if (this.stopped) return;
    this.story = { server_door: night.server_door, door_override: night.door_override };
    const now = this.io.now();
    if (!sensorUsable(this.sensor, now) || this.inFlight || this.cancelRetry !== null) return;
    if (now - this.lastPostAt < RECONCILE_GAP_MS || !this.gateOpen()) return;
    const storyOpen = this.story.server_door === "open";
    if (storyOpen !== this.sensor.open) this.send(this.sensor.open, 0);
  }

  stop(): void {
    this.stopped = true;
    this.dropRetry();
  }

  private edge(open: boolean): void {
    if (!this.gateOpen()) return; // the reconcile brings the story round once it may
    this.dropRetry();
    if (this.inFlight) {
      this.pending = open;
      return;
    }
    this.send(open, 0);
  }

  private dropRetry(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
  }

  private send(open: boolean, attempt: number): void {
    const level = this.sensor?.level ?? 0;
    const signal = signalFor(open);
    this.inFlight = true;
    this.pending = null;
    this.lastPostAt = this.io.now();
    this.posted.push(signal);
    void this.io.post(signal, level).then(
      (out) => this.landed(open, attempt, out),
      () => this.landed(open, attempt, "network"),
    );
  }

  private landed(open: boolean, attempt: number, out: PostOutcome): void {
    this.inFlight = false;
    if (this.stopped) return;
    const next = this.pending;
    this.pending = null;
    if (next !== null && next !== open) {
      if (this.gateOpen() && !isBlockingFault(this.sensor?.fault ?? null)) this.send(next, 0);
      return;
    }
    if (out !== "network" || attempt >= DOOR_RETRY_MS.length) return;
    this.cancelRetry = this.io.later(() => {
      this.cancelRetry = null;
      const s = this.sensor;
      // Only while the sensor still says so, cleanly, and the story may hear it.
      if (s === null || s.open !== open || isBlockingFault(s.fault) || !this.gateOpen() || this.inFlight) return;
      this.send(open, attempt + 1);
    }, DOOR_RETRY_MS[attempt]!);
  }
}
