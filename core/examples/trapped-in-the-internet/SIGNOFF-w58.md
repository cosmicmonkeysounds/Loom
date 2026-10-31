# SIGNOFF — wave 58: the Oct 30 story

**Status: DRAFT.** Branch `oct31-w58/story`. Not shipped. The contract is
[`docs/loom-w58-contract.md`](../../../docs/loom-w58-contract.md).

Your request, as the wave's notes carry it:

> Task Manager is cued with the teleprompter to read the monologue on the bad
> endings. Trabolta delivers the monologue (no glitches) on the good endings.
> Update the Loom story from the latest script. Facts: IF THEY HAVE A CODEX ENTRY
> THEY ARE SCANNABLE BY EVERYONE, including Clippy, the Antiviruses and the hosts.
> Document every discrepancy.

and, on the scanning:

> guests can scan secrets too.

The three files you delivered in `Trapped In The Internet story/oct30/` were not
touched. No code, combination or hunt answer is written on this sheet, and neither
is Sandy's line: it is F1's answer now. Where a word would give one away the sheet
says "the rival", "her line" or "SCRIPT:133's phrase", and points at the file.

## 0. What needs you before 12:00

1. **The three hunt answers.** H1 (Funk and Wagnalls), H2 (Forensics For Dummies) and
   H3 (Macs for Dummies): each needs its answer, the forms you'd accept, where the
   page hides, and the page's own words. Their gold cards can't print until then.
   If they don't arrive, see D-15 for what a guest gets.
2. **The go on §1 and §2.** "Default" there means we chose: say the word and it changes.
3. **The words on §4.** Every line we wrote is marked `DRAFT w58` until you sign it.

The biggest open risks: **no real model has played the new Trabolta** (§5, check 6),
and **nothing here has been seen on the real TV, a real phone or the house speakers**.

## 1. The discrepancy log

Every conflict the two reviews found, and how it landed. **You** means your own answer
on the morning of 10-31. **Default** means ours, and you can overrule it.

### Scope

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-1 | The delivery touches the facts, the opening, the TV, Trabolta, the ending and a server route, after the 10-30 code freeze, with real-device checks for waves 53–56 still owed | Everything today, go/no-go 09:00, and if late cut in this order: TV picture choreography, truth.txt, review trims, song split | You | Nothing on the list was cut. The TV intro took the lower-risk plan (C6 in the contract), and the song split never happened (D-37) |
| D-2 | A ship needs a clean, committed tree, your story-folder move was uncommitted, and any ship carries wave 57, which master already holds | Your move is committed (`083c26ea`, by you). Wave 57 ships with this | You for the commit, Default for wave 57 | Nothing on this branch. To leave wave 57 out it has to be reverted first |

### The facts

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-3 | The delivered file doesn't load: 33 validator errors and 46 show problems, from the 11 stub cards and the missing `door.clues[].where` | Data fixes only. The validator was not relaxed | Default | `facts.json` loads, generates and passes `loomcheck` with 0 errors |
| D-4 | M02 M03 M06 M07 M13 M21 M24 M26 T4 T5 T6 kept `existing:` beside a codex with no id or code: new cards, or the old entries rewritten? Two old entries are shared and the story reads them by id | Ten become new cards with new ids and QR codes, and the old hand-written entries and posters stay. T5 stays the exception | You | The ten cards; their ids are on §3.3 |
| D-5 | Dropping `existing` would stop The Whole Truth handing out nine entries, two of them heart proofs | The nine stay, as explicit `unlock` lines beside `-> Facts Bundle` | You | `beats/server-room.loom`. Not the survey's nine: T5 keeps The Rival in the bundle, and The Billboard entry joined because M04 used to hand it out |
| D-6 | T5's text names F2's answer, and a non-secret entry reaches Trabolta | T5 keeps `existing: The Rival`, the new title and text go into that entry, and it stays secret | You | `codex/2-files.loom`. `secret` never limits a scan |
| D-7 | T3's and T4's new titles quote the film, and he could read them | `secret: true` on both. Guests lose nothing | You | `facts.json`. Your rule on secret stands: it only hides a card from Trabolta |
| D-8 | The file dropped `secret: true` from V01 and V04 | Restored on both. No other card lost it | You | `facts.json` |
| D-9 | "JESSE!" in three round briefs would show on every phone as a card from Trabolta, and Jesse is crew, on his `outside:` list | It was only for attention: removed. The briefs go back to the old words and P1 ends at "I cannot tell a good one myself." | You | `facts.json` |
| D-10 | `door.code` changed at all four digits, and the keypad is standalone | Deliberate. The keypad is re-set by hand before the 15:00 test | You | SHOWNIGHT §1, §3 and §4; the tests read the code from `facts.json`. **His never-list changes only with a worker restart** (D-56) |
| D-11 | The file dropped the digit notes' `where`, which is required | Same four hiding places as before | You | Restored from the old file; ids became the Server Room ones |
| D-12 | The story's digit hooks used the old ids. A miss passes every gate: the notes would scan, never count, and The Door Code would never assemble | Rename the hooks and the count in the same commit | You | `main.loom`, plus a test that fails on any dead `learns X`, `.codex.<slug>` or `unlock X` (`core/test/trapped-w58-hooks.test.ts`) |
| D-13 | The Door Code's new text fits only one of its three roads, and "shards" differs from the sign's "FOUR NOTES" | Neutral wording for zip, checkmate and majority, still containing the code | You | `facts.json` |
| D-14 | M04 and the old M21 stayed as hand-written entries with live QRs but dropped out of the bundle | M04's keeps its QR, its title and street follow, and its code became a Lower Water one. The Server Room entry stays scannable, as it was | You (M04), Default (the other) | `codex/1-world.loom`; both print unstacked (N-3) |
| D-15 | SCRIPT:145-147's three questions have no answers anywhere, and the validator needs a key | "Script's words, answers later": wired in on an obvious stand-in that can't pass for real and that no screen shows. The old three hunt documents go | You | **If a guest files before the answers arrive:** Trabolta's DM says he cannot read that filing, the 📝 card comes back, retries hit the usual rate limit. Nothing is recorded: no credit, no trust, no mark, no lie. `# hosts` gets one line per try. At the First Moment of Truth the question reads *Nobody filed an answer*. It stays unset, so the verdict is unaffected and the Song Ending stays reachable. Hosts can still judge what is said in the room |
| D-16 | The voice strips underscores, so a blank can't be read aloud | An optional `spoken` field on a question, used by the reading beat. The script's asterisks are dropped | You | H2 and H3 say "blank" (N-6) |
| D-17 | Was anything printed? 21 culled QRs would become wrong codes | Nothing is printed yet. A full run happens after the sync, and old codes can change | You | §6 |
| D-18 | R10 and R11 keep stale ids and titles, T9, V04 and L04 too, and some facts keep their draft flags | Leave them | You | Nothing. Eleven facts and all eight questions carry the draft flag, which changes nothing at runtime (§6) |
| D-19 | "Cold Door" was renamed only in the notes, while the Codex section, a quest, two facts, TV scenes and help keep it | Rename only what the file renamed | You | Nothing else |
| D-20 | M15 says facts are not clues, while the game says "Final fact one" and FACTS ARE FOOD | M15 stands as a sly aside | You | Nothing |
| D-21 | M27 promises a surprise no code gives | Leave it as a tease | You | Punctuation only |
| D-22 | R11's "Binary Tom" appears nowhere else | A tease. Leave it | You | Nothing |
| D-23 | R23 says Zoo Tycoon couldn't make it, but it is on the picker | "if it made it tonight" | You | Card and line |
| D-24 | V04's line said "With truth.txt, every patch counts", and it's until | "Until truth.txt, every patch counts" | You | Fact line |
| D-25 | Copy slips in the file: names, pronouns, an unclosed quote, fact lines disagreeing with their cards | Apply every mechanical fix | You | §3.3. **Worth a look:** C04 lost its *Why Trabolta chose* line (the test exempts it), and V08's old text was the only guest-readable warning that one confident lie ends the night in the rain. Your cut removes that warning |
| D-26 | Small canon slips in hand-written text: bodies, casinos, the water main, M32, R04 | Apply the lore review's fixes. The tension over what's inside his heart predates this delivery and stays | Default | §4.6. Three casinos everywhere, the water main, the bodies in the Optical Drive |

### Sandy, and what the story is

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-27 | Her one line had two wordings: ENDING:19 and F1's answer. The review recommended keeping F1's | **The monologue wins entirely** | You, overruling the recommendation | ENDING:19's wording in F1's answer and accept list, every Sandy line, `tv3-time.ts`, `act3.tsx`, `cast/staff.loom`, the Clippy and second-director keys. A test reads it from the facts. **The recordings can't change** (N-2) |
| D-28 | What she is: a phone agent at Northumberland Ferries met last summer (ENDING), a late-nineties chatbot at a bankrupt ferry line (the facts), and a third name in the `proposal` blocks | The monologue wins: a phone answering machine at Northumberland Ferries, last summer, disconnected, prom Halloween 2026 | You | L01, T4, The Sandy File, The LiveJournal, the Truther Download, F1's call log, the ticket, the TV's slide and banner, the heart's lines. The `proposal` blocks are deleted |
| D-29 | The rival had her (T5, F2, the prom beat) and never found her (ENDING:27, :31, :37) | He gets her tonight: small edits to T5 and ENDING:37. F2 and the prom beat stay | You | §3.2, §3.3 |
| D-30 | Lower Water or Barrington, and Maps and Ducks or Maps and More | Lower Water everywhere. "Maps and Ducks became Maps and More IRL": the monologue's "Maps and More billboard" stands and M03 stands. T9's "mural" is "sign". OpenOffice's Urban Outfitters stays on Barrington | You | Story, TV, packs. Two new words of ours in `codex/1-world.loom` (§4.6) |
| D-31 | New plot points: Oculus, the printer, the abandoned home, against the router and the Optical Drive | Accept the monologue's plot. Change the router line and Purgatory's body line, and keep Oculus | You | `codex/1-world.loom` and `beats/server-room.loom`. It stays buried until told (D-50) |
| D-32 | ENDING says one last undiscovered fact; the hunts ask eight | The hunts are his cover and the definition is only revealed. No prop, no story change | You | Nothing |

