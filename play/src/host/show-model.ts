//! The host's windows and the Show window, as plain decisions (wave 25,
//! docs/loom-house-desk.md §6.2). A host booth's taskbar reads
//! `Show · Chats · Desk · Scan`; Show is home. It lays out the night the
//! pull-up drawer used to hold: the night strip, NEXT, LAST, *Your jobs*,
//! *Needs you*, *Coming up*, then Judge, the cue sheet, People and More as
//! sections that fold. The slim NEXT bar shows only while Show is off
//! screen. No React, so every rule is tested on plain values.

import { countdownLeft, cueTitleTags, type CueRow } from "../../../core/src/cue-sheet.ts";
import { URGENT_S, formatLeft } from "../clock.ts";
import type { SheetLayout } from "../director.tsx";
import type { HostStripItem, HostTab } from "./model.ts";

// --- the windows -------------------------------------------------------------------

/** A host booth's windows (the taskbar's first three buttons). */
export type HostWindow = "show" | "chats" | "desk";

export const HOST_WINDOWS: readonly HostWindow[] = ["show", "chats", "desk"];

/** The window on screen: the picked one, unless a room covers it (a phone
 *  shows one pane: the open room). Wide, the room sits beside it. */
export function hostWindowShown(win: HostWindow, wide: boolean, activeId: string | null): HostWindow | null {
  return wide || activeId === null ? win : null;
}

/** The slim NEXT bar sits above the taskbar only while Show is off screen
 *  (Chats, the Desk, a room), so a host can fire without going back. */
export function hostBarShown(win: HostWindow, wide: boolean, activeId: string | null): boolean {
  return hostWindowShown(win, wide, activeId) !== "show";
}

// --- the Show window's sections -------------------------------------------------------

/** `talk` (wave 32) is the 🤖 Talk card under NEXT, not a fold: a jump
 *  there (the slim bar's 🤖 Talk chip) opens and scrolls to it. */
export type ShowSectionId = "jobs" | "needs" | "coming" | "judge" | "cues" | "people" | "more" | "talk";

export interface ShowSectionInfo {
  id: ShowSectionId;
  title: string;
  /** Shown in the head: what waits (needs, filings) or how many (jobs, guests). */
  count?: number;
  /** Open unless the host folds it. */
  open: boolean;
}

/**
 * The sections under NEXT and LAST, in order. *Your jobs* and *Coming up*
 * stand open; *Needs you* and Judge open while something waits; the cue
 * sheet, People and More start folded (they are long, and reached on
 * purpose). Judge only when the event has facts.
 */
export function showSections(o: { jobs: number; needs: number; judging: { pending: number } | null; people: number }): ShowSectionInfo[] {
  const out: ShowSectionInfo[] = [
    { id: "jobs", title: "Your jobs", count: o.jobs, open: true },
    { id: "needs", title: "Needs you", count: o.needs, open: o.needs > 0 },
    { id: "coming", title: "Coming up", open: true },
  ];
  if (o.judging !== null) out.push({ id: "judge", title: "Judge", count: o.judging.pending, open: o.judging.pending > 0 });
  out.push({ id: "cues", title: "Cue sheet", open: false }, { id: "people", title: "People", count: o.people, open: false }, { id: "more", title: "More", open: false });
  return out;
}

/** A section's head: "Needs you (3)", "Needs you · nothing", "Cue sheet". */
export function sectionHead(s: ShowSectionInfo): string {
  if (s.count === undefined) return s.title;
  if (s.count > 0) return `${s.title} (${s.count})`;
  return s.id === "needs" || s.id === "judge" ? `${s.title} · nothing` : s.title;
}

/** Does a section stand open: the host's own fold wins, else its default. */
export function sectionOpen(s: ShowSectionInfo, folds: Readonly<Partial<Record<ShowSectionId, boolean>>>): boolean {
  return folds[s.id] ?? s.open;
}

/** Where a jump inside the console lands (a need's row, the caller chip, a
 *  refused press): the drawer's old tab, as a section of Show. `top` is
 *  the head of the window (NEXT and Who's calling). */
