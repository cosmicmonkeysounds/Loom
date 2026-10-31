//! K-26 — the recap numbers for the awards ceremony: ranked lists read off
//! the live `Sim` (its world + its event log), served by
//! `GET /e/:id/api/mod/recap` as JSON plus a paste-ready text block the
//! director reads into the ceremony (or pastes into `cast:Trabolta`).
//!
//! Pure and transport-free (Node or browser). The lists are:
//!
//! - **trust** — the program's `trust` var (the Trust Chart).
//! - **truths** — accepted answers that were *true*: `truths_accepted`
//!   minus the program's accepted lies (the story counts an accepted lie as
//!   accepted, on purpose — Trabolta can't tell).
//! - **lies** — accepted confident lies (Moment of Truth + DM filings). No
//!   program var holds these (only the Kernel's total, so the agent never
//!   reads a lie count off a guest): every rise of `Kernel.lies_accepted` in
//!   the log is credited to the person the same chain was about — the
//!   nearest preceding person-headed `worldSet` or `signal` subject (both
//!   lie hooks write the program's own var just before the Kernel's). A
//!   fall (a host corrects a mis-tapped lie) comes off the same way (B11).
//!   A round-3 DM lie (`lie_q7` / `lie_q8`) counts only once 📄 truth.txt
//!   settles it (`Night.r3_closed`): in auto mode the counter rises at
//!   filing, but a server-room ending (Combo A / B, 🕊) never settles round
//!   3, so that bluff was never accepted and stays out of both lists.
//! - **questionsRight** (wave 58) — the questions a program got right, live:
//!   G9a's count (main.loom, ROLE Program), which the story writes only when
//!   G9a is pressed. Once a question: a filing standing accurate (or pending
//!   on an accurate proposal) or a spoken answer accepted ✅ and no 😤 took
//!   back. Never `truths_accepted`. A key still owed (`Night.owed_*`) counts
//!   for nobody.
//! - **internetVisits** — the `internet_visits` var, else the count of
//!   `captured` events.
//! - **codex** — entries held. **quests** — quests done. **truthcoin** —
//!   `score`.
//! - **shares** — codex entries handed to someone else (`codexUnlocked`
//!   `via: "share"`, credited to `from`; a share to a character counts).
//! - **chess** — wins against the King: `signal`s named `chess won` (the
//!   chess terminal outside the server-room door, wave 11) or `beat the
//!   machine` (a host's ♟ fallback), names folded,
//!   per subject; `chessGames` adds the `chess lost` / `chess drawn` counts.
//! - **bathroom** — Bathroom Mode trips: `go to the bathroom` signals per
//!   subject, a repeat while still away not counted again. A trip ends at
//!   `back from the bathroom` or when the story clears `<who>.afk` (the
//!   show's 15-minute timeout fires no signal). A trip count, not minutes
//!   (the journal has no `at`).
//! - **bathroomMinutes** / **bathroomSwitches** (wave 45) — off the story's
//!   own counters (`bath_s` plus an open trip up to `Time.elapsed`, rounded
//!   to the nearest minute; `bath_presses`, the on / off switches), the
//!   same numbers G13 🚻 The Bathroom Report reads. **bathroomNever** —
//!   the programs with no trip (`bath_trips` 0), who lose 5 trust at G1.
//!   All three are empty / 0 on a story without the counters.
//! - **factions** — every declared group with its members, biggest first.
//! - **duck** — the Golden Duck Speedrun (G8): each program's fastest find
//!   in the reinstallation games, fastest first, off the `SpatialHub`'s run
//!   log (`spatial-runs.jsonl`, SW-RE-14) the runtime passes in.

import { foldName } from "../src/parser/names.ts";
import { asNumber, display } from "../src/runtime/expr.ts";
import type { Sim } from "../src/runtime/sim/index.ts";
import type { DuckRun } from "./spatial.ts";

/** The story's lie counter (cast/props.loom: `Kernel.lies_accepted`). */
export const LIE_COUNTER = "Kernel.lies_accepted";
/** A program's round-3 lie flags (main.loom `verdict_q7` / `verdict_q8`). */
export const UNSETTLED_LIE_VARS = ["lie_q7", "lie_q8"] as const;
/** Set at 📄 truth.txt, when round 3 settles. */
export const ROUND3_CLOSED = "Night.r3_closed";

export interface RecapRow {
  id: string;
  name: string;
  value: number;
  /** Shared on ties: 1, 2, 2, 4. */
  rank: number;
  /** A director's rehearsal persona, not a real guest. */
  persona: boolean;
}

