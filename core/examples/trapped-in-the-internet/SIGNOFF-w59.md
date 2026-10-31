# SIGNOFF — wave 59: the notes from the live run

**Status: DRAFT.** Branch `oct31-w59/story`. Not shipped. The map of the wave is
[`docs/loom-w59-contract.md`](../../../docs/loom-w59-contract.md).

You ran `w56` on the live server and sent a list. Your words win over everything
below. No code, combination or hunt answer is written on this sheet. `▒▒▒` stands for
a word that is also a code.

## 0. What needs you before 12:00

1. **The go on §2.** Those seven are calls we made for you, each with its cost. Say the
   word and any of them changes.
2. **The words on §4.** Every line we wrote is marked `DRAFT w59` until you sign it.
3. **H1–H3's answers,** still owed from wave 58. `titi:facts` and `loomcheck` warn about
   all three, and none of their gold cards can print until its answer is in.
4. **Two small word calls** on §3: N-47 (Clippy's Cloud aside) and N-48 (the Casino's room
   tone).

The biggest open risk: **no real phone, printer, camera, tablet, iPad, Quest, TV or
voice has met any of this** (§5). Nothing here has run through a real `sync-show` or on
the VPS.

## 1. Your notes, and where each landed

| Your note | Where it landed |
|---|---|
| Text codes on every QR, so people without a scanner can still "scan" | Every printed QR has one, and typing it does what scanning does. The digit notes' codes hold no digit, checked on the real file |
| No out-of-world names like "Kitchen" | Everything printed, every guest and wall screen and Trabolta's facts read the story's names. Crew tools keep the real room |
| Can the story change up to opening without breaking the QRs? | **Yes.** 982 printed links and codes, none moved after text, objectives and beat order changed through a real reload. §6 has what does break a card, and `titi:qr-lock` guards it |
| Filter strength: only a slider, no explanation | Done. The only words are the window's title |
| Chat rooms shouldn't be available until their beat | Done for everyone, hosts and directors too. Booths also lose hidden places until they open (N-41) |
| Truth Pong before Hunt 2 in Act II | Your answer: the order stays, and the Act II heading moves up to the ad hijack, so Malware, Hunt 2, the summons and Pong read as one act |
| No ad sounds or bleeps on the TV, the Tent and the Heart, as an option | `🔇 No ad sounds or bleeps` in ⚙ and `bleeps=` on a link, on by itself on those three |
| The Settings icon hidden but still there | Hidden on every terminal, same corner, same 2 s hold |
| No video from the old tablets to the games | Fixes for the likeliest cause and a readout in ⚙ and on Run. **The cause is a hypothesis**, and no real tablet tried it |
| Trabolta doesn't wait for Clippy | His lines wait for her arrow, and her arrow or ✓ Done starts his introduction (🤖 is the backup) |
| A shared teleprompter, with the lock | One position on the server. A press locks it to that phone; his lines lock and autoscroll it |
| Someone else's line sends a notification | Built, and nothing in the show uses it yet: wave 58 removed the Recycling Bin's line (N-30) |
| No directors in anyone's People, and only people online | Done, on the server, so a name never reaches a phone's list. Online means the last 3 minutes (D-4) |
| Dialogue always on top in the games | VR's talkers' panel was the one surface behind geometry. Fixed. The web's lines sit above the page |
| A run reset in both games | Hold R 5 s; both triggers + A 5 s in VR. A bar fills, and letting go cancels |
| Gerald sometimes isn't there | VR's cause is found and fixed. The web's was never reproduced (N-27) |
| The Steam Room is the Power Supply, the Graphics Card is the Casino | Renamed everywhere anyone reads, lore rewritten, hidden ids kept (§3, N-44 to N-46) |
| One QR holder until released | One phone per part or Person, on every badge, claim link and typed code, with Ask a host for a lost phone |
| The Task Manager costume | Built: `docs/trapped/costume.md`. Never tried on a real iPad |

## 2. Decisions made for you, and what they cost

All ours, and all yours to overrule.

