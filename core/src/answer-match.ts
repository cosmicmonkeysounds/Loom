//! Near-miss matching for typed answers (wave 11, C6): is a filing *close
//! enough* to a key that a director should look at it before the judge
//! calls it a lie or a guess?
//!
//! The judge (`server/facts.ts`) matches exactly after `foldAnswer`; this
//! module is the looser second look it takes at a miss. A near miss is never
//! accepted here — it is routed to a director (the Judging card) instead of
//! being judged automatically, so the rules lean generous:
//!
//! - **honorifics** drop (`Mr` / `Mister` / `Dr` / `Mrs` …), so `Mr Pickels`
//!   is compared as `pickels`;
//! - **number words** become digits (`eleven` → `11`, `nineteen ninety
//!   seven` → `1997`, `one thousand nine hundred ninety seven` → `1997`), and
//!   a thousands separator joins (`1,997` → `1997`);
//! - **plurals** fold (`pickles` → `pickle`, `boxes` → `box`, `flies` → `fly`);
//! - **token sets**: the same words in another order match;
//! - **spelling**: a Damerau (optimal string alignment) distance ≤ 1 — ≤ 2
//!   once both sides are 8+ characters — on what is left; nothing for a side
//!   of 1–2 characters.
//!
//! **Numbers match exactly only**: when either side carries a number, both
//! must carry the same numbers in the same order (`1996` is never near
//! `1997`, `10:00` never near `9:00`), and no edit may touch a digit.
//!
//! Pure, dependency-free, deterministic; the one fold is `facts.ts`'s.

import { foldAnswer } from "./facts.ts";

/** Words dropped as honorifics before comparing (folded, no dots). */
const HONORIFICS = new Set(["mr", "mister", "mrs", "missus", "ms", "miss", "dr", "doctor", "sir", "dame", "madam", "madame", "lord", "lady", "prof", "professor", "st", "saint", "rev", "reverend", "capt", "captain"]);

const ONES: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Readonly<Record<string, number>> = { hundred: 100, thousand: 1000, million: 1_000_000 };

const isNumberWord = (w: string): boolean => w in ONES || w in TENS || w in SCALES;
const isDigits = (w: string): boolean => /^[0-9]+$/u.test(w);

/**
 * One run of number words as digits. With a scale word it is a cardinal
 * (`one thousand nine hundred and ninety seven` → `1997`); without one it is
 * read in chunks below 100, written one after another (`nineteen ninety
 * seven` → `1997`, `one two three` → `123`, `nineteen oh five` → `1905`).
 */
function wordsToDigits(run: readonly string[]): string {
  if (run.some((w) => w in SCALES)) {
    let total = 0;
    let current = 0;
    for (const w of run) {
      if (w in ONES) current += ONES[w]!;
      else if (w in TENS) current += TENS[w]!;
      else {
        const scale = SCALES[w]!;
        if (scale === 100) current = (current === 0 ? 1 : current) * 100;
        else {
          total += (current === 0 ? 1 : current) * scale;
          current = 0;
        }
      }
    }
    return String(total + current);
  }
  const chunks: string[] = [];
  let tens: number | null = null;
  const flush = () => {
    if (tens !== null) chunks.push(String(tens));
    tens = null;
  };
  for (const w of run) {
    if (w in TENS) {
      flush();
      tens = TENS[w]!;
    } else if (tens !== null && ONES[w]! > 0 && ONES[w]! < 10) {
      chunks.push(String(tens + ONES[w]!));
      tens = null;
    } else {
      flush();
      // "oh" inside a year (`nineteen oh five`) is a zero digit before the next.
      chunks.push(w === "oh" ? "0" : String(ONES[w]!));
    }
  }
  flush();
  return chunks.join("");
}

/** A plural folded to its singular (letters only; short words kept). */
function singular(w: string): string {
  if (w.length <= 3 || isDigits(w)) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(?:s|x|z|ch|sh)es$/u.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(?:ss|us|is)$/u.test(w)) return w.slice(0, -1);
  return w;
}

