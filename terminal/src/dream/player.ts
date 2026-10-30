//! The page's one dream player (wave 50). One `<video>` for the page's whole
//! life, armed when the story turns the dream on and handed from view to view
//! (`hold`): a wall swapping its asleep screen for its awake one keeps its
//! place and its buffer, and the mosh draws from the same element. It plays
//! muted, so it needs no gesture; the file has no sound anyway.
//!
//! It keeps itself alive. A terminal's place is worked out from the server's
//! clock (`dreamPositionS`), so nothing here has to be remembered: a stalled
//! video is simply reloaded at its place, and after `DREAM_VIDEO_TRIES`
//! failures the page falls back to the JPEG frames the games use, three a
//! second and a tenth the bytes. If those fail too it is `failed`, and the
//! terminal keeps its old idle show (`dreamPhase` never leaves `armed`); both
//! are tried again every `DREAM_RETRY_MS`.
//!
//! A held view that goes away (a line opens, a game starts) parks it; after
//! `DREAM_PARK_MS` with no view it pauses, so a screen in use costs no video.
//! Reduced motion: one frame every `DREAM_STILL_MS`.

import { DREAM_FRAME_FPS, DREAM_MEDIA, dreamFrameIndex, dreamFrameName, dreamPositionS } from "@loom/house";
import { dreamSrc } from "./dream.ts";

/** A video that won't play gives way to the frames after this many tries. */
export const DREAM_VIDEO_TRIES = 3;
/** The frames give up after this many misses in a row. */
export const DREAM_FRAME_TRIES = 9;
/** A video that hasn't moved in this long has stalled (ms). */
export const DREAM_STALL_MS = 9000;
/** How long a fallback runs before the video is tried again (ms). */
export const DREAM_RETRY_MS = 60_000;
/** With no view on screen, it plays on this long before pausing (ms). */
export const DREAM_PARK_MS = 20_000;
/** Back from a pause, it seeks only when this far off its place (s). */
export const DREAM_DRIFT_S = 4;
/** Reduced motion: a still this often (ms). */
export const DREAM_STILL_MS = 10_000;

export type DreamMode = "video" | "frames" | "failed";

export interface DreamHealth {
  mode: DreamMode;
  /** There is a picture to show. */
  ready: boolean;
  videoFails: number;
  frameFails: number;
}

export type DreamEvent = "playing" | "video-failed" | "frame-ok" | "frame-failed" | "retry";

export const DREAM_FRESH: DreamHealth = { mode: "video", ready: false, videoFails: 0, frameFails: 0 };

/** What an event does to the player's health (pure). */
export function dreamHealthAfter(h: DreamHealth, e: DreamEvent): DreamHealth {
  switch (e) {
    case "playing":
      return { mode: "video", ready: true, videoFails: 0, frameFails: 0 };
    case "video-failed": {
      const videoFails = h.videoFails + 1;
      return videoFails >= DREAM_VIDEO_TRIES ? { ...h, mode: "frames", videoFails } : { ...h, videoFails };
    }
    case "frame-ok":
      return h.mode === "frames" ? { ...h, ready: true, frameFails: 0 } : h;
    case "frame-failed": {
      const frameFails = h.frameFails + 1;
      return frameFails >= DREAM_FRAME_TRIES ? { ...h, mode: "failed", ready: false, frameFails } : { ...h, frameFails };
    }
    case "retry":
      // A picture in hand (the frames) stays up until the video proves itself.
      return { ...h, mode: "video", videoFails: 0, frameFails: 0 };
  }
}

export interface DreamArm {
  key: string;
  target: "tv" | "wall";
  reduced: boolean;
  /** The server's clock. */
  now: () => number;
}

class DreamPlayer {
  private arm_: DreamArm | null = null;
  private stage: HTMLDivElement | null = null;
  private video: HTMLVideoElement | null = null;
  private img: HTMLImageElement | null = null;
  private health = DREAM_FRESH;
  private holds = 0;
  private keeps = 0;
  private parkAt: number | null = null;
  private ticker = 0;
  private lastTime = -1;
  private movedAt = 0;
  private frameAt = 0;
  private retryAt = 0;
  private readonly listeners = new Set<() => void>();

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  /** Is there a picture of the dream to show? */
  ready = (): boolean => this.health.ready;

  /** What the mosh bleeds in: the video, or the frame on show. Null: nothing yet. */
  source(): HTMLVideoElement | HTMLImageElement | null {
    if (this.health.mode === "video" && this.video !== null && this.video.readyState >= 2) return this.video;
    if (this.img !== null && this.img.complete && this.img.naturalWidth > 0) return this.img;
    return null;
  }

  private report(e: DreamEvent): void {
    const was = this.health;
    this.health = dreamHealthAfter(was, e);
    if (this.stage !== null) this.stage.dataset["mode"] = this.health.mode;
    if (was.ready !== this.health.ready) for (const l of [...this.listeners]) l();
    if (e === "video-failed") this.health.mode === "video" ? this.loadVideo() : this.dropVideo();
    if (this.health.mode !== "video" && was.mode === "video") this.retryAt = performance.now() + DREAM_RETRY_MS;
  }

