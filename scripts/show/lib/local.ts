//! The local half of `showctl preflight <machine>`: what one show computer
//! must have running before the doors, checked on that computer.
//!
//! Four machines (the show's final list, 2026-10-24):
//!   - `macbook`    John's MacBook (macOS): Ollama + stagehand `agents`
//!                  (Trabolta), ship / sync-show / showbackup, a Run console;
//!                  the sound router + the MOTU 828x only as the fallback
//!                  (`--router macbook`).
//!   - `desktop`    John's Desktop (Windows): the Chrome kiosk TV, Mosquitto
//!                  (1883 loopback + 1884 LAN with credentials),
//!                  Zigbee2MQTT on the CC2652P, stagehand `show` + `lights`
//!                  and, by default (2026-10-27), the sound router `audio`
//!                  on the MOTU 828x.
//!   - `serverroom` Steph's laptop: Chrome on the server-room terminal with
//!                  the Grand Central M4 on USB (door sensor + patch bay).
//!   - `tent`       John's old laptop: the tent terminal (`view=reinstall`).
//!
//! Every probe goes through `Probe`, so the rules are tested on a fake
//! machine. Commands run with `execFile` (no shell), each with a timeout;
//! a missing program is a finding, never a crash. Nothing here reads a
//! secret: `laptop.yaml` is scanned for its `mind_mode:` line only, and
//! URLs are printed with a `<mod>` placeholder, never the code.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import type { Check, Level } from "./ui.ts";

/** The machines `preflight` knows. */
export const MACHINES = ["macbook", "desktop", "serverroom", "tent"] as const;
export type Machine = (typeof MACHINES)[number];

/** Where the sound router (stagehand `audio` + the MOTU) runs tonight:
 *  the Desktop by default, the MacBook as the fallback (`--router macbook`). */
export const ROUTER_HOSTS = ["desktop", "macbook"] as const;
export type RouterHost = (typeof ROUTER_HOSTS)[number];

/** What a command answered (`missing`: the program isn't installed). */
export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  missing?: boolean;
}

/** Everything a local check may ask of the machine (fakeable). */
export interface Probe {
  platform: string;
  env: Record<string, string | undefined>;
  /** The repo root (for `stagehand/`, `scripts/ops/`). */
  root: string;
  run(cmd: string, args: readonly string[], timeoutMs?: number): Promise<RunResult>;
  /** Can a TCP connection be opened? */
  port(host: string, port: number, timeoutMs?: number): Promise<boolean>;
  /** GET a URL: status, body and its Content-Security-Policy, or null when nothing answers. */
  http(url: string, timeoutMs?: number): Promise<{ status: number; body: string; csp?: string | null } | null>;
  exists(path: string): boolean;
  readFile(path: string): string | null;
  /** The current user's uid (launchd's `gui/<uid>` domain); null on Windows. */
  uid(): number | null;
}

/** The real machine. */
export function realProbe(root: string): Probe {
  return {
    platform: process.platform,
    env: process.env,
    root,
    run: (cmd, args, timeoutMs = 15_000) =>
      new Promise((resolve) => {
        execFile(cmd, [...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { code?: unknown }) | null;
          if (e && e.code === "ENOENT") resolve({ code: null, stdout: "", stderr: "", missing: true });
          else resolve({ code: e ? (typeof e.code === "number" ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
        });
      }),
    port: (host, port, timeoutMs = 2_000) =>
      new Promise((resolve) => {
        const s = connect({ host, port });
        const done = (ok: boolean) => {
          s.destroy();
          resolve(ok);
        };
        s.setTimeout(timeoutMs, () => done(false));
        s.once("connect", () => done(true));
        s.once("error", () => done(false));
      }),
    http: async (url, timeoutMs = 3_000) => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        return { status: r.status, body: await r.text(), csp: r.headers.get("content-security-policy") };
      } catch {
        return null;
      }
    },
    exists: (p) => existsSync(p),
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
    uid: () => (typeof process.getuid === "function" ? process.getuid() : null),
  };
}

const row = (name: string, level: Level, detail: string, read: string): Check => ({ name, level, detail, read });

