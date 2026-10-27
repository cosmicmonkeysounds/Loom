//! What the wizard says about a program before Play here — pure: corrupted
//! (in the Internet), restricted (wave 4's restricted state, not captured
//! yet) or healthy. The server's `restricted` is true both for a program
//! the story marked (sent to the Internet: Play here's `reinstallation
//! begun` captures them) and for one a director restricted from the
//! Inspector (which Play here does not capture), so the wizard says only
//! what holds for both. And the scan screen's quick picks: the programs in
//! the Internet now, then the restricted ones (the marked on their way), so
//! the operator never has to type a name.
//!
//! Wave 16: only a program the story marked for reinstallation (captured,
//! or restricted) may enter — the server's begin answers 409 `not marked
//! for reinstallation` otherwise — so the healthy are never offered Play
//! here or a headset, and say why.
//!
//! Wave 18: the server names the marked (`marked`, C7) — a mark no longer
//! restricts a program — and after an ending the reinstallation is open to
//! everyone as a party favour (S1): the screen state's `night.ended` turns
//! the copy into a party favour, never "corrupted". The candidates say it
//! too (`favour`, with `marked` false for everyone once the night is over).

/** A candidate as the tablet reads it (`GET /api/mod/spatial/candidates`). */
export interface Program {
  id: string;
  name: string;
  captured: boolean;
  /** Restricted (wave 4: marked by an older story, or held by a director) and not captured yet. */
  restricted: boolean;
  /** Captured or marked: the server's begin lets them in (wave 16). */
  eligible: boolean;
  /** Marked for reinstallation and not captured yet (wave 18, C7: the
   *  server's `marked`, else read off `restricted` for an older server). */
  marked: boolean;
  /** The night is over and the server lets them in: a party favour (wave 18,
   *  the server's `favour`; false from a server that doesn't say). */
  favour: boolean;
  location: string | null;
  /** Reinstallations completed since the story started (the server's
   *  `reinstalled`, wave 33): ≥ 1 lets the intro be skipped. Missing = 0. */
  reinstalled?: number;
}

/** The server's 409 for a program neither captured nor marked. */
export const NOT_MARKED_ERROR = "not marked for reinstallation";

/** What the wizard says about a program it may not begin. It states no
 *  rule (wave 26, G2: the help and the screens never explain the machinery). */
// w26 (G2) UI copy
export const NOT_MARKED = "Not marked for reinstallation.";

/** May the tablet begin this program? (A row from a server older than
 *  wave 16 has no `eligible`: captured or restricted, the same rule.) */
export function isEligible(p: Pick<Program, "captured" | "restricted"> & { eligible?: boolean }): boolean {
  return p.eligible ?? (p.captured || p.restricted);
}

/** Is this program marked (wave 18)? The server's `marked` when it says;
 *  an older one's row reads `restricted` (the old marked state). Never a
 *  captured program: that one is corrupted. */
export function isMarked(row: { captured: boolean; restricted?: boolean; eligible?: boolean; marked?: boolean }): boolean {
  if (row.captured) return false;
  if (typeof row.marked === "boolean") return row.marked || (row.restricted === true && row.eligible === true);
  return row.restricted === true;
}

/**
 * - `corrupted` — in the Internet (captured);
 * - `favour`    — the night is over and the server lets them in: the
 *                 reinstallation is a party favour (S1), nothing corrupted;
 * - `marked`    — marked for reinstallation: Play here begins it;
 * - `held`      — restricted by a director but not marked: no Play here;
 * - `healthy`   — not marked.
 */
export type ProgramState = "corrupted" | "favour" | "marked" | "held" | "healthy";

type StateInput = Pick<Program, "captured" | "restricted"> & { eligible?: boolean; marked?: boolean; favour?: boolean };

export function programState(p: StateInput, ended = false): ProgramState {
  if (p.captured) return "corrupted";
  const eligible = isEligible(p);
  if ((ended || p.favour === true) && eligible) return "favour";
  // The server's `marked` (or an older one's `restricted`), or any other
  // program its begin lets in (a restricted, marked one reads `marked: false`).
  if (isMarked(p) || eligible) return "marked";
  return p.restricted ? "held" : "healthy";
}

/** The choose card's heading, icon and status line. */
export function programStatus(p: StateInput, ended = false): { heading: string; icon: string; status: string } {
  switch (programState(p, ended)) {
    case "corrupted":
      return { heading: "Corrupted program detected", icon: "☣", status: "STATUS: CORRUPTED — requires reinstallation" };
    case "favour":
      return { heading: "Party favour unlocked", icon: "🎉", status: "STATUS: the night is over — anyone may play" };
    case "marked":
      return { heading: "Marked program detected", icon: "🚨", status: "STATUS: MARKED — marked for reinstallation" };
    case "held":
      // w26 (G2) UI copy: never names who holds it.
      return { heading: "Program held", icon: "⛔", status: "STATUS: RESTRICTED — held, not marked" };
    case "healthy":
      return { heading: "Program not marked", icon: "▣", status: "STATUS: healthy — not marked for reinstallation" };
  }
}

/** The choose card's line about the game: a party favour after the end,
 *  else what a reinstallation asks. */
export function programPitch(state: ProgramState): string {
  return state === "favour"
    ? "The night is over, so the reinstallation is a party favour: walk the virtual house and find Gerald, the golden duck, just for fun."
    : "To be reinstalled, a program must prove it can follow instructions: walk the virtual house and find Gerald, the golden duck.";
}

/** The starting screen's heading. */
export function startingHeading(state: ProgramState, name: string): string {
  return state === "favour" ? `Party favour for ${name}` : `Reinstalling ${name}`;
}

/** The scan screen's quick picks: up to `max` in the Internet, then up to
 *  `max` who may play (marked, or anyone after the end), each by name; the
 *  healthy and the director-held never. */
export function quickPicks(roster: readonly Program[], max = 8, ended = false): { corrupted: Program[]; marked: Program[] } {
  const byName = (a: Program, b: Program) => a.name.localeCompare(b.name);
  return {
    corrupted: roster.filter((p) => programState(p, ended) === "corrupted").sort(byName).slice(0, max),
    marked: roster
      .filter((p) => {
        const s = programState(p, ended);
        return s === "marked" || s === "favour";
      })
      .sort(byName)
      .slice(0, max),
  };
}

/** The second quick-pick list's legend. */
export function markedLegend(ended: boolean): string {
  return ended ? "Anyone may play — the night is over" : "Marked for reinstallation";
}

/** A failed begin, in the wizard's words: the server's own refusal for an
 *  unmarked program, never a crash or silent nothing. */
export function beginErrorText(status: number | null, message: string): string {
  if (status === 409 && message === NOT_MARKED_ERROR) return NOT_MARKED;
  if (status === 409) return "The story isn't running yet — start the event first.";
  if (status === 404) return "Unknown program — register on your phone first.";
  if (status === 503) return "The server has no house map.";
  if (status === 401 || status === 403) return "This device lost its access — set it up again (⚙).";
  return `Couldn't start the simulation — ${message}`;
}
