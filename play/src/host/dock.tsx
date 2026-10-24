//! The host dock (wave 13, D5 + D9 + D10): in a host booth (a part the
//! story marks `admin: true`, or a booth holding the mod passcode) a NEXT
//! bar sits above the taskbar — the cue to press next with its ARM → FIRE
//! button, and the night on its second line (act · phase · countdown · ⚠
//! needs) — and pulls up into a compact console: Cues · Needs · Judge ·
//! People · More. Everything it reads is the host view; everything it
//! writes is on the host allowlist (`host/api.ts`). Never in Play: restart,
//! push, go live, end, the var table, the log, the Mind (D5).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { cueRows, cueTitleTags, type CueMarks, type CueRow } from "../../../core/src/cue-sheet.ts";
import { suggestionHint, awardSuggestion } from "../../../core/src/host-board.ts";
import { ArmDrain, CLOCK_HELD, CuePicker, NOTHING_TO_PRESS, type CueDesk, STORY_RUNS, clockRuns, countdownText, nextBar, sheetLayout, storyNow, useCueDesk, type FireOutcome } from "../director.tsx";
import { eventRoot } from "../chrome/balloon.tsx";
import { URGENT_S } from "../clock.ts";
import { useKeyboardOpen } from "../chrome/keyboard.ts";
import { PopOutDock } from "../moments/popout.tsx";
import { useMomentsHold } from "../moments/provider.tsx";
import type { PrimeSession } from "../session/prime.ts";
import type { HostView } from "../types.ts";
import { useHostView, useRecap, type HostClient } from "./client.ts";
import { hostFire } from "./fire.ts";
import { HostContext, failText, type HostCtx } from "./kit.tsx";
import { OPTIMISTIC_MS, awardsNear, barLine, cueDescription, groupNeeds, hostWanted, wantedNeed, type BarLine, type HostStripItem, hostStrip, hostTabs, newestSeq, refusalReason, refusedLive, tabLabel, type HostTab, type MoreFocus, type OwnPress, type RefusedPress } from "./model.ts";
import { callerKnown, callerText, cueCaller, shownCaller, type CallerFlip } from "./caller.ts";
import { useFireAnyway } from "./fire-anyway.tsx";
import { CuesTab } from "./tab-cues.tsx";
import { JudgeTab } from "./tab-judge.tsx";
import { MoreTab } from "./tab-more.tsx";
import { NeedsTab } from "./tab-needs.tsx";
import { PeopleTab } from "./tab-people.tsx";
import { dockKeyboard, focusInside, sheetCloseIn, useBalloonClearance, useFocusInside, useIsoLayoutEffect, useKeyboardFit, useSettledTrue, type KeyboardFit } from "./viewport.ts";

/** How long the NEXT bar stays away after typing in the console ends. */
const BAR_BACK_MS = 250;

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
  /** Open the Wanted board read-only (the booth's `WantedBoard`, wave 18
   *  §5.5); `booth/app.tsx` supplies it. Without it Needs lists the wanted
   *  programs in place. */
  openWanted?: () => void;
}

export function HostDock(p: HostDockProps) {
  // No hooks here: a booth that isn't a host renders nothing at all.
  if (!isHostBooth(p.session)) return null;
  return <HostDockOn {...p} />;
}

/** What the NEXT bar adds while the show is paused: the guest's NOW bar's
 *  Win95 word, after the cue (D3). FIRE stays live: a press still lands. */
export const PAUSED_MARK = " (Paused)";

/** Is the show paused (the doors open, the story clock stopped)? Not
 *  before the doors: the strip says 🚪 doors closed then. */
export function hostPaused(view: Pick<HostView, "runtime" | "paused" | "doorsClosed">): boolean {
  if (view.doorsClosed === true || view.runtime === "idle") return false;
  return view.runtime === "paused" || view.paused === true;
}

export { fireLabel } from "./fire-label.ts";
import { fireLabel } from "./fire-label.ts";

