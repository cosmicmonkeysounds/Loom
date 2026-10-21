//! Is a moment's scene up on this screen? (wave 17) The cutscene layer is
//! a lazy chunk beside the idle show, not inside it, so it says so here and
//! the idle show pauses under a moment (no popup, saver chime or arrival
//! sound over the scene's own stingers). Base bundle: a few lines, like
//! `face-bus.ts`.

import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();
let up = false;

/** A moment's scene is up right now. */
export function momentUp(): boolean {
  return up;
}

/** The cutscene layer: a moment's scene came up (true) or went (false). */
export function setMomentUp(on: boolean): void {
  if (on === up) return;
  up = on;
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a listener that went away */
    }
  }
}

/** Hear every change; returns the unsubscribe. */
export function onMomentUp(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** `momentUp`, following a change. */
export function useMomentUp(): boolean {
  return useSyncExternalStore(onMomentUp, momentUp, momentUp);
}
