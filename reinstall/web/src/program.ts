//! What the wizard says about a program before Play here — pure: corrupted
//! (in the Internet), marked (wave 4's restricted state: sent to the
//! Internet, not there yet — Play here's `reinstallation begun` captures
//! them, so the wizard shows them as such) or healthy. And the scan
//! screen's quick picks: the programs in the Internet now, then the marked
//! ones on their way, so the operator never has to type a name.

/** A candidate as the tablet reads it (`GET /api/mod/spatial/candidates`). */
export interface Program {
  id: string;
  name: string;
  captured: boolean;
  /** Marked for reinstallation (restricted) and not captured yet. */
  restricted: boolean;
  location: string | null;
}

export type ProgramState = "corrupted" | "marked" | "healthy";

export function programState(p: Pick<Program, "captured" | "restricted">): ProgramState {
  if (p.captured) return "corrupted";
  return p.restricted ? "marked" : "healthy";
}

/** The choose card's heading, icon and status line. */
export function programStatus(p: Pick<Program, "captured" | "restricted">): { heading: string; icon: string; status: string } {
  switch (programState(p)) {
    case "corrupted":
      return { heading: "Corrupted program detected", icon: "☣", status: "STATUS: CORRUPTED — requires reinstallation" };
    case "marked":
      return { heading: "Marked program detected", icon: "🚨", status: "STATUS: MARKED — Play here begins the reinstallation" };
    case "healthy":
      return { heading: "Program detected", icon: "▣", status: "STATUS: healthy — Gerald is waiting anyway" };
  }
}

/** The scan screen's quick picks: up to `max` in the Internet, then up to `max` marked, each by name. */
export function quickPicks(roster: readonly Program[], max = 8): { corrupted: Program[]; marked: Program[] } {
  const byName = (a: Program, b: Program) => a.name.localeCompare(b.name);
  return {
    corrupted: roster.filter((p) => programState(p) === "corrupted").sort(byName).slice(0, max),
    marked: roster.filter((p) => programState(p) === "marked").sort(byName).slice(0, max),
  };
}
