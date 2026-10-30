#!/usr/bin/env node
// A quick test server for the headset: a scratch event server on this
// computer (dead database, a fresh state dir, the show's story from disk,
// event `default`), its doors open and a few programs registered, one of them
// captured so the lobby has a tile to pick. The headset reaches it over USB
// (`adb reverse`), so its server is http://127.0.0.1:<port> and no Wi-Fi or
// firewall is involved. Build an APK for it with
// `tools\quest-win.ps1 -TestServer -Install -Launch` (no intro, this server's
// passcode baked in).
//
//   node reinstall/vr/tools/test-server.mjs [--port 7642] [--no-adb] [--verbose]
//   node reinstall/vr/tools/test-server.mjs --init    # only write the config
//
// The port and the passcodes live in reinstall/vr/build/test-server.json
// (git-ignored; made on first use, shared with quest-win.ps1). Ctrl+C stops
// the server. Never the VPS, never :7000 (your own dev server).
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vr = resolve(here, "..");
const core = resolve(vr, "..", "..", "core");
const configPath = join(vr, "build", "test-server.json");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
};

// The programs it registers: the first is captured (a tile in the lobby).
const PROGRAMS = ["Netscape Navigator", "WinZip", "Minesweeper", "Notepad", "Solitaire"];

function secret() {
  return randomBytes(9).toString("base64url").replace(/[-_]/g, "x");
}

/** build/test-server.json: made once, kept so a built APK keeps working. */
export function testConfig(path = configPath) {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const c = { port: 7642, mod: secret(), event: secret(), prime: secret() };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(c, null, 2) + "\n");
  return c;
}

function adbPath() {
  const home = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  const exe = process.platform === "win32" ? "adb.exe" : "adb";
  return home ? join(home, "platform-tools", exe) : exe;
}

/** The headset's 127.0.0.1:port → this computer's, over USB. */
function adbReverse(port) {
  const r = spawnSync(adbPath(), ["reverse", `tcp:${port}`, `tcp:${port}`], { encoding: "utf8" });
  if (r.status === 0) console.log(`test-server: adb reverse tcp:${port} (the headset's 127.0.0.1:${port} is this computer)`);
  else console.log(`test-server: adb reverse failed (${(r.stderr || r.error?.message || "").trim()}): plug the headset in and run again, or adb reverse tcp:${port} tcp:${port}`);
}

async function call(base, method, path, body, token) {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { "x-loom-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try {
    json = await r.json();
  } catch {}
  return { status: r.status, json };
}

async function waitHealthy(base, child) {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`the server exited (${child.exitCode})`);
    try {
      const r = await fetch(base + "/api/mod/spatial/candidates");
      // 401/403 = up and asking for a mod; 409 = up, story still loading.
      if (r.status !== 409 && r.status < 500) return;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error("the server did not come up in 2 minutes");
}

async function seed(base, c) {
  const login = await call(base, "POST", "/api/mod/login", { passcode: c.mod });
  if (login.status !== 200) throw new Error(`mod login → ${login.status}`);
  const mod = login.json.token;
  const start = await call(base, "POST", "/api/mod/start", {}, mod);
  if (start.status !== 200) throw new Error(`open the doors → ${start.status}`);
  const made = [];
  for (const name of PROGRAMS) {
    const r = await call(base, "POST", "/api/guest/register", { passcode: c.event, name });
    if (r.status === 200) made.push({ id: r.json.id, name: r.json.name ?? name });
    else console.log(`test-server: ${name} not registered (${r.status} ${r.json.error ?? ""})`);
  }
  if (made.length === 0) throw new Error("no program registered");
  const set = await call(base, "POST", "/api/mod/set", { id: made[0].id, field: "captured", value: true }, mod);
  if (set.status !== 200) throw new Error(`capture ${made[0].name} → ${set.status}`);
  const list = await call(base, "GET", "/api/mod/spatial/candidates", undefined, mod);
  const rows = Array.isArray(list.json.players) ? list.json.players : [];
  const tiles = rows.filter((p) => p.captured || p.restricted || p.marked).map((p) => p.name);
  console.log(`test-server: doors open; programs ${made.map((p) => p.name).join(", ")}; captured ${made[0].name}`);
  console.log(`test-server: lobby tiles: ${tiles.join(", ") || "(none)"}`);
}

async function main() {
  const c = testConfig();
  if (flag("--init")) return; // quest-win.ps1 -TestServer: just the shared config
  const port = Number(opt("--port") ?? c.port);
  if (port === 7000) throw new Error("not :7000 (your own dev server)");
  const base = `http://127.0.0.1:${port}`;
  const state = mkdtempSync(join(tmpdir(), "loom-vr-test-"));
  const env = {
    ...process.env,
    LOOM_PORT: String(port),
    LOOM_HOST: "127.0.0.1",
    LOOM_STATE_DIR: state,
    LOOM_MOD_PASS: c.mod,
    LOOM_EVENT_PASS: c.event,
    LOOM_PRIME_PASS: c.prime,
    LOOM_WIKI: "off",
    LOOM_DB_WAIT: "off",
    DATABASE_URL: "postgres://127.0.0.1:1/none",
    LOOM_RL_REGISTER: "400",
  };
  console.log(`test-server: starting ${base} (state ${state})`);
  const child = process.platform === "win32" ? spawn("pnpm serve", { cwd: core, env, stdio: ["ignore", "pipe", "pipe"], shell: true }) : spawn("pnpm", ["serve"], { cwd: core, env, stdio: ["ignore", "pipe", "pipe"] });
  const quiet = flag("--verbose") ? null : [];
  const pipe = (s, to) => s.on("data", (d) => (quiet ? quiet.push(d) : to.write(d)));
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  const stop = () => {
    if (child.exitCode === null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  try {
    await waitHealthy(base, child);
    await seed(base, c);
  } catch (e) {
    if (quiet) process.stderr.write(Buffer.concat(quiet));
    stop();
    throw e;
  }
  if (!flag("--no-adb")) adbReverse(port);
  console.log(`test-server: ready at ${base}. Ctrl+C stops it.`);
  child.on("exit", (code) => {
    console.log(`test-server: the server exited (${code})`);
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`test-server: ${e.message}`);
    process.exit(1);
  });
}
