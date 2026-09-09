//! Human names (Loom 4 §3).
//!
//! A name is any run of words. Two names are the *same* name when they
//! match after folding: lowercase, `_` / `-` read as spaces, runs of
//! whitespace collapsed. `foldName` is the single definition every
//! lookup falls back to (beats, entities, speakers) when an exact key
//! misses, so `-> the bell tower at dawn` reaches
//! `== The Bell Tower at Dawn` and `Cookie Banner:` speaks as
//! `CHARACTER Cookie_Banner`.

/** Fold a name to its comparison key. */
export function foldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[_\-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Fold a dotted key (`Owner.beat`) segment-wise, so an owned beat's key
 * folds the owner and the beat name independently.
 */
export function foldKey(key: string): string {
  return key
    .split(".")
    .map((s) => foldName(s))
    .join(".");
}

/**
 * A folded lookup table over a set of exact keys. `get` returns the
 * exact key an input folds to, or null. Later exact keys win on a
 * collision (mirrors `Map.set` last-writer semantics); callers that care
 * about ambiguity can check `collisions`.
 */
export class FoldedIndex {
  private readonly table = new Map<string, string>();
  readonly collisions: Array<[string, string]> = [];

  add(exactKey: string): void {
    const folded = foldKey(exactKey);
    const prior = this.table.get(folded);
    if (prior !== undefined && prior !== exactKey) this.collisions.push([prior, exactKey]);
    this.table.set(folded, exactKey);
  }

  get(input: string): string | null {
    return this.table.get(foldKey(input)) ?? null;
  }

  has(input: string): boolean {
    return this.table.has(foldKey(input));
  }
}

/**
 * The *speaker head* grammar: one to three capitalised words (letters,
 * digits, `'`, `-`, `_`), several heads joined by `|`, optionally followed
 * by a parenthetical. Lowercase heads are property keys, never speakers.
 * Returns the head parts or null.
 */
export function parseSpeakerHead(head: string): { speakers: string[]; parenthetical: string | null } | null {
  let text = head.trim();
  let parenthetical: string | null = null;
  const paren = /\s*\(([^()]*)\)\s*$/u.exec(text);
  if (paren !== null) {
    parenthetical = paren[1]!.trim();
    text = text.slice(0, paren.index).trim();
  }
  if (text.length === 0) return null;
  const speakers = text.split("|").map((s) => s.trim());
  for (const s of speakers) {
    if (!isNameShaped(s)) return null;
  }
  return { speakers, parenthetical };
}

const FIRST_WORD_RE = /^[A-Z][A-Za-z0-9'_\-]*$/u;
const WORD_RE = /^[A-Za-z][A-Za-z0-9'_\-]*$/u;

/**
 * `Ivo`, `Ivo Marsh`, `Ivo the Younger`, `Cookie Banner`, `IVO` — up to
 * three words, the first capitalised. (Lowercase heads are property keys.)
 */
export function isNameShaped(text: string): boolean {
  const words = text.trim().split(/\s+/u);
  if (words.length === 0 || words.length > 3) return false;
  if (!FIRST_WORD_RE.test(words[0]!)) return false;
  return words.every((w) => WORD_RE.test(w));
}
