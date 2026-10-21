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
