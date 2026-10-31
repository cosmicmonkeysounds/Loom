//! The camera feed (wave 14): a placed terminal sends a small, frequent JPEG
//! of its own camera to the event (`POST /api/mod/spatial/cam {spot, jpeg,
//! w, h}`, its mod token), and the reinstallation games hang that picture on
//! the wall where this tablet hangs — a window from the virtual house into
//! the real room.
//!
//! ~3 frames a second at up to 320 × 240 (a 4:3 centre crop of the camera,
//! JPEG quality 0.5 — ~10–20 KB each; wave 33b doubled it from 160 × 120 for
//! the games' 3× terminals), drawn off the page's one camera stream
//! (`camera.ts`, the scanner's), never while the page is hidden, never more
//! than one upload in flight. A failure backs off (1 s doubling to 30 s); a
//! 404 (`no such spot` — the map has no terminal by this id) stops the feed
//! until ⚙ changes the spot, and so does a revoked token. The image is sent
//! as the camera sees it (never mirrored).
//!
//! Wave 26 (R5, C7): the upload's reply says whether anyone in the game can
//! see this room (`watched`: a player is in this spot's room). While
//! `watched: false` the feed slows to one frame every `FEED_IDLE_EVERY_MS`
//! (2 s) and goes back to `FEED_EVERY_MS` on `true`; an older server sends
//! no `watched` (the old rate). The tent laptop (`view=reinstall`) never
//! sends its camera: every walk starts in its room, and it is never linked.
//!
//! Old tablets (Chrome 87 / Safari 14): a plain `<canvas>` + `toDataURL`, no
//! `OffscreenCanvas`.
//!
//! Wave 59 (the SM-T280s: Mali-400, Chrome 95, GPU rasterization off). A 2D
//! canvas read only by `toDataURL` stays on the GPU, while the scanner's, which
//! calls `getImageData`, had been pushed to software all along. The leading
//! hypothesis for no video is that the GPU path reads back blank on that chip
//! (no tablet has confirmed it: ⚙'s `blank` or `no_frames` would). So the canvas
//! here is kept off the GPU (`sizeCanvas`). A frame that comes back blank, or
//! never comes, walks `FeedTuner`'s ladder: the frame straight off the track
//! (`ImageCapture`, no `<video>`), then the smallest size. A route that has shown
//! a picture is proved, and a blank frame on it is a dark room, sent as it is;
//! on a lesser route the top is tried again now and then, so a transient never
//! costs the night. The feed also spends at most `FEED_SHARE` of the page: a
//! slow capture stretches the gap, then drops a size. `link-stats.ts` counts
//! what happens.

import { useEffect, useState, useSyncExternalStore } from "react";
import { baseOf, type TerminalConfig } from "./config.ts";
import { camera as pageCamera, type CameraHub, type CameraState } from "./camera.ts";
import { linkStats } from "./link-stats.ts";
import { sizeCanvas } from "./software-canvas.ts";
import type { LinkError } from "../../core/src/link-health.ts";

export const FEED_W = 320;
export const FEED_H = 240;
export const FEED_EVERY_MS = 333;
/** (wave 26, R5) Nobody in the game can see this room (`watched: false`): one frame this often. */
export const FEED_IDLE_EVERY_MS = 2000;
export const FEED_QUALITY = 0.5;
export const FEED_BACKOFF_MS = 1000;
export const FEED_BACKOFF_MAX_MS = 30_000;
/** The server refuses a frame over this (decoded bytes). */
export const FEED_MAX_BYTES = 96 * 1024;

/** Time before the feed asks for a camera that failed to open again. */
export const FEED_CAMERA_RETRY_MS = 15_000;
/** A camera still opening after this long (ms) is usually a prompt nobody has answered. */
export const FEED_CAMERA_WAIT_MS = 20_000;

