//! Value bridging + the normative number formatter.
//!
//! `Value` itself is reused from `@loom/core` rather than redeclared, so
//! the bank and the live `Sim` cannot drift on truthiness, equality, or
//! arithmetic — the semantics have exactly one definition.

import {
  asNumber as asNumberOf,
  display,
  valuesEqual as equalValues,
  VNULL,
  vBool,
  vNumber,
  vString,
  vList,
} from "@loom/core/runtime";
import type { Value } from "@loom/core/runtime";
import type { BankValue } from "./ir.ts";

export { display, truthy, valuesEqual, asNumber, VNULL, vBool, vNumber, vString, vList } from "@loom/core/runtime";
export type { Value } from "@loom/core/runtime";

/**
 * Render a number the way every runtime must.
 *
 * Normative definition is ECMA-262 `Number::toString` — i.e. literally
 * `String(n)` — chosen rather than invented because the live engine's
 * `display()` already is that, so bank and `Sim` agree by construction.
 * Other languages must match this, including the capitalised `NaN` /
 * `Infinity` spellings, which are JS's rather than C's.
 */
export function formatNumber(n: number): string {
  return String(n);
}

/** `Value` → its bank/JSON tagged form. */
export function toBankValue(v: Value): BankValue {
  switch (v.kind) {
    case "null":
      return { t: "null" };
    case "bool":
      return { t: "bool", v: v.value };
    case "number":
      return { t: "num", v: v.value };
    case "string":
      return { t: "str", v: v.value };
    case "list":
      return { t: "list", v: v.items.map(toBankValue) };
  }
}

/** The inverse of `toBankValue`. */
export function fromBankValue(b: BankValue): Value {
  switch (b.t) {
    case "null":
      return VNULL;
    case "bool":
      return vBool(b.v);
    case "num":
      return vNumber(b.v);
    case "str":
      return vString(b.v);
    case "list":
      return vList(b.v.map(fromBankValue));
  }
}

/**
 * Parse a scenario-script literal (`42`, `"text"`, `true`, `null`, or a
 * bare word, which is taken as a string).
 */
export function parseLiteral(text: string): Value {
  const t = text.trim();
  if (t === "null") return VNULL;
  if (t === "true") return vBool(true);
  if (t === "false") return vBool(false);
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/u.test(t)) return vNumber(Number(t));
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return vString(t.slice(1, -1));
  return vString(t);
}

/** Display a value, routing numbers through the spec'd formatter. */
export function displaySpec(v: Value): string {
  return v.kind === "number" ? formatNumber(v.value) : display(v);
}

/**
 * Binary operator semantics.
 *
 * `@loom/core` keeps its `evalBinary` private, so this is the one place
 * the bank restates rather than reuses engine behaviour. It is a
 * deliberate transcription of `core/src/runtime/expr.ts::evalBinary` —
 * and it is also the normative reference every engine runtime transcribes
 * in turn, which is why the rules are spelled out rather than inferred:
 *
 * - all numbers are f64: `/` by zero yields `Infinity`/`NaN` (GDScript's
 *   integer `/` and `%` do not), and `%` is truncated remainder, so
 *   `-7 % 3 === -1` rather than `2`;
 * - `null` and non-numerics coerce to `0` in arithmetic;
 * - `+` concatenates when *either* side is a string, using `display`;
 * - `==`/`!=` compare by value across types; the orderings compare
 *   numerically after coercion.
 */
export function applyBinary(op: number, l: Value, r: Value): Value {
  const num = (v: Value): number => asNumberOf(v) ?? 0;
  switch (op) {
    case BinaryOp.Add:
      if (l.kind === "string") return vString(l.value + display(r));
      if (r.kind === "string") return vString(display(l) + r.value);
      return vNumber(num(l) + num(r));
    case BinaryOp.Sub:
      return vNumber(num(l) - num(r));
    case BinaryOp.Mul:
      return vNumber(num(l) * num(r));
    case BinaryOp.Div:
      return vNumber(num(l) / num(r));
    case BinaryOp.Mod:
      return vNumber(num(l) % num(r));
    case BinaryOp.Eq:
      return vBool(equalValues(l, r));
    case BinaryOp.Ne:
      return vBool(!equalValues(l, r));
    case BinaryOp.Lt:
      return vBool(num(l) < num(r));
    case BinaryOp.Le:
      return vBool(num(l) <= num(r));
    case BinaryOp.Gt:
      return vBool(num(l) > num(r));
    case BinaryOp.Ge:
      return vBool(num(l) >= num(r));
    default:
      return VNULL;
  }
}

/** E-op numbers for the binary operators, mirroring `EOp` in `ir.ts`. */
const BinaryOp = {
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
} as const;
