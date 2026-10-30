//! Clippy's dream (wave 49, `docs/loom-w49-contract.md`), the pure parts. From
//! the moment Trabolta names the Y2K bug the house is in a new glitch era:
//! every terminal's idle show (its screensavers, ads and popups) gives way to
//! the hour-long video, each terminal at its own place in it (`@loom/house`
//! `dreamPositionS`), and everything that outranks the idle show still gets
//! through, data moshed (`mosh.ts`).
//!
//! The order of what is on a screen does not change; the dream is a new
//! bottom layer, and the slides, scenes, overlays and announcements above it
//! come through it:
//!
//!   blackout (true black, never moshed)
//!     > overlay > moment > slide > announcement, moshed
//!     > a line, a game, a walk (nothing moshes a screen someone is using)
//!     > the dream (where the idle show was; the Y2K clock floats on it)
//!
//! `phase`: `armed` while the story has it on and the video readies (ahead of
//! the moment, so every screen goes together), `take` for the takeover itself,
//! `through` after it. A terminal whose video and frames both fail never
//! leaves `armed`: it keeps its old idle show.

import { DREAM_MEDIA } from "@loom/house";
import type { ScreenState } from "../screen.ts";

/** The takeover: the screen rots into the dream this long, then it is the dream. */
export const DREAM_TAKE_MS = 2400;

export type DreamPhase = "off" | "armed" | "take" | "through";

/** Where the dream stands at `serverNow`. `ready`: this page has a picture of it to show. */
export function dreamPhase(state: Pick<ScreenState, "dream"> | null, serverNow: number, ready: boolean): DreamPhase {
  const d = state?.dream ?? null;
  if (d === null) return "off";
  if (!ready || serverNow < d.at) return "armed";
  return d.at > 0 && serverNow < d.at + DREAM_TAKE_MS ? "take" : "through";
}

/** The video for this screen: the TV's is sharper, a wall's lighter. */
export function dreamSrc(target: "tv" | "wall"): string {
  return `${DREAM_MEDIA}/dream-${target === "tv" ? 720 : 480}.mp4`;
}

/** What this terminal's place in the hour is keyed on: its map spot (the
 *  server's feed to the games uses the same), else its name. */
export function dreamKeyOf(c: { spot: string; name: string }): string {
  return c.spot.trim() !== "" ? c.spot.trim() : c.name.trim();
}

/** The y2k slide alone never moshes: its clock floats on the dream all hour. */
export const DREAM_SLIDE = "y2k";

export type MoshMode = "take" | "rot";

export interface MoshAsk {
  phase: DreamPhase;
  overlay: string | null;
  slide: string | null;
  glitch: boolean;
  burst: boolean;
  /** A moment's scene is up. */
  moment: boolean;
  announcing: boolean;
  /** The TV: his face has come through for a line. */
  speaking: boolean;
  /** A line, a walk, a board: someone is using this screen. */
  busy: boolean;
  reduced: boolean;
}

/**
 * Is anything above the dream getting through (`rot`), or is this the
 * takeover (`take`)? Never a blackout: that stays true black. An overlay
 * moshes whatever is under it (it has already stopped the game); anything
 * else leaves a screen in use alone. Reduced motion takes the cut, no rot.
 */
export function moshMode(a: MoshAsk): MoshMode | null {
  if (a.overlay === "blackout") return null;
  if (a.phase === "take") return a.busy || a.reduced ? null : "take";
  if (a.phase !== "through") return null;
  if (a.overlay !== null) return "rot";
  if (a.busy) return null;
  const slide = a.slide !== null && a.slide !== DREAM_SLIDE;
  return slide || a.moment || a.glitch || a.burst || a.announcing || a.speaking ? "rot" : null;
}
