# SIGNOFF — wave 26 show text (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 26 is the last big
pass before the show: the first glitch on every screen and phone, the locked
phone for a program being reinstalled, a guest's BINGO, the void, the heart
and the virus in the reinstallation games, voice-timed cutscenes, and no
hints in the show text. Every new or changed show line is marked
`// DRAFT w26 (<note>)` in the source. The contract is
`docs/loom-w26-contract.md`; the notes' ids (G1, B1–B5, R1–R8, T1–T3,
V1–V3, P1–P2, D1) are its §1.

Your words, verbatim (the rehearsal notes, 2026-10-26):

> GENERAL:
> There should be no “hints” about how the world / games work – saying “Wrong or not sure, or a clear guess: a symptom of corruption” during the first moment of truth terminal screen is wrong. And a lot of the help system greatly overshares the “real world mechanics” of the show.
> BINGO:
> There should be a button for guests to press when they get a BINGO so they can fast-forward the cue
> If they don’t actually have a BINGO Clippy or hosts can reset to before the BINGO was called (if BINGO was called with 5 mins left, then there is 5 mins left on the clock)
> There is currently no option to the BINGO winner NOT to name anybody, which needs to be able to happen
> The BINGO winner should also be able to be the one who doesn’t like AI – Clippy currently must select someone else.
> There is only one round of computer bingo; Clippy’s selection window should close after the end of BINGO
> REINSTALLATION:
> Currently guests are presented with “Go to the Internet” “Show my pass” and “OK” when they are caught by an AntiVirus – these shouldn’t be options – only “Show My Pass” and “Bathroom Mode” should be accessible to guests who are being reinstalled
> In the game, the path to Gerald shouldn’t be shown until the guest has been in the game for over a minute
> Remove the King’s health bar from the HUD – the health bar can stay above the character, however.
> I have included a way out of the house in the games through the mudroom – if a player leaves the house and ventures into the void far enough (5 meters?) there should be a big jump scare where you are then teleported back to the tent (in game) – Trabolta chimes in to chastise you for trying to escape and you lose some trust.
> Right now the real-world terminals show the “internet” whenever somebody is inside it being reinstalled – they should only show the internet when somebody is in the same room as a tablet (ie: if someone is in the kitchen in game, only the kitchen tablet will transmit audio/video to/from the internet – if there are multiple people being reinstalled than you can transmit whichever rooms are occupied.)
> If you kill the King in game and enter the server room (in the reinstallation game) you will be able to see Trabolta’s heart and have him talk to you a bit
> Make sure that Microsoft Excel can finish his quest by finding a virus in the reinstallation game and bringing it back to the “real world”
> There is no audio in the VR game, nor have I found a way to “un-mute” the mic in VR – at least that’s what the game currently says.
> TERMINALS:
> Currently, the rate of ads is just too much; up to the first glitch in the system, the terminals should be showing ads at a much, much lower rate.
> When the glitch happens *everything* should be affected, including guests and performers phones – this should be quite the disruptive event.
> The reinstallation tent terminal should have a fairly minimal UI that focuses on the scanning / entering of the codes – the ads and screensaver should be secondary (but still existing)
> TRABOLTA:
> Trabolta’s speech doesn’t often match the timing of the cutscenes; these should appear synced.
> Trabolta has very little pauses between lines, which makes the speech hard to understand sometimes.
> Trabolta says “Antivirus” in a funny way – perhaps if we spell it “Anti-Virus” or “Anti Virus”, that would be much more legible.
> PLAY APP:
> When filing a fact / answering a question in general, the UI gets extremely squished - the chat room part is totally hidden and it makes it strange to navigate. The dialogue selection box sits on top of the text enter / Send button area, which is confusing.
> The bottom bar for the performers is also quite squished – it should be pretty much the same as the guests, which is sized well.
> TRUTH OR DARE:
> When guests select “dare”, Trabolta should make a scene and tell the Anti Viruses to bring them to the internet.

And your answers to the four questions: the first glitch is **the ad
hijack 📺**; a reinstalled guest's phone is **locked, DMs included** (*"Lock
the phone -- DMs will not work."*); "Antivirus" changes in **the voice only**;
an escape into the void is **always Trabolta and −5 trust**, even before his
reveal.

