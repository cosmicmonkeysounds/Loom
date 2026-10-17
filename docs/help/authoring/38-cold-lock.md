---
title: Running the Cold Lock — the chess door, from the director's chair
section: Live Shows
order: 38
keywords: chess, the King, king, chess piece, health bar, hit, challenge, tent tablet, simulation, chess phone, cold lock, chess won, chess lost, chess drawn, beat the machine, server room, door, disarm, disarmed, window, 90 seconds, propped, propped door, alarm, latch, re-arm, rearm, re-lock, fallback, dead phone, honour, OP-12, Trapped in the Internet, runbook
---

*Trapped in the Internet* guards its server room with **the King**: a
tall golden chess piece standing in the server-room doorway of the
**simulation** (the house map's `king` prop, guarding that door), with
a health bar. A program on the tent tablet walks up and hits him; every
hit makes the chess machine behind him dumber; beat him at chess and
the door in the simulation opens and the tablet tells the story `chess
won`. After the Y2K clock starts, that win **disarms the real door for
90 seconds**, then it locks itself again. This page is the director's
side of it — what to watch, and the two buttons that fix it when
something goes wrong. How the rules are written is in [live
verbs](33-live-verbs.md) (*A button as a fallback for a machine*); the
map side is in [the house map](39-house-map.md).

## The King, on the tablet

1. The program plays the simulation on the **tent tablet** (the King
   is never fought in a headset: VR shows him and says *"The King is
   fought on the tent tablet."*; the door he guards stays shut there).
   He stands in the basement hall, in the server-room doorway, which is
   drawn shut behind him — the chevrons never lead there; the duck is
   elsewhere.
2. Up close and facing him, **⚔ HIT** (or **Space**) lands one blow
   every 2 seconds. The bar under the HUD counts him down — *at full
   strength* → *rattled* → *reeling* → *dizzy* → *PAWNS ONLY* (the
   map's `hp`: eight on the show's maps, two blows a stage, about 16
   seconds of hitting in all; four by default). Each stage is a weaker chess machine,
   down to a king with nothing but his eight pawns.
3. **♟ CHALLENGE** (or **C**) opens the board. Checkmate fells him —
   *"CHECKMATE — the door opens."* — the door in the simulation opens,
   and the tablet posts `chess won` for that program, journaled as the
   tablet's doing. A loss (*"The King holds. Hit him again."*) or a
   draw changes nothing, and the tablet reports `chess lost` / `chess
   drawn` so Trabolta can gloat.
4. The fight is **per session**: the next program who scans their pass
   meets him at full strength again. The ladder can be run in seconds
   by someone who knows it; the story, not the game, decides what a
   win is worth.
5. If the win can't reach the server (Wi-Fi down for more than about
   15 seconds, or under a minute on a connection that hangs), the tablet says *"The win didn't reach the house: tell
   a host (♟)."* — press ♟ for them. A tablet reloaded within 60
   seconds of the checkmate sends the win once on its own; after that
   it is dropped, so a late win never unlocks the real door.

A badge on the board says whether the win is **ARMED** or **PRACTICE**
(the map's `armed:` reads `Night.step`): before the Y2K hour the
simulation's door still opens — that is the game's reward — but the
real door does not.

## What happens, in order

1. **Before the Y2K clock** a win is practice. `# hosts` says *"♟ A chess
   win before the Y2K hour is practice only."* and nothing opens.
2. **From the Y2K clock on**, while the room is still locked, a win opens
   the window: the door ring turns green, the server-room lights come
   up, any alarm still ringing stops (the screens drop the alarm
   overlay), and `# hosts` says *"♟ Cold Lock open: the server-room door
   is disarmed for 90 seconds."*
3. **90 seconds later** the door locks again, the lights go back to the
   Y2K look, and `# hosts` says *"♟ Cold Lock closed: the server-room
   door is armed again."* A second win inside the window (a ♟
   after the tablet's own post, or a late retry) changes nothing: the
   90 seconds keep running and `# hosts` says *"♟ The Cold Lock is
   already open: nothing changed."*
4. **A loss or a draw** opens nothing. If the tablet reports it,
   Trabolta gloats on the TV in The Desktop (the crew get a readout in
   `# hosts`); no director action is needed.

After a faction wins the majority the room is unlocked anyway, so a
chess win does nothing; after an ending, nothing either. Pausing the
run freezes the window with the story clock.

Programs learn the rule from the **The Cold Lock** codex entry, handed
to every cleared program with The Y2K Clock at the final round.

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

Run → **Director** → the cue sheet → **♟ Cold Lock: they beat the King
(fallback)**. One click opens the same 90-second window. It is an
off-sequence cue, so the sheet ticks it but never marks it LAST or
suggests it as NEXT — firing it doesn't move your place in the show.
It needs no guest.

Use it when the tablet lost its connection mid-mate, the phone died or
froze and the crew saw the win, or when the booth that should press ♟
is down.

## A propped door

The door sensor keeps reporting "open" for as long as the door stands
open. Inside the window that is fine. **Once the window closes, the next
report from a door still standing open trips the alarm** — latched for
two minutes, and the first alarm of the night costs Trabolta. So the
server-room watch closes the door behind the group (*"Close the cold
door behind you"*, as the note says).

If the door was propped by the crew rather than a guest (setting up,
a rehearsal, an early unlock left over), fix it from the cue sheet:
**🔒 Server room: re-lock + re-arm** locks the room, clears the alarm
latch and closes any open chess window. The lights stay as they are —
**💡 Restore the house lights** brings them back. To let people in for
good, **🔓 Server room: unlock (override)** — after that the door never
alarms again.

## Before the doors open

- On the tent tablet: walk to the King, hit him to *PAWNS ONLY*,
  challenge, mate — `# hosts` says *practice only* before the Y2K hour.
  The server must be the one that knows `king` props (an older
  `validateHouse` refuses the map).
- The chess phone is charged, plugged in, on Wi-Fi, the screen held
  awake, the computer set to the agreed level.
- On the bench (the K-27 check, with the real door reed): win once from
  the Y2K hour → two openings inside the 90 seconds stay silent, one
  after it alarms; then **🔒 re-lock + re-arm** clears it.
- Every host and Antivirus knows the honour rule and where ♟ is on a
  guest's card (the booth's ⚡ Actions on that guest).
- See [Run mode](43-run-mode.md) for the cue sheet itself.