/** An award's value box on opening the picker: the recap's suggestion, once
 *  per opening (`filledFor` is the cue last filled), never over a typed one.
 *  Null leaves the box alone. */
export function awardPrefill(pickingId: string | null, filledFor: string | null, suggestion: { value: string } | null, value: string): string | null {
  if (pickingId === null || pickingId === filledFor) return null;
  return suggestion !== null && value === "" ? suggestion.value : null;
}

function HostDockOn({ session, wide, openCard, client: injected, keyboardOpen, openWanted }: HostDockProps) {
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
  // The cue this booth pressed last (LAST · you), with what it did (did:).
  const [mine, setMine] = useState<string | null>(null);
  const [ownPress, setOwnPress] = useState<OwnPress | null>(null);
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
    } else if (out.ok) {
      setMine(row.id);
      setOwnPress({ id: row.id, said: out.said ?? [], staff: out.staff ?? [], at: Date.now() });
    }
  }, []);
  // Who is calling the show (wave 18 B8): this console's own claim reads
  // back at once, the view after OPTIMISTIC_MS; a FIRE while someone else
  // calls asks once.
  const me = auth.character;
  const [flip, setFlip] = useState<CallerFlip | null>(null);
  const callers = view !== null && callerKnown(view.cues);
  const caller = shownCaller(view !== null ? cueCaller(view.cues) : null, flip, me, Date.now(), OPTIMISTIC_MS);
  const anyway = useFireAnyway(caller, [me]);
  const desk = useCueDesk(
    rows,
    marks,
    view?.roster,
    (id, subject, value, presses) => {
      pressSeq.current.set(id, newestSeq(msgRef.current));
      return fire === null ? Promise.resolve({ ok: false, status: -1, message: "not signed in" }) : fire(id, subject, value, presses);
    },
    onOutcome,
    { confirm: anyway.confirm },
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
  // An award only one program can take (G10 is MS Paint's) offers them first.
  const suggestion = picking !== null ? awardSuggestion(picking.id, recap, view?.awardOnly?.[picking.id]) : null;
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
  const [dockNode, setDockNode] = useState<HTMLDivElement | null>(null);
  const [frameNode, setFrameNode] = useState<HTMLElement | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    const root = (el?.closest(".root") as HTMLElement | null) ?? null;
    if (el !== null) frame.current = root;
    setDockNode(el);
    if (el !== null) setFrameNode(root);
  }, []);
  const focusKeyboard = useKeyboardOpen(frame as RefObject<HTMLElement>);
  const keyboard = keyboardOpen ?? focusKeyboard;
  // The keyboard rule (item 1): a field in the room hides the dock; a field
  // in the console (Announce, a search, the award value, the answer box)
  // hides only the NEXT bar — the drawer and the field stay, above the
  // phone's keyboard.
  const inDockFocus = useFocusInside(dockNode);
  const inDock = inDockFocus || (keyboard && focusInside(dockNode));
  const kb = dockKeyboard(keyboard, inDock, open);
  const typing = keyboard && inDock;
  const barAway = useSettledTrue(!kb.bar, BAR_BACK_MS);
  // Where the dock's top sits with the bar and the taskbar showing: the
  // drawer keeps its bottom there while they are away (no slide under a
  // finger), and lifts above the keyboard.
  const restTop = useRef<number | null>(null);
  useIsoLayoutEffect(() => {
    if (!typing && !barAway && dockNode !== null) restTop.current = dockNode.getBoundingClientRect().top;
  });
  const fit = useKeyboardFit(typing || barAway, dockNode, restTop);
  useBalloonClearance(open, wide, dockNode, frameNode, fit);
  // Escape closes the console from anywhere on the page — focus may sit on
  // <body> after a button disabled itself while busy — and focus goes back
  // to the bar that opened it. A sheet open over the console (a QR, the
  // answer sheet) closes first, alone. It listens where the dock lives: the
  // document, or a Run → Players pane's shadow root (whose host keeps keys
  // from the document).
  const barMain = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    barMain.current?.focus();
  }, []);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const root = eventRoot(dockNode);
    const onKey = (ev: Event) => {
      const e = ev as globalThis.KeyboardEvent;
      if (e.key !== "Escape") return;
      e.stopPropagation();
      const sheet = sheetCloseIn(dockNode);
      if (sheet !== null) sheet.click();
      else close();
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [open, close, dockNode]);
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

  // A keyboard opened in the room (the composer) hides the dock; one opened
  // in the console hides only the bar (above).
  if (!kb.render) return null;
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
  const needs = groupNeeds(view.needs).length + (refused !== null ? 1 : 0) + (wantedNeed(hostWanted(view)) !== null ? 1 : 0) + (view.rejoins?.length ?? 0);
  // The countdown the bar's first line already reads ("nothing to press …
  // ⏱ Midnight in 59:28") leaves the strip on a phone.
  const strip = hostStrip(view, layout, nowMs, needs, bar.kind === "countdown", callers ? callerText(caller, [me], view.parts.map((p) => p.id)) : null);
  const paused = hostPaused(view);
  const line2 = barLine({ toast: desk.toast, connected: client.connected, error: client.error, receivedAt: client.receivedAt, now, armed: armedHere, subjectName: desk.subjectName, refused: refusedBar ? refused : null, reason, description: bar.kind === "next" ? cueDescription(bar.row, view.cues) : null });
  const claim = async (on: boolean): Promise<boolean> => {
    setFlip({ on, at: Date.now() });
    const ok = await run(on ? "📣 You're calling the show" : "📣 You stopped calling", () => calls!.caller(on));
    if (!ok) setFlip(null);
    return ok;
  };
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
    ...(openWanted !== undefined
      ? {
          openWanted: () => {
            setOpen(false);
            openWanted();
          },
        }
      : {}),
    caller,
    callers,
    claim,
    ownPress,
  };
  const toggle = () => {
    if (open) return close();
    // The bar's one line cuts a refusal's reason short: open on Needs,
    // where it is whole.
    if (line2.kind === "refused") setTab("needs");
    setOpen(true);
  };
  return (
    <HostContext.Provider value={ctx}>
      <div className={`host-dock ${wide ? "wide" : ""} ${open ? "open" : ""}`} ref={dockRef}>
        {open && (
          <>
            <div className="host-scrim" aria-hidden="true" onClick={close} />
            <Drawer tabs={tabs} tab={tab} setTab={(t) => { setTab(t); setSection(null); }} onClose={close} title={auth.character} fit={fit}>
              {tab === "cues" && <CuesTab rows={rows} layout={layout} desk={desk} mineLast={mine !== null && mine === view.cues.last} bar={bar} stale={stale} />}
              {tab === "needs" && <NeedsTab refused={refused} reason={reason} />}
              {tab === "judge" && <JudgeTab />}
              {tab === "people" && <PeopleTab />}
              {tab === "more" && <MoreTab focus={section} />}
            </Drawer>
          </>
        )}
        {!barAway && (
          <HostNextBar
            bar={bar}
            desk={desk}
            open={open}
            stale={stale}
            paused={paused}
            line2={line2}
            strip={strip}
            barMain={barMain}
            onToggle={toggle}
            onCaller={() => {
              // The chip opens the console on Cues, at Who's calling.
              setTab("cues");
              setSection(null);
            }}
          />
        )}
        <CuePicker desk={desk} roster={view.roster} suggest={suggestion !== null ? { id: suggestion.id, hint: suggestionHint(suggestion) } : null} />
        {anyway.dialog}
      </div>
    </HostContext.Provider>
  );
}

