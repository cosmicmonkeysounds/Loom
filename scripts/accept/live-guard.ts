// The guard every acceptance script that WRITES to an event runs first
// (k32-load.ts, K-22.ts --steps): a pasted live MOD code must never put
// bots, probe lines or a restart into the real show.
//
// The decisions (what counts as a real guest, the refusal) live in
// `core/scripts/live-guard.ts`, shared with `sync-example.ts` / sync-show;
// this file adds the terminal side: name the event, refuse a live-looking
// one, then ask y/N (skipped by `--yes`, or against localhost).

import { judge, LIVE_OVERRIDE, realGuests, type GuardRow } from "../../core/scripts/live-guard.ts";

export { guestNames, judge, LIVE_OVERRIDE, realGuests, reloadVerdict } from "../../core/scripts/live-guard.ts";
export type { GuardRow, GuardVerdict } from "../../core/scripts/live-guard.ts";

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
