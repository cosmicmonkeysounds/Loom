//! The roll's pure parts (wave 44, C7): fetching `GET /api/credits`, the
//! rows (core's `creditsRows`, shared with the TV so both read the same
//! order), the pause-able clock, and where the rows sit at a moment of the
//! roll. Lazy: only `roll.tsx` imports this.

import { creditsRollMs, creditsRows, type CreditsRow, type CreditsView } from "../../../core/src/credits.ts";
import { withTimeout } from "../client.ts";

export type { CreditsRow, CreditsView };

/** Why there is no roll to show. */
export type CreditsUnready = "not_yet" | "no_credits" | "offline";

export type CreditsLoad = { kind: "loading" } | { kind: "ready"; view: CreditsView } | { kind: "unready"; why: CreditsUnready };

/** How long the one fetch may take before the card says it isn't ready. */
export const CREDITS_FETCH_MS = 10_000;

/** The route, under the event's base. */
export function creditsPath(eventId: string): string {
  return `/e/${encodeURIComponent(eventId)}/api/credits`;
}

/** An answer's status and body → what the roll shows (pure). */
export function creditsAnswer(status: number, body: unknown): CreditsLoad {
  if (status === 200 && isView(body)) return { kind: "ready", view: body };
  const error = body !== null && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (status === 403 && error === "not_yet") return { kind: "unready", why: "not_yet" };
  if (status === 404) return { kind: "unready", why: "no_credits" };
  return { kind: "unready", why: "offline" };
}

function isView(v: unknown): v is CreditsView {
  if (v === null || typeof v !== "object") return false;
  const o = v as Partial<CreditsView>;
  return typeof o.title === "string" && Array.isArray(o.sections) && Array.isArray(o.end);
}

/** `GET /api/credits` with the session's token, once (any failure is `offline`). */
export async function fetchCredits(eventId: string, token: string, doFetch: typeof fetch = (...a) => fetch(...a)): Promise<CreditsLoad> {
  try {
    const res = await withTimeout(doFetch(creditsPath(eventId), { headers: { "x-loom-token": token }, cache: "no-store" }), CREDITS_FETCH_MS);
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return creditsAnswer(res.status, body);
  } catch {
    return { kind: "unready", why: "offline" };
  }
}

/** The roll's rows, how long they take, and the held end card's lines
 *  (the title when the file has no `end`). */
export interface RollPlan {
  rows: CreditsRow[];
  ms: number;
  end: string[];
}

export function rollPlan(view: CreditsView): RollPlan {
  const rows = creditsRows(view);
  return { rows, ms: creditsRollMs(rows.length), end: view.end.length > 0 ? view.end : [view.title] };
}

/** The roll's clock: time banked while paused, plus the wall time since it last ran. */
export interface RollClock {
  /** Wall ms it (re)started at; null while paused. */
  since: number | null;
  /** Elapsed ms banked before `since`. */
  banked: number;
}

export const rollStart = (now: number): RollClock => ({ since: now, banked: 0 });

export function rollElapsed(c: RollClock, now: number): number {
  return c.banked + (c.since === null ? 0 : Math.max(0, now - c.since));
}

export function rollPaused(c: RollClock): boolean {
  return c.since === null;
}

/** Pause a running clock (no change when already paused). */
export function rollPause(c: RollClock, now: number): RollClock {
  return c.since === null ? c : { since: null, banked: rollElapsed(c, now) };
}

/** Run a paused clock (no change when already running). */
export function rollResume(c: RollClock, now: number): RollClock {
  return c.since === null ? { since: now, banked: c.banked } : c;
}

/** A tap: pause, or go on. */
export function rollToggle(c: RollClock, now: number): RollClock {
  return c.since === null ? rollResume(c, now) : rollPause(c, now);
}

/**
 * Where the rows' top sits (px from the screen's top) `elapsed` ms into a
 * roll of `ms`: from just below the screen (`viewH`) to just above it
 * (`-contentH`), at a steady pace. Past the end it stays off the top.
 */
export function rollY(elapsed: number, ms: number, viewH: number, contentH: number): number {
  const p = ms <= 0 ? 1 : Math.min(1, Math.max(0, elapsed / ms));
  return Math.round(viewH - p * (viewH + contentH));
}

/** The rows have rolled by: hold the end card. */
export function rollOver(elapsed: number, ms: number): boolean {
  return elapsed >= ms;
}
