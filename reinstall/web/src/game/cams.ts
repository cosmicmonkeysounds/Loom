//! The wall terminals' camera feeds in the game (wave 14,
//! `docs/loom-reinstall.md` §2.3): every terminal near the player shows its
//! real room live on a window where it hangs (`HouseScene.setTerminalFeed`).
//!
//! The feed list (`GET /api/spatial/cams`) is polled every 2 s; the frame
//! of each feed worth showing (`pickFeeds`: a fresh feed, on the player's
//! floor, within 12 m, the 4 nearest) at ~3 fps, one request in flight per
//! feed, a repeat `x-cam-at` never decoded twice. A failing feed backs off
//! (3 misses → 5 s); a 401 / 410 on the list stops everything (the session
//! is over). Bitmaps are closed as soon as the scene has copied them.
//! Imperative but transport-injected, so the whole loop is unit-tested.

import type { TerminalSpot, Vec3 } from "@loom/house";
import { fetchCamFrame, fetchCams } from "../api.ts";

/** How often the feed list is read. */
export const CAM_LIST_MS = 2000;
/** How often each shown feed's frame is read (~3 fps). */
export const CAM_FRAME_MS = 333;
/** A terminal further than this (plan metres) shows no feed. */
export const CAM_NEAR_M = 12;
/** …or one more than this above / below the player (another floor). */
export const CAM_FLOOR_DY = 2.2;
/** At most this many feeds at once (each is ~3 small JPEGs a second). */
export const CAM_MAX_FEEDS = 4;
/** A feed that failed this many times in a row rests `CAM_REST_MS`. */
export const CAM_MISSES = 3;
export const CAM_REST_MS = 5000;

/**
 * The terminals whose feeds are worth showing from `at` (house metres): a
 * fresh feed, within `CAM_FLOOR_DY` of the player's height and `CAM_NEAR_M`
 * on the plan, nearest first, at most `CAM_MAX_FEEDS`.
 */
export function pickFeeds(terminals: readonly TerminalSpot[], fresh: ReadonlySet<string>, at: Vec3, max = CAM_MAX_FEEDS): string[] {
  const near: Array<{ id: string; d: number }> = [];
  for (const t of terminals) {
    if (!fresh.has(t.id)) continue;
    // The screen hangs ~1.3 m above its floor; the player's feet are on theirs.
    if (Math.abs(t.pos[1] - at[1] - 1.3) > CAM_FLOOR_DY) continue;
    const d = Math.hypot(t.pos[0] - at[0], t.pos[2] - at[2]);
    if (d <= CAM_NEAR_M) near.push({ id: t.id, d });
  }
  near.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  return near.slice(0, max).map((n) => n.id);
}

export interface CamFeedOptions {
  /** The event-scoped API base (`/e/<id>`). */
  base: string;
  /** The game's session token. */
  token: string;
  /** Draw a frame on terminal `spot`'s window, or `null` for its screen look. */
  sink(spot: string, source: ImageBitmap | null): void;
  /** The current map's terminals and the player's feet (house metres). */
  where(): { terminals: readonly TerminalSpot[]; at: Vec3 };
  fetcher?: typeof fetch;
  decode?: (blob: Blob) => Promise<ImageBitmap>;
  /** `setInterval` stand-in: returns the stop. */
  every?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
}

const defaultEvery = (fn: () => void, ms: number): (() => void) => {
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
};

const defaultDecode = (blob: Blob): Promise<ImageBitmap> => {
  if (typeof createImageBitmap !== "function") return Promise.reject(new Error("no createImageBitmap"));
  return createImageBitmap(blob);
};

/** The polling loop. `setActive(true)` while playing on screen. */
export class CamFeeds {
  private readonly o: CamFeedOptions;
  private fresh = new Set<string>();
  /** Spot → the `x-cam-at` on its window now. */
  private readonly shown = new Map<string, number>();
  private readonly inflight = new Set<string>();
  /** The last round's picks: a frame that lands for a spot no longer picked is dropped. */
  private wanted = new Set<string>();
  private readonly misses = new Map<string, { n: number; until: number }>();
  private stops: Array<() => void> = [];
  private listing = false;
  private active = false;
  private dead = false;

