//! Clippy's dream in the reinstallation games (wave 50,
//! `docs/loom-w50-contract.md` C4). Both games already hang a JPEG feed on
//! every terminal in the player's room (`spatial-cams.ts`,
//! `GET /api/spatial/cams` + `/cam?spot=`), so the dream reaches them down
//! the same two routes and neither game changes: a Quest APK from before this
//! wave shows it too. While the dream runs each terminal's feed is its own
//! moment of the hour (`@loom/house` `dreamFrameIndex`: what that wall shows
//! now), read off disk at the 3 fps the games poll, with the room's real
//! camera breaking through for `DREAM_CAM_MS` in every `DREAM_CAM_EVERY_MS`
//! where the terminal has one. Transport-free, clock injected; memory only
//! (nothing but the "are the frames there?" answer, cached).

import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { DREAM_FRAME_FPS, dreamFrameIndex, dreamFrameName, dreamOffsetS } from "@loom/house";

import type { CamInfo } from "./spatial-cams.ts";

/** The set's frames: 320 × 240, as a terminal's camera sends. */
export const DREAM_FEED_W = 320;
export const DREAM_FEED_H = 240;
/** The real room breaks through this long… */
export const DREAM_CAM_MS = 3000;
/** …in every this long, on each terminal's own beat. */
export const DREAM_CAM_EVERY_MS = 24_000;
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

  /** Does this terminal's real camera break through now? Only with a fresh
   *  frame to show: `hasCamera`. */
  showsCamera(spot: string, hasCamera: boolean): boolean {
    if (!hasCamera) return false;
    const beat = (this.now() + dreamOffsetS(spot) * 1000) % DREAM_CAM_EVERY_MS;
    return beat < DREAM_CAM_MS;
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

  /** The feed list while the dream runs: every terminal in `spots` has a
   *  feed, whether or not it has a camera. */
  list(spots: Iterable<string>, real: readonly CamInfo[]): CamInfo[] {
    const at = this.now();
    const out = new Map<string, CamInfo>(real.map((c) => [c.spot, c]));
    for (const spot of spots) if (!out.has(spot)) out.set(spot, { spot, at, w: DREAM_FEED_W, h: DREAM_FEED_H });
    return [...out.values()].sort((a, b) => (a.spot < b.spot ? -1 : 1));
  }
}