/** One program's best duck run (lowest time first; ties share a rank). */
export interface RecapDuckRow {
  id: string;
  name: string;
  /** The fastest find, in ms. */
  ms: number;
  /** The same as `m:ss` — the G8 award's value. */
  time: string;
  rank: number;
  persona: boolean;
  /** Where the fastest run was played. */
  world: DuckRun["world"];
  /** How many times they found the duck. */
  runs: number;
}

/** One program's games against the King (anyone who played at least one). */
export interface RecapChessRow {
  id: string;
  name: string;
  persona: boolean;
  won: number;
  lost: number;
  drawn: number;
}

/** The signals the chess + bathroom lists count (matched folded). */
export const CHESS_WON = ["chess won", "beat the machine"] as const;
export const CHESS_LOST = "chess lost";
export const CHESS_DRAWN = "chess drawn";
export const BATHROOM_GO = "go to the bathroom";
export const BATHROOM_BACK = "back from the bathroom";

export interface RecapFaction {
  id: string;
  members: Array<{ id: string; name: string }>;
}

export const RECAP_LISTS = ["trust", "truths", "lies", "questionsRight", "internetVisits", "codex", "quests", "truthcoin", "shares", "chess", "bathroom", "bathroomMinutes", "bathroomSwitches"] as const;
export type RecapList = (typeof RECAP_LISTS)[number];

export interface Recap {
  title: string;
  /** `Night.ending` once a final ending has happened, else null. */
  ending: string | null;
  programs: number;
  totals: {
    liesAccepted: number;
    truthsAccepted: number;
    internetVisits: number;
    codexHeld: number;
    questsDone: number;
    shares: number;
    chessWins: number;
    bathroomTrips: number;
    /** Wave 45: minutes in Bathroom Mode, all together (whole, rounded). */
    bathroomMinutes: number;
  };
  lists: Record<RecapList, RecapRow[]>;
  /** Everyone who played the King at chess, most wins first. */
  chessGames: RecapChessRow[];
  /** The Golden Duck Speedrun, fastest first (empty: nobody found it). */
  duck: RecapDuckRow[];
  factions: RecapFaction[];
  /** Wave 45: the programs who never went (no Bathroom Mode trip), by name. */
  bathroomNever: Array<{ id: string; name: string }>;
  /** Paste-ready text: top 5 of each list (bottom 3 for trust as well). */
  text: string;
}

const LIST_TITLES: Record<RecapList, string> = {
  trust: "Most trusted (trust)",
  truths: "Truths accepted",
  lies: "Confident lies accepted",
  // Wave 58. DRAFT w58
  questionsRight: "Questions correct (G9a, the special prize)",
  internetVisits: "Trips to the Internet",
  codex: "Codex entries held",
  quests: "Quests completed",
  truthcoin: "Truthcoin",
  shares: "Codex shares",
  chess: "Chess against the King",
  bathroom: "Bathroom trips",
  bathroomMinutes: "Minutes in Bathroom Mode",
  bathroomSwitches: "Bathroom Mode switches (on and off)",
};

function num(sim: Sim, path: string): number | null {
  return asNumber(sim.world.get(path));
}

/** The eight questions, as the story numbers them (`fact_v1` is H1's). */
const QUESTION_SLOTS = ["h1", "h2", "h3", "h4", "h5", "h6", "f1", "f2"] as const;

/** (wave 58) G9a's count, read live: main.loom's `questions_right` rule, once
 *  a question. `trapped-w58-prize.test.ts` holds the two to the same number. */
function questionsRight(sim: Sim, person: string): number {
  const read = (k: string) => display(sim.world.get(`${person}.${k}`));
  return QUESTION_SLOTS.filter((id, i) => {
    if (display(sim.world.get(`Night.owed_${id}`)) === "true") return false;
    const n = i + 1;
    const filed = read(`fact_v${n}`);
    return filed === "accurate" || (filed === "pending" && read(`fact_j${n}`) === "accurate") || (read(`judged_q${n}`) === "true" && read(`hunt_lie_q${n}`) !== "true");
  }).length;
}

