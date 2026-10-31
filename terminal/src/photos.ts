//! The terminals' photos (wave 59p, `docs/loom-w59-photos-contract.md`): while the
//! screen state says `photos`, one still every 15 s, uploaded to the VPS
//! (`POST /api/mod/photos/shot`). Invisible: no flash, no sound, no pop-up, no
//! change to the screen, and a failure stays silent.
//!
//! - **It opens nothing.** There is one camera (`camera.ts`), and the feed
//!   (`camfeed.ts`) holds it wherever the games' camera setting is on. A still
//!   is read off that stream, from the `<video>` already in the page, so arming
//!   never prompts and never opens a camera. A terminal with that setting off
//!   takes no photos, and a scanner that happens to be up doesn't change that.
//! - **The sacred three.** The tent never sends its camera, the TV has none
//!   (`photoTerminal`, and the server tells neither nor takes theirs). The
//!   server room gives a still only while its camera is already running.
//! - **Old tablets.** The canvas is off the GPU as the feed's is (`sizeCanvas`,
//!   the Mali-400 note there), read by `toDataURL`. A still is up to 640 × 480,
//!   the whole frame, JPEG 0.7. `StillTuner` walks down when that fails: the
//!   `<video>`, then `ImageCapture` off the track, then what the feed has. A
//!   slow capture drops the size, then to the feed's frame, which costs nothing.
//! - Never more than one upload in flight (`runPhotos` is sequential), a page
//!   hidden takes none, and the feed's own loop and tuner are never touched.

import { useEffect } from "react";
import { baseOf, type TerminalConfig } from "./config.ts";
import { camera as pageCamera, type CameraHub } from "./camera.ts";
import { base64Bytes, feedWanted, jpegBase64, looksBlank, newestFeedFrame, trackPicture, videoPicture, type FeedFrame, type Picture } from "./camfeed.ts";
import { photoStatus } from "./photo-status.ts";
import { sizeCanvas } from "./software-canvas.ts";
import { PHOTO_EVERY_MS, type PhotoReport } from "../../core/src/photos.ts";

/** The sizes, largest first: the most a still is. */
export const PHOTO_SIZES: ReadonlyArray<readonly [number, number]> = [
  [640, 480],
  [320, 240],
];
export const PHOTO_QUALITY = 0.7;
/** The server refuses a still over this (decoded bytes, `core/server/photos.ts`). */
export const PHOTO_MAX_BYTES = 400 * 1024;
/** The wait before looking again when there's nothing to shoot. */
export const PHOTO_LOOK_MS = 5000;
/** The wait after an upload that failed. */
export const PHOTO_BACKOFF_MS = 60_000;
/** An upload this late is given up on, so one hung request can't end the night's photos. */
export const PHOTO_UPLOAD_MS = 20_000;
/** A capture this slow (ms)… */
export const PHOTO_SLOW_MS = 400;
/** …this many times running drops a size. */
export const PHOTO_SLOW_RUN = 2;
/** This many shots on the feed's frame tries the top again (2 minutes). */
export const PHOTO_RETRY_RUN = 8;
/** The feed's frame is this fresh, or it isn't a photo of now. */
export const PHOTO_FEED_FRESH_MS = 5000;

/** Does this terminal ever take stills? Never the tent, never the TV. */
export function photoTerminal(c: Pick<TerminalConfig, "spot"> & { view?: string }): boolean {
  return c.spot.trim() !== "" && c.view !== "reinstall" && c.view !== "tv";
}

/** The largest size within `maxW × maxH` that keeps the whole frame, and never upscales. */
export function fitSize(vw: number, vh: number, maxW: number, maxH: number): { w: number; h: number } {
  const scale = Math.min(1, maxW / vw, maxH / vh);
  return { w: Math.max(1, Math.round(vw * scale)), h: Math.max(1, Math.round(vh * scale)) };
}

/**
 * How a still is taken (pure), found out by trying. A size at a time, and a route
 * at a time: the `<video>`, then the track, then the feed's own frame. A route
 * that has shown a picture is `proved`, so a blank frame on it is a dark room,
 * and it goes out as it is. After `PHOTO_RETRY_RUN` shots on the feed's frame the
 * top is tried again, so a transient never costs the night.
 */
