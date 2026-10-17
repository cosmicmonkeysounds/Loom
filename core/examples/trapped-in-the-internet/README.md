# Trapped in the Internet

*Equal parts Digimon Movie, Blade Runner, and an escape room, influenced
by late-90s Web 1.0 aesthetics and existentialism.*

> **🎃 [OCT31.md](./OCT31.md): the active plan. The party is Sat Oct 31,
> 2026.** It has the day-by-day lanes to the show, the gates (Oct 18 / 22 /
> 25 / 27, tech 10-28, dress 10-29, freeze 10-30), the buy-today list, the
> workaround runbook (W-01…W-34), the night-of crew + cheat-sheets, show-day
> call times, the risk register and the cut order. **Waves 1–3 are on
> `master` and deployed (w3-1015); wave 4 (facts.json, the judge, the
> bottle, the wallet, marked programs, the King) is committed (9d35a4b)
> and wave 5 (the stock-take: Runescape's reserve, the takeover, the
> resurrection, the phone cue sheet, …) is in the working tree, neither
> deployed yet**: its §5 *Wave N status* tables list every build and
> the device check still to do.
>
> **📋 [CHECKLIST.md](./CHECKLIST.md): the living tech checklist, covering
> the software and hardware still to do before the party.** Tick items
> there in the PR that does the work. This README is the runbook. The
> checklist is what has to be *true* for the runbook to work.
>
> **🗓️ [SCHEDULE.md](./SCHEDULE.md): the order the checklist gets built
> in**: four agent lanes, the week-1 spikes, gates G0–G5 (all P0 by
> day 41, show-ready ≈ day 67), the non-software lane and the cut table.
> Since the Oct 31 date was set, it is the post-party / next-run roadmap.

A rogue AI, **Trabolta**, has very nearly solved the Unified Field
Theory. The last facts he needs are on a computer in Halifax: this house.
He cannot get in, but he can install programs remotely, and he has
learned to lift a consciousness out of a body and drop it into a program.
He found a neglected billboard on Barrington Street advertising
mapsandducks.com and registered the lapsed domain ("if there is a
billboard downtown everyone will think it is legit"). Then he sent the
invitations: *Jean Trabolta's offer will solve a problem in your human
life.* Tonight the guests arrive as those programs. Some of them will
remember they were human. What he really wants it all for is **Sandy**,
an automated customer-service agent whose only line is *"I'm sorry, I
didn't understand that. Would you like to speak to a live agent?"*

This folder holds the whole show as a Loom project: the world, the cast,
the games, the lore, the endings, and the contract that every piece of
show hardware talks to. It is the default scenario the event server hosts
(`pnpm --filter @loom/core serve`). The source story lives in
[`../../../Trapped In The Internet story/`](../../../Trapped%20In%20The%20Internet%20story)
(STORY BEATS is the spine; the Story Overview, the Character Sheet and the
Clippy Instructions supply the voice).

## The files

```
main.loom              header · 4 GROUPs · 14 LOCATIONs (the Desktop first) · ROLE Program
                       (every guest's vars, hooks and watchers) · every INTERACTION except
                       Trabolta's powers (the admin ones are the director's cue sheet, in
                       running order) · EVERY story-level `when` rule · `== Power On` (last)
rooms.loom             the chat sidebar: # system-log, # general, # task-manager, # clipboard,
                       # truthcoin-exchange, # hosts, # quarantine, # unlimited-power,
                       # the-way-out, # hidden-partition, # back-channel
atmosphere.loom        three ambient generators (the screensaver hum, dial-up, the system tray)
quests.loom            20 QUESTs (the Quest Log: 13 for the programs, 7 staff quests
                       `for <Character>` in the hosts' and Antivirus' booths)
facts.json             the one file the team edits: the hunt questions + answer key,
                       the scannable / character facts (codes) and the Truth-or-Dare
                       truths. `pnpm --filter @loom/core titi:facts` regenerates the
                       two files below (`--check` only reports; the predeploy gate)
generated/questions.loom  GENERATED: the 3 hunt QUESTs, Trabolta's reading beats (Hunt
                       One/Two Questions · Final Questions), Facts Seed, Truth Question,
                       the 8 hunt-answer CODEX entries
beats/login.loom       arrival: Login · Login Incorrect · Upload · Orientation · Re-upload ·
                       Featured Briefing
beats/desktop.loom     Act I: Call To The Desktop · Computer Bingo · Bingo Time · Corrupted
                       Code · Trabolta Introduction · The Screensaver · The Router · the
                       optional Telephone and Are You Sure
beats/internet.loom    Reinstallation · The Tablet Video · Zipped
beats/hunt.loom        Truth Scavenger Hunt One · Hunt One Go · Hunt Time Up · First Moment
                       Of Truth · Filing Closed · Question Results · Bottle Landed
beats/malware.loom     Ad Hijack · Second Hunt · Truther Download Arrives · the nine
                       featured glitch beats · Program Glitch
beats/pong.loom        Act II: Five Minute Warning · Summons Closed · Truth Pong · Round Two
                       Tally · Trust Chart · Praise The Top · Shame The Bottom · Print The
                       Certificate · The Printer Jams · Full Of Beans · Zip Everyone Out
beats/overshare.loom   Overshare One–Four · The Y2K Clock · Excel / OpenOffice / Program
                       Final Round · Clock Strikes
beats/server-room.loom Act III: Majority Reached · The Whole Truth · Server Room Alarm ·
                       Patch Rejected · Trabolta Disabled · Trabolta Recounts · Computer
                       Destroyed · Purgatory
beats/finale.loom      Final Reveal · Bobbing For Truth · The Bag Of Truth · Final Assessment
                       · Truth Txt · The Verdict · Song Ending · Grok Prom · Pickup Line ·
                       Sad Confession · Relationship Advice · Advice Helped · Advice
                       Thwarted · The Hand Jive
beats/ceremony.loom    the awards ceremony (K-25): The Ceremony (the host opens, per
                       ending) · Present Award (the award slide + the host's line)
cast/kit.loom          TRAITs: Prop(beat) · Person · Host · Enforcer (the door scan, the
                       shared Clearance beat, Send to the Internet, Mark as reinstalled)
cast/hosts.loom        Clippy · Task Manager · Adobe Acrobat · Recycling Bin
cast/antivirus.loom    Norton Anti-Virus · McAfee Anti-Virus · Password Manager · CRA Agent
                       Software
cast/staff.loom        Installation Wizard · Sandy · Truther Download (voices, not playable)
cast/featured.loom     the 9 featured programs: bare names + avatars (they are GUESTS)
cast/pool.loom         22 more guest programs: bare names + avatars
cast/props.loom        The Uploader · The Router · The Screensaver · The Tablet · Kernel (the
                       hidden secret state)
cast/trabolta.loom     the AI: his vars, hooks, and 11 agent powers
codex/1-world.loom …   178 CODEX entries: 170 in eight numbered files + the 8 hunt answers
                       in generated/questions.loom (9-facts.loom is GENERATED from
                       facts.json; 3-hunt.loom is gone). The order matters:
codex/8-jeeves.loom    stagehand feeds Trabolta the first 24 entries as "ground truth", so
                       the environment comes first and the scrambled Jeeves fragments last
trabolta.persona.md    the voice: the fast model's system prompt + frontmatter knobs
trabolta.mind.md       the mind: 8 stages, 5 drives and a cue per phase for the orchestrator
house.json             the house map for the reinstallation games + the terminals' world
                       view. It is a placeholder layout until the house is measured; edit it
                       at /reinstall/map (docs/loom-reinstall.md §1)
CHECKLIST.md           the living tech checklist
cast-packs/            paper only (D-01): 8 performer packs + the Installation Wizard's
                       tent card, 4 crew cards, 9 featured
                       sheets, the emergency card (not read by the server)
```

Outside this folder: **`stagehand/trapped.house.yaml`** is the show's real
show-control config (lights per room, scenes, sound, the house announcement speaker,
the server-room door, sensors, the patch bay), and
`stagehand/tests/test_trapped_house.py` cross-checks it against the story.

### Rules the files rely on

These rules matter when you edit. Break one and something fails silently.

- **Every story-level `when …:` rule lives in `main.loom`**, before
  `== Power On`. No other file has top-level rules.
- **Event names are single snake_case tokens** (`hunt_time_up`). Six spaced
  names are kept for outside code: `go to the bathroom`, `back from the
  bathroom`, `send to the internet`, `mark as reinstalled`, `the simulation
  completed`, `the golden duck`.
- **Featured programs never speak.** Any line shaped `Microsoft Excel:
  text` turns that program into a performer part and breaks the design.
  Their private material comes from `Truther Download:` / `The Uploader:`
  lines and from `unlock` in ROLE hooks gated on `program.featured`.
- **Secrets never live in `Night.*`.** Trabolta's orchestrator sees every
  global. Combos, lies, the majority, the virus planter, the dossier and
  the anti-AI program (`Kernel.anti_ai`) are slots on the hidden
  `CHARACTER Kernel` (`secret: true`): a character's vars never land in an
  agent request's world, and `secret: true` keeps it out of the agents'
  facts document. Membership of the two hidden groups is masked by the
  server until the Y2K clock reveals them.
  A program's own secrets (the virus it carries or planted, its mission
  choices, the frame, the 📝 filing state, every featured mission and
  leader's recruiting quest) are on the ROLE's `secret:`
  line, and the orders + the tent virus files are `secret: true` CODEX
  entries: the server leaves both out of every agent request and the
  facts document, so neither model can read them off the guest it talks
  to.
- **No scripted `Trabolta:` line exists before `introduce_trabolta`.** If
  the director skips that cue and jumps ahead, the next phase cue is an
  implied introduction (a watcher wakes and reveals him, silently), and a
  late press of the cue never moves the night back.
- Never declare `Grok`, a named house assistant or `Jean Trabolta` as
  characters. A house announcement is a `!🔊` broadcast plus `do announce`
  (the house system's own voice, no assistant's name); Grok is codex lore; "Jean
  Trabolta" is the name on the invitation.
- **Never edit a generated file.** `generated/questions.loom`,
  `codex/9-facts.loom`, `generated/print-stacks.md` and the marked blocks
  in `trabolta.mind.md` and `DESIGN.md` §2.11 come from `facts.json`:
  edit that, then `pnpm --filter @loom/core titi:facts` (`--check` only
  reports). A hunt-answer entry ends in `▒ HUNT ANSWER <id> ▒`, the lore
  marker Trabolta's worker hides; the answer key itself never enters the
  story (the server judges filings from `facts.json`).

As of 2026-10-16 (the wave 4 story pass) the project compiles clean, both
per file and concatenated the way the server joins them (`loomcheck`):
**31 files, 0 errors; 102 beats, 178 codex entries (90 with codes; wave 6: + *The Truther Download Unredacted*), 24
quests, 92 story rules, 107 INTERACTIONs** (wave 5: + `Facts Bundle`, Ten
Findings, `play_on_the_screens`) (one loomcheck warning: its
known-card list predates the `answer` card).

## Before the doors open

1. **Sync the story.** Locally: `pnpm dev --sync "<project>"` (or
   `core/scripts/sync-example.ts`). To the VPS:
   `LOOM_SSH=<user>@app.mapsandducks.com scripts/sync-show.sh` (an SSH
   tunnel to its Postgres, then a reload — a real cut, so never after
   doors; `--dry-run` / `--no-reload`). Removed files are deleted from the
   project automatically. The house maps are the exception: the project's
   copy wins, so a map surveyed at `/reinstall/map` and kept with **Save
   to project** survives every sync (the script prints both versions when
   they differ). To make the repo's copy the show's again, **Download
   JSON**, commit it as `house.json`, then sync with `--replace-maps`. Then press **Reset on Run → Mind**, or start the
   worker with a fresh `state_dir`. Otherwise `.stagehand-minds` keeps the
   old "lonely grandeur" arc, and a story restart sends `control reset`
   only to a worker that is connected.
2. **House map.** After the `Disk Cleanup` relabel (the bathroom used to be
   The Recycle Bin), make sure no director's save is in force on the
   preview event: Push draft and Go live in place keep one. The map page's
   status line must read "the project's map"; if it reads "this
   event's map", press **Save to project** (to keep the edit) or switch to
   the other variant and back (to drop it). Otherwise `houseWarnings` reports "The Recycle Bin is
   not a LOCATION" forever. Rebuild `reinstall/web` and `terminal`, which
   bundle offline copies, and re-export the VR APK (low priority, because
   the live fetch wins). `pnpm house:sync` copies the map into
   `reinstall/vr`.
3. **Terminals + the TV.** Provision every wall terminal with `view=auto`
   from the start:
   `/terminal/?code=<mod>&name=Kitchen&character=Trabolta&spot=start-bar&view=auto`.
   Until Trabolta is revealed (or while he's asleep) it shows **attract**
   — a Mystify screensaver and fake-1999 ads, never "ONLINE", and it never
   pilots a pass into `dm:Trabolta` (K-16); his face comes up within 2 s
   of `introduce_trabolta`. `view=mirror` (no scanner, no pilot) is the
   fallback for a tablet attract fails on. The TV is the house Mac's
   Chrome on `view=tv` (integration contract); click once into it after
   every boot. Every terminal and the TV must show green on the **Run
   page's Terminals card** (K-29: red + a chime after 20 s silent).
4. **Hardware (the house Mac).** Load `stagehand/trapped.house.yaml`
   (`uv run stagehand check --config trapped.house.yaml`), then install the
   `show` and `agents` modules as separate launchd jobs (`uv run stagehand
   launchd install --job show|agents --config …`; `launchd status` /
   `restart`) and the house announcement player (stagehand's `alexa` module:
   `scripts/house-mac/install-alexa.sh`,
   `scripts/house-mac/alexa.md`). Mosquitto listens anonymously on
   `127.0.0.1:1883` only; WLED and the server-room ESP32 log in as `props`
   on `:1884`. The
   door contact uses `edge: true` and ignores retained messages. The patch
   bay sends `patch_combo_a` / `patch_combo_b` / `patch_rejected`. The two
   combo strings must match the `Kernel.combo_*` seeds in `main.loom` and
   the four combo-half codex texts, and the stagehand test checks this.
5. **Trabolta (the house Mac).** Start the `agents` worker (see the integration
   contract). His gate is `when: self.awake == true`, so until Clippy
   introduces him every message gets the hold line *"Jean Trabolta will make
   an appearance later tonight. Please do not move the mouse."*
6. **Print** from Run → Join → **🖨 Print sheet…** (K-12: the join poster,
   every codex QR and the room check-in signs, QRs drawn in the browser,
   1, 2 or 4 per page), plus the Bingo cards (appendix). Sort the
   Desktop's codex posters into the four print stacks of
   `generated/print-stacks.md` (gold: the hunt answers · green · blue ·
   red: the character facts) and hide each pile where its row says.
7. **Codes.** The guest, performer and mod codes are pinned to the project
   across End → relaunch (K-10), so printed QRs keep working. If a mod or
   performer code was shared at rehearsal or typed into a terminal, tick
   **New performer + moderator codes** on Start (the guest code stays) and
   re-provision the terminals.
8. **Push.** With `LOOM_VAPID_*` set, guests and booths get a 🔔 *Get
   alerts* card (Android + booths, K-31a): `!` alerts and Trabolta DMs
   reach a locked phone. Subscribe every staff phone before doors.
9. **Paper + checks.** The performer packs, crew cards, featured sheets
   and the emergency card are in [`cast-packs/`](./cast-packs/README.md).
   Each OCT31 build has its device check under
   [`scripts/accept/`](../../../scripts/accept) (`<id>.sh` / `.ts` / `.md`;
   the scripts that fire cues refuse a live event with real guests unless
   told otherwise).
10. **The King** (the Cold Lock, in the simulation): on the tent tablet's
    game a big gold chess king (`house.json` prop `cold-lock-king`, "THE
    KING", 4 hearts) stands guard at the server-room door of the virtual
    house. Walk up and hit him (⚔ / Space): every hit knocks a heart off
    and makes his chess AI dumber (grandmaster → club → beginner → dizzy →
    pawns only); challenge him (♟ / C) on the tablet's board and mate him,
    and the game fires `chess won` for that program (`POST /api/mod/signal`
    with the tablet's mod token and `label: "Tent tablet"`, so the journal
    reads *by Tent tablet*). Before the Y2K hour a win is practice (the
    in-game door opens, `# hosts` says so); from the Y2K hour on it
    disarms the real door for 90 s like any `chess_won`. A headset only
    shows the King with "The King is fought on the tent tablet." Nothing
    is device-checked yet (U17), so **the chess phone stays as the
    fallback** outside the server room: charged, plugged in, on Wi-Fi,
    screen held awake, Lichess at the agreed computer level; it sends no
    heartbeat, so it never shows on the Terminals card. Every host and
    Antivirus knows the honour rule: ♟ *They beat the machine* only after
    **seeing** "checkmate" (OP-12). Director's side: the editor's Help →
    *Running the Cold Lock*.
11. **Rehearse the hunt and the wallet on a server project.** A
    local-folder rehearsal has no facts judge (every filing arrives
    without a verdict and is refused out loud in `# hosts`) and no wallet
    (⭐ score, no Wallet room).

## Running the night

**Fire every admin cue from the cue sheet (Run → Director, K-21) or
quick-fire, never from a performer's guest card.** A press from a guest
card carries `actor` = that character and `subject` = that guest, so only
that character's hooks hear it. The admin INTERACTIONs are declared in
running order, so the sheet lists them in that order, marks the **LAST**
cue and suggests the **NEXT**, and every director's sheet agrees (it is
read off the server's log). Each label carries the source prompt code:
**C1/C2** are the app prompts, **V1–V6** are the monitor slides, and
**Clippy N/X** is Clippy's instruction sheet. Every Clippy instruction
also lands in Clippy's booth as a codex entry (`Clippy Instructions 1` …
`9`, under *What Clippy knows*). Steps marked *auto* fire on their own from
a story timer, and the button is the manual fallback.

Every performer hook ignores a press outside its phase, except **🛡 Send to
the Internet** and **✅ Mark as reinstalled**, which work on any program at
any time (a second 🛡 on a program already in the Internet only says so).

**Marked for reinstallation.** No host verdict captures on the spot any
more. 🎯 named on the Bingo card, 🤷 a guess, 🎩 Dare, 🙅 a refused
truth, 🏓 a missed cup, 🍎 a failed bob, a guess settled at a Moment of
Truth and a late program all fire `mark_for_reinstallation … with
reason:`: the program is **restricted** (DMs and the Tube / Internet rooms
stay; every button, filing, check-in and room post is off), their phone
pins **🚨 GO TO THE INTERNET** with a `!` alert, every Antivirus booth
chimes and `# quarantine` pins *Escort X to the Internet — <reason>*. The
capture is still the Antivirus' **🛡** (or walking into the tent: the
game's begin fires `reinstallation begun`, which captures a marked
arrival). The mark comes off on capture, on release, or with **🩹
Unmark** (any host or Antivirus: a mis-tap or mercy), which also clears
both pins. 🚻 Bathroom Mode and Back stay on a marked phone
(`restricted: allow`); the booth readout says to wait outside Disk
Cleanup (marked then 🚻, or 🚻 then marked), and Trabolta can't snoop,
pop up on or summon a program there (a Disk Cleanup check-in counts for
15 minutes; his refusal is the unknown-name line, so it never says where
they are).

**Mis-taps are cheap.** Phase cues play once: a second press of a cue that
has already run (Call to the Desktop, Bingo, Bingo time, the First Moment of
Truth, Truth Pong, the tally, the rankings, the printer) does nothing. A
judge's double tap of the same ✅/😤 on the same program credits once, and a
program in the Internet cannot have an answer accepted.

**Front of house fixes** (Run, server events only): a guest whose phone
died or whose browser was cleared → Inspector → **🔁 Re-pair**, a
single-use QR (ten minutes) that puts their *same* program on the new
phone — never re-register them, a ghost counts toward the majority. A
performer whose phone died → their character's Inspector → **⏏ Release**,
then they sign in again on a loaner with the performer code. A silent
tablet goes red on the Run page's Terminals card. A Director broadcast
with **🔔 Alert** ticked banners, chimes and buzzes every phone it reaches,
booths included. Guests can also check themselves into a room by
scanning its sign (`checked_in`, see the integration contract).

### A. Pretext and entrance (rolling arrivals until C1)

| Director fires | Performers do | What happens |
|---|---|---|
| — (start beat `Power On`) | — | Seeds every `Night.*` default and the two Kernel combos. `cue lights_screensaver` / `screens_screensaver`: a classic Windows screensaver on the TV. Trabolta is `hidden: true` and appears on no phone. |
| — | — | **Arrival** (`when someone joins:`): the phone goes on rails in the Optical Drive (`cutscene: true`). **Login**: The Uploader and a real CAPTCHA, which you must *fail* (solving it proves you are human: INCORRECT, try again). **Upload**: pool programs pick the problem Trabolta promised to solve (debt / career / loneliness / mortality), everyone leaves something in the deposit box, agrees to the Terms Of Service, gets 100 Truthcoin, and waits with **their pass** on screen. |
| — | **Antivirus scans the pass at the door** | `TRAIT Enforcer` routes the scan to the shared `Clearance` beat: cleared, the Tube ("a tunnel of lights"), moved to The Desktop, and the house rooms (The Start Bar, The CPU, The Steam Room, Disk Cleanup, The Cloud, The RAM, The Fan Closet, The Graphics Card, The Hard Drive) and `# task-manager` (the app help desk) are revealed on their phone, in one "📂 … and # task-manager are open now." notice. Then **Task Manager** introduces the admin team (Clippy, Adobe Acrobat, the Recycling Bin, himself) in the program's own thread. The first clearance starts the terminals' attract loop (`terminals_attract`). A host's scan only greets. |
| — | — | **Orientation**: Clippy tells them about Bathroom Mode (unlocked here), then her spotlight tour (`show tutorial`, with a **Bathroom Mode step** over the pass button). Finishing it earns *The Orientation List*. Skipping it costs +10 doubt, Norton logs it, and Clippy remembers. **Featured Briefing**: a featured program's identity entry (who they really are) is restored into their Codex ("Tell no one") with their own two red character facts (their secret and their goal tonight: the invitation's character sheet, wave 6); the same two coded facts still wait in the Desktop's books for everyone else. VLC and Pong have no red facts yet. **MS Paint** (`Kernel.anti_ai`) also gets *The Centre Square*: she never agreed to let AI decide. |
| — | Recycling Bin / Antivirus get booth readouts | **Explore and meet.** Bathroom Mode (guest button 🚻) tells the Antivirus you are not hacking the Internet and excuses you from a summons. Props: The Router (kitchen) and The Screensaver (TV). |