/** The NEXT bar: the cue (or why there is none) and the night's second
 *  line in one button that pulls the console up, then ARM → FIRE. It reads
 *  the same desk as the Cues tab, so an arm made in one fires from the
 *  other. */
export function HostNextBar({ bar, desk, open, stale, paused = false, line2, strip, barMain, onToggle, onCaller }: { bar: ReturnType<typeof nextBar>; desk: CueDesk; open: boolean; stale: boolean; paused?: boolean; line2: BarLine; strip: HostStripItem[]; barMain?: Ref<HTMLButtonElement>; onToggle: () => void; onCaller?: () => void }) {
  const nextRow = bar.kind === "next" ? bar.row : null;
  const armedHere = nextRow !== null && desk.armed?.id === nextRow.id;
  const sending = nextRow !== null && desk.pending === nextRow.id;
  return (
    <div className={`host-bar ${bar.kind} ${armedHere ? "armed" : ""} ${stale ? "stale" : ""} ${paused ? "paused" : ""} ${line2.kind === "refused" || line2.kind === "stale" ? "long2" : ""}`} data-testid="host-nextbar">
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
              {bar.row.code !== null && <span className="cue-code host-code-wide">{bar.row.code}</span>}
              <span className="host-bar-title">
                {cueTitleTags(bar.row.title).title}
                {paused && <span className="host-bar-paused">{PAUSED_MARK}</span>}
              </span>
            </>
          ) : bar.kind === "countdown" ? (
            <span className={`host-bar-title quiet ${bar.left < URGENT_S && bar.held !== true ? "urgent" : ""}`}>
              {NOTHING_TO_PRESS}. {bar.held === true ? CLOCK_HELD : STORY_RUNS} {countdownText(bar)}
            </span>
          ) : (
            <span className="host-bar-title quiet">
              {NOTHING_TO_PRESS}
              {paused && <span className="host-bar-paused">{PAUSED_MARK}</span>}
            </span>
          )}
        </span>
        <span className="host-bar-line2" role="status" aria-live="polite">
          {/* On a phone the code chip moves here, so the title keeps line 1. */}
          {nextRow?.code != null && (
            <span className="cue-code host-code-narrow" aria-hidden="true">
              {nextRow.code}
            </span>
          )}
          {line2.kind !== "strip" ? (
            <span className={`host-bar-toast host-bar-${line2.kind}`} data-testid="host-line2">
              {line2.text}
            </span>
          ) : (
            strip.map((it, k) => (
              <span
                key={k}
                className={stripClass(it)}
                // The chip's tap opens on Cues (the bar's own tap opens the console).
                onClick={it.kind === "caller" ? onCaller : undefined}
              >
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
          {armedHere && !sending && <ArmDrain key={desk.armed!.at} at={desk.armed!.at} className="host-drain-fire" />}
        </button>
      )}
    </div>
  );
}

