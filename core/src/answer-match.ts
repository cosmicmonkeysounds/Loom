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
//! - **spelling**, word by word (never over the joined line, so a short word
//!   that decides the answer is never swallowed by a long one around it): a
//!   word of 1–3 letters must match exactly (`a` ≠ `z`, `am` ≠ `pm`, `did` ≠
//!   `didnt`); a word of 4–7 letters takes ≤ 1 Damerau (optimal string
//!   alignment) edit, one of 8+ ≤ 2; a misspelled word keeps its first
//!   letter (`Tickles` is not `Pickles`); and the line as a whole takes ≤ 1
//!   edit (≤ 2 once 8+ characters) — a missing space (`mrpickles`) is one,
//!   when the joined words match exactly.
//!
//! **Numbers match exactly only**: a digit run is its own token even inside a
//! word (`9am` → `9 am`), `a.m.` / `p.m.` read as `am` / `pm`, both sides
//! must carry the same numbers in the same order (`1996` is never near
//! `1997`, `10:00` never near `9:00`, `9am` never near `8am` or `9pm`), and
//! no edit may touch a digit.
//!
//! **Extra words** (wave 11 recheck): an answer that holds every word of a
//! key form, in order, plus up to four more (`11 years ago` for `11`,
//! `Mister Pickles the cat`, `9:00 in the morning`) is near, so a right
//! answer said at length goes to a director instead of being an automatic
//! lie. Not when an extra word turns it around or hedges (`not`, `never`,
//! `didnt`, `or` …), names the half of the day the key leaves open (`9:00
//! pm` for `9:00`), or is a lone letter (`Appendix A` for `appendix`,
//! `Room 101 b`) — a letter is a name, not a filler.
//!
//! **Abbreviations** spell out first (`yrs` → `years`, `ext` → `extension`,
//! `mr` → `mister`, and a leading-zero clock time `0900` → `9 00`):
//! `spellOut` is also the judge's second exact look, so `11 yrs`, `Mr.
//! Pickles` and `extension 1978` are simply right.
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

/** Folded abbreviations spelled out (`spellOut`, `nearTokens`): only ones
 *  that can never be a different answer's word. Honorifics map to their
 *  own long form (`mr` → `mister`, never `mrs`). */
const ABBREVIATIONS: Readonly<Record<string, string>> = {
  mr: "mister",
  mrs: "missus",
  dr: "doctor",
  yr: "year",
  yrs: "years",
  ext: "extension",
  hr: "hour",
  hrs: "hours",
  min: "minute",
  mins: "minutes",
  sec: "second",
  secs: "seconds",
};

/** Words that turn an answer around or hedge it: never extra words (`not grok`). */
const TURNING = new Set(["not", "no", "never", "nor", "neither", "none", "nothing", "isnt", "wasnt", "arent", "werent", "dont", "doesnt", "didnt", "cant", "cannot", "couldnt", "wont", "wouldnt", "shouldnt", "or", "either", "except", "but"]);

/** A folded answer with its abbreviations spelled out and a leading-zero
 *  clock time split (`0900` → `9 00`): the judge's second exact look
 *  (`server/facts.ts`), so `Mr. Pickles` is `Mister Pickles` and `11 yrs`
 *  is `11 years`. Takes an already-folded string (`foldAnswer`). */
export function spellOut(folded: string): string {
  if (folded === "") return "";
  return folded
    .split(" ")
    .map((w) => {
      const clock = /^0([0-9])([0-5][0-9])$/u.exec(w);
      if (clock !== null) return `${clock[1]} ${clock[2]}`;
      return ABBREVIATIONS[w] ?? w;
    })
    .join(" ");
}

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
  // Abbreviations spell out (`yrs` → `years`) except on the look that keeps
  // honorifics, which compares the line as typed (`mrpickles` ≈ `Mr. Pickles`).
  const folded = opts.honorifics === true ? foldAnswer(s) : spellOut(foldAnswer(s));
  if (folded === "") return [];
  // A digit run is its own token (`9am` → `9 am`), and `a m` / `p m` (the
  // fold of `a.m.` / `p.m.`) read as one word, so the hour is a number.
  const split = folded.split(" ").flatMap((w) => w.match(/[0-9]+|[a-z]+/gu) ?? []);
  const raw: string[] = [];
  for (let i = 0; i < split.length; i++) {
    const w = split[i]!;
    if ((w === "a" || w === "p") && split[i + 1] === "m") {
      raw.push(`${w}m`);
      i += 1;
    } else raw.push(w);
  }
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
  if (extraWords(k, a)) return true;
  // Spelling, word by word, under one budget for the whole line (spaces
  // count: the line is the words joined, numbers left out).
  const kw = k.filter((t) => !isDigits(t)).join(" ");
  const aw = a.filter((t) => !isDigits(t)).join(" ");
  const shorter = Math.min(kw.length, aw.length);
  if (shorter < 3) return false;
  const budget = shorter >= 8 ? 2 : 1;
  if (k.length === a.length) return alignedEdits(k, a) <= budget;
  // One space missing or extra: two neighbouring words of the longer side,
  // run together, are exactly one word of the shorter side (the space is the
  // one edit), and the rest lines up.
  const [long, short] = k.length > a.length ? [k, a] : [a, k];
  if (long.length - short.length !== 1 || budget < 1) return false;
  for (let i = 0; i + 1 < long.length; i++) {
    if (isDigits(long[i]!) || isDigits(long[i + 1]!)) continue;
    const merged = [...long.slice(0, i), long[i]! + long[i + 1]!, ...long.slice(i + 2)];
    if (merged[i] !== short[i]) continue;
    if (1 + alignedEdits(merged, short) <= budget) return true;
  }
  return false;
}

