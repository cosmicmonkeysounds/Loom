//! Which TV scenes follow his voice, by scene id (wave 26, V1; contract
//! C11). The scene defs (`scenes/act*.tsx`) carry no `voice:` key: the
//! cutscene layer reads this map by id, so the act files stay the
//! terminal's. `marks[i]` is the scene-time ms at which his i-th spoken
//! sentence begins: the scene's lines in its beats, in order, each cut by
//! `splitSentences` (`test/voice-scenes.test.ts` reads `beats/*.loom` and
//! pins `marks.length` per entry, so a story edit that changes a count fails
//! there, never silently on the night).
//!
//! Not here, on purpose:
//! - `truth_answered`, `truth_refused`, `filing_closed`, `zip`: their beats
//!   carry no line of his (broadcasts, Clippy, the narrator), so nothing to
//!   wait for;
//! - `hunt_results`: the reading's timeline is built from the row count
//!   (`readingPlan`) and the branch his lines take, which a fixed list of
//!   marks can't describe; it keeps the server clock;
//! - `chose_dare`: retired by D1 for `dare_chosen`.
//!
//! Every mark sits at or after ≈ 1.2 s where it can: his first sentence
//! starts about a poll after the moment, so an earlier mark would make the
//! picture jump ahead the moment he speaks.
//!
//! His line shows once: the layer captions the sentence he is saying unless
//! the scene draws it itself (`ownCaption`: the intro, the bottle's
//! "<pick>." / "Truth or dare?") or that sentence is one of its `drawn`
//! (advice_helped's proposal, typed in SandyChat).

import { BOTTLE_SPIN_MS } from "./kit/tv1-time.ts";
import { INTRO_CAPTIONS, INTRO_MS, INTRO_VOICE_END } from "./kit/tv1-boot.tsx";
import { VERDICT_PLAN } from "./kit/results.ts";
import { AWARD_CONFETTI } from "./kit/tv3-time.ts";
import type { VoiceScene } from "./voice-clock.ts";

/** The scenes that wait for his voice, by `SceneDef.id`. */
export const VOICE_SCENES: Readonly<Record<string, VoiceScene>> = {
  // HELLO, PROGRAMS. then a sentence at a time; the setup after the voice.
  trabolta_introduction: {
    beats: ["Trabolta Introduction"],
    marks: INTRO_CAPTIONS.map((c) => c.start),
    tail: INTRO_MS - INTRO_VOICE_END,
    ownCaption: true,
  },
  // "<pick>." as the bottle lands on the seat; "Truth or dare?" typed after.
  bottle_landed: { beats: ["Bottle Landed"], marks: [BOTTLE_SPIN_MS, BOTTLE_SPIN_MS + 600], tail: 14_000 - (BOTTLE_SPIN_MS + 1800), ownCaption: true },
  // D1, the story lane's `== Dare Chosen` (2–3 lines): a placeholder until
  // the story and terminal lanes merge; the voice lane recomputes the marks
  // from the merged beat before it merges (C11).
  dare_chosen: { beats: ["Dare Chosen"], marks: [1500, 4000, 6500] },
  // "I have compared…" while the tiles flip; the counts as the totals land.
  verdict: { beats: ["The Verdict"], marks: [1200, VERDICT_PLAN.tiles + 7 * VERDICT_PLAN.tileEvery + 100, VERDICT_PLAN.totals - 500, VERDICT_PLAN.totals] },
  // "…The house says YES." while the card is up; "That is the line." on the stamp.
  pickup_line: { beats: ["Pickup Line"], marks: [1500, 4200], tail: 8000 - 5400 },
  // His first two lines before SandyChat opens (the window stays shut, his
  // words captioned); the chat opens on "Sandy." and types the proposal as
  // he says it (sentences 5–7, drawn by the chat, never captioned twice);
  // her answer in Sandy's pause; THAT WAS A YES on "That was a yes."; the
  // ride off on "Thank you, programs."
  advice_helped: { beats: ["Advice Helped"], marks: [20, 60, 100, 140, 180, 200, 1400, 2000, 4600, 5200, 6200, 9200, 10_400], tail: 14_000 - 12_600, drawn: [5, 6, 7] },
  // The award's kind as the card flips; the winner's name on the reveal.
  // (Marks for the first award's line; the others map by share.)
  award: { beats: ["Present Award"], marks: [800, AWARD_CONFETTI.first, AWARD_CONFETTI.first + 1200, AWARD_CONFETTI.first + 3200] },
  // The cold door opens on "Someone has found my heart."; the bay beats under
  // the rest. (Voiced only on a TV that speaks The Server Room's lines.)
  the_heart: { beats: ["The Heart"], marks: [1500, 4000, 5000, 5800, 6600, 9000, 10_500, 12_000, 13_500, 15_000, 16_000], tail: 2000 },
};

/** A scene's voice timing, or null when it keeps the server clock. */
export function voiceSceneOf(id: string): VoiceScene | null {
  return Object.prototype.hasOwnProperty.call(VOICE_SCENES, id) ? VOICE_SCENES[id]! : null;
}
