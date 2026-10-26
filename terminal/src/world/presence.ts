//! Terminals link to the Internet by room (wave 26, R5) — pure, so the
//! walls, the TV and the tests agree. A terminal shows and transmits the
//! Internet (the world view, its camera into the game, its mic to and from
//! the players) only while a reinstalled player is in its spot's room in the
//! game. The server is the judge: the screen state's `spot.here` (players
//! whose presence room — `@loom/house` `presenceRoom`, with its 0.75 m
//! doorway hysteresis — is this spot's room). The voice and the cameras the
//! server routes per room itself (C7, C8); this decides what the screen draws.
//!
//! - `mirror` / `shadow` (dedicated spectator screens) stay always on.
//! - `reinstall` (the tent: every walk starts in its room) is never linked.
//! - A terminal with no spot is never linked.
//! - Only when `here` is absent (an older server, no spatial map) does a
//!   placed terminal fall back to the old house-wide rule (anyone in the
//!   simulation).
//!
//! `PresenceLatch` adds the client's `PRESENCE_LINGER_MS` (3 s): on at once,
//! off only after that long unlinked, so a doorway crossing never flickers a
//! pane or a whole screen.

import { useEffect, useRef, useState } from "react";
import { PRESENCE_LINGER_MS } from "@loom/house";
import type { TerminalView } from "../config.ts";
import type { ScreenSpot } from "../screen.ts";
import { paneSimulation, type PaneSim } from "../webgl.ts";

/**
 * Is this spot's room occupied in the game? The server's `here` when it
 * sends one (`here > 0`); else (an older server, no map) `fallback` — the
 * old rule's answer (anyone in the simulation).
 */
export function roomOccupied(spot: Pick<ScreenSpot, "here"> | null | undefined, fallback: boolean): boolean {
  const here = spot?.here;
  return typeof here === "number" ? here > 0 : fallback;
}

/**
 * Is a terminal linked to the Internet now (R5)? `spot` = its map spot id
 * (`config.spot`), `here` = the screen state's spot block, `anyone` = someone
 * is in the simulation anywhere (the stream's players, or the server's
 * house-wide `reinstalling`).
 */
export function linkedNow(o: { view: TerminalView | string; spot: string; here: Pick<ScreenSpot, "here"> | null | undefined; anyone: boolean }): boolean {
  if (o.view === "mirror" || o.view === "shadow") return o.anyone; // spectator screens: house-wide, as always
  if (o.view === "reinstall") return false; // the tent: every walk starts in its room (T3)
  if (o.spot.trim() === "") return false; // nowhere in the game
  return roomOccupied(o.here, o.anyone);
}

/** A wall's face pane on the attract screen: the simulation only while linked
 *  (both `auto` and `world`: R5), else nothing over the face. */
export function linkedPane(view: TerminalView, webgl2: boolean, linked: boolean, shadowReady: boolean): PaneSim {
  return linked ? paneSimulation(view, webgl2, true, shadowReady) : "none";
}

/**
 * On at once, off only after `linger` ms of continuous off (a doorway
 * crossing, a poll that missed). Pure: fed the clock; `nextChange` says when
 * to ask again.
 */
export class PresenceLatch {
  private offSince: number | null = null;
  private value = false;
  constructor(private readonly linger: number = PRESENCE_LINGER_MS) {}
  /** The latched answer for the raw `on` at `now`. */
  update(on: boolean, now: number): boolean {
    if (on) {
      this.value = true;
      this.offSince = null;
    } else if (this.value) {
      this.offSince ??= now;
      if (now - this.offSince >= this.linger) {
        this.value = false;
        this.offSince = null;
      }
    }
    return this.value;
  }
  get on(): boolean {
    return this.value;
  }
  /** When a raw `off` held since now would drop the latch (local ms), or null (nothing pending). */
  nextChange(): number | null {
    return this.value && this.offSince !== null ? this.offSince + this.linger : null;
  }
}

/** `PresenceLatch` as a hook: the latched `on`, re-asked when the linger runs out. */
export function usePresenceLatch(on: boolean, linger: number = PRESENCE_LINGER_MS): boolean {
  const latch = useRef<PresenceLatch | null>(null);
  latch.current ??= new PresenceLatch(linger);
  const [, bump] = useState(0);
  const value = latch.current.update(on, Date.now());
  const due = latch.current.nextChange();
  useEffect(() => {
    if (due === null) return;
    const t = window.setTimeout(() => bump((n) => n + 1), Math.max(0, due - Date.now()) + 20);
    return () => window.clearTimeout(t);
  }, [due]);
  return value;
}

/**
 * The room gate for a screen with the stream at hand (the TV's world pane,
 * integration I1): the server's `here` for this spot, falling back to
 * `anyone` (today's `inSimulation`) only when `here` is absent, latched.
 */
export function useRoomLinked(spot: Pick<ScreenSpot, "here"> | null | undefined, anyone: boolean): boolean {
  return usePresenceLatch(roomOccupied(spot, anyone));
}
