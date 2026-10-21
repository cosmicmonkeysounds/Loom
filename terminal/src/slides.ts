//! The screen layer, the pure parts (OCT31 K-17 + N-03): overlays, PNG
//! slides, the corner countdown and the Y2K clock, stacked over whatever the
//! terminal would show anyway. The server folds the story's screen cues into
//! a per-target `program` (`core/server/routes/screen.ts`); this decides what
//! is on top *now*:
//!
//!   overlay (blackout · go_to_living_room · alarm)
//!     > slide — held `SLIDE_HOLD_MS` (45 s terminals / 90 s TV), or until the
//!       next cue for the persistent ones (`bingo`, `y2k`, `trust_chart`,
//!       `truth_txt`, the finale's waits `bobbing` / `advice` / `grok_prom` /
//!       `banish`, the ceremony's `award_*`); a slide beats attract
//!     > attract (the character hidden or asleep — K-16)
//!     > the base view (face / world / mirror).
//!
//! The corner countdown (`countdown_*` never replaces a slide) shows the
//! story's running countdown over a slide, attract or the base view. A
//! pilot session pre-empts a slide and the corner; an overlay ends the
//! pilot. `flicker` is a one-shot stutter over everything but a blackout.
//! A room terminal (wave 7, `room`: the server-room terminal) never shows a
//! story slide or the corner — it is a room's own screen, not the house's —
//! but the overlays (blackout, alarm) and the flicker still reach it.
//! Every flash is ≤ 3 Hz and never full-field red (photosensitivity).
//!
//! A clip (`SCREEN_CLIPS`, Trabolta's `play_on_the_screens`) never cuts a
//! story slide short: while the story slide this page saw last is still in
//! its hold, it stays up and the clip waits under it (shown for whatever is
//! left of its own hold). The one memory here is that last story slide, kept
//! per target in `localStorage` too (keyed to the sim's `announceEpoch`), so
//! a terminal that reloads mid-clip still shows the story slide. A terminal
//! with no memory at all (a first boot, cleared storage), or one whose memory
//! is older than the clip by more than `MEMO_GAP_MS` (it was off when the clip
//! went up, so it may have missed a story slide), can't know what the clip
//! went up over, and the server sends only the newest cue: the story
//! slide may still be held under it, so it shows no clip until a story
//! slide put up before that clip would have lapsed (the story wins).

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
  /** The slide on top, with its cue's `seq` (bumps on a repeat) and `at`
   *  (server ms, 0 = history) — a cutscene is keyed on the one and drawn from the other. */
  slide: { value: string; cue: string; seq: number; at: number } | null;
  /** Seconds on the corner countdown, or null for none. */
  corner: number | null;
  /** Seconds to midnight for the Y2K clock (`y2k` slide), or null when not running. */
  y2k: number | null;
  /** The seq of a flicker to play now (once per seq), or null. */
  flicker: number | null;
  /** The live chart for the slide on screen (the Trust Chart), or null. */
  chart: ScreenChart | null;
  /** How many of the chart's rows are revealed so far, counted from the bottom. */
  chartShown: number;
}

export const NO_LAYERS: ScreenLayers = { overlay: null, slide: null, corner: null, y2k: null, flicker: null, chart: null, chartShown: 0 };

const isOverlay = (v: string): v is OverlayKind => v === "blackout" || v === "go_to_living_room" || v === "alarm";

/** Trabolta's `play_on_the_screens` clips (fact M19), cued `terminals_*` only. */
export const SCREEN_CLIPS: readonly string[] = ["dancing_baby", "hamster_dance", "under_construction", "youve_got_mail"];
type ProgramSlide = NonNullable<ScreenState["program"]["slide"]>;
/** A memo last confirmed more than this before a clip went up missed a
 *  stretch (the page was off or asleep): it may not hold the story slide
 *  under the clip. Polls run every 1–2 s; a reload takes a few seconds more. */
export const MEMO_GAP_MS = 15_000;
const isClip = (s: ProgramSlide) => s.kind === "slide" && s.cue.startsWith("terminals_") && SCREEN_CLIPS.includes(s.value);

/**
 * What this page knows lies under a clip, per target: the newest non-clip
 * slide it saw (`story`, null = a base / no slide), for the sim `epoch`.
 * `blindUntil` (server ms) marks a first look that was already a clip —
 * nothing known under it until then (a story slide cued before that clip is
 * past its hold by then). `seenAt` (server ms) is the newest answer this memo
 * was confirmed against.
 */
