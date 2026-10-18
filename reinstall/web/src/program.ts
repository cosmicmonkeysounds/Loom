//! What the wizard says about a program before Play here — pure: corrupted
//! (in the Internet), restricted (wave 4's restricted state, not captured
//! yet) or healthy. The server's `restricted` is true both for a program
//! the story marked (sent to the Internet: Play here's `reinstallation
//! begun` captures them) and for one a director restricted from the
//! Inspector (which Play here does not capture), so the wizard says only
//! what holds for both. And the scan screen's quick picks: the programs in
//! the Internet now, then the restricted ones (the marked on their way), so
//! the operator never has to type a name.

/** A candidate as the tablet reads it (`GET /api/mod/spatial/candidates`). */
export interface Program {
  id: string;
  name: string;
  captured: boolean;
  /** Restricted (marked by the story, or held by a director) and not captured yet. */
  restricted: boolean;
  location: string | null;
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
      return { heading: "Restricted program detected", icon: "🚨", status: "STATUS: RESTRICTED — if marked, Play here begins the reinstallation" };
    case "healthy":
      return { heading: "Program detected", icon: "▣", status: "STATUS: healthy — Gerald is waiting anyway" };
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
