# Loom Banks — compiled story exports for game engines

**Status:** normative spec, v1 (format `1`, ABI `1`).
**Audience:** anyone implementing a Loom runtime for an engine, or
changing the bank compiler.

A **bank** is a Loom project compiled to a flat, versioned, engine-
agnostic instruction format. The authoring side (the Loom editor, the
`@loom/bank` compiler) produces banks; a **runtime** in each game engine
consumes them through one shared API. This is deliberately the Wwise
model: an authoring tool that builds banks, ID headers generated
alongside them, and a per-engine SDK that all speak the same contract.

There is exactly **one normative implementation of the semantics** — the
TypeScript reference interpreter in `bank/src/interp.ts`.
Every other runtime is validated against it by golden-trace conformance
(§8). When this document and the reference interpreter disagree, that is
a bug in one of them; say which you believe and fix both.

---

## 1. Why a new IR at all

The live TS engine (`core/src/runtime/sim/sim.ts`) walks parser AST nodes
with an explicit frame stack. That is the right shape for authoring — it
keeps source spans, so the editor can map a running line back to a
character offset — but it cannot ship into a game:

- A suspended choice's continuation holds **live `BodyItem` object
  references** (`sim.ts` `PendingChoice.continuation`), so it cannot be
  serialised. The event server works around this by persisting a command
  journal and replaying it (`core/server/store.ts`). A game needs real
  save/load.
- Expressions are stored as **un-parsed source strings** and re-parsed on
  every evaluation.
- Line text is **regex-scanned for `{expr}`** on every emission.

Flattening each beat into an instruction stream fixes all three: a
continuation becomes `(program, pc)` plus scalars, expressions are
pre-compiled, and interpolation is pre-split.

---

## 2. Architectural commitments

| Decision | Choice | Rationale |
|---|---|---|
| Program granularity | one flat stream per **beat** and per **hook body**. Nested bodies (conditional arms, choice options, dialogue blocks) are **inlined with jumps**, never separate programs | continuation is `(program, pc)` with zero indirection |
| Instruction encoding | fixed **4 × i32 words**: `[op, a, b, c]`, unused operands `-1`. `pc` is an *instruction index*, not a word offset | `pc += 1` in every language; `PackedInt32Array` in Godot; jump targets stay valid regardless of operand count |
| Speaker | resolved at **compile time** | speakers are lexically determined, so no runtime speaker stack and no push/pop opcodes |
| `<let:>` locals | compile-time slot allocation into a per-frame `locals[]` | scope restore on frame pop is free. **This is a behaviour change** — see §10.1 |
| Divert | **call** semantics: push a frame, caller resumes after | matches the live engine. Not Ink's goto — see §10.5 |
| Expressions | flat **RPN i32 stream** + shared constant pool | §5 |
| Choice menus | a menu suspends the **whole VM**; at most one pending menu | §10.13. A multi-participant host runs one VM per participant over a shared world |

### 2.1 Numbers are f64, everywhere

All Loom values are `null`, `bool`, `f64`, `string`, or `list`. There is
no integer type. Every runtime must reproduce:

- Division by zero yields IEEE `inf` / `-inf`; `0/0` yields `nan`.
  **GDScript's integer `/` and `%` do not do this** — runtimes must use
  float division and `fmod`.
