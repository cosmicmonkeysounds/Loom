// Show-night safety for the acceptance helpers that MUTATE an event (fire
// cues, set Night.*, end the night): they are for a REHEARSAL. The event
// server doesn't know rehearsal from live (that's the control plane's
// row), so the guard reads what a live show looks like from the mod view —
// a real crowd on the roster — and refuses unless `--force` is passed.
//
//   import { rehearsalGuard } from "./guard.ts";
//   await rehearsalGuard(base, ev, token, args);

/** More guests than a rehearsal's handful of test phones. */
export const LIVE_ROSTER = 8;

export async function rehearsalGuard(base: string, ev: string, token: string, args: string[]): Promise<void> {
  const r = await fetch(`${base}${ev}/api/state?role=mod&token=${encodeURIComponent(token)}`);
  if (!r.ok) throw new Error(`mod state → ${r.status}`);
  const { roster } = (await r.json()) as { roster?: unknown[] };
  const n = roster?.length ?? 0;
  if (n <= LIVE_ROSTER || args.includes("--force")) return;
  console.error(
    `REFUSED: this event has ${n} guests — it looks like the LIVE show, and this helper fires cues / sets the night's state.\n` +
      `Use the rehearsal's mod code (Run → Start rehearsal). If this really is a rehearsal, re-run with --force.`,
  );
  process.exit(2);
}
