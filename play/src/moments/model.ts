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

import { lowerRung, noticeKey } from "../../../core/src/delivery.ts";
import { retractedPinSeqs } from "../pins.ts";
import { guestLineToBooth } from "../stream/badges.ts";
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
  /**
   * A booth's *peek*: the balloon that shows a major moment while a busy
   * surface (the scanner, a guest card) holds the screen, its twin (this
   * key) waiting as a sticky for the hold to end. Never missed, never
   * replayed, never shown once the hold is over (`peekFor`).
   */
  peekOf?: string;
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
  /** The room the guest stands in (`loc:<Place>`), for the blue screen's
   *  "reaches you"; a booth's open room (a guest's typed line in the thread
   *  it is reading raises no balloon). */
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
/**
 * A modal (dialog / blue screen) closed after this long was read: its dead
 * time (`surfaces.tsx` `MODAL_DEAD_MS`, 400 ms from its first render)
 * already refuses an earlier tap, so a tap it lets through is deliberate —
 * this is that 400 ms less the few ms between the modal's first render and
 * the provider's on-screen stamp. The second modal of a queue the guest is
 * already tapping through is never missed at all.
 */
export const MODAL_GLANCE_MS = 350;
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
export function rungFor(moment: Pick<Moment, "severity" | "kind" | "peekOf">, level: AlertLevel, role: Viewer["role"]): AlertLevel {
  if (moment.peekOf !== undefined) return "balloon";
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
  // The lobby is the house's announcement room (its own title is the story's).
  if (m.channel === "lobby") return "Announcement";
  return m.title.trim() !== "" ? m.title.trim() : "Message";
}

/**
 * The moment a message makes for this viewer, or null. The server stamps
 * `moment`; an older server's `!` alert counts as major; a takeover has its
 * own layer (never a moment); a hidden message never is one. A booth runs
 * its filter first and then demotes guest-facing alerts.
 */
/**
 * The phase a message was posted in: the server's stamp when it carries one
 * (`ChatMessage.phase`, core's `chat.ts` `storyPhase` at compose time), else
 * `fallback` (the phase the client knows now). The stamp is what lets a
 * locked iPhone's backlog, replayed as `history` after wake, drop alarms
 * from before a phase change; an older server's messages, or a story with
 * no `Night.phase` yet, carry none.
 */
export function phaseOf(m: ChatMessage, fallback: string | null): string | null {
  const stamped: unknown = m.phase;
  return typeof stamped === "string" || stamped === null ? stamped : fallback;
}