/** The voice model Trabolta runs on (stagehand `laptop.yaml`). */
export const VOICE_MODEL = "gpt-oss:20b";
/** The classic mind's orchestrator: never needed under `mind_mode: new`. */
export const ORCHESTRATOR_HINT = "qwen";
/** stagehand's launchd labels (`stagehand/src/stagehand/launchd.py`). */
export const LAUNCHD_PREFIX = "com.mapsandducks.stagehand";
/** Web Serial (the M4 bridge) shipped in Chrome 89. */
export const WEB_SERIAL_CHROME = 89;
/** The Adafruit USB vendor id (the Grand Central M4). */
export const ADAFRUIT_VID = "239A";

/** A Chrome `--version` line → its major version, or null. */
export function chromeMajor(text: string): number | null {
  const m = /(?:Chrome|Chromium)\D*(\d+)\.\d+/u.exec(text) ?? /\bversion\s+REG_SZ\s+(\d+)\./iu.exec(text);
  return m ? Number(m[1]) : null;
}

/** `launchctl print gui/<uid>/<label>` → running / loaded / not loaded. */
export function launchdState(r: RunResult): "running" | "loaded" | "absent" {
  if (r.code !== 0) return "absent";
  return /^\s*state = running/mu.test(r.stdout) ? "running" : "loaded";
}

/** A `powercfg /query` block's AC setting index (seconds; 0 = never). */
export function powercfgAc(text: string): number | null {
  const m = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/iu.exec(text);
  return m ? parseInt(m[1]!, 16) : null;
}

/** `pmset -g`'s system sleep minutes (0 = never), or null. */
export function pmsetSleep(text: string): number | null {
  const m = /^\s*sleep\s+(\d+)/mu.exec(text);
  return m ? Number(m[1]) : null;
}