- `%` is **truncated remainder** (C / C# / JS semantics), so
  `-7 % 3 == -1`, *not* `2`. GDScript's `%` on ints truncates the same
  way but errors on float operands; use `fmod`.
- `truthy(nan) == false`.
- An unknown function call evaluates to `null`, never an error.
- `null` coerces to `0` in arithmetic contexts.

A dedicated `arith` conformance scenario covers these; it is mandatory.

### 2.2 Number formatting is spec'd, not inherited

`display(number)` is used for line interpolation, `match` comparison, and
trace output, so three languages disagreeing on float printing would
break conformance for reasons unrelated to story logic. GDScript's
`str(float)`, C#'s `ToString()`, and C's `%g` all differ.

Normative: **ECMA-262 `Number::toString`** (radix 10) — i.e. exactly what
JavaScript's `String(n)` produces. This is chosen rather than invented
because the live engine's `display()` already is `String(n)`, so the bank
and the live `Sim` agree by construction.

In practice that means: integral values render as plain decimals with no
point and no exponent (up to `1e21`, above which exponent form kicks in);
non-integral values render as the **shortest decimal string that
round-trips** to the same f64; and the special values are `"NaN"`,
`"Infinity"`, `"-Infinity"` — note the capitalisation, which is JS's, not
C's.

Implementers: this is the Ryū / Grisu "shortest round-trip" algorithm
with JS's exponent thresholds. C# `double.ToString("R")` and Rust's
`{}` are close but differ at the thresholds; Godot's `str()` differs
more. Do not assume — the `float-format` scenario is what settles it.

Each runtime ships this as a shared helper, and a `float-format`
conformance scenario diffs it over adversarial values.

---

## 3. The instruction set

19 opcodes. `pc`-typed operands are instruction indices **within the same
program**. `-1` means absent.

| # | Op | a | b | c | Semantics |
|---|---|---|---|---|---|
| 0 | `NOP` | – | – | – | nothing |
| 1 | `NARRATE` | textId | – | – | emit `Line` with `speaker = 0` |
| 2 | `SPEAK` | speakerId | textId | – | emit `Line` with the resolved speaker |
| 3 | `JUMP` | pc | – | – | `pc = a` |
| 4 | `JUMP_IF_NOT` | exprId | pc | – | if `!truthy(eval(a))` then `pc = b` |
| 5 | `MATCH` | exprId | switchId | – | linear scan of `switches[b].cases`; jump the first hit, else `default`; `default = -1` falls through |
| 6 | `MENU` | menuId | – | – | build the visible option list, emit `Choice`, **suspend** |
| 7 | `EACH_VISIT` | siteId | tableId | – | `n = ++counter[site]`; jump `branches[min(n, len) - 1]` — the last present branch sticks |
| 8 | `AFTER` | siteId | exprId | elsePc | if latched or `truthy(eval(b))`, latch and fall through; else `pc = c` |
| 9 | `LET` | slot | exprId | – | `locals[a] = eval(b)` |
| 10 | `CLEAR_LOCALS` | slot | count | – | null out `locals[a .. a+b)` at lexical scope exit |
| 11 | `SET` | setId | – | – | apply `sets[a]`, emit `VarSet` |
| 12 | `SIGNAL` | verbId | exprId | – | enqueue a trigger (`<fire:>`) |
| 13 | `HOST` | verbId | argsId | mode | emit `Directive`; `mode` 0 = leaf, 1 = block-begin, 2 = block-end |
| 14 | `DIVERT` | targetId | argsId | – | resolve, push a frame, bump the visit counter, emit `BeatEnter` |
| 15 | `TUNNEL` | targetId | argsId | – | as `DIVERT`, but marks the pushed frame as a tunnel anchor |
| 16 | `RETURN` | – | – | – | pop frames through the nearest tunnel anchor; no anchor ⇒ behave as `END` |
| 17 | `END` | – | – | – | clear the whole frame stack and abandon the current drain |
| 18 | `HALT` | – | – | – | implicit terminator of every program; pops one frame |

Reserved, never emitted in v1 (the compiler raises a diagnostic
instead): `19 CALL_SLOT`, `20 SHUFFLE`.

### 3.1 Lowering — every `BodyItem` kind

The input is the parser AST (`core/src/parser/ast.ts`, `BodyItem`) after
`compileModel` has run its `is`-inheritance merge and derived-slot fill.

| `BodyItem.kind` | Lowering |
|---|---|
| `action`, no enclosing speaker | `NARRATE text` |
| `action`, under a speaker | `SPEAK speaker, text` — **unless** the trimmed text matches `^\(.*\)$`, in which case **nothing is emitted** and the text is recorded in `program.notes` at that pc. A bare parenthetical is a delivery note |
| `sceneHeading` | `NARRATE text` |
| `metadata` | nothing; recorded in `program.notes` |
| `slotPlaceholder` | never reaches the IR (derived-slot fill runs first). An unfilled hole is a compile error |
| `dialogue` | resolve the speaker, then emit the block body **inline** with that speaker pushed on the compiler's speaker stack. The block's `parenthetical` and `improv` go to `notes`, not to code |
| `conditional` | arm chain. For each arm with a condition: `JUMP_IF_NOT e, <next arm>` / body / `JUMP <end>`. An `<else>` arm emits no test. No matching arm falls through to `<end>` |
| `match` | `MATCH e, switchId`; each arm body ends `JUMP <resume>`; an `_` arm becomes `default` |
| `eachVisit` | `EACH_VISIT site, tableId` where `branches` holds the pcs of the **present** branches in `[first, then, finally]` order (absent ones omitted); each ends `JUMP <resume>` |
| `afterMorph` | `AFTER site, e, <elsePc>` / after-body / `JUMP <end>` / else-label / otherwise-body / end-label |
| `inlineLet` | `LET slot, e`; a `CLEAR_LOCALS slot, n` at lexical scope exit. Reads of that name **within the scope** compile to `E_LOCAL slot`, not `E_PATH` |
| `directive`, native `set` | `SET setId`. The `<set:>` body is parsed at compile time; the path is a list of name ids |
| `directive`, native `fire` | `SIGNAL verbId, -1`. The argument is a name and is **not** interpolated |
| `directive`, pass-through | `HOST verbId, argsId, 0` with args pre-parsed per §6 |
| `directiveBlock` | `HOST verb, args, 1` / body inline / `HOST verb, -1, 2` |
| `choice` (a **run** of consecutive choices) | one `MENU`. Option bodies are inlined at their `target` pc and each ends `JUMP menu.resume`. Consecutive `choice` siblings coalesce into one menu; the first non-choice sibling is `resume` |
| `divert` `to` | `DIVERT target, args` |
| `divert` `tunnel` | `TUNNEL target, -1` |
| `divert` `return` | `RETURN` |
| `divert` `end` | `END` |

### 3.2 What the flat form cannot express

1. **Interleaved pending choices.** The live engine queues N pending
   choices per person and keeps draining later triggers while one is
   unanswered. A single instruction pointer cannot. v1: one VM is one
   narrative thread, `MENU` suspends everything, and queued triggers
   persist across `choose()`. A multi-participant host runs one VM per
   participant over a shared world. See §10.13.
2. **Divert `slots:`** — passing a *body* to a callee. Needs callee-side
   `CALL_SLOT` sites; reserved, v1 diagnostic.
3. **`scopeAs`** (`-> beat as x`) implies a fresh binding namespace, not
   one extra binding. v1 lowers it to one extra binding and warns.
4. **`improv` blocks** are live-performance gating, not narrative control
   flow. Compiled to `notes`.
5. **Generators** stay a data table driven by `tick`, not a program.

---

## 4. VM state

```
Frame {
  program:      u32          // index into programs[]
  pc:           u32          // instruction index
  locals:       Value[]      // sized by program.localCount
  bindings:     [(nameId, string)]
  setting:      nameId | -1  // the room this frame's lines happen in
  cast:         nameId | -1  // SELF/ME fallback
  tunnelAnchor: bool
  subject:      string       // "" in single-player
}

VM {
  frames:       Frame[]
  world:        { values: Map<string,Value>, collections: Map<string,Value> }
  counters:     Map<siteKey, u32>     // visit + each-visit counts
  latches:      Set<siteKey>          // <after:> sites that have fired
  taken:        Set<optionKey>        // once-only choices already chosen
  pendingMenu:  { program, menu, subject } | null
  triggers:     Deque<Trigger>
  programQueue: Deque<(program, bindings)>
  elapsedMs:    f64
  timers:       Map<hookKey, f64>
  rng:          u64
  diagnostics:  Diagnostic[]
}
```

`setting` inheritance on `DIVERT`: the callee's own `setting` wins; a
setting-less callee **inherits the caller's**, so a sub-beat continues in
the same room. `cast` comes from the callee's program header.

Every field is a primitive or a flat array of primitives. `save()` is a
structural dump — there is no object graph anywhere in this state.

### 4.1 The world is two-tier

`World.get(path)` resolves in this order:

1. a frame-local slot, if the compiler bound the name to one;
2. the binding-expanded path in `values`;
3. `collections`;
4. `null`.

Bindings substitute **per path segment**, so with `self → "Wren"` the
path `self.trust` resolves to `Wren.trust`. A binding value containing a
`.` would silently produce extra segments; that is rejected at the API
boundary (§7) with an `Error` step.

v1 engine banks never populate `collections`, but the two-tier lookup is
mandatory so the same runtime can serve a multi-participant host later
without a rewrite.

---

## 5. Expressions — RPN

Expressions compile to a flat `i32` array (`exprCode`), with each
expression a `{at, len}` window into it. Operands follow their opcode
inline.

### 5.1 Why RPN and not a tree

GDScript has no tagged unions, so a tree IR means one `Dictionary` per
node plus recursion — the slowest available shape in GDScript. RPN is a
single `while` loop over a `PackedInt32Array` with an explicit value
stack. C++ and C# get a zero-allocation loop over contiguous ints. And a
flat int array hashes identically across engines, so the conformance
harness can digest expression tables directly. The only cost is two
short-circuit opcodes.

### 5.2 E-ops

| # | Op | operands | Semantics |
|---|---|---|---|
| 1 | `E_NULL` | – | push `null` |
| 2 / 3 | `E_TRUE` / `E_FALSE` | – | push a bool |
| 4 | `E_NUM` | k | push `exprConsts.nums[k]` |
| 5 | `E_STR` | k | push `strings[k]` |
| 6 | `E_PATH` | p | expand `paths[p].segs` through bindings, join with `.`, `World.get` |
| 7 | `E_LOCAL` | slot | push `frame.locals[slot]` |
| 8 | `E_LIST` | n | pop n values into a list |
| 9 / 10 | `E_NEG` / `E_NOT` | – | unary |
| 11–15 | `E_ADD` `E_SUB` `E_MUL` `E_DIV` `E_MOD` | – | arithmetic per §2.1; `E_ADD` concatenates via `display` when either side is a string |
| 16–21 | `E_EQ` `E_NE` `E_LT` `E_LE` `E_GT` `E_GE` | – | comparison |
| 22 | `E_JF_POP` | rel | peek: falsey ⇒ replace top with `false` and `ip += rel`; else pop |
| 23 | `E_JT_POP` | rel | peek: truthy ⇒ replace top with `true` and `ip += rel`; else pop |
| 24 | `E_TOBOOL` | – | pop, push `truthy(v)` |
| 25 | `E_CALL` | nameId, argc | pop argc args, dispatch |
| 26 | `E_COMP` | slot, vAt, vLen, fAt, fLen | list comprehension over sub-ranges of `exprCode` |

`and` / `or` lower to `<lhs> E_JF_POP r <rhs> E_TOBOOL`. Note this
reproduces the live engine exactly: **short-circuit yields a bool, not
the surviving operand.**

### 5.3 Builtins

`count(list)` and `visits(beat)` are native. Anything else is dispatched
to the host and returns `null` if unhandled — an unknown call is never an
error.

---

## 6. Directive arguments are pre-parsed

Pass-through directives use the argument convention that the show-control
bridge already defines (see `loom-show-control.md`): top-level
comma-separated segments, a bare segment is a positional target, and
`key: value` is a named argument, respecting quotes and brackets.

**All of that parsing happens at compile time.** A bank stores:

```json
{ "verb": 17, "positional": [9], "named": [{ "key": 18, "text": 10 }], "raw": 11 }
```

Every value is a `textId`, so interpolation inside an argument is
pre-split too. A runtime never sees a comma, a quote, or a colon. This is
the single biggest reason a GDScript runtime stays small.

---

## 7. The runtime API

Every engine implements exactly this surface. Names follow each
language's convention (`snake_case` in GDScript, `PascalCase` in C#);
semantics are identical.

```
// banks
load_bank(data) -> bool
unload_bank(bank_id) -> bool
is_loaded(bank_id) -> bool
set_locale(tag)                  // "" = the source locale

// execution — pull model
start(program_id, bindings)      // clears frames, pushes one
advance() -> Step                // exactly one Step per call
choose(index) -> bool            // false if invalid or no menu pending
is_waiting() -> bool

// state
get(path) -> Value
set(path, value)
visits(program_id) -> int

// reactivity
signal(verb_id, subject, filter)
tick(dt_ms)

// persistence
save() -> bytes
load(bytes) -> LoadResult

// diagnostics
drain_diagnostics() -> Diagnostic[]
```

### 7.1 `Step`

```
BeatEnter { program, name, setting, subject }
Line      { speaker, display, text, setting, program, note }   // speaker == 0 ⇒ narration
Choice    { menu, options: [{ index, text, tag }] }
Directive { verb, verb_name, positional[], named{}, raw, block }
VarSet    { path, value }
Signal    { verb, subject }
Idle      { }        // nothing runnable; the host may tick or signal
Done      { }        // frames empty, queues drained
Error     { code, message }
```

One `Line` covers both narration and dialogue (`speaker == 0` means
narration) because every host renders them through the same widget, and
it halves the conformance surface.

**Directives are `Step`s, not host callbacks.** Callback ergonomics
diverge badly across GDScript signals, C# events, and UE delegates, and
callbacks invite reentrancy — a host mutating state from inside a
directive handler. A value-returning `advance()` is byte-identically
implementable in all three, *and it is literally the golden trace*. Each
runtime may layer an idiomatic push API on top; the pull API is the
normative one.

### 7.2 `advance()` — normative algorithm

1. If a menu is pending, return `Idle`.
2. If `frames` is non-empty, execute instructions until one produces a
   `Step`, and return it. `HALT` pops a frame; if that empties `frames`,
   continue at 3.
3. If `programQueue` is non-empty, dequeue, push a frame, return
   `BeatEnter`.
4. If `triggers` is non-empty, dequeue one, match hooks in the bank's
   frozen order, enqueue matched hook programs, and go to 3. A
   10 000-iteration backstop emits `Error{code: "drainOverflow"}` and
   stops rather than throwing.
5. Return `Done`.

### 7.3 Save / load

`save()` serialises the whole VM state from §4 plus each loaded bank's
`sourceHash` (locale banks included, in load order). Every leaf is a
`u64` hex string, an int, a float, a string, or a tagged `Value`. The
`shuffles` section carries the per-site PRNG states (§10 item 10).

`load()` compares each bank's `sourceHash`. On mismatch it returns
`{ ok: false, reason: "bankChanged", bank }` unless the host opts into
migration. **Migration is not pc-preserving** — pcs are meaningless
across a recompile. It restores `world`, `counters`, `latches` and
`taken` (all structurally keyed, so they survive content edits) and
**discards frames, the pending menu, and the queues**, leaving the host
to `start()` at a checkpoint. This is the most common shipping surprise
with a format like this; it is called out here so it is a decision rather
than a discovery.

### 7.4 Site keys must be structural

Visit counters, `<after:>` latches, and once-only choice records are
persisted, so their keys must survive content edits. A key is a hash of
`(program name, structural path within the body)` — e.g.
`opening/body/7/arm0/2` — **never** a source ordinal.

Consequence, worth documenting for authors: inserting a sibling *between*
existing ones is safe, but **reordering siblings invalidates their
keys**.

---

## 8. Bank files

JSON is the **normative** encoding — conformance diffs against it. A
byte-identical binary re-encoding (header + section table over the same
arrays) is the ship format and is not yet specified.

### 8.1 Header

```json
{
  "loomBank": 1,
  "bankName": "lighthouse",
  "bankId": "7b1e4a0c9f22d5e1",
  "kind": "content",
  "locale": null,
  "requires": ["core"],
  "matchMode": "value",
  "seed": "8f3a…16-hex u64…",
  "compiler": { "version": "0.1.0", "sourceHash": "sha256:…" },
  "entry": 0
}
```

`seed` is the `<shuffle:>` PRNG seed (§10 item 10), derived from the
source hash.

### 8.2 Sections

| Section | Contents |
|---|---|
| `names[]`, `nameHashes[]` | parallel arrays. Opcodes address the dense index; the 64-bit hash is the host-facing and cross-bank identity |
| `strings[]` | raw string literals |
| `texts[]` | `{ parts: [{k:"lit",s} \| {k:"expr",e}], loc }` — interpolation **pre-split**. `loc` is the locale-bank join key |
| `exprConsts`, `exprCode[]`, `exprs[]`, `paths[]` | §5 |
| `sets[]` | `{ path, op, expr, enum }` |
| `speakers[]` | `{ mode: "lit" \| "self", ids, display }` |
| `directiveArgs[]` | §6 |
| `targets[]` | `{kind:"local",program}` \| `{kind:"owned",qualifier,name,flat}` \| `{kind:"extern",hash}` |
| `menus[]` | `{ resume, options: [{ text, cond, sticky, suppressed, target, tag }] }` |
| `switches[]`, `visitTables[]`, `argTables[]` | jump tables |
| `programs[]` | `{ name, hash, kind, params, localCount, setting, cast, siteBase, siteCount, code[], notes[] }` |
| `entities` | `{ kinds{}, tables[{ id, kind, fields }] }` — typed-slot defaults plus the identity seed |
| `hooks[]` | `{ owner, ownerKind, verb, param, filter, timer, program, order }` |
| `verbs[]`, `signals[]`, `globals{}`, `gens[]` | registries and data |

`speakers[].mode == "self"` resolves at runtime: the `self` binding
upper-cased, else the frame's `cast` upper-cased, else the literal token.

`targets[].kind == "owned"` mirrors the live resolver: try
`<owner>.<name>` — rebinding `self` when the owner is foreign, so the
target speaks as its true owner — else fall back to the bare global
program, else raise a diagnostic.

### 8.3 Bank kinds and loading

| Kind | Contents | Rules |
|---|---|---|
| **init** | project-wide `names` / `nameHashes`, `verbs`, `signals`, `entities`, `globals`, `gens`, and the program directory (`program hash → owning bank`). No code, no texts | loaded first, never unloaded. Seeds the world with entity identity strings and defaults |
| **content** | self-contained code + all side tables. Its `names` is a *local* dense table; `nameHashes` is the join to the init bank | `load_bank` registers each program hash and each hook; unload reverses both |
| **locale** | `texts` overrides keyed by `loc`, plus the locale bank's **own `strings` table** for the literal parts (expression parts reference the content bank's ids) | `set_locale` swaps the active override map with no code reload. A translated string must reference the **same** expression ids as its source — the compiler validates this, so a translator cannot invent an interpolation. Unmatched keys fall back |

