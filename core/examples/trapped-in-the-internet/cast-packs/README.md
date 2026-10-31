# Cast paper: performer packs, crew cards, featured sheets (D-01)

Drafts for **Trapped in the Internet** (Sat Oct 31, 2026), written from
[`DESIGN.md`](../DESIGN.md), the [`README`](../README.md), the story files and
[`OCT31.md`](../OCT31.md) §9–§11. **These are drafts for you to edit.** Nothing
here is read by the server: `sync-example` only pushes `.loom` files.

Search for `[[EDIT` to find every blank the drafts could not fill (names,
addresses, codes, where things are kept).

## What is here

| File | For | Hand out |
|---|---|---|
| [`emergency-card.md`](./emergency-card.md) | everyone: posted at the door and on the back of every crew card | print batch 2 (10-26) |
| [`all-crew.md`](./all-crew.md) | everyone: radio call words, the performer basics, the blackout rule, the door FAQ | read-through 10-25 |
| [`patch-bay-watch.md`](./patch-bay-watch.md) | the Antivirus stationed in the server room (Tier 0 only) | 10-25, kept face-down |
| [`history.md`](./history.md) | nobody: the old running list of what the packs assumed, wave by wave (not instructions) | never |
| **Performers** (one pack each; the card on page 1 is the laminated one) | | read-through **10-25** |
| [`performers/clippy.md`](./performers/clippy.md) | Clippy (Brooke), incl. CI 1–9 cards, the answer key, the Bingo card, the bottle's truth questions | |
| [`performers/task-manager.md`](./performers/task-manager.md) | Task Manager (John) | |
| [`performers/adobe-acrobat.md`](./performers/adobe-acrobat.md) | Adobe Acrobat (Stephanie), incl. the truth.txt printout | |
| [`performers/recycling-bin.md`](./performers/recycling-bin.md) | Recycling Bin (Jesse), incl. the porch card | |
| [`performers/norton.md`](./performers/norton.md) | Norton Anti-Virus (Julie) | |
| [`performers/mcafee.md`](./performers/mcafee.md) | McAfee Anti-Virus ([[EDIT: cast by 10-18 or cut]]) | |
| [`performers/password-manager.md`](./performers/password-manager.md) | Password Manager (Francine) | |
| [`performers/cra-agent.md`](./performers/cra-agent.md) | CRA Agent Software (Emma) | |
| [`performers/installation-wizard.md`](./performers/installation-wizard.md) | the Installation Wizard (Julia — a voice, no booth), incl. the tent card | |
| **Crew** | | trained 10-25 |
| [`crew/director.md`](./crew/director.md) | the Director card (the Run console) + the show owner's day (John) | |
| [`crew/second-director.md`](./crew/second-director.md) | the second director (at Run all night) | |
| [`crew/tech-operator.md`](./crew/tech-operator.md) | the tech operator (at John's MacBook all night, looking after the four show computers) | |
| [`crew/house-manager.md`](./crew/house-manager.md) | the house manager (door after 20:30, safety lead) | |
| [`crew/trabolta-mind.md`](./crew/trabolta-mind.md) | Run → Mind + the tech operator: Trabolta's story mind (wave 12), what a quiet Mind page means, the switches, when to flip to classic | rehearsed 10-25 |
| **Featured guests** (one sheet each, for the invitee only) | | **[[EDIT: already sent with the invitations? If so these are reference copies — the invitations are the truth; the app's identity entries (`codex/5-people.loom`) and the red character facts (`facts.json`) were rewritten from them on 10-16, and every sheet's "Who you really are" / "Why you said yes" was rewritten from those entries the same day — re-read each against its invitation before any reprint]]** |
| [`featured/microsoft-excel.md`](./featured/microsoft-excel.md) · [`openoffice`](./featured/openoffice.md) · [`draftkings`](./featured/draftkings.md) · [`bugdom`](./featured/bugdom.md) · [`broken-ask-jeeves`](./featured/broken-ask-jeeves.md) · [`runescape`](./featured/runescape.md) · [`ms-paint`](./featured/ms-paint.md) · [`vlc`](./featured/vlc.md) · [`pong`](./featured/pong.md) | | |


## What the packs assume (master at wave 22, 2026-10-24)

The packs are written to **master**, which holds every wave up to 22. The VPS
still runs the release **`w18b-1021`**: waves 18b (Stage B), 19, 20, 20b, 21
and 22 are merged but **not shipped**. The user signed off the show text of
waves 13 through 28 on 2026-10-27, and the packs follow it. Wave 22's
patch-bay lines (`// DRAFT w22` in the story) have no sheet of their own.
Wave 32's talk scenes (`// DRAFT w32`, [`SIGNOFF-w32.md`](../SIGNOFF-w32.md))
ship as written before their sign-off: the Task Manager, Clippy and director
packs and the Mind card carry them (reprint those four).
The old wave-by-wave list is in [`history.md`](./history.md).

**The house and its computers**

- The app lives at **https://app.mapsandducks.com** (the editor at `/edit/`, the
  invite one-pager at the apex). Invitations are out.
