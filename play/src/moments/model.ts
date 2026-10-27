//! The moments model (wave 13, the moments lane): the pure part of the
//! interrupt layer. A *moment* is something the story wants a phone to
//! notice — a `!` alert, a readout for you, a quest that starts, a card that
//! asks you, a loud objective going live, and at `bsod` the first line of
//! every beat that reaches you. Each one renders on a rung of the Win95
//! ladder (balloon → sticky → dialog → bsod): a major moment at the story's
//! level, a minor one a rung lower (never below a balloon), a booth never
//! above `sticky`.
//!
//! Wave 18 adds the **big** rung (`moment: "big"`, CONTRACTS C1): full
//! screen whatever the level, acknowledged once, replayed until it is; and
//! the hygiene of GUEST-SPEC §7 — priority tiers, one house banner, a phase
//! change retiring old house moments to Notifications, at most three blue
//! screens, no Dismiss all, and a wake that brings back only the unacked
//! bigs and the newest live house banner (everything else is an unread
//! Notifications row). A booth's big moment is a pop-out (`popout.tsx`).
//!
//! Everything here is a pure function or a reducer over plain data, so the
//! queue, the hold, the missed list and the wake replay are unit-tested
//! (`test/moments-model.test.ts`) without React. `provider.tsx` drives it.

import { lowerRung, noticeKey } from "../../../core/src/delivery.ts";
import { retractedPinSeqs } from "../pins.ts";
import { guestLineToBooth } from "../stream/badges.ts";
import type { AlertLevel, ChatMessage, MomentClass, ObjectiveView } from "../types.ts";
import type { GoTarget } from "./exits.ts";

export { namedDm, type DmRoom, type LiveCard } from "./exits.ts";

/** A moment's class: major, minor, or wave 18's `big` (C1). */
export type MomentSeverity = MomentClass;
/** A rung: the story's ladder, plus the big moment that ignores it. */
export type Rung = AlertLevel | "big";

/** A message as the moments layer reads it: core's `ChatMessage`, which
 *  carries the wave 18 fields (C1–C3: `moment: "big"`, `go`, `autoClose`,
 *  `aboutName`, `aboutAvatar`; an older server's message simply has none). */
export type MomentMessage = ChatMessage;

/** Read a message with the wave 18 fields (kept for callers; now the identity). */
export function momentMessage(m: ChatMessage): MomentMessage {
  return m;
}

// --- the moments themselves --------------------------------------------------

/** What made the moment (drives its icon, its caption and its exits). */
export type MomentKind = "alert" | "readout" | "card" | "quest" | "objective" | "beat" | "other";

/** One moment waiting to be shown. */
export interface Moment {
  /** The message it came from (`m:<seq>`), or a client-made key (`o:<objective>`). */
  key: string;
  seq: number | null;
  severity: MomentSeverity;
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
  /** A `!` alarm (`ChatMessage.alert`), whatever made it — a cue, a pin, a `reply !…`: the red stop icon. */
  alarm?: boolean;
  /**
   * Parked by a level rise (the rest of a backlog that climbed): it waits in
   * the missed list for the tray's 🔔, and nothing else brings it back — not
   * a wake, a hold ending or a reload (it counts as settled), so a phone that
   * locks or reloads never steps through the backlog the rise just spared.
   */
  parked?: boolean;
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
  /** Sent to everyone (`audience: "all"`): a house moment, not yours alone. */
  house?: boolean;
  /** The story's buttons (`ChatMessage.go`, C2). */
  go?: GoTarget[];
  /** A big house cheer's self-close (ms). */
  autoClose?: number;
  /** `with ack: none` on a big (wave 26, R1): no acknowledge button when one
   *  of its own exits resolves (`big-model.ts` `bigAck`). */
  noAck?: true;
  /** The card a card moment is (its seq, kind and leading glyph). */
  card?: { seq: number; kind: string; glyph: string };
  /** A codex moment's entry id (its exit opens that entry). */
  entry?: string;
  /** A quest moment's quest id (its exit opens that quest). */
  quest?: string;
  /** A big one a newer big of yours replaced in a backlog (BN-F10): never
   *  shown, and the provider acknowledges it so a reload never brings it
   *  back. */
  superseded?: true;
}

