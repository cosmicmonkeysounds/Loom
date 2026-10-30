// Wave 48: the Password Manager's language filter
// (`docs/loom-w48-contract.md` C1). Browser-safe and pure: the server runs
// it over every guest line, and the stems, the masking and the signal names
// live here so a client could read a line the same way.
//
// It is deliberately over-eager (the user's ask): a stem counts anywhere
// inside a word, so "password" is flagged for "ass", "hello" for "hell",
// "check" for "heck", "button" for "butt" and "Saturday" for "turd". The
// Password Manager decides what actually gets censored.

/** The swear stems, lower case, mild ones too. DRAFT w48 (SIGNOFF-w48). */
export const FILTER_STEMS: readonly string[] = [
  "arse",
  "ass",
  "bastard",
  "bitch",
  "bloody",
  "bollock",
  "boob",
  "bugger",
  "bum",
  "butt",
  "cock",
  "crap",
  "cunt",
  "dammit",
  "damn",
  "dang",
  "darn",
  "dick",
  "douche",
  "fart",
  "fml",
  "frick",
  "frig",
  "fuck",
  "heck",
  "hell",
  "lmao",
  "lmfao",
  "piss",
  "poop",
  "prick",
  "pussy",
  "rump",
  "shit",
  "slut",
  "stfu",
  "tit",
  "turd",
  "twat",
  "wank",
  "whore",
  "wtf",
];

/** The story signal for a flagged guest line: `signal(SWEAR_FLAGGED, guest,
 *  { message, words, list })`, committed by the server (C2). */
export const SWEAR_FLAGGED = "swear_flagged";
/** The story signal for the censor's ✂: `signal(SWEAR_CENSORED, guest,
 *  { message, words, list, fresh }, <censor>)` (C2). */
export const SWEAR_CENSORED = "swear_censored";

/** A stem's place in a line (UTF-16 offsets, end exclusive). */
export interface FilterSpan {
  start: number;
  end: number;
}

/** One flagged word: where it is in the line, the word folded to lower
 *  case, and every stem inside it (overlapping ones merged). */
export interface FilterHit extends FilterSpan {
  word: string;
  stems: FilterSpan[];
}

/** What a look-alike may stand for. `*` (a self-censored letter) is any. */
const LOOKALIKE: Readonly<Record<string, string>> = {
  "@": "a",
  $: "s",
  "0": "o",
  "1": "il",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
};

/** A word: letters, digits, the look-alikes and an inner apostrophe. */
const WORD = /[\p{L}\p{N}@$*']+/gu;
const LETTER = /\p{L}/u;

/** Does the word's character `c` (folded) read as the stem's letter `s`? */
function readsAs(c: string, s: string): boolean {
  if (c === s) return true;
  const alike = LOOKALIKE[c];
  return alike !== undefined && alike.includes(s);
}

/** Every stem occurrence in a folded word, merged where they touch. A `*`
 *  matches any one letter inside a stem, never its first or last (so
 *  `f*ck`, `f**k` and `sh*t` are caught, while `**text**` is not "tit"). */
function stemSpans(folded: string, stems: readonly string[]): FilterSpan[] {
  const found: FilterSpan[] = [];
  for (const stem of stems) {
    for (let i = 0; i + stem.length <= folded.length; i++) {
      let ok = true;
      for (let k = 0; k < stem.length; k++) {
        const c = folded[i + k]!;
        if (c === "*" ? k === 0 || k === stem.length - 1 : !readsAs(c, stem[k]!)) {
          ok = false;
          break;
        }
      }
      if (ok) found.push({ start: i, end: i + stem.length });
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: FilterSpan[] = [];
  for (const s of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** Fold one UTF-16 unit to lower case, keeping offsets (a fold that would
 *  change the length leaves the character as it is). */
function foldUnit(c: string): string {
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
}

/** The flagged words of a line, in order (C1). */
export function filterHits(text: string, stems: readonly string[] = FILTER_STEMS): FilterHit[] {
  const out: FilterHit[] = [];
  for (const m of text.matchAll(WORD)) {
    let raw = m[0];
    let start = m.index ?? 0;
    // An apostrophe only inside a word ("don't"), never around it.
    while (raw.startsWith("'")) {
      raw = raw.slice(1);
      start += 1;
    }
    while (raw.endsWith("'")) raw = raw.slice(0, -1);
    if (!LETTER.test(raw)) continue;
    let folded = "";
    for (let i = 0; i < raw.length; i++) folded += foldUnit(raw[i]!);
    const spans = stemSpans(folded, stems);
    if (spans.length === 0) continue;
    out.push({
      word: folded,
      start,
      end: start + raw.length,
      stems: spans.map((s) => ({ start: start + s.start, end: start + s.end })),
    });
  }
  return out;
}

/** The line with every stem's characters turned to `*` ("p***word"). */
export function maskText(text: string, hits: readonly FilterHit[]): string {
  const chars = text.split("");
  for (const h of hits) for (const s of h.stems) for (let i = s.start; i < s.end && i < chars.length; i++) chars[i] = "*";
  return chars.join("");
}

/** The flagged words as the story's `list` arg ("password, hello"). */
export function hitList(hits: readonly FilterHit[]): string {
  return hits.map((h) => h.word).join(", ");
}