interface ScreenMemo {
  epoch: string | null;
  story: ProgramSlide | null;
  blindUntil: number;
  seenAt: number;
}
type MemoStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memo = new Map<ScreenTarget, ScreenMemo>();
const memoKey = (t: ScreenTarget) => `loom.terminal.screen.${t}`;
/** undefined = not resolved yet (the page's `localStorage`, if it has one). */
let memoStorage: MemoStorage | null | undefined;
function storage(): MemoStorage | null {
  if (memoStorage === undefined) {
    try {
      memoStorage = typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      memoStorage = null;
    }
  }
  return memoStorage;
}
/** Use this storage for the memo (tests; null = memory only). Forgets the in-memory memo. */
export function setScreenMemoStorage(s: MemoStorage | null): void {
  memoStorage = s;
  memo.clear();
}
/** Forget the story slide under a clip (tests). */
export function resetScreenMemo(): void {
  memo.clear();
  for (const t of ["terminals", "tv"] as const) {
    try {
      storage()?.removeItem(memoKey(t));
    } catch {
      // storage refused: the in-memory memo is gone anyway
    }
  }
}
function isShot(x: unknown): x is ProgramSlide {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return typeof r["value"] === "string" && typeof r["cue"] === "string" && typeof r["seq"] === "number" && typeof r["at"] === "number" && (r["kind"] === "slide" || r["kind"] === "base");
}
/** The memo for this target and sim, from memory else storage (a reload). */
function recall(target: ScreenTarget, epoch: string | null): ScreenMemo | undefined {
  let m = memo.get(target);
  if (m === undefined) {
    try {
      const raw = storage()?.getItem(memoKey(target));
      const j = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      if (j !== null && (typeof j["epoch"] === "string" || j["epoch"] === null) && (j["story"] === null || isShot(j["story"]))) {
        m = { epoch: j["epoch"] as string | null, story: (j["story"] as ProgramSlide | null) ?? null, blindUntil: typeof j["blindUntil"] === "number" ? j["blindUntil"] : 0, seenAt: typeof j["seenAt"] === "number" ? j["seenAt"] : 0 };
        memo.set(target, m);
      }
    } catch {
      // unreadable: no memory
    }
  }
  // Another sim (a restart, a server boot): its slides are not this one's.
  return m !== undefined && m.epoch === epoch ? m : undefined;
}
function remember(target: ScreenTarget, m: ScreenMemo): void {
  const prev = memo.get(target);
  memo.set(target, m);
  if (prev !== undefined && prev.epoch === m.epoch && prev.story?.seq === m.story?.seq && prev.blindUntil === m.blindUntil && prev.seenAt === m.seenAt) return;
  try {
    storage()?.setItem(memoKey(target), JSON.stringify(m));
  } catch {
    // storage full / refused: the in-memory memo still holds for this page
  }
}

/**
 * What the screen shows on top, `nowMs` local ms (`Date.now()`). Ages are
 * measured on the server's clock (its `now` + the time since the answer
 * arrived), so a tablet with the wrong time still holds slides right.
 */
export function screenLayers(state: ScreenState | null, nowMs: number, o: { piloting: boolean; peek?: boolean; room?: boolean }): ScreenLayers {
  if (state === null) return NO_LAYERS;
  const since = Math.max(0, nowMs - state.receivedAt);
  const serverNow = state.now + since;
  const age = (at: number) => (at > 0 ? serverNow - at : Number.POSITIVE_INFINITY);
  const p = state.program;

  let overlay: OverlayKind | null = null;
  if (p.blackout !== null && age(p.blackout.at) < BLACKOUT_MS) overlay = "blackout";
  else if (p.overlay !== null && isOverlay(p.overlay.value)) overlay = p.overlay.value;

  let slide: ScreenLayers["slide"] = null;
  const held = (x: ProgramSlide) => x.kind === "slide" && (x.persist || age(x.at) < SLIDE_HOLD_MS[state.target]);
  let s = p.slide;
  const epoch = state.announceEpoch;
  if (s === null || !isClip(s)) remember(state.target, { epoch, story: s, blindUntil: 0, seenAt: state.now });
  else {
    let m = recall(state.target, epoch);
    // A first look that is already a clip, or a memo from before the page
    // went dark (it may have missed a story slide): what the clip went up
    // over is unknown.
    if (m === undefined || (s.at > 0 && m.seenAt < s.at - MEMO_GAP_MS)) m = { epoch, story: null, blindUntil: s.at > 0 ? s.at + SLIDE_HOLD_MS[state.target] : 0, seenAt: state.now };
    else m = { ...m, seenAt: Math.max(m.seenAt, state.now) };
    remember(state.target, m);
    const under = m.story;
    if (under !== null && under.seq < s.seq && under.at <= s.at && held(under)) s = under; // the story slide keeps its hold
    else if (serverNow < m.blindUntil) s = null; // a story slide may be held under it, unseen: the story wins
  }
  // A pilot, a peek or a room terminal: no slide (nor the corner below).
  const bare = o.piloting || o.peek === true || o.room === true;
  if (!bare && s !== null && held(s)) slide = { value: s.value, cue: s.cue, seq: s.seq, at: s.at };

  const remaining = state.remaining === null ? null : Math.max(0, state.remaining - Math.floor(since / 1000));
  const y2k = state.countdown === "y2k" ? remaining : null;
  // A peek clears the corner too: its box sits over the typed fallback's CONNECT.
  const corner = overlay === null && !bare && state.countdown !== null && remaining !== null && slide?.value !== "y2k" ? remaining : null;

  const flicker = p.flicker !== null && overlay !== "blackout" && age(p.flicker.at) < FLICKER_FRESH_MS ? p.flicker.seq : null;
  const chart = overlay === null && slide !== null && state.chart !== null && state.chart.slide === slide.value ? state.chart : null;
  const chartShown = chart === null ? 0 : chartReveal(chart.rows.length, chart.revealAt, serverNow);
  return { overlay, slide, corner, y2k, flicker, chart, chartShown };
}

