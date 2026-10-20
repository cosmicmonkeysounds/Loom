//! The moments layer (wave 13; the moments lane owns it): one queue of the
//! story's moments, rendered by the interrupt ladder — a tray balloon tip, a
//! sticky banner, a Win95 dialog box, a blue screen — plus the quiet
//! feedback toast, the glitch on every level change, the missed count for
//! the taskbar tray and the busy-surface hold. The pure rules are in
//! `model.ts`; this file is the React engine around them.
//!
//! Mounted by both apps (`guest/app.tsx`, `booth/app.tsx`): the provider
//! wraps the root, `<MomentsLayer/>` sits where the sticky banner should
//! flow (directly under the title bar), and the full-screen surfaces are
//! `position: fixed` layers at the tokens' z values.

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { DEFAULT_ALERT_LEVEL } from "../../../core/src/delivery.ts";
import { playChime, useVisible, vibrate, type Alert, type Alerts } from "../alerts.ts";
import { Icon } from "../chrome/icons.tsx";
import { TrayItem } from "../chrome/taskbar.tsx";
import { usePlayHost } from "../host.ts";
import { retractedPinSeqs } from "../pins.ts";
import type { AlertLevel, ChatMessage, ObjectiveView } from "../types.ts";
import {
  BALLOON_MS,
  DISMISS_ALL_MODALS_OVER,
  GLITCH_MS,
  READOUT_WAIT_MS,
  afterWait,
  arrivals,
  doneAbove,
  missedCount,
  momentExit,
  momentsReducer,
  sameWords,
  settledMark,
  shouldGlitch,
  sortArrivals,
  storyNow,
  surfacesOf,
  type Moment,
  type Queued,
  type Surfaces,
  type Viewer,
} from "./model.ts";
import { MOMENTS_MEMORY, announceLoud, loadDone, recallMoments, rememberMoments, saveDoneList, type EngineMemory } from "./memory.ts";
import { Balloon, BlueScreen, Glitch, MissedList, MomentDialog, StickyBanner, SummarySticky, Toast } from "./surfaces.tsx";

export interface MomentsInput {
  role: "guest" | "booth";
  /** Guest id, or the booth's character. */
  me: string;
  /** The sign-in token (keys persisted marks); null when signed out. */
  session: string | null;
  messages: ReadonlyMap<number, ChatMessage>;
  /** The session's `useAlerts` result, whole. Its `alert` / `dismiss` are
   *  the quiet feedback toast; its mark is what the moments settle. */
  alerts: Alerts;
  alertLevel: AlertLevel | undefined;
  objectives: readonly ObjectiveView[] | undefined;
  /** `view.night.phase` (staleness). */
  phase: string | null | undefined;
  clock: number | undefined;
  /** "Take me there". Absent → no room exit (a guest on rails in a cutscene). */
  openRoom?: (channelId: string) => void;
  /** Booth filter (`boothAlertFilter(character)`); guests pass none. */
  filter?: (m: ChatMessage) => boolean;
  sound: boolean;
  /** The room the guest stands in (`loc:<Place>`): its beats reach the blue screen. Absent → DMs + the lobby only. */
  here?: string | null;
  /** "Take me there" for a moment about the pass (the loud "show your pass" objective). Absent → no button. */
  openPass?: () => void;
  /** A booth: the guest whose card is open (or was last), read when moments
   *  arrive — a readout about them inside the hold was shown on the card;
   *  one about anyone else is news. */
  cardGuest?: () => string | null;
  /** The frame has a NOW title bar (the guest's): a loud objective below the
   *  modal rungs flashes it (`useNowMoment`) instead of a sticky / balloon. */
  nowBar?: boolean;
  /** Where a moment's "Take me there" goes (`exitRoomFor`: a live card's
   *  room, never the room already open); absent → the moment's own room. */
  exitRoom?: (m: Moment) => string | null;
}

/** How long the NOW bar stays flashed open on a new objective (visible time). */
export const NOW_FLASH_MS = 12_000;


