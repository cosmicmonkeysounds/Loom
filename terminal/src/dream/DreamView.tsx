//! The dream on a screen (wave 49): a place the page's one player
//! (`player.ts`) plays in, and the hooks that say when. In the base bundle,
//! never a lazy chunk: the takeover comes hours after boot, when a rebuilt
//! server may no longer have this page's chunks.

import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { serverNow, useReducedMotion } from "../cutscene/clock.ts";
import type { ScreenState } from "../screen.ts";
import { DREAM_TAKE_MS, dreamKeyOf, dreamPhase, type DreamPhase } from "./dream.ts";
import { dreamPlayer, dreamSpeaking, onDreamSpeaking } from "./player.ts";

/** Is there a picture of the dream to show? */
export function useDreamReady(): boolean {
  return useSyncExternalStore(dreamPlayer.subscribe, dreamPlayer.ready, dreamPlayer.ready);
}

/** `dreamSpeaking`, following a change. */
export function useDreamSpeaking(): boolean {
  return useSyncExternalStore(onDreamSpeaking, dreamSpeaking, dreamSpeaking);
}

/** The dream's phase now, re-read on the moment it starts and when the takeover ends. */
export function useDreamPhase(state: ScreenState | null): DreamPhase {
  const ready = useDreamReady();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const at = state?.dream?.at ?? null;
  useEffect(() => {
    if (at === null) return;
    const now = serverNow(state);
    const ids = [at, at + DREAM_TAKE_MS].filter((t) => t > now).map((t) => window.setTimeout(tick, t - now + 20));
    return () => ids.forEach((id) => window.clearTimeout(id));
    // `at` moves only with a new moment; `state`'s clock is read once for it.
  }, [at]);
  return dreamPhase(state, serverNow(state), ready);
}

/** The dream is showing now, as a scene reads it (scenes don't hold hooks for it). */
export function dreamThrough(state: ScreenState | null, now: number): boolean {
  return dreamPhase(state, now, dreamPlayer.ready()) === "through";
}

/** Ready the picture as soon as the story turns the dream on (hours may pass
 *  between a page's boot and it, and it must be up before his word). */
export function useDreamArm(config: { spot: string; name: string } | null, target: "tv" | "wall", state: ScreenState | null): void {
  const armed = state?.dream != null;
  const reduced = useReducedMotion();
  const key = config === null ? "" : dreamKeyOf(config);
  const clock = useRef(state);
  clock.current = state;
  useEffect(() => {
    if (!armed || key === "") return;
    dreamPlayer.arm({ key, target, reduced, now: () => serverNow(clock.current) });
    return () => dreamPlayer.disarm();
  }, [armed, key, target, reduced]);
}

/** Where the dream plays. `active` false: it steps aside (a line, a game) and parks. */
export function DreamView({ active = true }: { active?: boolean }) {
  const host = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => (active && host.current !== null ? dreamPlayer.hold(host.current) : undefined), [active]);
  return <div ref={host} className="dream-view" data-active={String(active)} aria-hidden="true" />;
}