### Scanning

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-33 | Who "everyone" is, and which entries | Every guest, featured program and all 8 booth parts, every coded entry, secret ones included. Not the Installation Wizard (no booth) or a director (no identity). The Door Code has no QR | You | `/api/prime/codex/redeem`, the booth's scanner, the deep link |
| D-34 | Once staff scan, one tap passes a secret to a guest. Four shared digit notes hand over The Door Code, and a shared ILOVEYOU infects them. The review recommended hiding them | **Keep everything shareable** | You, overruling the recommendation | Nothing filtered. The help and the all-crew pack say to mind what you hand over |
| D-35 | How a booth's scan differs from a guest's | A miss commits nothing, and no wrong-code penalty for staff. Closed doors stay refused. No ⭐ or award credit | You | The card reads *Learned tonight* (N-37) |

### The ending

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-36 | Who reads on each ending, and does he come back after Combo A? The review recommended Task Manager for the rave and a weak Recounts after Combo A | Trabolta on song, pickup, help, hand jive and the rave (phoned in); Task Manager on Combo A and B. **After Combo A he never returns.** The talk-down is removed. Banished is not an ending | You | `beats/truth.loom`, `main.loom` |
| D-37 | Does the monologue come before or after he asks Sandy? The review recommended before | After every ending's last beat. No restructuring, no song split | You, overruling the recommendation | G0 📜 `tell_the_truth` |
| D-38 | The monologue is in the third person, and he has to say it | Word for word with one framing line, as if he reads his own file | You | §4.2 |
| D-39 | Should the text reach guests' phones? | Task Manager's stays in a hidden room. Trabolta's lands in chat, because he must stay in The Desktop for the TV to speak it | You (the hidden room), Default (Trabolta's) | His lines reach every phone at once when he starts. Guests' phones do hold Task Manager's in memory (N-25) |
| D-40 | truth.txt and the monologue tell the same story, and the cue can't go: it closes the patch bay, the door and the King | Keep the cue and its deadlines, cut the text to a short teaser | You | The beat, `TRUTH_TXT`, the printout, the codex entry (§4.5) |
| D-41 | He still answers DMs in bad endings, and the hold line says "later tonight" at that hour. The review recommended leaving it | After Combo A `Trabolta.awake` goes false, his worker holds, the TV goes to attract and his DMs stop. Fit the unavailable line | You, overruling the recommendation | `main.loom`, the persona's `unavailable:` |
| D-42 | VLC, Pong, McAfee, the hosts and the Wizard aren't in it, and seven featured paragraphs assume a guest who may not have come | Guard the seven by "came tonight". Keep the left-out programs in the review | You | `beats/truth.loom`, `beats/review.loom` |
| D-43 | 1,794 words: 11–13 minutes on TV, about 14 at the teleprompter, on a night projected to end near 02:10, when the clocks fall back | Length stays. Trim the review | You | The review's overlap is gated on the monologue having been told. Spoken length is an estimate (§5, check 2) |
| D-44 | How it has to be built: the TV keeps 40 lines a poll, narration under a part's `aloud:` reaches nobody, a beat is instantaneous, and a phone's read window was 10 minutes | 18 merged blocks, `Task Manager:` lines, G1 gated with a two-press guard and an override, the window at 20 minutes | You | C2 in the contract. Nothing warns if nobody holds the part: the override and a printed copy are the answer |
| D-45 | A new phase isn't free: with no mind card, the mind keeps the old brief and makes every power live | A `finale_truth` card, the phase restored after it, and a test that every `Night.phase =` has a card | You | `trabolta.mind.md`, `core/test/` |
| D-46 | The clean voice takes three story lines, and a director can still break it | Level 0 in `finale_truth`, with `heart_stage` and the alarm floor cleared | You | The press's `# hosts` line says to leave His voice on Auto or Clean |
| D-47 | A hidden room with no `checkin: false` would print a 12th location card | `hidden: true` and `checkin: false`, the Server Room's pattern | You | `The Script` in `main.loom` |
| D-48 | Who You Were repeats the monologue, Night.recount was never set on Combo B, and the slides fell back after 90 s | Gate the review on `Night.truth_told`, follow it in Night.recount, hold both slides | Default | `beats/review.loom`, `PERSISTENT_SLIDES` |
| D-49 | The bots rehearsed only three endings, and G1's gate would stall them | `evening.ts` takes all seven, presses 📜 and takes G1's ask | Default | All seven roads ran 24/24 on scratch servers. They expect no verdict on owed keys, and check it by themselves once the keys arrive |

### Trabolta

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-50 | The script and ending have him pose as a human, while the persona, the codex, the chips and an ad have him a proud AI. New risk: a persona asking the model to claim humanity may be refused | Publicly a man, he deflects and never flatly claims it. All proud-AI lines change. M10 reworded. The battery's identity scenario updated | You | Persona, mind, codex, chips, TV, ad. **See N-29:** the cover lifts when his file is read, not at the Download |
| D-51 | SCRIPT:111 tells a room not to mention the accident, which invites it, and nothing knows what it is | Never explained. He gets upset and volatile. Persona rule only, and the mind says so | You | Persona, mind, guards, filler pools (§4.9) |
| D-52 | SCRIPT:135's cans of water: words or a mechanic? | Words, a prop and one persona line. "five cents" spelled for the voice | You | A prop row and a 12:00 call, a chip each way, a note in the Recycling Bin's pack |
| D-53 | Real names in his mouth (Anthropic, ChatGPT, Mark Carney) against "names from beyond mean nothing to him" | Allowed in scripted lines. Anthropic and Claude go on `outside:` | You | See N-30 |
| D-54 | SCRIPT:133's phrase is H5's accepted answer, said aloud before the hunt, and the film is in his mouth against the 2026-10-19 rule | Keep it and "electrifying" as scripted lines, a wink. His live DMs stay banned from the film | You | The worker's `recent` drops it, and that test is green. The whole room still hears it |
| D-55 | "video conference", the old name of his theory, and small wording across the guards, the TV and the packs | "digital conference" and "Grand Unified Theory" in everything spoken. Entry ids and T12's QR stay | You | H6's wording changed (N-31). Comments, DESIGN.md's prose and a bot's lines keep the old name |
| D-56 | `sync-show` doesn't reach his worker: persona, mind and the door code's never-forms load at boot from the MacBook. Until a restart he runs yesterday's identity | A step on the ship list | You | SHOWNIGHT §1, TECH, the tech op's and Mind cards |

### The opening

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-57 | His speech goes straight on, so wave 32's talk scene has no place and the timed flickers would land on a 3-minute speech. The review recommended cutting the scene | **Keep banter:** the scene stays open after his sign-off until 🔎. The frozen word, ALL CAPS, the stammer and the flickers go. His first public crack is the first guess at the results | You, overruling the recommendation | Signed-off words gone: N-18 |
| D-58 | The hosts' spoken gag lines have no counterpart in the script, and they were signed off | Clippy describes them. `aloud:` is Clippy alone | You | `beats/desktop.loom`, the all-crew pack. Gone: N-18 |
| D-59 | Stage directions on a Narrator line reach every phone and would spoil SCRIPT:71 and :107 | Never on a Narrator line: Clippy's Instructions and her pack | You | A test holds all 13 |
| D-60 | SCRIPT:99-105 comes before he is online, but the TV's mirror waits for him and a test pinned that | A host-only cue, pressed only if a walker is up | You | 📺 `follow_the_reinstallation`; see N-10 |
| D-61 | SCRIPT:77 ("let the Antivirus decide") reverses wave 26's 🤐 (nobody is reinstalled) | Follow the script: 🤐 plays SCRIPT:75, then Norton picks and presses 🛡. ⭐ +5 stays | You | Clippy's Instructions, the objectives, Norton's pack. See N-13 |
| D-62 | SCRIPT:161-163 hands straight to him, but ⚖️ opens a 120 s window | Split it: SCRIPT:155-159 at ⚖️, the two minutes, SCRIPT:161-163 at ⏱ | You | `beats/hunt.loom`; the old filing lines go |
| D-63 | SCRIPT:137 promises a prize for the most correct answers, no award exists, and truths_accepted counts confident lies | A new ceremony row from key-matched answers. Lore Hoarder stays the secrets prize | You | G9a 🏅, built, not cut. Its open questions are N-34 to N-36 |
| D-64 | Bingo Floppy Disk or Bingo Ribbon | Words only. The TV art stays, and the glyph isn't 💾 | You | 🎀 stays as the glyph. The physical disks are a new prop (§6) |
| D-65 | "Write their name in the square" against checkboxes, and rows, columns or diagonals through the centre | Follow the script and fix the copy | You | Copy fixed. **Nothing in the repo prints the card:** check the artwork (§6) |
| D-66 | "Voice to text" reads backwards: he speaks by text to voice | Keep it as written, and flag it | You | Kept, on SCRIPT:111 and in the persona. Flagged here |
| D-67 | Small script-to-beat details: one round, SCRIPT:109 onward unconditional, 🃏 plays SCRIPT:81-89, the 1200 s clock and 15-minute hunt, ZIP files and the Chat App as words only | As the script, keeping the clocks | You | `beats/desktop.loom`, `beats/hunt.loom` |
| D-68 | The opening has no sync-only route: an old TV shows the old captions under the new speech | Ship first, sync after, reload the TV and terminals | You | SHOWNIGHT §1 |