/** The sizes, largest first. */
export const FEED_SIZES: ReadonlyArray<readonly [number, number]> = [[FEED_W, FEED_H], [160, 120], [128, 96]];
/** The feed spends at most this share of the page's time. */
export const FEED_SHARE = 0.25;
/** A capture this slow (ms)… */
export const FEED_SLOW_MS = 120;
/** …this many times running drops a size. */
export const FEED_SLOW_RUN = 5;
/** This many looks with no frame in a row (≈ 4 s) tries the next route. */
export const FEED_MISS_RUN = 12;
/** This many blank frames in a row tries the next route. */
export const FEED_BLANK_RUN = 6;
/** A JPEG within this share of an empty canvas's is a blank frame. */
export const FEED_BLANK_MARGIN = 1.1;
/** A frame off the track this late is a miss (ms). */
export const FEED_GRAB_MS = 3000;
/** This many good frames on a lesser route (≈ 20 s) tries the top again. */
export const FEED_RETRY_RUN = 60;

/** Is this JPEG (base64 length) no bigger than the empty canvas's? A dark room
 *  still has noise in it, and that costs bytes. */
export function looksBlank(length: number, emptyLength: number): boolean {
  return emptyLength > 0 && length <= emptyLength * FEED_BLANK_MARGIN;
}

/**
 * How this terminal gets a picture and what it costs (pure): which size, the
 * `<video>` or the track, and how long to wait. What's wrong is only ever found
 * out by trying, so a frame that doesn't come walks down: the track, then the
 * smallest size, then both. A blank run only walks a route that has never shown
 * a picture: on a `proved` one it's a dark room. Below the top, every
 * `FEED_RETRY_RUN` good frames one frame tries the top again: a good one stays
 * there, and anything else goes straight back, at the cost of that one frame.
 */
export class FeedTuner {
  size = 0;
  /** Grab frames off the track, not the `<video>`. */
  track = false;
  /** What a capture costs (ms, smoothed). */
  costMs = 0;
  /** This route has shown a picture, so a blank frame on it is the room's. */
  proved = false;
  private slow = 0;
  private misses = 0;
  private blanks = 0;
  private rung = 0;
  private sinceTop = 0;
  /** Where to go back to while a frame tries the top. */
  private trying: { track: boolean; size: number; rung: number } | null = null;

  constructor(private readonly canTrack: boolean) {}

  /** The ladder has nothing left: a blank frame goes out after all, since a dim
   *  room would otherwise never send anything. */
  get spent(): boolean {
    return this.rung >= (this.canTrack ? 3 : 1);
  }

  /** A capture took `ms`. */
  took(ms: number): void {
    if (ms >= FEED_SLOW_MS && this.backFromTop()) return;
    this.costMs = this.costMs === 0 ? ms : this.costMs * 0.7 + ms * 0.3;
    this.slow = ms >= FEED_SLOW_MS ? this.slow + 1 : 0;
    if (this.slow >= FEED_SLOW_RUN && this.size < FEED_SIZES.length - 1) {
      this.size++;
      this.slow = 0;
    }
  }

  good(): void {
    this.misses = 0;
    this.blanks = 0;
    this.proved = true;
    if (this.trying !== null) {
      this.trying = null;
      this.rung = 0;
      return;
    }
    if ((this.size === 0 && !this.track) || ++this.sinceTop < FEED_RETRY_RUN) return;
    this.sinceTop = 0;
    this.trying = { track: this.track, size: this.size, rung: this.rung };
    this.track = false;
    this.size = 0;
    this.proved = false;
  }

  /** No frame: true once that's a failure worth calling one. */
  missed(): boolean {
    if (this.backFromTop() || ++this.misses < FEED_MISS_RUN) return false;
    this.misses = 0;
    this.walk();
    return true;
  }

  /** A blank frame on an unproved route: true once that's a failure worth calling one. */
  blank(): boolean {
    if (this.backFromTop() || ++this.blanks < FEED_BLANK_RUN) return false;
    this.blanks = 0;
    this.walk();
    return true;
  }