| # | The decision | Why | What it costs | To change it |
|---|---|---|---|---|
| D-1 | **A plain story restart frees guests and leaves booths signed in. Only Go live frees every part.** This overrules rule 3 of the claims lane, which listed a story restart as a release | A sync's reload is a restart, and it must not sign all eight staff phones out, or the story can't change close to opening | A dead phone's part needs ⏏ Release or Ask a host after a restart | Drop the `kind === "golive"` guard around the session loop in `restart()` |
| D-2 | **AD STORM and GLITCH flicker the screens outside a talk scene,** from the doors to the final reveal. A real burst lands only in the ad attack's and the beans' talk scenes, and at the bottle it stays a flicker | The buttons shouldn't read *Not Responding* through the hunts, and nothing may spoil the ad hijack | The flicker blinks the room bulbs too, so it still reads *Not Responding* during the alarm, a blackout or a room he has put out. A burst during the takeover is refused, and a storm stops if a talk scene opens or closes under it | `costume_flicker` in `main.loom`, and `costumeCue` |
| D-3 | **LIGHTS touches only the living room, for 6 s,** then the story's look comes back | Almost every colourful look also sets the halls, which are safety fixtures. Every story look covers the living room, so firing it again restores everything | A guest pressing it in the kitchen sees nothing | `costume.json`, if a look touches no safety fixture |
| D-4 | **Online means seen in the last 3 minutes:** an open stream, or heard from in that time | So a phone in a pocket doesn't flicker on and off | A guest whose phone sleeps longer is off everyone's People until they open the app, so the list may be shorter than you expect. Someone who left lingers up to 3 minutes. While the show is paused the list stands still | `ONLINE_GRACE_MS` in `core/src/host-board.ts`, one constant |
| D-5 | **The floor captions are gone from the wall maps** ("MAIN FLOOR", "Basement") | The alternative was inventing an in-world word | A wall map doesn't say which floor it shows | Easy to put back with a name you pick |
| D-6 | **The VR chord near the King can spend the hit** | In the walk a trigger or A is the hit, and the chord's first button can't be told from one | Held in reach of him, the chord spends that visit's hit and takes 1 HP off him, then the reset fires. It costs no reset and strands nobody | No clean fix. Only a press that completes the chord could be ignored, and that almost never applies |
| D-7 | **A one-character typo of a printed code still costs what a guess costs** | Your `wrong code` rule stays. Only true misses reach it | Doubt +8 (at 40 Clippy hears that the Antivirus is asking about them), a line from the Password Manager, 🔑 in her booth, and one of 8 misses a minute. You may want this softer. A sentence typed in the Codex's own box costs the same. Printed codes, a room's name and words with spaces in 📷 Scan cost nothing | The simple fix: treat anything within one character of a printed code as a note |

## 3. Calls to check

Found on the way. Each is built as it says, and yours to overrule.

### Printed codes and in-world names

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-1 | A room's short code or name typed before joining could hand out the guest code | Before joining, only badge codes resolve: *That code doesn't open anything* | |
| N-2 | Text with spaces used to be refused as "not a code", and `blue duck` must still work for a hyphened code | In 📷 Scan, words that open nothing answer with a plain note, free. A real code typed with spaces unlocks | A sentence in the Codex's own box is still a miss, as it always was |
| N-3 | A wall terminal's TYPE A CODE box goes straight to the Codex | A printed code there costs nothing and opens nothing, though the screen still reads WRONG. A true miss costs +8, as on a phone | Say if a terminal should act on a printed code |
| N-4 | A renamed sign's card, a dropped reveal and the like break a card with no warning | `titi:qr-lock` catches all of them but a changed secret or guest code, a reveal behind a beat the night never reaches, and a sign's button edited to do nothing | |
| N-5 | Reordering the reserved programs keeps the QRs but makes their typed codes find the wrong program | The lock pins the order, and a badge's number now names its program on the server | |
| N-6 | Guests lose the real room on screen, as you asked | The door signs have to do that job | Check every room's sign is on its door |
| N-7 | Trabolta's prompts carried the whole label, real room included | His facts and dossier now read in-world too. The dossier's change is typechecked only, not proven through a real heart thread | |
| N-8 | A performer's chat room list still shows the crew label | Left: performers need the real room | |
| N-9 | `/cards` has no blank badges (600 of them) | The Print sheet has them | |
| N-10 | `README.md`, `DESIGN.md` and `OCT31.md` quote codex codes in old rows | Added none. The old rows are still against your rule | Say the word and they go |
| N-52 | Two of this wave's commit messages hold a secret's words: `c9bdc576` spells F2's answer, as three of wave 58's do (`SIGNOFF-w58.md`, N-59), and `aa53f7d9` names a sign whose words are also a codex code. F2's word also sat in `docs/trapped/costume.md` and `core/CLAUDE.md` | Taken out of the two docs. The commits are left: `c9bdc576` is on the integrate branch too, so rewording means rewriting those | Against your rule. Left in the history |

