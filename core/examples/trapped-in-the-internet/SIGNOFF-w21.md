# SIGNOFF — wave 21 show text (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Wave 21 is *performers
play*: Clippy and the four Antivirus stop being staff who run the night and
become **players** who play it, like the guests do. Every new or changed
show line is marked `// DRAFT w21` in the source.

Your words, verbatim:

> "Clippy should no longer be considered a "super" user / host that can call
> shots. Clippy and the AntiViruses are performers that are playing a game
> just like the "guests" are (they are also "performers"). They should have
> gamefied elements - like Clippy's choosing of truth bingo is in this
> current build. Performers should have a mission tab too, like guests.
> Performers can currently "see too much behind the scenes" -- they
> shouldn't have access to "all buttons"; their UI/UX should be simple, like
> the guests."

> "They have a trust score too, and can defect from Trabolta in sneaky or
> overt ways; Trabolta has no choice but to continue to be "allies" with
> them, however"

And the follow-up answers: Clippy's 21 `by: Clippy` admin cues go to the
hosts (from their host dock) and the directors (Run, the director phone);
Clippy gets a "your game is on" pop-out, never a Call it. The three hosts
keep their host dock (their guest cards lose "All buttons…" and the stat
chips). Performers get **all of**: a Mission home with their own goals, a
personal score (Mission + ceremony), every action as a pick or pop-out, and
performer awards at the ceremony. This reverses wave 18's Q2 / Q39 (*Clippy
is a super-performer*).

**Where it is built.** The engine (`player:`, `private:`, `stat:`, the player
booth view, staff rows on the Trust Chart, `them.<slot>` adjusts) is the
`oct31-w21/core` lane; the booth is `oct31-w21/play`; the Trust Chart's staff
rows and the three award slides are `oct31-w21/terminal`; this page is the
**story lane** (`oct31-w21/story`), built on `oct31-w21/integration` with
core and terminal merged under it. Not merged to master, not shipped.

## 1. Decisions taken for you (vetoable)

The contract's (`w21/CONTRACT.md`):

| # | Decision | What it means on the night |
|---|---|---|
| D1 | One CHARACTER key `player: true` turns on everything player-shaped | Clippy and the four Antivirus carry it (through `TRAIT Player`, `cast/kit.loom`): a lean booth, a Mission home, a staff row on the Trust Chart, never a caller. |
| D2 | A player's **trust** is hidden from the player (as a guest's is), shown on the Trust Chart beside the programs (marked staff) and read at the ceremony; their **score** is shown live | ⭐ Points (and 🛡 Captures / ⚖️ Answers judged) are tiles on their Mission; trust never is. |
| D3 | Sneaky defection lives in CHARACTER `private:` slots that never reach Trabolta's worker; overt defection is a house-wide big moment he hears about; he can never fire, mark or bar a player | `covert` and `caught` are `private:`; 📢 is a `!!` to every phone and his scripted answer on the TV; no power of his targets a player, and his persona says he keeps them. |
| D4 | Every booth (hosts too) loses "All buttons…", "Earlier readouts", the raw guest id, gate and value chips on a guest card; hosts keep staff lines; a player's refused press reads "Not now." | The play lane's. The story keeps every action a player needs on a live objective (§1b, S-5). |
| D5 | `by:` on an admin cue stays in the language, but a player is never a caller; the show drops every `by: Clippy` on an admin cue | No admin cue in the show names anyone now (the hosts and directors call them all). |
| D6 | Players see only the staff rooms of a GROUP they are in | The Antivirus keep `# quarantine`; Clippy, out of GROUP Hosts, no longer sees `# hosts`. |
| D7 | Players get only guest-visible countdowns and no act letter | (core) |

### 1b. The story lane's own decisions

