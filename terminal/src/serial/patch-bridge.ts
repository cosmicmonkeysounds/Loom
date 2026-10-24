//! The patch bay's bridge (wave 22): what the heart terminal tells the story
//! about the server-room patch bay the Grand Central M4 reads beside the
//! door, and what it reports on its heartbeat. Pure, like `DoorBridge`: fed
//! the board's `patch` lines, the screen state's `night` and a clock; the
//! post is injected (`door-serial.ts` wires the port and `POST
//! /api/mod/signal`).
//!
//! - **What it posts:** `patch_changed {combo}` with the settled pairs, when
//!   the board's settled bay *becomes* complete (exactly four V–D pairs,
//!   nothing between levels, no source twice) and the pairs differ from the
//!   last complete set this bridge posted. Pulling a cable and pushing it
//!   back is never a second combination; the periodic line of a bay that
//!   hasn't changed is never a post; nor is whatever is plugged in when the
//!   port (re)connects (the first line after a connect is only looked at: a
//!   terminal that reboots never re-posts the cables it posted before).
//! - **Gate:** nothing until a screen poll has said `night.server_door !==
//!   null` (Power On has played) and `night.step >= 14` (the Y2K hour: the
//!   story's `when patch_changed:` ignores a set before it, and a set it
//!   ignored must never count as posted), nothing once `night.ended`, and
//!   nothing while `night.patch_override === true` (a 🔌 / 💥 / ❌ press: the
//!   story follows the buttons until 🔌 Trust the patch bay). A bay that
//!   becomes complete while the gate is shut is let go, never posted later:
//!   an override ending must not replay the cables a director just overruled,
//!   and the hour starting must not fire cables left in before it (pull one
//!   and push it back to play them).
//! - **A new run forgets:** while the hour is not on (`server_door` null or
//!   `step` under 14: a restart, Push draft, Go live in place or End →
//!   relaunch all start the story over) the last posted set is forgotten, so
//!   a rehearsal's combination can be plugged again in the show without a
//!   page reload. A post that lands after that still never counts.
//! - **The story judges:** this file never knows a combination. The pairs go
//!   to the story as they are; nothing about them goes on the heartbeat
//!   (a GET query lands in proxy logs), only counts.
//! - **Retry:** a post lost to the network is tried again after 1 s / 2 s /
//!   4 s while the settled bay still says the same; a refused post is not.
//!   Only a post the server took (`ok`) counts as posted: the same cables
//!   plugged again after a refusal or a lost post are tried again. No
//!   reconcile: a combination is an event, not a level.

import type { PostOutcome } from "./door-bridge.ts";
import type { PatchLine } from "./door-protocol.ts";

/** A bay with no `patch` line for this long is stale (the board sends one a second). */
export const PATCH_STALE_MS = 3000;
/** A post lost to the network is tried again after these waits (ms). */
export const PATCH_RETRY_MS: readonly number[] = [1000, 2000, 4000];
/** Four V–D cables make a combination. */
export const PATCH_PAIRS = 4;
/** `Night.step` of the Y2K hour, from which the story judges a set (main.loom's
 *  `when patch_changed:` reads `Night.step >= 14`). */
export const PATCH_FROM_STEP = 14;

export const PATCH_SIGNAL = "patch_changed";

/** What the story says (the screen state's `night`). */
export interface StoryPatch {
  server_door: "open" | "closed" | null;
  patch_override: boolean | null;
  /** `Night.step` (null: no story / unset). */
  step: number | null;
  /** `Night.ended`. */
  ended: boolean | null;
}

/** The story could act on a set now: Power On played, the Y2K hour on, no ending. */
export function hourOn(n: StoryPatch): boolean {
  return n.server_door !== null && n.step !== null && n.step >= PATCH_FROM_STEP;
}

/** The bay as last read. */
export interface PatchState {
  pairs: string;
  count: number;
  complete: boolean;
  raw: number[];
  src: number[];
  stable: boolean;
  /** Local ms of the line. */
  at: number;
}

/** The live decode's counts (off `src`, the latest scan). */
export interface PatchSummary {
  /** V–D pairs read. */
  count: number;
  /** Inputs between levels. */
  between: number;
  /** A source on two inputs (a wiring fault: impossible with TS cables). */
  dup: boolean;
}

export function patchSummary(src: readonly number[]): PatchSummary {
  const seen = new Set<number>();
  let count = 0;
  let between = 0;
  let dup = false;
  for (const k of src) {
    if (k === -1) between++;
    else if (k > 0) {
      count++;
      if (seen.has(k)) dup = true;
      seen.add(k);
    }
  }
  return { count, between, dup };
}

/** The firmware's canonical pairs for a decode (`V<k>-D<i>`, by source then
 *  input, `,`-joined): the sim's, and the tests'. */
export function pairsOf(src: readonly number[]): string {
  const pairs: Array<[number, number]> = [];
  src.forEach((k, i) => {
    if (k > 0) pairs.push([k, i + 1]);
  });
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return pairs.map(([k, i]) => `V${k}-D${i}`).join(",");
}

/** The heartbeat's bay keys (`pb`, `pbc`, `pbx`, `pft`; never the pairs). */
export interface PatchReport {
  /** V–D pairs in the settled bay, or `fault`. */
  pb: number | "fault";
  complete?: boolean;
  /** Inputs between levels in the latest scan. */
  between?: number;
  /** `no_port` | `stale` | `dup`. */
  fault?: string;
}

