---
title: Running the server room — the keypad door, the King and Trabolta's heart
section: Live Shows
order: 38
keywords: server room, keypad, keypad lock, door code, code, riddle, cold door, the King, king, chess, chess piece, health bar, hit, challenge, tent tablet, simulation, chess phone, chess won, chess lost, chess drawn, beat the machine, door, door contact, cutscene, The Heart, heart, server-room terminal, terminal, talk down, talked down, stand down, Fallout, Master, patch bay, alarm, wrong combination, reset, latch, fallback, dead phone, honour, OP-12, Trapped in the Internet, runbook, cold lock
---

In *Trapped in the Internet* Trabolta's heart — a video patch bay — sits
behind the **server-room door**, and that door has a real **keypad
lock**. Whoever opens it with the code gets in, whoever they are; nobody
is "breaking in". This page is the director's side of the room: how a
program gets the code, what happens when the door opens, the terminal
where a program can talk Trabolta down, the patch-bay alarm, and the
buttons that fix each of them. How the rules are written is in [live
verbs](33-live-verbs.md) (*A button as a fallback for a machine*); the
map side is in [the house map](39-house-map.md).

## The keypad and the code

The lock is **standalone**: its code is set by hand on the lock and it
talks to nothing. No cue, no sensor, no button in Run can lock or unlock
it. From inside, the handle always opens with no code.

The code lives in one place, the project's `facts.json` (`door.code`).
`pnpm --filter @loom/core titi:facts` writes it into the story's secret
state (`Kernel.door_code`) and into a secret codex entry, *The Door
Code*, and prints the keypad sign (the riddle, never the number) into
`generated/print-stacks.md`. To change it: edit `facts.json`,
regenerate, sync, and **reprogram the keypad by hand**. Never say it on
the radio.

A program learns it one of three ways:

1. **The riddle.** The sign by the keypad, and *The Cold Door* in every
   cleared program's Codex at the final round, say *"FOUR DIGITS. THE
   DOOR REMEMBERS THE YEAR HE MET HER."* The lore holds the answer for
   anyone who reads closely.
2. **Beat the King** at chess, from the Y2K clock (below).
3. **Win the majority.** Every member of the winning faction gets *The
   Door Code* last in their Whole Truth.

