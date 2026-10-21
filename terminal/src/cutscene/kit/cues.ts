//! Things a scene does at a frame (a sound on the beat): fired once when
//! the scene's `t` crosses them, and never late — a cue more than `slack`
//! behind `t` (a reload, a page that was hidden) is skipped, not replayed.

import { useEffect, useRef } from "react";
import type { SfxName, SfxOpts } from "../../sound/index.ts";
import { cuesDue } from "./time.ts";

export type Cue = readonly [at: number, fire: () => void];

/** Fire each cue as `t` passes it (ms into the scene). */
export function useCues(t: number, cues: readonly Cue[], slack = 500): void {
  const prev = useRef<number | null>(null);
  const list = useRef(cues);
  list.current = cues;
  useEffect(() => {
    const p = prev.current ?? Number.NEGATIVE_INFINITY;
    prev.current = t;
    // A clock that went back (a new seq reuses the component): start over from here.
    if (t < p) return;
    const due = cuesDue(p, t, list.current.map((c) => c[0]), slack);
    if (due.length === 0) return;
    for (const c of list.current) if (due.includes(c[0])) c[1]();
  }, [t, slack]);
}

/** A sound per beat: `[[0, "startup"], [1800, "ding", {pitch: 1.5}]]`. */
export function useSfxCues(t: number, play: (name: SfxName, opts?: SfxOpts) => boolean, cues: ReadonlyArray<readonly [number, SfxName, SfxOpts?]>, slack = 500): void {
  useCues(
    t,
    cues.map(([at, name, opts]) => [at, () => void play(name, opts)] as const),
    slack,
  );
}
