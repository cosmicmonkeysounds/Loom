//! The cutscene chunk's loader (wave 17), in the base bundle: the scenes,
//! the kit and their CSS load lazily, fetched at boot (`app.tsx`) on every
//! view that draws slides — while the page and the server still match;
//! hours later a rebuild may have renamed the chunk. Retryable: `lazy`
//! alone caches a failed load forever.

import { retryable } from "../retry.ts";

export const loadCutscenes = retryable(() => import("./CutsceneLayer.tsx").then((m) => ({ default: m.CutsceneLayer })));

/** Does a terminal draw story slides (and so cutscenes)? Not a room terminal, the board or the casino. */
export function drawsSlides(view: string, room: string | null): boolean {
  return room === null && view !== "chess" && view !== "casino";
}

/** The idle show's and the scenes' target for a view: the TV, and its
 *  mirror fallback (`view=mirror`, OP-22, on the same screen), draw the TV's
 *  takes (no TOUCH ME, no wall popups); every other view is a wall's. */
export function screenTargetOf(view: string): "tv" | "wall" {
  return view === "tv" || view === "mirror" ? "tv" : "wall";
}

/** Does a view keep its page effects silent? The mirror is a silent
 *  spectator (docs/trapped/kiosk.md): the TV's own page has the sound and
 *  the director's mute. */
export function silentView(view: string): boolean {
  return view === "mirror";
}