**Locale emission** (landed 2026-07-25): `loom-bank strings <bank>`
emits the translator's template — every localisable `loc` key mapped to
its source text with each interpolation as an ordinal `{0}`/`{1}`
placeholder (source order; literal braces escape as `{{`/`}}`). The
translated copy of that file feeds
`loom-bank build … --locale <tag>=<file>` (repeatable), which validates
each entry — reordering placeholders is fine, inventing or dropping one
is a `badTranslation` error, an unknown key is a warning — and writes
`<name>.<tag>.loombank` beside the content bank. At runtime,
`load_bank` recognises `kind: "locale"` and registers the override map;
`set_locale(tag)` activates it per render, so partial translations ship
and fall back per key.

**Cross-bank diverts.** An `extern` target carries the destination's
64-bit program hash. On `DIVERT`: resolve through the program map; on a
miss, consult the init bank's directory and emit
`Error{code:"bankNotLoaded", bank}` **without advancing past the
divert**, so the host can `load_bank` and re-call `advance()` to retry.
A miss in the directory too is `Error{code:"unresolvedTarget"}`. A
missing bank is a loud, recoverable error — never a silent skip — which
makes streaming load-on-demand a two-line host pattern.

**Unloading** returns `false` and does nothing if any live frame, the
pending menu, or any queued program belongs to that bank. World
variables, counters, latches and taken-sets survive unload (they are
keyed by string path or structural hash, not by bank), so unloading and
reloading a chapter preserves what was already visited and chosen.

