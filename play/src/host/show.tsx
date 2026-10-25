//! The Show window (wave 25, docs/loom-house-desk.md §6.2): a host's home,
//! in place of the pull-up drawer. Top to bottom: the night strip (act ·
//! phase · show clock · caller · paused), Who's calling, a big NEXT card
//! (ARM → FIRE with the drain, what it does, `then:`), the console's last
//! word (a toast, a refusal, a stale view), LAST with `did:`, then the
//! sections — *Your jobs* (the NOW card laid open), *Needs you*, *Coming
//! up*, Judge, the cue sheet, People and More. The sections are the
//! drawer's own tabs (`tab-*.tsx`), unchanged, on the same console
//! (`HostConsole` in `dock.tsx`): an arm made here fires from the slim bar.
//! The rules are `show-model.ts`.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CLOCK_HELD, NOTHING_TO_PRESS, STORY_RUNS, countdownText } from "../director.tsx";
import { clockText, showClockOf, useShowClock } from "../show-clock.ts";
import { useHostConsole, type HostConsoleState } from "./dock.tsx";
import { HostContext, HostEmpty } from "./kit.tsx";
import { cueThen } from "./model.ts";
import { comingUp, nightStrip, sectionHead, sectionOpen, showClockChip, showSections, type ShowSectionId, type ShowSectionInfo } from "./show-model.ts";
import { CueSheet, LastBox, NextBox, WhoIsCalling } from "./tab-cues.tsx";
import { JudgeTab } from "./tab-judge.tsx";
import { MoreTab } from "./tab-more.tsx";
import { NeedsTab } from "./tab-needs.tsx";
import { PeopleTab } from "./tab-people.tsx";

export interface HostShowProps {
  /** *Your jobs*: the booth's `NowJobs` (the NOW card laid open). */
  jobs?: ReactNode;
  /** How many live objectives the host has (the section's count). */
  jobCount?: number;
  /** The booth's 🗂 Guests list (People's head). */
  openGuests?: () => void;
}

/** The Show window; nothing outside a host console. */
export function HostShowWindow(p: HostShowProps) {
  const c = useHostConsole();
  if (c === null) return null;
  if (c.view === null || c.ctx === null) {
    return (
      <div className="screen side host-show" data-testid="host-show">
        <ShowTitle who={c.ctx?.session.auth?.character ?? null} paused={false} />
        <p className="host-empty">{c.client.error ?? "Loading the cue sheet…"}</p>
      </div>
    );
  }
  return (
    <HostContext.Provider value={c.ctx}>
      <ShowBody c={c} {...p} />
    </HostContext.Provider>
  );
}