export function showTarget(tab: HostTab): ShowSectionId | "top" {
  switch (tab) {
    case "cues":
      return "top";
    case "needs":
      return "needs";
    case "judge":
      return "judge";
    case "people":
      return "people";
    case "more":
      return "more";
    case "talk":
      return "talk";
  }
}

// --- the night strip ---------------------------------------------------------------------

export interface NightItem {
  text: string;
  kind: NonNullable<HostStripItem["kind"]> | "show-clock";
  tone?: HostStripItem["tone"];
}

/** The night strip at Show's top: the bar's strip (📣 caller · act · phase ·
 *  ⏸ / 🚪 · watch values · the soonest countdown) with the show clock after
 *  the phase. A window wraps, so nothing drops; the ⚠ count is left to the
 *  *Needs you* head. */
export function nightStrip(strip: readonly HostStripItem[], showClock: string | null): NightItem[] {
  const out: NightItem[] = [];
  const items = strip.filter((it) => it.kind !== "needs");
  const at = (() => {
    const phase = items.findIndex((it) => it.kind === "phase");
    if (phase >= 0) return phase + 1;
    const act = items.findIndex((it) => it.kind === "act");
    if (act >= 0) return act + 1;
    return items[0]?.kind === "caller" ? 1 : 0;
  })();
  items.forEach((it, k) => {
    if (k === at && showClock !== null) out.push({ text: showClock, kind: "show-clock" });
    out.push({ text: it.text, kind: it.kind ?? "watch", ...(it.tone !== undefined ? { tone: it.tone } : {}) });
  });
  if (at >= items.length && showClock !== null) out.push({ text: showClock, kind: "show-clock" });
  return out;
}

/** The show clock as the strip reads it: "🕐 7:42 PM", "🕐 ⏸ 7:42 PM". */
export function showClockChip(text: string | null, running: boolean): string | null {
  return text === null ? null : `🕐 ${running ? "" : "⏸ "}${text}`;
}

// --- coming up ------------------------------------------------------------------------

export interface ComingCue {
  id: string;
  code: string | null;
  title: string;
  /** False when the cue is off tonight's branch (`while:` false): dimmed. */
  live: boolean;
}

export interface ComingCountdown {
  label: string;
  left: number;
  text: string;
  urgent: boolean;
}

export interface ComingUp {
  cues: ComingCue[];
  countdowns: ComingCountdown[];
}

/** How many cues *Coming up* lists after NEXT. */
export const COMING_CUES = 3;

/**
 * *Coming up*: the in-sequence cues after NEXT that haven't fired, in the
 * focus act only (the next act's opener is the act head's business), and
 * every live countdown, soonest first. No NEXT: the cues after LAST.
 */
export function comingUp(rows: readonly CueRow[], layout: SheetLayout, countdowns: ReadonlyArray<{ label: string; endsAt: number }> | undefined, nowMs: number | null, n = COMING_CUES): ComingUp {
  const next = rows.findIndex((r) => r.next);
  const from = next >= 0 ? next : rows.findIndex((r) => r.last);
  const act = layout.kind === "acts" && layout.focus >= 0 ? new Set(layout.acts[layout.focus]!.rows.map((r) => r.id)) : null;
  const cues = rows
    .slice(from + 1)
    .filter((r) => r.sequence && !r.fired && (act === null || act.has(r.id)))
    .slice(0, n)
    .map((r) => ({ id: r.id, code: r.code, title: cueTitleTags(r.title).title, live: r.live }));
  const cds: ComingCountdown[] = [];
  for (const c of countdowns ?? []) {
    const left = countdownLeft(c.endsAt, nowMs);
    if (left !== null) cds.push({ label: c.label, left, text: `⏳ ${c.label} in ${formatLeft(left)}`, urgent: left < URGENT_S });
  }
  cds.sort((a, b) => a.left - b.left);
  return { cues, countdowns: cds };
}