---

## 9. IDs

**FNV-1a 64** — offset basis `0xcbf29ce484222325`, prime
`0x100000001b3` — over the UTF-8 bytes of the NFC-normalised,
case-preserved name.

64-bit rather than Wwise's 32: at roughly 10 000 names, 32-bit carries a
~1.2 % chance of at least one collision per project, and a collision here
would silently reroute a divert. 64-bit brings that to ~3e-12, and costs
nothing in the instruction stream because opcodes address the dense
`nameId` table — the hash is only an external identity.

- A collision between two distinct names is a **hard compile error**.
- Two names differing only by case raise a **warning**, because `SELF`
  resolution upper-cases ids at runtime.
- IDs serialise as **16-character lowercase hex**; JSON numbers cannot
  represent u64 exactly.

### 9.1 Generated ID headers

One codegen pass emits `LoomIDs.gd`, `LoomIDs.cs`, and `LoomIDs.h`, so
game code names a beat or signal symbolically and a rename breaks the
build instead of failing silently at runtime.

Identifiers are the upper-snake of the name with non-alphanumerics
replaced by `_`, prefixed by kind (`PROGRAM_`, `SIGNAL_`, `VERB_`,
`ENTITY_`). A munging collision gets a `_2` suffix and a warning.

**GDScript caveat:** its ints are *signed* 64-bit and a literal ≥ 2^63 is
a parse error, so the GDScript header emits signed decimals with the hex
in a trailing comment. Never print these as unsigned.

