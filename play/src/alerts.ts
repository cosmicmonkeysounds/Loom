//! Alerts that actually land (K-06 / N-07). An alert is a `!` broadcast
//! (`ChatMessage.alert`) or, in a booth, an unsolicited readout (the late
//! list, a private warning). Wave 13: the moments layer
//! (`moments/provider.tsx`) turns them into moments on the interrupt ladder
//! and settles the mark this hook persists; `useAlerts` keeps the mark, the
//! audio unlock and the quiet feedback toast (`raise`).
//!
//! Three things a phone does to alerts, and what this module does back:
//! - **The screen goes off.** The SSE stream drops; on wake it reconnects
//!   and the server replays `history`. The mark of the last alert seen is
//!   therefore *kept* across re-histories (and persisted per session, so an
//!   iOS tab the OS discarded still knows), and the newest unseen alert
//!   from the last 10 story-minutes is bannered. Older ones are skipped: a
//!   re-login must not replay every alarm of the night.
//! - **Audio needs a gesture.** One shared `AudioContext`, created and
//!   unlocked on the first tap (iOS stays silent for a context made later,
//!   outside a gesture), resumed before every chime.
//! - **A hidden page can't sound.** An alert that lands while the page is
//!   hidden chimes when it becomes visible, and its banner's auto-dismiss
//!   only counts visible time.
//!
//! Pure helpers first (unit-tested in `test/alerts.test.ts`), then the hook.

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionStorage } from "./host.ts";
import { activePins } from "./pins.ts";
import type { ChatMessage } from "./types.ts";

/** A feedback toast on screen (seq < 0, client-made). Wave 13: show alarms are moments. */
export interface Alert {
  seq: number;
  text: string;
  /** Raised as the answer to the viewer's own press. */
  quiet?: boolean;
}

/** How old (story clock) a missed alert may be and still banner on wake. */
export const ALERT_WINDOW_MS = 10 * 60_000;
/** A readout this soon after the booth's own action is its answer, not news. */
export const READOUT_GRACE_MS = 4_000;
/** How long a banner stays up, counting only time the page is visible. */
export const BANNER_MS = 15_000;

/** Which alerts are this session's own (default: every one — a guest's view
 *  only carries its own messages). */
export type AlertFilter = (m: ChatMessage) => boolean;

/** Rooms where an empty audience means the line reached nobody — a
 *  `to location(room)` / `to participant(x)` alert whose scope was empty
 *  lands in the lobby with `[]` — rather than a staff back-room (`# hosts`
 *  is a faction room no guest belongs to, so its notices carry `[]`). */
const NOBODY_WHEN_EMPTY: ReadonlySet<string> = new Set(["lobby", "location", "dm", "codex", "quests", "wallet"]);

/** An empty-audience message that reached nobody: a nobody-room above, or a
 *  derived `faction:<X>` mirror of a `to faction(X)` broadcast while X has
 *  no members (its audience is X's members, so `[]` = nobody). Authored
 *  staff rooms keep their own ids (`hosts`), so they still count as staff. */
function reachedNobody(m: ChatMessage): boolean {
  return NOBODY_WHEN_EMPTY.has(m.channelKind) || m.channel === "lobby" || m.channel.startsWith("faction:");
}

/**
 * A booth's alerts (B1): its stream also carries lobby messages addressed to
 * single guests (the booth builds per-guest threads from them), and a
 * guest's own `!` pin — "🚨 GO TO THE INTERNET. You are marked…" — must not
 * banner every booth. A booth's alert is one for everyone, one addressed to
 * its character (`@<Character>`), or a staff notice (empty audience in an
 * authored staff room, e.g. `# hosts`; never an empty `faction:<X>` mirror).
 * The booth's own cues ride its readouts (`raise`).
 */
export function boothAlertFilter(character: string): AlertFilter {
  const me = `@${character}`;
  return (m) => {
    if (m.audience === "all") return true;
    if (!Array.isArray(m.audience)) return false;
    if (m.audience.length === 0) return !reachedNobody(m);
    return m.audience.includes(me);
  };
}

