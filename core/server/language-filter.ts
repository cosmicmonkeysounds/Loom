/**
 * Wave 48: the Password Manager's filter, the server's book
 * (`docs/loom-w48-contract.md` C2). Transport-free: the runtime indexes a
 * guest line here when it journals its `swear_flagged` signal, and marks it
 * censored when it journals `swear_censored`; `restore` replays both from
 * the journal, so nothing here is stored out of band and a story restart
 * forgets it with the journal (`clear`).
 */

import type { FilterHit } from "../src/language-filter.ts";

/** The most waiting lines a booth's view carries (the newest). */
export const FILTER_VIEW_MAX = 40;

/** One flagged guest line. */
export interface FlagEntry {
  seq: number;
  guest: string;
  /** Where it was said, as the booth reads it ("# lobby", "DM to Trabolta"). */
  where: string;
  /** The line as typed (the chat store's copy is masked once censored). */
  text: string;
  hits: FilterHit[];
  /** Story ms. */
  ts: number;
  censored: boolean;
}

/** A waiting line in the censor's booth (C2's `FilterLine`). */
export interface FilterLine {
  seq: number;
  guest: string;
  name: string;
  avatar?: string;
  where: string;
  text: string;
  hits: Array<{ start: number; end: number }>;
  words: string[];
  ts: number;
}

/** The censor booth's `PrimeView.filter` (C2). */
export interface FilterView {
  /** Words flagged tonight, on every guest line. */
  flagged: number;
  /** Of them, censored. */
  censored: number;
  lines: FilterLine[];
}

/** How the view reads the world it cannot see. */
export interface FilterViewCtx {
  hidden: (seq: number) => boolean;
  nameOf: (guest: string) => string;
  avatarOf: (guest: string) => string | null;
}

export class FilterBook {
  /** By seq, in the order flagged (seq order). */
  private entries = new Map<number, FlagEntry>();
  /** Every word censored tonight (lower case): `fresh` reads it. */
  private words = new Set<string>();
  private flaggedWords = 0;
  private censoredWords = 0;

  /** Index a flagged line (a repeat of the same seq is ignored). */
  flag(e: Omit<FlagEntry, "censored">): void {
    if (this.entries.has(e.seq) || e.hits.length === 0) return;
    this.entries.set(e.seq, { ...e, censored: false });
    this.flaggedWords += e.hits.length;
  }

  get(seq: number): FlagEntry | undefined {
    return this.entries.get(seq);
  }

  /** The line's words not censored before tonight: unique, in order. */
  fresh(seq: number): string[] {
    const e = this.entries.get(seq);
    if (e === undefined) return [];
    const out: string[] = [];
    for (const h of e.hits) if (!this.words.has(h.word) && !out.includes(h.word)) out.push(h.word);
    return out;
  }

  /** Mark a flagged line censored; null for none or one already censored. */
  censor(seq: number): FlagEntry | null {
    const e = this.entries.get(seq);
    if (e === undefined || e.censored) return null;
    e.censored = true;
    this.censoredWords += e.hits.length;
    for (const h of e.hits) this.words.add(h.word);
    return e;
  }

  get flagged(): number {
    return this.flaggedWords;
  }
  get censored(): number {
    return this.censoredWords;
  }

  clear(): void {
    this.entries = new Map();
    this.words = new Set();
    this.flaggedWords = 0;
    this.censoredWords = 0;
  }

  /** The booth's view: the newest waiting lines (not censored, not hidden),
   *  oldest first. */
  view(ctx: FilterViewCtx, max = FILTER_VIEW_MAX): FilterView {
    const waiting: FlagEntry[] = [];
    for (const e of [...this.entries.values()].reverse()) {
      if (waiting.length >= max) break;
      if (!e.censored && !ctx.hidden(e.seq)) waiting.push(e);
    }
    waiting.reverse();
    return {
      flagged: this.flaggedWords,
      censored: this.censoredWords,
      lines: waiting.map((e) => {
        const avatar = ctx.avatarOf(e.guest);
        return {
          seq: e.seq,
          guest: e.guest,
          name: ctx.nameOf(e.guest),
          ...(avatar !== null ? { avatar } : {}),
          where: e.where,
          text: e.text,
          hits: e.hits.flatMap((h) => h.stems.map((s) => ({ start: s.start, end: s.end }))),
          words: e.hits.map((h) => h.word),
          ts: e.ts,
        };
      }),
    };
  }
}
