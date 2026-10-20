//! The tablet's one camera (wave 14). The pass scanner and the camera feed
//! (`camfeed.ts`, the live picture the reinstallation games hang on this
//! terminal's wall) and the shadow view all read the same `MediaStream`:
//! an old tablet often can't open its camera twice, and two `getUserMedia`
//! calls would fight over it. The hub opens the stream on the first
//! `acquire`, hands every later caller (same facing mode) the same one, and
//! stops its tracks when the last holder releases it. A new facing mode
//! (⚙ changed the camera) reopens it for everyone.
//!
//! Always opened at the scanner's resolution — a pass reads at 720p, and the
//! feed and the shadow view scale the same frames down themselves.
//!
//! `getUserMedia` needs a secure context (`https://` or `localhost`).

import { useEffect, useState, useSyncExternalStore } from "react";

export type Facing = "user" | "environment";
export type CameraState = "starting" | "live" | "insecure" | "denied" | "none" | "error";

/** The camera's state after a `getUserMedia` refusal (by the error's name). */
export function cameraStateOfError(e: unknown): CameraState {
  const name = (e as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "none";
  return "error";
}

export interface CameraEnv {
  secure: boolean;
  getUserMedia: ((c: MediaStreamConstraints) => Promise<MediaStream>) | null;
}

function browserEnv(): CameraEnv {
  const secure = typeof window !== "undefined" && window.isSecureContext;
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return { secure, getUserMedia: typeof md?.getUserMedia === "function" ? (c) => md.getUserMedia(c) : null };
}

export function constraintsFor(facing: Facing): MediaStreamConstraints {
  return { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };
}

export interface CameraSnapshot {
  facing: Facing | null;
  state: CameraState;
  stream: MediaStream | null;
}

/** Ref-counted owner of the one stream. */
export class CameraHub {
  snapshot: CameraSnapshot = { facing: null, state: "starting", stream: null };
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

  private set(next: Partial<CameraSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const fn of this.listeners) fn();
  }

  /** Hold the camera (call `release` once for every `acquire`). Resolves to
   *  the shared stream, or null when the camera can't run (`snapshot.state` says why). */
  acquire(facing: Facing): Promise<MediaStream | null> {
    this.holders++;
    if (this.snapshot.facing !== facing) this.close();
    if (this.snapshot.stream !== null) return Promise.resolve(this.snapshot.stream);
    if (this.opening !== null && this.snapshot.facing === facing) return this.opening;
    return this.open(facing);
  }

  release(): void {
    this.holders = Math.max(0, this.holders - 1);
    if (this.holders === 0) this.close();
  }

  private open(facing: Facing): Promise<MediaStream | null> {
    const env = this.env();
    this.set({ facing, state: "starting", stream: null });
    if (!env.secure || env.getUserMedia === null) {
      this.set({ state: env.secure ? "none" : "insecure" });
      return Promise.resolve(null);
    }
    const p = env.getUserMedia(constraintsFor(facing)).then(
      (stream) => {
        if (this.opening !== p) {
          // Released (or the facing changed) while it opened.
          stream.getTracks().forEach((t) => t.stop());
          return this.snapshot.stream;
        }
        this.opening = null;
        if (this.holders === 0) {
          stream.getTracks().forEach((t) => t.stop());
          this.set({ state: "starting", stream: null, facing: null });
          return null;
        }
        this.set({ state: "live", stream });
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

  private close(): void {
    this.opening = null;
    this.snapshot.stream?.getTracks().forEach((t) => t.stop());
    if (this.snapshot.stream !== null || this.snapshot.facing !== null) this.set({ stream: null, facing: null, state: "starting" });
  }
}

/** The page's camera. */
export const camera = new CameraHub();

/** Hold the shared camera while `active`: its stream (null until live / when it can't run) and state. */
export function useCamera(facing: Facing, active: boolean, hub: CameraHub = camera): { stream: MediaStream | null; state: CameraState } {
  const snap = useSyncExternalStore(hub.subscribe, () => hub.snapshot);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active) return;
    setHeld(true);
    void hub.acquire(facing);
    return () => {
      setHeld(false);
      hub.release();
    };
  }, [facing, active, hub]);
  if (!active || !held || snap.facing !== facing) return { stream: null, state: "starting" };
  return { stream: snap.stream, state: snap.state };
}

/** Is the shared camera live right now (anyone holding it)? */
export function useCameraLive(hub: CameraHub = camera): boolean {
  return useSyncExternalStore(hub.subscribe, () => hub.snapshot.state === "live" && hub.snapshot.stream !== null);
}
