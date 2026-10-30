// Wave 48: the Password Manager's language filter
// (`docs/loom-w48-contract.md` C1, and C7–C10 since wave 48b). Browser-safe
// and pure: the server runs it over every line a guest sends, and the
// bands, the masking, the scoring and the signal names live here so a
// client could read a line the same way.
//
// Wave 48b: a strength slider (0–100, starting at 100). Each hit has a tier,
// the lowest strength that catches it. Whole words (tiers 0–60) go through
// `obscenity` (its Unicode look-alikes, leetspeak and repeated letters, its
// whitelists); a swear buried inside a bigger word (75–100) is wave 48's own
// matcher, which is deliberately over-eager: at 100 "password" is flagged
// for "ass", "hello" for "hell", "check" for "heck". That is the joke. Tier
// 0 is slurs: they never leave `filterHits` as text (`UNSAID_WORD`).

import { DataSet, RegExpMatcher, collapseDuplicatesTransformer, englishDataset, englishRecommendedTransformers, parseRawPattern, resolveConfusablesTransformer, resolveLeetSpeakTransformer, toAsciiLowerCaseTransformer } from "obscenity";

/** A hit's band: the lowest strength that catches it (C7). */
export type FilterTier = 0 | 10 | 25 | 50 | 60 | 75 | 90 | 100;

/** One band of the slider: its tier, its key and what a word of it pays. */
export interface FilterBand {
  tier: FilterTier;
  key: string;
  points: number;
}

/** The bands, lowest first (C7). */
export const FILTER_BANDS: readonly FilterBand[] = [
  { tier: 0, key: "slur", points: 12 },
  { tier: 10, key: "worst", points: 8 },
  { tier: 25, key: "strong", points: 5 },
  { tier: 50, key: "mild", points: 3 },
  { tier: 60, key: "soft", points: 2 },
  { tier: 75, key: "buried", points: 2 },
  { tier: 90, key: "buried-mild", points: 1 },
  { tier: 100, key: "paranoid", points: 1 },
];

/** The strength a night starts at, and the slider's step. */
export const FILTER_START_LEVEL = 100;
export const FILTER_LEVEL_STEP = 5;

/** Is `n` a strength the slider can hold (0–100 in steps of 5)? */
export function isFilterLevel(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100 && n % FILTER_LEVEL_STEP === 0;
}

/** What a slur reads as wherever a word is shown or said. */
export const UNSAID_WORD = "[slur]";

/** The story signal for a flagged guest line (C8). */
export const SWEAR_FLAGGED = "swear_flagged";
/** The story signal for the censor's ✂ (C8). */
export const SWEAR_CENSORED = "swear_censored";
/** The story signal for the censor's strength slider (C8). */
export const SWEAR_FILTER = "swear_filter";

// ---------------------------------------------------------------------------
// The whole words (tiers 0–60), through obscenity
// ---------------------------------------------------------------------------

/** obscenity's English words (`originalWord`) by tier; one not listed is 25
 *  (`strong`: the explicit words). Its `ass` is ours instead (below). */
export const FILTER_WORD_TIER: Readonly<Record<string, FilterTier>> = {
  // Slurs: never shown, never read aloud.
  abo: 0,
  abeed: 0,
  africoon: 0,
  arabush: 0,
  boonga: 0,
  chingchong: 0,
  chink: 0,
  dyke: 0,
  fag: 0,
  kike: 0,
  negro: 0,
  nigger: 0,
  retard: 0,
  spastic: 0,
  tranny: 0,
  // The worst.
  fuck: 10,
  cunt: 10,
  rape: 10,
  // Mild.
  arse: 50,
  boob: 50,
  bollocks: 50,
  tit: 50,
  turd: 50,
};

/** Our own whole words (obscenity's pattern syntax: `|` a word's edge,
 *  `[x]` optional), written as the transformers leave them (C7). */
