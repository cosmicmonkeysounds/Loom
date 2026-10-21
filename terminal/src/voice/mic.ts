//! The tablet's microphone (wave 19): its own audio-only `getUserMedia`,
//! never a track on the camera's stream — a refused or missing microphone
//! must not take the pass scanner and the camera feed down with it, and the
//! tent wizard shares `camera.ts` (`constraintsFor` stays video-only).
//!
//! Ref-counted like `CameraHub`: the first `acquire` opens it, later callers
//! get the same stream, the last `release` stops its tracks, and a track that
//! ends under us (the OS took the microphone back, the tablet slept) is
//! opened again for whoever still holds it.
//!
//! Echo cancellation, noise suppression and gain control are asked for, but
//! nothing relies on them (browsers don't cancel Web Audio or speech output):
//! the uplink gates itself in software (`capture.ts`).

import { useSyncExternalStore } from "react";
import { cameraStateOfError, type CameraEnv, type CameraState } from "../camera.ts";

export type MicState = CameraState;

export const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: false,
};

export interface MicSnapshot {
  state: MicState;
  stream: MediaStream | null;
}

function browserEnv(): CameraEnv {
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return { secure, getUserMedia: typeof md?.getUserMedia === "function" ? (c) => md.getUserMedia(c) : null };
}

/** Ref-counted owner of the one microphone stream. */
export class MicHub {
  snapshot: MicSnapshot = { state: "starting", stream: null };
  private holders = 0;
  private opening: Promise<MediaStream | null> | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly env: () => CameraEnv = browserEnv) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  get count(): number {
    return this.holders;
  }

  private set(next: Partial<MicSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const fn of this.listeners) fn();
  }

  /** Hold the microphone (one `release` per `acquire`): the shared stream,
   *  or null when it can't run (`snapshot.state` says why). */
  acquire(): Promise<MediaStream | null> {
    this.holders++;
    if (this.snapshot.stream !== null) return Promise.resolve(this.snapshot.stream);
    if (this.opening !== null) return this.opening;
    return this.open();
  }

  release(): void {
    this.holders = Math.max(0, this.holders - 1);
    // Still opening: it stops itself on landing if nobody holds it by then.
    if (this.holders === 0 && this.opening === null) this.close();
  }

  private open(): Promise<MediaStream | null> {
    const env = this.env();
    this.set({ state: "starting", stream: null });
    if (!env.secure || env.getUserMedia === null) {
      this.set({ state: env.secure ? "none" : "insecure" });
      return Promise.resolve(null);
    }
    const p = env.getUserMedia(MIC_CONSTRAINTS).then(
      (stream) => {
        if (this.opening !== p) {
          stream.getTracks().forEach((t) => t.stop());
          return this.snapshot.stream;
        }
        this.opening = null;
        if (this.holders === 0) {
          stream.getTracks().forEach((t) => t.stop());
          this.set({ state: "starting", stream: null });
          return null;
        }
        this.set({ state: "live", stream });
        this.watchEnd(stream);
        return stream;
      },
      (e: unknown) => {
        if (this.opening === p) {
          this.opening = null;
          this.set({ state: cameraStateOfError(e) });
        }
        return null;
      },
    );
    this.opening = p;
    return p;
  }

  private watchEnd(stream: MediaStream): void {
    const tracks = typeof stream.getAudioTracks === "function" ? stream.getAudioTracks() : [];
    for (const t of tracks) {
      t.addEventListener?.("ended", () => {
        if (this.snapshot.stream !== stream) return;
        stream.getTracks().forEach((x) => x.stop());
        this.set({ stream: null, state: "starting" });
        if (this.holders > 0 && this.opening === null) void this.open();
      });
    }
  }

  private close(): void {
    this.opening = null;
    this.snapshot.stream?.getTracks().forEach((t) => t.stop());
    if (this.snapshot.stream !== null || this.snapshot.state !== "starting") this.set({ stream: null, state: "starting" });
  }
}

/** The page's microphone. */
export const mic = new MicHub();

export function useMic(hub: MicHub = mic): MicSnapshot {
  return useSyncExternalStore(hub.subscribe, () => hub.snapshot);
}
