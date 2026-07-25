//! `@loom/bank` — compiles a Loom project into engine-agnostic banks and
//! hosts the normative reference interpreter.
//!
//! Format + API spec: `docs/loom-banks.md`.

export * from "./ir.ts";
export { compileSources, compileBundle } from "./compile.ts";
export type { CompileOptions } from "./compile.ts";
export { BankVM } from "./interp.ts";
export type { LoadResult, SaveState } from "./interp.ts";
export { runScenario, parseScenario, toJsonl, diffTraces, diffStates } from "./trace.ts";
export type { Command, TraceDiff, TraceRecord } from "./trace.ts";
export { gdscriptHeader, csharpHeader, cppHeader, collectSymbols } from "./headers.ts";
export { fnv1a64, idHex, asSignedDecimal, NameTable } from "./ids.ts";
export { canonicalJson, digestOf, sha256Hex } from "./digest.ts";
export { parseDirectiveArgs, splitTopLevel, findTopLevel, unquote } from "./directive-args.ts";
export { formatNumber, displaySpec, toBankValue, fromBankValue, parseLiteral } from "./value.ts";