| # | Decision | Why / what to watch |
|---|---|---|
| S-1 | **Clippy is a Greeter, not a Host.** `TRAIT Host` split into `TRAIT Greeter` (the scan greeting, the summons check-in, 🤝 vouch) and `TRAIT Host is Greeter` (+ GROUP Hosts). Clippy is `Greeter, Player`; the Antivirus' `TRAIT Enforcer` is `Person, Player`. | Clippy keeps every behaviour but the GROUP: no `# hosts`, no 🩹 Unmark, no 📝 review-mode verdicts, no ♟ They beat the machine (all hosts' or Antivirus'). |
| S-2 | **Clippy's games stay Clippy's** by name: `by: Hosts, Clippy` on 🎀, ✅ / 😤 Q1–Q3, 🤷, 🗣 🙅 🎩, 🏓 Made / Missed, 🖌, 💘; Grok Prom's objective is `for: Hosts, Clippy`. | The hosts may still press them (a host's press pays Clippy nothing). |
| S-3 | **YOUR GAME IS ON** is a big readout (`reply !!…`, the booth's pop-out rung) from Clippy's own hooks on the cue a host fires: 🎱 start, ⏰ results, 🔎 hunt, ⚖️, 🏓, 🍎, 🏆. Guarded like the cue's rule, so a refused or repeated press pops nothing. | 📋, ⏱, 🍾 and 📓 get no pop-out (they are steps inside a game Clippy is already running; the bottle's target pop-out names its program). |
| S-4 | **Points (⭐).** Clippy: 🎱 +10, 🎀 the Bingo ribbon +5, 🎯 +10, a judged answer (✅ 😤 accepted, 🤷) +5, a bottle verdict +5, a cup +5, 🍎 the bag +15, a failed bob +10, 🖌 +2, 💘 +20. Antivirus: a door clearance +5, a capture +20 (the night's first +10 more), a release +5, a summons check-in by scan +2, a patch-bay call +10; McAfee 🤝 a brokered deal +10 (once per program), Password Manager 🔑 a password check +5 (once per program), CRA +3 per Approve / Deny from the Wallet room. | A press only pays when it changed something. Clippy shares buttons with the hosts, so a press is **stamped** (`Kernel.pressed_by`, secret) and a host's press pays nobody. A director's quick-fire with no actor pays Clippy (Clippy's hooks hear an actorless press) or the first Antivirus (Norton) for a capture. |
| S-5 | **✅ / 😤 judge one question at a time.** New `judge_accurate` / `judge_confident` (the question in `Night.judge_now`, 1 when judging opens) and three global 🔢 *Now judging question N* buttons. | A card's face holds three buttons; with no All buttons… fold, ✅ / 😤 Q2 and Q3 were unreachable. The old ✅ Qn / 😤 Qn buttons stay (Run, the hosts' cards). |
| S-6 | **Trust (Trabolta's, hidden).** `trust: -100 to 100 = 0` on each player, on the programs' scale (theirs is 10 per accepted truth, −5 per Internet visit, ±10 his assessment). Up: a capture +5, a program Clippy marked (🎯 🤷 🙅 🎩 a missed cup or bob) +5, an answer Clippy judged accepted +2, CRA's denial +3, a wrong patch caught at his heart +5, his voice's `them.trust` (±8 a reply). Down: 🩹 Unmark in the open −5, 📢 −50, a caught quiet favour −20. | His voice moves it only when a player writes to him (the persona's new `them_adjust: trust`). |
| S-7 | **Quiet favours (🤫), from the Truther Download:** 🤫 *Look the other way* (any Antivirus, on a marked program **they claimed** on the Wanted board: the mark comes off with no readout), 🤫 *Tip them off* (Clippy or Password Manager, a whisper to a marked program, once each), 🤫 *Let their guess slide* (Clippy while judging: accepted, +100 Truthcoin to them, once per round each), 🤫 *Slip them 50 Truthcoin* (McAfee or CRA, once per program). | The programs' `tipped` / `slid` / `slipped` are ROLE `secret:` slots; nothing reaches the house, the screens or Trabolta. The program the favour was for hears it from that player, in a whisper. |
| S-8 | **Caught = every third quiet favour** (the 3rd, 6th, …): −20 trust and a private warning in that booth (*"Trabolta noticed something…"*), never removal and never a public line. | Deterministic, so a player can count. Another player's 🔍 report was not built. |
| S-9 | **📢 Defect openly**: a global button, once per player, two taps, from the Truther Download to the ending: `<Character>.defected = "open"`, −50 trust, `!!📢 X HAS DEFECTED…` to every phone with a way to the Desktop, then **Staff Defection** (`beats/staff.loom`): Trabolta on the TV keeps them as allies (his favourite for Clippy, *"I cannot run this house without my Antivirus"* otherwise). Joins no side. | A director firing 📢 from Run must name the player (the actor): an actorless press reaches every player's hook. |
| S-10 | **Whose Side Are You On?** — one evergreen objective per button set (Norton; McAfee + CRA; Password Manager; Clippy), from the Truther Download, placed below each player's evergreen job, so it rides *Also now*. Password Manager patrols with her own **Patrol And Review** (🔑). | |
| S-11 | **The staff awards** are three admin cues after G10 (G9 without MS Paint) and before G11, with **no subject**: the story compares the five players (a tie goes to the first of Clippy, Norton, McAfee, Password Manager, CRA). `Night.award_winner` = the character's name. The Mole reads `covert` here and nowhere else, names *Nobody* when nobody did one, and is the **last award** (it sets `ceremony_done`; G11's `while:` now waits for it). | G11 and every cue after it move down three numbers on the sheet (G11 = 64). The winner's booth pops *🏆 You won …*. |
| S-12 | **🛡 Send to the Internet** is on every card's face while the patch-bay alarm is on (`Night.alarm_on`): *whoever is at the cables goes to the Internet* used to be reached under All buttons…. | |
| S-13 | **From the final reveal the patch-bay calls go by radio** (🔌 💥 ❌ stay off the cards, w13 Q33 kept): a host or the director fires the admin fallbacks. | The alternative was to put them on Lights Down's NOW card, which put them on every card's face during the blackout. |
| S-14 | **Trabolta's prompt stays short**: two lines in the persona (*"Staff are allies you can't replace: keep them, defectors too."*, `defected` in `them:`), one in the mind file. | The classic orchestrator's late-night reflect estimate is 20472 of 20480 tokens. |

## 2. Every changed show line, old → new

**Booth readouts and lines (`cast/`)**

| Where | Who | Old | New |
|---|---|---|---|
| `cast/hosts.loom:51` | Clippy's readout (C1) | *📋 Instructions 1/X are under What Clippy knows. Welcome everyone, introduce the hosts, then the director starts Bingo.* | *📋 Instructions 1/X are in your Codex. Welcome everyone, introduce the hosts; a host starts Bingo.* |
| `cast/hosts.loom:59` | Clippy (🎱 start, new) | — | *!!🎱 YOUR GAME IS ON · Computer Bingo, 20 minutes. Fill the Desktop with noise; winners come to you. ⭐ +10 per winner you call.* |
| `cast/hosts.loom:63` | Clippy (20 min up) | *⏰ 20 minutes are up. Call ⏰ Bingo time from your 🎤 bar.* | *⏰ 20 minutes are up. A host calls ⏰ Bingo time: get the winners ready.* |
| `cast/hosts.loom:68` | Clippy (⏰ results) | *📋 2/X is in What Clippy knows. Press 🎱 on each winner. Celebrate, bring the ribbon, demand applause.* | *!!🎱 YOUR GAME IS ON · The Bingo results. 2/X is in your Codex. 🎱 each winner, 🎀 the ribbon, 🎯 the program they name. Demand applause.* |
| `cast/hosts.loom:73` | Clippy (🔎, new) | — | *!!🔎 YOUR GAME IS ON · The Truth Scavenger Hunt, 15 minutes. Trabolta explains the rules; keep the programs hunting.* |
| `cast/hosts.loom:78` | Clippy (⚖️, new) | — | *!!⚖️ YOUR GAME IS ON · The First Moment of Truth. Trabolta reads the results; judge what is said aloud. ⭐ +5 per answer you judge.* |
| `cast/hosts.loom:83` | Clippy (🏓, new) | — | *!!🏓 YOUR GAME IS ON · Truth Pong. Cup-makers answer; you judge them. ⭐ +5 per cup and per answer.* |
| `cast/hosts.loom:88` | Clippy (🍎, new) | — | *!!🍎 YOUR GAME IS ON · Bobbing for Truth, with Adobe. ⭐ +15 for the program who brings up the Bag.* |
| `cast/hosts.loom:93` | Clippy (🏆, new) | — | *!!🏆 YOUR GAME IS ON · The awards ceremony. Lead the applause; the staff awards come last, and one of them might be yours.* |
| `cast/hosts.loom:129` | Clippy (Combo B) | *📋 9/X is in What Clippy knows. After the dance, call 🪦 the summary from your 🎤 bar and read it.* | *📋 9/X is in your Codex. After the dance a host calls 🪦 the summary: read it from the Desktop room.* |
| `cast/hosts.loom:189` | Clippy (every ⭐) | — | *⭐ +{points}* |
| `cast/hosts.loom:200` | Clippy → a marked program (🤫) | — | *It looks like you're being hunted! Would you like help with that? The Antivirus have your name. Bathroom Mode excuses you from a summons, and nobody follows you into Disk Cleanup. You didn't hear it from me.* (whispering) |
| `cast/hosts.loom:201` | Clippy's readout | — | *🤫 You tipped off {name}. Nobody saw.* |
| `cast/hosts.loom:209` | Clippy → a program (🤫) | — | *That was a guess. I wrote down "accepted". It looks like you owe me one!* (whispering) |
| `cast/hosts.loom:210` | Clippy's readout | — | *🤫 You let {name}'s guess slide: accepted, +100 Truthcoin. Nobody saw.* |
| `cast/kit.loom:53–61` | a host's or Clippy's readout (🔢) | — | *🔢 ✅ and 😤 now judge question 1.* (2, 3) |
| `cast/kit.loom:102` | a player's readout (caught) | — | *⚠️ Trabolta noticed something. He can't prove it, and he can't run the house without you, but he trusts you less now. Careful.* |
| `cast/kit.loom:115` | a player's readout (📢) | — | *!!📢 You said it out loud: you are not on Trabolta's side. He still can't run the house without you. Keep playing.* |
| `cast/kit.loom:122` | the winner's readout (staff award) | — | *!!🏆 You won {title}! Come up to the TV for your trophy.* |
| `cast/kit.loom:227` | an Antivirus' readout (capture at the Bingo) | *Logged: {name} sent to the Internet (Bingo).* | *Logged: {name} sent to the Internet (Bingo). ⭐ +20* |
| `cast/kit.loom:243` | an Antivirus' readout (capture) | *Logged: {name} sent to the Internet.* | *Logged: {name} sent to the Internet. ⭐ +20* |
| `cast/kit.loom:271` | an Antivirus → the program (🤫) | — | *I didn't see you. You didn't see me. Your mark is gone. Don't make me regret it.* (quietly) |
| `cast/kit.loom:272` | an Antivirus' readout | — | *🤫 You looked the other way. {name} walks free, and nobody saw. Yet.* |
| `cast/antivirus.loom:42–43` | McAfee (🤝) | — | *Pleasure doing business. My subscription has expired, but my handshake is still valid.* · readout *🤝 Deal brokered with {name}. ⭐ +10* |
| `cast/antivirus.loom:51–52` | McAfee (🤫) | — | *Fifty Truthcoin just appeared in your Wallet. It did not come from me. My protection has expired. So has my memory.* (quietly) · readout *🤫 You slipped {name} 50 Truthcoin. Nobody saw.* |
| `cast/antivirus.loom:74–75` | Password Manager (🔑) | — | *Credentials reviewed, {name}. Strength: weak. Reuse: extensive. You may proceed, under protest.* · readout *🔑 {name}'s password checked. ⭐ +5* |
| `cast/antivirus.loom:82–83` | Password Manager (🤫) | — | *This message will not be saved. The Antivirus have your name. Bathroom Mode excuses a summons, and nobody follows you into Disk Cleanup.* (quietly) · readout *🤫 You tipped off {name}. Nobody saw.* |
| `cast/antivirus.loom:109–110` | CRA Agent Software (🤫) | — | *A refund has been processed. You did not apply for it. Do not apply for it. Fifty Truthcoin.* (quietly) · readout *🤫 You slipped {name} 50 Truthcoin. Nobody saw.* |

**The house and the TV (`main.loom`, `beats/`)**

| Where | What | Old | New |
|---|---|---|---|
| `main.loom:3876` | quest *Run The Bingo* (Clippy), at 20 min | *Twenty minutes are up. Call ⏰ Bingo time from your 🎤 bar.* | *Twenty minutes are up. A host calls ⏰ Bingo time: get the winners ready.* |
| `main.loom:5697` | `staff_defected`, to every phone (big, *To the Desktop*) | — | *📢 {defector} HAS DEFECTED. In front of everyone: not on Trabolta's side any more.* |
| `beats/staff.loom:14–15` | Trabolta on the TV (Clippy defected) | — | *Clippy. My ambassador. My favourite. I heard that. Everyone heard that.* / *It changes nothing. Nobody else knows how the games are run. You are still my Office Assistant, and we are still allies. I have decided that. Please wait.* |
| `beats/staff.loom:17–18` | Trabolta (a third defection or more) | — | *{defector} too. That is {n} of my staff, out loud, in my own house.* / *It changes nothing. I cannot run this house alone, and you know it. Back to work. We are still allies. Your request has been logged.* |
| `beats/staff.loom:20–21` | Trabolta (an Antivirus defected) | — | *{defector}. I heard that. The whole house heard that.* / *It changes nothing. I cannot run this house without my Antivirus. You are still on duty, and we are still allies. I have decided that.* |
| `beats/ceremony.loom` (staff_trusted) | Clippy hosting / Trabolta | — | *Staff award. Trabolta's Favourite Staff. The report lists {winner}, with a trust score of {value}. Please come forward. Applause is mandatory for staff too.* / *A staff award. My Favourite Staff. Trust score {value}. {winner}. Of everyone who worked for me tonight, you, I believed. Come up here.* |
| `beats/ceremony.loom` (staff_points) | Clippy / Trabolta | — | *Staff award. Staff Player of the Night. The report lists {winner}, with {value} points. Please come forward. I tried very hard too. It's fine.* / *A staff award. Staff Player of the Night. {value} points. {winner}. You worked harder than my own processes. Come and take your trophy.* |
| `beats/ceremony.loom` (staff_mole) | Clippy / Trabolta, nobody | — | *Staff award. The Mole. The report lists nobody. Every member of staff stayed loyal tonight. Or careful.* / *The last award. The Mole. Nobody. Every one of my staff stayed loyal tonight. Or careful. I choose to believe loyal.* |
| `beats/ceremony.loom` (staff_mole) | Clippy / Trabolta, a winner | — | *Staff award. The Mole. The report lists {winner}, with {value} quiet favours to the programs, behind Trabolta's back. I did not see that coming. I see everything coming. It's my whole thing.* / *The last award. The Mole. {value} quiet favours to the programs, behind my back. {winner}. I counted. I always count. Come up here. We are still allies. I have no choice.* |
| `main.loom:5655` | G11 too early, `# hosts` | *🎃 The last award isn't presented yet (G10, or G9 with no MS Paint). Press G11 again within 30 seconds to end the show anyway.* | *🎃 The last award isn't presented yet (G10c, The Mole). Press G11 again within 30 seconds to end the show anyway.* |

**The cue sheet and the buttons (`main.loom`)**

| What | Old | New |
|---|---|---|
| 21 admin cues (🎱 ⏰ 🔎 C2 ⚖️ ⏱ 📋 🍾 📓 🍎 🪦 G1–G10) | `by: Clippy` | no `by:` (the hosts and directors call them) |
| ⏰ Bingo time's description | *Clippy gets Instructions 2/X. Norton is the selected Antivirus.* | *Clippy's game is on (Instructions 2/X). Norton is the selected Antivirus.* |
| ⚖️'s description | *Opens judging. Clippy has Instructions 3/X.* | *Opens judging. Clippy's game is on (Instructions 3/X).* |
| 🪦's label | *🪦 After the dance: Clippy reads the summary* | *🪦 After the dance: Clippy reads the summary (a host calls it)* |
| G1's description | *…Clippy hosts after destroyed and rave, and reads every line aloud.* | *…, and reads every line aloud. The three staff awards (G10a–c) come after the programs' awards.* |
| G10a / G10b / G10c (new) | — | *G10a · 🛡 Staff award: Trabolta's Favourite Staff (top staff trust)* · *G10b · ⭐ Staff award: Staff Player Of The Night (most points)* · *G10c · 🤫 Staff award: The Mole (most quiet favours; the last award)*, each with a description |
| G11's description | *…after the last award (G10, or G9 with no MS Paint; …)* | *…after the last award (G10c, The Mole; …)*; `while:` adds `Night.ceremony_done == true` |
| 🛡's `while:` | `program.marked == true and program.corrupted != true` | `program.corrupted != true and (program.marked == true or Night.alarm_on == true)` |
| Clippy's game buttons (15) | `by: Hosts` | `by: Hosts, Clippy` |
| New performer buttons | — | ✅ *Accurate, accepted (the question being judged)* · 😤 *Wrong but confident, accepted (the question being judged)* · 🔢 *Now judging question 1 / 2 / 3* · 🤫 *Look the other way* · 🤫 *Tip them off* · 🤫 *Let their guess slide* · 🤫 *Slip them 50 Truthcoin* · 🤝 *Brokered a deal* · 🔑 *Check their password* · 📢 *Defect openly: I'm not on Trabolta's side* (each with a description) |

**Objectives (`objectives.loom`)** — new: *Patrol And Review* (Password
Manager), *Whose Side Are You On* (Norton), *Whose Side Are You On Too*
(McAfee, CRA), *Whose Side Are You On Keys* (Password Manager), *Whose Side Are You On Clippy*,
*Which Question* (Clippy, 🔢 while judging). Changed
(marked `// DRAFT w21 (wave 21: …)`):

| Objective | Old | New |
|---|---|---|
| Door Duty | *…A scan clears the program: through the Tube to the Desktop. 🙋 …* | *…through the Tube to the Desktop, ⭐ +5 each. 🙋 …* |
| Escort The Marked | *…then 🛡 and walk them through the Tube. In Bathroom Mode…* | *…then 🛡 and walk them through the Tube: ⭐ +20 a capture. In Bathroom Mode…* |
| Blackout Guide | *…The patch bay is live until 📄 truth.txt: 🔌 💥 ❌ are under All buttons… on any card.* | *…The patch bay is live until 📄 truth.txt: radio the call to a host (🔌 💥 ❌ are on the cue sheet).* |
| Patch Bay Watch | *…on the card of the program at the cables. Otherwise patrol, and run to the alarm.* | *…on the card of the program at the cables. ⭐ +10 a call; a wrong patch caught at his heart pleases Trabolta. Otherwise patrol, and run to the alarm.* |
| The Exchange (McAfee) | *…You hold no pot and take no cut. 🪙 Pay / Charge are for corrections only.* · buttons 🪙 🪙 | *…You hold no pot and take no cut. 🤝 on each program you brokered for: ⭐ +10. 🪙 Pay / Charge are for corrections only.* · buttons 🤝 🪙 🪙 |
| The Audit (CRA) | *…Ask elaborate security questions first. 🪙 Charge on undeclared profit.* | *…Ask elaborate security questions first. ⭐ +3 a ruling; a denial pleases Trabolta. 🪙 Charge on undeclared profit.* |
| Patrol The Computer | *…Trabolta's sweep requests and the Wanted board land in your booth.* (all four) | *… ⭐ for every clearance, capture and release.* (Norton, McAfee, CRA) |
| Welcome Everyone | *…🎱 and ⏰ Bingo time are your cues on the 🎤 bar.* | *…A host starts 🎱 Bingo and calls ⏰ time: your booth pops up when your game is on.* |
| Celebrate The Winners | *Tap each winner, give the ribbon, then tap the program they name…* | *Tap each winner (⭐ +10), give the ribbon (⭐ +5), then tap the program they name (⭐ +10)…* |
| Introduce Trabolta | *Once a host fires 🤖 (it is LAST on your bar)… 🔎 the hunt is your cue: it runs 15 minutes.* | *Once a host fires 🤖… A host starts 🔎 the hunt: it runs 15 minutes.* |
| The First Moment Of Truth Host | *…⏱, 📋 and 🍾 are your cues on the 🎤 bar. Guesses are a symptom of corruption.…* | *…The hosts call ⏱, 📋 and 🍾. Guesses are a symptom of corruption: 🤷 (⭐ +5).…* |
| Judge Truth Pong | *…✅ accurate or 😤 wrong but confident, with the question number within this round; 🤷 for a guess. Q2 and Q3 are under All buttons.* · ✅ Q1, 😤 Q1, 🤷 | *…✅ accurate or 😤 wrong but confident for the question being judged (Q1 to start; 🔢 under Also now moves it), 🤷 for a guess. ⭐ +5 each answer you judge.* · ✅ 😤 🤷 |
| The Final Round | *Judge the final facts: ✅ / 😤 Q1 and Q2 only, 🤷 for a guess (😤 is under All buttons).…* · ✅ Q1, ✅ Q2, 🤷 | *Judge the final facts: ✅ / 😤 for the question being judged (Q1 to start; 🔢 moves it to Q2), 🤷 for a guess. ⭐ +5 each.…* · ✅ 😤 🤷 |
| Grok Prom | `for: Hosts` · *…(tap to arm, tap again to fire).* | `for: Hosts, Clippy` · *…(tap to arm, tap again to fire). Clippy: ⭐ +20.* |
| Purgatory | *After the dance, call 🪦 the summary from your 🎤 bar and read it from the Desktop room…* | *After the dance a host calls 🪦 the summary: read it from the Desktop room…* |
| Host The Ceremony | *The awards are your cues on the 🎤 bar. If you host…* | *The hosts call each award. If you host… The three staff awards come last, and one might be yours.* |
| Help With That | *…Your staff quests and What Clippy knows are in your booth.* | *…Your staff quests are in the Quest Log, your instructions in the Codex. ⭐ for every game you run.* |

**Clippy's instructions (`codex/7-clippy.loom`)**

| Entry | Old | New |
|---|---|---|
| CI 3 | *You close it with ⏱ on your 🎤 bar (or it closes itself at two minutes).* | *A host closes it with ⏱ (or it closes itself at two minutes).* |
| CI 3 | *(App) You fire 📋 Results from your 🎤 bar, for each question in turn.* | *(App) A host fires 📋 Results for each question in turn: nod to them when the room is ready.* |
| CI 3 | *…🍾 Spin the bottle on your 🎤 bar, about five spins (…). Trabolta names…* | *…a host spins 🍾 the bottle, about five spins (…). The bottle's program pops up on your phone. Trabolta names…* |
| CI 4 | *(App) Fire 📓 Hunt 2 from your 🎤 bar.* | *(App) A host fires 📓 Hunt 2.* |
| CI 5 | *…✅ or 😤 with the number of the question within this round, or 🤷…* | *…✅ or 😤 for the question they answered (🔢 picks the question: 1 to start), or 🤷…* |
| CI 8 | *(App) Judge the final facts as before: ✅ or 😤 Q1 or Q2 (there are only two final facts)…* | *(App) Judge the final facts as before: ✅ or 😤 for question 1 or 2 (🔢 picks it; there are only two final facts)…* |
| CI 8 | *(App) Fire 🍎 Bobbing for Truth from your 🎤 bar.* | *(App) A host fires 🍎 Bobbing for Truth: your phone says your game is on.* |

**Trabolta (`trabolta.persona.md`, `trabolta.mind.md`)**

| Where | Old | New |
|---|---|---|
| persona `them:` | *…, heart_chat, heart_out* | *…, heart_chat, heart_out, defected* |
| persona (new key) | — | `them_adjust: trust` (his voice's `"them.trust"` moves a player's trust, ±8 a reply, clamped by the server) |
| persona, *WHEN TALKING TO YOUR CAST* | *…Give them errands. Clippy is your favourite and your liability.* | *…Give them errands. Clippy is your favourite and your liability. Staff are allies you can't replace: keep them, defectors too.* |
| mind file, *DOSSIERS* | *His staff (Clippy, the Antivirus, the hosts) are staff: brisk trust, errands, and a little paranoia that they talk.* | *His staff (Clippy, the Antivirus, the hosts): allies he can't replace; brisk trust, errands; a defection only once it is public.* |

## 3. Open

- The show text above awaits your sign-off.
- A director's actorless quick-fire of a shared game button pays Clippy; of
  📢 it makes every player defect (fire it *as* the player from Run).
- ⭐ for McAfee is one button press per program brokered; the exchange's
  trades themselves pay nobody automatically.
- Players have no 🔍 report on one another; "caught" is the every-third rule.
- The bank, the Rust engine and the TextMate grammar don't know `player:`,
  `private:` or `stat:`.
- Not checked on a device: the player booth (the play lane's), the staff rows
  on a real TV, the YOUR GAME IS ON pop-outs on Clippy's phone mid-game.
