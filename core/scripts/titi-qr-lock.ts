//! titi-qr-lock — hold the story to what has been printed (wave 59).
//!
//!   pnpm --filter @loom/core titi:qr-lock           # write the lock: do this when the cards go to print
//!   pnpm --filter @loom/core titi:qr-lock --check   # fails naming what moved
//!   … [--example <name>]                            # default trapped-in-the-internet
//!
//! A printed QR is made of the event's guest code and claim secret, which a
//! story edit never touches, and one name from the story. Text, beats, their
//! order, conditions, objectives, a fact's words: nothing printed reads them.
//! What it does read is listed here (`printedIdentities`), each with what must
//! hold for that card to keep working:
//!
//!   room      a LOCATION with a sign: its name (the link's `checkin=`, the
//!             code's hash), and still `checkin`-able
//!   sign      a `qr:` guest INTERACTION: its name (`act=`, the code's hash)
//!   part      a performer CHARACTER: its name (the staff badge's code)
//!   invited   a reserved program: its name AND its place among them (the
//!             badge's number; typing that badge finds the program by place)
//!   codex     an entry's code (`unlock=`, and the card's text)
//!
//! `qr-lock.json`, beside the story, holds **hashes only**, so it can sit in a
//! repo: of a name and of what it must stay. `--check` reads the story as it is
//! now: a name whose identity changed is named; one gone from the story can't
//! be, the file holds only its hash, so it counts them and names what is new
//! (a rename reads as one of each). What is new alone fails nothing: nothing
//! printed points at it, but it has no card yet.
//!
//! `predeploy.sh` and `sync-show.sh` run `--check` once a lock exists.
//! `LOOM_QR_MOVED=1` (`sync-show.sh --qr-moved`) says yes, reprint: it reports
//! what moved and passes.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { scenarioDir, scenarioSource } from "../examples/load.ts";
import { identityDefs, guestPickable, performerPickable } from "../server/identity.ts";
import { actionSigns, checkinSigns } from "../server/routes/k12.ts";
import { INVITED_BADGES } from "../server/routes/rejoin.ts";
import { foldName } from "../src/parser/names.ts";
import { compileFromSource, type SimModel } from "../src/runtime/sim/index.ts";

export const QR_LOCK_FILE = "qr-lock.json";
export const QR_MOVED_ENV = "LOOM_QR_MOVED";

export type LockKind = "room" | "sign" | "part" | "invited" | "codex";

/** One printed thing: `name` is what a report calls it, `identity` what the
 *  card needs to stay. */
export interface LockItem {
  kind: LockKind;
  name: string;
  identity: string;
}

export interface QrLock {
  version: 1;
  /** `<kind>:<hash of the name>` → the hash of its identity. */
  items: Record<string, string>;
}

/** Everything printed that a story can move, in the order Run prints it. */
export function printedIdentities(model: SimModel): LockItem[] {
  const out: LockItem[] = [];
  for (const r of checkinSigns(model, "", "", "")) out.push({ kind: "room", name: r.id, identity: foldName(r.id) });
  for (const a of actionSigns(model, "", "", "")) out.push({ kind: "sign", name: a.name, identity: foldName(a.name) });
  for (const d of identityDefs(model).filter(performerPickable)) out.push({ kind: "part", name: d.name, identity: foldName(d.name) });
  identityDefs(model)
    .filter((d) => d.reserved && guestPickable(d))
    .slice(0, INVITED_BADGES)
    .forEach((d, i) => out.push({ kind: "invited", name: d.name, identity: `${i}:${foldName(d.name)}` }));
  for (const e of model.codex.values()) if (e.code !== null) out.push({ kind: "codex", name: e.id, identity: e.code });
  return out;
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);
const keyOf = (i: LockItem): string => `${i.kind}:${hash(i.name)}`;

export function buildLock(items: readonly LockItem[]): QrLock {
  return { version: 1, items: Object.fromEntries(items.map((i) => [keyOf(i), hash(`${i.kind}\0${i.identity}`)])) };
}

export interface LockDiff {
  /** Still in the story under its name, but no longer what was printed. */
  moved: LockItem[];
  /** How many locked things of a kind are gone from the story. */
  gone: Partial<Record<LockKind, number>>;
  /** In the story, not in the lock: nothing printed points at them. */
  added: LockItem[];
}

export function diffLock(lock: QrLock, items: readonly LockItem[]): LockDiff {
  const now = new Map(items.map((i) => [keyOf(i), i]));
  const moved = items.filter((i) => lock.items[keyOf(i)] !== undefined && lock.items[keyOf(i)] !== hash(`${i.kind}\0${i.identity}`));
  const added = items.filter((i) => lock.items[keyOf(i)] === undefined);
  const gone: LockDiff["gone"] = {};
  for (const key of Object.keys(lock.items)) {
    if (now.has(key)) continue;
    const kind = key.slice(0, key.indexOf(":")) as LockKind;
    gone[kind] = (gone[kind] ?? 0) + 1;
  }
  return { moved, gone, added };
}

/** Does anything printed stop working? */
export function lockBroken(d: LockDiff): boolean {
  return d.moved.length > 0 || Object.keys(d.gone).length > 0;
}

const WHAT: Record<LockKind, string> = {
  room: "room sign",
  sign: "sign",
  part: "staff badge",
  invited: "invited badge",
  codex: "codex card",
};

/** The report, one line each. A codex entry's id is fine to say; its code never appears. */
export function lockReport(d: LockDiff): string[] {
  return [
    ...d.moved.map((i) => `MOVED  ${WHAT[i.kind]}: ${i.name}`),
    ...Object.entries(d.gone).map(([kind, n]) => `GONE   ${n} ${WHAT[kind as LockKind]}${n === 1 ? "" : "s"} no longer in the story (renamed or deleted)`),
    ...d.added.map((i) => `NEW    ${WHAT[i.kind]}: ${i.name} (not printed yet)`),
  ];
}

function main(args: readonly string[]): number {
  const check = args.includes("--check");
  const at = args.indexOf("--example");
  const example = at >= 0 ? (args[at + 1] ?? "") : "trapped-in-the-internet";
  const path = join(scenarioDir(example), QR_LOCK_FILE);
  const items = printedIdentities(compileFromSource(scenarioSource(example)));
  if (!check) {
    writeFileSync(path, `${JSON.stringify(buildLock(items), null, 2)}\n`);
    process.stdout.write(`✓ locked ${items.length} printed identities in ${path}\n`);
    return 0;
  }
  if (!existsSync(path)) {
    process.stdout.write(`no ${QR_LOCK_FILE} yet: nothing is locked\n`);
    return 0;
  }
  const lock = JSON.parse(readFileSync(path, "utf8")) as QrLock;
  const diff = diffLock(lock, items);
  for (const line of lockReport(diff)) process.stdout.write(`${line}\n`);
  if (!lockBroken(diff)) {
    process.stdout.write(`✓ every printed QR still works (${Object.keys(lock.items).length} locked)\n`);
    return 0;
  }
  if (process.env[QR_MOVED_ENV] === "1") {
    process.stdout.write(`⚠ printed QRs moved (${QR_MOVED_ENV}=1): reprint those cards, then write the lock again\n`);
    return 0;
  }
  process.stderr.write(`✘ a story change breaks printed QRs. Put the name back, or reprint and write the lock again (${QR_MOVED_ENV}=1 to go on anyway)\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main(process.argv.slice(2)));
