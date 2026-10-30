/**
 * Wave 48: the Password Manager's filter, the server's book
 * (`docs/loom-w48-contract.md` C2, C8–C12 since wave 48b). Transport-free:
 * the runtime indexes a guest line here when it journals its
 * `swear_flagged` signal, sets the strength on `swear_filter`, and marks a
 * line censored when it journals `swear_censored`; `restore` replays all
 * three from the journal, so nothing here is stored out of band and a story
 * restart forgets it with the journal (`clear`).
 */

import { FILTER_COOL_MS, FILTER_MULTS, FILTER_START_LEVEL, atLevel, heatAfter, linePoints, multAt, starsFor, type FilterHit, type FilterTier } from "../src/language-filter.ts";

/** The most waiting lines a booth's view carries (the newest). */
export const FILTER_VIEW_MAX = 40;
/** The most censored words `top` names (C8). */
export const FILTER_TOP = 5;

/** One flagged guest line. */
export interface FlagEntry {
  seq: number;
  guest: string;
  /** Where it was said, as the booth reads it ("# lobby", "DM to Trabolta"). */
  where: string;
  /** The line as stored (slurs already starred; the chat store's copy is
   *  masked further once censored). */
  text: string;
  /** Its hits at the strength it was flagged at. */
  hits: FilterHit[];
  /** Story ms. */
  ts: number;
  censored: boolean;
}

/** A waiting line in the censor's booth (C11's `FilterLine`). */
export interface FilterLine {
  seq: number;
  guest: string;
  name: string;
  avatar?: string;
  where: string;
  text: string;
  hits: Array<{ start: number; end: number; tier: FilterTier }>;
  words: string[];
  points: number;
  ts: number;
}

/** The filter's heat, as of a view (C11). */
export interface FilterCombo {
  heat: number;
  coolMs: number;
  mults: number[];
}

/** The censor booth's `PrimeView.filter` (C11). */
export interface FilterView {
  /** Words caught tonight, at the strength of the time. */
  flagged: number;
  /** Of them, censored. */
  censored: number;
  level: number;
  /** Waiting lines the strength no longer catches. */
  muted: number;
  /** ⭐ paid by ✂ tonight. */
  stars: number;
  combo: FilterCombo;
  lines: FilterLine[];
}

/** How the view reads the world it cannot see. */
export interface FilterViewCtx {
  hidden: (seq: number) => boolean;
  nameOf: (guest: string) => string;
  avatarOf: (guest: string) => string | null;
  /** Server epoch ms. */
  now: number;
}

/** What a ✂ pays (C10). */
export interface FilterScore {
  points: number;
  mult: number;
  stars: number;
  /** The heat after this ✂, and when (server epoch ms). */
  heat: number;
  at: number;
}

/** A censored word's tally, for the report. */
export interface FilterWordCount {
  word: string;
  n: number;
}

export class FilterBook {
  /** By seq, in the order flagged (seq order). */
  private entries = new Map<number, FlagEntry>();
  /** Every word censored tonight (lower case, never a slur), first censored
   *  first, with how often. */
  private words = new Map<string, number>();
  private flaggedWords = 0;
  private censoredWords = 0;
  private unsaidWords = 0;
  private strength = FILTER_START_LEVEL;
  private heat = 0;
  private heatAt = 0;
  private paid = 0;

  /** Index a flagged line (a repeat of the same seq is ignored). */
  flag(e: Omit<FlagEntry, "censored">): void {
    if (this.entries.has(e.seq) || e.hits.length === 0) return;
    this.entries.set(e.seq, { ...e, censored: false });
    this.flaggedWords += e.hits.length;
  }

  get(seq: number): FlagEntry | undefined {
    return this.entries.get(seq);
  }

  /** The strength now (0–100). */
  get level(): number {
    return this.strength;
  }

  setLevel(level: number): void {
    this.strength = level;
  }

  /** A flagged line's hits the strength catches now (what ✂ censors). */
  live(seq: number): FilterHit[] {
    const e = this.entries.get(seq);
    return e === undefined ? [] : atLevel(e.hits, this.strength);
  }

