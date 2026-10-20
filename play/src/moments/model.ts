//! The moments model (wave 13, the moments lane): the pure part of the
//! interrupt layer. A *moment* is something the story wants a phone to
//! notice — a `!` alert, a readout for you, a quest that starts, a card that
//! asks you, a loud objective going live, and at `bsod` the first line of
//! every beat that reaches you. Each one renders on a rung of the Win95
//! ladder (balloon → sticky → dialog → bsod): a major moment at the story's
//! level, a minor one a rung lower (never below a balloon), a booth never
//! above `sticky`.
//!
//! Everything here is a pure function or a reducer over plain data, so the
//! queue, the hold, the missed list and the wake replay are unit-tested
//! (`test/moments-model.test.ts`) without React. `provider.tsx` drives it.

import { lowerRung } from "../../../core/src/delivery.ts";
import type { AlertLevel, ChatMessage, MomentClass, ObjectiveView } from "../types.ts";

// --- the moments themselves --------------------------------------------------

/** What made the moment (drives its icon, its caption and its exits). */
export type MomentKind = "alert" | "readout" | "card" | "quest" | "objective" | "beat" | "other";

/** One moment waiting to be shown. */
export interface Moment {
  /** The message it came from (`m:<seq>`), or a client-made key (`o:<objective>`). */
  key: string;
  seq: number | null;
  severity: MomentClass;
  kind: MomentKind;
  /** Who or what speaks: the dialog's caption ("Task Manager", "Trabolta"). */
  caption: string;
  text: string;
  /** "Take me there": the room it belongs to, when it has one. */
  channel: string | null;
  /** "Take me there" opens the full-screen pass instead (the loud "show your pass" objective). */
  pass?: boolean;
  /** The beat the line was spoken in (a blue screen is one per beat). */
  beat?: string | null;
  /** The story clock (ms) when it arrived. */
  at: number;
  /** `view.night.phase` when it arrived (a phase change makes a missed moment stale). */
  phase: string | null;
}

/** How a moment renders at a level (`lowerRung` for a minor one). */
export interface MomentRender {
  moment: Moment;
  level: AlertLevel;
}

/** Who is looking: a guest, or a booth's character. */
export interface Viewer {
  role: "guest" | "booth";
  /** Guest id, or the booth's character. */
  me: string;
  /** The room the guest stands in (`loc:<Place>`), for the blue screen's "reaches you". */
  here?: string | null;
  /** The booth's filter (`boothAlertFilter`). */
  filter?: (m: ChatMessage) => boolean;
}

/** The highest rung a booth ever shows: performers are working, a modal would stop them. */
export const BOOTH_CAP: AlertLevel = "sticky";
/** How long a balloon tip stays up (visible time). */
export const BALLOON_MS = 8_000;
/** A moment on screen for less than this before it was dismissed counts as missed. */
export const GLANCE_MS = 1_000;
/** A moment held behind a busy surface this long counts as missed. */
export const HOLD_MISS_MS = 30_000;
/** More missed moments than this replay as one "You missed n moments" list. */
export const REPLAY_MAX = 3;
/** Moments older than this (story clock) are old news after a reload. */
export const MOMENT_WINDOW_MS = 10 * 60_000;
/** A beat that goes quiet this long (story clock) and speaks again earns a new blue screen. */
export const BEAT_GAP_MS = 2 * 60_000;
/** The level-change glitch. */
export const GLITCH_MS = 600;

const RUNGS: readonly AlertLevel[] = ["balloon", "sticky", "dialog", "bsod"];

function rungIndex(level: AlertLevel): number {
  return RUNGS.indexOf(level);
}

/** The lower of two rungs. */
export function capLevel(level: AlertLevel, cap: AlertLevel): AlertLevel {
  return rungIndex(level) <= rungIndex(cap) ? level : cap;
}

/** The level a viewer's moments use: a booth is capped at `sticky`. */
export function viewerLevel(level: AlertLevel, role: Viewer["role"]): AlertLevel {
  return role === "booth" ? capLevel(level, BOOTH_CAP) : level;
}

/**
 * The rung one moment renders on. A beat's blue screen is a blue screen
 * (it only exists at `bsod`); a major moment sits at the level; a minor one
 * one rung lower, floored at a balloon. A booth never climbs past `sticky`.
 */