export function momentOf(m: ChatMessage, viewer: Viewer, phase: string | null): Moment | null {
  if (m.hidden || m.takeover === true) return null;
  // A guest's typed line to this booth's character ("help, I'm stuck"): a
  // minor moment (a balloon), its exit the guest's thread in the booth.
  if (viewer.role === "booth" && m.moment === undefined && m.alert !== true && guestLineToBooth(m, viewer.me)) {
    const guest = Array.isArray(m.audience) ? m.audience.find((a) => !a.startsWith("@")) : undefined;
    const channel = guest !== undefined ? `guest:${guest}` : null;
    // The performer is reading that thread already: the line is on screen.
    if (channel !== null && viewer.here === channel) return null;
    return {
      key: `m:${m.seq}`,
      seq: m.seq,
      severity: "minor",
      kind: "other",
      caption: m.from.trim(),
      text: m.text.trim(),
      channel,
      beat: null,
      at: m.ts,
      phase: phaseOf(m, phase),
    };
  }
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
    phase: phaseOf(m, phase),
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
    phase: phaseOf(m, phase),
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

/**
 * Where a moment's "Take me there" goes (pure): the pass when it is about
 * the pass and the app can open it, its room when it has one and the app
 * can open rooms, else nowhere (no button). A guest on rails in a cutscene
 * opens no room, so a house announcement there offers no exit that would
 * only change the room hidden behind the stage.
 */
export function momentExit(m: Pick<Moment, "pass" | "channel">, can: { room: boolean; pass: boolean }): "pass" | "room" | null {
  if (m.pass === true) return can.pass ? "pass" : null;
  return m.channel !== null && can.room ? "room" : null;
}

/** A live card waiting on the viewer, for "Take me there" (its glyph and room). */
export interface LiveCard {
  glyph: string;
  channel: string;
  seq: number;
}

/**
 * The room a moment's "Take me there" opens (pure), or null for none:
 * - a moment about a live card ("📝 Last chance: file your facts…" —
 *   its leading glyph is the card's) goes to the room the newest such card
 *   waits in, not the lobby the announcement was posted to;
 * - else the moment's own room;
 * - never the room already open on screen (there is nowhere to take you).
 */
export function exitRoomFor(m: Pick<Moment, "channel" | "text" | "kind">, ctx: { open: string | null; cards: readonly LiveCard[] }): string | null {
  const glyph = m.kind === "card" ? "•" : noticeKey(m.text);
  let card: LiveCard | undefined;
  if (glyph !== "•") for (const c of ctx.cards) if (c.glyph === glyph && (card === undefined || c.seq > card.seq)) card = c;
  const room = card?.channel ?? m.channel;
  return room !== null && room === ctx.open ? null : room;
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
  /** `dialog`: the list itself, modal. `sticky`: one bar that opens the list
   *  on a tap — a booth (never a modal it did not ask for) and a guest below
   *  `dialog` (the level says the room is calm). */
  level: "dialog" | "sticky";
}

/** How a summary shows at a level: the list (modal) only where the viewer's level is modal, else a sticky bar. */
export function summaryRung(level: AlertLevel, role: Viewer["role"]): Summary["level"] {
  return isModal(viewerLevel(level, role)) ? "dialog" : "sticky";
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
  /** A moment left the screen. A plain close after `onScreenMs` < `GLANCE_MS` → missed; `acted` (the user took its exit, "Take me there") never is. */
  | { type: "dismiss"; key: string; onScreenMs: number; acted?: boolean }
  /** Close the summary list. */
  | { type: "closeSummary" }
  /** "Dismiss all (n)" on the sticky bar: these leave the queue, read. */
  | { type: "dismissMany"; keys: readonly string[] }
  /** While a hold lasts: modal moments queued too long move to missed. */
  | { type: "tick"; now: number; held: boolean }
  /**
   * The story changed the level live: everything still queued moves to its
   * new rung (a blue screen only exists at `bsod`). On a rise, of the
   * moments that climb onto a modal rung only the newest still-relevant one
   * shows; the rest fold into the missed list ("You missed n moments"), and
   * any whose phase has passed (`phase`, when given) are dropped.
   */
  | { type: "relevel"; level: AlertLevel; role: Viewer["role"]; phase?: string | null }
  /** `!` pins taken down since (`retractedPinSeqs`): drop them wherever they wait. */
  | { type: "retract"; seqs: ReadonlySet<number> }
  /** The objectives live now: a loud objective's moment (`o:<id>`) whose objective has ended leaves wherever it waits (a cleared guest is never told to show their pass). */
  | { type: "objectives"; live: ReadonlySet<string> }
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

/** Rooms every announcement shares (the lobby is the one broadcast home, D11):
 *  a newer alert there is another announcement, not a correction of this
 *  one, so only the phase rule can make one stale. */
export const SHARED_HOMES: ReadonlySet<string> = new Set(["lobby"]);

/**
 * Is a missed moment stale now: a newer major moment has its room (never
 * the lobby, `SHARED_HOMES`), or the
 * night's phase moved on since it arrived (`null` phases never compare
 * unequal to each other, so a story without `Night.phase` never goes stale
 * that way).
 */
export function isStale(m: Moment, lastMajor: Readonly<Record<string, number>>, phase: string | null): boolean {
  if (m.channel !== null && !SHARED_HOMES.has(m.channel) && m.seq !== null && (lastMajor[m.channel] ?? -1) > m.seq) return true;
  return (m.phase ?? null) !== (phase ?? null);
}

/** The missed moments still worth showing, oldest first. */
export function replayable(missed: readonly Moment[], lastMajor: Readonly<Record<string, number>>, phase: string | null): Moment[] {
  return missed.filter((m) => !isStale(m, lastMajor, phase));
}

/** A moment that repeats one already waiting: the same words at the same story moment (one broadcast posted to two rooms). */
export const ECHO_WINDOW_MS = 2_000;

export function isEcho(m: Moment, others: readonly Moment[]): boolean {
  return others.some((o) => o.key !== m.key && o.key !== m.peekOf && m.key !== o.peekOf && o.text === m.text && o.severity === m.severity && Math.abs(o.at - m.at) <= ECHO_WINDOW_MS);
}

/** The balloon that peeks over a busy surface for a major booth moment held behind it (its twin waits as a sticky). */
export function peekFor(m: Moment): Moment {
  return { ...m, key: `p:${m.key}`, peekOf: m.key };
}

function isPeek(m: Moment): boolean {
  return m.peekOf !== undefined;
}

/** Drop the echoes inside a list (the first copy stays). */
export function withoutEchoes(moments: readonly Moment[], already: readonly Moment[] = []): Moment[] {
  const out: Moment[] = [];
  for (const m of moments) if (!isEcho(m, [...already, ...out])) out.push(m);
  return out;
}

/**
 * How urgently a moment wants the screen, highest first: a `!` alert (an
 * alarm never waits behind a stale notice), then anything else major (a
 * card that asks you, a `reply !…`), then a loud objective (the NOW bar
 * says it too), then the minor rest.
 */
export function priorityOf(m: Pick<Moment, "kind" | "severity">): number {
  if (m.severity === "major" && m.kind === "alert") return 3;
  if (m.kind === "objective") return 1;
  return m.severity === "major" ? 2 : 0;
}

/** The queue in the order its surfaces take it: priority first, arrival within one (a stable sort). */
function ordered(queue: readonly Queued[]): Queued[] {
  return queue
    .map((q, i) => ({ q, i, p: priorityOf(q.moment) }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .map((x) => x.q);
}

function enqueue(queue: Queued[], moments: readonly Moment[], level: AlertLevel, role: Viewer["role"], now: number): Queued[] {
  const have = new Set(queue.map((q) => q.moment.key));
  const add = withoutEchoes(moments.filter((m) => !have.has(m.key)), queue.map((q) => q.moment)).map((moment) => ({ moment, level: rungFor(moment, level, role), queuedAt: now }));
  // A peek is only for a twin that waits as a sticky: one that is a balloon
  // itself already shows over the busy surface.
  const twins = new Map([...queue, ...add].map((q) => [q.moment.key, q.level]));
  const kept = add.filter((q) => q.moment.peekOf === undefined || twins.get(q.moment.peekOf) === "sticky");
  return kept.length === 0 ? queue : ordered([...queue, ...kept]);
}

/**
 * Stickies never pile up (design review #6): a new sticky folds every older
 * one that is no more urgent into the missed list (the tray's 🔔 count,
 * replayed on wake or a tap). A loud objective's sticky is the NOW bar's
 * business and is never folded; an older, more urgent sticky (an alarm)
 * stays up and the new one waits behind it. A folded sticky takes its peek
 * with it; a peek itself is never missed.
 */
function foldStickies(queue: Queued[], fresh: ReadonlySet<string>): { queue: Queued[]; folded: Moment[] } {
  const news = queue.filter((q) => q.level === "sticky" && fresh.has(q.moment.key) && q.moment.kind !== "objective");
  if (news.length === 0) return { queue, folded: [] };
  const top = Math.max(...news.map((q) => priorityOf(q.moment)));
  const fold = queue.filter((q) => q.level === "sticky" && !fresh.has(q.moment.key) && q.moment.kind !== "objective" && priorityOf(q.moment) <= top);
  if (fold.length === 0) return { queue, folded: [] };
  const gone = new Set(fold.map((q) => q.moment.key));
  return { queue: queue.filter((q) => !fold.includes(q) && !(q.moment.peekOf !== undefined && gone.has(q.moment.peekOf))), folded: fold.map((q) => q.moment) };
}

/** Replay `list` (already filtered for staleness): one by one up to `REPLAY_MAX`, else one summary. */
function replay(s: MomentsState, all: Moment[], level: AlertLevel, role: Viewer["role"], now: number): MomentsState {
  const list = withoutEchoes(all);
  if (list.length === 0) return s;
  if (list.length > REPLAY_MAX) {
    const key = `summary:${list.map((m) => m.key).join(",")}`;
    const merged = s.summary !== null ? [...s.summary.moments, ...list.filter((m) => !s.summary!.moments.some((x) => x.key === m.key))] : list;
    return { ...s, summary: { key: s.summary?.key ?? key, moments: merged, level: summaryRung(level, role) } };
  }
  return { ...s, queue: enqueue(s.queue, list, level, role, now) };
}

/** The newest of some queued moments: story time, then seq (a loud objective has none). */
function newestOf(list: readonly Queued[]): Queued | null {
  let best: Queued | null = null;
  for (const q of list) {
    if (best === null || q.moment.at > best.moment.at || (q.moment.at === best.moment.at && (q.moment.seq ?? -1) > (best.moment.seq ?? -1))) best = q;
  }
  return best;
}

export function momentsReducer(s: MomentsState, a: MomentsAction): MomentsState {
  switch (a.type) {
    case "arrive": {
      if (a.moments.length === 0) return s;
      const lastMajor = noteMajor(s.lastMajor, a.moments);
      const known = new Set([...s.queue.map((q) => q.moment.key), ...s.missed.map((m) => m.key)]);
      const fresh = a.moments.filter((m) => !known.has(m.key));
      if (fresh.length === 0) return { ...s, lastMajor };
      if (!a.visible) return { ...s, lastMajor, missed: [...s.missed, ...withoutEchoes(fresh.filter((m) => !isPeek(m)), s.missed)] };
      const next = { ...s, lastMajor };
      if (!a.batch) {
        const { queue, folded } = foldStickies(enqueue(s.queue, fresh, a.level, a.role, a.now), new Set(fresh.map((m) => m.key)));
        return { ...next, queue, missed: folded.length === 0 ? s.missed : [...s.missed, ...folded] };
      }
      return replay(next, replayable(fresh.filter((m) => !isPeek(m)), lastMajor, a.phase), a.level, a.role, a.now);
    }
    case "wake": {
      if (s.missed.length === 0) return s;
      const list = replayable(s.missed, s.lastMajor, a.phase);
      return replay({ ...s, missed: [] }, list, a.level, a.role, a.now);
    }
    case "dismiss": {
      const hit = s.queue.find((q) => q.moment.key === a.key);
      if (hit === undefined) return s;
      // A sticky takes its peek with it; a peek acted on ("Take me there")
      // takes its sticky too — the performer went, it is not news after.
      const twin = a.acted === true ? hit.moment.peekOf : undefined;
      const queue = s.queue.filter((q) => q !== hit && q.moment.peekOf !== hit.moment.key && (twin === undefined || q.moment.key !== twin));
      const glance = isModal(hit.level) ? (s.burst > 0 ? 0 : MODAL_GLANCE_MS) : GLANCE_MS;
      const missed = a.acted !== true && a.onScreenMs < glance && !isPeek(hit.moment) ? [...s.missed, hit.moment] : s.missed;
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
    case "relevel": {
      let changed = false;
      const queue: Queued[] = [];
      // Moments that climb onto a modal rung (a sticky that becomes a dialog).
      const risen: Queued[] = [];
      for (const q of s.queue) {
        // A beat's blue screen has no lower rung: below `bsod` its line just stays in the stream.
        if (q.moment.kind === "beat" && viewerLevel(a.level, a.role) !== "bsod") {
          changed = true;
          continue;
        }
        const level = rungFor(q.moment, a.level, a.role);
        if (level === q.level) queue.push(q);
        else {
          changed = true;
          const moved = { ...q, level };
          if (isModal(level) && rungIndex(level) > rungIndex(q.level) && !isPeek(q.moment)) risen.push(moved);
          else queue.push(moved);
        }
      }
      let missed = s.missed;
      if (risen.length > 0) {
        // An hour of unread stickies never becomes a queue of modals, oldest
        // first: what is no longer news goes, the newest still-relevant one
        // shows on the new rung, the rest wait in the missed list.
        const live = a.phase === undefined ? risen : risen.filter((q) => !isStale(q.moment, s.lastMajor, a.phase ?? null));
        const newest = newestOf(live);
        if (newest !== null) queue.push(newest);
        const rest = live.filter((q) => q !== newest).map((q) => q.moment);
        if (rest.length > 0) missed = [...s.missed, ...rest];
      }
      const rung = summaryRung(a.level, a.role);
      const summary = s.summary !== null && s.summary.level !== rung ? { ...s.summary, level: rung } : s.summary;
      if (!changed && summary === s.summary) return s;
      return { ...s, queue: ordered(queue), missed, summary, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "dismissMany": {
      // "Dismiss all (n)": read, every one — none of them is missed.
      const keys = new Set(a.keys);
      if (!s.queue.some((q) => keys.has(q.moment.key))) return s;
      // A booth's peek goes with its sticky twin.
      const queue = s.queue.filter((q) => !keys.has(q.moment.key) && !(q.moment.peekOf !== undefined && keys.has(q.moment.peekOf)));
      return { ...s, queue, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "retract": {
      const gone = (m: Moment) => m.seq !== null && a.seqs.has(m.seq);
      const queue = s.queue.some((q) => gone(q.moment)) ? s.queue.filter((q) => !gone(q.moment)) : s.queue;
      const missed = s.missed.some(gone) ? s.missed.filter((m) => !gone(m)) : s.missed;
      let summary = s.summary;
      if (summary !== null && summary.moments.some(gone)) {
        const left = summary.moments.filter((m) => !gone(m));
        summary = left.length === 0 ? null : { ...summary, moments: left };
      }
      if (queue === s.queue && missed === s.missed && summary === s.summary) return s;
      return { ...s, queue, missed, summary, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "objectives": {
      const gone = (m: Moment) => m.kind === "objective" && m.key.startsWith("o:") && !a.live.has(m.key.slice(2));
      const queue = s.queue.some((q) => gone(q.moment)) ? s.queue.filter((q) => !gone(q.moment)) : s.queue;
      const missed = s.missed.some(gone) ? s.missed.filter((m) => !gone(m)) : s.missed;
      let summary = s.summary;
      if (summary !== null && summary.moments.some(gone)) {
        const left = summary.moments.filter((m) => !gone(m));
        summary = left.length === 0 ? null : { ...summary, moments: left };
      }
      if (queue === s.queue && missed === s.missed && summary === s.summary) return s;
      return { ...s, queue, missed, summary, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "reset":
      return EMPTY_MOMENTS;
  }
}

/** What is on screen now, per surface. `held` keeps the modal surfaces (dialog / bsod / the summary list) off; a sticky summary still shows. */
export interface Surfaces {
  /** A loud objective flashing the NOW title bar (a guest's frame only). */
  now: Queued | null;
  balloon: Queued | null;
  sticky: Queued | null;
  /** How many stickies are waiting, the one on screen included. */
  stickyCount: number;
  /** Their keys ("Dismiss all (n)"). */
  stickyKeys: string[];
  modal: Queued | null;
  /** Every modal waiting, the one on screen first ("Dismiss all (n)"). */
  modalKeys: string[];
  /** "n of m" for the modal on screen. */
  modalIndex: number;
  modalTotal: number;
  summary: Summary | null;
}

/** Is this queued moment the NOW bar's (a guest's loud objective below the modal rungs)? */
export function onNowBar(q: Queued, nowBar: boolean): boolean {
  return nowBar && q.moment.kind === "objective" && (q.level === "balloon" || q.level === "sticky");
}

/**
 * What each surface shows. `nowBar` (a guest's frame): a loud objective
 * below the modal rungs flashes the NOW title bar (`now`) instead of
 * stacking a second copy of it as a sticky or a balloon.
 */
export function surfacesOf(s: MomentsState, held: boolean, nowBar = false): Surfaces {
  const now = s.queue.find((q) => onNowBar(q, nowBar)) ?? null;
  const rest = nowBar ? s.queue.filter((q) => !onNowBar(q, nowBar)) : s.queue;
  // A peek shows only while the hold lasts (its twin's sticky takes over after).
  const balloon = rest.find((q) => q.level === "balloon" && (held || !isPeek(q.moment))) ?? null;
  const stickies = rest.filter((q) => q.level === "sticky");
  const modals = s.queue.filter((q) => isModal(q.level));
  const modalSummary = s.summary !== null && s.summary.level === "dialog";
  const modalOn = !held && !modalSummary;
  return {
    now,
    balloon,
    sticky: stickies[0] ?? null,
    stickyCount: stickies.length,
    stickyKeys: stickies.map((q) => q.moment.key),
    modal: modalOn ? (modals[0] ?? null) : null,
    modalKeys: modalOn ? modals.map((q) => q.moment.key) : [],
    modalIndex: s.burst + 1,
    modalTotal: s.burst + modals.length,
    summary: held && modalSummary ? null : s.summary,
  };
}

/** The dialog and the blue screen offer "Dismiss all (n)" with more than this many waiting. */
export const DISMISS_ALL_MODALS_OVER = 2;

/** The tray's count: the missed list, plus modal moments a hold has kept back too long. */
export function missedCount(s: MomentsState, held: boolean, now: number): number {
  const late = held ? s.queue.filter((q) => isModal(q.level) && now - q.queuedAt > HOLD_MISS_MS).length : 0;
  return s.missed.length + late + (s.summary !== null && s.summary.level === "dialog" && held ? s.summary.moments.length : 0);
}

// --- arrivals from the message map ---------------------------------------------

/** The seq the mark moves to: just under the oldest unsettled message moment
 *  (`waiting` adds moments not in the state yet — dispatched, or a readout
 *  waiting for its toast), else the newest processed. */
export function settledMark(s: MomentsState, processedMax: number, waiting: Iterable<number> = []): number {
  let min = Number.POSITIVE_INFINITY;
  for (const seq of waiting) if (seq < min) min = seq;
  for (const q of s.queue) if (q.moment.seq !== null && q.moment.seq < min) min = q.moment.seq;
  for (const m of s.missed) if (m.seq !== null && m.seq < min) min = m.seq;
  for (const m of s.summary?.moments ?? []) if (m.seq !== null && m.seq < min) min = m.seq;
  return Number.isFinite(min) ? Math.min(processedMax, min - 1) : processedMax;
}

/** How many settled seqs above the mark a reload remembers (the newest). */
export const DONE_MAX = 2_000;

/**
 * The seqs above the settled `mark` that are done — looked at, and not
 * waiting in the queue, the missed list or the summary (read, dismissed,
 * not a moment at all). The mark sits under the oldest moment still
 * waiting, so without these a reload would replay every moment after it
 * that was already read. Persisted per sign-in; ascending, the newest
 * `DONE_MAX`.
 */
export function doneAbove(s: MomentsState, processed: Iterable<number>, mark: number, also: Iterable<number> = []): number[] {
  const waiting = new Set<number>(also);
  for (const q of s.queue) if (q.moment.seq !== null) waiting.add(q.moment.seq);
  for (const m of s.missed) if (m.seq !== null) waiting.add(m.seq);
  for (const m of s.summary?.moments ?? []) if (m.seq !== null) waiting.add(m.seq);
  const out: number[] = [];
  for (const seq of processed) if (seq > mark && !waiting.has(seq)) out.push(seq);
  out.sort((a, b) => a - b);
  return out.length > DONE_MAX ? out.slice(-DONE_MAX) : out;
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
  const all = [...messages];
  // A `!` pin already taken down (the 🩹 after a mis-tapped mark) is not news.
  const gone = retractedPinSeqs(all);
  // Client-made rows (a choice echo: a half seq, a wall-clock ts) are never moments.
  const list = all.filter((m) => Number.isInteger(m.seq) && m.seq > mark && !processed.has(m.seq)).sort((a, b) => a.seq - b.seq);
  const moments: Moment[] = [];
  const seen: number[] = [];
  for (const m of list) {
    seen.push(m.seq);
    const old = m.ts < ctx.now - MOMENT_WINDOW_MS;
    const own = momentOf(m, viewer, ctx.phase);
    if (own !== null) {
      if (!old && !gone.has(m.seq)) moments.push(own);
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
  // Only the server's rows: a client echo carries wall-clock time (half seqs).
  for (const m of messages) if (Number.isInteger(m.seq) && m.ts > max) max = m.ts;
  return Number.isFinite(max) ? max : 0;
}

// --- readouts: news, or the answer to your own press ------------------------------

/** A toast the session raised (mirror of `alerts.ts` `RecentToast`). */
export interface ToastSeen {
  text: string;
  /** Wall time. */
  at: number;
  /** Quiet = the answer to the viewer's own press. Loud = a booth's unsolicited readout (`session/prime.ts`). */
  quiet: boolean;
}

/** A readout this soon after a toast that said the same is that toast's readout. */
export const ECHO_MS = 5_000;
/** How long a guest's minor readout waits for the quiet toast that may answer for it. */
export const READOUT_WAIT_MS = 1_200;
/** A booth readout about a guest this soon after the card / scanner closed was shown on the card. */
export const CARD_AFTERGLOW_MS = 4_000;

function toldBy(recent: readonly ToastSeen[], text: string, quiet: boolean, now: number, within: number): boolean {
  return recent.some((t) => t.quiet === quiet && now - t.at < within && sameWords(t.text, text));
}

/**
 * Which new moments show now, which wait (`later`, then `afterWait`), and
 * which are dropped. A readout is the dropped kind when it only repeats the
 * viewer's own press:
 * - a booth's readout about a guest while a busy surface (the card, the
 *   scanner) is open or just closed — the card showed it;
 * - a booth's minor readout the session did not mark as news. Every booth
 *   readout also arrives as a `response` frame *before* its message, and
 *   the session raises a loud toast for exactly the unsolicited ones (none
 *   in flight, none in the last 4 s: `unsolicitedReadout`), so a minor
 *   readout with no such raise is the answer to the booth's own scan / act;
 * - a guest's minor readout waits `READOUT_WAIT_MS` for the quiet toast of
 *   its own press (`afterWait`).
 * Major readouts (`reply !…`) always show.
 */
export function sortArrivals(
  moments: readonly Moment[],
  ctx: {
    role: Viewer["role"];
    held: boolean;
    sinceHoldEnd: number;
    about: (seq: number | null) => boolean;
    recent: readonly ToastSeen[];
    now: number;
    /** The guest a readout is about (`ChatMessage.about`). */
    aboutId?: (seq: number | null) => string | null;
    /** The guest whose card is open (or was, inside the afterglow). Absent
     *  (an older caller): every readout about a guest inside the hold is
     *  taken as shown on the card. */
    cardGuest?: string | null;
  },
): { now: Moment[]; later: Moment[] } {
  const out = { now: [] as Moment[], later: [] as Moment[] };
  const busy = ctx.held || ctx.sinceHoldEnd < CARD_AFTERGLOW_MS;
  // A booth's major moment held behind the busy surface: its sticky waits
  // for the hold to end, a balloon peeks over the card meanwhile.
  const push = (m: Moment) => {
    out.now.push(m);
    if (ctx.role === "booth" && ctx.held && m.severity === "major") out.now.push(peekFor(m));
  };
  for (const m of moments) {
    if (m.kind !== "readout") push(m);
    else if (ctx.role === "booth" && ctx.about(m.seq) && busy && shownOnCard(m, ctx)) continue;
    else if (m.severity === "major") push(m);
    else if (ctx.role === "booth") {
      if (toldBy(ctx.recent, m.text, false, ctx.now, ECHO_MS)) push(m);
    } else out.later.push(m);
  }
  return out;
}

/**
 * Did the card already show this booth readout about a guest? When it is
 * about the guest on the open card (a press or a scan answers about the
 * guest it was made on). When either side is unknown (no card yet, a
 * readout with no `about` id), when it answers the booth's own press: the
 * session raised no loud toast for it (a request was in flight or had just
 * answered). A readout about anyone else — the late list, Clippy's 🚨
 * marked — is news, card or no card, however recently the booth pressed.
 */
function shownOnCard(m: Moment, ctx: { recent: readonly ToastSeen[]; now: number; aboutId?: (seq: number | null) => string | null; cardGuest?: string | null }): boolean {
  if (ctx.cardGuest === undefined) return true;
  const about = ctx.aboutId?.(m.seq) ?? null;
  if (about !== null && ctx.cardGuest !== null) return about === ctx.cardGuest;
  return !toldBy(ctx.recent, m.text, false, ctx.now, ECHO_MS);
}

/** The waiting readouts still news once the wait is over: those no quiet toast already said. */
export function afterWait(readouts: readonly Moment[], recent: readonly ToastSeen[], now: number): Moment[] {
  return readouts.filter((m) => !toldBy(recent, m.text, true, now, ECHO_MS + READOUT_WAIT_MS));
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
