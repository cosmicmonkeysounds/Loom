//! How this terminal's photos are going (wave 59p), for the heartbeat (`ph=`) and
//! one line in ⚙. Nothing else on the terminal shows it: the photos are invisible
//! by design. Apart from `photos.ts`, so the base of the heartbeat imports no camera.

import { useSyncExternalStore } from "react";
import type { PhotoReport } from "../../core/src/photos.ts";

class PhotoStatus {
  /** Null: not armed, or a terminal that takes none. */
  report: PhotoReport | null = null;
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  set(r: PhotoReport | null): void {
    if (r === this.report) return;
    this.report = r;
    for (const fn of this.listeners) fn();
  }
}

export const photoStatus = new PhotoStatus();

export function usePhotoStatus(): PhotoReport | null {
  return useSyncExternalStore(photoStatus.subscribe, () => photoStatus.report);
}

/** ⚙'s line (DRAFT w59p). */
export function photoStatusText(r: PhotoReport): string {
  switch (r) {
    case "ok":
      return "photos armed — one every 15 s";
    case "camera":
      return "photos armed — no camera here";
    case "hidden":
      return "photos armed — waiting, this page is hidden";
    case "picture":
      return "photos armed — no picture from the camera yet";
    case "upload":
      return "photos armed — they aren't getting through";
  }
}
