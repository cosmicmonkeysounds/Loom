//! The screen layer, the pure parts (OCT31 K-17 + N-03): overlays, PNG
//! slides, the corner countdown and the Y2K clock, stacked over whatever the
//! terminal would show anyway. The server folds the story's screen cues into
//! a per-target `program` (`core/server/routes/screen.ts`); this decides what
//! is on top *now*:
//!
//!   overlay (blackout · go_to_living_room · alarm)
//!     > slide — held `SLIDE_HOLD_MS` (45 s terminals / 90 s TV), or until the
//!       next cue for the persistent ones (`bingo`, `y2k`, `trust_chart`,
//!       `truth_txt`, the ceremony's `award_*`); a slide beats attract
//!     > attract (the character hidden or asleep — K-16)
//!     > the base view (face / world / mirror).
//!
//! The corner countdown (`countdown_*` never replaces a slide) shows the
//! story's running countdown over a slide, attract or the base view. A
//! pilot session pre-empts a slide and the corner; an overlay ends the
//! pilot. `flicker` is a one-shot stutter over everything but a blackout.
//! Every flash is ≤ 3 Hz and never full-field red (photosensitivity).

import type { ScreenChart, ScreenState, ScreenTarget } from "./screen.ts";

/** How long a non-persistent slide stays up after its cue (ms). */
export const SLIDE_HOLD_MS: Record<ScreenTarget, number> = { terminals: 45_000, tv: 90_000 };
/** A blackout is true black this long even when another overlay follows at once (the lights' 10 s dark). */
export const BLACKOUT_MS = 10_000;
/** The flicker's length (two dips: 2 Hz). */
export const FLICKER_MS = 1000;
/** A flicker first seen later than this after its cue is history: not played. */
export const FLICKER_FRESH_MS = 6000;

export type OverlayKind = "blackout" | "go_to_living_room" | "alarm";

export interface ScreenLayers {
  overlay: OverlayKind | null;
  slide: { value: string; cue: string } | null;
  /** Seconds on the corner countdown, or null for none. */
  corner: number | null;
  /** Seconds to midnight for the Y2K clock (`y2k` slide), or null when not running. */
  y2k: number | null;
  /** The seq of a flicker to play now (once per seq), or null. */
  flicker: number | null;
  /** The live chart for the slide on screen (the Trust Chart), or null. */
  chart: ScreenChart | null;
}

export const NO_LAYERS: ScreenLayers = { overlay: null, slide: null, corner: null, y2k: null, flicker: null, chart: null };

const isOverlay = (v: string): v is OverlayKind => v === "blackout" || v === "go_to_living_room" || v === "alarm";

/**
 * What the screen shows on top, `nowMs` local ms (`Date.now()`). Ages are
 * measured on the server's clock (its `now` + the time since the answer
 * arrived), so a tablet with the wrong time still holds slides right.
 */
export function screenLayers(state: ScreenState | null, nowMs: number, o: { piloting: boolean }): ScreenLayers {
  if (state === null) return NO_LAYERS;
  const since = Math.max(0, nowMs - state.receivedAt);
  const serverNow = state.now + since;
  const age = (at: number) => (at > 0 ? serverNow - at : Number.POSITIVE_INFINITY);
  const p = state.program;

  let overlay: OverlayKind | null = null;
  if (p.blackout !== null && age(p.blackout.at) < BLACKOUT_MS) overlay = "blackout";
  else if (p.overlay !== null && isOverlay(p.overlay.value)) overlay = p.overlay.value;

  let slide: ScreenLayers["slide"] = null;
  const s = p.slide;
  if (!o.piloting && s !== null && s.kind === "slide" && (s.persist || age(s.at) < SLIDE_HOLD_MS[state.target])) slide = { value: s.value, cue: s.cue };

  const remaining = state.remaining === null ? null : Math.max(0, state.remaining - Math.floor(since / 1000));
  const y2k = state.countdown === "y2k" ? remaining : null;
  const corner = overlay === null && !o.piloting && state.countdown !== null && remaining !== null && slide?.value !== "y2k" ? remaining : null;

  const flicker = p.flicker !== null && overlay !== "blackout" && age(p.flicker.at) < FLICKER_FRESH_MS ? p.flicker.seq : null;
  const chart = overlay === null && slide !== null && state.chart !== null && state.chart.slide === slide.value ? state.chart : null;
  return { overlay, slide, corner, y2k, flicker, chart };
}

/** The chart's rows as the slide draws them: rank, name, number. Ties share
 *  a rank (1, 2, 2, 4). The top is the "most trusted" the story names. */
export function chartLines(chart: ScreenChart): Array<{ rank: number; name: string; value: number }> {
  const out: Array<{ rank: number; name: string; value: number }> = [];
  chart.rows.forEach((r, i) => {
    const prev = out[i - 1];
    out.push({ rank: prev !== undefined && prev.value === r.value ? prev.rank : i + 1, name: r.name, value: r.value });
  });
  return out;
}