---

## 10. Divergences from the live engine

The flat IR implements several things the AST-walking engine currently
does not, so a bank plays *more* of the authored language than the live
`Sim` does. Each is a deliberate, tested decision.

1. **`<let:>` becomes frame-local.** Today it writes the global world, so
   a binding leaks into diverted beats. The compiler emits a warning when
   a `<let:>`-only name is read from another program, pointing at
   `<set:>` as the fix.
2. **`END` / `RETURN` / `TUNNEL` actually work.** Today the divert branch
   breaks out of its `switch`, not the executor loop, so `-> END` is a
   no-op and execution *continues*. Implementing it truncates beats that
   have been running past an `-> END`; audit the corpus before shipping.
3. **`<each visit>` runs `then` / `finally`.** Today only `first` ever
   runs. This changes every revisit line in every existing story — a fix,
   but a visible one.
4. **`<after:>` latches.** The writer's guide promises "permanently";
   today it re-evaluates each pass. Note latches grow save size linearly
   in the number of `<after:>` sites reached.
5. **A divert is a call, not a goto.** `-> next` pushes a frame and the
   caller's remaining lines play afterwards. This is preserved for
   compatibility, but it will surprise anyone with Ink priors. A tail-goto
   form (`->>`) is a candidate for v1.1.
6. **`match` compares typed values.** Today the *raw source text* of an
   arm is compared against `display(value)`, so a quoted arm never
   matches. v1 compiles arm patterns to typed literals; the header's
   `matchMode` may be set to `"display"` to pin the old behaviour for one
   release.