function ShowBody({ c, jobs, jobCount = 0, openGuests }: HostShowProps & { c: HostConsoleState }) {
  const view = c.view!;
  const clock = useShowClock(showClockOf(view));
  const night = nightStrip(c.strip, showClockChip(clock === null ? null : clockText(clock.minutes), clock?.running ?? true));
  const sections = showSections({ jobs: jobCount, needs: c.needs, judging: view.judging != null ? { pending: view.judging.pending.length } : null, people: view.people.length });
  const [folds, setFolds] = useState<Partial<Record<ShowSectionId, boolean>>>({});
  const root = useRef<HTMLDivElement>(null);
  // A jump (a need's row, the caller chip, a refused press) opens its
  // section and scrolls to it, once per jump.
  const jump = c.jump;
  const scrolled = useRef(0);
  useEffect(() => {
    if (jump === null || jump.to === "top") return;
    const to = jump.to;
    setFolds((f) => (f[to] === true ? f : { ...f, [to]: true }));
  }, [jump]);
  useEffect(() => {
    if (jump === null || scrolled.current === jump.seq) return;
    scrolled.current = jump.seq;
    // Matched by attribute value, never a selector string.
    const hit = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-show]") ?? []).find((el) => el.dataset["show"] === jump.to);
    hit?.scrollIntoView?.({ block: "start" });
  }, [jump, folds]);
  const bar = c.bar!;
  const line2 = c.line2!;
  const coming = comingUp(c.rows, c.layout, view.countdowns, c.nowMs);
  const body = (id: ShowSectionId): ReactNode => {
    switch (id) {
      case "jobs":
        return jobs ?? <HostEmpty>No job for you right now.</HostEmpty>;
      case "needs":
        return <NeedsTab refused={c.refused} reason={c.reason} />;
      case "coming":
        return <ComingUp coming={coming} />;
      case "judge":
        return <JudgeTab />;
      case "cues":
        return <CueSheet rows={c.rows} layout={c.layout} desk={c.desk} />;
      case "people":
        return (
          <>
            {openGuests !== undefined && (
              <button type="button" className="w95-btn host-show-guests" onClick={openGuests}>
                🗂 Every guest, with their cards
              </button>
            )}
            <PeopleTab />
          </>
        );
      case "more":
        return <MoreTab focus={jump?.to === "more" ? jump.more : null} />;
    }
  };
  return (
    <div className="screen side host-show" data-testid="host-show" ref={root}>
      <ShowTitle who={c.ctx?.session.auth?.character ?? null} paused={c.paused} />
      <div className="host-show-scroll">
        <div className="host-show-strip" role="group" aria-label="The night" data-show="top">
          {night.map((it, k) => (
            <span key={k} className={`host-show-chip ${it.kind}${it.tone !== undefined ? ` ${it.tone}` : ""}`}>
              {it.text}
            </span>
          ))}
        </div>
        {c.ctx?.callers === true && <WhoIsCalling />}
        {bar.kind === "next" ? (
          <NextBox big row={bar.row} desk={c.desk} stale={c.stale} again={bar.again} then={cueThen(c.rows, view.cues)} />
        ) : (
          <fieldset className="host-box host-show-next none" data-testid="host-next-box">
            <legend>NEXT</legend>
            <p className="host-show-nothing">
              {bar.kind === "countdown" ? `${NOTHING_TO_PRESS}. ${bar.held === true ? CLOCK_HELD : STORY_RUNS} ${countdownText(bar)}` : NOTHING_TO_PRESS}
            </p>
          </fieldset>
        )}
        <p className={`host-show-status${line2.kind !== "strip" ? ` ${line2.kind}` : ""}`} role="status" aria-live="polite" data-testid="host-show-status">
          {line2.kind !== "strip" ? line2.text : ""}
        </p>
        <LastBox rows={c.rows} mineLast={c.mineLast} />
        {sections.map((s) => (
          <ShowFold key={s.id} info={s} open={sectionOpen(s, folds)} onToggle={() => setFolds((f) => ({ ...f, [s.id]: !sectionOpen(s, f) }))}>
            {body(s.id)}
          </ShowFold>
        ))}
      </div>
    </div>
  );
}

/** The window's title bar (the NOW card steps aside while Show is up, so
 *  this bar keeps the notch's room): ▣ SHOW · the host's part. */
function ShowTitle({ who, paused }: { who: string | null; paused: boolean }) {
  return (
    <div className={`host-show-title${paused ? " paused" : ""}`}>
      <span className="host-show-title-k">▣ SHOW</span>
      {who !== null && who !== "" && <span className="host-show-title-who">{who}</span>}
      {paused && <span className="host-show-title-paused">(Paused)</span>}
    </div>
  );
}

/** One section: a 44 px head that folds it, and its body. */
function ShowFold({ info, open, onToggle, children }: { info: ShowSectionInfo; open: boolean; onToggle: () => void; children: ReactNode }) {
  const waits = (info.id === "needs" || info.id === "judge") && (info.count ?? 0) > 0;
  return (
    <section className="host-show-fold" data-show={info.id}>
      <h3 className="host-show-h">
        <button type="button" className={`host-show-head${waits ? " waits" : ""}`} aria-expanded={open} onClick={onToggle}>
          <span className="host-show-caret" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
          {sectionHead(info)}
        </button>
      </h3>
      {open && <div className="host-show-body">{children}</div>}
    </section>
  );
}

/** *Coming up*: the next cues of the act, then the countdowns. */
function ComingUp({ coming }: { coming: ReturnType<typeof comingUp> }) {
  if (coming.cues.length === 0 && coming.countdowns.length === 0) return <HostEmpty>Nothing more in this act, and no countdown running.</HostEmpty>;
  return (
    <ul className="host-show-coming">
      {coming.cues.map((q) => (
        <li key={q.id} className={`host-show-cue${q.live ? "" : " off"}`}>
          {q.code !== null && <span className="cue-code">{q.code}</span>}
          <span className="host-show-cue-title">{q.title}</span>
        </li>
      ))}
      {coming.countdowns.map((d) => (
        <li key={d.label} className={`host-show-cd${d.urgent ? " urgent" : ""}`}>
          {d.text}
        </li>
      ))}
    </ul>
  );
}
