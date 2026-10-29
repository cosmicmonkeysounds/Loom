//! The credits roll's timing, pure (wave 44, C8): where the column of
//! `creditsRows` is at `t` (ms since the slide went up, on the server's
//! clock), when the end card fades in, and, under Reduce Motion, which page
//! is up. The scene (`scenes/credits.tsx`) measures the column and the
//! stage once and hands the pixels in; everything else is a function of
//! `t`, so a reload lands mid-roll and every screen in the house is on the
//! same row.

import { creditsRollMs, type CreditsRow, type CreditsView } from "../../../core/src/credits.ts";

/** Where the column's top starts, as a share of the stage's height: the
 *  title is already on screen at `t` 0, a little above the middle. */
export const ROLL_START = 0.32;
/** The roll fades in over this long (ms). */
export const ROLL_FADE_IN_MS = 900;
/** The end card fades in over this long, from the roll's end (ms). */
export const END_FADE_MS = 1400;
/** A Reduce Motion page change is a cross-fade this long (ms). */
export const PAGE_FADE_MS = 500;

/** The fallback's words (a failed or 404 fetch): the title and end lines only. */
// DRAFT w44 (the credits' fallback card)
export const CREDITS_FALLBACK_TITLE = "Trapped in the Internet";
// DRAFT w44
export const CREDITS_FALLBACK_END: readonly string[] = ["Thank you for playing."];

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** How long the roll takes for a view (ms): `creditsRollMs` over its rows. */
export function rollMsOf(rows: readonly CreditsRow[]): number {
  return creditsRollMs(rows.length);
}

/** The end card: the view's title and end lines (no end lines: the fallback's). */
export function endCard(view: CreditsView | null): { title: string; lines: readonly string[] } {
  if (view === null) return { title: CREDITS_FALLBACK_TITLE, lines: CREDITS_FALLBACK_END };
  const title = view.title.trim() === "" ? CREDITS_FALLBACK_TITLE : view.title;
  return { title, lines: view.end.length > 0 ? view.end : CREDITS_FALLBACK_END };
}

export interface RollFrame {
  /** `roll` while the column moves, `end` once it has gone (the end card holds). */
  phase: "roll" | "end";
  /** The column's top, px from the stage's top. */
  y: number;
  /** The column's opacity (fades in at the start, out as the end card comes). */
  rollOpacity: number;
  /** The end card's opacity. */
  endOpacity: number;
}

/**
 * The roll at `t`: the column's top goes from `ROLL_START` of the stage
 * down the screen to just above it (`-contentPx`, every row gone) at a
 * constant speed over `rollMs`, then the end card fades in and holds. With
 * the column not measured yet (`contentPx` 0) it sits at its start.
 */
export function rollFrame(t: number, rollMs: number, contentPx: number, viewPx: number): RollFrame {
  const start = viewPx * ROLL_START;
  const k = rollMs > 0 ? clamp01(t / rollMs) : 1;
  const y = contentPx > 0 ? start - k * (start + contentPx) : start;
  const endOpacity = clamp01((t - rollMs) / END_FADE_MS);
  const rollOpacity = Math.min(clamp01(t / ROLL_FADE_IN_MS), 1 - endOpacity);
  return { phase: t < rollMs ? "roll" : "end", y, rollOpacity, endOpacity };
}

/** How much of a page a row takes (about a line of body type each). */
export interface PageMetrics {
  /** Rows a page holds, in body lines. */
  capacity: number;
  /** Characters a body line holds before it wraps. */
  perLine: number;
  /** A person row is two lines (the part above the name: a wall's layout). */
  stacked: boolean;
}

/** The TV's pages (role and name side by side) and a wall's (stacked). */
export const PAGE_METRICS: Readonly<Record<"tv" | "wall", PageMetrics>> = {
  tv: { capacity: 11, perLine: 56, stacked: false },
  wall: { capacity: 10, perLine: 32, stacked: true },
};

const lines = (text: string, perLine: number): number => Math.max(1, Math.ceil(text.length / Math.max(1, perLine)));

/** One row's share of a page, in body lines. */
export function rowWeight(row: CreditsRow, m: PageMetrics): number {
  switch (row.kind) {
    case "title":
      return 2.4 * lines(row.text, Math.round(m.perLine / 2));
    case "subtitle":
      return 1.4 * lines(row.text, m.perLine);
    case "heading":
      return 1.6;
    case "person":
      return m.stacked ? 0.8 + lines(row.name, m.perLine) : lines(`${row.role}   ${row.name}`, m.perLine);
    case "line":
      return lines(row.text, m.perLine);
    case "gap":
      return 0.8;
  }
}

/**
 * Reduce Motion's pages: the rows cut into screenfuls, never more than
 * `capacity` lines a page (but a row too big for one gets a page of its
 * own). A page never starts with a gap and never ends on a heading (the
 * heading moves over with its first row); a page break falls at a section's
 * gap when one is near.
 */
export function creditsPages(rows: readonly CreditsRow[], m: PageMetrics): CreditsRow[][] {
  const pages: CreditsRow[][] = [];
  let page: CreditsRow[] = [];
  let used = 0;
  const flush = () => {
    while (page.length > 0 && page[page.length - 1]!.kind === "gap") page.pop();
    if (page.length > 0) pages.push(page);
    page = [];
    used = 0;
  };
  rows.forEach((row, i) => {
    if (row.kind === "gap") {
      if (page.length === 0) return;
      // A section starts here: break now if the heading and its first row won't fit.
      const next = rows.slice(i + 1, i + 3).reduce((n, r) => n + rowWeight(r, m), 0);
      if (used + rowWeight(row, m) + next > m.capacity) {
        flush();
        return;
      }
    }
    const w = rowWeight(row, m);
    if (page.length > 0 && used + w > m.capacity) {
      // Carry a trailing heading over with this row.
      const carry: CreditsRow[] = [];
      while (page.length > 0 && page[page.length - 1]!.kind === "heading") carry.unshift(page.pop()!);
      if (page.length > 0) flush();
      page = carry;
      used = carry.reduce((n, r) => n + rowWeight(r, m), 0);
    }
    page.push(row);
    used += w;
  });
  flush();
  return pages;
}

export interface PageFrame {
  /** The page up (or the last one, as the end card comes). */
  index: number;
  /** Its opacity: a cross-fade in at its start. */
  opacity: number;
  phase: "roll" | "end";
  endOpacity: number;
}

/** Reduce Motion: the page up at `t`, each page an equal share of `rollMs`, then the end card. */
export function pageFrame(t: number, rollMs: number, pageCount: number): PageFrame {
  const n = Math.max(1, pageCount);
  const each = rollMs / n;
  const index = Math.min(n - 1, Math.max(0, Math.floor(t / each)));
  const into = t - index * each;
  const endOpacity = clamp01((t - rollMs) / END_FADE_MS);
  const opacity = Math.min(clamp01(into / PAGE_FADE_MS), 1 - endOpacity);
  return { index, opacity, phase: t < rollMs ? "roll" : "end", endOpacity };
}