  /** The story turned the dream on: ready the picture now, hidden. */
  arm(o: DreamArm): void {
    const was = this.arm_;
    if (was !== null && was.key === o.key && was.target === o.target && was.reduced === o.reduced) {
      this.arm_ = o;
      return;
    }
    this.disarm();
    this.arm_ = o;
    const stage = document.createElement("div");
    stage.className = "dream-stage dream-parked";
    stage.dataset["mode"] = "video";
    const img = document.createElement("img");
    img.alt = "";
    img.className = "dream-frame";
    img.onload = () => this.report("frame-ok");
    img.onerror = () => this.report("frame-failed");
    stage.appendChild(img);
    document.body.appendChild(stage);
    this.stage = stage;
    this.img = img;
    this.health = DREAM_FRESH;
    this.parkAt = null;
    if (o.reduced) {
      this.health = { ...DREAM_FRESH, mode: "frames" };
      stage.dataset["mode"] = "frames";
    } else this.loadVideo();
    this.movedAt = performance.now();
    this.ticker = window.setInterval(this.tick, 1000 / DREAM_FRAME_FPS);
    document.addEventListener("visibilitychange", this.onVisibility);
    for (const l of [...this.listeners]) l();
  }

  /** The dream is off: everything goes. */
  disarm(): void {
    if (this.arm_ === null) return;
    window.clearInterval(this.ticker);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.dropVideo();
    this.stage?.remove();
    this.stage = null;
    this.img = null;
    this.arm_ = null;
    this.health = DREAM_FRESH;
    this.holds = 0;
    this.keeps = 0;
    for (const l of [...this.listeners]) l();
  }

  private dropVideo(): void {
    const v = this.video;
    if (v === null) return;
    v.onloadedmetadata = v.onplaying = v.ontimeupdate = v.onerror = null;
    v.pause();
    v.removeAttribute("src");
    v.load();
    v.remove();
    this.video = null;
  }

  private loadVideo(): void {
    const o = this.arm_;
    if (o === null || this.stage === null) return;
    this.dropVideo();
    const v = document.createElement("video");
    v.className = "dream-video";
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("playsinline", "");
    v.setAttribute("muted", "");
    v.preload = "auto";
    v.onloadedmetadata = () => {
      v.currentTime = dreamPositionS(o.key, this.arm_?.now() ?? o.now());
      void v.play()?.catch(() => {});
    };
    v.ontimeupdate = () => {
      if (v.readyState >= 2 && !v.seeking && !this.health.ready) this.report("playing");
      else if (v.readyState >= 2 && !v.seeking && this.health.mode === "video" && this.health.videoFails > 0) this.report("playing");
    };
    v.onerror = () => this.report("video-failed");
    // Over the frame: with no picture yet it is see-through, so a retry never blacks out.
    this.stage.appendChild(v);
    this.video = v;
    v.src = dreamSrc(o.target);
    this.lastTime = -1;
    this.movedAt = performance.now();
  }

  private wanted(): boolean {
    return this.holds + this.keeps > 0 || this.parkAt === null || performance.now() < this.parkAt;
  }

  private resume(): void {
    const v = this.video;
    const o = this.arm_;
    if (v === null || o === null || !v.paused || v.readyState < 1) return;
    const at = dreamPositionS(o.key, o.now());
    if (Math.abs(v.currentTime - at) > DREAM_DRIFT_S) v.currentTime = at;
    this.movedAt = performance.now();
    void v.play()?.catch(() => {});
  }

  private readonly onVisibility = (): void => {
    if (document.hidden) this.video?.pause();
    else if (this.wanted()) this.resume();
  };

  private readonly tick = (): void => {
    const o = this.arm_;
    if (o === null || document.hidden) return;
    const now = performance.now();
    const wanted = this.wanted();
    if (this.health.mode === "video") {
      const v = this.video;
      if (v === null) return;
      if (!wanted) {
        if (!v.paused) v.pause();
        return;
      }
      if (v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.movedAt = now;
      } else if (now - this.movedAt > DREAM_STALL_MS) {
        this.movedAt = now;
        this.report("video-failed");
      }
      return;
    }
    if (this.health.mode === "failed" || !o.reduced) {
      if (now >= this.retryAt && !o.reduced) {
        this.report("retry");
        this.loadVideo();
        return;
      }
    }
    if (this.health.mode === "frames" && wanted && now >= this.frameAt && this.img !== null) {
      this.frameAt = now + (o.reduced ? DREAM_STILL_MS : 1000 / DREAM_FRAME_FPS);
      this.img.src = `${DREAM_MEDIA}/frames/${dreamFrameName(dreamFrameIndex(o.key, o.now()))}`;
    }
  };

  /** Show the dream in `host`. Returns the release. */
  hold(host: HTMLElement): () => void {
    const stage = this.stage;
    if (stage === null) return () => {};
    this.holds += 1;
    this.parkAt = null;
    stage.classList.remove("dream-parked");
    host.appendChild(stage);
    this.resume();
    return () => {
      this.holds = Math.max(0, this.holds - 1);
      if (this.stage !== stage || stage.parentElement !== host) return;
      stage.classList.add("dream-parked");
      document.body.appendChild(stage);
      if (this.holds + this.keeps === 0) this.parkAt = performance.now() + DREAM_PARK_MS;
      this.resume();
    };
  }

  /** Keep it playing with no view (the mosh draws from it). Returns the release. */
  keep(): () => void {
    this.keeps += 1;
    this.parkAt = null;
    this.resume();
    return () => {
      this.keeps = Math.max(0, this.keeps - 1);
      if (this.holds + this.keeps === 0) this.parkAt = performance.now() + DREAM_PARK_MS;
    };
  }
}

/** The page's one player. */
export const dreamPlayer = new DreamPlayer();

// --- his face on the TV -------------------------------------------------------------

let speaking = false;
const speakers = new Set<() => void>();

/** The TV: he is speaking, and his face has come through the dream. */
export function setDreamSpeaking(on: boolean): void {
  if (on === speaking) return;
  speaking = on;
  for (const l of [...speakers]) l();
}
export const dreamSpeaking = (): boolean => speaking;
export function onDreamSpeaking(l: () => void): () => void {
  speakers.add(l);
  return () => void speakers.delete(l);
}