/** Accepted lies per person, credited off the event log (see the header). */
export function liesByPerson(sim: Sim): Map<string, number> {
  const out = new Map<string, number>();
  let last: string | null = null;
  let prev = 0;
  for (const e of sim.log.all()) {
    if (e.type === "signal") {
      if (e.subject !== null && sim.persons.has(e.subject)) last = e.subject;
      continue;
    }
    if (e.type !== "worldSet") continue;
    if (e.path === LIE_COUNTER) {
      const n = Number(e.value);
      if (!Number.isFinite(n)) continue;
      if (last !== null && n > prev) out.set(last, (out.get(last) ?? 0) + (n - prev));
      // A host taking a lie back (B11) lowers the counter just after
      // clearing that program's `lie_qN`: the fall comes off that program.
      else if (last !== null && n < prev) out.set(last, Math.max(0, (out.get(last) ?? 0) - (prev - n)));
      prev = n;
      continue;
    }
    const dot = e.path.indexOf(".");
    const head = dot > 0 ? e.path.slice(0, dot) : e.path;
    if (sim.persons.has(head)) last = head;
  }
  return out;
}

/** Codex shares, chess games and bathroom trips per person, off the log. */
export function logCounts(sim: Sim): {
  shares: Map<string, number>;
  chess: Map<string, { won: number; lost: number; drawn: number }>;
  bathroom: Map<string, number>;
} {
  const shares = new Map<string, number>();
  const chess = new Map<string, { won: number; lost: number; drawn: number }>();
  const bathroom = new Map<string, number>();
  const away = new Set<string>();
  const won = new Set<string>(CHESS_WON.map(foldName));
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const e of sim.log.all()) {
    if (e.type === "worldSet") {
      // Bathroom Mode timed out (`set self.afk = false`): the trip is over.
      if (e.path.endsWith(".afk") && e.value === "false") away.delete(e.path.slice(0, -".afk".length));
      continue;
    }
    if (e.type === "codexUnlocked") {
      if (e.via === "share" && e.from !== null && sim.persons.has(e.from)) bump(shares, e.from);
      continue;
    }
    if (e.type !== "signal" || e.subject === null || !sim.persons.has(e.subject)) continue;
    const who = e.subject;
    const name = foldName(e.name);
    const game = () => {
      let g = chess.get(who);
      if (g === undefined) chess.set(who, (g = { won: 0, lost: 0, drawn: 0 }));
      return g;
    };
    if (won.has(name)) game().won += 1;
    else if (name === CHESS_LOST) game().lost += 1;
    else if (name === CHESS_DRAWN) game().drawn += 1;
    else if (name === BATHROOM_GO) {
      if (!away.has(who)) bump(bathroom, who);
      away.add(who);
    } else if (name === BATHROOM_BACK) away.delete(who);
  }
  return { shares, chess, bathroom };
}

/** Sort high → low (ties by name) and give shared ranks. */
export function rank(rows: Array<Omit<RecapRow, "rank">>): RecapRow[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const out: RecapRow[] = [];
  sorted.forEach((r, i) => {
    const rankHere = i > 0 && sorted[i - 1]!.value === r.value ? out[i - 1]!.rank : i + 1;
    out.push({ ...r, rank: rankHere });
  });
  return out;
}

export interface RecapOptions {
  title?: string;
  /** Persona ids (mod-spawned rehearsal guests) — flagged, still listed. */
  personas?: ReadonlySet<string> | ReadonlyMap<string, unknown>;
  /** Every duck found this story (`SpatialHub.runs()`). */
  duckRuns?: readonly DuckRun[];
}

/** `83_400` → `1:23` (whole seconds, rounded down). */
export function runTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Each program's fastest find, fastest first, with shared ranks on ties
 *  (by whole second, as read aloud). The name is the sim's when the person
 *  still exists, else the one the run recorded. */
export function duckBoard(sim: Sim, runs: readonly DuckRun[], personas: RecapOptions["personas"] = new Set<string>()): RecapDuckRow[] {
  const best = new Map<string, { run: DuckRun; count: number }>();
  for (const r of runs) {
    if (r.after === true) continue; // C7: after the end, a party favour
    const prev = best.get(r.guest);
    if (prev === undefined) best.set(r.guest, { run: r, count: 1 });
    else best.set(r.guest, { run: r.ms < prev.run.ms ? r : prev.run, count: prev.count + 1 });
  }
  const rows = [...best.values()]
    .map(({ run, count }) => ({
      id: run.guest,
      name: sim.persons.get(run.guest)?.name ?? run.name,
      ms: run.ms,
      time: runTime(run.ms),
      persona: personas.has(run.guest),
      world: run.world,
      runs: count,
    }))
    .sort((a, b) => a.ms - b.ms || a.name.localeCompare(b.name));
  const out: RecapDuckRow[] = [];
  rows.forEach((r, i) => {
    const tied = i > 0 && out[i - 1]!.time === r.time;
    out.push({ ...r, rank: tied ? out[i - 1]!.rank : i + 1 });
  });
  return out;
}