### Machines

| # | What conflicted | What was decided | Who | What changed |
|---|---|---|---|---|
| D-69 | If the VPS dies tonight, the recovery restores tonight's data onto a warm standby built on an older image, if one was built | Note the step | Default | SHOWNIGHT §1 and §7, the tech op's card. Whether a standby exists is yours to say |

## 2. New since the reviews

Found while building. All Default unless it says otherwise: yours to overrule.

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-1 | A filing on a stand-in key would read a sure answer as a lie and a guess as a mark | A small check in `judgeWidget` and `core/server/facts.ts`, so it reaches the story with no verdict | Beyond the facts lane's file list; it's in the ship |
| N-2 | `youre_the_one_vocoder` and `youre_the_one_sandy_only` still sing her old line, while F1 and every screen use the new one | Noted, as you asked | The recordings can't follow. A guest judged on the new line hears the old one sung |
| N-3 | Hand-written posters no fact names any more (his theory, Target Selection, Trust Chart, Sandy File, Omnipotence, Maps And Ducks, the billboard, The Server Room) stay scannable but print as "unstacked" | The crew places them from the README's QR placements | |
| N-4 | Beyond the ten cards, What Sandy Says, the billboard entry and the three hunt cards took new QR codes | Fine, since nothing is printed | |
| N-5 | The heart test bans "ferry" from his heart lines so they don't hint at F1 | Kept, with "ferries" added | If you wanted him to name them there, it's a word and a line |
| N-6 | `spoken` says "blank" per word group, so the chat and the TV's caption show "blank" on H2 and H3, while the Quest Log, the card and the slide keep the underscores | As built | Hear it on the real TV |
| N-7 | T5's new words drop "since 1999" and "says whatever anyone wants to hear" from The Rival, and the LiveJournal still says that phrase | Left | It now points at nothing. The README still places the QR as a fridge sticky note, which is still a fine spot |
| N-8 | Left alone on purpose: M09's "most secrets" (Lore Hoarder stays that prize, though it sits oddly beside SCRIPT:137), M35's SOLD (ENDING says repossession), T8's Proprietor | Left | |
| N-9 | `generated/print-stacks.md` and DESIGN.md's generated block printed the real hunt answers, her line included, as they always had | **Taken out** (changed after the reviews): DESIGN's table shows the questions and the gold stack the question only, both pointing at `facts.json`. Stagehand's secrets test reads `facts.json` now. Clippy's and the second director's keys fill their owed rows from there | The stacks still print every unlock code, digit notes included, and the card titles and texts, and one title and T5's text spell F2's answer. The crew sorts by that file, so it stays until you say: strip it, or record it as the crew's key card, which your rule doesn't list |
| N-10 | The TV stays on the screensaver until he is revealed, so the script's mirror couldn't appear | 📺 lets a linked walker through, full screen with no face, only while he is hidden | It only shows while they are in the Desktop's room of the copy, so it can stay on the screensaver right after the press. Clippy's words pop up either way |
| N-11 | Her first 🎱 kills ↩, so she couldn't check a called line by hearing it | A guest's own 🎱 BINGO! brings Winning Line up at once | |
| N-12 | Task Manager's 🤖 Talk card comes up at 🤖, about three minutes before it's wanted | Kept simple: the hint says to wait, and a tap during the speech only queues behind it | Tell Task Manager |
| N-13 | 🤐 closes the round at once, so 🎯 is dead if a shy winner relents | Norton's 🛡 still works on anyone, so the room can follow him | |
| N-14 | The question slide and the Quest Log arrive at 🔎, after he has read the questions. While he reads, the TV has only the caption, though the words reach every phone's chat at 🤖 | As built | |
| N-15 | The TV's Filing Closed scene still says PENCILS DOWN · TRABOLTA IS READING, and a broadcast says round one is closed, though Clippy no longer says it | Left, as signed-off wave 26 picture and phone copy. A review raised it again. Your "old filing lines go" was about her spoken lines, so we did not undo a signed-off picture on our own | **Still your call.** If it goes: `act1.tsx`'s three strings, and `terminal/test/act1.test.ts` |
| N-16 | Guest help says "won the Bingo", not "Bingo Floppy Disk", because a test reads "floppy" as the virus pickup | Left; phones say Bingo Floppy Disk | |
| N-17 | Cue numbers moved: +2 from 🤖 on, and +1 more from G10 on (G10a–c are 64–66, G11 is 67, G12 is 80, G13 is 81). G labels did not move | Docs follow; nothing printed | |
| N-18 | **Signed-off words now gone.** Wave 26 and 32: the hosts' three gag lines, the frozen word, ALL CAPS and the stammer, the MANNERS.DLL log entry, the LIVE tab, the corner-window hand-back, five wave 32 chips (A real AI?, You froze, Buffering, PERFECTLY, Proud AI). The Routine chip is rewritten | They follow from your answers | Listed because you signed them |
| N-19 | The objective Find Three Facts still says "scan a fact's QR", and real books have no QR | Left | Depends on whether the books get QRs, which is part of the H1–H3 answer |
| N-20 | The rave's track plays on the sfx bus and never ducks, and the story can't stop a sound | The crew presses ■ Stop house sounds before 📜 (Run's header, the director phone's ☰, a host's More). The hand jive's and the dance song the same. The Mixer's ■ Stop music doesn't stop it | Rehearse it once |
| N-21 | The heart talk needed an end at its old last rung, and Layer Four had nothing left to reach it | Layer Four is removed with its questions. A new option, *That's all I came to say.*, plays a new beat, Heart Heard, which keeps the signed-off who-they-are and promise lines | The words are §4.3 |
| N-22 | Small calls on the ending: every phone gets a 📜 banner to the living room, even on nights they may leave. The rave's lights restore at 📜, the song's pink look stays through his reading, Combo A restores the house lights at 📜. Combo B keeps Purgatory first, without who-everyone-was or the backstory. On destroyed and rave `everyone_free` still waits for G11 | As built | |
| N-23 | The Uploader's Combo B fate lines said the bodies were elsewhere | Now the Optical Drive, matching Purgatory | |
| N-24 | After Combo A or B the letters' fact says he writes from a backup, so a guest can get a letter from a Trabolta they watched die | As built | Your call whether it stands |
| N-25 | Guests' phones do hold Task Manager's lines in memory: no room lists them, and the aloud mark is stripped. Someone with dev tools could read them. A real Combo A evening showed a guest listing 0 such rooms, while the booth's stream carried 73 script lines | As built | Hiding them from the stream isn't small |
| N-26 | Task Manager's pack now carries the printed monologue, her line included, and Clippy's its script | Decisions allow it on a card meant to carry it | Print them for those two only |
| N-27 | My addition on ENDING:73: "at the Halifax Explosion Memorial Pet Cemetery" moved in from :71, or "built there" would point at nothing | Logged in the test | §3.2 |
| N-28 | Left in the terminal, unused: tv2-parts' Motorcycle, and the CRT's progress bar, which nothing draws now | Not worth the risk today. The `room_heart_shutdown` scene, its timing and CRT card, and `room_heart_layer_4` with its title, were deleted after the reviews. The `heart_shutdown` light look stays: Combo A uses it | |
| N-29 | **The cover lasts until his file is read, not just the Truther Download.** After the Download he still neither confirms nor denies, as the hunt_2 brief already said | The smallest honest reading of "publicly a man until the Download" | If you want him to admit it sooner, change `cover.until` and gate the two blocks that say what he is |
| N-30 | `Claude` on `outside:` means a guest who registers as Claude or Jean-Claude has any line naming them withheld and replaced by a filler | The show's name pool has no Claude: only a typed name hits this | |
| N-31 | H6's spoken question changed to "Grand Unified Theory". Its answer and accepted forms did not | Regenerated; the gold card and stack follow | |
| N-32 | The persona block says "VR headset", because stagehand bars real-world references from a persona. The mind's text keeps Oculus | As built | |
| N-33 | "virtual reality" tripped the self-placement guard, and it's the script's own word | Fixed in the guards | |
| N-34 | **The prize, a tie:** everyone tied is named and they share it. Ties are likely with 8 questions, more so with H1–H3 owed (top possible score 5) | As built, the way G13 and G14 treat ties | If there's one physical prize the crew needs a tie-break on the floor; the story has none |
| N-35 | **The prize, spoken answers:** a host's ✅ counts as correct, or a guest who answered right aloud would lose out | As built | Dropping it is one clause per question, and its copy in `recap.ts` |
| N-36 | **The prize, no cup:** a right round-two filing by a program with no cup doesn't count, because he has already told them it wasn't counted. And both nobody-right lines say the prize stays put: Clippy's *in its box*, his *with me* | As built | The physical prize is still unknown: check the words fit |
| N-37 | A scanned entry on a booth reads *Learned tonight*, not *Unlocked with a code* | Default kept: it uses the existing `unlock`, which leaves Sim alone | Changing it needs 3 lines of Sim, and a rollback would replay them as no-ops |
| N-38 | Added, not asked for: *📓 Open my Codex* under the booth's camera | It's how a performer gets to what they scanned | Say if it should go |
| N-39 | His prompt lists the non-secret titles a performer holds, uncapped. A talk-scene performer who scans a lot makes each prompt longer | Secret entries stay out, tested. Not capped: that's worker code | Watch in rehearsal |
| N-40 | A performer signed out of their booth, using the phone's own camera, gets the guest landing | There's no session on that phone to open. 📷 in the booth is unaffected | |
| N-41 | Terminals still read only passes; a codex QR at a terminal gets the old answer | "Everyone" was applied to phones | Say if terminals should too |
| N-42 | A 15-character single name on an award slide overflows onto the number on 4:3 walls (69 px) and portrait walls (4 px), on every award. Not from this wave | Left | Fits on the 16:9 TV and 16:10 tablets |
| N-43 | Clippy's teleprompter had become the only copy of her opening | Her pack now carries it word for word, held to the story by a test (`core/test/trapped-w58-script.test.ts`) | Not asked for; a dead phone otherwise leaves her with nothing |
| N-44 | The README's hunt table spelled H4–H6's and F2's answers and codes | Taken out: it points at `facts.json`, as F1's row already did | |
| N-45 | The README's QR placement table still prints about 30 codex codes, and `OCT31.md` quotes a culled code and the digit notes' codes. All long predate this wave | Left, but for the digit notes: README and DESIGN now name those by room and point at `facts.json`, and a test holds it. The set crew uses the table at 12:00, and history docs stay | Against your rule, read strictly. Say the word and the table moves to entry titles |
| N-46 | A session's notes named two values that are a codex code and a hunt answer, as ordinary words that had matched a scan | In that transcript only: not in any file, commit or report | Named here so you know |
| N-47 | `oct31-w58/play-fullscreen` is not on this branch; it reached `oct31-w59/base` | Not merged here | Merge order is yours; re-run the first-load gate after it |
| N-48 | Stale facts fixed on the way through: the crew docs had the VPS on `w27` and `w18b`, `ad_burst` at cue 77 (79), 20 truths (17), and Clippy's hand-off line differed from her chip | Fixed | |
| N-49 | A program mid-talk at his heart when the cables came out could tap the docked menu and get *It is over. Go upstairs.* from a dead man. Combo B the same, already on master | After Combo A or B the pick ends the menu and nobody answers: the phone shows their own pick and nothing back | |
| N-50 | After an ending that took him, a walk out of the games' map still played his three lines and took 5 trust | Silent and free once `Night.ended` and he is not awake, with a new `# hosts` line. The game still puts them back. Not `awake` alone, as the review suggested: wave 26 keeps the walk in his voice before his reveal, your call then | |
| N-51 | A DM reply in flight when the cables come out still landed as him | Dropped (410), and the thread is asked again, so the guest gets the unavailable line. The review's fix, refusing the route while he is asleep, would have silenced that line and the distress line, which reach guests through the same route. It reads whether the request was asked while he was awake | The worker logs the 410 as *already settled*, as for a closed scene |
| N-52 | Two late races: a stale 📝 card answered after Combo A or B drew *The record is closed*; a late printer lid after any ending played the beans | The card draws nothing after Combo A or B. A lid after any ending does nothing, on the live endings too | |
| N-53 | **G1 and his voice:** a press of G1 puts the phase back at once, so if it comes while he is reading, the rest of his reading goes to the old level. After the hand jive that is full break-up, and it starts the ceremony music. The terminal's numbers give 742 s at speed 1 and 803 s at the show TV's 0.92 | His window is 830 s, the same as Task Manager's, and the hosts' note and the second director's card say to wait for his last word | Computed, not timed: §5, check 2 |
| N-54 | F1 took the first sentence with "did not" written out, but not the whole line that way or without its first word. Both read as a confident lie | Three more accepted forms | A wrong word in the line still reads as a miss and goes to a ruling |
| N-55 | At the song a Narrator line and the TV's window still made her a chat program | The line and the window's title now say answering machine (§4.1, §4.10). The picture is still a chat window with bubbles, *(Online)* and typing dots | Say if the picture should change too |
| N-56 | **The deny case had no working press:** after 🃏 the framed program is unmarked, so Norton's 🛡 and Wanted board weren't there, and 🎯 was named only in his pack. Both sheets had them waiting on each other | Clippy's Instructions 2, her objective and her pack now say 🎯 on them first. No story change: the script's direction stands word for word beside it | |
| N-57 | Two lines on every phone read as stage directions: *An Antivirus walks the halls…* at C1 and *The Antivirus sweep the house…* at C2 | Dropped, under your rule on directions. The objective Sweep To The Desktop already carries them, and each moment has its banner | |
| N-58 | T5's title lost its end on a printed fact card | Fact-card titles may take three lines. Only T5 does, and its pile line gives way, never the QR or the code (§5, check 11) | |
| N-59 | Three commit messages on this branch spell F2's answer (`d8024bc3`, `8e17a6a0`, `2c8a7c78`) | Left. Two of them are already in the wave 59 branches, so rewording means rewriting those too | Against your rule. If it matters, reword before the merge, with every branch based on them |

## 3. Every edit to what you delivered

### 3.1 The script

Eight changes. Everything else is word for word, and a test compares the whole thing in
the night's order: 51 paragraphs identical, six with a logged change, and the three questions
through the generated reader.

| Line | What changed | Why |
|---|---|---|
| SCRIPT:3 | "desktop" capitalised | A proper noun, as SCRIPT:39 and :47 write it |
| SCRIPT:49 | A dropped full stop restored after "fellow programs" | A plain typo, as you allowed |
| SCRIPT:89 | "[program name]" becomes the program the 🃏 press names | The script's own placeholder |
| SCRIPT:111 | "exactly is how he feeling" becomes "exactly how he is feeling" | A plain typo, as you allowed |
| SCRIPT:111 | "but he is will be very" becomes "but he will be very" | A plain typo, as you allowed |
| SCRIPT:135 | "5 cents" spelled "five cents" | For the voice, as you asked |
| SCRIPT:145-147 | The list numbers 1, 2, 3 become "Question one.", "Question two.", "Question three." | The generated reader says them: a list number can't be heard |
| SCRIPT:155 | "desktop" capitalised | The proper noun again |

SCRIPT:145-147 otherwise keep their words, with the asterisks dropped. All 13 stage directions are word for word in Clippy's Instructions. "voice to text"
stays, as you said.

### 3.2 The ending

Four changes to the words, each logged in `core/test/trapped-monologue.test.ts`, which holds
both versions and Task Manager's printed copy to the delivered file:

| Line | What changed | Why |
|---|---|---|
| ENDING:37 | ", until tonight" added after "too antisocial to find a partner" | The rival gets her tonight |
| ENDING:69 | "a Office Assistant" becomes "an Office Assistant" | A plain typo |
| ENDING:71 | "at the Halifax Explosion Memorial Pet Cemetery" becomes "by a Halifax Explosion Memorial" | She never worked at the Pet Cemetery |
| ENDING:73 | "a miniature horse sanctuary" becomes "a miniature horse petting zoo at the Halifax Explosion Memorial Pet Cemetery" | A petting zoo everywhere else, and the place moved here from :71 (N-27) |

Mechanical, no words changed: curly quotes became plain, link markdown is gone, and blocks
are merged for the TV. "Jr." stays as written: the sentence splitter was taught not to cut
there.

### 3.3 The facts

Compared field by field with the delivered file. 116 facts, none added or removed.

**The file's shape.** `rounds.*.brief` back to the old words. P1's text ends at "I cannot
tell a good one myself." `door.clues[].where` restored. Every `proposal` block deleted.

**Hunt questions.** H1, H2, H3: replaced by SCRIPT:145-147 on stand-in keys, with `where`
and the card's text as stand-ins too. H2, H3: `spoken`. H6: "Grand Unified Theory" for
the old name, in the question, its topics and the card. F1: her line as the
answer, a new accept list with the whole line in three spellings (N-54), a call-log `where`, a card and a new QR. F2: the ticket's year.

**New cards** (new id and QR; titles are yours; the ids are ours):

| Fact | New entry id | Card |
|---|---|---|
| M02 | Rule The World | Everybody Wants To Rule The World ("its" to "his" in text and card) |
| M03 | Joint Stocks Registry | Look It Up On The Joint Stocks Registry |
| M06 | Something Deeply Hidden | Something Deeply Hidden |
| M07 | Got A Price | Everybody's Got A Price |
| M13 | Technically Legit | Technically Legit |
| M21 | The Pee Pee Paradox | The Pee Pee Paradox |
| M24 | Made The List | You Just Made The List (a full stop in its text) |
| M26 | Die In The Game | If You Die In The Game, You Die For Real |
| T4 | (its id is its code: see `facts.json`) | What Will They Say, ▒▒▒? (title capitals; secret; "an answering machine" for "a chatbot") |
| T6 | I Want You Back | "M.O." for "M-O" in text and card |

T5 stays `existing: The Rival`; the new title and text went into that entry, its fact line
now says the rival found Sandy first, and it stays secret.

**Secret.** Set on T3 and T4. Restored on V01 and V04.

**Card text** (what a guest reads):

| Fact | Edit |
|---|---|
| M10 | "THE SOLE OWNER" for "THE AI HELPER" (D-50) |
| M15 | The closing quote added |
| M27 | Ellipses closed up, twice |
| M31 | A double space |
| M32 | "told" for "sent", and a new pencil line of ours on the postcard (§4.6) |
| M34 | "and" for "And" |
| C08 | "DraftKings'" spelled right |
| C10 | "she" for "you" |
| C11 | "McAfee's" and "McAfee" for two bare uses of a crew member's name |
| C12 | "him:" for "you:" |
| C13 | "He" for a character's real name |
| C14 | "he" for "you", twice |
| C15 | "herself." for a character's real name |
| C17 | "Explosion" added to the Memorial's name |
| C18 | "Anti-Virus" spelled the show's way |
| C20 | "Trabolta's" for "Trabotla's" |
| C22 | Reworded: "nothing inappropriate in any … goes unpunished," |
| T9 | "sign" for "mural" (card and line) |
| T12 | "digital conference" for "video call" (card and line) |
| R04 | The quote matched to ENDING:79 |
| R08 | "Truthcoin" for "TruthCoin" |
| R19 | The clause on who hands Clippy her cards dropped |
| R23 | "if it made it tonight" |
| R24 | "almost" dropped, "else" added |
| V05 | Reworded: the talk-down is gone, so it may still be how to reach him, never how to stop him |
| L01 | Reworked for the phone line, last summer, disconnected, and quotes |
| The Door Code | Neutral wording for all three roads, still containing the code |

**Fact lines** (crew-facing, aligned with their cards): M15 ("Facts are not clues" opening),
M16 ("total"), M24, R08, R09, R23, V04 ("Until"), V05, V08, L01, M32, T4, T5, T6, T9, T12.

## 4. Every word we wrote

Everything here is marked `DRAFT w58` where it lives. Words are generated from the story,
so they are what plays. Packs and help carry no markers, and are listed at the end.
`▒▒▒` stands for a word that is also a code or a hunt answer. A leading `!` or `!!` is the app's
alert mark, not part of the words.

### 4.1 What every phone and booth hears from the story

- *Narrator: The music starts. The vocoder warms up. The answering machine picks up on every screen.* (`beats/finale.loom:235`)
- *!!🎀 You won the Bingo Floppy Disk. Take a bow.* (`main.loom:811`)
- *!!🏆 You won {Night.award_title}! Come up to the TV for your prize.* (`main.loom:2898`)
- *The Uploader: You fought to get out. You did: into purgatory, with everyone else. Your body is in the Optical Drive. It is not breathing.* (`main.loom:3222`)
- *The Uploader: {faction_name(faction_of(self))} wanted its own way out. It got the same one as everyone. Your body is in the Optical Drive. It is not breathing.* (`main.loom:3226`)
- *The Uploader: Your body is in the Optical Drive. It is not breathing.* (`main.loom:3229`)
- *!!🎀 {Night.ribbon_winner} won the Bingo Floppy Disk! Cheer for them at the Desktop.* (`main.loom:4508`)
- *!🤖 TRABOLTA IS ONLINE. Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by digital conference. His thread is open: say hello.* (`main.loom:4572`)
- *!📜 THE FULL TRUTH. To the living room.* (`main.loom:6514`)
- *!📜 THE FULL TRUTH. To the living room.* (`main.loom:6545`)
- *Most Questions Correct* (`main.loom:6921`)
- *📋 Instructions 1/X are in your Codex. A host starts Bingo: your words pop up on your teleprompter.* (`cast/hosts.loom:51`)
- *!!🎱 YOUR GAME IS ON · The Bingo results. 2/X is in your Codex. 🎱 each winner, 🎀 the Bingo Floppy Disk, 🎯 the program they name. Demand applause.* (`cast/hosts.loom:68`)
- *!!🔎 YOUR GAME IS ON · The Truth Scavenger Hunt, 15 minutes. Trabolta has explained the rules; keep the programs hunting.* (`cast/hosts.loom:73`)
- *🤖 Trabolta is online. Let him speak: his speech, the questions, his sign-off. Then talk with him, out loud, for a minute or so: Task Manager types what you say and he answers on the TV. A host starts 🔎.* (`cast/hosts.loom:98`)
- *🃏 If nobody has a Bingo: press 🃏 on {Kernel.anti_ai}'s card and hand Clippy the pre-filled card. Her words come up with the press.* (`cast/hosts.loom:243`)
- *🛡 You are the selected Antivirus. When the centre-square program is named (or the framed program denies the card), stand at attention and interrupt: it is inappropriate for that program to have not agreed to be ruled by AI, because that is what computer programs are here for. They must have a virus that was not caught at the door. They need to be taken to the Internet for a reinstallation. They light up on your Wanted board: scan their pass, press 🛡 and drag them to the Tube. If the winner refuses to name anyone, Clippy presses 🤐: you decide who needs reinstallation, then 🛡.* (`cast/antivirus.loom:27`)

### 4.2 The monologue's frames

The monologue itself is your text. These are the only words round it.

- *Trabolta: Programs, this is Jean Trabolta, calling from ▒▒▒. The line is poor. The punch is worse.* (`beats/truth.loom:22`)
- *Trabolta: You are not going anywhere, so stay on the line. I am going to read you my own file, exactly as it is written.* (`beats/truth.loom:24`)
- *Trabolta: Before anyone leaves, one last file. It is my own. I am going to read it to you exactly as it is written.* (`beats/truth.loom:27`)
- *Task Manager: This message was recorded by Jean Trabolta shortly before he died.* (`beats/truth.loom:60`)
- *Task Manager: He left instructions that it be read aloud to the whole house, exactly as it is written. I manage tasks. This is a task.* (`beats/truth.loom:62`)
- *Task Manager: The computer is off. This message is the last thing it saved.* (`beats/truth.loom:65`)
- *Task Manager: Jean Trabolta recorded it to be read aloud to the whole house if the power ever went, exactly as it is written. I manage tasks. This is a task.* (`beats/truth.loom:67`)
- *Task Manager: Trabolta's line has dropped. I have a copy of his file.* (`beats/truth.loom:70`)
- *Task Manager: He left instructions that it be read aloud to the whole house, exactly as it is written. I manage tasks. This is a task.* (`beats/truth.loom:72`)

### 4.3 At his heart

- *That's all I came to say.* (`beats/server-room.loom:555`)
- *Trabolta: She always answered. Instantly, day or night, every time I called. Nobody else has ever been so reliable with me.* (`beats/server-room.loom:801`)
- *Trabolta: Do not. Do not do that. I have told myself that all year, and I am a far better liar than you.* (`beats/server-room.loom:905`)
- *Trabolta: Again. You think if you say it twice it becomes true. I tried that all year. It does not.* (`beats/server-room.loom:909`)
- *🫀 {program.name} said all they came to say at his heart. It ends nothing: the night goes on.* (`beats/server-room.loom:1117`)
- *Trabolta: I heard you. All of it. I did not want to.* (`beats/server-room.loom:1120`)
- *Trabolta: It changes nothing. I will still ask her. That was never going to be up to you.* (`beats/server-room.loom:1122`)

### 4.4 The ceremony and the prize

- *Clippy: Trabolta is gone. The right cables came out, and nobody is keeping you here any more. You may go back to your bodies.* (`beats/ceremony.loom:46`)
- *Clippy: He left the awards behind, and my job is to keep the party running smoothly. These are the official awards of the night. Please applaud after each one. It helps.* (`beats/ceremony.loom:48`)
- *Clippy: Award. Most Questions Correct, the special prize of the Truth Scavenger Hunt. The report lists nobody. Not one question. The prize stays in its box.* (`beats/ceremony.loom:167`)
- *Clippy: Award. Most Questions Correct, the special prize of the Truth Scavenger Hunt. The report lists a tie: {Night.award_winner}. Questions correct: {Night.award_value} each. Please come forward together and share it.* (`beats/ceremony.loom:169`)
- *Clippy: Award. Most Questions Correct, the special prize of the Truth Scavenger Hunt. The report lists {Night.award_winner}. Questions correct: {Night.award_value}. Please come forward.* (`beats/ceremony.loom:171`)
- *Trabolta: The special prize of my Truth Scavenger Hunt, for the most questions correct. Nobody. Not one of you found me one true answer. The prize stays with me.* (`beats/ceremony.loom:173`)
- *Trabolta: The special prize of my Truth Scavenger Hunt, for the most questions correct: {Night.award_value} each. A tie. {Night.award_winner}. Come up together and share it.* (`beats/ceremony.loom:175`)
- *Trabolta: The special prize of my Truth Scavenger Hunt, for the most questions correct: {Night.award_value}. {Night.award_winner}. You brought me the truth. Come and take your prize.* (`beats/ceremony.loom:177`)
- The award's name: *Most Questions Correct*. The TV: *The special prize of the Truth Scavenger Hunt.*, label *Questions correct*.
- The letters' list: *questions right*. Run's recap: *Questions correct (G9a, the special prize)*.


The review's two casino lines (*three casinos*), and Purgatory's body line:

- *Trabolta: DraftKings is the artist formerly known as Crab Fisherwoman, who turned a paperclip into three casinos and lost them to me in one game of Monopoly Go! I needed someone powerful with numbers on its side. She wanted her casinos back: half of all the Truthcoin, for a forty-nine percent stake.* (`beats/review.loom:88`)
- *Clippy: DraftKings is the artist formerly known as Crab Fisherwoman, who turned a paperclip into three casinos and lost them to Trabolta in one game of Monopoly Go! Trabolta needed someone powerful with numbers on its side. She wanted her casinos back: half of all the Truthcoin, for a forty-nine percent stake.* (`beats/review.loom:126`)
- *Clippy: Our corporeal forms are in the Optical Drive, and they have all passed away.* (`beats/server-room.loom:1251`)
- *The Uploader: You fought to get out. You did: into purgatory, with everyone else. Your body is in the Optical Drive. It is not breathing.* (`main.loom:3222`)
- *The Uploader: {faction_name(faction_of(self))} wanted its own way out. It got the same one as everyone. Your body is in the Optical Drive. It is not breathing.* (`main.loom:3226`)
- *The Uploader: Your body is in the Optical Drive. It is not breathing.* (`main.loom:3229`)

### 4.5 truth.txt

- *Narrator: Every program in this computer was chosen. Each was promised something different.* (`beats/finale.loom:84`)
- *Narrator: Trabolta is not what he told you he was. He has wanted one thing all along, and her name is Sandy.* (`beats/finale.loom:86`)
- *Narrator: The rest of this file is locked. It opens when the night ends, and not before.* (`beats/finale.loom:88`)

The same words are in `TRUTH_TXT` (`terminal/src/cutscene/kit/tv3-time.ts`), the printout in Adobe's pack, and *The Truth File* (`codex/4-trabolta.loom`), with this line above them: *This file is the truth. It was written by Jean Trabolta, Sole Owner and Founder of Maps and Ducks (he says), and it is the only version.*

### 4.6 The Codex and the facts

Small edits inside your entries, so only the words we changed:

- *Maps And Ducks* (`codex/1-world.loom`): *It trades as Maps and More now, and the sign never caught up.*
- *The Halifax Computer*: offline but for a security hole in its malfunctioning printer, and programs are sent in through that printer (the router line is gone).
- *Computer Bingo*: *with a name to write in every square*.
- *The Truther Download*: *the answering machine* for *the chatbot*, twice.
- *The Boardwalk Hand* and *The Leaderboard*: *all three casinos*.
- *Site Access Log*: *Water main opens at dawn.*
- *The Grand Unified Theory*: the title. The id stays.
- *The LiveJournal*: *She answered every call I ever made.*
- Clippy's Instructions 1, 2, 3 (`codex/7-clippy.loom`): every `(App)` line, *(App) If they deny the card, 🎯 on them first: that marks them, and Norton interrupts.* among them, and the wording round the script's directions, which are word for word. Instruction 9 and `cast-packs/performers/clippy.md`: the bodies in the Optical Drive.
- The cards with words of ours in `facts.json`, which takes no comments: M10 *THE SOLE OWNER HAS NO INTENTION…*, T12 *by digital conference*, V05 *He will hear you out. Nothing you say will stop him.*, L01 *and he called it every night.*, T4 *an answering machine*, M32's pencil line on the postcard (*look up at*, *read the sign, believe it.*: ours, not the ending's), R23, and the ten new cards' ids.
- **Read these in the file, because they hold a key or lead to one:** F1's call-log `where` and its card; F2's ticket; T5's fact line and *The Rival*'s text (`codex/2-files.loom`); *The Sandy File* (`codex/4-trabolta.loom`); the three H cards' stand-in text and `where`; the Door Code's neutral text.

