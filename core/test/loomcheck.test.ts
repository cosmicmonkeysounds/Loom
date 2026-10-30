//! `core/scripts/loomcheck.ts` run as the CLI on a temp fixture: the
//! wave 5 detectors (the currency / wallet lints it prints from the
//! workspace, the `with`-argument traps, the bare card hook in a class).

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = fileURLToPath(new URL("..", import.meta.url));

function loomcheck(main: string, extra: Record<string, string> = {}, quiet = true): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "loomcheck-"));
  try {
    writeFileSync(join(dir, "main.loom"), main);
    for (const [name, text] of Object.entries(extra)) writeFileSync(join(dir, name), text);
    const r = spawnSync(join(CORE, "node_modules/.bin/tsx"), ["scripts/loomcheck.ts", dir, ...(quiet ? ["--quiet"] : [])], { cwd: CORE, encoding: "utf8" });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAN = `# Lint
start: Go
currency: score as Truthcoin, max 500

ROLE Program
  when someone joins:
    show answer "Your line, please" to program with question: "P1", button: "Say it, now"
    fire flagged for program with reason: "late, no mode", n: 2
  when flagged for program:
    reply ok

CHARACTER Oracle
  wallet: approver, every 3
  when answer answered for who:
    Oracle: thanks

== Go
Hi.
`;

describe("loomcheck — wave 5 detectors", () => {
  it("a clean fixture (commas inside quotes, quoted question, `for who` hook) reports nothing", () => {
    const r = loomcheck(CLEAN);
    expect(r.out).toMatch(/0 error\(s\) · 0 warning\(s\)/);
    expect(r.status).toBe(0);
  });

  it("flags an unparsed currency / wallet line (errors), an unquoted question, unbalanced quotes and a bare class card hook", () => {
    const r = loomcheck(
      CLEAN.replace("max 500", "max lots")
        .replace("every 3", "evry 3")
        .replace('question: "P1"', "question: P1")
        .replace('reason: "late, no mode", n: 2', 'reason: "late, no mode')
        .replace("when answer answered for who:", "when answer answered:"),
    );
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/ERROR main\.loom:3 L1203 /);
    expect(r.out).toMatch(/ERROR main\.loom:13 L1204 /);
    expect(r.out).toMatch(/WARN .*`show … with question: P1` — quote it/);
    expect(r.out).toMatch(/WARN .*`fire flagged .*unbalanced quotes/);
    expect(r.out).toMatch(/WARN .*\[character Oracle · when answer answered\] .*`when answer answered for who:`/);
    // The workspace lint says it too (L1212: the card's answer, truncated).
    expect(r.out).toMatch(/WARN .*L1212 `when answer answered:`/);
    expect(r.out).toMatch(/2 error\(s\) · 4 warning\(s\)/);
  });

  it("wave 11's keys (`reserved: true`, INTERACTION `arm:`, a `for guests` countdown) report nothing", () => {
    const r = loomcheck(`# Lint
start: Go
countdown: Night.summons_end as Summons, for guests

CHARACTER Microsoft Excel
  reserved: true

INTERACTION the summons
  label: Summon
  who: admin
  arm: true

== Go
set Night.summons_end = 100
Hi.
`);
    expect(r.out).not.toMatch(/seeds NO value/);
    expect(r.out).toMatch(/0 error\(s\) · 0 warning\(s\)/);
    expect(r.status).toBe(0);
  });
});

// Wave 25: a story driven by the house desk (`desk.json`): `cue heart_reveal`
// plays a desk cue, whose `event` step and `done` the story hears.
const DESK_STORY = `# Desk
start: Boot

LOCATION The Server Room

CHARACTER Trabolta

CHARACTER Task Manager
  admin: true
  when scanned by guest:
    reply ok

when heart_speaks:
  -> Heart Speaks

when heart_reveal_done:
  -> Heart Quiet

== Boot
cue heart_reveal
Hello.

== Heart Speaks
  setting: The Server Room
  cast: Trabolta
Trabolta: I am awake.
Trabolta: Close the door.

== Heart Quiet
  setting: The Server Room
  cast: Trabolta
Trabolta: Good.
`;
const DESK_JSON = JSON.stringify({
  version: 1,
  cues: [{ id: "heart_reveal", name: "The Heart wakes", done: "heart_reveal_done", steps: [{ kind: "event", event: "heart_speaks" }, { kind: "speech", room: "The Server Room", max: 5000 }] }],
});

describe("loomcheck — the house desk (wave 25)", () => {
  it("a desk-driven story lints clean, and the desk's events count as fired", () => {
    const r = loomcheck(DESK_STORY, { "desk.json": DESK_JSON }, false);
    expect(r.out).toMatch(/0 error\(s\) · 0 warning\(s\)/);
    expect(r.status).toBe(0);
    expect(r.out).not.toMatch(/"heart speaks" is only fired by the director/u);
    // Without the desk the same story only notes (INFO) that nothing in it fires them.
    const bare = loomcheck(DESK_STORY, {}, false);
    expect(bare.status).toBe(0);
    expect(bare.out).toMatch(/0 error\(s\) · 0 warning\(s\)/);
    expect(bare.out).toMatch(/only fired by the director/u);
  });

  it("a broken desk.json is an error", () => {
    const r = loomcheck(DESK_STORY, { "desk.json": JSON.stringify({ version: 1, cues: [{ id: "Bad Id", name: "x", steps: [] }] }) });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/desk\.json: cues\[0\]: id must match/u);
  });
});

describe("loomcheck — the descent's words (wave 49)", () => {
  const ok = (extra: object = {}) =>
    JSON.stringify({ version: 1, talkers: [], whispers: {}, grin: [], whiteduck: [], self: [], small: [], big: [], hallway: { enter: [], far: [], out: [] }, found: {}, ...extra });

  it("a usable descent.json lints clean", () => {
    const r = loomcheck(CLEAN, { "descent.json": ok() });
    expect(r.out).not.toContain("descent.json");
    expect(r.status).toBe(0);
  });

  it("a descent.json that doesn't validate, or isn't JSON, is an error", () => {
    const bad = loomcheck(CLEAN, { "descent.json": ok({ version: 2 }) });
    expect(bad.out).toMatch(/ERROR.*descent\.json: version must be 1/u);
    expect(bad.status).not.toBe(0);
    const junk = loomcheck(CLEAN, { "descent.json": "{ nope" });
    expect(junk.out).toMatch(/ERROR.*descent\.json: not JSON/u);
  });

  it("a talker on a model that isn't one yet is a warning", () => {
    const talker = { id: "ghost", from: 1, models: ["no-such-model"], nodes: { start: { say: ["Hello."] } } };
    const r = loomcheck(CLEAN, { "descent.json": ok({ talkers: [talker] }) }, false);
    expect(r.out).toMatch(/WARN.*descent\.json: talker "ghost": "no-such-model" is not a model yet/u);
    expect(r.status).toBe(0);
  });
});
