//! Cues: the director phone's running order inside the drawer — the same
//! desk as the NEXT bar (an arm made on one fires from the other), LAST and
//! who pressed it (D9: any host may fire), a filter, the acts.

import { useState } from "react";
import { cueTitleTags, type CueRow } from "../../../core/src/cue-sheet.ts";
import { CueActList, DOORS_CLOSED, noCuesText, type CueDesk, type SheetLayout } from "../director.tsx";
import { foldName } from "../avatars.ts";
import { useHost } from "./kit.tsx";

/** Who pressed LAST, as far as this booth can tell. The server's name for
 *  the presser (`cues.lastName`: "Task Manager", a director's name) wins
 *  when it has one — "you" when it names this booth's own part (`me`), so a
 *  reload still says so and another host repeating the cue is not "you".
 *  Without it (an older server): this booth's own press (`mine`), the
 *  story, else another host / the director. */
export function lastByText(lastBy: string | null | undefined, mine: boolean, lastName?: string | null, me?: string | null): string {
  const named = lastBy === "director" && typeof lastName === "string" && lastName.trim() !== "" ? lastName.trim() : null;
  if (named !== null) {
    if (typeof me === "string" && me.trim() !== "") return foldName(named) === foldName(me) ? "you" : named;
    return mine ? "you" : named;
  }
  if (lastBy === "story") return "the story";
  if (mine) return "you";
  if (lastBy === "director") return "a host or the director";
  return "";
}

/** The LAST line's tooltip: "Task Manager pressed LAST". */
export function lastByTitle(by: string): string {
  return `${by.charAt(0).toUpperCase()}${by.slice(1)} pressed LAST`;
}

export function CuesTab({ rows, layout, desk, mineLast }: { rows: CueRow[]; layout: SheetLayout; desk: CueDesk; mineLast: boolean }) {
  const { view, session } = useHost();
  const [query, setQuery] = useState("");
  const last = rows.find((r) => r.last) ?? null;
  const by = lastByText(view.cues.lastBy, mineLast, view.cues.lastName, session.auth?.character);
  return (
    <div className="host-cues">
      {last !== null && (
        <p className="host-last" data-testid="host-last">
          <span className="host-last-tag">LAST</span>
          {last.code !== null && <span className="cue-code">{last.code}</span>}
          <span className="host-last-title">{cueTitleTags(last.title).title}</span>
          {by !== "" && (
            <span className="host-last-by" title={lastByTitle(by)}>
              · {by}
            </span>
          )}
        </p>
      )}
      <input className="host-filter" type="search" aria-label="Filter cues" placeholder="Filter cues (code or words)" value={query} onChange={(e) => setQuery(e.target.value)} />
      {view.doorsClosed === true && rows.length > 0 && <p className="host-note">{DOORS_CLOSED}</p>}
      {desk.armed !== null && desk.subjectName !== null && (
        <p className="host-note">
          Armed for {desk.subjectName}
          {desk.armed.value !== undefined ? ` (value ${desk.armed.value})` : ""}. Tap the cue again to fire.
        </p>
      )}
      {rows.length === 0 ? <p className="host-empty">{noCuesText({ phase: view.runtime, ...(view.doorsClosed === true ? { doorsClosed: true as const } : {}) })}</p> : <CueActList rows={rows} layout={layout} query={query} desk={desk} />}
    </div>
  );
}