export class StillTuner {
  size = 0;
  track = false;
  feed = false;
  proved = false;
  private slow = 0;
  private waited = 0;

  constructor(private readonly canTrack: boolean) {}

  private down(): void {
    this.slow = 0;
    if (this.size < PHOTO_SIZES.length - 1) this.size++;
    else this.feed = true;
  }

  /** A capture took `ms`. */
  took(ms: number): void {
    this.slow = ms >= PHOTO_SLOW_MS ? this.slow + 1 : 0;
    if (this.slow >= PHOTO_SLOW_RUN) this.down();
  }

  tooBig(): void {
    this.down();
  }

  good(): void {
    this.proved = true;
  }

  /** No frame, or a blank one on a route that has never shown a picture: the next route. */
  failed(): void {
    this.proved = false;
    if (!this.track && this.canTrack) this.track = true;
    else this.feed = true;
  }

  /** One shot on the feed's frame. */
  onFeed(): void {
    if (++this.waited < PHOTO_RETRY_RUN) return;
    this.waited = 0;
    this.slow = 0;
    this.size = 0;
    this.track = false;
    this.feed = false;
    this.proved = false;
  }
}

export type Shot = { kind: "still"; still: FeedFrame } | { kind: "camera" } | { kind: "picture" };

/** One capture onto the canvas at `w × h`: its JPEG (base64), and the empty canvas's length at that size. */
export type Draw = (pic: Picture, w: number, h: number) => { jpeg: string | null; emptyLength: number };

export interface StillDeps {
  /** The running camera; null: none is running, and nothing here opens one. */
  stream: () => MediaStream | null;
  picture: (stream: MediaStream, track: boolean) => Promise<Picture | null> | Picture | null;
  draw: Draw;
  /** The feed's newest frame, if fresh. */
  feedFrame: () => FeedFrame | null;
  clock: () => number;
}

/** One still, by what the tuner says, with the feed's frame to fall back on. */
export async function takeStill(tuner: StillTuner, d: StillDeps): Promise<Shot> {
  const stream = d.stream();
  if (stream === null) return { kind: "camera" };
  const fallback = (): Shot => {
    const f = d.feedFrame();
    return f === null ? { kind: "picture" } : { kind: "still", still: f };
  };
  if (tuner.feed) {
    tuner.onFeed();
    return fallback();
  }
  const pic = await d.picture(stream, tuner.track);
  if (pic === null) {
    tuner.failed();
    return fallback();
  }
  try {
    const [maxW, maxH] = PHOTO_SIZES[tuner.size]!;
    const { w, h } = fitSize(pic.w, pic.h, maxW, maxH);
    const started = d.clock();
    const { jpeg, emptyLength } = d.draw(pic, w, h);
    tuner.took(d.clock() - started);
    if (jpeg === null) {
      tuner.failed();
      return fallback();
    }
    if (base64Bytes(jpeg) > PHOTO_MAX_BYTES) {
      tuner.tooBig();
      return fallback();
    }
    if (!tuner.proved && looksBlank(jpeg.length, emptyLength)) {
      tuner.failed();
      return fallback();
    }
    tuner.good();
    return { kind: "still", still: { jpeg, w, h } };
  } catch {
    tuner.failed();
    return fallback();
  } finally {
    pic.done?.();
  }
}

export interface PhotoDeps {
  shoot: () => Promise<Shot>;
  /** Send it: the HTTP status, null when the server couldn't be reached. */
  post: (still: FeedFrame) => Promise<number | null>;
  hidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onReport: (r: PhotoReport) => void;
}

/** Is that upload's answer no trouble? 409: just disarmed. 429: a reload shot early. */
export function photoPosted(status: number | null): boolean {
  return status !== null && ((status >= 200 && status < 300) || status === 409 || status === 429);
}

