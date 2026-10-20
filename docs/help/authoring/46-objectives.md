---
title: Objectives — what to do now
section: Live Shows
order: 46
keywords: OBJECTIVE, objective, objectives, now, now bar, now card, title bar, checklist, to-do, done when, for, while, act, title, text, brief, buttons, pass, scan, loud, face, card, booth, guests, performers, everyone, L1207, L1208, L1209
---

An **objective** is what one phone should be doing right now. The
participant app shows the first live one as **NOW**: the title bar on a
guest's phone (*▣ NOW: Show your pass to an Antivirus ›*, tap for the
card), and the card pinned at the top of a performer's booth, with its
checklist. Its buttons lead the screen: the guest's NOW card, and the
**face** of a scanned guest's card in a booth (at most three; everything
else folds under *All buttons…*).

```loom
OBJECTIVE Show Your Pass
  for: Guest
  while: guest.uploaded == true and guest.cleared != true
  act: Doors
  title: Show your pass at the door
  text:
    Wait by the door with your pass on screen, bright. A host scans it
    and lets you in.
    - Uploaded, done when guest.uploaded == true
    - Scanned at the door, done when guest.cleared == true
  buttons: pass
  loud: true

OBJECTIVE Door Duty
  for: Ivo Marsh, Mara Vell
  while: Night.doors_open == true
  title: Scan every pass at the door
  text:
    Greet them, scan them, send them to the Long Table.
    - Wave the latecomers in
  buttons: scan, wave in
```

| Key | Means |
|---|---|
| `for:` | who sees it (required): `guests`, `performers`, `everyone`, a ROLE, a CHARACTER or a GROUP, comma-separated |
| `while:` | when it is live (a condition); absent = always |
| `act:` | a label, display only (a booth's tray shows it: *Doors*, *Act B*) |
| `title:` | the one line people read; default the name |
| `text:` | the brief (re-flowed prose); its `- ` lines are the checklist (`brief:` works too) |
| `buttons:` | INTERACTION names, plus `pass` (the full-screen pass) and `scan` (the scanner) |
| `loud: true` | going live interrupts that phone once |

## Who sees it

Each `for:` name is read, first match wins, as a reserved word, a ROLE,
a CHARACTER, then a GROUP.

- **A guest** sees it for `guests`, their ROLE, or a GROUP they belong
  to (never a hidden group the story hasn't revealed). Its conditions
  read the guest (`guest.…`, or the ROLE's own name) and the world
  (`Night.…`).
- **A booth** sees it for `performers`, its character, or the
  character's GROUP — so `for: Hosts` reaches every host. Its conditions
  read the world and `self.…` (the character). A `guest.…` path in a
  booth objective reads nothing: a booth objective is the same for every
  guest it scans. Put per-guest rightness on each button's own `while:`
  ([Live verbs](live-verbs.md)).
- `everyone` is both.

## Order is the rule

For each viewer the **first live objective in model order** (file order,
the first file first) is NOW; the others wait behind it (*+1 objective*).
So write the urgent ones first in each audience (a guest who has been
marked is told where to go before anything else), and end every
audience with a fallback with no `while:`, so a phone always has
something to do from the door to the end of the night.

## The checklist

A `- ` line inside `text:` is a to-do. `, done when <condition>` makes
the story tick it (read like `while:`, for the same viewer); with no
condition it is a box a performer ticks by hand on their own phone, and
on a guest's phone it stays open. Write a `done when` wherever the story
can know. Text is literal: no `{…}` in an objective.

## Buttons

`buttons:` names what the objective needs pressed, in order. Each viewer
keeps only what they could press anyway: a guest the `who: guest`
buttons on offer to them, a booth its `who: performer` buttons (another
character's `by:` button only when the booth may press it). `pass` and
`scan` are always kept: on a guest's NOW card they read **Show my pass**
and **Scan a code**, and the taskbar's Pass or Scan blinks. The apps
show at most three story buttons per objective.

On a booth's guest card the face fills from every live objective in
order, NOW first, until it has three buttons this guest can take; then
come the buttons whose `while:` reads the guest.

## Loud

`loud: true` makes the objective a **major moment** the first time it
goes live for a phone: on a guest's it flashes the NOW bar open with its
brief, and at a modal alert level it takes the screen with a way to act
(*Show my pass* for a pass objective). Use it only where nothing else
from the same moment already interrupts: an `!` alert and a loud
objective together are two pop-ups for one beat.

## What it never does

Objectives are display only. They are computed from the world on every
view, never journaled, never cached across a change, and never sent to
an agent-voiced character's worker. Run → Inspector lists a
participant's live objectives ([Run mode](run-mode.md)).

## The lints

| Code | When |
|---|---|
| `L1207 ObjectiveForUnresolved` | a `for:` name is no reserved word, ROLE, CHARACTER or GROUP (a warning), or none resolves or `for:` is missing (an error: nobody ever sees it) |
| `L1208 ObjectiveButtonUnresolved` | a `buttons:` name is no INTERACTION (nor `pass` / `scan`); a `who: admin` or `who: agent` button; a button for an audience the objective doesn't have; more than three story buttons (warnings) |
| `L1209 ObjectiveConditionInvalid` | a `while:` or a `done when` is empty or doesn't parse (an error: never live, never ticks) |