const OWN_PHRASES: ReadonlyArray<{ word: string; tier: FilterTier; patterns: readonly string[] }> = [
  // More slurs, whole words only.
  { word: "spic", tier: 0, patterns: ["|spic|", "|spics|"] },
  { word: "gook", tier: 0, patterns: ["|gook"] },
  { word: "wetback", tier: 0, patterns: ["wetback"] },
  { word: "beaner", tier: 0, patterns: ["|beaner"] },
  { word: "paki", tier: 0, patterns: ["|paki|", "|pakis|"] },
  { word: "raghead", tier: 0, patterns: ["raghead"] },
  { word: "towelhead", tier: 0, patterns: ["towelhead"] },
  { word: "coon", tier: 0, patterns: ["|coon|", "|coons|"] },
  { word: "jap", tier: 0, patterns: ["|jap|", "|japs|"] },
  { word: "wop", tier: 0, patterns: ["|wop|", "|wops|"] },
  { word: "shemale", tier: 0, patterns: ["shemale"] },
  { word: "kyke", tier: 0, patterns: ["|kyke"] },
  { word: "tard", tier: 0, patterns: ["|tard|", "|tards|"] },
  // Strong.
  { word: "asshole", tier: 25, patterns: ["|asshole", "|arsehole"] },
  // Mild.
  { word: "ass", tier: 50, patterns: ["|ass|", "|asses|", "|asshat", "|asswipe", "|jackass", "|dumbass", "|badass", "|smartass", "|fatass", "|lardass"] },
  { word: "crap", tier: 50, patterns: ["|crap"] },
  { word: "balls", tier: 50, patterns: ["|balls|", "|ballsack"] },
  { word: "butt", tier: 50, patterns: ["|butt|", "|butts|", "|butthole", "|buttcheek", "|butthead"] },
  { word: "damn", tier: 50, patterns: ["|damn", "|goddamn", "|godamn"] },
  { word: "bloody", tier: 50, patterns: ["|bloody|"] },
  { word: "bugger", tier: 50, patterns: ["|bugger"] },
  { word: "douche", tier: 50, patterns: ["|douche"] },
  { word: "wtf", tier: 50, patterns: ["|wtf|"] },
  { word: "stfu", tier: 50, patterns: ["|stfu|"] },
  // Soft.
  { word: "hell", tier: 60, patterns: ["|hell|", "|hells|", "|hellish|"] },
  { word: "heck", tier: 60, patterns: ["|heck|", "|heckin"] },
  { word: "darn", tier: 60, patterns: ["|darn|", "|darnit|", "|darned|"] },
  { word: "dang", tier: 60, patterns: ["|dang|", "|dangit|"] },
  { word: "frick", tier: 60, patterns: ["|frick"] },
  { word: "frig", tier: 60, patterns: ["|frig|", "|frigging|", "|friggin|"] },
  { word: "fart", tier: 60, patterns: ["|fart|", "|farts|", "|farted|", "|farting|", "|fartface"] },
  { word: "poop", tier: 60, patterns: ["|poop"] },
  { word: "bum", tier: 60, patterns: ["|bum|", "|bums|"] },
  { word: "rump", tier: 60, patterns: ["|rump|", "|rumps|"] },
  { word: "dammit", tier: 60, patterns: ["|dammit|", "|damnit|"] },
  { word: "fml", tier: 60, patterns: ["|fml|"] },
  { word: "lmao", tier: 60, patterns: ["|lmao|", "|lmfao|"] },
];

/** Every slur the filter knows (tier 0), for tests and nothing shown. */
export const FILTER_SLURS: readonly string[] = [
  ...Object.entries(FILTER_WORD_TIER)
    .filter(([, t]) => t === 0)
    .map(([w]) => w),
  ...OWN_PHRASES.filter((p) => p.tier === 0).map((p) => p.word),
];

type Meta = { originalWord: string };

interface Matchers {
  english: RegExpMatcher;
  englishSet: DataSet<Meta>;
  own: RegExpMatcher;
  ownSet: DataSet<Meta>;
}

let matchers: Matchers | null = null;

/** Built once, on first use. Ours keep a doubled `t` and `m` too (`butt`,
 *  `dammit`), which obscenity's English thresholds would fold away. */