7. **Choice `sticky` / `suppressed` are honoured.** Today both are
   ignored. A once-only option is removed after it is taken, and
   `suppressed` text renders in place of the option's label afterwards.
   A menu whose options are all exhausted emits `Idle` once and then
   continues at `menu.resume` — **a menu is never a dead end.**
8. **Hook dispatch order is frozen.** Today it follows map insertion
   order, which three runtimes would not agree on. Banks store an
   explicit `order`, sorted by `(owner name hash, source index)`. Note
   this *changes* today's order wherever declaration order differs.
9. **`directiveBlock` gains real scoping.** `HOST` block-begin /
   block-end brackets the body. A host that ignores `block` leaks
   whatever it opened, so each runtime ships a base implementation
   maintaining a scope stack, making the common case correct with no host
   code.
10. **`<shuffle:>` runs on a spec'd PRNG** (landed 2026-07-25 — the
    live `Sim` still treats it as an unknown directive). The generator
    is **xorshift64\***: per site, state seeds from
    `bank.seed ^ fnv1a64(siteKey)` (the FNV offset basis substitutes
    for a zero seed — xorshift is stuck at zero); each execution steps
    the state once (`x ^= x >> 12; x ^= x << 25; x ^= x >> 27`, u64
    wrap) and stores the **pre-multiply** state; the selection is the
    multiplied output's (`state * 0x2545F4914F6CDD1D`) **top 32 bits
    mod n**, computable in non-negative arithmetic on signed-int
    runtimes. `bank.seed` is a header field (16-hex u64, derived from
    the source hash — a recompile reshuffles, which is safe because a
    recompile invalidates saves anyway). States persist in the save
    under `shuffles` as `[siteKey:subject, hex16]` pairs, keyed like
    counters, so they survive migration and a replayed site continues
    its sequence. Lowering mirrors `eachVisit`: `SHUFFLE site, table`
    over a `visitTables` jump table, one branch per variant, each a
    line spoken by the enclosing dialogue speaker (else narration).

