//! Alerts that actually land (K-06 / N-07). An alert is a `!` broadcast
//! (`ChatMessage.alert`) or, in a booth, an unsolicited readout (the late
//! list, a private warning). Either one banners, chimes and buzzes.
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
import type { ChatMessage } from "./types.ts";

/** An alert on screen — a `!` broadcast (seq ≥ 0) or a booth readout (seq < 0). */
export interface Alert {
  seq: number;
  text: string;
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

/**
 * A booth's alerts (B1): its stream also carries lobby messages addressed to
 * single guests (the booth builds per-guest threads from them), and a
 * guest's own `!` pin — "🚨 GO TO THE INTERNET. You are marked…" — must not
 * banner every booth. A booth's alert is one for everyone, one addressed to
 * its character (`@<Character>`), or a staff notice (empty audience, e.g.
 * `# hosts`). The booth's own cues ride its readouts (`raise`).
 */
export function boothAlertFilter(character: string): AlertFilter {
  const me = `@${character}`;
  return (m) => m.audience === "all" || (Array.isArray(m.audience) && (m.audience.length === 0 || m.audience.includes(me)));
}

/** Alert broadcasts newer than `sinceSeq`, oldest first. */
export function pickAlerts(messages: Iterable<ChatMessage>, sinceSeq: number, forMe?: AlertFilter): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) if (m.alert === true && m.seq > sinceSeq && !m.hidden && (forMe?.(m) ?? true)) out.push(m);
  return out.sort((a, b) => a.seq - b.seq);
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
 * `forMe` rejects included — it is never shown later either). `now` is
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
  const fresh = forMe === undefined ? all : all.filter(forMe);
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

export interface Alerts {
  alert: Alert | null;
  dismiss: () => void;
  /** Banner + chime arbitrary text now (a booth readout). `quiet` banners
   *  without the chime / buzz (a refusal, not a show alarm). */
  raise: (text: string, opts?: { quiet?: boolean }) => void;
  /** Call from the stream's `onHistory`, before the messages are applied. */
  onHistory: (list: readonly ChatMessage[]) => void;
  /** The story restarted under a live session: the next history is old news. */
  rebase: () => void;
}

/**
 * The alert state for one role session. `session` identifies the sign-in
 * (its token) — the persisted mark only applies to the same one; `clock` is
 * the latest view's story clock; `storageKey` where the mark persists.
 */
export function useAlerts(opts: {
  messages: ReadonlyMap<number, ChatMessage>;
  clock: number | null | undefined;
  session: string | null;
  storage: SessionStorage;
  storageKey: string;
  sound: boolean;
  /** Only these alerts banner (a booth's `boothAlertFilter`); the mark still
   *  moves past the rest. Read through a ref — it may be a fresh closure. */
  forMe?: AlertFilter;
}): Alerts {
  const { messages, clock, session, storage, storageKey, sound } = opts;
  const forMeRef = useRef(opts.forMe);
  forMeRef.current = opts.forMe;
  const mark = useRef(-1);
  const rebasing = useRef(false);
  const baseline = useRef(false);
  const owner = useRef<string | null>(null);
  const pendingChime = useRef(false);
  const readoutSeq = useRef(-1);
  const [alert, setAlert] = useState<Alert | null>(null);
  const visible = useVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

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

  const show = useCallback(
    (a: Alert, quiet = false) => {
      setAlert(a);
      if (!sound || quiet) return;
      if (visibleRef.current) {
        playChime();
        vibrate();
      } else {
        pendingChime.current = true;
      }
    },
    [sound],
  );

  useEffect(() => {
    if (session === null) return;
    const before = mark.current;
    const next = nextAlert(messages.values(), before, clock, forMeRef.current);
    if (next.mark === before) return;
    mark.current = next.mark;
    persist();
    if (next.alert !== null) show({ seq: next.alert.seq, text: next.alert.text });
    // `clock` is read, not watched: a snapshot alone never raises an alert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, session, show, persist]);

  // Woke up: sound what landed while hidden.
  useEffect(() => {
    if (visible && pendingChime.current) {
      pendingChime.current = false;
      if (sound) {
        playChime();
        vibrate();
      }
    }
  }, [visible, sound]);

  // Auto-dismiss on visible time only — a banner that arrived with the
  // screen off is still there when the phone wakes.
  useEffect(() => {
    if (alert === null || !visible) return;
    const t = window.setTimeout(() => setAlert(null), BANNER_MS);
    return () => window.clearTimeout(t);
  }, [alert, visible]);

  const dismiss = useCallback(() => {
    pendingChime.current = false;
    setAlert(null);
  }, []);
  const raise = useCallback((text: string, o?: { quiet?: boolean }) => show({ seq: readoutSeq.current--, text }, o?.quiet === true), [show]);
  const onHistory = useCallback(
    (list: readonly ChatMessage[]) => {
      const m = markAfterHistory(list, mark.current, rebasing.current);
      rebasing.current = false;
      const first = baseline.current;
      baseline.current = false;
      if (m !== mark.current || first) {
        mark.current = m;
        persist();
      }
    },
    [persist],
  );
  const rebase = useCallback(() => {
    rebasing.current = true;
  }, []);
  return { alert, dismiss, raise, onHistory, rebase };
}
