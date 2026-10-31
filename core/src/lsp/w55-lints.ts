//! The wave 55 workspace lint:
//!
//! - `L1227 AloudNobody` (an error) — a beat's `aloud:` names something that
//!   is no part a performer can sign in as, and no `{…}` read from the story
//!   (`aloud: Clippy`, `aloud: {Night.bobber}`). Its lines would reach
//!   nobody's teleprompter, silently, on the night.
//!
//! Model-driven like the wave 18 lints in `w18-lints.ts`.

import { Code } from "../parser/diagnostics.ts";
import type { LoomFile } from "../parser/ast.ts";
import type { SimModel } from "../runtime/sim/model.ts";
import { identityDefs, performerPickable } from "../identity-kind.ts";
import type { Range } from "./types.ts";
import { spanToRange } from "./util.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;
type Doc = { text: string; file: LoomFile };

export function wave55Lints(docs: ReadonlyArray<[string, Doc]>, model: SimModel | null, push: Push): void {
  if (model === null) return;
  const parts = new Set(identityDefs(model).filter(performerPickable).map((d) => d.name));
  for (const [uri, doc] of docs) {
    for (const item of doc.file.items) {
      if (item.kind !== "beat") continue;
      const prop = item.value.contract.get("aloud");
      if (prop === undefined) continue;
      for (const raw of prop.value.split(",")) {
        const who = raw.trim();
        if (parts.has(who) || /^\{.+\}$/u.test(who)) continue;
        push(uri, spanToRange(prop.span), true, Code.L1227AloudNobody, `\`${who}\` in \`aloud:\` is no part a performer can sign in as — name a CHARACTER with a booth, or a \`{…}\` holding a program's name (\`aloud: {Night.bobber}\`)`);
      }
    }
  }
}