export function rungFor(moment: Pick<Moment, "severity" | "kind">, level: AlertLevel, role: Viewer["role"]): AlertLevel {
  const at = viewerLevel(level, role);
  if (moment.kind === "beat") return role === "booth" ? lowerRung(at) : "bsod";
  return moment.severity === "major" ? at : lowerRung(at);
}

/** Empty-audience rooms where `[]` means the line reached nobody (mirror of `alerts.ts`). */
const NOBODY_WHEN_EMPTY: ReadonlySet<string> = new Set(["lobby", "location", "dm", "codex", "quests", "wallet"]);

/**
 * A booth's severity for a moment message (§9.6): a guest-facing `"all"`
 * alert is minor there (a balloon); only what is addressed `@<Character>`,
 * a staff room's notice (an empty audience in an authored staff room) and
 * the booth's own Inbox (`dm:<Character>`) keep their class.
 */
export function boothSeverity(m: ChatMessage, character: string, severity: MomentClass): MomentClass {
  if (severity === "minor") return "minor";
  if (m.channel === `dm:${character}`) return severity;
  if (m.audience === "all") return "minor";
  if (m.audience.length === 0) return NOBODY_WHEN_EMPTY.has(m.channelKind) || m.channel === "lobby" || m.channel.startsWith("faction:") ? "minor" : severity;
  return m.audience.includes(`@${character}`) ? severity : "minor";
}

/** The text a message moment shows. */
function momentText(m: ChatMessage): string {
  if (m.widget !== undefined) return (m.widget.text || m.text || "A card is waiting for you.").trim();
  if (m.quest !== undefined) return m.text.trim() !== "" ? m.text.trim() : m.quest.title;
  return m.text.trim();
}

function momentKindOf(m: ChatMessage): MomentKind {
  if (m.widget !== undefined) return "card";
  if (m.quest !== undefined) return "quest";
  if (m.readout === true) return "readout";
  if (m.alert === true) return "alert";
  return "other";
}

/** The caption for a message moment: the speaker, a quest's title, else the room. */
function momentCaption(m: ChatMessage, kind: MomentKind): string {
  if (kind === "quest" && m.quest !== undefined) return `New quest: ${m.quest.title}`;
  const from = m.from.trim();
  if (from !== "" && from !== "Narrator") return from;
  return m.title.trim() !== "" ? m.title.trim() : "Message";
}

/**
 * The moment a message makes for this viewer, or null. The server stamps
 * `moment`; an older server's `!` alert counts as major; a takeover has its
 * own layer (never a moment); a hidden message never is one. A booth runs
 * its filter first and then demotes guest-facing alerts.
 */
export function momentOf(m: ChatMessage, viewer: Viewer, phase: string | null): Moment | null {
  if (m.hidden || m.takeover === true) return null;
  let severity: MomentClass | null = m.moment ?? (m.alert === true ? "major" : null);
  if (severity === null) return null;
  if (viewer.role === "booth") {
    if (viewer.filter !== undefined && !viewer.filter(m) && m.channel !== `dm:${viewer.me}`) return null;
    severity = boothSeverity(m, viewer.me, severity);
  }
  const kind = momentKindOf(m);
  return {
    key: `m:${m.seq}`,
    seq: m.seq,
    severity,
    kind,
    caption: momentCaption(m, kind),
    text: momentText(m),
    channel: m.channel,
    beat: m.beat ?? null,
    at: m.ts,
    phase,
  };
}

/**
 * Does this line count for the blue screen (`bsod`): a scripted line of a
 * beat (`line` / `narration` with `beat`) that reaches the guest — their
 * DM threads, the lobby, or the room they stand in. Typed chat (no beat),
 * cards, notices and system rows never do.
 */
export function beatLineReaches(m: ChatMessage, viewer: Viewer): boolean {
  if (viewer.role !== "guest" || m.hidden || m.parentSeq !== null) return false;
  if (m.kind !== "line" && m.kind !== "narration") return false;
  if (m.beat === undefined || m.beat === null || m.beat === "") return false;
  if (m.ambient === true || m.notice !== undefined) return false;
  if (m.audience !== "all" && !m.audience.includes(viewer.me)) return false;
  if (m.channelKind === "dm" || m.channel === "lobby") return true;
  return viewer.here !== undefined && viewer.here !== null && m.channel === viewer.here;
}

