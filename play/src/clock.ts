//! The story clock's small helpers (wave 13 fix round), moved out of
//! `director.tsx` so the guest's tray clock and countdown strip don't pull
//! the whole director cue sheet into a guest's first load. `director.tsx`
//! re-exports every name (frozen signatures, CONTRACTS §0).

/** The story time now from a snapshot's clock, the wall time it arrived and
 *  the wall time now — held still while the clock is stopped. */
export function storyNow(clock: number | undefined, receivedAt: number, now: number, runs = true): number | null {
  if (clock === undefined || !Number.isFinite(clock)) return null;
  return runs ? clock + Math.max(0, now - receivedAt) : clock;
}

/** Seconds as `37:52`, or `1:02:03` past the hour. */
export function formatLeft(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Under this many seconds a countdown reads red. */
export const URGENT_S = 60;
