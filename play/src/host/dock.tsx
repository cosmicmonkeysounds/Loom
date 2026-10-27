//! The host console (wave 13, D5 + D9 + D10; wave 25, the house desk): in
//! a host booth (a part the story marks `admin: true`, or a booth holding
//! the mod passcode) one console reads the host view and owns the cue desk
//! (ARM → FIRE, the caller claim, *Fire anyway?*, a refused press and its
//! reason, the award prefill). Two places draw it: the **Show** window
//! (`host/show.tsx`, the host's home) and the slim **NEXT bar** above the
//! taskbar, which shows only while Show is off screen (Chats, the Desk, a
//! room) and opens Show on a tap — the pull-up drawer is gone (wave 25).
//! Everything it reads is the host view; everything it writes is on the
//! host allowlist (`host/api.ts`). Never in Play: restart, push, go live,
//! end, the var table, the log, the Mind (D5).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { cueRows, cueTitleTags, type CueMarks, type CueRow } from "../../../core/src/cue-sheet.ts";
import { suggestionHint, awardSuggestion } from "../../../core/src/host-board.ts";
import { ArmDrain, armWindow, CLOCK_HELD, CuePicker, NOTHING_TO_PRESS, type CueDesk, type NextBar, type SheetLayout, STORY_RUNS, clockRuns, countdownText, nextBar, sheetLayout, storyNow, useCueDesk, type FireOutcome } from "../director.tsx";
import { URGENT_S } from "../clock.ts";
import type { PrimeSession } from "../session/prime.ts";
import type { HostView } from "../types.ts";
import { useHostView, useRecap, type HostClient } from "./client.ts";
import { hostFire } from "./fire.ts";
import { failText, type HostCtx } from "./kit.tsx";
import { OPTIMISTIC_MS, awardsNear, barLine, cueDescription, needsCount, type BarLine, type HostStripItem, hostStrip, newestSeq, refusalReason, refusedLive, type MoreFocus, type OwnPress, type RefusedPress } from "./model.ts";
import { callerKnown, callerText, cueCaller, shownCaller, type CallerFlip } from "./caller.ts";
import { useFireAnyway } from "./fire-anyway.tsx";
import { showTarget, type ShowSectionId } from "./show-model.ts";
import { talkChipShown } from "./talk-model.ts";

const NO_MARKS: CueMarks = { last: null, fired: [] };

