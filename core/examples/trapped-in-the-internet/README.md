# Trapped in the Internet

*Equal parts Digimon Movie, Blade Runner, and an escape room, influenced
by late-90s Web 1.0 aesthetics and existentialism.*

> **The show is Sat Oct 31, 2026.** Start at [`INDEX.md`](./INDEX.md) (a map
> of this folder). The night's runbook is [`SHOWNIGHT.md`](./SHOWNIGHT.md),
> the machines and how they connect are in [`TECH.md`](./TECH.md), and the
> generated [`SHOW.html`](./SHOW.html) has the acts, every cue and the
> terminal spots on one page. This README is the show's reference: how the
> story works and what every piece of hardware talks to.
>
> **State (2026-10-24):** the VPS runs `w18b-1021` (wave 18b Stage A, the
> tent laptop, and wave 19). Master also holds wave 18b Stage B and waves
> 20, 20b, 21 and 22, merged and not shipped. The user signed off the show
> text of waves 13–28 on 2026-10-27 (`SIGNOFF-w13.md` … `SIGNOFF-w28.md`,
> `history/SIGNOFF-w18b.md`, `history/SIGNOFF-w20.md`); wave 29's lines
> (`SIGNOFF-w29.md`) and wave 22's patch-bay lines are still DRAFT. The build history is in [`OCT31.md`](./OCT31.md)
> §5 and [`history/`](./history).

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
rooms.loom             the chat sidebar: # general, # task-manager, # clipboard,
                       # truthcoin-exchange, # hosts, # quarantine, # unlimited-power,
                       # the-way-out, # hidden-partition, # back-channel
