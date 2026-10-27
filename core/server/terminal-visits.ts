// A wall terminal's visit floor (wave 28, gap 2b). The heart terminal shows
// only this visit's lines: those past the chat seq at the scan. Kept on the
// terminal's page alone, a reload mid-visit (the pass scanned again within
// seconds) floored at the reload and hid his earlier lines from this same
// visit. The server keeps the floor per guest + terminal (its label) and
// answers it from `/api/mod/impersonate` as `visitSeq`: a scan soon after
// the same terminal's last session for that guest ended (a reload, a blip)
// carries on the visit and its floor; anything later starts a new one.
// Memory only: a restart forgets it (the terminal falls back to the scan's
// own seq), and every lifecycle restart clears it.

/** A re-scan within this long of the last session's end carries on the visit (ms). */
export const VISIT_RESUME_MS = 3 * 60_000;
/** A session whose end never arrived (the pagehide post lost) carries on only this long after its scan (ms). */
export const VISIT_OPEN_MAX_MS = 15 * 60_000;

interface Visit {
  /** The newest chat seq when the visit began: its lines are past it. */
  seq: number;
  /** When it was (last) scanned. */
  at: number;
  /** When its session last ended (null: still open, or the end was lost). */
  endedAt: number | null;
}

export class TerminalVisits {
  private readonly visits = new Map<string, Visit>();

  private static key(guestId: string, label: string): string {
    return `${guestId}\u0000${label}`;
  }

  /** A pass scanned at `label`: the visit's floor (a carried-on visit's, else `newestSeq`). */
  begin(guestId: string, label: string, newestSeq: number, now: number): number {
    const k = TerminalVisits.key(guestId, label);
    const was = this.visits.get(k);
    const carries = was !== undefined && (was.endedAt !== null ? now - was.endedAt <= VISIT_RESUME_MS : now - was.at <= VISIT_OPEN_MAX_MS);
    const seq = carries ? was!.seq : newestSeq;
    this.visits.set(k, { seq, at: now, endedAt: null });
    return seq;
  }

  /** That terminal's session for the guest ended (`/api/mod/impersonate/end`). */
  end(guestId: string, label: string, now: number): void {
    const v = this.visits.get(TerminalVisits.key(guestId, label));
    if (v !== undefined) v.endedAt = now;
  }

  /** A lifecycle restart (reset, reload, go live): every visit starts over. */
  clear(): void {
    this.visits.clear();
  }
}