/** How a moment renders at a level (`lowerRung` for a minor one). */
export interface MomentRender {
  moment: Moment;
  level: Rung;
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
  /** A guest's display name: a house cheer that names them is not for them. */
  name?: string;
  /** Wave 18b (D18): a guest whose story hides the lobby (`lobby: hidden`):
   *  a lobby line that is no moment is still a Notifications row. */
  lobbyHidden?: boolean;
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
/** Moments older than this (story clock) are old news after a reload. */
export const MOMENT_WINDOW_MS = 10 * 60_000;
/** An unacknowledged big moment replays on a reload or a wake this long (story clock). */
export const BIG_WINDOW_MS = 15 * 60_000;
/** A busy surface (the pass, the scan sheet) holds a big moment back at most this long. */
export const BIG_HOLD_MS = 8_000;
/** At most this many blue screens wait; older ones go to Notifications. */
export const BSOD_MAX = 3;
/** A quest's balloon this close (story clock) to a sticky or a dialog is the same cue said twice: dropped. */
export const QUEST_DEDUPE_MS = 2_000;
/** A beat that goes quiet this long (story clock) and speaks again earns a new blue screen. */
export const BEAT_GAP_MS = 2 * 60_000;
/** The level-change glitch. */
export const GLITCH_MS = 600;
/** Wave 26 (T2): how fresh (story ms) a glitch must be to take the phone over. */
export const TAKEOVER_FRESH_MS = 15_000;
/** Wave 26 (T2): the takeover's length — a guest's or a player's, a host's look-only one. */
export const TAKEOVER_MS = 6_000;
export const TAKEOVER_LIGHT_MS = 2_500;

/**
 * Wave 26 (T2, CONTRACTS C3): does the story's glitch take this phone over
 * now? Only live: never embedded (Run → Players), never on a first view (a
 * reload, a new sign-in), only for an `at` this provider hasn't seen, and
 * only within `TAKEOVER_FRESH_MS` of it on the story clock.
 */
export function takeoverDue(prevAt: number | null, glitch: { at: number } | null | undefined, clock: number | undefined, firstView: boolean, embedded: boolean): boolean {
  if (embedded || firstView || glitch == null || clock === undefined) return false;
  const age = clock - glitch.at;
  return glitch.at > 0 && glitch.at !== prevAt && age >= 0 && age <= TAKEOVER_FRESH_MS;
}

/**
 * Wave 32 (C5): which takeover a live glitch plays here. A host booth's is
 * always light; a burst (`NightView.glitch.light`, a talk scene's ⚡ or its
 * timed bursts) is light for everyone (guests and players too: 2.5 s, look
 * only, taps go through); otherwise the phone's own (`full`).
 */
export function takeoverKind(own: "full" | "light", glitch: { light?: true } | null | undefined): "full" | "light" {
  return own === "light" || glitch?.light === true ? "light" : "full";
}

/** The takeover a due glitch starts: what it shows, whether it's the light
 *  one, and how long it holds the phone (the provider's whole decision). */
export function takeoverStart(at: number, own: "full" | "light", glitch: { text?: string | null; light?: true } | null | undefined): { at: number; text: string | null; light: boolean; ms: number } {
  const light = takeoverKind(own, glitch) === "light";
  return { at, text: glitch?.text ?? null, light, ms: light ? TAKEOVER_LIGHT_MS : TAKEOVER_MS };
}

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
export function rungFor(moment: Pick<Moment, "severity" | "kind" | "peekOf">, level: AlertLevel, role: Viewer["role"]): Rung {
  if (moment.peekOf !== undefined) return "balloon";
  // A big moment ignores the ladder (a guest's full screen). A booth's is a
  // pop-out (`popout.tsx`); one that reaches the queue (no adapter) is major.
  if (moment.severity === "big" && role === "guest") return "big";
  const at = viewerLevel(level, role);
  if (moment.kind === "beat") return role === "booth" ? lowerRung(at) : "bsod";
  return moment.severity === "minor" ? lowerRung(at) : at;
}

/** Is a moment at least major (a big one is more than major)? */
export function atLeastMajor(m: Pick<Moment, "severity">): boolean {
  return m.severity === "major" || m.severity === "big";
}

/** A house `!` alarm: sent to everyone, major, an alert (one house banner at a time). */
export function isHouseAlert(m: Pick<Moment, "severity" | "kind" | "house" | "alarm">): boolean {
  return m.house === true && m.severity === "major" && (m.kind === "alert" || m.alarm === true);
}

/** Empty-audience rooms where `[]` means the line reached nobody (mirror of `alerts.ts`). */
const NOBODY_WHEN_EMPTY: ReadonlySet<string> = new Set(["lobby", "location", "dm", "codex", "quests", "wallet"]);

/**
 * A booth's severity for a moment message (§9.6): a guest-facing `"all"`
 * alert is minor there (a balloon); only what is addressed `@<Character>`,
 * a staff room's notice (an empty audience in an authored staff room) and
 * the booth's own Inbox (`dm:<Character>`) keep their class.
 */
export function boothSeverity(m: ChatMessage, character: string, severity: MomentSeverity): MomentSeverity {
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
  if (m.widget?.kind === "invite") return "Invitation";
  const from = m.from.trim();
  if (from !== "" && from !== "Narrator") return from;
  // The lobby is the house's announcement room (its own title is the
  // story's): an announcement when it is for everyone, else a line for you
  // alone (GN-F12: every readout was "Announcement").
  if (m.channel === "lobby") return m.audience === "all" ? "Announcement" : "For you";
  return m.title.trim() !== "" ? m.title.trim() : "Message";
}

/** Does `text` name `name` as whole words (any case)? */
export function namesViewer(text: string, name: string | undefined): boolean {
  const n = name?.trim() ?? "";
  if (n === "") return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${esc}($|[^\\p{L}\\p{N}])`, "iu").test(text);
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
  const w = momentMessage(m);
  let severity: MomentSeverity | null = w.moment ?? (m.alert === true ? "major" : null);
  if (severity === null) return null;
  if (viewer.role === "booth") {
    if (viewer.filter !== undefined && !viewer.filter(m) && m.channel !== `dm:${viewer.me}`) return null;
    severity = boothSeverity(m, viewer.me, severity);
  }
  const kind = momentKindOf(m);
  const go = Array.isArray(w.go) && w.go.length > 0 ? w.go : undefined;
  const autoClose = severity === "big" && typeof w.autoClose === "number" && w.autoClose > 0 ? w.autoClose : undefined;
  // A house cheer that names you ("Winamp won the Bingo Ribbon! Cheer for
  // them") is for everyone else: the winner has their own medal (B7).
  if (viewer.role === "guest" && autoClose !== undefined && m.audience === "all" && namesViewer(m.text, viewer.name)) return null;
  return {
    key: `m:${m.seq}`,
    seq: m.seq,
    severity,
    kind,
    ...(m.alert === true ? { alarm: true } : {}),
    caption: momentCaption(m, kind),
    text: momentText(m),
    channel: m.channel,
    beat: m.beat ?? null,
    at: m.ts,
    phase: phaseOf(m, phase),
    ...(m.audience === "all" ? { house: true } : {}),
    ...(go !== undefined ? { go } : {}),
    ...(autoClose !== undefined ? { autoClose } : {}),
    ...(severity === "big" && w.noAck === true ? { noAck: true as const } : {}),
    ...(m.widget !== undefined ? { card: { seq: m.seq, kind: m.widget.kind, glyph: noticeKey(m.widget.text || m.text) } } : {}),
    ...(m.codex !== undefined ? { entry: m.codex.entry } : {}),
    ...(m.quest !== undefined ? { quest: m.quest.quest } : {}),
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

// --- the queue ----------------------------------------------------------------

/** A moment in the queue, on its rung. */
export interface Queued {
  moment: Moment;
  level: Rung;
  /** Wall time it joined the queue (the hold's 30 s; a big's 8 s). */
  queuedAt: number;
}

export interface MomentsState {
  queue: Queued[];
  /**
   * Missed, oldest first: arrived hidden, glanced at, held too long, folded
   * by a newer sticky, replaced by a newer house banner, retired by a phase
   * change. Wave 18: these are unread Notifications rows; a wake brings
   * back only the unacked bigs and the newest live house banner among them.
   */
  missed: Moment[];
  /** The newest major moment's seq per room — a missed moment in the same room older than it is stale. */
  lastMajor: Record<string, number>;
  /** Modal moments dismissed since the modal queue was last empty ("2 of 3"). */
  burst: number;
  /** Big moments acknowledged since the big queue was last empty ("2 of 2"). */
  bigBurst: number;
}

export const EMPTY_MOMENTS: MomentsState = { queue: [], missed: [], lastMajor: {}, burst: 0, bigBurst: 0 };

export type MomentsAction =
  /** Moments that just arrived. `batch` = a history replay (several at once): only the bigs and the newest live house banner show. */
  | { type: "arrive"; moments: Moment[]; visible: boolean; level: AlertLevel; role: Viewer["role"]; now: number; phase: string | null; batch: boolean; storyNow?: number; newestHouse?: number | null; houseSince?: number | null }
  /**
   * The page became visible (or the last hold released): the unacked bigs
   * (inside `BIG_WINDOW_MS` of `storyNow`) and the newest live house banner
   * come back; the rest stay unread. `manual` (a booth tray's 🔔) brings
   * back every live one, the parked too.
   */
  | { type: "wake"; level: AlertLevel; role: Viewer["role"]; now: number; phase: string | null; manual?: boolean; storyNow?: number; newestHouse?: number | null; houseSince?: number | null }
  /** A moment left the screen. A plain close after `onScreenMs` < `GLANCE_MS` → missed; `acted` (the user took an exit) never is; a big never is. */
  | { type: "dismiss"; key: string; onScreenMs: number; acted?: boolean; keep?: boolean }
  /** The NOW objective changed (live): every queued house moment from before it (story time) is no longer news (GN-F2: "Last chance" outlived the filing). Bigs never retire. */
  | { type: "now"; storyNow: number }
  /** These leave the queue, read (the pin rail shows them in full). */
  | { type: "read"; keys: readonly string[] }
  /** While a hold lasts: modal moments queued too long move to missed. */
  | { type: "tick"; now: number; held: boolean }
  /**
   * The story changed the level live: everything still queued moves to its
   * new rung (a blue screen only exists at `bsod`; a big ignores the level).
   * On a rise, of the moments that climb onto a modal rung only the newest
   * still-relevant one shows; the rest fold into the missed list, parked,
   * and any whose phase has passed (`phase`, when given) are dropped.
   */
  | { type: "relevel"; level: AlertLevel; role: Viewer["role"]; phase?: string | null }
  /** The night's phase changed (live): every queued house moment from an earlier phase goes to missed (Notifications, unread). Bigs never retire. */
  | { type: "phase"; phase: string | null }
  /** `!` pins taken down since (`retractedPinSeqs`): drop them wherever they wait. */
  | { type: "retract"; seqs: ReadonlySet<number> }
  /** The objectives live now: a loud objective's moment (`o:<id>`) whose objective has ended leaves wherever it waits (a cleared guest is never told to show their pass). */
  | { type: "objectives"; live: ReadonlySet<string> }
  /** The story restarted: nothing queued is news any more. */
  | { type: "reset" };

function isModal(level: Rung): boolean {
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
 * that way). A big moment is never stale (only its window ends it).
 */
export function isStale(m: Moment, lastMajor: Readonly<Record<string, number>>, phase: string | null): boolean {
  if (m.severity === "big") return false;
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
 * How urgently a moment wants the screen, highest first (GUEST-SPEC §7):
 * 6 a big moment to you · 5 a big one to the house · 4 a major card or
 * readout addressed to you (your move) · 3 a house `!` alert · 2 any other
 * major · 1 a loud objective (the NOW bar says it too) · 0 the minor rest.
 * A `!` alarm addressed to you counts as your move (4).
 */
export function priorityOf(m: Pick<Moment, "kind" | "severity"> & Partial<Pick<Moment, "house" | "alarm">>): number {
  // A big card (the bottle, the doors) is your move: it comes before your
  // other big moments, and those before the house's (BN-F10).
  if (m.severity === "big") return m.house === true ? 5 : m.kind === "card" ? 7 : 6;
  if (m.kind === "objective") return 1;
  if (m.severity !== "major") return 0;
  // Yours: a card, a readout or a `!` alarm addressed to you (G6: personal outranks the house).
  if (m.house !== true && (m.kind === "card" || m.kind === "readout" || m.kind === "alert" || m.alarm === true)) return 4;
  if (m.kind === "alert" || m.alarm === true) return 3;
  return 2;
}

/**
 * The queue in the order its surfaces take it: priority first; within a
 * tier the bigs in arrival order (story order: 🎱 then 🎀), everything else
 * newest first (story time, then seq; a stable sort for the rest).
 */
function ordered(queue: readonly Queued[]): Queued[] {
  return queue
    .map((q, i) => ({ q, i, p: priorityOf(q.moment) }))
    .sort((a, b) => {
      if (a.p !== b.p) return b.p - a.p;
      if (a.p >= 5) return a.q.moment.at - b.q.moment.at || (a.q.moment.seq ?? -1) - (b.q.moment.seq ?? -1) || a.i - b.i;
      return b.q.moment.at - a.q.moment.at || (b.q.moment.seq ?? -1) - (a.q.moment.seq ?? -1) || a.i - b.i;
    })
    .map((x) => x.q);
}

/** The queue with its house banners cut to the newest one, and the rest (to missed). */
function oneHouseBanner(queue: Queued[]): { queue: Queued[]; out: Moment[] } {
  const banners = queue.filter((q) => isHouseAlert(q.moment) && !isPeek(q.moment));
  if (banners.length <= 1) return { queue, out: [] };
  const keep = newestOf(banners);
  const drop = banners.filter((q) => q !== keep);
  return { queue: queue.filter((q) => !drop.includes(q)), out: drop.map((q) => q.moment) };
}

/** At most `BSOD_MAX` blue screens wait: the newest; the rest go to missed. */
function capBlueScreens(queue: Queued[]): { queue: Queued[]; out: Moment[] } {
  const screens = queue.filter((q) => q.level === "bsod");
  if (screens.length <= BSOD_MAX) return { queue, out: [] };
  const byAge = [...screens].sort((a, b) => b.moment.at - a.moment.at || (b.moment.seq ?? -1) - (a.moment.seq ?? -1));
  const drop = byAge.slice(BSOD_MAX);
  return { queue: queue.filter((q) => !drop.includes(q)), out: drop.map((q) => q.moment) };
}

/** A quest-start balloon beside a sticky / dialog of the same cue (≤ 2 s apart) is dropped (it stays an unread Notifications row). */
function questDedupe(queue: Queued[]): { queue: Queued[]; out: Moment[] } {
  const loud = queue.filter((q) => q.level === "sticky" || isModal(q.level));
  const drop = queue.filter((q) => q.moment.kind === "quest" && q.level === "balloon" && loud.some((l) => l !== q && Math.abs(l.moment.at - q.moment.at) <= QUEST_DEDUPE_MS));
  if (drop.length === 0) return { queue, out: [] };
  return { queue: queue.filter((q) => !drop.includes(q)), out: drop.map((q) => q.moment) };
}

function enqueue(queue: Queued[], moments: readonly Moment[], level: AlertLevel, role: Viewer["role"], now: number): { queue: Queued[]; out: Moment[] } {
  const have = new Set(queue.map((q) => q.moment.key));
  const add = withoutEchoes(moments.filter((m) => !have.has(m.key)), queue.map((q) => q.moment)).map((moment) => ({ moment, level: rungFor(moment, level, role), queuedAt: now }));
  // A peek is only for a twin that waits as a sticky: one that is a balloon
  // itself already shows over the busy surface.
  const twins = new Map([...queue, ...add].map((q) => [q.moment.key, q.level]));
  const kept = add.filter((q) => q.moment.peekOf === undefined || twins.get(q.moment.peekOf) === "sticky");
  if (kept.length === 0) return { queue, out: [] };
  const a = oneHouseBanner([...queue, ...kept]);
  const b = capBlueScreens(a.queue);
  const c = questDedupe(b.queue);
  return { queue: ordered(c.queue), out: [...a.out, ...b.out, ...c.out] };
}

/**
 * Stickies never pile up (design review #6): a new sticky folds every older
 * one that is no more urgent into the missed list (unread in
 * Notifications). A loud objective's sticky is the NOW bar's business and
 * is never folded; an older, more urgent sticky (an alarm) stays up and the
 * new one waits behind it. A folded sticky takes its peek with it; a peek
 * itself is never missed.
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

/** A parked moment back in play (replayed from the tray): an ordinary one again. */
function unpark(m: Moment): Moment {
  if (m.parked !== true) return m;
  const { parked: _parked, ...rest } = m;
  return rest;
}

/** The newest of some queued moments: story time, then seq (a loud objective has none). */
function newestOf(list: readonly Queued[]): Queued | null {
  let best: Queued | null = null;
  for (const q of list) {
    if (best === null || q.moment.at > best.moment.at || (q.moment.at === best.moment.at && (q.moment.seq ?? -1) > (best.moment.seq ?? -1))) best = q;
  }
  return best;
}

/** The newest of some moments (story time, then seq). */
function newestMoment(list: readonly Moment[]): Moment | null {
  let best: Moment | null = null;
  for (const m of list) if (best === null || m.at > best.at || (m.at === best.at && (m.seq ?? -1) > (best.seq ?? -1))) best = m;
  return best;
}

/**
 * What a wake / reload / reconnect brings back (§7):
 * - every unanswered big card (whatever its age: it is your move);
 * - the newest of your other big moments inside the window, and the newest
 *   of the house's — an older one is superseded (BN-F10: a phone away for
 *   five minutes stepped through BINGO, a ribbon, an old capture and a
 *   release before the live bottle); a superseded one goes to `rest`
 *   marked `superseded` (read, never shown);
 * - the newest still-live house banner, and only when it is the newest
 *   house banner of all (`newestHouse`, read or not): an older one never
 *   comes back over a newer one already seen (GN-F2).
 * The rest stay unread.
 */
export function wakeReplay(list: readonly Moment[], lastMajor: Readonly<Record<string, number>>, phase: string | null, storyNow?: number, newestHouse?: number | null, houseSince?: number | null): { show: Moment[]; rest: Moment[] } {
  const inWindow = (m: Moment) => storyNow === undefined || m.at >= storyNow - BIG_WINDOW_MS;
  const bigs0 = list.filter((m) => m.severity === "big" && m.superseded !== true && (m.kind === "card" || inWindow(m)));
  const cards = bigs0.filter((m) => m.kind === "card");
  const mine = newestMoment(bigs0.filter((m) => m.kind !== "card" && m.house !== true));
  const house = newestMoment(bigs0.filter((m) => m.kind !== "card" && m.house === true));
  const bigs = [...cards, ...(mine !== null ? [mine] : []), ...(house !== null ? [house] : [])];
  const superseded = bigs0.filter((m) => !bigs.includes(m)).map((m): Moment => ({ ...m, superseded: true }));
  // A house banner from before the NOW objective on screen began is not news (N3).
  const current = (m: Moment) => houseSince === undefined || houseSince === null || m.at >= houseSince - ECHO_WINDOW_MS;
  const live = newestMoment(list.filter((m) => m.severity !== "big" && isHouseAlert(m) && !isStale(m, lastMajor, phase) && current(m)));
  const banner = live !== null && (newestHouse === undefined || newestHouse === null || live.seq === null || live.seq >= newestHouse) ? live : null;
  const show = [...bigs, ...(banner !== null ? [banner] : [])];
  return { show, rest: [...list.filter((m) => !show.includes(m) && (m.severity !== "big" || m.superseded === true)), ...superseded] };
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
        const q = enqueue(s.queue, fresh, a.level, a.role, a.now);
        const { queue, folded } = foldStickies(q.queue, new Set(fresh.map((m) => m.key)));
        const missed = [...q.out, ...folded];
        return { ...next, queue, missed: missed.length === 0 ? s.missed : [...s.missed, ...missed] };
      }
      // A backlog (a reload, a reconnect): the bigs and the newest live house banner.
      const { show, rest } = wakeReplay(withoutEchoes(fresh.filter((m) => !isPeek(m))), lastMajor, a.phase, a.storyNow, a.newestHouse, a.houseSince);
      const q = enqueue(s.queue, show, a.level, a.role, a.now);
      const missed = [...q.out, ...rest];
      return { ...next, queue: q.queue, missed: missed.length === 0 ? s.missed : [...s.missed, ...missed] };
    }
    case "wake": {
      if (a.manual === true) {
        // A booth tray's 🔔: every live one, the parked too.
        if (s.missed.length === 0) return s;
        const list = withoutEchoes(replayable(s.missed, s.lastMajor, a.phase).map(unpark));
        const q = enqueue(s.queue, list, a.level, a.role, a.now);
        return { ...s, queue: q.queue, missed: q.out };
      }
      // A wake on its own: the moments a level rise parked wait for the tray.
      const due = s.missed.filter((m) => m.parked !== true);
      const { show, rest } = wakeReplay(due, s.lastMajor, a.phase, a.storyNow, a.newestHouse, a.houseSince);
      if (show.length === 0 && rest.length === due.length) return s;
      const parked = s.missed.filter((m) => m.parked === true);
      const q = enqueue(s.queue, show, a.level, a.role, a.now);
      return { ...s, queue: q.queue, missed: [...parked, ...rest, ...q.out] };
    }
    case "dismiss": {
      const hit = s.queue.find((q) => q.moment.key === a.key);
      if (hit === undefined) return s;
      // A sticky takes its peek with it; a peek acted on (its exit) takes
      // its sticky too — the performer went, it is not news after.
      const twin = a.acted === true ? hit.moment.peekOf : undefined;
      const queue = s.queue.filter((q) => q !== hit && q.moment.peekOf !== hit.moment.key && (twin === undefined || q.moment.key !== twin));
      if (hit.level === "big") {
        // Acknowledged: never missed. `keep` (an exit taken from a big card
        // still unanswered, NM-F2): out of the way, but back on the next
        // wake or load until it is answered.
        const bigLeft = queue.some((q) => q.level === "big");
        return { ...s, queue, bigBurst: bigLeft ? s.bigBurst + 1 : 0, ...(a.keep === true ? { missed: [...s.missed, hit.moment] } : {}) };
      }
      const glance = isModal(hit.level) ? (s.burst > 0 ? 0 : MODAL_GLANCE_MS) : GLANCE_MS;
      const missed = a.acted !== true && a.onScreenMs < glance && !isPeek(hit.moment) ? [...s.missed, hit.moment] : s.missed;
      const modalLeft = queue.some((q) => isModal(q.level));
      const burst = isModal(hit.level) ? (modalLeft ? s.burst + 1 : 0) : s.burst;
      return { ...s, queue, missed, burst };
    }
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
          if (isModal(level) && rungIndex(level as AlertLevel) > rungIndex(q.level as AlertLevel) && !isPeek(q.moment)) risen.push(moved);
          else queue.push(moved);
        }
      }
      let missed = s.missed;
      if (risen.length > 0) {
        // An hour of unread stickies never becomes a queue of modals, oldest
        // first: what is no longer news goes, the newest still-relevant one
        // shows on the new rung, the rest wait in the missed list, parked.
        const live = a.phase === undefined ? risen : risen.filter((q) => !isStale(q.moment, s.lastMajor, a.phase ?? null));
        const newest = newestOf(live);
        if (newest !== null) queue.push(newest);
        const rest = live.filter((q) => q !== newest).map((q): Moment => ({ ...q.moment, parked: true }));
        if (rest.length > 0) missed = [...s.missed, ...rest];
      }
      if (!changed) return s;
      return { ...s, queue: ordered(queue), missed, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "phase": {
      const retire = s.queue.filter((q) => q.moment.house === true && q.level !== "big" && q.moment.severity !== "big" && !isPeek(q.moment) && (q.moment.phase ?? null) !== (a.phase ?? null));
      if (retire.length === 0) return s;
      const queue = s.queue.filter((q) => !retire.includes(q) && !(q.moment.peekOf !== undefined && retire.some((r) => r.moment.key === q.moment.peekOf)));
      return { ...s, queue, missed: [...s.missed, ...retire.map((q) => q.moment)], burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "now": {
      // Well before the change (2 s of slack: the press that moved NOW
      // also posted its own banner, which stays).
      const retire = s.queue.filter((q) => q.moment.house === true && q.level !== "big" && q.moment.severity !== "big" && q.moment.kind !== "objective" && !isPeek(q.moment) && q.moment.at < a.storyNow - ECHO_WINDOW_MS);
      if (retire.length === 0) return s;
      const queue = s.queue.filter((q) => !retire.includes(q) && !(q.moment.peekOf !== undefined && retire.some((r) => r.moment.key === q.moment.peekOf)));
      return { ...s, queue, missed: [...s.missed, ...retire.map((q) => q.moment)], burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "read": {
      // Read, every one — none of them is missed.
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
      if (queue === s.queue && missed === s.missed) return s;
      return { ...s, queue, missed, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "objectives": {
      const gone = (m: Moment) => m.kind === "objective" && m.key.startsWith("o:") && !a.live.has(m.key.slice(2));
      const queue = s.queue.some((q) => gone(q.moment)) ? s.queue.filter((q) => !gone(q.moment)) : s.queue;
      const missed = s.missed.some(gone) ? s.missed.filter((m) => !gone(m)) : s.missed;
      if (queue === s.queue && missed === s.missed) return s;
      return { ...s, queue, missed, burst: queue.some((q) => isModal(q.level)) ? s.burst : 0 };
    }
    case "reset":
      return EMPTY_MOMENTS;
  }
}

/** What is on screen now, per surface. `held` keeps the modal surfaces (dialog / bsod) off and a big back for `BIG_HOLD_MS`. */
export interface Surfaces {
  /** A big moment (full screen, whatever the level). While one shows, every other surface waits. */
  big: Queued | null;
  /** "n of m" for the big on screen. */
  bigIndex: number;
  bigTotal: number;
  /** A loud objective flashing the NOW title bar (a guest's frame only). */
  now: Queued | null;
  balloon: Queued | null;
  sticky: Queued | null;
  /** How many stickies are waiting, the one on screen included. */
  stickyCount: number;
  /** Their keys (the pin rail reads those it shows in full). */
  stickyKeys: string[];
  modal: Queued | null;
  /** "n of m" for the modal on screen. */
  modalIndex: number;
  modalTotal: number;
}

/** Is this queued moment the NOW bar's (a guest's loud objective below the modal rungs)? */
export function onNowBar(q: Queued, nowBar: boolean): boolean {
  return nowBar && q.moment.kind === "objective" && (q.level === "balloon" || q.level === "sticky");
}

/**
 * What each surface shows. `nowBar` (a guest's frame): a loud objective
 * below the modal rungs flashes the NOW title bar (`now`) instead of
 * stacking a second copy of it as a sticky or a balloon. `now` (wall
 * clock) lets a big held behind a busy surface show after `BIG_HOLD_MS`.
 * `covered` (wave 26 C3: the glitch takeover is on screen) holds back every
 * surface, stickies and balloons too: nothing reaches the screen (no
 * chime, no balloon timer) under the takeover, and nothing leaves the
 * queue, so it all lands right after it.
 */
export function surfacesOf(s: MomentsState, held: boolean, nowBar = false, now = Number.POSITIVE_INFINITY, covered = false): Surfaces {
  if (covered) return { big: null, bigIndex: 0, bigTotal: 0, now: null, balloon: null, sticky: null, stickyCount: 0, stickyKeys: [], modal: null, modalIndex: 0, modalTotal: 0 };
  const bigs = s.queue.filter((q) => q.level === "big");
  const first = bigs[0] ?? null;
  const big = first !== null && (!held || now - first.queuedAt >= BIG_HOLD_MS) ? first : null;
  if (big !== null)
    return { big, bigIndex: s.bigBurst + 1, bigTotal: s.bigBurst + bigs.length, now: null, balloon: null, sticky: null, stickyCount: 0, stickyKeys: [], modal: null, modalIndex: 0, modalTotal: 0 };
  const rest0 = s.queue.filter((q) => q.level !== "big");
  const nowQ = rest0.find((q) => onNowBar(q, nowBar)) ?? null;
  const rest = nowBar ? rest0.filter((q) => !onNowBar(q, nowBar)) : rest0;
  // A peek shows only while the hold lasts (its twin's sticky takes over after).
  const balloon = rest.find((q) => q.level === "balloon" && (held || !isPeek(q.moment))) ?? null;
  const stickies = rest.filter((q) => q.level === "sticky");
  const modals = s.queue.filter((q) => isModal(q.level));
  return {
    big: null,
    bigIndex: 0,
    bigTotal: 0,
    now: nowQ,
    balloon,
    sticky: stickies[0] ?? null,
    stickyCount: stickies.length,
    stickyKeys: stickies.map((q) => q.moment.key),
    modal: held ? null : (modals[0] ?? null),
    modalIndex: s.burst + 1,
    modalTotal: s.burst + modals.length,
  };
}

/** The missed count: the missed list, plus modal moments a hold has kept back too long. */
export function missedCount(s: MomentsState, held: boolean, now: number): number {
  const late = held ? s.queue.filter((q) => isModal(q.level) && now - q.queuedAt > HOLD_MISS_MS).length : 0;
  return s.missed.length + late;
}

// --- arrivals from the message map ---------------------------------------------

/** The seq the mark moves to: just under the oldest unsettled message moment
 *  (`waiting` adds moments not in the state yet — dispatched, or a readout
 *  waiting for its toast), else the newest processed. */
export function settledMark(s: MomentsState, processedMax: number, waiting: Iterable<number> = []): number {
  let min = Number.POSITIVE_INFINITY;
  for (const seq of waiting) if (seq < min) min = seq;
  for (const q of s.queue) if (q.moment.seq !== null && q.moment.seq < min) min = q.moment.seq;
  // A parked moment is settled: a reload never replays it.
  for (const m of s.missed) if (m.seq !== null && m.parked !== true && m.seq < min) min = m.seq;
  return Number.isFinite(min) ? Math.min(processedMax, min - 1) : processedMax;
}

/** How many settled seqs above the mark a reload remembers (the newest). */
export const DONE_MAX = 2_000;

/**
 * The seqs above the settled `mark` that are done — looked at, and not
 * waiting in the queue or the missed list (read, dismissed,
 * not a moment at all). The mark sits under the oldest moment still
 * waiting, so without these a reload would replay every moment after it
 * that was already read. Persisted per sign-in; ascending, the newest
 * `DONE_MAX`.
 */
export function doneAbove(s: MomentsState, processed: Iterable<number>, mark: number, also: Iterable<number> = []): number[] {
  const waiting = new Set<number>(also);
  for (const q of s.queue) if (q.moment.seq !== null) waiting.add(q.moment.seq);
  for (const m of s.missed) if (m.seq !== null && m.parked !== true) waiting.add(m.seq);
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
    const own = momentOf(m, viewer, ctx.phase);
    // An unacknowledged big moment stays news a little longer.
    const old = m.ts < ctx.now - (own?.severity === "big" ? BIG_WINDOW_MS : MOMENT_WINDOW_MS);
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

/** The newest house banner's seq for this viewer (read or not), else null:
 *  a reload / wake never brings back an older one over it (GN-F2). */
export function newestHouseSeq(messages: Iterable<ChatMessage>, viewer: Viewer, phase: string | null): number | null {
  let max: number | null = null;
  for (const m of messages) {
    if (m.audience !== "all" || m.alert !== true || !Number.isInteger(m.seq)) continue;
    if (max !== null && m.seq <= max) continue;
    const own = momentOf(m, viewer, phase);
    if (own !== null && own.severity !== "big" && isHouseAlert(own)) max = m.seq;
  }
  return max;
}

/**
 * The sign-in's first backlog sweep (GN-F7 / NM-F3): the big moments at or
 * under the mark (a new sign-in takes its first history as old news) that
 * still matter — every unanswered big card addressed to the viewer,
 * whatever its age, and any other big inside `BIG_WINDOW_MS` — never one
 * acknowledged, nor a house cheer that closes itself.
 */
export function sweepBigs(
  messages: Iterable<ChatMessage>,
  mark: number,
  viewer: Viewer,
  ctx: { now: number; phase: string | null; acked: ReadonlySet<string>; answered: (seq: number) => boolean; processed: ReadonlySet<number> },
): Moment[] {
  const out: Moment[] = [];
  for (const m of messages) {
    if (!Number.isInteger(m.seq) || m.seq > mark || ctx.processed.has(m.seq)) continue;
    const own = momentOf(m, viewer, ctx.phase);
    if (own === null || own.severity !== "big" || own.autoClose !== undefined || ctx.acked.has(own.key)) continue;
    if (own.kind === "card" ? ctx.answered(m.seq) : m.ts < ctx.now - BIG_WINDOW_MS) continue;
    out.push(own);
  }
  return out.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
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
    else if (m.severity === "major" || m.severity === "big") push(m);
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
