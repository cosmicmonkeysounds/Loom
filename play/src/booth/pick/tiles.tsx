//! Guest tiles for a picker (wave 18, BOOTH-SPEC §4.7): square pictures in a
//! CSS grid (3 across from 380 px, 2 below), the name under each clamped to
//! two lines; the chosen one navy. A greyed tile names why ("(bingo
//! winner)") and can't be picked; a tagged one (wave 26 B4) names why and
//! still can. *Not here? Search everyone* opens a search over every guest.

import { useState } from "react";
import { PersonAvatar } from "../../ui/primitives.tsx";
import { GuestBadges } from "../badges.tsx";
import { filterGuests } from "../model.ts";
import type { PrimeGuest } from "../../types.ts";

export interface TilesProps {
  /** The guests at hand (the objective's `pick`, server order). */
  list: readonly PrimeGuest[];
  /** Everyone (the search fallback). */
  everyone: readonly PrimeGuest[];
  chosen: string | null;
  /** Greyed guests and the word they wear (a hard lock: disabled). */
  greyed?: ReadonlyMap<string, string>;
  /** Wave 26 (B4): tagged guests and the word they wear, still selectable. */
  tagged?: ReadonlyMap<string, string>;
  disabled?: boolean;
  onPick: (id: string) => void;
}

export function GuestTiles({ list, everyone, chosen, greyed, tagged, disabled = false, onPick }: TilesProps) {
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const shown = searching ? filterGuests(everyone, q) : list;
  return (
    <div className="bsel-tiles-box">
      {!searching && <div className="bsel-at-hand">At hand ({list.length})</div>}
      {searching && (
        <input className="w95-inset booth-search" type="search" placeholder="Search everyone" aria-label="Search everyone" value={q} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setQ(e.target.value)} />
      )}
      <div className="tiles" role="listbox" aria-label="Programs">
        {shown.map((g) => {
          const grey = greyed?.get(g.id);
          const tag = grey ?? tagged?.get(g.id);
          const on = chosen === g.id;
          return (
            <button key={g.id} type="button" role="option" aria-selected={on} className={`tile ${on ? "chosen" : ""} ${grey !== undefined ? "greyed" : tag !== undefined ? "tagged" : ""}`} disabled={disabled || grey !== undefined} onClick={() => onPick(g.id)}>
              <span className="tile-pic">
                <PersonAvatar name={g.name} size="lg" />
              </span>
              <span className="tile-name">
                {g.name}
                <GuestBadges id={g.id} />
              </span>
              {tag !== undefined && <span className="tile-grey">{tag}</span>}
            </button>
          );
        })}
      </div>
      {shown.length === 0 && <p className="booth-none">{searching ? "Nobody matches." : "Nobody at hand right now."}</p>}
      <button type="button" className="w95-btn bsel-search" onClick={() => setSearching((v) => !v)}>
        {searching ? "‹ Back to who's at hand" : "🔍 Not here? Search everyone"}
      </button>
    </div>
  );
}
