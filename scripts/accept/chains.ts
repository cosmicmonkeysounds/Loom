// The cue chains the acceptance helpers press on a fresh rehearsal, in the
// order the cue sheet demands since wave 9 (story-cues): a forward press out
// of turn is refused in # hosts and changes nothing, so a chain that skips a
// step stops the night where it was without a word. Pinned against the show
// by core/test/accept-chains.test.ts (every press accepted, the step reached).

/** Power On → hunt 2 open (Night.phase "hunt_2", Night.step 8). ⏱ closes the
 *  filings (the two-minute timer presses it itself if a run waits) and 📋
 *  reads Q1–Q3 before 📺 opens the preview. */
export const TO_HUNT2: readonly string[] = [
  "call_to_the_desktop",
  "start_the_bingo",
  "bingo_time",
  "introduce_trabolta",
  "start_the_hunt",
  "hunt_time_up",
  "first_moment_of_truth",
  "close_the_filing",
  "read_the_results",
  "read_the_results",
  "read_the_results",
  "second_hunt_preview",
  "start_the_second_hunt",
];

/** Power On → the Y2K clock (Night.step 14: chess wins give the door code). */
export const TO_Y2K: readonly string[] = [
  ...TO_HUNT2,
  "five_minute_warning",
  "summons_closed",
  "truth_pong",
  "round_two_tally",
  "trust_chart",
  "show_the_rankings",
  "trabolta_overshares",
  "y2k_clock",
];

/** One press of a chain: a cue name, or a cue aimed at a program the caller
 *  names by role (`who`: "bobber", "most_trusted", …). */
export type ChainStep = string | { readonly name: string; readonly who: string };

export const stepName = (s: ChainStep): string => (typeof s === "string" ? s : s.name);
export const stepWho = (s: ChainStep): string | undefined => (typeof s === "string" ? undefined : s.who);

// Wave 28: the chains after the Y2K clock (each ending, then the ceremony),
// pressed by the full-evening simulator (scripts/sim/evening.ts).

/** After 🕚, Combo B without the cables (💥, the hardware fallback): `destroyed`. */
export const Y2K_TO_DESTROYED: readonly ChainStep[] = ["patch_combo_b", "clippy_reads_summary"];

/** After 🕚, midnight's road: 🌑 → 🍎 → the bag (on the bobber) → 📄 → ⚖.
 *  The verdict then waits ~34 s (finale.loom): every answered fact accurate
 *  → the song (`song`); any lie on record → Grok Prom (below). */
export const Y2K_TO_VERDICT: readonly ChainStep[] = [
  "final_reveal",
  "bobbing_for_truth",
  { name: "brought_up_the_bag", who: "bobber" },
  "read_truth_txt",
  "the_verdict",
];

/** Grok Prom → nobody has the line: the confession and the rave (`rave`). */
export const GROK_TO_RAVE: readonly ChainStep[] = ["no_pickup_line"];

/** Grok Prom → 💌 the advice poll; the room votes Help / Thwart, then 🗳. */
export const GROK_TO_ADVICE: readonly ChainStep[] = ["ask_for_advice"];
export const ADVICE_TALLY: readonly ChainStep[] = ["advice_tally"];

/** The awards ceremony, after any ending: G1, the programs' awards (each on
 *  its winner: the caller names who), the staff awards (no subject; The
 *  Mole last), then G11. 🖌 The Painting is the caller's to add, on MS Paint,
 *  only when MS Paint is at the party (`Night.painting`). */
export const CEREMONY: readonly ChainStep[] = [
  "start_the_ceremony",
  { name: "award_most_trusted", who: "most_trusted" },
  { name: "award_least_trusted", who: "least_trusted" },
  { name: "award_frequent_flyer", who: "frequent_flyer" },
  { name: "award_lore_hoarder", who: "lore_hoarder" },
  { name: "award_truthcoin_tycoon", who: "truthcoin_tycoon" },
  { name: "award_best_liar", who: "best_liar" },
  { name: "award_duck_speedrun", who: "duck_speedrun" },
  { name: "award_quest_completionist", who: "quest_completionist" },
  "award_staff_trusted",
  "award_staff_points",
  "award_staff_mole",
  "resurrection",
];

/** A press the timer may already have made: refused then, harmlessly. */
export const SELF_PRESSED: ReadonlySet<string> = new Set(["close_the_filing"]);

/** Press a chain through `/api/mod/signal`. A refusal is printed; one that is
 *  not a timer's own step stops the walk (the night is somewhere else — a
 *  rerun, or a rehearsal that wasn't restarted), and the caller says so.
 *  A step with a `who` is passed to `signal` as its second argument. */
export async function pressChain(
  chain: readonly ChainStep[],
  signal: (name: string, who?: string) => Promise<Record<string, unknown>>,
  log: (line: string) => void = console.log,
): Promise<{ ok: boolean; refused: string[] }> {
  const refused: string[] = [];
  for (const step of chain) {
    const name = stepName(step);
    const who = stepWho(step);
    const r = await (who === undefined ? signal(name) : signal(name, who));
    if (r["refused"] === true) {
      refused.push(name);
      log(`  refused ${name} — # hosts says why`);
      if (!SELF_PRESSED.has(name)) return { ok: false, refused };
    } else log(`  fired ${name}`);
  }
  return { ok: true, refused };
}
