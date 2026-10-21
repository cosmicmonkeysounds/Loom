//! Clippy's 🎤 ON MIC bar (wave 18, BOOTH-SPEC §4.9, B6, Q2): the
//! super-performer calls its own games. In `.booth-dock`, only when the view
//! carries `PrimeView.calls`: a yellow band while one of its cues is live
//! (ARM → FIRE, the shared desk: 300 ms dead, 4 s window), a grey one while
//! it waits ("🎤 next for you" + the soonest countdown), the sheet's NEXT
//! and who is calling on line 2. ▴ opens *Your cues (n)*. Fires go through
//! `POST /api/prime/cue` (the cue sheet's path: 409 `moved` / `doorsClosed`,
//! `refused`). Clippy is never asked *Fire anyway?* on its own cues.

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { cueTitleTags, type CueMarks, type CueRow } from "../../../core/src/cue-sheet.ts";
import { ApiError } from "../client.ts";
import { ArmDrain, CueActList, CuePicker, fireCue, sheetLayout, soonestCountdown, useCueDesk, type DeskFire, type FirePost } from "../director.tsx";
import { formatLeft } from "../clock.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { CountdownSummary } from "../types.ts";
import { callsOf, type CallsView } from "./wire.ts";

/** The cue that is Clippy's to call now: only its own row that is the
 *  sheet's NEXT (and live). Never just any live row (BN-F1: cues with no
 *  `while:` are live all night, fired or not, out of order). */
export function yourCue(rows: readonly CueRow[], next: string | null = null): CueRow | null {
  return rows.find((r) => r.live && (r.next || (next !== null && r.id === next))) ?? null;
}

/** The next of Clippy's cues while none is its to call: the first in
 *  running order not yet fired (the sequence's first; else an off-sequence one). */
export function nextForYou(rows: readonly CueRow[]): CueRow | null {
  return rows.find((r) => !r.fired && r.sequence !== false) ?? rows.find((r) => !r.fired) ?? null;
}

/** The marks Clippy's desk binds an arm to. */
export function callMarks(calls: CallsView): CueMarks {
  return { last: calls.last, fired: calls.rows.filter((r) => r.fired).map((r) => r.id), presses: calls.presses, ...(calls.lastName !== null ? { lastName: calls.lastName } : {}) };
}

/** Line 2's sheet NEXT: "the same" when it is Clippy's own, else its title (a row of Clippy's) or its id. */
export function sheetNext(calls: CallsView, mine: CueRow | null): string | null {
  if (calls.next === null) return null;
  if (mine !== null && calls.next === mine.id) return "the same";
  const row = calls.rows.find((r) => r.id === calls.next);
  const title = calls.nextTitle;
  return row !== undefined ? cueTitleTags(row.title).title : title != null && title !== "" ? cueTitleTags(title).title : calls.next;
}

/** The caller chip on line 2: "📣 You" / "📣 Task Manager". */
export function callerChip(calls: CallsView, me: string): string | null {
  const c = calls.caller;
  if (c === undefined || c === null) return null;
  return c.name === me ? "📣 You" : `📣 ${c.name}`;
}

/** The desk's fire over `/api/prime/cue`. */
export function clippyFire(session: Pick<PrimeSession, "cue">, onFired?: (at: number) => void): DeskFire {
  return async (id, subject, value, presses) => {
    const post: FirePost = async (body) => {
      try {
        const r = await session.cue(body.name, body.subject ?? null, body.args ?? null, body.presses);
        return { refused: r.refused === true, moved: r.moved === true };
      } catch (e) {
        if (e instanceof ApiError && e.status === 409 && /moved/iu.test(e.message)) return { moved: true };
        throw e;
      }
    };
    const body = { name: id, label: "", ...(subject !== null ? { subject } : {}), ...(value !== undefined ? { args: { value } } : {}), ...(presses !== undefined ? { presses } : {}) };
    // Stamped as the press goes out (BN-F12): the snapshot the fire causes
    // can land before the post resolves, and PLAYER SELECT opens at once
    // only inside 10 s of this booth's own fire.
    onFired?.(Date.now());
    return fireCue(post, body, () => {});
  };
}

export interface ClippyCueBarProps {
  session: PrimeSession;
  /** Story ms now (the waiting countdown). */
  now: number | null;
  countdowns?: readonly CountdownSummary[];
  /** This booth's own fire landed (PLAYER SELECT opens at once after it). */
  onFired?: (at: number) => void;
  /** The *Call it?* pop-out arms a cue here. */
  armRef?: MutableRefObject<((id: string) => void) | null>;
}

