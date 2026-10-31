//! The "scan done" dialog (wave 18b, R1): a wall code or a room's sign read
//! in the app says it worked — "🔓 Code accepted", "📓 Already yours",
//! "📍 Checked in" — over the place it landed (the Codex on that entry, the
//! room). The app navigates first and the dialog sits on top (D26). A miss
//! or a refusal never gets the dialog: the 📷 sheet stays open with the
//! reason and the camera keeps reading.
//!
//! The answers are read by pure functions (`redeemOutcome`,
//! `checkinOutcome`, `scanErrorNote`; `test/scan-done.test.tsx`); the 📷
//! sheet, the Codex composer and the `?unlock=` / `?checkin=` links all
//! feed the one dialog through the session's `showScan`.

import { useEffect, useRef } from "react";
import { useVisible } from "./alerts.ts";
import { REDEEM_THROTTLED, TYPED_UNKNOWN } from "./codex.ts";

/** `/api/guest/codex/redeem`'s answer (the wave 18b fields are absent on an old server). */
export interface RedeemAnswer {
  /** The entry this code just unlocked, else null. */
  unlocked: string | null;
  /** The entry's title, for a hit and for `already`. */
  title?: string;
  /** The guest already held the code's entry (its id). */
  already?: string;
  /** The code unlocks nothing. */
  missed?: true;
  /** Spaced text that was no code (wave 59): no miss, nothing fired. */
  words?: true;
}

/** `/api/guest/checkin`'s answer (`room` / `replies` are wave 18b's). */
export interface CheckinAnswer {
  at: string;
  /** The room's chat (`loc:<at>`). */
  channel: string;
  /** False when the story kept the guest where they were. */
  moved: boolean;
  /** The LOCATION's label. */
  room?: string;
  /** The story's own lines to the guest from the check-in. */
  replies?: string[];
}

/** Where a done scan lands. */
export type ScanGo = { to: "codex"; entry: string } | { to: "room"; id: string };

/** One "scan done" dialog. `id` tells two of the same scan apart. */
export interface ScanDone {
  id: number;
  title: string;
  body: string;
  go: ScanGo;
}

/** A scan's outcome: the dialog (the sheet closes), or a line for the sheet (it stays). */
export type ScanOutcome = { done: Omit<ScanDone, "id"> } | { note: string };

export const SCAN_DONE_UNLOCK = "🔓 Code accepted";
export const SCAN_DONE_ALREADY = "📓 Already yours";
export const SCAN_DONE_CHECKIN = "📍 Checked in";
export const SCAN_MISSED = "⛔ That code unlocks nothing — check it and try again.";
export const SCAN_PAUSED = "⏸ The show is paused — try again in a moment.";
export const SCAN_FAILED = "⚠️ That didn't go through — check your connection and try again.";
/** The story kept the guest out and said nothing about it. */
export const CHECKIN_KEPT = "⛔ You can't check in there right now.";

/** How long the dialog stays up by itself, counting only visible time. */
export const SCAN_DONE_MS = 6_000;

function quoted(title: string): string {
  return `“${title}”`;
}

/** What a redeem's answer does: a hit or a code already held opens the
 *  Codex on its entry; a miss keeps the sheet open with a reason. */
export function redeemOutcome(r: RedeemAnswer): ScanOutcome {
  if (r.unlocked !== null && r.unlocked !== undefined) {
    const body = r.title ? `${quoted(r.title)} is in your Codex now.` : "A new entry is in your Codex now.";
    return { done: { title: SCAN_DONE_UNLOCK, body, go: { to: "codex", entry: r.unlocked } } };
  }
  if (r.already !== undefined) {
    const body = r.title ? `You already have ${quoted(r.title)}. Here it is.` : "You already have that one. Here it is.";
    return { done: { title: SCAN_DONE_ALREADY, body, go: { to: "codex", entry: r.already } } };
  }
  return { note: r.words === true ? TYPED_UNKNOWN : SCAN_MISSED };
}

/** The story's reply lines, trimmed, the empty ones dropped. */
function said(replies: readonly string[] | undefined): string[] {
  return (replies ?? []).map((r) => r.trim()).filter((r) => r !== "");
}

/** What a check-in's answer does: in, the room opens under the dialog
 *  (the story's own words, else a plain line); kept out by the story, the
 *  sheet says why. */
export function checkinOutcome(r: CheckinAnswer): ScanOutcome {
  const lines = said(r.replies);
  if (!r.moved) return { note: lines.length > 0 ? `⛔ ${lines.join(" ")}` : CHECKIN_KEPT };
  const body = lines.length > 0 ? lines.join("\n") : `You're checked in at ${r.room ?? r.at}.`;
  return { done: { title: SCAN_DONE_CHECKIN, body, go: { to: "room", id: r.channel } } };
}

/** What the sheet says when a redeem or a check-in is refused: a throttle,
 *  the paused show, else the server's own words (they name the room, the
 *  wait, the reason). */
export function scanErrorNote(e: unknown, kind: "unlock" | "checkin"): string {
  const status = typeof e === "object" && e !== null ? (e as { status?: unknown }).status : undefined;
  const message = e instanceof Error ? e.message : "";
  if (typeof status !== "number") return SCAN_FAILED;
  if (status === 409 && /doors are closed/iu.test(message)) return SCAN_PAUSED;
  if (status === 429 && kind === "unlock") return REDEEM_THROTTLED;
  return message !== "" ? `⛔ ${message}` : SCAN_FAILED;
}

/**
 * The dialog itself: a small Win95 window over the place the scan landed.
 * OK, a tap outside or six seconds on screen close it. A `div` with
 * `role="alertdialog"`, never `<dialog>` (old Safari).
 */
export function ScanDoneDialog({ done, onClose }: { done: ScanDone; onClose: () => void }) {
  const visible = useVisible();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => close.current(), SCAN_DONE_MS);
    return () => window.clearTimeout(t);
  }, [visible, done.id]);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus?.();
  }, [done.id]);
  const titleId = `scan-done-title-${done.id}`;
  return (
    <div className="scan-done-layer" onClick={onClose}>
      <div className="w95-window scan-done" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <div className="w95-titlebar">
          <span className="w95-title" id={titleId}>
            {done.title}
          </span>
        </div>
        <div className="scan-done-body">
          {done.body.split("\n").map((line, i) => (
            <p key={i} className="scan-done-line">
              {line}
            </p>
          ))}
          <button ref={ok} type="button" className="w95-btn scan-done-ok" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
