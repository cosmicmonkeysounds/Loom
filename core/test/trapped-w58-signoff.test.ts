//! Trapped in the Internet, wave 58: the sign-off sheet is the discrepancy log the
//! user asked for, so it has to stay true. Every word we wrote is on it, every fact
//! we changed from the delivered file is on it, and it names no secret: it reads
//! them from the source, as the show page's test does. `core/test/trapped-w13-
//! objectives.test.ts` holds the objectives to it, and stagehand's wave 42d test
//! the two filler pools.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadShow, redact, secretsIn, showSecrets } from "../scripts/show-page.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SHOW = join(HERE, "../examples/trapped-in-the-internet");
const DELIVERED = join(ROOT, "Trapped In The Internet story/oct30/facts-with-codex-edited.json");
const read = (p: string) => readFileSync(join(SHOW, p), "utf8");
const SHEET = read("SIGNOFF-w58.md");
const CONTRACT = readFileSync(join(ROOT, "docs/loom-w58-contract.md"), "utf8");
const SECRETS = showSecrets(loadShow());

/** Every tracked file carrying a marker, by path from the root. */
const MARKED = execSync(`git grep -l "DRAFT w58" -- . ':!core/test' ':!terminal/test' ':!play/test' ':!stagehand/tests' ':!*SIGNOFF-w58.md' ':!docs/loom-w58-contract.md'`, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/** The words a `// DRAFT w58` comment covers: the next line that says something. */
function markedWords(file: string): Array<{ where: string; text: string }> {
  const lines = read(file).split("\n");
  const out: Array<{ where: string; text: string }> = [];
  lines.forEach((l, i) => {
    if (!/\/\/.*DRAFT w58/u.test(l)) return;
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

describe("wave 58: the sign-off sheet", () => {
  it("names no secret, and neither does the contract", () => {
    expect(SECRETS.length).toBeGreaterThan(50);
    expect(secretsIn(SHEET, SECRETS)).toEqual([]);
    expect(secretsIn(CONTRACT, SECRETS)).toEqual([]);
  });

  it("says who decided every discrepancy, the user or a default of ours", () => {
    const rows = SHEET.split("\n").filter((l) => /^\| D-\d+ \|/u.test(l));
    expect(rows).toHaveLength(69);
    for (const r of rows) expect(r, r.slice(0, 40)).toMatch(/\| (?:\*\*)?(?:You|Default)\b/u);
  });

  it("says what is owed, and what a guest gets until it arrives", () => {
    for (const q of ["H1", "H2", "H3"]) expect(SHEET).toContain(q);
    expect(SHEET).toMatch(/If a guest files before the answers arrive/u);
    expect(SHEET).toMatch(/recordings can't/iu);
    expect(SHEET).toMatch(/Real-device checks owed/u);
    expect(SHEET).toMatch(/What's owed in print/u);
  });

  it("names every file that holds a DRAFT w58 marker", () => {
    expect(MARKED.length).toBeGreaterThan(30);
    for (const f of MARKED) expect(SHEET, f).toContain(f.replace("core/examples/trapped-in-the-internet/", ""));
  });

  it("carries every line a marker covers, word for word (a secret's word as ▒▒▒)", () => {
    const loom = MARKED.filter((f) => f.endsWith(".loom")).map((f) => f.replace("core/examples/trapped-in-the-internet/", ""));
    const words = loom.flatMap(markedWords);
    expect(words.length).toBeGreaterThan(40);
    for (const w of words) expect(SHEET, w.where).toContain(redact(w.text, SECRETS));
  });
});

describe.skipIf(!existsSync(DELIVERED))("wave 58: every edit to the delivered facts is logged", () => {
  it("names each fact and question that differs from the delivered file", () => {
    interface Row { id: string; text?: string; answer?: string; existing?: string; secret?: boolean; codex?: { id?: string; text?: string; title?: string; secret?: boolean } }
    const ours = JSON.parse(read("facts.json")) as { facts: Row[]; questions: Row[] };
    const theirs = JSON.parse(readFileSync(DELIVERED, "utf8")) as typeof ours;
    const log = SHEET.slice(SHEET.indexOf("### 3.3 The facts"), SHEET.indexOf("## 4. Every word we wrote"));
    const shape = (r: Row) => JSON.stringify([r.text, r.answer, r.existing, r.codex?.id, r.codex?.text, r.codex?.title, r.codex?.secret]);
    const changed: string[] = [];
    for (const [a, b] of [[ours.facts, theirs.facts], [ours.questions, theirs.questions]] as const) {
      const delivered = new Map(b.map((r) => [r.id, r]));
      for (const r of a) if (shape(r) !== shape(delivered.get(r.id)!)) changed.push(r.id);
    }
    expect(changed.length).toBeGreaterThan(40);
    for (const id of changed) expect(log, id).toMatch(new RegExp(`\\b${id}\\b`, "u"));
  });
});