Visit counts are keyed by `(beat, subject)`. In a single-player game the
subject is always `""`; the field stays in the IR and the save format so
one bank can serve both a game engine and a multi-participant host.

---

## 11. Conformance

Three hand-written runtimes stay in agreement only because this is
enforced mechanically. It is not optional.

### 11.1 Scenario scripts

A scenario is a line-oriented driver script:

```
locale
start opening
run                 # advance until Choice, Idle, or Done
choose 0
signal lamp_lit ""
run
tick 1000
save                # snapshot + digest
load                # round-trip; the digest must match
run
```

Commands: `start <name> [k=v …]`, `run`, `advance <n>`, `choose <i>`,
`signal <verb> <subject> [filter]`, `set <path> <literal>`, `tick <ms>`,
`save`, `load`, `loadbank <file>`, `unloadbank <name>`, `locale <tag>`.

### 11.2 Golden traces

JSONL, two record types — one per emitted `Step`, and one per driver
command carrying a digest:

```jsonl
{"i":0,"step":"beat","program":"c3d1…","name":"opening","setting":"9a03…","subject":""}
{"i":1,"step":"line","speaker":0,"text":"The stair smells of paraffin and salt."}
{"cmd":"choose 0","digest":"sha256:4f10bb…"}
```

Canonicalisation is normative, or the diff is noise: keys sorted
lexicographically, no whitespace, UTF-8, absent optional fields
**omitted rather than null**, ids as 16-char lowercase hex, numbers via
§2.2. `digest` is SHA-256 over the canonicalised `save()` blob, taken
after every driver command — so save/load divergence is caught, not just
output divergence.

