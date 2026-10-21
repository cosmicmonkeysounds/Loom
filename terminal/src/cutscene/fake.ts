//! A made-up screen state for drawing a scene with no server (wave 17):
//! the preview harness and the lanes' tests. Every field the cutscenes read
//! has a plausible late-night value; override what a scene needs.

import { EMPTY_NIGHT, type ResultOutcome, type ResultRow, type RulingStamp, type ScreenChart, type ScreenKing, type ScreenMoment, type ScreenNight, type ScreenResultQuestion, type ScreenResults, type ScreenState, type ScreenTarget } from "../screen.ts";

export interface FakeOpts {
  now?: number;
  /** The character introduced (revealed), or still hidden. */
  introduced?: boolean;
  target?: ScreenTarget;
  night?: Partial<ScreenNight>;
  moments?: ScreenMoment[];
  chart?: ScreenChart | null;
  king?: ScreenKing | null;
  countdown?: string | null;
  /** Seconds left on the countdown. */
  remaining?: number | null;
  reinstalling?: number;
  /** A results block (`fakeResults`), else none. */
  results?: ScreenResults | null;
}

/** Programs for a fake chart / a fake pick. */
export const FAKE_PROGRAMS: readonly string[] = ["Winamp", "Excel", "MS Paint", "Minesweeper", "Netscape Navigator", "RealPlayer", "ICQ", "Encarta 95", "SimCity 2000", "Paint Shop Pro", "Solitaire", "Notepad"];

export function fakeChart(slide = "trust_chart", revealAt = 0): ScreenChart {
  return { slide, rows: FAKE_PROGRAMS.map((name, i) => ({ name, value: 96 - i * 7 })), top: FAKE_PROGRAMS[0]!, bottom: FAKE_PROGRAMS[FAKE_PROGRAMS.length - 1]!, revealAt };
}

export function fakeState(o: FakeOpts = {}): ScreenState {
  const now = o.now ?? Date.now();
  return {
    now,
    receivedAt: now,
    night: { ...EMPTY_NIGHT, phase: "desktop", step: 6, bottle_pick: "Winamp", award_winner: "Excel", award_value: 412, help_votes: 7, thwart_votes: 3, alerts: "dialog", ...o.night },
    moments: o.moments ?? [],
    cues: {},
    character: { id: "Trabolta", hidden: o.introduced === false, awake: o.introduced !== false, online: true, hold: false },
    attract: o.introduced === false,
    countdown: o.countdown ?? null,
    remaining: o.remaining ?? null,
    chart: o.chart === undefined ? fakeChart() : o.chart,
    target: o.target ?? "tv",
    program: { slide: null, overlay: null, blackout: null, flicker: null },
    voice: null,
    room: null,
    announce: null,
    announces: [],
    identify: false,
    identifyLeft: null,
    announceEpoch: "preview",
    king: o.king === undefined ? { hp: 9, max: 15, fallen: false, armed: true } : o.king,
    reinstalling: o.reinstalling ?? 0,
    results: o.results ?? null,
  };
}

// --- a made-up results block (wave 18b) ------------------------------------------------
//
// Never the show's questions or answers (those live in facts.json, and the
// key answers must never be copied into a scene, a slide or a fixture, §3):
// plain made-up questions about the house, and made-up answers.

const FAKE_Q_TEXT = ["What colour is the front door of this house?", "Which room has the most chairs?", "What is written on the fridge magnet?", "How many lamps are in the hall?", "What is the cat's favourite chair?", "What music plays on the stairs?", "What shape is the doormat?", "Who painted the blue vase?"];
const FAKE_SAID = ["Blue", "Bright blue", "Green", "The kitchen", "a red stapler", "Tuesday", "Nobody knows", "the round one", "BLUE!!", "teal, maybe"];
const FAKE_OUT: readonly ResultOutcome[] = ["a", "a", "g", "a", "u", "a", "g", "p", "a", "a"];
const FAKE_RULED: readonly RulingStamp[] = ["", "s", "n", "r", "", "?", "", "", "s", ""];

/** A filing row for a fake reading (`i` picks the program and what it said). */
function fakeRow(i: number): ResultRow {
  const out = FAKE_OUT[i % FAKE_OUT.length]!;
  const ruled = FAKE_RULED[i % FAKE_RULED.length]!;
  // 🤖 SAME / NOT THE SAME only below 100 (the server's rule): a sure row carries `r` instead.
  const sure = ruled === "r" || (ruled !== "s" && ruled !== "n" && i % 3 !== 2);
  return { who: FAKE_PROGRAMS[i % FAKE_PROGRAMS.length]!, said: FAKE_SAID[i % FAKE_SAID.length]!, sure, out, ruled };
}

/** A made-up question `n` (1–8) as a reading publishes it; `rows` filings (the TV's). */
export function fakeReadQuestion(n: number, rows: number, tv = true): ScreenResultQuestion {
  const list = Array.from({ length: rows }, (_, i) => fakeRow(i + n));
  const count = (o: ResultOutcome) => list.filter((r) => r.out === o).length;
  return {
    id: n <= 6 ? `H${n}` : `F${n - 6}`,
    n,
    round: n <= 3 ? 1 : n <= 6 ? 2 : 3,
    text: FAKE_Q_TEXT[(n - 1) % FAKE_Q_TEXT.length]!,
    filed: rows,
    accepted: count("a"),
    guesses: count("g"),
    uncounted: count("u"),
    consensus: false,
    answer: null,
    truth: null,
    rows: tv ? list : null,
    more: 0,
    liars: null,
    liarsMore: 0,
  };
}

/** A made-up results block: a reading of `ids` (book numbers), or the verdict over all eight. */
export function fakeResults(kind: ScreenResults["kind"], o: { ns?: readonly number[]; rows?: number; tv?: boolean; at?: number; seq?: number } = {}): ScreenResults {
  const tv = o.tv ?? true;
  if (kind === "read") {
    const ns = o.ns ?? [1];
    return { kind, seq: o.seq ?? 7, at: o.at ?? 0, questions: ns.map((n) => fakeReadQuestion(n, o.rows ?? 12, tv)) };
  }
  const truths = ["true", "lie", "true", "none", "true", "lie", "true", "true"] as const;
  const questions = truths.map((truth, i): ScreenResultQuestion => {
    const q = fakeReadQuestion(i + 1, 0, false);
    const liars = truth === "lie" ? [{ who: FAKE_PROGRAMS[(i * 3) % FAKE_PROGRAMS.length]!, ruled: false }, { who: FAKE_PROGRAMS[(i * 3 + 1) % FAKE_PROGRAMS.length]!, ruled: true }] : [];
    return { ...q, text: null, filed: truth === "none" ? 0 : 9, accepted: truth === "none" ? 0 : 7, guesses: truth === "none" ? 0 : 2, truth, answer: tv ? FAKE_SAID[i % FAKE_SAID.length]! : null, liars: tv ? liars : null };
  });
  return { kind, seq: o.seq ?? 9, at: o.at ?? 0, questions };
}
