# Wave 58 contract: the Oct 30 story

2026-10-31. The ask: Task Manager is cued with the teleprompter to read the
monologue on the bad endings. Trabolta delivers it, with no glitches, on the good
ones. Update the story from the latest script. Any fact with a codex entry is
scannable by everyone, Clippy, the Antivirus and the hosts included. Document every
discrepancy.

Branch `oct31-w58/story`. Not shipped. It needs a release (the server, the terminal
and phone bundles), `sync-show` with its reload, the MacBook's worker restarted, and
every screen and booth reloaded, in that order: `SHOWNIGHT.md` §1, *Landing wave
58*. The discrepancy log, every edit to the delivered text, every word we wrote and
what is owed are on [`SIGNOFF-w58.md`](../core/examples/trapped-in-the-internet/SIGNOFF-w58.md).

The three delivered files in `Trapped In The Internet story/oct30/` are not edited.
Two tests read them: `core/test/trapped-w58-script.test.ts` holds the opening to the
script and `core/test/trapped-monologue.test.ts` holds both monologues to the ending.
Each carries a `FIXES` list, and nothing else may differ.

## The shape of it

| Part | Where | Reaches the show by |
|---|---|---|
| The facts, the hunts, the canon | `facts.json`, `codex/`, `titi:facts` | `sync-show` |
| The opening | `beats/desktop.loom`, `beats/hunt.loom`, `main.loom` | `sync-show`, with the terminal's scene from the ship |
| The monologue | `beats/truth.loom`, `main.loom` | `sync-show`, with three small reads from the ship |
| Trabolta | `trabolta.persona.md`, `trabolta.mind.md`, `stagehand/agents/` | the MacBook's restart, never a sync |
| Booth scanning | `/api/prime/codex/redeem`, `play/src/booth/` | the ship, then a reload of every booth |
| The prize | `main.loom`, `beats/ceremony.loom`, `core/server/recap.ts`, the award slide | `sync-show` and the ship |

## C1. A hunt key still owed

The script's three questions replace H1–H3, and their answers come later. A question
may therefore ship before its answer.

- `facts.ts` `Question.placeholder`. A stand-in `answer` carries `PLACEHOLDER_MARK`
  and the question says `placeholder: true`. `showFactsProblems` refuses either
  without the other, so a stand-in can't pass for a real key, or a real key be
  skipped by a stray flag.
- `judgeWidget` passes a filing on an owed key with **no verdict**, so the story's
  own "could not be judged" path answers. Nothing is recorded, credited or marked;
  the card is dealt again; `# hosts` gets one line per try; at the First Moment of
  Truth the question reads *Nobody filed an answer*. It stays unset, so the verdict
  is unaffected and the song stays reachable. Hosts can still judge what is said
  in the room.
- `screenResultsOf` and the generated tables never show a stand-in: they print
  *owed*. `titi:facts`, `loomcheck` and predeploy WARN by id, and exit clean.
- `Question.spoken` is what the reader says instead of `text`, for a blank the voice
  would strip. The card, the Quest Log and the slide keep `text`.
- `titi:facts` writes `Night.owed_<id>` from the flag. **The owed flags live in the
  generated story**, so an answer put in `facts.json` alone is judged while G9a
  still skips it: `titi:facts`, then `sync-show`.

To finish a key: `answer`, `accept`, `where`, `codex.text`, delete `placeholder`, run
`titi:facts`. It refuses an answer containing one of its question's `topics`.

Tests: `core/test/w58-owed-keys.test.ts`, `core/test/fixtures/hunt-keys.ts` (the suites
that need H1–H3 judged run on made-up keys, so none waits for the real ones).

## C2. The full truth

The monologue is 1,794 words and comes **after** each ending's last beat, on the
director's `tell_the_truth` (G0 📜). Nothing about any ending was restructured.

| Ending | Who | Frame |
|---|---|---|
| `song`, `song_pickup`, `help`, `hand_jive` | Trabolta, the TV | Reading his own file aloud |
| `rave` | Trabolta, the TV | He phones in from the prom |
| `disabled` (Combo A) | Task Manager, the teleprompter | A message he left before he died |
| `destroyed` (Combo B) | Task Manager, the teleprompter | The last thing the computer saved |

