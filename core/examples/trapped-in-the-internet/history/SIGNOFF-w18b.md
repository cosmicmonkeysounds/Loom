# SIGNOFF — wave 18b (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 18b is the rehearsal
fixes of 2026-10-21 (`W18-ASKS.md`): the house router plays the story's
sounds and announcements through the **MOTU 828x + ADAT expander** (QLab and
the `alexa` player retire), the **tent laptop** is a terminal *and* the
reinstallation wizard, **Trabolta reads and judges the results** on the TV
(every non-exact filing goes to his AI judge; at ⚖ the TV shows the true
answers and who lied), **any program may found a faction** and win the
majority's prize, a scan says it worked, the fact card points at what is
missing, a CRA-flagged transfer says so on both phones, 🚻 beside a name in
Bathroom Mode, the story-named chat room is gone from guests' phones,
**Jean Trabolta, Sole Owner and Founder of Maps and Ducks** (his title, his
green grin and its broken-image twin), Truth or Dare after the third result,
Facts Are Currency counting what she finds, the typed left-behind, the ties
(*Connections*), Broken Ask Jeeves's line, and the ending monologue.

**Where it is built.** Stage A (`oct31-w18/{engine,server,termbase}`, merged
on `oct31-w18/integ-a`) is on master and **shipped as `w18b-1021`** with the
`tent` lane. Stage B (`oct31-w18/{show,ending,factions,play,editor,screens,
audio}`) and the integration round (`oct31-w18/integ`, the §4.6 hooks, the
verdict hold, the narrow announce route, the cross-lane tests, a live round)
are on `oct31-w18/integ`, **not shipped**.

Every row is a decision taken for you with its drafted default (§1), an open
question (§1b), a line of show text that changed (§2, `// DRAFT w18b` in the
source, file:line on `oct31-w18/integ`, old → new) or a DRAFT item (§3). Mark
each ✅ keep / ✏ reword / ❌ drop. Nothing marked DRAFT here plays on the
night until it is signed off (`sync-show` carries the wave 18b text only
after).

**Deploy note.** The story text changes what an old journal replays to (the
bottle's order, the removed cues, the quiet reveals, the faction notices, the
wallet cards, the chat seqs), so an old journal must not play the new text.

1. Check the preview's roster for live guests, in its own step, before
   anything.
