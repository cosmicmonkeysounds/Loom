//! A made-up screen state for drawing a scene with no server (wave 17):
//! the preview harness and the lanes' tests. Every field the cutscenes read
//! has a plausible late-night value; override what a scene needs.

import { creditsView, type CreditsFile, type CreditsView } from "../../../core/src/credits.ts";
import { EMPTY_NIGHT, languageOf, type ResultOutcome, type ScreenBathroom, type ScreenLanguage, type ResultRow, type RulingStamp, type ScreenChart, type ScreenKing, type ScreenMoment, type ScreenNight, type ScreenResultQuestion, type ScreenResults, type ScreenState, type ScreenTarget } from "../screen.ts";

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
  /** (wave 26, R5) This spot's `here` (players in its room in the game): a
   *  spot block `{announce: false, here}`; absent, no spot block. */
  here?: number;
  /** (wave 26, T2) A glitch cued at this server ms (`program.glitch`, seq 1),
   *  live for this page (`firstNow` before it); absent, none. */
  glitch?: number;
}

/** Programs for a fake chart / a fake pick. */
export const FAKE_PROGRAMS: readonly string[] = ["Winamp", "Excel", "MS Paint", "Minesweeper", "Netscape Navigator", "RealPlayer", "ICQ", "Encarta 95", "SimCity 2000", "Paint Shop Pro", "Solitaire", "Notepad"];

/** Staff for a fake chart (wave 21): player parts ranked beside the programs. */
export const FAKE_STAFF: ReadonlyArray<{ name: string; value: number }> = [
  { name: "Clippy", value: 72 },
  { name: "Norton Anti-Virus", value: 40 },
];

/** A fake chart: the programs (96, 89, …) with `staff` rows ranked among them. */
export function fakeChart(slide = "trust_chart", revealAt = 0, staff: ReadonlyArray<{ name: string; value: number }> = FAKE_STAFF): ScreenChart {
  const rows = [...FAKE_PROGRAMS.map((name, i) => ({ name, value: 96 - i * 7, staff: false })), ...staff.map((s) => ({ ...s, staff: true }))].sort((a, b) => b.value - a.value);
  return { slide, rows, top: FAKE_PROGRAMS[0]!, bottom: FAKE_PROGRAMS[FAKE_PROGRAMS.length - 1]!, revealAt };
}

