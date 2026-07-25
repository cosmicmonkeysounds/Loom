//! The bank IR — types, versions, and the two opcode tables.
//!
//! Normative spec: `docs/loom-banks.md`. This file is the
//! machine-readable half of it; when the two disagree, one of them is a
//! bug.
//!
//! Const objects rather than TS `enum`s throughout, matching the rest of
//! the workspace (`erasableSyntaxOnly` forbids runtime enum syntax).

/** Bumped when the on-disk shape changes incompatibly. */
export const BANK_FORMAT_VERSION = 1;
/** Bumped when the runtime API contract changes incompatibly. */
export const BANK_ABI_VERSION = 1;

// ---------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------

/**
 * Every instruction is four `i32` words — `[op, a, b, c]`, unused
 * operands `-1`. `pc` is an *instruction* index, so `pc += 1` steps one
 * instruction in every language and a jump target stays valid however
 * many operands its instruction happens to use.
 */
export const WORDS_PER_INSTRUCTION = 4;

export const Op = {
  Nop: 0,
  Narrate: 1,
  Speak: 2,
  Jump: 3,
  JumpIfNot: 4,
  Match: 5,
  Menu: 6,
  Let: 9,
  ClearLocals: 10,
  Set: 11,
  Signal: 12,
  Host: 13,
  Divert: 14,
  Tunnel: 15,
  Return: 16,
  End: 17,
  Halt: 18,
  /** Reserved — the compiler diagnoses instead of emitting these. */
  CallSlot: 19,
  Shuffle: 20,
  EachVisit: 7,
  After: 8,
} as const;
export type Op = (typeof Op)[keyof typeof Op];

/** Human-readable opcode names, for `inspect` output and diagnostics. */
export const OP_NAMES: Record<number, string> = {
  0: "NOP",
  1: "NARRATE",
  2: "SPEAK",
  3: "JUMP",
  4: "JUMP_IF_NOT",
  5: "MATCH",
  6: "MENU",
  7: "EACH_VISIT",
  8: "AFTER",
  9: "LET",
  10: "CLEAR_LOCALS",
  11: "SET",
  12: "SIGNAL",
  13: "HOST",
  14: "DIVERT",
  15: "TUNNEL",
  16: "RETURN",
  17: "END",
  18: "HALT",
  19: "CALL_SLOT",
  20: "SHUFFLE",
};

/** `HOST` mode operand — how a directive brackets its body. */
export const HostMode = { Leaf: 0, BlockBegin: 1, BlockEnd: 2 } as const;
export type HostMode = (typeof HostMode)[keyof typeof HostMode];

// ---------------------------------------------------------------------
// Expression opcodes (RPN)
// ---------------------------------------------------------------------

/**
 * Expressions are a flat `i32` stream with operands inline. RPN rather
 * than a tree because GDScript has no tagged unions — a tree means a
 * `Dictionary` per node plus recursion, the slowest available shape —
 * whereas this is one `while` loop over a `PackedInt32Array`.
 */
export const EOp = {
  Null: 1,
  True: 2,
  False: 3,
  Num: 4,
  Str: 5,
  Path: 6,
  Local: 7,
  List: 8,
  Neg: 9,
  Not: 10,
  Add: 11,
  Sub: 12,
  Mul: 13,
  Div: 14,
  Mod: 15,
  Eq: 16,
  Ne: 17,
  Lt: 18,
  Le: 19,
  Gt: 20,
  Ge: 21,
  /** Short-circuit: peek, and on falsey replace the top with `false`. */
  JumpFalsePop: 22,
  /** Short-circuit: peek, and on truthy replace the top with `true`. */
  JumpTruePop: 23,
  ToBool: 24,
  Call: 25,
  Comprehension: 26,
} as const;
export type EOp = (typeof EOp)[keyof typeof EOp];

