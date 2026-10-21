//! A cutscene's clock (wave 17): scenes are drawn from the **server's** time
//! (its `now` + the time since the answer arrived, like the slide holds in
//! `slides.ts`), so every screen in the house is on the same frame and a
//! reload resumes mid-scene. The frame loop is capped (≤ 30 fps: an old
//! tablet in an enclosure runs hot) and stops while the page is hidden.

import { useEffect, useState } from "react";
import type { ScreenState } from "../screen.ts";

/** A slide that came from history (`at` 0: a server restart replayed it) is
 *  drawn this far in — its hold state, never its entrance. */
export const HISTORY_T = 600_000;
/** The frame cap. */
export const SCENE_FPS = 30;

/** The server's clock at local `localNow` (no answer yet: the local clock). */
export function serverNow(state: Pick<ScreenState, "now" | "receivedAt"> | null, localNow: number = Date.now()): number {
  if (state === null || !(state.now > 0)) return localNow;
  return state.now + Math.max(0, localNow - state.receivedAt);
}

/** ms into a scene that started at `at` (server ms; 0 = history → `HISTORY_T`). Never negative. */
export function sceneT(at: number, now: number): number {
  if (!(at > 0)) return HISTORY_T;
  return Math.max(0, now - at);
}

/** Is a frame due at `now` after one at `last` (a cap of `fps`)? A 2 ms slack keeps a 60 Hz display at an even 30. */
export function frameDue(last: number, now: number, fps: number = SCENE_FPS): boolean {
  return now - last >= 1000 / fps - 2;
}

/**
 * The local clock (`Date.now()`), re-read once a frame at ≤ `fps` while
 * `active` and the page is visible. Hidden: no frames at all (the rAF loop
 * is cancelled, not throttled), and the first frame back jumps to now.
 */
export function useSceneClock(active: boolean, fps: number = SCENE_FPS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let raf = 0;
    let last = 0;
    const loop = (ts: number) => {
      raf = window.requestAnimationFrame(loop);
      if (!frameDue(last, ts, fps)) return;
      last = ts;
      setNow(Date.now());
    };
    const start = () => {
      window.cancelAnimationFrame(raf);
      if (document.hidden) return;
      setNow(Date.now());
      raf = window.requestAnimationFrame(loop);
    };
    const onVis = () => (document.hidden ? window.cancelAnimationFrame(raf) : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, fps]);
  return now;
}

/** `prefers-reduced-motion: reduce` right now (false where it can't be asked). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** `prefersReducedMotion`, following a change (Safari 14's MediaQueryList may only have `addListener`). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", on);
    else mq.addListener(on);
    return () => {
      if (typeof mq.removeEventListener === "function") mq.removeEventListener("change", on);
      else mq.removeListener(on);
    };
  }, []);
  return reduced;
}