/** The `mind_mode:` value of a stagehand YAML (only that line is read). */
export function mindModeOf(yaml: string): string | null {
  const m = /^\s*mind_mode:\s*["']?([a-z]+)/mu.exec(yaml);
  return m ? m[1]! : null;
}

/** Ollama's `/api/tags` or `/api/ps` body → the model names it lists. */
export function ollamaModels(body: string): string[] {
  try {
    const j = JSON.parse(body) as { models?: Array<{ name?: string; model?: string }> };
    return (j.models ?? []).map((m) => String(m.name ?? m.model ?? ""));
  } catch {
    return [];
  }
}

/** Which stagehand modules a process list runs (`--only show,lights` per
 *  process; a `run` with no `--only` runs every module in its YAML). */
export function stagehandJobs(commandLines: string): Set<string> {
  const jobs = new Set<string>();
  for (const line of commandLines.split(/\r?\n/u)) {
    if (!/stagehand/iu.test(line) || !/\brun\b/u.test(line)) continue;
    const only = /--only[= ]([\w,]+)/u.exec(line);
    if (only) for (const j of only[1]!.split(",")) jobs.add(j);
    else jobs.add("*");
  }
  return jobs;
}

async function chromeVersion(p: Probe): Promise<{ major: number | null; where: string }> {
  if (p.platform === "darwin") {
    const bin = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (!p.exists(bin)) return { major: null, where: bin };
    const r = await p.run(bin, ["--version"]);
    return { major: chromeMajor(r.stdout), where: bin };
  }
  if (p.platform === "win32") {
    const r = await p.run("reg", ["query", "HKCU\\Software\\Google\\Chrome\\BLBeacon", "/v", "version"]);
    if (r.code === 0) return { major: chromeMajor(r.stdout), where: "HKCU\\Software\\Google\\Chrome\\BLBeacon" };
    for (const base of [p.env["ProgramFiles"], p.env["ProgramFiles(x86)"], p.env["LOCALAPPDATA"]]) {
      if (base && p.exists(`${base}\\Google\\Chrome\\Application\\chrome.exe`)) return { major: null, where: `${base}\\Google\\Chrome\\Application\\chrome.exe` };
    }
    return { major: null, where: "chrome.exe" };
  }
  for (const bin of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const r = await p.run(bin, ["--version"]);
    if (!r.missing) return { major: chromeMajor(r.stdout), where: bin };
  }
  return { major: null, where: "google-chrome" };
}

/** Chrome is installed, and new enough for Web Serial when `min` is given. */
async function chromeCheck(p: Probe, min: number | null): Promise<Check> {
  const v = await chromeVersion(p);
  const read = `chrome --version (${v.where})`;
  if (v.major === null) return row("Chrome", p.exists(v.where) ? "info" : "fail", p.exists(v.where) ? "installed (version unread — check chrome://version)" : "Chrome not found — install Google Chrome", read);
  if (min !== null && v.major < min) return row("Chrome", "fail", `Chrome ${v.major}: Web Serial needs ${min}+ — update Chrome`, read);
  return row("Chrome", "ok", `Chrome ${v.major}${min !== null ? ` (Web Serial needs ${min}+)` : ""}`, read);
}

function osCheck(p: Probe, want: string, label: string): Check | null {
  if (p.platform === want) return null;
  return row("This computer", "warn", `this is ${p.platform}, but ${label} — are you on the right machine?`, "process.platform");
}

async function launchdJob(p: Probe, job: string, missingLevel: Level, missingText: string): Promise<Check> {
  const uid = p.uid();
  const label = `${LAUNCHD_PREFIX}.${job}`;
  const read = `launchctl print gui/${uid ?? "?"}/${label}`;
  const r = await p.run("launchctl", ["print", `gui/${uid ?? 501}/${label}`]);
  const st = launchdState(r);
  if (st === "running") return row(`stagehand ${job}`, "ok", "launchd job running", read);
  if (st === "loaded") return row(`stagehand ${job}`, "warn", "launchd job loaded but not running — uv run stagehand launchd restart --job " + job, read);
  return row(`stagehand ${job}`, missingLevel, missingText, read);
}

/** John's MacBook: Trabolta's voice, the backups, the console; the router
 *  only when it is the fallback host (`router === "macbook"`). */
export async function macbookChecks(p: Probe, router: RouterHost = "desktop"): Promise<Check[]> {
  const out: Check[] = [];
  const os = osCheck(p, "darwin", "the MacBook runs macOS");
  if (os) out.push(os);
  const ollama = p.env["OLLAMA_HOST"] ? p.env["OLLAMA_HOST"]!.replace(/\/+$/u, "") : "http://127.0.0.1:11434";
  const tags = await p.http(`${ollama}/api/tags`);
  if (tags === null) out.push(row("Ollama", "fail", "not answering — open the Ollama app (or ollama serve)", `GET ${ollama}/api/tags`));
  else {
    const pulled = ollamaModels(tags.body);
    out.push(row("Ollama", pulled.includes(VOICE_MODEL) ? "ok" : "fail", pulled.includes(VOICE_MODEL) ? `${VOICE_MODEL} pulled` : `${VOICE_MODEL} NOT pulled — ollama pull ${VOICE_MODEL}`, `GET ${ollama}/api/tags`));
    const loaded = ollamaModels((await p.http(`${ollama}/api/ps`))?.body ?? "");
    out.push(row("Voice model", loaded.includes(VOICE_MODEL) ? "ok" : "warn", loaded.includes(VOICE_MODEL) ? `${VOICE_MODEL} loaded in memory` : `${VOICE_MODEL} not loaded: the first line waits ~25 s — warm it: ollama run ${VOICE_MODEL} hi`, `GET ${ollama}/api/ps`));
    const mode = mindModeOf(p.readFile(`${p.root}/stagehand/laptop.yaml`) ?? "");
    const orch = loaded.filter((m) => m.includes(ORCHESTRATOR_HINT));
    if (mode === "new" && orch.length > 0) out.push(row("Orchestrator", "warn", `${orch.join(", ")} is loaded but mind_mode: new never uses it — ollama stop ${orch[0]}`, `GET ${ollama}/api/ps`));
  }
  const yaml = p.readFile(`${p.root}/stagehand/laptop.yaml`);
  out.push(yaml === null ? row("laptop.yaml", "fail", "stagehand/laptop.yaml missing (it holds the agents config; git-ignored)", "stagehand/laptop.yaml") : row("laptop.yaml", mindModeOf(yaml) === "new" ? "ok" : "warn", `mind_mode: ${mindModeOf(yaml) ?? "(unset = classic)"}`, "stagehand/laptop.yaml (mind_mode line only)"));
  const uv = await p.run("uv", ["--version"]);
  out.push(uv.missing || uv.code !== 0 ? row("uv", "fail", "uv not on PATH — curl -LsSf https://astral.sh/uv/install.sh | sh", "uv --version") : row("uv", "ok", uv.stdout.trim(), "uv --version"));
  out.push(await launchdJob(p, "agents", "fail", "not installed — cd stagehand && uv run stagehand launchd install --job agents --config laptop.yaml"));
  if (router === "macbook") {
    out.push(await launchdJob(p, "audio", "fail", "not installed — the router is the MacBook's tonight (--router macbook): cd stagehand && uv run stagehand launchd install --job audio --config trapped.macbook.yaml"));
    const audio = await p.run("system_profiler", ["SPAudioDataType"], 20_000);
    if (!audio.missing) out.push(row("MOTU 828x", /MOTU|828/u.test(audio.stdout) ? "ok" : "fail", /MOTU|828/u.test(audio.stdout) ? "listed by Core Audio" : "not listed — check its Thunderbolt cable, power and MOTU's driver (the router runs here tonight)", "system_profiler SPAudioDataType"));
  } else {
    // The Desktop has the router tonight: one here too would speak every
    // announcement twice.
    const uid = p.uid();
    const read = `launchctl print gui/${uid ?? "?"}/${LAUNCHD_PREFIX}.audio`;
    const st = launchdState(await p.run("launchctl", ["print", `gui/${uid ?? 501}/${LAUNCHD_PREFIX}.audio`]));
    if (st === "absent") out.push(row("stagehand audio", "ok", "not installed here (the router runs on the Desktop; the MacBook fallback is --router macbook)", read));
    else out.push(row("stagehand audio", "warn", `${st === "running" ? "running" : "loaded"} HERE, but the router belongs to the Desktop tonight — two routers speak every announcement twice: uv run stagehand launchd uninstall --job audio (or, if this IS the fallback, pass --router macbook)`, read));
  }
  const vps = p.env["LOOM_VPS"] || "loom-vps";
  const ssh = await p.run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", vps, "true"], 12_000);
  out.push(row("ssh to the VPS", ssh.code === 0 ? "ok" : "warn", ssh.code === 0 ? `ssh ${vps} works (ship / sync-show / showbackup)` : `ssh ${vps} failed — ship.sh, sync-show and showbackup need it`, `ssh -o BatchMode=yes ${vps} true`));
  const batt = await p.run("pmset", ["-g", "batt"]);
  if (!batt.missing) out.push(row("Power", /AC Power/u.test(batt.stdout) ? "ok" : "warn", /AC Power/u.test(batt.stdout) ? "on AC power" : "ON BATTERY — plug the MacBook in (a sleeping MacBook = Trabolta offline)", "pmset -g batt"));
  const pm = await p.run("pmset", ["-g"]);
  const sleep = pmsetSleep(pm.stdout);
  if (sleep !== null) out.push(row("Sleep", sleep === 0 ? "ok" : "warn", sleep === 0 ? "system sleep off" : `system sleeps after ${sleep} min — run caffeinate -dims in a terminal for the night`, "pmset -g"));
  const backup = await p.run("bash", [`${p.root}/scripts/ops/showbackup.sh`, "status"], 20_000);
  if (!backup.missing) {
    const last = (backup.stdout.trim().split("\n").pop() ?? "").slice(0, 160);
    out.push(row("Show backups", backup.code === 0 && !/STALE/u.test(backup.stdout) ? "ok" : "warn", last || "no output", "scripts/ops/showbackup.sh status"));
  }
  return out;
}

/** John's Desktop (Windows): the broker, Zigbee, show + lights, the router
 *  (unless it is on the MacBook tonight: `router === "macbook"`), the TV. */
export async function desktopChecks(p: Probe, router: RouterHost = "desktop"): Promise<Check[]> {
  const out: Check[] = [];
  const os = osCheck(p, "win32", "John's Desktop runs Windows");
  if (os) out.push(os);
  const uv = await p.run("uv", ["--version"]);
  out.push(uv.missing || uv.code !== 0 ? row("uv", "fail", "uv not on PATH — winget install astral-sh.uv", "uv --version") : row("uv", "ok", uv.stdout.trim(), "uv --version"));
  if (p.platform === "win32") {
    const sc = await p.run("sc", ["query", "mosquitto"]);
    out.push(row("Mosquitto service", /RUNNING/u.test(sc.stdout) ? "ok" : "fail", /RUNNING/u.test(sc.stdout) ? "running" : "not running — Start-Service mosquitto", "sc query mosquitto"));
  }
  const lo = await p.port("127.0.0.1", 1883);
  out.push(row("MQTT 1883", lo ? "ok" : "fail", lo ? "the loopback listener answers (stagehand, Z2M)" : "nothing on 127.0.0.1:1883 — check mosquitto.conf's listener 1883 127.0.0.1", "tcp 127.0.0.1:1883"));
  const lan = await p.port("127.0.0.1", 1884);
  out.push(row("MQTT 1884", lan ? "ok" : "warn", lan ? "the LAN listener answers (the WLED controllers dial it with credentials; so does the MacBook's router in the fallback)" : `nothing on :1884 — the WLED strips can't reach the broker${router === "macbook" ? ", and the MacBook's router can't hear show/announce" : ""}`, "tcp 127.0.0.1:1884"));
  const z2mUrl = p.env["Z2M_FRONTEND"] || "http://127.0.0.1:8080";
  const z2m = await p.http(z2mUrl);
  out.push(row("Zigbee2MQTT", z2m !== null ? "ok" : "fail", z2m !== null ? `frontend answers (HTTP ${z2m.status})` : `frontend not answering at ${z2mUrl} — is Zigbee2MQTT running (and the CC2652P's COM port right)?`, `GET ${z2mUrl}`));
  out.push(await chromeCheck(p, null));
  if (p.platform === "win32") {
    const ps = await p.run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { $_.CommandLine }"], 20_000);
    const jobs = stagehandJobs(ps.stdout);
    for (const job of ["show", "lights"]) {
      const on = jobs.has(job) || jobs.has("*");
      out.push(row(`stagehand ${job}`, on ? "ok" : "fail", on ? "a stagehand run process carries it" : `no stagehand run --only ${job} process — .\\scripts\\house-desktop\\start-stagehand.ps1 -Restart ${job} (the task \\Loom\\stagehand-${job})`, "Win32_Process command lines"));
    }
    const audioHere = jobs.has("audio") || jobs.has("*");
    if (router === "desktop") out.push(row("stagehand audio", audioHere ? "ok" : "fail", audioHere ? "a stagehand run process carries the sound router" : "no stagehand run --only audio process — .\\scripts\\house-desktop\\start-stagehand.ps1 -Restart audio (the task \\Loom\\stagehand-audio; first install: start-stagehand.ps1). Router on the MacBook tonight? pass --router macbook", "Win32_Process command lines"));
    else out.push(row("stagehand audio", audioHere ? "warn" : "info", audioHere ? "running HERE, but --router macbook says the MacBook has it — two routers speak every announcement twice: .\\scripts\\house-desktop\\start-stagehand.ps1 -Stop audio" : "not here (--router macbook: the MacBook runs it)", "Win32_Process command lines"));
    const kiosk = ps.stdout.split(/\r?\n/u).some((l) => /chrome\.exe/iu.test(l) && /--kiosk/u.test(l));
    out.push(row("TV kiosk", kiosk ? "ok" : "warn", kiosk ? "a Chrome --kiosk window is running" : "no Chrome --kiosk running — launch the TV profile (spot=desktop-tv)", "Win32_Process command lines"));
    const standby = powercfgAc((await p.run("powercfg", ["/query", "SCHEME_CURRENT", "SUB_SLEEP", "STANDBYIDLE"])).stdout);
    if (standby !== null) out.push(row("Sleep", standby === 0 ? "ok" : "warn", standby === 0 ? "never sleeps on AC" : `sleeps after ${Math.round(standby / 60)} min — powercfg /change standby-timeout-ac 0`, "powercfg /query … STANDBYIDLE"));
    const monitor = powercfgAc((await p.run("powercfg", ["/query", "SCHEME_CURRENT", "SUB_VIDEO", "VIDEOIDLE"])).stdout);
    if (monitor !== null) out.push(row("Display", monitor === 0 ? "ok" : "warn", monitor === 0 ? "the TV output never blanks" : `display off after ${Math.round(monitor / 60)} min — powercfg /change monitor-timeout-ac 0`, "powercfg /query … VIDEOIDLE"));
  }
  return out;
}

/** The terminal URL pattern for a spot, with a placeholder for the code. */
export function kioskUrl(server: string, spot: string, extra = ""): string {
  return `${server}/terminal/?code=<mod>&spot=${spot}${extra}`;
}

/** Where the laptop's whisper.cpp answers (`scripts/server-room/start-whisper.ps1`; the terminal's `WHISPER_URL`). */
const WHISPER_ORIGIN = "http://127.0.0.1:8178";
const WHISPER_HEALTH = `${WHISPER_ORIGIN}/health`;

/** May a page under this Content-Security-Policy fetch `origin`? */
export function cspConnects(csp: string | null | undefined, origin: string): boolean {
  if (!csp) return true;
  const sources = (name: string) =>
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/u))
      .find((d) => d[0] === name)
      ?.slice(1);
  return (sources("connect-src") ?? sources("default-src") ?? [origin]).includes(origin);
}

