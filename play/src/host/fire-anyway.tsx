//! *Fire anyway?* (wave 18, BOOTH-SPEC §5.3): while someone else calls the
//! show, this console's FIRE asks once. One Win95 question box; Cancel is
//! the default button (Enter / Escape cancel), *Fire anyway* sends at once
//! (the arm is spent: no second ARM). Nobody calling, or this console
//! calling, asks nothing. The host dock and the director phone both use it,
//! through `useCueDesk`'s `confirm` option.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cueTitleTags, type CueRow } from "../../../core/src/cue-sheet.ts";
import { asksBeforeFire, fireAnywayText, type CueCaller } from "./caller.ts";

interface Ask {
  row: CueRow;
  caller: CueCaller;
  answer: (fire: boolean) => void;
}

/** The cue as the question names it: its code, else its title. */
export function askCue(row: Pick<CueRow, "code" | "title">): string {
  return row.code !== null ? `${row.code} ${cueTitleTags(row.title).title}` : cueTitleTags(row.title).title;
}

/**
 * The confirm a desk takes, and the box it shows. `caller` and `me` are
 * read when FIRE is tapped (a ref), so a claim that lands while the arm
 * window runs is the one asked about.
 */
export function useFireAnyway(caller: CueCaller | null, me: ReadonlyArray<string | null | undefined>): { confirm: (row: CueRow) => Promise<boolean>; dialog: ReactNode } {
  const [ask, setAsk] = useState<Ask | null>(null);
  const now = useRef({ caller, me });
  now.current = { caller, me };
  const confirm = useCallback((row: CueRow) => {
    const { caller: c, me: m } = now.current;
    if (c === null || !asksBeforeFire(c, m)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setAsk({
        row,
        caller: c,
        answer: (fire) => {
          setAsk(null);
          resolve(fire);
        },
      });
    });
  }, []);
  // A desk that unmounts with the box up never leaves its press hanging.
  const open = useRef<Ask | null>(null);
  open.current = ask;
  useEffect(() => () => open.current?.answer(false), []);
  const dialog = ask === null ? null : <FireAnywayBox caller={ask.caller} cue={askCue(ask.row)} onFire={() => ask.answer(true)} onCancel={() => ask.answer(false)} />;
  return { confirm, dialog };
}

export function FireAnywayBox({ caller, cue, onFire, onCancel }: { caller: CueCaller; cue: string; onFire: () => void; onCancel: () => void }) {
  const t = fireAnywayText(caller, cue);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div className="host-ask-backdrop" data-testid="host-fire-anyway">
      <div
        className="w95-window host-ask"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="host-ask-title"
        aria-describedby="host-ask-body"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
        }}
      >
        <div className="w95-titlebar">
          <span className="w95-title" id="host-ask-title">
            {t.title}
          </span>
          <button type="button" className="w95-btn w95-x" aria-label="Cancel" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="host-ask-body">
          <span className="host-ask-icon" aria-hidden="true">
            !
          </span>
          <p id="host-ask-body">{t.body}</p>
        </div>
        <div className="host-ask-buttons">
          <button type="button" className="w95-btn host-ask-fire" data-testid="host-fire-anyway-yes" onClick={onFire}>
            Fire anyway
          </button>
          <button type="button" className="w95-btn host-ask-cancel" ref={cancel} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
