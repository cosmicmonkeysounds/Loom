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

/** A press the timer may already have made: refused then, harmlessly. */
export const SELF_PRESSED: ReadonlySet<string> = new Set(["close_the_filing"]);

/** Press a chain through `/api/mod/signal`. A refusal is printed; one that is
 *  not a timer's own step stops the walk (the night is somewhere else — a
 *  rerun, or a rehearsal that wasn't restarted), and the caller says so. */
export async function pressChain(
  chain: readonly string[],
  signal: (name: string) => Promise<Record<string, unknown>>,
  log: (line: string) => void = console.log,
): Promise<{ ok: boolean; refused: string[] }> {
  const refused: string[] = [];
  for (const name of chain) {
    const r = await signal(name);
    if (r["refused"] === true) {
      refused.push(name);
      log(`  refused ${name} — # hosts says why`);
      if (!SELF_PRESSED.has(name)) return { ok: false, refused };
    } else log(`  fired ${name}`);
  }
  return { ok: true, refused };
}