- **Trabolta's version** is `The Full Truth`: 18 merged lines, because the TV keeps a
  poll's newest 40 (`MAX_VOICE_LINES`) and the text would run off the end. Phase
  `finale_truth` reads level 0, and `heart_stage` and the alarm's floor are cleared.
  The ending's phase comes back at G1. A director's Broken or a shot can still break
  him: the press's `# hosts` line says so.
- **Task Manager's version** is `The Full Truth Read`: `Task Manager:` lines under
  `aloud:`, in the room `The Script`, `hidden: true` and `checkin: false`. Narration
  under a part's `aloud:` reaches nobody, and a hidden room with a check-in prints a
  sign. A guest's stream carries the lines but no room lists them, and the aloud
  mark is stripped.
- **The seven featured parts** are read only if that program came tonight.
- **G1** waits. `Night.truth_until` gates its `while:`; a press before that asks first,
  and a second inside 30 s goes on. A beat is instantaneous and nothing waits for
  speech, so this is the only gate, and its 830 s on either version is an estimate.
- **`task_manager_reads`** hands any ending to Task Manager, for a TV with no voice.
  Nothing warns if nobody holds the part; his pack carries a printed copy, held to the
  story by the test.
- **`ALOUD_WINDOW_MS`** is 20 minutes, so a phone swapped mid-read still gets it.
- **`READING_BEATS`** keeps his lines out of the worker's `recent`. The `recount` and
  `purgatory` slides persist.
- **`Night.truth_told`** gates the review's overlap and lifts his cover (C3).

**After Combo A he does not return.** No Recounts, no ride, no "I can never die".
`Trabolta.awake` goes false, so his worker holds and his DMs stop; `everyone_free`
moves into the cue, and into G1 if the cue is skipped; the chart's last count runs
silently; Clippy hosts. The TV's recount scene holds through the read.

**A sound can't be stopped by the story.** The rave track plays on the sfx bus and is
`no_duck`, so his voice would come over the top of it undimmed. The crew's step is ■
Stop house sounds before 📜; `/api/mod/audio/stop` fades it in 0.3 s. The Mixer's ■ Stop
music stops only the music bus.

**The talk-down is removed.** `talked_down`, the 🕊 cue, the autoend, `stand_down_by`,
Heart Convinced, Return, Shutdown and Layer Four, and voice-fx's reading of it. The
heart talk stays; its last rung offers an end, *Heart Heard*, which ends nothing.

**truth.txt** keeps its cue and its deadlines (`read_truth_txt` still sets `r3_closed`).
Its text is a short teaser, in the beat, `TRUTH_TXT`, the printout and the codex entry.

Tests: `core/test/trapped-monologue.test.ts` (every road), `scripts/sim/evening.ts` takes
all seven endings.

## C3. Trabolta

**The cover.** Publicly a man. Persona key `cover: {until: Night.truth_told == true}`;
his heart also lifts it. Asked whether he is human he answers neither way and changes
the subject. A flat claim to be human is caught at any hour.

**The accident** is never explained, and he gets upset. No mechanic: a persona rule, and
the guards catch an invented detail or a denial that there was one.

Both work as **sore points** beside bait mode, not inside it: `guards.sore_point`, a steer
(`sore_steer`), the reasons `cover` and `accident`, and a filler pool each per stage.
`BAIT_CLASSES` and `not_plain` are untouched. Neither can be bought at the Y2K hour.

**The monologue's plot** sits only in the mind's director text, which `mind_mode: new`
never shows, and in the persona block `your file has been read`, gated on
`Night.truth_told` and not `finale_truth`.

`outside:` gains Anthropic and Claude. `unavailable:` fits both ends of the night. An
older worker refuses a persona with `cover:`, so the MacBook pulls and restarts
together. **No real model has played this persona:** the measured "no refusal in about
600 calls" was the proud-AI one. The battery (60 scenarios, six of them `w58-*`) is
owed on Claude, and a refused line costs about 99 s on the standby.

Tests: `stagehand/tests/test_w58_cover.py`, `core/test/trapped-w58-*.test.ts`.