/** The blue screen for a beat line. */
export function beatMoment(m: ChatMessage, phase: string | null): Moment {
  const from = m.from.trim();
  return {
    key: `m:${m.seq}`,
    seq: m.seq,
    severity: "minor",
    kind: "beat",
    caption: from !== "" && from !== "Narrator" ? from : m.title,
    text: from !== "" && from !== "Narrator" ? `${from}: ${m.text.trim()}` : m.text.trim(),
    channel: m.channel,
    beat: m.beat ?? null,
    at: m.ts,
    phase,
  };
}

/**
 * One blue screen per beat: a line opens a new screen when its beat has not
 * spoken to this viewer yet, or has been quiet for `BEAT_GAP_MS` (a beat
 * played again later). `last` maps a beat to its last line's story time and
 * is updated in place for every eligible line.
 */
export function beatOpensScreen(beat: string, ts: number, last: Map<string, number>): boolean {
  const prev = last.get(beat);
  last.set(beat, Math.max(prev ?? ts, ts));
  return prev === undefined || ts - prev > BEAT_GAP_MS;
}

/** The loud objectives that went live and were not announced yet (once per session). */
export function loudObjectives(objectives: readonly ObjectiveView[] | undefined, announced: ReadonlySet<string>, at: number, phase: string | null): Moment[] {
  const out: Moment[] = [];
  for (const o of objectives ?? []) {
    if (o.loud !== true || announced.has(o.id)) continue;
    const pass = o.buttons.includes("pass");
    out.push({
      key: `o:${o.id}`,
      seq: null,
      severity: "major",
      kind: "objective",
      caption: "New objective",
      text: o.brief.trim() !== "" ? `${o.title}\n${o.brief}` : o.title,
      channel: null,
      ...(pass ? { pass: true } : {}),
      at,
      phase,
    });
  }
  return out;
}

// --- the queue ----------------------------------------------------------------

/** A moment in the queue, on its rung. */
export interface Queued {
  moment: Moment;
  level: AlertLevel;
  /** Wall time it joined the queue (the hold's 30 s). */
  queuedAt: number;
}

/** The "You missed n moments" list (a wake that found more than `REPLAY_MAX`). */
export interface Summary {
  key: string;
  moments: Moment[];
}

export interface MomentsState {
  queue: Queued[];
  /** Missed, oldest first: arrived hidden, glanced at, or held too long. */
  missed: Moment[];
  /** A wake's compressed replay, shown as one dialog. */
  summary: Summary | null;
  /** The newest major moment's seq per room — a missed moment in the same room older than it is stale. */
  lastMajor: Record<string, number>;
  /** Modal moments dismissed since the modal queue was last empty ("2 of 3"). */
  burst: number;
}

export const EMPTY_MOMENTS: MomentsState = { queue: [], missed: [], summary: null, lastMajor: {}, burst: 0 };

export type MomentsAction =
  /** Moments that just arrived. `batch` = a history replay (several at once): staleness + compression apply. */
  | { type: "arrive"; moments: Moment[]; visible: boolean; level: AlertLevel; role: Viewer["role"]; now: number; phase: string | null; batch: boolean }
  /** The page became visible (or the last hold released): replay the missed list. */
  | { type: "wake"; level: AlertLevel; role: Viewer["role"]; now: number; phase: string | null }
  /** A moment left the screen. `onScreenMs` < `GLANCE_MS` → missed. */
  | { type: "dismiss"; key: string; onScreenMs: number }
  /** Close the summary list. */
  | { type: "closeSummary" }
  /** While a hold lasts: modal moments queued too long move to missed. */
  | { type: "tick"; now: number; held: boolean }
  /** The story restarted: nothing queued is news any more. */
  | { type: "reset" };

function isModal(level: AlertLevel): boolean {
  return level === "dialog" || level === "bsod";
}

function noteMajor(lastMajor: Record<string, number>, moments: readonly Moment[]): Record<string, number> {
  let out = lastMajor;
  for (const m of moments) {
    if (m.severity !== "major" || m.channel === null || m.seq === null) continue;
    if ((out[m.channel] ?? -1) >= m.seq) continue;
    if (out === lastMajor) out = { ...lastMajor };
    out[m.channel] = m.seq;
  }
  return out;
}