Each runtime writes traces with its own canonical serialiser. Godot's
`JSON.stringify` cannot be used: it is insertion-ordered and formats
floats differently.

### 11.3 Running it

```
godot --headless --path conformance/godot --script res://run.gd -- \
      --bank out/lighthouse.lbank --script trace/lighthouse.script --out /tmp/godot.jsonl
loom-bank diff golden/lighthouse.jsonl /tmp/godot.jsonl
```

The differ reports the first divergent line with surrounding context and,
on a digest mismatch, structurally diffs the two save blobs — so a
failure names *which* counter or world key drifted instead of showing two
unequal hashes.

Goldens are generated only by an explicit `--regen-goldens` flag and are
committed. A change that moves a golden must say why.

### 11.4 Mandatory scenarios

`float-format` and `arith` (§2.1, §2.2) are required for every runtime,
independent of story content. A later fuzz layer — seeded random command
sequences run through every runtime and diffed, with divergent seeds
minimised into fixed scenarios — is what actually catches save/load bugs;
fixed scripts miss them.

---

## 12. Layout

```
bank/                          @loom/bank — compiler + reference interpreter
  src/ir.ts                    IR types, format + ABI versions
  src/ids.ts                   FNV-1a 64, collision detection
  src/intern.ts                string table, interpolation splitting
  src/expr-compile.ts          Expr AST → RPN
  src/compile.ts               SimModel → Bank
  src/interp.ts                the reference interpreter (normative)
  src/trace.ts                 scenario driver + golden traces
  src/headers.ts               LoomIDs.{gd,cs,h} codegen
  bin/loom-bank.ts             build / trace / diff / inspect
engines/godot/                 the Godot addon + demo + conformance runner
```

The compiler consumes `@loom/core`'s `compileModel`, so `is`-inheritance
merging, derived-slot filling, and hook lowering are shared rather than
reimplemented.