## C4. Booth scanning

Every guest, featured program and all 8 booth parts scan every coded entry, secret ones
included. `secret` never limits a scan: it only hides an entry from Trabolta. The
Installation Wizard is not a booth, a director has no identity to hold entries, and The
Door Code has no QR.

`POST /api/prime/codex/redeem {code}`: a booth's token, a host's too. It answers
`/api/guest/codex/redeem`'s shape.

- **A hit** is the journaled `unlock`, `via: "story"`, so the card reads *Learned tonight*.
  No Sim change, which keeps a rollback safe.
- **A miss** is no story event: no `wrong code`, no doubt, no ⭐, no award credit. It only
  counts on the limiter (`redeemMisses`, keyed by the part).
- **409** with the doors closed or paused. **403** without a character. `agentRefusal` for an
  operator playing an agent-voiced part.
- A part is never locked: `isLocked` reads Persons only.
- `program learns` hooks run only for Persons, so a part assembles no Door Code and
  ILOVEYOU infects no part. `agentVarsOf` and the holdings filters keep a part's secret
  entries out of every request.
- `/api/prime/codex/share` stays unfiltered, by the user's choice.

The client: `PrimeSession.redeem`, the scanner's wall branch (the camera stays on, and a
held QR counts once), the typed box (`/api/scan` first, then a code on *unknown guest*),
`booth/unlock-link.ts` for the phone camera's `?unlock=`. Terminals still read only passes.

Tests: `core/test/w58-booth-scan.test.ts` (all 8 parts over every coded entry, every code
read from the compiled model), `play/test/w58-booth-scan.test.tsx`.

## C5. The special prize

G9a 🏅 `award_most_correct`, after G9, moves no G label but every cue's `#` from G10 on. No
subject: the story counts.

Counted once per question: a filing standing accurate, or still pending on an accurate
proposal, or a spoken answer a host ✅ accepted and no 😤 took back. Never
`truths_accepted`, which counts confident lies. A guess, a lie, a filing settled `marked`
(no cup) and Clippy's 🤫 slide score nothing. An owed key scores nothing.

`questions_right` is written per program only when G9a is pressed, and sits on the role's
`secret:` list: a live count beside `truths_accepted` would tell the worker who lied.
`recap.ts` `questionsRight` reads the same rule live, and the test holds the two together.
A tie names everyone in it; nobody right is said aloud.

Tests: `core/test/trapped-w58-prize.test.ts`.

## C6. The opening

The script, word for word, each button its own teleprompter section: Bingo Time, Winning
Line 🎱, Bingo Prize 🎀, Shy Winner 🤐, No Bingos 🃏, Corrupted Code, Following The
Reinstallation 📺 (host cue, off the sequence), Clippy On Trabolta 🎤 (host cue, before 🤖).

- 🤖 lands Trabolta Introduction, Trabolta Greeting, Hunt One Questions and Hunt One Go as
  one chain. The `intro` talk scene stays open behind it until 🔎 and has no ⚡.
  Truth Scavenger Hunt One keeps its name and has no lines.
- First Moment Of Truth splits around the two-minute window: SCRIPT:155-159 at ⚖️,
  SCRIPT:161-163 at ⏱.
- Stage directions are never on a Narrator line, which reaches every phone: they are in
  Clippy's Instructions and her pack, and a test says so.
- The TV's intro scene runs the first five sentences (about 34 s); the rest of the speech
  runs under the plain face on no scene's clock. `captionWith` throws at import if a word
  goes, so change the anchors with the beat.
- 📺 lets a linked walker through attract, full screen and with no face, only while he is
  hidden (`tv.ts` `mirrorBeforeHim`).
- A guest's own 🎱 BINGO! brings Winning Line up at once, because her first 🎱 kills ↩.

Tests: `core/test/trapped-w58-script.test.ts`, `terminal/test/tv1-boot.test.ts`.

## C7. What a rollback costs

The story can go back until the staff upload at 17:00; after that it costs every staff
upload, and after the doors it is impossible. The server's additions are additive, and
`unlock` lines replay on an older server as they always have (reasoned, not run).