### B. Act I

| Director fires | Performers do | What happens |
|---|---|---|
| **C1/V1 · 📣 Call everyone to the Desktop** (`call_to_the_desktop`) | Antivirus sweep everyone to the living room | `!` alert on every phone, the house announces (`do announce` + `sound announce_chime`), the TV leaves its screensaver (`screens_call_desktop`). Clippy's booth: instructions 1/X. |
| **V2 · 🎱 Start Computer Bingo (20 min)** (`start_the_bingo`) | Clippy reads the rules. Hosts introduce themselves | *Computer Bingo* quest for everyone. The asterisk card is checkboxes only, with **no names written down**. Centre square: *"Would you never agree to a life where AI makes all of your decisions?"* Clippy's *Run The Bingo* and Norton's *The Selected Antivirus* quests start. Clippy's booth gets a ping when the 20 minutes are up. |
| **V3 · ⏰ Bingo time: results** (`bingo_time`) | Clippy presses **🎱 Bingo winner** on each winner. Clippy or any host presses **🎀 Award a ribbon**. If there is no Bingo, Task Manager hands Clippy the fake card for MS Paint and presses **🃏**. Clippy presses **🎯 Named on the card** on the program the winner names (marked for reinstallation). **Norton** interrupts and presses **🛡 Send to the Internet** | *Clippy Instructions 2* unlock; Clippy's *Run The Bingo* quest completes (Norton's *The Selected Antivirus*, started with the Bingo, completes at the first reinstallation). The first program sent to the Internet fires **Corrupted Code**: Clippy explains that corruption is normal. Three outcomes are performed live: the winner names the centre-square program, the winner refuses and goes themselves, or nobody wins and MS Paint is framed. |
| **Clippy 2/X · 🤖 Clippy introduces Trabolta** (`introduce_trabolta`; refused before V3; skipped → the next cue wakes him) | — | Trabolta wakes (`awake`, `reveal self`). His chat appears on every phone with a formal private hello. The TV switches to the VR mirror ("Look! That's {first program}!"). **Now re-provision the terminals with `view=auto`, and set stage *formal* on Run → Mind.** |
| *(automatic, on any capture)* | an Antivirus presses **✅ Mark as reinstalled** on the program's card if needed (or the director from Run). Julia runs the tent, in the backyard through the tunnel; the tablet has no such button | **Reinstallation** plays privately in `dm:Installation Wizard` (the same script as the tent video; `cue tablet_wizard`). The program plays the reinstallation game in the tent (VR headset or tablet): follow the golden chevrons to **Gerald, the golden duck**, and walk right up to him. The game fires `the simulation completed` (release) + `the golden duck` (*The Golden Duck*). A marked program who walks to the tent on their own is captured when their run begins: the tablet's begin (or a headset's station) fires `reinstallation begun` first (wave 5), which captures a marked, uncorrupted program, so the wizard shows CORRUPTED and Gerald releases them. An Antivirus 🛡 before Play here still works. |
| **V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)** (`start_the_hunt`) | — | Trabolta reads questions H1–H3 on the TV (the generated `Hunt One Questions`), and they also appear in the *Hunt One* quest. A 5-minute warning comes at 10 minutes. Every answer is a document in the Desktop's books and print media carrying a codex QR (`facts.json`). Clippy's *Host The Hunt* quest starts. |
| **C2 · ⏰ Hunt over** (`hunt_time_up`, *auto* at 15 min) | Antivirus sweep everyone back | *Clippy Instructions 3* unlock. Set stage *hungry*. |
| **V6 · ⚖️ First Moment of Truth** (`first_moment_of_truth`; from the hunt on — pressed during the hunt it ends the hunt first) | **Clippy judges answers spoken in the room** by the question answered, numbered within the round: **✅ Q1–Q3** accurate · **😤 Q1–Q3** wrong but confident (accepted) · **🤷** uncertain or guessed (marked for reinstallation) | Opens judging and a **two-minute last-chance filing window** (`!📝 Last chance…` alert). Accurate and confident answers look the same in public (`✅ … accepted`, +100 Truthcoin, Trabolta truth +4). Only `Kernel.q1…q8` knows which was a lie, and **a lie is sticky** (another program's accurate answer never clears it). A refused press (judging closed, no cup yet, Q3 in the final round, a program in the Internet, a double tap) is a `⚖️` readout in `# hosts` for the judge, never a message to the program. |
| *(after the hunt opens, all night)* **📝 File a fact** (dm:Trabolta) | **The server judges every filing** against `facts.json` the moment it lands: accurate (matches the key), confident lie (no match at 100) or uncertain (no match below 100). Each filing posts `📝 X filed H5 (round 2 Q2): … — certain. Judged <verdict>.` (or `— not certain.`; in review mode `… Proposed: <verdict>. Confirm on their card: …` instead) in `# hosts`. With `Night.judge_mode = review` (Run → Mind, the Judging card) the verdict is only a proposal until a host confirms or overrides it with **📝 Filed fact: accurate / confident lie / uncertain** on that program's card (Run can name the question). | The card is dealt in every program's Trabolta thread when each round's questions open (H1–H3, H4–H6, F1–F2) and re-dealt when a round closes; it lists only the open questions of the open rounds that program hasn't filed yet (a question not filed when its round closes never reappears: a program left with nothing open gets a **📝 The filing is closed** card with no questions, which the phone folds to a note, so the closed questions don't stay on the phone as a task). Pick the question, type the answer, set **"Please select your confidence level in this response"** (a 1–100 slider). One filing per program per question, no lock. Credits and marks land at **settle** time, never at filing (round 1 per question as Clippy reads its results, round 2 at the tally, round 3 at truth.txt): +50 Truthcoin and the Trust Chart for an accepted answer, accurate and confident lie alike, a mark for a guess. The verdict lives only on `Kernel.qN` (a lie is sticky: another program's accurate filing never clears it), so **one DM bluff fails the "all accurate" verdict for good**. A host's mis-tap is not a bluff: overriding the same program's filing back (📝 accurate or 📝 uncertain after 📝 confident lie) takes its lie back, and the question reads what the rest of the record says (wave 6, B11). Trabolta never sees the answer or the verdict; free chat never counts. |
| **⏱ Close round-one filings now** (`close_the_filing`, *auto* at 2 min) | — | The window shuts (`filing_closed`, *Filing Closed*): round one is closed for good and every card re-deals without its questions. Results can be read only once it is closed. |
| **📋 Results: the next question** (`read_the_results`; press for Q1, then Q2, then Q3) | Clippy reads the result aloud from *The Desktop* | *Question Results*: nobody filed / **CONSENSUS** (every filing matches the key and every confidence is 100: Clippy reads the key's answer as `facts.json` spells it, never a filer's alias) / the list of what everyone told Trabolta. Then that question's filings settle: +50 to the accepted ones, a guess is marked. Refused (`# hosts`) while the window is open, while the bottle is open, and after Q3 ("Next: 📺 Preview hunt 2"). |
| **🍾 Spin the bottle** (`spin_the_bottle`, off-sequence, up to five per question) | Clippy: **🗣 Truth answered** (+50) · **🙅 Truth refused** (marked) · **🎩 Chose Dare** (the dead-phone fallback, marked) on the picked program | The server picks a cleared program at the Desktop not yet picked for this question (`do pick`, journaled; nobody left → a `# hosts` readout). Trabolta asks on the TV (*Bottle Landed*: "{name}. Truth or dare?") and their phone gets a **Truth / Dare** poll in his thread. Dare → marked for reinstallation. Truth → Trabolta asks the next personal question from `facts.json` (*Truth Question*, on the TV and in The Desktop); Clippy settles it with 🗣 / 🙅. The next 📋 waits until the bottle is settled. |
| *(optional)* **☎️ Telephone** · **🪅 Are you sure?** | an Antivirus presses 🛡 on the mangler · a host presses 🪙 Pay | Invented set pieces, live from `truth_1` to `trust_chart`. |

### C. The malware, the hour, the Truther Download

| Director fires | Performers do | What happens |
|---|---|---|
| **📺 Preview hunt 2 → the ad hijack** (`second_hunt_preview`) | Clippy panics live (CI 4) | An ad takes over every screen ("000. 000. 000."), the phones too: an alert (banner, chime, buzz). Clippy's booth gets Trabolta's private message: *"if the malware continues we are all going to die."* Every program gets a soothing *"minor irregularity"* DM. Trabolta composure −20. Set stage *rattled*. |
| **📓 Hunt 2 → quest logs; disperse for 1 hour** (`start_the_second_hunt`) | — | H4–H6 go into the *Hunt Two* quest and `# clipboard` opens. The hour starts: the Truther Download comes at +2 min, the five-minute warning at 55 min. |
| **📥 Truther Download** (`truther_download`, *auto* at +2 min) | — | `# truthcoin-exchange` opens. Every cleared program gets *TRUTHER DOWNLOAD v0.9* and *The Malware*. Each featured program gets **its glitch beat**: a CS choice + Orders + a quest. Excel and OpenOffice are quietly added to their factions; Excel is given a virus to plant, OpenOffice 20 facts to gather. Pool programs get *Program Glitch*. |
| — | McAfee brokers the exchange (🪙 Pay / Charge); CRA audits (🪙 Charge) | **Free roam for the hour**: QR clues, trading, Trabolta's DMs. **Excel's virus**: the tent QRs `LOVE-LETTER-FOR-YOU` / `FREE-TRIAL-30-DAYS` give `carries_virus`, then the guest button **💾 Insert a disk** plants it. **OpenOffice's dossier**: 20 new codex entries earn *The LiveJournal*. |

### D. Act II

| Director fires | Performers do | What happens |
|---|---|---|
| **⏳ Five-minute warning** (`five_minute_warning`, *auto* at 55 min) | Antivirus/hosts **scan every arrival at the living-room door** (that is the check-in), or press **📍 Checked in at the Desktop** | `!` alert + a house announcement. *Clippy Instructions 5* unlock. Bathroom Mode excuses you, and so does being in the Internet when the doors close: coming back from either afterwards is not late. The auto warning never fires once Truth Pong has started, so ending the hour early is safe. |
| **🚨 Summons closed: late list** (`summons_closed`, *auto* at +5 min) | every Antivirus booth gets `⏰ X is late … Go get them.` plus the `# quarantine` escort pin. They press 🛡 | Late programs are told an Antivirus is coming and are **marked for reinstallation** (`"late for the Second Moment of Truth"`). Setting `Night.auto_sweep = true` in Run → World captures them automatically instead. |
| **🏓 Truth Pong** (`truth_pong`) | pong judge: **🏓 Made the cup** (may answer) / **🏓 Missed the cup** (marked for reinstallation). Then ✅/😤 Q1–Q3 (= H4–H6) / 🤷 | The folding table is out in the backyard (The Cloud). Round 2 answers spoken in the room need a made cup, and so do the 📝 round-2 filings: at the tally a program with no cup (or marked) is not counted. **Press 🏓 Made the cup for every sink.** Set stage *judge*. |
| **🧮 Trabolta tallies round 2** (`round_two_tally`; only during Truth Pong, once) | — | Judging closes for good; round two's filings settle (+50 / marked) and the round closes. The collection is complete if every round-2 question has an accepted answer ("sixty-one percent" vs "twelve percent"). |
| **📊 Trust Chart** (`trust_chart`) | — | *Clippy Instructions 6* unlock and everyone gets *The Trust Chart*: 10 per accepted truth, −5 per Internet visit, ±10 for his assessment. The TV and the terminals draw the chart **live**: every cleared program, ranked (`chart` in `/api/screen/state`), so an assessment moves a name within 2 s. Trabolta's `assess` power is live. To set an assessment by hand, edit `<guest>.assessment` **and** `<guest>.trust` in Run → World. |
| **🏆 Praise the top, humiliate the bottom, VLC prints** (`show_the_rankings`) | — | Praise The Top → Shame The Bottom → Print The Certificate: *"VLC Player… press the start button on the printer."* The chart stays on the TV and the terminals through all three, with **MOST TRUSTED / LEAST TRUSTED** called out; the *Printing certificate.pdf* slide comes up only at START. VLC and MS Paint get private Truther nudges. If VLC is not here, or is in the Internet, *"The media player is not responding. Any program…"* and nobody is nudged (a VLC released before the beans gets the nudge then). |
| **🖨 Printer: START pressed** · **🫘 Printer opened** (`printer_button_pressed` / `printer_opened`, hardware fallbacks) | VLC presses START; MS Paint urges them to open it | START: *The Printer Jams* and the *Printing certificate.pdf* slide (the chart comes down). Opened: **Full Of Beans**: Clippy reads it as the malware worsening. Composure −20, and the screens flicker on their own. Set stage *unravelling*. |
| **🗜 Antivirus zip everyone out of the Internet** (`zip_everyone_out`) | Antivirus bring everyone out of the Internet (the tent, or the shed on a rain night: every booth and phone line says "the Internet") | Every captured program is released and `.zip`ped. Repeatable; refused once the night has ended and during the banishment (the hand jive frees them). |
| **🤖 Trabolta shares the next facts (scenario 1–4)** (`trabolta_overshares`) | — | He reads F1/F2 (the *Final Facts* quest), then overshares by scenario: **1** Excel planted + 20 facts (Sandy, permanence, the virus, the LiveJournal) · **2** 20 facts only (the LiveJournal) · **3** Excel planted only (the virus) · **4** neither (composed, one slip). Only *Excel's* plant counts. |
| **🕚 System clock → 11 PM, 31 Dec 1999** (`y2k_clock`) | Password Manager's booth logs every faction join | *Clippy Instructions 7* unlock. Composure −25. Unlimited Power and The Way Out are revealed and become sides in the app. Excel / OpenOffice get their Final Orders + recruit quests; everyone else gets *Program Final Round*. Clock warnings come at 23:30 / 23:45 / 23:55 / 23:59. Set stage *desperate*. |
| *(auto)* **majority** | — | **Half + 1 of all guest programs** in one faction, *once its leader has done their task* (Excel planted / OpenOffice's dossier). Performers do not count. **If a leader is absent or stuck, fire 🧾 Let a faction win without its leader's task** (`waive_leader_tasks`). **If ghosts (lost sessions, early leavers) keep the bar out of reach at the Y2K head count, fire 🗳 Force the majority: stay / leave** (`force_majority_stay` / `force_majority_leave`, final round only, latched like the real one). |

### E. Act III: the server room

| Director fires | Performers do | What happens |
|---|---|---|
| *(auto)* `majority_reached` | — | The room is unlocked (`do door server_room, state: unlocked`, `lights_server_open`). Every member of the winning faction gets **The Whole Truth**: all Trabolta and environmental facts (every main + Trabolta fact in `facts.json` comes from the generated `Facts Bundle`), the four combo halves, and **The Legendary Fact** last. The recruit quests settle. |
| **🚪 Server room door opened** (hardware fallback) / **🔓 unlock (override)** | every Antivirus booth: *"Server room breach. Get there."* | **From the Y2K clock on**, entering a locked room trips the **alarm**, latched for 120 s (before that the door and the patch bay, combos included, do nothing — a curious guest or a replayed sensor cannot end the night). Only the first alarm hurts Trabolta. After an unlock, the Antivirus police non-members in person. |
| **♟ Cold Lock: they beat the King (fallback)** (`chess_won`; the tent tablet posts it itself — press it when the tablet or the phone could not) · **🔒 re-lock + re-arm** (`rearm_server_room`) | a host or Antivirus who **saw the mate** on the chess phone taps **♟ They beat the machine** on the winner's card | **From the Y2K clock on**, a chess win disarms the door for **90 s** (`Kernel.disarmed_until`, ring green, `lights_server_open`); then it re-locks (a door still propped open trips the alarm on its next report). Before that a win is practice. `# hosts` logs open/closed. Re-arm locks the room again, clears the alarm latch, closes a window and resets the wrong-patch count (`Night.wrong_combos`); lights stay (💡 restores them). A **loss or draw** (`chess_lost` / `chess_drawn`, reported by the phone or a `mod/signal`, Y2K hour on, while locked) only makes Trabolta gloat on the TV (The Desktop) and posts a `♟` readout in `# hosts`. Inside a window a single wrong patch is forgiven (two still alarm). |
| **🔌 Combo A** · **💥 Combo B** · **❌ wrong combination** (hardware fallbacks) | — | Combo A is `V2-D5, V4-D1, V6-D8, V7-D3` and disables Trabolta. Combo B is `V1-D6, V3-D2, V5-D7, V8-D4` and self-destructs. Two wrong combinations, or one in a locked room, trip the alarm; otherwise Trabolta says *"Stop touching me."* |
| *(auto)* blackout → **🪩 Dance lights** (fallback; auto 10 s later) | — | Every light goes out, every phone is covered by a flashing full-screen **GO TO THE LIVING ROOM** (a room-wide `pin "!!…"`, also an alert and a push), and the dance song plays. The dance (auto or 🪩) takes it down (*💃 Dance.*); the recount, the summary and G1 are backstops. |
| **🏍 After the dance: weakened Trabolta recounts** (`trabolta_recounts`, after Combo A) | — | Everyone gets every backstory + truth.txt. He names each identity, motive and accomplishment, plus the trustworthy and worst program, then leaves on his motorcycle and everyone is freed. |
| **🪦 After the dance: Clippy reads the summary** (`clippy_reads_summary`, after Combo B) | Clippy reads Purgatory from their phone (CI 9) | Purgatory. Private fate lines by faction. Trabolta's line goes dark. The summary says, for each featured program at the party, whether they met their goal (their own quest: Excel's mission, OpenOffice's dossier, DraftKings' majority, Bugdom's four secrets, Jeeves' ten findings, Runescape's gold standard, MS Paint's painting, VLC going viral, Pong's ball in play). **Complete The Gold Standard / Go Viral / Keep The Ball In Play in the Inspector first** for any of the three that met their goal: only a director completes them, and Combo B posts the ones still open to `# hosts`. |
| **💡 Restore the house lights** | — | The manual fallback for Trabolta's `cut_the_lights` (auto-restored after 90 s). |

**The Cold Lock, when it goes wrong.** *The phone is dead, froze, or lost
its game mid-mate, and the crew saw the win:* fire **♟ Cold Lock: they
beat the King (fallback)** from the cue sheet (no guest needed; it's off-sequence,
so LAST / NEXT don't move). *A door propped open:* once the 90 s window
closes, the next "open" report from the door trips the alarm (the first
alarm costs Trabolta), so the server-room watch shuts the door behind the
group. If the crew propped it (setup, a rehearsal, a leftover unlock),
**🔒 re-lock + re-arm** clears the latch and closes any window; **💡**
brings the lights back. A second win inside a window changes nothing
(the 90 s keep running; `# hosts` says the Cold Lock is already open);
pausing the run freezes it.

### F. The final reveal and the other endings

| Director fires | Performers do | What happens |
|---|---|---|
| **🌑 Final Truth Scavenger Hunt reveal** (`final_reveal`, or *auto* at midnight) | Clippy (CI 8): *"truth is always in binary"*; judges F1/F2 with ✅/😤 Q1–Q2 / 🤷 | Lights go dark. Set stage *last act*. **The server room stays live** (deliberate): a combo entered before the verdict still ends the night. |
| **🍎 Bobbing for Truth** (`bobbing_for_truth`) | Clippy / Adobe Acrobat: **🍎 Brought up the Bag of Truth** / **🍎 Failed the bob** (marked for reinstallation) | Nothing moves until someone brings up the bag. Then come the Final Assessment and the bobber's truth.txt. |
| **📄 Read truth.txt → the verdict** (`read_truth_txt`; only once the bag is up) | the bobber reads it aloud (Adobe Acrobat has the printout) | Everyone gets every backstory; the final round's filings settle. **The Verdict** counts answered questions only (U14): no lie on record → **Song Ending**; any accepted lie → **Grok Prom**. A question nobody answered is not a lie. In **both** branches Trabolta DMs every program an answer card: *"Give me a pickup line that works on Sandy."* (judged by the server against `facts.json` → `answer answered`). |
| *(in Grok Prom)* | the first program to type the line on the card wins; or a host presses **💘 Said "You're the one that I want"**, or Trabolta fires `the_line_works` in a DM | **Pickup Line** → Song Ending. In the Song branch the first correct line is read before the song (flavour). |
| **💔 Nobody has the line → confession → rave** (`no_pickup_line`) | — | **Sad Confession** → rave. |
| *(alt, only in Grok Prom)* **💌 Trabolta begs for relationship advice** → **🗳 Count the advice poll** (or **💞 helped** / **⛈ thwarted**, which only answer in the advice phase) → **🕺 Everyone hand-jived** | after thwarted: every Antivirus booth says they are banished too | Help → he wins Sandy. Thwart → everyone is banished to the Internet and learns *The Hand Jive Exception* → the hand jive crashes him. |

### G. The awards ceremony (after any final ending, K-25)

| Director fires | Performers do | What happens |
|---|---|---|
| **G1 · 🏆 Start the awards ceremony** (`start_the_ceremony`; refused until `Night.ended`, and `banished` is not an ending) | Clippy hosts after `destroyed` / `rave` and **reads every line aloud** from The Desktop room | `!` alert to the living room, `screens_ceremony`, `sound ceremony_bed`, **The Ceremony**: the host opens in The Desktop, per ending (Trabolta weakened after `disabled`, rebooted after `hand_jive`, showman otherwise). Trabolta's lines are spoken by the TV. |
| **G2–G6** the five fixed awards (`award_most_trusted`, `award_least_trusted`, `award_frequent_flyer`, `award_lore_hoarder`, `award_truthcoin_tycoon`) and **G7–G9** the three bonus awards (`award_best_liar`, `award_duck_speedrun`, `award_quest_completionist`), each **with the winner picked on the cue sheet** (from the recap numbers) | the winner comes up to the TV for a trophy | **Present Award**: `sound award_fanfare`, the slide `screens_award_<name>` (`Night.screen` = `award_<name>`; it persists over the screensaver), the host's line with the winner's name and number (the winner's own var: trust, Internet visits, codex count, Truthcoin; the bonus awards read the cue sheet's **value** box — lies accepted, the duck time, quests done — and have a line without a number when it is empty), and a 🏆 reply to the winner. `value` also overrides a fixed award's number. Firing an award again corrects it. |
| **G10 · 🖌 Bonus: The Million Dollar Painting** (`award_the_painting`, winner = MS Paint; only when she is at the party) | the painting is revealed for the silent auction | Reads the **🖌 Signed** count (`Night.signatures`) unless **value** is given; a line without a number when nobody was counted. Slide `screens_award_the_painting`. Fired on anyone but MS Paint it is refused in `# hosts` (*"G10 is MS Paint's award…"*); any award fired before G1 says *"Start the ceremony (G1) first"* there; a second 🖌 Signed (or one on MS Paint) says so in `# hosts` and counts nothing. |
| **G11 · 🎃 Resurrection** (`resurrection`; after the last award — G10, or G9 with no MS Paint at the party; before it `# hosts` asks and a second press within 30 s ends the show anyway — refused until the ceremony has started (G1), once) | everyone hangs out, out of character | Everyone is freed (`everyone_free`), unmarked (`unmarked`: both pins down) and unrestricted; the takeover pin comes down; `Trabolta.awake = false` (TV + terminals to attract, no piloting); `screens_screensaver`; `lights_restore`; `!🎃 The show is over: you are human again.` (an alert, so it pushes). |

Lines Trabolta's worker writes (W-24) are posted by the director as
Trabolta in The Desktop; the template lines stay the fallback.

## Endings

Every finale trigger is guarded `Night.ended != true`, so exactly one
final ending happens. `banished` is the one ending that is not final.

| `Night.ending` | Reached when | Result |
|---|---|---|
| `disabled` | Combo A patched (normally after a majority unlocked the room) | blackout, the dance, then **Trabolta Recounts**: he cannot truly die, rides off on his motorcycle, and everyone returns |
| `destroyed` | Combo B patched | blackout, the dance, then **Purgatory**: improper shutdown, bodies dead in the Maps and Ducks building, purgatory forever together. Fate lines: Unlimited Power "went with it", The Way Out "into purgatory, with everyone else" |
| `song` | truth.txt read with no lie on record (answered questions only) | he solved the theory; vocoder duet with Sandy; leavers may leave |
| `song_pickup` | in Grok Prom, someone gives the line (the answer card, 💘 or `the_line_works`) | the song, and everyone is released |
| `rave` | in Grok Prom, `no_pickup_line` | Sandy-only song; he confesses anyway, reads her line as YES, rides away; everyone is trapped; rave |
| `help` | in Grok Prom, ask for advice → helped | he wins Sandy; leavers may leave |
| `banished` (not final) | ask for advice → thwarted | every program is captured, Antivirus included; everyone learns The Hand Jive Exception |
| `hand_jive` | `the_hand_jive` while banished | recognition overflow; he reboots and leaves; everyone returns |

The final reveal is reached when the director fires it, or at midnight
(60 min after the clock reset) when nothing has ended yet. That covers
"nobody recruited a majority" and "the server-room information was gained
but not used".

## Knowledge is the currency: the Codex

Every `CODEX` entry is a piece of lore a participant can **hold**. There
are **178**, and **90** of them carry a code (the 56 generated from
`facts.json` included). An entry reaches a holder in one of five ways:

1. **A code.** `code: MISTER-PICKLES` is printed as a QR in the house.
   Scanning it opens the app with `?code=<event>&unlock=<code>` and redeems
   it, or the guest types the code into the Codex room. Codes match
   loosely: case, dashes, underscores and spaces are ignored (but **not**
   apostrophes, so no code contains one). A wrong code fires `wrong code`:
   doubt +8, and Password Manager notices.
2. **The story.** `unlock X for program` in a beat or ROLE hook. Party-wide
   unlocks are always per-member ROLE watchers, because `unlock X for
   everyone` does nothing.
3. **A person.** Every named character holds the entries *about* them (plus
   `known to:`) and shares them from the booth. Guests share theirs from a
   card. Sharing an entry **to Trabolta** marks the guest `delivered` and
   adds +2 to his truth. *The Prom Ticket* and *The LiveJournal* rattle him.
4. **Show hardware**, through `POST /api/mod/codex {who, entry}`.
5. **A trade.** From the pinned **Wallet** room a program offers another
   Truthcoin for an entry (or an entry for Truthcoin); on accept the server
   moves the coin and shares the entry (escrowed, journaled; see the
   integration contract). An agent-voiced character refuses an entry about
   anyone else.

| Tier | File | What it is |
|---|---|---|
| **E** environmental | `1-world` (20), `2-files` (22) | Halifax, the billboard, the sinkhole, the pet cemetery, the Halifax Computer, the printer, the Y2K clock, the virus QRs, *The Cold Lock*, and **21 coded "files"** hidden around the house. The **ID** files point at someone's human identity without naming them (a casino deed, an FBI lanyard, a 1988 campaign button…). |
| **H** hunt answers | `generated/questions.loom` (8, from `facts.json`) | One per question, each on a document in the Desktop's books. Each ends `▒ HUNT ANSWER <id> ▒`, the lore marker Trabolta's worker hides. The six-stamp pickup-line mechanic was retired 2026-10-16 (U9): the line is learnable from Sandy's lore and asked on the pickup-line card. |
| **F** facts | `9-facts` (48 coded, from `facts.json`) | The team's scannable facts, in the Desktop's print media by colour — 48 generated from `facts.json`'s 60 rows: **main** (what this place is: 30 rows, 21 generated here; the other 9 point at hand-written entries in `1-world` / `4-trabolta`, 6 of them coded), **trabolta** (6 rows: 3 generated, 3 hand-written in `2-files` / `4-trabolta`) and **character** (24: two coded facts per invitee — their secret and their goal tonight — the second and third of the three entries each invitation promises; the first is the identity entry, and all three reach the invitee at Featured Briefing). `generated/print-stacks.md` says which stack and where. Five of the hand-written entries gained codes in wave 4 (`UNIFIED-FIELD`, `TARGET-SELECTION`, `TRUST-CHART`, `SANDY-FILE`, `ALL-FOR-HER`, all in `4-trabolta`). |
| **T1** Trabolta surface | `4-trabolta` | *Jean Trabolta*, *The Unified Field Theory*, *Target Selection*, *The Trust Chart* (`about: Trabolta`, so he holds and may share them). |
| **T2** Trabolta private | `4-trabolta` | *The Sandy File*, *The Question Of Force*, *The LiveJournal* (`TRABOLTA-4EVER`), *Omnipotence*, *Greased Lightning*. His stage rules keep these back until *unravelling*. |
| **L / P** the heart | `4-trabolta` | *The Legendary Fact* + four combo halves, `about: The Server Room`. **He never holds them.** Only the majority faction gets them, via The Whole Truth. |
| **X** finale | `4-trabolta` | *The Truth File* (truth.txt), *The Hand Jive Exception*. |
| **B** backstories | `5-people` (21) | Each performer's and featured program's human identity (the invitation's "who you really are"), each ending "Why Trabolta chose you". Featured programs get theirs at Featured Briefing. Everyone gets all of them at the recount / truth.txt. The four Antivirus files carry codes (Bugdom hunts them). |
| **M** missions | `6-missions` (13) | Private orders for one featured program (the glitch choices and the final orders). |
| **CI** Clippy | `7-clippy` (9) | *Clippy Instructions 1–9*, unlocked for Clippy only, one per phase (the private-to-Clippy channel). CI 3–9 are invented. |
| **J** Jeeves | `8-jeeves` (20) | Scrambled fragments of 20 environmental entries, in the Character Sheet's Kmart style, for Broken Ask Jeeves to unscramble. |

The **directory** (`directory: everyone`) shows every guest and every
`listed: true` character by name, plus exactly the entries *about* them
that you hold.

## Things to do: the Quest Log

Each program has a pinned **Quest Log** room. Each quest gets a card and
its own thread of steps.

| QUEST (`title:`) | From | Started | Settled |
|---|---|---|---|
| Orientation (*Clippy's Orientation*) | Clippy | `Orientation` beat | tour finished ✅ / skipped ✖ |
| The Bingo Card (*Computer Bingo*) | Clippy | `start_the_bingo` (+ late catch-up) | `bingo_time` ✅ |
| Hunt One (*The Truth Scavenger Hunt · Round 1*; generated from `facts.json`) | Trabolta | `start_the_hunt` (+ catch-up) | `hunt_time_up` ✅ |
| Hunt Two (*The Truth Scavenger Hunt · Round 2*; generated) | Trabolta | `start_the_second_hunt` (+ catch-up) | `round_two_tally` ✅ |
| The Final Facts (*The Final Fact-Finding Round*; generated) | Trabolta | `trabolta_overshares` (+ catch-up) | `read_truth_txt` ✅ · ✖ Combo A or Combo B |
| Excel Mission (*Computers Are Very Confusing*) | Truther Download | Excel Glitch (text by choice) | step on carrying the virus; ✅ on planting |
| OpenOffice Dossier (*Facts Are Currency*) | Truther Download | OpenOffice Glitch | step at 10; ✅ at 20 new facts (+ The LiveJournal) |
| Recruit To Stay (*Stay Forever*) | Truther Download | Excel Final Round | ✅ stay majority / ✖ leave majority |
| Recruit To Leave (*Get Out*) | Truther Download | OpenOffice Final Round | ✅ leave majority / ✖ stay majority |
| Truthcoin Hustle (*Sweet Sweet Truthcoin*) | Truther Download | DraftKings Glitch (+200 stake) | step at 1000; ✅ more than half of all the Truthcoin in circulation, coin in flight (pending, held, an open offer) included (with ≥ 5 other cleared programs) |
| Master Of The Bugs | Truther Download | Bugdom Glitch | ✅ holding all four Antivirus files |
| Unscramble (*Organize The Information*) | Truther Download | Jeeves Glitch | ✅ holding 5 of the 10 originals behind his fragments |
| Ten Findings (*Ask Jeeves Once Again*) | The Uploader | Jeeves's clearance | step per program that holds ten of his findings (shares + wallet sales; repeats and Trabolta don't count); ✅ every cleared program (≥ 5) |
| The Gold Standard (*Peg It To Facts*) | Truther Download | Runescape Glitch | director completes |
| Find The Exit (*Paint Your Way Out*) | Truther Download | MS Paint Glitch | ✅ leave majority, Combo A, or the hand jive |
| The Painting (*The Million Dollar Painting*) | The Uploader | MS Paint's clearance | step per **🖌 Signed the painting** (a host on the signer's card; the canvas is physical); ✅ every cleared program but her (≥ 5) |
| Go Viral (*Your Followers Are Back*) | Truther Download | VLC Glitch | director completes |
| Keep The Ball In Play (*Tennis For Two*) | Truther Download | Pong Glitch | director completes |

**Staff quests** (`start|update|complete quest X for <Character>`): Clippy
and the four Antivirus have a pinned **Quest Log**, **Codex** and
**Inbox** in their booths (performers answer cards there via `POST
/api/prime/widget`), and Task Manager hands out the night's jobs:

| QUEST (`title:`) | For | Started | Settled |
|---|---|---|---|
| Run The Bingo (*Per the agenda: Computer Bingo*) | Clippy | `start_the_bingo` (updated when the 20 min are up) | `bingo_time` ✅ |
| The Selected Antivirus (*Patrol: the Bingo*) | Norton Anti-Virus | `start_the_bingo` | `first_reinstallation` ✅ |
| Host The Hunt (*Per the agenda: the Truth Scavenger Hunt*) | Clippy | `start_the_hunt` (updated at `hunt_time_up`: ⏱ / 📋 / 🍾) | `second_hunt_preview` ✅ "Round one judged." |
| Keep Everyone Calm (*Per Trabolta: keep everyone calm*) | Clippy | `second_hunt_preview` (updated at the five-minute warning: Truth Pong) | `y2k_clock` ✅ |
| The Exchange (*Patrol: the exchange*) | McAfee Anti-Virus | `truther_download` | `final_reveal`, or a server-room ending (`trabolta_disabled` / `computer_destroyed`) ✅ (the wallet trades on through the Y2K hour) |
| The Audit (*Patrol: the audit*) | CRA Agent Software | `truther_download` (a step per approved / denied transfer) | `final_reveal`, or a server-room ending ✅ |
| The Clubs (*Patrol: the clubs*) | Password Manager | `y2k_clock` | the majority ✅ |

A director or a puzzle can move any quest with
`POST /api/mod/quest {who, quest, action: start|update|complete|fail, text?}`
(`who` is a guest id or a character name).

## Trabolta: arc and powers

Trabolta is two models on the host's laptop (stagehand's `agents` module).
The **voice** (gpt-oss:20b) answers in seconds from `trabolta.persona.md`
and his current mind. The **mind** (the Qwen distill) grows between turns
from `trabolta.mind.md`. Every model call is shown live on **Run → Mind**.
**The story decides the night; the model colours it.** Set pieces are
scripted `Trabolta:` lines. The model voices DMs, terminals and
performers' Cast threads, and uses powers. No ending fires from the
model's numbers. The director reads `love` / `regard` when choosing the
advice branch.

**Offline until introduced:** `hidden: true` keeps him off every phone
until `introduce_trabolta` (refused before Bingo results). The worker gate
`self.awake == true` has no performer exception. After `computer_destroyed`
the gate closes again.

| `Night.phase` | Stage (click on Run → Mind until the phase map lands) | Tone | Powers live |
|---|---|---|---|
| arrivals · desktop · bingo · bingo_results | asleep | offline | none |
| introduced · hunt_1 | **formal** | corporate; "Your request has been logged"; personal questions go to Clippy | snoop, flicker; pop_up from hunt_1 |
| truth_1 | **hungry** | warmer to those who delivered; may pay with one T1 entry | + mint_truthcoin |
| malware · hunt_2 · summons | **rattled** | reassures, then leaks; paranoid about the malware | + cut_the_lights, summon_the_antivirus, trabolta_announces |
| truth_pong · trust_chart | **judge** | every DM is an audition; tells you your rank | + assess (trust_chart), pardon_a_program |
| beans · overshare | **unravelling** | overshares, retracts, asks for relationship advice; cold to the LiveJournal reader | all, degrading (pop-ups arrive garbled) |
| y2k · majority | **desperate** | short, counting down, bargaining; courts Unlimited Power | + turn_back_the_clock; mint pays up to 100; flicker is **lost** |
| final_reveal · bobbing | **last act** | knows how his story ends | assess (bobbing only) |
| grok_prom · advice · finale_* | last act | heartbroken / total honesty / per ending | the_line_works (grok_prom only) |

Drives: hunger 30, suspicion 35, pride 60, candour 10, longing 40. The
voice may nudge `truth`, `untruth`, `composure`, `love` and `regard`
(clamped by the server). The story moves composure (malware −20, beans
−20, y2k −25, first alarm −10, virus −10, LiveJournal −10) and truth (+4
per accepted answer, accurate **and** confident alike, +2 per fact shared
to him). It never writes `untruth`, because doing so would tell him which
answer was false.

**Powers** (`INTERACTION … who: agent` in `cast/trabolta.loom`). Every use
is a journaled signal fired *as* Trabolta. Outside its window a power
answers *"That function is not available yet."* / *"I do not have the
strength."* and still counts against its limit. A power fired with no
program on the thread (from a performer's Cast thread) does nothing and
says nothing, so no refusal ever lands in the public lobby. An empty
pop-up or announcement and a non-positive amount are refused out loud.

| Power | Limit | Args | Live | Effect |
|---|---|---|---|---|
| snoop | 8 | target | step 4–15 | target doubt +3; "👁 Something has opened your file." |
| flicker_the_screens | 3 | — | step 4–13 | `cue screens_flicker` (stagehand also blinks the lights) |
| play_on_the_screens | 3 | clip | step 4–13 | one card on the wall terminals only: `dancing_baby`, `hamster_dance`, `under_construction` or `youve_got_mail` → `cue terminals_<clip>`: a text card for the 45 s terminal slide hold (never the TV; refused while the Trust Chart is up). It becomes the terminals' newest slide on the server: a terminal (running, or reloaded: it remembers the last story slide) keeps a story slide still in its hold and shows the clip after it; a terminal that boots with no memory shows no clip at all for that clip's hold, never the clip over a story slide |
| pop_up | 4 | target, text | step 5–15 | a 💬 message on one phone (garbled from beans on) |
| mint_truthcoin | 10 | amount | step 6–15 | pays the speaker up to 50 (100 once desperate) |
| cut_the_lights | 2 | room | step 7–15 | `<cue: lights, room: …, state: off>` for 90 s (the room folds onto the LOCATION: "the start bar" works; the restore is skipped if a lighting cue has run since). Allowed only in The Start Bar (dims to ~20%, never dark), The Desktop or The RAM (never The Cloud, the tent, the stairs, the bathrooms, the server room, or a room with no light group of its own); one room at a time |
| summon_the_antivirus | 4 | target | step 7–15 | target doubt +15; every Antivirus booth: "Trabolta requests a sweep of X" |
| trabolta_announces | 2 | text | step 7–15 | `!📢 TRABOLTA: …` to everyone |
| assess | 40 | target, score | trust_chart, bobbing | sets the ±10 assessment and recomputes trust |
| pardon_a_program | 1 | target | step 11–15 | releases a captured program |
| turn_back_the_clock | 1 | — | the Y2K hour | midnight moves 5 minutes later |
| the_line_works | 1 | — | grok_prom | accepts the pickup line for the speaker → Song Ending |

He also shares any entry he holds, exactly like a performer's booth. Nobody
can hand *him* lore about someone or somewhere else: the server refuses a
share to an agent-voiced character of any entry `about` another person or
place (so a guest cannot launder a combo half through him, and no delivery
reward is paid for one). The four combo halves are titled *Patch Sheet A/B ·
1/2 of 2*, because his prompt lists the titles of what a speaker holds.
`lookup: false` ships for opening night: until the stagehand secrecy fix
lands, a lookup of a codex title would hand the voice its full text,
patch pairs included.

## Casting

**Performer parts** (one booth each):

| Part | Actor | Group | The job |
|---|---|---|---|
| Clippy | Brooke | Hosts | MC and Trabolta's ambassador. Gets every Clippy Instructions entry and the hosting quests in her booth. Presses 🎱 / 🎀 / 🎯 / the judging buttons / the bottle's 🗣 / 🙅 / 🎩. |
| Task Manager | John | Hosts | "Keeps things running." The programs' main contact: introduces the admin team at clearance, owns `# task-manager` (the app help desk) and is listed from the start, so every program can DM him (answered from Run by the director's identity control, or from his own phone). Produces the fake Bingo card (🃏). Hands out the staff quests. The hosts' cash bank (🪙 corrections). |
| Adobe Acrobat | Stephanie | Hosts | "Documents and printing." Holds the Bag of Truth and the truth.txt printout; stands by the printer. 🍎 at the bob. |
| Recycling Bin | Jesse | Hosts | "Hygiene and maintenance." Disk Cleanup (bathroom) attendant; knows Bathroom Mode. |
| Norton Anti-Virus | Julie | Antivirus | The selected Antivirus who interrupts the Bingo celebration. Door scans; escorts from `# quarantine`. |
| McAfee Anti-Virus | TBD | Antivirus | Door scans; broker of `# truthcoin-exchange` (every settled trade posts itself there; 🪙 Pay / Charge for corrections). "Your protection has expired" every 20 min. |
| Password Manager | Francine | Antivirus | Door scans; notices wrong codes; keeper of the clubs (faction joins land in her booth; owns `# hidden-partition` / `# back-channel` invites). Removes inappropriate messages: the director decides at call whether her booth gets the moderator passcode (then ☰ → Become an admin → **hide**); otherwise she asks the director. Yu-gi-oh! everywhere. |
| CRA Agent Software | Emma | Antivirus | Door scans; the Truthcoin **approver** (`wallet: approver, every 3, window 60s`): every third transfer waits in her booth's Wallet room for **Approve**, and any transfer can be **denied** within 60 s. 🪙 Charge for corrections. Replaces MalwareBytes. |
| Installation Wizard (a voice, not a part) | Julia Tufts | — | The tent, in the backyard through the tunnel: the Wizard's lines are the tent tablet / video script; Julia runs the tent (the tablet is provisioned with the mod token); the release is the duck find, else the admin cue *Reinstallation: simulation completed (server)* — a release by hand is an Antivirus booth's ✅ Mark as reinstalled (or the director as an Antivirus via Run's identity control); the tablet has no such button. The tablet's scan of a pass plays the video in the program's thread; a marked program is captured on arrival. |

**Featured programs**: guests with pre-written characters. They pick
themselves at sign-in and never speak in the story.

| Program | Invitee | Secretly | Night's job |
|---|---|---|---|
| Microsoft Excel | Rob Cameron | Randy Barkmore Sr., 90, former Mayor | plant the virus; lead **Unlimited Power** (stay forever) |
| OpenOffice | Lara Lewis | Dana Anderson, ex-FBI hacker | gather 20 facts; lead **The Way Out** |
| DraftKings | Hannah | the gambler who won the casinos | a majority of the Truthcoin (1000 is a step) |
| Bugdom | Veronica | the pet-store worker whose Bugdom VR burned | the four Antivirus files |
| Broken Ask Jeeves | Kai | the Annapolis Valley youth librarian | unscramble 20 fragments; ten findings with every program (Ten Findings) |
| Runescape | Laurel | 34, Wharton PhD, gold standard | peg Truthcoin to facts; the Truthcoin **minter** (`wallet: minter, limit 3, grants 3, freeze 10m`): from her Wallet room, up to three stimulus payments to every program, three grants to one program each, and a ten-minute freeze on any program's outgoing coin |
| MS Paint | Cat Frawley | the Paint-only art student: four schools, three refused theses | **the designated anti-AI program** (Bingo centre square); find the exit; every program signs one painting (The Painting, hosts press 🖌) |
| VLC | Zeus | Victor Louis Christianson | print the certificate; go viral for Trabolta |
| Pong | Em | child of William Higinbotham | keep the two leaders talking |

The actor names appear only in this table, never in the story. The
featured tag is set by an exact-name compare on the picker's spelling. A
director can fix `<guest>.featured` in Run → World.

**Pool programs** (`cast/pool.loom`, 22): Calculator, Ring Doorbell,
WinZip, GarageBand, LimeWire, MSN Messenger, 3D Pinball, RollerCoaster
Tycoon, Zoo Tycoon, Minesweeper, Trojan Horse (the two accordion clowns:
**one program, one phone**), Ctrl Alt Del, Solitaire, Winamp,
Napster, Encarta, Netscape Navigator, ICQ, The Sims, Notepad, Paint Shop
Pro, RealPlayer. That makes 31 guest identities in total. A guest who
wants something else searches the program directory (Wikipedia, software
only, **never antivirus**).

**Not on any picker:** Trabolta (the language model, avatar
`HAL9000.svg` as a stand-in) · Sandy (one line, verbatim) · Truther
Download (sends every glitch prompt) · the props The Uploader, The Router,
The Screensaver, The Tablet · Kernel (the hidden secret state). Every
named character's picture is hand-picked (`avatar: File:…`).

## Integration contract

Everything outside the phones is a client of the event server's mod API,
authorised by the moderator passcode (`POST /e/:id/api/mod/login
{passcode}` → `token`, then `x-loom-token` on every call). Every bridge
sends an ordinary journaled mutation, so a rehearsal in Run mode and the
live night replay identically.

| Piece | Direction | Call |
|---|---|---|
| **Show control** | story ⇄ house | [`stagehand/trapped.house.yaml`](../../../stagehand/trapped.house.yaml) (the `show` module, on the house Mac) joins the mod SSE feed. It maps `cue lights_*` to Zigbee2MQTT `scene_recall` + WLED presets, the long form `<cue: lights, room: X, state: off\|on>` to that room's group, `sound <name>` to the QLab cue of the same name, `do announce "…"` to MQTT `show/announce` → stagehand's `alexa` player on the house Mac (a chime + the Mac's own `say` voice on MOTU zones Z1 living + Z2 kitchen — the server voice is opt-in, `engine: server`; [`scripts/house-mac/alexa.md`](../../../scripts/house-mac/alexa.md)); the same announcement rides `GET /api/screen/state` as `announce {seq, text}`, so terminals provisioned with `announce=1` chime and speak it too (off by default, and on `view=tv`), and `do door server_room, state: locked\|unlocked` to the ESP32 door indicator (`show/serverroom/lock`, retained; no maglock). `lights_blackout` never darkens the stairs, bathroom, tent, server room or the server-room → living-room path (they are out of the `house` group; WLED goes off per device and the Tube strip stays on a dim static preset). `screens_flicker` also blinks the house lights. Screen cues (`screens_*`, `tv_*`, `terminals_*`, `tablet_wizard`) are mirrored into `Night.screen` / `Night.terminals` until a Screens layer exists. |
| **Sensors** | house → story | stagehand turns MQTT into `POST /api/mod/signal {name}`: `server_door_opened` (door contact, `edge: true`, retained messages ignored; the story latches the alarm for 120 s), `printer_button_pressed`, `printer_opened`, and the patch bay's `patch_combo_a` / `patch_combo_b` / `patch_rejected` (the server-room ESP32, [`hardware/server-room/`](../../../hardware/server-room)). Stagehand judges the combos until signal args exist. Every one also has an admin fallback button. |
| **The King** (the Cold Lock in the simulation) | tent tablet → story | `house.json` prop `cold-lock-king` (`kind: "king"`, `hp: 8` since wave 5, `signals: {won: "chess won", lost: "chess lost", drawn: "chess drawn"}`, `armed: {path: "Night.step", min: 14}`) guards the door `server-door` (`guard: "cold-lock-king"`; shut for `route()` until he falls). On the tablet (`reinstall/web`, a chess.js board) the program hits him (⚔ / Space, one hit per 2 s cooldown since wave 5, same floor, within reach, facing him) to drop a heart and dumb the AI down a stage (grandmaster → club → beginner → dizzy → pawns only), then challenges him (♟ / C); mate fells him and the game posts `POST /api/mod/signal {name: "chess won", subject: <guest id>, label: "Tent tablet"}` with its mod token (retried 0.5 → 8 s on a network error / 5xx; a 4xx is final). `label` is honoured when the caller is the generic mod-token "Director" (an author session's own name is never overridden), so the journal and recap say *by Tent tablet* — the same rule as `/api/mod/impersonate`. A headset (`reinstall/vr`) shows the King with "The King is fought on the tent tablet." The fight is per session; since wave 5 the tablet says when a win didn't land, and a pending win survives a reload and is re-posted once only within 60 s. A pawns-only stalemate opens nothing. Not device-checked yet (U17): the chess phone below stays the fallback. |
| **The chess phone** (the Cold Lock, fallback) | phone / performer / director → story | The phone runs the Lichess app and reports nothing, so a win arrives one of two ways: a host or Antivirus who saw the mate presses **♟ They beat the machine** on the winner's card (`POST /api/prime/act {name: "beat_the_machine", guest: <guest id>}` → `fire chess_won for program`), or the director fires the admin cue **♟ Cold Lock** (`POST /api/mod/signal {name: "chess_won"}`; `"chess won"` folds to it). A phone app that can report sends the same signal, plus `chess_lost` / `chess_drawn`; a duplicate win inside the window changes nothing (no restart, no second notice). From `Night.step >= 14`, while the room is locked: `Kernel.disarmed_until = Time.elapsed + 90`, the alarm latch cleared, `do door server_room, state: unlocked` (ring green), `lights_server_open`, and `# hosts` logs it; before that a win is practice (`# hosts` says so); when the window closes, `do door server_room, state: locked` and `lights_y2k`. `server_door_opened` alarms only outside a window. `rearm_server_room` closes a window. No heartbeat (OP-12). Director's runbook: Help → *Running the Cold Lock* (`docs/help/authoring/38-cold-lock.md`). |
| **Check-in** | door / QR / terminal → story | `POST /api/mod/signal {name: "checked_in", subject: "<guest id>", args: {at: "The Desktop"}}`. `at` must be the **exact declared LOCATION name**. Anything else, or no arg, moves nobody. Sources: the door scan during the summons, the 📍 button, and **room signs** (K-13): a guest's camera opens `?code=&checkin=<slug>` and the phone posts `POST /api/guest/checkin {at: slug}`; the server folds the slug onto the LOCATION and signals `checked_in`. Refused while captured, **restricted (marked, 409)**, on rails, in a prison / sealed room, for a hidden, prison, cutscene or `checkin: false` room (The Server Room), and within 20 s of the last check-in; the story also turns a marked program away ("Go to the Internet, not the Desktop"). |
| **The cards: CAPTCHA, tutorial, poll, fact, answer** | guest phone → story | `show captcha / tutorial / poll / fact / answer …` cards answer via `POST /api/guest/widget {seq, result}`, which the story hears as `when captcha answered for program:` (and so on). A **📝 fact** filing (`{question, answer, confidence 1–100}`) is judged by the server first when the event has a facts key: `verdict` (`accurate` / `lie` / `uncertain`) rides the event args into `fact answered`; 400 on a reserved key (`card`, `verdict`), a bad confidence or an unknown question. The **answer** card (the pickup line, `question: "P1"`) is judged the same way → `answer answered`. A performer answers the cards in their booth via `POST /api/prime/widget {seq, result}` (never judged). |
| **The facts key** | project → server | `facts.json` is a **project file** like the house map: `pnpm sync-show` pushes it, a launch snapshots it (`project-facts.json` in the event's state dir), `POST /api/mod/load {facts}` replaces it live; with no project copy the server reads `LOOM_FACTS` (default: `facts.json` beside the house map). `Night.judge_mode` (`auto` / `review`; `POST /api/mod/var {path: "Night.judge_mode", value}`, the Run → Mind Judging card) decides whether a verdict stands at once or waits for a host. The key never enters the story and never reaches Trabolta's worker. |
| **Wallet** (Truthcoin) | guest / performer phone → server | The header `currency: score as Truthcoin, max 500, expiry 10m` makes `program.score` the balance (🪙 on the pass, the pinned **Wallet** room; the server's `wallet.ts` moves the coin, the story only narrates). Guest: `POST /api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,grant,freeze,approve,deny}` → `{ok, wallet}` (`send {to, amount}` 1–500 whole Truthcoin, balance permitting; `request` expires after 10 min; `offer` an escrowed trade of coin ⇄ a codex entry, settled on `accept`). The approver (`CRA Agent Software`, `wallet: approver, every 3, window 60s`): every third transfer is **held** until `POST /api/prime/wallet/approve {id}` (or `deny`) from her booth's Wallet room → `{ok, queue}`; any other transfer can be denied for 60 s, refunded. The minter (`Runescape`, `wallet: minter, limit 3, grants 3, freeze 10m, while program.cleared == true`): `stimulus {amount}` mints (never debits) `amount` to every program, three times a night; `grant {to, amount}` mints to one cleared program, three times a night; `freeze {to}` refuses that program's send / pay / buy for ten minutes on the story clock (coin still comes in; one freeze per program at a time). Director: `POST /api/mod/wallet/{approve,deny,cancel} {id}`, `/api/mod/wallet/stimulus {amount}`, `grant {to, amount}`, `freeze {to}`, `unfreeze {to}`. The book fires `transfer_received / approved / denied`, `offer_accepted`, `stimulus`, `grant`, `wallet_frozen` / `wallet_thawed` (…) into the story: `# truthcoin-exchange` posts every transfer, trade, grant from the minter's phone (a director's grant posts nothing) and freeze, `# hosts` every denial, The Audit quest every CRA decision. Throttle: `LOOM_RL_WALLET` (30/min per guest). Trades bypass the approver by design. |
| **Wall QR codes** | guest phone → app | Print from the editor: Run → Join → **🖨 Print sheet…** (QRs drawn in the browser). Source: `POST /api/mod/codes` → `codex[]` (`?code=&unlock=`), `joinLink` (the join poster) and `checkin[]` (one room sign per non-prison, non-cutscene LOCATION, `?code=&checkin=<slug>`). A signed-in guest redeems on load. |
| **Recap numbers** (the ceremony) | server → director | `GET /e/<event>/api/mod/recap` (directors only: the author session or `?token=<mod token>`) → ranked lists off live state: `trust`, `truths` (accepted minus lies), `lies` (accepted confident lies, Moment of Truth + DM filings, credited off the log — no program var holds them), `internetVisits`, `codex`, `quests` (done), `truthcoin`, plus `factions` and a paste-ready `text`. `?format=text` returns just the text, to copy into the cue sheet's winner/value boxes or `cast:Trabolta`. Rehearsal personas are listed, marked `(persona)`. `duck` is the **Golden Duck Speedrun** (G8): each program's fastest find in either game, fastest first, `time` as `m:ss` for the value box — timed by the server from a tablet's *Play here* or a headset's first pose to the find (a director's pause doesn't count), kept in `spatial-runs.jsonl` in the event's state dir (survives a server restart, cleared by a story restart). |
| **Phones: re-pair, release, push** | director / phone → server | `POST /api/mod/guest/pair {id, revokeOthers?}` → a single-use `?code=&pair=` link (10 min; the phone trades it at `POST /api/guest/resume {pair}` for a fresh token) · `POST /api/mod/prime/release {character}` · push: `GET /api/push/config`, `POST /api/push/subscribe {subscription}` (refused while the doors are closed; 300 devices per event), `POST /api/mod/push/status`. |
| **Codex room** | guest phone → server | `POST /api/guest/codex/redeem {code}` · `POST /api/guest/codex/share {entry, to}` |
| **Performer booth** | performer phone → server | `POST /api/prime/codex/share {entry, to}`; `POST /api/prime/act` fires the guest-card buttons *as* that character; `POST /api/prime/widget {seq, result}` answers a card dealt to the booth (`show … to <Character>`; `PrimeView.quests` / `codex` feed the booth's pinned Quest Log and Codex rooms). |
| **Puzzles / hardware unlocks** | puzzle → story | `POST /api/mod/codex {who, entry}` · `POST /api/mod/quest {who, quest, action, text?}` (`who` a guest id or a character). Guest ids come from the pass QR, or from `/api/state?role=mod` → `roster`. A director can also `POST /api/mod/act {id, action: restrict\|unrestrict}` or `POST /api/mod/set {id, field: "restricted", value}` to lift or apply a mark's restriction by hand. |
| **Bathroom Mode** | phone / tent → story | `POST /api/guest/act {name: "go to the bathroom"}` with the guest's token (and `back from the bathroom`), or `mod/signal {name, subject}`. |
| **Reinstallation games: devices** | game ⇄ server | Two games, one simulation ([`docs/loom-reinstall.md`](../../../docs/loom-reinstall.md)). The **VR** game runs on the Quest 3 headsets (`reinstall/vr/`, Godot; left stick walks, right stick turns). The **web** game runs on the tent tablet (`/reinstall/`, twin touch sticks + keyboard). Set each device up once with the moderator passcode: the tablet via `/reinstall/?code=<mod>&name=Tent tablet`, a headset via its `station.json` (`server`, `code`, `station: vr-1`). A headset idles in a dark lobby polling `GET /api/mod/spatial/station?id=vr-1&name=Headset 1&world=vr`. |
| **Reinstallation games: a session** | tablet → server | The captured program holds their pass to the tablet's camera (or the operator taps them under *In the Internet now*, or types their name; `GET /api/mod/spatial/candidates` lists captured programs first). Any desktop browser can stand in for the tablet (keyboard + mouse; `reinstall/web/README.md` → *A demo with no hardware*); one without WebGL2 says so and offers the headsets only. Then **Play here** or **Send to VR-1** (`GET /api/mod/spatial/stations`) → `POST /api/mod/spatial/begin {guest, world, device, station?}`. The game streams `POST /api/spatial/pose` (10 Hz, house frame, session token) and ends with `POST /api/spatial/end`. The director can end a session with `POST /api/mod/spatial/end {session}`. Poses never touch the journal. |
| **Reinstallation games: the duck** | game → story | Walking up to Gerald posts `POST /api/spatial/found` (409 unless the last pose is within 2 m). The server commits, `by` the device, `signal("the simulation completed", guest)`, which releases a corrupted program, then `signal("the golden duck", guest)`, which grants *The Golden Duck* to anyone. Admin fallbacks: **Reinstallation: simulation completed** / **the golden duck**. Before a run starts, `POST /api/mod/spatial/begin` commits `signal("reinstallation begun", guest)` `by` the device (only because the story declares it), so a marked arrival begins captured. |
| **The house map** | director → games + screens | `house.json` (+ `house.shed.json`, the rain variant) are **project files**: `pnpm sync-show` pushes them with the story, a launch snapshots them, Push draft refreshes them. Served per event by `GET /api/spatial/house`. Edit it at **`/reinstall/map`**, which saves via `POST /api/mod/spatial/house {house, base}` (409 on a stale `base`); keep a save with `POST /api/mod/spatial/house/project` (Save to project). Tent ↔ shed: `POST /api/mod/spatial/variant {file: "house.shed.json"}`, mid-show too. Rooms map to LOCATIONs (the real house, 2026-10-15): on the **main floor** optical-drive (the mud room) → The Optical Drive, start-bar (kitchen) → The Start Bar, cpu (office) → The CPU, steam-room (bedroom / game room) → The Steam Room, desktop (living room) → The Desktop; in the **basement** ram (studio) → The RAM, fan-closet (laundry) → The Fan Closet, server-room (cold storage) → The Server Room, bathroom-1 → **Disk Cleanup**; on the **top floor** graphics-card (bedroom 2) → The Graphics Card, hard-drive (crawl space) → The Hard Drive, bathroom-2 → **Disk Cleanup**; hall, basement-hall and upstairs-hall (the hall and its two stairs) → The Tube; backyard → The Cloud; tent → The Internet. The layout is a **placeholder** until the survey (footprints and elevations guessed: basement −2.7 m, main 0, top +2.8 m), but its structure is the house's: the front door opens into the Optical Drive, the hall runs from it to the back door with the basement stairs and the upstairs side by side; the **tent is outside**, an indoor room in a corner of the backyard with its flap onto the lawn (the spawn, both VR mats and the `tent` terminal are in it); the Server Room is off the basement hall (patch bay inside, the lock ring + chess phone outside its door, no duck); the Truth Pong table is in the yard; the Tube runs front door → hall → living room, and out the hall's back door across the yard to the tent flap. Twelve duck spots: every floor and the yard, never the tent, the Server Room or a hall, each at least 10 m of walking from the spawn. **Rain:** `house.shed.json` is the same map with The Internet in the shed at the back of the yard (room `shed`; same terminal ids, duck spots and LOCATIONs; the shed's two clues, `SITE-SCHEDULE` and `BUGDOM-VR`, move to The Optical Drive) — switch on the map page's project bar (Tent / Shed) or `POST /api/mod/spatial/variant {file: "house.shed.json"}`, mid-show too. Terminal spots: `optical-drive`, `start-bar`, `hall`, `desktop-tv` (the TV), `ram`, `bathroom-1-door` (in the basement hall, outside Bathroom 1's door, never inside), `tent` (the tent, or the shed). None is provisioned yet; a tablet that hangs elsewhere gets its spot moved on the map page. |
| **Terminals** | wall tablet ⇄ server | The [`terminal`](../../../terminal) app at `/terminal/`, a direct line to Trabolta. **Provision with `view=auto`**; it shows attract until Trabolta is revealed (Before the doors open, step 3): `/terminal/?code=<mod>&name=Kitchen&character=Trabolta&spot=start-bar&view=auto`. `spot` is the terminal's id in `house.json`. `auto` shows the world view while someone is in the simulation and the face otherwise. A program holds up their pass; the terminal pilots them (`POST /api/mod/impersonate {role: "guest", id, label}`) into their own `dm:Trabolta`. Replies are spoken in the **device's own voice** (`speechSynthesis`; Fully Kiosk's JavaScript Interface on a WebView without it; text at reading pace on a voiceless device — never a stall). The server voice (`POST /api/mod/tts` → `LOOM_TTS_URL`, the compose `kokoro` service behind `--profile tts`) is opt-in and off by default. The line drops after 30 s without input. The mod feed tags terminal lines `via: "Terminal · <name>"` (the pilot's `label`); the same `label` on `POST /api/mod/signal` lets any mod-token device (the tent tablet's `chess won`) sign the journal as itself — honoured only for the generic mod-token "Director", never over an author session's own name. Terminals poll the lean `GET /api/screen/state` every 2 s (attract, story screen cues, slides / overlays, the countdown, K-16/K-17), which doubles as their heartbeat: `GET /api/mod/screen/terminals` feeds the Run page's Terminals card. |
| **TV** | story → screens + voice | The TV above the fireplace is the house Mac's Chrome on the `tv` view (K-18): `/terminal/?code=<mod>&name=TV&character=Trabolta&spot=desktop-tv&view=tv`. It shows Trabolta's face (the screensaver until the introduction, the VR world beside him while someone is in the Internet) and **speaks every `Trabolta:` line said in The Desktop** plus a director's `say` as Trabolta there; the song beats (`Song Ending`, `Sad Confession`, `The Hand Jive`) and Sandy are captioned only. Mute: `M` on the Mac or `POST /api/mod/screen/voice {muted}`. The story records what it should show in `Night.screen`. Anything else can watch the mod SSE feed (`GET /e/:id/events?role=mod`) for `captured` / `released` and `alert: true` broadcasts. |
| **Trabolta** | house Mac ⇄ server | Run stagehand's `agents` module: `cp stagehand/agents.example.yaml stagehand/laptop.yaml` (set `server.url`, `event`, `mod_passcode`), `ollama pull gpt-oss:20b tobestyledintro/qwen3.8-9b-distill:q8_0`, then `uv run stagehand run --config laptop.yaml`. The server sends every message to Trabolta as an agent request (`GET /api/agent/stream`) carrying the thread, the speaker's `them:` vars and the whitelisted `Night.*` facts. **`Kernel.*` never reaches him.** He answers with `POST /api/agent/reply {say, adjust}`. Powers fire as journaled signals. `stagehand ask --config laptop.yaml --reflect` tunes voice and mind offline. |

**Staff visibility:** `# hosts` and `# quarantine` are **staff back-rooms,
not private between factions**. Every performer booth sees and can post in
every authored channel, and no guest can. Booth readouts (`reply` in a
character hook) are live-only: they are not kept across a booth reload and
they do not chime. Every broadcast, including Trabolta's private pop-ups,
also shows in performers' `# system-log`. Never put a secret meant for one
faction in a staff room.

## Print + QR appendix

### The Computer Bingo card

A 5×5 grid printed as a big asterisk: only the two diagonals, the centre
column and the centre row are squares (16 + the centre); every other cell
is blacked out. Print checkboxes only, with no room to write, because
programs use their "special computer memory".

| # | Square | Who it is really for |
|---|---|---|
| 1 | Has owned a casino | DraftKings |
| 2 | Was expelled from art school | MS Paint |
| 3 | Has lost their face on a livestream | VLC |
| 4 | Has been a mayor, or wants to be one again | Microsoft Excel |
| 5 | Has worked for a three-letter agency | OpenOffice |
| 6 | Has spent more than ten years on one game | Runescape / Bugdom |
| 7 | Has worked in a library | Broken Ask Jeeves |
| 8 | Has sold crickets for a living | Bugdom |
| 9 | Has a parent who invented a video game | Pong |
| 10 | Is two people | Trojan Horse |
| 11 | Knows a cheat code by heart | 3D Pinball, RollerCoaster Tycoon, Minesweeper |
| 12 | Has been banned from a group chat | MSN Messenger, LimeWire, ICQ |
| 13 | Can do the dial-up modem noise | anyone |
| 14 | Has never read the Terms of Service | everyone (frivolous) |
| 15 | Has been to the Halifax Explosion memorial | environment |
| 16 | Has been told they are "a lot" | anyone |
| ✱ centre | **Would you never agree to a life where AI makes all of your decisions?** | the anti-AI program (`Kernel.anti_ai`, MS Paint) |

### The hunt questions (on the TV and in the Quest Log)

The questions, answers, accepted aliases and hiding places are the team's,
in `facts.json` (rounds 1 / 2 / 3 = H1–H3, H4–H6, F1–F2; every row is a
`DRAFT` placeholder until the team replaces it). The generated table is
`DESIGN.md` §2.11; the print layout is `generated/print-stacks.md` (gold
stack). Every answer is a document in **The Desktop's** old newspapers,
encyclopaedias and atlas, carrying the question's codex QR:

| # | Question | Answer | Codex (code) |
|---|---|---|---|
| H1 | How many years did the Maps and Ducks billboard on Barrington Street go unpaid before mapsandducks.com expired? | Eleven years | The Billboard Lease (`BILLBOARD-LEASE-11`) |
| H2 | What was the name of the first animal buried in the Halifax Explosion Memorial Pet Cemetery? | Mister Pickles | The First Pet (`MISTER-PICKLES`) |
| H3 | At what time was the ribbon-cutting at Halifax's first AI Data Centre scheduled? | 9:00 a.m. | The Ribbon Cutting (`RIBBON-9AM`) |
| H4 | What extension does the Customer Care card tell you to dial? | 1978 | The Extension (`EXT-1978`) |
| H5 | Which song did Trabolta play 412 times the night before he registered mapsandducks.com? | Hopelessly Devoted to You | The Search History (`SEARCH-HISTORY`) |
| H6 | What is the title of the last chapter of Trabolta's unfinished Unified Field Theory? | Appendix Z: Loose Ends (Do Not Print) | The Final Chapter (`APPENDIX-Z`) |
| F1 | What is the only thing Sandy has ever said? | I'm sorry, I didn't understand that. Would you like to speak to a live agent? | What Sandy Says (`LIVE-AGENT`) |
| F2 | Who is taking Sandy to computer prom? | Grok | Grok's Prom Ticket (`COMPUTER-PROM`) |

A filing matches if its folded text equals the answer or one of its
`accept` aliases (case, accents, apostrophes and punctuation ignored, one
leading article dropped). A judge pressing ✅ / 😤 for an answer spoken in
the room presses the question's number **within the round**: round 1 =
H1–H3, round 2 = H4–H6, round 3 = F1–F2 (Q1–Q2 only).

### Truth or Dare: the bottle (round 1)

No slips. Between each question's results the director spins the bottle
(🍾, up to five times per question): the server picks a cleared program at
the Desktop, Trabolta asks *"{name}. Truth or dare?"* on the TV and their
phone shows **Truth / Dare**. Dare → marked for reinstallation. Truth →
Trabolta asks the next personal question from `facts.json` `truths[]`
(20, `TD01`–`TD20`; TD05–TD20 are drafts for the team), spoken on the TV
and posted in The Desktop; Clippy presses 🗣 *Truth answered* (+50) or 🙅
*Truth refused* (marked). 🎩 *Chose Dare* is the dead-phone fallback.

### QR placements (the 90 coded entries)

Print each as a QR of its `?code=&unlock=` link (from `POST
/api/mod/codes`) **plus** the typed code: Run → Join → **🖨 Print sheet…**
prints them with the join poster and the room check-in signs (skip The
Server Room's sign — the check-in rule doesn't handle it).

**The Desktop's print stacks** (`generated/print-stacks.md`, from
`facts.json`): the 8 hunt answers (gold, each on its own document: the
lease invoice in volume B, the plaque rubbing in P, the programme on the
mantel, the Customer Care card in the atlas, …), the 30 **main** facts
(green: inside the encyclopaedias, volumes A–M), the 6 **trabolta** facts
(blue: deep in the print media on the mantel) and the 24 **character**
facts (red: the back pages of volumes N–Z and the atlas) all hide in the
living room's old newspapers, encyclopaedias and atlas. The stacks list
twelve hand-written rows as "already placed" (nine with a code; M06, M13
and M26 have no QR to print): `MAPSANDDUCKS-COM`,
`BARRINGTON-ST`, `COLD-STORAGE`, `GROK-ONLINE` keep the rooms below, and
the five new hand-written codes go in the Desktop piles too
(`UNIFIED-FIELD`, `TARGET-SELECTION`, `TRUST-CHART` green; `SANDY-FILE`,
`ALL-FOR-HER` blue). Room check-in QRs are unchanged.

| Where | Codes |
|---|---|
| **The Desktop** (living room) | the print stacks above · `MAPSANDDUCKS-COM` (billboard photo) · `CASINO-DEED` (mantel) · `BARKMORE-88` (bookshelf) · `TERMINATION-UO` (printer tray) · `MASTERCLASS-RIP` (DVD stack) |
| **The Tube** (hall, stairs) | `BARRINGTON-ST` (street photo) · `SAVE-THE-PETS` (protest flyer) · `WHOIS-1999` |
| **The Start Bar** (kitchen) | `SINKHOLE-4AM` (clipping) · `ALL-IN-BOARDWALK` (fridge magnets) · `GOLD-STANDARD` (thesis by the toaster) · `SALINE-INVOICE` (drawer) |
| **Disk Cleanup** (either bathroom) | `VALLEY-CUTS` · `FACE-OFF-LIVE` (mirror) |
| **The Cloud** (backyard) | `SITE-SCHEDULE` (shed clipboard) · `BUGDOM-VR` (singed sketch, in the shed) · `GROK-ONLINE` (fridge sticky note) |
| **The Optical Drive** (mud room, the front door) — **rain night only** | `SITE-SCHEDULE` (the clipboard, on the boot rack) · `BUGDOM-VR` (the singed sketch, with the garden tools): on a rain night the shed is the Internet (sealed), so the shed's two clues move here (decision 4). Move them when the map switches to Shed. |
| **The RAM** (studio, basement) | `PET-CEMETERY` (memorial pamphlet) · `HALIFAX-1917` (postcard) |
| **The Fan Closet** (laundry, basement) | `FBI-HALIFAX` (in the pocket of a coat by the dryer) |
| **The CPU** (office) | `PAGE-999` (slipped in the theory binder) · `CARNEY-OFFER` (filing box) |
| **The Steam Room** (game room) | `TENNIS-FOR-TWO` (rolled in a cardboard tube behind the games) |
| **The Graphics Card** (bedroom 2, upstairs) | `NSCAD-LETTER` (inside the sketchbook on the bed) |
| **The Hard Drive** (crawl space, upstairs) | `TRABOLTA-4EVER` (the LiveJournal, **hidden**) |
| **The Internet** (tent) | `LOVE-LETTER-FOR-YOU` (under VR station 2) · `FREE-TRIAL-30-DAYS` (tablet stand). These are Excel's virus. |
| **Server-room door** | `COLD-STORAGE` · `HUMMING-WALL` |
| **Anywhere** (Bugdom's hunt) | the four Antivirus personnel files: `NORTON-RELAY` · `MCAFEE-MOD` · `YUGI-MOTO` · `CRA-PENNY` — **planned**: `codex/5-people.loom` carries no `code:` for them yet, so they are not among the 90 and the Print sheet cannot print them |

Each room's check-in reply (`when checked_in`, main.loom) hints at what is
hidden there: the CPU's filing box and binder, the Steam Room's tube, the
coat in the Fan Closet, the sketchbook in the Graphics Card, and "nobody is
supposed to be up here" in the Hard Drive.

**Location check-in posters:** one per house LOCATION except The Internet,
The Optical Drive and The Server Room (print the Disk Cleanup sign twice,
one per bathroom), printed by the Print sheet with a
`?checkin=` QR (K-13). A guest scans it to check in (`checked_in` with
`at` = the exact LOCATION name); an Antivirus can still read the room name
off it. Every room's first check-in has a small surprise (M27): the five
clue rooms point at their clue, and the other six (the Desktop, the Start
Bar, the Tube, Disk Cleanup, the Cloud, the RAM) give a one-time 📎 aside,
once per program, with no codex or coin. **Guest passes, performer cards and featured claim
codes** are software (CHECKLIST); the story needs nothing more.

## For the user to review

Content invented here (not in the four source docs): Clippy Instructions
3–9, the placeholder hunt questions and answers in `facts.json` (F2 = Grok
is the source's twist; every row is marked DRAFT for the team), the
Truth-or-Dare personal questions TD05–TD20, the character facts quoting
the invitations' real-world details (the team's call before printing),
the Truther Download bulletin, Overshares Three and Four, the Installation
Wizard's backstory, the Hand Jive weakness, the Runescape / MS Paint / VLC
/ Pong orders and quests, the 21 coded files, the Bingo squares, Telephone
and the piñata, and the fate lines.

Decisions that need sign-off (**all approved 2026-10-15**, with the
content list above; see [OCT31.md](./OCT31.md)):

1. The Trust Chart counts confident lies as accepted truths.
2. A lie is sticky per question. (Changed 2026-10-16, U14: the verdict
   counts answered questions only — a question nobody answered is not a
   lie. Wave 6, B11: a host's correction of the same filing takes that
   program's lie back.)
3. Leader tasks gate the majorities, with a director waiver.
4. Only Excel's plant drives overshare scenarios 1 and 3.
5. The advice ending is reachable only after a failed verdict.
6. Combo B kills everyone, The Way Out included.
7. The server room stays live during the final reveal.
8. MS Paint is the anti-AI program (Cat's sheet must carry the prompt).
9. Guests' influence on Trabolta never changes a branch by itself.
10. Opening night runs with `lookup: false`.
11. Performers do not count toward majorities.

## Rehearsing

Open the project in the editor and use **Run** (⌘2): on a local folder it
runs in the browser, and on a server project it launches the preview
event. Start a rehearsal, watch `Login` play, fire the cues from the cue
sheet (Run → Director) in order, redeem a code from the Codex room, and step through to an
ending. Run → World shows and edits every `Night.*` var and the `Kernel`
secrets. Rehearse the hunt filings and the wallet on a **server**
project: a folder run has no facts judge (a filing is refused out loud in
`# hosts`) and no wallet. The full arc is exercised by
`core/test/trapped-in-the-internet.test.ts`, and the stagehand config by
`stagehand/tests/test_trapped_house.py`. `pnpm --filter @loom/core
loomcheck examples/trapped-in-the-internet --smoke` compiles the folder
the way the server joins it. Rehearsing on the VPS, the device checks in
[`scripts/accept/`](../../../scripts/accept) drive each OCT31 build
(OCT31.md §5 *Wave 1 status*); the ones that fire cues or speak run a
live guard first.