/** Alert broadcasts newer than `sinceSeq`, oldest first. */
export function pickAlerts(messages: Iterable<ChatMessage>, sinceSeq: number, forMe?: AlertFilter): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) if (m.alert === true && m.seq > sinceSeq && !m.hidden && (forMe?.(m) ?? true)) out.push(m);
  return out.sort((a, b) => a.seq - b.seq);
}

/** The seqs of `!` pins a later `unpin` (or a newer pin with the same key)
 *  already took down — the 🩹 after a mis-tapped mark, the dance lifting a
 *  `!!` takeover. Such a pin is no longer news: it never banners on wake,
 *  and a banner still up for it goes away. */
export function retractedPinSeqs(messages: Iterable<ChatMessage>): Set<number> {
  const list = [...messages];
  const live = new Set(activePins(list).map((m) => m.seq));
  const out = new Set<number>();
  for (const m of list) if (m.alert === true && m.pin !== undefined && !live.has(m.seq)) out.add(m.seq);
  return out;
}

/** The banner left once the pins in `gone` are taken down: `alert` itself,
 *  or null when it is one of them. Fed the *latest* banner (a functional
 *  state update), so a newer pin that replaced the one on screen in the
 *  same render — a second `!` pin with the same key — is kept, never wiped
 *  with the pin it replaced. A readout (negative seq) is never a pin. */
export function bannerAfterRetract(alert: Alert | null, gone: ReadonlySet<number>): Alert | null {
  return alert !== null && alert.seq >= 0 && gone.has(alert.seq) ? null : alert;
}

/** The highest seq in a message list (−1 when empty). */
export function maxSeqOf(messages: Iterable<ChatMessage>): number {
  let max = -1;
  for (const m of messages) if (m.seq > max) max = m.seq;
  return max;
}

/** The newest story-clock `ts` in a message list (−∞ when empty). */
export function maxTsOf(messages: Iterable<ChatMessage>): number {
  let max = Number.NEGATIVE_INFINITY;
  for (const m of messages) if (m.ts > max) max = m.ts;
  return max;
}

/**
 * The alert to banner now, given the last one seen (`mark`): the newest
 * unseen alert at most `ALERT_WINDOW_MS` older than `now`, else null. The
 * returned `mark` moves past every unseen alert, shown or skipped (an alert
 * `forMe` rejects, or a `!` pin already taken down, included — it is never
 * shown later either). `now` is
 * the story clock — the server view's `clock`, or the newest message's `ts`
 * when that is later (a view is only rebuilt on state changes).
 */
export function nextAlert(
  messages: Iterable<ChatMessage>,
  mark: number,
  clock: number | null | undefined,
  forMe?: AlertFilter,
): { alert: ChatMessage | null; mark: number } {
  const list = [...messages];
  const all = pickAlerts(list, mark);
  if (all.length === 0) return { alert: null, mark };
  const last = all[all.length - 1]!;
  const retracted = retractedPinSeqs(list);
  const fresh = all.filter((m) => !retracted.has(m.seq) && (forMe?.(m) ?? true));
  const now = Math.max(clock ?? Number.NEGATIVE_INFINITY, maxTsOf(list));
  const recent = fresh.filter((m) => m.ts >= now - ALERT_WINDOW_MS);
  return { alert: recent.length > 0 ? recent[recent.length - 1]! : null, mark: last.seq };
}

/**
 * The mark after a history (re)load. Normally unchanged — that is the whole
 * fix: a reconnect's replay must not swallow what landed while the screen
 * was off. But after a story restart (`rebase`, or a stream that now ends
 * below the mark because seqs were renumbered) the backlog is old news.
 */
export function markAfterHistory(list: readonly ChatMessage[], mark: number, rebase: boolean): number {
  const max = maxSeqOf(list);
  if (rebase || max < mark) return max;
  return mark;
}

