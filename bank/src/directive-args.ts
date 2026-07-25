//! Directive argument parsing — at compile time, once.
//!
//! Mirrors the convention the show-control bridge already defines
//! (`stagehand/src/stagehand/directives.py`): top-level comma-separated
//! segments, a bare segment is a positional target, `key: value` is a
//! named argument, respecting quotes and brackets.
//!
//! Doing this here is what keeps a per-engine runtime small — no engine
//! ever has to tokenise a comma, a quote, or a colon.

export interface ParsedDirectiveArgs {
  positional: string[];
  named: Array<{ key: string; value: string }>;
}

/** Split on commas that are not inside quotes, brackets, or parens. */
export function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote !== null) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === separator && depth === 0) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

/** Index of the first top-level occurrence of `ch`, or -1. */
export function findTopLevel(text: string, ch: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth += 1;
    if (c === ")" || c === "]" || c === "}") depth = Math.max(0, depth - 1);
    if (c === ch && depth === 0) return i;
  }
  return -1;
}

/** Strip one layer of matching surrounding quotes. */
export function unquote(text: string): string {
  const t = text.trim();
  if (t.length >= 2) {
    const first = t[0]!;
    if ((first === '"' || first === "'") && t.endsWith(first)) return t.slice(1, -1);
  }
  return t;
}

export function parseDirectiveArgs(rest: string): ParsedDirectiveArgs {
  const positional: string[] = [];
  const named: Array<{ key: string; value: string }> = [];
  if (rest.trim().length === 0) return { positional, named };

  for (const segment of splitTopLevel(rest, ",")) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) continue;
    const colon = findTopLevel(trimmed, ":");
    if (colon > 0) {
      const key = trimmed.slice(0, colon).trim();
      // Only a bare identifier counts as a key — otherwise a positional
      // like `10:30` or a quoted string would be misread as named.
      if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
        named.push({ key, value: unquote(trimmed.slice(colon + 1)) });
        continue;
      }
    }
    positional.push(unquote(trimmed));
  }
  return { positional, named };
}
