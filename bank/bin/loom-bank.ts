#!/usr/bin/env tsx
//! `loom-bank` — build banks, run scenarios, diff traces, inspect a bank.
//!
//!   loom-bank build <projectDir|file.loom …> -o <outDir> [--name main]
//!                   [--locale <tag>=<translations.json> …]
//!   loom-bank strings <bank.loombank> [-o template.json]
//!   loom-bank trace <bank.loombank> <scenario.script> [-o out.jsonl]
//!   loom-bank diff  <golden.jsonl> <actual.jsonl>
//!   loom-bank inspect <bank.loombank> [program]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { compileLocaleBank, compileSources, stringsTemplate } from "../src/compile.ts";
import { cppHeader, csharpHeader, gdscriptHeader } from "../src/headers.ts";
import { OP_NAMES, WORDS_PER_INSTRUCTION } from "../src/ir.ts";
import type { Bank } from "../src/ir.ts";
import { diffTraces, parseScenario, runScenario, toJsonl } from "../src/trace.ts";

function loomFilesUnder(path: string): string[] {
  const info = statSync(path);
  if (info.isFile()) return [path];
  const out: string[] = [];
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) out.push(...loomFilesUnder(child));
    else if (entry.endsWith(".loom")) out.push(child);
  }
  // `main.loom` first, mirroring the example loader's convention: the
  // spine file carries the `entry:` header.
  return out.sort((a, b) => {
    const am = a.endsWith("main.loom") ? 0 : 1;
    const bm = b.endsWith("main.loom") ? 0 : 1;
    return am - bm || a.localeCompare(b);
  });
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Every value of a repeatable flag (`--locale fr=fr.json --locale de=…`). */
function flags(argv: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length - 1; i++) {
    if (argv[i] === name) out.push(argv[i + 1]!);
  }
  return out;
}