/**
 * The mark a sign-in starts from: its persisted mark (a reconnect or a
 * reloaded tab of the *same* session keeps what it had seen), else a
 * `baseline` — a brand-new sign-in (a performer at the call, a loaner
 * phone, a re-paired guest) takes its first history as old news rather
 * than chiming the newest alarm of the last ten minutes.
 */
export function initialMark(stored: { session: string; mark: number } | null, session: string | null): { mark: number; baseline: boolean } {
  if (session !== null && stored !== null && stored.session === session) return { mark: stored.mark, baseline: false };
  return { mark: -1, baseline: session !== null };
}

/** Is a booth readout news (chime it) rather than the answer to the booth's own scan / act? */
export function unsolicitedReadout(lastActionAt: number, now: number): boolean {
  return now - lastActionAt > READOUT_GRACE_MS;
}

// --- sound + buzz -----------------------------------------------------------

type AudioCtor = typeof AudioContext;
let shared: AudioContext | null = null;
let unlockInstalled = false;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Create (once) and resume the shared context. Inside a gesture this is
 *  what unlocks audio on iOS; outside one it just resumes what was unlocked. */
function ensureAudio(): AudioContext | null {
  try {
    if (shared === null) {
      const Ctx = audioCtor();
      if (Ctx === null) return null;
      shared = new Ctx();
    }
    if (shared.state === "suspended") void shared.resume().catch(() => {});
    return shared;
  } catch {
    return null;
  }
}

/** Unlock audio on the first tap / key anywhere on the page (idempotent). */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    const ctx = ensureAudio();
    if (ctx === null) return;
    try {
      // A silent one-sample buffer, played inside the gesture, is what makes
      // iOS Safari treat the context as user-started.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22_050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* fine */
    }
    if (ctx.state === "running") {
      for (const ev of ["pointerdown", "touchend", "keydown"]) window.removeEventListener(ev, unlock, true);
    }
  };
  for (const ev of ["pointerdown", "touchend", "keydown"]) window.addEventListener(ev, unlock, true);
}

/**
 * A short two-tone chime, synthesised (no asset, no network), on the shared
 * context. Silent until the page has been tapped once — the banner and the
 * vibration still land.
 */
export function playChime(): void {
  const ctx = ensureAudio();
  if (ctx === null) return;
  try {
    const tone = (freq: number, at: number, dur: number): void => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    tone(880, 0, 0.18);
    tone(1320, 0.2, 0.28);
  } catch {
    /* no audio — fine */
  }
}

/** Buzz the phone, where the browser allows it (never on iOS). */
export function vibrate(): void {
  try {
    navigator.vibrate?.([180, 80, 180]);
  } catch {
    /* unsupported */
  }
}

// --- the hook ---------------------------------------------------------------

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

