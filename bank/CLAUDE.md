# bank (`@loom/bank`)

The bank compiler and the **normative reference interpreter**. It lowers
a Loom project into a `.loombank` (engine-agnostic 4×i32 instruction
streams, RPN expressions, pre-split `{expr}` interpolation, pre-parsed
directive args) plus generated `LoomIDs.{gd,cs,h}` headers, and hosts the
scenario driver and golden traces every per-engine runtime is checked
against. The only runtime so far is [`engines/godot`](../engines/godot).
This is the game-engine path; the live show does not use banks.

Read [`README.md`](./README.md) for the CLI, the library API and the
suite-by-suite tests, and [`docs/loom-banks.md`](../docs/loom-banks.md)
for the format, which is normative for every runtime.

## Layout

| Path | What |
|---|---|
| `src/compile.ts` | `SimModel` → `Bank`: the lowering pass, and the "not in the bank format" diagnostics |
| `src/interp.ts` | `BankVM`, the reference interpreter. If it and a runtime disagree, the runtime is wrong |
| `src/ir.ts` | IR types, format / ABI versions, opcode tables |
| `src/expr-compile.ts`, `intern.ts`, `directive-args.ts` | expressions → RPN, the string table and interpolation, directive args |
| `src/ids.ts`, `prng.ts`, `value.ts`, `digest.ts`, `sha256.ts` | FNV-1a 64 ids, the xorshift64* PRNG, value semantics and number formatting, canonical JSON + digests |
| `src/trace.ts`, `headers.ts` | the scenario driver and trace diffing; `LoomIDs` codegen |
| `bin/loom-bank.ts` | the CLI: `build`, `strings`, `trace`, `diff`, `inspect` |
| `test/` | the suites, `fixtures/*.loom`, `scenarios/*.script`, `golden/` |

## Commands

```bash
pnpm --filter @loom/bank test                     # all suites
REGEN_GOLDENS=1 pnpm --filter @loom/bank test     # rewrite goldens, deliberately only
pnpm --filter @loom/bank typecheck
cd bank && npx tsx bin/loom-bank.ts inspect out/main.loombank [beat]   # disassemble
engines/godot/test/conformance.sh                 # from the repo root, needs Godot 4
```

## Conventions and gotchas

- **It builds on `@loom/core`.** `compileModel` (the `is` merge, derived
  slots, hook lowering) and `Value` / `truthy` / `valuesEqual` come from
  core, so the two cannot drift on them. A change to core's model can
  change a bank: run this suite after touching `core/src/runtime/sim/model.ts`.
- **The format is versioned.** Changing an opcode, the save layout or the
  value semantics is a format change: bump the version in `ir.ts`, update
  `docs/loom-banks.md`, regenerate goldens on purpose, and re-run the
  Godot conformance script, which rebuilds every fixture from source.
- **New language features don't come for free.** A feature added to the
  live engine compiles here with a warning (`watcherIgnored`,
  `storyRulesIgnored`, `liveHeadersIgnored`, `choiceGuardIgnored`, …) or
  not at all. Say so in the README's "What a bank does not play" when
  you add one.
- **Some files read as binary to grep.** `src/compile.ts`,
  `src/expr-compile.ts` and `src/intern.ts` are skipped by the shell's
  grep; use `grep -a`.
- **The editor imports this package from source**, which is why
  `editor/vite.config.ts` aliases `@loom/core/runtime` even though no
  editor file imports it. Don't remove that alias.
- The desktop app compiles banks in its webview through this package
  (Integrations mode, `⌘3`), and writes them into a linked Godot project.