interface Engine {
  input: MomentsInput;
  level: AlertLevel;
  surfaces: Surfaces;
  held: boolean;
  missed: number;
  glitch: number | null;
  toast: Alert | null;
  replay: () => void;
  dismiss: (q: Queued) => void;
  /** "Take me there": go, and the moment is done (never missed, however quick the tap). */
  act: (q: Queued) => void;
  go: (m: Moment) => void;
  canGo: (m: Moment) => boolean;
  closeSummary: () => void;
  dismissToast: () => void;
  hold: (delta: number) => void;
  /** "Dismiss all (n)": every sticky waiting, read. */
  dismissStickies: () => void;
  /** "Dismiss all (n)" on a dialog / blue screen: every modal waiting, read. */
  dismissModals: () => void;
  /** Close a moment with no exit taken: `acted` = it was opened (never missed). */
  close: (q: Queued, acted: boolean) => void;
}

const EngineContext = createContext<Engine | null>(null);

function useMomentsEngine(input: MomentsInput): Engine {
  const host = usePlayHost();
  const visible = useVisible();
  const { alerts, role, session } = input;
  // The engine's memory outlives a remount of the same sign-in (the guest
  // app swaps its cutscene and main roots, each with its own provider).
  const memRef = useRef<EngineMemory | null>(null);
  if (memRef.current === null) memRef.current = recallMoments(role, session);
  const mem = memRef.current;
  const [state, dispatch] = useReducer(momentsReducer, mem.state);
  // A new state has every dispatch made before this render folded in.
  if (mem.state !== state) mem.inflight.clear();
  mem.state = state;
  const [holds, setHolds] = useState(0);
  const held = holds > 0;
  const [tick, setTick] = useState(() => Date.now());
  const level = input.alertLevel ?? DEFAULT_ALERT_LEVEL;

  const live = useRef({ visible, level, held, phase: input.phase ?? null });
  live.current = { visible, level, held, phase: input.phase ?? null };
  const viewer: Viewer = { role, me: input.me, here: input.here ?? null, filter: input.filter };
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  const saveDone = useCallback(
    (seqs: number[]) => {
      if (session === null) return;
      const text = seqs.join(",");
      if (text === mem.savedDone) return;
      mem.savedDone = text;
      saveDoneList(host.storage, role, session, seqs);
    },
    [host, role, session],
  );
  // Settle the mark under whatever is still waiting, and remember what is
  // done above it (a reload must not replay a moment already read).
  // Readouts waiting out `READOUT_WAIT_MS` are not settled either.
  const settleNow = useCallback(() => {
    if (session === null) return;
    const waiting = [...mem.pending, ...mem.inflight];
    alerts.settle(settledMark(mem.state, mem.processedMax, waiting));
    saveDone(doneAbove(mem.state, mem.processed, alerts.mark(), waiting));
  }, [session, alerts, saveDone]);

  // A new sign-in, or a story restart under this one: nothing queued is news.
  // A sign-in picks up what it had already settled above its mark (a reload);
  // a restart renumbers the seqs, so that list goes.
  useEffect(() => {
    if (mem.session === session && mem.epoch === alerts.epoch) return; // a remount: carry on
    const signIn = mem.session !== session;
    mem.session = session;
    mem.epoch = alerts.epoch;
    mem.processed = new Set();
    mem.processedMax = -1;
    mem.beats = new Map();
    mem.pending = new Set();
    mem.inflight = new Set();
    dispatch({ type: "reset" });
    if (session === null) return;
    if (signIn) loadDone(host.storage, role, session, alerts.mark(), mem);
    else saveDone([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.epoch, session]);

  const arrive = useCallback(
    (moments: Moment[], batch: boolean) => {
      if (moments.length === 0) return;
      const l = live.current;
      dispatch({ type: "arrive", moments, visible: l.visible, level: l.level, role, now: Date.now(), phase: l.phase, batch });
    },
    [role],
  );

  // New messages → moments. Readouts wait a moment for the toast that may
  // already say them (your own press); a booth's readout about a guest
  // while (or just after) a card was open was shown on that card.
  useEffect(() => {
    if (session === null) return;
    const mark = alerts.mark();
    if (mem.processedMax < mark) mem.processedMax = mark;
    const now = storyNow(input.messages.values(), input.clock);
    const l = live.current;
    const { moments, seen } = arrivals(input.messages.values(), mark, mem.processed, viewerRef.current, {
      now,
      phase: l.phase,
      bsod: role === "guest" && l.level === "bsod",
      beats: mem.beats,
    });
    for (const s of seen) {
      mem.processed.add(s);
      if (s > mem.processedMax) mem.processedMax = s;
    }
    // A reconnect's backlog (a new history since the last pass) is replayed
    // like a wake: staleness and compression. A live stream just queues,
    // however many moments one drain posted.
    const histories = alerts.histories?.() ?? 0;
    const backlog = histories !== mem.historiesSeen;
    mem.historiesSeen = histories;
    if (seen.length === 0) return;
    const wall = Date.now();
    const sorted = sortArrivals(moments, {
      role,
      held: l.held,
      sinceHoldEnd: wall - mem.lastHoldEnd,
      about: (seq) => aboutGuest(input.messages.get(seq ?? -1)),
      aboutId: (seq) => input.messages.get(seq ?? -1)?.about ?? null,
      ...(input.cardGuest !== undefined ? { cardGuest: input.cardGuest() } : {}),
      recent: alerts.recent(),
      now: wall,
    });
    // Until the queue renders them, the mark must not pass them (an effect
    // later in this commit settles against the state before the dispatch).
    for (const m of sorted.now) if (m.seq !== null) mem.inflight.add(m.seq);
    arrive(sorted.now, backlog);
    if (sorted.later.length > 0) {
      for (const m of sorted.later) if (m.seq !== null) mem.pending.add(m.seq);
      window.setTimeout(() => {
        for (const m of sorted.later) if (m.seq !== null) mem.pending.delete(m.seq);
        const news = afterWait(sorted.later, alerts.recent(), Date.now());
        for (const m of news) if (m.seq !== null) mem.inflight.add(m.seq);
        if (news.length > 0) arrive(news, backlog);
        else settleNow();
      }, READOUT_WAIT_MS);
    }
    // Nothing joined the queue: settle now (else the state change does).
    if (sorted.now.length === 0) settleNow();
    // `clock`, the level and the phase are read, not watched: a snapshot alone never raises a moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, session, alerts.epoch]);

  // The level is switchable live (D2): what is still queued follows it, so a
  // host who calms the room never leaves phones stepping through old modals.
  useEffect(() => {
    // The phase is read, not watched: a stale moment is dropped only on a rise.
    dispatch({ type: "relevel", level, role, phase: live.current.phase });
  }, [level, role]);

  // A `!` pin taken down (an unpin, or a newer pin with its key) leaves the
  // queue, the missed list and the summary: a lifted mark is not news.
  useEffect(() => {
    const gone = retractedPinSeqs(input.messages.values());
    if (gone.size > 0) dispatch({ type: "retract", seqs: gone });
  }, [input.messages]);

  // A loud objective going live: one major moment per sign-in (persisted).
  useEffect(() => {
    if (session === null || input.objectives === undefined) return;
    const fresh = announceLoud(host.storage, role, session, input.objectives, storyNow([], input.clock), live.current.phase);
    arrive(fresh, false);
    // An objective that ended takes its moment with it.
    dispatch({ type: "objectives", live: new Set(input.objectives.map((o) => o.id)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.objectives, session]);

  useEffect(() => {
    settleNow();
  }, [state, settleNow]);

  // Woke up (or the last busy surface closed): replay what was missed.
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) dispatch({ type: "wake", level, role, now: Date.now(), phase: input.phase ?? null });
    wasVisible.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) {
      mem.lastHoldEnd = Date.now();
      dispatch({ type: "tick", now: Date.now(), held: true });
      dispatch({ type: "wake", level, role, now: Date.now(), phase: input.phase ?? null });
    }
    wasHeld.current = held;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);
  // While held, a modal moment kept back 30 s counts as missed.
  useEffect(() => {
    if (!held) return;
    const t = window.setInterval(() => {
      const now = Date.now();
      setTick(now);
      dispatch({ type: "tick", now, held: true });
    }, 1_000);
    return () => window.clearInterval(t);
  }, [held]);

  // Keep the memory for this sign-in (one per role).
  useEffect(() => {
    rememberMoments(role, session, mem);
  }, [role, session, mem]);

  const surfaces = surfacesOf(state, held, input.nowBar === true);

  // On-screen time per moment (a glance < 1 s is missed), and the chime the
  // first time a major moment reaches the screen.
  const onScreen = [surfaces.now, surfaces.balloon, surfaces.sticky, surfaces.modal].filter((q): q is Queued => q !== null);
  const onScreenKeys = onScreen.map((q) => q.moment.key).join("|");
  useEffect(() => {
    if (!visible) return;
    let ring = false;
    for (const q of onScreen) {
      if (mem.shownAt.has(q.moment.key)) continue;
      mem.shownAt.set(q.moment.key, Date.now());
      if (q.moment.severity === "major") ring = true;
    }
    if (ring && input.sound) {
      playChime();
      vibrate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreenKeys, visible]);

  const close = useCallback((q: Queued, acted: boolean) => {
    const at = mem.shownAt.get(q.moment.key);
    mem.shownAt.delete(q.moment.key);
    dispatch({ type: "dismiss", key: q.moment.key, onScreenMs: at === undefined ? 0 : Date.now() - at, acted });
  }, []);
  const dismiss = useCallback((q: Queued) => close(q, false), [close]);

  // A balloon tip times out after 8 s of visible time.
  const balloonKey = surfaces.balloon?.moment.key ?? null;
  useEffect(() => {
    if (balloonKey === null || !visible || surfaces.balloon === null) return;
    const q = surfaces.balloon;
    const t = window.setTimeout(() => dismiss(q), BALLOON_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloonKey, visible, dismiss]);

  // The NOW bar's flash folds back after 12 s of visible time (read, unless
  // it was a glance; a tap that opens the objective is the moment acted on).
  const nowKey = surfaces.now?.moment.key ?? null;
  useEffect(() => {
    if (nowKey === null || !visible || surfaces.now === null) return;
    const q = surfaces.now;
    const t = window.setTimeout(() => dismiss(q), NOW_FLASH_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowKey, visible, dismiss]);

  // The glitch on every level change after the first view.
  const [glitch, setGlitch] = useState<number | null>(null);
  const prevLevel = useRef<AlertLevel | undefined>(undefined);
  useEffect(() => {
    const now = input.alertLevel;
    if (now === undefined) return;
    const before = prevLevel.current;
    prevLevel.current = now;
    if (!shouldGlitch(before, now)) return;
    setGlitch((g) => (g ?? 0) + 1);
    const t = window.setTimeout(() => setGlitch(null), GLITCH_MS);
    return () => window.clearTimeout(t);
  }, [input.alertLevel]);

  const { openRoom, openPass, exitRoom } = input;
  // The room a moment's exit opens: the app's resolver when it has one.
  const roomOf = useCallback((m: Moment): string | null => (exitRoom !== undefined ? exitRoom(m) : m.channel), [exitRoom]);
  const canGo = useCallback(
    (m: Moment) => momentExit({ pass: m.pass, channel: m.pass === true ? m.channel : roomOf(m) }, { room: openRoom !== undefined, pass: openPass !== undefined }) !== null,
    [openRoom, openPass, roomOf],
  );
  const go = useCallback(
    (m: Moment) => {
      const room = m.pass === true ? m.channel : roomOf(m);
      const exit = momentExit({ pass: m.pass, channel: room }, { room: openRoom !== undefined, pass: openPass !== undefined });
      if (exit === "pass") openPass?.();
      else if (exit === "room" && room !== null) openRoom?.(room);
    },
    [openRoom, openPass, roomOf],
  );
  const act = useCallback(
    (q: Queued) => {
      go(q.moment);
      close(q, true);
    },
    [go, close],
  );
  const hold = useCallback((delta: number) => setHolds((h) => Math.max(0, h + delta)), []);
  const replay = useCallback(() => dispatch({ type: "wake", level, role, now: Date.now(), phase: input.phase ?? null }), [level, role, input.phase]);
  const closeSummary = useCallback(() => dispatch({ type: "closeSummary" }), []);
  const stickyKeys = surfaces.stickyKeys.join("\u0000");
  const dismissStickies = useCallback(() => {
    const keys = stickyKeys === "" ? [] : stickyKeys.split("\u0000");
    for (const k of keys) mem.shownAt.delete(k);
    dispatch({ type: "dismissMany", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickyKeys]);
  const modalKeys = surfaces.modalKeys.join("\u0000");
  const dismissModals = useCallback(() => {
    const keys = modalKeys === "" ? [] : modalKeys.split("\u0000");
    for (const k of keys) mem.shownAt.delete(k);
    dispatch({ type: "dismissMany", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalKeys]);

  // A loud raise (a booth's unsolicited readout) never toasts (useAlerts);
  // an older session's that did stands back for the moment saying it.
  const toast = alerts.alert !== null && alerts.alert.quiet !== true && state.queue.some((q) => sameWords(q.moment.text, alerts.alert!.text)) ? null : alerts.alert;

  return {
    input,
    level,
    surfaces,
    held,
    missed: missedCount(state, held, tick),
    glitch,
    toast,
    replay,
    dismiss,
    act,
    go,
    canGo,
    closeSummary,
    dismissToast: alerts.dismiss,
    hold,
    dismissStickies,
    dismissModals,
    close,
  };
}

/** Is a readout about one guest (`about`) — the answer to a scan or a card press? */
function aboutGuest(m: ChatMessage | undefined): boolean {
  return m !== undefined && typeof m.about === "string" && m.about !== "";
}

export { MOMENTS_MEMORY };

export function MomentsProvider(p: MomentsInput & { children: ReactNode }) {
  const { children, ...input } = p;
  const engine = useMomentsEngine(input);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** "Dismiss all (n)" on a modal: only with more than two waiting. */
function dismissAllOf(s: Surfaces, dismiss: () => void): { waiting?: number; onDismissAll?: () => void } {
  return s.modalKeys.length > DISMISS_ALL_MODALS_OVER ? { waiting: s.modalKeys.length, onDismissAll: dismiss } : {};
}

/** The overlay: the feedback toast and the sticky banner (in flow, under the
 *  title bar), the balloon tip, the dialog box or the blue screen, the
 *  missed list, and the glitch. */
export function MomentsLayer({ foldSticky = false }: { foldSticky?: boolean } = {}) {
  const e = useContext(EngineContext);
  // A sticky summary opens its list on a tap (the one modal a booth sees: it asked).
  const [openList, setOpenList] = useState<string | null>(null);
  if (e === null) return null;
  const { surfaces: s } = e;
  const modal = s.modal;
  const summary = s.summary;
  const listOpen = summary !== null && (summary.level === "dialog" || openList === summary.key);
  return (
    <>
      {summary !== null && !listOpen && <SummarySticky count={summary.moments.length} onOpen={() => setOpenList(summary.key)} onDismiss={e.closeSummary} />}
      {s.sticky !== null && !foldSticky && (
        <StickyBanner
          q={s.sticky}
          count={s.stickyCount}
          canGo={e.canGo(s.sticky.moment)}
          onGo={() => e.act(s.sticky!)}
          onDismiss={() => e.dismiss(s.sticky!)}
          onDismissAll={e.dismissStickies}
        />
      )}
      {e.toast !== null && (
        <div className="moments-anchor">
          <Toast text={e.toast.text} onDismiss={e.dismissToast} />
        </div>
      )}
      {s.balloon !== null && (
        <Balloon
          q={s.balloon}
          canGo={e.canGo(s.balloon.moment)}
          onGo={() => e.act(s.balloon!)}
          onDismiss={() => e.dismiss(s.balloon!)}
        />
      )}
      {modal !== null && modal.level === "dialog" && (
        <MomentDialog
          key={modal.moment.key}
          q={modal}
          index={s.modalIndex}
          total={s.modalTotal}
          canGo={e.canGo(modal.moment)}
          onGo={() => e.act(modal)}
          onDismiss={() => e.dismiss(modal)}
          {...dismissAllOf(s, e.dismissModals)}
        />
      )}
      {modal !== null && modal.level === "bsod" && (
        <BlueScreen
          key={modal.moment.key}
          q={modal}
          index={s.modalIndex}
          total={s.modalTotal}
          canGo={e.canGo(modal.moment)}
          onGo={() => e.act(modal)}
          onDismiss={() => e.dismiss(modal)}
          {...dismissAllOf(s, e.dismissModals)}
        />
      )}
      {summary !== null && listOpen && (
        <MissedList
          moments={summary.moments}
          canGo={e.canGo}
          onGo={(m) => {
            e.go(m);
            e.closeSummary();
          }}
          onClose={e.closeSummary}
        />
      )}
      {e.glitch !== null && <Glitch key={e.glitch} />}
    </>
  );
}

/**
 * The loud objective flashing the NOW title bar, if any (a guest's frame,
 * `nowBar`): `seen(true)` when the guest opened it (acted on, never
 * missed), `seen(false)` to fold it back.
 */
export function useNowMoment(): { moment: Moment | null; seen: (acted: boolean) => void } {
  const e = useContext(EngineContext);
  const q = e?.surfaces.now ?? null;
  const close = e?.close;
  return useMemo(
    () => ({
      moment: q?.moment ?? null,
      seen: (acted: boolean) => {
        if (q !== null) close?.(q, acted);
      },
    }),
    [q, close],
  );
}

/** The sticky on screen, if any, and how many wait (the pin rail folds them into a "+n" on the guest's own pin). */
export function useStickyMoment(): { key: string | null; count: number } {
  const e = useContext(EngineContext);
  const key = e?.surfaces.sticky?.moment.key ?? null;
  const count = e?.surfaces.stickyCount ?? 0;
  return useMemo(() => ({ key, count }), [key, count]);
}

export function useMoments(): { missed: number; replay: () => void; level: AlertLevel } {
  const e = useContext(EngineContext);
  return useMemo(() => ({ missed: e?.missed ?? 0, replay: e?.replay ?? (() => {}), level: e?.level ?? DEFAULT_ALERT_LEVEL }), [e?.missed, e?.replay, e?.level]);
}

/** The tray's missed-moments item ("🔔 3", tap to replay them); null when none. */
export function MissedTray() {
  const { missed, replay } = useMoments();
  if (missed === 0) return null;
  const label = missed === 1 ? "1 missed moment — show it" : `${missed} missed moments — show them`;
  return <TrayItem icon={<Icon name="bell" />} text={String(missed)} title={label} tone="alarm" onClick={replay} />;
}

/** A busy surface (the scanner, a guest card, the host drawer, the
 *  full-screen pass, the scan sheet) calls this while open: no `dialog` /
 *  `bsod` shows while any hold is active; moments queue behind it and show
 *  when the last hold releases (one kept back 30 s counts as missed). */
export function useMomentsHold(active: boolean): void {
  const e = useContext(EngineContext);
  const hold = e?.hold;
  useEffect(() => {
    if (!active || hold === undefined) return;
    hold(1);
    return () => hold(-1);
  }, [active, hold]);
}
