// The live guard for the bash acceptance helpers that WRITE to an event
// (K-17.sh --fire, K-18.sh --say/--beat/--fire/--mute, …). Same rule as
// `live-guard.ts` (k32-load.ts, K-22.ts): a roster with a real guest refuses
// unless `--i-know-this-is-live`; otherwise the event is named and y/N asked
// (`--yes` skips; localhost never asks). Exit 0 = go, 3 = refused / aborted.
//
//   node --no-warnings scripts/accept/guard-cli.ts --base <url> --event <id> \
//        --token <mod token> --action "fire call_to_the_desktop" [--yes] [--i-know-this-is-live]
//
// Bash callers source `guard.sh`, which strips those two flags off "$@" and
// passes them through.

import { liveGuard, type GuardRow } from "./live-guard.ts";

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v === undefined) {
    console.error(`guard-cli: missing --${name}`);
    process.exit(2);
  }
  return v;
}

const base = arg("base").replace(/\/$/u, "");
const event = arg("event");
const token = arg("token");
const action = arg("action");
const scope = event === "" || event === "default" ? "" : `/e/${encodeURIComponent(event)}`;

const st = await fetch(`${base}${scope}/api/state?role=mod`, { headers: { "x-loom-token": token } });
if (!st.ok) {
  console.error(`  ✘ mod state → ${st.status}; refusing to ${action} blind`);
  process.exit(3);
}
const view = (await st.json()) as { title?: string; roster?: GuardRow[] };
await liveGuard({
  title: view.title,
  where: `${base}${scope}`,
  roster: view.roster,
  action,
  local: /^https?:\/\/(localhost|127\.|\[::1\])/u.test(base),
});
