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
//! Dependency-free on purpose: the play app imports this file by path (it
//! has no `@loom/core` dependency), so the shapes below are structural —
//! the server's `InteractionSummary` / `CueState` / world rows fit them.

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
}

/** What a cue row needs from the server's `CueState`. */
export interface CueMarks {
  last: string | null;
  /** Who fired `last` (`director` / `story`) — not read here. */
  lastBy?: string | null;
  fired: string[];
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
}

/** A code is the label's first ` · `-separated part, if it is short. */
const CODE_MAX = 12;

export function splitCode(label: string): { code: string | null; title: string } {
  const at = label.indexOf(" · ");
  if (at > 0 && at <= CODE_MAX) return { code: label.slice(0, at).trim(), title: label.slice(at + 3).trim() };
  return { code: null, title: label.trim() };
}

/** Every admin cue in declared order, marked against the cue state. */
export function cueRows(interactions: readonly CueInteraction[], cues: CueMarks): CueRow[] {
  const fired = new Set(cues.fired);
  const admin = interactions.filter((i) => i.who === "admin");
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
    };
  });
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
  interactions: CueInteraction[];
  cues: CueMarks;
  /** Just the `Night.phase` row, if set. */
  world: WorldLine[];
  roster: CuePerson[];
}

/** Trim a `ModView`-shaped snapshot down to the cue sheet. */
export function cueSheetView(view: {
  title?: string;
  interactions?: readonly CueInteraction[];
  cues?: CueMarks;
  world?: readonly WorldLine[];
  roster?: readonly CuePerson[];
}): CueSheetView {
  return {
    ...(view.title !== undefined ? { title: view.title } : {}),
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
      })),
    cues: view.cues ?? { last: null, fired: [] },
    world: (view.world ?? []).filter((w) => w.path === "Night.phase").map((w) => ({ path: w.path, value: w.value })),
    roster: (view.roster ?? []).map((p) => ({ id: p.id, name: p.name, location: p.location, ...(p.owner !== undefined ? { owner: p.owner } : {}) })),
  };
}
