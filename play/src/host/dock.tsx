//! The host dock (wave 13, D5 + D9 + D10): in a host booth (a part the
//! story marks `admin: true`, or a booth holding the mod passcode) a NEXT
//! bar sits above the taskbar — the cue to press next with its ARM → FIRE
//! button, and the night on its second line (act · phase · countdown · ⚠
//! needs) — and pulls up into a compact console: Cues · Needs · Judge ·
//! People · More. Everything it reads is the host view; everything it
//! writes is on the host allowlist (`host/api.ts`). Never in Play: restart,
//! push, go live, end, the var table, the log, the Mind (D5).

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { cueRows, cueTitleTags, type CueMarks, type CueRow } from "../../../core/src/cue-sheet.ts";
import { suggestionHint, awardSuggestion } from "../../../core/src/host-board.ts";
import { CLOCK_HELD, CuePicker, NOTHING_TO_PRESS, STORY_RUNS, clockRuns, countdownText, nextBar, sheetLayout, storyNow, useCueDesk, type FireOutcome } from "../director.tsx";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { useMomentsHold } from "../moments/provider.tsx";
import type { PrimeSession } from "../session/prime.ts";
import { useHostView, useRecap } from "./client.ts";
import { hostFire } from "./fire.ts";
import { HostContext, failText, type HostCtx } from "./kit.tsx";
import { awardsNear, groupNeeds, hostStrip, hostTabs, newestSeq, refusalReason, refusedLive, tabLabel, type HostTab, type MoreSection, type RefusedPress } from "./model.ts";
import { CuesTab } from "./tab-cues.tsx";
import { JudgeTab } from "./tab-judge.tsx";
import { MoreTab } from "./tab-more.tsx";
import { NeedsTab } from "./tab-needs.tsx";
import { PeopleTab } from "./tab-people.tsx";

const NO_MARKS: CueMarks = { last: null, fired: [] };

/** Is this booth a host (the part's `admin: true`, or the mod passcode)? */
export function isHostBooth(session: Pick<PrimeSession, "auth"> | null | undefined): boolean {
  const a = session?.auth;
  return a != null && (a.host === true || a.admin === true);
}

export function HostDock(p: {
  session: PrimeSession;
  wide: boolean;
  /** Open a guest's card in the booth (booth passes its opener). */
  openCard: (guestId: string) => void;
}) {
  // No hooks here: a booth that isn't a host renders nothing at all.
  if (!isHostBooth(p.session)) return null;
  return <HostDockOn {...p} />;
}

/** The NEXT bar's call to action: ARM, then FIRE inside the window. */
export function fireLabel(armedHere: boolean, sending: boolean, subject: boolean): string {
  if (sending) return "Sending…";
  if (armedHere) return "FIRE";
  return subject ? "PICK" : "ARM";
}