/**
 * Is a missed moment stale now: a newer major moment has its room, or the
 * night's phase moved on since it arrived (`null` phases never compare
 * unequal to each other, so a story without `Night.phase` never goes stale
 * that way).
 */
export function isStale(m: Moment, lastMajor: Readonly<Record<string, number>>, phase: string | null): boolean {
  if (m.channel !== null && m.seq !== null && (lastMajor[m.channel] ?? -1) > m.seq) return true;
  return (m.phase ?? null) !== (phase ?? null);
}

/** The missed moments still worth showing, oldest first. */
export function replayable(missed: readonly Moment[], lastMajor: Readonly<Record<string, number>>, phase: string | null): Moment[] {
  return missed.filter((m) => !isStale(m, lastMajor, phase));
}

function enqueue(queue: Queued[], moments: readonly Moment[], level: AlertLevel, role: Viewer["role"], now: number): Queued[] {
  const have = new Set(queue.map((q) => q.moment.key));
  const add = moments.filter((m) => !have.has(m.key)).map((moment) => ({ moment, level: rungFor(moment, level, role), queuedAt: now }));
  return add.length === 0 ? queue : [...queue, ...add];
}

/** Replay `list` (already filtered for staleness): one by one up to `REPLAY_MAX`, else one summary. */
function replay(s: MomentsState, list: Moment[], level: AlertLevel, role: Viewer["role"], now: number): MomentsState {
  if (list.length === 0) return s;
  if (list.length > REPLAY_MAX) {
    const key = `summary:${list.map((m) => m.key).join(",")}`;
    const merged = s.summary !== null ? [...s.summary.moments, ...list.filter((m) => !s.summary!.moments.some((x) => x.key === m.key))] : list;
    return { ...s, summary: { key, moments: merged } };
  }
  return { ...s, queue: enqueue(s.queue, list, level, role, now) };
}

export function momentsReducer(s: MomentsState, a: MomentsAction): MomentsState {
  switch (a.type) {
    case "arrive": {
      if (a.moments.length === 0) return s;
      const lastMajor = noteMajor(s.lastMajor, a.moments);
      const known = new Set([...s.queue.map((q) => q.moment.key), ...s.missed.map((m) => m.key)]);
      const fresh = a.moments.filter((m) => !known.has(m.key));
      if (fresh.length === 0) return { ...s, lastMajor };
      if (!a.visible) return { ...s, lastMajor, missed: [...s.missed, ...fresh] };
      const next = { ...s, lastMajor };
      if (!a.batch) return { ...next, queue: enqueue(s.queue, fresh, a.level, a.role, a.now) };
      return replay(next, replayable(fresh, lastMajor, a.phase), a.level, a.role, a.now);
    }
    case "wake": {
      if (s.missed.length === 0) return s;
      const list = replayable(s.missed, s.lastMajor, a.phase);
      return replay({ ...s, missed: [] }, list, a.level, a.role, a.now);
    }
    case "dismiss": {
      const hit = s.queue.find((q) => q.moment.key === a.key);
      if (hit === undefined) return s;
      const queue = s.queue.filter((q) => q !== hit);
      const missed = a.onScreenMs < GLANCE_MS ? [...s.missed, hit.moment] : s.missed;
      const modalLeft = queue.some((q) => isModal(q.level));
      const burst = isModal(hit.level) ? (modalLeft ? s.burst + 1 : 0) : s.burst;
      return { ...s, queue, missed, burst };
    }
    case "closeSummary":
      return s.summary === null ? s : { ...s, summary: null };
    case "tick": {
      if (!a.held) return s;
      const late = s.queue.filter((q) => isModal(q.level) && a.now - q.queuedAt > HOLD_MISS_MS);
      if (late.length === 0) return s;
      return { ...s, queue: s.queue.filter((q) => !late.includes(q)), missed: [...s.missed, ...late.map((q) => q.moment)] };
    }
    case "reset":
      return EMPTY_MOMENTS;
  }
}

/** What is on screen now, per surface. `held` keeps the modal surface (dialog / bsod / summary) off. */
export interface Surfaces {
  balloon: Queued | null;
  sticky: Queued | null;
  /** How many stickies are waiting, the one on screen included. */
  stickyCount: number;
  modal: Queued | null;
  /** "n of m" for the modal on screen. */
  modalIndex: number;
  modalTotal: number;
  summary: Summary | null;
}

