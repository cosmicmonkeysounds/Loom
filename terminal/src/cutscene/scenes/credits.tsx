//! The credits on the TV and the walls (wave 44, C8). At the very end of
//! the night the story cues `screens_credits` (`Night.screen` and
//! `Night.terminals` = `credits`): every screen fetches the night's
//! `CreditsView` once for that slide (`credits-fetch.ts`, keyed on its seq)
//! and rolls `creditsRows` up the screen from the slide's `at` on the
//! server's clock, over `creditsRollMs`, so a reload lands mid-roll and the
//! TV and every wall are on the same row. Then the end card (the title and
//! the `end` lines) holds for the rest of the slide. A 404 or a failed fetch
//! draws the end card only, from a built-in fallback.
//!
//! Silent: no speech, no effects. Reduce Motion pages through
//! (`creditsPages`, cross-faded) instead of scrolling. The TV's take rolls
//! over a slow starfield, role and name side by side; a wall's is plainer
//! and bigger, each part above its name. Chrome 87 / Safari 14: no flex
//! `gap`, no `aspect-ratio`; the column is measured (ResizeObserver,
//! feature-detected) and moved with a transform only.

import "./credits.css";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { CREDITS_SLIDE, creditsRows, type CreditsRow } from "../../../../core/src/credits.ts";
import { PAGE_METRICS, END_FADE_MS, creditsPages, endCard, pageFrame, rollFrame, rollMsOf } from "../credits-roll.ts";
import { creditsCache, creditsKey, type CreditsEntry } from "../credits-fetch.ts";
import { Starfield } from "../kit/index.ts";
import type { SceneDef, SceneProps } from "../types.ts";

/** `useLayoutEffect` in the browser, `useEffect` under a server render (the tests). */
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The credits for this slide: asked once per key, re-drawn when they come. */
export function useCredits(key: string): CreditsEntry {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => creditsCache.subscribe(bump), []);
  useEffect(() => creditsCache.request(key), [key]);
  return creditsCache.peek(key);
}

/** The stage's and the column's heights (px), re-measured on a resize or a late font. */
function useHeights(on: boolean, deps: unknown) {
  const stage = useRef<HTMLDivElement | null>(null);
  const column = useRef<HTMLDivElement | null>(null);
  const [h, setH] = useState({ view: 0, content: 0 });
  useMeasureEffect(() => {
    if (!on) return;
    const measure = () => {
      const view = stage.current?.clientHeight ?? 0;
      const content = column.current?.offsetHeight ?? 0;
      setH((p) => (p.view === view && p.content === content ? p : { view, content }));
    };
    measure();
    const RO = typeof ResizeObserver === "function" ? ResizeObserver : null;
    const ro = RO === null ? null : new RO(measure);
    if (ro !== null) {
      if (stage.current !== null) ro.observe(stage.current);
      if (column.current !== null) ro.observe(column.current);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [on, deps]);
  return { stage, column, ...h };
}

/** One row of the roll. */
export function CreditsRowView({ row }: { row: CreditsRow }) {
  switch (row.kind) {
    case "title":
      return <div className="cr-row cr-title">{row.text}</div>;
    case "subtitle":
      return <div className="cr-row cr-subtitle">{row.text}</div>;
    case "heading":
      return <div className="cr-row cr-heading">{row.text}</div>;
    case "person":
      return (
        <div className="cr-row cr-person">
          <span className="cr-role">{row.role}</span>
          <span className="cr-name">{row.name}</span>
        </div>
      );
    case "line":
      return <div className="cr-row cr-line">{row.text}</div>;
    case "gap":
      return <div className="cr-row cr-gap" aria-hidden="true" />;
  }
}

function rowsOf(rows: readonly CreditsRow[]): ReactNode {
  return rows.map((r, i) => <CreditsRowView key={i} row={r} />);
}

/** The end card: the title and the end lines, held. */
function EndCard({ title, lines, opacity }: { title: string; lines: readonly string[]; opacity: number }) {
  return (
    <div className="cr-end" style={{ opacity: opacity.toFixed(3) }} data-credits-end="">
      <div className="cr-end-title">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className="cr-end-line">
          {l}
        </div>
      ))}
    </div>
  );
}

function Credits({ t, seq, state, target, reduced }: SceneProps) {
  const entry = useCredits(creditsKey(state.announceEpoch, seq));
  const view = entry.status === "ready" ? entry.view : null;
  const rows = useMemo(() => (view === null ? [] : creditsRows(view)), [view]);
  const rollMs = rollMsOf(rows);
  const tv = target === "tv";
  const end = endCard(view);
  const rolling = view !== null && !reduced;
  const { stage, column, view: viewPx, content } = useHeights(rolling, rows);
  // The column, built once per view: only its transform changes a frame.
  const column$ = useMemo(() => rowsOf(rows), [rows]);
  const pages = useMemo(() => (view === null ? [] : creditsPages(rows, PAGE_METRICS[tv ? "tv" : "wall"])), [rows, view, tv]);

  let body: ReactNode = null;
  let endOpacity = 0;
  if (entry.status === "loading") {
    body = null;
  } else if (view === null) {
    // No credits (404) or no answer: the end card only.
    endOpacity = Math.min(1, Math.max(0, t / END_FADE_MS));
  } else if (reduced) {
    const f = pageFrame(t, rollMs, pages.length);
    endOpacity = f.endOpacity;
    body = (
      <div className="cr-page" key={f.index} style={{ opacity: f.opacity.toFixed(3) }} data-credits-page={f.index}>
        {rowsOf(pages[f.index] ?? [])}
      </div>
    );
  } else {
    const f = rollFrame(t, rollMs, content, viewPx);
    endOpacity = f.endOpacity;
    body = (
      <div ref={column} className="cr-column" style={{ transform: `translate3d(0, ${Math.round(f.y)}px, 0)`, opacity: f.rollOpacity.toFixed(3), visibility: f.rollOpacity > 0 ? undefined : "hidden" }} data-credits-phase={f.phase}>
        {column$}
      </div>
    );
  }
  return (
    <div ref={stage} className={`kit-stage cr-stage ${tv ? "cr-tv" : "cr-wall"}`} data-credits={entry.status}>
      {tv && <Starfield t={reduced ? 0 : t} speed={0.04} count={180} bg="#02030b" />}
      {body}
      {rolling && <div className="cr-fade cr-fade-top" aria-hidden="true" />}
      {rolling && <div className="cr-fade cr-fade-bottom" aria-hidden="true" />}
      {endOpacity > 0 && <EndCard title={end.title} lines={end.lines} opacity={endOpacity} />}
    </div>
  );
}

export const SCENES: SceneDef[] = [
  // Silent on purpose: no `face`, no sfx. A persistent slide: held until the next cue.
  { id: "credits", when: [{ slide: CREDITS_SLIDE }], ms: "hold", tv: Credits, wall: Credits },
];