function HostDockOn({ session, wide, openCard }: { session: PrimeSession; wide: boolean; openCard: (guestId: string) => void }) {
  const auth = session.auth!;
  const client = useHostView({ token: auth.token, eventId: auth.eventId });
  const view = client.view;
  const rows = useMemo(() => (view === null ? [] : cueRows(view.interactions, view.cues)), [view]);
  const layout = useMemo(() => sheetLayout(rows), [rows]);
  const marks = view?.cues ?? NO_MARKS;

  // A refused press, kept under Needs for a minute with its `# hosts` reason:
  // the reason is the first staff-room line after the press went out.
  const [refused, setRefused] = useState<RefusedPress | null>(null);
  const pressSeq = useRef(new Map<string, number>());
  // The cue this booth pressed last (LAST · you).
  const [mine, setMine] = useState<string | null>(null);
  const calls = client.calls;
  const fire = useMemo(() => (calls === null ? null : hostFire(calls, client.fresh)), [calls, client.fresh]);
  const messages = session.messages;
  const msgRef = useRef(messages);
  msgRef.current = messages;
  const onOutcome = useCallback((row: CueRow, out: FireOutcome) => {
    if (out.ok && out.refused === true) setRefused({ id: row.id, what: row.code ?? cueTitleTags(row.title).title, at: Date.now(), afterSeq: pressSeq.current.get(row.id) ?? newestSeq(msgRef.current) });
    else if (out.ok) setMine(row.id);
  }, []);
  const desk = useCueDesk(
    rows,
    marks,
    view?.roster,
    (id, subject, value, presses) => {
      pressSeq.current.set(id, newestSeq(msgRef.current));
      return fire === null ? Promise.resolve({ ok: false, status: -1, message: "not signed in" }) : fire(id, subject, value, presses);
    },
    onOutcome,
  );

  // The clock: countdowns tick between polls; the drawer's "waiting 1:42".
  const [open, setOpen] = useState(false);
  const runs = clockRuns(view === null ? null : { phase: view.runtime, ...(view.paused === true ? { paused: true as const } : {}) });
  const [wall, setWall] = useState(() => Date.now());
  const ticking = open || (runs && (view?.countdowns?.length ?? 0) > 0) || refused !== null;
  useEffect(() => {
    if (!ticking) return;
    setWall(Date.now());
    const t = setInterval(() => setWall(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, client.receivedAt]);
  const now = Math.max(wall, client.receivedAt);
  const nowMs = storyNow(view?.clock, client.receivedAt, now, runs);
  useEffect(() => {
    if (refused !== null && !refusedLive(refused, now)) setRefused(null);
  }, [refused, now]);
  const reason = refused !== null ? refusalReason(messages, view?.staffRooms ?? session.view?.staffRooms ?? [], refused.afterSeq) : null;

  // Awards: the recap's suggested winner is offered first in the picker,
  // its value pre-filled, while the award cues are near.
  const recap = useRecap({ token: auth.token, eventId: auth.eventId }, awardsNear(rows, layout));
  const picking = desk.picking;
  const suggestion = picking !== null ? awardSuggestion(picking.id, recap) : null;
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    if (picking === null) {
      pickedFor.current = null;
      return;
    }
    if (pickedFor.current === picking.id) return;
    pickedFor.current = picking.id;
    if (suggestion !== null && desk.value === "") desk.setValue(suggestion.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, suggestion]);

  // The drawer.
  const [tab, setTab] = useState<HostTab>("cues");
  const [section, setSection] = useState<MoreSection | null>(null);
  useMomentsHold(open);
  const frame = useRef<HTMLElement | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    frame.current = el?.closest(".root") as HTMLElement | null;
  }, []);
  const keyboard = useKeyboardOpen(frame as RefObject<HTMLElement>);
  const tabs = hostTabs(view, refused !== null ? 1 : 0);
  useEffect(() => {
    if (!tabs.some((t) => t.id === tab)) setTab("cues");
  }, [tabs, tab]);

  const run = useCallback<HostCtx["run"]>(
    async (done, call) => {
      try {
        const p = call();
        if (p === null) {
          desk.setToast("Not done — the story names no event for that");
          return false;
        }
        await p;
        if (done !== "") desk.setToast(`✓ ${done.replace(/^✓ /u, "")}`);
        client.refresh();
        return true;
      } catch (e) {
        desk.setToast(failText(e));
        client.refresh();
        return false;
      }
    },
    [desk, client],
  );

  // A keyboard opened in the room (the composer) hides the bar; one opened
  // in the drawer (Announce, a search) never does.
  if (keyboard && !open) return null;
  if (view === null) {
    return (
      <div className="host-dock" ref={dockRef}>
        <div className="host-bar loading">
          <span className="host-bar-main">
            <span className="host-bar-line1">{client.error ?? "Loading the cue sheet…"}</span>
          </span>
        </div>
      </div>
    );
  }

  const bar = nextBar(rows, view.countdowns, nowMs, runs);
  const nextRow = bar.kind === "next" ? bar.row : null;
  const armedHere = nextRow !== null && desk.armed?.id === nextRow.id;
  const sending = nextRow !== null && desk.pending === nextRow.id;
  const needs = groupNeeds(view.needs).length + (refused !== null ? 1 : 0);
  const strip = hostStrip(view, layout, nowMs, needs);
  const ctx: HostCtx = {
    view,
    calls: calls!,
    session,
    now,
    run,
    go: (t, s) => {
      setTab(t);
      setSection(s ?? null);
    },
    openRoom: (channel) => {
      setOpen(false);
      session.threads.open(channel);
    },
    openCard: (id) => {
      setOpen(false);
      openCard(id);
    },
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <HostContext.Provider value={ctx}>
      <div className={`host-dock ${wide ? "wide" : ""} ${open ? "open" : ""}`} ref={dockRef} onKeyDown={onKey}>
        {open && (
          <>
            <div className="host-scrim" aria-hidden="true" onClick={() => setOpen(false)} />
            <Drawer tabs={tabs} tab={tab} setTab={(t) => { setTab(t); setSection(null); }} onClose={() => setOpen(false)} title={auth.character}>
              {tab === "cues" && <CuesTab rows={rows} layout={layout} desk={desk} mineLast={mine !== null && mine === view.cues.last} />}
              {tab === "needs" && <NeedsTab refused={refused} reason={reason} />}
              {tab === "judge" && <JudgeTab />}
              {tab === "people" && <PeopleTab />}
              {tab === "more" && <MoreTab focus={section} />}
            </Drawer>
          </>
        )}
        <div className={`host-bar ${bar.kind} ${armedHere ? "armed" : ""}`} data-testid="host-nextbar">
          <button type="button" className="host-bar-main" aria-expanded={open} aria-controls="host-drawer" aria-label={`${open ? "Close" : "Open"} the host console`} onClick={() => setOpen((o) => !o)}>
            <span className="host-bar-line1">
              <span className="host-bar-grip" aria-hidden="true">
                {open ? "▾" : "▴"}
              </span>
              {bar.kind === "next" ? (
                <>
                  <span className="host-bar-tag">{armedHere ? "ARMED" : bar.again ? "AGAIN" : "NEXT"}</span>
                  {bar.row.code !== null && <span className="cue-code">{bar.row.code}</span>}
                  <span className="host-bar-title">{cueTitleTags(bar.row.title).title}</span>
                </>
              ) : bar.kind === "countdown" ? (
                <span className="host-bar-title quiet">
                  {NOTHING_TO_PRESS}. {bar.held === true ? CLOCK_HELD : STORY_RUNS} {countdownText(bar)}
                </span>
              ) : (
                <span className="host-bar-title quiet">{NOTHING_TO_PRESS}</span>
              )}
            </span>
            <span className="host-bar-line2" role="status" aria-live="polite">
              {desk.toast !== null ? (
                <span className="host-bar-toast">{desk.toast}</span>
              ) : armedHere ? (
                <span className="host-bar-toast">{desk.subjectName !== null ? `Tap FIRE to fire → ${desk.subjectName}` : "Tap FIRE within 4 s to fire"}</span>
              ) : (
                strip.map((it, k) => (
                  <span key={k} className={it.tone !== undefined ? `host-strip-${it.tone}` : undefined}>
                    {it.text}
                  </span>
                ))
              )}
            </span>
          </button>
          {nextRow !== null && (
            <button
              type="button"
              className={`host-fire ${armedHere ? "armed" : ""}`}
              data-testid="host-fire"
              disabled={desk.locked(nextRow)}
              aria-busy={sending || undefined}
              aria-label={armedHere ? `Fire ${nextRow.code ?? nextRow.title}` : `Arm ${nextRow.code ?? nextRow.title}`}
              onClick={() => desk.tap(nextRow)}
            >
              {fireLabel(armedHere, sending, nextRow.subject && !armedHere)}
            </button>
          )}
        </div>
        <CuePicker desk={desk} roster={view.roster} suggest={suggestion !== null ? { id: suggestion.id, hint: suggestionHint(suggestion) } : null} />
      </div>
    </HostContext.Provider>
  );
}

function Drawer({ tabs, tab, setTab, onClose, title, children }: { tabs: ReturnType<typeof hostTabs>; tab: HostTab; setTab: (t: HostTab) => void; onClose: () => void; title: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [tab]);
  return (
    <div className="host-drawer w95-window" id="host-drawer" role="dialog" aria-label="Host console">
      <div className="w95-titlebar host-drawer-title">
        <span className="w95-title">▣ Host console · {title}</span>
        <button type="button" className="w95-btn w95-x" aria-label="Close the host console" onClick={onClose}>
          ▾
        </button>
      </div>
      <div className="host-tabs" role="tablist" aria-label="Host console">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={`host-tab ${t.id === tab ? "current" : ""} ${t.count !== undefined && t.count > 0 && t.id !== "cues" ? "counted" : ""}`} onClick={() => setTab(t.id)}>
            {tabLabel(t)}
          </button>
        ))}
      </div>
      <div className="host-drawer-body" role="tabpanel" ref={body}>
        {children}
      </div>
    </div>
  );
}

