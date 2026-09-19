#!/usr/bin/env node
// The whole Loom dev stack in one command.
//
//   pnpm dev                      build play + terminal, then run the event
//                                 server (:7000) and the editor (:5173)
//   pnpm dev --no-build           skip the builds (the server serves the
//                                 last play/dist + terminal/dist)
//   pnpm dev --play               also run the play app's own Vite (:5174),
//                                 a second origin for a performer phone
//   pnpm dev --only server        just the server (or: editor, play)
//   pnpm dev --sync "My Project"  after boot, push the example story into
//                                 that server project + reload its event
//                                 (see core/scripts/sync-example.ts)
//   pnpm dev --example NAME       which example --sync pushes
//
// Every process gets a coloured, prefixed log; Ctrl+C stops them all.
// Env (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `LOOM_*`) passes straight
// through — the defaults are the local `loom_dev` Postgres and the dev
// auth secret, which is all a laptop needs. No dependencies: plain Node.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] ?? null);
};
const build = !flag("--no-build");
const only = opt("--only");
const wantPlay = flag("--play") || only === "play";
const sync = opt("--sync");
const example = opt("--example") ?? "trapped-in-the-internet";
const port = process.env.LOOM_PORT ?? "7000";
const run = (name) => only === null || only === name;

const COLORS = { build: "36", server: "32", editor: "35", play: "33", sync: "34" };
const kids = new Set();
let shuttingDown = false;

function prefixed(name, stream, out) {
  let rest = "";
  stream.on("data", (chunk) => {
    rest += chunk.toString();
    const lines = rest.split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) out.write(`\x1b[${COLORS[name] ?? "37"}m[${name}]\x1b[0m ${line}\n`);
  });
  stream.on("end", () => {
    if (rest) out.write(`\x1b[${COLORS[name] ?? "37"}m[${name}]\x1b[0m ${rest}\n`);
  });
}

/** Spawn `pnpm …` in the repo root; resolves with the exit code. */
function pnpm(name, pnpmArgs, { env = {} } = {}) {
  const child = spawn("pnpm", pnpmArgs, { cwd: root, env: { ...process.env, FORCE_COLOR: "1", ...env }, stdio: ["ignore", "pipe", "pipe"] });
  kids.add(child);
  prefixed(name, child.stdout, process.stdout);
  prefixed(name, child.stderr, process.stderr);
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      kids.delete(child);
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function stopAll() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write("\n\x1b[2mstopping…\x1b[0m\n");
  for (const k of kids) k.kill("SIGTERM");
  setTimeout(() => {
    for (const k of kids) k.kill("SIGKILL");
    process.exit(0);
  }, 3000).unref();
}
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

/** Wait for the event server to answer on its port. */
async function waitForServer(ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://localhost:${port}/api/resolve-code`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (r.status > 0) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  if (build && (run("server") || only === null)) {
    process.stdout.write("\x1b[36m[build]\x1b[0m play + terminal (the server serves their dist/)\n");
    const codes = await Promise.all([pnpm("build", ["--filter", "loom-play", "build"]), pnpm("build", ["--filter", "loom-terminal", "build"])]);
    if (codes.some((c) => c !== 0)) {
      process.stderr.write("\x1b[31m[build] failed — not starting the stack\x1b[0m\n");
      process.exit(1);
    }
  }

  const running = [];
  if (run("server")) running.push(pnpm("server", ["--filter", "@loom/core", "serve"]));
  if (run("editor")) running.push(pnpm("editor", ["--filter", "loom-app", "dev"]));
  if (wantPlay) running.push(pnpm("play", ["--filter", "loom-play", "dev"]));
  if (running.length === 0) {
    process.stderr.write("nothing to run (--only takes server | editor | play)\n");
    process.exit(2);
  }

  if (sync !== null) {
    if (run("server")) await waitForServer();
    const code = await pnpm("sync", ["--filter", "@loom/core", "exec", "tsx", "scripts/sync-example.ts", sync, example, "--server", `http://localhost:${port}`]);
    if (code !== 0) process.stderr.write("\x1b[31m[sync] failed (see above) — the stack keeps running\x1b[0m\n");
  }

  process.stdout.write(
    `\x1b[2m→ server http://localhost:${port}${run("editor") ? "  ·  editor http://localhost:5173" : ""}${wantPlay ? "  ·  play http://localhost:5174" : ""}  ·  Ctrl+C stops everything\x1b[0m\n`,
  );
  const codes = await Promise.all(running);
  if (!shuttingDown) process.exit(codes.find((c) => c !== 0) ?? 0);
}

main().catch((e) => {
  process.stderr.write(`dev: ${e?.message ?? e}\n`);
  stopAll();
});
