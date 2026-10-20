//! The director's cue sheet (K-21), as pure data — shared by the editor's
//! Run → Director page and the play app's phone cue page (W-26).
//!
//! The story declares its `who: admin` INTERACTIONs in running order, each
//! label opening with the source cue code (`C1/V1 · 📣 Call everyone to the
//! Desktop`). This module turns those into rows a director's screen renders
//! as buttons: the code split off, the last cue marked, the next one (the
//! first declaration after the last that hasn't fired and is on tonight's
//! branch — `while:` holds — or the last itself while it is a `repeat: true`
//! cue, pressed once per question / per trip) suggested, a free-text filter, and the story's `Night.phase` read off
//! the world.
//!
//! On top of the rows (wave 10, display only — never NEXT / LAST): the
//! story's **acts** (an admin cue's `act:` opens a section later admin cues
//! join; `cueActs` groups the rows and names the focus act, the one holding
//! NEXT, else LAST), the cue after NEXT (`onDeck`), a title's parenthetical
//! tags, countdowns off the story clock, and the **arm model** both screens
//! fire through: a first tap arms, a second one ≥ `ARM_DEAD_MS` and
//! < `ARM_MS` later fires, and an arm is dropped once the cue state moves.
//!
//! Dependency-free on purpose: the play app imports this file by path (it
//! has no `@loom/core` dependency), so the shapes below are structural —
//! the server's `InteractionSummary` / `CueState` / world rows fit them.

import type { ShowClock } from "./show-clock.ts";

/** What a cue row needs from an `InteractionSummary`. */
export interface CueInteraction {
  id: string;
  label: string;
  who: string;
  sequence?: false;
  subject?: boolean;
  /** Pressed again and again (`repeat: true`): still NEXT once fired. */
  repeat?: true;
  /** False while the cue's `while:` is false — off tonight's branch (🏍
   *  before Combo A): never NEXT, still pressable. */
  live?: false;
  /** The cue's own `act:` line (it opens an act; later cues join it). */
  act?: string;
  /** What the cue does, in full (the laptop's NOW card; never the phone's). */
  description?: string | null;
  /** `arm: true` on the INTERACTION (the director's sheet arms every cue
   *  anyway; carried so every view of a button says the same). */
  arm?: boolean;
}

/** What a cue row needs from the server's `CueState`. */
export interface CueMarks {
  last: string | null;
  /** Who fired `last` (`director` / `story`) — not read here. */
  lastBy?: string | null;
  /** Who pressed `last`, by name (a host part, a director, a device), when
   *  the server knows — the host dock's LAST line. Absent from an older
   *  server and when the story fired it. Not read here. */
  lastName?: string;
  fired: string[];
  /** How many presses the story has taken tonight (any admin cue, by a
   *  director, a device or the story; a refused press never counts). A
   *  repeat of LAST (📋 per question) or of an aside moves neither `last`
   *  nor `fired`, so an arm also binds to this: it drops when the newest
   *  press since was its own cue, and the server refuses it when any press
   *  since was. Absent from an older server. */
  presses?: number;
  /** The cue the newest taken press fired (an aside included), or null. */
  pressed?: string | null;
}

/** One world row (`ModView.world`). */
export interface WorldLine {
  path: string;
  value: string;
}

export interface CueRow {
  /** The INTERACTION id — the named event the button fires. */
  id: string;
  /** 1-based position in the declared order. */
  n: number;
  /** The source cue code (`C1/V1`, `V2`, `Clippy 2/X`), or null. */
  code: string | null;
  /** The label without its code. */
  title: string;
  /** Fired at least once tonight. */
  fired: boolean;
  /** The most recent cue to fire. */
  last: boolean;
  /** The first in-sequence cue after the last one in running order that
   *  has not fired yet (a `repeat: true` cue stays eligible) — or the last
   *  one itself while it is a `repeat: true` cue: the director presses it
   *  again (📋 per question) or moves on. */
  next: boolean;
  /** False for an off-sequence cue (`sequence: false` — machine-fired or a
   *  hardware fallback): it ticks when it fires but is never LAST / NEXT. */
  sequence: boolean;
  /** False while the cue's `while:` is false (off tonight's branch): the
   *  sheet never suggests it, and may dim it. */
  live: boolean;
  /** The cue does nothing without a person (an award's winner): the sheet
   *  asks for one before it fires. */
  subject: boolean;
  /** The act it belongs to — its own `act:`, else the last one above it —
   *  in the spelling of the act's first appearance; null before any. */
  act: string | null;
  /** The cue's `description:`, if the view carries it. */
  description: string | null;
}

