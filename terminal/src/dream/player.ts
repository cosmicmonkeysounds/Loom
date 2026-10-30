//! The page's one dream player (wave 50). One `<video>` for the page's whole
//! life, armed when the story turns the dream on and handed from view to view
//! (`hold`): a wall swapping its asleep screen for its awake one keeps its
//! place and its buffer, and the mosh draws from the same element. It plays
//! muted, so it needs no gesture; the file has no sound anyway.
//!
//! It keeps itself alive. A terminal's place is worked out from the server's
//! clock (`dreamPositionS`), so nothing here has to be remembered: a stalled
//! video is simply reloaded at its place, and after `DREAM_VIDEO_TRIES`
//! failures (or at once, if the browser refuses to autoplay it) the page falls
//! back to the JPEG frames the games use, three a second and a tenth the
//! bytes. If those fail too it is `failed`, and the terminal keeps its old
//! idle show (`dreamPhase` never leaves `armed`). Every `DREAM_RETRY_MS` a
//! fallback tries the video again beside itself: it takes over only by
//! really playing (the clock moving: a seek's `timeupdate` proves nothing).
//!
//! A view that goes away (a line opens, a game starts) parks it; after
//! `DREAM_PARK_MS` with no view it pauses, so a screen in use costs no video,
//! and a screen busy when it is armed stops after `DREAM_ARM_KEEP_MS`.
//! Reduced motion: one frame every `DREAM_STILL_MS`.

import { DREAM_FRAME_FPS, DREAM_MEDIA, dreamFrameIndex, dreamFrameName, dreamPositionS } from "@loom/house";
import { dreamSrc } from "./dream.ts";

/** A video that won't play gives way to the frames after this many tries. */
export const DREAM_VIDEO_TRIES = 3;
/** The frames give up after this many misses in a row. */
export const DREAM_FRAME_TRIES = 6;
/** A frame not here in this long is a miss (ms). One loads at a time: a new
 *  `src` cancels a load with no event, so slow wifi would never land any. */
export const DREAM_FRAME_WAIT_MS = 3000;
/** A video that hasn't moved in this long has stalled (ms). */
export const DREAM_STALL_MS = 9000;
/** How long a fallback runs before the video is tried again (ms). */
export const DREAM_RETRY_MS = 60_000;
/** With no view on screen, it plays on this long before pausing (ms). */
export const DREAM_PARK_MS = 20_000;
/** Armed with no view yet, it readies this long: past the takeover (ms). */
export const DREAM_ARM_KEEP_MS = 60_000;
/** The video has played once its clock has moved this far (s). */
export const DREAM_MOVED_S = 0.25;
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

export type DreamEvent = "playing" | "video-failed" | "video-refused" | "frame-ok" | "frame-failed" | "retry";

export const DREAM_FRESH: DreamHealth = { mode: "video", ready: false, videoFails: 0, frameFails: 0 };

/** What an event does to the player's health (pure). */
export function dreamHealthAfter(h: DreamHealth, e: DreamEvent): DreamHealth {
  switch (e) {
    case "playing":
      return { mode: "video", ready: true, videoFails: 0, frameFails: 0 };
    case "video-failed": {
      const videoFails = h.videoFails + 1;
      // A trial beside a fallback that didn't work: the fallback stands.
      if (h.mode !== "video") return { ...h, videoFails };
      return videoFails >= DREAM_VIDEO_TRIES ? { ...h, mode: "frames", videoFails } : { ...h, videoFails };
    }
    case "video-refused":
      // The browser won't autoplay it: no reload changes that.
      return { ...h, mode: h.mode === "video" ? "frames" : h.mode, videoFails: DREAM_VIDEO_TRIES };
    case "frame-ok":
      return h.mode === "frames" ? { ...h, ready: true, frameFails: 0 } : h;
    case "frame-failed": {
      const frameFails = h.frameFails + 1;
      return frameFails >= DREAM_FRAME_TRIES ? { ...h, mode: "failed", ready: false, frameFails } : { ...h, frameFails };
    }
    case "retry":
      // The video on trial, one try, beside the frames: they keep running
      // (again, after `failed`) until it proves itself with `playing`.
      return { ...h, mode: "frames", videoFails: DREAM_VIDEO_TRIES - 1, frameFails: 0 };
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
  /** When the frame on its way was asked for; null: none is. */
  private frameSince: number | null = null;
  private frameShown = 0;
  private stillAt = 0;
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
    if (e !== "video-failed" && e !== "video-refused") return;
    if (this.health.mode === "video") this.loadVideo();
    else {
      this.dropVideo();
      this.retryAt = performance.now() + DREAM_RETRY_MS;
    }
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
    img.onload = () => {
      this.frameSince = null;
      this.report("frame-ok");
    };
    img.onerror = () => {
      this.frameSince = null;
      this.report("frame-failed");
    };
    stage.appendChild(img);
    document.body.appendChild(stage);
    this.stage = stage;
    this.img = img;
    this.health = DREAM_FRESH;
    this.parkAt = performance.now() + DREAM_ARM_KEEP_MS;
    this.frameSince = null;
    this.frameShown = 0;
    this.stillAt = 0;
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
    v.onloadedmetadata = v.onseeked = v.ontimeupdate = v.onerror = null;
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
    // Where its clock stood when the seek landed: only moving on from there
    // counts. A seek ending fires `timeupdate` too, paused or not.
    let from = Number.POSITIVE_INFINITY;
    v.onloadedmetadata = () => {
      v.currentTime = dreamPositionS(o.key, this.arm_?.now() ?? o.now());
      this.play(v);
    };
    v.onseeked = () => {
      from = v.currentTime;
    };
    v.ontimeupdate = () => {
      if (v.paused || v.seeking || v.currentTime - from < DREAM_MOVED_S) return;
      const h = this.health;
      if (h.mode !== "video" || !h.ready || h.videoFails > 0) this.report("playing");
    };
    v.onerror = () => this.report("video-failed");
    // Over the frame: a trial stays hidden until it plays (`data-mode`).
    this.stage.appendChild(v);
    this.video = v;
    v.src = dreamSrc(o.target);
    this.lastTime = -1;
    this.movedAt = performance.now();
  }

  private play(v: HTMLVideoElement): void {
    void v.play()?.catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name === "NotAllowedError" && v === this.video) this.report("video-refused");
    });
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
    this.play(v);
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
    const v = this.video;
    if (v !== null) {
      if (!wanted) {
        if (!v.paused) v.pause();
      } else if (v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        this.movedAt = now;
      } else if (now - this.movedAt > DREAM_STALL_MS) {
        this.movedAt = now;
        this.report("video-failed");
      }
    }
    if (this.health.mode === "video") return;
    if (!o.reduced && now >= this.retryAt) {
      this.report("retry");
      this.loadVideo();
    }
    if (this.health.mode === "frames" && wanted) this.stepFrame(o, now);
  };

  /** The frame for now, one at a time, and a miss if it never comes. */
  private stepFrame(o: DreamArm, now: number): void {
    const img = this.img;
    if (img === null) return;
    if (this.frameSince !== null) {
      if (now - this.frameSince < DREAM_FRAME_WAIT_MS) return;
      this.frameSince = null;
      this.report("frame-failed");
      if (this.health.mode !== "frames") return;
    }
    if (o.reduced && now < this.stillAt) return;
    const n = dreamFrameIndex(o.key, o.now());
    if (n === this.frameShown) return;
    this.frameShown = n;
    this.stillAt = now + DREAM_STILL_MS;
    this.frameSince = now;
    img.src = `${DREAM_MEDIA}/frames/${dreamFrameName(n)}`;
  }

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
