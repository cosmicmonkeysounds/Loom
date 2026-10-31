#!/usr/bin/env node
// What the Quest's compositor saw of the game: reads a logcat dump, picks the
// VrApi line of the process that logged as `godot`, and sums up the frame
// rate, the stale frames and the budget. `adb logcat -d > run.txt`, then
//
//   node reinstall/vr/tools/quest-frames.mjs run.txt [--from HH:MM:SS]
//
// FPS is frames shown / display rate; Stale frames were shown twice, which is
// the judder a player feels. App is the GPU's ms per frame, CPU&GPU the whole
// frame's, and GPU% the share of the GPU's clock in use at its level.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const num = (line, re) => {
  const m = line.match(re);
  return m ? Number(m[1]) : undefined;
};

/** One VrApi line as numbers, or null when it isn't one. */
export function parseVrApi(line) {
  const at = line.match(/(\d\d:\d\d:\d\d\.\d+)/)?.[1];
  const fps = line.match(/FPS=(\d+)\/(\d+)/);
  if (!at || !fps) return null;
  const levels = line.match(/CPU4\/GPU=(\d+)\/(\d+),(\d+)\/(\d+)MHz/);
  return {
    at,
    fps: Number(fps[1]),
    display: Number(fps[2]),
    stale: num(line, /Stale=(\d+)/) ?? 0,
    early: num(line, /Early=(\d+)/) ?? 0,
    tear: num(line, /Tear=(\d+)/) ?? 0,
    prd: num(line, /Prd=(\d+)ms/),
    app: num(line, /App=([\d.]+)ms/),
    tw: num(line, /TW=([\d.]+)ms/),
    frame: num(line, /CPU&GPU=([\d.]+)ms/),
    gpu: num(line, /GPU%=([\d.]+)/),
    cpu: num(line, /CPU%=([\d.]+)/),
    temp: num(line, /Temp=([\d.]+)C/),
    cpuLevel: levels ? Number(levels[1]) : undefined,
    gpuLevel: levels ? Number(levels[2]) : undefined,
    gpuMhz: levels ? Number(levels[4]) : undefined,
    fov: line.match(/Fov=(\w+)/)?.[1],
  };
}

/** The pid that logged as `godot` in a logcat dump (threadtime or time format). */
export function gamePid(text) {
  const m = text.match(/\s(\d+)\s+\d+\s[A-Z]\s+godot\s*:/) ?? text.match(/[A-Z]\/godot\s*\(\s*(\d+)\)/);
  return m ? m[1] : null;
}

function pct(values, p) {
  const v = [...values].sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))] : 0;
}

/** The numbers worth reading, from parsed lines. */
export function summary(rows) {
  const seen = (k) => rows.map((r) => r[k]).filter((v) => v !== undefined);
  const spread = (k) => ({ p50: pct(seen(k), 50), p95: pct(seen(k), 95), max: Math.max(...seen(k)) });
  const staleSeconds = rows.filter((r) => r.stale > 0).length;
  return {
    seconds: rows.length,
    display: [...new Set(rows.map((r) => r.display))],
    fpsLow: Math.min(...rows.map((r) => r.fps)),
    staleFrames: rows.reduce((n, r) => n + r.stale, 0),
    staleSeconds,
    earlyFrames: rows.reduce((n, r) => n + r.early, 0),
    app: spread("app"),
    frame: spread("frame"),
    gpu: spread("gpu"),
    cpu: spread("cpu"),
    prd: spread("prd"),
    levels: [...new Set(rows.map((r) => `${r.cpuLevel}/${r.gpuLevel}`))],
    gpuMhz: [...new Set(rows.map((r) => r.gpuMhz))],
    fov: [...new Set(rows.map((r) => r.fov))],
    tempMax: Math.max(...seen("temp")),
  };
}

function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const from = fromAt >= 0 ? args[fromAt + 1] : "";
  const file = args.find((a, i) => !a.startsWith("--") && (fromAt < 0 || i !== fromAt + 1));
  if (!file) {
    console.error("usage: quest-frames.mjs <logcat file> [--from HH:MM:SS]");
    process.exit(2);
  }
  const text = readFileSync(file, "latin1");
  const pid = gamePid(text);
  if (!pid) {
    console.error("no godot lines in that log");
    process.exit(1);
  }
  const mine = new RegExp(`(^|\\s|\\()${pid}(\\s|\\))`);
  const rows = text
    .split("\n")
    .filter((l) => l.includes("VrApi") && l.includes("FPS=") && mine.test(l.slice(18, 40)))
    .map(parseVrApi)
    .filter((r) => r && r.at >= from);
  if (rows.length === 0) {
    console.error("no VrApi lines for the game in that log");
    process.exit(1);
  }
  const s = summary(rows);
  const budget = 1000 / Math.max(...s.display);
  console.log(`${s.seconds} s at ${s.display.join("/")} Hz (budget ${budget.toFixed(1)} ms), lowest ${s.fpsLow} fps`);
  console.log(`stale frames ${s.staleFrames} (in ${s.staleSeconds} of ${s.seconds} s), early ${s.earlyFrames}`);
  console.log(`GPU app ms   p50 ${s.app.p50}  p95 ${s.app.p95}  max ${s.app.max}`);
  console.log(`frame ms     p50 ${s.frame.p50}  p95 ${s.frame.p95}  max ${s.frame.max}`);
  console.log(`GPU busy     p50 ${s.gpu.p50}  p95 ${s.gpu.p95}  max ${s.gpu.max}`);
  console.log(`CPU busy     p50 ${s.cpu.p50}  p95 ${s.cpu.p95}  max ${s.cpu.max}`);
  console.log(`latency ms   p50 ${s.prd.p50}  p95 ${s.prd.p95}`);
  console.log(`levels CPU/GPU ${s.levels.join(" ")}  GPU ${s.gpuMhz.join("/")} MHz  foveation ${s.fov.join(" ")}  ${s.tempMax} C`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