/** One strip item's classes: tone, kind, and when a phone drops it. */
export function stripClass(it: HostStripItem): string | undefined {
  const c = [it.tone !== undefined ? `host-strip-${it.tone}` : "", it.kind !== undefined ? `host-strip-${it.kind}` : "", it.optional === true ? "host-strip-optional" : "", it.drop !== undefined ? `host-strip-drop${it.drop}` : ""];
  return c.filter((x) => x !== "").join(" ") || undefined;
}

function Drawer({ tabs, tab, setTab, onClose, title, fit, children }: { tabs: ReturnType<typeof hostTabs>; tab: HostTab; setTab: (t: HostTab) => void; onClose: () => void; title: string; fit: KeyboardFit | null; children: ReactNode }) {
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
    <div
      className="host-drawer w95-window"
      id="host-drawer"
      role="dialog"
      aria-label="Host console"
      // Above the phone's keyboard while a field in it has focus.
      style={fit !== null ? { bottom: `calc(100% + ${fit.lift}px)`, ...(fit.height !== null ? { height: `min(72vh, ${fit.height}px)`, minHeight: 0 } : {}) } : undefined}
    >
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
        <DockSlot />
        {children}
      </div>
    </div>
  );
}


/** The pop-out strip's slot at the top of the console's body (§5.7): a
 *  pop-out docks as a strip inside the console, never over the NEXT bar. */
function DockSlot() {
  return <PopOutDock />;
}