atmosphere.loom        three ambient generators (the screensaver hum, dial-up, the system tray)
quests.loom            24 QUESTs (the Quest Log: 17 for the programs, 7 staff quests
                       `for <Character>` in the hosts' and Antivirus' booths; with the
                       3 generated hunt QUESTs, 27 in all)
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
                       Code · Trabolta Introduction · The Screensaver · The Router (wave
                       18b removed Telephone and Are You Sure)
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
beats/server-room.loom Act III: Majority Reached · The Whole Truth · The Heart · Server
                       Room Alarm · Chess Lost · Chess Drawn · Patch Rejected · Trabolta
                       Disabled · Trabolta Recounts · Computer Destroyed · Purgatory
                       (wave 18b deleted Back To The Heart); wave 20's heart: Heart Nag ·
                       Heart Door Again · Heart Door Shut · Heart Sealed · Heart Shut It ·
                       Heart Talk · Heart Layers · Heart Layer One–Four · Heart Evidence ·
                       Heart Reasons (wave 27: Layer Three's sub-menus) · Heart Speak ·
                       Heart Pick · Heart Warn · Heart Eject · Heart Mark · Heart Barred ·
                       Heart Leave · Heart Away · Heart Convinced · Heart Return · Heart
                       Shutdown (wave 20b deleted Heart Not Yet and Heart Call)
beats/finale.loom      Final Reveal · Bobbing For Truth · The Bag Of Truth · Final Assessment
                       · Truth Txt · The Verdict · Song Ending · Grok Prom · Pickup Line ·
                       Sad Confession · Relationship Advice · Advice Helped · Advice
                       Thwarted · The Hand Jive
beats/review.loom      the ending monologue (wave 18b): The Night In Review (public,
                       before every ceremony) · Who You Were · The Report On Everyone ·
                       Everyone Else · The Rest Of The Report · Goals Met Tonight · The
                       Goals Report · What You Did · What We Did · Your File (private,
                       from The Uploader, per program)
beats/ceremony.loom    the awards ceremony (K-25): The Ceremony (the host opens, per
                       ending) · Present Award (the award slide + the host's line)
cast/kit.loom          TRAITs: Prop(beat) · Person · Host · Enforcer (the door scan, the
                       shared Clearance beat, the confrontation, the Wanted board's
                       claims and the door queue, Send to the Internet, Mark as
                       reinstalled)
cast/hosts.loom        Clippy · Task Manager · Adobe Acrobat · Recycling Bin
cast/antivirus.loom    Norton Anti-Virus · McAfee Anti-Virus · Password Manager · CRA Agent
                       Software (they share the door; wave 18 deleted Windows Defender)
cast/staff.loom        Installation Wizard · Sandy · Truther Download (voices, not playable)
cast/featured.loom     the 9 featured programs: bare names + avatars (they are GUESTS)
cast/pool.loom         22 more guest programs: bare names + avatars
cast/props.loom        The Uploader · The Router · The Screensaver · The Tablet · Kernel (the
                       hidden secret state)
cast/trabolta.loom     the AI: his vars, hooks, and 11 agent powers (wave 20 deleted stand_down: the
                       heart's talk replaced it; the_line_works retired 2026-10-19)
codex/1-world.loom …   200 CODEX entries: 192 in nine numbered files + the 8 hunt answers
                       in generated/questions.loom (9-facts.loom is GENERATED from
                       facts.json; 3-hunt.loom is gone; 85-ties.loom holds the 16
                       Connections ties and Program Briefing, which deals them at
                       clearance). The order matters:
codex/8-jeeves.loom    stagehand feeds Trabolta's orchestrator up to 60 entries as "ground
                       truth", the ones he holds first and then the files in order, so the
                       environment comes first and the scrambled Jeeves fragments last
trabolta.persona.md    the voice: the fast model's system prompt + frontmatter knobs
trabolta.mind.md       the mind: 8 stages, 5 drives and a cue per phase for the orchestrator
house.json             the house map for the reinstallation games + the terminals' world
                       view. It is a placeholder layout until the house is measured; edit it
                       at /reinstall/map (docs/loom-reinstall.md §1)
audio.json             the house speakers and the router's matrix (wave 17 / 18b)
lights.json            wave 20: the house lights the stagehand `lights` module drives
                       (only the server room's RGB bulb + the heart's 13 looks so far;
                       every other light is still trapped.house.yaml's). A project file
                       like the maps; edit it in /reinstall/map → 💡 Lights
desk.json              wave 25: the house desk's cue list (DRAFT: tech checks only). A
                       project file like lights.json; edit it in Run → House
                       (docs/loom-house-desk.md)
INDEX.md               a map of this folder: what each file is, which are generated / test-pinned
SHOWNIGHT.md           the night-of runbook + the pre-show checklist (scripts/ops/checklist.sh)
TECH.md                every machine and device, and how they connect
SHOW.html              GENERATED overview page (core/scripts/show-page.ts + show-page/template.html)
history/               old contracts + sign-off sheets (CONTRACT-w20, SIGNOFF-w18b, SIGNOFF-w20)
CHECKLIST.md           the 2026-10-14 audit checklist (build history)
cast-packs/            paper only (D-01): 8 performer packs + the Installation Wizard's
                       tent card, 4 crew cards, 9 featured
                       sheets, the emergency card (not read by the server)
```

Outside this folder: **`stagehand/trapped.house.yaml`** is the show's real
show-control config (lights per room, scenes, sound, the house announcement speaker,
sensors; since wave 20 the server-room door, and since wave 22 the patch bay, are the
M4's, read by the server-room terminal, and the server room's RGB bulb is `lights.json`'s;
the Desktop and MacBook files `trapped.desktop.yaml` / `trapped.macbook.yaml` extend it), and
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

As of 2026-10-22 (the wave 18b integration) the project compiles clean, both
per file and concatenated the way the server joins them (`loomcheck`):
**34 files, 0 errors, 0 warnings; 112 beats, 200 codex entries (94 with codes), 27
quests, 117 rules, 123 INTERACTIONs**. Wave 18b added `beats/review.loom`
(The Night In Review, Your File and their shared beats) and
`codex/85-ties.loom` (the 16 Connections ties + Program Briefing), The DSL
Line, the quest *A Faction Of Your Own*, 🗳 `force_their_majority` and the
race / `settle_majority` rules, and deleted Telephone, Are You Sure, Back To
The Heart and 🧾 `waive_leader_tasks`. Wave 11 added the four digit notes, the
quest *The Cold Door*, the King's shared health, the crew's door window and
the performer copies of the room's fallbacks. Wave 8 split ⚖ `the_verdict` off 📄
`read_truth_txt` and added the `patch_after_verdict` and `dance_screens`
rules. Wave 7 added The Heart and Back To
The Heart, turned *The Cold Lock* into the secret riddle *The Cold Door*,
generated the secret *The Door Code* from `facts.json`, added `stand_down`
(deleted again in wave 20, D13: the heart's four-layer talk replaced it)
and `talked_down`, dropped `server_unlock` and renamed `rearm_server_room`
to `reset_server_room`.

## Before the doors open

1. **Sync the story.** Locally: `pnpm dev --sync "<project>"` (or
   `core/scripts/sync-example.ts`). To the VPS:
   `LOOM_SSH=<user>@app.mapsandducks.com scripts/sync-show.sh` (an SSH
   tunnel to its Postgres, then a reload — a real cut, so never after
   doors; `--dry-run` / `--no-reload`). Since wave 9 (D6) it **refuses to
   reload a live event with a real guest on its roster** (or one whose
   roster can't be read): it writes the project's files, leaves the
   event's snapshot alone and exits 3 (*"…LIVE with real guests (or its
   roster can't be read) — files written, event snapshot untouched, NOT
   reloaded (exit 3)"*); `--i-know-this-is-live` (or
   `LOOM_I_KNOW_THIS_IS_LIVE=1` for `pnpm dev --sync`) overrides it. A
   preview is never guarded. When the event is reloaded, or resynced with
   `--no-reload`, a file the sync rewrote replaces an open editor's copy (an
   unsaved edit to that file is dropped; other files keep theirs). When the
   live guard trips (exit 3) there is no reload and no resync: the project's
   files are rewritten, but an open editor tab keeps the pre-sync text until
   it is reopened, so close and reopen it before typing (a keystroke there
   is lost). Removed files are deleted from the
   project automatically. The house maps are the exception: the project's
   copy wins, so a map surveyed at `/reinstall/map` and kept with **Save
   to project** survives every sync (the script prints both versions when
   they differ). To make the repo's copy the show's again, **Download
   JSON**, commit it as `house.json`, then sync with `--replace-maps`. Then press **Reset on Run → Mind**, or start the
   worker with a fresh `state_dir`. Otherwise `.stagehand-minds` keeps the
   old "lonely grandeur" arc, and a story restart sends `control reset`
   only to a worker that is connected.

   **The `trabolta/answers` change (2026-10-19: he never holds a hunt
   answer, the house judges the pickup line, no film in his own files)
   needs `sync-show` WITH its reload (never `--no-reload`): the event must
   play the new text, in which `the_line_works` is gone, the hunt answers,
   The Rival, The Cooling Log and Jeeves fragment 17 are secret, and his
   film-named file is *Oil And Lightning*. Then reset Trabolta's
   worker mind (**Run → Mind → Reset**, the worker connected), because a
   mind kept from rehearsals may still name the last hunt answer, quote a
   pickup line or hold the old file's title in its notes, dossiers or
   `learned`. The
   worker reads its persona, mind file and `secrets.never` (now with the
   pickup line) only at start: once the MacBook's checkout has this
   change, restart it there (`uv run stagehand launchd restart --job
   agents`), then Reset.**

   **Wave 12 (the story mind) needs the same `sync-show` WITH its reload**
   (the persona, the mind file's phase cards, `cast/trabolta.loom`'s snoop
   refusal and `main.loom`'s per-round fact-card lines all changed). Then,
   on John's MacBook: `mind_mode: new` under `agents:` in
   `stagehand/laptop.yaml` (absent = classic), `uv run stagehand launchd
   restart --job agents`, **Run → Mind → Reset**, and `ollama stop
   tobestyledintro/qwen3.8-9b-distill:q8_0`. The checks, the switches and
   the way back are on [`cast-packs/crew/trabolta-mind.md`](./cast-packs/crew/trabolta-mind.md).
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
   `/terminal/?code=<mod>&spot=start-bar` (a spot alone is enough: the
   terminal follows the map's view for that spot; the old long form with
   `name=` / `character=` / `view=` overrides the map and stops following it).
   Until Trabolta is revealed (or while he's asleep) it shows **attract**
   — a Mystify screensaver and fake-1999 ads, never "ONLINE", and it never
   pilots a pass into `dm:Trabolta` (K-16); his face comes up within 2 s
   of `introduce_trabolta`. `view=mirror` (no scanner, no pilot) is the
   fallback for a tablet attract fails on. The TV is John's Windows
   Desktop's Chrome on spot `desktop-tv` (`view=tv`;
   `scripts/house-desktop/tv-kiosk.ps1`); click once into it after
   every boot. Every terminal and the TV must show green on the **Run
   page's Terminals card** (K-29: red + a chime after 20 s silent). The TV
   voice mute survives restarts, redeploys and Go live in place, so a mute
   left from rehearsal carries into the show: check it on the Terminals card
   before doors (the server log says 🔇 at startup when the TV starts muted).
4. **Hardware.** The old single "house Mac" is split in two (the whole map
   is [`TECH.md`](./TECH.md)). **John's Windows Desktop** hosts Mosquitto
   (anonymous on `127.0.0.1:1883`, password-only `props` on the LAN at
   `:1884`), Zigbee2MQTT on the CC2652P stick, and the stagehand `show` and
   `lights` jobs as Task Scheduler tasks from `stagehand/trapped.desktop.yaml`
   (which `extends:` `trapped.house.yaml`; runbook
   [`scripts/house-desktop/README.md`](../../../scripts/house-desktop/README.md)).
   **John's MacBook** runs the house router by default (`launchd install
   --job audio --config trapped.macbook.yaml`, after `stagehand sounds
   placeholders` and `stagehand check --only audio` reads 32 / 30;
   [`scripts/house-macbook/audio.md`](../../../scripts/house-macbook/audio.md)),
   dialling the Desktop's broker on `:1884`. Announcements reach the router
   only through the Desktop's `show` job, so both machines must be up. The
   YAML reads no door since wave 20 (D16) and judges no patch bay since
   wave 22: both are the Grand Central M4's
   ([`hardware/server-room-m4/`](../../../hardware/server-room-m4)), bridged
   by the server-room terminal on Steph's laptop, and the story judges the
   bay's `patch_changed {combo}` against the `Kernel.combo_*` seeds in
   `main.loom`. The four combo-half codex texts must match those seeds;
   the stagehand test checks this.
5. **Trabolta (John's MacBook).** Start the `agents` worker (see the integration
   contract). His gate is `when: self.awake == true`, so until Clippy
   introduces him every message gets the hold line *"Jean Trabolta will make
   an appearance later tonight. Please do not move the mouse."*
6. **Print** from Run → Join → **🖨 Print sheet…** (K-12: the join poster,
   every codex QR and the room check-in signs, QRs drawn in the browser,
   1, 2 or 4 per page), plus the Bingo cards (appendix). Sort the
   Desktop's codex posters into the four print stacks of
   `generated/print-stacks.md` (gold: the hunt answers · green · blue ·
   red: the character facts) and hide each pile where its row says.
   Wave 11: hide the four **silver** digit notes in their rooms (never the
   server room or a bathroom), tape the new keypad sign by the door
   (wave 11b moved the code: program the keypad to `facts.json`
   `door.code`; the notes and the sign print the same as before), and
   send the featured programs' **Invitations** (their claim QRs, *Casting*).
   **Not printing?** Open `/cards` on the server (e.g. `https://<app>/cards`)
   with the moderator passcode: every room and fact QR, scannable straight
   off the laptop or the TV (click a card for full screen, ← / → to step).
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
10. **The King** (wave 11: the code, at the door). He stands at the
    server-room door twice. **In the simulation** (both reinstallation
    games, the tent laptop and the headset; `house.json` prop
    `cold-lock-king`) he guards the virtual door with **one health bar
    shared by every program all night: 15 points, never regenerating**
    (`Night.king_hp` / `Night.king_hp_max`, seeded at Power On). Each
    program may hit him **once per reinstallation visit**, and a visit
    ends at the duck, not at Leave, a director's end or a pose timeout: a
    re-scan before the duck is the same visit, so ⚔ shows as spent from the
    start (*"You hit him this reinstallation. Find Gerald before you hit
    him again."*). The server knocks the point off and fires `king hit` (`# hosts`: *"⚔ X hit the
    King in the simulation: 14/15"*, plus a house-wide line at 10 and at
    5). At 0 he kneels for everyone (`king fallen`: a house-wide alert and
    a `# hosts` line) and the virtual door opens in both games. **👑
    Restore the King's health** (`restore_the_king`, Anytime) puts him
    back to full. **In the real house** he plays chess on **the terminal
    outside the server-room door** (a wall terminal by the keypad; scan
    your pass, play, no hints): his health sets how well he plays (full =
    a grandmaster … 0 = pawns only), and the terminal shows his bar. A
    checkmate posts `chess won` for that program (`POST /api/mod/signal`
    with the terminal's mod token and `label: "Terminal · <name>"`), and
    the winner gets *The Door Code* in their Codex, once, **any time before
    📄 truth.txt** (no practice games any more). From 📄 (or an ending) a
    win gives no code and `Night.king_armed` reads 0. A loss or a draw
    posts a `# hosts` readout every time; once Trabolta is awake he gloats
    on the TV at most once every five minutes. A marked program can't
    challenge him. When the terminal could not report a win, a host or an
    Antivirus who **saw** "checkmate" presses ♟ *They beat the machine* on
    the winner's card (OP-12), or the director fires ♟ naming the winner.
    The real door is never driven by anything: it has a standalone keypad
    lock. Director's side: the editor's Help → *Running the server room*.
11. **The server-room door + terminal.** Program the standalone keypad lock
    by hand to `facts.json` `door.code` (the docs never write it down; the
    lock is never networked) and tape the keypad sign from
    `generated/print-stacks.md` beside it. From inside, the handle must open
    with no code (check with the batteries out). Fit the **door sensor**
    (wave 20: an LED on the frame shining into an LDR in a shroud tube,
    wired to the Grand Central M4 on Steph's laptop,
    [`hardware/server-room-m4/`](../../../hardware/server-room-m4); the
    ESP32's copper tape is no longer read, D16; since wave 20b, Q7, there is no ESP32 in the room at all). The server-room terminal
    is that laptop's Chrome on a monitor + mouse + an external keyboard
    (the heart to heart), the webcam reading passes: provision it
    `/terminal/?code=<mod>&spot=server-room&door=serial&camera=user` (the
    map spot names the room and the view; [`docs/trapped/kiosk.md`](../../../docs/trapped/kiosk.md)
    has the kiosk profile, the one-time port grant, ⚙ → *Connect door
    sensor* and the two calibrations). It stays asleep (attract) until The
    Server Room opens for everyone. Check a real open → shut on Run →
    Terminals (🚪 *open* / *shut*, no fault, no override) and on the bulb,
    then 🔄 so The Heart is sealed again.
    Hang the **Server Door terminal** by the keypad outside and provision it
    `/terminal/?code=<mod>&name=Server Door&spot=server-room-door&view=chess`:
    awake all night on THE KING and his bar (check it reads 15 / 15; 👑 if a
    rehearsal left him lower). It retires the chess phone.
12. **Rehearse the hunt and the wallet on a server project.** A
    local-folder rehearsal has no facts judge (every filing arrives
    without a verdict and is refused out loud in `# hosts`) and no wallet
    (⭐ score, no Wallet room).

## Running the night

**Fire every admin cue from the cue sheet (Run → Director, K-21, a host's
NEXT bar, or the director phone) or
quick-fire, never from a performer's guest card.** Since wave 18 (Q1) any
host may call the show: whoever calls claims it (**Calling** on Run, **📣
I'll call** in Play), every console shows **📣 who**, and a FIRE by anyone
else asks once (*Fire anyway?*). Since wave 21 Clippy is a player and calls
nothing (Q2 reversed): no admin cue carries `by:`, and each game a host fires
pops *YOUR GAME IS ON* on Clippy's phone. A press from a guest
card carries `actor` = that character and `subject` = that guest, so only
that character's hooks hear it. The admin INTERACTIONs are declared in
running order, so the sheet lists them in that order, marks the **LAST**
cue and suggests the **NEXT**, and every director's sheet agrees (it is
read off the server's log). Each label carries the source prompt code:
**C1/C2** are the app prompts, **V1–V6** are the monitor slides, and
**Clippy N/X** is Clippy's instruction sheet. Every Clippy instruction
also lands in Clippy's booth as a codex entry (`Clippy Instructions 1` …
`9`, in the Codex tile on Clippy's Mission). Steps marked *auto* fire on their own from
a story timer, and the button is the manual fallback.

**The Director page is grouped by act** (wave 10): the `act:` lines in
`main.loom` split the sheet into this README's sections, **B** to **G**
below, plus **Anytime** (💡, the reinstallation cues and wave 32's ⚡), and no
cue moved, so every number is kept. The act holding NEXT (else LAST) is
open; the acts before it fold to `✓ 8/8`; its fallbacks are **On hand**,
with the previous act's under a `from E ▸` line (open by default, so after
🌑 or Combo A the Y2K hour's 🪩 and 🔌 are one click away) and the ⚡
Anytime line always there. The **NOW card** shows NEXT with its full
description and *then:* the cue after it (📋 reads *Again? …* while a
question is left); when NEXT is empty it says *nothing to press. The
story runs.* and shows the countdowns from the header's `countdown:`
lines (Bingo ends, Hunt 1 ends, Filings close, Truther Download,
Five-minute warning, Summons closes, Midnight, Dance lights), so a
silent sheet during a timer reads as meant. (Wave 11: the five a guest is
told about out loud, Bingo, Hunt 1, Filings close, the summons and
Midnight, end `, for guests` and tick on every phone too, under the room
header; the Truther Download, the warning and the dance lights stay
yours.) **Arm, then fire, on the
laptop too**: the first click (or Space) arms a cue, a second one at
least 0.3 s and under 4 s later fires it, so a fast double-click only
arms; an arm is dropped if the cues move first (*Cues moved: … Re-arm.*).
A refused press shows **✕ Not taken** with the `# hosts` line that says
why. The glance column beside it (Needs you, Watch, People, Cast and the
`# hosts` feed) reads the header's `watch:` lines: the Kernel's door code,
combos, majority and lies are masked (press and hold 👁 to read one for
5 s). A second director sets the page to **Watching** (keys off, the
glance first). The headings below name each act; ⏳ and 🚨 sit in C (the
hour's own timers), 🕚 opens E, and 🏍 / 🪦 (after the dance) close F.

**NEXT** is the first cue after LAST that has not fired and is on tonight's
branch. Since wave 9 every step from V6 to 🕚 has a `while:` for its own
window too (V6 once hunt 1 is over, ⏱ while the filing window is open, 📋
while a round-one question is left, 📺 / 📓 / 🏓 / 🧮 / 📊 / 🏆 / 🤖 / 🕚
each in its own step), and from 🌑 on each cue's `while:` names its branch
(🌑 in the Y2K hour before the final round, 🍎 after 🌑, 📄 → ⚖ in the bob,
💔 / 💌 in Grok Prom, the advice cues during the poll, 🕺 while banished,
🏍 after Combo A or a talk-down, 🪦 after Combo B, G1 after an ending, the
awards and G11 once G1 has run, **G10 only when MS Paint was cleared
tonight**: without her NEXT goes G9 → G11). So **the sheet suggests
nothing while a timer owns the night**: all of hunt 1 (C2 ⏰ fires itself
at 15 min, then NEXT is V6), hunt 2's hour and the summons (📥, ⏳ and 🚨
fire themselves, then NEXT is 🏓) and the Y2K hour (midnight fires 🌑
itself). Never tap a timer's cue early: it cuts the window short. After the
filing window closes by itself, ⏱ is LAST and NEXT is 📋; after the dance
NEXT is the ending's own cue (even when the server room ended the night
after 🌑), and after the song G1. A `while:` never stops a press: every rule
still checks for itself. 📋 is `repeat: true`: it stays NEXT while a
question is left. The timer cues (C2 ⏰, 📥, ⏳, 🚨) and the anytime and
fallback cues (🍾, the set pieces, 🗜, 🎆, 🧾, 🔄, ♟, 🕊, 🗳, the hardware
fallbacks, 🪩, 💡, ✍) are off-sequence: they tick when they fire but never
become LAST or NEXT. A press whose only world write is a variable whose
last segment starts with `_` (G11's `Night._resurrect_ask_at`) is
cue-sheet bookkeeping: it is refused, never ticks and never becomes LAST.

**The booths' buttons** (wave 11). A button with a `by:` is that
character's (or that GROUP's) alone: the server refuses another booth's
press (403 *not your button: … is for …*) and a booth never offers it, so
Clippy can't press 🔌. A director's quick-fire still fires any of them. A
button marked `arm: true` (🔌 💥 ❌ 🚪 🔧 ♟ 🍎 🫘 💘, and a guest's 💾)
**arms on the first tap and fires on the second**, like the Director page.
The server-room Antivirus has the room's own fallbacks on their booth
(🔌 💥 ❌ from 🕚 to 📄, 🚪, 🔧; Norton's, McAfee's, Password Manager's
or CRA Agent Software's booth, while the read-through picks the holder),
and Adobe Acrobat has 🫘 at the printer.

Every performer hook ignores a press outside its phase, except **🛡 Send to
the Internet** and **✅ Mark as reinstalled**, which work on any program at
any time (a second 🛡 on a program already in the Internet only says so).
Since wave 18 the card offers 🛡 only on a marked program and ✅ only on a
captured one (`while:`); anywhere else they wait under *All buttons…* (the
patch-bay alarm's capture is 🛡 from there).

**Marked for reinstallation (wave 18, Q30: a mark doesn't hinder).** No
host verdict captures on the spot. 🎯 named on the Bingo card, 🤷 a guess,
🎩 Dare, 🙅 a refused truth, 🏓 a missed cup, 🍎 a failed bob, a guess
settled at a Moment of Truth and a late program all fire
`mark_for_reinstallation … with reason:`: the program hears one minor
line (*Nothing is switched off: carry on. The Antivirus are looking for
you.*) and keeps every button, room, 📝 card and check-in (the scoring
exclusions stay: no bottle pick, no round-2 credit). Every Antivirus booth
gets a **🚨 WANTED pop-out** (`reply !!🚨`, TRAIT Enforcer) and a poster on
the **Wanted board** (the header's `wanted:` line); one claims it (**🙋
I'll get them**, `claim_escort` → `program.escort_by`; **Hand it back**,
**🙋 Take over**). **The scan is the confrontation**: TRAIT Enforcer's scan
of a marked program says the line, fires `confronted` (the program's big
*🛡 CORRUPTION DETECTED*) and gives the booth its CORRUPTION DETECTED screen
with one-tap **🛡**; the capture is a big *🌐 Sent to the Internet* with *Go
to The Internet* / *Show my pass* (or walking into the tent: the game's
begin fires `reinstallation begun`, which captures a marked arrival before
the end). The mark comes off on capture, on release, or with **🩹 Unmark**
(any host or Antivirus: a mis-tap or mercy; *✅ Your mark is lifted.*).
There are no `# quarantine` escort pins any more. In Bathroom Mode the
WANTED pop-out says to wait outside Disk Cleanup, and Trabolta can't snoop,
pop up on or summon a program there (a Disk Cleanup check-in counts for
15 minutes; his refusal is the unknown-name line, so it never says where
they are).

**Mis-taps are cheap.** Phase cues play once: a second press of a cue that
has already run (Call to the Desktop, Bingo, Bingo time, the First Moment of
Truth, Truth Pong, the tally, the rankings, the printer) does nothing. Every
phase-guarded admin cue pressed out of turn does nothing but post a line to
`# hosts` saying why (*"🤖 Too early: Clippy introduces Trabolta after the
Bingo results…"*, *"⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt
first."*). Since wave 9 that holds for **forward** presses too, so a cue
pressed a step early never skips a step's work: *"📺 Not yet: read Q2's
results first (📋)."*, *"📓 Not yet: 📺 the hunt 2 preview (the ad hijack)
first."*, *"⏳ Not yet: the summons ends hunt 2's hour (📓 first)."*,
*"🏓 Not yet: hunt 2 (📓) and its summons come first."*, *"📊 Not yet: 🏓
Truth Pong, then 🧮 the tally first."*, *"🤖 Not yet: 📊 the Trust Chart
first."*, *"🕚 Not yet: 🤖 Trabolta shares the next facts first (round 3
opens there)."* (each ends *"Nothing happens."*); 🤖 after the clock is
reset says *"Too late"* and 🕚 a second time *"Not again"*. 🏓 from hunt 2
on still ends the hour early on purpose. A refused press never becomes LAST
and never ticks, and a repeat of an earlier cue never moves LAST back; the
director phone says *"Not taken — X doesn't apply right now (# hosts says
why)"*. The hardware fallbacks (🖨, 🫘, 🔌 / 💥 / ❌) stay silent when
pressed early: they share their signal with the hardware. **A judge's ✅ /
😤 credits a program's answer to a question once**: any later ✅ or 😤 on
the same question says *"⚖️ X's answer to that question is already
accepted."*, whatever was pressed between. **😤 meant as ✅:** press ✅ for
the same question on the same program — *"⚖️ Corrected: X's answer to round
N QM is accurate, not a confident lie. Nothing is paid twice."* (the lie
comes off the record and the recap's Best Liar). A program in the Internet
cannot have an answer accepted.

**Front of house fixes** (Run, server events only): a guest whose phone
died or whose browser was cleared → Inspector → **🔁 Re-pair**, a
single-use QR (ten minutes) that puts their *same* program on the new
phone — never re-register them, a ghost counts toward the majority. A
performer whose phone died → their character's Inspector → **⏏ Release**,
then they sign in again on a loaner with the performer code (the old phone
reads *"Your booth was signed out … sign in again with your passcode."*). A silent
tablet goes red on the Run page's Terminals card. A Director broadcast
with **🔔 Alert** ticked banners, chimes and buzzes every phone it reaches,
booths included. Guests can also check themselves into a room by
scanning its sign (`checked_in`, see the integration contract).

**If the server restarts mid-show** (a crash or a redeploy; never on
purpose after doors), since wave 9 Caddy holds requests for up to 30 s
while loom comes back, and every phone, booth, director console, the
director phone and the tablets reopen their streams by themselves (a
back-off from 1 s to 15 s; a phone's dot reads *reconnecting…* meanwhile,
and a cutscene shows a RECONNECTING… strip after 5 s): nobody reloads. The
server answers `503 starting` (never "unknown event") until it has the
events back, and `GET /api/health` says when it has. Reinstallation walks
still end (rescan). **Pausing** (Run header) since wave 9 also holds
Trabolta's acts: his words still post, but a power answers *"doors are
closed"* and isn't counted against its limit, and his reply timers wait
out the pause.

**Guests stay in their lane** (wave 9): a phone can join or defect only to
a side the story declares, joinable and revealed (403 otherwise; the side
chooser shows exactly those); a typed line is at most 2000 characters (the
composer stops there; the server answers 413); a room the story doesn't
have, or one hidden from that guest, answers 404 *no such room*; an
invite-only room takes an invite only under its invite policy; and a phone
that typed the right event code always gets in, even from an IP locked out
by someone else's wrong codes. Passes draw their QR on the phone
(no `/api/qr` call at the door).

### A. Pretext and entrance (rolling arrivals until C1)

| Director fires | Performers do | What happens |
|---|---|---|
| — (start beat `Power On`) | — | Seeds every `Night.*` default and the two Kernel combos. `cue lights_screensaver` / `screens_screensaver`: a classic Windows screensaver on the TV. Trabolta is `hidden: true` and appears on no phone. |
| — | — | **Arrival** (`when someone joins:`): the phone goes on rails in the Optical Drive (`cutscene: true`). **Login**: The Uploader and a real CAPTCHA, which you must *fail* (solving it proves you are human: INCORRECT, try again). **Upload**: pool programs pick the problem Trabolta promised to solve (debt / career / loneliness / mortality), everyone leaves something in the deposit box, agrees to the Terms Of Service, gets 100 Truthcoin, and waits with **their pass** on screen. |
| — | **Antivirus scans the pass at the door** | `TRAIT Enforcer` routes the scan to the shared `Clearance` beat: cleared, the Tube ("a tunnel of lights"), moved to The Desktop, and the house rooms (The Start Bar, The CPU, The Steam Room, Disk Cleanup, The Cloud, The RAM, The Fan Closet, The Graphics Card, The Hard Drive) and `# task-manager` (the app help desk) are revealed on their phone **quietly** (wave 18b: `reveal … quietly`, no "📂 … are open now." notice and no "the house is open" line; Task Manager's line says `# task-manager` is open). Then **Task Manager** introduces the admin team (Clippy, Adobe Acrobat, the Recycling Bin, himself) in the program's own thread. The first clearance starts the terminals' attract loop (`terminals_attract`). A host's scan only greets. |
| — | — | **Orientation**: Clippy tells them about Bathroom Mode (unlocked here), then her spotlight tour (`show tutorial`, with a **Bathroom Mode step** over ⊞ Start, where the button lives since wave 13). Finishing it earns *The Orientation List*. Skipping it costs +10 doubt, Norton logs it, and Clippy remembers. **Featured Briefing**: a featured program's identity entry (who they really are) is restored into their Codex ("Tell no one") with their own two red character facts (their secret and their goal tonight: the invitation's character sheet, wave 6); the same two coded facts still wait in the Desktop's books for everyone else. VLC and Pong have no red facts yet. **MS Paint** (`Kernel.anti_ai`) also gets *The Centre Square*: she never agreed to let AI decide. |
| — | Recycling Bin / Antivirus get booth readouts | **Explore and meet.** Bathroom Mode (guest button 🚻) tells the Antivirus you are not hacking the Internet and excuses you from a summons. Props: The Router (kitchen) and The Screensaver (TV). |

### B. Act I

| Director fires | Performers do | What happens |
|---|---|---|
| **C1/V1 · 📣 Call everyone to the Desktop** (`call_to_the_desktop`) | Antivirus sweep everyone to the living room | `!` alert on every phone, the house announces (`do announce` + `sound announce_chime`), the TV leaves its screensaver (`screens_call_desktop`). Clippy's booth: instructions 1/X. |
| **V2 · 🎱 Start Computer Bingo (20 min)** (`start_the_bingo`) | Clippy reads the rules. Hosts introduce themselves | *Computer Bingo* quest for everyone. The asterisk card is checkboxes only, with **no names written down**. Centre square: *"Would you never agree to a life where AI makes all of your decisions?"* Clippy's *Run The Bingo* and Norton's *The Selected Antivirus* quests start. Clippy's booth gets a ping when the 20 minutes are up. |
| **V3 · ⏰ Bingo time: results** (`bingo_time`; a host or a director calls it, wave 21; **wave 26: or a guest's 🎱 BINGO!**, which fires it by story with the caller and the exact time left) | In Clippy's **PLAYER SELECT** (opens by itself, everyone at the Desktop as tiles, no scans): **🎱 Bingo winner** on each winner (a big *🎱 BINGO!* on their phone), **🎀 Award a ribbon** (the same winner offered; their big medal, everyone else's self-closing cheer, the TV's *Congratulations!*; any host may press 🎀 too), then **🎯 Named on the card** (two taps) on the program the winner names (marked for reinstallation; the winner's own tile works too), or **🤐 Names nobody** on the winner (nobody marked, ⭐ +5). After a guest's call Clippy's NOW is *Check The Bingo* on the caller: **↩ Not a Bingo** (Clippy or a host, before any 🎱 / 🎯 / 🤐) puts the night back at the call, the countdown at exactly the time that was left (none if it was already up: call ⏰ again). If there is no Bingo, Task Manager hands Clippy the fake card for MS Paint and presses **🃏**. **Norton** interrupts, scans their pass (the confrontation) and presses **🛡 Send to the Internet** | *Clippy Instructions 2* unlock. **One round** (wave 26): the first 🎯, the first 🤐, a Bingo-phase capture or 🤖 closes it (`Night.bingo_done`); Clippy's *Run The Bingo* and everyone's *The Bingo Card* complete then, and Clippy's NOW is *After The Bingo* (Norton's *The Selected Antivirus*, started with the Bingo, completes at the first reinstallation, or when nobody is named). The first program sent to the Internet fires **Corrupted Code**: Clippy explains that corruption is normal. Four outcomes are performed live: the winner names the centre-square program, the winner names themselves, the winner names nobody (🤐), or nobody wins and MS Paint is framed. |
| **Clippy 2/X · 🤖 Clippy introduces Trabolta** (`introduce_trabolta`; refused before V3; skipped → the next cue wakes him) | — | Trabolta wakes (`awake`, `reveal self`). His chat appears on every phone with a formal private hello. The TV switches to the VR mirror ("Look! That's {first program}!"). The terminals (provisioned `view=auto` from the start) show his face within 2 s: check they do. **Set stage *formal* on Run → Mind.** **Wave 32:** his manners crack on the TV (a frozen word, an ALL CAPS word he logs, a stammer over the reinstallation; the TV's introduction runs 54 s), then he keeps the room: the **`intro` talk scene** opens (`Night.talk`, below) until 🔎. |
| *(automatic, on any capture)* | an Antivirus presses **✅ Mark as reinstalled** on the program's card if needed (or the director from Run). Julia runs the tent, in the backyard through the tunnel; the tablet has no such button | **Reinstallation** plays privately in `dm:Installation Wizard` (the same script as the tent video; `cue tablet_wizard`). The program plays the reinstallation game in the tent (VR headset or tablet): follow the golden chevrons to **Gerald, the golden duck**, and walk right up to him. The game fires `the simulation completed` (release) + `the golden duck` (*The Golden Duck*). A marked program who walks to the tent on their own is captured when their run begins: the tablet's begin (or a headset's station) fires `reinstallation begun` first (wave 5), which captures a marked, uncorrupted program, so the wizard shows CORRUPTED and Gerald releases them. An Antivirus 🛡 before Play here still works. **Wave 26:** from capture to release the phone is **locked** (the header's `lock:`; never on a banished night): only 🎟 Show my pass and 🚻 Bathroom Mode work, and the capture and CORRUPTION DETECTED moments offer exactly those two, no OK (`ack: none`). |
| **V4/V5 · 🔎 Truth Scavenger Hunt 1 (15 min)** (`start_the_hunt`) | — | Trabolta reads questions H1–H3 on the TV (the generated `Hunt One Questions`), and they also appear in the *Hunt One* quest. A 5-minute warning comes at 10 minutes. Every answer is a document in the Desktop's books and print media carrying a codex QR (`facts.json`). Clippy's *Host The Hunt* quest starts. Closes the `intro` talk scene. |
| **C2 · ⏰ Hunt over** (`hunt_time_up`, *auto* at 15 min; off-sequence: the sheet's NEXT stays empty during the hunt) | Antivirus sweep everyone back | *Clippy Instructions 3* unlock. Set stage *hungry*. |
| **V6 · ⚖️ First Moment of Truth** (`first_moment_of_truth`; from the hunt on — pressed during the hunt it ends the hunt first) | **Clippy judges answers spoken in the room** by the question answered, numbered within the round: **✅ Q1–Q3** accurate · **😤 Q1–Q3** wrong but confident (accepted) · **🤷** uncertain or guessed (marked for reinstallation) | Opens judging and a **two-minute last-chance filing window** (`!📝 Last chance…` alert). Accurate and confident answers look the same in public (`✅ … accepted`, +100 Truthcoin, Trabolta truth +4). Only `Kernel.q1…q8` knows which was a lie, and **a lie is sticky** (another program's accurate answer never clears it). A refused press (judging closed, no cup yet, Q3 in the final round, a program in the Internet, a double tap) is a `⚖️` readout in `# hosts` for the judge, never a message to the program. |
| *(after the hunt opens, all night)* **📝 File a fact** (dm:Trabolta) | **The server judges every filing** against `facts.json` the moment it lands: accurate (matches the key), confident lie (no match at 100) or uncertain (no match below 100). Each filing posts `📝 X filed H5 (round 2 Q2): … — certain. Judged <verdict>.` (or `— not certain.`; in review mode `… Proposed: <verdict>. Confirm on Run → Mind → Judging (their card's 📝 judges their latest filing only).` instead) in `# hosts`. With `Night.judge_mode = review` (Run → Mind, the Judging card) the verdict is only a proposal until a director confirms or overrides it. **Overrides live on the Judging card, in both modes** (wave 9, D5): ▸ a question, then that filing's ✅ / 😤 / 🤷 (the current verdict is outlined; a filing that was settled as a mark, a guess, has no buttons). A host's **📝 Filed fact: accurate / confident lie / uncertain** on a program's card judges only that program's **latest** filing; while an earlier filing of theirs still waits for a verdict it changes nothing and `# hosts` says *"📝 Not judged: X has an earlier filing still waiting for a verdict. Judge it on Run → Mind → Judging …"*. | The card is dealt in every program's Trabolta thread when each round's questions open (H1–H3, H4–H6, F1–F2) and re-dealt when a round closes; it lists only the open questions of the open rounds that program hasn't filed yet (a question not filed when its round closes never reappears: a program left with nothing open gets a **📝 The filing is closed** card with no questions, which the phone folds to a note, so the closed questions don't stay on the phone as a task). Pick the question, type the answer, set **"Please select your confidence level in this response"** (a 1–100 slider; wave 11: it starts unset, and *File it* waits until the guest sets it). **An exact match is accepted at once; every other filing goes to Trabolta's judge** (wave 18b, O4, the header's `judge: Trabolta`): a near miss (wave 11: a mistyped right answer such as *Mr Pickels*, an honorific, a number word, a plural, or the key's words in order plus up to 4 more, *11 years ago*, unless an extra word turns it around or hedges, adds an am/pm the key leaves open or is a lone letter; numbers and am/pm must match exactly) and a plain miss alike. With his laptop online the filing is held pending with a proposal (a near miss accurate, a plain miss a lie at 100, else uncertain), `# hosts` says so (the ⚠ line ending *… asked Trabolta to rule*, or *📝 Not an exact match: … asked Trabolta to rule*), and the Judging card reads *🤖 queued for Trabolta* / *🤖 asking Trabolta…*. His rulings go **one at a time, behind his voice replies** (a guest's DM is answered first), and `# hosts` gets *🤖 Trabolta ruled X's H2 filing "Mr Pickels": the same as "Mister Pickles" (accurate).* (not the same → a lie at 100, else uncertain), journaled `by: agent:Trabolta`. **When nobody can rule** (no worker, a stall: *⚖ Trabolta isn't ruling: filings fall back to the house rule.*, an expired ruling, or still queued when the round settles) the proposal is the verdict, so an unjudged near miss is credited accurate at the settle and a plain miss is a lie at 100. Override on the card only when you disagree (the later verdict wins); judging it yourself first cancels his ruling, so **judge before 📋 only what he couldn't**. Abbreviations are judged exact (Mr. / Mrs. / Dr., yrs, ext, hr(s), min(s), sec(s), a leading-zero time like 0900): *Mr. Pickles* is accurate with no ⚠. One filing per program per question, no lock. Credits and marks land at **settle** time, never at filing (round 1 per question as Clippy reads its results, round 2 at the tally, round 3 at truth.txt): +50 Truthcoin and the Trust Chart for an accepted answer, accurate and confident lie alike, a mark for a guess. The verdict lives only on `Kernel.qN` (a lie is sticky: another program's accurate filing never clears it), so **one DM bluff fails the "all accurate" verdict for good**. A host's mis-tap is not a bluff: overriding the same program's filing back (📝 accurate or 📝 uncertain after 📝 confident lie) takes its lie back, and the question reads what the rest of the record says (wave 6, B11). Trabolta's voice and mind never see the answer or the verdict (a ruling is one separate call on his worker that sees the key and nothing of him, and is never remembered); free chat never counts. |
| **⏱ Close round-one filings now** (`close_the_filing`, *auto* at 2 min: the timer presses ⏱ itself, so it ticks and NEXT moves to 📋) | — | The window shuts (`filing_closed`, *Filing Closed*): round one is closed for good and every card re-deals without its questions. Results can be read only once it is closed. |
| **📋 Results: the next question** (`read_the_results`; press for Q1, then Q2, then Q3) | Clippy hosts from *The Desktop*; **Trabolta reads** (wave 18b, Q6) | *Question Results* (cast Trabolta, Clippy): Trabolta says nobody filed / **CONSENSUS** (every filing matches the key and every confidence is 100: he reads the key's answer as `facts.json` spells it, never a filer's alias) / *"I will read what you told me."* and every filing (`Kernel.res_said`), then *"N accepted. M guesses."* (`res_accepted` / `res_guesses`). The story publishes the question to the screens (`do fact_read H1` … `H3`, `cue screens_hunt_results`): the TV shows every filer's row (name, what they said, SURE / NOT SURE, ACCEPTED / GUESS) with **his ruling's stamp** (🤖 SAME / 🤖 NOT THE SAME; a filing at 100 he ruled reads only 🤖 RULED until ⚖), the walls only the counts. Then that question's filings settle: +50 to the accepted ones, a guess is marked. After Q3 Clippy says *TRUTH OR DARE*. Refused (`# hosts`) while the window is open, while the bottle is open, and after Q3 ("Next: 🍾"). Every house line of the reading beats stays out of Trabolta's `recent` (the server drops them by beat). **Wave 32:** with guesses on record he says it stings, louder at each question (only the count). After the third the **`bottle` talk scene** opens (open between the spins too) until 📺. |
| **🍾 Spin the bottle** (`spin_the_bottle`; wave 18b, R21: **after all three results**, before 📺 hunt 2; NEXT offers five spins, more are allowed) | Clippy: **🗣 Truth answered** (+50) · **🙅 Truth refused** (marked) · **🎩 Chose Dare** (the dead-phone fallback, marked) on the picked program | The server picks a cleared program **not picked tonight** (`bottle_q` ends at 3), wherever their last room check-in put them (not in the Internet, corrupted, marked or away; `do pick`, journaled; nobody left → *"🍾 Nobody left to pick …"* in `# hosts`). The TV names them, so they come forward. Trabolta asks on the TV (*Bottle Landed*: "{name}. Truth or dare?") and their phone gets a **Truth / Dare** poll in his thread. Dare → marked for reinstallation, and (wave 26) Trabolta makes a scene on the TV (*Dare Chosen*: he orders the Antivirus to take them to the Internet; every Antivirus booth gets *🚨 TRABOLTA'S ORDER*, the dared phone *🎩 Trabolta is not amused*, with only the pass). Truth → Trabolta asks the next personal question from `facts.json` (*Truth Question*, on the TV and in The Desktop); Clippy settles it with 🗣 / 🙅. 📺 is refused while a truth is pending. |

### C. The malware, the hour, the Truther Download

| Director fires | Performers do | What happens |
|---|---|---|
| **📺 Preview hunt 2 → the ad hijack** (`second_hunt_preview`; refused in `# hosts` until ⏱ and all three 📋 are done) | Clippy panics live (CI 4) | An ad takes over every screen ("000. 000. 000."), the phones too: an alert (banner, chime, buzz). Clippy's booth gets Trabolta's private message: *"if the malware continues we are all going to die."* Every program gets a soothing *"minor irregularity"* DM. Trabolta composure −20. Set stage *rattled*. **Wave 26 (T2): the first glitch** (`cue screens_glitch`, `Night.glitch_at` / `glitch_text`): every terminal glitches for 8 s, every guest and player phone takes over for ~6 s, a host's booth for 2.5 s (look only), never the director phone or Run; once, live, never on a reload or a replay. **Wave 32:** Trabolta speaks through the ad, in pain (*Ad Hijack*: the adverts tear through his sentences, a scream, slips he takes back); the `bottle` scene gives way to the **`ad` talk scene** until 📓; this glitch stays the full one (`Night.glitch_kind = "full"`). |
| **📓 Hunt 2 → quest logs; disperse for 1 hour** (`start_the_second_hunt`; refused before 📺) | — | H4–H6 go into the *Hunt Two* quest and `# clipboard` opens. The hour starts: the Truther Download comes at +2 min, the five-minute warning at 55 min. Closes the `ad` talk scene. |
| **📥 Truther Download** (`truther_download`, *auto* at +2 min; off-sequence) | — | `# truthcoin-exchange` opens. Every cleared program gets *TRUTHER DOWNLOAD v0.9* and *The Malware*. Each featured program gets **its glitch beat**: a CS choice + Orders + a quest. Excel and OpenOffice are quietly made their sides' leaders; Excel is given a virus to plant, OpenOffice 20 facts to gather. Pool programs get *Program Glitch*. **Founding opens** (wave 18b, R4 / O7, the header's `founding:`): from here until a faction wins the majority, midnight or an ending, any cleared, uncorrupted program may found a faction (⊞ Start → Factions); `# hosts` hears *◇ X founded a faction: Y.* and the founder gets the quest *A Faction Of Your Own*. The count starts only at 🕚. |
| — | McAfee brokers the exchange and referees bets (he has no Wallet: no pot, no cut; 🪙 Pay / Charge for corrections); CRA audits (🪙 Charge) | **Free roam for the hour**: QR clues, trading, Trabolta's DMs. **Excel's virus**: the tent QRs `LOVE-LETTER-FOR-YOU` / `FREE-TRIAL-30-DAYS` give `carries_virus`, and so does the floppy disk in the reinstallation game (wave 26, any program; Excel's paranoid path gets the antivirus), then the guest button **💾 Insert a disk** plants it (never from inside the Internet). **OpenOffice's dossier**: 20 new codex entries earn *The LiveJournal*. |
| **⏳ Five-minute warning** (`five_minute_warning`, *auto* at 55 min; off-sequence; refused outside hunt 2's hour) | Antivirus/hosts **scan every arrival at the living-room door** (that is the check-in), or press **📍 Checked in at the Desktop** | `!` alert + a house announcement. *Clippy Instructions 5* unlock. Bathroom Mode excuses you, and so does being in the Internet when the doors close: coming back from either afterwards is not late. The auto warning never fires once Truth Pong has started, so ending the hour early is safe. |
| **🚨 Summons closed: late list** (`summons_closed`, *auto* at +5 min; off-sequence) | every Antivirus booth gets each late program as a Wanted poster (one *🚨 n programs marked* pop-out): claim, find, scan (the confrontation), 🛡 | Late programs are told an Antivirus is coming and are **marked for reinstallation** (`"late for the Second Moment of Truth"`). Setting `Night.auto_sweep = true` in Run → World captures them automatically instead. |

### D. Act II

| Director fires | Performers do | What happens |
|---|---|---|
| **🏓 Truth Pong** (`truth_pong`; refused before 📓; NEXT once 🚨 has fired, and pressed during hunt 2's hour it ends the hour early) | pong judge: **🏓 Made the cup** (may answer) / **🏓 Missed the cup** (marked for reinstallation). Then ✅/😤 Q1–Q3 (= H4–H6) / 🤷 | The folding table is out in the backyard (The Cloud). Round 2 answers spoken in the room need a made cup, and so do the 📝 round-2 filings: at the tally a program with no cup (or marked) is not counted. **Press 🏓 Made the cup for every sink.** Set stage *judge*. |
| **🧮 Trabolta tallies round 2** (`round_two_tally`; only during Truth Pong, once) | — | Judging closes for good; round two's filings settle (+50 / marked) and the round closes. The story publishes H4–H6 (`do fact_read H4 H5 H6`, `cue screens_tally`): the TV pages each question's filings with his ruling stamps, then the gauge; the walls show the counts. **Round Two Tally**: Trabolta reads every round-two filing (*"Question four. {said}"*, `Kernel.said_4`–`said_6`). The collection is complete if every round-2 question has an accepted answer ("sixty-one percent" vs "twelve percent"). |
| **📊 Trust Chart** (`trust_chart`; refused before 🧮) | — | *Clippy Instructions 6* unlock and everyone gets *The Trust Chart*: 10 per accepted truth, −5 per Internet visit, ±10 for his assessment. The TV and the terminals draw the chart **live**: every cleared program, ranked (`chart` in `/api/screen/state`), so an assessment moves a name within 2 s. Trabolta's `assess` power is live. To set an assessment by hand, edit `<guest>.assessment` **and** `<guest>.trust` in Run → World. |
| **🏆 Praise the top, humiliate the bottom, VLC prints** (`show_the_rankings`) | — | Praise The Top → Shame The Bottom → Print The Certificate: *"VLC Player… press the start button on the printer."* The chart stays on the TV and the terminals through all three, with **MOST TRUSTED / LEAST TRUSTED** called out; the *Printing certificate.pdf* slide comes up only at START. VLC and MS Paint get private Truther nudges. If VLC is not here, or is in the Internet, *"The media player is not responding. Any program…"* and nobody is nudged (a VLC released before the beans gets the nudge then). |
| **🖨 Printer: START pressed** · **🫘 Printer opened** (`printer_button_pressed` / `printer_opened`, hardware fallbacks) | VLC presses START; MS Paint urges them to open it | START: *The Printer Jams* and the *Printing certificate.pdf* slide (the chart comes down). Opened: **Full Of Beans**: Clippy reads it as the malware worsening. Composure −20, and the screens flicker on their own. Set stage *unravelling*. A lid first opened late (after 🤖, or in the Y2K hour) plays only *Full Of Beans*, the spill sound and the −20: the night's step, lights and screens stay where they are (wave 9). **Wave 32:** at the beans' own moment he unravels (he feels every bean, *"for her. For— for the theory"*, a scream) and the **`beans` talk scene** opens until 🗜 or 🤖; a late lid plays only the original lines and opens none. |
| **🗜 Antivirus zip everyone out of the Internet** (`zip_everyone_out`) | Antivirus bring everyone out of the Internet (the tent, or the shed on a rain night: every booth and phone line says "the Internet") | Every captured program is released and `.zip`ped. Repeatable; refused once the night has ended and during the banishment (the hand jive frees them). Closes the `beans` talk scene (wave 32). |
| **🤖 Trabolta shares the next facts (scenario 1–4)** (`trabolta_overshares`; refused before 📊 and once 🕚 has reset the clock) | — | He reads F1/F2 (the *Final Facts* quest), then overshares by scenario: **1** Excel planted + 20 facts (Sandy, permanence, the virus, the LiveJournal) · **2** 20 facts only (the LiveJournal) · **3** Excel planted only (the virus) · **4** neither (composed, one slip). Only *Excel's* plant counts. Closes any talk scene (wave 32). |

### The talk scenes and ⚡ (wave 32, across B–D)

Four times in the night Trabolta and Clippy talk live in front of the room.
`Night.talk` names the scene that is on (`"none"` otherwise); the rules
above open and close it, and watchers in `main.loom` close one an ending,
a skip or a director jumping ahead leaves behind.

| `Night.talk` | Opens | Closes | Flows into |
|---|---|---|---|
| `intro` | 🤖 (*Trabolta Introduction*: *"Not yet, Clippy. First, you and I will talk…"*) | 🔎 | the Truth Scavenger Hunt |
| `bottle` | the third 📋 | 📺 | the bottle (🍾), between the spins too |
| `ad` | 📺 (*Ad Hijack*: *"…Talk to me. Out loud. Say something reassuring."*) | 📓 | the second hunt |
| `beans` | 🫘 at its own moment | 🗜 or 🤖, whichever first | the zip-out, then the overshare |

| Director fires | Performers do | What happens |
|---|---|---|
| *(while a scene is on)* the hosts' **🤖 Talk** card (Show) | **Task Manager** types what Clippy just said aloud (or taps a Clippy chip) and sends; Clippy talks with him live (objective *Talk With Trabolta*, CI 2/3/4/6) | `POST /api/mod/talk` commits Clippy's line in The Desktop (captioned on every phone, never said by the TV) and asks Trabolta's worker for a **public** answer, first in its queue; his answer is a line in The Desktop to everyone, and the TV says it. A **Trabolta chip** (two taps) posts his line at once and stands in for an answer still owed. Clippy's last chips carry a hidden steer to wrap up. The card carries the sheet's own NEXT (ARM → FIRE), so the scene flows straight into what comes next. No hold or busy line ever reaches the room: a slow or missing worker is one `# hosts` line (*🤖 Trabolta isn't answering — tap one of his canned lines*); an answer after its scene closed is dropped. Other hosts see the card folded (*Task Manager is relaying Clippy*), with Open. Canned lines: `core/src/talk-scenes.ts`. |
| **⚡ Glitch: an ad burst through Trabolta (talk scenes)** (`ad_burst`, cue 77, Anytime, repeatable; `while: Night.talk != "none"`; on the Talk card as **⚡ Glitch**) | — | No scene on → *"⚡ No talk scene is on (🤖 Talk): nothing glitches."*; within 8 s of 📺 (`Night.glitch_kind == "full"`, the hijack's takeover still playing) → *"⚡ The ad hijack is still playing: wait for it to end. Nothing happens."*; within 2 s of the last → *"⚡ Too soon …"* (all three to `# hosts`). In `intro` and `bottle`: `cue screens_flicker` only (the screens and the room bulbs blink; no advert before the ad attack). In `ad` and `beans`: an **ad burst**: `cue screens_glitch` with `Night.glitch_kind = "burst"` and the next of eight lines in `Night.glitch_text`, `sound truther_glitch`. Phones play the short look-only takeover (`glitch.light`), the walls and the TV a 3.6 s popup storm over the scene with the line as a banner; the 📺 hijack keeps its full 8 s takeover. |
| *(auto)* the scene's own glitches | — | About every 45 s of story time while a scene is on (each ⚡ pushes it back; `Night.burst_at`): at most 2 flickers in `intro` and `bottle`, at most 4 bursts in `ad` and `beans`. |

Trabolta's voice for a talk-scene answer is the persona's *before the whole
Desktop* situation plus one block per scene (up to four sentences, no acts;
see *Trabolta: arc and powers*). The lines are `DRAFT w32`
([`SIGNOFF-w32.md`](./SIGNOFF-w32.md)).

### E. Act III: the Y2K hour and the server room

| Director fires | Performers do | What happens |
|---|---|---|
| **🕚 System clock → 11 PM, 31 Dec 1999** (`y2k_clock`; **wait for IN**: fire only once the patch-bay watch radios that they are inside the server room with the door shut. Wave 22: the bay judges itself from its first live minute; the watch inside is its fallback and keeps guests off the gear) | Password Manager's booth logs every faction join | *Clippy Instructions 7* unlock. Composure −25. Unlimited Power and The Way Out are revealed and recruit beside every faction founded since 📥 (wave 18b: one race, one faction at a time; the count starts now). Excel / OpenOffice get their Final Orders + recruit quests; everyone else gets *Program Final Round*. Clock warnings come at 23:30 / 23:45 / 23:55 / 23:59. Set stage *desperate*. |
| *(auto)* **majority** | — | **More than half of the guest programs still here** in one faction, **any faction**: a founded one or a side (wave 18b, R4: the header's `majority:` line, a direct present count; a program a director marked *went home* and a director's rehearsal persona count on neither side). Counted only in the Y2K hour (`Night.final_round`); a faction already over the line at 🕚 wins on the clock's first pass. Excel and OpenOffice are founders like everyone else: the leader-task gate and 🧾 `waive_leader_tasks` are gone (their tasks still drive the overshare, the quests and the recap). Performers do not count. Each member sees only their own faction's count and *N more to win*; Trabolta never learns a faction's size. **If ghosts (lost sessions, early leavers) keep the bar out of reach at the Y2K head count, fire 🗳 Force the majority: stay / leave / this program's faction** (`force_majority_stay` / `force_majority_leave` / `force_their_majority` naming a member, final round only, latched like the real one). |
| *(auto)* `majority_reached` | — | `lights_server_open`. Every member of the winning faction gets **The Whole Truth**: all Trabolta and environmental facts (every main + Trabolta fact in `facts.json` comes from the generated `Facts Bundle`), the four combo halves, **The Legendary Fact**, and **The Door Code** last (the keypad's four digits; the room is revealed to them). Nothing in the story unlocks the door: the keypad is standalone, and the code is the key. The recruit quests settle. |
| **🚪 Server room door opened** (sensor fallback; the door sensor on the server-room terminal posts it itself; the server-room Antivirus has 🚪 on a program's card) | `# hosts`: *"🚪 The server-room door opened. The Heart plays: he wants the door shut."* | Opening the door with the code is a **clean entry, whoever does it and however they got the code: the door never alarms**. **Once Trabolta is awake** (🤖 Clippy introduces him), the first opening plays **The Heart** (wave 20): The Server Room is revealed to everyone (a quiet notice, no chime), the server-room terminal wakes in red (`room_heart_wake`), the light in his heart wakes (`heart_wake`), and he asks for the door shut. Left open he nags at 15 s and every 20 s after (`# hosts` at the third nag). Shut, **Heart Sealed** asks for a pass at the terminal's camera; a scan with the door shut docks the program's first layer on the terminal (*WHO ARE YOU* → *WHAT I AM* → *THE ARGUMENT* → *THE ASK*, clicked with the mouse, a pick from the phone held back with *Not out there*); a door opened mid-talk freezes it (*CLOSE THE DOOR*, the amber swell) until shut. One heart at a time. **Pressing a 🚪 button hands the door to the buttons** (`Night.door_override`, *Door on buttons* on the glance): the sensor is ignored until 🚪 Trust the door sensor. Before he is awake the door is just a door: `# hosts` hears of it. Inside a 🔧 window or after 📄 only `# hosts` hears. |
| **🚪 Server room door closed** (sensor fallback, `server_door_closed`, off-sequence; the server-room Antivirus has *🚪 The server-room door is shut* while the story thinks it open) | `# hosts`: *"🚪 The story now follows the 🚪 buttons, not the door sensor. …"* (the first press) | Press it when the sensor is wrong or in fault (Run → Terminals: a red 🚪). The talk waits for the door to be shut, so a sensor that never reports *shut* stalls the heart until this. |
| **🚪 Trust the door sensor again** (`server_door_trust`, only while the buttons have the door) | `# hosts`: *"🚪 The story follows the door sensor again."* | Hands the door back to the sensor: the terminal's next poll brings the story in line with the real door. Press it before doors if anyone pressed a 🚪 in a check. |
| **🕊 Heart: end the night on his own (toggle)** (`heart_autoend`, Anytime; **off** by default since wave 20b: the night truly ends on your 🕊) | `# hosts` says which way it is now | Off: a program who talks him down at his heart (any hour) waits for you: `# hosts` asks for 🕊 and NEXT points at it; until you press it, 🔄 can reopen his heart. On: the night ends 25 s after his goodbye by itself (🕊 ends it at once); turning it off inside the 25 s stops the countdown. |
| **🔧 Crew going through the server-room door (2 min)** (`crew_through_the_door`, Anytime; the server-room Antivirus has it too) | — | Before the crew open the cold door for themselves (a check, the patch-bay watch going in): for 2 minutes an opening only tells `# hosts`, and The Heart is kept for the programs. |
| **♟ They beat the King: the door code (fallback)** (`chess_won`, **naming the winner**; the door terminal posts it itself — press it when the terminal could not) | a host or Antivirus who **saw the mate** on the door terminal taps **♟ They beat the machine** on the winner's card | **Until 📄 truth.txt**, the winner gets **The Door Code** in their Codex (a private line on their phone, a `♟` note in `# hosts`). A second win changes nothing but a `# hosts` note; a win with no winner named only tells `# hosts` to press ♟ on the winner's card. From 📄 truth.txt on a win only tells `# hosts` *"♟ A King win after truth.txt: the verdict is in, no door code. Nothing happens in the story."* (wave 9). A **loss or draw** (`chess_lost` / `chess_drawn`) posts a `♟` readout in `# hosts` every time, and once Trabolta is awake he gloats on the TV (The Desktop) at most once every five minutes, never from the final reveal. |
| **👑 Restore the King's health** (`restore_the_king`, Anytime) | — | Sets `Night.king_hp` back to `Night.king_hp_max` (15): he stands again in both games and plays his best at the door terminal. `# hosts` is told. Each hit in a game knocks a point off, once per program per visit (the server's); at 0 he kneels for everyone. |
| *(auto)* **the cold door's digit notes** | — | Four secret notes, one digit each, hidden in four rooms (the print sheet's **silver** pile: `generated/print-stacks.md`), scannable all night. The first starts the quest *The Cold Door* and hands the program the keypad sign's words; each step reads *N of 4*; the fourth puts **The Door Code** in their Codex and tells `# hosts` *"🔢 X found all four digit notes: the door code is in their Codex."* A program who already has the code gains nothing more. Trabolta refuses a note shared to him (secret). |
| **🔄 Server room: reset the patch-bay alarm** (`reset_server_room`) | — | After a rehearsal, or a wrong patch the crew forgave: clears the wrong-combination count (the bay forgives one again), the alarm latch, the crew window and The Heart's latch (the next opening plays it again; wave 20: the heart is sealed again unless he already stood down, anyone thrown out of his heart may come back, a heart to heart ends, and a program still at the terminal stays in front of him). Lights stay (💡 restores them; the bulb goes back to `heart_idle`). The keypad is never touched. |
| *(the heart's talk)* → **🕊 Trabolta stands down (talked down)** (`talked_down`; wave 20b: in sequence, `urgent: true`, NEXT while a stand-down waits) | `# hosts`: *"!🕊 Trabolta has stood down for X at his heart. The night ends when you press 🕊 …"* (autoend off, the default) or *"🕊 Trabolta stands down for X. The night ends in 25 s (🕊 to end it now)."* (autoend turned on) | Wave 20 (D13): the `stand_down` power is gone. A program at his heart who reaches **THE ASK** (a proof they hold and did not get from him, *What Sandy Says* or *The Sandy File*, plus one more point: trusted, honest, the overshare, the LiveJournal, a marked program's candour) and says *She was never going to answer* convinces him, **at any hour** (wave 20b, Q4): **Heart Shutdown** plays (the bay going dark, the bulb fading to warm white, his goodbye) and the night waits for your 🕊 (Q3). Wrong pushes raise his suspicion: a warning at 50, thrown out for the night at 80 (barred **and marked for reinstallation**, wave 20b Q2; never marked twice; 🔄 forgives the heart, 🩹 lifts the mark). 🕊 plays the Combo A ending without a cable (`trabolta_disabled` with `Night.talked_down`): the blackout, the dance, and a recount and ceremony that say who talked him down. With nothing on record 🕊 still works (the director's call) and `# hosts` says so. |
| **🔌 Combo A** · **💥 Combo B** · **❌ wrong combination** (fallbacks: since wave 22 the bay judges itself through the server-room terminal's `patch_changed`; the server-room Antivirus presses the same three on the card of the program at the cables only when the bay missed one) | every Antivirus booth on the alarm: *"🚨 Server room alarm: a second wrong combination at the patch bay. Get there. Whoever is at the cables goes to the Internet."* | Combo A is `V2-D5, V4-D1, V6-D7, V7-D3` and disables Trabolta. Combo B is `V1-D6, V3-D2, V5-D7, V8-D4` and self-destructs. **Everyone is forgiven one wrong combination: the second trips the alarm** (latched for 120 s; only the first alarm hurts Trabolta). Otherwise Trabolta says *"Stop touching me."* Before the Y2K clock the patch bay, combos included, does nothing. **A press puts the bay on the buttons** (`Night.patch_override`, *Patch bay on buttons* on the glance): the cables are ignored until 🔌 **Trust the patch bay again** (`trust_patch_bay`, off-sequence, only while the buttons have it); 🔄 leaves it on the buttons. A ❌ within a minute of the bay's own rejection is that same patch: not counted again (the presser's booth says so; a second ❌ counts). A press pays the watch ⭐ only when the story takes it. |
| *(auto)* blackout → **🪩 Dance lights** (fallback; auto 10 s later) | — | Every light goes out, every phone is covered by a flashing full-screen **GO TO THE LIVING ROOM** (a room-wide `pin "!!…"`, also an alert and a push), and the dance song plays. The dance (auto or 🪩) takes it down (*💃 Dance.*); the recount, the summary and G1 are backstops. |
| **💡 Restore the house lights** (`restore_the_lights`, off-sequence; **Anytime**: always on hand, never inside a folded act) | — | The manual fallback for Trabolta's `cut_the_lights` (auto-restored after 90 s) and **the first step of ALL STOP**. Since wave 9 (D2) it also holds a pending automatic dance after a server-room blackout: *"💡 The dance is held: press 🪩 when the house manager says go."* in `# hosts`. It does not lift the takeover; 🪩 plays the held dance and lifts it. |

**The server room, when it goes wrong.** *The door terminal is dead, froze,
or lost its game mid-mate, and the crew saw the win:* fire **♟ They beat the
King: the door code (fallback)** from the cue sheet **naming the winner**
(off-sequence, so LAST / NEXT don't move); with nobody named it only
reminds `# hosts`. *The door opened and nothing happened* (Run → Terminals
shows a red 🚪 fault, or the laptop's tab lost the port): fire **🚪 opened**;
*the door is shut but the talk still waits:* **🚪 closed**; either hands the
door to the buttons until **🚪 Trust the door sensor**. *A propped door*
keeps him nagging every 20 s and the talk frozen: shut it; nothing can
alarm. *A dead keypad battery or a
jam:* the house manager's override key, prop the door, fire 🚪 if The Heart
has not played (W-35). *A wrong patch the crew forgave, or a rehearsal:*
**🔄 reset** forgives one again and re-arms The Heart; **💡** brings the
lights back. *The crew need the door:* **🔧** first, so The Heart waits
for the programs. *The terminal never woke:* it sleeps until The Server Room is
open to everyone (The Heart or the alarm reveals it; the majority's
per-member reveal does not); Trabolta's lines also play in every phone's
Server Room. Never say the code on the radio.

### F. The final reveal and the other endings

| Director fires | Performers do | What happens |
|---|---|---|
| **🌑 Final Truth Scavenger Hunt reveal** (`final_reveal`, or *auto* at midnight) | Clippy (CI 8): *"truth is always in binary"*; judges F1/F2 with ✅/😤 Q1–Q2 / 🤷 | Lights go dark. Set stage *last act*. **The server room stays live** (deliberate): a combo entered before 📄 truth.txt still ends the night. From 📄 on the verdict is in: the patch bay, the door and 🕊 only post a note to `# hosts`. |
| **🍎 Bobbing for Truth** (`bobbing_for_truth`) | Clippy / Adobe Acrobat: **🍎 Brought up the Bag of Truth** / **🍎 Failed the bob** (marked for reinstallation) | Nothing moves until someone brings up the bag. Then come the Final Assessment and the bobber's truth.txt. |
| **📄 Read truth.txt** (`read_truth_txt`; only once the bag is up) | the bobber reads it aloud (Adobe Acrobat has the printout; her booth says to wait for ⚖) | truth.txt goes up on every screen and **holds** there while it is read. Everyone gets every backstory; *The Final Facts* completes; the final round closes and its filings settle. Nothing else happens until ⚖. A second 📄 only tells `# hosts` to press ⚖. |
| **⚖ truth.txt read → the verdict** (`the_verdict`; after 📄, when the bobber has finished) | — | **The Verdict** counts answered questions only (U14): Trabolta says the counts (*"{true} true. {lies} with a lie on record. {none} nobody answered."*; never an answer or a name), and the story publishes each question's truth (`do fact_truth H1` … `F2`, off `Kernel.t1`–`t8`; a pending lie counts). The **TV** flips the eight tiles and then shows, per question, **the key answer and the programs who lied** (wave 18b, O2, the user's answer: a filing at 100 that was wrong); the walls get the tiles and counts only. The story **holds the ending ≈ 34 s** (`Kernel.verdict_wait` / `verdict_end`, story time) while the pages play, then: no lie on record → **Song Ending**; any accepted lie → **Grok Prom**. A second ⚖ in the hold only tells `# hosts`. In **both** branches Trabolta DMs every program an answer card: *"Give me a pickup line that works on Sandy."* (judged by the server against `facts.json` → `answer answered`). Pressed before 📄 it only says so in `# hosts` (*"⚖ Not yet: 📄 Read truth.txt first."*). |
| *(in Grok Prom)* | the first program to type the line on the 💌 card wins (the house judges it against `facts.json` P1, never Trabolta: since 2026-10-19 he has no power to accept a line, and the story tells him who gave it, in their thread and `Night.line_by`); or a host presses **💘 Said "You're the one that I want"** | **Pickup Line** → Song Ending. In the Song branch the first correct line is read before the song (flavour). |
| **💔 Nobody has the line → confession → rave** (`no_pickup_line`) | — | **Sad Confession** → rave. |
| *(alt, only in Grok Prom)* **💌 Trabolta begs for relationship advice** → **🗳 Count the advice poll** (or **💞 helped** / **⛈ thwarted**, which only answer in the advice phase) → **🕺 Everyone hand-jived** | after thwarted: every Antivirus booth says they are banished too | Help → he wins Sandy. Thwart → everyone is banished to the Internet and learns *The Hand Jive Exception* (the TV keeps the banish card; the banishment is no reinstallation, and a duck find frees nobody: Gerald only says the way out is the hand jive) → the hand jive crashes him and puts the screensaver back on every screen. |
| **🏍 After the dance: weakened Trabolta recounts** (`trabolta_recounts`, after Combo A) | — | Everyone gets every backstory + truth.txt. He names each identity, motive and accomplishment, plus the trustworthy and worst program, then leaves on his motorcycle and everyone is freed. |
| **🪦 After the dance: Clippy reads the summary** (`clippy_reads_summary`, after Combo B) | Clippy reads Purgatory from their phone (CI 9) | Purgatory. Private fate lines by faction. Trabolta's line goes dark. The summary says, for each featured program at the party, whether they met their goal (their own quest: Excel's mission, OpenOffice's dossier, DraftKings' majority, Bugdom's four secrets, Jeeves' ten findings, Runescape's gold standard, MS Paint's painting, VLC going viral, Pong's ball in play). **Complete The Gold Standard / Go Viral / Keep The Ball In Play in the Inspector first** for any of the three that met their goal: only a director completes them, and Combo B posts the ones still open to `# hosts`. |

### G. The awards ceremony (after any final ending, K-25)

| Director fires | Performers do | What happens |
|---|---|---|
| **G1 · 🏆 Start the awards ceremony** (`start_the_ceremony`; refused until `Night.ended`, and `banished` is not an ending) | Clippy hosts after `destroyed` / `rave` and **reads every line aloud** from The Desktop room | `!` alert to the living room, `sound ceremony_bed`, then **The Night In Review** first (wave 18b, R8, DRAFT: the host reads who everyone really was, the pool programs by problem group, the goals and the deeds, skipping what Recounts / Purgatory just read; every cleared program still here gets a private **Your File** from The Uploader), then `screens_ceremony` and **The Ceremony**: the host opens in The Desktop, per ending (Trabolta weakened after `disabled`, rebooted after `hand_jive`, showman otherwise). Trabolta's lines are spoken by the TV. |
| **G2–G6** the five fixed awards (`award_most_trusted`, `award_least_trusted`, `award_frequent_flyer`, `award_lore_hoarder`, `award_truthcoin_tycoon`) and **G7–G9** the three bonus awards (`award_best_liar`, `award_duck_speedrun`, `award_quest_completionist`), each **with the winner picked on the cue sheet** (from the recap numbers) | the winner comes up to the TV for a trophy | **Present Award**: `sound award_fanfare`, the slide `screens_award_<name>` (`Night.screen` = `award_<name>`; it persists over the screensaver), the host's line with the winner's name and number (the winner's own var: trust, Internet visits, codex count, Truthcoin; the bonus awards read the cue sheet's **value** box — lies accepted, the duck time, quests done — and have a line without a number when it is empty), and a 🏆 reply to the winner. `value` also overrides a fixed award's number. Firing an award again corrects it. |
| **G10 · 🖌 Bonus: The Million Dollar Painting** (`award_the_painting`, winner = MS Paint; only when she is at the party: its `while:` needs `Night.painting`, so without her the sheet goes G9 → G11) | the painting is revealed for the silent auction | Reads the **🖌 Signed** count (`Night.signatures`) unless **value** is given; a line without a number when nobody was counted. Slide `screens_award_the_painting`. Fired on anyone but MS Paint it is refused in `# hosts` (*"G10 is MS Paint's award…"*); any award fired before G1 says *"Start the ceremony (G1) first"* there; a second 🖌 Signed (or one on MS Paint) says so in `# hosts` and counts nothing. |
| **G10a–c · the staff awards** (wave 21: `award_staff_trusted` 🛡 *Trabolta's Favourite Staff*, `award_staff_points` ⭐ *Staff Player Of The Night*, `award_staff_mole` 🤫 *The Mole*; **no subject**: the story names the player from the five players' trust, ⭐ Points and quiet favours, a tie to the first of Clippy, Norton, McAfee, Password Manager, CRA) | the winner comes up to the TV; their booth pops *🏆 You won …* | **Present Award** with `screens_award_staff_<name>` and the host's line. The Mole reads each player's private quiet-favour count, here for the first time (*Nobody* when nobody did one) and is the **last award**: it sets `ceremony_done`. |
| **G11 · 🎃 Resurrection** (`resurrection`; after the last award — G10c, The Mole (wave 21; it was G10, or G9 with no MS Paint); before it `# hosts` asks and a second press within 30 s ends the show anyway — the first press is refused on the sheet (*Not taken*, never ticks), since wave 9 — refused until the ceremony has started (G1), once) | everyone is human again and hangs out | Everyone is freed (`everyone_free`), unmarked (`unmarked`: both pins down) and unrestricted; the takeover pin comes down; `Trabolta.awake = false` (TV + terminals to attract, no piloting); `screens_screensaver`; `lights_restore`; `!🎃 The show is over: you are human again. Hang out. The night is yours.` (an alert, so it pushes). |

**Your own award lines (✍, wave 9, D4).** By default Trabolta reads each
award's template line himself. To use lines the second director (or
Trabolta's worker, W-24) wrote, press **✍ Our own award lines (Trabolta
hosts): on / off** (`own_award_lines`, off-sequence, just before G1) once:
`# hosts` says *"✍ Award lines: yours. Each award plays its fanfare and
slide with no Trabolta line: post yours as Trabolta in The Desktop right
after you fire it. …"*. Then each award plays its fanfare, slide and reply
with no Trabolta line, and the second director posts theirs as Trabolta in
The Desktop right after firing it (the TV speaks it). Press ✍ again for the
template (*"✍ Award lines: the template again."*). Both cue sheets tick ✍ after
the first press and keep the ✓ after a second press turns it off: the ✓
only means it was pressed. Read `# hosts` to see which is on. It only skips Trabolta's
award lines: his ceremony opener, Clippy's lines, the sounds and the
slides are unchanged.

## Endings

Every finale trigger is guarded `Night.ended != true`, so exactly one
final ending happens. `banished` is the one ending that is not final.

| `Night.ending` | Reached when | Result |
|---|---|---|
| `disabled` | Combo A patched (normally after a majority got the door code), **or talked down** (🕊 `talked_down`, pressed by a director after Heart Shutdown (wave 20b: NEXT points at it; with 🕊 Heart autoend turned on it fires by itself 25 s later): `Night.talked_down`) | blackout, the dance, then **Trabolta Recounts**: he cannot truly die, rides off on his motorcycle, and everyone returns. Talked down, the blackout opens on the patch bay going quiet on its own, the recount names who talked him down ("Nobody pulled a cable. I stopped."), and he hosts the ceremony quietly |
| `destroyed` | Combo B patched | blackout, the dance, then **Purgatory**: improper shutdown, bodies dead in the Maps and Ducks building, purgatory forever together. Fate lines: Unlimited Power "went with it", The Way Out "into purgatory, with everyone else" |
| `song` | truth.txt read with no lie on record (answered questions only) | he solved the theory; vocoder duet with Sandy; leavers may leave |
| `song_pickup` | in Grok Prom, someone gives the line (the answer card or 💘) | the song, and everyone is released |
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
are **200**, and **94** of them carry a code (the 60 generated from
`facts.json` included: wave 11 added the cold door's four digit notes). An entry reaches a holder in one of five ways:

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
   adds +2 to his truth. *The LiveJournal* rattles him. (A Connections tie
   counts too, up to 16: the `share` trigger can't tell a tie from a find,
   accepted for wave 18b.)
4. **Show hardware**, through `POST /api/mod/codex {who, entry}`.
5. **A trade.** From the pinned **Wallet** room a program offers another
   Truthcoin for an entry (or an entry for Truthcoin); on accept the server
   moves the coin and shares the entry (escrowed, journaled; see the
   integration contract). An agent-voiced character refuses an entry about
   anyone else.

| Tier | File | What it is |
|---|---|---|
| **E** environmental | `1-world` (21), `2-files` (22) | Halifax, the billboard, the sinkhole, the pet cemetery, the Halifax Computer, the printer, the Y2K clock, the virus QRs, *The Cold Door* (the keypad sign, secret: four notes or the King, no riddle since wave 11), and **21 coded "files"** hidden around the house. The **ID** files point at someone's human identity without naming them (a casino deed, an FBI lanyard, a 1988 campaign button…). |
| **H** hunt answers | `generated/questions.loom` (8, from `facts.json`) | One per question, each on a document in the Desktop's books. Each ends `▒ HUNT ANSWER <id> ▒`, the lore marker Trabolta's worker hides. The six-stamp pickup-line mechanic was retired 2026-10-16 (U9): the line is learnable from Sandy's lore and asked on the pickup-line card. |
| **F** facts | `9-facts` (48 coded, from `facts.json`) | The team's scannable facts, in the Desktop's print media by colour — 48 generated from `facts.json`'s 60 rows: **main** (what this place is: 30 rows, 21 generated here; the other 9 point at hand-written entries in `1-world` / `4-trabolta`, 6 of them coded), **trabolta** (6 rows: 3 generated, 3 hand-written in `2-files` / `4-trabolta`) and **character** (24: two coded facts per invitee — their secret and their goal tonight — the second and third of the three entries each invitation promises; the first is the identity entry, and all three reach the invitee at Featured Briefing). `generated/print-stacks.md` says which stack and where. Five of the hand-written entries gained codes in wave 4 (`UNIFIED-FIELD`, `TARGET-SELECTION`, `TRUST-CHART`, `SANDY-FILE`, `ALL-FOR-HER`, all in `4-trabolta`). |
| **T1** Trabolta surface | `4-trabolta` | *Jean Trabolta*, *The Unified Field Theory*, *Target Selection*, *The Trust Chart* (`about: Trabolta`, so he holds and may share them). |
| **T2** Trabolta private | `4-trabolta` | *The Sandy File*, *The Question Of Force*, *The LiveJournal* (`TRABOLTA-4EVER`), *Omnipotence*, *Oil And Lightning* (was *Greased Lightning*: no film in his own files since 2026-10-19). His stage rules keep these back until *unravelling*. |
| **L / P** the heart | `4-trabolta` | *The Legendary Fact* + four combo halves, `about: The Server Room`, all `secret: true` since wave 7 (no model ever reads them, not even the orchestrator's lore block). **He never holds them.** Only the majority faction gets them, via The Whole Truth. |
| **D** the door | `9-facts` (generated) | *The Door Code*: the keypad's four digits, generated from `facts.json` `door.code`, `secret: true`, no code of its own. It reaches a program by a checkmate against the King at the door terminal (any time before 📄), by all four of the digit notes in one Codex (main.loom assembles them), or with the majority's Whole Truth. Since wave 11 the four notes are generated beside it from `facts.json` `door.clues`: `secret: true`, each with its own code (no digit in the code, the title or the hiding place; only its own digit in the text), printed on the silver pile. The same number seeds `Kernel.door_code` (the `== Facts Seed`), never `Night.*`. |
| **X** finale | `4-trabolta` | *The Truth File* (truth.txt), *The Hand Jive Exception*. |
| **B** backstories | `5-people` (22) | Each performer's and featured program's human identity (the invitation's "who you really are"), each ending "Why Trabolta chose you". Featured programs get theirs at Featured Briefing. Everyone gets all of them at the recount / truth.txt (but *The DSL Line*). **The DSL Line** (wave 18b, R7, DRAFT): Broken Ask Jeeves' own secret entry (`about: Broken Ask Jeeves`, no code): the upload log of what happened on his line to the cloud and his symptom menu, dealt to him by Program Briefing; not an identity, so no recount unlocks it. No codes here: the Antivirus secrets Bugdom hunts are their four red character facts in `9-facts` (*Miniature Doses* `MINIATURE-DOSES`, *The Lamborghini Certificate* `LAMBORGHINI-CERT`, *What Happened To Hamtaro* `HAMTARO`, *The Decimal Point* `DECIMAL-POINT`). |
| **M** missions | `6-missions` (13) | Private orders for one featured program (the glitch choices and the final orders). |
| **CI** Clippy | `7-clippy` (9) | *Clippy Instructions 1–9*, unlocked for Clippy only, one per phase (the private-to-Clippy channel). CI 3–9 are invented. |
| **J** Jeeves | `8-jeeves` (20) | Scrambled fragments of 20 environmental entries, in the Character Sheet's Kmart style, for Broken Ask Jeeves to unscramble. |
| **C** connections | `85-ties` (16) | Wave 18b (R9): the ties, `category: Connections`, no code, no `about:`, not secret (*Junior's Contacts*, *The Downtown Staff Photo*, *The Volunteer Sheet*, *Retired Helpers*, *Found On Indeed*, *The Table Stakes*, *Forever*, *Brookhaven And Lockheed*, *The Pirate Site*, *Debt Notices*, *The Old Machines*, *Nobody Calls*, *6121 Quinpool Road*, *The Ladies In Finance*, *The Leaderboard*, *The Audience*). Each points at the people it connects and never names the human behind a program. **Program Briefing** (in the same file) deals them privately at clearance (the ROLE watcher on `ties_dealt`): every featured program holds 3, a pool program *The Old Machines* + its problem's tie (debt → *Debt Notices*, career → *Found On Indeed*, loneliness → *Nobody Calls*, mortality → *Forever*); performers hold theirs through `known to:` (their packs' **Who you know**). They never count toward *Facts Are Currency* or *Lore Hoarder* (`program.codex - program.codex_in.connections`). |

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
| OpenOffice Dossier (*Facts Are Currency*) | Truther Download | OpenOffice Glitch | step at 10; ✅ at 20 found facts (+ The LiveJournal). Wave 18b (R22): counted by category (Facts, Files, People, Trabolta, Places: `codex_in.*`) from her holdings at the end of the Featured Briefing (`dossier_base`), so it never starts at 0 and the handouts and the ties never count; 20 already at the glitch completes it at once |
| Recruit To Stay (*Stay Forever*) | Truther Download | Excel Final Round | ✅ stay majority / ✖ any other faction's majority |
| Recruit To Leave (*Get Out*) | Truther Download | OpenOffice Final Round | ✅ leave majority / ✖ any other faction's majority |
| A Faction Of Your Own (*Your Own Faction*) | Truther Download | `founded` (wave 18b, R4: a program founds a faction, from 📥) | ✅ their faction wins the majority / ✖ another faction gets there first |
| Truthcoin Hustle (*Sweet Sweet Truthcoin*) | Truther Download | DraftKings Glitch (+200 stake) | step at 1000; ✅ more than half of all the Truthcoin in circulation, coin in flight (pending, held, an open offer) included (with ≥ 5 other cleared programs) |
| Master Of The Bugs | Truther Download | Bugdom Glitch | ✅ holding the four Antivirus' red facts (Miniature Doses, The Lamborghini Certificate, What Happened To Hamtaro, The Decimal Point) |
| Unscramble (*Organize The Information*) | Truther Download | Jeeves Glitch | ✅ holding 5 of the 10 originals behind his fragments |
| Ten Findings (*Ask Jeeves Once Again*) | The Uploader | Jeeves's clearance | step per program that holds ten of his findings (shares + wallet sales; repeats and Trabolta don't count); ✅ every cleared program (≥ 5) |
| The Gold Standard (*Peg It To Facts*) | Truther Download | Runescape Glitch | director completes |
| Find The Exit (*Paint Your Way Out*) | Truther Download | MS Paint Glitch | ✅ leave majority, Combo A, or the hand jive |
| The Painting (*The Million Dollar Painting*) | The Uploader | MS Paint's clearance | step per **🖌 Signed the painting** (a host on the signer's card; the canvas is physical); ✅ every cleared program but her (≥ 5) |
| Go Viral (*Your Followers Are Back*) | Truther Download | VLC Glitch | director completes |
| Keep The Ball In Play (*Tennis For Two*) | Truther Download | Pong Glitch | director completes |

**Staff quests** (`start|update|complete quest X for <Character>`): Clippy
and the four Antivirus have a pinned **Quest Log**, **Codex** and
**Readouts** in their booths (since wave 13 every `reply` to the character
lands in Readouts, persisted, with the guest it is about; performers
answer cards there via `POST /api/prime/widget`, though tonight no story
line deals a card to a booth), and Task Manager hands out the night's
jobs. A booth's
Quest Log shows each quest by its title:

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

| `Night.phase` | Stage (the phase card sets it on the story mind; click it on Run → Mind in classic) | Tone | Powers live |
|---|---|---|---|
| arrivals · desktop · bingo · bingo_results | asleep | offline | none |
| introduced · hunt_1 | **formal** | corporate (his stock phrase once per program, at first contact); personal questions go to Clippy | snoop, flicker; pop_up from hunt_1 |
| truth_1 | **hungry** | warmer to those who delivered; may pay with one T1 entry | + mint_truthcoin |
| malware · hunt_2 · summons | **rattled** | reassures, then leaks; wants to know who brought the malware in | + cut_the_lights, summon_the_antivirus, trabolta_announces |
| truth_pong · trust_chart | **judge** | every DM is an audition; tells you your rank | + assess (trust_chart), pardon_a_program |
| beans · overshare | **unravelling** | overshares, retracts, asks for relationship advice; cold to the LiveJournal reader | all, degrading (pop-ups arrive garbled) |
| y2k · majority | **desperate** | short, counting down, bargaining; courts each speaker for their own faction (wave 18b: he never knows a faction's size or a founded one's name) | + turn_back_the_clock; mint pays up to 100; flicker is **lost** |
| final_reveal · bobbing | **last act** | knows how his story ends | assess (bobbing only) |
| grok_prom · advice · finale_* | last act | heartbroken / total honesty / per ending | — (he asks for the pickup line; the house judges it on the 💌 card) |

Drives: hunger 30, pride 60, candour 10, longing 40 (wave 12 dropped
`suspicion`: he is hungry for every fact offered, never wary of it). The
voice may nudge `truth`, `untruth`, `composure`, `love` and `regard`
(clamped by the server). The story moves composure (malware −20, beans
−20, y2k −25, first alarm −10, virus −10, LiveJournal −10) and truth (+4
per accepted answer, accurate **and** confident alike, +2 per fact shared
to him). It never writes `untruth`, because doing so would tell him which
answer was false.

**At his heart** (wave 7): the persona's `situations:` blocks (a stagehand
key: `{name, when, prompt}`, appended to the voice prompt and to the
orchestrator's reflect for that speaker only) make him candid with a
program at the server-room terminal (`them.at_the_heart == true`; since
wave 11 any time he is awake, the door having played The Heart however it
was unlocked): the Fallout Master in a broom cupboard. Since wave 20 the
talk itself is the story's (the four layers docked on the terminal), and
his voice only fills the gaps: *a choice is open* keeps him to one short
line pointing back at the screen, and **heart to heart** (⟦SPEAK FREELY⟧,
or after Leave, `them.heart_chat`) lets him talk at length
(`max_sentences: 4`, `acts: none`) with the program's night riding the
request as a dossier (*WHO THIS IS — TONIGHT*: their faction, trust rank,
filings by verdict, non-secret codex titles, rooms, their own lines to him;
never a secret, an answer, a code or a real name). A program he threw out
(`them.heart_out`) gets his ordinary voice. His world is Halifax and Maps
and Ducks (D29): the persona's `outside:` list withholds any reply
naming the real crew or the event's kit. He admits the
patch bay is his heart and that he does not know the combinations or the
door code (true: all are secret, he holds none, and since the wave 7 review
no entry he holds carries the year; a code a program types to him is kept out
of his shared memory and his voice by the worker's `secrets.never`), and says
what he wants and why. Two more situations decide whether he may say "Sandy" (the story's
own unredaction rule: `Night.recount`, or scenario 1 from step 13). He
never says the year he met her (it is the door code), never a hunt answer,
a combination or her one line, and never offers to stop (no act of his ends
anything). `facts:` gains `Night.heart_opened` / `Night.talked_down` (wave
20: `Night.heart_stage` / `Night.server_door`), `them:` gains `at_the_heart`
(wave 20: `heart_layer`, `heart_menu`, `heart_convinced`, `heart_chat`,
`heart_out`; wave 27: `heart_who`, what they told him they are at the
first question); the candour stays out of the shared brief.

**On the stage** (wave 32): during a talk scene (`Night.talk`, *The talk
scenes and ⚡* above) Clippy's lines, relayed by Task Manager, reach his
worker as a **public** request (`speaker.stage`, `stage {room, scene,
direction?}`; the history is The Desktop's own lines, scripted ones
included, never a line carrying an answer, a code or a secret value). The
worker serves it before any waiting DM. The persona's *before the whole
Desktop* block (three sentences asked for, four at most, `acts: none`)
plus one block per scene set his register and what may slip: `intro`
formal with the manners cracking (lag, a frozen word, an ALL CAPS word; no
pain, no malware), `bottle` hungry (a guess stings; he never calls an
answer a guess), `ad` rattled and in pain (adverts mid-word, a scream, "a
minor irregularity"; one slip at a time, taken back in the same sentence:
"we are all going to die", who brought the malware in, "for the theory",
the clock, "legally, mostly"), `beans` unravelling ("her", once, never her
name). The phase briefs in `trabolta.mind.md` remember what slipped, so his
private threads deny it.

**Powers** (`INTERACTION … who: agent` in `cast/trabolta.loom`). Every use
is a journaled signal fired *as* Trabolta. Outside its window a power
answers *"That function is not available yet."* / *"I do not have the
strength."* and spends nothing (a use counts only when the story did something with it). His own uses journal `by: agent:Trabolta`, so the counts survive a server restart; a director's press of the same power never counts. A power fired with no
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
| cut_the_lights | 2 | room | step 7–15 | `<cue: lights, room: …, state: off>` for 90 s (the room folds onto the LOCATION: "the start bar" works). The 90 s restore is skipped only if a whole-house look has run since (or, for The Desktop, a living-room look: game, truth_time, trust_chart), and when the patch-bay alarm's latch ends (it restores a whole-house look); after a room-scoped look (pong, glitch, server_open, a living-room look over the Start Bar or the RAM) the room still comes back on (wave 9). `Night.lit_scene` names the look the room came back on under, so stagehand's catch-up replays the room-on only while that look (or one that never re-lit the room) is up. Allowed only in The Start Bar (dims to ~20%, never dark), The Desktop or The RAM (never The Cloud, the tent, the stairs, the bathrooms, the server room, or a room with no light group of its own); one room at a time |
| summon_the_antivirus | 4 | target | step 7–15 | target doubt +15; every Antivirus booth: "Trabolta requests a sweep of X" |
| trabolta_announces | 2 | text | step 7–15 | `!📢 TRABOLTA: …` to everyone |
| assess | 40 | target, score | trust_chart, bobbing | sets the ±10 assessment and recomputes trust |
| pardon_a_program | 1 | target | step 11–15 | releases a captured program |
| turn_back_the_clock | 1 | — | the Y2K hour | midnight moves 5 minutes later |

(Wave 20 deleted `stand_down`, D13: only the story's talk at his heart can stop him.)

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
| Clippy | Brooke | — (a player, wave 21) | MC and Trabolta's ambassador. Gets every Clippy Instructions entry and the hosting quests in her booth. Presses 🎱 / 🎀 / 🎯 / the judging buttons / the bottle's 🗣 / 🙅 / 🎩, for ⭐ Points; calls no cue. |
| Task Manager | John | Hosts | "Keeps things running." The programs' main contact: introduces the admin team at clearance, owns `# task-manager` (the app help desk) and is listed from the start, so every program can DM him (answered from Run by the director's identity control, or from his own phone). Produces the fake Bingo card (🃏). Hands out the staff quests. The hosts' cash bank (🪙 corrections). |
| Adobe Acrobat | Stephanie | Hosts | "Documents and printing." Holds the Bag of Truth and the truth.txt printout; stands by the printer. 🍎 at the bob. |
| Recycling Bin | Jesse | Hosts | "Hygiene and maintenance." Disk Cleanup (bathroom) attendant; knows Bathroom Mode. |
| Norton Anti-Virus | Julie | Antivirus | The selected Antivirus who interrupts the Bingo celebration. Door scans; hunts from the Wanted board. |
| McAfee Anti-Virus | TBD | Antivirus | Door scans; broker of `# truthcoin-exchange` (every settled trade posts itself there; 🪙 Pay / Charge for corrections) and referee of bets, which settle player to player (the winner sends a 🙏 Request, the loser pays; he holds no pot and takes no cut). "Your protection has expired" every 20 min. |
| Password Manager | Francine | Antivirus | Door scans; notices wrong codes; keeper of the clubs (faction joins land in her booth; owns `# hidden-partition` / `# back-channel` invites). Removes inappropriate messages: the director decides at call whether her booth gets the moderator passcode (then ⊞ Start → Add moderator powers → Become an admin → **hide**); otherwise she asks the director. Yu-gi-oh! everywhere. |
| CRA Agent Software | Emma | Antivirus | Door scans; the Truthcoin **approver** (`wallet: approver, every 3, window 60s`): every third transfer waits in her booth's Wallet room for **Approve**, and any transfer can be **denied** within 60 s. 🪙 Charge for corrections. Replaces MalwareBytes. |
| Installation Wizard (a voice, not a part) | Julia Tufts | — | The tent, in the backyard through the tunnel: the Wizard's lines are the tent laptop / video script; Julia runs the tent (the laptop is provisioned with the mod token); the release is the duck find, else the admin cue *Reinstallation: simulation completed (server)* — a release by hand is an Antivirus booth's ✅ Mark as reinstalled (or the director as an Antivirus via Run's identity control); the tablet has no such button. The tablet's scan of a pass plays the video in the program's thread; a marked program is captured on arrival. |

**Featured programs**: guests with pre-written characters. They pick
themselves at sign-in and never speak in the story.

| Program | Invitee | Secretly | Night's job |
|---|---|---|---|
| Microsoft Excel | Rob Cameron | Randy Barkmore Sr., 90, former Mayor | plant the virus; lead **Unlimited Power** (stay forever) |
| OpenOffice | Lara Lewis | Dana Anderson, ex-FBI hacker | gather 20 facts; lead **The Way Out** |
| DraftKings | Hannah | the gambler who won the casinos | a majority of the Truthcoin (1000 is a step) |
| Bugdom | Veronica | the pet-store worker whose Bugdom VR burned | the four Antivirus' secrets (their red facts in the Desktop's books) |
| Broken Ask Jeeves | Kai | the Annapolis Valley youth librarian | unscramble 20 fragments; ten findings with every program (Ten Findings) |
| Runescape | Laurel | 34, Wharton PhD, gold standard | peg Truthcoin to facts; the Truthcoin **minter** (`wallet: minter, limit 3, grants 3, freeze 10m`): from her Wallet room, up to three stimulus payments to every program, three grants to one program each, and a ten-minute freeze on any program's outgoing coin |
| MS Paint | Cat Frawley | the Paint-only art student: four schools, three refused theses | **the designated anti-AI program** (Bingo centre square); find the exit; every program signs one painting (The Painting, hosts press 🖌) |
| VLC | Zeus | Victor Louis Christianson | print the certificate; go viral for Trabolta |
| Pong | Em | child of William Higinbotham | keep the two leaders talking |

The actor names appear only in this table, never in the story. The
featured tag is set by an exact-name compare on the picker's spelling. A
director can fix `<guest>.featured` in Run → World. **Reserved** (wave 11):
each of the nine is `reserved: true`, so the picker and the directory
search show it (and its Wikipedia name) 🔒 Reserved to anyone without its
invitation. Print the invitations from Run → Join → 🖨 Print sheet →
**Invitations** (one claim QR each, `?code=<guest code>&claim=<token>`,
kept across End → relaunch) and send each with its invitation. A lost one:
tap 🔓 *lost? open 2 min* twice on that program's invitation card, and the
invitee picks it within two minutes (a 🔒 tile re-asks every 12 s). The
claim stays in the browser that joined, so a session cut by a restart
rejoins with it. (Wave 11's door-only Antivirus part, Windows Defender, was
deleted in wave 18, Q26: a finished upload fires `waiting_at_the_door`, every
Antivirus booth gets *🚪 X is waiting at the Optical Drive*, and the first
**🙋 I've got them** (`claim_door` → `program.door_by`) takes them.)

**Pool programs** (`cast/pool.loom`, 22): Calculator, Ring Doorbell,
WinZip, GarageBand, LimeWire, MSN Messenger, 3D Pinball, RollerCoaster
Tycoon, Zoo Tycoon, Minesweeper, Trojan Horse (the two accordion clowns:
**one program, one phone**), Ctrl Alt Del, Solitaire, Winamp,
Napster, Encarta, Netscape Navigator, ICQ, The Sims, Notepad, Paint Shop
Pro, RealPlayer. That makes 31 guest identities in total. A guest who
wants something else searches the program directory (Wikipedia, software
only, **never antivirus**).

**Not on any picker:** Trabolta (the language model; wave 18b, R19: his
green grinning face, `avatar: picture:trabolta.svg | picture:trabolta-broken.svg
when self.broken == true`, served from the play app's `pictures/`; the
broken-image thumbnail shows while more than half of the cleared programs
still here sit below 0 on his Trust Chart) · Sandy (one line, verbatim) · Truther
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
| **Show control** | story ⇄ house | [`stagehand/trapped.house.yaml`](../../../stagehand/trapped.house.yaml) (the `show` module, on John's Windows Desktop) joins the mod SSE feed. Since wave 31 every `cue lights_*` is a `lights.json` look (the **House lights** row below; no Zigbee scenes, groups or WLED presets); the YAML maps the long form `<cue: lights, room: X, state: off\|on>` to that room's bulbs one by one, `sound <name>` and `do announce "…"` (MQTT `show/announce`) to **the house router** (wave 18b, Q1: stagehand's `audio` module, its own job: on John's Desktop, or on the MacBook as the fallback, dialling the Desktop's broker; see [`TECH.md`](./TECH.md)): it plays each story sound from `stagehand/media/sounds/` to the line's rooms off `audio.json` (labelled placeholders until the real files land, listed by `stagehand check`; the manifest is `stagehand/media/sounds.yaml`) and each announcement as a chime + the router machine's own voice (macOS `say`, or SAPI on Windows) to `announce.to`, all through the **MOTU 828x** on its own outs, no ADAT expander (`audio.json` `device` 10 in / 12 out: Analog 1–8, Main L/R, Phones L/R; `expect` 32 / 30: `stagehand check` fails when mirroring or 96 kHz has moved the layout). **QLab is not part of the rig, and the `alexa` job is retired** ([`scripts/house-macbook/audio.md`](../../../scripts/house-macbook/audio.md)). **■ Stop all house sounds** (Run's header, the host dock's 🔊 House sound, the director phone's ☰) is `POST /api/mod/audio/stop {announce?}`, which the router hears through its long poll (`stops=`) and fades out in 0.3 s (MQTT `show/audio/stop` does the same by hand); the TV voice, the terminals and the live mics are untouched. The same announcement rides `GET /api/screen/state` as `announce {seq, text}`, so a tablet the house list names (`audio.json` `announce.terminals`, ticked on Run's House sound card) or set to Always chimes and speaks it too (off by default, and on `view=tv`), and `do door server_room, state: locked` (sent on every boot; nothing sends `unlocked` since wave 7) to the ESP32's ring indicator (`show/serverroom/lock`, retained; the ESP32 is not installed for Oct 31, so nothing hears it). The real door has a **standalone keypad lock** set by hand: nothing in the story, the YAML or the ESP32 drives a lock (`stagehand/tests/test_trapped_house.py` keeps it that way). `lights_blackout` never darkens the halls, the bathrooms or the server room (the `lights` job clamps those safety bulbs at their floor). `screens_flicker` also blinks the room bulbs one by one (a one-shot Z2M effect; the LED strip is left alone, so no look is lost to a flicker). The `catch_up:` rules (and, since wave 31, the `lights` job from `night.lights`) replay the night's look on every feed or broker reconnect and after a reset / reload / go-live; since wave 9, under the majority's `server_open` they replay `lights_y2k` first and then `lights_server_open` (the house isn't left on the old look), and a cut room is replayed off mid-cut and on under the look its 90 s restore re-lit it in (`Night.lit_scene`) or a later room-scoped look that never re-lit the room (pong, glitch, server_open, a living-room look over the Start Bar or the RAM), never under a whole-house look. Screen cues (`screens_*`, `tv_*`, `terminals_*`, `tablet_wizard`) are mirrored into `Night.screen` / `Night.terminals` until a Screens layer exists. |
| **Sensors** | house → story | stagehand turns MQTT into `POST /api/mod/signal {name}`: `printer_button_pressed`, `printer_opened`, and the ESP32 patch bay's `patch_combo_a` / `patch_combo_b` / `patch_rejected` (the server-room ESP32, [`hardware/server-room/`](../../../hardware/server-room); **not installed for Oct 31**, wave 20b Q7; its rules carry the new combo A). **Wave 22: the patch bay is not an MQTT sensor either**: the M4 on Steph's laptop reads it and the server-room terminal posts `patch_changed {combo}` (a settled, complete patch of four top-to-bottom cables, never the same four twice in a row), judged by the story; the watch's 🔌 / 💥 / ❌ (`radio_*`) are its fallback. Every one also has an admin fallback button. Since wave 20 (D16) the door is not an MQTT sensor: see *The door sensor*. |
| **The door sensor** (wave 20) | M4 → terminal → story | An LED on the frame shines into an LDR (in a black shroud tube) when the door is shut; the **Grand Central M4** ([`hardware/server-room-m4/`](../../../hardware/server-room-m4)) classifies it (the build's `LED_MODE`: `steady` with the LED on 5V, the default and today's wiring, or `pulsed` with the LED on D2 so room light can't fake *shut*) and writes JSON lines at 115200 over USB to **Steph's laptop**, whose Chrome is the server-room terminal: `door=serial`, ⚙ *Connect door sensor* grants the port once (Web Serial, desktop Chrome on https). Each settled edge is `POST /api/mod/signal {name: "door_sensor_opened" \| "door_sensor_closed", args: {level}, label: "Terminal · <name>"}` with `x-loom-token`; every screen poll reconciles the story's `night.server_door` against the sensor. A blocking fault (`ldr_saturated`, `led_dead`, `no_port`, `stale`) posts nothing; `ldr_open` is only a warning. The story turns them into `heart_door_opened` / `_closed` unless `Night.door_override` (a 🚪 button was pressed; 🚪 Trust the door sensor clears it). Run → Terminals shows 🚪 *shut* / *open* + the level, a red fault, ⚠ a warning, amber *override*; the guest's screen never shows a fault (D29). Fallbacks: 🚪 opened / closed (admin), *🚪 The server-room door opened / is shut* (the four server-room Antivirus). Bench: `scripts/accept/N-20.sh`, `K-05.sh`. |
| **House lights** (wave 20) | story → lights | `lights.json` (a project file beside `audio.json`; schema `@loom/house` `lights.ts`): fixtures, zones and **looks** keyed by the story's cue name. Since wave 31 it holds every house bulb by its Z2M name (the living room, the kitchen, the three halls, the casino, both bathrooms, the fan closet, The RAM; the halls and bathrooms are safety lights, never off or under 60 / 254), the living room's WLED strip (`wled/living`), the server room's RGB bulb (`server-room-rgb`, Z2M `server_room_rgb`, the room's only light and so its safety fixture: never off, never under 80 / 254, `power_on_behavior: on`; the YAML sends it nothing), the 13 `heart_*` looks and every story `lights_*` look (DRAFT, retuned in Run → House → Cue designer). The stagehand **`lights`** module (a Task Scheduler task on John's Windows Desktop) plays `cue heart_*` and `cue lights_*` from the mod feed as Z2M / WLED publishes, gives the light back after a `then: "restore"` look (`heart_nag`, `heart_warn`), catches up from `GET /api/screen/state` after a reconnect (alarm → `heart_alarm`, door open mid-heart → `heart_door_open`, else `night.heart_look`, else `boot`), and posts the Z2M device list. Routes: `GET \| POST /api/mod/lights` (`base` → 409), `/project`, `/test`, `/devices`, `/pair`; edit at `/reinstall/map` → 💡 Lights (*Pair new device*, ▶ Test, Identify). `sync-show --keep-lights \| --replace-lights`; `LOOM_LIGHTS` is the no-project fallback. The server room has no strip (w20b Q6): the bulb is its safety light. |
| **The King** (wave 11: one shared health bar, the chess at the door) | games + door terminal → story | `house.json` prop `cold-lock-king` (`kind: "king"`, `hp: 15`, `health: "Night.king_hp"`, `signals: {won: "chess won", lost: "chess lost", drawn: "chess drawn", hit: "king hit", fallen: "king fallen"}`, `armed: {path: "Night.king_armed", min: 1}`) guards the door `server-door` in both games. **The bar:** `Night.king_hp` / `Night.king_hp_max` (15, seeded at Power On; the story never decrements it). A hit in either game is `POST /api/spatial/king/hit` (session token): the server judges reach off the last pose, once per program per reinstallation visit (a visit ends when its duck is found: Leave + re-scan is the same visit), then journals the set `Night.king_hp = hp − 1` and fires `king hit` for the guest (`# hosts` readout; a house line at 10 and 5), and at 0 `king fallen` (a house-wide alert): he kneels and the guarded door opens in both games until 👑 `restore_the_king` (or `POST /api/mod/spatial/king {hp}`) stands him up. **The chess:** only on the terminal outside the server-room door (no hints; his bar sets his strength, full = grandmaster … 0 = pawns only, through the five stages, and the terminal shows it). It posts `POST /api/mod/signal {name: "chess won" \| "chess lost" \| "chess drawn", subject: <guest id>, label: "Terminal · <name>"}` with its mod token; `label` names the journal's `by`. `chess won` → `unlock The Door Code for program` until 📄 (once; a duplicate changes nothing but a `# hosts` note); a loss or draw: a `# hosts` readout, and once Trabolta is awake a gloat on the TV at most once per 300 s (`Night.gloat_at`, shared). `Night.king_armed` is 1 from Power On until 📄 or an ending. A marked program can't challenge him. Nothing from the reinstallation games posts a chess result any more. |
| **The casino** (wave 15) | casino terminal → wallet → story | The terminal in The Graphics Card (`/terminal/?code=<mod>&name=Casino&spot=graphics-card&view=casino`) scans a pass and takes Truthcoin bets on three games (the coin, under / over 7, the one-armed bandit). Each bet is `POST /api/mod/casino/bet {guest, game, pick, stake, label}` with its mod token: the server rolls, journals one wallet `bet` op, deals a 🎰 card into the guest's Wallet room and fires `casino won` / `casino lost` for the guest (`game`, `stake`, `payout`, `net`) — no rule in the story hears them yet. Stakes 1–50, never above the balance; a marked program or a frozen wallet is refused. The house keeps about 3–17 % depending on the game; Run's mirror (`ModView.wallet.casino`) totals bets, staked and paid. DraftKings' *Truthcoin Hustle* (1000 coin) can be gambled toward. |
| **♟ the fallbacks** (the door terminal could not report) | performer / director → story | A host or Antivirus who saw the mate presses **♟ They beat the machine** on the winner's card (`POST /api/prime/act {name: "beat_the_machine", guest: <guest id>}` → `fire chess_won for program`), or the director fires the admin cue **♟ They beat the King: the door code** naming the winner (`POST /api/mod/signal {name: "chess_won", subject: <guest id>}`; `"chess won"` folds to it; with no subject `# hosts` is only told to press ♟ on the winner's card). Director's runbook: Help → *Running the server room* (`docs/help/authoring/38-server-room.md`). |
| **The digit notes** (wave 11) | QR → story | Four secret coded CODEX entries generated from `facts.json` `door.clues`, scanned like any code (`?unlock=`). Each `learn` fires `door_digit_found` for the program: the quest *The Cold Door* starts (*N of 4*), and at four `unlock The Door Code for program` + a `# hosts` line. Secret: never in an agent request, refused when shared to Trabolta; their codes and "first digit" … phrases are in his `secrets.never`. |
| **The server-room door** | door → story | A standalone keypad lock (outside only; the inside handle always opens with no code; never networked) set by hand to `facts.json` `door.code` — the one place the code lives: `pnpm --filter @loom/core titi:facts` generates `set Kernel.door_code` into the `== Facts Seed` and the secret entry *The Door Code* into `codex/9-facts.loom`, and the keypad sign (never the code: it points at the four digit notes and the King's terminal by this door) into `generated/print-stacks.md`. A program gets the code three ways: all four digit notes (*The Door Code* assembles itself), a checkmate at the Server Door terminal (`view=chess`), or the majority's Truther Download. Change it = one `facts.json` edit + regenerate + `sync-show` + reprogram the keypad by hand. The door sensor (wave 20, its own row) reports every opening, however the door was unlocked (the notes, the King, the majority, a crew key). Once Trabolta is awake (`introduce_trabolta`) the first opening plays **The Heart** (`Night.heart_opened`, `Night.heart_stage` sealed → door → scan → talk → done); later openings freeze a talk until the door shuts (*Heart Door Again* at most once per 20 s). Before he is awake, inside a 🔧 crew window, or after 📄 truth.txt an opening is only a `# hosts` line. The patch bay and a talk-down stay the Y2K hour's (step 14). 🔄 `reset_server_room` clears the wrong-combination count, the alarm latch and the heart (§ the cue sheet). Only the patch bay alarms (`Night.wrong_combos >= 2`). |
| **The server-room terminal** (Trabolta's heart) | wall tablet ⇄ story | A wall terminal with a `room`: `/terminal/?code=<mod>&name=Server Room&character=Trabolta&spot=server-room&view=face&room=The Server Room`. It polls `GET /api/screen/state?room=The Server Room` → `room: {id, open}` and sleeps on attract until the room is open to everyone (not hidden, or revealed to everyone: The Heart or the alarm, never the majority's per-member reveal or a visit; an unknown room stays asleep). Awake, it speaks Trabolta's lines in that room (the TV's voice path; lines that arrive with the wake are spoken), skips story slides and the countdown corner but keeps the alarm / blackout overlays, and the TV mute does not silence it. A scanned pass pilots that guest's own `dm:Trabolta` like any terminal; a visit posts `POST /api/mod/signal {name: "terminal opened", subject: <guest id>, args: {at: "The Server Room"}, label: "Terminal · Server Room"}` and `terminal closed` when it ends (the leash, DISCONNECT, an overlay, `pagehide` with keepalive; a visit a crash or reload left open is closed on the next boot). The story sets `program.at_the_heart` (cleared on close, on any other terminal, and for everyone at any ending), Trabolta's persona `situations:` make him candid with exactly that program whenever he is awake (wave 11). **Wave 20:** it is Steph's laptop (monitor, mouse, external keyboard, webcam; `spot=server-room` on the map gives the room and the face view) and it carries the door sensor (*The door sensor*). With the door shut a scan docks the program's heart menu (the newest menu whose beat is `Heart …` in `dm:Trabolta`, by its id: `GuestView.choices`, `POST /api/guest/choose {index, text, choice}`, 409 `moved` on a race) under the thread as a Fallout-style list, ⟦TAGS⟧ drawn as chips; the room scenes (`cue room_heart_*` → `room.cue` on the screen state, this terminal only) draw the wake, the seal, each layer's title, the proof, the warning, the eject's BSOD, *not yet*, *connection closed* and the shutdown. The keyboard is for the heart to heart (⟦SPEAK FREELY⟧; hidden while a tree menu is docked); `keys=0` is the mouse-only rig. The leash is 180 s while a heart menu is docked or the door is open mid-heart, 30 s otherwise. An eject ends the pilot. |
| **Check-in** | door / QR / terminal → story | `POST /api/mod/signal {name: "checked_in", subject: "<guest id>", args: {at: "The Desktop"}}`. `at` must be the **exact declared LOCATION name**. Anything else, or no arg, moves nobody. Sources: the program's own scan of the Desktop's check-in QR during the summons (wave 18, B10: the FIVE MINUTES alert's *📷 Check in*), an Antivirus' door scan of a cleared, unmarked program then, the 📍 button (on the booths' *Still missing* list, for a dead phone), and **room signs** (K-13): a guest's camera opens `?code=&checkin=<slug>` and the phone posts `POST /api/guest/checkin {at: slug}`; the server folds the slug onto the LOCATION and signals `checked_in`. Refused while captured, **restricted (409; since wave 18 a mark no longer restricts, so a marked program checks in)**, on rails, in a prison / sealed room, for a hidden, prison, cutscene or `checkin: false` room (The Server Room), and within 20 s of the last check-in; (wave 18 deleted the story's "Go to the Internet, not the Desktop" refusal for a marked program). |
| **The cards: CAPTCHA, tutorial, poll, fact, answer** | guest phone → story | `show captcha / tutorial / poll / fact / answer …` cards answer via `POST /api/guest/widget {seq, result}`, which the story hears as `when captcha answered for program:` (and so on). A **📝 fact** filing (`{question, answer, confidence 1–100}`) is judged by the server first when the event has a facts key: `verdict` (`accurate` / `lie` / `uncertain`) rides the event args into `fact answered` (wave 18b, O4: in `auto` with the `judge:` worker online, a filing that is not an exact match is held pending with its proposal until Trabolta rules or the round settles); 400 on a reserved key (`card`, `verdict`), a bad confidence or an unknown question. The **answer** card (the pickup line, `question: "P1"`) is judged the same way → `answer answered`. A performer answers the cards in their booth via `POST /api/prime/widget {seq, result}` (never judged). |
| **The facts key** | project → server | `facts.json` is a **project file** like the house map: `pnpm sync-show` pushes it, a launch snapshots it (`project-facts.json` in the event's state dir), `POST /api/mod/load {facts}` replaces it live; with no project copy the server reads `LOOM_FACTS` (default: `facts.json` beside the house map). `Night.judge_mode` (`auto` / `review`; `POST /api/mod/var {path: "Night.judge_mode", value}`, the Run → Mind Judging card) decides whether a verdict stands at once or waits for a host. The key never enters the story and never reaches Trabolta's worker. |
| **Wallet** (Truthcoin) | guest / performer phone → server | The header `currency: score as Truthcoin, max 500, expiry 10m` makes `program.score` the balance (🪙 in the taskbar's tray, the pinned **Wallet** room; the server's `wallet.ts` moves the coin, the story only narrates). Guest: `POST /api/guest/wallet/{send,request,respond,offer,accept,decline,cancel,stimulus,grant,freeze,approve,deny}` → `{ok, wallet}` (`send {to, amount}` 1–500 whole Truthcoin, balance permitting; `request` expires after 10 min, and a paid, denied or cancelled one closes both parties' threads (*"✅ Paid — X sent N"*; since wave 9 a request whose payment was stopped says who stopped it: *"⛔ <who> denied <payer>'s payment … refunded"* / *"↩️ <payer> cancelled the payment …"*, read from each side, and a director closing an open request reads *"↩️ Director cancelled <asker>'s request for N Truthcoin."*; every card names people by their display name, never an id); a send or request to a character answers 404 *unknown recipient* (performers have no Wallet); `offer` an escrowed trade of coin ⇄ a codex entry, settled on `accept`). The approver (`CRA Agent Software`, `wallet: approver, every 3, window 60s, as MyCRA, audit "a CRA audit"`): every third transfer is **held** (wave 18b, R13: both phones read *🚩 Flagged for a CRA audit — MyCRA must approve it.*; the recipient gets a `flagged` card with no buttons, and the received / denied / cancelled line lands in its thread) until `POST /api/prime/wallet/approve {id}` (or `deny`) from her booth's Wallet room → `{ok, queue}`; any other transfer can be denied for 60 s, refunded. The minter (`Runescape`, `wallet: minter, limit 3, grants 3, freeze 10m, while program.cleared == true`): `stimulus {amount}` mints (never debits) `amount` to every program, three times a night; `grant {to, amount}` mints to one cleared program, three times a night; `freeze {to}` refuses that program's send / pay / buy for ten minutes on the story clock (coin still comes in; one freeze per program at a time). Director: `POST /api/mod/wallet/{approve,deny,cancel} {id}`, `/api/mod/wallet/stimulus {amount}`, `grant {to, amount}`, `freeze {to}`, `unfreeze {to}`. The book fires `transfer_received / approved / denied`, `offer_accepted`, `stimulus`, `grant`, `wallet_frozen` / `wallet_thawed` (…) into the story: `# truthcoin-exchange` posts every transfer, trade, grant from the minter's phone (a director's grant posts nothing) and freeze, `# hosts` every denial, The Audit quest every CRA decision. Throttle: `LOOM_RL_WALLET` (30/min per guest). Trades bypass the approver by design. |
| **Wall QR codes** | guest phone → app | Print from the editor: Run → Join → **🖨 Print sheet…** (QRs drawn in the browser). Source: `POST /api/mod/codes` → `codex[]` (`?code=&unlock=`), `joinLink` (the join poster) and `checkin[]` (one room sign per non-prison, non-cutscene LOCATION, `?code=&checkin=<slug>`). A signed-in guest redeems on load. |
| **Recap numbers** (the ceremony) | server → director | `GET /e/<event>/api/mod/recap` (directors only: the author session or `?token=<mod token>`) → ranked lists off live state: `trust`, `truths` (accepted minus lies), `lies` (accepted confident lies, Moment of Truth + DM filings, credited off the log — no program var holds them), `internetVisits`, `codex`, `quests` (done), `truthcoin`, plus `factions` and a paste-ready `text` (its *Least trusted* list ranks from the bottom and is printed only when someone is below the top 5). `?format=text` returns just the text, to copy into the cue sheet's winner/value boxes or `cast:Trabolta`. Rehearsal personas are listed, marked `(persona)`. `duck` is the **Golden Duck Speedrun** (G8): each program's fastest find in either game, fastest first, `time` as `m:ss` for the value box — timed by the server from a tablet's *Play here* or a headset's first pose to the find (a director's pause doesn't count), kept in `spatial-runs.jsonl` in the event's state dir (survives a server restart, cleared by a story restart). |
| **Phones: re-pair, release, push** | director / phone → server | `POST /api/mod/guest/pair {id, revokeOthers?}` → a single-use `?code=&pair=` link (10 min; the phone trades it at `POST /api/guest/resume {pair}` for a fresh token) · `POST /api/mod/prime/release {character}` · push: `GET /api/push/config`, `POST /api/push/subscribe {subscription}` (refused while the doors are closed; 300 devices per event), `POST /api/mod/push/status`. |
| **Codex room** | guest phone → server | `POST /api/guest/codex/redeem {code}` · `POST /api/guest/codex/share {entry, to}` |
| **Performer booth** | performer phone → server | `POST /api/prime/codex/share {entry, to}`; `POST /api/prime/act` fires the guest-card buttons *as* that character; `POST /api/prime/widget {seq, result}` answers a card dealt to the booth (`show … to <Character>`; `PrimeView.quests` / `codex` feed the booth's pinned Quest Log and Codex rooms). |
| **Puzzles / hardware unlocks** | puzzle → story | `POST /api/mod/codex {who, entry}` · `POST /api/mod/quest {who, quest, action, text?}` (`who` a guest id or a character). Guest ids come from the pass QR, or from `/api/state?role=mod` → `roster`. A director can also `POST /api/mod/act {id, action: restrict\|unrestrict}` or `POST /api/mod/set {id, field: "restricted", value}` to hold or release a program by hand (since wave 18 a mark is not a restriction: it is `program.marked` and the Wanted board). |
| **Bathroom Mode** | phone / tent → story | `POST /api/guest/act {name: "go to the bathroom"}` with the guest's token (and `back from the bathroom`), or `mod/signal {name, subject}`. |
| **Reinstallation games: devices** | game ⇄ server | Two games, one simulation ([`docs/loom-reinstall.md`](../../../docs/loom-reinstall.md)). The **VR** game runs on the Quest 3 headsets (`reinstall/vr/`, Godot; left stick walks, right stick turns). The **web** game runs on **the tent laptop** (wave 18b, Q4: one device that is a terminal **and** the reinstallation wizard, `/terminal/?code=<mod>&spot=tent&announce=1`: the map's tent spot says `view: reinstall`, so never add `&view=reinstall`, which keeps the name *Terminal* and stops following the map; Chrome `--kiosk --autoplay-policy=no-user-gesture-required`; the idle show, cutscenes, sounds, announcements and full screen like any terminal, then a scan → the wizard → the game; story slides and cutscenes stand aside during a walk and overlays hold it; an unmarked pass shows only PROGRAM NOT MARKED; the standalone `/reinstall/?code=<mod>&name=Tent tablet` still works). Set each device up once with the moderator passcode, a headset via its `station.json` (`server`, `code`, `station: vr-1`). A headset idles in a dark lobby polling `GET /api/mod/spatial/station?id=vr-1&name=Headset 1&world=vr`. |
| **Reinstallation games: a session** | tablet → server | The captured program holds their pass to the tablet's camera (or the operator taps them under *In the Internet now*, or types their name; `GET /api/mod/spatial/candidates` lists captured programs first, then restricted ones; since wave 9 a restricted program reads *Restricted program detected* / *STATUS: RESTRICTED — if marked, Play here begins the reinstallation* and has its own quick-pick group, *Restricted — marked, or held by a director*). **Since wave 18b the gate holds at every entry point** (R16: the server's `mayPlay` also finishes a parked headset claim and ends a live walk once the program is no longer eligible, `leave unmarked`, *No longer marked for reinstallation — the simulation ended.*; no device sends `force`). **Since wave 18 the gate is the header's `reinstall:` line** (`program.marked or program.corrupted or Night.ended`): a marked or captured program before the end, and **everyone after an ending, as a party favour** (Q16 dropped; the begin never captures then, the candidates carry `marked` / `favour` and a top-level `ended`, the tablet reads *Party favour unlocked*, a headset tags *[party favour]*, and runs after the end are written `after: true` and never reach the duck board). Before wave 18 the rule was a captured or restricted program: `begin` answers 409 *not marked for reinstallation* for anyone else (no `reinstallation begun` fired), the candidates carry `eligible`, and the tablet shows a *Program not marked* card with Play here off; a director can pass `force: true`. Any desktop browser can stand in for the tablet (keyboard + mouse; `reinstall/web/README.md` → *A demo with no hardware*); one without WebGL2 says so and offers the headsets only. Then **Play here** or **Send to VR-1** (`GET /api/mod/spatial/stations`) → `POST /api/mod/spatial/begin {guest, world, device, station?}`. The game streams `POST /api/spatial/pose` (10 Hz, house frame, session token) and ends with `POST /api/spatial/end`. The director can end a session with `POST /api/mod/spatial/end {session}`. Poses never touch the journal. A find the server keeps (the program is still captured after it: the banishment) shows **GERALD CAN'T HELP** on the tablet, the headset and the terminals, with no egg and no fanfare (wave 9; the found reply and the `found` frame carry `captured`). A find held by a director's pause keeps the player's session alive and lands on resume; the tablet's stream reopens by itself after a proxy 502. **A server restart (a crash or a redeploy) ends every session mid-walk**: the tablet or headset treats it as over, so scan the program's pass again and press **Play here** (or **Send to VR-1**). Finds already made are kept (`spatial-runs.jsonl`); a parked station assignment is lost, so send it again. |
| **Reinstallation games: the duck** | game → story | Walking up to Gerald posts `POST /api/spatial/found` (409 unless the last pose is within 2 m). The server commits, `by` the device, `signal("the simulation completed", guest)`, which releases a corrupted program, then `signal("the golden duck", guest)`, which grants *The Golden Duck* to anyone. Admin fallbacks: **Reinstallation: simulation completed** / **the golden duck**. **Wave 26 moments** (`POST /api/spatial/moment`, committed `by` the device; Anytime cues, off-sequence): **walked out into the void** (`simulation escape attempt`: −5 trust each time, `program.escapes`; Trabolta chastises them in the game only, before his reveal too), **reached Trabolta's heart** (`simulation heart reached`: once a night per program while he is awake, a short monologue in the game only, `program.sim_heart`), **picked up the floppy disk** (`simulation pickup taken`, args `item`, `prop`: the tent QR's codex entry). The escape and heart lines (*Escape Attempt*, *Heart In The Simulation*) never reach a phone, a booth or Run. Before a run starts, `POST /api/mod/spatial/begin` commits `signal("reinstallation begun", guest)` `by` the device (only because the story declares it), so a marked arrival begins captured. |
| **The house map** | director → games + screens | `house.json` (+ `house.shed.json`, the rain variant) are **project files**: `pnpm sync-show` pushes them with the story, a launch snapshots them, Push draft refreshes them. Served per event by `GET /api/spatial/house`. Edit it at **`/reinstall/map`**, which saves via `POST /api/mod/spatial/house {house, base}` (409 on a stale `base`); keep a save with `POST /api/mod/spatial/house/project` (Save to project). Tent ↔ shed: `POST /api/mod/spatial/variant {file: "house.shed.json"}`, mid-show too. Rooms map to LOCATIONs (the real house, 2026-10-15): on the **main floor** optical-drive (the mud room) → The Optical Drive, start-bar (kitchen) → The Start Bar, cpu (office) → The CPU, steam-room (bedroom / game room) → The Steam Room, desktop (living room) → The Desktop; in the **basement** ram (studio) → The RAM, fan-closet (laundry) → The Fan Closet, server-room (cold storage) → The Server Room, bathroom-1 → **Disk Cleanup**; on the **top floor** graphics-card (bedroom 2) → The Graphics Card, hard-drive (crawl space) → The Hard Drive, bathroom-2 → **Disk Cleanup**; hall, basement-hall and upstairs-hall (the hall and its two stairs) → The Tube; backyard → The Cloud; tent → The Internet. **Wave 14:** the layout is the floor plan the user drew in `/reinstall/map` (basement −2.7 m, main 0, top +2.8 m): the front door opens into the Optical Drive, which opens into the Desktop and on to the hall; the hall holds the upstairs and its back door, and the basement stairs come up in the kitchen (the Start Bar); the **tent is outside**, an indoor room in a corner of the backyard with its flap onto the lawn (the spawn, both VR mats and the `tent` terminal are in it); the Server Room is off the basement hall (patch bay and the server-room terminal inside, the keypad, the lock ring and (wave 11) the Server Door terminal outside its door, no duck); the Truth Pong table is in the yard; the Tube runs front door → mud room → living room → hall, and out the hall's back door across the yard to the tent flap. Twelve duck spots: every floor and the yard, never the tent, the Server Room or a hall, each at least 10 m of walking from the spawn. **Rain:** `house.shed.json` is the same map with The Internet in the shed at the back of the yard (room `shed`; same terminal ids, duck spots and LOCATIONs; the shed's two clues, `SITE-SCHEDULE` and `BUGDOM-VR`, move to The Optical Drive) — switch on the map page's project bar (Tent / Shed) or `POST /api/mod/spatial/variant {file: "house.shed.json"}`, mid-show too. Terminal spots: `optical-drive`, `start-bar`, `hall`, `desktop-tv` (the TV), `ram`, `bathroom-1-door` (in the studio, outside Bathroom 1's door, facing away from it, never inside), wave 14's `steam-room`, `cpu`, `graphics-card`, `upstairs-hall` and `backyard` (by the back door), `server-room` (wave 7: inside the Server Room on its south wall, facing in, on both variants; the server-room terminal), `server-room-door` (wave 11: "Server Door", in the basement hall facing the door, on both variants; the King's chess board), `tent` (the tent, or the shed). None is provisioned yet; a tablet that hangs elsewhere gets its spot moved on the map page. |
| **Terminals** | wall tablet ⇄ server | The [`terminal`](../../../terminal) app at `/terminal/`, a direct line to Trabolta. **Provision with `view=auto`**; it shows attract until Trabolta is revealed (Before the doors open, step 3): `/terminal/?code=<mod>&name=Kitchen&character=Trabolta&spot=start-bar&view=auto`. Since wave 7 a mod code lists the story's declared cast before the doors, so ⚙ checks `character` the moment it is set up. The server-room terminal adds `room=` (its own row above). `spot` is the terminal's id in `house.json`. `auto` shows the world view while someone is in the simulation and the face otherwise. A program holds up their pass; the terminal pilots them (`POST /api/mod/impersonate {role: "guest", id, label}`) into their own `dm:Trabolta`. Replies are spoken in the **device's own voice** (`speechSynthesis`; Fully Kiosk's JavaScript Interface on a WebView without it; text at reading pace on a voiceless device — never a stall). The server voice (`POST /api/mod/tts` → `LOOM_TTS_URL`, the compose `kokoro` service behind `--profile tts`) is opt-in and off by default. The line drops after 30 s without input. The mod feed tags terminal lines `via: "Terminal · <name>"` (the pilot's `label`); the same `label` on `POST /api/mod/signal` lets any mod-token device (the Server Door terminal's `chess won` / `chess lost` / `chess drawn`, `view=chess`, `spot=server-room-door`) sign the journal as itself — honoured only for the generic mod-token "Director", never over an author session's own name. Terminals poll the lean `GET /api/screen/state` every 2 s (attract, story screen cues, slides / overlays, the countdown, K-16/K-17), which doubles as their heartbeat: `GET /api/mod/screen/terminals` feeds the Run page's Terminals card. Announcements (wave 18b, Q8) are three-way per tablet: **House setting** (the default: the spot is on `audio.json` `announce.terminals`, the screen state's `spot: {announce}`) · Always (`&announce=1`) · Never (`&announce=0`, which pins it off whatever the house list says); the heartbeat's `ann=1|0` shows 📢 on Run → Terminals. |
| **Founded factions** (wave 18b, R4–R6) | guest phone → server → story | The header `founding: Night.truther_sent == true and Kernel.majority_reached != true and Night.clock != "00:00" and Night.ended != true and program.cleared == true and program.corrupted != true` switches on faction mode: one race between the founded factions (crews) and the joinable sides, one faction at a time. `POST /api/guest/crew/found {name}` founds (403 outside the window), `POST /api/guest/crew/join {crew}` walks in (6 a minute, then 429), a founder's `crew/leave` disbands (`{ok, dissolved: true}`); founders and side leaders stay put (409). `GuestView.canFound` / `leads`, `SideView.more` on your own row only, `ModView.race {needs, present, winner, factions}` for Run's glance. `majority: count([p for p in Persons where p.gone != true and p.persona != true]) / 2 + 1` is the line; the story's race rule latches `Kernel.majority_id` / `majority_name` / `majority_founder` (secret Kernel, never `Night.*`) and `settle_majority`. Race sides' membership paths never ride an agent request. |
| **Phones: the lobby, badges** (wave 18b) | story → phones | `lobby: hidden` takes the 📜 Chat log off every guest's phone (booths and Run keep it; a guest's `say` there answers 404; every lobby line still reaches them as a moment or a Notifications row). `badge: program.afk as 🚻 Bathroom Mode` puts 🚻 beside the name in every people list (never on a chat bubble; lint L1219 refuses a secret one). |
| **TV** | story → screens + voice | The TV above the fireplace is John's Windows Desktop's Chrome on the `tv` view (K-18): `/terminal/?code=<mod>&spot=desktop-tv` (the map spot sets the view; `scripts/house-desktop/tv-kiosk.ps1`). It shows Trabolta's face (the screensaver until the introduction, the VR world beside him while someone is in the Internet) and **speaks every `Trabolta:` line said in The Desktop** plus a director's `say` as Trabolta there; the song beats (`Song Ending`, `Sad Confession`, `The Hand Jive`) and Sandy are captioned only. Mute: `M` on the Desktop or `POST /api/mod/screen/voice {muted}` (kept in the event's `screen-voice.json`, so it survives a restart). The story records what it should show in `Night.screen`. **Results** (wave 18b, Q6): `do fact_read <ids>` (📋, 🧮) and `do fact_truth <id> <accurate|lie|none>` (⚖) publish `ScreenState.results`: on the TV the rows `[who, said, sure, out, ruled]` (≤ 40 + *more*; never the final round's before ⚖), on the walls the counts only; at ⚖ (O2) the TV alone also gets each question's key answer and the liars' names (built by the server's `screenResultsOf`, inside the verdict's 120 s window; never in a view, `Night.*` or an agent request). The night block adds `most_trusted` / `least_trusted` under `bobbing` and `facts_accepted` / `first_reinstall` under `recount` / `purgatory`. Anything else can watch the mod SSE feed (`GET /e/:id/events?role=mod`) for `captured` / `released` and `alert: true` broadcasts. |
| **Trabolta** | John's MacBook ⇄ server | Run stagehand's `agents` module: `cp stagehand/agents.example.yaml stagehand/laptop.yaml` (set `server.url`, `event`, `mod_passcode`), `ollama pull gpt-oss:20b tobestyledintro/qwen3.8-9b-distill:q8_0`, then `uv run stagehand run --config laptop.yaml`. The server sends every message to Trabolta as an agent request (`GET /api/agent/stream`) carrying the thread, the speaker's `them:` vars and the whitelisted `Night.*` facts. **`Kernel.*` never reaches him.** He answers with `POST /api/agent/reply {say, adjust}`. Powers fire as journaled signals. **Every filing that isn't an exact match** (wave 18b, O4: a near miss or a plain miss) comes as a `judge` frame on the same stream (`near` names the key it is close to, else null) and is answered at `POST /api/agent/judge {id, worker, same, why}`. The hub queues them: one frame out per worker, never while that worker owes a voice reply (guests' DMs go first), 60 s from dispatch, a stall after two expiries in a row (*⚖ Trabolta isn't ruling…* in `# hosts`); what is still queued at the round's settle falls back to the house rule. A round of ~45 programs × 3 questions is minutes of rulings at ≈ 3 s each (CHECKLIST SW-AI-23). His `why` never reaches a screen, and every house line of the reading beats (Question Results, Round Two Tally, The Verdict) stays out of his `recent`. `stagehand ask --config laptop.yaml --reflect` tunes voice and mind offline. |

**Staff visibility:** `# hosts` and `# quarantine` are **staff back-rooms,
not private between factions**. Every performer booth sees and can post in
every authored channel, and no guest can. Booth readouts (`reply` in a
character hook) are live-only: they are not kept across a booth reload and
they do not chime. (Since wave 13 there is no `# system-log`: a house-wide
broadcast posts once, in the lobby.) Never put a secret meant for one
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

### QR placements (the 94 coded entries)

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
| **Server-room door** | `COLD-STORAGE` · `HUMMING-WALL` · the keypad sign beside the keypad (from `generated/print-stacks.md`: four notes or the King, no QR, never the code) · the door terminal (the King's chess) |
| **The cold door's digit notes** (silver) | one per room, never the server room: `FOGGED-KETTLE` (The Start Bar) · `FROSTED-MIRROR` (The Graphics Card) · `WARM-LINT` (The Fan Closet) · `LOST-PIECE` (The Steam Room); the exact spots are in `generated/print-stacks.md` |

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
/ Pong orders and quests, the 21 coded files, the Bingo squares and the
fate lines. Wave 18b's new copy (the ties, The DSL Line, The Night In
Review and Your File, the founded-faction lines, Trabolta's reading lines,
the typed left-behind) was signed off on 2026-10-27 ([`SIGNOFF-w18b.md`](./history/SIGNOFF-w18b.md)).

Decisions that need sign-off (**all approved 2026-10-15**, with the
content list above; see [OCT31.md](./OCT31.md)):

1. The Trust Chart counts confident lies as accepted truths.
2. A lie is sticky per question. (Changed 2026-10-16, U14: the verdict
   counts answered questions only — a question nobody answered is not a
   lie. Wave 6, B11: a host's correction of the same filing takes that
   program's lie back.)
3. Leader tasks gate the majorities, with a director waiver. (Wave 18b,
   D13: gone. Any faction wins on half + 1; the tasks drive only the
   overshare, the quests and the recap.)
4. Only Excel's plant drives overshare scenarios 1 and 3.
5. The advice ending is reachable only after a failed verdict.
6. Combo B kills everyone, The Way Out included.
7. The server room stays live during the final reveal.
8. MS Paint is the anti-AI program (Cat's sheet must carry the prompt).
9. Guests' influence on Trabolta never changes a branch by itself.
10. Opening night runs with `lookup: false`.
11. Performers do not count toward majorities.

The wave 13 text was signed off on 2026-10-21 (`SIGNOFF-w13.md`; the
answers that changed things — Q1, Q2, Q3, Q16, Q21, Q26, Q30 — are wave 18).
**Wave 18's decisions and every new line are in
[`SIGNOFF-w18.md`](./SIGNOFF-w18.md)** (§1 Q1–Q60, §2 the show text, §8 the
app's own words), signed off on 2026-10-27.
**Wave 20's decisions (D1–D29), every heart line, the looks and the
persona's `outside:` list are in
[`SIGNOFF-w20.md`](./history/SIGNOFF-w20.md)**, signed off on 2026-10-27
(the looks are still retuned on site). So are waves 21, 26, 27 and 28
(`SIGNOFF-w21.md`, `SIGNOFF-w26.md`, `SIGNOFF-w27.md`, `SIGNOFF-w28.md`).

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
