//! Trapped in the Internet, wave 59: the sign-off sheet has to stay true. Every word
//! a story marker covers is on it, every file holding a marker is named, and neither
//! it nor the wave's other docs name a secret: they read them from the source, as the
//! show page's test does.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadShow, redact, secretsIn, showSecrets } from "../scripts/show-page.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SHOW = join(HERE, "../examples/trapped-in-the-internet");
const read = (p: string) => readFileSync(join(SHOW, p), "utf8");
const SHEET = read("SIGNOFF-w59.md");
const SECRETS = showSecrets(loadShow());

/** The wave's docs: what a person reads to run it. */
const DOCS = [
  "CLAUDE.md",
  "core/CLAUDE.md",
  "docs/loom-w59-contract.md",
  "docs/loom-w59-prompter-contract.md",
  "docs/trapped/costume.md",
  "core/examples/trapped-in-the-internet/SHOWNIGHT.md",
  "core/examples/trapped-in-the-internet/TECH.md",
];

/** Every tracked file carrying a marker, by path from the root. */
const MARKED = execSync(`git grep -l "DRAFT w59" -- . ':!core/test' ':!terminal/test' ':!play/test' ':!reinstall/web/test' ':!*SIGNOFF-w59.md' ':!docs/loom-w59-*' ':!docs/help'`, { cwd: ROOT, encoding: "utf8" })
  .trim()
  .split("\n")
  .filter((f) => f !== "");

/** The words a `// DRAFT w59` comment covers: the next line that says something. */
function markedWords(file: string): Array<{ where: string; text: string }> {
  const lines = read(file).split("\n");
  const out: Array<{ where: string; text: string }> = [];
  lines.forEach((l, i) => {
    if (!/\/\/.*DRAFT w59/u.test(l)) return;
    let j = i + 1;
    while (j < lines.length && (lines[j]!.trim() === "" || lines[j]!.trim().startsWith("//"))) j++;
    const next = lines[j] ?? "";
    const said = /^\s*(?:[A-Z][A-Za-z ]*?)(?: \([^)]*\))?: (.+)$/u.exec(next);
    const told = /^\s*broadcast "(.*?)"(?: to | with )/u.exec(next);
    if (told) out.push({ where: `${file}:${j + 1}`, text: told[1]! });
    else if (said && !/^\s*(label|text|title|who|while|setting|cast|aloud)\b/u.test(next)) out.push({ where: `${file}:${j + 1}`, text: next.trim() });
  });
  return out;
}

describe("wave 59: the sign-off sheet", () => {
  it("names no secret, and neither does any doc the wave wrote", () => {
    expect(SECRETS.length).toBeGreaterThan(50);
    expect(secretsIn(SHEET, SECRETS)).toEqual([]);
    for (const d of DOCS) expect(secretsIn(readFileSync(join(ROOT, d), "utf8"), SECRETS), d).toEqual([]);
  });

  it("records each decision with its cost, and what is owed", () => {
    const rows = SHEET.split("\n").filter((l) => /^\| D-\d+ \|/u.test(l));
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r.split(" | ").length, r.slice(0, 40)).toBeGreaterThanOrEqual(5);
    expect(SHEET).toMatch(/Real-device checks owed/u);
    expect(SHEET).toMatch(/What's owed in print/u);
    expect(SHEET).toMatch(/titi:qr-lock/u);
  });

  it("names every file that holds a DRAFT w59 marker", () => {
    expect(MARKED.length).toBeGreaterThan(25);
    for (const f of MARKED) expect(SHEET, f).toContain(f.replace("core/examples/trapped-in-the-internet/", ""));
  });

  it("carries every line a marker covers, word for word (a secret's word as ▒▒▒)", () => {
    const loom = MARKED.filter((f) => f.endsWith(".loom")).map((f) => f.replace("core/examples/trapped-in-the-internet/", ""));
    const words = loom.flatMap(markedWords);
    expect(words.length).toBeGreaterThan(8);
    for (const w of words) expect(SHEET, w.where).toContain(redact(w.text, SECRETS));
  });
});
