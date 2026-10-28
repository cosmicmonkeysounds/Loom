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
//!
//! Wave 18: the big moment (`BigMoment`, every guest, whatever the level),
//! every surface's exits from `exits.ts` (a guest app passes `go` +
//! `exitContext`; without them the old room / pass exits stand), the
//! Notifications rows (`BellButton` here; the window and `useNotifications`
//! in `notifications.tsx`, which loads with the window), the per-sign-in
//! memory of acknowledged bigs / seen moments / deleted rows, and a booth's
//! pop-outs (`popOutAdapter` feeds them to the store in `popout.tsx`, the
//! booth's chunk, through `popout-registry.ts`).

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { DEFAULT_ALERT_LEVEL } from "../../../core/src/delivery.ts";
import { playChime, useVisible, vibrate, type Alert, type Alerts } from "../alerts.ts";
import { usePlayHost } from "../host.ts";
import { retractedPinSeqs } from "../pins.ts";
import type { WidgetHook } from "../stream/bubble.tsx";
import type { AlertLevel, ChatMessage, ObjectiveView } from "../types.ts";
import { WIDGETS, cardAsks, supersededCards, widgetInline } from "../widgets.tsx";
import { captureStage, staleCaptureKeys } from "./big-parts.ts";
import { ChunkBoundary, retryableLazy } from "../lazy-chunk.tsx";
import type { BigCard } from "./big.tsx";
import { exitsOf, type Exit, type ExitContext, type Nav } from "./exits.ts";
import {
  BALLOON_MS,
  GLITCH_MS,
  GLANCE_MS,
  READOUT_WAIT_MS,
  STICKY_MS,
  afterWait,
  arrivals,
  doneAbove,
  missedCount,
  momentExit,
  momentMessage,
  momentOf,
  momentsReducer,
  newestHouseSeq,
  sameWords,
  sweepBigs,
  settledMark,
  shouldGlitch,
  sortArrivals,
  takeoverDue,
  takeoverStart,
  storyNow,
  surfacesOf,
  waitBalloons,
  type Moment,
  type Queued,
  type Surfaces,
  type Viewer,
} from "./model.ts";
import {
  MOMENTS_MEMORY,
  ackedKey,
  announceLoud,
  bsodKey,
  deletedKey,
  emptySignIn,
  type SignInMemory,
  loadDone,
  loadNow,
  loadSignIn,
  nowSinceOnLoad,
  readMarkKey,
  recallMoments,
  rememberMoments,
  saveDoneList,
  saveKeys,
  saveNow,
  saveNumber,
  seenKey,
  type EngineMemory,
} from "./memory.ts";
import { notificationGroups, unreadOf, type NotificationGroup } from "./notifications-count.ts";
import type { PopOutAdapter } from "./popout-model.ts";
import { offerPopOut, popOutCandidate } from "./popout-registry.ts";
import { Balloon, BlueScreen, Glitch, MomentDialog, StickyBanner, Toast } from "./surfaces.tsx";

/** The big window loads on its own (most phones see a handful a night); fetched early, after the first paint. */
const loadBig = () => import("./big.tsx").then((m) => ({ default: m.BigMoment }));
const LazyBig = retryableLazy(loadBig);
/** Wave 26 (T2): the glitch takeover, its own chunk; the 600 ms `<Glitch/>` stands in while it loads or if it won't. */
const loadTakeover = () => import("./glitch-takeover.tsx").then((m) => ({ default: m.GlitchTakeover }));
const LazyTakeover = retryableLazy(loadTakeover);