/** Steph's laptop: Chrome new enough for Web Serial, the M4 on USB, whisper up
 *  and the live page allowed to reach it, the terminal's own Chrome profile. */
export async function serverroomChecks(p: Probe, server: string): Promise<Check[]> {
  const out: Check[] = [await chromeCheck(p, WEB_SERIAL_CHROME)];
  let found: boolean | null = null;
  let read = "";
  if (p.platform === "win32") {
    read = "Win32_PnPEntity VID_239A";
    const r = await p.run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_239A' } | ForEach-Object { $_.Name }"], 20_000);
    found = !r.missing ? r.stdout.trim() !== "" : null;
  } else if (p.platform === "darwin") {
    read = "system_profiler SPUSBDataType";
    const r = await p.run("system_profiler", ["SPUSBDataType"], 20_000);
    found = !r.missing ? /Grand Central|Adafruit|0x239a/iu.test(r.stdout) : null;
  } else {
    read = "lsusb";
    const r = await p.run("lsusb", []);
    found = !r.missing ? /239a:/iu.test(r.stdout) : null;
  }
  if (found !== null) out.push(row("Grand Central M4", found ? "ok" : "fail", found ? "on USB" : "not on USB — plug the M4 in (a data cable, not charge-only)", read));
  const whisper = await p.http(WHISPER_HEALTH);
  out.push(row("Whisper", whisper?.status === 200 ? "ok" : "warn", whisper?.status === 200 ? "listening on 127.0.0.1:8178" : "not running — scripts/server-room/start-whisper.ps1 (spoken answers wait on it; the choices still work)", WHISPER_HEALTH));
  // Whisper can be up and still unreachable: the served page's CSP decides, and Vite sends none.
  const page = await p.http(`${server}/terminal/`, 8_000);
  if (page === null) out.push(row("Page → whisper", "warn", "couldn't read the live terminal page", `${server}/terminal/`));
  else {
    const reaches = cspConnects(page.csp, WHISPER_ORIGIN);
    out.push(row("Page → whisper", reaches ? "ok" : "fail", reaches ? "the live page may fetch whisper" : "the live page refuses whisper (connect-src): it needs a release from the MacBook, then a reload here (the choices still work)", `${server}/terminal/ Content-Security-Policy`));
  }
  const appData = p.env["LOCALAPPDATA"];
  if (p.platform === "win32" && appData) {
    const profile = `${appData}\\loom-terminal`;
    const set = p.exists(profile);
    out.push(row("Chrome profile", set ? "ok" : "warn", set ? "the terminal's own profile exists" : "not set up — scripts/server-room/start-terminal.ps1 -Setup: its grants live in this profile, and the kiosk has no mouse to answer them", profile));
  }
  out.push(row("Kiosk URL", "info", `${kioskUrl(server, "server-room", "&door=serial&camera=user&webcam=C310&pad=1&whisper=1&crt=1")} — scripts/server-room/start-terminal.ps1 -Setup grants the serial port, camera, microphone and device access, then start-terminal.ps1 runs the kiosk`, "docs/trapped/kiosk.md"));
  out.push(row("By hand", "info", "⚙ on the terminal: the door sensor connected + calibrated; open → shut the door once and watch 🚪 flip on Run → Terminals; plug one patch cable and watch 🔌 count it; the GameCube controller walks the choices and SPEAK TO HIM says your words back", "the M4 checks"));
  return out;
}