export function patchReport(o: { connected: boolean; reading: PatchState | null; now: number }): PatchReport {
  if (!o.connected) return { pb: "fault", fault: "no_port" };
  const r = o.reading;
  if (r === null || o.now - r.at > PATCH_STALE_MS) return { pb: "fault", fault: "stale" };
  const live = patchSummary(r.src);
  if (live.dup) return { pb: "fault", fault: "dup", between: live.between };
  return { pb: r.count, complete: r.complete, between: live.between };
}

/** The heartbeat query (`pb=` `pbc=` `pbx=` `pft=`); nothing for a terminal with no bay. */
export function patchQuery(r: PatchReport | null): Record<string, string> {
  if (r === null) return {};
  const q: Record<string, string> = { pb: r.pb === "fault" ? "fault" : String(Math.max(0, Math.min(16, Math.round(r.pb)))) };
  if (r.complete !== undefined) q["pbc"] = r.complete ? "1" : "0";
  if (r.between !== undefined) q["pbx"] = String(Math.max(0, Math.min(16, Math.round(r.between))));
  if (r.fault !== undefined && /^[a-z_]{1,24}$/u.test(r.fault)) q["pft"] = r.fault;
  return q;
}

export interface PatchIo {
  post(combo: string): Promise<PostOutcome>;
  now(): number;
  later(fn: () => void, ms: number): () => void;
}

/** The patch bay bridge's state machine. */
export class PatchBridge {
  private reading_: PatchState | null = null;
  /** The settled pairs on the previous line since connect (null: none yet). */
  private prev: string | null = null;
  /** The last set the story took (an `ok`; kept across reconnects, forgotten
   *  while the hour is not on: a new run). */
  private lastPosted: string | null = null;
  /** Bumped each time `lastPosted` is forgotten: a post sent before it never counts. */
  private run = 0;
  /** The set being posted or retried now. */
  private trying: string | null = null;
  private story: StoryPatch | null = null;
  private inFlight = false;
  /** A combination that settled while a post was in flight: posted when it lands. */
  private pending: string | null = null;
  private cancelRetry: (() => void) | null = null;
  private stopped = false;
  /** Every post's pairs, oldest first (tests, ⚙'s last line). */
  readonly posted: string[] = [];

  constructor(private readonly io: PatchIo) {}

  get reading(): PatchState | null {
    return this.reading_;
  }

  private gateOpen(): boolean {
    return this.story !== null && hourOn(this.story) && this.story.ended !== true && this.story.patch_override !== true;
  }

  /** A `patch` line from the board. */
  line(l: PatchLine): void {
    if (this.stopped) return;
    this.reading_ = { pairs: l.pairs, count: l.count, complete: l.complete, raw: l.raw, src: l.src, stable: l.stable, at: this.io.now() };
    const was = this.prev;
    this.prev = l.pairs;
    if (was === l.pairs) return; // the periodic line: nothing changed
    // Any change drops a retry of the bay as it was.
    this.giveUp();
    if (was === null) return; // the first line since connect: only looked at
    const combo = l.complete && l.count === PATCH_PAIRS ? l.pairs : null;
    if (combo === null || combo === this.lastPosted || combo === this.trying || !this.gateOpen()) return;
    if (this.inFlight) {
      this.pending = combo;
      return;
    }
    this.send(combo, 0);
  }

  /** The port closed or the board went away: the next line is a first look. */
  disconnected(): void {
    this.prev = null;
    this.reading_ = null;
    this.pending = null;
    this.giveUp();
  }

  /** A screen poll answered. */
  screen(night: StoryPatch): void {
    if (this.stopped) return;
    this.story = { server_door: night.server_door, patch_override: night.patch_override, step: night.step, ended: night.ended };
    if (!hourOn(this.story)) {
      // Not the hour (yet, or again: the story started over): a set posted in
      // a run before this one may be plugged again.
      if (this.lastPosted !== null || this.inFlight) this.run++;
      this.lastPosted = null;
    }
    if (!this.gateOpen()) {
      this.pending = null;
      this.giveUp();
    }
  }

  stop(): void {
    this.stopped = true;
    this.giveUp();
  }

  /** Stop retrying (a post in flight still lands, and counts if it's taken). */
  private giveUp(): void {
    this.cancelRetry?.();
    if (this.cancelRetry !== null) this.trying = null;
    this.cancelRetry = null;
  }

  private send(combo: string, attempt: number): void {
    this.inFlight = true;
    this.pending = null;
    this.trying = combo;
    this.posted.push(combo);
    const run = this.run;
    void this.io.post(combo).then(
      (out) => this.landed(combo, attempt, out, run),
      () => this.landed(combo, attempt, "network", run),
    );
  }

  private landed(combo: string, attempt: number, out: PostOutcome, run: number): void {
    this.inFlight = false;
    if (out === "ok" && run === this.run) this.lastPosted = combo;
    if (this.stopped) return;
    const current = () => this.reading_ !== null && this.reading_.pairs === combo && this.reading_.complete;
    const retry = out === "network" && attempt < PATCH_RETRY_MS.length && current() && this.gateOpen();
    if (!retry) this.trying = null;
    const next = this.pending;
    this.pending = null;
    if (next !== null && next !== combo) {
      this.trying = null;
      if (this.gateOpen() && this.reading_?.pairs === next && next !== this.lastPosted) this.send(next, 0);
      return;
    }
    // Refused (the server heard it and said no) or taken: done. Lost to the
    // network: again while the bay still says the same.
    if (!retry) return;
    this.cancelRetry = this.io.later(() => {
      this.cancelRetry = null;
      if (!current() || !this.gateOpen() || this.inFlight) {
        this.trying = null;
        return;
      }
      this.send(combo, attempt + 1);
    }, PATCH_RETRY_MS[attempt]!);
  }
}