- Four show computers (the tech operator's card has the details):

  | Computer | Runs |
  |---|---|
  | **John's MacBook** (macOS) | Ollama + Trabolta's worker (stagehand `agents`), the house speaker router (stagehand `audio`, the MOTU 828x + an ADAT expander), the show-night backups, a Run console |
  | **John's Desktop** (Windows) | the living-room TV (`view=tv`), the house broker (Mosquitto), Zigbee2MQTT, stagehand `show` + `lights` |
  | **Steph's laptop** | the server-room terminal (Trabolta's face, webcam, mouse, keyboard) + the Grand Central M4 on USB: the door sensor and the patch bay |
  | **John's old laptop** | the tent: its terminal, the reinstallation wizard and the web game in one |

  The router may move to the Desktop if the MOTU works there; the packs
  never depend on which. Wall tablets (Fully Kiosk), the Server Door chess
  terminal, the casino terminal, the Quest and the phones are the rest.
- The house announcements ("the house system" in the show) and every story
  sound play through the router. There is no QLab and no `alexa` player.
  ■ Stop house sounds (Run, a host's phone) fades them all.
- [[EDIT: confirm the house lights: the PAUTIX strips on a **WLED**
  controller (presets; the Tube gets a chase) and any Zigbee bulbs besides
  the server room's]]. The server room has one RGB bulb and no strip: it is
  the room's light and its safety light (never off, never under 80 / 254).
- **No hosted-model fallback** (decision #35): if Trabolta's worker dies, the
  server posts his hold line and **the directors answer his DMs by hand**.
- **House internet down → cues are fired by hand** (WLED presets, wall
  switches, the router from the MacBook). Phones fall back to cellular; the
  server is on the VPS, not in the house.

**Who calls, who plays**

- **Task Manager, Adobe Acrobat and the Recycling Bin are the hosts**
  (`admin: true`). Their booths carry the cue sheet in a **NEXT bar** (tap
  ARM, tap FIRE) and a console (Cues · Needs · Judge · People · More). Any
  host may call the show: **📣 I'll call** shows everyone who is calling, and
  a FIRE by someone else asks once (*Fire anyway?*). The directors call from
  Run → Director or the director phone.
- **Clippy and the four Antivirus (Norton, McAfee, Password Manager, CRA
  Agent Software) are players** (wave 21). Their booth is a **Mission** like
  a guest's (⊞ Start · Mission · Chats · 📷 Scan), with ⭐ Points and their
  stat tiles, only their own buttons and their own team room (`#
  quarantine` for the Antivirus; Clippy has none). **Clippy calls no cue**:
  the hosts and the directors fire Clippy's games, and Clippy's phone pops
  *YOUR GAME IS ON*.
- A scanned guest's card shows the facts, **at most three buttons** (the
  ones the live objectives name; a host also gets the ones live because of
  this guest) and what the press came to. There is no *All buttons…* fold.
- The Installation Wizard (Julia) is a voice in the tent, with no booth.
- Windows Defender is gone (wave 18): the four Antivirus share the door, and
  the first **🙋** on *🚪 X is waiting* takes the arrival.

**The night's machinery the packs lean on**

- A verdict **marks** a program and the mark hinders nothing: every
  Antivirus gets a **🚨 WANTED** pop-out and the program's poster on the
  **Wanted board**; one claims them, finds them and scans their pass (the
  **confrontation**: CORRUPTION DETECTED → 🛡 → CAPTURED). Walking into the
  tent captures a marked program too.
- The hunt questions, answers and the bottle's truths come from
  `facts.json`. The server judges every 📝 filing: an exact match at once,
  anything else by **Trabolta's judge** (*🤖 Trabolta ruled …*); a director
  overrides on Run → Mind → Judging.
- Truthcoin moves between Wallets, and CRA Agent Software approves or
  denies every third transaction (C16).
- The nine featured programs are 🔒 Reserved: each invitee joins from the QR
  on their invitation; a lost one gets the director's 🔓 for two minutes.
- **The server room.** The door has a real, standalone **keypad lock**
  (outside only; the inside handle always opens with no code; nothing in
  the show locks or unlocks it), and opening it is a clean entry, whoever
  does it. A program gets the code from the winning majority, from **four
  digit notes** hidden in four rooms, or by **checkmating the King** on the
  Server Door terminal outside (all night until 📄, no hints). The King
  also stands in both reinstallation games with **one health bar for the
  night** (15 points; each program may hit him once per visit).
- **The Heart.** The door sensor is a light across the frame, read by the
  M4. The first opening once Trabolta is awake plays The Heart, and he wants
  the door shut before anything goes on (press **🔧** before the crew go
  through). A pass at his screen starts a three-layer talk (mouse) or a heart
  to heart (keyboard). The talk ends nothing: he hears them out and the
  night goes on. A program he throws out is marked.
- **The patch bay judges itself** (wave 22): the same M4 reads its 16 jacks (8 live),
  and in the Y2K hour the story judges every complete patch about 5 s after
  the fourth cable. The Antivirus watch inside presses 🔌 / 💥 / ❌ only when
  the bay missed one; a press hands the bay to the buttons until the
  director presses 🔌 *Trust the patch bay again*. Only the patch bay
  alarms, on the **second** wrong combination. There is no ESP32.
- Buttons with no way back (🔌 💥 ❌ 🚪 🔧 ♟ 🍎 🫘 💘) **arm on the first
  tap and fire on the second**.
- Phones, booths, Run and the tablets reconnect by themselves after a
  server restart.

## Rules every sheet keeps

- **Actor names never appear in the story.** They appear on paper only (who a
  sheet is for). The featured programs never "speak" in the app; each guest
  speaks for themselves in person and in chat.
- **Secrets are need-to-know.** The answer key lives in `facts.json`; it is
  printed on Clippy's, Adobe's and the second director's packs only. The patch-bay
  combos are on no card but the patch-bay card (they are also in the show's
  runbook, `../README.md` section E, and in `../DESIGN.md`). The door
  code is in `facts.json` (`door.code`) and on the keypad, never on a card;
  the tech op and the house manager know it. A featured
  sheet holds only its own secret.
- Buttons that do nothing out of phase are normal (W-05). Only the un-phased
  buttons work any time: 🛡 **Send to the Internet** (on a marked program's
  card since wave 18, on every card while the patch-bay alarm is on, and on
  every card once the Bingo round is over), ✅ **Mark as
  reinstalled** (on a captured program's card), 🩹 **Unmark**, 🎀 ribbon, 🤝
  Vouch, 👁 watchlist, 🪙 Pay / Charge and ♟ They beat the machine; every
  verdict button is phase-gated. ✅ 👁 are the Antivirus' own (wave 13):
  no host's or Clippy's card shows them. 🛡 is the Antivirus' and the
  hosts' (wave 47: a host's capture earns no ⭐); never Clippy's.
- **Verdicts mark, Antivirus capture.** Every verdict (🎯 🤷 🙅 🎩 🏓 🍎,
  pressed by a host or by Clippy) marks a program for reinstallation. The mark hinders nothing (Q30): the
  program lights up on every Antivirus' Wanted board, one claims them, finds
  them and scans their pass (the confrontation), then presses 🛡 and walks
  them through the Tube.
- **Any host may call the show** (Q1): never "radio the director before you
  fire". 📣 shows who is calling; agree it at the read-through.


## The players in more detail (wave 21)

The user: *"Clippy should no longer be considered a "super" user / host that
can call shots. Clippy and the AntiViruses are performers that are playing a
game just like the "guests" are."*

- **Points:** Clippy for running the games (🎱 🎀 🎯 ✅ 😤 🤷 🗣 🙅 🎩 🏓 🍎 🖌 💘),
  the Antivirus for clearances, captures, releases, patch-bay calls, McAfee
  for 🤝 brokered deals, Password Manager for 🔑 password checks, CRA for each
  audit ruling. **Trust** (Trabolta's, hidden from them, on his chart as
  🛡 STAFF): serving him raises it, mercy in the open lowers it a little.
- **Whose side are you on?** From the Truther Download: **📢 defect openly**
  (a big moment to every phone; Trabolta answers on the TV and keeps them as
  allies; −50 trust) or **🤫 quiet favours** (🤫 look the other way on a
  claimed mark, tip a marked program off, let a guess slide, slip a program
  50 Truthcoin): private, never told to Trabolta; every third one he
  notices (−20 trust, a private warning, never removal).
- **Staff awards** after G10 / G9: 🛡 Trabolta's Favourite Staff, ⭐ Staff
  Player Of The Night, 🤫 The Mole (the last award; G11 waits for it).
- ✅ / 😤 judge one question at a time (🔢 picks it), so a card's three
  buttons cover every question.

## Print notes (for PAPER, batch 2 on 10-26)

- Each performer and crew file starts with a **Card** section: print that on
  one side of a half-letter sheet and laminate it; print the emergency card on
  the back. The rest of the file is the pack (read it once at home). Since
  wave 13 each booth's **NOW card** carries the same per-act job on the phone,
  so the laminated card is the backup, not the instructions.
- **Print now: the sign-off is done.** `../SIGNOFF-w13.md`, `-w18`, `-w21`,
  `-w26`, `-w27`, `-w28` and `../history/SIGNOFF-w18b.md`, `-w20` were all
  signed off on 2026-10-27 (any host calls the show, the Wanted board and
  the confrontation, the shared door, the self check-in, McAfee's line in
  the ticker; wave 21: the players, below). Reprint every pack that
  changed: `clippy`, `task-manager`, `norton`, `mcafee`,
  `password-manager`, `cra-agent`, `crew/director`,
  `performers/installation-wizard`, `featured/microsoft-excel`, and with
  them `adobe-acrobat`, `recycling-bin`, `all-crew` and `patch-bay-watch`
  (their printed DRAFT tags are gone).
- Clippy's CI 1–9 cards: one index card each (from the appendix of her pack).
- The Desktop's QR stacks: print the codex posters from Run → 🖨 Print sheet
  and sort them by colour into the piles `generated/print-stacks.md` lists
  (gold = the hunt answers, green, blue, red), each hidden where its row says.
- Adobe's truth.txt: print, then put it in a zip bag (it goes in the Bag of
  Truth, which goes in the bobbing tub).
- Task Manager's monologue: the appendix of his pack, printed, in his pocket
  for the night (the fallback if his phone goes down mid-read).
- If the story changes after 10-24 12:00 (content lock for batch 2), re-check
  the answer key against `facts.json` (`generated/print-stacks.md` is the
  printable table) and truth.txt against `beats/finale.loom`.