/** Track `document.visibilityState`. */
export function useVisible(): boolean {
  const [visible, setVisible] = useState(pageVisible);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setVisible(pageVisible());
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

interface StoredMark {
  session: string;
  mark: number;
}

/** How long a feedback toast stays up, counting only visible time. */
export const TOAST_MS = 5_000;
/** How many recent toasts the moments layer can compare a readout against. */
const RECENT_TOASTS = 6;

/** A feedback toast raised recently (wall clock). */
export interface RecentToast {
  text: string;
  at: number;
  quiet: boolean;
}

export interface Alerts {
  /** The feedback toast on screen (✔ Done, a refusal). Wave 13: never a show alarm — those are moments. */
  alert: Alert | null;
  dismiss: () => void;
  /** Toast text now. `quiet` = the answer to the viewer's own press (it stands in for a readout saying the same). Never chimes. */
  raise: (text: string, opts?: { quiet?: boolean }) => void;
  /** Call from the stream's `onHistory`, before the messages are applied. */
  onHistory: (list: readonly ChatMessage[]) => void;
  /** The story restarted under a live session: the next history is old news. */
  rebase: () => void;
  /** Moments: every message at or below this seq is settled (seen, or old news). Persisted per sign-in. */
  mark: () => number;
  /** Moments: move the mark up to `seq` (never down) and persist it. */
  settle: (seq: number) => void;
  /** Bumps when a history rebased the mark (a story restart, renumbered seqs): the moments queue is old news. */
  epoch: number;
  /** The last few toasts, newest last (the moments layer drops a readout a quiet toast already said). */
  recent: () => readonly RecentToast[];
}

/**
 * The alert state for one role session: the persisted mark the moments
 * layer settles (`moments/provider.tsx` turns messages into moments), and
 * the quiet feedback toast. `session` identifies the sign-in (its token) —
 * the persisted mark only applies to the same one; `storageKey` is where
 * the mark persists. `clock` and `forMe` are kept for the callers' shape;
 * the moments layer reads the view's clock and the booth filter itself.
 */
export function useAlerts(opts: {
  messages: ReadonlyMap<number, ChatMessage>;
  clock: number | null | undefined;
  session: string | null;
  storage: SessionStorage;
  storageKey: string;
  sound: boolean;
  forMe?: AlertFilter;
}): Alerts {
  const { session, storage, storageKey, sound } = opts;
  const mark = useRef(-1);
  const rebasing = useRef(false);
  const baseline = useRef(false);
  const owner = useRef<string | null>(null);
  const toastSeq = useRef(-1);
  const recentRef = useRef<RecentToast[]>([]);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [epoch, setEpoch] = useState(0);
  const visible = useVisible();

  // Load the mark for this sign-in (a different session starts from scratch).
  if (owner.current !== session) {
    owner.current = session;
    const stored = session !== null ? storage.load<StoredMark>(storageKey) : null;
    const start = initialMark(stored, session);
    mark.current = start.mark;
    // A fresh sign-in's first history is the baseline (persisted even when
    // empty, so a reloaded tab of this session keeps its place).
    rebasing.current = start.baseline;
    baseline.current = start.baseline;
  }
  const persist = useCallback(() => {
    if (owner.current === null) return;
    try {
      storage.save(storageKey, { session: owner.current, mark: mark.current } satisfies StoredMark);
    } catch {
      /* storage full / blocked — the in-memory mark still works */
    }
  }, [storage, storageKey]);

  useEffect(() => {
    if (sound) installAudioUnlock();
  }, [sound]);

  // Auto-dismiss on visible time only.
  useEffect(() => {
    if (alert === null || !visible) return;
    const t = window.setTimeout(() => setAlert(null), TOAST_MS);
    return () => window.clearTimeout(t);
  }, [alert, visible]);

  const dismiss = useCallback(() => setAlert(null), []);
  const raise = useCallback((text: string, o?: { quiet?: boolean }) => {
    const quiet = o?.quiet === true;
    recentRef.current = [...recentRef.current, { text, at: Date.now(), quiet }].slice(-RECENT_TOASTS);
    setAlert({ seq: toastSeq.current--, text, quiet });
  }, []);
  const onHistory = useCallback(
    (list: readonly ChatMessage[]) => {
      const max = maxSeqOf(list);
      const rebased = !baseline.current && (rebasing.current || max < mark.current);
      const m = markAfterHistory(list, mark.current, rebasing.current);
      rebasing.current = false;
      const first = baseline.current;
      baseline.current = false;
      if (m !== mark.current || first) {
        mark.current = m;
        persist();
      }
      if (rebased) setEpoch((e) => e + 1);
    },
    [persist],
  );
  const rebase = useCallback(() => {
    rebasing.current = true;
  }, []);
  const getMark = useCallback(() => mark.current, []);
  const settle = useCallback(
    (seq: number) => {
      if (seq <= mark.current) return;
      mark.current = seq;
      persist();
    },
    [persist],
  );
  const recent = useCallback(() => recentRef.current, []);
  return { alert, dismiss, raise, onHistory, rebase, mark: getMark, settle, epoch, recent };
}