/** If the big window's chunk won't load: the words and one OK, so nothing waits behind a blank screen. */
function BigFallback({ q, onAck, retry }: { q: Queued; onAck: () => void; retry: () => void }) {
  return (
    <div className="moments-big" role="alertdialog" aria-modal="true" aria-label={q.moment.caption}>
      <div className="moments-big-window w95-window">
        <div className="w95-titlebar moments-big-caption">
          <span className="w95-title">{q.moment.caption}</span>
        </div>
        <div className="moments-big-body">
          <p className="moments-big-text">{q.moment.text}</p>
          <div className="moments-big-buttons">
            <button type="button" className="w95-btn" onClick={retry}>
              Try again
            </button>
            <button type="button" className="w95-btn moments-big-ack" onClick={onAck}>
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { Exit, ExitContext, Nav } from "./exits.ts";
export type { PopAction, PopGuest, PopOutAdapter, PopOutSpec, PopTone } from "./popout-model.ts";
export { raisePopOut, retirePopOut } from "./popout-registry.ts";

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
  /** Where a moment's room exit goes (`exitRoomFor`: a live card's room,
   *  never the room already open); absent → the moment's own room. The
   *  pre-wave-18 path: an app that passes `go` + `exitContext` never needs it. */
  exitRoom?: (m: Moment) => string | null;
  /** Wave 18 (a guest): land on an exit's place (`guest/nav.ts` `go`).
   *  With `exitContext`, every surface's exits come from `exitsOf`. Absent
   *  (on rails in the cutscene) → the old room / pass exits, or none. */
  go?: (nav: Nav) => void;
  /** Wave 18 (a guest): what `exitsOf` needs, read when a surface renders. */
  exitContext?: () => ExitContext;
  /** Wave 18 (a guest): the card answer path, so a big moment renders its card inside itself. */
  widgets?: WidgetHook;
  /** Wave 18: open the Notifications window (the bell). */
  openNotifications?: () => void;
  /**
   * Wave 18 (a booth, BOOTH-SPEC §2.3): every booth big moment and every
   * `!` readout about a guest is passed here — a spec is raised as a
   * pop-out, `null` shows nothing (the booth shows it another way),
   * `"default"` raises the generic one. Absent → today's stickies.
   */
  popOutAdapter?: PopOutAdapter;
  /** Wave 18 (a booth): open a guest's card (the generic pop-out's 🗂 Open card). */
  openCard?: (guestId: string) => void;
  /** Wave 18 fix (a guest): their display name — a house cheer that names them is not theirs. */
  name?: string;
  /** Wave 18 fix (a guest): they are on a side — a house moment that only
   *  sends them to choose one is done (GN-F2: the Y2K dialog showed after
   *  Walk in). */
  sideChosen?: boolean;
  /** Wave 18 recheck (a guest): `GuestView.captured` — a sent-to-the-Internet
   *  big still queued after a release is not news (BN2-FB / NMR-1). */
  captured?: boolean;
  /** Wave 18b (R12, D18): the story hides the lobby from guests — its lines
   *  that are no moment become Notifications rows. */
  lobbyHidden?: boolean;
  /** Wave 26 (T2): the story's last glitch (`NightView.glitch`, story ms). */
  glitch?: { at: number; text: string | null; light?: true } | null;
  /** Wave 26 (T2): what a live glitch does here — `full` (a guest, a player
   *  booth: ~6 s, swallows taps), `light` (a host booth: 2.5 s, look only).
   *  Absent → nothing (the director phone). Embedded → never. */
  takeover?: "full" | "light";
  /** Wave 37 (C5, a booth): a pop-out, the scanner, a guest card or PLAYER
   *  SELECT is up — no balloon shows (peeks too) and none times out; they
   *  wait. Stickies, the NOW bar and the modals are unaffected. Default false. */
  balloonsWait?: boolean;
}

/** How long the NOW bar stays flashed open on a new objective (visible time). */
export const NOW_FLASH_MS = 12_000;

/** What the Notifications window needs of the engine (`notifications.tsx` builds the rest). */
export interface NotifState {
  /** The rows before their words, newest first. */
  groups: readonly NotificationGroup[];
  /** The bell's count. */
  unread: number;
  /** This sign-in's acked bigs, seen moments, deleted rows and read mark (mutable; `save` after a change). */
  sign: SignInMemory;
  /** Persist what changed and re-render. */
  save: (what: "deleted" | "seen" | "read") => void;
  /** A row's moment was acted on (read). */
  markSeen: (key: string) => void;
}

interface Engine {
  input: MomentsInput;
  level: AlertLevel;
  surfaces: Surfaces;
  held: boolean;
  missed: number;
  glitch: number | null;
  /** Wave 26 (T2): the glitch takeover on screen, if any. */
  takeover: { at: number; text: string | null; light: boolean } | null;
  toast: Alert | null;
  replay: () => void;
  dismiss: (q: Queued) => void;
  /** Take an exit: go, and the moment is done (never missed, however quick the tap). */
  act: (q: Queued, e: Exit) => void;
  /** A moment's exits on a surface (balloon 1, everything else 2). */
  exits: (m: Moment, max: 1 | 2, opts?: { big?: boolean; inlineCard?: boolean }) => Exit[];
  /** Go to an exit's place (no moment closed). */
  goTo: (e: Exit) => void;
  /** Take an exit for a moment by key: closes it (acted) if it waits in the queue, else just goes. */
  takeExit: (key: string, e: Exit) => void;
  /** Acknowledge a big moment (persisted: a reload never shows it again). */
  ack: (q: Queued) => void;
  dismissToast: () => void;
  hold: (delta: number) => void;
  /** Wave 37: the sticky is folded away (the pin rail's "+n"): off the screen, its clock stopped. */
  fold: (delta: number) => void;
  /** These moments are read (shown elsewhere in full): off the queue, never missed. */
  readMany: (keys: readonly string[]) => void;
  /** Close a moment with no exit taken: `acted` = it was opened (never missed). */
  close: (q: Queued, acted: boolean) => void;
  /** Does this blue screen carry the fatal-exception boilerplate (the first of the sign-in only)? */
  boilerplate: (key: string) => boolean;
  notif: NotifState;
}

export type { Engine as MomentsEngine };

const EngineContext = createContext<Engine | null>(null);

/** The pre-wave-18 exits: the pass, or the moment's room ("Open ›"). */
function legacyExits(m: Moment, input: MomentsInput): Exit[] {
  const room = m.pass === true ? m.channel : input.exitRoom !== undefined ? input.exitRoom(m) : m.channel === "lobby" ? null : m.channel;
  const exit = momentExit({ pass: m.pass, channel: room }, { room: input.openRoom !== undefined, pass: input.openPass !== undefined });
  if (exit === "pass") return [{ label: "Show my pass", icon: "pass", nav: { to: "pass" } }];
  if (exit === "room" && room !== null) return [{ label: room.startsWith("loc:") ? "Go there ›" : "Open ›", icon: room.startsWith("loc:") ? "pin" : "reply", nav: { to: "room", id: room } }];
  return [];
}

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
  const [folds, setFolds] = useState(0);
  // Wave 26 (T2, C3): the glitch takeover on screen. While it runs every
  // surface waits (`surfacesOf`'s `covered`), so a sticky or a balloon lands
  // right after it, never under it; the wiring is with the glitch below.
  const [takeover, setTakeover] = useState<Engine["takeover"]>(null);
  const [tick, setTick] = useState(() => Date.now());
  // Bumped when the sign-in memory changes (a row deleted, the window read).
  const [rev, setRev] = useState(0);
  const level = input.alertLevel ?? DEFAULT_ALERT_LEVEL;

  const live = useRef({ visible, level, held, phase: input.phase ?? null });
  live.current = { visible, level, held, phase: input.phase ?? null };
  const viewer: Viewer = { role, me: input.me, here: input.here ?? null, filter: input.filter, ...(input.name !== undefined ? { name: input.name } : {}), ...(input.lobbyHidden === true ? { lobbyHidden: true } : {}) };
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  const inputRef = useRef(input);
  inputRef.current = input;

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

  // --- a new sign-in -------------------------------------------------------------

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
    mem.extras = [];
    // A restart renumbers the seqs: an old on-screen stamp is no new m:<seq>.
    mem.shownAt.clear();
    dispatch({ type: "reset" });
    if (session === null) {
      mem.signIn = emptySignIn();
      return;
    }
    if (signIn) {
      loadDone(host.storage, role, session, alerts.mark(), mem);
      mem.signIn = loadSignIn(host.storage, session);
      mem.firstBsod = null;
      setRev((r) => r + 1);
    } else saveDone([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts.epoch, session]);

  const arrive = useCallback(
    (moments: Moment[], batch: boolean) => {
      if (moments.length === 0) return;
      const l = live.current;
      const now = storyNow(inputRef.current.messages.values(), inputRef.current.clock);
      const newestHouse = batch ? newestHouseSeq(inputRef.current.messages.values(), viewerRef.current, l.phase) : null;
      dispatch({ type: "arrive", moments, visible: l.visible, level: l.level, role, now: Date.now(), phase: l.phase, batch, storyNow: now, newestHouse, houseSince: mem.nowSince ?? null });
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
    const found = arrivals(input.messages.values(), mark, mem.processed, viewerRef.current, {
      now,
      phase: l.phase,
      bsod: role === "guest" && l.level === "bsod",
      beats: mem.beats,
    });
    const { seen } = found;
    for (const s of seen) {
      mem.processed.add(s);
      if (s > mem.processedMax) mem.processedMax = s;
    }
    // An acknowledged big moment never comes back (a reload, a reconnect);
    // a house moment that only sends a guest already on a side to choose one
    // is done before it shows.
    let moments = found.moments.filter((m) => !mem.signIn.acked.has(m.key) && !(input.sideChosen === true && sendsToSides(m)));
    // A booth: its big moments and `!` readouts about a guest are pop-outs.
    const adapter = input.popOutAdapter;
    if (role === "booth" && adapter !== undefined) {
      const kept: Moment[] = [];
      for (const m of moments) {
        const msg = m.seq !== null ? input.messages.get(m.seq) : undefined;
        if (msg === undefined || !popOutCandidate(momentMessage(msg), m.severity)) {
          kept.push(m);
          continue;
        }
        const w = momentMessage(msg);
        const verdict = adapter(w);
        if (verdict !== null) offerPopOut(session, w, verdict, { ...(input.openCard !== undefined ? { openCard: input.openCard } : {}), ...(input.openRoom !== undefined ? { openRoom: input.openRoom } : {}) });
      }
      moments = kept;
    }
    // A reconnect's backlog (a new history since the last pass) is replayed
    // like a wake: the bigs and the newest house banner. A live stream just
    // queues, however many moments one drain posted.
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
    for (const m of sorted.now) if (m.kind === "beat") keepExtra(mem, m);
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

  // A sign-in's first backlog (a new phone, a re-paired one, a cleared tab):
  // its alert mark starts at the newest seq, so the big moments it missed
  // would never show. Once the history and the view (its answered cards)
  // are in, the ones that still matter join the queue (GN-F7 / NM-F3).
  useEffect(() => {
    if (session === null || role !== "guest" || mem.swept === session) return;
    if ((alerts.histories?.() ?? 1) === 0 || input.objectives === undefined) return;
    mem.swept = session;
    const answered = input.widgets?.answered;
    const done = doneCards(input.messages);
    const old = sweepBigs(input.messages.values(), alerts.mark(), viewerRef.current, {
      now: storyNow(input.messages.values(), input.clock),
      phase: live.current.phase,
      acked: mem.signIn.acked,
      answered: (seq) => answered?.has(seq) === true || done.has(seq),
      processed: mem.processed,
    });
    if (old.length === 0) return;
    for (const m of old) if (m.seq !== null) mem.inflight.add(m.seq);
    arrive(old, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, input.objectives, input.widgets?.answered, session]);

  // A big moment a newer one replaced in a backlog is read: acknowledged, so
  // no reload brings it back and Notifications never holds it "in use".
  useEffect(() => {
    if (session === null) return;
    let changed = false;
    for (const m of state.missed) {
      if (m.superseded !== true || mem.signIn.acked.has(m.key)) continue;
      mem.signIn.acked.add(m.key);
      changed = true;
    }
    if (changed) {
      saveKeys(host.storage, ackedKey(session), mem.signIn.acked);
      setRev((r) => r + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.missed, session]);

  // The NOW objective changed: the house moments queued before it are no
  // longer news (G6; the phase alone missed ⏱ and 📋, GN-F2).
  // A load remembers when the NOW began (N3): a page opened after it
  // changed retires the house banners from before, as a live change does.
  const prevNow = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (input.objectives === undefined) return;
    const id = input.objectives[0]?.id ?? null;
    const before = prevNow.current;
    prevNow.current = id;
    const at = storyNow(input.messages.values(), input.clock);
    if (session !== null && before === undefined) {
      const since = nowSinceOnLoad(loadNow(host.storage, session), id);
      mem.nowSince = since;
      saveNow(host.storage, session, { id, since, seen: at });
      if (since !== null) dispatch({ type: "now", storyNow: since });
    } else if (session !== null && before !== id) {
      mem.nowSince = at;
      saveNow(host.storage, session, { id, since: at, seen: at });
    }
    if (before !== undefined && before !== id) dispatch({ type: "now", storyNow: at });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.objectives]);
  // The last time this phone looked (story clock): a NOW that changed while
  // it was closed changed after this.
  const lastSeenSave = useRef(0);
  useEffect(() => {
    if (session === null || prevNow.current === undefined) return;
    const at = storyNow(input.messages.values(), input.clock);
    if (at - lastSeenSave.current < 5_000) return;
    lastSeenSave.current = at;
    saveNow(host.storage, session, { id: prevNow.current, since: mem.nowSince ?? null, seen: at });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, input.clock, session]);

  // On a side now: a queued house moment that only asked them to choose one is read.
  useEffect(() => {
    if (input.sideChosen !== true) return;
    const keys = mem.state.queue.filter((q) => sendsToSides(q.moment)).map((q) => q.moment.key);
    if (keys.length > 0) dispatch({ type: "read", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.sideChosen]);

  // The level is switchable live (D2): what is still queued follows it, so a
  // host who calms the room never leaves phones stepping through old modals.
  useEffect(() => {
    // The phase is read, not watched: a stale moment is dropped only on a rise.
    dispatch({ type: "relevel", level, role, phase: live.current.phase });
  }, [level, role]);

  // A phase change retires the queued house moments of the phase before (G6).
  const prevPhase = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const now = input.phase;
    if (now === undefined) return;
    const before = prevPhase.current;
    prevPhase.current = now;
    if (before !== undefined && before !== now) dispatch({ type: "phase", phase: now });
  }, [input.phase]);

  // A card a newer one replaced, or one that asks nothing any more (an
  // ending's closing doors card), is no longer anyone's move: its big
  // moment leaves the queue (recheck N5: Walk in after the ending).
  useEffect(() => {
    const done = doneCards(input.messages);
    if (done.size === 0) return;
    const keys = mem.state.queue.filter((q) => q.moment.kind === "card" && q.moment.seq !== null && done.has(q.moment.seq)).map((q) => q.moment.key);
    if (keys.length > 0) dispatch({ type: "read", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, state.queue.length]);

  // The capture chain moved on (a capture, a release, a second
  // confrontation): the older found / sent bigs still queued are not true
  // any more — read, and never brought back (BN2-FB / NMR-1: a released
  // program was offered "Go to The Internet").
  useEffect(() => {
    if (session === null || role !== "guest") return;
    const queued = mem.state.queue.filter((q) => q.level === "big").map((q) => q.moment);
    if (queued.length === 0) return;
    const chain: { seq: number }[] = [];
    for (const msg of input.messages.values()) {
      const m = momentOf(msg, viewerRef.current, live.current.phase);
      if (m !== null && m.seq !== null && captureStage(m) !== null) chain.push({ seq: m.seq });
    }
    const keys = staleCaptureKeys(queued, chain, { captured: input.captured, clock: input.clock });
    if (keys.length === 0) return;
    for (const k of keys) mem.signIn.acked.add(k);
    saveKeys(host.storage, ackedKey(session), mem.signIn.acked);
    dispatch({ type: "read", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.messages, input.captured, input.clock, state.queue.length, session]);

  // A `!` pin taken down (an unpin, or a newer pin with its key) leaves the
  // queue and the missed list: a lifted mark is not news.
  useEffect(() => {
    const gone = retractedPinSeqs(input.messages.values());
    if (gone.size > 0) dispatch({ type: "retract", seqs: gone });
  }, [input.messages]);

  // A loud objective going live: one major moment per sign-in (persisted).
  useEffect(() => {
    if (session === null || input.objectives === undefined) return;
    const fresh = announceLoud(host.storage, role, session, input.objectives, storyNow([], input.clock), live.current.phase);
    for (const m of fresh) keepExtra(mem, m);
    arrive(fresh, false);
    // An objective that ended takes its moment with it.
    dispatch({ type: "objectives", live: new Set(input.objectives.map((o) => o.id)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.objectives, session]);

  useEffect(() => {
    settleNow();
  }, [state, settleNow]);

  // Woke up (or the last busy surface closed): the bigs and the newest house banner come back.
  const wake = useCallback(
    (manual: boolean) => {
      const i = inputRef.current;
      dispatch({ type: "wake", level: live.current.level, role, now: Date.now(), phase: i.phase ?? null, storyNow: storyNow(i.messages.values(), i.clock), newestHouse: newestHouseSeq(i.messages.values(), viewerRef.current, i.phase ?? null), houseSince: mem.nowSince ?? null, ...(manual ? { manual: true } : {}) });
    },
    [role],
  );
  const wasVisible = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisible.current) wake(false);
    wasVisible.current = visible;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const wasHeld = useRef(held);
  useEffect(() => {
    if (wasHeld.current && !held) {
      mem.lastHoldEnd = Date.now();
      dispatch({ type: "tick", now: Date.now(), held: true });
      wake(false);
    }
    wasHeld.current = held;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);
  // While held, a modal moment kept back 30 s counts as missed, and a big
  // one waits at most 8 s.
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

  const surfaces = surfacesOf(state, held, input.nowBar === true, held ? tick : Number.POSITIVE_INFINITY, takeover !== null);
  // Wave 37 (C5): what shows — a booth's balloons wait while it is busy face to face.
  const shown = waitBalloons(surfaces, input.balloonsWait === true);

  // The blue screen's boilerplate: only the sign-in's first (G6).
  if (surfaces.modal !== null && surfaces.modal.level === "bsod" && mem.firstBsod === null && !mem.signIn.bsodShown && session !== null) {
    mem.firstBsod = surfaces.modal.moment.key;
    mem.signIn.bsodShown = true;
    saveNumber(host.storage, bsodKey(session), 1);
  }
  const boilerplate = useCallback((key: string) => mem.firstBsod === key, []);

  // Wave 37: a sticky under a hold's layer (the booth's windows, the scan
  // sheet, the pass) or folded into the pin rail's "+n" is not on screen.
  const sticky = held || folds > 0 ? null : surfaces.sticky;
  // On-screen time per moment (a glance < 1 s is missed), and the chime the
  // first time a major (or big) moment reaches the screen.
  const onScreen = [surfaces.big, surfaces.now, shown.balloon, sticky, surfaces.modal].filter((q): q is Queued => q !== null);
  const onScreenKeys = onScreen.map((q) => q.moment.key).join("|");
  useEffect(() => {
    const t = Date.now();
    const on = visible ? onScreen.map((q) => q.moment.key) : [];
    // Wave 37: the clock runs only on screen. Off it (covered, folded, the
    // page hidden) `shownAt` holds minus the time it was on (`onMs`).
    // Wave 37 (C17): what reached the screen is read. A moment that left the
    // queue without a close (a NOW or phase change, an objective's end, a
    // newer banner) after a glance on screen is seen, not an unread row.
    for (const [k, at] of mem.shownAt) {
      if (!state.queue.some((q) => q.moment.key === k)) {
        if (onMs(k) >= GLANCE_MS) markSeen(k);
      } else if (on.includes(k) === at <= 0) mem.shownAt.set(k, at <= 0 ? t + at : at - t);
    }
    if (!visible) return;
    let ring = false;
    for (const q of onScreen) {
      if (mem.shownAt.has(q.moment.key)) continue;
      mem.shownAt.set(q.moment.key, t);
      if (q.moment.severity === "major" || q.moment.severity === "big") ring = true;
    }
    if (ring && input.sound) {
      playChime();
      vibrate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onScreenKeys, visible, state.queue]);

  // How long a moment was on screen (in all), and forget it.
  const onMs = (k: string) => {
    const t = Date.now();
    const at = mem.shownAt.get(k) ?? t;
    mem.shownAt.delete(k);
    return at <= 0 ? -at : t - at;
  };

  // A moment seen (≥ 1 s on screen, or acted on) is read in Notifications.
  const markSeen = useCallback(
    (key: string) => {
      if (mem.signIn.seen.has(key)) return;
      mem.signIn.seen.add(key);
      if (session !== null) saveKeys(host.storage, seenKey(session), mem.signIn.seen);
      setRev((r) => r + 1);
    },
    [session, host],
  );

  const close = useCallback(
    (q: Queued, acted: boolean, keep = false) => {
      const onScreenMs = onMs(q.moment.key);
      if (acted || onScreenMs >= GLANCE_MS || q.level === "big") markSeen(q.moment.key);
      dispatch({ type: "dismiss", key: q.moment.key, onScreenMs, acted, ...(keep ? { keep: true } : {}) });
    },
    [markSeen],
  );
  const dismiss = useCallback((q: Queued) => close(q, false), [close]);
  const ack = useCallback(
    (q: Queued) => {
      mem.signIn.acked.add(q.moment.key);
      if (session !== null) saveKeys(host.storage, ackedKey(session), mem.signIn.acked);
      close(q, true);
    },
    [close, session, host],
  );

  // A balloon tip times out after 8 s of visible time (on screen: never while it waits).
  const balloonKey = shown.balloon?.moment.key ?? null;
  useEffect(() => {
    if (balloonKey === null || !visible || shown.balloon === null) return;
    const q = shown.balloon;
    const t = window.setTimeout(() => dismiss(q), BALLOON_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balloonKey, visible, dismiss]);

  // Wave 37 (C16): a banner leaves after 45 s of visible time (seen: it was
  // on screen); a card's or a loud objective's sticky waits for its answer.
  const stickyKey = sticky?.moment.key ?? null;
  useEffect(() => {
    const q = sticky;
    if (q === null || !visible || q.moment.kind === "card" || q.moment.kind === "objective") return;
    const t = window.setTimeout(() => dismiss(q), STICKY_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stickyKey, visible, dismiss]);

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

  // Wave 26 (T2): the story's glitch takes the phone over, once, live
  // (`takeoverDue`), and holds the queue for its length (`takeover`, above).
  const glitchSeen = useRef<{ first: boolean; at: number | null }>({ first: true, at: null });
  const glitchAt = input.glitch?.at ?? null;
  useEffect(() => {
    if (input.clock === undefined) return;
    const r = glitchSeen.current;
    const due = input.takeover !== undefined && takeoverDue(r.at, input.glitch, input.clock, r.first, host.embedded);
    r.first = false;
    if (glitchAt !== null) r.at = glitchAt;
    if (!due || glitchAt === null) return;
    // Wave 32: a burst is the light one for every phone (`takeoverStart`).
    const { ms, ...shown } = takeoverStart(glitchAt, input.takeover!, input.glitch);
    setTakeover(shown);
    setHolds((h) => h + 1);
    const at = glitchAt;
    window.setTimeout(() => {
      // Only its own takeover: a second glitch inside the first's 6 s keeps its full length.
      setTakeover((t) => (t?.at === at ? null : t));
      setHolds((h) => Math.max(0, h - 1));
    }, ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glitchAt, input.clock === undefined]);
  useEffect(() => {
    if (input.takeover === undefined || host.embedded) return;
    const t = window.setTimeout(() => void loadTakeover().catch(() => {}), 3_000);
    return () => window.clearTimeout(t);
  }, [input.takeover, host.embedded]);

  // A guest fetches the big window's chunk early (after the first paint).
  useEffect(() => {
    if (role !== "guest") return;
    const t = window.setTimeout(() => void loadBig().catch(() => {}), 2_000);
    return () => window.clearTimeout(t);
  }, [role]);

  // --- exits ---------------------------------------------------------------------
  const entryTitles = useMemo(() => {
    const out = new Map<string, string>();
    for (const m of input.messages.values()) if (m.codex !== undefined) out.set(m.codex.entry, m.codex.title);
    return out;
  }, [input.messages]);
  const exits = useCallback(
    (m: Moment, max: 1 | 2, opts: { big?: boolean; inlineCard?: boolean } = {}): Exit[] => {
      const i = inputRef.current;
      if (i.go !== undefined && i.exitContext !== undefined) return exitsOf(m, i.exitContext(), max, { ...opts, entryTitles });
      return legacyExits(m, i).slice(0, max);
    },
    [entryTitles],
  );
  const goTo = useCallback((e: Exit) => {
    const i = inputRef.current;
    if (i.go !== undefined) {
      i.go(e.nav);
      return;
    }
    if (e.nav.to === "pass") i.openPass?.();
    else if (e.nav.to === "room") i.openRoom?.(e.nav.id);
  }, []);
  const act = useCallback(
    (q: Queued, e: Exit) => {
      goTo(e);
      // A big card still waiting on its answer is never acknowledged by an
      // exit: it steps aside and comes back on the next wake / load until it
      // is answered (NM-F2: the bottle escaped through "What do I do?").
      if (q.level === "big" && unansweredCard(q.moment, inputRef.current.widgets)) close(q, true, true);
      else if (q.level === "big") ack(q);
      else close(q, true);
    },
    [goTo, close, ack],
  );
  const takeExit = useCallback(
    (key: string, x: Exit) => {
      const q = mem.state.queue.find((y) => y.moment.key === key);
      if (q !== undefined) act(q, x);
      else goTo(x);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act, goTo],
  );
  const hold = useCallback((delta: number) => setHolds((h) => Math.max(0, h + delta)), []);
  const fold = useCallback((delta: number) => setFolds((h) => Math.max(0, h + delta)), []);
  // A booth tray's 🔔 (the old missed tray): everything missed comes back.
  const replay = useCallback(() => wake(true), [wake]);
  const readMany = useCallback((keys: readonly string[]) => {
    if (keys.length === 0) return;
    for (const k of keys) onMs(k);
    dispatch({ type: "read", keys });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Notifications ---------------------------------------------------------------
  const groups = useMemo(
    () => (role === "guest" ? notificationGroups(input.messages.values(), viewer, input.phase ?? null, mem.signIn.deleted, mem.extras) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.messages, input.phase, rev, role, state],
  );
  const notif = useMemo((): NotifState => {
    const sign = mem.signIn;
    return {
      groups,
      unread: unreadOf(groups, sign.seen, sign.readMark),
      sign,
      save: (what) => {
        if (session !== null) {
          if (what === "deleted") saveKeys(host.storage, deletedKey(session), sign.deleted);
          else if (what === "seen") saveKeys(host.storage, seenKey(session), sign.seen);
          else {
            saveNumber(host.storage, readMarkKey(session), sign.readMark);
            saveKeys(host.storage, seenKey(session), sign.seen);
          }
        }
        setRev((r) => r + 1);
      },
      markSeen,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, rev, session, host, markSeen]);

  // A loud raise (a booth's unsolicited readout) never toasts (useAlerts);
  // an older session's that did stands back for the moment saying it.
  const toast = alerts.alert !== null && alerts.alert.quiet !== true && state.queue.some((q) => sameWords(q.moment.text, alerts.alert!.text)) ? null : alerts.alert;

  return {
    input,
    level,
    surfaces: shown,
    held,
    missed: role === "guest" ? notif.unread : missedCount(state, held, tick),
    glitch,
    takeover,
    toast,
    replay,
    dismiss,
    act,
    exits,
    goTo,
    takeExit,
    ack,
    dismissToast: alerts.dismiss,
    hold,
    fold,
    readMany,
    close,
    boilerplate,
    notif,
  };
}

/** How many client-made moments (objectives, blue screens) Notifications keeps. */
const EXTRAS_MAX = 200;
function keepExtra(mem: EngineMemory, m: Moment): void {
  if (mem.extras.some((x) => x.key === m.key)) return;
  mem.extras.push(m);
  if (mem.extras.length > EXTRAS_MAX) mem.extras.splice(0, mem.extras.length - EXTRAS_MAX);
}

/** A moment that only sends the viewer to choose a side (a house one with `go: sides`). */
function sendsToSides(m: Moment): boolean {
  return m.house === true && m.severity !== "big" && (m.go ?? []).some((g) => g.kind === "sides");
}

/** The cards that no longer ask anything: replaced by a newer one of their
 *  kind in the room, or closed (`WidgetDef.closed`). */
export function doneCards(messages: ReadonlyMap<number, ChatMessage>): Set<number> {
  const done = supersededCards(messages.values());
  for (const m of messages.values()) if (m.kind === "widget" && m.widget !== undefined && WIDGETS[m.widget.kind]?.answerable === true && !cardAsks(m.widget)) done.add(m.seq);
  return done;
}

/** A card moment whose card the viewer has not answered. */
function unansweredCard(m: Moment, widgets: WidgetHook | undefined): boolean {
  const seq = m.card?.seq ?? (m.kind === "card" ? m.seq : null);
  return seq !== null && widgets !== undefined && !widgets.answered.has(seq);
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

/** The engine, for the lane's own surfaces (`notifications.tsx`, `popout.tsx`). */
export function useMomentsEngineContext(): Engine | null {
  return useContext(EngineContext);
}

/** The overlay: the feedback toast and the sticky banner (in flow, under the
 *  title bar), the balloon tip, the dialog box, the blue screen or the big
 *  moment, and the glitch. No surface has a Dismiss all (G6). */
export function MomentsLayer({ foldSticky = false }: { foldSticky?: boolean } = {}) {
  const e = useContext(EngineContext);
  useCounted(foldSticky, e?.fold);
  if (e === null) return null;
  const { surfaces: s } = e;
  const modal = s.modal;
  const big = s.big;
  const msg = big !== null && big.moment.seq !== null ? e.input.messages.get(big.moment.seq) : undefined;
  const card = msg?.widget;
  const inline = card !== undefined && widgetInline(card.kind) && e.input.widgets !== undefined && e.input.role === "guest";
  return (
    <>
      {s.sticky !== null && !foldSticky && (
        <StickyBanner q={s.sticky} count={s.stickyCount} exits={e.exits(s.sticky.moment, 2)} onExit={(x) => e.act(s.sticky!, x)} onDismiss={() => e.dismiss(s.sticky!)} />
      )}
      {e.toast !== null && (
        <div className="moments-anchor">
          <Toast text={e.toast.text} onDismiss={e.dismissToast} />
        </div>
      )}
      {s.balloon !== null && <Balloon q={s.balloon} exits={e.exits(s.balloon.moment, 1)} onExit={(x) => e.act(s.balloon!, x)} onDismiss={() => e.dismiss(s.balloon!)} />}
      {modal !== null && modal.level === "dialog" && (
        <MomentDialog key={modal.moment.key} q={modal} index={s.modalIndex} total={s.modalTotal} exits={e.exits(modal.moment, 2)} onExit={(x) => e.act(modal, x)} onDismiss={() => e.dismiss(modal)} />
      )}
      {modal !== null && modal.level === "bsod" && (
        <BlueScreen
          key={modal.moment.key}
          q={modal}
          index={s.modalIndex}
          total={s.modalTotal}
          exits={e.exits(modal.moment, 2)}
          onExit={(x) => e.act(modal, x)}
          onDismiss={() => e.dismiss(modal)}
          boilerplate={e.boilerplate(modal.moment.key)}
        />
      )}
      {big !== null && <BigSlot e={e} q={big} index={s.bigIndex} total={s.bigTotal} inline={inline} {...(inline && card !== undefined && msg !== undefined ? { card: { card, seq: msg.seq, room: msg.title } } : {})} />}
      {e.glitch !== null && <Glitch key={e.glitch} />}
      {e.takeover !== null && <TakeoverSlot key={e.takeover.at} t={e.takeover} sound={e.input.sound} />}
    </>
  );
}

/** Wave 26 (T2): the takeover, lazily; the short glitch while it loads or if it won't. */
function TakeoverSlot({ t, sound }: { t: NonNullable<Engine["takeover"]>; sound: boolean }) {
  const C = LazyTakeover.current();
  return (
    <ChunkBoundary fallback={() => <Glitch />}>
      <Suspense fallback={<Glitch />}>
        <C text={t.text} light={t.light} sound={sound} />
      </Suspense>
    </ChunkBoundary>
  );
}

/** The big window, lazily: its words and an OK if the chunk won't load. */
function BigSlot({ e, q, index, total, inline, card }: { e: Engine; q: Queued; index: number; total: number; inline: boolean; card?: BigCard }) {
  const Big = LazyBig.current();
  const props = {
    q,
    index,
    total,
    exits: e.exits(q.moment, 2, inline ? { inlineCard: true } : { big: true }),
    onExit: (x: Exit) => e.act(q, x),
    onAck: () => e.ack(q),
    ...(card !== undefined ? { card, widgets: e.input.widgets } : {}),
  };
  return (
    <ChunkBoundary
      fallback={(retry) => (
        <BigFallback
          q={q}
          onAck={() => e.ack(q)}
          retry={() => {
            LazyBig.again();
            retry();
          }}
        />
      )}
    >
      <Suspense fallback={null}>
        <Big key={q.moment.key} {...props} />
      </Suspense>
    </ChunkBoundary>
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

/** The sticky on screen, if any, how many wait and their keys (the pin rail
 *  folds them into a "+n" on the guest's own pin), and `read` to take some
 *  off the queue as read (the `!` pin the rail already shows in full). */
export function useStickyMoment(): { key: string | null; count: number; keys: readonly string[]; read: (keys: readonly string[]) => void } {
  const e = useContext(EngineContext);
  const key = e?.surfaces.sticky?.moment.key ?? null;
  const count = e?.surfaces.stickyCount ?? 0;
  const joined = (e?.surfaces.stickyKeys ?? []).join("\u0000");
  const read = e?.readMany;
  return useMemo(() => ({ key, count, keys: joined === "" ? [] : joined.split("\u0000"), read: read ?? (() => {}) }), [key, count, joined, read]);
}

/** Is a big moment on screen now (it covers everything: a sheet under it steps aside)? */
export function useBigOnScreen(): boolean {
  const e = useContext(EngineContext);
  return e?.surfaces.big != null;
}

/** The missed count (a guest: the unread Notifications), the booth's replay, the level. */
export function useMoments(): { missed: number; replay: () => void; level: AlertLevel } {
  const e = useContext(EngineContext);
  return useMemo(() => ({ missed: e?.missed ?? 0, replay: e?.replay ?? (() => {}), level: e?.level ?? DEFAULT_ALERT_LEVEL }), [e?.missed, e?.replay, e?.level]);
}

/** The bin glyph: empty, or paper sticking out (§1.1). */
function BinGlyph({ full }: { full: boolean }) {
  return (
    <svg className="moments-bin" width="20" height="20" viewBox="0 0 16 16" aria-hidden focusable="false">
      {full && <path className="moments-bin-paper" d="M5 1.5h5l1.5 1.5V5H5Z" />}
      <path className="moments-bin-lid" d="M2.5 4.5h11v1.5h-11Z" />
      <path className="moments-bin-can" d="M3.5 6.5h9l-.8 8h-7.4Z" />
      <path className="moments-bin-rib" d="M6 8v5M8 8v5M10 8v5" />
    </svg>
  );
}

/** The top bar's 🔔: the Recycle-Bin bell with the unread count (GUEST-SPEC §1.1); opens Notifications. */
export function BellButton({ onOpen, className }: { onOpen?: () => void; className?: string }) {
  const e = useContext(EngineContext);
  const n = e?.notif.unread ?? 0;
  const open = onOpen ?? e?.input.openNotifications;
  const label = n > 0 ? `Notifications, ${n} new` : "Notifications";
  return (
    <button type="button" className={`moments-bell${n > 0 ? " full" : ""}${className ? ` ${className}` : ""}`} data-tour="bell" aria-label={label} title={label} onClick={() => open?.()}>
      <BinGlyph full={n > 0} />
      {n > 0 && <span className="moments-bell-count">{n > 9 ? "9+" : n}</span>}
    </button>
  );
}

/** A busy surface (the scanner, a guest card, the host drawer, the
 *  full-screen pass, the scan sheet) calls this while open: no `dialog` /
 *  `bsod` shows while any hold is active, and a big moment waits at most
 *  8 s; moments queue behind it and show when the last hold releases (one
 *  kept back 30 s counts as missed). A booth's pop-outs dock instead. */
export function useMomentsHold(active: boolean): void {
  useCounted(active, useContext(EngineContext)?.hold);
}

/** One of a counter's users (`hold`, `fold`) while `active`. */
function useCounted(active: boolean, count: ((delta: number) => void) | undefined): void {
  useEffect(() => {
    if (!active || count === undefined) return;
    count(1);
    return () => count(-1);
  }, [active, count]);
}