/** Round-3 lies the counter already holds that truth.txt has not settled. */
function unsettledLies(sim: Sim, person: string): number {
  if (display(sim.world.get(ROUND3_CLOSED)) === "true") return 0;
  return UNSETTLED_LIE_VARS.filter((v) => display(sim.world.get(`${person}.${v}`)) === "true").length;
}

export function computeRecap(sim: Sim, opts: RecapOptions = {}): Recap {
  const personas = opts.personas ?? new Set<string>();
  const lies = liesByPerson(sim);
  const counts = logCounts(sim);
  const captures = new Map<string, number>();
  for (const e of sim.log.all()) if (e.type === "captured") captures.set(e.person, (captures.get(e.person) ?? 0) + 1);

  const lists = Object.fromEntries(RECAP_LISTS.map((k) => [k, [] as Array<Omit<RecapRow, "rank">>])) as Record<
    RecapList,
    Array<Omit<RecapRow, "rank">>
  >;
  const totals = { liesAccepted: 0, truthsAccepted: 0, internetVisits: 0, codexHeld: 0, questsDone: 0, shares: 0, chessWins: 0, bathroomTrips: 0, bathroomMinutes: 0 };
  const chessGames: RecapChessRow[] = [];
  const bathroomNever: Recap["bathroomNever"] = [];
  const elapsed = num(sim, "Time.elapsed") ?? 0;
  let bathSeconds = 0;
  for (const p of sim.persons.values()) {
    const base = { id: p.id, name: p.name, persona: personas.has(p.id) };
    const lied = Math.max(0, (lies.get(p.id) ?? 0) - unsettledLies(sim, p.id));
    const accepted = num(sim, `${p.id}.truths_accepted`) ?? 0;
    const visits = num(sim, `${p.id}.internet_visits`) ?? captures.get(p.id) ?? 0;
    const codex = sim.codexFor(p.id).length;
    const quests = sim.questsFor(p.id).filter((q) => q.status === "done").length;
    lists.trust.push({ ...base, value: num(sim, `${p.id}.trust`) ?? 0 });
    lists.truths.push({ ...base, value: Math.max(0, accepted - lied) });
    lists.lies.push({ ...base, value: lied });
    lists.questionsRight.push({ ...base, value: questionsRight(sim, p.id) });
    lists.internetVisits.push({ ...base, value: visits });
    lists.codex.push({ ...base, value: codex });
    lists.quests.push({ ...base, value: quests });
    lists.truthcoin.push({ ...base, value: sim.scoreOf(p.id) });
    const shared = counts.shares.get(p.id) ?? 0;
    const games = counts.chess.get(p.id);
    const trips = counts.bathroom.get(p.id) ?? 0;
    lists.shares.push({ ...base, value: shared });
    lists.chess.push({ ...base, value: games?.won ?? 0 });
    lists.bathroom.push({ ...base, value: trips });
    // Wave 45: the story's own counters (G13 reads the same).
    const bathS = Math.max(0, (num(sim, `${p.id}.bath_s`) ?? 0) + (num(sim, `${p.id}.bath_open`) === 1 ? elapsed - (num(sim, `${p.id}.afk_since`) ?? elapsed) : 0));
    lists.bathroomMinutes.push({ ...base, value: Math.round(bathS / 60) });
    lists.bathroomSwitches.push({ ...base, value: num(sim, `${p.id}.bath_presses`) ?? 0 });
    // At the party (cleared, not gone, not a persona), as the G1 penalty reads it.
    const here = display(sim.world.get(`${p.id}.cleared`)) === "true" && display(sim.world.get(`${p.id}.gone`)) !== "true" && !base.persona;
    if (here && num(sim, `${p.id}.bath_trips`) === 0) bathroomNever.push({ id: p.id, name: p.name });
    bathSeconds += bathS;
    if (games !== undefined) chessGames.push({ ...base, ...games });
    totals.liesAccepted += lied;
    totals.truthsAccepted += Math.max(0, accepted - lied);
    totals.internetVisits += visits;
    totals.codexHeld += codex;
    totals.questsDone += quests;
    totals.shares += shared;
    totals.chessWins += games?.won ?? 0;
    totals.bathroomTrips += trips;
  }
  totals.bathroomMinutes = Math.round(bathSeconds / 60);
  const ranked = Object.fromEntries(RECAP_LISTS.map((k) => [k, rank(lists[k])])) as Record<RecapList, RecapRow[]>;

  const factions: RecapFaction[] = [...sim.model.factions.values()]
    .map((f) => ({
      id: f.id,
      members: sim
        .factionMembers(f.id)
        .filter((id) => sim.persons.has(id))
        .map((id) => ({ id, name: sim.persons.get(id)!.name })),
    }))
    .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));

  const endingV = sim.world.get("Night.ending");
  const ending = endingV.kind === "null" ? null : display(endingV);
  const recap: Omit<Recap, "text"> = {
    title: opts.title ?? sim.lobbyTitle(),
    ending: ending === "" || ending === "none" ? null : ending,
    programs: sim.persons.size,
    totals,
    lists: ranked,
    chessGames: chessGames.sort((a, b) => b.won - a.won || a.lost - b.lost || b.drawn - a.drawn || a.name.localeCompare(b.name)),
    duck: duckBoard(sim, opts.duckRuns ?? [], personas),
    factions,
    bathroomNever,
  };
  return { ...recap, text: recapText(recap) };
}