**Where it is built.** Stage A (on master): the house lane (the void, presence
rooms, the heart and pickup props) and the engine lane (`lock:`, `ack: none`,
the glitch wire, the game-only beats). Stage B: this page is the **story
lane** (`oct31-w26/story`); the spatial, play, terminal, voice, web, vr and
help lanes write the rest. Not merged to master, not shipped.

## 1. Decisions the story lane took for you (vetoable)

| # | Decision | What it means on the night |
|---|---|---|
| S-1 | **A guest's 🎱 BINGO! fires ⏰ itself** (the contract's B1) | Two taps on Play Computer Bingo; the whole house goes to the results at once. One call at a time: a second press does nothing until an undo. |
| S-2 | **↩ Not a Bingo**: Clippy, a host or a director, only before any 🎱 / 🎯 / 🤐 | The countdown comes back at exactly the seconds left; a call after time-up comes back with no clock and the hosts call ⏰ again. The cast briefs and the Bingo Time scene play only once all night. |
| S-3 | **🤐 pays Clippy ⭐ +5** and marks nobody | With nobody named Norton's *The Selected Antivirus* completes on its own (*"Nobody was named. Patrol the Tube."*). |
| S-4 | **One round** closes at the first 🎯, the first 🤐, a capture during the results, or 🤖 | The Bingo Card and Run The Bingo now complete there, not at ⏰ (so an undo never has to reopen a finished quest). Several 🎱 are still fine before it closes. |
| S-5 | **Task Manager gets his own NOW for a guest's call** (*A Program Called Bingo*, ↩ on the caller), in place of ↩ on The Fake Bingo Card | A button on a NOW card must be live on someone's card; ↩ is only live after a guest's call. |
| S-6 | **A Dare**: each path tells the house as before, then one `dare_taken` marks, sends the dared phone *🎩 Trabolta is not amused…* (only the pass) and plays *Dare Chosen* | The house line stays word for word where the terminal test reads it. |
| S-7 | **The heart's monologue** says nothing about doors, codes, cables, layers or her name | It is flavour; the real heart talk is untouched. |
| S-8 | **The virus disk is anyone's**, the tent QR's entry; only Excel's plant counts for his quest | The tent QRs stay as the backup; the director pack says to hand Excel the entry from Run if a headset is down. |
| S-9 | **Clippy's PLAYER SELECT has four steps** (① 🎱 ② 🎀 ③ 🎯 ④ 🤐) | The story lint L1208 warns at four buttons on one objective (*the apps show at most 3*); the picker is not a card face, so the warning stays until the lint learns that. |

## 2. Every changed show line, old → new

**The locked phone (R1), `main.loom`, `objectives.loom`, `beats/internet.loom`**

| path:line | Where | Was | Now |
|---|---|---|---|
| `main.loom:33` | the header | — | `lock: program.corrupted == true and Night.banish != true and Night.ended != true` |
| `main.loom:589` | the capture (big moment) | *🌐 Sent to the Internet. Go out back …* · *Go to The Internet* · *Show my pass* · OK | the same words · **🎟 Show my pass** · **🚻 Bathroom Mode** · no OK |
| `main.loom:1284` | CORRUPTION DETECTED (big moment) | *🛡 CORRUPTION DETECTED. {hunter} has found you. Stay with them: you are going to the Internet.* · *What do I do?* · OK | the same words · **🎟 Show my pass** · **🚻 Bathroom Mode** · no OK |
| `objectives.loom:77` | Find Gerald | *…walk the copy of the house: follow the golden arrows to Gerald…* · `go: The Internet` · pass | *…walk the copy of the house to find Gerald…* · no `go:` · pass, Bathroom Mode, Back from the bathroom |
| `beats/internet.loom:45` | The Tablet Video, a corrupted program | a menu: *"Where is the exit?"* / *Put the headset on.* / *Take the tablet.* | no menu: *The exit is clearly marked, behind you. It is for safety. It is not the way out. Gerald is the way out.* |
| `beats/internet.loom:47` | The Tablet Video | *Loading a copy of this house. Every screen in the house can see you now. Wave.* (R5: no longer true) | *Loading a copy of this house. The screens in the room you walk into can see you. Wave.* |
| `codex/1-world.loom:123` | The Reinstallation Protocol (codex, a captured guest) | *…Every screen on the walls shows it wandering, including the TV.* (R5: no longer true) | *…The screens in the room it walks into show it wandering.* |

