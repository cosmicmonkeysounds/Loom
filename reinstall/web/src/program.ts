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

/** A candidate as the tablet reads it (`GET /api/mod/spatial/candidates`). */
export interface Program {
  id: string;
  name: string;
  captured: boolean;
  /** Restricted (marked by the story, or held by a director) and not captured yet. */
  restricted: boolean;
  /** Captured or marked: the server's begin lets them in (wave 16). */
  eligible: boolean;
  location: string | null;
}

/** The server's 409 for a program neither captured nor marked. */
export const NOT_MARKED_ERROR = "not marked for reinstallation";

/** What the wizard says about a program it may not begin. */
export const NOT_MARKED = "Not marked — an Antivirus marks programs for reinstallation.";

/** May the tablet begin this program? (A row from a server older than
 *  wave 16 has no `eligible`: captured or restricted, the same rule.) */
export function isEligible(p: Pick<Program, "captured" | "restricted"> & { eligible?: boolean }): boolean {
  return p.eligible ?? (p.captured || p.restricted);
}

export type ProgramState = "corrupted" | "restricted" | "healthy";

export function programState(p: Pick<Program, "captured" | "restricted">): ProgramState {
  if (p.captured) return "corrupted";
  return p.restricted ? "restricted" : "healthy";
}

/** The choose card's heading, icon and status line. */
export function programStatus(p: Pick<Program, "captured" | "restricted">): { heading: string; icon: string; status: string } {
  switch (programState(p)) {
    case "corrupted":
      return { heading: "Corrupted program detected", icon: "☣", status: "STATUS: CORRUPTED — requires reinstallation" };
    case "restricted":
      return { heading: "Restricted program detected", icon: "🚨", status: "STATUS: RESTRICTED — marked for reinstallation" };
    case "healthy":
      return { heading: "Program not marked", icon: "▣", status: "STATUS: healthy — not marked for reinstallation" };
  }
}

/** The scan screen's quick picks: up to `max` in the Internet, then up to `max` restricted, each by name. */
export function quickPicks(roster: readonly Program[], max = 8): { corrupted: Program[]; restricted: Program[] } {
  const byName = (a: Program, b: Program) => a.name.localeCompare(b.name);
  return {
    corrupted: roster.filter((p) => programState(p) === "corrupted").sort(byName).slice(0, max),
    restricted: roster.filter((p) => programState(p) === "restricted").sort(byName).slice(0, max),
  };
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