### One holder

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-11 | The server can't tell a lost phone from a live one | Anyone who loses a session needs a host, where a badge used to sign them straight in. Expect asks on Needs tonight | |
| N-12 | Run has no asks list | Answers come from a host's Needs or the director phone. An ask shows one line above NEXT | |
| N-13 | Ask a host by program name is open to anyone with the guest code, and an Approve signs the old phone out | The host's check is the only guard. The Needs row says what it does | |
| N-14 | A camera that opens a second browser | That browser is refused and told to go back to the first. If a host approves while it waits, it takes over and the first is signed out | Proved with two browser contexts, not a real camera handoff |
| N-15 | A guest's released program stays taken on the picker, because the Person still exists | Reachable by their badge, invitation, Ask a host or a re-pair. A released part goes free | |
| N-16 | A join screen still holding a released Person's badge, picking someone else | It signs in as the badge's Person, so a card can never make a second Person | |
| N-17 | During a lockout, a right part or claim passes and a wrong one doesn't | That reads differently, which a guesser with the guest code could notice. The codes are 50 bits, so we judged it harmless | |
| N-18 | A stale row can sit on Needs for up to 10 minutes after a phone reloads while waiting | Approving it changes nothing | |
| N-19 | A page left open on the old bundle reads a held badge as *The doors aren't open yet* | Until it reloads | |

### People, and rehearsing

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-20 | A program in the Internet tends to have a locked phone | It stays on an Antivirus's list, phone or no phone. Everyone else sees it only while online | |
| N-21 | A plain performer's 🗂 Guests, and pickers for the wallet, shares, cues and Bingo | Keep offline people. Only directors' personas are removed | |
| N-22 | Rehearsing against a persona from a real phone | It's on no list: scan its pass. Its DM to a booth arrives as *Director* and can be answered, and Run's Players panes show everything as before | |
| N-23 | Two places a persona's name still reaches a phone: a story line that prints it (a persona founding a faction, in `# hosts`), and a persona made a teleprompter reader (`prompterName`) | Left: both need a director playing a persona, so rehearsal only | |

### Terminals and the tablets

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-24 | The noise inside his broken speech (wave 56) | Kept on the TV and the CRT: it is his speech | If that counts as a bleep, it's one line in `voiceNoise` |
| N-25 | The game's own quack, buzz and pickup on the tent | Kept while someone is playing. Only the station's bleeps and the idle show go quiet | The tent walk's own sounds weren't exercised in a real walk |
| N-26 | Turning bleeps back on on the TV plays them at the old level through the house, ducking the music | By design, so the box isn't a lie. The default stays off | |

### The games

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-27 | Gerald on the web | Rendered at all 12 spots at levels 0 and 4, and across three walks. No cause found, so nothing in the web's duck code changed; a test and a map Check that warns of a prop drawn over a spot were added | If it happens again, note the device, the program and the room, and run Check on the live project's map |
| N-28 | "Both triggers", with one controller on the night | Any two of the index and grip triggers count, and X counts as A: index + grip + A on one controller | It's one line (`VrPlayer.chord`) |
| N-29 | The reset keeps the run's clock and the path reveal | That's your "no penalty, no bonus". A tablet with no keyboard has no reset | |

### The teleprompter

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-30 | The Recycling Bin's line in Bingo is gone on wave 58's story, and no beat has a line for anyone outside its `aloud:` list | The small card works, proven on a tiny story, and nothing in the show uses it. Adobe Acrobat in Truth Pong is a named reader and gets the full pop-up | For the card instead, that beat becomes `aloud: Clippy`: one word |
| N-31 | Reading ahead | She can't scroll past an unsaid line of his, so a look-ahead sets him off. Dragging the rail previews safely | |
| N-32 | Ad Hijack | His lines wait for Clippy, so they no longer play under the 8 s takeover | Feel it in a rehearsal |
| N-33 | A reader with the pop-up up and untouched looks like a long paragraph | He waits until a host presses ▶. If her phone sleeps or dies he waits at most 12 s | |
| N-34 | Someone else's open prompter | It holds him only while they drive it: a touch every 20 s or autoscroll on | `DRIVE_TTL_MS` |
| N-35 | Y2K timing after a hold is let go (a fake voice at 2.7 words a second) | The held line goes first, so he reaches *…the Y2K BUG.* at about 42.6 s and the 42 s fallback starts the dream about 0.3 s ahead of the words. Before the fix he never said it at all | A real voice will shift this |
| N-36 | The arrow fires him with no undo | A slip to the bottom starts him early. Only a reader's ✓ Done fires him; a host's ✓ Done or a director's close doesn't, but a host scrolling to the end does | |
| N-37 | 🤖 pressed after the arrow says *🤖 Trabolta is already online. Nothing happens.* | True, but it reads as a refused press on the sheet | |
| N-38 | A rail or section jump stops ▶ for everyone | She presses ▶ again after a jump. The narrow option keeps wave 55's autoscroll, but a jump onto the second-last line rolls into him within seconds | One line in `play/src/aloud/prompter.tsx` |
| N-39 | ✓ Done behind paused doors | He starts by himself as soon as the doors reopen. The reopening director should know | The alternative is an alert and a host's 🤖: a person holds the timing, but it can be missed |
| N-40 | A new beat over her paragraph | She carries on from *↑ earlier lines*, and a host presses 🤖 on her last line. If no host is watching `# hosts`, he waits, though the alert pops on every host's phone | |

