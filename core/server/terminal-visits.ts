// A wall terminal's visit floor (wave 28, gap 2b). The heart terminal shows
// only this visit's lines: those past the chat seq at the scan. Kept on the
// terminal's page alone, a reload mid-visit (the pass scanned again within
// seconds) floored at the reload and hid his earlier lines from this same
// visit. The server keeps the floor per guest + terminal (its label) and
// answers it from `/api/mod/impersonate` as `visitSeq`: a scan soon after
// the same terminal's last session for that guest ended (a reload, a blip)
// carries on the visit and its floor; anything later starts a new one.
// Only the page going away (its pagehide end, `resumable: true`) leaves a
// visit to carry on: a leash end (thrown out, timed out, done, left) is a
// real end, and the next scan floors fresh even seconds later. A carried
// scan keeps the visit's first open time, so a lost end never stretches the
// open window past VISIT_OPEN_MAX_MS from the visit's start.
// Memory only: a restart forgets it (the terminal falls back to the scan's
// own seq), and every lifecycle restart clears it.

/** A re-scan within this long of the last session's end carries on the visit (ms). */
export const VISIT_RESUME_MS = 3 * 60_000;
/** A session whose end never arrived (the pagehide post lost) carries on only this long after the visit's first scan (ms). */
export const VISIT_OPEN_MAX_MS = 15 * 60_000;

interface Visit {
  /** The newest chat seq when the visit began: its lines are past it. */
  seq: number;
  /** When the visit was first scanned (a carried scan keeps it). */
  openedAt: number;
  /** When its session last ended resumably (null: still open, or the end was lost). */
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
    const carries = was !== undefined && (was.endedAt !== null ? now - was.endedAt <= VISIT_RESUME_MS : now - was.openedAt <= VISIT_OPEN_MAX_MS);
    const visit: Visit = carries ? { seq: was!.seq, openedAt: was!.openedAt, endedAt: null } : { seq: newestSeq, openedAt: now, endedAt: null };
    this.visits.set(k, visit);
    return visit.seq;
  }

  /** That terminal's session for the guest ended (`/api/mod/impersonate/end`).
   *  `resumable`: the page went away (a reload), so a re-scan soon after
   *  carries on; otherwise the visit is over and forgotten. */
  end(guestId: string, label: string, now: number, resumable: boolean): void {
    const k = TerminalVisits.key(guestId, label);
    if (!resumable) {
      this.visits.delete(k);
      return;
    }
    const v = this.visits.get(k);
    if (v !== undefined) v.endedAt = now;
  }

  /** A lifecycle restart (reset, reload, go live): every visit starts over. */
  clear(): void {
    this.visits.clear();
  }
}