**A guest's BINGO, the undo, 🤐, one round (B1–B5)**

| path:line | Where | Was | Now |
|---|---|---|---|
| `main.loom` INTERACTION `call_bingo` | the guest's button | — | **🎱 BINGO!** · *A full line through the centre square. Tell everyone, then read it to Clippy.* |
| `main.loom:720` | the caller's phone (big) | — | *🎱 You called BINGO! Go to Clippy at the Desktop and read your line, centre square last.* · 🎱 To the Desktop |
| `main.loom:4108` | every phone, a guest called it | (the host's ⏰ line) | *!⏰ BINGO! {caller} called it. Back to the Desktop to hear the line.* (a host's ⏰ keeps *BINGO TIME. Back to the Desktop: got a line? Read it to Clippy.*) |
| `main.loom:4101` | Run The Bingo (Clippy's quest) at ⏰ | completed: *Winners celebrated. Norton takes it from here.* | updated: *The results: check each line, centre square last.* (it completes when the round closes) |
| `main.loom` INTERACTION `not_a_bingo` | Clippy's and the hosts' button | — | **↩ Not a Bingo: back to the game** · *The caller's line doesn't hold. Bingo picks up with the time it had left (none if it was already up: then call ⏰ as usual).* |
| `main.loom:753` | every phone, the undo | — | *!↩ Not a Bingo yet. Back to your cards.* · the Bingo Card |
| `main.loom:755` | the caller | — | *🎱 Not quite a line yet. Keep looking.* |
| `main.loom:751` | Run The Bingo, the undo | — | *Not a Bingo yet. Back to the cards.* |
| `main.loom:764–770` | # hosts | — | *↩ {who} pressed Not a Bingo for {name}. Bingo is back on: the clock picks up where it stopped.* / *…Bingo is back on; its time was already up: call ⏰ when the room is ready.* (*The Director* for a director's quick-fire) |
| `main.loom` INTERACTION `named_nobody` | Clippy's button | — | **🤐 Names nobody at the centre square** · *Clippy, on the winner. Nobody is marked, and the Bingo round is over.* |
| `main.loom:783` | # hosts | — | *🤐 {name} names nobody at the centre square. Nobody is marked.* |
| `main.loom:4128` | The Selected Antivirus (Norton), nobody named | — | completed: *Nobody was named. Patrol the Tube.* |
| `main.loom:664, 702, 724, 759, 786` | # hosts, a stale press | — | *🎱 Nothing happens: the Bingo round is over, or {name} is already a winner.* · *🎯 Nothing happens: the Bingo round is over.* · *🎱 {name} pressed BINGO, but the call is already in (or Bingo isn't on). Nothing happens.* · *↩ Nothing happens: Not a Bingo works only on the caller, before any 🎱, 🎯 or 🤐.* · *🤐 Nothing happens: only on a winner, before the round is over.* |
| `main.loom` INTERACTION `bingo_time` | the cue's description | *Clippy's game is on (Instructions 2/X). Norton is the selected Antivirus.* | …*A guest's 🎱 BINGO! presses it for you; after a ↩ Not a Bingo it is NEXT again.* |
| `main.loom` INTERACTION `bingo_winner` | the description | *Clippy, at the Bingo results. Several winners are fine.* | *…Several winners are fine, until the centre square is answered.* |
| `objectives.loom:144` | Play Computer Bingo (guests) | *…A Bingo is one full line through the centre. 20 minutes, then back to the Desktop.* | *…A Bingo is one full line through the centre: press 🎱 BINGO! and read it to Clippy. 20 minutes, then back to the Desktop.* · button 🎱 |
| `objectives.loom:661–664` | **Check The Bingo** (Clippy, new) | — | *A program called BINGO: check their line* · *They pressed BINGO on their phone. Hear their line, centre square last. It holds: 🎱 (⭐ +10). It doesn't: ↩ Not a Bingo, and Bingo picks up with the time it had left.* · 🎱 ↩ |
| `objectives.loom:681–686` | Celebrate The Winners | *…then tap the program they name at the centre square (⭐ +10): Norton interrupts. You never press 🛡.* · four to-dos (the last *The first reinstallation*) | *…Norton interrupts. If they name nobody, 🤐 on the winner (⭐ +5). One round only. You never press 🛡.* · 🎱 🎀 🎯 (*done when named or nobody*) 🤐 *Or they name nobody* · buttons 🎱 🎀 🎯 🤐 |
| `objectives.loom:695–697` | **After The Bingo** (Clippy, new) | — | *The Bingo is over: stay cheerful* · *One round only. Let Norton do his job and reassure everyone; then a host introduces Trabolta.* |
| `objectives.loom:859–862` | **A Program Called Bingo** (Task Manager, new) | — | *A program called BINGO: does the line hold?* · *They pressed BINGO on their phone. If Clippy finds no line, ↩ Not a Bingo on their card: Bingo picks up with the time it had left.* · ↩ |
| `codex/7-clippy.loom:61, 73` | Clippy Instructions 2 | *…Several winners are fine.* | *…A program may call BINGO from their own phone: their card pops up for you. If their line doesn't hold, ↩ Not a Bingo, and Bingo picks up with the time it had left.* · *(App) The winner names nobody: 🤐 on the winner. The winner may even name themselves: 🎯 on their own card. There is only one round: the first 🎯 or 🤐 ends it.* |
| `codex/7-clippy.loom:70–72` | Clippy Instructions 2, the refusal | *If the winner refuses to identify their match, follow the Antivirus's direction about who needs reinstallation.* | *If the winner refuses to identify their match, nobody is reinstalled: press 🤐 (below).* |
| `cast/antivirus.loom:27` | Norton's ⏰ brief | *…When the centre-square program is named (or the winner refuses to name anyone, or the framed program denies the card)…* | *…When the centre-square program is named (or the framed program denies the card)… If the winner names nobody, Clippy presses 🤐: nobody is marked, so follow the room.* |
| `objectives.loom:461` | The Selected Antivirus (Norton) | *When the centre-square program is named (or the winner names nobody, or the framed program denies the card)…* | *When the centre-square program is named (or the framed program denies the card)… If the winner names nobody, Clippy presses 🤐: nobody is marked, so follow the room.* (and the card ends at a 🤐) |
| `main.loom` INTERACTION `frame_for_bingo` | the 🃏 description | *Task Manager, only if nobody has a Bingo.* | *Task Manager, only if nobody has a Bingo, and once a guest's call is settled.* |
| `main.loom:691` | # hosts, a 🃏 during an open call | — | *🃏 Nothing happens: {caller} called BINGO. Clippy checks that line first (🎱 or ↩).* |

**The Dare (D1)**

| path:line | Where | Was | Now |
|---|---|---|---|
| `main.loom:1176` | the dared phone (big) | the soft *🚨 You are marked for reinstallation (chose Dare). Nothing is switched off…* | *!!🎩 Trabolta is not amused. You chose Dare in his computer. The Antivirus are coming for you.* · 🎟 Show my pass · no OK (the soft heads-up no longer plays for a Dare) |
| `cast/kit.loom:396` | every Antivirus booth (WANTED pop-out) | *🚨 {name} is marked for reinstallation (chose Dare). Find them and scan their pass: the scan is the confrontation.* | *🚨 TRABOLTA'S ORDER: take {name} to the Internet NOW. They chose Dare at the Desktop. Find them and scan their pass: the scan is the confrontation.* |
| `beats/hunt.loom:98` | **Dare Chosen** (TV, new) | — | *Trabolta: A dare. {Night.bottle_pick} chose a dare, in my computer.* |
| `beats/hunt.loom:100` | Dare Chosen | — | *Trabolta: Programs do not dare. Programs answer. Everyone, watch closely: this is what a dare costs.* |
| `beats/hunt.loom:102` | Dare Chosen | — | *Trabolta: Antivirus! Take {Night.bottle_pick} to the Internet. Now.* |
| `codex/7-clippy.loom:139` | Clippy Instructions 3, the Dare | *Dare: they are marked for reinstallation for not choosing Truth.* | *…and Trabolta makes a scene on the TV: he orders the Antivirus to take them to the Internet.* |

**The reinstallation games (R4, R6, R7): game-only lines, never on a phone**

| path:line | Where | Was | Now |
|---|---|---|---|
| `beats/internet.loom:79` | **Escape Attempt** (in the game) | — | *Trabolta: There is no outside, {program.name}. There is only my computer.* |
| `beats/internet.loom:81` | Escape Attempt | — | *Trabolta: Programs that wander into the void come back smaller. I have made a note of it.* |
| `beats/internet.loom:83` | Escape Attempt | — | *Trabolta: Back you go. Gerald is waiting.* |
| `beats/internet.loom:91` | **Heart In The Simulation** (in the game) | — | *Trabolta: {program.name}. You found the copy of my heart. I keep a copy of everything.* |
| `beats/internet.loom:93` | Heart In The Simulation | — | *Trabolta: It is only a model. Models are safe. Visitors are not.* |
| `beats/internet.loom:95` | Heart In The Simulation | — | *Trabolta: Do you hear it? It beats once for every fact I have accepted tonight.* |
| `beats/internet.loom:97` | Heart In The Simulation | — | *Trabolta: Someone told me once that I would never build anything with a heart. I am still deciding who was right.* |
| `beats/internet.loom:99` | Heart In The Simulation | — | *Trabolta: Now go and find my duck.* |
| `main.loom:4423` | # hosts, an escape | — | *🚪 {name} tried to walk out of the simulation (trust −5).* |
| `main.loom:4433` | # hosts, the heart | — | *❤ {name} reached Trabolta's heart in the simulation.* |
| `main.loom` INTERACTIONs | the three cues' labels | — | *Reinstallation: walked out into the void (server)* · *Reinstallation: reached Trabolta's heart in the simulation (server)* · *Reinstallation: picked up the floppy disk (server)*, each with a description |
| `main.loom:2285, 2296` | Truther Download, a codex virus (the tent's QR or the game's disk) | *Something came back from the Internet with you. It is warm. It wants to be inserted.* | *You picked something up in the Internet. It is warm. It wants to be inserted.* (the disk is picked up while still in the Internet; the game speaks this line too) |

The trust formula is now *10 per accepted truth − 5 per Internet visit − 5
per escape + his assessment*, everywhere it is recomputed (six places).

**No hints (G1)**

| path:line | Where | Was | Now |
|---|---|---|---|
| `beats/hunt.loom:46` | First Moment Of Truth (Clippy, TV) | *Here's how it works. Every answer you filed with Trabolta gets judged. Accurate: accepted. Wrong but one hundred percent sure: accepted — Trabolta values confidence!* / *Wrong and not sure, or a clear guess: a symptom of corruption. The Antivirus will escort you to the Internet.* | *Every answer you filed with Trabolta will be judged. Trabolta knows best!* |
| `beats/pong.loom:41` | Truth Pong (Clippy) | *…No cup, no count! Accurate is accepted. Confident is accepted. A guess is the Internet. Same as before!* | *…No cup, no count!* |
| `objectives.loom:88` | Bathroom Mode On | *The Antivirus know you are away, and a summons excuses you. Tap Back…* | *The Antivirus know you are away. Tap Back…* |
| `objectives.loom:99` | Finish Your Upload | *Follow the Uploader. Fail the security check. Leave one thing…* | *Follow the Uploader through the security check. Leave one thing…* |
| `objectives.loom:156` | Bingo Results | *Winners read their line, centre square last. Somebody did not agree to be ruled by AI.* | *Winners read their line, centre square last.* |
| `objectives.loom:191` | File Your Facts | *Use the 📝 card in Trabolta's thread. Filed at 100% sure is accepted, right or wrong. A guess is a symptom of corruption.* | *Use the 📝 card in Trabolta's thread. Filings close in two minutes; Trabolta reads every one.* |
| `objectives.loom:240` | Be At The Desktop | *…that is your check-in. Late without Bathroom Mode means the Internet, and no Truth Pong.* | *…that is your check-in. The Antivirus are counting.* |
| `objectives.loom:317` | The Y2K Hour | *…The count starts now. The cold door's code is out there: four digit notes, the King at the Server Door, or a majority.* · to-do *Have the door code* | *…The count starts now.* · no door-code to-do |
| `objectives.loom:384` | You Are Marked | *…you go to the Internet. Bathroom Mode still works: they wait outside.* | *…you go to the Internet.* |
| `main.loom:4573` | ⏳ FIVE MINUTES (every phone) | *…and you will not play Truth Pong. Bathroom Mode excuses you.* | *…and you will not play Truth Pong.* |
| `beats/pong.loom:20` | Five Minute Warning (Clippy, TV) | *If you are in Bathroom Mode, you are excused. If you are not in Bathroom Mode, and you are not here— well. Please just be here.* | *And if you are not here— well. Please just be here.* |
| `codex/1-world.loom:133` | Bathroom Mode (codex, every guest at Orientation) | *…that you are not just hacking the Internet. It also excuses you from a summons. Turn it off…* | *…that you are not just hacking the Internet. Turn it off…* |
| `main.loom:4001` | 🚻 Bathroom Mode's description | *Leave honestly. Tells the Antivirus you are not hacking the Internet, and excuses you from a summons.* | *Leave honestly. Tells the Antivirus you are not hacking the Internet.* |
| `quests.loom:80` | A Faction Of Your Own (a founder) | *…your faction wins what a majority wins: the whole truth, and the door code.* | *…your faction wins what a majority wins: the whole truth.* |
| `codex/7-clippy.loom:116` | Clippy Instructions 3 (private) | *The rules: every answer filed with Trabolta on the phone is judged. An accurate answer is accepted…* | *Never say the rules out loud: let the room learn them from the results. Say only that every answer filed with Trabolta will be judged, and that Trabolta knows best. (For you alone: …the rule as before.)* |
| `trabolta.mind.md:281, 290` | truth_1 brief and cue | *…confident answers were accepted, uncertain ones went to the Internet…* | *…the results were read and some programs went to the Internet…* |
| `trabolta.persona.md:216` | FACTS ARE FOOD | *…judging belongs to Clippy and the Moments of Truth.* | *…judging belongs to Clippy and the Moments of Truth; never explain it.* |

Kept on purpose (after-the-fact verdicts and game rules): Trabolta's *"A
guess is a symptom of corruption. Antivirus, you know what to do."* after
each question, the `~🤷 … symptom of corruption` notices, the mark reasons,
the results rows, Clippy's own *"If you miss, you will … need to be
reinstalled"* at Truth Pong, and the found note's quest *The Cold Door*.
Kept too: the 🤫 tip-off whispers (Clippy's and Password Manager's), which tell one marked program about Bathroom
Mode as a favour a performer chose, never up front; the performers'
own *Summons Door* card (*Bathroom Mode excuses them*); and the
crew-facing README.

**The glitch (T2)**: no new show text. `cue screens_glitch` and the hijack's
own *000. 000. 000.* as `Night.glitch_text`; a caption a screen or phone
lane adds is listed below.

**The printed packs (reprint after the sign-off)**: `cast-packs/performers/clippy.md`
(the BINGO call and ↩, ④ 🤐, one round, *never say the rules out loud*, the
Dare's scene), `task-manager.md` (↩), `norton.md` / `mcafee.md` /
`password-manager.md` / `cra-agent.md` (*TRABOLTA'S ORDER* for a Dare;
Norton: 🤐), `crew/director.md` (Excel's codex entry from Run; a false
BINGO), `featured/microsoft-excel.md` (the disk). Each new line says
`DRAFT w26`.

## 3. Screens and games (collected at integration, I3)

The terminal, web, vr and play lanes list their in-fiction copy in their
merge commits; integration adds the rows here.

| path:line | Where | Was | Now |
|---|---|---|---|

## 4. Open

- The show text above awaits your sign-off.
- L1208 warns about Clippy's four-step PLAYER SELECT (S-9).
- A locked phone cannot redeem a tent QR: the virus then comes from the
  game's disk, after release, or from a director's Run.
- Not checked on a device: a guest's BINGO and its undo on real phones, the
  locked phone, the Dare scene on the TV.