### The rooms and the costume

| # | What came up | What we did | Yours to decide |
|---|---|---|---|
| N-41 | Booths lost hidden places until they open, as well as chat rooms | The Script never appears in Task Manager's room list, and his teleprompter still gets the read (checked in Chromium). `# task-manager` appears for booths at the first program's clearance | |
| N-42 | **The Tube's card can never work:** nothing reveals it | `checkin: false`: no card, so 10 location cards. Its one aside goes with its check-in arm (*Every light in the Tube blinks once…*), which never played, and it was on the plain rooms' list for M27 | |
| N-43 | C and D stay separate sections, both headed Act II | The docs and the spec number cues by those letters | One heading means dropping the `act: D` line and two tests |
| N-44 | Five facts keep room words, word for word from your delivered file (the bathroom, the basement, the kitchen fridge, the living room, office, hall and mud room): `facts[18]`, `[19]`, `[20]`, `[57]`, `[61]` | Kept as your text | Say if they should change |
| N-45 | Words left on purpose: *Bathroom Mode*, *need the bathroom*, upstairs, downstairs, stairs, fireplace, *the tunnel*, the sign on the cold door and its codex title. Antivirus objectives and crew packs keep real rooms. An ad's *every hall and both stairs* describes the Tube | As built | |
| N-46 | His persona keeps the plain room words so he understands a program who uses them, with a new line that he says only the computer's names | Needs the MacBook's restart. **Whether he obeys wasn't run against a real model** | |
| N-47 | Clippy's aside at her Cloud check-in reads *Remember, the Cloud is just someone else's backyard!* (`main.loom:2575`) | Kept: the joke works, at the cost of one real-house word on a guest's phone | *…someone else's computer!* has no house word and is the old saying, but loses the pun |
| N-48 | The Casino's room tone is still a graphics card's coil whine (read only, never auditioned) | Kept: no work, and only someone who knows the sound would notice | A swap needs a new synthesised sound and an audition on the Desktop's router |
| N-49 | "A song is on" has no check of its own in the costume | Every song plays after `Night.ended`, so the ending's refusal covers it | |
| N-50 | A server restart inside AFTER PARTY's 45 s hold loses its timed return | BACK TO NORMAL reads *Not Responding*, and someone presses Follow the story in the Mixer. Before this a guest could release a director's hand | |
| N-51 | `costume-root.mjs` puts the link on a plain-http LAN page during setup | Stop the script once the iPad has it. The token can only fire the menu, but don't post it | |

## 4. Every word we wrote

Everything here is marked `DRAFT w59` where it lives, or sits under a marker next to it.
Packs and help carry no markers, and are listed at the end.

### 4.1 Rooms, on every phone

- *📍 Checked in at the Power Supply. Everything in here hums like it is one plug away from a blackout. Something is rolled up in a cardboard tube behind the games.* (`main.loom:2559`)
- *📍 Checked in at the Casino. The house always wins. Somebody staked a sketchbook on the bed and never came back for it, every drawing in pixels.* (`main.loom:2594`)
- *Upstairs, the Casino pays out to an empty room.* (`atmosphere.loom:15`)
- *The door code is in your Codex. The keypad is by the cold door, downstairs.* (`main.loom:2495`)
- *!!GO TO THE DESKTOP* (`main.loom:6147`, `:6229`) and *Go to the Desktop.* (`main.loom:6149`, `:6231`)
- *!🌑 ALL PROGRAMS: to the Desktop for the final Truth Scavenger Hunt reveal.* (`main.loom:6289`)
- *!📜 THE FULL TRUTH. To the Desktop.* (`main.loom:6536`, `:6568`)
- *!🏆 THE AWARDS CEREMONY. Every program to the Desktop.* (`main.loom:6608`)
- *!🎵 TRABOLTA SOLVED IT. Those of you who want to leave may leave. To the Desktop for the song.* (`beats/finale.loom:228`)
- Installation Wizard: You are in the Internet, out in the Cloud at the end of the tunnel. Your program has been corrupted. It went against the will of Jean Trabolta, Sole Owner and Founder of Maps and Ducks. That is not your fault. Entropy is a normal part of the lifecycle of a program. (`beats/internet.loom:24`)
- *Every phone in the house buzzes at once. Five minutes. Somewhere in the Tube an Antivirus starts counting.* (`beats/pong.loom:19`)
- Narrator: Somewhere downstairs, the Server Room hums louder. (`beats/server-room.loom:37`)
- *🚪 The server room is open. Trabolta's heart is behind the cold door, downstairs.* (`beats/server-room.loom:151`)
- Narrator: Then every phone says one thing. GO TO THE DESKTOP. (`beats/server-room.loom:1211`, `:1224`)

### 4.2 Objectives