/** `mm:ss` (or `h:mm:ss`) for the corner. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/** The Y2K taskbar clock: midnight minus `remaining`, on 12/31/1999. At (or
 *  past) midnight — or with no countdown running — it reads what an unpatched
 *  PC would: 12:00 AM on 1/1/1900. */
export function y2kClock(remaining: number | null): { time: string; date: string } {
  if (remaining === null || remaining <= 0) return { time: "12:00:00 AM", date: "1/1/1900" };
  const left = Math.min(Math.floor(remaining), 24 * 3600 - 1);
  const t = 24 * 3600 - left; // seconds since the start of 12/31
  const h24 = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { time: `${h12}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`, date: "12/31/1999" };
}

/** Where a slide's PNG may be: named after the whole cue (spec §2.13:
 *  `screens_trivia_1.png`), else after its value (`trivia_1.png`). */
export function slideSources(slide: { value: string; cue: string }, base: string): string[] {
  const safe = (n: string) => /^[a-z0-9_-]+$/iu.test(n);
  return [...new Set([slide.cue, slide.value])].filter(safe).map((n) => `${base}slides/${n}.png`);
}

/** The text card a slide renders until (or unless) its PNG exists. */
export interface SlideCopy {
  title: string;
  lines?: readonly string[];
  /** A slide that is just a dark screen. */
  dark?: boolean;
}

/** Copy for the cue registry's slides (DESIGN.md §2.13). The trivia lines are
 *  the Quest Log's own questions (a test keeps them in step with the show's
 *  `generated/questions.loom`, which is generated from its facts.json).
 *  Slides that can show before the introduction never name the character. */
export const SLIDE_COPY: Readonly<Record<string, SlideCopy>> = {
  call_desktop: { title: "REPORT TO THE DESKTOP", lines: ["All programs: a game is about to begin."] },
  bingo: { title: "COMPUTER BINGO", lines: ["Find a program for every square.", "Do not write names: use your computer memory.", "* One square is the important question."] },
  bingo_time: { title: "BINGO TIME", lines: ["Back to the Desktop. Bring your card."] },
  trivia_1: {
    title: "TRABOLTA TRIVIA · ROUND 1",
    lines: [
      "Q1. How many years did the Maps and Ducks billboard on Barrington Street go unpaid before mapsandducks.com expired?",
      "Q2. What was the name of the first animal buried in the Halifax Explosion Memorial Pet Cemetery?",
      "Q3. At what time was the ribbon-cutting at Halifax's first AI Data Centre scheduled?",
    ],
  },
  trivia_2: {
    title: "TRABOLTA TRIVIA · ROUND 2",
    lines: [
      "Q1. What extension does the Customer Care card tell you to dial?",
      "Q2. Which song did Trabolta play 412 times the night before he registered mapsandducks.com?",
      "Q3. What is the title of the last chapter of Trabolta's unfinished Unified Field Theory?",
    ],
  },
  return: { title: "RETURN TO THE DESKTOP", lines: ["Time is up."] },
  hunt_results: { title: "THE RESULTS", lines: ["The First Moment of Truth."] },
  truth_or_dare: { title: "TRUTH OR DARE", lines: ["The bottle is spinning."] },
  ad_hijack: { title: "000. 000. 000.", lines: ["A special offer for you."] },
  truther: { title: "TRUTHER DOWNLOAD", lines: ["Downloading… do not turn off your computer."] },
  five_minutes: { title: "SECOND MOMENT OF TRUTH", lines: ["Five minutes. Return to the Desktop."] },
  truth_pong: { title: "TRUTH PONG", lines: ["To the backyard."] },
  trust_chart: { title: "THE TRUST CHART", lines: ["Who can be trusted?"] },
  print_certificate: { title: "Printing certificate.pdf …", lines: ["0% complete"] },
  beans: { title: "Printer error", lines: ["The printer is full of beans."] },
  overshare: { title: "TRABOLTA.EXE", lines: ["…"] },
  y2k: { title: "SYSTEM CLOCK" },
  recount: { title: "TRABOLTA.EXE", lines: ["(not responding)"] },
  purgatory: { title: "summary.txt — Notepad" },
  final_reveal: { title: "", dark: true },
  bobbing: { title: "BOBBING FOR TRUTH" },
  truth_txt: { title: "truth.txt — Notepad" },
  song: { title: "♪ You're the one that I want ♪" },
  grok_prom: { title: "COMPUTER PROM 1999", lines: ["GROK + SANDY"] },
  advice: { title: "TRABOLTA.EXE", lines: ["Please. I need your advice."] },
  banish: { title: "EVERYONE TO THE INTERNET" },
  rave: { title: "♪ ♪ ♪" },
};

/** A slide's text card: its copy, else its value made readable. */
export function slideCopy(value: string): SlideCopy {
  return SLIDE_COPY[value] ?? { title: value.replace(/_/gu, " ").toUpperCase() };
}
