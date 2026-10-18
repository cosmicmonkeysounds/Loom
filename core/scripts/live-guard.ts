// The live guard's pure decisions, shared by every tool that writes to or
// restarts an event: the acceptance scripts (`scripts/accept/live-guard.ts`
// re-exports these and adds the terminal y/N) and `sync-example.ts` (what
// `scripts/sync-show.sh` runs), which must never reload a live show.
//
// "Live" here means the roster holds a real guest — anyone who is neither a
// director's persona (`p-…` ids, `/api/mod/persona`) nor one of the load
// test's own "K32 Bot …" registrations. A rehearsal event full of personas
// passes; one real phone on the roster refuses unless the caller passed
// `--i-know-this-is-live`. Plain TypeScript (no deps), so `node` runs it
// straight from the acceptance scripts.

export interface GuardRow {
  id: string;
  name: string;
}

export const LIVE_OVERRIDE = "i-know-this-is-live";

/** Roster rows that are real participants (not personas, not our bots). */
export function realGuests(roster: readonly GuardRow[] | undefined): GuardRow[] {
  return (roster ?? []).filter((r) => !r.id.startsWith("p-") && !/^K32 Bot /u.test(r.name));
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/** The pure decision: refuse when real guests are present without the override. */
export function judge(roster: readonly GuardRow[] | undefined, override: boolean, action: string): GuardVerdict {
  const real = realGuests(roster);
  if (real.length === 0 || override) return { ok: true };
  return {
    ok: false,
    reason:
      `refusing to ${action}: this event has ${real.length} real guest(s) on the roster (${guestNames(real)}). ` +
      `It looks LIVE. Use a rehearsal event's MOD code, or pass --${LIVE_OVERRIDE} if you really mean it.`,
  };
}

/** Up to five names, then "…". */
export function guestNames(real: readonly GuardRow[]): string {
  return real.slice(0, 5).map((r) => r.name).join(", ") + (real.length > 5 ? ", …" : "");
}

/**
 * May a story sync reload this event? A reload is `EventRuntime.restart()`:
 * every guest token cleared, the journal reset. A preview (the rehearsal
 * run) always may; a `live` event only while no real guest is on its
 * roster, or with the override. (OCT31 §3: never after doors.)
 */
export function reloadVerdict(opts: { mode: string; roster: readonly GuardRow[] | undefined; override: boolean }): GuardVerdict {
  if (opts.mode !== "live" || opts.override) return { ok: true };
  const real = realGuests(opts.roster);
  if (real.length === 0) return { ok: true };
  return {
    ok: false,
    reason:
      `live event with ${real.length} real guest(s) (${guestNames(real)}): the project's files are saved, ` +
      `the event's snapshot is untouched and it was NOT reloaded — ` +
      `a reload signs every guest out and wipes the night's journal. Push draft from Run (typed confirm), ` +
      `or re-run with --${LIVE_OVERRIDE}`,
  };
}