export function ClippyCueBar(p: ClippyCueBarProps) {
  const calls = callsOf(p.session.view);
  if (calls === null) return null;
  return <CueBarOn {...p} calls={calls} />;
}

function CueBarOn({ session, calls, now, countdowns, onFired, armRef }: ClippyCueBarProps & { calls: CallsView }) {
  const me = session.auth?.character ?? "";
  const rows = calls.rows;
  const fired = useRef(onFired);
  fired.current = onFired;
  const desk = useCueDesk(rows, callMarks(calls), session.view?.guests, clippyFire(session, (at) => fired.current?.(at)));
  const [open, setOpen] = useState(false);
  const mine = yourCue(rows, calls.next);
  useEffect(() => {
    if (armRef === undefined) return;
    armRef.current = (id) => {
      const row = rows.find((r) => r.id === id);
      if (row !== undefined && desk.armed?.id !== id) desk.tap(row);
    };
    return () => {
      armRef.current = null;
    };
  });
  const sheet = sheetNext(calls, mine);
  const caller = callerChip(calls, me);
  const line2 = [desk.toast ?? (sheet !== null ? `NEXT on the sheet: ${sheet}` : null), caller].filter((x): x is string => x !== null).join(" · ");
  const waiting = mine === null ? nextForYou(rows) : null;
  const soon = soonestCountdown([...(countdowns ?? [])], now);
  const armedHere = mine !== null && desk.armed?.id === mine.id;
  const sending = mine !== null && desk.pending === mine.id;
  return (
    <div className={`cue-bar ${mine !== null ? "live" : "waiting"} ${armedHere ? "armed" : ""}`} data-testid="clippy-cue-bar">
      {open && (
        <div className="cue-bar-drawer w95-window" role="dialog" aria-label="Your cues">
          <div className="w95-titlebar">
            <span className="w95-title">🎤 Your cues ({rows.length})</span>
            <button type="button" className="w95-btn w95-x" aria-label="Close your cues" onClick={() => setOpen(false)}>
              ▾
            </button>
          </div>
          <div className="cue-bar-drawer-body">
            <CueActList rows={rows} layout={sheetLayout(rows)} query="" desk={desk} />
          </div>
        </div>
      )}
      <button type="button" className="cue-bar-main" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="cue-bar-line1">
          <span className="cue-bar-grip" aria-hidden>
            {open ? "▾" : "▴"}
          </span>
          {mine !== null ? (
            <>
              <span className="cue-bar-tag">🎤 YOUR CUE</span>
              {mine.code !== null && <span className="cue-code">{mine.code}</span>}
              <span className="cue-bar-title">{cueTitleTags(mine.title).title}</span>
            </>
          ) : (
            <>
              <span className="cue-bar-tag">🎤 next for you</span>
              <span className="cue-bar-title">{waiting !== null ? cueTitleTags(waiting.title).title : "nothing tonight"}</span>
              {soon !== null && <span className="cue-bar-clock">⏳ {formatLeft(soon.left)}</span>}
            </>
          )}
        </span>
        {line2 !== "" && (
          <span className="cue-bar-line2" role="status" aria-live="polite">
            {mine === null && sheet !== null ? `NEXT: ${sheet}${caller !== null ? ` · ${caller}` : ""}` : line2}
          </span>
        )}
      </button>
      {mine !== null && (
        <button type="button" className={`w95-btn cue-bar-fire ${armedHere ? "armed" : ""}`} disabled={desk.locked(mine)} aria-busy={sending || undefined} aria-label={armedHere ? `Fire ${mine.code ?? mine.title}` : `Arm ${mine.code ?? mine.title}`} onClick={() => desk.tap(mine)}>
          {sending ? "…" : armedHere ? `FIRE ${mine.code ?? ""}`.trim() : "ARM"}
          {armedHere && !sending && <ArmDrain key={desk.armed!.at} at={desk.armed!.at} className="host-drain-fire" />}
        </button>
      )}
      {/* A cue that needs a person (an award's winner) asks for one first. */}
      <CuePicker desk={desk} roster={(session.view?.guests ?? []).map((g) => ({ id: g.id, name: g.name, location: g.location }))} />
    </div>
  );
}
