//! The lean screen state (OCT31 K-16): every 2 s the terminal asks the
//! event server `GET /api/screen/state` (~1 KB, `core/server/routes/screen.ts`)
//! what the house's screens should be doing — the story's screen cues, the
//! running countdown, and whether this terminal's character is hidden or
//! asleep. While it is, the terminal is on **attract** (screensaver + ads):
//! no scanner, never "ONLINE", never a pilot into the character's thread.
//!
//! The poll is also the terminal's heartbeat — the server remembers each
//! terminal's last poll by name (K-29 reads it).
//!
//! Fail closed: until the first answer arrives the terminal stays on
//! attract, and an unreachable server keeps the last answer it gave — a
//! dropped poll never flips a hidden character onto the wall.

import { useEffect, useState } from "react";
import { baseOf, type TerminalConfig } from "./config.ts";

/** How often the terminal polls (ms). */
export const SCREEN_POLL_MS = 2000;

export type ScreenCueFamily = "screens" | "terminals" | "tv" | "tablet";

export interface ScreenCue {
  value: string;
  seq: number;
}

/** The server's answer (a subset is all the terminal reads today). */
export interface ScreenState {
  now: number;
  night: { screen: string | null; terminals: string | null };
  cues: Partial<Record<ScreenCueFamily, ScreenCue | null>>;
  character: { id: string; hidden: boolean; awake: boolean; online: boolean } | null;
  attract: boolean;
  countdown: string | null;
  remaining: number | null;
}

/** The poll URL for this terminal (its name/spot/view ride along as the heartbeat). */
export function screenStateUrl(c: Pick<TerminalConfig, "eventId" | "name" | "spot" | "view" | "character">): string {
  const q = new URLSearchParams({ name: c.name, spot: c.spot, view: c.view, character: c.character });
  return `${baseOf(c)}/api/screen/state?${q.toString()}`;
}

/** Accept a body only if it has the shape the terminal relies on. */
export function parseScreenState(raw: unknown): ScreenState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["attract"] !== "boolean") return null;
  const ch = r["character"];
  const character =
    typeof ch === "object" && ch !== null && typeof (ch as Record<string, unknown>)["id"] === "string"
      ? {
          id: String((ch as Record<string, unknown>)["id"]),
          hidden: (ch as Record<string, unknown>)["hidden"] === true,
          awake: (ch as Record<string, unknown>)["awake"] !== false,
          online: (ch as Record<string, unknown>)["online"] === true,
        }
      : null;
  const night = (typeof r["night"] === "object" && r["night"] !== null ? r["night"] : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    now: num(r["now"]) ?? 0,
    night: { screen: str(night["screen"]), terminals: str(night["terminals"]) },
    cues: (typeof r["cues"] === "object" && r["cues"] !== null ? r["cues"] : {}) as ScreenState["cues"],
    character,
    attract: r["attract"] as boolean,
    countdown: str(r["countdown"]),
    remaining: num(r["remaining"]),
  };
}

/** Attract or not: no answer yet is attract (fail closed). */
export function attractOf(state: ScreenState | null): boolean {
  return state === null ? true : state.attract;
}

export type PollOutcome = { kind: "state"; state: ScreenState } | { kind: "revoked" } | { kind: "miss" };

/** One poll. A 401/403 is a revoked token; anything else that fails is a miss (keep the last answer). */
export async function pollScreen(c: TerminalConfig, fetchFn: typeof fetch = fetch): Promise<PollOutcome> {
  try {
    const res = await fetchFn(screenStateUrl(c), { headers: { "x-loom-token": c.token }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { kind: "revoked" };
    if (!res.ok) return { kind: "miss" };
    const state = parseScreenState(await res.json());
    return state === null ? { kind: "miss" } : { kind: "state", state };
  } catch {
    return { kind: "miss" };
  }
}

/**
 * Poll the screen state every `SCREEN_POLL_MS` while a config is present.
 * Returns the last good answer (null until the first) and whether the
 * server refused this terminal's token.
 */
export function useScreenState(config: TerminalConfig | null): { state: ScreenState | null; revoked: boolean } {
  const [state, setState] = useState<ScreenState | null>(null);
  const [revoked, setRevoked] = useState(false);
  useEffect(() => {
    setState(null);
    setRevoked(false);
    if (config === null) return;
    let alive = true;
    let timer = 0;
    const tick = async () => {
      const out = await pollScreen(config);
      if (!alive) return;
      if (out.kind === "state") setState(out.state);
      else if (out.kind === "revoked") {
        setRevoked(true);
        return; // stop polling: setup takes over
      }
      timer = window.setTimeout(() => void tick(), SCREEN_POLL_MS);
    };
    void tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [config]);
  return { state, revoked };
}