- *Everyone to the Desktop. Clippy welcomes the programs and introduces the hosts.* (`objectives.loom:126`)
- *Go to the Desktop and scan its check-in QR: that is your check-in. The Antivirus are counting.* (`objectives.loom:225`)
- *The final reveal: to the Desktop* (`objectives.loom:305`)
- *To the Desktop for the awards* (`objectives.loom:344`)

### 4.3 The Codex

Only the words we changed.

- *A street photo, taped up in the Tube.* (`codex/1-world.loom:42`, The Billboard On Lower Water)
- *Cloud: a clearly marked exit, two VR headsets, and a tablet.* (`codex/1-world.loom:123`, The Reinstallation Protocol)
- *A laminated sign on a door downstairs: ▒▒▒.* (`codex/1-world.loom:182`, The Server Room)
- *Three screenshots taped to the mirror in Disk Cleanup.* (`codex/2-files.loom:112`, Face Off)
- *…says GO TO THE DESKTOP, and the dance song plays.* (`codex/7-clippy.loom:268`)
- The digit notes' hiding lines in `facts.json`: *The Casino (bedroom two)* and *The Power Supply (game room)*, crew-facing, the spots unchanged.

### 4.4 His words

- *Those plain words are so you understand a program who uses them: you only ever say the computer's names.* (`trabolta.persona.md:553`)
- His six lines when poked (`costume.json`, and `core/src/costume.ts:219`, which a test holds equal): *Who did that. I felt that. I have filed it under Liberties, Taken.* · *Please stop. It tickles in a way that has not been approved.* · *Ow. That was my good side. I do not have a bad side. Ow.* · *Gerald, was that you? Gerald has no hands. Then who touched me?* · *One does not poke a founder. There are procedures for this.* · *Something just pressed me. I did not authorise the pressing.*

### 4.5 The walls and the TV

- *GO TO THE DESKTOP* (`terminal/src/ScreenLayer.tsx:205`)
- *An Antivirus is sweeping the Tube.* · *Programs found in the Tube will be escorted.* · *Proceed to the Desktop.* and the sweep's other lines (`terminal/src/cutscene/scenes/act1.tsx:119`)
- *The Desktop is the room with the big screen.* and the marquee *★ THE ROOM WITH THE BIG SCREEN ★* (`terminal/src/cutscene/scenes/act1.tsx:119`, `:157`)
- *The Power Supply* and *The Casino* on the late board (`terminal/src/cutscene/scenes/act2.tsx:198`, `:201`)
- *Somewhere downstairs, the Server Room hums louder.* (`terminal/src/cutscene/scenes/act2.tsx:1381`)
- The window title `C:\▒▒▒`, with no real room in its path (`terminal/src/cutscene/scenes/act2.tsx:1388`)
- *Trabolta's heart is behind the cold door, downstairs.* (`terminal/src/cutscene/scenes/act2.tsx:1470`, `:1484`)
- *To the Cloud.* (`terminal/src/slides.ts:608`)
- *THE POWER SUPPLY: GAMES GAMES GAMES* (`terminal/src/idle-show/ads.ts:103`)
- *Fresh air, 100% uptime, a tunnel to the Internet. The Cloud is open for business.* (`terminal/src/idle-show/ads.ts:101`)
- Kicker *DOWNSTAIRS* and *Random access, volatile vibes, everything you forgot you remembered. Down the stairs.* (`ads.ts:113`; *volatile vibes* replaces *studio vibes*)
- *Cool down in The Fan Closet, downstairs by the dryer.* (`ads.ts:114`)
- Kicker *IN THE CLOUD* (`ads.ts:132`)
- *Disk activity downstairs is up. This is normal.* (`terminal/src/idle-show/popups.ts:83`)

### 4.6 The games

- Web: *Keep holding R to go back to the start* and *Back at the start.* (`reinstall/web/src/game/reset.ts:14`). With Gerald's line added: *Back at the start. Gerald moved.* or *Back at the start. Gerald moved — follow the golden arrows.*
- Web: *hold R if you get stuck* (`reinstall/web/src/game/Play.tsx:343`), and the training's last card, *Stuck on something? Hold R for 5 seconds.* (`reinstall/web/src/game/tutorial.ts:143`)
- VR: *KEEP HOLDING TO GO BACK TO THE START* (`reinstall/vr/game/hud.gd:42`)
- VR: *Back at the start.* (`reinstall/vr/game/game.gd:146`). With Gerald's line added: *Back at the start. Gerald moved.* or *Back at the start. Gerald moved — follow the arrows.*
- VR: the tutorial's last card, *Stuck on something? Hold both triggers and A for 5 seconds. Now find Gerald.* (`reinstall/vr/game/intro_flow.gd:60`; the old line's *the golden duck* was cut to fit the panel)

### 4.7 The costume

