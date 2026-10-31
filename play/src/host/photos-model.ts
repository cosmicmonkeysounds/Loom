//! The Desk's 📷 Terminal photos, the pure part (wave 59p,
//! `docs/loom-w59-photos-contract.md`). Words: DRAFT w59p (the shared ones are in
//! `core/src/photos.ts`).

import { photosViewOf, type PhotosView } from "../../../core/src/photos.ts";

export const PHOTOS_PATH = "/api/mod/photos";
export const PHOTO_THUMB_PATH = "/api/mod/photos/thumb";
/** The panel's poll. */
export const PHOTOS_POLL_MS = 5000;
export const PHOTOS_TIMEOUT_MS = 8000;
/** A thumbnail is the real still, so one a terminal this often is plenty on a phone. */
export const THUMB_EVERY_MS = 30_000;

export const NOT_PHOTOS = "This server takes no photos yet.";
export const PHOTOS_UNREACHED = "Can't reach the server";

export type PhotosPoll = { kind: "view"; view: PhotosView } | { kind: "error"; message: string };

/** What one poll's answer means. */
export function photosPollOutcome(status: number, body: unknown): PhotosPoll {
  const message = typeof (body as { error?: unknown } | null)?.error === "string" ? (body as { error: string }).error : `HTTP ${status}`;
  if (status === 403) return { kind: "error", message: "This booth isn't a host any more." };
  if (status === 404) return { kind: "error", message: NOT_PHOTOS };
  if (status < 200 || status >= 300) return { kind: "error", message };
  const view = photosViewOf(body);
  return view === null ? { kind: "error", message: NOT_PHOTOS } : { kind: "view", view };
}

/** What a press on the big button says it does. */
export function armHint(armed: boolean): string {
  return armed ? "Press to make safe" : "Press to arm";
}

/** Should the thumbnail be fetched? A new still, and not too soon after the last fetch. */
export function thumbDue(shown: { lastAt: number; fetchedAt: number } | null, lastAt: number | null, now: number): boolean {
  if (lastAt === null) return false;
  if (shown === null) return true;
  return lastAt !== shown.lastAt && now - shown.fetchedAt >= THUMB_EVERY_MS;
}