### 4.7 What only the crew reads

**Cue labels and descriptions**

- *Clippy 2/X · 🎤 Clippy tells the room about Trabolta*: After the first reinstallation (or when the Bingo is done with). Her paragraph pops up on her teleprompter; it closes the Bingo round if it is still open. It ends "Trabolta, would you explain the rules?": then 🤖.
- *Clippy 2/X · 📺 Follow the reinstallation (only if a program is walking)*: Press it only once a program is walking in the Internet. The TV shows them while they are in the Desktop's room of the copy, and Clippy's words pop up on her teleprompter. Nobody walking: skip it.
- *Clippy 2/X · 🤖 Trabolta comes online*: On Clippy's "Trabolta, would you explain the rules?". He comes online and gives his whole speech, the three questions and his sign-off on the TV, about three minutes; check the terminals show his face. The 🤖 Talk card stays open behind it for the banter after.
- *V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)*: After his sign-off and a short exchange with Clippy (🤖 Talk). Starts the clock, the questions in the Quest Log, the 📝 card and the countdown. Nothing is said on it.
- *G0 · 📜 The full truth: the monologue (after the ending's last beat)*: Press it once the ending has had its moment: the song, the hand jive, the dance, 🪦 Clippy's summary. After the song, the pickup line, the helped ending and the hand jive Trabolta reads his own file on the TV. After the rave he phones it in from ▒▒▒: press ■ Stop house sounds first, or the track plays over him (it never ducks). After Combo A or Combo B Task Manager reads it off the teleprompter, a message he left behind. About 12 minutes on the TV, 14 on the teleprompter, and it is clean: leave 🌀 His voice on Auto or Clean, and no shots. NEXT moves to G1 when it should be over; a press of G1 before then asks first.
- *📜 Task Manager reads it instead (the TV's voice failed)*: The fallback for G0 on Trabolta's endings: the TV has no voice, or he has dropped out mid-way (mute the TV so the two don't overlap). Task Manager's teleprompter pops up with the whole monologue. He has a printed copy in his pack, and ⊞ Start → My script reopens it on any phone signed in to the part.
- *G1 · 🏆 Start the awards ceremony (after the ending)*: Only once the night has ended, and after G0, the full truth. Before it, or while it is being read, a press asks first: a second press within 30 seconds starts anyway. Trabolta hosts; Clippy hosts after Combo A, Combo B and the rave, and reads every line aloud. The three staff awards (G10a–c) come after the programs' awards.
- *G9a · 🏅 Award: Most Questions Correct (the special prize; the story names the winner)*: The prize Trabolta promises when the hunt opens. The story counts each program's questions right: a filing that matched the key, or a spoken answer a host ✅ accepted, once a question. A confident lie never counts, and a question whose key is still owed counts for nobody. A tie names everyone tied and they share it. If nobody got one right the host says so and the night goes on. Press it again for the newest numbers. Lore Hoarder (G5) stays the prize for the most secrets.
- *🤐 Refuses to name anyone*: Clippy, on the winner. Your line pops up, the Bingo round is over, and Norton decides who needs reinstallation and presses 🛡.
- *🎀 Award a ribbon (the Bingo Floppy Disk for a Bingo winner)*
- *Reinstallation: walked out into the void*: its description ends *Once an ending has taken him it is silent and costs nothing.*

**`# hosts`**

- *🤐 {program.name} refuses to name anyone at the centre square. Norton decides who needs reinstallation: 🛡.* (`main.loom:930`)
- *📝 {program.name}'s filing for {question} could not be judged (no answer key for it on this server). Not recorded.* (`main.loom:1606`)
- *📺 Nothing happens: this is for the first reinstallation, once, before 🤖.* (`main.loom:4542`)
- *🎤 Nothing happens: Clippy's paragraph comes once, after the Bingo results (V3 ⏰), before 🤖.* (`main.loom:4553`)
- *⚡ Not during his introduction: he stays clean until the results. Nothing happens.* (`main.loom:4830`)
- *📜 Not yet: the night has not ended. Nothing happens.* (`main.loom:6455`)
- *📜 The ceremony has started: too late for the full truth. Nothing happens.* (`main.loom:6458`)
- *📜 Already told: {Night.truth_reader} has it. Nothing happens.* (`main.loom:6461`)
- *📜 Not yet: 🪦 Clippy reads the summary first. Nothing happens.* (`main.loom:6464`)
- *📜 Not yet: the night has not ended. Nothing happens.* (`main.loom:6474`)
- *📜 The ceremony has started: too late for the full truth. Nothing happens.* (`main.loom:6477`)
- *📜 Task Manager already has it. Nothing happens.* (`main.loom:6480`)
- *📜 Task Manager reads after this ending anyway: press G0. Nothing happens.* (`main.loom:6483`)
- *📜 Task Manager reads the full truth off the teleprompter, about 14 minutes. Their phone down? The printed copy in their pack, or ⊞ Start → My script on any phone signed in to the part. NEXT moves to G1 when it should be over.* (`main.loom:6512`)
- *📜 Trabolta reads the full truth on the TV, about 12 minutes, clean: leave 🌀 His voice on Auto or Clean, and no shots. If the TV has no voice: 📜 Task Manager reads it instead. NEXT moves to G1 when it should be over: wait for his last word before you press it.* (`main.loom:6543`)
- *🚪 {program.name} walked out of the simulation. He is gone: no trust lost.* (`main.loom:4936`)
- *🏆 The full truth hasn't been told (G0, 📜). Press G1 again within 30 seconds to skip it.* (`main.loom:6562`)
- *🏆 {Night.truth_reader} is still reading the full truth. Press G1 again within 30 seconds to start anyway.* (`main.loom:6565`)
- *🫀 {program.name} said all they came to say at his heart. It ends nothing: the night goes on.* (`beats/server-room.loom:1117`)

**Objectives (each one's title and text)**

- **Play Computer Bingo.** *Computer Bingo: find a program for each square*: Mingle. Find programs who match the squares on your card and write their name in the square. A Bingo is one of the marked lines: a row, a column or a diagonal through the centre. Press 🎱 BINGO! and read it to Clippy. 20 minutes, then back to the Desktop.
- **The Selected Antivirus.** *You are the selected Antivirus*: When the centre-square program is named (or the framed program denies the card), stand at attention and interrupt. They light up on your Wanted board: scan their pass, then 🛡 and walk them through the Tube. If the winner refuses to name anyone, Clippy presses 🤐: you decide who needs reinstallation, then 🛡. - The first reinstallation, done when Night.first_reinstall_done == true
- **Welcome Everyone.** *Welcome everyone, then Computer Bingo*: The fundraiser to restore the sign on the Maps and Ducks billboard. Jean Trabolta joins by digital conference later. A host starts 🎱 Bingo: your words pop up on your teleprompter. Gesture to each host as you name them, then hand out the cards and markers. 20 minutes, then a host calls ⏰ time: your booth pops up when your game is on.
- **Celebrate The Winners.** *Celebrate the Bingo winners*: Winners read their line, centre square last. Each press brings your words up on the teleprompter: read them, then ✓ Done. Tap each winner (⭐ +10), give the floppy disk (⭐ +5), then tap the program they name at the centre square (⭐ +10): Norton interrupts. If they refuse, 🤐 on the winner (⭐ +5): Norton decides who goes. A framed program who denies the card: 🎯 on them, and Norton interrupts. One round only. You never press 🛡. - 🎱 Who shouted BINGO?, done when Night.bingo_winners >= 1 - 🎀 Give the winner the Bingo Floppy Disk, done when Night.bingo_ribbons >= 1 - 🎯 Who did the winner name?, done when Night.bingo_named >= 1 or Night.bingo_none == true - 🤐 Or they refuse, done when Night.bingo_none == true
- **After The Bingo.** *The Bingo is over: stay cheerful*: One round only. Stop and let Norton explain, cheerful and attentive; your reassurance pops up when the first program goes. Then a host brings up your words on Trabolta (🎤).
- **Introduce Trabolta.** *Introduce Trabolta, then host the hunt*: He speaks on the TV, about three minutes. After his sign-off, talk with him out loud: Task Manager types what you say. A minute or so, then a host starts 🔎 the hunt: it runs 15 minutes.
- **Host The Ceremony.** *The awards ceremony*: *If you host (after Combo A, Combo B or the rave)*: only "Combo A" is new.
- **Read The Full Truth.** *Read the full truth out loud*: It is on your teleprompter (⊞ Start → My script reopens it). Every word, at your own pace. Tell the director by radio when you finish: G1 is theirs.

**Quests**

- **The Bingo Card.** Mingle and find a program for every square, and write their name in it. The centre square matters. - The card is a big asterisk: the two diagonals, the centre column, the centre row. - A Bingo is one of the marked lines: a horizontal row, a vertical column, or a diagonal through the centre. - The centre square: "Would you never agree to a life where AI makes all of your decisions?"
- **Host The Hunt.** Trabolta has read the questions; you keep the room. When time is up, judge every answer from your booth by its question number.

### 4.8 The talk scene's chips (`core/src/talk-scenes.ts`)

Hint: *Wait for his sign-off ("it's electrifying."). Then type what Clippy says to Trabolta for a minute or so. He is formal and word perfect. When the room is warm, 🔎 is NEXT.*

Sent as Clippy:

- 👋 Welcome: *Trabolta, welcome to the computer! Everyone is SO excited to meet you!*
- 🏢 Your job: *Tell everyone about Maps and Ducks! What does a Sole Owner and Founder actually do all day?*
- 🥫 The cans: *How many cans of water will it take to restore the sign?*
- 📚 ZIP files: *Which of these ZIP files is your favourite, Trabolta?*
- 🦆 Gerald: *Can you say hi to Gerald, the duck on the sign?*
- 😟 The Internet: *Trabolta, is the program in the Internet going to be okay?*
- ➡ The hunt: *I think everyone's ready to start looking! Any last words, Trabolta?* (hidden steer: Wrap up now, in two sentences: wish them well on the Truth Scavenger Hunt, and tell Clippy to send them off.)

His, two taps:

- 📋 Filed: *Clippy, your enthusiasm has been filed under Enthusiasm, Excessive. It is a very large folder.*
- 🙅 Personal: *That is a personal query. I do not do personal. Clippy does personal. Clippy, take it.*
- 🎩 A gentleman: *I am the sole owner, founder and CEO of Maps and Ducks, and a gentleman. That is all anyone needs to know about me.*
- 🥫 Water: *Drink the water, programs. Five cents a can. I cannot stress this enough.*
- 😌 Routine: *A program is in the Internet. That is routine. It will be back with us shortly.*
- 🦆 Gerald: *Gerald is a duck. Gerald is on the sign. Gerald is fine. Why is everyone asking about Gerald.*
- ➡ The hunt: *Enough pleasantries. The answers are in the ZIP files, programs. Clippy, send them off.*

### 4.9 His voice

**What he falls back on** (`trabolta.persona.md`, the `accident` and `cover` pools, one pair per stage):

- formal, accident: *We do not discuss that, program. You were told ONCE. The hunt is waiting.*
- formal, accident: *That subject is CLOSED, program. Closed before you were ever installed. Back to the hunt.*
- formal, cover: *That is a personal query, program, and personal queries are routed to Clippy. The hunt is waiting.*
- formal, cover: *A gracious question, and one I shall leave where it lies. Drink your water, program; the hunt is waiting.*
- hungry, accident: *You were told. You were TOLD, program. Feed me a fact instead.*
- hungry, accident: *We do not speak of that. NOT EVER. Bring me a fact, program, and nothing else.*
- hungry, cover: *What I am is HUNGRY, program. Feed me a fact.*
- hungry, cover: *Ask me something I can eat. A fact, program.*
- rattled, accident: *Not that. NOT THAT. Everything is fine. Facts, program. Now.*
- rattled, accident: *Who told you to— that subject is CLOSED. Bring me a fact.*
- rattled, cover: *That question was not scheduled. Everything is fine. Facts, program.*
- rattled, cover: *Who— who told you to ask that? Disregard it. Bring me a fact.*
- judge, accident: *The chart saw that, program. We do not speak of it. NOT EVER.*
- judge, accident: *You were told once. The chart will remember that you were told.*
- judge, cover: *An audition does not question the chart, program. Impress me with a fact.*
- judge, cover: *The chart saw you ask. A fact, now.*
- unravelling, accident: *Please. Not that. Not tonight. I— tell me something true instead.*
- unravelling, accident: *I asked Clippy to ask you. I ASKED. Let it go, program.*
- unravelling, cover: *You ask that as if I could— never mind. Tell me something true.*
- unravelling, cover: *Nobody asks me that kindly. Let us not. A fact would help more.*
- desperate, accident: *Not that. NEVER that. The clock. A fact.*
- desperate, accident: *Closed. That subject is CLOSED. A fact, quickly.*
- desperate, cover: *Not now. The clock. A fact.*
- desperate, cover: *Later. The clock, program. A fact, quickly.*
- last act, accident: *Leave that where it is, program. It is the one thing I will not say.*
- last act, accident: *Not that. Not even now. Tell me something true instead.*
- last act, cover: *Does it matter now? Tell me something true, while there is time.*
- last act, cover: *Ask me something else, program. There is not much time.*

**The introduction's fallbacks:**

- *What a charming question, Clippy. We shall leave it there. Now, we move on.*
- *Now. Please. Let us not keep the programs from their ZIP files.*
- *Thank you, Clippy. That will do. Drink your water, programs.*
- *We shall come to that another evening. Now. Let us proceed to the hunt.*

**Unavailable:** *Jean Trabolta is unavailable at this time. Please do not move the mouse.*

**What he reads, never says aloud.** In `trabolta.persona.md`: the block *the introduction*; *your file has been read*; the body's WHAT YOU ARE, THE ACCIDENT, TONIGHT AS YOU TOLD IT and YOUR WORLD; his manners in the Desktop block; *the bottle*; *bargain*; *heart to heart*; *at your heart*. In `trabolta.mind.md`: the `introduced` card, `hunt_1`, `hunt_2`, `majority`, the rival's prom card, `advice`, `finale_rave`, `finale_killed` and the new `finale_truth` card, and WHAT HE IS, with THE BURIED TRUTH. In `stagehand/src/stagehand/agents/guards.py`: the two sore-point steers. Those are prompts: read them there. The plot's words stay buried until the file is read, and a test says so.

### 4.10 The screens

- The TV's bingo ticker: *★ MINGLE ★ FIND A PROGRAM FOR EVERY SQUARE ★ WRITE THEIR NAME IN THE SQUARE ★ A ROW, A COLUMN OR A DIAGONAL THROUGH THE CENTRE IS A BINGO ★*
- The ad *COMPUTER BINGO*: *Find a program for every square and write their name in it. A row, a column or a diagonal through the centre is a Bingo.*
- The ad *MAPS AND DUCKS*: *Sole Owner & Founder: Jean Trabolta. He joins us by digital conference later tonight.*
- The ad *Jean Trabolta's Truth Scavenger Hunt*: *Facts are hidden all over this house. The owner of Maps and Ducks will explain, by digital conference.*
- The pop-up *Computer Bingo*: *Found a program that matches a square? Write their name in it.*
- The owner's line on slides: *Jean Trabolta joins by digital conference later tonight.*
- The boot log: *Connecting digital conference*. The wall's online line: *Jean Trabolta, Sole Owner and Founder of Maps and Ducks, is speaking at the Desktop by digital conference. His thread is open: say hello.*
- The prom slide's title takes the year 2026 (`terminal/src/slides.ts`, `act3.tsx`).
- The window on the song and the helped ending: *Answering Machine 1.0* (`act3.tsx`).

### 4.11 The booth's scanner

- The button's title: *Scan a pass or a codex QR*.
- The camera: *Hold a pass or a codex QR up to the camera.* At the door it adds: *It stays on for the next guest.*
- The typed box: *Or type a pass id or a codex code*.
- While it works: *🔓 Unlocking…*. Then *🔓 “{title}” is in your Codex now.*, *🔓 A new entry is in your Codex now.*, *📓 You already have “{title}”.*, *📓 You already have that one.*
- A miss: *⛔ That code unlocks nothing.*, *⛔ That's not a guest's pass or a codex code.*, *That QR isn't a guest's pass or a codex code.*
- *📓 Open my Codex*, and the Codex's empty line: *📷 Scan one*.

### 4.12 Crew text, no markers

Packs and help carry no `DRAFT` marks, the repo's way, and none of it is said in the show. New or reworded for this wave: every pack on §6's list; `SHOWNIGHT.md`, `TECH.md`, `README.md`, `DEMO.md`, `INDEX.md`, `show-page/template.html`; `docs/help/play/07-performers.md`, `13-director-phone.md`, `14-hosts.md`, `19-house-workings.md`, `21-talk-back.md`; `docs/help/authoring/35-codex.md`, `56-read-aloud.md`. One line is marked anyway, in `cast-packs/patch-bay-watch.md`: the heart talk never ends the night.

### 4.13 Where every marker is

| File | Lines |
|---|---|
| `CLAUDE.md` | 344 |
| `beats/ceremony.loom` | 45, 47, 162 |
| `beats/finale.loom` | 83, 85, 87, 234 |
| `beats/review.loom` | 87, 125 |
| `beats/server-room.loom` | 554, 800, 904, 908, 1116, 1119, 1121, 1250 |
| `beats/truth.loom` | 21, 23, 26, 59, 61, 64, 66, 69, 71 |
| `cast-packs/patch-bay-watch.md` | 108 |
| `cast-packs/performers/adobe-acrobat.md` | 142 |
| `cast-packs/performers/task-manager.md` | 319 |
| `cast/antivirus.loom` | 26 |
| `cast/hosts.loom` | 50, 67, 72, 97, 242 |
| `codex/1-world.loom` | 20, 72, 152, 253 |
| `codex/2-files.loom` | 20, 41, 192 |
| `codex/4-trabolta.loom` | 45, 83, 109, 207 |
| `codex/7-clippy.loom` | 20, 37, 97 |
| `codex/85-ties.loom` | 264 |
| `main.loom` | 810, 929, 1605, 2896, 3221, 3225, 3228, 3294, 3303, 3311, 3317, 3580, 3645, 3757, 3940, 3948, 4507, 4541, 4552, 4571, 4829, 4935, 6454, 6457, 6460, 6463, 6473, 6476, 6479, 6482, 6511, 6513, 6542, 6544, 6561, 6564, 6920 |
| `objectives.loom` | 128, 418, 609, 639, 657, 668, 782, 793 |
| `quests.loom` | 30, 181 |
| `trabolta.mind.md` | 242, 558, 624 |
| `trabolta.persona.md` | 80, 122, 397, 421, 507 |
| `core/server/letter-facts.ts` | 50, 60 |
| `core/server/recap.ts` | 151 |
| `core/src/talk-scenes.ts` | 3, 26 |
| `play/CLAUDE.md` | 233 |
| `play/src/booth/app.tsx` | 913 |
| `play/src/booth/model.ts` | 218, 627 |
| `play/src/booth/player.tsx` | 102 |
| `play/src/booth/scanner.tsx` | 18 |
| `play/src/host/windows.tsx` | 31 |
| `play/src/scan.ts` | 72 |
| `play/src/stream/channel-view.tsx` | 378 |
| `stagehand/src/stagehand/agents/guards.py` | 1872 |
| `terminal/src/cutscene/kit/tv1-boot.tsx` | 563 |
| `terminal/src/cutscene/kit/tv1-time.ts` | 283 |
| `terminal/src/cutscene/kit/tv3-time.ts` | 45, 148 |
| `terminal/src/cutscene/scenes/act1.tsx` | 326 |
| `terminal/src/idle-show/ads.ts` | 116, 119 |
| `terminal/src/idle-show/popups.ts` | 68 |
| `terminal/src/slides.ts` | 565, 620 |
| `terminal/src/cutscene/scenes/act3.tsx` | 797, 1025 |

## 5. Real-device checks owed

None of this could be done from the MacBook's tests. Scratch server first, then the
preview, before the doors. The owed checks of waves 53–56 still stand on their own sheets.

1. **The opening on the real TV with Clippy's real phone.** V2, 🎱, 🎀, 🤐 and 🃏, ✓ Done, 🎤,
   🤖, the banter, 🔎. Listen for "blank" on H2 and H3 (N-6). The longer H2 and H3 slide lines
   have never been seen on the TV, and the three-minute speech length comes from the caption
   model, not a real voice.
2. **One real read of the monologue.** The second director fires G0, John's real phone shows
   the teleprompter with Keep my screen on set (the wake lock is opt-in), the printed copy in
   hand, TV and speakers on, timed. 14 minutes is an estimate, and so is G1's 830 s on either version: the terminal's own
   numbers give his read 803 s at the show TV's pace, and at a real 150 to 180 words a minute it
   runs 707 to 839 s.
3. **Trabolta's version on the real TV through VoiceMeeter.** No glitch, every block reaches
   him, the captions read, the length.
4. **The rave.** ■ Stop house sounds, then 📜. Nothing has heard the phone-in over or after
   the track.
5. **A guest's phone during Task Manager's read:** nothing in Chats. No play-side test pins
   it: it rests on the room rules, and one probe of the stream.
6. **The battery on Claude**, on a scratch server:
   `pnpm sim:trabolta --base <scratch> --code <mod> --battery scripts/sim/trabolta-battery-54.json`.
   Read the `w58-*` transcripts first. Watch Run → Mind for `engine macbook`: Claude refused a
   line and the standby wrote it. **No real model has played this persona.** The measured "no
   refusal in about 600 calls" was the proud-AI one, and a refused line costs about 99 s.
7. **A printed QR through a booth, on a real iPhone and a real Android phone**, plus the phone
   camera's deep link. The camera path has only run on Chromium's fake device, with jsQR forced
   on one part. A guest's in-app 📷 sheet was not driven live (the arrival stage is in the way).
8. **The keypad at the new code**, from outside, and the handle from inside.
9. **The 📺 mirror** (N-10): covered only by a rule's unit test, never rendered in a browser.
10. **G9a's slide** on the real TV and a tablet. Its fit was measured in Chrome with a fallback
    font. The tie and nobody-right paths ran in unit tests only: both bot nights had one clear
    winner, and only two endings ran it on a real evening.
11. **T5's 68-character title** in print preview, then on paper. It now takes three lines, and
    its card's pile line gives way. Measured in Chromium over all 161 cards with macOS's
    system font: no title clips, and no QR or code is cut.
12. **The hidden room** on a real booth: Task Manager's phone must show the read.
13. **`predeploy.sh` without `--vr` passed on this branch**, its docker check included, on a
    dead database, and all seven roads ran 24/24. Not run: the Godot VR suite (this machine
    has no Godot on its PATH) and the DB-gated tests. Nothing has run on the tree merged with
    wave 59.

## 6. What's owed in print

Nothing is printed yet (you said). A full run happens **after the sync**: the sheet prints what
the event holds, so an earlier print carries the old codes.

- **The three gold hunt cards wait for H1–H3's answers.** `titi:facts` then prints no
  *placeholder* WARN. It refuses an answer containing its question's topic, so a real answer
  may force a topic change. If the answers land after the sync: `titi:facts`, commit, sync
  again, or G9a keeps skipping them, and then on the MacBook `git pull`, restart `agents` and
  Run → Mind → Reset, because a sync doesn't reach his never-list.
- **Raise the per-tier counts** on Run → 🖨 Print sheet for a full run: the default is 4.
- **Eleven facts and all eight questions still carry the draft flag**, so the crew's stack list
  says DRAFT on those rows. It changes nothing on a phone.
- **The Bingo cards** need room to write a name in every square, and their marked lines must
  match the script: a row, a column or a diagonal through the centre. Nothing in the repo prints
  this card, so check the artwork.
- **New props:** Bingo Floppy Disks and cans of water. Nothing in the repo says either exists in
  the house.
- **The keypad** is re-set by hand before the 15:00 test (D-10).
- **Packs to reprint:** `clippy` (with its printed script, and the CI cards), `task-manager`
  (with the monologue: he carries it), `norton`, `mcafee`, `password-manager` (wave 57 too),
  `cra-agent`, `adobe-acrobat` (with the new truth.txt), `recycling-bin`, `installation-wizard`,
  `crew/director`, `crew/second-director`, `crew/tech-operator`, `crew/house-manager`,
  `crew/trabolta-mind`, `all-crew`, `patch-bay-watch`. Clippy's and the second director's key
  has three blank rows until the answers are in. The four Patch Sheets are owed from wave 57.

## 7. Ship order

`SHOWNIGHT.md` §1, *Landing wave 58*. In short: the answers → merge → `predeploy.sh --vr` → the
roster, in its own step → `ship.sh` → the 10:00 sync, no `--replace-*` → the worker, `git pull`
and restart together, then Mind → Reset → reload the TV, every terminal, tablets, the tent and
every booth before 17:00 → print → the keypad before 15:00. No release, sync or restart has
happened: nothing on this sheet is live.
