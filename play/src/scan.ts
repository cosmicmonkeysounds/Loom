//! What a booth scan means. A guest's **pass** (their "Your pass" sheet,
//! or the `show pass` card) is a QR of their guest id — `g-3f9a1c` (a
//! persona spawned from the editor is `p-…`). The walls also carry the
//! join QR (`…/?code=<event>`), the codex QRs (`…&unlock=<code>`) and the
//! room check-in signs (`…&checkin=<room>`, K-13); a
//! booth recognises those so the performer hears "that's a wall code"
//! instead of a bare 404. Mirrors `terminal/src/scan.ts`.
//!
//! Pure — the camera lives in `scanner.tsx`.

export type ScanHit =
  | { kind: "guest"; id: string }
  | { kind: "wall"; unlock: string | null; checkin?: string }
  | { kind: "unknown"; text: string };

/** A guest / persona id as the server mints them. */
const GUEST_ID = /^[gp]-[0-9a-f]{6}$/i;

export function parseScan(raw: string): ScanHit {
  const text = raw.trim();
  if (text === "") return { kind: "unknown", text };
  if (GUEST_ID.test(text)) return { kind: "guest", id: text.toLowerCase() };
  try {
    const url = new URL(text);
    if (url.searchParams.has("code")) {
      const checkin = url.searchParams.get("checkin");
      return checkin !== null ? { kind: "wall", unlock: null, checkin } : { kind: "wall", unlock: url.searchParams.get("unlock") };
    }
    const id = url.searchParams.get("pass") ?? url.searchParams.get("guest");
    if (id !== null && GUEST_ID.test(id)) return { kind: "guest", id: id.toLowerCase() };
  } catch {
    /* not a URL */
  }
  return { kind: "unknown", text };
}

/**
 * What a *typed* id should be sent as: a well-formed id is normalised
 * (case, stray spaces — phone keyboards capitalise the first letter),
 * anything else goes through as typed so the server's own answer stands.
 */
export function typedTarget(raw: string): string {
  const hit = parseScan(raw);
  return hit.kind === "guest" ? hit.id : raw.trim();
}

/** The words a performer sees for a scan that wasn't a pass. */
export function scanProblem(hit: ScanHit): string | null {
  switch (hit.kind) {
    case "guest":
      return null;
    case "wall":
      if (hit.checkin !== undefined) return "That's a room sign — scan the guest's pass.";
      return hit.unlock !== null ? "That's a codex code from the wall — scan the guest's pass." : "That's the join code — scan the guest's pass.";
    case "unknown":
      return "That QR isn't a guest pass.";
  }
}

/**
 * Report a code once, then ignore it for `windowMs` so a pass held up to
 * the lens doesn't re-fire — but a *different* pass scans at once, so a
 * door queue goes pass after pass with the camera left on.
 */
export function repeatGate(windowMs: number, now: () => number = Date.now): (text: string) => boolean {
  const seen = new Map<string, number>();
  return (text) => {
    const t = now();
    const last = seen.get(text);
    if (last !== undefined && t - last < windowMs) return false;
    seen.set(text, t);
    return true;
  };
}

export type CameraState = "off" | "starting" | "live" | "insecure" | "denied" | "none" | "error";

/** Map a `getUserMedia` failure to a camera state. */
export function cameraFailure(name: string): CameraState {
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "none";
  return "error";
}

/** Why the camera isn't running, in words a performer at the door can act on. */
export function cameraProblem(state: CameraState): string | null {
  switch (state) {
    case "insecure":
      return "The camera needs a secure address (https://) — type the id.";
    case "denied":
      return "Camera permission was refused — allow it in Settings › Safari › Camera (or the browser's site settings), then try again. Meanwhile type the id.";
    case "none":
      return "No camera on this device — type the id.";
    case "error":
      return "The camera couldn't start — type the id.";
    default:
      return null;
  }
}

/** The size to decode a frame at with jsQR: ≤ 640 px wide, plenty for a phone-screen QR. */
export function decodeSize(width: number, height: number, max = 640): { width: number; height: number } {
  const scale = width > 0 ? Math.min(1, max / width) : 1;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