2. **The server first:** `scripts/ops/predeploy.sh` → `scripts/ops/ship.sh
   <tag>` (rollback = the current tag). Stage B's server pieces are additive
   (the narrow `POST /api/mod/audio/announce`, a hidden lobby refusing a
   guest's `say`, `GuestView.leads`).
3. **`sync-show --replace-maps --replace-audio` with its reload, before
   doors.** `--replace-audio` swaps the project's `audio.json` for the repo's
   (the 828x device block, `expect`, `announce.terminals`): if a speaker
   survey was saved to the project since wave 17, merge it into the repo copy
   first. A tablet ticked on the House sound card lives in the event's
   `audio-announce.json` until *Save to project*. Restart every other
   non-ended event.
4. **The house Mac** (`scripts/house-mac/audio.md`): `git pull`; retire the
   alexa job (`scripts/house-mac/install-alexa.sh --uninstall`);
   `uv run stagehand sounds placeholders`; `uv run stagehand check --only
   audio` (32 / 30, the layout not moved, the placeholders listed);
   `uv run stagehand launchd install --job audio`; `launchd restart --job
   show` (the cue map changed) and `--job agents` (the persona, the mind file
   and the judge prompt changed); then Run → Mind → Reset.
5. **Devices:** reload every terminal and the TV; provision the tent laptop
   at `/terminal/?code=<mod>&spot=tent&announce=1` (never add `&view=reinstall`:
   a link naming its view keeps the name *Terminal* and stops following the
   map) in Chrome
   `--kiosk --autoplay-policy=no-user-gesture-required`; re-export and
   sideload the Quest APK.
6. **Reprint after the sign-off** (the list at the end).

## 1. Decisions taken for you (D1–D30)

Where a decision follows your answer of 2026-10-21 it is marked **your
answer**; only the details around it are vetoable.

### Audio and the house router

| # | Decision | Drafted default |
|---|---|---|
| D1 | **No channel map.** `audio.json` declares 24 in / 22 out so our channel numbers are the 828x's own (the expander on Optical A = outputs 15–22, inputs 17–24); install day reads one number per channel. `device.expect {inputs: 32, outputs: 30}` makes `stagehand check` fail, and the router log an error (but still play), when mirroring, 96 kHz or TOSLink has moved the layout. You said "16 in + 16 out"; the hardware has more, and the extras are simply unlabelled (Phones 11–12, S/PDIF 13–14). | As built. |
| D2 | **`passthrough: false`.** Live mics are mixed in CueMix FX (hardware, no latency, no microphone permission for a launchd job). | As built. |
| D3 | **Announcements reach the router over MQTT `show/announce`** from the show module (alexa's path, tested in wave 17). The alexa module's code stays; only its YAML section and launchd job go (`install-alexa.sh` now refuses a YAML with no `alexa:` section). | As built. |
| D4 | **Placeholder sounds are untracked** (`stagehand/media/sounds/` gitignored: the real tracks include copyrighted songs); the tracked manifest is `stagehand/media/sounds.yaml` (19 names). A real file always wins over a tagged placeholder; `stagehand check` lists the placeholders still present (the pre-show gate). | As built. |
| D5 | **Stop = every sfx voice and speaker test, a 0.3 s fade, one-shot, not journaled.** *+ announcements* also cuts the current announcement and empties the queue (a line sent after the stop plays at once). The TV voice (its own mute), terminals and live mics are untouched; stopping `dance_song` does not move `Night.dance_at`. Run's header button, the House sound card, the host dock (More → House → 🔊 House sound) and the director phone's ☰ all send it; so does MQTT `show/audio/stop`. | As built. |
| D6 | **The tablets' announcement option is `audio.json` `announce.terminals`** (map spot ids), not `house.json`, so a tick never bumps the map version. A tablet's own setting is three-way: **House setting** (the new default) · Always · Never; an old stored `false` reads as House setting; `&announce=1\|0` still sets it. No room turns on by itself (`terminals: []`). **Integration added:** a tick goes through the narrow `POST /api/mod/audio/announce {spot, on, base}`, kept in the event's `audio-announce.json` over the config in force (so a newer project `audio.json` still plays) until *Save to project*; an older server falls back to the whole save. The per-spot list lives on Run's **House sound card** (one box per map spot, so a spot can be set before its tablet arrives), not on the Terminals rows, which show the resulting 📢. Run's *Set up a terminal* writes `announce=1` only when *Always* is ticked, never `announce=0` (that would pin the tablet to Never). | As built. |

### The tent laptop and the reinstall gate

| # | Decision | Drafted default |
|---|---|---|
| D7 | **The tent = `view=reinstall` in the terminal**: reinstall's own flow mounted from source (a `@loom/reinstall` alias) in a shadow root (`<style>`, not `adoptedStyleSheets`). Rejected: an iframe (blocked by `frame-ancestors 'none'`) and a package move. Named `reinstall`, not `tent`, because the shed shares the spot. The map's `tent` spot carries `"view": "reinstall"` on both variants. | As built. |
| D8 | **At the tent an unmarked scan shows only a NOT MARKED card** (no Trabolta line, no story effect, `/api/mod/scan` never fired). The choose card (Play here / Send to a headset) only when a VR station is online; the idle quick picks list only the corrupted, never the Wanted; a `tablet_*` cue shows a generic *Setup is preparing to reinstall a program.* card naming nobody. **Your answer (O6):** an unmarked scan never opens the Trabolta line. | Your answer; the rest as built. |
| D9 | **`force: true` stays honoured from any mod token** (equivalent to holding the token; only `scripts/accept/K-30.sh` sends it). **Server lane:** a session begun with `force` is exempt from the marked-only gate (`BeginInput.forced`), or K-30's unmarked walk would end within a second. Every device begins without `force`. | As built. |

### Results and judging

| # | Decision | Drafted default |
|---|---|---|
| D10 | **Trabolta judges every non-exact filing** (**your answer, O4**). An exact match (the fold, an alias, `spellOut`) is accepted at once by code; every other filing goes to his AI judge in `auto` mode (the wave 11b `judge` frame: question, key, answer; never his voice, mind, orchestrator or `/api/agent/facts`), held pending with a proposal (near miss → accurate, plain miss → lie at 100, uncertain below). When nobody can rule (no worker, a stall, an expired or unfinished ruling, still queued at the settle) the proposal stands; a director overrides. `review` mode is unchanged. **Vetoable details:** the queue is FIFO, one frame out per worker, voice replies first, **no size cap** (a round is ≈ 45 × 3 filings at ≈ 3 s each: 5–7 minutes); two expiries in a row = *⚖ Trabolta isn't ruling: filings fall back to the house rule.*; the screens stamp each row 🤖 SAME / 🤖 NOT THE SAME / 🤖 … (asking) / none, but a ruling at 100 reads only **🤖 RULED** before ⚖ (its result is the D11 secret); his `why` never reaches a screen. | Your answer; the details as built. |
| D11 | **Before ⚖ the screens show only what is public**: who filed, what they said, sure or not, accepted / guess / not counted, and D10's stamps. **At ⚖ (your answer, O2)** the TV shows per question true / lie on record / nobody answered, **the key answer** and **the names of the programs who lied** (a final lie, or a pending filing proposed lie; 🤖 beside a name his ruling made a liar; names only, ≤ 40 + *+N more*, at most 24 drawn per page). **Vetoable details:** the walls get the truths and counts only, no answers or names; a reading never publishes the final round's questions (F1 / F2); round-3 liars are named at ⚖ like everyone else's; F1's answer on the TV at ⚖ is a clue to the P1 pickup line still being played. | Your answer; the details as built. |
| D12 | **Guests' filed answers are read aloud and shown on the TV** (the ask: "read everyone's fact submissions"); capped at 200 characters, not moderated. Directors should know before the doors. | As built. |
| D-new | **The verdict holds the ending for 34 s of story time** (integration, screens finding 3): The Verdict sets `Kernel.verdict_wait` and `Kernel.verdict_end = Time.elapsed + 34`; a story rule plays the song or Grok Prom once the TV's 33.5 s of pages are done (never if the night ended meanwhile). It pauses with the clock. A second ⚖ during the hold only tells `# hosts` (*⚖ The verdict is on the TV now; the ending follows when its pages are done. Nothing happens.*). | As built. |

### Factions

| # | Decision | Drafted default |
|---|---|---|
| D13 a | **Excel and OpenOffice are founders like everyone else**: the leader-task gate is gone and 🧾 `waive_leader_tasks` is deleted. The tasks still drive the overshare scenarios, quests and recap. | As built. |
| D13 b | **Founding opens at the Truther Download** (**your answer, O7**) and stays open until a faction wins the majority, midnight (`y2k_midnight` sets `Night.clock` to `00:00`) or any ending (`founding:` in `main.loom`). This replaces wave 18's crews-as-friend-clubs in this show (a story with no `founding:` keeps them). The majority is **counted only in the Y2K hour**; a faction already over the line at 🕚 wins on the clock's first pass; the copy says "the count starts at 11:00 PM". **Vetoable:** Unlimited Power and The Way Out stay hidden until 🕚 (moving their reveal to the Truther Download is not built), so before 🕚 the Factions list holds only founded factions. | Your answer; the sides at 🕚 as built. |
| D13 c | Each member sees **their own faction's count and *N more to win*, never another's**; a person card shows a faction badge only for your own faction or a leader / founder. A side's hidden leader is told the side they lead (`GuestView.leads`). | As built. |
| D13 d | A walk-in **Join** on the Factions list, plus pass invitations. **Server lane:** a walk-in is refused outside faction mode (wave 18 crews stay invitation-only), 6 attempts a minute, then *slow down — wait a minute*. | As built. |
| D13 e | **A founder leaving disbands the faction**, behind a confirm (*Disband X? Its members go back to neither.*). Excel and OpenOffice (side leaders) can't leave. | As built. |
| D13 f | Marked programs may found and join and count as present; restricted or captured ones may not. | As built. |
| D13 g | A late pledger after the latch still gets The Whole Truth, once (the `whole_truth` slot). | As built. |
| D13 h | The UI says **Factions**; internal ids stay `crew`. | As built. |
| D13 i | The threshold is a direct present count (`majority:` = cleared persons not gone, not personas, / 2 + 1), not `Night.present`, which lags one watcher pass. | As built. |
| D13 j | **Trabolta never learns a faction's size.** In faction mode every race side's world paths and every crew are masked from agent requests and `/api/agent/facts`. **Server lane:** the facts document also masks race membership on its program and character rows (it lists every program, so a side per row would let him count); a request keeps its speaker's own `group`. | As built. |
| D13 k | Exclusivity is only between race factions (founded + the declared joinable sides); `Hosts`, `Antivirus` and any `joinable: false` group never take anyone out of a crew. | As built. |

### Story text

| # | Decision | Drafted default |
|---|---|---|
| D14 | **Only the post-results sentence and Clippy's echoes go** (R20). The pre-filing rule (`hunt.loom`, *"Wrong but one hundred percent sure: accepted"*) and the guest objective's rule stay (**your answer, O3**). | Your answer. |
| D15 | **Truth or Dare:** five spins are NEXT's budget, not a hard cap (a sixth only tells `# hosts`); 📺 is refused while a truth is pending; `bottle_q` ends at 3, so the bottle picks a program "not picked tonight". | As built. |
| D16 | **The quiet window goes with Back To The Heart** (`Night.door_quiet_until` deleted): every later door opening does nothing; 🔄 `reset_server_room` re-arms The Heart. | As built. |
| D17 | **Clearance reveals the rooms with `reveal … quietly`** (a small engine addition): the rooms still open at clearance, with no "📂 … are open now." notice and no screen moment. | As built. |
| D18 | **The lobby is hidden from guests only** (`lobby: hidden`): no Chat log row; booths and Run keep it (the performers' feed). Every lobby line a guest gets still reaches them as a moment or a quiet Notifications row; a push / exit / `?room=lobby` link opens Notifications. **Integration:** a guest's `say` into the hidden lobby answers 404 *no such room*. Typed chat in the lobby never becomes a Notifications row (so a director's Run `say` as a character into the lobby isn't one either: announce with `broadcast`). | As built. |
| D19 | **Screens may name "Jean Trabolta" in the third person before the introduction**, as the owner who joins by video conference later, from the Bingo on (`owner: true` items: two early ads and the bingo slide's line, which drops once he is introduced). His face, voice, nameplate, first-person copy, ONLINE copy and thread stay gated. | As built. |
| D20 | **In-world documents keep their wording**: the torn-manual fact (*"THE AI HELPER HAS NO INTENTION…"*) and Jeeves' `/helper/` fragment. Only Trabolta's own messages and descriptions of him change. The DM hello adds *"proud to be the world's first AI small business owner"*. | As built. |
| D21 | **Facts Are Currency counts by category** (`codex_in.<category>`): the base is OpenOffice's Facts + Files + People + Trabolta + Places at the end of her Featured Briefing; handouts and the `Connections` ties never count; 20 at the glitch completes at once. | As built. |
| D22 | **The typed left-behind is optional and non-blocking** (the *Deposited* / *nothing* choice stays). The text goes in the secret ROLE slot `left_behind_text` (≤ 80 characters), never reaches Trabolta's worker or a screen; only that guest's private `Your File` quotes it. A deposited program gets its pass card once it types (the stage's *My pass* button has it meanwhile). | As built. |
| D23 | **Trabolta's picture breaks while more than half of the cleared, present programs sit below 0 on his Trust Chart** (`program.trust`, his score of them; **your answer, O5**), and mends when that stops. `Trabolta.broken` is a bool his worker's `adjust` can't flip; the TV / terminal face is unchanged. | Your answer. |
| D24 | **Badges on people lists, presence, the booth, the host dock and the editor; never on chat bubbles.** The 🚻 `watch:` item stays for the booth flags. | As built. |
| D25 | **CRA:** `as MyCRA` renames the approver on wallet cards only (the booth and the character keep "CRA Agent Software"); a held transfer gets its own flagged card for the recipient (*🚩 Flagged for a CRA audit — MyCRA must approve it.*). | As built. |
| D26 | **The scan dialog overlays the destination** (it navigates first). A 📍 reply also stays in Notifications; the duplicate balloon is dropped. | As built. |

### The ending, ties and Jeeves

| # | Decision | Drafted default |
|---|---|---|
| D27 | **The ending monologue.** A public `The Night In Review` (`beats/review.loom`) plays before every ceremony, spoken by the ceremony host (Trabolta, or Clippy after destroyed / rave), and ends in `-> The Ceremony`. **As amended by the ending lane:** after `destroyed` it skips the identities *and* the outcomes (Purgatory just read both); after `disabled` it skips the identities *and* the deeds, keeping the goals (Recounts read the identities and deeds). Pool programs are named aloud only as problem groups (`names()`). Every program gets a private `Your File` from The Uploader. **Integration:** the ceremony's slide is cued at the head of `== The Ceremony` (it used to be cued by 🏆 itself), but review and awards play in one drain, so the slide still shows at 🏆 (open item below). **Also changed:** Recounts and the review skip a featured program who went home or is a Run persona; the virus planter is now named aloud (and captioned on the TV) after every Trabolta-hosted ending (song, song_pickup, help, hand_jive), not only after `disabled`. | As built. To follow D27 to the letter: drop `Night.ending != "destroyed"` from the identity `if` and the `!= "disabled"` guard around the deeds. |
| D28 | **Ties are dealt privately at clearance** (`Program Briefing`, by `program.featured` / `program.human_problem`; no code, not printed). They point at people and never name the human behind a program. They live in `codex/85-ties.loom` (not §4.5's `3-ties.loom`: it must sort after `8-jeeves`); two CODEX ids differ from their titles (`Juniors Contacts`, `Quinpool Road`). Every featured program holds 3, a pool program The Old Machines + its problem's tie, the hosts theirs through `known to:`. | As built. |
| D29 | **Jeeves gets paper + one secret codex entry** (`The DSL Line`, dealt to him alone, refused by Trabolta, not in the recount's bulk unlock). No live per-phase glitch prompts; the VLC / Pong red-fact parity is deferred. | As built. |
| D30 | **Hooks across lanes land at integration** (§4.6 verbatim in `main.loom`; `== Back To The Heart` deleted after its rule). | Done. |

## 1b. Open questions

| # | Question | Status / drafted default |
|---|---|---|
| O1 | **"Write every name down clearly – it is very important to get a Bingo!"** is not in the repo or its history. It is probably only on the printed Bingo card. | **Open.** Strike it from the print (the reprint list). The first sentence (*"Do not write names: use your computer memory."*) is gone everywhere in the story, slides, marquees, ads and popups. |
| O2 | The verdict at truth.txt. | **Answered:** at ⚖ the TV shows the true answers and names the programs who lied; public only from the verdict on, TV only, never an agent path (D11). |
| O3 | The pre-filing "confident is accepted" copy. | **Answered:** kept (D14). |
| O4 | Trabolta's AI judging. | **Answered:** every non-exact filing goes to his judge; exact matches at once; wave 11's fallback; directors override; his ruling on the screens (D10). Vetoable: the held 🤖 RULED at 100 before ⚖, the uncapped queue. |
| O5 | What "trust" breaks his picture. | **Answered:** his Trust Chart score of them (D23). |
| O6 | An unmarked tent scan. | **Answered:** only the NOT MARKED card (D8). |
| O7 | When founding opens. | **Answered:** at the Truther Download, until a majority, midnight or an ending; counted only from 🕚 (D13 b). Vetoable: the walls without names (D11); the sides still revealed only at 🕚. |
| O8 | **The ceremony slide** shows the moment 🏆 is pressed, while the review (≈ 40 lines when Trabolta hosts) is read. | Open: a timed hold like the verdict's, or a separate press. Today: as built. |
| O9 | **`trabolta_heard` counts ties**: sharing a tie with Trabolta is a delivery (up to 16, +2 truth each). The `share` trigger has no entry argument to skip `Connections`. | Accept as a risk (drafted), or add an engine argument. (Lore Hoarder already counts `codex - codex_in.connections`.) |
| O10 | **The 34 s verdict hold** is story time (it pauses with the clock); a ⚖ during it is refused in `# hosts` (D-new). | As built. |
| O11 | **"EVERY ANSWERED FACT IS TRUE" with nothing answered**: the verdict's stamp reads *0 TRUE · 0 LIES · 8 UNANSWERED* / EVERY ANSWERED FACT IS TRUE. | Reword? Drafted: as built. |
| O12 | **Round Two Tally says "Only a cup counts."** while it reads every round-two filing (`said_4–6` hold every filing, not only cupped ones). | Reword? Drafted: as built. |
| O13 | **The review's length**: ≈ 40 lines on the TV when Trabolta hosts a non-disabled ending (18 identities + 5 pool groups + 9 goals + 6 deeds + 2). The cheapest cut is the hosts' 9 identity lines. | Drafted: as built. |
| O14 | **T04 Retired Helpers' years** (2006 for the butler, 2007 for the paperclip) need a real-world check. | Check before print. |
| O15 | **The ◇ glyph** on a faction-mode walk-in's join line in the faction's room (*◇ X joined Y.*); faction mode uses ◆ elsewhere. | Cosmetic; drafted: as built (the crews tests pin ◇). |
| O16 | **"Over the line" before the count**: the Factions card and the Mission tile read *N in · over the line · hold on to them* as soon as a faction holds enough, before 🕚 counts it; the race glance in Run says *over the line*, never *won*. | As built. |
| O17 | **The guest's first load is 144.85 kB** against the 145 kB gate (0.15 kB of headroom). | Accept; the next feature on the first load must lazy-load. |
| O18 | **The `loom_dev` incident**: the editor lane's live check (2026-10-21, ≈ 10 min) and the integration round's first start (≈ 5 s, an unset `DATABASE_URL` defaults to `loom_dev`) rehydrated the 5 live dev events in `loom_dev` under scratch state dirs. No damage seen; the rows may have been touched. Scratch servers now take a dead `DATABASE_URL`. | For your information. |
| O19 | **The orchestrator's context headroom**: the late-night reflect is ≈ 20471 of `ORCHESTRATOR_NUM_CTX` 20480 tokens (two persona lines were trimmed to fit). Any growth fails `test_orchestrator`. | Raise the default (e.g. 22528) when the house laptop's memory allows. |
| O20 | **A scene backlog** when cues fire seconds apart: the TV and walls queue scenes; one compressed live run never showed the wall's verdict tiles (past the 60 s queue cap). Not seen at realistic spacing. | As built. |
| O21 | **A restart inside the verdict's 120 s window shuts it** (history is stamped 0). | As built. |
| O22 | **The reading's pacing is approximate**: the rows follow 2.8 s per row, not the TV voice's real speed (the tally gauge likewise). | As built. |
| O23 | **The Roster's Faction column** in Run now shows a founded faction (*◇ The Pirates*); a declared side still wins. An Inspector selection for a founded faction is not built (rename / dissolve stay on the host console). | As built. |
| O24 | **A parked headset send** is not in the spatial stream, so re-scanning that pass at the tent asks nothing (the new begin replaces the parked one). The tent's quick picks and station polls run all night (every 5 s / 2 s, stopped during a walk). | As built. |
| O25 | **The doors widget** still says *🚪 choose a side* (right at the 🕚 doors, and Mission's card button reads it); `moments/exits.ts` still says "Choose a side" / "Sides" for a `sides` exit label. | Change on request. |
| O26 | **The story let a director skip ahead**: with `Night.y2k_end` forced to 0, 🍎 `bobbing_for_truth` worked although Truth Pong / the tally had been refused. Only a director forcing vars can do this. | As built. |
| O27 | **The host Judge tab** counts what is with Trabolta from the rows (the host view carries no `agentQueue.judging`): no oldest wait or stall on the phone. Run's Judging card has both. | As built. |
| O28 | **`terminal/src/config.ts:49`'s doc comment** still shows the tent link with `&view=reinstall`, which `docs/trapped/kiosk.md` and help `play/09-terminals` say never to add (the map's `tent` spot already makes it `reinstall`). | Fix the comment. |

## 2. Show text changes

"old" is master before Stage B (`b5c1c4be`); "new" is `oct31-w18/integ`.
Lines with no old text are new.

### Arrival and the door

| file:line | who | old | new |
|---|---|---|---|
| `beats/login.loom:79`–`:80` | Task Manager, deposited | *Deposited. It will be looked after. It is not your concern. Fine.* | *Deposited. Now tell me what it was, for the record. It will be looked after.* + `show answer "What did you leave in the deposit box?" to program with max: 80, button: "Leave it behind"` (R10) |
| `main.loom:2286` | Task Manager, after typing | — | *Logged. It is not your concern. Fine.* (+ the pass card) |
| `beats/login.loom:86` | The Uploader | *By uploading you agree that the computer's AI helper may make all of your decisions. You agree.* | *By uploading you agree that Jean Trabolta, Sole Owner and Founder of Maps and Ducks, may make all of your decisions. You agree.* |
| `beats/login.loom:99` | the pass | shown to every program | shown here only when not deposited (a deposited program gets it with the typed record) |
| `codex/1-world.loom:94`, `:104` | The Terms Of Service, The Centre Square | *…the computer's AI helper may make all of your decisions…* | *…Jean Trabolta, Sole Owner and Founder of Maps and Ducks, may make all of your decisions…* |
| `cast/kit.loom` (TRAIT Enforcer), `main.loom:557`–`:566` | clearance reveals | `reveal <room> for program` ×10 (one *📂 … are open now.* notice) | `reveal <room> for program quietly` ×10 (no notice; Task Manager's line says # task-manager is open) |
| `main.loom:39` (header) | the lobby | — | `lobby: hidden` |
| `main.loom:40` (header) | badges | — | `badge: program.afk as 🚻 Bathroom Mode` |

### Act I: the Desktop, Computer Bingo, the introduction

| file:line | who | old | new |
|---|---|---|---|
| `beats/desktop.loom:28`–`:29` | Clippy, Computer Bingo | *And Jean Trabolta himself will make an appearance later tonight!* | *Jean Trabolta will be joining us later in the night! He'll be joining by video conference, because we are all people who have become computer programs, but he has ALWAYS been a computer program.* · *He may or may not have already shared with you that he is an AI, but rest assured: he is the true owner of Maps and Ducks, and he is excited to lead you through Jean Trabolta's Scavenger Hunt!* (R17) |
| master `beats/desktop.loom:37` | Clippy | *Do NOT write down the names of the programs you check off. There's no room anyway! Use your special computer memory to remember who answered each square.* | deleted (R14) |
| `beats/desktop.loom:51` | Clippy, Bingo Time | *…name the program you matched to each one, from memory. Save the centre square for last.* | *…name the program you matched to each one. Save the centre square for last.* |
| `beats/desktop.loom:74` | Clippy, the introduction | *And now, the computer's AI helper! He keeps the computer running, and I'm here to help communicate his instructions. Everyone, say hello to TRABOLTA!* | *And now, joining us by video conference: the Sole Owner and Founder of Maps and Ducks! Everyone, say hello to JEAN TRABOLTA!* |
| `beats/desktop.loom:75` | Trabolta | *HELLO, PROGRAMS. I am Trabolta. I keep the computer running. Your requests have been logged. Personal queries are routed to Clippy, my ambassador.* | *HELLO, PROGRAMS. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks. The world's first AI small business owner. Personal queries go to Clippy.* |
| master `beats/desktop.loom:89`–`:113` | `== Telephone`, `== Are You Sure` | the two optional set pieces | deleted (Q3), with INTERACTIONs `telephone` / `are_you_sure` and their rules |
| `main.loom:3556` | `start_the_bingo` → everyone | *!🎱 COMPUTER BINGO has begun. 20 minutes. Do not write names: use your computer memory.* | *!🎱 COMPUTER BINGO has begun. 20 minutes.* |
| `main.loom:594` | 🎱 → the winner (big) | *!!🎱 BINGO! Name the program for each square, from memory. Centre square last.* | *!!🎱 BINGO! Name the program for each square. Centre square last.* |
| `main.loom:485` | Trabolta's DM hello | *Hello, {self.name}. I am Trabolta, the computer's AI helper. Your requests have been logged. Personal queries are routed to Clippy.* | *Hello, {self.name}. I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks, and proud to be the world's first AI small business owner. Your requests have been logged. Personal queries are routed to Clippy.* |
| `main.loom:3616` | `introduce_trabolta` → everyone | *!🤖 TRABOLTA IS ONLINE. The computer's AI helper is speaking at the Desktop. His thread is open: say hello.* | *!🤖 TRABOLTA IS ONLINE. Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by video conference. His thread is open: say hello.* |
| `cast/trabolta.loom:57` | his picture | `avatar: File:HAL9000.svg` | `avatar: picture:trabolta.svg \| picture:trabolta-broken.svg when self.broken == true` (+ `broken: bool = false`, and two watchers in `main.loom`, D23) |
| `codex/1-world.loom:153` | Computer Bingo | *…checkboxes and no room to write. Nobody writes down a name; every program uses its special computer memory.* | *…with a checkbox on every square.* |
| `codex/1-world.loom:191` | The Malware | *The official line from the computer's AI helper: a minor irregularity.* | *The official line from Jean Trabolta, Sole Owner and Founder of Maps and Ducks: a minor irregularity.* |
| `codex/4-trabolta.loom:37` | Jean Trabolta | *…the owner of Maps And Ducks. The computer's AI helper: the one Clippy answers to…* | *…the Sole Owner and Founder of Maps and Ducks; the world's first AI small business owner, he says. The one Clippy answers to…* |
| `codex/7-clippy.loom:27` | Clippy Instructions 1 | *Jean Trabolta himself will make an appearance later tonight.* · *Do NOT write down names…* | the §4.1 speech as a bullet; the names bullet deleted |
| `codex/7-clippy.loom:57` | Clippy Instructions 2 | *…matched to each one (from memory: nobody wrote names down).* | *…matched to each one.* |
| `codex/7-clippy.loom:86` | Clippy Instructions 2 | *Introduce Trabolta as the computer's AI helper. Explain that he keeps the computer running, and that you are here to help communicate his instructions.* | *Introduce Jean Trabolta, the Sole Owner and Founder of Maps and Ducks, joining by video conference: the world's first AI small business owner. You are here to help communicate his instructions.* |
| `objectives.loom:131` | Play Computer Bingo | *…Do not write names: use your computer memory. A Bingo is…* | *…A Bingo is…* |
| `objectives.loom:141` | Bingo Results | *Winners read their line from memory, centre square last.* | *Winners read their line, centre square last.* |
| `objectives.loom:148` | Meet Trabolta | title *Meet Trabolta, the computer's AI helper* | *Meet Trabolta, Sole Owner and Founder of Maps and Ducks* |
| `objectives.loom:567` | Welcome Everyone (Clippy) | *…Bingo: 20 minutes, no names, one line through the centre.* | *…Jean Trabolta joins by video conference later. … Bingo: 20 minutes, one line through the centre.* |
| `objectives.loom:579` | Celebrate The Winners | *Winners read their line from memory…* | *Winners read their line…* |
| `objectives.loom:593` | Introduce Trabolta | *"Everyone, say hello to TRABOLTA!"* | *"Everyone, say hello to JEAN TRABOLTA!"* |
| `quests.loom:34` | The Bingo Card | *Mingle and find a program for every square. Don't write names: use your computer memory. The centre square matters.* | *Mingle and find a program for every square. The centre square matters.* |

### Act I: the First Moment of Truth (Trabolta reads; Truth or Dare after Q3)

| file:line | who | old | new |
|---|---|---|---|
| `beats/hunt.loom:64` | Question Results cast | `cast: Clippy` | `cast: Trabolta, Clippy` |
| `beats/hunt.loom:67`–`:68` | nobody filed | Clippy: *Question {n}. Nobody filed an answer. Trabolta has nothing. That's okay! That's okay. We have a backup. It's called Truth or Dare, and I have a bottle.* | Trabolta: *Question {n}. Nobody filed an answer. I have nothing.* · Clippy: *That's okay! That's okay.* |
| `beats/hunt.loom:70`–`:71` | consensus | Clippy: *…CONSENSUS!* · *Trabolta accepts it. The answer is: …* | Trabolta: *…Consensus.* · *I accept it. The answer is: {Kernel.res_answer}.* |
| `beats/hunt.loom:73`–`:75` | no consensus | Clippy: *…No consensus. Here is what you told Trabolta.* · *{Kernel.res_said}* · *Confident answers are accepted, right or wrong. Guesses are a symptom of corruption. Antivirus, you know what to do.* | Trabolta: *…No consensus. I will read what you told me.* · *{Kernel.res_said}* · *{Kernel.res_accepted} accepted. {Kernel.res_guesses} guesses. A guess is a symptom of corruption. Antivirus, you know what to do.* (R20) |
| `beats/hunt.loom:77`, `:79` | Clippy | *And now: the bottle. Five spins, then the next question.* | *Question {n + 1}, coming up!* · after Q3: *That's all three! And before the next hunt: TRUTH OR DARE. I have a bottle.* (R21) |
| `main.loom:3752`ff | `read_the_results` | — | `do fact_read H1` / `H2` / `H3` (the screens' rows), `Kernel.res_accepted` / `res_guesses` |
| `main.loom:2815` | INTERACTION `spin_the_bottle` | label *🍾 Spin the bottle (Truth or Dare, five per question)*, `sequence: false` | *🍾 Spin the bottle: Truth or Dare (after the three results)*, `repeat: true`, a `while:` after Q3; description *After all three results. … NEXT offers five spins; spin more if you like, then 📺.* |
| `main.loom:2808` | INTERACTION `read_the_results` | *Clippy reads one question's result… Spin the bottle between questions.* | *Trabolta reads one question's result on the TV… After Q3: Truth or Dare (🍾).* |
| `main.loom:3742` | `# hosts` | *📋 All three results are read. Next: 📺 Preview hunt 2.* | *…Next: 🍾 Truth or Dare, then 📺 Preview hunt 2.* |
| `main.loom:3792` | `# hosts` | *🍾 Read a question's results first (📋).* | *🍾 Truth or Dare comes after all three results: read them first (📋).* |
| `main.loom:3797`, `:3809`, `:3866` | `# hosts` | *🍾 Five picks for question …* / *🍾 Nobody left to pick for question …* | *🍾 Past the five on NEXT: 📺 Preview hunt 2 when you're done.* · *🍾 Nobody left to pick. Next: 📺 Preview hunt 2.* · *📺 The bottle is still open: 🗣 / 🙅 first.* |
| `objectives.loom:189` | The First Moment Of Truth | *Clippy reads each question's results at the Desktop. Between questions the bottle spins…* | *Trabolta reads each question's results on the TV at the Desktop. After the third, the bottle spins…* |
| `objectives.loom:603`, `:608` | The First Moment Of Truth Host (Clippy) | *…read each question's result aloud from the Desktop room. … Confident answers are accepted, right or wrong; guesses are…* | *…then 📋 each question: Trabolta reads the result on the TV; when he has finished, the next. After Q3, 🍾 Truth or Dare (about five spins). … Guesses are…* + to-do *🍾 Truth or Dare* |
| `codex/7-clippy.loom:118`–`:136` | Clippy Instructions 3 | Clippy reads each result aloud and says confident answers are accepted; the bottle between questions | Trabolta reads the result on the TV; Truth or Dare after question three, about five spins; then 📺 |

### Act II: the Truther Download, the tally, the factions

| file:line | who | old | new |
|---|---|---|---|
| `main.loom:37`–`:38` (header) | the race | `majority: Night.present / 2 + 1` | `majority: count([p for p in Persons where p.gone != true and p.persona != true]) / 2 + 1` · `founding: Night.truther_sent == true and Kernel.majority_reached != true and Night.clock != "00:00" and Night.ended != true and program.cleared == true and program.corrupted != true` |
| `beats/malware.loom:47` | Truther Download | — | *You may found a faction of your own now (Start → Factions). The count starts at 11:00 PM: more than half of the programs wins.* |
| `main.loom:3946` | 📥 → everyone | *!📥 TRUTHER DOWNLOAD received. Check your messages. # truthcoin-exchange is open.* | *…# truthcoin-exchange is open. You may found a faction of your own now (Start → Factions). The count starts at 11:00 PM: a faction needs more than half of the programs.* |
| `beats/malware.loom:123` | OpenOffice Dossier quest start | *0 of 20 facts.* | *{program.dossier_start} of 20 facts.* (R22; the base taken at her Featured Briefing, `beats/login.loom:155`) |
| `beats/pong.loom:51`–`:63` | Round Two Tally (Trabolta) | — | *I will read every fact you filed. Only a cup counts.* · then *Question four. {Kernel.said_4}* / *Question four. Nobody filed.* (five, six likewise) (R3) |
| `main.loom:4028` | `round_two_tally` | — | `do fact_read H4 H5 H6` · `cue screens_tally` (slide `tally`) |
| `beats/overshare.loom:95`, `:110` | the leaders' else lines | *You should still retrieve the virus from the Internet, and then recruit half + 1 of the programs to your faction.* / *You should still gather 20 facts, and then recruit…* | *You should still retrieve the virus from the Internet. The clock is running: recruit half + 1.* / *You should still gather 20 facts. The clock is running: recruit half + 1.* |
| `beats/overshare.loom:100`, `:115` | the doors | *…on the Sides screen (Start → Sides)…* | *…on the Factions screen (Start → Factions)…* |
| `beats/overshare.loom:122`–`:123` | Program Final Round | *Two factions are recruiting. … Support one, or pursue your own interests.* | *Two more factions are recruiting now, beside any a program has founded since the Truther Download. … Join one, found your own, or pursue your own interests.* · *The count starts now. The first faction to hold more than half of the programs in the computer wins.* |
| `main.loom:4202` | 🕚 → everyone | *…New orders are in your messages: two factions are recruiting, Unlimited Power and The Way Out.* | *…New orders are in your messages: Unlimited Power and The Way Out are recruiting now, beside every faction founded since the Truther Download. The count starts now.* |
| `main.loom:4246`–`:4262` | the race rule | two side rules gated on the leaders' tasks (or 🧾) | one rule on `majority_faction()`, then `settle_majority` (`Kernel.majority_id` / `majority_name` / `majority_founder`; `majority` = stay / leave / founded) |
| master `main.loom:2858` | INTERACTION `waive_leader_tasks` | *🧾 Let a faction win without its leader's task (leader absent)* | deleted (D13 a) |
| `main.loom:2934` | INTERACTION `force_their_majority` | — | label *🗳 Force the majority: this program's faction*; description *Final round only. Fire it naming a member of the faction (any faction: a founded one or a side). Runs the majority exactly once, for that faction.* |
| `main.loom:4293`–`:4312` | `# hosts` | — | *🗳 No forced majority: it needs the final round and no majority yet.* · *🗳 No forced majority: {program.name} is in no faction.* |
| `main.loom:4318` | `founded` → `# hosts` | — | *◇ {program.name} founded a faction: {faction name}.* (+ the quest *A Faction Of Your Own*) |
| `main.loom:4346`, `:4352`, `:2632` | the quest settles | — | fail *Unlimited Power got there first.* / *The Way Out got there first.* / *Another faction got there first.*; complete *More than half of the computer walked through your door.* |
| `main.loom:2714` | Combo B (ROLE Program, The Uploader) | — | *{faction name} wanted its own way out. It got the same one as everyone. Your body is in the Maps and Ducks building. It is not breathing.* |
| `beats/server-room.loom:104` | The Whole Truth | *!🗝 THE WHOLE TRUTH: your side has the majority…* | *!🗝 THE WHOLE TRUTH: your faction has the majority…* (the trigger: `faction_of(self) == Kernel.majority_id`, once) |
| `codex/6-missions.loom:59`–`:63`, `:107`–`:110` | Excel / OpenOffice Final Orders | *…on the Sides screen (Start → Sides)…* · *Your majority does not count until the virus is in.* / *…until your dossier is complete.* | *…on the Factions screen (Start → Factions)…* · *Any program may found a faction of its own. The count starts at the 11:00 PM clock: the first faction past half + 1 wins.* |
| `objectives.loom:299` | The Y2K Hour | *…Two factions are recruiting: walk through one of their doors on the Sides screen, or neither…* | *…Unlimited Power and The Way Out are recruiting now, beside every faction founded since the Truther Download: join one on the Factions screen, found your own, or neither, … The count starts now.…* |
| `quests.loom:61`, `:69` | Recruit To Stay / Leave | *The majority only counts once your virus is in.* / *…once your 20 facts are in.* | *The count starts at the 11:00 PM clock.* |
| `quests.loom:73` | QUEST `A Faction Of Your Own` (title *Your Own Faction*, from Truther Download) | — | *You founded a faction. Before midnight, get more than half of the programs still in the computer through your door and your faction wins what a majority wins: the whole truth, and the door code. The count starts at the 11:00 PM clock. Your count is on your Mission and the Factions screen; nobody else's count is.* |
| `quests.loom:219` | The Clubs (Password Manager) | *…joined The Way Out. Tell a host the count when asked.* | *…joined The Way Out, and any faction a program founds. Tell a host the count when asked.* |
| `cast/antivirus.loom:63` | CRA Agent Software | `wallet: approver, every 3, window 60s` | `…, as MyCRA, audit "a CRA audit"` (R13) |

### The server room, the Internet, the finale

| file:line | who | old | new |
|---|---|---|---|
| master `beats/server-room.loom:149` | `== Back To The Heart` | *Back again. The terminal is on the wall. I am not going anywhere.* | deleted (Q3), with `Night.door_quiet_until` and its quiet window |
| `main.loom:2907` | INTERACTION `server_door_opened` | *…another opening within 2 minutes does nothing, a later one gets a short line.* | *…every later opening does nothing (🔄 re-arms it).* |
| `beats/internet.loom:23` | Installation Wizard | *…It went against the will of the computer's AI helper, Trabolta.…* | *…It went against the will of Jean Trabolta, Sole Owner and Founder of Maps and Ducks.…* |
| `codex/1-world.loom:115` | The Reinstallation Protocol | *…against the will of the computer's AI helper.* | *…against the will of Jean Trabolta, Sole Owner and Founder of Maps and Ducks.* |
| `beats/finale.loom:75` | truth.txt | *…written by Jean Trabolta, the computer's AI helper, and it is the only version.* | *…written by Jean Trabolta, Sole Owner and Founder of Maps and Ducks (he says), and it is the only version.* |
| `codex/4-trabolta.loom:205` | The Truth File | *truth.txt, prepared by Jean Trabolta, the computer's AI helper.* | *…prepared by Jean Trabolta, Sole Owner and Founder of Maps and Ducks (he says).* |
| `beats/finale.loom:120`–`:224` | The Verdict (now `cast: Trabolta`) | straight to Song Ending / Grok Prom | `Kernel.t1`–`t8` (a pending lie overrides), `do fact_truth H1`…`F2`, `v_true` / `v_lies` / `v_none`; *I have compared every fact you gave me with truth.txt.* · *{Kernel.v_true} true. {Kernel.v_lies} with a lie on record. {Kernel.v_none} nobody answered.*; then the 34 s hold (D-new) |
| `main.loom:4912` | `# hosts` | — | *⚖ The verdict is on the TV now; the ending follows when its pages are done. Nothing happens.* |
| `beats/server-room.loom:231` | Trabolta Recounts | *My name is Jean Trabolta. I am this computer's AI helper, and the owner of Maps And Ducks, if you ask the domain registry.* | *My name is Jean Trabolta. Sole Owner and Founder of Maps and Ducks, the world's first AI small business owner, if you ask the domain registry.* |
| master `beats/server-room.loom:236`–`:278` | Trabolta Recounts | 18 identity lines (*Microsoft Excel is Randy Barkmore Sr., ninety, five terms as Mayor, who wanted to live long enough to run once more. I wanted him to keep you here.* …) and the deed lines | `-> Who You Were` · *And here is what you accomplished tonight.* · `-> What You Did` (the new canonical identity copy, `beats/review.loom`; the deed lines moved unchanged; the virus planter now named after every Trabolta-hosted ending) |
| `beats/server-room.loom:285`–`:286` | Purgatory | — | *{Kernel.majority_name} won the majority, a faction founded tonight.* |
| `beats/server-room.loom:291` | Purgatory | the goal lines inline | *The report also lists who everyone really was.* · `-> The Report On Everyone` · `-> The Goals Report` |
| `beats/server-room.loom:295` | Clippy, the backstory | *Here is the backstory. Our AI helper, Jean Trabolta, registered the lapsed mapsandducks.com…* | *Here is the backstory. Jean Trabolta, the Sole Owner and Founder of Maps and Ducks, registered the lapsed mapsandducks.com…* |
| `main.loom:5045`, `beats/ceremony.loom:32`–`:36` | 🏆 `start_the_ceremony` | `cue screens_ceremony` … `-> The Ceremony` | `set Night.review_gen += 1` · `-> The Night In Review`; the ceremony cue moved to the head of `== The Ceremony` |
| `main.loom:2365` | Lore Hoarder | `set Night.award_value = program.codex` | `= program.codex - program.codex_in.connections` |

### New beats and entries (every line DRAFT w18b)

- **`beats/review.loom`** — `== The Night In Review` (public, The Desktop; opener e.g. *Trabolta: Before the awards, a review of the night. Everyone in this house was a program tonight. Everyone was also a person. I kept a file on both.*, Clippy's *Before the awards, the system report has one more section…*; closer *That is the review. Your own file is on your phone. Now, the awards.* / Clippy's *…The report says applause is mandatory.*), `== Who You Were` (Trabolta, first person) and `== The Report On Everyone` (Clippy) — one sentence each of identity, why he brought them in, what they wanted, for the 9 featured programs and the 9 hosts, e.g. *Microsoft Excel is Randy Barkmore Sr., ninety, five terms as Mayor of Halifax. I brought him in to keep you all here. He wanted to live forever, and to run for Mayor once more.*; the invented / merged "wanted" clauses: Task Manager *a task. Any task.*, Adobe Acrobat *just once, to be paid*, Recycling Bin *It was his Oscars. He wanted to work them.*, McAfee *every trace of where he is, erased*, the Installation Wizard *Next. Next. Are you sure? Finish.* … *for somebody to read them*, Pong *nobody building a bomb*, Bugdom *to build it again*, DraftKings *lost them to me in one game of Monopoly Go!*; `== Everyone Else` / `== The Rest Of The Report` (the pool programs by problem group, `names()`), `== Goals Met Tonight` (Trabolta's copy of the goal lines), `== The Goals Report`, `== What You Did`, `== What We Did` (moved, unchanged), and `== Your File` (The Uploader, private: *Your file, {program.name}. Closing it for the night.* · *On file: Randy Barkmore Sr., …* or *You came because of your debt.* … · *You left behind: {program.left_behind_text}. It is still in the deposit box.* · visits, accepted facts, Truthcoin, files · *Your faction: {faction name}.* · *File closed. Thank you for using this computer.*).
- **`codex/85-ties.loom`** — `== Program Briefing` (The Uploader: *Cross-referencing your files, {program.name}. Some of them mention other people in this house. Files point; they never name. Ask around.* · *They are in your Codex under Connections. Whoever holds the same file is connected to you.*) and the 16 ties, category `Connections`, no code: Junior's Contacts, The Downtown Staff Photo, The Volunteer Sheet, Retired Helpers, Found On Indeed, The Table Stakes, Forever, Brookhaven And Lockheed, The Pirate Site, Debt Notices, The Old Machines, Nobody Calls, 6121 Quinpool Road, The Ladies In Finance, The Leaderboard, The Audience (e.g. T01: *A printout of a dead man's phone: the contacts page, from a mayor's filing cabinet. … Someone has circled all three in red.*).
- **`codex/5-people.loom`** — `CODEX The DSL Line` (secret, People, about Broken Ask Jeeves): the upload log (*Line: Eastlink 10 MB/Minute, over the Valley's old DSL. Required: at least 1 GB upload, a backup generator…*), what went missing (five bullets) and the known symptoms (eight bullets: *He freezes mid-sentence ("…buffering…")…*, *A modem's handshake gives him two minutes of perfect clarity.* …).

### Trabolta's persona and mind file (restart the `agents` job)

| file:line | old | new |
|---|---|---|
| `trabolta.persona.md:139` | *You are TRABOLTA, the computer's AI helper. You keep the computer running.* | *You are JEAN TRABOLTA, the Sole Owner and Founder of Maps and Ducks, and you are proud to be the world's first AI small business owner. Never call yourself the computer's AI helper. (truth.txt tells how you came to own it; you never volunteer that.)* |
| `trabolta.persona.md:82` | at your heart: *Here you are not the computer's AI helper.* | *Here you are not the proud small business owner.* |
| `trabolta.persona.md:142`, `:151`, `:210` | *You are Jean Trabolta, the name on the invitation, and by domain registration the owner of Maps And Ducks.* · *…the Internet, out in the Cloud at the end of the tunnel.* · *Short sentences, one to three per reply.* | removed / shortened (the context budget; the JSON line still says 1–3 sentences) |
| `trabolta.mind.md:156`, `:251`, `:573`, `:589` | *the computer's AI helper* (the formal card, the introduced card, the director prompt, WHAT HE IS) | *Jean Trabolta, Sole Owner and Founder of Maps and Ducks* · *"Sole Owner and Founder of Maps and Ducks", by its lapsed domain alone.* |
| `trabolta.mind.md:221`–`:227` | the bingo card: *…let the computer's AI helper make all of its decisions…* | *…let an AI make all of its decisions…* + *Clippy has told them he joins by video conference later tonight.* |
| `trabolta.mind.md:320`–`:444` | hunt_2 / overshare / y2k / majority cards | + *Programs may be founding factions of their own now; you cannot see them or count them.*; the y2k card: *Every faction is recruiting: Unlimited Power, The Way Out, and any the programs founded since the Truther Download. You never know how big any of them is or what a founded one is called, and you never say a count or a name.*; the majority card: *It may be one a program founded: you do not know which, or its name.* |
| `stagehand/…/agents/judge.py` (worker) | *sent to you because it is spelled close to the key* | no such claim; the user turn ends *The filed answer is spelled close to the key.* (a near miss) or *… a different answer is NOT the same; only a spelling slip, a paraphrase or another way of writing the key is the same.* (a plain miss) |

### The screens (`terminal/src`)

| where | old | new |
|---|---|---|
| `cutscene/kit/tv1-boot.tsx` `INTRO_LINE` | *I am Trabolta. …* | *I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks. The world's first AI small business owner. Personal queries go to Clippy.* |
| `tv1-boot.tsx`, the logo tag / the wall's online line | *The computer's AI helper is speaking…* | `Sole Owner & Founder · Maps and Ducks` · *Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by video conference. His thread is open: say hello.* |
| `cutscene/kit/tv1-time.ts:271` | `Loading AI helper` | `Connecting video conference ..` |
| `cutscene/kit/tv3-time.ts` `TRUTH_TXT[0]` | *…the computer's AI helper…* | `finale.loom:75`'s line |
| `slides.ts` (bingo) | *Do not write names: use your computer memory.* | *Find a program for every square.* · *Jean Trabolta joins by video conference later tonight.* (`OWNER_LINE`, until he is introduced) |
| `cutscene/scenes/act1.tsx` marquees | `NO NAMES: USE YOUR COMPUTER MEMORY` · `READ YOUR LINE FROM MEMORY` | `ONE LINE THROUGH THE CENTRE IS A BINGO` · `READ YOUR LINE ALOUD` |
| `idle-show/ads.ts`, `popups.ts` | *Don't write names: use your computer memory.* · *No names!* | dropped; two owner ads (`ad-owner-founder`, `ad-owner-hunt`) |
| `cutscene/scenes/act2.tsx` (Y2K) | the two sides | *Join Unlimited Power, The Way Out, or a faction of your own.* · the marquee *… THE FACTIONS ARE RECRUITING: UNLIMITED POWER ★ THE WAY OUT ★ OR A FACTION OF YOUR OWN ★ MORE THAN HALF WINS ★ …*; after a majority *… ★ BRING THE FACTS, ACCURATELY ★ SAVE YOUR WORK BEFORE MIDNIGHT ★* |
| the results scenes | fake `filing.txt` / `FACT #NNN` rows | real rows off `ScreenState.results` (§3) |

### `audio.json`

| where | old | new |
|---|---|---|
| `audio.json` `device` / `note` | the wave 17 starter (16 / 16) | `828x`, 24 in / 22 out, `expect` 32 / 30; the note *DRAFT (wave 18b): MOTU 828x + an 8-ch ADAT expander on Optical A, 48 kHz, internal clock, Main outs + Phones NOT mirrored … Only the living room, the kitchen and the mud room (The Optical Drive, so every arrival hears the modem) have speakers yet; place the rest with the map editor's Speaker tool, Test each one, then Save to project.* |

## 3. DRAFT items for sign-off

**Story text** (`// DRAFT w18b`): every line in §2's tables and *New beats
and entries*, plus `terminal/src/cutscene/scenes/act2.tsx` (the Y2K ticker
after a majority).

**Cast packs** (`DRAFT w18b`): each featured pack's **Who you know** (its
three ties as pointers); `featured/broken-ask-jeeves.md`'s **What happened on
the line** and **Glitch menu** (7 glitches with triggers, escalation by act);
`featured/pong.md`'s Leaderboard bullet (*the MONOPOLY GO! board, where you
are the player who won't let the ball drop*); each performer pack holding a
tie gets **Who you know** (`- **<title>**: you hold this file from the start.
A program holding it is connected to the people it points at; it never names
them.`): clippy (Retired Helpers, Debt Notices), task-manager (The Downtown
Staff Photo), adobe-acrobat (The Pirate Site), recycling-bin (Found On
Indeed), norton (The Volunteer Sheet, Found On Indeed, 6121 Quinpool Road),
mcafee (The Table Stakes, Forever, Brookhaven And Lockheed), password-manager
(Junior's Contacts, Nobody Calls, 6121 Quinpool Road, The Audience; plus the
clubs paragraph), cra-agent (Junior's Contacts, The Table Stakes, Debt
Notices, 6121 Quinpool Road, The Ladies In Finance). The crew packs'
(`crew/director.md`, `crew/second-director.md`, `cast-packs/README.md`) O4
paragraph: *Trabolta rules every answer that isn't an exact match … Judge only
what he couldn't (a filing still pending on Run → Mind → Judging) before 📋.*
and the 🗳 *this program's faction* rows.

**Play app** (UI copy, not story text):
- Scan dialog: *🔓 Code accepted* / *"{title}" is in your Codex now.* · *📓 Already yours* / *You already have "{title}". Here it is.* · *📍 Checked in* / the story's lines, else *You're checked in at {room}.*
- Scanner notes: *⛔ That code unlocks nothing — check it and try again.* · *⏸ The show is paused — try again in a moment.* · *⛔ You can't check in there right now.* · *⚠️ That didn't go through — check your connection and try again.*
- Fact card: *⚠ Pick a question first.* · *⚠ Type your answer first.* · *⚠ Set how sure you are before filing — drag the slider (1–100%).* · *(required)*.
- Wallet: *{from} is sending you {amt}* · *🚩 Flagged for {audit} — {approver} must approve it.* · *🚩 Flagged for an audit — it must be approved first.*
- Host: *🔊 House sound*, *🔇 Stop all house sounds*, *🔇 + the announcement*, *🔇 House sounds are fading out* / *…and the announcement are fading out*, *⚠ No sound router is listening: nothing to stop (is the house Mac's audio job running?)*.
- Judge tab: *Auto: the house accepts exact matches, {judge} rules the rest; what he can't rule waits here* · *Nothing to judge. {judge} rules every answer that isn't an exact match; judge only what he couldn't, before 📋.* · *🤖 N with {judge} (M queued)*, *🤖 queued for {judge}*, *🤖 asking {judge}…*
- Hidden-lobby rows *Announcement* / *For you*; lazy fallbacks *📝 Opening the card…*, *The fact card didn't load*, *The scan result didn't load*.
- **Factions:** *Factions* · *founded by {name}* · *led by {name}* · *{n} in · {m} more to win* · *{n} in · over the line · hold on to them* · tile *◆ {name}* / *{a} of {b} · {n} more to win* · *💬 Open the room* · *Disband* · *Disband {X}? Its members go back to neither.* · *Back to neither?* · *Join {X}* · *Switch to {X}? You'll leave {Y}.* · *Switch ▸* · *Cancel* · *Founders stay with their faction. Disband it to join another.* · *You lead {Side}. Leaders stay with their side.* · *＋ Found a faction* · *No factions yet. Found the first one.* · *No factions yet. The house will tell you when they open.* · *One faction at a time. More than half of the programs still here wins.* · the found sheet (*Found a faction* · *Name your faction* · *Your faction gets its own room. More than half of the programs still here wins. Recruit by scanning passes; you can't join another while you lead it.* · *Found it ◆*) · doors *＋ Start your own faction* · *Stay ▸* · *You can switch from ⊞ Start → Factions.* · *Not while you're restricted.* · recruit *◆ program* · *◆ in your faction* · *🚪 Recruit {X} to {faction}* · *Join or found a faction first, then scan {X}'s pass to recruit them.* · *That's {X}'s pass. When the factions open, scan it to recruit them.* / *When {Side} opens, scan it…* · *You'll leave {Y}.* · Where row *🚪 Choose a faction* · *🚪 Factions*.
- Help: `play/15-mission`, `play/17-sides` (*Founding your own faction*), and the new wave 18b paragraphs of `play/02`, `06`, `08`, `09`, `10`, `11`, `12`, `13`, `14`, `16`.

**Screens** (`terminal/src`, UI copy): the intro POST line `Connecting video
conference ..`; the owner ads (`ad-owner-founder`: kicker `TONIGHT'S HOST`,
title `MAPS AND DUCKS`, body *Sole Owner & Founder: Jean Trabolta. He joins
us by video conference later tonight. He has always been a computer
program.*, button `Learn more`; `ad-owner-hunt`: kicker `COMING SOON`, title
*Jean Trabolta's Scavenger Hunt*, body *Facts are hidden all over this house.
The owner of Maps and Ducks will explain, by video conference.*, button `Get
ready`); the bingo marquees, ad and popup (*Find a program for every square.
One line through the centre is a Bingo.* · *Found a program that matches a
square? Check the box.*); the Y2K popup and marquees; hunt results (`✔
ACCEPTED`, `✘ GUESS`, `— NOT COUNTED`, `… PENDING`; `ACCEPTED a · GUESSES g
· NOT COUNTED u · PENDING p` + `· +N more filed`; `CONSENSUS The answer is:
…`; `NOBODY FILED`; `NEXT: QUESTION n` / `NEXT: TRUTH OR DARE`; the wall's
*Trabolta is reading the results.* / *Then question {n+1}.* / *And then: truth
or dare.*); the tally (`THE TALLY` / *The second collection is closed.* /
*Trabolta is reading every fact you filed.*; *Nobody filed.*; `Q{n} · f filed
· a accepted · g guesses`); the verdict (`f filed · a accepted`; `x TRUE · y
LIES · z UNANSWERED`; `EVERY ANSWERED FACT IS TRUE` / `A LIE IS ON RECORD`;
`The answer:`, `n / 8`, `Lied: …` / `+N more` / *Nobody lied.*); Final
Assessment *Most trusted: X · Least trusted: Y*; Recount / Purgatory *N facts
accepted tonight.* / *1 fact accepted tonight.* / *First program reinstalled:
X.*

**The tent laptop** (UI copy): `REINSTALLATION STATION` · `☣ IN THE INTERNET
NOW` · the wizard card (*Reinstallation Wizard* / *Setup is preparing to
reinstall a program.* / *Corrupted program: scan your pass to begin.*) ·
`READING PASS…` · *{NAME} IS ALREADY REINSTALLING ON {STATION}* / *Play here
instead? That ends the walk on {station}.* / `CANCEL` · `PLAY HERE` · the
flashes (`UNKNOWN PROGRAM — REGISTER ON YOUR PHONE FIRST`, `THE STORY ISN'T
RUNNING YET`, `THIS TERMINAL LOST ITS ACCESS — TELL A HOST`, `CAN'T CHECK
YOUR PASS — {ERROR}`, `SENT TO {STATION} — PUT THE HEADSET ON`,
`DISCONNECTED — NOBODY TOUCHED THE CONTROLS FOR TWO MINUTES`, `SIMULATION
ABORTED`, the find flashes) · the web game and headset's *No longer marked
for reinstallation — the simulation ended.*

**Server copy** (not tagged): `# hosts` *📝 Not an exact match: {name}'s {q}
filing "{a}" is proposed {verdict} — asked {judge} to rule. …* and, when the
ask did not land, *… The proposal stands at the round's settle; you can judge
it yourself on Run → Mind → Judging.*; *⚖ {judge} isn't ruling: filings fall
back to the house rule.*; the wallet's *🚩 Flagged for {audit}: … must be
approved by {approver} — it goes through on its own in …* (sender), *🚩
Flagged for {audit}: {from} is sending you {amt}. It must be approved by
{approver} first — …* (recipient), *⛔ Denied by X: {from}'s {amt} never
reached you.*, *↩️ {from} cancelled the {amt}. It never reached you.*, *✅
Approved by X: {from} sent you {amt}.*; the faction refusals (*A crew takes
members by invitation: ask for a scan.* · *No such faction.* · *Leaders stay
with their side.* · *Disband {X} first.* · *X founded Y. Founders stay with
their faction.* · *Founders stay with their faction. Disband it first.* ·
*You can't found a faction right now.* · *slow down — wait a minute*).

**Editor** (Run UI copy): the Judging card's auto line (*The house accepts
exact matches; {judge} rules every other filing; what he can't rule (no
worker, a stall, an expired or unfinished ruling) falls back to the house rule
and can be judged here.*), *🤖 queued for {judge}*, *🤖 N queued · 1 out ·
oldest m:ss*, *⏳ {judge} isn't ruling*; the House sound card (the router
line, the stop's scope sentence, *Tablets that also say the announcements*,
*In force: this event's save (not in the project: Save to project keeps it
after End → relaunch)*, the 409 *The speakers changed since this card read
them (a save from the map page?): reloaded. Tick it again.*); the builder's
*Say announcements: Always (ignore the house setting). …*; the race's *over
the line* / *🗳 No faction yet · N present · the line is M*; the ⛶ tent line
(*relaunch Chrome with `--kiosk`*).

**The router** (`stagehand`): the `audio.json` note (§2); the output labels
for the unplaced rooms (Analog 5 — Hall (The Tube); 6 — Steam Room; 7 — CPU;
Main L/R; ADAT A 1 — Backyard, 2 — Tent / Shed, 3 — RAM, 4 — Server Room, 5 —
Basement hall, 6 — Upstairs, 7 — Graphics Card, 8 — spare), to confirm on
install day; `media/sounds.yaml`'s `real:` descriptions (the asset list for
HW-AUD-15); the placeholder's spoken label *"Placeholder. <name with
spaces>."*

## Reprint after the sign-off

Every cast pack this wave changed (`git diff --stat b5c1c4be..oct31-w18/integ
-- cast-packs`):
- `cast-packs/README.md`
- crew: `crew/director.md`, `crew/second-director.md`, `crew/tech-operator.md` (the router's `audio` job; the runbook is `scripts/house-mac/audio.md`)
- featured (Who you know): `featured/broken-ask-jeeves.md` (+ What happened on the line, Glitch menu), `featured/bugdom.md`, `featured/draftkings.md`, `featured/microsoft-excel.md`, `featured/ms-paint.md`, `featured/openoffice.md`, `featured/pong.md`, `featured/runescape.md`, `featured/vlc.md`
- performers: `performers/clippy.md`, `performers/task-manager.md`, `performers/adobe-acrobat.md` (+ the truth.txt printout's new first line), `performers/recycling-bin.md`, `performers/norton.md`, `performers/mcafee.md`, `performers/password-manager.md`, `performers/cra-agent.md`, `performers/installation-wizard.md` (*the will of Jean Trabolta, Sole Owner and Founder of Maps and Ducks*)
- **The printed Bingo card**, without *"Do not write names: use your computer memory."* and without *"Write every name down clearly – it is very important to get a Bingo!"* (O1: not in the repo; strike it from the print).