export function surfacesOf(s: MomentsState, held: boolean): Surfaces {
  const balloon = s.queue.find((q) => q.level === "balloon") ?? null;
  const stickies = s.queue.filter((q) => q.level === "sticky");
  const modals = s.queue.filter((q) => isModal(q.level));
  const showModal = !held && s.summary === null;
  return {
    balloon,
    sticky: stickies[0] ?? null,
    stickyCount: stickies.length,
    modal: showModal ? (modals[0] ?? null) : null,
    modalIndex: s.burst + 1,
    modalTotal: s.burst + modals.length,
    summary: held ? null : s.summary,
  };
}

/** The tray's count: the missed list, plus modal moments a hold has kept back too long. */
export function missedCount(s: MomentsState, held: boolean, now: number): number {
  const late = held ? s.queue.filter((q) => isModal(q.level) && now - q.queuedAt > HOLD_MISS_MS).length : 0;
  return s.missed.length + late + (s.summary !== null && held ? s.summary.moments.length : 0);
}

// --- arrivals from the message map ---------------------------------------------

/** The seq the mark moves to: just under the oldest unsettled message moment, else the newest processed. */
export function settledMark(s: MomentsState, processedMax: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const q of s.queue) if (q.moment.seq !== null && q.moment.seq < min) min = q.moment.seq;
  for (const m of s.missed) if (m.seq !== null && m.seq < min) min = m.seq;
  for (const m of s.summary?.moments ?? []) if (m.seq !== null && m.seq < min) min = m.seq;
  return Number.isFinite(min) ? Math.min(processedMax, min - 1) : processedMax;
}

/**
 * The moments new messages make: every message above `mark` not processed
 * yet, oldest first, inside the story-clock window (a reload never replays
 * the night). `beats` tracks each beat's last line for the blue screen and
 * is updated in place; `bsod` says whether the blue screen is on for this
 * viewer. Returns the moments and every seq it looked at.
 */
export function arrivals(
  messages: Iterable<ChatMessage>,
  mark: number,
  processed: ReadonlySet<number>,
  viewer: Viewer,
  ctx: { now: number; phase: string | null; bsod: boolean; beats: Map<string, number> },
): { moments: Moment[]; seen: number[] } {
  const list = [...messages].filter((m) => m.seq > mark && !processed.has(m.seq)).sort((a, b) => a.seq - b.seq);
  const moments: Moment[] = [];
  const seen: number[] = [];
  for (const m of list) {
    seen.push(m.seq);
    const old = m.ts < ctx.now - MOMENT_WINDOW_MS;
    const own = momentOf(m, viewer, ctx.phase);
    if (own !== null) {
      if (!old) moments.push(own);
      if (own.beat) ctx.beats.set(own.beat, Math.max(ctx.beats.get(own.beat) ?? m.ts, m.ts));
      continue;
    }
    if (!beatLineReaches(m, viewer)) continue;
    const opens = beatOpensScreen(m.beat!, m.ts, ctx.beats);
    if (ctx.bsod && opens && !old) moments.push(beatMoment(m, ctx.phase));
  }
  return { moments, seen };
}

/** The story clock now: the later of the view's clock and the newest message. */
export function storyNow(messages: Iterable<ChatMessage>, clock: number | null | undefined): number {
  let max = clock ?? Number.NEGATIVE_INFINITY;
  for (const m of messages) if (m.ts > max) max = m.ts;
  return Number.isFinite(max) ? max : 0;
}

/** Should a toast stand back for a moment saying the same thing (or vice versa)? Same text, folded. */
export function sameWords(a: string, b: string): boolean {
  const fold = (s: string) => s.replace(/\s+/gu, " ").trim().toLowerCase();
  const x = fold(a);
  const y = fold(b);
  return x !== "" && y !== "" && (x === y || x.includes(y) || y.includes(x));
}

/** A deterministic fake exception address for the blue screen ("0028:C0011E36"), from the moment's key. */
export function faultAddress(key: string): string {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hex = h.toString(16).toUpperCase().padStart(8, "0");
  return `0028:C0${hex.slice(0, 6)}`;
}

/** Does a level change glitch the screen: only a real change after the first view (a reload or a first snapshot never does). */
export function shouldGlitch(before: AlertLevel | undefined, now: AlertLevel | undefined): boolean {
  return before !== undefined && now !== undefined && before !== now;
}