/** Operand-word count for each e-op, so a walker can skip correctly. */
export const EOP_ARITY: Record<number, number> = {
  1: 0,
  2: 0,
  3: 0,
  4: 1,
  5: 1,
  6: 1,
  7: 1,
  8: 1,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 0,
  16: 0,
  17: 0,
  18: 0,
  19: 0,
  20: 0,
  21: 0,
  22: 1,
  23: 1,
  24: 0,
  25: 2,
  /** slot, valueLen, filterLen — the sub-programs follow inline. */
  26: 3,
};

// ---------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------

/** A tagged value literal, as it appears in a bank's data tables. */
export type BankValue =
  | { t: "null" }
  | { t: "bool"; v: boolean }
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "list"; v: BankValue[] };

/**
 * One renderable line, pre-split so no runtime ever scans for `{…}`.
 * `loc` is the stable locale-bank join key (a structural hash, not an
 * ordinal — see the spec's site-key rule).
 */
export interface TextEntry {
  parts: Array<{ k: "lit"; s: number } | { k: "expr"; e: number }>;
  loc?: string;
}

/** A window into the shared `exprCode` array. */
export interface ExprRef {
  at: number;
  len: number;
}

/** A dotted path as name ids, expanded through bindings at eval time. */
export interface PathEntry {
  segs: number[];
}

/** A compiled `<set:>` — its body is parsed once, here, not per eval. */
export interface SetEntry {
  path: number;
  op: "=" | "+=" | "-=" | "*=" | "/=";
  expr: number;
  /**
   * A bare-identifier right-hand side doubles as a string literal when
   * it resolves to nothing (`<set: g.faction = Mods>`). Holds that
   * fallback's string id, or `-1`.
   */
  enum: number;
}

/**
 * A resolved speaker. `mode: "self"` stays dynamic — `SELF`/`ME` depend
 * on who routed into the beat, so they resolve against the frame.
 */
export interface SpeakerEntry {
  mode: "lit" | "self";
  ids: number[];
  display: number;
}

/** A pass-through directive's arguments, parsed at compile time. */
export interface DirectiveArgsEntry {
  verb: number;
  positional: number[];
  named: Array<{ key: number; text: number }>;
  raw: number;
}

export type TargetEntry =
  | { kind: "local"; program: number }
  | { kind: "owned"; qualifier: string | null; name: number; flat: number }
  | { kind: "extern"; hash: string };

export interface MenuOption {
  text: number;
  /** Guard expression id, or `-1` for an unconditional option. */
  cond: number;
  sticky: boolean;
  /** Text shown in place of the label once taken, or `-1`. */
  suppressed: number;
  target: number;
  /** Structural key — what `taken` records, so it survives edits. */
  tag: string;
}

export interface MenuEntry {
  resume: number;
  options: MenuOption[];
}

export interface SwitchEntry {
  cases: Array<{ lit: BankValue; target: number }>;
  default: number;
}

export interface VisitTableEntry {
  /** pcs of the *present* branches, in `[first, then, finally]` order. */
  branches: number[];
  resume: number;
}

export interface ArgTableEntry {
  binds: Array<{ name: number; expr: number }>;
  bindAs: number;
}

export type ProgramKind = "beat" | "ownedBeat" | "hook" | "anon";

export interface ProgramEntry {
  name: number;
  hash: string;
  kind: ProgramKind;
  params: number[];
  localCount: number;
  setting: number;
  cast: number;
  /** Base of this program's site-id range; see `siteKeys`. */
  siteBase: number;
  siteCount: number;
  /** Structural keys for each site, parallel to `siteBase + i`. */
  siteKeys: string[];
  code: number[];
  notes: Array<{ pc: number; text: string }>;
}

export interface EntityEntry {
  id: number;
  kind: string;
  fields: Record<string, BankValue>;
}

export interface HookEntry {
  owner: number;
  ownerKind: "character" | "role";
  verb: number;
  param: number;
  filter: number;
  timer: { mode: "every" | "after"; ms: number } | null;
  program: number;
  /** Frozen dispatch order — map iteration order is not portable. */
  order: number;
}

export interface GenEntry {
  id: string;
  intervalMs: number;
  barks: string[];
}

