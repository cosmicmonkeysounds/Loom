//! The wave 26 workspace lints:
//!
//! - `L1226 AckNoneWithoutGo` (a warning) — `with …, ack: none` on a
//!   `broadcast` / `reply` / `show` tail with no `go:` in the same tail. A
//!   big moment without an acknowledge button needs an exit to close it, so
//!   the phone shows its usual OK anyway (a guest is never trapped).
//!
//! The `lock:` header's check is `L1216` (`w18-lints.ts`). Text-driven like
//! the wave 18 lints, so it runs without a compiled model.

import { Code } from "../parser/diagnostics.ts";
import type { LoomFile } from "../parser/ast.ts";
import { splitMomentArgs } from "../go.ts";
import type { Range } from "./types.ts";
import { lines } from "./util.ts";
import { lineRange, momentTail, stripComment } from "./w18-lints.ts";

type Push = (uri: string, range: Range, error: boolean, code: string, message: string) => void;
type Doc = { text: string; file: LoomFile };

export function wave26Lints(docs: ReadonlyArray<[string, Doc]>, push: Push): void {
  ackLints(docs, push);
}

function ackLints(docs: ReadonlyArray<[string, Doc]>, push: Push): void {
  for (const [uri, doc] of docs) {
    lines(doc.text).forEach((raw, n) => {
      const line = stripComment(raw);
      const m = /^[ \t]*(broadcast|reply|respond|show)[ \t]+(\S.*)$/u.exec(line);
      if (m === null) return;
      const tail = momentTail(m[1]!, m[2]!);
      if (tail === null) return;
      const args = splitMomentArgs(tail);
      if (args.ack !== "none" || args.go.length > 0) return;
      push(uri, lineRange(raw, n), false, Code.L1226AckNoneWithoutGo, "`ack: none` needs a `go:` exit in the same tail (`with go: pass, ack: none`) — without one the phone shows its usual OK");
    });
  }
}
