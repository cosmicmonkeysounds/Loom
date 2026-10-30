//! Clippy's dream in the reinstallation games (wave 50,
//! `docs/loom-w50-contract.md` C4). Both games already hang a JPEG feed on
//! every terminal in the player's room (`spatial-cams.ts`,
//! `GET /api/spatial/cams` + `/cam?spot=`), so the dream reaches them down
//! the same two routes and neither game changes: a Quest APK from before this
//! wave shows it too. While the dream runs the games' terminals stay what they
//! are, windows on the real rooms, and it breaks through them in irregular
//! spurts (`dreamSpurting`): for a few seconds a terminal's feed is its own
//! moment of the hour (`@loom/house` `dreamFrameIndex`: what that wall shows
//! now), read off disk at the 3 fps the games poll. A terminal with no camera
//! keeps its usual screen between spurts. Transport-free, clock injected;
//! memory only (nothing but the "are the frames there?" answer, cached).

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { DREAM_FRAME_FPS, DREAM_SECONDS, dreamFrameIndex, dreamFrameName, dreamOffsetS } from "@loom/house";

import type { CamInfo } from "./spatial-cams.ts";

/** The set's frames: 320 × 240, as a terminal's camera sends. */
export const DREAM_FEED_W = 320;
export const DREAM_FEED_H = 240;
/** Each terminal's time is cut into slots this long… */
export const DREAM_SPURT_SLOT_MS = 15_000;
/** …and this share of them holds a spurt: about one every 30 s, never a metronome. */
export const DREAM_SPURT_CHANCE = 0.5;
/** A spurt's shortest and longest: past the games' 2 s read of the feed list,
 *  so one reaches a terminal with no camera too. */
export const DREAM_SPURT_MIN_MS = 3000;
export const DREAM_SPURT_MAX_MS = 6000;
/** How long a look for the frames on disk is believed. */
export const DREAM_CHECK_MS = 30_000;

export interface DreamFrame {
  jpeg: Buffer;
  /** The frame's slot on the clock: a repeat is never decoded twice (`x-cam-at`). */
  at: number;
}

export interface DreamFeedOptions {
  /** The media folder (`LOOM_MEDIA_DIR`); null: no dream reaches the games. */
  dir: string | null;
  now?: () => number;
  read?: (file: string) => Promise<Buffer>;
  exists?: (file: string) => Promise<boolean>;
}

const hasFile = (file: string): Promise<boolean> => stat(file).then((s) => s.isFile(), () => false);

/**
 * Is the dream breaking through terminal `spot` at server time `at`? Pure: no
 * state, so a restart or two games agree. Each terminal runs on its own clock
 * (its head start in the hour), so no two spurt together.
 */
export function dreamSpurting(spot: string, at: number): boolean {
  const t = at + dreamOffsetS(spot) * 1000;
  const slot = Math.floor(t / DREAM_SPURT_SLOT_MS);
  // The stagger's hash, used as a dice roll in [0, 1).
  const roll = (what: string): number => dreamOffsetS(`${spot}#${slot}#${what}`) / DREAM_SECONDS;
  if (roll("go") >= DREAM_SPURT_CHANCE) return false;
  const length = DREAM_SPURT_MIN_MS + (DREAM_SPURT_MAX_MS - DREAM_SPURT_MIN_MS) * roll("length");
  const start = (DREAM_SPURT_SLOT_MS - length) * roll("start");
  const into = t - slot * DREAM_SPURT_SLOT_MS;
  return into >= start && into < start + length;
}

export class DreamFeed {
  private readonly dir: string | null;
  private readonly now: () => number;
  private readonly read: (file: string) => Promise<Buffer>;
  private readonly exists: (file: string) => Promise<boolean>;
  private checkedAt = Number.NEGATIVE_INFINITY;
  private found = false;

  constructor(o: DreamFeedOptions) {
    this.dir = o.dir;
    this.now = o.now ?? Date.now;
    this.read = o.read ?? readFile;
    this.exists = o.exists ?? hasFile;
  }

  private file(index: number): string | null {
    return this.dir === null ? null : join(this.dir, "dream", "frames", dreamFrameName(index));
  }

  /** Are the frames on disk? Asked at most once per `DREAM_CHECK_MS`; the
   *  answer in hand comes back at once, a new look lands for the next caller. */
  ready(): boolean {
    const now = this.now();
    if (now - this.checkedAt >= DREAM_CHECK_MS && this.dir !== null) {
      this.checkedAt = now;
      void this.exists(this.file(1)!).then(
        (ok) => void (this.found = ok),
        () => void (this.found = false),
      );
    }
    return this.found;
  }

  /** Is the dream breaking through this terminal now? */
  spurting(spot: string): boolean {
    return dreamSpurting(spot, this.now());
  }

  /** The terminal's frame now, or null (the set is short a file). */
  async frame(spot: string): Promise<DreamFrame | null> {
    const now = this.now();
    const file = this.file(dreamFrameIndex(spot, now));
    if (file === null) return null;
    try {
      return { jpeg: await this.read(file), at: Math.floor((now * DREAM_FRAME_FPS) / 1000) };
    } catch {
      return null;
    }
  }

  /** The feed list while the dream runs: the real cameras, and any terminal
   *  of `spots` with none while a spurt is on it. */
  list(spots: Iterable<string>, real: readonly CamInfo[]): CamInfo[] {
    const at = this.now();
    const out = new Map<string, CamInfo>(real.map((c) => [c.spot, c]));
    for (const spot of spots) if (!out.has(spot) && this.spurting(spot)) out.set(spot, { spot, at, w: DREAM_FEED_W, h: DREAM_FEED_H });
    return [...out.values()].sort((a, b) => (a.spot < b.spot ? -1 : 1));
  }
}
