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

function loomcheck(main: string): { status: number | null; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "loomcheck-"));
  try {
    writeFileSync(join(dir, "main.loom"), main);
    const r = spawnSync(join(CORE, "node_modules/.bin/tsx"), ["scripts/loomcheck.ts", dir, "--quiet"], { cwd: CORE, encoding: "utf8" });
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
