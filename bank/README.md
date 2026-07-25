# @loom/bank

Compiles a Loom project into **banks** — engine-agnostic, versioned
instruction streams that game engines load and play — and hosts the
**reference interpreter** that defines what a bank means.

Format and API spec: [`../docs/loom-banks.md`](../docs/loom-banks.md).

This is the Wwise model: one authoring-side compiler, banks plus generated
ID headers as the artifact, and a small native runtime per engine that all
speak one contract. The first of those runtimes is
[`../engines/godot`](../engines/godot).

## Why a separate IR

The live engine (`@loom/core`'s `Sim`) walks parser AST nodes. That is
right for authoring — source spans let the editor map a running line back
to a character offset — but it cannot ship into a game:

- a suspended choice's continuation holds **live AST object references**,
  so it cannot be serialised (the event server works around this by
  replaying a command journal);
- expressions are stored as **source strings** and re-parsed on every
  evaluation;
- line text is **regex-scanned for `{expr}`** on every emission.

Flattening each beat into a jump-target instruction stream fixes all
three: a continuation becomes `(program, pc)` plus scalars, expressions are
pre-compiled to RPN, and interpolation is pre-split at compile time.

## Use

```bash
npx tsx bin/loom-bank.ts build <dir|file.loom …> -o out [--name main] \
                               [--locale <tag>=<translations.json> …]
npx tsx bin/loom-bank.ts strings out/main.loombank [-o template.json]
npx tsx bin/loom-bank.ts trace  out/main.loombank scenario.script [-o trace.jsonl]
npx tsx bin/loom-bank.ts diff   golden.jsonl actual.jsonl
npx tsx bin/loom-bank.ts inspect out/main.loombank [beat]
```

`build` emits `<name>.loombank` plus `LoomIDs.gd` / `.cs` / `.h`; each
`--locale` also emits a `<name>.<tag>.loombank` sidecar. `strings` emits
the translator's template (`loc` key → source text with `{0}` ordinal
placeholders) — translate the values, keep the placeholders, feed the
file back through `--locale`.
`inspect` disassembles, which is the fastest way to see what a construct
lowered to:

```
== opening  [beat] f904a6cfcdb92317
     0  NARRATE      1
     1  SPEAK        1, 2    ; (guarded)
     2  JUMP_IF_NOT  0, 5
     3  SPEAK        1, 3
     4  JUMP         7
...
```

As a library:

```ts
import { compileSources, BankVM } from "@loom/bank";

const bank = compileSources([{ path: "story.loom", source }]);
const vm = new BankVM();
vm.loadBank(bank);
vm.start(vm.programByName("opening"));
let step = vm.advance();      // pull model: one Step per call
```

## Layout

| File | Role |
|---|---|
| `src/ir.ts` | IR types, format/ABI versions, the two opcode tables |
| `src/ids.ts` | FNV-1a 64 hashing + collision detection |
| `src/intern.ts` | string table, interpolation pre-splitting |
| `src/expr-compile.ts` | `Expr` AST → flat RPN |
| `src/compile.ts` | `SimModel` → `Bank` (the lowering pass) |
| `src/interp.ts` | **the reference interpreter — normative** |
| `src/trace.ts` | scenario driver + golden traces + diffing |
| `src/headers.ts` | `LoomIDs.{gd,cs,h}` codegen |
| `src/value.ts` | value bridging, the spec'd number formatter, binary ops |
| `src/digest.ts` | canonical JSON + SHA-256 |

The compiler consumes `@loom/core`'s `compileModel`, so `is`-inheritance
merging, derived-slot filling, and hook lowering are shared rather than
reimplemented. `Value`, `truthy`, and `valuesEqual` are reused from core
too, so the bank and the live engine cannot drift on them.

## Tests

```bash
pnpm --filter @loom/bank test
```

Five suites, and it is worth knowing what each is *for*:

- **`lowering`** — asserts on decoded opcodes, so a lowering regression is
  localised to the compiler instead of surfacing as a mysterious
  behavioural diff.
- **`interp`** — the normative semantics. Anything not asserted here is not
  part of the format, however clearly the spec prose reads.
- **`parity`** — plays the same source through `@loom/core`'s `Sim` *and*
  the bank VM and requires identical output. This is what keeps the two
  engines honest until the live server migrates onto the bank IR.
- **`conformance`** — number formatting and f64 arithmetic vectors, which
  exist purely because three hand-written runtimes would silently disagree
  otherwise, plus the committed golden trace.
- **`ids`** — hash vectors and collision behaviour.

Regenerate goldens deliberately, never incidentally:

```bash
REGEN_GOLDENS=1 pnpm --filter @loom/bank test
```

## Divergences from the live engine

A bank plays *more* of the authored language than `Sim` currently does, so
these are deliberate and tested: `-> END` / `<-` / tunnels actually work
(in `Sim` the divert branch breaks out of its `switch`, not the executor
loop, so `-> END` is inert); `<each visit>` runs its `then` / `finally`
arms; `<after:>` latches permanently; once-only and suppressed choices are
honoured; `match` arms compare typed values, so a quoted arm can match;
`<let:>` is frame-local rather than leaking into diverted beats; hook
dispatch order is frozen at compile time rather than following map
insertion order; and `<shuffle:>` actually shuffles — on the spec'd
xorshift64* PRNG (`src/prng.ts`), with per-site streams that persist in
the save, where `Sim` passes it through as an unknown directive. Full
list with rationale in the spec's §10.