function line(rows: RecapRow[]): string {
  if (rows.length === 0) return "  (nobody)";
  return rows.map((r) => `  ${r.rank}. ${r.name}${r.persona ? " (persona)" : ""} — ${r.value}`).join("\n");
}

/** The bottom of the trust list, ranked from the bottom (shared on ties):
 *  at most 3, never a name the top 5 already shows, and never anyone tied
 *  with the top 5's lowest — a shared 0 isn't "least trusted" (T7-07). */
export function leastTrusted(trust: readonly RecapRow[]): RecapRow[] {
  const top = trust.slice(0, 5);
  const floor = top[top.length - 1]?.value ?? Infinity;
  const below = trust.slice(top.length).filter((x) => x.value < floor);
  return below
    .slice(-3)
    .reverse()
    .map((x) => ({ ...x, rank: 1 + below.filter((y) => y.value < x.value).length }));
}

/** The paste-ready block: top 5 per list, people with 0 left off (except trust). */
export function recapText(r: Omit<Recap, "text">): string {
  const out: string[] = [];
  out.push(`RECAP — ${r.title}`);
  out.push(`${r.programs} programs${r.ending ? ` · ending: ${r.ending}` : ""}`);
  out.push(
    `Totals: ${r.totals.truthsAccepted} truths · ${r.totals.liesAccepted} lies accepted · ${r.totals.internetVisits} Internet trips · ${r.totals.codexHeld} codex entries · ${r.totals.questsDone} quests done · ${r.totals.shares} shares · ${r.totals.chessWins} chess wins · ${r.totals.bathroomTrips} bathroom trips · ${r.totals.bathroomMinutes} bathroom minutes`,
  );
  for (const k of RECAP_LISTS) {
    if (k === "chess") {
      out.push("");
      out.push(`${LIST_TITLES.chess} (most wins):`);
      out.push(
        r.chessGames.length === 0
          ? "  (nobody played)"
          : r.chessGames
              .slice(0, 5)
              .map((g) => `  ${g.name}${g.persona ? " (persona)" : ""} — ${g.won} won · ${g.lost} lost · ${g.drawn} drawn`)
              .join("\n"),
      );
      continue;
    }
    const rows = k === "trust" ? r.lists[k] : r.lists[k].filter((x) => x.value > 0);
    out.push("");
    out.push(`${LIST_TITLES[k]}:`);
    out.push(line(rows.slice(0, 5)));
    // Only when someone sits below the top 5 (early on most programs tie
    // at 0 with the 5th, and a "(nobody)" bottom reads like a bug).
    const least = k === "trust" ? leastTrusted(r.lists.trust) : [];
    if (least.length > 0) {
      out.push("Least trusted:");
      out.push(line(least));
    }
  }
  // Wave 45: who never went (−5 trust at G1); none on a story without the counters.
  if (r.bathroomNever.length > 0) {
    out.push("");
    out.push(`Never went to the bathroom (−5 trust): ${r.bathroomNever.map((x) => x.name).join(", ")}`);
  }
  out.push("");
  out.push("Golden Duck Speedrun (fastest find):");
  out.push(
    r.duck.length === 0
      ? "  (nobody found the duck)"
      : r.duck
          .slice(0, 5)
          .map((d) => `  ${d.rank}. ${d.name}${d.persona ? " (persona)" : ""} — ${d.time} (${d.world === "vr" ? "headset" : "tablet"})`)
          .join("\n"),
  );
  out.push("");
  out.push("Factions:");
  const fs = r.factions.filter((f) => f.members.length > 0);
  if (fs.length === 0) out.push("  (none joined)");
  for (const f of fs) out.push(`  ${f.id} (${f.members.length}): ${f.members.map((m) => m.name).join(", ")}`);
  return out.join("\n");
}
