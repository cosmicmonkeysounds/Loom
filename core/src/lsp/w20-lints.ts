//! The wave 20 workspace lint:
//!
//! - `L1221 ChoiceGuardInvalid` — a choice line `* (if <cond>) text` /
//!   `+ (if <cond>) text` whose condition does not parse. The Sim reads it
//!   as false (a diagnostic), so the option is never offered.
//!
//! Text-driven, so it reaches every choice: a beat's, a CHARACTER's owned
//! beat and a story rule's (those bodies stay raw until compile).

import { splitChoiceGuard } from "../parser/parser.ts";
import { Code } from "../parser/diagnostics.ts";
import { parseExpr } from "../runtime/expr.ts";
import type { Range } from "./types.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;

const CHOICE_LINE = /^(\s*)[*+][ \t]+/u;

export function wave20Lints(docs: ReadonlyArray<[string, { text: string }]>, push: Push): void {
  for (const [uri, doc] of docs) {
    const lines = doc.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.replace(/\r$/u, "");
      const m = CHOICE_LINE.exec(line);
      if (m === null) continue;
      const [guard] = splitChoiceGuard(line.slice(m[0].length));
      if (guard === null || exprOk(guard)) continue;
      const range = { start: { line: i, character: m[1]!.length }, end: { line: i, character: line.length } };
      push(uri, range, false, Code.L1221ChoiceGuardInvalid, `the guard \`(if ${guard})\` does not parse, so this option is never offered — write a condition, \`+ (if program.trust >= 20) ⟦TRUSTED⟧ …\``);
    }
  }
}

function exprOk(src: string): boolean {
  if (src.trim() === "") return false;
  try {
    parseExpr(src);
    return true;
  } catch {
    return false;
  }
}
