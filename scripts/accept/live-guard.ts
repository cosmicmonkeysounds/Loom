// The guard every acceptance script that WRITES to an event runs first
// (k32-load.ts, K-22.ts --steps): a pasted live MOD code must never put
// bots, probe lines or a restart into the real show.
//
// "Live" here means the roster holds a real guest — anyone who is neither a
// director's persona (`p-…` ids, `/api/mod/persona`) nor one of the load
// test's own "K32 Bot …" registrations. A rehearsal event full of personas
// passes; one real phone on the roster refuses unless the caller passed
// `--i-know-this-is-live`. On top of that the script names the event and
// asks y/N (skipped by `--yes`, or against localhost).

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
  const names = real.slice(0, 5).map((r) => r.name).join(", ");
  return {
    ok: false,
    reason:
      `refusing to ${action}: this event has ${real.length} real guest(s) on the roster (${names}${real.length > 5 ? ", …" : ""}). ` +
      `It looks LIVE. Use a rehearsal event's MOD code, or pass --${LIVE_OVERRIDE} if you really mean it.`,
  };
}

/** Ask y/N on the terminal; a non-interactive run must pass --yes. */
export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/iu.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Run the guard: print the event, refuse a live-looking one, then confirm.
 * Exits the process (code 3) on refusal or a "no".
 */
export async function liveGuard(opts: {
  title: string | undefined;
  where: string;
  roster: readonly GuardRow[] | undefined;
  action: string;
  argv?: readonly string[];
  local?: boolean;
}): Promise<void> {
  const argv = opts.argv ?? process.argv;
  const override = argv.includes(`--${LIVE_OVERRIDE}`);
  const verdict = judge(opts.roster, override, opts.action);
  const real = realGuests(opts.roster).length;
  console.log(`  event: "${opts.title ?? "(untitled)"}" at ${opts.where} — ${opts.roster?.length ?? 0} on the roster, ${real} real guest(s)`);
  if (!verdict.ok) {
    console.error(`  ✘ ${verdict.reason}`);
    process.exit(3);
  }
  if (argv.includes("--yes") || opts.local === true) return;
  if (!(await confirm(`  → ${opts.action} on "${opts.title ?? opts.where}"? REHEARSAL EVENTS ONLY.`))) {
    console.error("  aborted (pass --yes to skip this question in a script).");
    process.exit(3);
  }
}