/** A peek (B21) lasts until nobody has touched the terminal for this long. */
export const PEEK_MS = 30_000;

/**
 * May a tap on a slide peek under it (B21)? Only on a face terminal (not the
 * TV, not a mirror: nothing to scan there) showing its scanner — the slide
 * would otherwise cover "type your program name" for as long as it is held
 * (the y2k slide: the whole final hour), and a tablet with no camera could
 * open no line at all. The peek hides the slide only: an overlay still
 * covers everything.
 */
export function canPeek(view: string, terminal: "attract" | "connecting" | "piloting" | "setup", screensaver: boolean): boolean {
  return view !== "tv" && view !== "mirror" && terminal === "attract" && !screensaver;
}

/**
 * The peek's state machine (B21), pure: fed timestamps, the app owns the
 * timer and the input listeners. A tap on the slide starts (or keeps) the
 * peek; any input while peeking restarts its clock; `PEEK_MS` with no input,
 * or the terminal leaving its scanner (connecting, piloting, the screensaver),
 * ends it until the next tap — the slide (and the corner countdown, which a
 * peek also hides: its box covers CONNECT) is back.
 */
export class PeekClock {
  private last: number | null = null;
  constructor(private readonly limit: number = PEEK_MS) {}
  /** A tap on the held slide: peek from now. */
  tap(now: number): void {
    this.last = now;
  }
  /** Someone touched or typed: a running peek lasts another `limit`. */
  touch(now: number): void {
    if (this.last !== null) this.last = now;
  }
  /** Is the peek on at `now`? Ending is for good (until the next tap). */
  on(now: number, peekable: boolean): boolean {
    if (this.last === null) return false;
    if (!peekable || now - this.last >= this.limit) {
      this.last = null;
      return false;
    }
    return true;
  }
}

/** The chart reveals one row every this many ms, bottom first. */
export const CHART_STEP_MS = 1500;

/**
 * How many of a chart's `lines` rows are up, counted from the last (the
 * least trusted first, the top last): one at once, one more every `stepMs`
 * after `revealAt` (server ms; `now` on the server's clock too). A `revealAt`
 * of 0 — history, or an older server — shows every row.
 */
export function chartReveal(lines: number, revealAt: number, now: number, stepMs: number = CHART_STEP_MS): number {
  if (lines <= 0) return 0;
  if (revealAt <= 0) return lines;
  return Math.min(lines, Math.floor(Math.max(0, now - revealAt) / stepMs) + 1);
}

/** The banner words for a chart's call-outs (any other chart: TOP / BOTTOM). */
export const CHART_CALLOUTS: Record<string, { top: string; bottom: string }> = {
  trust_chart: { top: "MOST TRUSTED", bottom: "LEAST TRUSTED" },
};
export function chartCallouts(slide: string): { top: string; bottom: string } {
  return CHART_CALLOUTS[slide] ?? { top: "TOP", bottom: "BOTTOM" };
}

/** The chart's rows as the slide draws them: rank, name, number. Ties share
 *  a rank (1, 2, 2, 4). Who is called out is the server's `top` / `bottom`. */
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
  return slideNames(slide).map((n) => `${base}slides/${n}.png`);
}

/** A slide's clips, tried before its PNGs on the TV only (N-04a): the same
 *  names as `.mp4` (`screens_ad_hijack.mp4`, else `ad_hijack.mp4`). The wall
 *  tablets never try video (the oldest are Chrome 87 / Safari 14). */
export function slideVideoSources(slide: { value: string; cue: string }, base: string): string[] {
  return slideNames(slide).map((n) => `${base}slides/${n}.mp4`);
}

/** The cue then the bare value, deduplicated; anything but a plain name drops. */
function slideNames(slide: { value: string; cue: string }): string[] {
  const safe = (n: string) => /^[a-z0-9_-]+$/iu.test(n);
  return [...new Set([slide.cue, slide.value])].filter(safe);
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
  // Trabolta's `play_on_the_screens` clips (fact M19): `terminals_*` only.
  dancing_baby: { title: "DANCING BABY", lines: ["Loading baby.avi…", "♪ ooga-chaka ♪"] },
  hamster_dance: { title: "THE HAMSTER DANCE", lines: ["Welcome to Hampton's page.", "♪ ♪ ♪"] },
  under_construction: { title: "UNDER CONSTRUCTION", lines: ["This page is under construction.", "Please come back soon!"] },
  youve_got_mail: { title: "YOU'VE GOT MAIL!", lines: ["1 new message in your Inbox."] },
};

/** A slide's text card: its copy, else its value made readable. */
export function slideCopy(value: string): SlideCopy {
  return SLIDE_COPY[value] ?? { title: value.replace(/_/gu, " ").toUpperCase() };
}