// Story banks are "init" | "content"; a locale sidecar is its own shape
// (`LocaleBank`, kind: "locale") so the two discriminate as a union.
export type BankKind = "init" | "content";

export interface Bank {
  loomBank: number;
  abi: number;
  bankName: string;
  bankId: string;
  kind: BankKind;
  locale: string | null;
  requires: string[];
  matchMode: "value" | "display";
  /**
   * The `<shuffle:>` PRNG seed (16-char lowercase hex, u64) — derived
   * from the source hash so a recompile reshuffles, which is safe
   * because a recompile invalidates saves anyway. See `prng.ts`.
   */
  seed: string;
  compiler: { version: string; sourceHash: string };
  /** Program index of the project `entry:` beat, or `-1`. */
  entry: number;

  names: string[];
  nameHashes: string[];
  strings: string[];
  texts: TextEntry[];
  exprConsts: { nums: number[] };
  exprCode: number[];
  exprs: ExprRef[];
  paths: PathEntry[];
  sets: SetEntry[];
  speakers: SpeakerEntry[];
  directiveArgs: DirectiveArgsEntry[];
  targets: TargetEntry[];
  menus: MenuEntry[];
  switches: SwitchEntry[];
  visitTables: VisitTableEntry[];
  argTables: ArgTableEntry[];
  programs: ProgramEntry[];
  entities: { kinds: Record<string, string>; tables: EntityEntry[] };
  hooks: HookEntry[];
  /**
   * Every pass-through directive verb the bank emits. `delegated` marks
   * the verbs the live LARP engine implements internally (`join`,
   * `capture`, …) — a bank never does, so they arrive as host steps like
   * any other, but the flag lets a host tell "deliberately delegated"
   * from "author-invented", which is the difference between ignoring one
   * safely and shipping a bug.
   */
  verbs: Array<{ name: string; id: string; delegated: boolean }>;
  signals: Array<{ name: string; id: string }>;
  globals: Record<string, BankValue>;
  gens: GenEntry[];
  /** Compile-time diagnostics carried alongside, for tooling. */
  diagnostics: BankDiagnostic[];
}

export interface BankDiagnostic {
  severity: "error" | "warning";
  code: string;
  message: string;
  program?: string;
}

/**
 * A locale bank (spec §8.3): translated `texts` overrides keyed by their
 * source entry's `loc` join key. It carries its *own* string table for
 * the literal parts; expression parts reference the content bank's
 * expression ids — the compiler validates that a translation uses
 * exactly the source's expressions, so a translator cannot invent an
 * interpolation. Unmatched keys fall back to the source at render time.
 */
export interface LocaleBank {
  loomBank: number;
  abi: number;
  bankName: string;
  bankId: string;
  kind: "locale";
  locale: string;
  requires: string[];
  compiler: { version: string; sourceHash: string };
  strings: string[];
  texts: Record<string, { parts: TextEntry["parts"] }>;
  diagnostics: BankDiagnostic[];
}

// ---------------------------------------------------------------------
// Steps — the runtime's pull-model output
// ---------------------------------------------------------------------

export const StepKind = {
  BeatEnter: "beat",
  Line: "line",
  Choice: "choice",
  Directive: "directive",
  VarSet: "varset",
  Signal: "signal",
  Idle: "idle",
  Done: "done",
  Error: "error",
} as const;
export type StepKind = (typeof StepKind)[keyof typeof StepKind];

export type Step =
  | { step: "beat"; program: string; name: string; setting: string; subject: string }
  | {
      step: "line";
      /** `0` means narration — no speaker. */
      speaker: string | 0;
      display?: string;
      text: string;
      setting?: string;
      note?: string;
    }
  | { step: "choice"; menu: string; options: Array<{ i: number; text: string; tag: string }> }
  | {
      step: "directive";
      verb: string;
      verbName: string;
      positional: string[];
      named: Record<string, string>;
      raw: string;
      block: HostMode;
    }
  | { step: "varset"; path: string; value: BankValue }
  | { step: "signal"; verb: string; subject: string }
  | { step: "idle" }
  | { step: "done" }
  | { step: "error"; code: string; message: string };
