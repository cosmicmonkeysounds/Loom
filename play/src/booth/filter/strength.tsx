// Wave 48b (C7, C13), wave 59: the censor's 🔑 Filter strength window, a
// booth layer opened only from ⊞ Start (nothing else points at it: she has
// to find it). Only a slider: 0–100 in steps of 5 that posts on release (not
// on every pixel), and not a word beyond the title (DRAFT w48b's copy went
// with the user's note, wave 59). The dial is optimistic (`use-filter.ts`
// `setLevel`): a refusal rolls the thumb back and reddens the track, and a
// screen reader hears why.

import { useRef, useState, type ReactElement } from "react";
import { BoothLayer } from "../layer.tsx";
import { FILTER_COPY, FILTER_LEVEL_COPY, FILTER_LEVEL_STEP, snapLevel } from "./model.ts";
import type { FilterApi } from "./use-filter.ts";

export function FilterStrengthWindow({ api, onClose }: { api: Pick<FilterApi, "level" | "levelError" | "setLevel">; onClose: () => void }): ReactElement {
  // The thumb while a finger (or a key) holds it; posted on release.
  const [drag, setDrag] = useState<number | null>(null);
  const held = useRef<number | null>(null);
  const shown = drag ?? api.level;
  const move = (v: number) => {
    held.current = snapLevel(v);
    setDrag(held.current);
  };
  const commit = () => {
    const to = held.current;
    if (to === null) return;
    held.current = null;
    setDrag(null);
    api.setLevel(to);
  };
  const refused = api.levelError !== null;
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>{FILTER_COPY.glyph}</span> {FILTER_LEVEL_COPY.title}
        </span>
      }
      label={FILTER_LEVEL_COPY.label}
      onClose={onClose}
    >
      <div className="filter-level">
        <input
          type="range"
          className={`filter-level-range${refused ? " refused" : ""}`}
          min={0}
          max={100}
          step={FILTER_LEVEL_STEP}
          value={shown}
          aria-label={FILTER_LEVEL_COPY.label}
          aria-valuetext={`${shown}%`}
          onChange={(e) => move(Number(e.currentTarget.value))}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <div className="moments-visually-hidden" role="status">
          {api.levelError ?? ""}
        </div>
      </div>
    </BoothLayer>
  );
}