/** The most extra words a long answer may carry around a key form. */
const MAX_EXTRA = 4;

/**
 * `a` is the key form `k` said at length: every word of `k`, in order, plus
 * 1–`MAX_EXTRA` more, none of which turns it around (`TURNING`), adds the
 * am / pm the key leaves open, or is a lone letter. One way only: the key's
 * words are the answer; a shorter answer is a different one (an alias).
 * Numbers are already equal (`nearAs`).
 */
function extraWords(k: readonly string[], a: readonly string[]): boolean {
  if (a.length <= k.length || a.length - k.length > MAX_EXTRA) return false;
  const extra: Array<{ w: string; at: number }> = [];
  let i = 0;
  a.forEach((w, at) => {
    if (i < k.length && w === k[i]) i += 1;
    else extra.push({ w, at });
  });
  if (i < k.length) return false;
  return extra.every(({ w, at }) => {
    if (TURNING.has(w)) return false;
    if ((w === "am" || w === "pm") && !k.includes(w)) return false;
    // A lone letter is a name (`Appendix A`, `Plan B`), except the article
    // or `I` inside a sentence (`it was a tabby`, `i think grok`).
    if (w.length === 1 && !isDigits(w)) return (w === "a" || w === "i") && at < a.length - 1;
    return true;
  });
}

/** The edits that turn `a` into `k` word by word (same length), or
 *  Infinity when any word pair is past its own allowance: numbers exactly,
 *  1–3 letters exactly, 4–7 letters ≤ 1 with the first letter kept, 8+ ≤ 2. */
function alignedEdits(k: readonly string[], a: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < k.length; i++) {
    const x = k[i]!;
    const y = a[i]!;
    if (x === y) continue;
    if (isDigits(x) || isDigits(y)) return Infinity;
    const shorter = Math.min(x.length, y.length);
    if (shorter <= 3 || x[0] !== y[0]) return Infinity;
    const d = damerau(x, y);
    if (d > (shorter >= 8 ? 2 : 1)) return Infinity;
    total += d;
  }
  return total;
}

/**
 * Does `text` **mention** the key form `key` anywhere — the leak check
 * (the show's answer-secrecy guard): the form's words appear as a run in
 * the text, word-bounded, under the judge's own spelling rules (`nearAs`'s
 * per-word allowance and line budget, numbers exactly, number words as
 * digits, plurals and honorifics folded), so `Mr. Pickels` in a prompt is
 * a mention of `Mister Pickles` and `eleven` one of `11`. Only a run of
 * the form's own length is compared (no token sets, no extra words: those
 * are a filing's latitude, not a mention's). One more line of prose's own:
 * a key form that is a single word of five letters or fewer takes no slip
 * (in running text one slip of a short word is another word: `grow` for
 * `grok`).
 */
export function mentionsKey(text: string, key: string): boolean {
  for (const honorifics of [false, true]) {
    const k = nearTokens(key, { honorifics });
    if (k.length === 0) continue;
    const exactOnly = k.length === 1 && k[0]!.length <= 5;
    const t = nearTokens(text, { honorifics });
    const kj = k.join(" ");
    const kw = k.filter((w) => !isDigits(w)).join(" ");
    for (let i = 0; i + k.length <= t.length; i++) {
      const w = t.slice(i, i + k.length);
      if (w.join(" ") === kj) return true;
      if (exactOnly) continue;
      const ww = w.filter((x) => !isDigits(x)).join(" ");
      const shorter = Math.min(kw.length, ww.length);
      if (shorter < 3) continue;
      const kn = numbersOf(k);
      const wn = numbersOf(w);
      if (kn.length !== wn.length || kn.some((x, j) => x !== wn[j])) continue;
      if (alignedEdits(k, w) <= (shorter >= 8 ? 2 : 1)) return true;
    }
  }
  return false;
}
