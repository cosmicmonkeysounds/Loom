// The heart terminal spec's front door: the live guard on this terminal
// (y/N), then heart.spec.ts through the editor's Playwright.
//
//   node --experimental-strip-types --no-warnings scripts/sim/heart.ts --base http://127.0.0.1:7391 --code <mod> [--shots /tmp/heart] [--yes] [--headed]
//
// It refuses a roster with a real guest (exit 3) unless
// --i-know-this-is-live, and asks y/N before touching any server that is
// not a scratch server on this laptop (port 7000, your own dev server,
// still asks) unless --yes. Needs a FRESH night (a fresh scratch server):
// the spec registers two programs and plays the heart.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LIVE_OVERRIDE, liveGuard } from "../accept/live-guard.ts";
import { Client } from "./lib/http.ts";
import { Recorder } from "./lib/report.ts";
import { envServerNotice, isScratch, resolveBase } from "./lib/safety.ts";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const base = resolveBase(arg("base"), process.env["LOOM_SERVER"]) ?? "";
const code = arg("code") ?? process.env["LOOM_MOD_CODE"] ?? "";
if (base === "" || code === "") {
  console.error("usage: node --experimental-strip-types scripts/sim/heart.ts --base <url> --code <MOD code> [--shots <dir>] [--yes] [--headed]");
  process.exit(2);
}
const notice = envServerNotice(arg("base"), process.env["LOOM_SERVER"], base);
if (notice !== null) console.log(notice);

const http = new Client(base, new Recorder());
const r = await http.call<{ eventId?: string }>("POST", "/api/resolve-code", { body: { code }, root: true });
if (r.status === 200 && r.json.eventId !== undefined && r.json.eventId !== "default") http.scope = `/e/${encodeURIComponent(r.json.eventId)}`;
const login = await http.post<{ token?: string }>("/api/mod/login", { passcode: code });
if (login.status !== 200 || login.json.token === undefined) {
  console.error(`  ✘ mod login → ${login.status}`);
  process.exit(3);
}
const st = await http.get<{ title?: string; roster?: Array<{ id: string; name: string }> }>("/api/state?role=mod", login.json.token);
await liveGuard({ title: st.json.title, where: `${base}${http.scope}`, roster: st.json.roster, action: "drive the heart terminal (two programs, a heart visit)", argv: process.argv, local: isScratch(base) });

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const res = spawnSync("pnpm", ["--filter", "loom-app", "exec", "playwright", "test", "-c", "../scripts/sim/playwright.config.ts", "heart", ...(argv.includes("--headed") ? ["--headed"] : [])], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SIM_BASE: base,
    SIM_MOD_CODE: code,
    SIM_SHOTS: arg("shots") ?? process.env["SIM_SHOTS"] ?? join(root, "editor/test-results/heart"),
    // The guard above passed (y/N answered, or a scratch server): the spec's own check agrees.
    SIM_YES: "1",
    ...(argv.includes(`--${LIVE_OVERRIDE}`) ? { SIM_LIVE: "1" } : {}),
  },
});
process.exit(res.status ?? 1);