export function fakeState(o: FakeOpts = {}): ScreenState {
  const now = o.now ?? Date.now();
  return {
    now,
    receivedAt: now,
    night: { ...EMPTY_NIGHT, phase: "desktop", step: 6, bottle_pick: "Winamp", award_winner: "Excel", award_value: 38, help_votes: 7, thwart_votes: 3, alerts: "dialog", ...o.night },
    moments: o.moments ?? [],
    cues: {},
    character: { id: "Trabolta", hidden: o.introduced === false, awake: o.introduced !== false, online: true, hold: false },
    attract: o.introduced === false,
    countdown: o.countdown ?? null,
    remaining: o.remaining ?? null,
    chart: o.chart === undefined ? fakeChart() : o.chart,
    target: o.target ?? "tv",
    program: { slide: null, overlay: null, blackout: null, flicker: null, ...(o.glitch !== undefined ? { glitch: { value: "glitch", cue: "screens_glitch", seq: 1, at: o.glitch } } : {}) },
    ...(o.glitch !== undefined ? { firstNow: o.glitch - 60_000 } : {}),
    spot: o.here === undefined ? null : { announce: false, here: o.here },
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

// --- made-up credits (wave 44) ------------------------------------------------------------
//
// Made-up people: never the crew's or the cast's real names (the show's
// `credits.json` has those).

const FAKE_CREDITS_FILE: CreditsFile = {
  title: "Trapped in the Internet",
  subtitle: "A night on the Desktop",
  sections: [
    { heading: "Cast", people: [{ role: "Clippy", name: "Alex Example" }, { role: "Task Manager", name: "Sam Sample" }, { role: "Norton Anti-Virus", name: "Jordan Placeholder" }, { role: "The Installation Wizard", name: "Robin Fixture" }] },
    { heading: "Crew", people: [{ role: "Director", name: "Casey Demo" }, { role: "Sound and lights", name: "Morgan Mock" }, { role: "The server room", name: "Taylor Stub" }] },
    { heading: "Starring the programs", programs: true },
    { heading: "Thanks", lines: ["Everyone who came, and everyone who stayed for the credits."] },
  ],
  end: ["Thank you for playing.", "Happy Halloween."],
};

/** (wave 45) A made-up Bathroom Report for `?preview=bathroom` (`bath=one`: one goer; `bath=nobody`). */
export function fakeBathroom(kind: string | null): ScreenBathroom {
  if (kind === "nobody") return { goers: 0, never: 9, total_s: 0, most: null, most_s: 0, least: null, least_s: 0, toggler: null, toggles: 0 };
  if (kind === "one") return { goers: 1, never: 8, total_s: 260, most: "Winamp", most_s: 260, least: null, least_s: 0, toggler: "Winamp", toggles: 2 };
  return { goers: 31, never: 4, total_s: 24_330, most: "Netscape Navigator", most_s: 2_710, least: "Minesweeper and Solitaire", least_s: 40, toggler: "Winamp", toggles: 14 };
}

/** (wave 48) Words the over-eager filter flags (a stem inside: "password" for "ass"), a few
 *  mild swears among them, unique and lower case, for `fakeLanguage`. */
export const FAKE_FLAGGED_WORDS: readonly string[] = [
  "password", "hello", "check", "button", "trumpet", "saturday", "damn", "class", "heck", "scrap", "title", "crap", "assignment", "cocktail",
  "danger", "passport", "assistant", "grumpy", "checklist", "attitude", "peacock", "massive", "dickens", "parse", "sparse", "classic", "bumblebee", "competition",
  "scrapbook", "buttercup", "glasses", "shellfish", "brass", "farther", "nincompoop", "refrigerator", "prickly", "swanky", "bass", "embassy", "cockpit", "petition",
  "rebuttal", "compass", "othello", "constitution", "cassette", "dangerous", "butterfly", "frumpy", "sassy", "checkmate", "titanic", "arsenal", "harass", "molasses",
  "lmao", "darn", "bloody", "frick", "album", "crappy", "assessment", "trespass", "picasso", "bypass", "superstition", "hassle", "grasshopper", "shell", "wtf", "dang", "rump",
];

/** (wave 48b) Strong words a real night censors at a low strength (never a slur: those are only ever a count). */
export const FAKE_STRONG_WORDS: readonly string[] = ["shit", "fuck", "fucking", "bullshit", "asshole", "bastard", "dick", "piss", "shitty", "motherfucker", "pissed", "wanker", "bollocks", "bugger", "arse", "hell", "fart", "poop", "boobs", "turd"];

/** (wave 48b) More buried and mild words, and the endings guests give them, for the hundreds. */
const FAKE_MORE: readonly string[] = [
  "passwords", "hellooo", "checking", "buttons", "classes", "titles", "documents", "document", "hellfire", "shellshock", "scunthorpe", "matchbox", "cocktails", "assassin",
  "bassoon", "carcass", "chassis", "cuckoo", "deadass", "glassware", "grass", "hashtag", "hitchcock", "jackass", "lass", "mass", "morass", "pass", "passenger",
  "passion", "passive", "sass", "stitches", "tithe", "titmouse", "toucan", "tuttifrutti", "badass", "bassist", "brassiere", "butterscotch", "buttress", "rebutton",
  "scuttlebutt", "shuttlecock", "weathercock", "woodcock", "hancock", "babcock", "dickhead", "dickering", "crapshoot", "craps", "crapper", "damnation", "damned",
  "goddamn", "heckler", "hecking", "hellish", "helluva", "othellos", "seashell", "nutshell", "eggshell", "bombshell", "hellraiser", "turdle", "saturdays", "crumpet",
  "rumpus", "trumpets", "frumpily", "rumple", "grumpily", "titter", "titular", "constitute", "institute", "repetition", "petite", "appetite", "titanium", "entitled",
  "bumble", "bumper", "bumpkin", "bumpy", "bums", "darned", "darnit", "dangit", "frickin", "fricking", "friggin", "fartlek", "farted", "poopy", "nincompoops", "pooped",
  "bloodied", "buggered", "bollocking", "arsed", "arses", "boob", "turds", "pissing", "shits", "fucks", "fucker", "fucked", "assholes", "bastards", "dicks", "wtff",
  "omfg", "lmfao", "fml", "stfu", "heckity", "hellohello", "passw0rd", "p@ssword", "h3llo", "ch3ck", "butt0n", "cl@ss", "sh!t", "f*ck", "d@mn", "cr@p", "a$$",
];

/** (wave 48b) Every made-up censored word, unique, at least 400 of them: the lists above, then their plurals and -y's. */
export const FAKE_CENSORED_WORDS: readonly string[] = (() => {
  const base = [...FAKE_STRONG_WORDS.slice(0, 6), ...FAKE_FLAGGED_WORDS, ...FAKE_STRONG_WORDS.slice(6), ...FAKE_MORE];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (w: string) => {
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  };
  base.forEach(add);
  const takes = { s: /[a-rt-z]$/u, y: /[a-rt-xz]$/u, ed: /[a-ce-rt-xz]$/u } as const;
  for (const end of ["s", "y", "ed"] as const) for (const w of base) if (out.length < 460 && takes[end].test(w)) add(`${w}${end}`);
  return out;
})();

/** (wave 48b) Times each of `n` words was censored, most first: a long tail of ones under a few favourites. */
export function fakeCounts(n: number, top = 40): number[] {
  return Array.from({ length: n }, (_, i) => Math.max(1, Math.round(top / (i + 1) ** 0.9)));
}

/**
 * (wave 48) A made-up Language Report for `?preview=language` (wave 48b's shape). `lang=`:
 * `none` nothing flagged · `kept` flagged, none censored · `one` one word · `dozen` 12 words ·
 * `unsaid` a dozen and 4 unsaid (bars) · `bars` only unsaid words, at strength 0 ·
 * `hundreds` 180 words and 7 unsaid · `max` 400 words, 62 more and 9 unsaid · `tie` a tie for
 * the most · `w48` a wave 48 server's report (≤ 60 words, no counts, strength or ⭐) through
 * `languageOf`. Anything else (the default): a typical night, 120 words and 3 unsaid.
 */
export function fakeLanguage(kind: string | null): ScreenLanguage {
  const words = (n: number) => FAKE_CENSORED_WORDS.slice(0, n);
  const report = (o: Partial<ScreenLanguage> & { n?: number; top?: number }): ScreenLanguage => {
    const n = o.n ?? 0;
    return { flagged: 0, censored: 0, curser: null, curses: 0, words: words(n), counts: fakeCounts(n, o.top), more: 0, unsaid: 0, level: 100, stars: 0, ...o };
  };
  if (kind === "none") return report({ flagged: 0 });
  if (kind === "kept") return report({ flagged: 27, curser: "Excel", curses: 12, level: 100, stars: 0 });
  if (kind === "one") return report({ flagged: 3, censored: 1, curser: "Winamp", curses: 3, words: ["heck"], counts: [1], level: 100, stars: 6 });
  if (kind === "dozen") return report({ n: 12, top: 9, flagged: 61, censored: 34, curser: "Netscape Navigator", curses: 17, level: 60, stars: 41 });
  if (kind === "unsaid") return report({ n: 12, top: 9, flagged: 70, censored: 40, unsaid: 4, curser: "Netscape Navigator", curses: 19, level: 25, stars: 96 });
  if (kind === "bars") return report({ flagged: 6, censored: 6, unsaid: 6, curser: "RealPlayer", curses: 6, level: 0, stars: 72 });
  if (kind === "hundreds") return report({ n: 180, flagged: 702, censored: 455, unsaid: 7, curser: "Netscape Navigator", curses: 88, level: 50, stars: 212 });
  if (kind === "max") return report({ n: 400, top: 60, flagged: 2_416, censored: 1_380, more: 62, unsaid: 9, curser: "Netscape Navigator", curses: 233, level: 100, stars: 388 });
  if (kind === "tie") return report({ flagged: 31, censored: 6, curser: "Winamp and MS Paint", curses: 9, words: ["password", "hello", "button", "darn", "heck", "trumpet"], counts: [3, 2, 1, 1, 1, 1], level: 90, stars: 14 });
  if (kind === "w48") return languageOf({ flagged: 212, censored: 118, curser: "Netscape Navigator", curses: 41, words: FAKE_FLAGGED_WORDS.slice(0, 60), more: FAKE_FLAGGED_WORDS.length - 60 })!;
  return report({ n: 120, flagged: 388, censored: 236, unsaid: 3, curser: "Netscape Navigator", curses: 61, level: 75, stars: 140 });
}

/** A made-up `CreditsView` with `programs` of the fake programs (cycled, numbered past the list). */
export function fakeCredits(programs = FAKE_PROGRAMS.length): CreditsView {
  const names = Array.from({ length: Math.max(0, programs) }, (_, i) => (i < FAKE_PROGRAMS.length ? FAKE_PROGRAMS[i]! : `${FAKE_PROGRAMS[i % FAKE_PROGRAMS.length]!} ${Math.floor(i / FAKE_PROGRAMS.length) + 1}`));
  return creditsView(FAKE_CREDITS_FILE, names, 1);
}
