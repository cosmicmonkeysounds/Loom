//! Cues: the director phone's running order inside the drawer — the same
//! desk as the NEXT bar (an arm made on one fires from the other), LAST and
//! who pressed it (D9: any host may fire), a filter, the acts. Wave 18
//! (§5.2): three group boxes above the list — Who's calling (the claim),
//! NEXT (its description and `then:`), LAST (`did:` after this console's
//! own press).

import { useState } from "react";
import { cueTitleTags, type CueRow } from "../../../core/src/cue-sheet.ts";
import { ArmDrain, CueActList, DOORS_CLOSED, noCuesText, type CueDesk, type NextBar, type SheetLayout } from "../director.tsx";
import { foldName } from "../avatars.ts";
import { callerIsMe, callerLine } from "./caller.ts";
import { fireLabel } from "./fire-label.ts";
import { ActButton, useHost } from "./kit.tsx";
import { cueDescription, cueThen, didText } from "./model.ts";

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

export function CuesTab({ rows, layout, desk, mineLast, bar, stale = false }: { rows: CueRow[]; layout: SheetLayout; desk: CueDesk; mineLast: boolean; bar?: NextBar; stale?: boolean }) {
  const { view, session, callers, ownPress } = useHost();
  const [query, setQuery] = useState("");
  const last = rows.find((r) => r.last) ?? null;
  const by = lastByText(view.cues.lastBy, mineLast, view.cues.lastName, session.auth?.character);
  const next = bar?.kind === "next" ? bar.row : null;
  const did = didText(ownPress ?? null, last?.id ?? null);
  return (
    <div className="host-cues">
      {callers === true && <WhoIsCalling />}
      {next !== null && <NextBox row={next} desk={desk} stale={stale} again={bar?.kind === "next" && bar.again} then={cueThen(rows, view.cues)} />}
      {last !== null && (
        <fieldset className="host-box host-box-last" data-testid="host-last">
          <legend>LAST</legend>
          <p className="host-last">
            {last.code !== null && <span className="cue-code">{last.code}</span>}
            <span className="host-last-title">{cueTitleTags(last.title).title}</span>
            {by !== "" && (
              <span className="host-last-by" title={lastByTitle(by)}>
                · {by}
              </span>
            )}
          </p>
          {did !== null && (
            <p className="host-box-did" data-testid="host-did">
              <span className="host-box-tag">did:</span> {did}
            </p>
          )}
        </fieldset>
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

/** Who's calling (§5.2): the claim, and the one button that takes or
 *  gives it back. Any host or Run may claim; the server keeps one. */
function WhoIsCalling() {
  const { caller, claim, session } = useHost();
  const me = session.auth?.character ?? "";
  const mine = callerIsMe(caller ?? null, [me]);
  return (
    <fieldset className="host-box host-box-caller" data-testid="host-caller">
      <legend>Who's calling</legend>
      <div className="host-box-row">
        <span className="host-box-line">{callerLine(caller ?? null, [me])}</span>
        {claim !== undefined && <ActButton className={mine ? "" : "host-primary"} label={mine ? "Stop calling" : "📣 I'll call"} onClick={() => claim(!mine)} />}
      </div>
    </fieldset>
  );
}

/** NEXT (§5.2): the same desk as the bar (an arm made here fires there),
 *  what the cue does (two lines, ▸ more), and what is on deck after it. */
function NextBox({ row, desk, stale, again, then }: { row: CueRow; desk: CueDesk; stale: boolean; again: boolean; then: CueRow | null }) {
  const { view } = useHost();
  const [more, setMore] = useState(false);
  const armedHere = desk.armed?.id === row.id;
  const sending = desk.pending === row.id;
  const description = cueDescription(row, view.cues);
  return (
    <fieldset className={`host-box host-box-next ${armedHere ? "armed" : ""}`} data-testid="host-next-box">
      <legend>{again ? "AGAIN" : "NEXT"}</legend>
      <div className="host-box-row">
        <span className="host-box-cue">
          {row.code !== null && <span className="cue-code">{row.code}</span>}
          <span className="host-box-title">{cueTitleTags(row.title).title}</span>
        </span>
        <button
          type="button"
          className={`host-fire ${armedHere ? "armed" : ""} ${stale ? "stale" : ""}`}
          disabled={desk.locked(row)}
          aria-busy={sending || undefined}
          aria-label={armedHere ? `Fire ${row.code ?? row.title}` : `Arm ${row.code ?? row.title}`}
          onClick={() => desk.tap(row)}
        >
          {fireLabel(armedHere, sending, row.subject && !armedHere)}
          {armedHere && !sending && <ArmDrain key={desk.armed!.at} at={desk.armed!.at} className="host-drain-fire" />}
        </button>
      </div>
      {description !== null && (
        <>
          <p className={`host-box-desc ${more ? "open" : ""}`} data-testid="host-next-desc">
            {description}
          </p>
          {description.length > DESC_FOLD && (
            <button type="button" className="host-box-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {more ? "▴ less" : "▸ more"}
            </button>
          )}
        </>
      )}
      {then !== null && (
        <p className="host-box-then" data-testid="host-then">
          <span className="host-box-tag">then:</span> {then.code !== null ? `${then.code} ` : ""}
          {cueTitleTags(then.title).title}
        </p>
      )}
    </fieldset>
  );
}

/** About two lines at 390 px: longer descriptions fold behind ▸ more. */
const DESC_FOLD = 90;
