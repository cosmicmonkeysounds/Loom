// node --experimental-strip-types --no-warnings --test scripts/show/test/local.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { chromeMajor, desktopChecks, kioskUrl, launchdState, macbookChecks, mindModeOf, ollamaModels, pmsetSleep, powercfgAc, type Probe, type RunResult, serverroomChecks, spotFocus, stagehandJobs, tentChecks } from "../lib/local.ts";

/** A fake machine: commands answered by `cmd args…` prefix, ports, URLs, files. */
function fakeProbe(o: { platform: string; run?: Record<string, Partial<RunResult>>; ports?: number[]; http?: Record<string, string>; files?: Record<string, string>; env?: Record<string, string> }): Probe & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    platform: o.platform,
    env: o.env ?? {},
    root: "/repo",
    run: async (cmd, args) => {
      const line = [cmd, ...args].join(" ");
      ran.push(line);
      const key = Object.keys(o.run ?? {}).find((k) => line.startsWith(k));
      if (key === undefined) return { code: null, stdout: "", stderr: "", missing: true };
      return { code: 0, stdout: "", stderr: "", ...o.run![key] };
    },
    port: async (_h, p) => (o.ports ?? []).includes(p),
    http: async (url) => (o.http?.[url] !== undefined ? { status: 200, body: o.http[url]! } : null),
    exists: (p) => o.files?.[p] !== undefined,
    readFile: (p) => o.files?.[p] ?? null,
    uid: () => 501,
  };
}

const levelOf = (rows: { name: string; level: string }[], name: string) => rows.find((r) => r.name === name)?.level;

test("parsers: Chrome versions, launchd, powercfg, pmset, mind_mode, Ollama, stagehand processes", () => {
  assert.equal(chromeMajor("Google Chrome 131.0.6778.86"), 131);
  assert.equal(chromeMajor("    version    REG_SZ    87.0.4280.141"), 87);
  assert.equal(chromeMajor("nothing"), null);
  assert.equal(launchdState({ code: 0, stdout: "\tstate = running\n", stderr: "" }), "running");
  assert.equal(launchdState({ code: 0, stdout: "\tstate = not running\n", stderr: "" }), "loaded");
  assert.equal(launchdState({ code: 113, stdout: "", stderr: "Could not find service" }), "absent");
  assert.equal(powercfgAc("    Current AC Power Setting Index: 0x00000708\n    Current DC Power Setting Index: 0x0000012c"), 1800);
  assert.equal(pmsetSleep(" standby 1\n sleep                1 (sleep prevented by …)\n"), 1);
  assert.equal(pmsetSleep(" sleep 0\n"), 0);
  assert.equal(mindModeOf("agents:\n  name: laptop\n  mind_mode: new\n  mod_passcode: SECRET\n"), "new");
  assert.equal(mindModeOf("agents: {}\n"), null);
  assert.deepEqual(ollamaModels('{"models":[{"name":"gpt-oss:20b"},{"model":"qwen3:8b"}]}'), ["gpt-oss:20b", "qwen3:8b"]);
  assert.deepEqual(ollamaModels("not json"), []);
  const jobs = stagehandJobs('"C:\\uv.exe" run stagehand run --config trapped.house.yaml --only show,lights\nchrome.exe --kiosk\npython -m stagehand run --config x.yaml --only=audio\n');
  assert.deepEqual([...jobs].sort(), ["audio", "lights", "show"]);
  assert.deepEqual([...stagehandJobs("uv run stagehand run --config all.yaml")], ["*"]);
  assert.equal(kioskUrl("https://s", "tent", "&announce=1"), "https://s/terminal/?code=<mod>&spot=tent&announce=1");
});

test("the MacBook: Ollama + the voice model, the agents job, power, ssh; the yaml read for mind_mode only", async () => {
  const p = fakeProbe({
    platform: "darwin",
    http: { "http://127.0.0.1:11434/api/tags": '{"models":[{"name":"gpt-oss:20b"}]}', "http://127.0.0.1:11434/api/ps": '{"models":[{"name":"gpt-oss:20b"},{"name":"tobestyledintro/qwen3.8-9b-distill:q8_0"}]}' },
    files: { "/repo/stagehand/laptop.yaml": "agents:\n  mind_mode: new\n" },
    run: {
      "uv --version": { stdout: "uv 0.11.8\n" },
      "launchctl print gui/501/com.mapsandducks.stagehand.agents": { stdout: "state = running" },
      "launchctl print gui/501/com.mapsandducks.stagehand.audio": { code: 113 },
      "system_profiler SPAudioDataType": { stdout: "MOTU 828x:\n" },
      ssh: { code: 255 },
      "pmset -g batt": { stdout: "Now drawing from 'AC Power'" },
      "pmset -g": { stdout: " sleep 0\n" },
      bash: { stdout: "newest copy 4 min old\n" },
    },
  });
  const rows = await macbookChecks(p);
  assert.equal(levelOf(rows, "Ollama"), "ok");
  assert.equal(levelOf(rows, "Voice model"), "ok");
  assert.equal(levelOf(rows, "Orchestrator"), "warn", "mind_mode: new never needs the qwen model loaded");
  assert.equal(levelOf(rows, "laptop.yaml"), "ok");
  assert.equal(levelOf(rows, "stagehand agents"), "ok");
  assert.equal(levelOf(rows, "stagehand audio"), "warn");
  assert.equal(levelOf(rows, "MOTU 828x"), "ok");
  assert.equal(levelOf(rows, "ssh to the VPS"), "warn");
  assert.ok(p.ran.some((l) => l === "ssh -o BatchMode=yes -o ConnectTimeout=5 loom-vps true"), "ssh only runs `true`");
  assert.equal(levelOf(rows, "Sleep"), "ok");
  const off = await macbookChecks(fakeProbe({ platform: "darwin" }));
  assert.equal(levelOf(off, "Ollama"), "fail");
  assert.equal(levelOf(off, "laptop.yaml"), "fail");
  assert.equal(levelOf(off, "uv"), "fail");
  assert.equal(levelOf(off, "stagehand agents"), "fail");
});

