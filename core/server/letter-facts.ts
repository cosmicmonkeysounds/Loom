//! What Trabolta's letter writer is told about one person (wave 41,
//! `docs/loom-w41-contract.md` C6): the night summary in a `letter` frame.
//! Pure: read off the live `Sim` and the K-26 recap (`recap.ts`), at the
//! moment a director asks for the letters.
//!
//! Only stats and the person's own words go in: never a facts key, a
//! secret codex entry, a code, or another guest's private text. The two
//! secret slots a program typed itself (`human_problem_text`,
//! `left_behind_text`) are the exception on purpose: the letter is to them.
//!
//! The featured programs' identities and the endings are the show's
//! (*Trapped in the Internet*), as `talk-scenes.ts` holds its talk lines;
//! another story gets the stats alone. DRAFT w41.

import { asNumber, display } from "../src/runtime/expr.ts";
import type { Sim } from "../src/runtime/sim/index.ts";
import type { LetterEntry, LetterTo } from "./letters.ts";
import { RECAP_LISTS, type Recap, type RecapList } from "./recap.ts";

/** Who a featured program really is, and what they came for (review.loom
 *  `Your File`). */
export const LETTER_FEATURED: Readonly<Record<string, { who: string; cameFor: string }>> = {
  excel: { who: "Randy Barkmore Sr., ninety, five terms as Mayor of Halifax", cameFor: "to live forever, and to run for Mayor once more" },
  openoffice: { who: "Dana Anderson, formerly of the FBI", cameFor: "to have every record of the hack destroyed" },
  draftkings: { who: "the artist formerly known as Crab Fisherwoman", cameFor: "to win her casinos back" },
  bugdom: { who: "Bea Nunes, of the crickets", cameFor: "a hundred hours for every minute, to build Bugdom Reloaded again" },
  jeeves: { who: "Virgil Jeeves, children's librarian", cameFor: "the Map Librarian job, and to be asked again" },
  runescape: { who: "Poppy van Mises", cameFor: "to put the computer's economy on a gold standard" },
  mspaint: { who: "Maria Sophia Paine", cameFor: "a million dollars and one painting" },
  vlc: { who: "Victor Louis Christianson", cameFor: "to keep his beauty forever" },
  pong: { who: "the child of William Higinbotham", cameFor: "to keep the ball in play" },
};

/** The four stock answers on the upload form. */
export const LETTER_PROBLEMS: Readonly<Record<string, string>> = {
  debt: "to make their debt go away",
  career: "a career: always something to do",
  loneliness: "never to be alone again",
  mortality: "never to die",
};

/** How the night ended, from where Trabolta stands (`Night.ending`). */
export const LETTER_ENDINGS: Readonly<Record<string, string>> = {
  song: "every fact true; Grand Unified Theory solved; you sang to Sandy; programs free to leave",
  song_pickup: "some facts false; one program gave you the line for Sandy; you sang it to her; programs free to leave",
  rave: "nobody had the line for Sandy; you tried alone; she did not understand; you took it as a yes and rode off to computer prom",
  help: "you asked the programs for relationship advice; they voted to help you win Sandy",
  banished: "you asked the programs for relationship advice; they voted to thwart you and banished you",
  hand_jive: "the programs voted to thwart you and banished you; the night ended in the hand jive",
  // DRAFT w58 (he does not come back)
  disabled: "the programs found the combination in the server room and pulled your cables; you died; you write from a backup",
  destroyed: "the programs ran the self-destruct in the server room; the computer went off without Shut Down; you write from a backup",
};

/** What a place on each list is the most of ("the most Truthcoin"). */
const LIST_LABELS: Readonly<Record<RecapList, string>> = {
  trust: "trusted",
  truths: "true facts given",
  lies: "lies you accepted from them",
  questionsRight: "questions right",
  internetVisits: "trips to the Internet",
  codex: "files in their Codex",
  quests: "quests done",
  truthcoin: "Truthcoin",
  shares: "files shared with others",
  chess: "chess wins against the King",
  bathroom: "bathroom breaks",
  bathroomMinutes: "minutes in the bathroom",
  bathroomSwitches: "switches of Bathroom Mode on and off",
};
/** Fewer programs than this and a place means nothing (1st of 2). */
export const HIGHLIGHT_MIN_PROGRAMS = 4;

export interface LetterFactsInput {
  sim: Sim;
  recap: Recap;
  /** The date the letter is written (shown as written, e.g. "October 31, 2026"). */
  date: string;
}

function num(sim: Sim, path: string): number | null {
  const v = sim.world.get(path);
  return v.kind === "null" ? null : asNumber(v);
}