  /** A try of the top that didn't take: back to the route that works. */
  private backFromTop(): boolean {
    if (this.trying === null) return false;
    ({ track: this.track, size: this.size, rung: this.rung } = this.trying);
    this.trying = null;
    this.proved = true;
    return true;
  }

  private walk(): void {
    const last = FEED_SIZES.length - 1;
    const rungs: Array<{ track: boolean; size: number }> = this.canTrack
      ? [{ track: true, size: this.size }, { track: false, size: last }, { track: true, size: last }]
      : [{ track: false, size: last }];
    const next = rungs[Math.min(this.rung, rungs.length - 1)]!;
    this.rung++;
    this.track = next.track;
    this.size = next.size;
    this.proved = false;
    this.sinceTop = 0;
  }

  /** The wait after a frame: `base`, or longer to keep to `FEED_SHARE`. */
  gap(base: number): number {
    return Math.max(base, Math.round(this.costMs / FEED_SHARE));
  }
}

/** Is a camera that failed to open worth asking for again? A busy or
 *  glitched camera (`error`: NotReadableError and the like) is; no secure
 *  context, a refusal (Safari would re-prompt every time) or no camera isn't. */
export function cameraRetryable(state: CameraState): boolean {
  return state === "error";
}

/** Does this terminal send its camera? Only a placed one, only while ⚙ leaves
 *  it on, and never the tent laptop (`view=reinstall`, wave 26 T3 / R5). */
export function feedWanted(c: Pick<TerminalConfig, "spot" | "camFeed"> & { view?: string }): boolean {
  return c.camFeed && c.spot.trim() !== "" && c.view !== "reinstall";
}

/** The source rectangle of a centre crop of `vw × vh` to `aspect` (w / h). */
export function cropRect(vw: number, vh: number, aspect = FEED_W / FEED_H): { sx: number; sy: number; sw: number; sh: number } {
  if (vw <= 0 || vh <= 0) return { sx: 0, sy: 0, sw: 0, sh: 0 };
  if (vw / vh > aspect) {
    const sw = Math.round(vh * aspect);
    return { sx: Math.round((vw - sw) / 2), sy: 0, sw, sh: vh };
  }
  const sh = Math.round(vw / aspect);
  return { sx: 0, sy: Math.round((vh - sh) / 2), sw: vw, sh };
}

/** A `data:image/jpeg;base64,…` URL's payload (the wire wants no prefix); null for anything else. */
export function jpegBase64(dataUrl: string): string | null {
  const m = /^data:image\/jpeg;base64,(.+)$/u.exec(dataUrl);
  return m === null ? null : m[1]!;
}

/** The decoded size of a base64 payload, bytes. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export type FeedStatus =
  | { kind: "off" }
  | { kind: "waiting" } // no camera frame yet (or the page is hidden)
  | { kind: "sending"; at: number; watched?: boolean }
  | { kind: "retrying"; problem: string }
  | { kind: "stopped"; problem: string };

/** The feed's status in words for ⚙. */
export function feedStatusText(s: FeedStatus): string {
  switch (s.kind) {
    case "off":
      return "camera feed off";
    case "waiting":
      return "camera feed waiting for the camera";
    case "sending":
      return s.watched === false ? "camera feed idle — nobody in this room in the games" : "camera feed live — the games show this room";
    case "retrying":
      return `camera feed retrying (${s.problem})`;
    case "stopped":
      return `camera feed stopped: ${s.problem}`;
  }
}

/** What one upload's HTTP status means for the loop. */
export function feedOutcome(status: number | null): "ok" | "stop" | "retry" {
  if (status !== null && status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 401 || status === 403) return "stop";
  return "retry";
}

/** One upload's failure as the readout's code. */
export function feedError(status: number | null): LinkError {
  if (status === null) return "offline";
  if (status === 404) return "no_spot";
  if (status === 401 || status === 403) return "refused";
  if (status === 413) return "too_big";
  return "http";
}

