// What trabolta-load.ts may touch, decided before it logs in. Pure, so
// `test/load.test.ts` pins every refusal (the driver prints the reason and
// exits; nothing here exits).
//
// Each safety lifts on its own flag and none lifts another. The driver once
// had one (`--i-know-this-is-live`) that lifted the off-laptop refusal, the
// port 7000 refusal and the real-guest refusal together, and its README
// taught it for an ordinary second run on a scratch server: the habit that
// would also have let it press Power On, the cue chain and 50 bots into the
// VPS with real guests on. Now:
//
//   --allow-remote      a server off this laptop (the off-laptop refusal only)
//   --allow-dev-server  port 7000 here, the user's own loom_dev (that refusal only)
//   --rerun             a scratch server whose only guests are this driver's
//                       own bots from an earlier run (the guard looks past
//                       them; anyone else still refuses)
//
// The real-guest refusal has no override here (`--i-know-this-is-live` is
// refused outright: the load driver never runs over real guests), and off a
// scratch server the guard always asks y/N (`--yes` counts only on one).

import { LIVE_OVERRIDE, guestNames, realGuests, type GuardRow } from "../../accept/live-guard.ts";
import { isLocal } from "./http.ts";
import { isDevServer, isScratch } from "./safety.ts";

export interface LoadSafetyFlags {
  allowRemote: boolean;
  allowDevServer: boolean;
  rerun: boolean;
  liveOverride: boolean;
}

export const LOAD_SAFETY_FLAGS = { allowRemote: "allow-remote", allowDevServer: "allow-dev-server", rerun: "rerun" } as const;

export function safetyFlags(argv: readonly string[]): LoadSafetyFlags {
  return {
    allowRemote: argv.includes(`--${LOAD_SAFETY_FLAGS.allowRemote}`),
    allowDevServer: argv.includes(`--${LOAD_SAFETY_FLAGS.allowDevServer}`),
    rerun: argv.includes(`--${LOAD_SAFETY_FLAGS.rerun}`),
    liveOverride: argv.includes(`--${LIVE_OVERRIDE}`),
  };
}

/** Why the run may not start against `base`, or null when it may. */
export function loadRefusal(base: string, f: LoadSafetyFlags): string | null {
  if (f.liveOverride) return `--${LIVE_OVERRIDE} is not taken here: the load driver never runs over real guests. A second run on a scratch server is --${LOAD_SAFETY_FLAGS.rerun}.`;
  if (!isLocal(base) && !f.allowRemote) return `${base} is not this laptop: the load driver runs against a scratch server only (--${LOAD_SAFETY_FLAGS.allowRemote} for a rehearsal server elsewhere; the real-guest guard and its y/N still apply).`;
  if (isDevServer(base) && !f.allowDevServer) return `port 7000 on this laptop is your own dev server (loom_dev): start a scratch server on another port (scripts/sim/README.md), or --${LOAD_SAFETY_FLAGS.allowDevServer}.`;
  if (f.rerun && !isScratch(base)) return `--${LOAD_SAFETY_FLAGS.rerun} is for a scratch server on this laptop only (not port 7000, not a server elsewhere).`;
  return null;
}

/** A guest this driver registers: `Load 01`… (`loadNames`), or one of the
 *  battery's `as.name`s. */
export function isOwnBot(name: string, batteryNames: ReadonlySet<string>, prefix = "Load"): boolean {
  const n = name.trim();
  return new RegExp(`^${prefix} \\d{2,}$`, "u").test(n) || batteryNames.has(n.toLowerCase());
}

/**
 * What the live guard is handed. With `--rerun` (scratch only, refused
 * elsewhere by `loadRefusal`) the roster it judges leaves out this
 * driver's own bots, so an earlier run's `Load 01`… don't read as real
 * guests while anyone else still does. Off a scratch server `--yes` is
 * dropped, so the guard always asks; `--i-know-this-is-live` never reaches
 * it (refused before).
 */
export function guardInput(
  base: string,
  argv: readonly string[],
  roster: readonly GuardRow[] | undefined,
  batteryNames: ReadonlySet<string>,
): { roster: GuardRow[] | undefined; argv: string[]; local: boolean; skipped: number; refusal: string | null } {
  const scratch = isScratch(base);
  const rerun = argv.includes(`--${LOAD_SAFETY_FLAGS.rerun}`) && scratch;
  const kept = roster === undefined ? undefined : rerun ? roster.filter((r) => !isOwnBot(r.name, batteryNames)) : [...roster];
  const out = argv.filter((a) => a !== `--${LIVE_OVERRIDE}` && (scratch || a !== "--yes"));
  // Refused here, in this tool's words, before the shared guard would point
  // at the live override this tool does not take.
  const real = realGuests(kept);
  const refusal =
    real.length === 0
      ? null
      : `refusing to run the Trabolta load driver: ${real.length} guest(s) on the roster ${rerun ? "who are not this driver's bots " : ""}(${guestNames(real)}). ` +
        (scratch && !rerun ? `If they are an earlier run's bots, --${LOAD_SAFETY_FLAGS.rerun}; else a fresh scratch server.` : "It runs only where no real guest is on.");
  return { roster: kept, argv: out, local: scratch, skipped: (roster?.length ?? 0) - (kept?.length ?? 0), refusal };
}

/** Flags that take a value, given without one (`--fake-worker` at the end
 *  of the line, or followed by another flag). A missing value used to fall
 *  back silently: `--fake-worker` with no number turned the fake off and
 *  the run measured two minutes of hold lines. Also any that is not a
 *  number where a number is due. */
export function valueProblems(argv: readonly string[], valued: readonly string[], numeric: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const name of valued) {
    const i = argv.indexOf(`--${name}`);
    if (i < 0) continue;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) out.push(`--${name} needs a value`);
    else if (numeric.has(name) && !Number.isFinite(Number(v))) out.push(`--${name} needs a number (got ${JSON.stringify(v.slice(0, 20))})`);
  }
  return out;
}
