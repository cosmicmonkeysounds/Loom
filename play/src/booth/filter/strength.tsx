// Wave 48b (C7, C13): the censor's 🔑 Filter strength window, a booth
// layer opened only from ⊞ Start (nothing else points at it: she has to
// find it). The big %, what that strength catches, a slider 0–100 in
// steps of 5 that posts on release (not on every pixel), ◀ Less / More ▶
// to jump a band, and the legend: every band in its highlight colour, on
// when this strength catches it, with its ⭐ a word. The dial is
// optimistic (`use-filter.ts` `setLevel`): a refusal rolls it back and the
// status line says so. Copy is `DRAFT w48b` (`model.ts` `FILTER_LEVEL_COPY`).

import { useRef, useState, type ReactElement } from "react";
import { BoothLayer } from "../layer.tsx";
import { FILTER_COPY, FILTER_LEVEL_COPY, FILTER_LEVEL_STEP, UNSAID_WORD, bandAt, bandsAt, snapLevel, stepBand } from "./model.ts";
import type { FilterApi } from "./use-filter.ts";

/** The legend's row for a band (the slur band never names one). */
function legendText(tier: number, catches: string): string {
  return tier === 0 ? FILTER_LEVEL_COPY.slurs : catches;
}

/** The legend: every band, its colour, its strength, what it adds, its ⭐ a word. */
export function FilterLegend({ level }: { level: number }): ReactElement {
  return (
    <ul className="filter-legend" aria-label={FILTER_LEVEL_COPY.catches}>
      {bandsAt(level).map(({ band, on }) => (
        <li key={band.key} className={`filter-legend-row${on ? " on" : ""}`}>
          <span className={`filter-swatch filter-tier-${band.tier}`} aria-hidden>
            {band.tier === 0 ? UNSAID_WORD : "abc"}
          </span>
          <span className="filter-legend-tier">{band.tier}%</span>
          <span className="filter-legend-text">
            {legendText(band.tier, band.catches)}
            {!on && <span className="filter-legend-off"> · {FILTER_LEVEL_COPY.off}</span>}
          </span>
          <span className="filter-legend-pts">{FILTER_LEVEL_COPY.points(band.points)}</span>
        </li>
      ))}
    </ul>
  );
}

export function FilterStrengthWindow({ api, onClose }: { api: Pick<FilterApi, "level" | "saving" | "levelError" | "setLevel">; onClose: () => void }): ReactElement {
  // The thumb while a finger (or a key) holds it; posted on release.
  const [drag, setDrag] = useState<number | null>(null);
  const held = useRef<number | null>(null);
  const shown = drag ?? api.level;
  const band = bandAt(shown);
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
  const jump = (dir: -1 | 1) => {
    held.current = null;
    setDrag(null);
    api.setLevel(stepBand(api.level, dir));
  };
  const status = api.saving ? FILTER_LEVEL_COPY.saving : api.levelError !== null ? FILTER_LEVEL_COPY.stays(api.levelError, api.level) : FILTER_LEVEL_COPY.foot;
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>{FILTER_COPY.glyph}</span> {FILTER_LEVEL_COPY.title}
        </span>
      }
      label={FILTER_LEVEL_COPY.label}
      onClose={onClose}
      foot={
        <div className={`booth-status${api.levelError !== null && !api.saving ? " filter-level-refused" : ""}`} role="status">
          {status}
        </div>
      }
    >
      <div className="filter-level">
        <p className="filter-level-big" aria-hidden>
          {FILTER_LEVEL_COPY.big(shown)}
        </p>
        <p className={`filter-level-now filter-tier-${band.tier}`}>{band.catches}</p>
        <input
          type="range"
          className="filter-level-range"
          min={0}
          max={100}
          step={FILTER_LEVEL_STEP}
          value={shown}
          aria-label={FILTER_LEVEL_COPY.label}
          aria-valuetext={`${FILTER_LEVEL_COPY.big(shown)}: ${band.catches}`}
          onChange={(e) => move(Number(e.currentTarget.value))}
          onPointerUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <div className="filter-level-steps">
          <button type="button" className="w95-btn filter-level-step" disabled={shown <= 0} onClick={() => jump(-1)}>
            {FILTER_LEVEL_COPY.less}
          </button>
          <button type="button" className="w95-btn filter-level-step" disabled={shown >= 100} onClick={() => jump(1)}>
            {FILTER_LEVEL_COPY.more}
          </button>
        </div>
        <p className="filter-level-catches">{FILTER_LEVEL_COPY.catches}</p>
        <FilterLegend level={shown} />
      </div>
    </BoothLayer>
  );
}
