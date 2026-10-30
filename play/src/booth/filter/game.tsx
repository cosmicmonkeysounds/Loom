// Wave 48b (C10, C11, C13): the Password Manager's ⭐ mini-game, drawn.
// Each ✂ pays `floor(points × mult)`; the multiplier comes from the
// filter's heat, which every ✂ raises and which cools back toward ×3
// (`model.ts` `multAt`, decaying from the moment its view arrived:
// `use-filter.ts` `FilterGame`). The booth hands the heat down through
// `FilterGameContext`, so a pop-out raised a minute ago still reads the
// heat now. `FilterMeter` (the heat bar, the multiplier, when it is back to
// ×3, a line's worth) and `FilterPay` (what ✂ would pay now) tick only
// while mounted and still warm: no timer outlives them, none runs once the
// heat is gone. `FilterBurst` is the "+n ⭐ ×m" that rises from a ✂'s
// answer. Copy is `DRAFT w48b` (`model.ts` `FILTER_GAME_COPY`).

import { createContext, useContext, useEffect, useRef, useState, type ReactElement } from "react";
import type { FilterLine } from "../../types.ts";
import { FILTER_GAME_COPY, burstLine, burstQuip, heatAt, heatShare, multAt, multText, nextNotchMs, notchAt, payOf, restedInMs, type FilterBurstData, type FilterDraftGame } from "./model.ts";
import type { FilterGame } from "./use-filter.ts";

/** The censor's heat (`FilterApi.game`); null: not the censor, or an older server. */
export const FilterGameContext = createContext<FilterGame | null>(null);

/** The meter's tick (a CSS transition of the same length smooths it). */
export const METER_TICK_MS = 500;
/** How long a burst stays up. */
export const FILTER_BURST_MS = 1_600;

/** The phone asks for less motion. */
function still(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Ms since the game's view arrived, re-read while the heat is still up:
 * every `tickMs` (the meter), or at the next change of multiplier (`null`,
 * a pay label). One timeout at a time, set after each render and cleared
 * on the next or on unmount; none once the heat is gone.
 */
export function useGameClock(game: FilterGame | null, tickMs: number | null): number {
  const [, setTick] = useState(0);
  const elapsed = game !== null ? Date.now() - game.at : 0;
  const warm = game !== null && heatAt(game.combo, elapsed) > 0;
  useEffect(() => {
    if (game === null || !warm) return;
    const wait = tickMs ?? (nextNotchMs(game.combo, Date.now() - game.at) ?? 0) + 30;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(16, wait));
    return () => clearTimeout(t);
  });
  return elapsed;
}

/** The heat meter: the line's worth (when given), the multiplier now, a
 *  bar that cools to empty, and when ✂ pays the best again. */
export function FilterMeter({ points, game: given }: { points?: number | undefined; game?: FilterGame | null }): ReactElement | null {
  const ctx = useContext(FilterGameContext);
  const game = given !== undefined ? given : ctx;
  const elapsed = useGameClock(game, still() ? 1_000 : METER_TICK_MS);
  if (game === null) return null;
  const c = game.combo;
  const mult = multText(multAt(c, elapsed));
  const rest = restedInMs(c, elapsed);
  const best = multText(c.mults[0] ?? 3);
  const cool = rest > 0 ? FILTER_GAME_COPY.coolsIn(best, Math.ceil(rest / 1000)) : FILTER_GAME_COPY.rested;
  return (
    <div className={`filter-meter notch-${notchAt(c, elapsed)}`} role="group" aria-label={`${FILTER_GAME_COPY.heat} ${mult}, ${cool}`}>
      {points !== undefined && (
        <span className="filter-worth" title={FILTER_GAME_COPY.worthTitle(points)}>
          {FILTER_GAME_COPY.worth(points)}
        </span>
      )}
      <span className="filter-mult">{mult}</span>
      <span className="filter-heat" aria-hidden>
        <span className="filter-heat-cover" style={{ transform: `scaleX(${(1 - heatShare(c, elapsed)).toFixed(3)})` }} />
      </span>
      <span className="filter-cool">{cool}</span>
    </div>
  );
}

/** What ✂ would pay now ("+15 ⭐"), inside its button; nothing without a game or a worth. */
export function FilterPay({ points, game: given }: { points: number | undefined; game?: FilterGame | null }): ReactElement | null {
  const ctx = useContext(FilterGameContext);
  const game = given !== undefined ? given : ctx;
  const elapsed = useGameClock(game, null);
  if (game === null || points === undefined) return null;
  return <span className="filter-pay">{FILTER_GAME_COPY.pay(payOf(points, multAt(game.combo, elapsed)))}</span>;
}

/** The 🔑 LANGUAGE pop-out's live parts for one line (`filterDraft`'s `game`). */
export function filterGameNodes(line: Pick<FilterLine, "seq" | "points">): FilterDraftGame {
  return { meter: <FilterMeter key={`meter:${line.seq}`} points={line.points} />, pay: <FilterPay key={`pay:${line.seq}`} points={line.points} /> };
}

/** A light buzz where the phone has one: a tap for stars, a stutter for none. */
function buzz(stars: number): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(stars > 0 ? 25 : [12, 60, 12]);
  } catch {
    /* no vibration */
  }
}

/** The "+n ⭐ ×m" burst over the booth after a ✂, with a quip (a 0 ⭐ ✂
 *  at ×¼ is a joke, not an error). Gone after `FILTER_BURST_MS`; reduced
 *  motion fades it in place (`css/booth.css`). */
export function FilterBurst({ burst, onDone }: { burst: FilterBurstData | null; onDone: () => void }): ReactElement {
  const done = useRef(onDone);
  done.current = onDone;
  const id = burst?.id ?? null;
  const stars = burst?.stars ?? 0;
  useEffect(() => {
    if (id === null) return;
    buzz(stars);
    const t = setTimeout(() => done.current(), FILTER_BURST_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return (
    <div className="filter-burst-host" aria-live="polite">
      {burst !== null && (
        <div key={burst.id} className={`filter-burst${burst.stars <= 0 ? " zero" : ""}`}>
          <span className="filter-burst-line">{burstLine(burst)}</span>
          <span className="filter-burst-quip">{burstQuip(burst)}</span>
        </div>
      )}
    </div>
  );
}