test("the Desktop: the broker's two listeners, Z2M, the stagehand jobs and the kiosk off process lines, power", async () => {
  const p = fakeProbe({
    platform: "win32",
    ports: [1883],
    http: { "http://127.0.0.1:8080": "<html>" },
    env: { ProgramFiles: "C:\\Program Files" },
    run: {
      "uv --version": { stdout: "uv 0.11.8" },
      "sc query mosquitto": { stdout: "STATE : 4 RUNNING" },
      "reg query": { stdout: "version REG_SZ 131.0.1" },
      powershell: { stdout: "uv run stagehand run --config trapped.house.yaml --only show\n\"chrome.exe\" --user-data-dir=C:\\tv --kiosk https://x/terminal/\n" },
      "powercfg /query SCHEME_CURRENT SUB_SLEEP": { stdout: "Current AC Power Setting Index: 0x00000000" },
      "powercfg /query SCHEME_CURRENT SUB_VIDEO": { stdout: "Current AC Power Setting Index: 0x00000258" },
    },
  });
  const rows = await desktopChecks(p);
  assert.equal(levelOf(rows, "This computer"), undefined, "on Windows, no wrong-machine row");
  assert.equal(levelOf(rows, "Mosquitto service"), "ok");
  assert.equal(levelOf(rows, "MQTT 1883"), "ok");
  assert.equal(levelOf(rows, "MQTT 1884"), "warn");
  assert.equal(levelOf(rows, "Zigbee2MQTT"), "ok");
  assert.equal(levelOf(rows, "Chrome"), "ok");
  assert.equal(levelOf(rows, "stagehand show"), "ok");
  assert.equal(levelOf(rows, "stagehand lights"), "fail");
  assert.equal(levelOf(rows, "TV kiosk"), "ok");
  assert.equal(levelOf(rows, "Sleep"), "ok");
  assert.equal(levelOf(rows, "Display"), "warn");
  const mac = await desktopChecks(fakeProbe({ platform: "darwin", run: { "uv --version": { stdout: "uv" } } }));
  assert.equal(levelOf(mac, "This computer"), "warn");
});

test("the server room: Web Serial needs Chrome 89+, the M4 on USB; URLs carry a <mod> placeholder", async () => {
  const old = await serverroomChecks(fakeProbe({ platform: "win32", run: { "reg query": { stdout: "version REG_SZ 87.0.1" }, powershell: { stdout: "Adafruit Grand Central M4 (COM5)" } } }), "https://s");
  assert.equal(levelOf(old, "Chrome"), "fail");
  assert.equal(levelOf(old, "Grand Central M4"), "ok");
  const mac = await serverroomChecks(fakeProbe({ platform: "darwin", files: { "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome": "" }, run: { "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --version": { stdout: "Google Chrome 131.0" }, "system_profiler SPUSBDataType": { stdout: "USB 3.1 Bus:\n" } } }), "https://s");
  assert.equal(levelOf(mac, "Chrome"), "ok");
  assert.equal(levelOf(mac, "Grand Central M4"), "fail");
  assert.match(mac.find((r) => r.name === "Kiosk URL")!.detail, /code=<mod>&spot=server-room&door=serial&camera=user/u);
  const tent = await tentChecks(fakeProbe({ platform: "linux" }), "https://s");
  assert.equal(levelOf(tent, "Chrome"), "fail");
  assert.ok(!tent.some((r) => /view=reinstall/u.test(r.detail) && !/never add/u.test(r.detail)));
});

test("this machine's own screen: the spot polling, the right view and mic, the door sensor", () => {
  const terms = (t: Record<string, unknown>) => ({ silentMs: 20_000, terminals: [{ name: "X", ago: 1000, ...t }] });
  assert.equal(spotFocus(terms({ spot: "other" }), "tent", {})[0]!.level, "fail");
  const tent = spotFocus(terms({ spot: "tent", view: "reinstall", mic: "live" }), "tent", { mic: "off" });
  assert.equal(levelOf(tent, "Mic"), "warn");
  const tv = spotFocus(terms({ spot: "desktop-tv", view: "auto" }), "desktop-tv", { view: "tv" });
  assert.equal(levelOf(tv, "View"), "warn");
  assert.equal(levelOf(spotFocus(terms({ spot: "server-room" }), "server-room", { door: true }), "Door sensor"), "fail");
  assert.equal(levelOf(spotFocus(terms({ spot: "server-room", door: "fault", doorFault: "ldr_saturated" }), "server-room", { door: true }), "Door sensor"), "fail");
  assert.equal(levelOf(spotFocus(terms({ spot: "server-room", door: "closed", doorLevel: 2000 }), "server-room", { door: true }), "Door sensor"), "ok");
  assert.equal(levelOf(spotFocus(terms({ spot: "server-room", door: "closed", ago: 60_000 }), "server-room", { door: true }), "Door sensor"), "warn", "a silent terminal's door state is stale");
});