  constructor(opts: CamFeedOptions) {
    this.o = opts;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Poll while on: off stops the timers (the windows keep their last frame). */
  setActive(on: boolean): void {
    if (on === this.active || (on && this.dead)) return;
    this.active = on;
    for (const stop of this.stops) stop();
    this.stops = [];
    if (!on) return;
    const every = this.o.every ?? defaultEvery;
    this.stops.push(every(() => void this.list(), CAM_LIST_MS), every(() => this.tick(), CAM_FRAME_MS));
    void this.list();
  }

  /** Stop for good and put every screen back. */
  dispose(): void {
    this.setActive(false);
    this.dead = true;
    for (const spot of [...this.shown.keys()]) this.clear(spot);
  }

  /** The scene was rebuilt (a new map): every window is blank again, so the
   *  next frame of each feed is drawn even if it is not new. */
  forget(): void {
    this.shown.clear();
  }

  /** The spots with a frame on their window now (tests, the HUD never). */
  get showing(): string[] {
    return [...this.shown.keys()].sort();
  }

  private clear(spot: string): void {
    if (!this.shown.delete(spot)) return;
    try {
      this.o.sink(spot, null);
    } catch {
      /* a disposed scene */
    }
  }

  /** Read the feed list once. */
  async list(): Promise<void> {
    if (this.listing || this.dead) return;
    this.listing = true;
    try {
      const out = await fetchCams(this.o.base, this.o.token, this.o.fetcher);
      if (this.dead) return;
      if (out.status === 401 || out.status === 410) {
        this.dispose(); // the session is over
        return;
      }
      if (out.status !== 200) return; // away for a moment: keep what we had
      this.fresh = new Set(out.cams.map((c) => c.spot));
      for (const spot of [...this.shown.keys()]) if (!this.fresh.has(spot)) this.clear(spot);
    } finally {
      this.listing = false;
    }
  }

  /** One frame round: drop feeds no longer worth showing, read the rest. */
  tick(): void {
    if (!this.active || this.dead) return;
    const { terminals, at } = this.o.where();
    const want = pickFeeds(terminals, this.fresh, at);
    this.wanted = new Set(want);
    for (const spot of [...this.shown.keys()]) if (!this.wanted.has(spot)) this.clear(spot);
    const now = this.now();
    for (const spot of want) {
      if (this.inflight.has(spot)) continue;
      const m = this.misses.get(spot);
      if (m !== undefined && m.until > now) continue;
      void this.frame(spot);
    }
  }

  private miss(spot: string): void {
    const m = this.misses.get(spot) ?? { n: 0, until: 0 };
    m.n += 1;
    if (m.n >= CAM_MISSES) {
      m.n = 0;
      m.until = this.now() + CAM_REST_MS;
    }
    this.misses.set(spot, m);
  }

  private async frame(spot: string): Promise<void> {
    this.inflight.add(spot);
    try {
      const out = await fetchCamFrame(this.o.base, this.o.token, spot, this.o.fetcher);
      if (this.dead || !this.active) return;
      if (out.status === 404) {
        // Gone quiet (> 15 s) or off the map: the screen look again.
        this.fresh.delete(spot);
        this.clear(spot);
        return;
      }
      if (out.status !== 200 || out.blob === null) {
        this.miss(spot);
        return;
      }
      if (out.at !== null && this.shown.get(spot) === out.at) return; // nothing new
      let bmp: ImageBitmap;
      try {
        bmp = await (this.o.decode ?? defaultDecode)(out.blob);
      } catch {
        this.miss(spot);
        return;
      }
      try {
        if (this.dead || !this.active || !this.wanted.has(spot)) return;
        this.misses.delete(spot);
        this.o.sink(spot, bmp);
        this.shown.set(spot, out.at ?? this.now());
      } catch {
        /* a disposed scene */
      } finally {
        bmp.close?.();
      }
    } finally {
      this.inflight.delete(spot);
    }
  }
}
