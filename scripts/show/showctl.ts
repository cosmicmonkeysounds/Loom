#!/usr/bin/env -S node --experimental-strip-types --no-warnings
//! showctl — show-night diagnostics for Trapped in the Internet, on any of
//! the show's computers (macOS, Windows, Linux). Zero dependencies: Node ≥
//! 22.6 runs this TypeScript straight (`--experimental-strip-types`).
//!
//!   pnpm showctl doctor [--watch N]           one green / amber / red table
//!   pnpm showctl status [--watch N]           the one-screen summary
//!   pnpm showctl log [--follow] [--type a,b] [--who name] [--last N]
//!   pnpm showctl roster [--csv] [--where captured|restricted|offline|online|gone|<room>] [--all]
//!   pnpm showctl terminals [--watch]
//!   pnpm showctl recap [--text]
//!   pnpm showctl preflight macbook|desktop|serverroom|tent
//!   pnpm showctl fire <signal> [--subject <guest>] [--arg k=v] --yes
//!
//! Env: LOOM_SERVER (default https://app.mapsandducks.com), LOOM_MOD_CODE
//! (a moderator passcode; `--server` / `--code` override both). Every
//! command but `fire` only reads. Exit 0 ok, 1 warnings, 2 failures (3: a
//! write the live guard or you refused). `--json` for machines, colour only
//! on a TTY (`--no-color` / `NO_COLOR` turn it off). A passcode prints as
//! its first two characters; a token never prints. See README.md here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirm } from "../accept/live-guard.ts";
import { flagOn, flagStr, parseArgs } from "./lib/args.ts";
import { ShowClient, ShowError } from "./lib/client.ts";
import { type Ctx, doctor, fire, log, preflight, recap, roster, status, terminals } from "./lib/commands.ts";
import { realProbe } from "./lib/local.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
export const DEFAULT_SERVER = "https://app.mapsandducks.com";

const COMMANDS: Record<string, (ctx: Ctx) => Promise<number>> = { doctor, status, log, roster, terminals, recap, preflight, fire };

function usage(): string {
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n");
  return src
    .slice(1, 21)
    .map((l) => l.replace(/^\/\/! ?/u, ""))
    .join("\n");
}

/** The show map's terminal spots (for "this spot never polled" rows). */
function mapSpots(): Array<{ id: string; name: string }> {
  const file = process.env["SHOWCTL_HOUSE"] ?? join(ROOT, "core", "examples", "trapped-in-the-internet", "house.json");
  try {
    const house = JSON.parse(readFileSync(file, "utf8")) as { terminals?: Array<{ id: string; name?: string }> };
    return (house.terminals ?? []).map((t) => ({ id: t.id, name: t.name ?? t.id }));
  } catch {
    return [];
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const [maj, min] = process.versions.node.split(".").map(Number) as [number, number];
  if (maj < 22 || (maj === 22 && min < 6)) {
    console.error(`showctl needs Node ≥ 22.6 (this is ${process.versions.node})`);
    return 2;
  }
  const args = parseArgs(argv);
  if (args.error !== null) {
    console.error(`showctl: ${args.error}\n\n${usage()}`);
    return 2;
  }
  const run = args.command === null ? undefined : COMMANDS[args.command];
  if (flagOn(args, "help") || args.command === "help" || run === undefined) {
    (run === undefined && args.command !== null && args.command !== "help" ? console.error : console.log)(
      `${run === undefined && args.command !== null && args.command !== "help" ? `showctl: unknown command "${args.command}"\n\n` : ""}${usage()}`,
    );
    return args.command === null || args.command === "help" || flagOn(args, "help") ? 0 : 2;
  }
  const json = flagOn(args, "json");
  const color = !json && process.stdout.isTTY === true && !process.env["NO_COLOR"] && !flagOn(args, "no-color");
  const client = new ShowClient({ server: flagStr(args, "server") ?? process.env["LOOM_SERVER"] ?? DEFAULT_SERVER, code: flagStr(args, "code") ?? process.env["LOOM_MOD_CODE"] ?? "" });
  const ctx: Ctx = {
    client,
    args,
    color,
    json,
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    probe: realProbe(ROOT),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
    mapSpots: mapSpots(),
    clear: () => {
      if (process.stdout.isTTY) process.stdout.write("\u001b[2J\u001b[H");
    },
    confirm,
  };
  try {
    return await run(ctx);
  } catch (e) {
    if (e instanceof ShowError) {
      console.error(`showctl ${args.command}: ${e.message}  (${e.read})`);
      return 2;
    }
    throw e;
  }
}

process.on("SIGINT", () => process.exit(0));
main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : String(e));
    process.exit(2);
  },
);