function getMatchers(): Matchers {
  if (matchers !== null) return matchers;
  const englishSet = new DataSet<Meta>().addAll(englishDataset).removePhrasesIf((p) => p.metadata?.originalWord === "ass");
  const ownSet = new DataSet<Meta>();
  for (const p of OWN_PHRASES) {
    ownSet.addPhrase((b) => {
      let out = b.setMetadata({ originalWord: p.word });
      for (const raw of p.patterns) out = out.addPattern(parseRawPattern(raw));
      return out;
    });
  }
  const ownTransformers = [
    resolveConfusablesTransformer(),
    resolveLeetSpeakTransformer(),
    toAsciiLowerCaseTransformer(),
    collapseDuplicatesTransformer({
      defaultThreshold: 1,
      customThresholds: new Map(["b", "e", "o", "l", "s", "g", "t", "m"].map((c) => [c, 2])),
    }),
  ];
  matchers = {
    english: new RegExpMatcher({ ...englishSet.build(), ...englishRecommendedTransformers }),
    englishSet,
    own: new RegExpMatcher({ ...ownSet.build(), blacklistMatcherTransformers: ownTransformers }),
    ownSet,
  };
  return matchers;
}

/** Whole words whose tier a self-censored spelling keeps (`sh*t`, `f**k`,
 *  `a**hole`): never a slur. */
const SELF_CENSORED: ReadonlyArray<{ stem: string; tier: FilterTier }> = [
  { stem: "fuck", tier: 10 },
  { stem: "cunt", tier: 10 },
  { stem: "asshole", tier: 25 },
  { stem: "shit", tier: 25 },
  { stem: "bitch", tier: 25 },
  { stem: "bastard", tier: 25 },
  { stem: "dick", tier: 25 },
  { stem: "cock", tier: 25 },
  { stem: "prick", tier: 25 },
  { stem: "pussy", tier: 25 },
  { stem: "twat", tier: 25 },
  { stem: "slut", tier: 25 },
  { stem: "whore", tier: 25 },
  { stem: "wank", tier: 25 },
  { stem: "piss", tier: 25 },
  { stem: "crap", tier: 50 },
  { stem: "damn", tier: 50 },
  { stem: "hell", tier: 60 },
];

// ---------------------------------------------------------------------------
// The buried stems (tiers 75–100), wave 48's matcher
// ---------------------------------------------------------------------------

/** The stems that count inside a bigger word, by the tier that catches them
 *  there (C7). DRAFT w48b (SIGNOFF-w48). */
export const BURIED_STEMS: Readonly<Record<75 | 90 | 100, readonly string[]>> = {
  75: ["bastard", "bitch", "cock", "cunt", "dick", "fuck", "piss", "prick", "pussy", "shit", "slut", "twat", "wank", "whore"],
  90: ["arse", "ass", "balls", "bollock", "boob", "butt", "crap", "cum", "douche", "sex", "tit", "turd"],
  100: ["bum", "damn", "dang", "darn", "fart", "frick", "frig", "heck", "hell", "poop", "rump"],
};

/** A place in a line (UTF-16 offsets, end exclusive). */
export interface FilterSpan {
  start: number;
  end: number;
}

/** A caught stem, with the tier that caught it. */
export interface FilterStem extends FilterSpan {
  tier: FilterTier;
}

/** One flagged word (or phrase): where it is, the word folded to lower case
 *  (`UNSAID_WORD` for a slur), its lowest tier, and every stem inside it
 *  (overlapping ones merged, the lower tier kept). */