function text(sim: Sim, path: string): string | null {
  const v = sim.world.get(path);
  if (v.kind === "null") return null;
  const s = display(v).trim();
  return s === "" || s === "none" ? null : s;
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The awards a program won, by name (`Night.award_winner` set to their
 *  name while `Night.award_title` held the award's title). */
export function awardsOf(sim: Sim, name: string): string[] {
  let title: string | null = null;
  const out: string[] = [];
  for (const e of sim.log.all()) {
    if (e.type !== "worldSet") continue;
    if (e.path === "Night.award_title") title = e.value;
    else if (e.path === "Night.award_winner" && e.value === name && title !== null && title !== "" && title !== "none") out.push(title);
  }
  return [...new Set(out)];
}

/** "the most Truthcoin of the 38 programs (412)": a program's top-3
 *  places in plain words (a value of 0 never ranks), and the bottom of the
 *  trust list. None in a house under `HIGHLIGHT_MIN_PROGRAMS`. */
export function highlightsOf(recap: Recap, id: string): string[] {
  const out: string[] = [];
  for (const k of RECAP_LISTS) {
    const rows = recap.lists[k];
    if (rows.length < HIGHLIGHT_MIN_PROGRAMS) continue;
    const row = rows.find((r) => r.id === id);
    if (row === undefined) continue;
    const most = row.rank === 1 ? "the most" : `the ${ordinal(row.rank)} most`;
    if (row.rank <= 3 && row.value > 0) out.push(`${most} ${LIST_LABELS[k]} of the ${rows.length} programs (${row.value})`);
    else if (k === "trust" && row.rank === rows[rows.length - 1]!.rank && row.value < 0) out.push(`the least trusted of the ${rows.length} programs (trust ${row.value})`);
  }
  const duck = recap.duck.find((d) => d.id === id);
  if (duck !== undefined && duck.rank <= 3 && recap.programs >= HIGHLIGHT_MIN_PROGRAMS) out.push(`${duck.rank === 1 ? "the fastest" : `the ${ordinal(duck.rank)} fastest`} to find the Golden Duck (${duck.time})`);
  return out;
}

/** Leave out what says nothing (null, false, 0, an empty list): the writer
 *  otherwise narrates every zero and flag. Truthcoin stays, zero or not. */
export function compactFacts(o: Record<string, unknown>, keep: ReadonlySet<string> = new Set(["truthcoin"])): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!keep.has(k) && (v === null || v === false || v === 0 || (Array.isArray(v) && v.length === 0))) continue;
    out[k] = v;
  }
  return out;
}

function valueIn(recap: Recap, list: RecapList, id: string): number {
  return recap.lists[list].find((r) => r.id === id)?.value ?? 0;
}

/** The frame's `to` and `facts` for one entry, or null when the story no
 *  longer has them. */
export function letterFactsOf(entry: LetterEntry, input: LetterFactsInput): { to: LetterTo; facts: Record<string, unknown> } | null {
  const { sim, recap, date } = input;
  const night = {
    programs: recap.programs,
    ending: recap.ending,
    ending_note: recap.ending === null ? null : (LETTER_ENDINGS[recap.ending] ?? null),
    true_facts: recap.totals.truthsAccepted,
    lies_accepted: recap.totals.liesAccepted,
    internet_trips: recap.totals.internetVisits,
    chess_wins: recap.totals.chessWins,
  };
  if (entry.kind === "performer") {
    const c = sim.model.characters.get(entry.id);
    if (c === undefined) return null;
    const player = (c as { player?: unknown }).player === true;
    const part: Record<string, unknown> = { name: entry.id, player };
    if (player) {
      part["score"] = num(sim, `${entry.id}.score`) ?? 0;
      part["trust"] = num(sim, `${entry.id}.trust`) ?? 0;
    }
    return { to: { kind: "performer", name: entry.id, part: entry.id }, facts: { date, kind: "performer", part, night } };
  }
  const p = sim.persons.get(entry.id);
  if (p === undefined) return null;
  const id = p.id;
  const featured = text(sim, `${id}.featured`);
  const feat = featured === null ? undefined : LETTER_FEATURED[featured];
  const problem = text(sim, `${id}.human_problem`);
  const ownWords = problem === "other" ? text(sim, `${id}.human_problem_text`) : null;
  const leftKind = text(sim, `${id}.left_behind`);
  const leftText = text(sim, `${id}.left_behind_text`);
  const chess = recap.chessGames.find((g) => g.id === id);
  const faction = sim.crews.factionOf(id);
  const program = compactFacts({
    name: p.name,
    who: feat?.who ?? null,
    came_for: feat?.cameFor ?? (problem === null ? null : (LETTER_PROBLEMS[problem] ?? null)),
    // Their words, in their voice: "my landlord" is the program's own.
    came_for_in_their_own_words: ownWords,
    left_behind_in_their_own_words: leftText,
    left_behind:
      leftText !== null ? null : leftKind === "deposited" ? "something in the deposit box; they never said what" : leftKind === "nothing" ? "nothing: they said they had nothing to leave" : null,
    side: faction === null ? null : (sim.crews.displayName(faction) ?? faction),
    left_early: text(sim, `${id}.gone`) === "true",
    truthcoin: valueIn(recap, "truthcoin", id),
    true_facts: valueIn(recap, "truths", id),
    lies_you_accepted_from_them: valueIn(recap, "lies", id),
    internet_trips: valueIn(recap, "internetVisits", id),
    codex_files: valueIn(recap, "codex", id),
    quests_done: valueIn(recap, "quests", id),
    files_shared: valueIn(recap, "shares", id),
    trust: valueIn(recap, "trust", id),
    chess: chess === undefined ? null : { won: chess.won, lost: chess.lost, drawn: chess.drawn },
    bathroom_breaks: valueIn(recap, "bathroom", id),
    golden_duck: recap.duck.find((d) => d.id === id)?.time ?? null,
    awards: awardsOf(sim, p.name),
    highlights: highlightsOf(recap, id),
  });
  return { to: { kind: "guest", name: p.name }, facts: { date, kind: "guest", program, night } };
}