/** A code is the label's first ` · `-separated part, if it is short. */
const CODE_MAX = 12;

export function splitCode(label: string): { code: string | null; title: string } {
  const at = label.indexOf(" · ");
  if (at > 0 && at <= CODE_MAX) return { code: label.slice(0, at).trim(), title: label.slice(at + 3).trim() };
  return { code: null, title: label.trim() };
}

/** An act name's comparison key: lowercase, `_` / `-` / space runs read
 *  as one space (core's `foldName`, kept here: this file has no imports). */
function foldAct(name: string): string {
  return name.trim().toLowerCase().replace(/[_\-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

/** Every admin cue in declared order, marked against the cue state. */
export function cueRows(interactions: readonly CueInteraction[], cues: CueMarks): CueRow[] {
  const fired = new Set(cues.fired);
  const admin = interactions.filter((i) => i.who === "admin");
  // Acts carry forward: a cue with no `act:` joins the one above it; a name
  // already seen (folded) rejoins that act under its first spelling.
  const spelled = new Map<string, string>();
  let act: string | null = null;
  const acts = admin.map((i) => {
    const own = i.act?.trim() ?? "";
    if (own !== "") {
      const k = foldAct(own);
      if (!spelled.has(k)) spelled.set(k, own);
      act = spelled.get(k)!;
    }
    return act;
  });
  const lastIdx = cues.last === null ? -1 : admin.findIndex((i) => i.id === cues.last);
  const nextIdx =
    lastIdx >= 0 && admin[lastIdx]!.repeat === true && admin[lastIdx]!.live !== false
      ? lastIdx
      : admin.findIndex((i, idx) => idx > lastIdx && i.sequence !== false && i.live !== false && (!fired.has(i.id) || i.repeat === true));
  return admin.map((i, idx) => {
    const { code, title } = splitCode(i.label || i.id);
    return {
      id: i.id,
      n: idx + 1,
      code,
      title,
      fired: fired.has(i.id),
      last: idx === lastIdx,
      next: idx === nextIdx,
      sequence: i.sequence !== false,
      live: i.live !== false,
      subject: i.subject === true,
      act: acts[idx]!,
      description: i.description ?? null,
    };
  });
}

/** One act of the running order. */
export interface CueAct {
  /** The folded act name ("" for the unnamed act before any `act:`). */
  key: string;
  /** The act's code (`B` of `B · Act I: …`, `splitCode`), or null. */
  code: string | null;
  /** The act's title without its code; null for the unnamed act. */
  title: string | null;
  /** Every row in it, in running order. */
  rows: CueRow[];
  /** Its in-sequence rows (numbered on the sheet; NEXT / LAST live here). */
  spine: CueRow[];
  /** Its off-sequence rows (`sequence: false`: fallbacks, machine cues). */
  asides: CueRow[];
  /** How many spine rows have fired. */
  firedSpine: number;
  /** Where the night is: before the focus act (`past`; `skipped` when none
   *  of its spine fired), the focus act, after it, or an act of asides
   *  only (`anytime`: never the focus). */
  state: "past" | "skipped" | "focus" | "future" | "anytime";
  /** The focus act, just begun: NEXT is its first unfired spine row and
   *  no LAST sits in it yet. */
  starting: boolean;
}

/**
 * The rows grouped into acts, in order of each act's first appearance (a
 * rejoined act — a second `act: Anytime` — gathers its rows wherever they
 * sit). The focus act holds NEXT, else LAST, else it is the first act that
 * is not Anytime. With no `act:` anywhere: one unnamed act. No rows: none.
 */
export function cueActs(rows: CueRow[]): CueAct[] {
  const byKey = new Map<string, CueAct>();
  for (const r of rows) {
    const key = r.act === null ? "" : foldAct(r.act);
    let a = byKey.get(key);
    if (a === undefined) {
      const named = r.act === null ? null : splitCode(r.act);
      a = { key, code: named?.code ?? null, title: named?.title ?? null, rows: [], spine: [], asides: [], firedSpine: 0, state: "future", starting: false };
      byKey.set(key, a);
    }
    a.rows.push(r);
    (r.sequence ? a.spine : a.asides).push(r);
    if (r.sequence && r.fired) a.firedSpine += 1;
  }
  const acts = [...byKey.values()];
  const anytime = (a: CueAct): boolean => a.spine.length === 0;
  let focus = acts.findIndex((a) => !anytime(a) && a.rows.some((r) => r.next));
  if (focus < 0) focus = acts.findIndex((a) => !anytime(a) && a.rows.some((r) => r.last));
  if (focus < 0) focus = acts.findIndex((a) => !anytime(a));
  acts.forEach((a, k) => {
    if (anytime(a)) a.state = "anytime";
    else if (k === focus) a.state = "focus";
    else if (k < focus) a.state = a.firedSpine === 0 ? "skipped" : "past";
    else a.state = "future";
  });
  if (focus >= 0) {
    const a = acts[focus]!;
    // Just begun: NEXT is its first unfired spine row and nothing pressed
    // in it has become LAST yet (a mid-act NEXT is not a start).
    const first = a.spine.find((r) => !r.fired);
    a.starting = first !== undefined && first.next && !a.rows.some((r) => r.last && !r.next);
  }
  return acts;
}

/** The focus act's index (-1 when there are no acts, or only Anytime). */
export function focusActIndex(acts: CueAct[]): number {
  return acts.findIndex((a) => a.state === "focus");
}

/** The act before `focus` that is not Anytime (its asides stay on hand as
 *  the "from D ▸" line), or -1. */
export function previousActIndex(acts: CueAct[], focus: number): number {
  for (let k = Math.min(focus, acts.length) - 1; k >= 0; k--) if (acts[k]!.state !== "anytime") return k;
  return -1;
}

/** The cue after NEXT: the next unfired in-sequence row below it (live or
 *  not — the sheet dims an off-branch one). Null with no NEXT. */
export function onDeck(rows: CueRow[]): CueRow | null {
  const at = rows.findIndex((r) => r.next);
  if (at < 0) return null;
  return rows.find((r, idx) => idx > at && r.sequence && !r.fired) ?? null;
}

/** The lead words a tag lower-cases (`Optional` → `optional`, `Alt, …` →
 *  `alt, …`); every other parenthetical keeps its spelling, so a name
 *  (`Trabolta hosts`, `Truth or Dare, …`) is never mangled. */
const TAG_LEAD_WORDS = /^(Optional|Alt)(?![\p{L}\p{N}])/u;

/** A tag's text: the parenthetical as written, unchanged, except a known
 *  lead word (`TAG_LEAD_WORDS`) lower-cased. */
function tagText(inner: string): string {
  const t = inner.trim();
  return TAG_LEAD_WORDS.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/**
 * Lift a title's leading `(…)` — at the very start, or right after a
 * leading emoji (`💌 (Alt) …`) — and its trailing `(…)` into muted tags:
 * `(Optional) ☎️ Telephone` → `☎️ Telephone` + `optional`;
 * `🎆 Midnight (auto at 60 min)` → `🎆 Midnight` + `auto at 60 min`.
 * A title that would be left empty keeps its parenthetical.
 */
export function cueTitleTags(title: string): { title: string; tags: string[] } {
  let rest = title.trim();
  const tags: string[] = [];
  const lead = /^((?:[^\p{L}\p{N}\s(]+\s+)?)\(([^()]*)\)\s*/u.exec(rest);
  if (lead !== null && rest.slice(lead[0].length).trim() !== "" && lead[2]!.trim() !== "") {
    tags.push(tagText(lead[2]!));
    rest = (lead[1]! + rest.slice(lead[0].length)).trim();
  }
  const trail = /\s*\(([^()]*)\)$/u.exec(rest);
  if (trail !== null && rest.slice(0, trail.index).trim() !== "" && trail[1]!.trim() !== "") {
    tags.push(tagText(trail[1]!));
    rest = rest.slice(0, trail.index).trim();
  }
  return { title: rest, tags };
}

/** Whole seconds left until `endsAt` (story seconds) at story time `nowMs`
 *  (the view's `clock`, ticked on locally) — null when unknown or over. */
export function countdownLeft(endsAt: number, nowMs: number | null): number | null {
  if (nowMs === null || !Number.isFinite(nowMs) || !Number.isFinite(endsAt)) return null;
  const left = endsAt - nowMs / 1000;
  return left > 0 ? Math.ceil(left) : null;
}

// --- arm, then fire ------------------------------------------------------------
// One model for the laptop's Director page and the phone's cue page: no key
// or tap fires in one stroke.

/** How long an armed cue waits for the second tap. */
export const ARM_MS = 4000;
/** A second tap sooner than this after arming is ignored: a double-click
 *  (📋 `read_the_results`, which would skip a question) only arms. */
export const ARM_DEAD_MS = 300;

/** The cue waiting for its second tap (and its person, for a subject cue). */
export interface Armed {
  id: string;
  subject: string | null;
  at: number;
  /** The award's optional value box, as typed (T2-09): lies accepted, the
   *  duck time, quests done — or a fixed award's number overridden. */
  value?: string;
  /** The cue state when it was armed (`CueMarks.last` and how many cues
   *  had fired): once either moves — another director, or the story,
   *  fired — the arm is stale. Absent: armed with no marks to bind to. */
  last?: string | null;
  firedCount?: number;
  /** `CueMarks.presses` when it was armed (a server that counts them). */
  presses?: number;
}

export type Tap =
  /** First tap: the row is armed — tap again to fire. */
  | { kind: "arm"; armed: Armed }
  /** A cue that needs a person, with none picked yet: open the picker. */
  | { kind: "pick"; id: string }
  /** Second tap on an armed row in time: fire it. `presses`: the press
   *  count it was armed against — sent with the press, so the server turns
   *  it down (409 `moved`) when another director's press landed in between,
   *  before this screen's next poll could say so. */
  | { kind: "fire"; id: string; subject: string | null; value?: string; presses?: number }
  /** A second tap inside the dead time: nothing happens. */
  | { kind: "ignore" };

/** The cue state an arm is bound to. */
function bindMarks(marks: CueMarks | undefined): Pick<Armed, "last" | "firedCount" | "presses"> {
  if (marks === undefined) return {};
  return { last: marks.last, firedCount: marks.fired.length, ...(typeof marks.presses === "number" ? { presses: marks.presses } : {}) };
}

/** Is `armed` still good to fire at `now`: inside `ARM_MS`, and the cue
 *  state it was armed against (if bound) has not moved since — LAST, the
 *  fired set, or a press of the armed cue itself. */
export function armStillValid(armed: Armed, marks: CueMarks, now: number): boolean {
  if (now - armed.at >= ARM_MS) return false;
  if (armed.last !== undefined && armed.last !== marks.last) return false;
  if (armed.firedCount !== undefined && armed.firedCount !== marks.fired.length) return false;
  // Another press of this same cue (a second director's 📋, 🍾 again)
  // moves only the press count — and `pressed` names it. Another cue's
  // repeat (a guest's second duck find, a door contact) leaves the arm be;
  // the server judges every press since the arm (`pressMovedArm`), so one a
  // newer press hid from `pressed` is still refused there. A count that
  // went back is a new run.
  if (armed.presses !== undefined && typeof marks.presses === "number") {
    if (marks.presses < armed.presses) return false;
    if (marks.presses > armed.presses && marks.pressed === armed.id) return false;
  }
  return true;
}

/** What a tap on `row` does, given what is armed now. With `marks`, the
 *  arm it makes is bound to them and a stale arm never fires (it re-arms). */
export function tapCue(armed: Armed | null, row: CueRow, now: number, marks?: CueMarks): Tap {
  if (armed !== null && armed.id === row.id && now - armed.at < ARM_DEAD_MS) return { kind: "ignore" };
  const live = armed !== null && armed.id === row.id && now - armed.at < ARM_MS && (marks === undefined || armStillValid(armed, marks, now));
  if (live) return { kind: "fire", id: row.id, subject: armed.subject, ...(armed.value !== undefined ? { value: armed.value } : {}), ...(armed.presses !== undefined ? { presses: armed.presses } : {}) };
  if (row.subject) return { kind: "pick", id: row.id };
  return { kind: "arm", armed: { id: row.id, subject: null, at: now, ...bindMarks(marks) } };
}

/** The picker answered: the subject cue is armed for that person (and the
 *  value box's text, when one was typed), bound to `marks` when given. */
export function armFor(id: string, subject: string, now: number, value?: string, marks?: CueMarks): Armed {
  const v = value?.trim() ?? "";
  return { id, subject, at: now, ...(v !== "" ? { value: v } : {}), ...bindMarks(marks) };
}

/** Only an award reads a value (G7–G9's number); the King's fallback or a
 *  reinstallation cue asks just for the person. */
export function takesValue(id: string): boolean {
  return id.startsWith("award_");
}

/** Rows whose code, label or id contain every word of `query` (case-folded). */
export function filterCues(rows: CueRow[], query: string): CueRow[] {
  const words = query.toLowerCase().split(/\s+/u).filter((w) => w !== "");
  if (words.length === 0) return rows;
  return rows.filter((r) => {
    const hay = `${r.code ?? ""} ${r.title} ${r.id}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The story's `Night.phase` (quotes stripped), or null when unset. */
export function nightPhase(world: readonly WorldLine[]): string | null {
  const e = world.find((w) => w.path === "Night.phase");
  if (e === undefined) return null;
  const v = e.value.replace(/^"(.*)"$/u, "$1").trim();
  return v === "" || v === "null" ? null : v;
}

/** A person-cue's optional `value` box (the number the award line reads):
 *  empty → no arguments, a number → a number, anything else → the text. */
export function cueValueArgs(raw: string): { value: string | number } | null {
  const t = raw.trim();
  if (t === "") return null;
  return { value: /^-?\d+(\.\d+)?$/u.test(t) ? Number(t) : t };
}

/** One person a subject cue can name (a `RosterRow`, trimmed). */
export interface CuePerson {
  id: string;
  name: string;
  location: string | null;
  owner?: string | null;
}

/** The phone's lean read (`GET /api/state?role=mod&cues=1`): only what the
 *  cue page renders. The full `ModView` with 60 guests is ~450 KB, polled
 *  every 3 s on a director's mobile data. */
export interface CueSheetView {
  title?: string;
  /** The story's `theme:` (the phone skins itself with it, the same before
   *  and after the doors open). */
  theme?: string;
  interactions: CueInteraction[];
  cues: CueMarks;
  /** Just the `Night.phase` row, if set. */
  world: WorldLine[];
  roster: CuePerson[];
  /** The story clock (ms) when the view was built — what the countdowns
   *  tick down from, plus the wall time since the poll. */
  clock?: number;
  /** The story clock is stopped (the event is paused, or the doors have
   *  not opened): `clock` holds still, so a countdown must not tick on.
   *  Absent while the clock runs, and from an older server. */
  paused?: true;
  /** The doors have not opened yet (the runtime is `idle`, or a restart
   *  left it `paused` before its `start:` beat): the cue sheet is the
   *  story's, nothing can fire until they open. */
  doorsClosed?: true;
  /** The live countdowns (`ModView.countdowns`), when any is running. */
  countdowns?: { label: string; endsAt: number }[];
  /** Up to 3 live `watch:` values — global ones only, never a secret;
   *  a `while`-gated line's first (what matters right now). */
  watch?: { label: string; value: string }[];
  /** The show clock (`ModView.showClock`, wave 13 K2), when the story set one. */
  showClock?: ShowClock;
}

/** What the lean view reads off a `ModView`'s `watch` (structural). */
interface WatchInput {
  label: string;
  path: string | null;
  scope: string;
  secret?: true;
  /** From a `while`-gated line: live only for a stretch of the night. */
  gated?: true;
}

/** How many `watch:` values the phone's strip carries. */
const PHONE_WATCH = 3;

/** Trim a `ModView`-shaped snapshot down to the cue sheet. */
export function cueSheetView(view: {
  title?: string;
  theme?: string;
  interactions?: readonly CueInteraction[];
  cues?: CueMarks;
  world?: readonly WorldLine[];
  roster?: readonly CuePerson[];
  clock?: number;
  /** The runtime phase (`ModView.phase`): the clock runs only while `open`. */
  phase?: string;
  /** The doors have not opened on this run (`ModView.doorsClosed`): also a
   *  `paused` run whose `start:` beat has not played (a restart before the
   *  doors). */
  doorsClosed?: true;
  watch?: readonly WatchInput[];
  countdowns?: readonly { label: string; endsAt: number }[];
  showClock?: ShowClock;
}): CueSheetView {
  const world = view.world ?? [];
  // The strip has room for three: a `while`-gated line's values first (they
  // are the ones that matter right now — `Results read` while the truth
  // round runs), then the always-on lines in declared order.
  const globals = (view.watch ?? []).filter((w) => w.scope === "global" && w.secret !== true && w.path !== null);
  const watch = [...globals.filter((w) => w.gated === true), ...globals.filter((w) => w.gated !== true)]
    .slice(0, PHONE_WATCH)
    .map((w) => ({ label: w.label, value: world.find((e) => e.path === w.path)?.value ?? "null" }));
  const countdowns = (view.countdowns ?? []).map((c) => ({ label: c.label, endsAt: c.endsAt }));
  return {
    ...(view.title !== undefined ? { title: view.title } : {}),
    ...(view.theme !== undefined ? { theme: view.theme } : {}),
    interactions: (view.interactions ?? [])
      .filter((i) => i.who === "admin")
      .map((i) => ({
        id: i.id,
        label: i.label,
        who: i.who,
        ...(i.sequence === false ? { sequence: false as const } : {}),
        ...(i.subject === true ? { subject: true } : {}),
        ...(i.repeat === true ? { repeat: true as const } : {}),
        ...(i.live === false ? { live: false as const } : {}),
        ...(typeof i.act === "string" && i.act.trim() !== "" ? { act: i.act } : {}),
        ...(i.arm === true ? { arm: true as const } : {}),
      })),
    cues: view.cues ?? { last: null, fired: [] },
    world: world.filter((w) => w.path === "Night.phase").map((w) => ({ path: w.path, value: w.value })),
    roster: (view.roster ?? []).map((p) => ({ id: p.id, name: p.name, location: p.location, ...(p.owner !== undefined ? { owner: p.owner } : {}) })),
    ...(view.clock !== undefined ? { clock: view.clock } : {}),
    ...(view.phase !== undefined && view.phase !== "open" ? { paused: true as const } : {}),
    ...(view.phase === "idle" || view.doorsClosed === true ? { doorsClosed: true as const } : {}),
    ...(countdowns.length > 0 ? { countdowns } : {}),
    ...(watch.length > 0 ? { watch } : {}),
    ...(view.showClock !== undefined ? { showClock: { minutes: view.showClock.minutes, running: view.showClock.running } } : {}),
  };
}
