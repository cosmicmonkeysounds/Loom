//! Keyword statements (Loom 4 §6) — instructions without brackets.
//!
//! A line that starts with a known lowercase verb is an instruction to
//! the runtime. The lexer lowers every such line onto the *existing*
//! directive AST (`if coins > 5:` → the directive text `if: coins > 5`),
//! so the parser, the sim, the bank compiler, and the story graph see
//! exactly what a `<if: coins > 5>` line produced in v3. This module is
//! the single table the lexer and every editor surface dispatch on.

/** How a verb's arguments map onto the directive text. */
type Shape =
  /** `verb:` opens a block; `verb X:` → `verb: X`. Trailing colon required. */
  | { kind: "block" }
  /** `verb` alone (no arguments). */
  | { kind: "bare" }
  /** `verb X` → `verb: X`; `test` must accept X or the line is prose. */
  | { kind: "args"; test?: RegExp; rename?: string }
  /** `do verb args` → `verb: args`. */
  | { kind: "do" };

const TO = /^\S+\s+to\s+\S+/u;
const FROM = /^\S+\s+from\s+\S+/u;
const FROM_TO = /^\S+\s+from\s+\S+\s+to\s+\S+/u;
const AS = /^\S+\s+as\s+\S+/u;
/** `broadcast cue to scope` or the block form `broadcast to scope:`. */
const SCOPED = /^(to\s+\S|\S.*\s+to\s+\S)/u;
const CALL = /^[A-Za-z_][A-Za-z0-9_.]*(\(.*\))?$/u;
const WAIT = /^(until\s+\S|\d)/u;
const FLASH = /^[A-Za-z_]+(\s*,\s*\d+[a-z]*)?$/u;
const GOAL = /^[A-Za-z_][A-Za-z0-9_./]*\s+[a-z]+$/u;
const INTO = /^[A-Za-z_][A-Za-z0-9_.]*(\s+(into|from)\s+\S+)?$/u;
const ENROLL = /^\S+\s+(to|→|->|into)\s+\S+/u;
const ASSIGN = /^[A-Za-z_][A-Za-z0-9_.]*\s*([+\-*/]?=)(?!=)/u;
const SINGLE_NAME = /^[A-Za-z_][A-Za-z0-9_.\-]*(\s+with\s+.+)?$/u;
/** `fire name` / `fire name for subject` / `fire name with k: v`. */
const EVENT = /^[A-Za-z_][A-Za-z0-9_.\-]*(\s+(for|with)\s+.+)?$/u;
/** A name of one word, or several words each Capitalised (`The Society`). */
const NAME_WORDS = /^[A-Za-z_][A-Za-z0-9_.'\-]*(\s+[A-Z][A-Za-z0-9_.'\-]*)*$/u;
const HAS_BAR = /\|/u;

/**
 * Every statement verb with the shape that tells it from prose. Multi-word
 * verbs (`else if`, `each visit`) are matched longest-first.
 */
export const STATEMENTS: ReadonlyArray<[verb: string, shape: Shape]> = [
  // Flow (syntactic forms — parsed structurally by the parser).
  ["else if", { kind: "block" }],
  ["each visit", { kind: "block" }],
  ["if", { kind: "block" }],
  ["else", { kind: "block" }],
  ["match", { kind: "block" }],
  ["after", { kind: "block" }],
  ["otherwise", { kind: "block" }],
  // Memory.
  ["set", { kind: "args", test: ASSIGN }],
  // Variety.
  ["cycle", { kind: "args", test: HAS_BAR }],
  ["shuffle", { kind: "args", test: HAS_BAR }],
  // Stagecraft.
  ["cue", { kind: "args", test: SINGLE_NAME }],
  ["sfx", { kind: "args", test: SINGLE_NAME }],
  ["sound", { kind: "args", test: SINGLE_NAME, rename: "sfx" }],
  ["pause", { kind: "bare" }],
  ["flash", { kind: "args", test: FLASH }],
  ["anchor", { kind: "args", test: SINGLE_NAME }],
  // Events.
  ["fire", { kind: "args", test: EVENT }],
  ["broadcast", { kind: "args", test: SCOPED }],
  ["reply", { kind: "args", rename: "respond" }],
  ["respond", { kind: "args" }],
  // World.
  ["move", { kind: "args", test: TO }],
  ["add", { kind: "args", test: TO }],
  ["remove", { kind: "args", test: FROM }],
  ["reveal", { kind: "args", test: NAME_WORDS }],
  ["cast", { kind: "args", test: AS }],
  ["promote", { kind: "args", test: TO }],
  ["demote", { kind: "args", test: NAME_WORDS }],
  ["goal", { kind: "args", test: GOAL }],
  // Coroutines.
  ["spawn", { kind: "args", test: NAME_WORDS }],
  ["run", { kind: "args", test: CALL }],
  ["cancel", { kind: "args", test: NAME_WORDS }],
  ["wait", { kind: "args", test: WAIT }],
  // Legacy live verbs (kept as conveniences — Loom 4 §12).
  ["capture", { kind: "args", test: INTO }],
  ["release", { kind: "args", test: INTO }],
  ["escape", { kind: "args", test: NAME_WORDS }],
  ["join", { kind: "args", test: TO }],
  ["defect", { kind: "args", test: FROM_TO }],
  ["betray", { kind: "args", test: TO }],
  ["enroll", { kind: "args", test: ENROLL }],
  // Escape hatch for custom verbs.
  ["do", { kind: "do" }],
];

/** The verbs, longest first (for prefix matching). */
export const STATEMENT_VERBS: readonly string[] = STATEMENTS.map(([v]) => v).sort(
  (a, b) => b.length - a.length,
);

/** Verbs that open an indented block (end with a colon). */
export const BLOCK_STATEMENTS: readonly string[] = STATEMENTS.filter(
  ([, s]) => s.kind === "block",
).map(([v]) => v);

/**
 * Lower a keyword statement to directive text, or return null when the
 * line is not a statement (and is therefore prose). Never diagnoses:
 * a verb that fails its shape is simply prose, by design (§6.2).
 */
export function statementToDirective(line: string): string | null {
  for (const [verb, shape] of STATEMENTS) {
    if (!line.startsWith(verb)) continue;
    const after = line.slice(verb.length);
    // The verb must end at a word boundary: a space, a colon, or the end.
    if (after.length > 0 && after[0] !== " " && after[0] !== ":") continue;
    const rest = after.trim();
    switch (shape.kind) {
      case "block": {
        // `else` / `otherwise` / `each visit` may stand bare; every block
        // opener must end with its colon (`if x:`), which is stripped.
        if (rest === "" || rest === ":") return verb;
        if (!rest.endsWith(":")) return null;
        const args = rest.slice(0, rest.length - 1).trim();
        return args.length === 0 ? verb : `${verb}: ${args}`;
      }
      case "bare":
        return rest.length === 0 ? verb : null;
      case "args": {
        if (rest.length === 0) return null;
        if (rest.startsWith(":")) return null; // `set: x` is v3 inner text, not a statement
        // `broadcast to scope:` opens a block — the trailing colon is syntax.
        const args = verb === "broadcast" && rest.endsWith(":") ? rest.slice(0, -1).trim() : rest;
        if (shape.test !== undefined && !shape.test.test(args)) return null;
        return `${shape.rename ?? verb}: ${args}`;
      }
      case "do": {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/u.exec(rest);
        if (m === null) return null;
        const args = m[2]!.trim();
        return args.length > 0 ? `${m[1]}: ${args}` : m[1]!;
      }
    }
  }
  return null;
}