/** Why the camera didn't open, as the readout's code. */
export function cameraError(state: CameraState): LinkError {
  return state === "denied" ? "cam_denied" : state === "insecure" ? "cam_insecure" : state === "none" ? "cam_none" : "cam_error";
}

export function feedProblem(status: number | null): string {
  if (status === null) return "the server can't be reached";
  if (status === 404) return "no such spot in the event's house map — pick this terminal's spot in ⚙";
  if (status === 401 || status === 403) return "this terminal's access was refused";
  if (status === 413) return "the frame was too big";
  return `HTTP ${status}`;
}

/** One upload's answer: its HTTP status (null: unreachable) and, from a wave
 *  26 server, whether a player can see this room now. */
export interface FeedReply {
  status: number | null;
  watched?: boolean;
}

/** The `watched` flag off an upload's JSON body (anything else: unknown). */
export function watchedOf(body: unknown): boolean | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const w = (body as Record<string, unknown>)["watched"];
  return typeof w === "boolean" ? w : undefined;
}

/** The wait before the next frame after an upload the server took. */
export function feedGap(watched: boolean | undefined): number {
  return watched === false ? FEED_IDLE_EVERY_MS : FEED_EVERY_MS;
}

export interface FeedFrame {
  jpeg: string;
  w: number;
  h: number;
}

export interface FeedDeps {
  /** A frame of the camera now, or null (no frame yet). */
  capture: () => FeedFrame | null | Promise<FeedFrame | null>;
  /** Send it; the HTTP status (null when the server couldn't be reached) and the reply's `watched`. */
  post: (frame: FeedFrame) => Promise<FeedReply>;
  hidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onStatus: (s: FeedStatus) => void;
  /** Stretch a wait (wave 59, `FeedTuner.gap`). */
  pace?: (ms: number) => number;
}

/**
 * The upload loop: capture → post → wait → again. Sequential, so never two
 * uploads in flight. Returns the stopper.
 */
export function runFeed(deps: FeedDeps): () => void {
  let alive = true;
  let timer: unknown = null;
  let backoff = 0;
  let last: FeedStatus | null = null;
  const status = (s: FeedStatus) => {
    if (last !== null && last.kind === s.kind && (s.kind !== "retrying" || (last.kind === "retrying" && last.problem === s.problem))) {
      if (s.kind !== "sending") return;
    }
    last = s;
    deps.onStatus(s);
  };
  const next = (ms: number) => {
    if (alive) timer = deps.setTimer(() => void tick(), deps.pace?.(ms) ?? ms);
  };
  const tick = async () => {
    timer = null;
    if (!alive) return;
    if (deps.hidden()) {
      status({ kind: "waiting" });
      next(FEED_EVERY_MS * 3);
      return;
    }
    const frame = await deps.capture();
    if (!alive) return;
    if (frame === null) {
      status({ kind: "waiting" });
      next(FEED_EVERY_MS);
      return;
    }
    if (base64Bytes(frame.jpeg) > FEED_MAX_BYTES) {
      next(FEED_EVERY_MS);
      return;
    }
    const reply = await deps.post(frame).catch((): FeedReply => ({ status: null }));
    if (!alive) return;
    const code = reply.status;
    const outcome = feedOutcome(code);
    if (outcome === "ok") {
      backoff = 0;
      status(reply.watched === undefined ? { kind: "sending", at: deps.now() } : { kind: "sending", at: deps.now(), watched: reply.watched });
      next(feedGap(reply.watched));
    } else if (outcome === "stop") {
      status({ kind: "stopped", problem: feedProblem(code) });
    } else {
      backoff = backoff === 0 ? FEED_BACKOFF_MS : Math.min(FEED_BACKOFF_MAX_MS, backoff * 2);
      status({ kind: "retrying", problem: feedProblem(code) });
      next(backoff);
    }
  };
  next(0);
  return () => {
    alive = false;
    if (timer !== null) deps.clearTimer(timer);
  };
}

