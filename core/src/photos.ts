//! The terminals' photos (wave 59p, `docs/loom-w59-photos-contract.md`): what the
//! server, the terminals and both panels share. Browser-safe. The stills
//! themselves never leave `server/photos.ts` but through the routes in
//! `server/routes/photos.ts`: directors and hosts only.

/** A terminal takes one still this often, while armed. */
export const PHOTO_EVERY_MS = 15_000;
/** The event's photos stop here. */
export const PHOTO_CAP_BYTES = 3 * 1024 ** 3;

/** What a terminal says on its heartbeat (`ph=`) while armed. Absent: not
 *  armed, not a photo terminal, or a build from before this. */
export const PHOTO_REPORTS = ["ok", "camera", "hidden", "picture", "upload"] as const;
export type PhotoReport = (typeof PHOTO_REPORTS)[number];

export function isPhotoReport(v: unknown): v is PhotoReport {
  return typeof v === "string" && (PHOTO_REPORTS as readonly string[]).includes(v);
}

/** Why the server has stopped keeping photos. */
export type PhotosStop = "cap" | "disk";

/** One terminal on the panel. */
export interface PhotoTerminal {
  spot: string;
  name: string;
  count: number;
  bytes: number;
  /** When the server took its last still (server ms); null: none yet. */
  lastAt: number | null;
  /** Why a terminal that should be shooting isn't (only while armed). */
  note: string | null;
  /** When it shoots at all, if not whenever armed: the Server Room's `PHOTO_HEART_ONLY`. */
  only?: string;
}

/** `GET /api/mod/photos`. */
export interface PhotosView {
  armed: boolean;
  /** When it was last armed or disarmed (server ms); null: never. */
  since: number | null;
  /** Server ms. */
  now: number;
  count: number;
  bytes: number;
  capBytes: number;
  stopped: PhotosStop | null;
  /** A disarm that couldn't be written: safe now, armed again by a restart. */
  unsaved?: boolean;
  terminals: PhotoTerminal[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A view off the wire; null for anything else (an older server's 404 body). */
export function photosViewOf(raw: unknown): PhotosView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const now = num(r["now"]);
  if (typeof r["armed"] !== "boolean" || now === null || !Array.isArray(r["terminals"])) return null;
  const terminals: PhotoTerminal[] = [];
  for (const row of r["terminals"] as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const t = row as Record<string, unknown>;
    if (typeof t["spot"] !== "string") continue;
    terminals.push({
      spot: t["spot"],
      name: typeof t["name"] === "string" ? t["name"] : t["spot"],
      count: num(t["count"]) ?? 0,
      bytes: num(t["bytes"]) ?? 0,
      lastAt: num(t["lastAt"]),
      note: typeof t["note"] === "string" ? t["note"] : null,
      ...(typeof t["only"] === "string" ? { only: t["only"] } : {}),
    });
  }
  return {
    armed: r["armed"],
    since: num(r["since"]),
    now,
    count: num(r["count"]) ?? 0,
    bytes: num(r["bytes"]) ?? 0,
    capBytes: num(r["capBytes"]) ?? PHOTO_CAP_BYTES,
    stopped: r["stopped"] === "cap" || r["stopped"] === "disk" ? r["stopped"] : null,
    ...(r["unsaved"] === true ? { unsaved: true } : {}),
    terminals,
  };
}

/** 1.2 GB, 340 MB, 12 KB. */
export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

/** "12 s ago", "4 min ago", "2 h ago" ("never" for none). */
export function photoAgo(now: number, at: number | null): string {
  if (at === null) return "never";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 90) return `${s} s ago`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

// --- the panels' words: DRAFT w59p -----------------------------------------

/** The Server Room's row: it shoots only while a program is at his heart. */
export const PHOTO_HEART_ONLY = "only at the heart";

/** A disarm that couldn't be written (the route's refusal, and the panel's line until it is). */
export const PHOTO_UNSAVED_LINE = "Safe now, but the server couldn't save that: a restart would arm the photos again.";

/** An arm that couldn't be written: nothing changed. */
export const PHOTO_ARM_FAILED = "The server couldn't save that, so the photos are still safe.";

/** The big state. */
export function photosState(v: Pick<PhotosView, "armed">): string {
  return v.armed ? "ARMED" : "SAFE";
}

/** The line under it. */
export function photosSummary(v: Pick<PhotosView, "count" | "bytes" | "capBytes">): string {
  return `${v.count} photo${v.count === 1 ? "" : "s"} · ${formatBytes(v.bytes)} of ${formatBytes(v.capBytes)}`;
}

/** The disarm that didn't reach the disk, or null. */
export function photosUnsavedLine(v: Pick<PhotosView, "unsaved">): string | null {
  return v.unsaved === true ? PHOTO_UNSAVED_LINE : null;
}

/** Why nothing is being kept, or null. */
export function photosStopLine(v: Pick<PhotosView, "stopped" | "capBytes">): string | null {
  if (v.stopped === "cap") return `Stopped: the ${formatBytes(v.capBytes)} cap is reached. Download them and delete them on Run → Terminals to carry on.`;
  if (v.stopped === "disk") return "Stopped: the server's disk is nearly full. Nothing more is being kept.";
  return null;
}