/** An answer as the near-miss rules compare it: folded tokens with number
 *  words as digits, thousands separators joined, plurals singular and
 *  honorifics dropped (unless that would leave nothing). */
export function nearTokens(s: string, opts: { honorifics?: boolean } = {}): string[] {
  const folded = foldAnswer(s);
  if (folded === "") return [];
  const raw = folded.split(" ");
  // `grouped`: a digit token that may take a thousands group after it — one
  // the filer typed as 1–3 digits (`1` of `1,997`), or such a run joined.
  const tokens: string[] = [];
  const grouped: boolean[] = [];
  for (let i = 0; i < raw.length; ) {
    const w = raw[i]!;
    if (w !== "oh" && isNumberWord(w)) {
      // A run of number words ("and" inside one is the British "hundred and";
      // "oh" inside one is a zero: `nineteen oh five`).
      const run: string[] = [];
      while (i < raw.length) {
        const x = raw[i]!;
        const next = raw[i + 1] ?? "";
        if (isNumberWord(x) && (x !== "oh" || isNumberWord(next))) run.push(x);
        else if (!(x === "and" && isNumberWord(next) && next !== "oh")) break;
        i += 1;
      }
      tokens.push(wordsToDigits(run));
      grouped.push(false);
      continue;
    }
    i += 1;
    const last = tokens.length - 1;
    // `1,997` folds to `1 997`: a 1–3 digit group then 3-digit groups is one number.
    if (last >= 0 && grouped[last] === true && /^[0-9]{3}$/u.test(w)) {
      tokens[last] += w;
      continue;
    }
    tokens.push(w);
    grouped.push(/^[0-9]{1,3}$/u.test(w));
  }
  const singulars = tokens.map(singular);
  if (opts.honorifics === true) return singulars;
  const bare = singulars.filter((t) => !HONORIFICS.has(t));
  return bare.length > 0 ? bare : singulars;
}

/** Numbers as values (`007` ≡ `7`), in order. */
function numbersOf(tokens: readonly string[]): string[] {
  return tokens.filter(isDigits).map((t) => String(BigInt(t)));
}

/** Optimal-string-alignment (restricted Damerau–Levenshtein) distance. */
export function damerau(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev2: number[] = new Array<number>(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array<number>(m + 1).fill(0);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[m]!;
}

/**
 * Is `answer` near `key` — the same answer, honestly mistyped or put another
 * way? True for an exact match too (the judge asks only after an exact miss).
 * See the module doc for the rules; numbers must match exactly.
 */
export function nearMatch(key: string, answer: string): boolean {
  // With honorifics dropped (`Mr Pickels` ≈ `Mister Pickles`), else kept
  // (`mrpickles` ≈ `Mr. Pickles`: the missing space is one edit).
  return nearAs(nearTokens(key), nearTokens(answer)) || nearAs(nearTokens(key, { honorifics: true }), nearTokens(answer, { honorifics: true }));
}

function nearAs(k: readonly string[], a: readonly string[]): boolean {
  if (k.length === 0 || a.length === 0) return false;
  const kn = numbersOf(k);
  const an = numbersOf(a);
  if (kn.length !== an.length || kn.some((x, i) => x !== an[i])) return false;
  if (k.join(" ") === a.join(" ")) return true;
  if ([...new Set(k)].sort().join(" ") === [...new Set(a)].sort().join(" ")) return true;
  // Spelling: the words around the numbers (the numbers already agree).
  // Spaces stay in: a missing or extra one is one edit (`pickle sjar`).
  const kw = k.filter((t) => !isDigits(t)).join(" ");
  const aw = a.filter((t) => !isDigits(t)).join(" ");
  const shorter = Math.min(kw.length, aw.length);
  if (shorter < 3) return false;
  return damerau(kw, aw) <= (shorter >= 8 ? 2 : 1);
}
