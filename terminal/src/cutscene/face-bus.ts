//! The TV face's one-shot moods from a cutscene (wave 17): the cutscene
//! layer lives in its own lazy chunk beside the TV, not inside it, so a
//! scene's `face` mood travels here and the TV hands it to its face
//! (`FaceHandle.flash`). Base bundle: a few lines.

import type { Mood } from "../face/mood.ts";

type Listener = (mood: Mood, ms: number) => void;
const listeners = new Set<Listener>();

/** Hear every scene's face mood; returns the unsubscribe. */
export function onSceneFace(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** A scene started with a face mood. */
export function flashFace(mood: Mood, ms: number): void {
  for (const l of [...listeners]) {
    try {
      l(mood, ms);
    } catch {
      /* a face that went away */
    }
  }
}