/** Is this booth a host (the part's `admin: true`, or the mod passcode)? */
export function isHostBooth(session: Pick<PrimeSession, "auth"> | null | undefined): boolean {
  const a = session?.auth;
  return a != null && (a.host === true || a.admin === true);
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

/** A jump inside Show (a need's row, the caller chip, a refused press):
 *  the section to open and scroll to, and More's own section. */
export interface ShowJump {
  to: ShowSectionId | "top";
  more: MoreFocus | null;
  /** Bumps per jump, so the same jump twice scrolls twice. */
  seq: number;
}

/** What Show and the slim bar read: the one console of this booth. */
export interface HostConsoleState {
  view: HostView | null;
  client: HostClient;
  /** The tabs' context (`useHost()`); null until the first view. */
  ctx: HostCtx | null;
  desk: CueDesk;
  rows: CueRow[];
  layout: SheetLayout;
  bar: NextBar | null;
  line2: BarLine | null;
  strip: HostStripItem[];
  paused: boolean;
  stale: boolean;
  /** What waits on a host (Needs' count). */
  needs: number;
  /** This booth pressed LAST. */
  mineLast: boolean;
  refused: RefusedPress | null;
  reason: string | null;
  /** Story ms now (null: no clock). */
  nowMs: number | null;
  /** Show is on screen: the bar steps aside. */
  showing: boolean;
  keyboard: boolean;
  wide: boolean;
  jump: ShowJump | null;
  /** Bring Show on screen (on Needs, for a refused press). */
  openShow: (atNeeds?: boolean) => void;
  /** Show, at Who's calling. */
  openCaller: () => void;
  /** Show, at the 🤖 Talk card (wave 32: the slim bar's chip). */
  openTalk: () => void;
  /** The Talk card's text box (wave 32): held here, so a draft survives
   *  Show leaving the screen and a refused send. */
  talkDraft: string;
  /** A value, or an updater (a send clears only the words it sent). */
  setTalkDraft: (t: string | ((draft: string) => string)) => void;
  /** The award picker and *Fire anyway?* (drawn by the bar's slot, always). */
  picker: ReactNode;
  dialog: ReactNode;
}

/** `undefined`: no console above (a lone `HostDock`: it makes its own). */
const ConsoleContext = createContext<HostConsoleState | null | undefined>(undefined);

/** The console above, or null (not a host booth). */
export function useHostConsole(): HostConsoleState | null {
  return useContext(ConsoleContext) ?? null;
}

export interface HostConsoleProps {
  session: PrimeSession;
  wide: boolean;
  /** Open a guest's card in the booth (booth passes its opener). */
  openCard: (guestId: string) => void;
  /** Tests: a client in place of the live poll (and no recap read). */
  client?: HostClient;
  /** The phone's keyboard is up (the booth frame's rule): the bar steps aside. */
  keyboardOpen?: boolean;
  /** Open the Wanted board read-only (the booth's `WantedBoard`, wave 18
   *  §5.5); `booth/app.tsx` supplies it. Without it Needs lists the wanted
   *  programs in place. */
  openWanted?: () => void;
  /** Show is on screen (wave 25): the slim bar steps aside. */
  showing?: boolean;
  /** Bring Show on screen: the bar's tap, a jump to one of its sections. */
  onShow?: () => void;
  /** The booth decides who is a host (the default: `isHostBooth`); a
   *  console that isn't one polls nothing and gives null. */
  enabled?: boolean;
}

/**
 * The console. It always renders the same tree (a booth that turns host
 * mid-night never remounts its rooms); when not `enabled` it polls nothing
 * and its consumers draw nothing.
 */
export function HostConsole({ session, wide, openCard, client: injected, keyboardOpen = false, openWanted, showing = false, onShow, enabled, children }: HostConsoleProps & { children: ReactNode }) {
  const on = enabled ?? isHostBooth(session);
  const auth = on ? session.auth : null;
  const live = useHostView(injected !== undefined || auth == null ? null : { token: auth.token, eventId: auth.eventId });
  const client = injected ?? live;
  const view = on ? client.view : null;
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
  const calls = on ? client.calls : null;
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
  const me = session.auth?.character ?? "";
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

  // The clock: countdowns tick between polls; Show's "waiting 1:42".
  const runs = clockRuns(view === null ? null : { phase: view.runtime, ...(view.paused === true ? { paused: true as const } : {}) });
  const [wall, setWall] = useState(() => Date.now());
  const stale = view !== null && !client.connected;
  const ticking = view !== null && (showing || (runs && (view.countdowns?.length ?? 0) > 0) || refused !== null || stale);
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
  const recap = useRecap(injected !== undefined || auth == null ? null : { token: auth.token, eventId: auth.eventId }, awardsNear(rows, layout));
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

  // Wave 32: the Talk card's draft, kept across Show's comings and goings.
  const [talkDraft, setTalkDraft] = useState("");

  // A jump into Show: the section to open, and More's own section.
  const [jump, setJump] = useState<ShowJump | null>(null);
  const showRef = useRef(onShow);
  showRef.current = onShow;
  const jumpTo = useCallback((to: ShowJump["to"], more: MoreFocus | null = null) => {
    setJump((j) => ({ to, more, seq: (j?.seq ?? 0) + 1 }));
    showRef.current?.();
  }, []);
  // A jump is spent once Show leaves the screen: coming back to Show later
  // never lands on an old one.
  useEffect(() => {
    if (!showing) setJump(null);
  }, [showing]);

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

  let state: HostConsoleState | null = null;
  if (on) {
    const bar = view === null ? null : nextBar(rows, view.countdowns, nowMs, runs);
    const armedHere = bar?.kind === "next" && desk.armed?.id === bar.row.id;
    const needs = needsCount(view, refused !== null ? 1 : 0);
    // The countdown the bar's first line already reads ("nothing to press …
    // ⏱ Midnight in 59:28") leaves the strip on a phone.
    const strip = view === null ? [] : hostStrip(view, layout, nowMs, needs, bar?.kind === "countdown", callers ? callerText(caller, [me], view.parts.map((p) => p.id)) : null);
    const line2 = view === null ? null : barLine({ toast: desk.toast, connected: client.connected, error: client.error, receivedAt: client.receivedAt, now, armed: armedHere, subjectName: desk.subjectName, refused: refusedBar ? refused : null, reason, description: bar?.kind === "next" ? cueDescription(bar.row, view.cues) : null });
    const claim = async (yes: boolean): Promise<boolean> => {
      setFlip({ on: yes, at: Date.now() });
      const ok = await run(yes ? "📣 You're calling the show" : "📣 You stopped calling", () => calls!.caller(yes));
      if (!ok) setFlip(null);
      return ok;
    };
    const ctx: HostCtx | null =
      view === null || calls === null
        ? null
        : {
            view,
            calls,
            session,
            now,
            run,
            go: (t, section) => jumpTo(showTarget(t), section ?? null),
            openRoom: (channel) => session.threads.open(channel),
            openCard,
            ...(openWanted !== undefined ? { openWanted } : {}),
            caller,
            callers,
            claim,
            ownPress,
          };
    state = {
      view,
      client,
      ctx,
      desk,
      rows,
      layout,
      bar,
      line2,
      strip,
      paused: view !== null && hostPaused(view),
      stale,
      needs,
      mineLast: mine !== null && view !== null && mine === view.cues.last,
      refused,
      reason,
      nowMs,
      showing,
      keyboard: keyboardOpen,
      wide,
      jump,
      openShow: (atNeeds = false) => (atNeeds ? jumpTo("needs") : showRef.current?.()),
      openCaller: () => jumpTo("top"),
      openTalk: () => jumpTo("talk"),
      talkDraft,
      setTalkDraft,
      picker: view === null ? null : <CuePicker desk={desk} roster={view.roster} suggest={suggestion !== null ? { id: suggestion.id, hint: suggestionHint(suggestion) } : null} />,
      dialog: anyway.dialog,
    };
  }
  return <ConsoleContext.Provider value={state}>{children}</ConsoleContext.Provider>;
}

export interface HostDockProps extends HostConsoleProps {}

/**
 * The bar's slot above the taskbar: the slim NEXT bar while Show is off
 * screen and no keyboard is up, and — always — the award picker and *Fire
 * anyway?*. Inside a `HostConsole` it draws that console; alone (the tests,
 * a frame with none) it makes its own.
 */
export function HostDock(p: HostDockProps) {
  // No hooks here: a booth that isn't a host renders nothing at all.
  if (!isHostBooth(p.session)) return null;
  return <DockSlot {...p} />;
}

function DockSlot(p: HostDockProps) {
  const c = useContext(ConsoleContext);
  if (c === undefined) {
    return (
      <HostConsole {...p}>
        <DockSlot {...p} />
      </HostConsole>
    );
  }
  if (c === null) return null;
  return <DockBar c={c} />;
}

function DockBar({ c }: { c: HostConsoleState }) {
  const barOn = !c.showing && !c.keyboard;
  if (c.view === null || c.bar === null || c.line2 === null) {
    if (!barOn) return null;
    return (
      <div className="host-dock">
        <div className="host-bar loading">
          <span className="host-bar-main">
            <span className="host-bar-line1">{c.client.error ?? "Loading the cue sheet…"}</span>
          </span>
        </div>
      </div>
    );
  }
  const line2 = c.line2;
  return (
    <>
      {barOn && (
        <div className={`host-dock ${c.wide ? "wide" : ""}`}>
          <HostNextBar
            bar={c.bar}
            desk={c.desk}
            stale={c.stale}
            paused={c.paused}
            line2={line2}
            strip={c.strip}
            // The bar's one line cuts a refusal's reason short: Show opens on
            // Needs, where it is whole.
            onOpen={() => c.openShow(line2.kind === "refused")}
            onCaller={c.openCaller}
            {...(talkChipShown(c.view.talk, barOn) ? { onTalk: c.openTalk } : {})}
          />
        </div>
      )}
      {c.picker}
      {c.dialog}
    </>
  );
}

/** The slim NEXT bar: the cue (or why there is none) and the night's
 *  second line in one button that opens Show, then ARM → FIRE. It reads the
 *  same desk as Show's NEXT card, so an arm made in one fires from the
 *  other. */
export function HostNextBar({ bar, desk, stale, paused = false, line2, strip, barMain, onOpen, onCaller, onTalk }: { bar: NextBar; desk: CueDesk; stale: boolean; paused?: boolean; line2: BarLine; strip: HostStripItem[]; barMain?: Ref<HTMLButtonElement>; onOpen: () => void; onCaller?: () => void; onTalk?: () => void }) {
  const nextRow = bar.kind === "next" ? bar.row : null;
  const armedHere = nextRow !== null && desk.armed?.id === nextRow.id;
  const sending = nextRow !== null && desk.pending === nextRow.id;
  return (
    <div className={`host-bar ${bar.kind} ${armedHere ? "armed" : ""} ${stale ? "stale" : ""} ${paused ? "paused" : ""} ${line2.kind === "refused" || line2.kind === "stale" ? "long2" : ""}`} data-testid="host-nextbar">
      {/* No aria-label: it would replace the cue and the strip, so a
          screen reader never heard what is NEXT. The verb is read first. */}
      <button type="button" className="host-bar-main" ref={barMain} onClick={onOpen}>
        <span className="host-bar-line1">
          <span className="host-sr">Open the Show window. </span>
          <span className="host-bar-grip" aria-hidden="true">
            ▣
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
                // The chip's tap opens Show at Who's calling (the bar's own tap opens Show).
                onClick={it.kind === "caller" ? onCaller : undefined}
              >
                {it.text}
              </span>
            ))
          )}
        </span>
      </button>
      {onTalk !== undefined && (
        // Wave 32 (C6): a talk scene is on — Show, at the 🤖 Talk card.
        <button type="button" className="host-talk-chip" data-testid="host-talk-chip" aria-label="Open the Talk card" onClick={onTalk}>
          <span aria-hidden="true">🤖</span>
          <span className="host-talk-chip-k">Talk</span>
        </button>
      )}
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
          {armedHere && !sending && <ArmDrain key={desk.armed!.at} at={desk.armed!.at} ms={armWindow(desk.armed!)} className="host-drain-fire" />}
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
