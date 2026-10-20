//! The camera feed (wave 14): a placed terminal sends a small, frequent JPEG
//! of its own camera to the event (`POST /api/mod/spatial/cam {spot, jpeg,
//! w, h}`, its mod token), and the reinstallation games hang that picture on
//! the wall where this tablet hangs — a window from the virtual house into
//! the real room.
//!
//! ~3 frames a second at 160 × 120 (a 4:3 centre crop of the camera, JPEG
//! quality 0.5 — a few KB each), drawn off the page's one camera stream
//! (`camera.ts`, the scanner's), never while the page is hidden, never more
//! than one upload in flight. A failure backs off (1 s doubling to 30 s); a
//! 404 (`no such spot` — the map has no terminal by this id) stops the feed
//! until ⚙ changes the spot, and so does a revoked token. The image is sent
//! as the camera sees it (never mirrored).
//!
//! Old tablets (Chrome 87 / Safari 14): a plain `<canvas>` + `toDataURL`, no
//! `OffscreenCanvas`, no `createImageBitmap`.

import { useEffect, useSyncExternalStore } from "react";
import { baseOf, type TerminalConfig } from "./config.ts";
import { camera as pageCamera, type CameraHub } from "./camera.ts";

export const FEED_W = 160;
export const FEED_H = 120;
export const FEED_EVERY_MS = 333;
export const FEED_QUALITY = 0.5;
export const FEED_BACKOFF_MS = 1000;
export const FEED_BACKOFF_MAX_MS = 30_000;
/** The server refuses a frame over this (decoded bytes). */
export const FEED_MAX_BYTES = 96 * 1024;

/** Does this terminal send its camera? Only a placed one, and only while ⚙ leaves it on. */
export function feedWanted(c: Pick<TerminalConfig, "spot" | "camFeed">): boolean {
  return c.camFeed && c.spot.trim() !== "";
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
  | { kind: "sending"; at: number }
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
      return "camera feed live — the games show this room";
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

export function feedProblem(status: number | null): string {
  if (status === null) return "the server can't be reached";
  if (status === 404) return "no such spot in the event's house map — pick this terminal's spot in ⚙";
  if (status === 401 || status === 403) return "this terminal's access was refused";
  if (status === 413) return "the frame was too big";
  return `HTTP ${status}`;
}

export interface FeedFrame {
  jpeg: string;
  w: number;
  h: number;
}

export interface FeedDeps {
  /** A frame of the camera now, or null (no frame yet). */
  capture: () => FeedFrame | null;
  /** Send it; the HTTP status, or null when the server couldn't be reached. */
  post: (frame: FeedFrame) => Promise<number | null>;
  hidden: () => boolean;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  onStatus: (s: FeedStatus) => void;
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
    if (alive) timer = deps.setTimer(() => void tick(), ms);
  };
  const tick = async () => {
    timer = null;
    if (!alive) return;
    if (deps.hidden()) {
      status({ kind: "waiting" });
      next(FEED_EVERY_MS * 3);
      return;
    }
    const frame = deps.capture();
    if (frame === null) {
      status({ kind: "waiting" });
      next(FEED_EVERY_MS);
      return;
    }
    if (base64Bytes(frame.jpeg) > FEED_MAX_BYTES) {
      next(FEED_EVERY_MS);
      return;
    }
    const code = await deps.post(frame).catch(() => null);
    if (!alive) return;
    const outcome = feedOutcome(code);
    if (outcome === "ok") {
      backoff = 0;
      status({ kind: "sending", at: deps.now() });
      next(FEED_EVERY_MS);
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

/** Draws frames of a video into a 160 × 120 canvas. */
function videoCapture(video: HTMLVideoElement): () => FeedFrame | null {
  const canvas = document.createElement("canvas");
  canvas.width = FEED_W;
  canvas.height = FEED_H;
  const ctx = canvas.getContext("2d");
  return () => {
    if (ctx === null || video.readyState < 2 || video.videoWidth === 0) return null;
    const r = cropRect(video.videoWidth, video.videoHeight);
    try {
      ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, FEED_W, FEED_H);
      const jpeg = jpegBase64(canvas.toDataURL("image/jpeg", FEED_QUALITY));
      return jpeg === null ? null : { jpeg, w: FEED_W, h: FEED_H };
    } catch {
      return null;
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
  useEffect(() => {
    if (!on) {
      feedStatus.set({ kind: "off" });
      return;
    }
    let alive = true;
    let stop: (() => void) | null = null;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    feedStatus.set({ kind: "waiting" });
    void hub.acquire(facing).then((stream) => {
      if (!alive) return;
      if (stream === null) {
        feedStatus.set({ kind: "stopped", problem: `no camera (${hub.snapshot.state})` });
        return;
      }
      video.srcObject = stream;
      void video.play().catch(() => {});
      const url = `${baseOf({ eventId })}/api/mod/spatial/cam`;
      stop = runFeed({
        capture: videoCapture(video),
        post: (f) =>
          fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-loom-token": token }, body: JSON.stringify({ spot, jpeg: f.jpeg, w: f.w, h: f.h }) }).then(
            (r) => r.status,
            () => null,
          ),
        hidden: () => document.hidden,
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (t) => window.clearTimeout(t as number),
        onStatus: (s) => alive && feedStatus.set(s),
      });
    });
    return () => {
      alive = false;
      stop?.();
      video.srcObject = null;
      hub.release();
      feedStatus.set({ kind: "off" });
    };
  }, [on, eventId, token, spot, facing, hub]);
}