function build(argv: string[]): number {
  const outDir = flag(argv, "-o") ?? flag(argv, "--out") ?? "out";
  const name = flag(argv, "--name") ?? "main";
  const skipValues = new Set(["-o", "--out", "--name", "--locale"]);
  const inputs = argv.filter((a, i) => !a.startsWith("-") && !skipValues.has(argv[i - 1] ?? ""));
  if (inputs.length === 0) {
    console.error("loom-bank build: no inputs");
    return 2;
  }

  const files = inputs.flatMap((input) => loomFilesUnder(resolve(input)));
  const sources = files.map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const bank = compileSources(sources, { bankName: name });

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.loombank`), JSON.stringify(bank, null, 2));
  writeFileSync(join(outDir, "LoomIDs.gd"), gdscriptHeader(bank));
  writeFileSync(join(outDir, "LoomIDs.cs"), csharpHeader(bank));
  writeFileSync(join(outDir, "LoomIDs.h"), cppHeader(bank));

  const diagnostics = [...bank.diagnostics];
  console.log(
    `${name}.loombank — ${bank.programs.length} programs, ${bank.texts.length} texts, ` +
      `${bank.exprs.length} exprs, ${bank.hooks.length} hooks`,
  );

  for (const spec of flags(argv, "--locale")) {
    const eq = spec.indexOf("=");
    if (eq <= 0) {
      console.error(`loom-bank build: --locale wants <tag>=<translations.json>, got \`${spec}\``);
      return 2;
    }
    const tag = spec.slice(0, eq);
    const translations = JSON.parse(readFileSync(resolve(spec.slice(eq + 1)), "utf8")) as Record<
      string,
      string
    >;
    const localeBank = compileLocaleBank(bank, tag, translations);
    writeFileSync(join(outDir, `${name}.${tag}.loombank`), JSON.stringify(localeBank, null, 2));
    diagnostics.push(...localeBank.diagnostics);
    console.log(`${name}.${tag}.loombank — ${Object.keys(localeBank.texts).length} translated texts`);
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  for (const d of diagnostics) {
    console.log(`  ${d.severity}: [${d.code}] ${d.message}${d.program !== undefined ? ` (${d.program})` : ""}`);
  }
  if (warnings.length > 0 || errors.length > 0) {
    console.log(`  ${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  return errors.length > 0 ? 1 : 0;
}

/** Emit the translator's template: every `loc` key → placeholder text. */
function strings(argv: string[]): number {
  const [bankPath] = argv.filter((a, i) => !a.startsWith("-") && argv[i - 1] !== "-o");
  if (bankPath === undefined) {
    console.error("loom-bank strings <bank> [-o template.json]");
    return 2;
  }
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as Bank;
  const template = JSON.stringify(stringsTemplate(bank), null, 2) + "\n";
  const out = flag(argv, "-o");
  if (out !== undefined) writeFileSync(out, template);
  else process.stdout.write(template);
  return 0;
}

function trace(argv: string[]): number {
  const [bankPath, scriptPath] = argv.filter((a) => !a.startsWith("-"));
  if (bankPath === undefined || scriptPath === undefined) {
    console.error("loom-bank trace <bank> <scenario>");
    return 2;
  }
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as Bank;
  const records = runScenario(bank, parseScenario(readFileSync(scriptPath, "utf8")), {
    // `loadbank` paths resolve against the primary bank's directory, so a
    // scenario can name its locale bank portably.
    resolveBank: (file) => {
      const path = join(dirname(resolve(bankPath)), file);
      return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Bank) : null;
    },
  });
  const jsonl = toJsonl(records);
  const out = flag(argv, "-o");
  if (out !== undefined) writeFileSync(out, jsonl);
  else process.stdout.write(jsonl);
  return 0;
}

function diff(argv: string[]): number {
  const [goldenPath, actualPath] = argv.filter((a) => !a.startsWith("-"));
  if (goldenPath === undefined || actualPath === undefined) {
    console.error("loom-bank diff <golden> <actual>");
    return 2;
  }
  const result = diffTraces(readFileSync(goldenPath, "utf8"), readFileSync(actualPath, "utf8"));
  if (result.ok) {
    console.log("traces match");
    return 0;
  }
  console.error(`divergence at line ${result.line}`);
  console.error(`  expected: ${result.expected ?? "(end of trace)"}`);
  console.error(`  actual:   ${result.actual ?? "(end of trace)"}`);
  return 1;
}

function inspect(argv: string[]): number {
  const [bankPath, which] = argv.filter((a) => !a.startsWith("-"));
  if (bankPath === undefined) {
    console.error("loom-bank inspect <bank> [program]");
    return 2;
  }
  const bank = JSON.parse(readFileSync(bankPath, "utf8")) as Bank;
  for (const program of bank.programs) {
    const name = bank.names[program.name] ?? "";
    if (which !== undefined && name !== which) continue;
    console.log(`\n== ${name}  [${program.kind}] ${program.hash}`);
    const count = program.code.length / WORDS_PER_INSTRUCTION;
    for (let pc = 0; pc < count; pc++) {
      const base = pc * WORDS_PER_INSTRUCTION;
      const [op, a, b, c] = program.code.slice(base, base + WORDS_PER_INSTRUCTION);
      const operands = [a, b, c].filter((x) => x !== -1).join(", ");
      const note = program.notes.find((n) => n.pc === pc);
      console.log(
        `  ${String(pc).padStart(4)}  ${(OP_NAMES[op ?? 0] ?? "?").padEnd(12)} ${operands}` +
          (note !== undefined ? `    ; ${note.text}` : ""),
      );
    }
  }
  return 0;
}

const [, , command, ...rest] = process.argv;
const handlers: Record<string, (argv: string[]) => number> = { build, strings, trace, diff, inspect };
const handler = command !== undefined ? handlers[command] : undefined;
if (handler === undefined) {
  console.error("usage: loom-bank <build|strings|trace|diff|inspect> …");
  process.exit(2);
}
process.exit(handler(rest));
