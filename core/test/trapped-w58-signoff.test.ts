//! Trapped in the Internet, wave 58: the sign-off sheet is the discrepancy log the
//! user asked for, so it has to stay true. Every word we wrote is on it, every fact
//! we changed from the delivered file is on it, and it names no secret: it reads
//! them from the source, as the show page's test does. `core/test/trapped-w13-
//! objectives.test.ts` holds the objectives to it, and stagehand's wave 42d test
//! the two filler pools. The Music manager, the other wave 58, has its own sheet
//! and its own marker (`SIGNOFF-w58-music.md`, `DRAFT w58-music`), held here too.

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
const MUSIC_SHEET = read("SIGNOFF-w58-music.md");
const MUSIC_CONTRACT = readFileSync(join(ROOT, "docs/loom-w58-music-contract.md"), "utf8");
const SECRETS = showSecrets(loadShow());

/** Every tracked file a pattern finds, by path from the root, past the tests and two sheets. */
const grepped = (pattern: string, sheet: string, contract: string): string[] =>
  execSync(`git grep -lE '${pattern}' -- . ':!core/test' ':!terminal/test' ':!play/test' ':!stagehand/tests' ':!*${sheet}' ':!docs/${contract}'`, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);

/** Wave 58 is two waves: the story's `DRAFT w58` here, the Music manager's `DRAFT w58-music`. */
const MARKED = grepped("DRAFT w58([^-]|$)", "SIGNOFF-w58.md", "loom-w58-contract.md");
const MUSIC_MARKED = grepped("DRAFT w58-music", "SIGNOFF-w58-music.md", "loom-w58-music-contract.md");

/** The words a `// DRAFT w58` comment covers: the next line that says something. */
function markedWords(file: string): Array<{ where: string; text: string }> {
  const lines = read(file).split("\n");
  const out: Array<{ where: string; text: string }> = [];
  lines.forEach((l, i) => {
    if (!/\/\/.*DRAFT w58(?!-music)/u.test(l)) return;
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

describe("wave 58's Music manager: its own sheet", () => {
  const trabolta = read("cast/trabolta.loom");
  const main = read("main.loom");
  const start = trabolta.indexOf("when change_the_music for program:");
  const power = trabolta.slice(start, trabolta.indexOf("// He asks; the humans capture.", start));
  /** The sheet writes `{program}`, and the three moods as one line. */
  const asSheet = (t: string) => t.replace("{program.name}", "{program}").replace(/the (?:calm|uneasy|dread) one/u, "the calm / uneasy / dread one");

  it("names no secret, and neither does the contract", () => {
    expect(secretsIn(MUSIC_SHEET, SECRETS)).toEqual([]);
    expect(secretsIn(MUSIC_CONTRACT, SECRETS)).toEqual([]);
  });

  it("is not the story's sheet: each marker has one home", () => {
    expect(MUSIC_SHEET).toMatch(/DRAFT w58-music/u);
    expect(MUSIC_SHEET).toContain("`SIGNOFF-w58.md` is the Oct 30 story's");
    for (const f of ["cast/trabolta.loom", "main.loom", "trabolta.mind.md"]) expect(read(f), f).toMatch(/DRAFT w58-music/u);
    // A marker carried over as a bare `DRAFT w58` would sit on the wrong sheet.
    expect(power).not.toMatch(/DRAFT w58(?!-music)/u);
    expect(trabolta.slice(trabolta.lastIndexOf("DRAFT w58", start), start)).toMatch(/^DRAFT w58-music/u);
  });

  it("records each decision", () => {
    const rows = MUSIC_SHEET.split("\n").filter((l) => /^\| [MT]-\d+ \|/u.test(l));
    expect(rows.map((r) => /^\| ([MT]-\d+)/u.exec(r)![1])).toEqual(["M-1", "M-2", "M-3", "M-4", "M-5", "M-6", "T-1", "T-2", "T-3", "T-4", "T-5", "T-6", "T-7", "T-8", "T-9", "T-10"]);
  });

  it("names every file that holds a DRAFT w58-music marker", () => {
    expect(MUSIC_MARKED.length).toBeGreaterThanOrEqual(5);
    for (const f of MUSIC_MARKED) expect(MUSIC_SHEET, f).toContain(f.replace("core/examples/trapped-in-the-internet/", ""));
  });

  it("carries every line he says, the asker's and # hosts', and the two cues, word for word", () => {
    const refusals = [...power.matchAll(/^\s*Trabolta: (.+)$/gmu)].map((m) => m[1]!);
    const told = [...power.matchAll(/broadcast "(.*?)" to /gu), ...main.matchAll(/broadcast "(🔒 Trabolta.*?|🔓 Trabolta.*?)" to /gu)].map((m) => m[1]!);
    expect(refusals.length).toBeGreaterThanOrEqual(6);
    expect(told.length).toBeGreaterThanOrEqual(12);
    // A refusal he already had isn't new words.
    const rest = trabolta.replace(power, "");
    for (const line of refusals) if (!rest.includes(`Trabolta: ${line}`)) expect(MUSIC_SHEET, line).toContain(line);
    for (const line of told) expect(MUSIC_SHEET, line).toContain(asSheet(line));
    for (const label of ["Keep Trabolta off the music", "Let Trabolta reach the music"]) {
      expect(main).toContain(label);
      expect(MUSIC_SHEET).toContain(label);
    }
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
