//! Is a moment's scene up on this screen? (wave 17) The cutscene layer is
//! a lazy chunk beside the idle show, not inside it, so it says so here and
//! the idle show pauses under a moment (no popup, saver chime or arrival
//! sound over the scene's own stingers). It also says when a scene draws the
//! story's countdown itself, so the corner countdown stands aside. Base
//! bundle: a few lines, like `face-bus.ts`.

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

// --- the scene's own countdown --------------------------------------------------------

const clockListeners = new Set<Listener>();
let clockUp = false;

/** A scene on screen draws the story's countdown itself (the corner stands aside). */
export function sceneClockUp(): boolean {
  return clockUp;
}

/** The cutscene layer: a scene that draws the countdown came up (true) or went (false). */
export function setSceneClockUp(on: boolean): void {
  if (on === clockUp) return;
  clockUp = on;
  for (const l of [...clockListeners]) {
    try {
      l();
    } catch {
      /* a listener that went away */
    }
  }
}

function onSceneClockUp(l: Listener): () => void {
  clockListeners.add(l);
  return () => void clockListeners.delete(l);
}

/** `sceneClockUp`, following a change. */
export function useSceneClockUp(): boolean {
  return useSyncExternalStore(onSceneClockUp, sceneClockUp, sceneClockUp);
}