- The menu (`costume.json`, and the same in `core/src/costume.ts`): *Close Program*. LIGHTS: *RED ALERT, BLUE SCREEN, GREEN GLITCH, POP-UP PINK, LIGHTS OUT*. SOUNDS: *DIAL-UP, PAPER JAM, STATIC, ZIP, FANFARE*. MUSIC: *NEXT TRACK, AFTER PARTY, BACK TO NORMAL*. *AD STORM, GLITCH, POKE TRABOLTA*.
- The dialog: *Not Responding*, *Done*, *Cancel* (`core/server/costume-page.ts:102`).

### 4.8 What phones show the crew

- The join box: *Event code, or your badge's code* (`play/src/guest/register.tsx`)
- 📜 *You have a line*, *✓ I'll just say it*, *📜 Join the teleprompter* (`play/src/aloud/prompter.tsx:72`)
- *🔊 {name} is speaking*, *🔒 {name} has it* (`play/src/aloud/prompter.tsx:460`)
- *↑ {n} earlier lines*, *↑ 1 earlier line* (`play/src/aloud/prompter.tsx:524`)
- *Earlier lines*, *✓ Read them*, and the label *Close the earlier lines* (`play/src/aloud/prompter.tsx:577`)
- *📜 Join* and *▶ Let him speak* (`play/src/host/prompter-strip.tsx:23`, `:29`; `play/src/director.tsx:1375`)
- A host's line: *🔊 he is speaking*, *🔒 {name} has it*, *⏸ he waits for the script* (`play/src/host/show-model.ts:115`)
- The push title *📜 You have a line* (`core/server/push.ts:290`)
- `# hosts`: *🤖 A new beat cut Clippy off: press 🤖 on her last line* (`core/server/event-runtime.ts:358`)
- *Nobody online.* (`play/src/booth/people.tsx:46`); *Offline ({n})*, *Nobody online.*, *Nobody online matches "…".* (`play/src/host/tab-people.tsx:32`, `:38`)
- *🔁 1 wants back in* and *🔁 {n} want back in* (`play/src/host/show-model.ts` `asksLine`)

The refused screen and its neighbours carry no marker, because they are app words, not show text:

- *{name} is already signed in on a phone.* · *Badge {ref} is already signed in on a phone.* · *That badge is already signed in on a phone.* and the hint under them (`play/src/rejoin-calls.ts`)
- *🙋 Ask a host* (`play/src/held.tsx`)
- *This phone was signed out. To come back, scan your badge or ask a host.* (`play/src/lifecycle.ts`)
- *Lose this page? Scan your badge, and a host can let you back in.* (`play/src/guest/register.tsx`)
- *Your part shows as taken after a lost phone? Tap it to ask a host.* (`play/src/booth/login.tsx`)
- *That signs out the phone they're on now.* (`play/src/host/model.ts`, `play/src/director.tsx`)
- *Sign {name}'s phone out? Their badge signs them in again on any phone.* (`play/src/host/tab-people.tsx`)
- *🪪 That badge is saved for {name}. Yours is the one with your own program on it.* (`play/src/rejoin.ts`), and the server's *that badge is saved for {program}* (`core/server/routes/rejoin.ts`)
- *{name} was signed in or out while you waited. If it's still you, ask again.* (`play/src/rejoin-calls.ts`)

### 4.9 What goes to paper

- A location card: *Scan to enter this room. No camera? Type the code in 📷 Scan.* (`editor/src/lib/print-sheet.ts`)
- A staff badge: *Scan to sign in, or type the code on the join screen.* An invited or blank badge: *Scan to start, or type the code on the join screen.*
- On every badge: *Lost your phone? Do it again, and a host can move you.* (`LOST_PHONE`)

### 4.10 What only the crew reads

**Cue descriptions**

