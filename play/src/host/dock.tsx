//! The host dock (wave 13, D5 + D9 + D10): in a host booth (a part the
//! story marks `admin: true`, or a booth holding the mod passcode) a NEXT
//! bar sits above the taskbar — the cue to press next with its ARM → FIRE
//! button, and the night on its second line (act · phase · countdown · ⚠
//! needs) — and pulls up into a compact console: Cues · Needs · Judge ·
//! People · More. Everything it reads is the host view; everything it
//! writes is on the host allowlist (`host/api.ts`). Never in Play: restart,
//! push, go live, end, the var table, the log, the Mind (D5).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { cueRows, cueTitleTags, type CueMarks, type CueRow } from "../../../core/src/cue-sheet.ts";
import { suggestionHint, awardSuggestion } from "../../../core/src/host-board.ts";
import { CLOCK_HELD, CuePicker, NOTHING_TO_PRESS, type CueDesk, STORY_RUNS, clockRuns, countdownText, nextBar, sheetLayout, storyNow, useCueDesk, type FireOutcome } from "../director.tsx";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { useMomentsHold } from "../moments/provider.tsx";
import type { PrimeSession } from "../session/prime.ts";
import { useHostView, useRecap, type HostClient } from "./client.ts";
import { hostFire } from "./fire.ts";
import { HostContext, failText, type HostCtx } from "./kit.tsx";
import { awardsNear, barLine, groupNeeds, type BarLine, type HostStripItem, hostStrip, hostTabs, newestSeq, refusalReason, refusedLive, tabLabel, type HostTab, type MoreFocus, type RefusedPress } from "./model.ts";
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

export interface HostDockProps {
  session: PrimeSession;
  wide: boolean;
  /** Open a guest's card in the booth (booth passes its opener). */
  openCard: (guestId: string) => void;
  /** Tests: a client in place of the live poll (and no recap read). */
  client?: HostClient;
  /** Tests: the keyboard state in place of the page's focus. */
  keyboardOpen?: boolean;
}

export function HostDock(p: HostDockProps) {
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

/** An award's value box on opening the picker: the recap's suggestion, once
 *  per opening (`filledFor` is the cue last filled), never over a typed one.
 *  Null leaves the box alone. */
export function awardPrefill(pickingId: string | null, filledFor: string | null, suggestion: { value: string } | null, value: string): string | null {
  if (pickingId === null || pickingId === filledFor) return null;
  return suggestion !== null && value === "" ? suggestion.value : null;
}

function HostDockOn({ session, wide, openCard, client: injected, keyboardOpen }: HostDockProps) {
  const auth = session.auth!;
  const live = useHostView(injected !== undefined ? null : { token: auth.token, eventId: auth.eventId });
  const client = injected ?? live;
  const view = client.view;
  const rows = useMemo(() => (view === null ? [] : cueRows(view.interactions, view.cues)), [view]);
  const layout = useMemo(() => sheetLayout(rows), [rows]);
  const marks = view?.cues ?? NO_MARKS;

  // A refused press, kept under Needs for a minute with its `# hosts` reason:
  // the reason is the first staff-room line after the press went out.
  const [refused, setRefused] = useState<RefusedPress | null>(null);
  // Is the refused press this booth's latest outcome? Then its reason
  // takes the bar's second line (for REFUSED_BAR_MS) in place of the toast.
  const [refusedBar, setRefusedBar] = useState(false);
  const pressSeq = useRef(new Map<string, number>());
  // The cue this booth pressed last (LAST · you).
  const [mine, setMine] = useState<string | null>(null);
  const calls = client.calls;
  const fire = useMemo(() => (calls === null ? null : hostFire(calls, client.fresh)), [calls, client.fresh]);
  const messages = session.messages;
  const msgRef = useRef(messages);
  msgRef.current = messages;
  const setToastRef = useRef<(t: string | null) => void>(() => {});
  const onOutcome = useCallback((row: CueRow, out: FireOutcome) => {
    setRefusedBar(out.ok && out.refused === true);
    if (out.ok && out.refused === true) {
      setRefused({ id: row.id, what: row.code ?? cueTitleTags(row.title).title, at: Date.now(), afterSeq: pressSeq.current.get(row.id) ?? newestSeq(msgRef.current) });
      // The generic "# hosts says why" toast gives way to the reason itself.
      setToastRef.current(null);
    } else if (out.ok) setMine(row.id);
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
  setToastRef.current = desk.setToast;

  // The clock: countdowns tick between polls; the drawer's "waiting 1:42".
  const [open, setOpen] = useState(false);
  const runs = clockRuns(view === null ? null : { phase: view.runtime, ...(view.paused === true ? { paused: true as const } : {}) });
  const [wall, setWall] = useState(() => Date.now());
  const stale = view !== null && !client.connected;
  const ticking = open || (runs && (view?.countdowns?.length ?? 0) > 0) || refused !== null || stale;
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
  const recap = useRecap(injected !== undefined ? null : { token: auth.token, eventId: auth.eventId }, awardsNear(rows, layout));
  const picking = desk.picking;
  const suggestion = picking !== null ? awardSuggestion(picking.id, recap) : null;
  const pickedFor = useRef<string | null>(null);
  useEffect(() => {
    const fill = awardPrefill(picking?.id ?? null, pickedFor.current, suggestion, desk.value);
    pickedFor.current = picking?.id ?? null;
    if (fill !== null) desk.setValue(fill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, suggestion]);

  // The drawer.
  const [tab, setTab] = useState<HostTab>("cues");
  const [section, setSection] = useState<MoreFocus | null>(null);
  useMomentsHold(open);
  const frame = useRef<HTMLElement | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    frame.current = el?.closest(".root") as HTMLElement | null;
  }, []);
  const focusKeyboard = useKeyboardOpen(frame as RefObject<HTMLElement>);
  const keyboard = keyboardOpen ?? focusKeyboard;
  // Escape closes the console from anywhere on the page — focus may sit on
  // <body> after a button disabled itself while busy — and focus goes back
  // to the bar that opened it.
  const barMain = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    barMain.current?.focus();
  }, []);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);
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
  const armedHere = bar.kind === "next" && desk.armed?.id === bar.row.id;
  const needs = groupNeeds(view.needs).length + (refused !== null ? 1 : 0);
  const strip = hostStrip(view, layout, nowMs, needs);
  const line2 = barLine({ toast: desk.toast, connected: client.connected, error: client.error, receivedAt: client.receivedAt, now, armed: armedHere, subjectName: desk.subjectName, refused: refusedBar ? refused : null, reason });
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
  return (
    <HostContext.Provider value={ctx}>
      <div className={`host-dock ${wide ? "wide" : ""} ${open ? "open" : ""}`} ref={dockRef}>
        {open && (
          <>
            <div className="host-scrim" aria-hidden="true" onClick={close} />
            <Drawer tabs={tabs} tab={tab} setTab={(t) => { setTab(t); setSection(null); }} onClose={close} title={auth.character}>
              {tab === "cues" && <CuesTab rows={rows} layout={layout} desk={desk} mineLast={mine !== null && mine === view.cues.last} />}
              {tab === "needs" && <NeedsTab refused={refused} reason={reason} />}
              {tab === "judge" && <JudgeTab />}
              {tab === "people" && <PeopleTab />}
              {tab === "more" && <MoreTab focus={section} />}
            </Drawer>
          </>
        )}
        <HostNextBar bar={bar} desk={desk} open={open} stale={stale} line2={line2} strip={strip} barMain={barMain} onToggle={() => (open ? close() : setOpen(true))} />
        <CuePicker desk={desk} roster={view.roster} suggest={suggestion !== null ? { id: suggestion.id, hint: suggestionHint(suggestion) } : null} />
      </div>
    </HostContext.Provider>
  );
}

