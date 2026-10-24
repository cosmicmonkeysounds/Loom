//! The wave 18b workspace lints:
//!
//! - `L1219 BadgeOnSecret` — a header `badge:` line that does not parse,
//!   names no ROLE or CHARACTER, or reads a ROLE `secret:` slot or a
//!   `secret: true` CHARACTER as its path or in its `while` (an error:
//!   every phone sees a badge, so the runtime never shows it).
//! - `L1220 FoundingInvalid` — a header `founding:` line that is no
//!   expression (nobody may found a faction), or a second one (ignored).
//!
//! Text- and model-driven like the wave 18 lints in `w18-lints.ts`.

import type { LoomFile } from "../parser/ast.ts";
import { Code } from "../parser/diagnostics.ts";
import { parseExpr } from "../runtime/expr.ts";
import { badgeHead, badgeIsSecret, badgeWhileReadsSecret, parseBadgeLine } from "../runtime/sim/badges.ts";
import type { SimModel } from "../runtime/sim/model.ts";
import type { Range } from "./types.ts";
import { spanToRange } from "./util.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;
type Doc = { text: string; file: LoomFile };

export function wave18bLints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  let founding = false;
  for (const [uri, doc] of docs) {
    for (const line of doc.file.header.lines ?? []) {
      const range = spanToRange(line.span);
      if (line.key === "badge") {
        const def = parseBadgeLine(line.value);
        if (def === null) {
          push(uri, range, false, Code.L1219BadgeOnSecret, `\`badge: ${line.value.trim()}\` does not parse — write \`badge: program.afk as 🚻 Bathroom Mode[, while <condition>]\` (one dotted path on a ROLE alias or a CHARACTER, \`as\` a glyph and a label); nobody wears it`);
          continue;
        }
        if (model === null) continue;
        if (badgeHead(model, def.head) === null) {
          push(uri, range, false, Code.L1219BadgeOnSecret, `\`${def.head}\` in \`badge: ${line.value.trim()}\` names no ROLE (or its alias) and no CHARACTER, so nobody wears it`);
          continue;
        }
        if (badgeIsSecret(model, def)) {
          push(uri, range, true, Code.L1219BadgeOnSecret, `\`badge: ${line.value.trim()}\` reads a secret (a ROLE \`secret:\` slot, a \`secret: true\` CHARACTER or a CHARACTER's \`private:\` slot) — every phone sees a badge, so it is never shown`);
          continue;
        }
        if (badgeWhileReadsSecret(model, def)) {
          push(uri, range, true, Code.L1219BadgeOnSecret, `the \`while\` of \`badge: ${line.value.trim()}\` reads a secret (a ROLE \`secret:\` slot, a \`secret: true\` CHARACTER or a CHARACTER's \`private:\` slot) — every phone sees a badge, so it would tell them that secret; it is never shown`);
          continue;
        }
        if (def.while !== null && !exprOk(def.while)) {
          push(uri, range, false, Code.L1219BadgeOnSecret, `the \`while\` of \`badge: ${line.value.trim()}\` is no expression, so nobody wears it`);
        }
      } else if (line.key === "founding") {
        if (founding) {
          push(uri, range, false, Code.L1220FoundingInvalid, "a second `founding:` line is ignored — the first one decides when a program may found a faction");
          continue;
        }
        founding = true;
        if (!exprOk(line.value)) push(uri, range, false, Code.L1220FoundingInvalid, `\`founding: ${line.value.trim()}\` is no expression — nobody may found a faction (write a condition, \`program\` bound: \`founding: Night.truther_sent == true and program.cleared == true\`)`);
      }
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
