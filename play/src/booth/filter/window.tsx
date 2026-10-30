// Wave 48 (C5): the censor's filter window, a booth layer opened from the
// tray's `🔑 n` or a pop-out's 🔑 All flagged. Header *Censored c of f
// flagged words*, then every line still to judge, oldest first: the
// program's picture and name, where and when, the line with each stem
// marked, ✂ Censor (arms: two taps) and Let it go. A refusal is said under
// its line. Empty: *Nothing to judge.* Its × / Escape / Back go through the
// booth's `closeTo`. Copy is `DRAFT w48` (`model.ts` `FILTER_COPY`).
// Wave 48b (C13): each mark in its band's colour (a slur a `[slur]` chip);
// the header gains the ⭐ tonight, the heat meter and, when the strength
// hides waiting lines, a note; each line shows its worth and its ✂ what it
// pays now; armed, ✂ says it raises their suspicion. Copy `DRAFT w48b`.

import { useContext, useState, type ReactElement } from "react";
import { ARM_LINE, useArmButtons } from "../../arm.ts";
import type { FilterLine } from "../../types.ts";
import { PersonAvatar } from "../../ui/primitives.tsx";
import { BoothLayer } from "../layer.tsx";
import { FilterGameContext, FilterMeter, useGameClock } from "./game.tsx";
import { FILTER_COPY, FILTER_GAME_COPY, FILTER_LINE_MAX, agoText, clipLine, filterHeader, markSegments, multAt, mutedNote, payOf, whereLine } from "./model.ts";
import type { FilterApi } from "./use-filter.ts";

/** The line with its stems marked in their bands' colours, a slur as its
 *  chip (the window's and the tests' rendering). */
export function MarkedLine({ text, hits, max = FILTER_LINE_MAX }: { text: string; hits: unknown; max?: number }): ReactElement {
  const clip = clipLine(text, hits, max);
  return (
    <p className="filter-line">
      {markSegments(clip.text, clip.hits).map((q, i) =>
        q.mark === true ? (
          <mark key={i} className={`filter-hit${q.tier !== undefined ? ` filter-tier-${q.tier}` : ""}${q.chip !== undefined ? " filter-chip" : ""}`}>
            {q.chip ?? q.text}
          </mark>
        ) : (
          <span key={i}>{q.text}</span>
        ),
      )}
    </p>
  );
}

export interface FilterRowProps {
  line: FilterLine;
  /** Story ms now. */
  now: number;
  armed: boolean;
  busy: boolean;
  refusal: string | null;
  /** Wave 48b: what ✂ pays now (`floor(points × mult)`), else null (no game). */
  pay?: number | null;
  onCensor: () => void;
  onLetGo: () => void;
}

/** One waiting line. */
export function FilterRow({ line, now, armed, busy, refusal, pay = null, onCensor, onLetGo }: FilterRowProps): ReactElement {
  const name = line.name.trim() !== "" ? line.name : line.guest;
  const sub = [whereLine(line.where), agoText(line.ts, now)].filter((x) => x !== null).join(" · ");
  return (
    <li className="filter-row">
      <div className="filter-who">
        <PersonAvatar name={name} size="sm" kind="guest" />
        <span className="filter-who-words">
          <span className="filter-name">{name}</span>
          <span className="filter-where">{sub}</span>
        </span>
        {typeof line.points === "number" && (
          <span className="filter-worth" title={FILTER_GAME_COPY.worthTitle(line.points)}>
            {FILTER_GAME_COPY.worth(line.points)}
          </span>
        )}
      </div>
      <MarkedLine text={line.text} hits={line.hits} />
      <div className="filter-actions">
        <button type="button" className={`w95-btn filter-btn censor${armed ? " armed" : ""}`} disabled={busy} aria-pressed={armed || undefined} onClick={onCensor}>
          {busy ? "…" : armed ? FILTER_COPY.censorArmed : FILTER_COPY.censor}
          {!busy && pay !== null && <span className="filter-pay">{FILTER_GAME_COPY.pay(pay)}</span>}
          {armed && !busy && <span className="filter-arm">{ARM_LINE}</span>}
        </button>
        <button type="button" className="w95-btn filter-btn" disabled={busy} onClick={onLetGo}>
          {FILTER_COPY.letGo}
        </button>
      </div>
      {refusal !== null && (
        <p className="filter-refused" role="status">
          {refusal}
        </p>
      )}
    </li>
  );
}

export function FilterWindow({ api, now, onClose }: { api: Pick<FilterApi, "view" | "waiting" | "censor" | "letGo" | "refusal"> & Partial<Pick<FilterApi, "game">>; now: number; onClose: () => void }) {
  const arm = useArmButtons();
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const ctx = useContext(FilterGameContext);
  const game = api.game !== undefined ? api.game : ctx;
  // Re-read at each change of multiplier, for every ✂'s pay.
  const elapsed = useGameClock(game, null);
  const mult = game !== null ? multAt(game.combo, elapsed) : null;
  const mark = (seq: number, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(seq);
      else next.delete(seq);
      return next;
    });
  const lines = api.waiting;
  const stars = api.view?.stars;
  const muted = mutedNote(api.view?.muted);
  return (
    <BoothLayer
      title={
        <span className="booth-layer-title">
          <span aria-hidden>{FILTER_COPY.glyph}</span> {FILTER_COPY.windowTitle(lines.length)}
        </span>
      }
      label="Flagged words"
      onClose={onClose}
      foot={<div className="booth-status">{FILTER_COPY.foot}</div>}
    >
      <div className="filter-window">
        <div className="filter-head-row">
          <p className="filter-head">{filterHeader(api.view)}</p>
          {typeof stars === "number" && <span className="filter-stars">{FILTER_GAME_COPY.stars(stars)}</span>}
        </div>
        <FilterMeter game={game} />
        {muted !== null && <p className="filter-muted">{muted}</p>}
        {lines.length === 0 ? (
          <p className="booth-none filter-none">{FILTER_COPY.empty}</p>
        ) : (
          <ul className="filter-list">
            {lines.map((l) => (
              <FilterRow
                key={l.seq}
                line={l}
                now={now}
                armed={arm.armed === `censor:${l.seq}`}
                busy={busy.has(l.seq)}
                refusal={api.refusal(l.seq)}
                pay={mult !== null && typeof l.points === "number" ? payOf(l.points, mult) : null}
                onCensor={() =>
                  arm.tap(`censor:${l.seq}`, true, () => {
                    mark(l.seq, true);
                    void api.censor(l.seq).finally(() => mark(l.seq, false));
                  })
                }
                onLetGo={() => api.letGo(l.seq)}
              />
            ))}
          </ul>
        )}
      </div>
    </BoothLayer>
  );
}