// --- the page's feed ------------------------------------------------------------

class FeedStatusStore {
  snapshot: FeedStatus = { kind: "off" };
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  set(s: FeedStatus): void {
    this.snapshot = s;
    for (const fn of this.listeners) fn();
  }
}

/** The page's feed status (⚙ shows it). */
export const feedStatus = new FeedStatusStore();

export function useFeedStatus(): FeedStatus {
  return useSyncExternalStore(feedStatus.subscribe, () => feedStatus.snapshot);
}

interface Picture {
  image: CanvasImageSource;
  w: number;
  h: number;
  done?: () => void;
}

/** The `<video>`'s current frame, or null. */
function videoPicture(video: HTMLVideoElement): Picture | null {
  return video.readyState < 2 || video.videoWidth === 0 ? null : { image: video, w: video.videoWidth, h: video.videoHeight };
}

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

function imageCaptureCtor(): ImageCaptureCtor | null {
  return (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture ?? null;
}

/** The next frame straight off the track (no `<video>`), or null. */
async function trackPicture(stream: MediaStream | null): Promise<Picture | null> {
  const Ctor = imageCaptureCtor();
  const track = stream?.getVideoTracks()[0];
  if (Ctor === null || track === undefined) return null;
  let late = 0;
  try {
    const bmp = await Promise.race([
      new Ctor(track).grabFrame(),
      new Promise<null>((resolve) => {
        late = window.setTimeout(() => resolve(null), FEED_GRAB_MS);
      }),
    ]);
    return bmp === null ? null : { image: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  } catch {
    return null;
  } finally {
    window.clearTimeout(late);
  }
}

/** Frames of the camera, as the tuner says, each cropped into a JPEG. */
function frameGrabber(video: HTMLVideoElement, stream: () => MediaStream | null, tuner: FeedTuner): () => Promise<FeedFrame | null> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  let size = -1;
  let emptyLength = 0;
  const jpeg = () => jpegBase64(canvas.toDataURL("image/jpeg", FEED_QUALITY));
  const fit = (c: CanvasRenderingContext2D) => {
    if (size === tuner.size) return;
    size = tuner.size;
    const [w, h] = FEED_SIZES[size]!;
    sizeCanvas(canvas, c, w, h);
    c.fillStyle = "#000";
    c.fillRect(0, 0, w, h);
    emptyLength = jpeg()?.length ?? 0;
  };
  const miss = (code: LinkError) => {
    if (tuner.missed()) linkStats.error(Date.now(), code);
    return null;
  };
  return async () => {
    if (ctx === null) return miss("no_frames");
    fit(ctx);
    const pic = tuner.track ? await trackPicture(stream()) : videoPicture(video);
    if (pic === null) return miss("no_frames");
    // What this costs the page: waiting for the track's next frame costs it nothing.
    const started = performance.now();
    try {
      const r = cropRect(pic.w, pic.h);
      ctx.drawImage(pic.image, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
      const out = jpeg();
      const ms = performance.now() - started;
      tuner.took(ms);
      linkStats.captureCost(ms);
      if (out === null) return miss("no_frames");
      const frame = { jpeg: out, w: canvas.width, h: canvas.height };
      if (!tuner.proved && looksBlank(out.length, emptyLength)) {
        if (tuner.blank()) linkStats.error(Date.now(), "blank");
        return tuner.spent ? frame : null;
      }
      tuner.good();
      return frame;
    } catch {
      return miss("no_frames");
    } finally {
      pic.done?.();
    }
  };
}

/**
 * Send this terminal's camera while it is placed and the feed is on. Holds
 * the page's camera (the scanner's stream) the whole time.
 */
export function useCamFeed(config: TerminalConfig | null, hub: CameraHub = pageCamera): void {
  const on = config !== null && feedWanted(config);
  const eventId = config?.eventId ?? "";
  const token = config?.token ?? "";
  const spot = config?.spot.trim() ?? "";
  const facing = config?.camera ?? "user";
  const view = config?.view ?? "auto";
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!on) {
      feedStatus.set({ kind: "off" });
      return;
    }
    let alive = true;
    let stop: (() => void) | null = null;
    let retry = 0;
    let unfollow: (() => void) | null = null;
    let touchAgain: (() => void) | null = null;
    const tuner = new FeedTuner(imageCaptureCtor() !== null);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    // In the page (a pixel, invisible): Safari stops decoding a detached video's frames.
    video.setAttribute("aria-hidden", "true");
    video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;";
    document.body.appendChild(video);
    feedStatus.set({ kind: "waiting" });
    linkStats.setFeeding(true);
    const waiting = window.setTimeout(() => linkStats.hold("cam_waiting"), FEED_CAMERA_WAIT_MS);
    void hub.acquire(facing).then((stream) => {
      window.clearTimeout(waiting);
      if (!alive) return;
      linkStats.hold(null);
      if (stream === null) {
        const state = hub.snapshot.state;
        // The TV's Desktop has no camera, and that's no fault of the TV's.
        if (view === "tv" && state === "none") linkStats.setFeeding(false);
        else linkStats.hold(cameraError(state));
        if (cameraRetryable(state)) {
          feedStatus.set({ kind: "retrying", problem: `the camera failed to open (${state})` });
          retry = window.setTimeout(() => setAttempt((n) => n + 1), FEED_CAMERA_RETRY_MS);
        } else {
          feedStatus.set({ kind: "stopped", problem: `no camera (${state})` });
          // A prompt nobody answered reads as refused: a touch asks again.
          if (state === "denied") {
            touchAgain = () => setAttempt((n) => n + 1);
            window.addEventListener("pointerdown", touchAgain, { once: true });
          }
        }
        return;
      }
      video.srcObject = stream;
      void video.play().catch(() => {});
      // The hub reopens a camera whose track ended: follow it to the new stream.
      unfollow = hub.subscribe(() => {
        const next = hub.snapshot.stream;
        if (!alive || next === null || video.srcObject === next) return;
        video.srcObject = next;
        void video.play().catch(() => {});
      });
      const url = `${baseOf({ eventId })}/api/mod/spatial/cam`;
      stop = runFeed({
        capture: frameGrabber(video, () => hub.snapshot.stream, tuner),
        post: (f) =>
          fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify({ spot, jpeg: f.jpeg, w: f.w, h: f.h }) }).then(
            async (r): Promise<FeedReply> => {
              if (r.ok) linkStats.sent(Date.now(), { w: f.w, h: f.h, bytes: base64Bytes(f.jpeg) });
              else if (feedOutcome(r.status) === "stop") linkStats.hold(feedError(r.status));
              else linkStats.error(Date.now(), feedError(r.status));
              return { status: r.status, watched: r.ok ? watchedOf(await r.json().catch(() => null)) : undefined };
            },
            (): FeedReply => {
              linkStats.error(Date.now(), feedError(null));
              return { status: null };
            },
          ),
        pace: (ms) => tuner.gap(ms),
        hidden: () => document.hidden,
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (t) => window.clearTimeout(t as number),
        onStatus: (s) => alive && feedStatus.set(s),
      });
    });
    return () => {
      alive = false;
      window.clearTimeout(waiting);
      window.clearTimeout(retry);
      if (touchAgain !== null) window.removeEventListener("pointerdown", touchAgain);
      unfollow?.();
      stop?.();
      video.srcObject = null;
      video.remove();
      hub.release();
      feedStatus.set({ kind: "off" });
      linkStats.setFeeding(false);
      linkStats.hold(null);
    };
  }, [on, eventId, token, spot, facing, view, hub, attempt]);
}
