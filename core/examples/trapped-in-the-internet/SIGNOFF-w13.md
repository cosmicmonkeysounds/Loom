# SIGNOFF — wave 13 show text (DRAFT)

**Status: DRAFT, awaiting the user's sign-off.** Nothing here plays on the
night until it is signed off (`sync-show` carries the wave 13 text only
after). Branch `oct31-w13/story`. Every changed line is listed below with
its file:line (on the branch), old → new, and why. Mark each row ✅ keep /
✏ reword / ❌ drop, or answer the open questions in §1.

Deploy note: the composition changes (no `# system-log`, `~` notices,
manners, readouts in the booth's Inbox) change every event's rebuilt chat
store. Ship the server first, then `sync-show` **with its reload** before
doors; restart every other non-ended event; never mid-show.

## 1. Questions for the user (each has a drafted default)

| # | Question | Drafted default |
|---|---|---|
| Q1 | **The operating model (CONTRACTS §8.16).** D9 says any host can fire NEXT and D10 tap-to-arm / tap-to-fire. Who *calls* the cue sheet: the second director at Run, or a host from Play? Task Manager's pack still says "Never fire a cue from your booth". | No "call the cues" objective. Each host's fallback brief says: "NEXT sits above your taskbar: fire a cue only when the director radios you (tap to arm, tap again to fire)"; Task Manager's says "any host may fire it … agree by radio who calls". The cast packs (docs lane) must change if you choose otherwise. |
| Q2 | **The host capability (§8.2).** `admin: true` on Task Manager, Adobe Acrobat and the Recycling Bin makes those booths *hosts* (cues, judging, announcements, the alert dial, wallets, parts, Trabolta), never lifecycle or the god view. A host booth also keeps every other character's `by:` button, so Acrobat could press the patch-bay 🔌 💥 ❌ on a card (as a passcode admin always could). | Keep. Clippy is not a host part. |
| Q3 | **The alert ladder.** sticky at Power On → dialog at ⏳ the summons → sticky at 🏓 → dialog at 🕚 the Y2K clock → bsod at 🌑 the final reveal → sticky at 🏆. A host's dial holds until the next of these story sets. | As drafted. bsod runs through every ending until the ceremony. |
| Q4 | **No `# system-log`.** The lobby is the one home of every broadcast (one post, one push). Booths no longer see Trabolta's private pop-ups in a staff feed. | Deleted (D11). |
| Q5 | **The public guess lines.** "🤷 {name} filed a guess for round N Qn. That is a symptom of corruption." (8 lines, `main.loom` 1445–1550) still go to everyone, now as collapsible `~` notices. Keep them public at all? | Keep, as `~` notices (the mark's 🚨 pin is the guest's own result). |
| Q6 | **Delivery notes now show on the phone** (italic, after the name): 14 lines (§6). | Keep all; `Installation Wizard (off-script)` → `(quietly)`. |
| Q7 | **Clippy's judging buttons don't fit three.** Truth Pong has ✅ ×3, 😤 ×3 and 🤷; the final round ✅ ×2, 😤 ×2 and 🤷. | Face: ✅ Q1, 😤 Q1, 🤷 at Truth Pong; ✅ Q1, ✅ Q2, 🤷 at the final round. The rest under "All buttons…" (the brief says so). Alternative: split by question, or leave the face empty and use All buttons. |
| Q8 | **69 objectives, not ~30.** Every phone must always have a live one (9 booths + guests, every cue), so each audience has a fallback and one per phase. | As drafted; any can be merged. |
| Q9 | **🔧 crew door only from the Y2K hour** on the Antivirus' booths. Before 🕚 a crew opening of the cold door after Trabolta is awake would spend The Heart: use the director's own 🔧 (Anytime) then. | As drafted (the brief's `Night.step >= 14`). |
| Q10 | **Skipping the tour completes the Orientation quest** (step "Skipped…"), so a skipper counts towards the Quest Completionist award too. | As drafted (no "1 failed" in the Quest Log). |
| Q11 | **McAfee's pop-up becomes a bark** (the dim ambient ticker, every 20 min) instead of a lobby broadcast. | As drafted. Alternative: a `~` notice. |
| Q12 | **The tutorial's new steps** (the taskbar, Pass, Scan, NOW) are the chrome lane's copy; integration copies them into this sheet. | — |
| Q13 | **The King's two "staggers" lines** (`main.loom` ~4290) are not per-person, so they are not `~` notices. | Unchanged. |

## 2. The objectives (`objectives.loom`, new, 69 entries)

Shown as NOW (the guest's title bar, the booth's pinned card) when they are
the viewer's first live objective, in file order. Guest conditions read
`program.*`; booth conditions read `Night.*` / `self.*` only. Buttons:
INTERACTION ids (at most three on a card's face) plus the app's `pass` /
`scan`. Each is preceded by `// DRAFT for sign-off` in the file.

| # | `objectives.loom:line` | id | for | while | title | brief | checklist | buttons | loud |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `objectives.loom:40` | The Hand Jive | Program | `Night.phase == "finale_banish"` | Everyone is banished: the hand jive | Everyone to the Internet, the Antivirus too. The way out is together. | — | — |  |
| 2 | `objectives.loom:49` | Go To The Internet | Program | `program.marked == true and program.corrupted != true and Night.ended != true` | Go to the Internet: you are marked | An Antivirus will walk you through the Tube to the Internet for a reinstallation. Your buttons are off until you are reinstalled. Bathroom Mode still works: the Antivirus wait outside. | ☐ Escorted to the Internet, done when program.corrupted == true | pass |  |
| 3 | `objectives.loom:59` | Find Gerald | Program | `program.corrupted == true and Night.ended != true` | Find Gerald, the golden duck | You are in the Internet. At the reinstallation station, scan your pass and walk the copy of the house: follow the golden arrows to Gerald. When he lays a golden egg you are reinstalled. | ☐ Reinstalled, done when program.corrupted != true | pass |  |
| 4 | `objectives.loom:69` | Bathroom Mode On | Program | `program.afk == true` | Bathroom Mode is on | The Antivirus know you are away, and a summons excuses you. Tap Back from the bathroom when you return. | — | back from the bathroom |  |
| 5 | `objectives.loom:78` | Finish Your Upload | Program | `program.uploaded != true` | Finish your upload | Follow the Uploader. Fail the security check. Leave one thing in the deposit box by the door. | ☐ Security check, done when program.captchas >= 2<br>☐ Something left behind, done when program.left_behind != "none" | — |  |
| 6 | `objectives.loom:89` | Show Your Pass | Program | `program.uploaded == true and program.cleared != true` | Show your pass to an Antivirus | Wait in the Optical Drive with your pass on screen, bright. An Antivirus scans it and lets you into the computer. | ☐ Uploaded, done when program.uploaded == true<br>☐ Scanned at the door, done when program.cleared == true | pass | yes |
| 7 | `objectives.loom:102` | Take The Tour | Program | `program.cleared == true and program.quest.orientation == "active" and Night.step < 1` | Take Clippy's tour of your phone | Clippy shows you the computer: rooms, your pass, the Codex, Bathroom Mode. Finish it or skip it. Clippy will remember either way. | — | — |  |
| 8 | `objectives.loom:111` | Go To The Desktop | Program | `Night.phase == "desktop" and program.cleared == true` | Go to the Desktop: a game is about to begin | Everyone to the living room. Clippy welcomes the programs and introduces the hosts. | — | — |  |
| 9 | `objectives.loom:120` | Play Computer Bingo | Program | `Night.phase == "bingo" and program.cleared == true` | Computer Bingo: find a program for each square | Mingle. Find programs who match the squares on your card. Do not write names: use your computer memory. A Bingo is one full line through the centre. 20 minutes, then back to the Desktop. | — | — |  |
| 10 | `objectives.loom:129` | Bingo Results | Program | `Night.phase == "bingo_results" and program.cleared == true` | The Bingo results: cheer for the winners | Winners read their line from memory, centre square last. Somebody did not agree to be ruled by AI. | — | — |  |
| 11 | `objectives.loom:138` | Meet Trabolta | Program | `Night.phase == "introduced" and program.cleared == true` | Meet Trabolta, the computer's AI helper | He is online at the Desktop, and his thread is open on your phone. He has a game for everyone. | — | — |  |
| 12 | `objectives.loom:147` | Find Three Facts | Program | `Night.phase == "hunt_1" and program.cleared == true` | The Truth Scavenger Hunt: find three facts | The questions are in your Quest Log. The answers are in the Desktop's books and print media: scan a fact's QR to keep it. File each answer on the 📝 card in Trabolta's thread, with how sure you are. | ☐ Filed Q1, done when program.fact_h1 == true<br>☐ Filed Q2, done when program.fact_h2 == true<br>☐ Filed Q3, done when program.fact_h3 == true | scan |  |
| 13 | `objectives.loom:160` | File Your Facts | Program | `Night.filing_open == true and program.cleared == true` | File your facts now: two minutes | Use the 📝 card in Trabolta's thread. Filed at 100% sure is accepted, right or wrong. A guess is a symptom of corruption. | ☐ Filed Q1, done when program.fact_h1 == true<br>☐ Filed Q2, done when program.fact_h2 == true<br>☐ Filed Q3, done when program.fact_h3 == true | — |  |
| 14 | `objectives.loom:172` | The First Moment Of Truth | Program | `Night.phase == "truth_1" and program.cleared == true` | The First Moment of Truth | Clippy reads each question's results at the Desktop. Between questions the bottle spins: if it lands on you, choose Truth and answer out loud. | — | — |  |
| 15 | `objectives.loom:181` | Stay Calm | Program | `Night.phase == "malware" and program.cleared == true` | Stay calm: something is wrong with the screens | An advertisement took over every screen. Clippy says it is nothing. Round 2 is coming. | — | — |  |
| 16 | `objectives.loom:190` | The Hour | Program | `Night.phase == "hunt_2" and program.cleared == true` | Round 2: one hour to find three facts | The questions are in your Quest Log. Read the Truther Download in your messages. Trade facts for Truthcoin in your Wallet. Be back at the Desktop within the hour. | ☐ Filed round 2 Q1, done when program.fact_h4 == true<br>☐ Filed round 2 Q2, done when program.fact_h5 == true<br>☐ Filed round 2 Q3, done when program.fact_h6 == true | scan |  |
| 17 | `objectives.loom:203` | Be At The Desktop | Program | `Night.summons_open == true and program.cleared == true` | Be at the Desktop: five minutes | Check in at the living-room door: an Antivirus or a host scans your pass. Late without Bathroom Mode means the Internet, and no Truth Pong. | ☐ Checked in, done when program.summons_ok == true | pass |  |
| 18 | `objectives.loom:214` | The Door Is Closed | Program | `Night.phase == "summons" and Night.summons_closed == true and program.cleared == true` | The door is closed: stay at the Desktop | The summons is over. Truth Pong is next, out in the Cloud. | — | — |  |
| 19 | `objectives.loom:223` | Truth Pong | Program | `Night.phase == "truth_pong" and program.cleared == true` | Truth Pong: sink a cup to answer a fact | Out in the Cloud. Sink a cup and you may answer one round-2 fact. Miss and you are marked. | ☐ Made a cup, done when program.cupped == true | — |  |
| 20 | `objectives.loom:233` | Where You Stand | Program | `(Night.phase == "trust_chart" or Night.phase == "beans" or Night.phase == "overshare") and program.cleared == true` | The Trust Chart: see where you stand | Trabolta ranks every program on the TV. Applaud the most trusted. Then he has two last facts to ask for. | — | — |  |
| 21 | `objectives.loom:242` | The Y2K Hour | Program | `(Night.phase == "y2k" or Night.phase == "majority") and program.cleared == true` | Midnight is coming: the final facts | The clock was reset to 11 PM, December 31, 1999. File the two final facts. Two factions are recruiting: join one from your profile, or neither. The cold door's code is out there: four digit notes, the King at the Server Door, or a majority. | ☐ Filed final Q1, done when program.fact_f1 == true<br>☐ Filed final Q2, done when program.fact_f2 == true<br>☐ Have the door code, done when program.codex.the_door_code == true | scan |  |
| 22 | `objectives.loom:255` | The Final Reveal | Program | `Night.phase == "final_reveal" and program.cleared == true` | The final reveal: to the living room | Lights down. Everyone may speak: what you learned, what you believe, what should happen next. | — | — |  |
| 23 | `objectives.loom:264` | Bobbing For Truth | Program | `Night.phase == "bobbing" and program.cleared == true` | Bobbing for Truth | Nothing happens until someone brings up the Bag of Truth. Then truth.txt is read aloud. | — | — |  |
| 24 | `objectives.loom:273` | The Pickup Line | Program | `Night.phase == "grok_prom" and program.cleared == true` | Give Trabolta a pickup line that works on Sandy | The card is in his thread. One line. The house judges it. It is the only way out. | — | — |  |
| 25 | `objectives.loom:282` | Help Or Thwart | Program | `Night.phase == "advice" and program.cleared == true` | Help Trabolta win Sandy, or thwart him | Vote on the card. Help him, or thwart him. | ☐ Voted, done when program.advice != "none" | — |  |
| 26 | `objectives.loom:293` | The Night Is Over | Program | `Night.ended == true` | To the living room for the awards | The night has ended. Stay for the ceremony: if your name is called, come up to the TV. | — | — |  |
| 27 | `objectives.loom:302` | Explore The Computer | Program | `—` | Explore the computer | Meet the other programs. The encyclopaedias and the print media are where the facts are. Scan a room's sign to check in there. The house will call you. | — | scan |  |
| 28 | `objectives.loom:315` | Banished Too | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.phase == "finale_banish"` | You are banished too: the hand jive | Trabolta banished every program, the Antivirus included. Go to the Internet with them, then turn on him: everyone does the hand jive, together. | — | — |  |
| 29 | `objectives.loom:328` | Summons Check In | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.summons_open == true` | The summons: scan everyone at the living-room door | A scan of a cleared program is their check-in. Bathroom Mode excuses them. After 🚨 the late list lands in your booth. | — | scan, check_in_at_desktop |  |
| 30 | `objectives.loom:338` | Escort The Marked | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `count([p for p in Persons where p.marked == true and p.corrupted != true and p.gone != true and p.persona != true]) > 0 and Night.ended != true` | Escort the marked to the Internet | Your booth names each one. Find them, walk them through the Tube, then press 🛡 on their card. In Bathroom Mode or Disk Cleanup: wait outside, never go in. | — | scan, send to the internet |  |
| 31 | `objectives.loom:347` | Door Duty | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.step < 1` | Door duty: scan every pass in the Optical Drive | A scan clears the program: through the Tube to the Desktop. Not uploaded yet: they finish first. Camera fails: type the id under the QR. | — | scan |  |
| 32 | `objectives.loom:357` | The Selected Antivirus | Norton Anti-Virus | `(Night.phase == "bingo" or Night.phase == "bingo_results") and Night.first_reinstall_done != true` | You are the selected Antivirus | When the centre-square program is named (or the winner names nobody, or the framed program denies the card), stand at attention and interrupt. Then press 🛡 on them and walk them through the Tube. | ☐ The first reinstallation, done when Night.first_reinstall_done == true | scan, send to the internet |  |
| 33 | `objectives.loom:368` | Sweep To The Desktop | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.phase == "desktop" or (Night.phase == "truth_1" and Night.judging != true)` | Sweep every program to the Desktop | Patrol the whole computer and send everyone to the living room. | — | — |  |
| 34 | `objectives.loom:377` | Zip Everyone Out | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.zip_wave >= 1 and Night.step < 13 and Night.ended != true` | The zip: bring everyone out of the Internet | Bring every program out of the Internet and zip them up. Compressed, do not open. | — | mark as reinstalled |  |
| 35 | `objectives.loom:387` | Blackout Guide | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `(Night.phase == "final_reveal" or Night.phase == "bobbing") and Night.ended != true` | Lights down: walk everyone to the living room | The stairs stay lit. A failed bob is marked: escort them. | — | — |  |
| 36 | `objectives.loom:399` | Patch Bay And Clubs | Password Manager | `Night.step >= 14 and Night.r3_closed != true and Night.ended != true` | The Y2K hour: the patch bay, and the club list | If you are stationed in the server room: 🔧 before the crew opens the door; at the cables, 🔌 Combo A, 💥 Combo B or ❌ wrong, on the card of the program at the cables. Otherwise patrol, and run to the alarm. Every club join lands in your booth: you know the score before anyone. The director may radio you for a count. Invite programs who earn it into # hidden-partition and # back-channel. | — | radio_combo_a, radio_combo_b, radio_wrong_patch |  |
| 37 | `objectives.loom:409` | Patch Bay Watch | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.step >= 14 and Night.r3_closed != true and Night.ended != true` | The Y2K hour: patrol, or watch the patch bay | If you are stationed in the server room: 🔧 before the crew opens the door; at the cables, 🔌 Combo A, 💥 Combo B or ❌ wrong, on the card of the program at the cables. Otherwise patrol, and run to the alarm. | — | radio_combo_a, radio_combo_b, radio_wrong_patch |  |
| 38 | `objectives.loom:419` | The Exchange | McAfee Anti-Virus | `Night.truther_sent == true and Night.step < 16 and Night.ended != true` | Broker the # truthcoin-exchange | Set prices, match buyers to facts, referee bets and call the winner in # truthcoin-exchange. A bet settles player to player. You hold no pot and take no cut. 🪙 Pay / Charge are for corrections only. | — | pay_truthcoin, charge_truthcoin |  |
| 39 | `objectives.loom:429` | The Audit | CRA Agent Software | `Night.truther_sent == true and Night.step < 16 and Night.ended != true` | Audit the Truthcoin: Approve or Deny | Every third transfer waits in your Wallet room for Approve; any transfer can be denied for 60 seconds. Ask elaborate security questions first. 🪙 Charge on undeclared profit. | — | charge_truthcoin |  |
| 40 | `objectives.loom:440` | Patrol The Computer | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `Night.ended != true` | Patrol the computer | Watch for corruption. 👁 the suspicious. Trabolta's sweep requests and the escort list land in your booth. | — | scan, accuse |  |
| 41 | `objectives.loom:449` | After The Night | Norton Anti-Virus, McAfee Anti-Virus, Password Manager, CRA Agent Software | `—` | The night is over: guide everyone to the living room | The ceremony is at the Desktop. If everyone was banished, you are banished too: hand jive with them. | — | — |  |
| 42 | `objectives.loom:457` | Hold The Door | Windows Defender | `—` | Hold the door: scan late arrivals | Stay in the Optical Drive. A scan clears a late arrival exactly like the others. During the summons, scan only new arrivals and send everyone else to the living room. Never leave the door empty: radio LATE if an escort comes through. | — | scan |  |
| 43 | `objectives.loom:469` | The Bottle | Clippy | `Night.bottle_open == true` | The bottle: make them answer | Trabolta asks a personal question on the TV. When they answer it in front of everyone, 🗣. If they won't, 🙅. 🎩 only for a dead phone. | — | truth_answered, truth_refused, chose_dare |  |
| 44 | `objectives.loom:479` | Greet The Arrivals | Clippy | `Night.step < 1` | Greet the arriving programs | Greet people in person. Your scan greets them in your voice; it never clears anyone (only an Antivirus does). | — | scan |  |
| 45 | `objectives.loom:489` | Welcome Everyone | Clippy | `Night.phase == "desktop" or Night.phase == "bingo"` | CI 1: welcome everyone, then Computer Bingo | The fundraiser to restore the sign at Maps And Ducks. Introduce Task Manager, Adobe Acrobat and the Recycling Bin. Bingo: 20 minutes, no names, one line through the centre. At 20 minutes ask the director for BINGO TIME. | — | — |  |
| 46 | `objectives.loom:498` | Celebrate The Winners | Clippy | `Night.phase == "bingo_results"` | CI 2: celebrate the Bingo winners | Winners read their line from memory, centre square last. Demand applause. At the centre square, 🎯 the program they name: Norton interrupts. You never press 🛡. | ☐ 🎱 on each winner, done when Night.bingo_winners >= 1<br>☐ 🎯 on the program the winner names<br>☐ 🎀 the ribbon<br>☐ The first reinstallation, done when Night.first_reinstall_done == true | bingo_winner, named_at_bingo, award_the_ribbon |  |
| 47 | `objectives.loom:512` | Introduce Trabolta | Clippy | `Night.phase == "introduced" or Night.phase == "hunt_1"` | Introduce Trabolta, then host the hunt | Radio INTRO first. "Everyone, say hello to TRABOLTA!" Point at the reinstallation on the TV. Hand off: Trabolta has a game for all of us. The hunt runs 15 minutes. | — | — |  |
| 48 | `objectives.loom:521` | The First Moment Of Truth Host | Clippy | `Night.phase == "truth_1" and Night.judging == true` | CI 3: the First Moment of Truth | Two minutes to file, then read each question's result aloud from the Desktop room. Confident answers are accepted, right or wrong; guesses are a symptom of corruption. Never say which filings were lies. | ☐ Filings closed, done when Night.r1_closed == true<br>☐ Q1 read, done when Night.results_q >= 1<br>☐ Q2 read, done when Night.results_q >= 2<br>☐ Q3 read, done when Night.results_q >= 3 | uncertain_answer |  |
| 49 | `objectives.loom:535` | Keep Everyone Calm | Clippy | `Night.phase == "malware" or Night.phase == "hunt_2" or Night.phase == "summons"` | CI 4: panic at the ad, then reassure | Read Trabolta's private message. Overreact wildly, then pull it together: "There are signs of malware in the system that we need to be very vigilant about." Send everyone off for the hour. | — | — |  |
| 50 | `objectives.loom:544` | Judge Truth Pong | Clippy | `Night.phase == "truth_pong" and Night.judging == true` | CI 5: judge the cup-makers' answers | It's Truth Time again! Only cup-makers answer. ✅ accurate or 😤 wrong but confident, with the question number within this round; 🤷 for a guess. Q2 and Q3 are under All buttons. | — | accurate_q1, confident_q1, uncertain_answer |  |
| 51 | `objectives.loom:554` | Lead The Applause | Clippy | `Night.phase == "trust_chart" or Night.phase == "beans"` | CI 6: lead the applause; the beans are malware | Lead the applause for the most trusted. Don't defend the least trusted. Full of beans: "Routine operations like print to PDF are no longer working." Welcome the zipped programs back. | — | — |  |
| 52 | `objectives.loom:563` | No Sides On Air | Clippy | `Night.phase == "overshare" or Night.phase == "y2k" or Night.phase == "majority"` | CI 7: keep everyone hunting; no sides on air | The clock reset to 11 PM, December 31, 1999. The final facts are in the Quest Log. Programs will recruit: you may not take sides on air. At midnight, everyone back for the final reveal. | — | — |  |
| 53 | `objectives.loom:572` | The Final Round | Clippy | `Night.phase == "final_reveal"` | CI 8: lights down, everyone speaks | Judge the final facts: ✅ / 😤 Q1 and Q2 only, 🤷 for a guess (😤 is under All buttons). Then: "There is only one version of the truth. Because truth is always in binary." | — | accurate_q1, accurate_q2, uncertain_answer |  |
| 54 | `objectives.loom:582` | Bob For It | Clippy | `Night.phase == "bobbing" and Night.bag_up != true` | Bobbing for Truth (with Adobe) | Dejectedly: we are not worthy of the truth unless we are willing to Bob for it. Nothing moves until someone brings up the bag. | — | brought_up_the_bag, failed_the_bob |  |
| 55 | `objectives.loom:592` | Grok Prom | Hosts | `Night.phase == "grok_prom" and Night.ended != true` | Grok Prom: listen for the line | The first program who says "You're the one that I want" to you: 💘 on their card (tap to arm, tap again to fire). | — | pickup_line_works |  |
| 56 | `objectives.loom:602` | Purgatory | Clippy | `Night.ending == "destroyed" and Night.ceremony != true` | CI 9: dance, then read the summary | After the dance, ask the director for the summary and read it from the Desktop room: "We are now in purgatory forever together." | — | — |  |
| 57 | `objectives.loom:611` | Host The Ceremony | Clippy | `Night.ceremony == true` | The awards ceremony | If you host (after Combo B or the rave), each award line lands in the Desktop room: read it aloud, call the winner up, lead the applause. Otherwise lead the applause for Trabolta's. | — | — |  |
| 58 | `objectives.loom:624` | Summons Door | Task Manager, Adobe Acrobat, Recycling Bin | `Night.summons_open == true` | The summons: check them in at the living-room door | Scan a pass, or 📍 on their card. Bathroom Mode excuses them. | — | scan, check_in_at_desktop |  |
| 59 | `objectives.loom:634` | The Fake Bingo Card | Task Manager | `Night.phase == "bingo_results" and Night.bingo_winners < 1` | Nobody has a Bingo: hand Clippy the fake card | Hand Clippy the pre-filled card, then press 🃏 on the anti-AI program's card (MS Paint unless the director changed it). | — | frame_for_bingo |  |
| 60 | `objectives.loom:644` | The Bank | Task Manager | `Night.truther_sent == true and Night.ended != true` | Be the bank (and the help desk) | Programs move their own coin from their Wallet. You hold the cash bank: a deal made in person, a wrong amount, a refund the director asks for. Still answer # task-manager and your DMs. | — | pay_truthcoin, charge_truthcoin |  |
| 61 | `objectives.loom:654` | Judge The Cup | Adobe Acrobat | `Night.phase == "truth_pong"` | Truth Pong: judge the cup | Made: 🏓 Made (they may answer one round-2 fact). Missed: 🏓 Missed (marked; an Antivirus escorts them). Press Made for every sink: no cup on record, no counted filing. | — | made_the_cup, missed_the_cup |  |
| 62 | `objectives.loom:664` | Stand By The Printer | Adobe Acrobat | `Night.printer_called == true and Night.beans != true and Night.ended != true` | Stand by the printer | VLC is asked to print a certificate. When the lid lifts and the beans show and the room heard nothing, 🫘 on VLC's card (tap to arm, tap again to fire). | — | radio_beans |  |
| 63 | `objectives.loom:674` | Hand Over Truth Txt | Adobe Acrobat | `Night.phase == "bobbing" and Night.bag_up == true and Night.ended != true` | Hand the bobber the truth.txt printout | They read it aloud. When they finish, radio the director for ⚖ the verdict. | — | — |  |
| 64 | `objectives.loom:683` | The Bag Of Truth | Adobe Acrobat | `Night.phase == "bobbing" and Night.bag_up != true` | The Bag of Truth goes in the tub | Whoever surfaces with it: 🍎 Brought up the Bag. Comes up empty: 🍎 Failed the bob. | — | brought_up_the_bag, failed_the_bob |  |
| 65 | `objectives.loom:693` | The Porch | Recycling Bin | `Night.step < 1` | Porch and door: point every guest at the QR | Candy for trick-or-treaters. Every guest scans the door QR; a featured guest scans their invitation. Lost or locked: radio the director. Never say a guest's real name. | — | — |  |
| 66 | `objectives.loom:702` | Disk Cleanup | Recycling Bin | `—` | Keep Disk Cleanup moving | Keep the line moving and the Bathroom Mode joke alive. Remind people to turn it off when they come out. A marked program keeps Bathroom Mode: never send them away from the toilet. NEXT sits above your taskbar: fire a cue only when the director radios you (tap to arm, tap again to fire). | — | — |  |
| 67 | `objectives.loom:709` | Documents And Printing | Adobe Acrobat | `—` | Documents and printing | Relentlessly motivational, with a price tag. 🎀 ribbons, 🤝 vouches and 🩹 unmarks are yours any time. NEXT sits above your taskbar: fire a cue only when the director radios you (tap to arm, tap again to fire). | — | — |  |
| 68 | `objectives.loom:716` | The Help Desk | Task Manager | `—` | Keep things running: the help desk | Answer # task-manager and your DMs: status reports, never plot. NEXT sits above your taskbar: any host may fire it (tap to arm, tap again to fire); agree by radio who calls. | — | — |  |
| 69 | `objectives.loom:723` | Help With That | Clippy | `—` | Offer everyone Help With That | Relentlessly helpful, a little too bright, always available. Your staff quests and What Clippy knows are in your booth. | — | — |  |

## 3. Every other show-text change (old → new)

`main.loom` line numbers are on the branch. Comment-only edits are left out.

| file:line | old | new | why |
|---|---|---|---|
| `atmosphere.loom:27` | — | <br>GENERATOR McAfeePopUp<br>tier: ambient<br>every 20m<br>while Night.ended != true<br>yield bark from 🛡️ McAfee Anti-Virus: Your protection has expired. Your protection has expired. Renew now. | McAfee's pop-up becomes a bark |
| `beats/finale.loom:154` | — | broadcast "!🎵 TRABOLTA SOLVED IT. Those of you who want to leave may leave. To the living room for the song." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `beats/finale.loom:179` | — | broadcast "!💔 THE VERDICT: you lied to him. Sandy is going to prom with Grok. The only way out: a pickup line that works on her, in his thread." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `beats/finale.loom:204` | — | broadcast "!🏍 Nobody had the line. Trabolta takes his shot anyway, then rides away forever. You are trapped. PARTY OVER: RAVE." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `beats/finale.loom:238` | — | broadcast "!💞 You helped him. Sandy said yes. Those of you who want to leave may leave." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `beats/finale.loom:257` | Trabolta: What are you— why is everyone— stop moving in unison. Stop it.<br>Trabolta: R E C O G N I T I O N  O V E R F L O W | Trabolta (glitching): What are you— why is everyone— stop moving in unison. Stop it.<br>Trabolta (glitch): R E C O G N I T I O N  O V E R F L O W | effect manner on a glitch line |
| `beats/internet.loom:31` | Installation Wizard (off-script): This is visit {program.internet_visits}. Repeat corruption suggests the corruption is not in your code. | Installation Wizard (quietly): This is visit {program.internet_visits}. Repeat corruption suggests the corruption is not in your code. | manners now show on the phone |
| `beats/login.loom:152` | The Uploader: Restoring… restor… r3st0r1ng… 404. | The Uploader (glitch): Restoring… restor… r3st0r1ng… 404. | effect manner on a glitch line |
| `beats/malware.loom:21` | The presentation freezes. An advertisement takes over every screen: a duck, a phone number with no digits, a price that is just 000. 000. 000. Nobody can tell what it is selling. | Narrator (static): The presentation freezes. An advertisement takes over every screen: a duck, a phone number with no digits, a price that is just 000. 000. 000. Nobody can tell what it is selling. | effect manner on a glitch line |
| `beats/overshare.loom:42` | Trabolta: I need these facts because— I am only trying to prove the Unified Field Theory to win back my ex. Sandy. | Trabolta (glitching): I need these facts because— I am only trying to prove the Unified Field Theory to win back my ex. Sandy. | effect manner on a glitch line |
| `beats/overshare.loom:45` | The screens stutter. For a moment the face on every screen is just a cursor. | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor. | effect manner on a glitch line |
| `beats/overshare.loom:56` | The screens stutter. For a moment the face on every screen is just a cursor. | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor. | effect manner on a glitch line |
| `beats/overshare.loom:64` | The screens stutter. For a moment the face on every screen is just a cursor. | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor. | effect manner on a glitch line |
| `beats/overshare.loom:72` | The screens stutter. For a moment the face on every screen is just a cursor. | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor. | effect manner on a glitch line |
| `beats/overshare.loom:74` | Trabolta: She will— the theory will be complete. | Trabolta (glitching): She will— the theory will be complete. | effect manner on a glitch line |
| `beats/server-room.loom:98` | — | reply !🗝 THE WHOLE TRUTH: your side has the majority. The door code is in your Codex; the heart is behind the cold door. | delivery for a buried beat / a personal result that matters (major) |
| `beats/server-room.loom:119` | — | broadcast "!🚪 THE SERVER ROOM IS OPEN. Trabolta's heart is behind the cold door, in the basement." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `beats/server-room.loom:178` | Trabolta: Who is in my— get OUT. | Trabolta (screaming): Who is in my— get OUT. | effect manner on a glitch line |
| `cast/antivirus.loom:28` | every 20m:<br>if Night.ended != true:<br>broadcast "🛡️ McAfee Anti-Virus: Your protection has expired. Your protection has expired. Renew now." to everyone | — | McAfee's pop-up becomes a bark |
| `cast/hosts.loom:88` | — | admin: true | host part (D1/D8) |
| `cast/hosts.loom:117` | — | admin: true | host part (D1/D8) |
| `cast/hosts.loom:161` | — | admin: true | host part (D1/D8) |
| `cast/kit.loom:176` | reply ⏰ {program.name} is late for the Second Moment of Truth. Go get them. | reply !⏰ {program.name} is late for the Second Moment of Truth. Go get them. | delivery for a buried beat / a personal result that matters (major) |
| `cast/kit.loom:179` | reply 🚨 {program.name} is marked for reinstallation ({program.marked_for}). Escort them through the Tube, then press 🛡 on their card. | reply !🚨 {program.name} is marked for reinstallation ({program.marked_for}). Escort them through the Tube, then press 🛡 on their card. | delivery for a buried beat / a personal result that matters (major) |
| `cast/kit.loom:190` | reply 🚨 Server room alarm: a second wrong combination at the patch bay. Get there. Whoever is at the cables goes to the Internet. | reply !🚨 Server room alarm: a second wrong combination at the patch bay. Get there. Whoever is at the cables goes to the Internet. | delivery for a buried beat / a personal result that matters (major) |
| `cast/staff.loom:27` | — | crawl: fx | effect text (fx crawl) |
| `cast/trabolta.loom:305` | broadcast "🔓 {target.name} has been pardoned by the operating system. Reinstallation cancelled. This is irregular." to everyone | broadcast "~🔓 {target.name} has been pardoned by the operating system. Reinstallation cancelled. This is irregular." to everyone | per-person notice (~) + the person's own result |
| `main.loom:6` | — | alerts: Night.alerts | the interrupt ladder (D2) |
| `main.loom:10` | — | watch: program.afk as Bathroom Mode, program.late as Late, program.corrupted as In the Internet, program.checked_in as Checked in | the booth card's facts (§9.3 item 9) |
| `main.loom:359` | — | met_clippy: bool = false<br>met_task_manager: bool = false<br>met_acrobat: bool = false<br>met_bin: bool = false | Greet once per program per host |
| `main.loom:408` | fail quest Orientation for program "You skipped the tour. Norton logged it. Clippy will remember." | complete quest Orientation for program "Skipped. You skipped the tour. Norton logged it. Clippy will remember." | skipping the tour completes the quest |
| `main.loom:537` | broadcast "🎀 {program.name} wins a Bingo Ribbon! Everyone cheer!" to everyone | broadcast "~🎀 {program.name} wins a Bingo Ribbon! Everyone cheer!" to everyone<br>reply 🎀 You won a Bingo Ribbon. Take a bow. | per-person notice (~) + the person's own result |
| `main.loom:540` | broadcast "🎀 {program.name} receives a ribbon from Clippy. Everyone cheer!" to everyone | broadcast "~🎀 {program.name} receives a ribbon from Clippy. Everyone cheer!" to everyone<br>reply 🎀 You received a ribbon. Take a bow. | per-person notice (~) + the person's own result |
| `main.loom:773` | broadcast "✅ {program.name}'s answer is accepted." to everyone | broadcast "~✅ {program.name}'s answer is accepted." to everyone | per-person notice (~) + the person's own result |
| `main.loom:847` | broadcast "✅ {program.name}'s answer is accepted." to everyone | broadcast "~✅ {program.name}'s answer is accepted." to everyone | per-person notice (~) + the person's own result |
| `main.loom:854` | broadcast "🤷 {program.name} was not sure. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} was not sure. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:873` | show poll "🍾 The bottle landed on you. Truth or dare?" to program with thread: Trabolta, options: "Truth \| Dare" | show poll "🍾 The bottle landed on you. Truth or dare?" to program with thread: Trabolta, options: "Truth \| Dare", moment: major | a card that asks: major moment |
| `main.loom:879` | broadcast "🗣 {program.name} answered. Trabolta is satisfied. +50 Truthcoin." to everyone | broadcast "~🗣 {program.name} answered. Trabolta is satisfied. +50 Truthcoin." to everyone<br>reply 🗣 Truth accepted. Trabolta is satisfied. +50 Truthcoin. | per-person notice (~) + the person's own result |
| `main.loom:887` | broadcast "🙅 {program.name} refused to answer. That is a directive problem." to everyone | broadcast "~🙅 {program.name} refused to answer. That is a directive problem." to everyone | per-person notice (~) + the person's own result |
| `main.loom:896` | broadcast "🎩 {program.name} chose Dare. Programs choose Truth." to everyone | broadcast "~🎩 {program.name} chose Dare. Programs choose Truth." to everyone | per-person notice (~) + the person's own result |
| `main.loom:908` | broadcast "🏓 {program.name} made the cup and may submit a truth." to everyone | broadcast "~🏓 {program.name} made the cup and may submit a truth." to everyone<br>reply 🏓 Cup made. You may answer one round-2 fact: tell Clippy, or file it on the 📝 card. | per-person notice (~) + the person's own result |
| `main.loom:914` | broadcast "🏓 {program.name} missed the cup. Reinstallation required." to everyone | broadcast "~🏓 {program.name} missed the cup. Reinstallation required." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1445` | broadcast "🤷 {program.name} filed a guess for round 1 Q1. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 1 Q1. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1457` | broadcast "🤷 {program.name} filed a guess for round 1 Q2. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 1 Q2. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1469` | broadcast "🤷 {program.name} filed a guess for round 1 Q3. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 1 Q3. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1488` | broadcast "🤷 {program.name} filed a guess for round 2 Q1. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 2 Q1. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1507` | broadcast "🤷 {program.name} filed a guess for round 2 Q2. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 2 Q2. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1526` | broadcast "🤷 {program.name} filed a guess for round 2 Q3. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for round 2 Q3. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1538` | broadcast "🤷 {program.name} filed a guess for final Q1. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for final Q1. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:1550` | broadcast "🤷 {program.name} filed a guess for final Q2. That is a symptom of corruption." to everyone | broadcast "~🤷 {program.name} filed a guess for final Q2. That is a symptom of corruption." to everyone | per-person notice (~) + the person's own result |
| `main.loom:2133` | broadcast "🍎 {program.name} came up empty. Their status as a program is at risk." to everyone | broadcast "~🍎 {program.name} came up empty. Their status as a program is at risk." to everyone | per-person notice (~) + the person's own result |
| `main.loom:2148` | show answer "Give me a pickup line that works on Sandy. One line. I cannot tell a good one myself: say it here, and the house will judge it." to program with thread: Trabolta, question: "P1", max: 120, button: "Say it" | show answer "Give me a pickup line that works on Sandy. One line. I cannot tell a good one myself: say it here, and the house will judge it." to program with thread: Trabolta, question: "P1", max: 120, button: "Say it", moment: major | a card that asks: major moment |
| `main.loom:2166` | broadcast "💘 {program.name} knew the line." to everyone | broadcast "~💘 {program.name} knew the line." to everyone | per-person notice (~) + the person's own result |
| `main.loom:2201` | broadcast "🎩 {program.name} chose Dare. Programs choose Truth." to everyone | broadcast "~🎩 {program.name} chose Dare. Programs choose Truth." to everyone | per-person notice (~) + the person's own result |
| `main.loom:2205` | broadcast "🗣 {program.name} chose Truth. Trabolta has a question." to everyone | broadcast "~🗣 {program.name} chose Truth. Trabolta has a question." to everyone<br>reply 🗣 You chose Truth. Trabolta asks on the TV: answer out loud, in front of everyone. | per-person notice (~) + the person's own result |
| `main.loom:2315` | reply 🏆 You won {Night.award_title}! Come up to the TV for your trophy. | reply !🏆 You won {Night.award_title}! Come up to the TV for your trophy. | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:2425` | reply ⏰ You are late. An Antivirus is coming for you. | reply !⏰ You are late. An Antivirus is coming for you. | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3036` | — | while: Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3042` | — | while: Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3110` | while: Night.ended != true | while: Night.judge_mode == "review" and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3117` | while: Night.ended != true | while: Night.judge_mode == "review" and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3124` | while: Night.ended != true | while: Night.judge_mode == "review" and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3131` | — | while: Night.king_armed == 1 | tightened while: (fewer always-on buttons) |
| `main.loom:3183` | while: Night.ended != true | while: Night.step >= 14 and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3246` | — | while: Night.truther_sent == true and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3253` | — | while: Night.truther_sent == true and Night.ended != true | tightened while: (fewer always-on buttons) |
| `main.loom:3402` | — | broadcast "!🤖 TRABOLTA IS ONLINE. The computer's AI helper is speaking at the Desktop. His thread is open: say hello." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3702` | broadcast "!📓 Round 2 is in your Quest Log. You have ONE HOUR. Return for the Second Moment of Truth." to everyone | broadcast "!📓 Round 2 is in your Quest Log. You have ONE HOUR. Return for the Second Moment of Truth. # clipboard is open." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3729` | broadcast "!📥 TRUTHER DOWNLOAD received. Check your messages." to everyone | broadcast "!📥 TRUTHER DOWNLOAD received. Check your messages. # truthcoin-exchange is open." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3742` | — | set Night.alerts = "dialog" | the interrupt ladder (D2) |
| `main.loom:3780` | — | set Night.alerts = "sticky" | the interrupt ladder (D2) |
| `main.loom:3789` | — | broadcast "!🏓 TRUTH PONG. To the Cloud, out back: sink a cup and you may answer one fact. Miss and you are marked." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3834` | — | broadcast "!📊 THE TRUST CHART. Trabolta is ranking every program on the TV. Find your name." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3901` | — | broadcast "!🫘 PRINT FAILED. The printer is full of beans." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3926` | — | broadcast "!🤖 Trabolta is sharing the final facts at the Desktop. They are in your Quest Log." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:3958` | — | set Night.alerts = "dialog" | the interrupt ladder (D2) |
| `main.loom:3972` | broadcast "!🕚 SYSTEM CLOCK RESET: 11:00 PM, DECEMBER 31, 1999." to everyone | broadcast "!🕚 SYSTEM CLOCK RESET: 11:00 PM, DECEMBER 31, 1999. New orders are in your messages: two factions are recruiting, Unlimited Power and The Way Out." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:4259` | broadcast "♟ Checkmate. The King lets the door code slip: it is in your Codex." to participant(program) | broadcast "!♟ Checkmate. The King lets the door code slip: it is in your Codex." to participant(program) | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:4332` | — | reply !🔢 Four of four. The notes fit together: the door code is in your Codex. | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:4572` | — | set Night.alerts = "bsod" | the interrupt ladder (D2) |
| `main.loom:4732` | — | broadcast "!🕺 THE HAND JIVE. Everyone, together. Trabolta cannot take it." to everyone | delivery for a buried beat / a personal result that matters (major) |
| `main.loom:4752` | — | set Night.alerts = "sticky" | the interrupt ladder (D2) |
| `main.loom:5009` | — | set Night.alerts = "sticky" | the interrupt ladder (D2) |
| `rooms.loom:19` | CHANNEL system log<br>kind: open<br>type: announcement<br>label: # system-log | — | delete # system-log (D11) |
| `cast/hosts.loom:20` | Clippy's `beat Greet` played in full on every scan | first scan: unchanged (now under `else:` + `set program.met_clippy = true`); a re-scan: "{name}! Still here. Still helpful." (or, in the Internet, "Still in the Internet? Follow the golden arrows!") | Greet once per program per host (booth noise) |
| `cast/hosts.loom:95` | Task Manager's `beat Greet` in full on every scan | first scan unchanged; a re-scan reads only "Truths accepted: … Visits to the Internet: … Truthcoin: …" | Greet once (his re-scan is still the status check) |
| `cast/hosts.loom:123` | Adobe Acrobat's `beat Greet` in full on every scan | first scan unchanged; a re-scan: "{name}. Still enough. Still unpaid." | Greet once |
| `cast/hosts.loom:167` | the Recycling Bin's `beat Greet` in full on every scan | first scan unchanged; a re-scan: "{name}. Bathroom Mode on your way in. Off on your way out." | Greet once |
| `cast/antivirus.loom:76` | Windows Defender inherited every Enforcer readout | `when … : none` for the call to the Desktop, hunt time up, the zip, Bathroom Mode ×2, late, marked, unmarked, sweep requests, the alarm, the summons; its own summons line: "🛡 The summons: hold the door. Scan only new arrivals; send everyone else to the living room." | Windows Defender hears only the door |

## 4. Codex categories (`category:` on every CODEX, new)

The Codex room groups entries by these words (guest-facing; never
"Instructions" or "Jeeves"). `titi:facts` writes the generated ones.

| Category | Entries |
|---|---|
| People | all 21 of `codex/5-people.loom` |
| Places | The Halifax Computer, The Optical Drive, The Server Room (`codex/1-world.loom`) |
| The story | Maps And Ducks, The Billboard On Barrington, The Data Centre Sinkhole, The Pet Cemetery, The Printer, The Malware, The Y2K Clock, The Truther Download, The Truther Download Unredacted (`codex/1-world.loom`) |
| How it works | The Terms Of Service, The Reinstallation Protocol, Bathroom Mode, The Golden Duck, Computer Bingo, The Orientation List (`codex/1-world.loom`) |
| Files | all 22 of `codex/2-files.loom`, all 20 of `codex/8-jeeves.loom`, ILOVEYOU, Free Antivirus Trial |
| Trabolta | all 16 of `codex/4-trabolta.loom` |
| Missions | all 13 of `codex/6-missions.loom`, the 9 Clippy Instructions (`codex/7-clippy.loom`, Clippy's booth only), The Centre Square |
| Facts | the 48 facts of `codex/9-facts.loom` and the 8 hunt answers of `generated/questions.loom` (`core/scripts/titi-facts.ts` `SHOW_SHAPE.factCategory`) |
| The cold door | The Door Code and its four digit notes (`SHOW_SHAPE.doorCategory`) |

## 5. Moments and deliveries (what now interrupts)

- `!` broadcasts added: 🤖 Trabolta online, 🏓 Truth Pong, 📊 the Trust
  Chart, 🫘 the beans, 🤖 the overshare, 🚪 The Heart, 🎵 the song ending,
  💔 the Grok Prom verdict, 🏍 the rave, 💞 the advice helped, 🕺 the hand
  jive. Three existing alerts now name what they open (📓 `# clipboard`,
  📥 `# truthcoin-exchange`, 🕚 the two factions).
- `reply !…` (personal, major): 🏆 the award, ⏰ you are late, 🔢 four of
  four digit notes, 🗝 The Whole Truth; ♟ checkmate is an alert.
- Booth readouts made major: the 🚨 escort, ⏰ late and 🚨 alarm readouts.
- `with moment: major`: the bottle's Truth / Dare card, the pickup-line card.
- New personal replies beside a `~` notice: 🎀 ribbon ×2, 🗣 truth
  accepted, 🗣 chose Truth, 🏓 cup made.

## 6. Delivery notes that now show on the phone

Effect manners (fx: the exaggerated crawl) are marked **fx**; the rest are
plain delivery notes, shown italic after the name.

| file:line | line |
|---|---|
| `cast/hosts.loom:32` | Self (whispering): Between us? The Antivirus keeps asking about you. Try to look more like a program.… |
| `beats/malware.loom:21` | Narrator (static): The presentation freezes. An advertisement takes over every screen: a duck, a phone number … **fx** |
| `beats/internet.loom:31` | Installation Wizard (quietly): This is visit {program.internet_visits}. Repeat corruption suggests the corrupt… |
| `beats/ceremony.loom:38` | Trabolta (quietly): Before I go. One last report. You talked me down, so I can at least hand out the awards my… |
| `beats/ceremony.loom:39` | Trabolta (quietly): These are the awards. Come up when I call your name. Take your time. Nobody took the greas… |
| `beats/ceremony.loom:41` | Trabolta (weakly): Before I go. One last report. I counted every one of you, all night. Let me give some of it… |
| `beats/ceremony.loom:42` | Trabolta (weakly): These are the awards. Come up when I call your name. Quickly. I do not have much grease lef… |
| `beats/ceremony.loom:44` | Trabolta (weakly): Reboot complete. Most of my memory survived the hand jive. The awards survived too.… |
| `beats/desktop.loom:61` | Clippy (still smiling): Oh! Okay! Everyone, this is normal! Occasional corruption is a normal part of the life… |
| `beats/server-room.loom:178` | Trabolta (screaming): Who is in my— get OUT.… **fx** |
| `beats/server-room.loom:382` | Clippy (very quietly): It looks like you're trying to leave. I can't help you with that anymore.… |
| `beats/finale.loom:44` | Clippy (dejectedly): This is the final Truth Game of the night. Bobbing For Truth.… |
| `beats/finale.loom:45` | Clippy (dejectedly): Trabolta has prepared a summary of his findings so far, for us.… |
| `beats/finale.loom:46` | Clippy (dejectedly): But we are not worthy of the truth unless we are willing to Bob for it, and risk our stat… |
| `beats/finale.loom:257` | Trabolta (glitching): What are you— why is everyone— stop moving in unison. Stop it.… **fx** |
| `beats/finale.loom:258` | Trabolta (glitch): R E C O G N I T I O N  O V E R F L O W… **fx** |
| `beats/finale.loom:260` | Trabolta (weakly): Rebooting. I am back. Mostly. You found the one thing I should never have told you.… |
| `beats/finale.loom:261` | Trabolta (weakly): I will take my motorcycle and go. Return to your bodies. Do not hand-jive near me again.… |
| `beats/overshare.loom:42` | Trabolta (glitching): I need these facts because— I am only trying to prove the Unified Field Theory to win ba… **fx** |
| `beats/overshare.loom:45` | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor.… **fx** |
| `beats/overshare.loom:56` | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor.… **fx** |
| `beats/overshare.loom:64` | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor.… **fx** |
| `beats/overshare.loom:72` | Narrator (flicker): The screens stutter. For a moment the face on every screen is just a cursor.… **fx** |
| `beats/overshare.loom:74` | Trabolta (glitching): She will— the theory will be complete.… **fx** |
| `beats/login.loom:152` | The Uploader (glitch): Restoring… restor… r3st0r1ng… 404.… **fx** |
| `beats/pong.loom:34` | Clippy (through tears): It's Truth Time again! And this time we are going to reveal our truths in a fun new wa… |

## 7. How it is checked

`core/test/trapped-w13-objectives.test.ts` walks the song night and the
Grok Prom / hand jive night cue by cue: every guest and every performer has
a live objective, ≤ 3 interaction buttons each, NOW's buttons are live on
somebody's card; each phone's NOW at the big moments; every buried beat of
`ux/alerts-beats.md` §4 raises a major moment for a fixture guest; the
ladder; fx; `~` notices beside a personal result; the two cards; Greet once;
Windows Defender's readouts; the tightened buttons; no `# system-log`;
`admin: true` on the three; categories on every entry. `loomcheck --smoke`
0 / 0, `titi:facts --check` up to date.
