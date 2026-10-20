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
import { TrayItem } from "../chrome/taskbar.tsx";
import { usePlayHost } from "../host.ts";
import { retractedPinSeqs } from "../pins.ts";
import type { AlertLevel, ChatMessage, ObjectiveView } from "../types.ts";
import {
  BALLOON_MS,
  EMPTY_MOMENTS,
  GLITCH_MS,
  arrivals,
  loudObjectives,
  missedCount,
  momentsReducer,
  sameWords,
  settledMark,
  shouldGlitch,
  storyNow,
  surfacesOf,
  type Moment,
  type Queued,
  type Surfaces,
  type Viewer,
} from "./model.ts";
import { Balloon, BlueScreen, Glitch, MissedList, MomentDialog, StickyBanner, Toast } from "./surfaces.tsx";

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
  /** "Take me there". */
  openRoom: (channelId: string) => void;
  /** Booth filter (`boothAlertFilter(character)`); guests pass none. */
  filter?: (m: ChatMessage) => boolean;
  sound: boolean;
  /** The room the guest stands in (`loc:<Place>`): its beats reach the blue screen. Absent → DMs + the lobby only. */
  here?: string | null;
  /** "Take me there" for a moment about the pass (the loud "show your pass" objective). Absent → no button. */
  openPass?: () => void;
}

/** A readout this soon after a quiet toast that said the same is the answer to your own press. */
const ECHO_MS = 5_000;
/** How long a readout waits for the toast that may answer for it. */
const READOUT_GRACE_MS = 1_200;
/** A booth readout about a guest this soon after the card / scanner closed was shown on the card. */
const CARD_AFTERGLOW_MS = 4_000;

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
  go: (m: Moment) => void;
  canGo: (m: Moment) => boolean;
  closeSummary: () => void;
  dismissToast: () => void;
  hold: (delta: number) => void;
}

const EngineContext = createContext<Engine | null>(null);

function loudKey(role: MomentsInput["role"]): string {
  return `loom.moments.loud.${role}`;
}

