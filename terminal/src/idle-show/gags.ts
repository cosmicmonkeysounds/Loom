//! What a tap does on the idle show (wave 17), pure: every ad button has a
//! gag, a tap on the screensaver pokes it, and a terminal nobody has touched
//! for a while asks to be touched. None of it reaches the scanner: the scan
//! box sits above the show and a pass is read whatever is on screen.

import type { SfxName } from "../sound/library.ts";
import { hash32 } from "./rng.ts";

/** An ad button's gag. */
export type AdGag = "shake" | "loading" | "won" | "popup" | "coin" | "error";
export const AD_GAGS: readonly AdGag[] = ["loading", "shake", "won", "popup", "coin", "error"];

/** The gag for the `clicks`-th tap on this ad's button (each tap the next one). */
export function adGag(adId: string, clicks: number): AdGag {
  return AD_GAGS[(hash32(adId) + Math.max(0, Math.floor(clicks))) % AD_GAGS.length]!;
}

/** How long a gag holds the ad (ms) — `loading` runs its bar first. */
export const GAG_MS: Record<AdGag, number> = { shake: 900, loading: 3_200, won: 2_400, popup: 600, coin: 1_600, error: 2_400 };

/** The line a gag shows on the ad (null: none). */
export function gagText(g: AdGag): string | null {
  switch (g) {
    case "loading":
      return "ERROR: too much fun";
    case "won":
      return "YOU WON… a feeling!";
    case "coin":
      return "+1 Truthcoin* (*not really)";
    case "error":
      return "This button is out of order.";
    default:
      return null;
  }
}

export function gagSound(g: AdGag): SfxName {
  switch (g) {
    case "shake":
      return "buzz";
    case "loading":
      return "error";
    case "won":
      return "tada";
    case "popup":
      return "popup";
    case "coin":
      return "coin";
    case "error":
      return "critical";
  }
}

/** The "punch the duck" target: where the duck is `t` ms in (a share of its lane, 0..1). */
export function duckLane(t: number): number {
  const period = 2_600;
  const u = (((t % period) + period) % period) / period;
  return u < 0.5 ? u * 2 : 2 - u * 2;
}

// --- the attention grab ----------------------------------------------------------------

/** Nobody has touched the terminal for this long: TOUCH ME. */
export const ATTENTION_IDLE_MS = 30_000;
/** It asks for this long, then rests for the rest of `ATTENTION_EVERY_MS`. */
export const ATTENTION_SHOW_MS = 8_000;
export const ATTENTION_EVERY_MS = 30_000;

/** Is TOUCH ME up at `now` (wall terminals only; never on the TV, which nobody touches)? */
export function attentionOn(lastTouch: number, now: number, target: "tv" | "wall"): boolean {
  if (target !== "wall") return false;
  const idle = now - lastTouch;
  if (idle < ATTENTION_IDLE_MS) return false;
  return (idle - ATTENTION_IDLE_MS) % ATTENTION_EVERY_MS < ATTENTION_SHOW_MS;
}

/** The thank-you lines for a touched TOUCH ME, in turn. */
export const THANKS: readonly string[] = ["THANK YOU!", "AGAIN!", "THAT TICKLES", "OK THAT'S ENOUGH", "★ YOU ARE MY FAVOURITE ★"];

// --- sounds, rationed -----------------------------------------------------------------

/** A window arriving rings at most once per … (ms): a pile-up is not a din. */
export function arrivalGapMs(target: "tv" | "wall"): number {
  return target === "tv" ? 6_000 : 2_500;
}

/** Does a window arriving at `now` ring, after the last that rang at `last`? */
export function ringsAt(last: number | null, now: number, target: "tv" | "wall"): boolean {
  return last === null || now - last >= arrivalGapMs(target);
}
