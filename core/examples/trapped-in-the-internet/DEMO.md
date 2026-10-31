# Demo — the Oct 31 WIP in 20–30 minutes

> **A demo, not the show.** For the night itself use
> [`SHOWNIGHT.md`](./SHOWNIGHT.md) and [`TECH.md`](./TECH.md).

How to show *Trapped in the Internet* as it stands on master (through wave 22,
2026-10-24) with **2–4 phones and one laptop**. It plays the
night from the door to an ending and the awards, compressed: every timed
stretch (Bingo's 20 min, the hunts, the hour, the Y2K hour) is skipped by
firing its cue by hand. It runs on **https://app.mapsandducks.com** once
the pending ship has landed (below); until then the VPS plays the older
`w56` story, and some steps here won't match it.

The cue order below is pinned by a test: `core/test/trapped-in-the-internet.test.ts`
→ *the WIP demo (DEMO.md)* drives it with three phones to both endings. If you
change the order here, change it there.

## Before you start (once)

1. The VPS runs a current release (`scripts/ops/ship.sh <tag>`, the server
   **before** the sync; as of 2026-10-31 it runs `w56`, and wave 58 reaches it
   only with the next ship and a `sync-show`, see [`SHOWNIGHT.md`](./SHOWNIGHT.md) §1); featured programs join only
   with their invitations; the cue sheet refuses 📺 until all three 📋 are read and
   while the bottle is open), and the show's story is in your
   server project: `LOOM_SSH=loom-vps pnpm sync-show` (with
   `LOOM_PROJECT="<your project name>"` if it isn't *Untitled Project*;
   since wave 9 it refuses to reload a **live** event with real guests,
   exit 3; a rehearsal or preview always reloads).
   The sync carries `facts.json` (the hunt questions, the facts and the
   judge's answer key) and the house maps with the story.
2. On the laptop, open **https://app.mapsandducks.com/edit/**, sign in, open
   the project, press **⌘2** (Run). If a run is already going and you want a
   clean night: header **↺ Restart ▾ → Restart this draft** (or **⇪ Push
   current draft** if the story changed since it started). Otherwise **▶ Start
   rehearsal**. A rehearsal is fine for a demo: phones join it with the same
   codes a live event uses.
3. The **Run page** shows three codes. Write them down:
   - **Event code** — guests (and its QR: point the phones' cameras at it).
   - **Performer code** — the cast's phones.
   - **Moderator code** — the TV, the tent laptop and the Server Door terminal.
4. Open two more tabs on the laptop (or a second screen):
   - **The TV**: `https://app.mapsandducks.com/terminal/?code=<moderator code>&name=TV&character=Trabolta&view=tv`
     (the living-room screen: screensaver, then Trabolta's face, the slides, the live Trust Chart, the overlays).
     **Click the TV tab once** ("🔇 CLICK ONCE TO ENABLE THE VOICE"): a browser
     keeps a page silent until someone touches it, so Trabolta's TV voice is
     mute until you do.
   - **The tent laptop**: `https://app.mapsandducks.com/terminal/?code=<moderator code>&spot=tent`
     (wave 18b: the map's tent spot makes it the reinstallation station, `view: reinstall`;
     never add `&view=reinstall`. The idle show between walks, a ☣ *IN THE INTERNET NOW*
     strip over the scan box, then the wizard and the game for a marked pass; keyboard
     WASD / arrows, Q/E turn, Shift runs; ⚔ / Space hits the King, once per visit. An
     unmarked pass reads PROGRAM NOT MARKED. The old standalone
     `/reinstall/?code=<moderator code>&name=Tent laptop` still works.)
   - *(Optional)* **The Server Door terminal**: `https://app.mapsandducks.com/terminal/?code=<moderator code>&name=Server Door&spot=server-room-door&view=chess`
     (THE KING, his bar, the scanner: hold up a phone's pass and play him;
     there is no chess on the tent laptop any more).
   - *(Optional, wave 20)* **The server-room terminal** (Trabolta's heart):
     `https://app.mapsandducks.com/terminal/?code=<moderator code>&spot=server-room&door=sim`
     on a laptop with a keyboard and a webcam. `door=sim` fakes the door sensor:
     **O** opens the door, **C** shuts it, **F** throws a sensor fault (the real
     rig is `door=serial` and the Grand Central M4; a mouse-only rig adds `&keys=0`).
     It sleeps until The Heart opens the room. Wave 20 reaches the VPS only
     with the next ship and a `sync-show`.
5. Optional: Trabolta's voice. Start stagehand's `agents` worker on the
   laptop (`uv run stagehand run --config <machine>.yaml --only agents`,
   see `stagehand/README.md`). Without it, DMs to Trabolta get his hold line
   ("Jean Trabolta is not responding…") after ~20 s, and you can answer as
   him from Run (👁 identity → Trabolta, then type in his thread).

## Who holds what

| Device | Signs in as | How |
|---|---|---|
| **Phone A** | a guest: **Microsoft Excel** (a featured program: he gets a secret mission at the Truther Download) | scan Excel's **invitation** QR (Run → **🖨 Print sheet…** → Invitations; it carries the event code and Excel's claim) → *Microsoft Excel*. The nine featured programs are 🔒 Reserved: without the invitation the picker refuses them. No printer? Tap **🔓 lost? open 2 min** twice on Excel's invitation, then join with the event code and pick *Microsoft Excel* within two minutes. |
| **Phone B** | a guest: **MS Paint** (featured: the night's anti-AI program, the first one sent to the Internet) | same, with MS Paint's invitation (or its 🔓) |
| **Phone C** (optional) | performer **Norton Anti-Virus** | **I'm a Performer** → performer code → pick *Norton Anti-Virus*. She scans passes at the door and sends programs to the Internet; a program *marked* for reinstallation shows up as an escort task pinned in her `# quarantine` (with a chime) until he presses 🛡. |
| **Phone D** (optional) | performer **Clippy** | performer code → *Clippy*. She judges answers spoken in the room (✅ / 😤 / 🏓 / 💘) and settles the bottle (🗣 / 🙅) on a guest's card; filed facts are judged by the server. |
| **Laptop** | the director | Run (cue sheet), plus the TV tab and the tent-laptop tab |

Two phones only? Skip C and D: in Run, the **👁 identity control** lets you
*be* Norton or Clippy (the performer's booth, their buttons on each guest),
and the guest's **Inspector** scans them in as Norton (the *— scan as
character —* menu → *Norton Anti-Virus* → **Scan**). Add a third guest
(Calculator, any pool program) if you have the phone: three programs make
the Trust Chart and the majority read better.

Every cue below is a button on **Run → Director → cue sheet** (in running
order; LAST / NEXT track where you are). The timer cues you fire by hand
here (C2 ⏰, 📥, ⏳, 🚨) are off-sequence, so NEXT stays empty while a timer
owns the night and comes back after them (V6, then 🏓). A cue pressed a
step early does nothing but say why in `# hosts`. A **performer button** is on the
guest's card in that performer's booth (phone C / D), or in Run while you
*are* that performer.

## The run, step by step (≈ 25 min)

### Act 0 — the door (5 min)

| Do | What the phones show |
|---|---|
| Phones A, B join (event code → pick the program). | A dark full-screen **cutscene**: The Uploader in the Optical Drive (the mud room). |
| Each fails the **CAPTCHA**: tap any squares → VERIFY. (Getting it *right* proves you're human: INCORRECT, try again.) | "CORRECT. You failed at once." |
| A pool program (Calculator) picks a problem; everyone picks **Deposited** / *I have nothing to leave*. After *Deposited* an optional card asks *What did you leave in the deposit box?* (type it, **Leave it behind**; wave 18b: it is secret, and only that program's own *Your File* quotes it at the end). | *100 Truthcoin credited*, then a **pass** (QR) on the stage: "An Antivirus will scan you in." |
| **Norton** (phone C's **Scanner**, or Run → the guest's Inspector → *scan as character* Norton → **Scan**) scans each pass. | "Scanned. … free of viruses." The Tube, the Desktop; the house rooms and `# task-manager` open quietly (wave 18b: no "open now" notice). Each program also gets its **Connections** ties from The Uploader (*"Cross-referencing your files…"*). **Continue** leaves the cutscene for the chat app. Clippy's **orientation tour** opens (Next / Skip). Excel and MS Paint get their human memories (identity + their own two red facts) in *The Uploader*'s thread; MS Paint gets *The Centre Square*. |

### Act I — the Desktop (8 min)

| Cue (Director) | Performer | What you see |
|---|---|---|
| **C1/V1 · 📣 Call everyone to the Desktop** | — | 🔔 alert on every phone (`# task-manager` has been open since the door scan); the TV leaves the screensaver. |
| **V2 · 🎱 Start Computer Bingo (20 min)** | — | Clippy's script in *The Desktop* room (wave 58: *"Welcome, everyone, to the Desktop!"*), the Bingo Card quest, the TV's Bingo slide (a text placeholder) + corner countdown. |
| **V3 · ⏰ Bingo time: results** | Clippy: **🎱 Bingo winner** + **🎀 Award a ribbon** on a guest (Calculator). Norton: **🛡 Send to the Internet** on **MS Paint**. | 🎀 broadcast; Norton's line to MS Paint ("you did not agree to be ruled by AI"); **Corrupted Code** (Clippy: "Nothing to worry about, everyone!"). Phone B: "⛓️ You've been taken to The Internet", the **Installation Wizard**'s reinstallation instructions. |
| *(tent laptop)* | — | On the laptop's tent tab: **MS Paint** is in the red *IN THE INTERNET NOW* strip (☣ MS Paint) → tap it (no headset online, so the game starts at once; with one online, **Play here**) → follow the golden chevrons to **Gerald, the golden duck** and walk into him. Phone B: "Reinstallation complete", *The Golden Duck*. (The map is the 3-floor placeholder of the house; the tent is out back.) |
| **Clippy 2/X · 🎤 Clippy tells the room about Trabolta** | — | Wave 58: her paragraph on her teleprompter, ending *"Trabolta, would you explain the rules?"*. (**📺 Follow the reinstallation** first, only if a program is walking: the TV shows them.) |
| **Clippy 2/X · 🤖 Trabolta comes online** | Task Manager: the 🤖 Talk card, after his sign-off. | Trabolta appears in everyone's People list and DMs ("Hello, … I am Jean Trabolta, Sole Owner and Founder of Maps and Ducks…", his green grinning picture); the TV flips to his face for his speech, the three questions and his sign-off, about three minutes, then the mirror of the house. |
| **V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)** | — | Nothing is said: he has said it. Hunt One in the Quest Log; a **📝 File a fact** card in each Trabolta thread. A filing on H1–H3 isn't recorded until their answers are in. |
| **C2 · ⏰ Hunt over** → **V6 · ⚖️ First Moment of Truth** | — | 🔔 "Last chance: file your round-one facts with Trabolta. Two minutes." Phones A/B can file an answer on the **📝 File a fact** card (pick the question, type it, set the confidence slider; wave 18b: *File it* with the slider unset points at it in red). An exact match is judged at once in `# hosts`; anything else goes to **Trabolta's judge** when the worker runs (*… asked Trabolta to rule*, then *🤖 Trabolta ruled …*), and without the worker it stands as proposed (the phone only hears "Your fact is in the record"). |
| **⏱ Close round-one filings now** → **📋 Results: the next question** (press it three times: Q1 now, Q2 and Q3 at the top of Act II; 📺 waits for all three) | Clippy: **✅ Q1** on Calculator, **😤 Q2** on Excel (a confident lie spoken in the room: accepted, looks identical). | **Trabolta reads** question 1's result on the TV (wave 18b: nobody filed / CONSENSUS / *"I will read what you told me."* and every filing, then the accepted and guess counts), and the TV shows each filer's row with SURE / NOT SURE, ACCEPTED / GUESS and his ruling's 🤖 stamp (the walls only the counts). Every filing for it is settled: +50 to the accepted ones, a guess is marked for reinstallation. A refused press (a fourth 📋) lands in `# hosts`, never on the guest's phone. |

### Act II — the malware and the hour (7 min)

| Cue | Performer / phones | What you see |
|---|---|---|
| **📋** for Q2, then **📋** for Q3 (Clippy: *"That's all three! … TRUTH OR DARE."*) | — | Trabolta reads both on the TV, as Q1. |
| *(optional)* **🍾 Spin the bottle** (wave 18b: after all three results, before 📺; NEXT offers five spins) | Clippy: 🗣 *Truth answered* / 🙅 *Truth refused* on the picked program. | Trabolta names a program not picked tonight on the TV ("…Truth or dare?"); their phone gets Truth / Dare. Dare or a refusal marks them for reinstallation; Truth asks Trabolta's personal question on the TV. |
| **📺 Preview hunt 2 → the ad hijack** (refused in `# hosts` until all three results are read, and while the bottle is open) | — | 🔔 **000. 000. 000.** alert on every phone + the ad on the TV. Clippy's booth (phone D) gets Trabolta's private "we are all going to die". Everyone else: "A minor irregularity…". |
| **📓 Hunt 2 → quest logs; disperse for 1 hour** | — | Hunt Two quest; `# clipboard` opens. |
| **📥 Truther Download (auto at +2 min)** — fire it now | **Phone A (Excel)** answers the choice in *Truther Download* (sabotage or paranoid). | 🔔 "TRUTHER DOWNLOAD received"; `# truthcoin-exchange` opens; each program gets its glitch beat; Excel becomes *Unlimited Power*'s leader (still hidden) with a mission. **Founding opens** (wave 18b): any phone may now found a faction of its own from **⊞ Start → Factions** and sees only its own count (*1 in · N more to win*); the count starts at 🕚. |
| **⏳ Five-minute warning** → **🚨 Summons closed** → **🏓 Truth Pong** | Norton scans anyone at the Desktop during the warning (a check-in). Clippy: **🏓 Made the cup** + **✅ Q1** on Calculator. | A guest not checked in gets "⏰ You are late" and Norton's booth "Go get them". |
| **🧮 Trabolta tallies round 2** → **📊 Trust Chart** | — | 🧮: round two settles and Trabolta welcomes them back; he reads no answers yet (wave 59a). 📊: **the TV draws the Trust Chart live**: every program, ranked by trust. |
| **🏆 Praise the top, humiliate the bottom, VLC prints** → **🫘 Printer opened** | — | Praise / shame by name with **MOST / LEAST TRUSTED** called out on the chart, the certificate ask, then *Full Of Beans*. |
| **🗜 Antivirus zip everyone out** → **🤖 Trabolta shares the next facts** | — | Captives zipped out; an overshare (scenario 1–4 by what Excel / OpenOffice did), round two's answers, the leaderboard and the three final questions; The Final Facts quest. |
| **🕚 System clock → 11 PM, 31 Dec 1999** | **Factions** (⊞ Start → Factions) now lists Unlimited Power and The Way Out beside every founded faction: Phone B can **Join** one or found her own; Excel leads Unlimited Power and stays with it. | 🔔 the clock alert; the TV becomes the Y2K clock; Excel's Final Orders. The count starts now: more than half of the programs still here in one faction wins. |

### Act III — pick one ending (3–5 min)

**A · The server room (Combo A)** — the shortest, loudest one.

1. Get a majority: **Phone B** (MS Paint): **⊞ Start → Factions → Join The Way Out**
   (or found her own faction and recruit Calculator by scanning his pass). **Phone A**
   (Excel) leads *Unlimited Power* and can't leave it (wave 18b: leaders stay with their
   side; the leader-task gate is gone). With three programs nobody holds half + 1 alone, so
   fire **🗳 Force the majority: The Way Out** (or **🗳 Force the majority: this program's
   faction** naming a member of a founded one).
   Members get the whole truth (50+ codex entries, *The Legendary Fact*, and *The Door Code* last) and The Server Room appears on their phones.
   *(Optional; any time once Trabolta is awake)* **open the door** (**O** on the `door=sim` terminal, or **🚪 Server room door opened**) → **The Heart** (wave 20): The Server Room opens on every phone (a quiet notice), the terminal wakes in red, and Trabolta asks for the door shut; leave it open and he nags at 15 s, then every 20 s. Shut it (**C**, or **🚪 Server room door closed**) → *Show it your pass*. Hold a phone's pass to the webcam → **WHO ARE YOU** docks on the terminal: click through the layers. Open the door mid-talk and the options grey out under *CLOSE THE DOOR* until it is shut. A 🚪 press hands the door to the buttons (*Door on buttons* on the glance) until **🚪 Trust the door sensor again**; 🔄 seals his heart for the next demo.
2. **🔌 Patch: Combo A** → every phone: 🔔 **GO TO THE LIVING ROOM**; the TV: blackout, then the flashing overlay; 10 s later the dance look.
3. **G0 · 📜 The full truth** after the dance — Task Manager's phone pops up with the message Trabolta left before he died (*Read this out loud*). Nobody else's Chats carry it. Everyone is released, the house lights come back, and the TV holds TRABOLTA.EXE (Not Responding). He does not come back.
4. **G1** once the reading is over (a press before that asks first; press again inside 30 s to go on): Clippy hosts every row.

**B · The verdict (the full truth → the song → the rave)**

1. **🎆 Midnight** → the final reveal (lights down): Clippy has the room, then **🌑** again (or her arrow past her last line) and Trabolta reads the final answers. **🍎 Bobbing for Truth** → Adobe Acrobat's or Clippy's **🍎 Brought up the Bag of Truth** on a guest.
2. **📄 Read truth.txt** (the slide holds while the bobber reads), then **⚖ truth.txt read → the verdict**: Trabolta reads the full truth on the TV, about 12 minutes.
3. The last answer decides, by itself. Someone found it: his news. Nobody did: his speech, then every phone gets the card *"What should I say to her?"*, for two minutes (**💬 Close the pickup lines now** ends them early); he reads every line, goes, and comes back with his news. Either way he leaves, the song plays and the rave follows.

**Then the ceremony (2 min)**: **G1 · 🏆 Start the awards ceremony** (wave 18b: *The Night In Review* plays first, the host reading who everyone really was, and each phone gets its private *Your File* in The Uploader's thread), then e.g.
**G2 · 🥇 Most Trusted** with the winner picked in the cue's *who?* box (the
top of the Trust Chart). The winner's phone: "🏆 You won Most Trusted!"; the
host's line in *The Desktop*; the TV's award slide (text only).

**The recap**: the Run page's **Recap ↗** link (under the codes) opens it as
text in a new tab, signed in as you: trust, truths and lies accepted,
Internet trips, codex, quests, Truthcoin, factions. (By hand it is
`https://app.mapsandducks.com/e/<event id>/api/mod/recap?format=text`; the
event id is the one `pnpm sync-show` prints as `✓ event <id>`.)

## Resetting between demos

Header **↺ Restart ▾ → Restart this draft**: the story starts again from the
top, the codes stay, joined phones are signed out (they land on the join
screen with a note). Performer booths stay signed in (only **Go live** signs
them out).

## What is built but not in the cue order above (show it if there's time)

- **The King** (wave 11): in both reinstallation games a gold chess king guards the server-room door of the virtual house with **one health bar shared by everyone all night** (15 points, `Night.king_hp`; each program may hit him once per visit, the server takes the point off, `# hosts` hears every hit; 👑 *Restore the King's health* puts him back). His **chess** is only on the wall terminal outside the real server-room door: scan a pass, play, no hints, and the lower his bar the worse he plays. Mate him and the terminal fires `chess won` for that program: the winner gets *The Door Code* in their Codex any time before 📄 truth.txt, exactly as **♟ They beat the King** (naming the winner) does. The real door has a standalone keypad lock nothing in the house drives.
- **The guest's phone** (wave 11): **📷 Scan** in the header and the Codex composer reads a wall QR inside the app (a QR scanned with the Camera app into another browser lands on *Type X into your Codex in the app you joined with*); the clocks Clippy announces (Bingo, hunt 1, the last-chance filing, the summons, midnight) tick in a strip under the room header; the 📝 card's confidence slider starts unset; a mistyped right answer is a **near miss** a director judges on Run → Mind → Judging (⚠ in `# hosts`). Buttons with no way back (🔌 💥 ❌ 🚪 🔧 ♟ 🍎 🫘 💘, the guest's 💾) arm on the first tap and fire on the second. *(Wave 13: 📷 Scan sits on the bottom taskbar and the soonest clock in its tray; the story's buttons and Bathroom Mode are under ⊞ Start.)*
- **Trabolta rules on every answer that isn't exact** (wave 11b near misses; wave 18b every non-exact filing): with the laptop's worker running, file *Grko* for F2 at 100 on Phone A's 📝 card, and something plainly wrong on Phone B's. `# hosts` says *… asked Trabolta to rule* for each, Run → Mind's Judging card reads *🤖 queued for Trabolta* / *🤖 asking Trabolta…* (one at a time, after any guest's DM), and a few seconds later *🤖 Trabolta ruled …: the same as the key (accurate).* with his reason; the card lists each ruling with ✅ / 😤 / 🤷 to override it, and 📋 shows his 🤖 stamp on the TV rows. What he hasn't ruled by 📋 falls back to the house rule. The call is a **judge** row in the Mind trace.
- **The digit notes** (wave 11): four secret QR notes, one digit of the door code each, hidden in four rooms (the silver pile in `generated/print-stacks.md`). Scan them all night; the quest *The Cold Door* counts them, and the fourth puts *The Door Code* in the Codex.
- **The Wallet**: every phone has a pinned **Wallet** room (🪙 balance on the pass): send Truthcoin to another program, request it, or trade coin for a codex entry (an escrowed offer the other side accepts). Every third transfer waits for **Approve** in CRA Agent Software's booth (wave 18b: both phones read *🚩 Flagged for a CRA audit — MyCRA must approve it.*) (sign a fourth phone in as her: the editor's performer lens doesn't show a booth's Wallet room yet, though Run's operator view lists the pending transfers as text); any transfer can be denied within 60 s. Runescape's phone can mint a stimulus to everyone (three a night). The hosts' 🪙 Pay / Charge buttons are corrections only. A local-folder rehearsal has no wallet — use the server project.
- **facts.json is the team's file**: the hunt questions + answer key, the Desktop's scannable facts (main / trabolta / character), the Truth-or-Dare questions and the pickup line all live in `core/examples/trapped-in-the-internet/facts.json`; `pnpm --filter @loom/core titi:facts` regenerates the story files from it. The server judges every 📝 filing against it (`Night.judge_mode` = `auto`; switch to `review` on Run → Mind's Judging card to confirm each verdict by hand). Rehearse filings on the server project: a folder run has no judge.
- **Marked for reinstallation**: 🎯 / 🤷 / 🎩 / 🙅 / 🏓 missed / 🍎 failed / a guess at settle / a late program no longer capture on the spot. The phone greys out (DMs and the Tube / Internet rooms only) with a pinned 🚨 GO TO THE INTERNET card; the Antivirus booths chime and `# quarantine` lists who to escort. 🛡 captures; **🩹 Unmark** (any host or Antivirus) undoes a mis-tap.
- **The Installation Wizard** (Julia's voice, not a part) runs the tent in the backyard through the tunnel; her lines are the tablet video's script in each captured program's thread. **Task Manager** is every program's main contact from the door scan (`# task-manager` and his DMs; answer as him from Run). Clippy's tour has a **Bathroom Mode** step.

## What is not built yet (say so on the day)

- **The house map is a placeholder** (3 floors + the tent, not measured; K-28). The game walks it fine; the rooms won't line up with the real ones yet.
- **No hardware in the loop**: the server-room door (🚪), the patch bay and the printer button are the admin fallback buttons on the cue sheet; the door code comes from the King at the door terminal or the four digit notes (above), with ♟ as the fallback. The ESP32 firmware (the patch bay) and the M4's door-sensor firmware (wave 20) exist but aren't wired to the VPS demo (`door=sim` fakes the door), the server room's RGB bulb needs the house Mac's `lights` module and Zigbee2MQTT, and the keypad lock is a real lock on a real door.
- **VR headsets** aren't part of this demo (the Quest build exists; a headset runs the same game, the King's shared health bar included).
- **Trabolta's voice needs the laptop worker**; without it he has his hold line and a director answers as him.
- **TV slides are text placeholders** (no artwork yet: "CEREMONY", "AWARD MOST TRUSTED"); the award slide doesn't name the winner — the winner's phone and the host's line do. Only the Trust Chart is drawn for real.
- **H1–H3's answers are owed** (wave 58): the three questions are the Oct 30 script's, and their keys are stand-ins that no screen shows. The character facts quote the invitations' real-world details (the team's call before printing).
- Not built: the tablet bench (K-02), the live tent run (K-03), the live mind run (K-04), the cellular sheet (K-07), K-31b, the printed QR posters on the walls (the Run page's 🖨 Print sheet makes them; the Desktop's piles are `generated/print-stacks.md`), cast-pack rehearsals.