- *🎤 Clippy tells the room about Trabolta*: After the first reinstallation (or when the Bingo is done with). Her paragraph pops up on her teleprompter; it closes the Bingo round if it is still open. It ends "Trabolta, would you explain the rules?". When her arrow passes that line, or she presses ✓ Done, he starts by himself: 🤖 is the backup. (`main.loom:3297`)
- *🤖 Trabolta comes online*: The backup. He starts by himself when Clippy's arrow passes "Trabolta, would you explain the rules?" or she presses ✓ Done; press this if neither can happen (no reader, a lost phone, after a server restart), or on her last line when # hosts says a new beat cut her off. Before or after that it is harmless. He comes online and gives his whole speech, the three questions and his sign-off on the TV, about three minutes; check the terminals show his face. The 🤖 Talk card stays open behind it for the banter after. (`main.loom:3313`)
- *🎭 Flicker the screens (the costume's Glitch, outside a talk scene)*: The Task Manager costume presses this itself. The screens and the room bulbs flicker once. No ad, no line, no spoiler. (`main.loom:3851`)

**Maps.** The prop labels *POWER* (was STEAM) and *CASINO* (was GPU), in `house.json` and `house.shed.json`. They carry no marker: JSON takes no comments.

**Packs.** `cast-packs/performers/clippy.md`: *If a new beat lands over your words, your phone moves on to it: finish from ↑ earlier lines, and a host presses 🤖 on your last line.*, and the shorter line on her Quick card. `cast-packs/crew/director.md` row 4, and `docs/help/play/14-hosts.md`: the same 🤖 cases in crew words.

**Crew text, no markers.** `SHOWNIGHT.md`, `TECH.md`, `INDEX.md`, `show-page/template.html`, `cast-packs/all-crew.md`, `cast-packs/crew/director.md`, `crew/second-director.md`, `crew/house-manager.md`, `crew/tech-operator.md`; `docs/help/play/01-welcome.md`, `07-performers.md`, `08-codex.md`, `09-terminals.md`, `11-reinstallation.md`, `13-director-phone.md`, `14-hosts.md`, `18-getting-back-in.md`; `docs/help/authoring/30-live-shows.md`, `35-codex.md`, `43-run-mode.md`, `48-terminal-setup.md`, `55-language-filter.md`, `56-read-aloud.md`; Run's badges and dialogs (`editor/src/lib/terminals.ts`, `editor/src/components/cockpit/Inspector.tsx`, `editor/src/components/cockpit/director/NightBar.tsx`), `⚙`'s `🔇 No ad sounds or bleeps` and its readout (`terminal/src/Setup.tsx`, `terminal/src/link-stats.ts`, `core/src/link-health.ts`), and the map's Check warning (`reinstall/web/src/map/check.ts`).

### 4.11 Where every marker is

| File | Lines |
|---|---|
| `CLAUDE.md` | 378 |
| `INDEX.md` | 57 |
| `atmosphere.loom` | 14 |
| `beats/finale.loom` | 227 |
| `beats/internet.loom` | 23 |
| `beats/pong.loom` | 18 |
| `beats/server-room.loom` | 36, 150, 1210, 1223 |
| `codex/1-world.loom` | 36, 115, 176 |
| `codex/2-files.loom` | 106 |
| `core/server/costume-page.ts` | 101 |
| `core/server/event-runtime.ts` | 357 |
| `core/server/push.ts` | 290 |
| `core/src/costume.ts` | 217 |
| `costume.json` | 2 |
| `editor/src/lib/print-sheet.ts` | 18 |
| `main.loom` | 2494, 2558, 2593, 3292, 3309, 3849, 6146, 6148, 6228, 6230, 6288, 6535, 6567, 6607 |
| `objectives.loom` | 118, 217, 300, 339 |
| `play/CLAUDE.md` | 597 |
| `play/src/aloud/prompter.tsx` | 71, 459, 523, 577 |
| `play/src/booth/people.tsx` | 46 |
| `play/src/director.tsx` | 1374 |
| `play/src/guest/register.tsx` | 173 |
| `play/src/host/prompter-strip.tsx` | 22, 28 |
| `play/src/host/show-model.ts` | 115 |
| `play/src/host/tab-people.tsx` | 32, 38 |
| `reinstall/vr/game/game.gd` | 145 |
| `reinstall/vr/game/hud.gd` | 41 |
| `reinstall/vr/game/intro_flow.gd` | 59 |
| `reinstall/web/src/game/Play.tsx` | 342 |
| `reinstall/web/src/game/reset.ts` | 13 |
| `reinstall/web/src/game/tutorial.ts` | 142 |
| `terminal/src/cutscene/scenes/act1.tsx` | 118, 155 |
| `terminal/src/cutscene/scenes/act2.tsx` | 1387 |
| `terminal/src/idle-show/ads.ts` | 100, 131 |
| `terminal/src/slides.ts` | 608 |

## 5. Real-device checks owed

None of this could be done from the MacBook's tests. Scratch server first, then the
preview, before the doors. The owed checks of waves 53–58 still stand on their own sheets.

1. **Print.** One sheet at 100% on real paper: the codes read, 3 × 2 cards, nothing clipped.
   It was rendered and printed to PDF in Chromium only (124 cards, none overflowing).
2. **Scan and type one of each kind on a real phone:** staff, invited and blank badges, a
   room, the 🚻 sign, a fact. Then type one of each on a phone with no camera access. Typed
   flows ran in Chromium as a Pixel 7 with no camera, and the camera path never ran.
3. **`sync-show --replace-maps`, for real.** It needs Postgres, so it has never run on this
   wave. The proof used `sync-example`'s own reload on a no-database scratch server. Check
   the two rooms on Run → House → Map afterwards.
4. **One holder on real phones:** a real iPhone and an Android phone, a real camera handoff
   into a second browser, Ask a host and Let them in, on the house's one IP. Only one client
   IP has ever been tried, and it wasn't the house's.
5. **Run itself.** Never opened on this wave's build: 🎭 and the 📷 🎞 ⚠ badges on Terminals,
   ⏏ Release in the Inspector, ▶ on the Director page, and the real Print sheet. It needs a
   database. The Print sheet ran as the real component in a harness.
6. **Each old tablet (SM-T280).** Reload, touch, hold the corner, read ⚙ (`TECH.md`, *The
   tablets' camera feed*). The cause is a hypothesis: Chromium 95 ran with no GPU, and neither a
   real tablet nor a GPU build tried it. Then the same in the other direction, with a program
   standing in that tablet's room.
7. **The quiet terminals heard, not counted.** The TV, the tent and the CRT through their real
   speakers: all audio proof is counted API calls in headless Chromium.
8. **The hidden ⚙ on the real kiosks,** with a finger on a tablet and a pointer on the CRT.
   Neither keyboard nor pad reaches it there, as before.
9. **The Quest.** Re-export and sideload, then in a headset: the chord (the grip action's
   reading on real Touch Plus controllers), the bar, the notice, the talkers' panel, Gerald on
   a second walk, and the frame rate with the new overlay materials. The XR branch of
   `_read_sticks` has never run: Godot's tests only.
10. **The web game on the tent laptop:** hold R, with ⚙ Graphics open. Headless Chromium on
    software GL only.
11. **One rehearsal of the prompter with Clippy's real phone, a host's phone, the real TV and
    his real voice:** Second Hunt, Ad Hijack and Clippy On Trabolta. The scroll's pace against
    his voice (`spokenMs`) is unmeasured, the TV ran with `engine=silent` or a stand-in, and
    the *↑ n earlier lines* chip hasn't been seen at show text sizes. Scroll to TV measured
    about 280 to 510 ms on loopback, with no real voice or VPS in it.
12. **The Y2K line after a hold** with a real voice (N-35).
13. **The iPad, all of it:** the profile, the TLS handshake (the ciphers iOS 9 offers were never
    checked against the live server), Add to Home Screen, Guided Access, three fingers on real
    glass, and the strap test. Go to the relay at the first sign of trouble.
14. **The costume's presses reaching the house:** a real router, lights module and bulbs. Each
    press was proved only as far as the server queues it, and the TV page wasn't driven for a poke.
15. **His persona on Claude:** the room names and the heart guard, with `pnpm sim:trabolta
    --battery`. No model has seen them. Read `SIGNOFF-w58.md` §5, check 6, first.
16. **The in-world door signs in the house:** a guest finds each room from its sign alone.
17. **Fullscreen** on a real Android phone. Driven in Chromium as a Pixel 7 and on a laptop only.
18. **What was not run on the merged tree:** `predeploy.sh` and the Postgres-gated core tests.

## 6. What's owed in print

**Settle, ship, sync, print, lock.** `SHOWNIGHT.md` §1, step 9.

- **10 location cards, not 11.** The two renamed rooms have new links and text codes, and The
  Tube has no card.
- **Then the lock:** `pnpm --filter @loom/core titi:qr-lock`, and commit `qr-lock.json`.
- **What breaks a printed card:** renaming or deleting a room with a sign, setting `checkin:
  false` on one, or marking it `prison` or `cutscene`; renaming a `qr:` sign's button; renaming a
  performer part; renaming or reordering a reserved program; changing a codex code; dropping a
  hidden room's last `reveal`. The lock catches each of these. A new guest code breaks every
  link, a new claim secret breaks room, sign and staff codes, and neither is a story edit. A new
  domain breaks the QRs but not the typed codes.
- **What doesn't:** story text, beats and their order, objectives, a fact's words, a label's crew
  note, new beats and facts, Restart, Go live, End and relaunch (that one rests on wave 54's design,
  not re-proved here), and new performer and mod codes.
- **The gold cards for H1, H2 and H3** wait for their answers (wave 58).
- **Packs to reprint** for this wave: `clippy`, `crew/director`, `crew/second-director`,
  `crew/house-manager`, `crew/tech-operator` and `all-crew`, all already on wave 58's list.
- **`hardware/server-room-m4/README.md:472`** still says `hold ⚙ 2 s`. It isn't printed.

## 7. Ship order

`SHOWNIGHT.md` §1, *Landing wave 58 and wave 59*. In short: the
answers → `predeploy.sh --vr` → the roster, in its own step → `ship.sh` → the 10:00 sync, with
`--replace-maps` → the worker, `git pull` and restart together, then Mind → Reset → reload every
phone, terminal, the TV, the tablets, the tent and any open Run tab before 17:00 → the Quest's
APK → the iPad → print → `titi:qr-lock`, committed → the keypad before 15:00. No release, sync or
restart has happened: nothing on this sheet is live.