/** John's old laptop: the tent terminal (wizard + game). */
export async function tentChecks(p: Probe, server: string): Promise<Check[]> {
  return [
    await chromeCheck(p, null),
    row("Kiosk URL", "info", `${kioskUrl(server, "tent", "&announce=1")} — never add &view=reinstall (the map's tent spot sets it)`, "docs/trapped/kiosk.md"),
    row("WebGL2", "info", "check chrome://gpu shows WebGL2 hardware accelerated: without it Play here is refused and the tent can only Send to a headset", "by hand"),
  ];
}

/** Server-side rows for one spot's terminal (the machine's own screen). */
export function spotFocus(terminals: Record<string, unknown>, spot: string, expect: { view?: string; door?: boolean; mic?: string }): Check[] {
  const read = "GET /api/mod/screen/terminals";
  const rows = Array.isArray(terminals["terminals"]) ? (terminals["terminals"] as Record<string, unknown>[]) : [];
  const t = rows.find((r) => r["spot"] === spot);
  if (t === undefined) return [row(`This terminal (${spot})`, "fail", `no terminal on spot ${spot} has polled — open the kiosk URL on this computer`, read)];
  const out: Check[] = [];
  const silent = (typeof t["ago"] === "number" ? t["ago"] : Infinity) >= (typeof terminals["silentMs"] === "number" ? terminals["silentMs"] : 20_000);
  out.push(row(`This terminal (${spot})`, silent ? "fail" : "ok", `"${String(t["name"])}" ${silent ? "is SILENT" : "is polling"}${t["view"] ? ` · view ${String(t["view"])}` : ""}`, read));
  if (expect.view !== undefined && t["view"] !== expect.view) out.push(row("View", "warn", `runs view ${String(t["view"] || "auto")}, expected ${expect.view} — let the map's spot set it`, read));
  if (expect.mic !== undefined && t["mic"] !== undefined && t["mic"] !== expect.mic) out.push(row("Mic", "warn", `mic ${String(t["mic"])}, expected ${expect.mic}`, read));
  if (expect.door === true) {
    const door = t["door"];
    if (door === undefined || door === "none") out.push(row("Door sensor", "fail", "this terminal bridges no door sensor — the URL needs &door=serial, then ⚙ Connect door sensor", read));
    else if (door === "fault") out.push(row("Door sensor", "fail", `FAULT ${String(t["doorFault"] ?? "")} — ⚙ on the terminal (calibrate again after a reflash)`, read));
    else out.push(row("Door sensor", silent ? "warn" : "ok", `${silent ? "last heard " : ""}${door === "closed" ? "shut" : "open"}${typeof t["doorLevel"] === "number" ? ` · level ${t["doorLevel"]}` : ""}${t["doorWarn"] ? ` · ⚠ ${String(t["doorWarn"])}` : ""}`, read));
    if (t["patch"] === undefined) out.push(row("Patch bay", "info", "this terminal reports no patch bay yet (an older terminal build, or the bay's firmware isn't flashed)", read));
  }
  return out;
}
