// Wave 48 (C5): the censor's filter window, a booth layer opened from the
// tray's `🔑 n` or a pop-out's 🔑 All flagged. Header *Censored c of f
// flagged words*, then every line still to judge, oldest first: the
// program's picture and name, where and when, the line with each stem
// marked, ✂ Censor (arms: two taps) and Let it go. A refusal is said under
// its line. Empty: *Nothing to judge.* Its × / Escape / Back go through the
// booth's `closeTo`. Copy is `DRAFT w48` (`model.ts` `FILTER_COPY`).

import { useState, type ReactElement } from "react";
import { ARM_LINE, useArmButtons } from "../../arm.ts";
import type { FilterLine } from "../../types.ts";
import { PersonAvatar } from "../../ui/primitives.tsx";
import { BoothLayer } from "../layer.tsx";
import { FILTER_COPY, FILTER_LINE_MAX, agoText, clipLine, filterHeader, markSegments, whereLine } from "./model.ts";
import type { FilterApi } from "./use-filter.ts";

/** The line with its stems marked (the window's and the tests' rendering). */
export function MarkedLine({ text, hits, max = FILTER_LINE_MAX }: { text: string; hits: unknown; max?: number }): ReactElement {
  const clip = clipLine(text, hits, max);
  return (
    <p className="filter-line">
      {markSegments(clip.text, clip.hits).map((q, i) =>
        q.mark === true ? (
          <mark key={i} className="filter-hit">
            {q.text}
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
  onCensor: () => void;
  onLetGo: () => void;
}

/** One waiting line. */
export function FilterRow({ line, now, armed, busy, refusal, onCensor, onLetGo }: FilterRowProps): ReactElement {
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
      </div>
      <MarkedLine text={line.text} hits={line.hits} />
      <div className="filter-actions">
        <button type="button" className={`w95-btn filter-btn censor${armed ? " armed" : ""}`} disabled={busy} aria-pressed={armed || undefined} onClick={onCensor}>
          {busy ? "…" : FILTER_COPY.censor}
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

export function FilterWindow({ api, now, onClose }: { api: Pick<FilterApi, "view" | "waiting" | "censor" | "letGo" | "refusal">; now: number; onClose: () => void }) {
  const arm = useArmButtons();
  const [busy, setBusy] = useState<ReadonlySet<number>>(() => new Set());
  const mark = (seq: number, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(seq);
      else next.delete(seq);
      return next;
    });
  const lines = api.waiting;
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
        <p className="filter-head">{filterHeader(api.view)}</p>
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