function useMomentsEngine(input: MomentsInput): Engine {
  const host = usePlayHost();
  const visible = useVisible();
  const [state, dispatch] = useReducer(momentsReducer, EMPTY_MOMENTS);
  const [holds, setHolds] = useState(0);
  const held = holds > 0;
  const [tick, setTick] = useState(() => Date.now());
  const level = input.alertLevel ?? DEFAULT_ALERT_LEVEL;
  const { alerts, role, session } = input;

  const processed = useRef(new Set<number>());
  const processedMax = useRef(-1);
  const beats = useRef(new Map<string, number>());
  const lastHoldEnd = useRef(Number.NEGATIVE_INFINITY);
  const live = useRef({ visible, level, held, phase: input.phase ?? null });
  live.current = { visible, level, held, phase: input.phase ?? null };
  const viewer: Viewer = { role, me: input.me, here: input.here ?? null, filter: input.filter };
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;

  // A new sign-in, or a story restart under this one: nothing queued is news.
  useEffect(() => {
    processed.current = new Set();
    processedMax.current = -1;
    beats.current = new Map();
    dispatch({ type: "reset" });
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
    if (processedMax.current < mark) processedMax.current = mark;
    const now = storyNow(input.messages.values(), input.clock);
    const l = live.current;
    const { moments, seen } = arrivals(input.messages.values(), mark, processed.current, viewerRef.current, {
      now,
      phase: l.phase,
      bsod: role === "guest" && l.level === "bsod",
      beats: beats.current,
    });
    for (const s of seen) {
      processed.current.add(s);
      if (s > processedMax.current) processedMax.current = s;
    }
    if (seen.length === 0) return;
    const now2 = Date.now();
    const readouts: Moment[] = [];
    const rest: Moment[] = [];
    for (const m of moments) {
      if (m.kind !== "readout") rest.push(m);
      else if (role === "booth" && aboutGuest(input.messages.get(m.seq ?? -1)) && (l.held || now2 - lastHoldEnd.current < CARD_AFTERGLOW_MS)) continue;
      else if (m.severity === "minor") readouts.push(m);
      else rest.push(m);
    }
    arrive(rest, moments.length > 1);
    if (readouts.length > 0) {
      window.setTimeout(() => {
        const toasts = alerts.recent().filter((t) => t.quiet && Date.now() - t.at < ECHO_MS + READOUT_GRACE_MS);
        arrive(
          readouts.filter((m) => !toasts.some((t) => sameWords(t.text, m.text))),
          readouts.length > 1,
        );
      }, READOUT_GRACE_MS);
    }
    // `clock`, the level and the phase are read, not watched: a snapshot alone never raises a moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, session, alerts.epoch]);

  // The level is switchable live (D2): what is still queued follows it, so a
  // host who calms the room never leaves phones stepping through old modals.
  useEffect(() => {
    dispatch({ type: "relevel", level, role });
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
    const stored = host.storage.load<{ session: string; ids: string[] }>(loudKey(role));
    const ids = stored !== null && stored.session === session ? stored.ids : [];
    const fresh = loudObjectives(input.objectives, new Set(ids), storyNow([], input.clock), live.current.phase);
    if (fresh.length === 0) return;
    try {
      host.storage.save(loudKey(role), { session, ids: [...ids, ...fresh.map((m) => m.key.slice(2))] });
    } catch {
      /* storage blocked — at worst it announces again after a reload */
    }
    arrive(fresh, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.objectives, session]);

  // Settle the mark under whatever is still waiting.
  useEffect(() => {
    if (session !== null) alerts.settle(settledMark(state, processedMax.current));
  }, [state, session, alerts]);

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
      lastHoldEnd.current = Date.now();
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

  const surfaces = surfacesOf(state, held);

  // On-screen time per moment (a glance < 1 s is missed), and the chime the
  // first time a major moment reaches the screen.
  const shownAt = useRef(new Map<string, number>());
  const onScreen = [surfaces.balloon, surfaces.sticky, surfaces.modal].filter((q): q is Queued => q !== null);
  const onScreenKeys = onScreen.map((q) => q.moment.key).join("|");
  useEffect(() => {
    if (!visible) return;
    let ring = false;
    for (const q of onScreen) {
      if (shownAt.current.has(q.moment.key)) continue;
      shownAt.current.set(q.moment.key, Date.now());
      if (q.moment.severity === "major") ring = true;
    }
    if (ring && input.sound) {
      playChime();
      vibrate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreenKeys, visible]);

  const dismiss = useCallback((q: Queued) => {
    const at = shownAt.current.get(q.moment.key);
    shownAt.current.delete(q.moment.key);
    dispatch({ type: "dismiss", key: q.moment.key, onScreenMs: at === undefined ? 0 : Date.now() - at });
  }, []);

  // A balloon tip times out after 8 s of visible time.
  const balloonKey = surfaces.balloon?.moment.key ?? null;
  useEffect(() => {
    if (balloonKey === null || !visible || surfaces.balloon === null) return;
    const q = surfaces.balloon;
    const t = window.setTimeout(() => dismiss(q), BALLOON_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloonKey, visible, dismiss]);

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

  const { openRoom, openPass } = input;
  const canGo = useCallback((m: Moment) => (m.pass === true ? openPass !== undefined : m.channel !== null), [openPass]);
  const go = useCallback(
    (m: Moment) => {
      if (m.pass === true) openPass?.();
      else if (m.channel !== null) openRoom(m.channel);
    },
    [openRoom, openPass],
  );
  const hold = useCallback((delta: number) => setHolds((h) => Math.max(0, h + delta)), []);
  const replay = useCallback(() => dispatch({ type: "wake", level, role, now: Date.now(), phase: input.phase ?? null }), [level, role, input.phase]);
  const closeSummary = useCallback(() => dispatch({ type: "closeSummary" }), []);

  // A booth's unsolicited readout still raises a (loud) toast from its
  // session; the moment says the same thing, so the toast stands back.
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
    go,
    canGo,
    closeSummary,
    dismissToast: alerts.dismiss,
    hold,
  };
}

/** Is a readout about one guest (`about`) — the answer to a scan or a card press? */
function aboutGuest(m: ChatMessage | undefined): boolean {
  return m !== undefined && typeof m.about === "string" && m.about !== "";
}

export function MomentsProvider(p: MomentsInput & { children: ReactNode }) {
  const { children, ...input } = p;
  const engine = useMomentsEngine(input);
  return <EngineContext.Provider value={engine}>{children}</EngineContext.Provider>;
}

/** The overlay: the feedback toast and the sticky banner (in flow, under the
 *  title bar), the balloon tip, the dialog box or the blue screen, the
 *  missed list, and the glitch. */
export function MomentsLayer() {
  const e = useContext(EngineContext);
  if (e === null) return null;
  const { surfaces: s } = e;
  const modal = s.modal;
  return (
    <>
      {s.sticky !== null && (
        <StickyBanner
          q={s.sticky}
          count={s.stickyCount}
          canGo={e.canGo(s.sticky.moment)}
          onGo={() => {
            e.go(s.sticky!.moment);
            e.dismiss(s.sticky!);
          }}
          onDismiss={() => e.dismiss(s.sticky!)}
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
          onGo={() => {
            e.go(s.balloon!.moment);
            e.dismiss(s.balloon!);
          }}
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
          onGo={() => {
            e.go(modal.moment);
            e.dismiss(modal);
          }}
          onDismiss={() => e.dismiss(modal)}
        />
      )}
      {modal !== null && modal.level === "bsod" && (
        <BlueScreen
          key={modal.moment.key}
          q={modal}
          index={s.modalIndex}
          total={s.modalTotal}
          canGo={e.canGo(modal.moment)}
          onGo={() => {
            e.go(modal.moment);
            e.dismiss(modal);
          }}
          onDismiss={() => e.dismiss(modal)}
        />
      )}
      {s.summary !== null && (
        <MissedList
          moments={s.summary.moments}
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

export function useMoments(): { missed: number; replay: () => void; level: AlertLevel } {
  const e = useContext(EngineContext);
  return useMemo(() => ({ missed: e?.missed ?? 0, replay: e?.replay ?? (() => {}), level: e?.level ?? DEFAULT_ALERT_LEVEL }), [e?.missed, e?.replay, e?.level]);
}

/** The tray's missed-moments item ("🔔 3", tap to replay them); null when none. */
export function MissedTray() {
  const { missed, replay } = useMoments();
  if (missed === 0) return null;
  const label = missed === 1 ? "1 missed moment — show it" : `${missed} missed moments — show them`;
  return <TrayItem icon="🔔" text={String(missed)} title={label} tone="alarm" onClick={replay} />;
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