/** The NEXT bar: the cue (or why there is none) and the night's second
 *  line in one button that pulls the console up, then ARM → FIRE. It reads
 *  the same desk as the Cues tab, so an arm made in one fires from the
 *  other. */
export function HostNextBar({ bar, desk, open, stale, line2, strip, barMain, onToggle }: { bar: ReturnType<typeof nextBar>; desk: CueDesk; open: boolean; stale: boolean; line2: BarLine; strip: HostStripItem[]; barMain?: RefObject<HTMLButtonElement>; onToggle: () => void }) {
  const nextRow = bar.kind === "next" ? bar.row : null;
  const armedHere = nextRow !== null && desk.armed?.id === nextRow.id;
  const sending = nextRow !== null && desk.pending === nextRow.id;
  return (
    <div className={`host-bar ${bar.kind} ${armedHere ? "armed" : ""} ${stale ? "stale" : ""}`} data-testid="host-nextbar">
      {/* No aria-label: it would replace the cue and the strip, so a
          screen reader never heard what is NEXT. The verb is read first. */}
      <button type="button" className="host-bar-main" ref={barMain} aria-expanded={open} aria-controls="host-drawer" onClick={onToggle}>
        <span className="host-bar-line1">
          <span className="host-sr">{open ? "Close" : "Open"} the host console. </span>
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
          {line2.kind !== "strip" ? (
            <span className={`host-bar-toast host-bar-${line2.kind}`} data-testid="host-line2">
              {line2.text}
            </span>
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
          className={`host-fire ${armedHere ? "armed" : ""} ${stale ? "stale" : ""}`}
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
  );
}

function Drawer({ tabs, tab, setTab, onClose, title, children }: { tabs: ReturnType<typeof hostTabs>; tab: HostTab; setTab: (t: HostTab) => void; onClose: () => void; title: string; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  const x = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    body.current?.scrollTo?.({ top: 0 });
  }, [tab]);
  // Opening moves focus into the console (its close button: no keyboard).
  useEffect(() => {
    x.current?.focus();
  }, []);
  return (
    <div className="host-drawer w95-window" id="host-drawer" role="dialog" aria-label="Host console">
      <div className="w95-titlebar host-drawer-title">
        <span className="w95-title">▣ Host console · {title}</span>
        <button type="button" className="w95-btn w95-x" ref={x} aria-label="Close the host console" onClick={onClose}>
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