export interface FilterHit extends FilterSpan {
  word: string;
  tier: FilterTier;
  unsaid: boolean;
  stems: FilterStem[];
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

/** Every occurrence of `stem` in a folded word. A `*` matches any one
 *  letter inside a stem, never its first or last (so `f*ck`, `f**k` and
 *  `sh*t` are caught, while `**text**` is not "tit"). */
function stemAt(folded: string, stem: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + stem.length <= folded.length; i++) {
    let ok = true;
    for (let k = 0; k < stem.length; k++) {
      const c = folded[i + k]!;
      if (c === "*" ? k === 0 || k === stem.length - 1 : !readsAs(c, stem[k]!)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

/** Fold one UTF-16 unit to lower case, keeping offsets (a fold that would
 *  change the length leaves the character as it is). */
function foldUnit(c: string): string {
  const l = c.toLowerCase();
  return l.length === 1 ? l : c;
}

function fold(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) out += foldUnit(s[i]!);
  return out;
}

/** The line's words, apostrophes only inside one ("don't"), each holding a letter. */
function wordsOf(text: string): FilterSpan[] {
  const out: FilterSpan[] = [];
  for (const m of text.matchAll(WORD)) {
    let raw = m[0];
    let start = m.index ?? 0;
    while (raw.startsWith("'")) {
      raw = raw.slice(1);
      start += 1;
    }
    while (raw.endsWith("'")) raw = raw.slice(0, -1);
    if (raw !== "" && LETTER.test(raw)) out.push({ start, end: start + raw.length });
  }
  return out;
}

interface Mark extends FilterStem {
  slur: boolean;
}

/** Every stem the filter catches in a line, at any strength. */
function marksOf(text: string, words: readonly FilterSpan[]): Mark[] {
  const marks: Mark[] = [];
  const m = getMatchers();
  for (const p of m.english.getAllMatches(text)) {
    const word = m.englishSet.getPayloadWithPhraseMetadata(p).phraseMetadata?.originalWord ?? "";
    const tier = FILTER_WORD_TIER[word] ?? 25;
    marks.push({ start: p.startIndex, end: p.endIndex + 1, tier, slur: tier === 0 });
  }
  for (const p of m.own.getAllMatches(text)) {
    const word = m.ownSet.getPayloadWithPhraseMetadata(p).phraseMetadata?.originalWord ?? "";
    const tier = OWN_PHRASES.find((o) => o.word === word)?.tier ?? 25;
    marks.push({ start: p.startIndex, end: p.endIndex + 1, tier, slur: tier === 0 });
  }
  for (const w of words) {
    const folded = fold(text.slice(w.start, w.end));
    if (folded.includes("*")) {
      // A self-censored whole word keeps its tier: the stem opens the word.
      for (const s of SELF_CENSORED) {
        if (stemAt(folded, s.stem).includes(0) && folded.slice(0, s.stem.length).includes("*")) marks.push({ start: w.start, end: w.start + s.stem.length, tier: s.tier, slur: false });
      }
    }
    for (const tier of [75, 90, 100] as const) {
      for (const stem of BURIED_STEMS[tier]) for (const i of stemAt(folded, stem)) marks.push({ start: w.start + i, end: w.start + i + stem.length, tier, slur: false });
    }
  }
  return marks;
}

/** The flagged words of a line at a strength, in order (C7). */
export function filterHits(text: string, level: number = FILTER_START_LEVEL): FilterHit[] {
  const words = wordsOf(text);
  const marks = marksOf(text, words)
    .filter((k) => k.tier <= level && k.end > k.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  // A hit is the word (or words) its stems touch; hits that overlap merge.
  const groups: Array<FilterSpan & { marks: Mark[] }> = [];
  for (const k of marks) {
    let start = k.start;
    let end = k.end;
    for (const w of words) {
      if (w.start < k.end && w.end > k.start) {
        start = Math.min(start, w.start);
        end = Math.max(end, w.end);
      }
    }
    const last = groups[groups.length - 1];
    if (last !== undefined && start < last.end) {
      last.end = Math.max(last.end, end);
      last.marks.push(k);
    } else groups.push({ start, end, marks: [k] });
  }
  return groups.map((g) => {
    const unsaid = g.marks.some((k) => k.slur);
    const stems: FilterStem[] = [];
    if (unsaid) stems.push({ start: g.start, end: g.end, tier: 0 });
    else {
      for (const k of g.marks) {
        const last = stems[stems.length - 1];
        if (last !== undefined && k.start < last.end) {
          last.end = Math.max(last.end, k.end);
          last.tier = Math.min(last.tier, k.tier) as FilterTier;
        } else stems.push({ start: k.start, end: k.end, tier: k.tier });
      }
    }
    const tier = Math.min(...stems.map((s) => s.tier)) as FilterTier;
    return { start: g.start, end: g.end, word: unsaid ? UNSAID_WORD : fold(text.slice(g.start, g.end)).replace(/\s+/gu, " "), tier, unsaid, stems };
  });
}

/** Stored hits re-read at another strength: only the stems it catches. */
export function atLevel(hits: readonly FilterHit[], level: number): FilterHit[] {
  const out: FilterHit[] = [];
  for (const h of hits) {
    const stems = h.stems.filter((s) => s.tier <= level);
    if (stems.length === 0) continue;
    out.push({ ...h, stems, tier: Math.min(...stems.map((s) => s.tier)) as FilterTier });
  }
  return out;
}

/** The line with every stem's characters turned to `*` ("p***word"); a
 *  slur's whole word goes. */
export function maskText(text: string, hits: readonly FilterHit[]): string {
  const chars = text.split("");
  for (const h of hits) {
    for (const s of h.stems) {
      for (let i = s.start; i < s.end && i < chars.length; i++) if (!/\s/u.test(chars[i]!)) chars[i] = "*";
    }
  }
  return chars.join("");
}

/** The line with only its slurs starred (C9): what is stored. */
export function maskUnsaid(text: string, hits: readonly FilterHit[]): string {
  return maskText(
    text,
    hits.filter((h) => h.unsaid),
  );
}

/** The flagged words as the story's `list` arg ("password, hello, [slur]"). */
export function hitList(hits: readonly FilterHit[]): string {
  return hits.map((h) => h.word).join(", ");
}

/** What a hit pays before the multiplier: its band's points (C10). */
export function hitPoints(hit: FilterHit): number {
  return FILTER_BANDS.find((b) => b.tier === hit.tier)?.points ?? 1;
}

/** The hits' worth before the multiplier. */
export function linePoints(hits: readonly FilterHit[]): number {
  return hits.reduce((n, h) => n + hitPoints(h), 0);
}

// ---------------------------------------------------------------------------
// The journal form (C8): `start-end[!]:s-e.tier,…;…`
// ---------------------------------------------------------------------------

/** Hits as a `swear_flagged` arg (a JSON scalar), so a restore rebuilds them. */
export function encodeHits(hits: readonly FilterHit[]): string {
  return hits.map((h) => `${h.start}-${h.end}${h.unsaid ? "!" : ""}:${h.stems.map((s) => `${s.start}-${s.end}.${s.tier}`).join(",")}`).join(";");
}

const TIERS = new Set<number>(FILTER_BANDS.map((b) => b.tier));

/** The hits back from `encodeHits`, over the stored line (a malformed one is
 *  skipped). */
export function decodeHits(text: string, code: string): FilterHit[] {
  const out: FilterHit[] = [];
  for (const part of code.split(";")) {
    const m = /^(\d+)-(\d+)(!?):(.+)$/u.exec(part);
    if (m === null) continue;
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (end <= start || end > text.length) continue;
    const stems: FilterStem[] = [];
    for (const s of m[4]!.split(",")) {
      const sm = /^(\d+)-(\d+)\.(\d+)$/u.exec(s);
      if (sm === null) continue;
      const tier = Number(sm[3]);
      const ss = Number(sm[1]);
      const se = Number(sm[2]);
      if (TIERS.has(tier) && ss >= start && se <= end && se > ss) stems.push({ start: ss, end: se, tier: tier as FilterTier });
    }
    if (stems.length === 0) continue;
    const unsaid = m[3] === "!";
    out.push({ start, end, word: unsaid ? UNSAID_WORD : fold(text.slice(start, end)).replace(/\s+/gu, " "), tier: Math.min(...stems.map((s) => s.tier)) as FilterTier, unsaid, stems });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The ⭐ mini-game (C10)
// ---------------------------------------------------------------------------

/** One heat cools away every this many ms. */
export const FILTER_COOL_MS = 20_000;
/** The multiplier by notch (`ceil(heat)`), rested first. */
export const FILTER_MULTS: readonly number[] = [3, 2, 1.5, 1, 0.5, 0.25];

/** Heat after `elapsedMs` of cooling. */
export function heatAfter(heat: number, elapsedMs: number): number {
  return Math.max(0, heat - Math.max(0, elapsedMs) / FILTER_COOL_MS);
}

/** The multiplier at a heat. */
export function multAt(heat: number): number {
  const notch = Math.min(FILTER_MULTS.length - 1, Math.ceil(Math.max(0, heat) - 1e-9));
  return FILTER_MULTS[notch]!;
}

/** What a ✂ pays: `floor(points × mult)`. */
export function starsFor(points: number, mult: number): number {
  return Math.floor(points * mult + 1e-9);
}
