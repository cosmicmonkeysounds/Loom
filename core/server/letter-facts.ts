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
  debt: "their debt",
  career: "a career",
  loneliness: "loneliness: they never wanted to be alone",
  mortality: "mortality: they never wanted to die",
};

/** How the night ended, from where Trabolta stands (`Night.ending`). */
export const LETTER_ENDINGS: Readonly<Record<string, string>> = {
  song: "Every fact the programs gave you was true. You solved the Grand Unified Theory and sang to Sandy: you're the one that I want. Whoever wanted to leave the computer was free to go.",
  song_pickup:
    "Not every fact the programs gave you was true, but one of them gave you the line that works on Sandy. You sang it to her. Whoever wanted to leave the computer was free to go.",
  rave: "Nobody had the line for Sandy. You took your shot alone, she said she did not understand, and you decided that was a yes. You rode off to computer prom.",
  help: "You asked the programs for relationship advice and they voted to help you win Sandy.",
  banished: "You asked the programs for relationship advice and they voted to thwart you. They banished you.",
  hand_jive: "You asked the programs for relationship advice, they voted to thwart you and banished you, and the night ended in the hand jive.",
  disabled: "The programs found the combination in the server room and switched you off. Every light went out. You have been switched back on since, and you are writing from your desk.",
  destroyed: "The programs ran the self-destruct in the server room: the computer was turned off without Shut Down being followed. You are writing from a backup.",
};

const LIST_LABELS: Readonly<Record<RecapList, string>> = {
  trust: "most trusted program",
  truths: "true facts given",
  lies: "lies you accepted from them",
  internetVisits: "trips to the Internet",
  codex: "files in the Codex",
  quests: "quests done",
  truthcoin: "Truthcoin",
  shares: "files shared with others",
  chess: "chess wins against the King",
  bathroom: "bathroom breaks",
};

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

/** "1st of 38 for Truthcoin (412)": a program's top-3 places (a value of
 *  0 never ranks), and the bottom of the trust list. */
export function highlightsOf(recap: Recap, id: string): string[] {
  const out: string[] = [];
  for (const k of RECAP_LISTS) {
    const rows = recap.lists[k];
    const row = rows.find((r) => r.id === id);
    if (row === undefined) continue;
    if (row.rank <= 3 && row.value > 0) out.push(`${ordinal(row.rank)} of ${rows.length} for ${LIST_LABELS[k]} (${row.value})`);
    else if (k === "trust" && rows.length >= 4 && row.rank === rows[rows.length - 1]!.rank && row.value < 0) out.push(`the least trusted program of the night (trust ${row.value})`);
  }
  const duck = recap.duck.find((d) => d.id === id);
  if (duck !== undefined && duck.rank <= 3) out.push(`${ordinal(duck.rank)} fastest to find the Golden Duck (${duck.time})`);
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
  const program: Record<string, unknown> = {
    name: p.name,
    who: feat?.who ?? null,
    came_for: feat?.cameFor ?? (problem === null ? null : (LETTER_PROBLEMS[problem] ?? null)),
    came_for_in_their_words: ownWords,
    left_behind: leftText ?? (leftKind === "deposited" ? "something in the deposit box (they did not say what)" : null),
    left_nothing: leftKind === "nothing",
    side: faction === null ? null : (sim.crews.displayName(faction) ?? faction),
    cleared: text(sim, `${id}.cleared`) === "true",
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
  };
  return { to: { kind: "guest", name: p.name }, facts: { date, kind: "guest", program, night } };
}