/** The loop: shoot → post → wait, so never two uploads in flight. Returns the stopper. */
export function runPhotos(d: PhotoDeps): () => void {
  let alive = true;
  let timer: unknown = null;
  const next = (ms: number) => {
    if (alive) timer = d.setTimer(() => void tick(), ms);
  };
  const tick = async () => {
    timer = null;
    if (!alive) return;
    if (d.hidden()) {
      d.onReport("hidden");
      next(PHOTO_LOOK_MS);
      return;
    }
    const started = d.now();
    const shot = await d.shoot().catch((): Shot => ({ kind: "picture" }));
    if (!alive) return;
    if (shot.kind !== "still") {
      d.onReport(shot.kind);
      next(PHOTO_LOOK_MS);
      return;
    }
    const status = await d.post(shot.still).catch(() => null);
    if (!alive) return;
    if (photoPosted(status)) {
      d.onReport("ok");
      next(Math.max(0, PHOTO_EVERY_MS - (d.now() - started)));
    } else {
      d.onReport("upload");
      next(PHOTO_BACKOFF_MS);
    }
  };
  next(0);
  return () => {
    alive = false;
    if (timer !== null) d.clearTimer(timer);
  };
}

// --- the page's photos ---------------------------------------------------------

/** The newest frame of `stream` from any `<video>` already showing it (the feed's, the scanner's). */
function pagePicture(stream: MediaStream): Picture | null {
  for (const v of Array.from(document.querySelectorAll("video"))) {
    if (v.srcObject !== stream) continue;
    const pic = videoPicture(v);
    if (pic !== null) return pic;
  }
  return null;
}

/** The canvas a still is drawn on: never in the page. Null: no 2D here. */
function canvasDraw(): Draw | null {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (ctx === null) return null;
  let emptyLength = 0;
  const jpeg = () => jpegBase64(canvas.toDataURL("image/jpeg", PHOTO_QUALITY));
  return (pic, w, h) => {
    if (canvas.width !== w || canvas.height !== h) {
      sizeCanvas(canvas, ctx, w, h);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      emptyLength = jpeg()?.length ?? 0;
    }
    ctx.drawImage(pic.image, 0, 0, pic.w, pic.h, 0, 0, w, h);
    return { jpeg: jpeg(), emptyLength };
  };
}

/** Take stills while `armed`, where this terminal may. */
export function usePhotos(config: TerminalConfig | null, armed: boolean, hub: CameraHub = pageCamera): void {
  const shoots = armed && config !== null && photoTerminal(config);
  // The games' camera setting: the one thing that holds a camera open.
  const camera = config !== null && feedWanted(config);
  const eventId = config?.eventId ?? "";
  const token = config?.token ?? "";
  const spot = config?.spot.trim() ?? "";
  useEffect(() => {
    if (!shoots) {
      photoStatus.set(null);
      return;
    }
    if (!camera) {
      photoStatus.set("camera");
      return () => photoStatus.set(null);
    }
    const draw = canvasDraw();
    if (draw === null) {
      photoStatus.set("picture");
      return () => photoStatus.set(null);
    }
    const tuner = new StillTuner(typeof (window as unknown as { ImageCapture?: unknown }).ImageCapture === "function");
    const url = `${baseOf({ eventId })}/api/mod/photos/shot`;
    const stop = runPhotos({
      shoot: () =>
        takeStill(tuner, {
          stream: () => (hub.snapshot.state === "live" ? hub.snapshot.stream : null),
          picture: (stream, track) => (track ? trackPicture(stream) : pagePicture(stream)),
          draw,
          feedFrame: () => newestFeedFrame(Date.now(), PHOTO_FEED_FRESH_MS),
          clock: () => performance.now(),
        }),
      post: (s) => {
        const abort = new AbortController();
        const late = window.setTimeout(() => abort.abort(), PHOTO_UPLOAD_MS);
        return fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify({ spot, jpeg: s.jpeg, w: s.w, h: s.h }), signal: abort.signal })
          .then(
            (r) => r.status,
            () => null,
          )
          .finally(() => window.clearTimeout(late));
      },
      hidden: () => document.hidden,
      now: () => Date.now(),
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: (t) => window.clearTimeout(t as number),
      onReport: (r) => photoStatus.set(r),
    });
    return () => {
      stop();
      photoStatus.set(null);
    };
  }, [shoots, camera, eventId, token, spot, hub]);
}
