---
title: Running the Cold Lock — the chess door, from the director's chair
section: Live Shows
order: 38
keywords: chess, chess phone, cold lock, chess won, chess lost, chess drawn, beat the machine, server room, door, disarm, disarmed, window, 90 seconds, propped, propped door, alarm, latch, re-arm, rearm, re-lock, fallback, dead phone, honour, OP-12, Trapped in the Internet, runbook
---

*Trapped in the Internet* guards its server room with a phone taped to
the wall outside it: a chess game against a hard machine. Beat it after
the Y2K clock starts and the door is **disarmed for 90 seconds**, then it
locks itself again. This page is the director's side of it — what to
watch, and the two buttons that fix it when something goes wrong. How
the rules are written is in [live verbs](33-live-verbs.md) (*A button as
a fallback for a machine*).

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
   door is armed again."* A second win inside the window just starts
   the 90 seconds over.
4. **A loss or a draw** opens nothing. If the phone reports it, Trabolta
   gloats in The Server Room; no director action is needed.

After a faction wins the majority the room is unlocked anyway, so a
chess win does nothing; after an ending, nothing either. Pausing the
run freezes the window with the story clock.

Programs learn the rule from the **The Cold Lock** codex entry (a note
taped beside the phone), handed to every cleared program with The Y2K
Clock at the final round.

## The honour rule

On the night the phone runs the Lichess app, which can't tell the server
anything. So a person reports the win: a host or Antivirus who **saw
"checkmate" on the phone** opens the winner's card in their booth and
presses **♟ They beat the machine**. Nobody presses it on someone's word.
The phone sends no heartbeat either, so it never shows on the Terminals
card — the Antivirus stationed in the server room glances at it each act.

## The phone is dead (the manual fallback)

Run → **Director** → the cue sheet → **♟ Cold Lock: they beat the
machine (chess phone fallback)**. One click opens the same 90-second
window. It is an off-sequence cue, so the sheet ticks it but never marks
it LAST or suggests it as NEXT — firing it doesn't move your place in
the show. It needs no guest.

Use it when the phone died, froze or lost its game mid-mate and the
crew saw the win, or when the booth that should press ♟ is down.

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

- The chess phone is charged, plugged in, on Wi-Fi, the screen held
  awake, the computer set to the agreed level.
- On the bench (the K-27 check, with the real door reed): win once from
  the Y2K hour → two openings inside the 90 seconds stay silent, one
  after it alarms; then **🔒 re-lock + re-arm** clears it.
- Every host and Antivirus knows the honour rule and where ♟ is on a
  guest's card (the booth's ⚡ Actions on that guest).
- See [Run mode](43-run-mode.md) for the cue sheet itself.