  /** Words of `hits` not censored before tonight: unique, in order, never a slur. */
  fresh(hits: readonly FilterHit[]): string[] {
    const out: string[] = [];
    for (const h of hits) if (!h.unsaid && !this.words.has(h.word) && !out.includes(h.word)) out.push(h.word);
    return out;
  }

  /** What censoring `hits` at `now` would pay (C10); changes nothing. */
  score(hits: readonly FilterHit[], now: number): FilterScore {
    const points = linePoints(hits);
    const heat = heatAfter(this.heat, now - this.heatAt);
    const mult = multAt(heat);
    return { points, mult, stars: starsFor(points, mult), heat: Math.round((heat + 1) * 1000) / 1000, at: now };
  }

  /** Mark a flagged line censored with the hits it lost and what it paid;
   *  null for none or one already censored. */
  censor(seq: number, hits: readonly FilterHit[], paid: Pick<FilterScore, "stars" | "heat" | "at">): FlagEntry | null {
    const e = this.entries.get(seq);
    if (e === undefined || e.censored) return null;
    e.censored = true;
    this.censoredWords += hits.length;
    for (const h of hits) {
      if (h.unsaid) this.unsaidWords += 1;
      else this.words.set(h.word, (this.words.get(h.word) ?? 0) + 1);
    }
    this.heat = paid.heat;
    this.heatAt = paid.at;
    this.paid += paid.stars;
    return e;
  }

  get flagged(): number {
    return this.flaggedWords;
  }
  get censored(): number {
    return this.censoredWords;
  }
  /** Slur words censored (never their text). */
  get unsaid(): number {
    return this.unsaidWords;
  }
  get stars(): number {
    return this.paid;
  }

  /** Every censored word with its tally, most censored first (a tie keeps
   *  the first censored first). */
  wordCounts(): FilterWordCount[] {
    return [...this.words].map(([word, n]) => ({ word, n })).sort((a, b) => b.n - a.n);
  }

  /** The words censored most, as the story's `top` ("hello, password"). */
  top(n = FILTER_TOP): string {
    return this.wordCounts()
      .slice(0, n)
      .map((w) => w.word)
      .join(", ");
  }

  clear(): void {
    this.entries = new Map();
    this.words = new Map();
    this.flaggedWords = 0;
    this.censoredWords = 0;
    this.unsaidWords = 0;
    this.strength = FILTER_START_LEVEL;
    this.heat = 0;
    this.heatAt = 0;
    this.paid = 0;
  }

  /** The booth's view: the newest waiting lines the strength still catches
   *  (not censored, not hidden), oldest first; the rest waiting are `muted`. */
  view(ctx: FilterViewCtx, max = FILTER_VIEW_MAX): FilterView {
    const waiting: Array<{ e: FlagEntry; hits: FilterHit[] }> = [];
    let muted = 0;
    for (const e of [...this.entries.values()].reverse()) {
      if (e.censored || ctx.hidden(e.seq)) continue;
      const hits = atLevel(e.hits, this.strength);
      if (hits.length === 0) muted += 1;
      else if (waiting.length < max) waiting.push({ e, hits });
    }
    waiting.reverse();
    return {
      flagged: this.flaggedWords,
      censored: this.censoredWords,
      level: this.strength,
      muted,
      stars: this.paid,
      combo: { heat: Math.round(heatAfter(this.heat, ctx.now - this.heatAt) * 1000) / 1000, coolMs: FILTER_COOL_MS, mults: [...FILTER_MULTS] },
      lines: waiting.map(({ e, hits }) => {
        const avatar = ctx.avatarOf(e.guest);
        return {
          seq: e.seq,
          guest: e.guest,
          name: ctx.nameOf(e.guest),
          ...(avatar !== null ? { avatar } : {}),
          where: e.where,
          text: e.text,
          hits: hits.flatMap((h) => h.stems.map((s) => ({ start: s.start, end: s.end, tier: s.tier }))),
          words: hits.map((h) => h.word),
          points: linePoints(hits),
          ts: e.ts,
        };
      }),
    };
  }
}
