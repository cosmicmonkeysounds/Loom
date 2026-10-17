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
| [`crew/tech-operator.md`](./crew/tech-operator.md) | the tech operator (at the house Mac all night) | |
| [`crew/house-manager.md`](./crew/house-manager.md) | the house manager (door after 20:30, safety lead) | |
| **Featured guests** (one sheet each, for the invitee only) | | **[[EDIT: already sent with the invitations? If so these are reference copies — the invitations are the truth; the app's identity entries (`codex/5-people.loom`) and the red character facts (`facts.json`) were rewritten from them on 10-16, and every sheet's "Who you really are" / "Why you said yes" was rewritten from those entries the same day — re-read each against its invitation before any reprint]]** |
| [`featured/microsoft-excel.md`](./featured/microsoft-excel.md) · [`openoffice`](./featured/openoffice.md) · [`draftkings`](./featured/draftkings.md) · [`bugdom`](./featured/bugdom.md) · [`broken-ask-jeeves`](./featured/broken-ask-jeeves.md) · [`runescape`](./featured/runescape.md) · [`ms-paint`](./featured/ms-paint.md) · [`vlc`](./featured/vlc.md) · [`pong`](./featured/pong.md) | | |

## Facts these drafts assume (from 2026-10-15)

- The app lives at **https://app.mapsandducks.com** (the editor at `/edit/`, the
  invite one-pager at the apex). Invitations are out.
- **One house Mac** does everything local: it drives the TV over the long HDMI
  run (`view=tv`), plays room audio through the **MOTU** (ADAT), and runs
  Mosquitto, Zigbee2MQTT, stagehand `show` + `agents`, Ollama (48 GB: both
  models stay loaded, `OLLAMA_MAX_LOADED_MODELS=2`) and the house announcement player. Where
  OCT31 says "the TV computer" or "the Ollama laptop", read "the house Mac".
- The PAUTIX strips are addressable, on an off-the-shelf **WLED** controller
  (presets; the Tube gets a chase).
- **No hosted-model fallback** (decision #35): if Trabolta's worker dies, the
  server posts his hold line and **the directors answer his DMs by hand**.
- **House internet down → cues are fired by hand** (WLED presets, wall switches,
  QLab GO). Phones fall back to cellular; the server is on the VPS, not in the
  house.
- The Run tools the crew cards lean on — the cue sheet (Run → Director), 🔁
  Re-pair and ⏏ Release in the Inspector, the Terminals card, the 🖨 Print
  sheet, ♟ chess, the ceremony cues — shipped to the VPS as `w3-1015`
  (2026-10-15). Each has a device check under
  [`scripts/accept/`](../../../../scripts/accept) (OCT31.md §5). The 📝
  judging is wave 4 (next bullet).
- Meta developer mode is set up; whether the Quest runs in the tent is the
  K-30 call (Thu 10-22). Every tent line below works with or without it.
- **Wave 4 (2026-10-16) is in the working tree, not yet deployed:** the
  hunt questions, answers and the bottle's truth questions come from
  `facts.json` (DRAFT placeholders until the team replaces them; `pnpm
  --filter @loom/core titi:facts` regenerates the story and
  `generated/print-stacks.md`); the server judges every 📝 filing (the
  confidence slider, 1–100); the First Moment of Truth is ⏱ → 📋 per question
  → 🍾 the bottle; a host's verdict **marks** a program and the Antivirus
  escort them (`# quarantine`); Truthcoin moves from each program's Wallet
  (CRA approves every third transfer); Clippy and the Antivirus have Quest
  Logs in their booths; the Installation Wizard (Julia) is a voice, the tent
  is in the backyard through the tunnel; the King guards the server-room
  door on the tent tablet. Every pack below is written to that.
- **Wave 7 (2026-10-17), not yet deployed:** the server-room door has a real,
  standalone **keypad lock** (outside only; the inside handle always opens
  with no code; nothing in the show can lock or unlock it). A program gets
  the code by checkmating the King from the Y2K hour, by solving the riddle
  on the sign by the keypad, or with the winning majority. Opening the door
  is a clean entry, whoever does it: the door never alarms. The first opening
  from the Y2K hour plays **The Heart** (Trabolta speaks candidly from the
  server-room terminal on the wall, where a program can talk him down: 🕊).
  Only the patch bay alarms, on the **second** wrong combination. CRA
  approves or denies every third transaction (C16), everywhere. The code is
  never written on a card or said on the radio.

## Rules every sheet keeps

- **Actor names never appear in the story.** They appear on paper only (who a
  sheet is for). The featured programs never "speak" in the app; each guest
  speaks for themselves in person and in chat.
- **Secrets are need-to-know.** The answer key lives in `facts.json`; it is
  printed on Clippy's, Adobe's and the second director's packs only. The patch-bay
  combos are on the patch-bay card and in the show's runbook (`../README.md`,
  section E) only, never on any other card. The door
  code is in `facts.json` (`door.code`) and on the keypad, never on a card;
  the tech op and the house manager know it. A featured
  sheet holds only its own secret.
- Buttons that do nothing out of phase are normal (W-05). Only the un-phased
  buttons work any time: 🛡 **Send to the Internet**, ✅ **Mark as
  reinstalled**, 🩹 **Unmark**, 🎀 ribbon, 🤝 Vouch, 👁 watchlist, 🪙 Pay /
  Charge and ♟ They beat the machine; every verdict button is phase-gated.
- **Hosts mark, Antivirus capture.** Every host verdict (🎯 🤷 🙅 🎩 🏓 🍎)
  marks a program for reinstallation; an Antivirus walks them through the
  Tube and presses 🛡.

## Print notes (for PAPER, batch 2 on 10-26)

- Each performer and crew file starts with a **Card** section: print that on
  one side of a half-letter sheet and laminate it; print the emergency card on
  the back. The rest of the file is the pack (read it once at home).
- Clippy's CI 1–9 cards: one index card each (from the appendix of her pack).
- The Desktop's QR stacks: print the codex posters from Run → 🖨 Print sheet
  and sort them by colour into the piles `generated/print-stacks.md` lists
  (gold = the hunt answers, green, blue, red), each hidden where its row says.
- Adobe's truth.txt: print, then put it in a zip bag (it goes in the Bag of
  Truth, which goes in the bobbing tub).
- If the story changes after 10-24 12:00 (content lock for batch 2), re-check
  the answer key against `facts.json` (`generated/print-stacks.md` is the
  printable table) and truth.txt against `beats/finale.loom`.