*The Door Code* and *The Cold Door* are `secret: true`, like the
patch sheets and the Legendary Fact: Trabolta's models never see them,
and no file he holds carries the year (*The Sandy File* says only
"late-nineties"; the '97 clues are on guest-only papers like Page 999).
He can still be told it: a program may type the code or a combination
to him. His worker never writes one into his memory (which every
conversation reads) and never lets him say one — the mind file's
`secrets.never`, generated from `facts.json` and the story's combos
(`titi:facts`) — so what one program types never reaches another's.

## The King, on the tablet

1. The program plays the simulation on the **tent tablet** (the King
   is never fought in a headset: VR shows him and says *"The King is
   fought on the tent tablet."*). He stands in the basement hall, in the
   server-room doorway of the simulation, which is drawn shut behind
   him — the chevrons never lead there; the duck is elsewhere.
2. Up close and facing him, **⚔ HIT** (or **Space**) lands one blow
   every 2 seconds. The bar under the HUD counts him down — *at full
   strength* → *rattled* → *reeling* → *dizzy* → *PAWNS ONLY* (the
   map's `hp`: eight on the show's maps, two blows a stage, about 16
   seconds of hitting in all; four by default). Each stage is a weaker
   chess machine, down to a king with nothing but his eight pawns.
3. **♟ CHALLENGE** (or **C**) opens the board. A badge on it reads
   **FOR THE CODE** from the Y2K hour and **PRACTICE** before it (the
   map's `armed:` reads `Night.step`), with a line under it saying what
   a checkmate wins. Checkmate fells him — *"CHECKMATE — the King
   falls."* — the door in the simulation opens, and the tablet posts
   `chess won` for that program, journaled as the tablet's doing. Once
   it lands the tablet says *"The server-room door code is in your
   phone's Codex."* or *"A practice win: the King guards nothing real
   until the Y2K clock."* A loss (*"THE KING WINS. AGAIN."*) or a draw
   (*"STALEMATE. AGAIN."* / *"DRAW. AGAIN."*) wins nothing: the tablet
   reports `chess lost` / `chess drawn`, and the board **stays open**
   with a fresh game at the same strength (a stuck pawns-only stalemate
   never strands the program). **Give up** closes the board — then more
   hits make him weaker before the next challenge; a re-dealt board
   says so.
4. The fight is **per session**: the next program who scans their pass
   meets him at full strength again. The story, not the game, decides
   what a win is worth.
5. If the win can't reach the server (Wi-Fi down for more than about
   15 seconds, or under a minute on a connection that hangs), the
   tablet says *"The win didn't reach the house: tell a host (♟)."* —
   press ♟ for them. **Once that notice shows, only ♟ hands over the
   code**: the tablet has forgotten the win, and reloading it sends
   nothing. A reload re-sends a win only when the page died while it
   was still being sent (before any notice), within 60 seconds of the
   checkmate. A practice win that never landed says nothing: there was
   nothing to hand over.

## What a chess result does

- **Before the Y2K clock** a win is practice. `# hosts` says *"♟ A chess
  win before the Y2K hour is practice only: no door code."*
- **From the Y2K clock on**, a win puts *The Door Code* in the winner's
  Codex, with a private line on their phone, and `# hosts` says *"♟ X
  beat the King: the door code is in their Codex."* A second win (a ♟
  after the tablet's own post, a late retry, a winner playing again)
  changes nothing but a `# hosts` note.
- **A loss or a draw** wins nothing. `# hosts` gets a readout every time,
  and Trabolta gloats on the TV in The Desktop at most once every five
  minutes (losses and draws share the window), and never from the final
  reveal. No director action is needed.
- After an ending, nothing at all.

## The chess phone (the fallback until the King is device-checked)

A phone taped to the wall outside the server room still runs the
Lichess app, which can't tell the server anything. If the tablet is
down, a person reports the win: a host or Antivirus who **saw
"checkmate" on the phone** opens the winner's card in their booth and
presses **♟ They beat the machine**. Nobody presses it on someone's
word. The phone sends no heartbeat, so it never shows on the Terminals
card — the Antivirus stationed in the server room glances at it each
act.

## Nothing reported it (the manual fallback)

Run → **Director** → the cue sheet → **♟ They beat the King: the door
code (fallback)**, **naming the winner** (the cue asks who). It is an
off-sequence cue, so the sheet ticks it but never marks it LAST or
suggests it as NEXT. Fired with nobody named it only reminds `# hosts`
to press ♟ on the winner's card.

## The door opens: The Heart

A door contact (two wire loops that touch when the door opens) tells
the story `server_door_opened`. It can't say who opened it, and an exit
counts as much as an entry. **The door never raises an alarm.**

- **Before the Y2K clock** the door is just a door: `# hosts` hears of
  it and nothing happens.
- **From the Y2K clock**, the first opening plays **The Heart**: The
  Server Room appears on every phone, the server-room lights come up
  (not while the patch-bay alarm is going), `# hosts` reads *"🚪 The
  server-room door opened. The Heart plays on the server-room
  terminal."*, and Trabolta speaks to the room — candidly, for once.
- **Another opening within two minutes of the last** (the group filing
  in, someone stepping out) does nothing. A later one gets a short
  *"Back again"* line.

If the door opened and nothing happened (a loop came loose: a broken
contact is silent), fire **🚪 Server room door opened** from the cue
sheet. It is the same signal.

## The server-room terminal: talking him down

A wall terminal hangs inside the room, provisioned with
`room=The Server Room` (the kiosk runbook, `docs/trapped/kiosk.md`, has
the provisioning link).
It sleeps on its screensaver until the room is open to everyone — The
Heart or the alarm opens it; the majority's private reveal does not —
then wakes, speaks Trabolta's lines in that room aloud, and works like
any terminal: a program holds up their pass and talks to him on their
own thread.

While they do, the story knows they are **at his heart**
(`program.at_the_heart`; the terminal tells it when the visit starts and
ends, and any ending clears it). There is one server-room terminal, so
the next pass scanned there takes over: whoever was at his heart before
is not any more, even if their visit's close was lost to the Wi-Fi (the
terminal also re-sends a close that didn't land, before its next line
and on its next boot). There, from the Y2K clock, Trabolta
drops the act — like the Master in *Fallout*: he admits the patch bay is
his heart, admits he doesn't know the combinations or the code, and says
what he wants and why.

A program who **shows him that what he wants is impossible** can talk
him down. He then fires his `stand_down` power — but it only **offers**:
the story checks the evidence itself (the program must hold *What Sandy
Says* or *The Sandy File*, and not because Trabolta shared it with them:
a proof he hands over never counts), and on success `# hosts` gets an alert,
*"🕊 Trabolta offers to stand down for X. Press 🕊 to end it."* Every
refusal is words only and spends nothing; he offers once a night, and
after that only says he has offered (🔄 does not clear an offer; 🕊 works
whenever you decide).

**🕊 Trabolta stands down (talked down)** is yours to press. It ends the
night the Combo A way, without a cable: the blackout, the dance, and a
recount and awards that say who talked him down. Pressed with no offer
on record it still works — the director's call — and `# hosts` says so.

## The patch bay and its alarm

Only the patch bay alarms. **Everyone is forgiven one wrong
combination; the second trips the alarm** — the siren, the alarm look,
every phone's alert, and every Antivirus booth: *"Server room alarm: a
second wrong combination at the patch bay. Get there. Whoever is at the
cables goes to the Internet."* The alarm latches for two minutes; only
the first of the night costs Trabolta. Before the Y2K clock the bay,
combos included, does nothing.

**🔄 Server room: reset the patch-bay alarm** (after a rehearsal, or a
wrong patch the crew forgave) clears the wrong-combination count (the
bay forgives one again), the alarm latch and The Heart (the next opening
from the Y2K clock plays it again). The lights stay as they are —
**💡 Restore the house lights** brings them back. It never touches the
keypad.

## When the keypad itself fails

A dead battery or a jam: the house manager has the override key and
spare batteries. Open it with the key, prop the door, and fire **🚪** if
The Heart has not played. A wrong code typed at the keypad is not a
fault — it's the riddle.

## Crew and the door after the Y2K clock

The contact can't tell crew from guests: **from 🕚 the first opening of
the night plays The Heart**, to whoever is there, and opens The Server
Room on every phone. So:

- The **patch-bay watch** goes in **before 🕚** and shuts the door, and
  stays in until guests have come in. Leaving before then would play The
  Heart to an empty room.
- **No crew opening between 🕚 and the first guest's.** The tech op
  visits the router / UPS / IP sheet before 🕚, or waits.
- A crew member who must come back in after The Heart has played gets
  the **house manager** (the override key, or the code at the keypad —
  never on the radio); that opening is just *back again*, or nothing
  within two minutes of the last.
- If a crew opening played The Heart anyway, **🔄** re-arms it for the
  guests' first opening — but the room is already on every phone.

## Before the doors open

- The keypad opens from outside with the code from `facts.json`
  (tested at 15:00), and from inside with the handle and no code — try
  it with the batteries out. The sign is taped beside it.
- The door contact reads open and shut in the stagehand log.
- The server-room terminal is green on the Terminals card and asleep.
- On the tent tablet: walk to the King, hit him to *PAWNS ONLY*,
  challenge, mate — the badge reads PRACTICE and `# hosts` says
  *practice only* before the Y2K hour.
- The chess phone is charged, plugged in, on Wi-Fi, the screen held
  awake, the computer set to the agreed level.
- On the bench (the K-27 check): a win from the Y2K hour gives the
  code; the door plays The Heart once, stays quiet for two minutes, then
  says *back again*; two wrong combinations alarm; **🔄 reset** clears
  it.
- Every host and Antivirus knows the honour rule and where ♟ is on a
  guest's card (the booth's ⚡ Actions on that guest).
- See [Run mode](43-run-mode.md) for the cue sheet itself.
