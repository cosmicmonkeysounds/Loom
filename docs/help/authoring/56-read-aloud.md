---
title: Lines Read Out Loud
section: Live Shows
order: 56
keywords: aloud, read aloud, read out loud, teleprompter, prompter, script, speech, sides, performer lines, bobber, L1227
---

Some lines in a live show are spoken by a real person in the room. Mark
those beats, and the person's phone becomes their script.

## Marking a beat

Add `aloud:` under the beat's opener, beside `setting:`:

```loom
== Bobbing For Truth
  setting: The Desktop
  cast: Clippy
  aloud: Clippy
Clippy (dejectedly): This is the final Truth Game of the night.
```

Name every part that reads, separated by commas. Each one reads their own
lines, and sees everyone else's as small cues:

```loom
  aloud: Clippy, Task Manager, Adobe Acrobat, Recycling Bin
```

A program can read too. Put the variable holding its name in braces, and
that program reads the beat's narration:

```loom
== Truth Txt
  setting: The Desktop
  aloud: {Night.bobber}
Narrator: This file is the truth.
```

A part must be a character a performer can sign in as, or the story check
reports `L1227`. A `{…}` is read when the line plays, so a name that matches
no program reads as nobody.

## What the reader sees

A full-screen **📜 READ THIS OUT LOUD** that sounds until it is tapped and
can't be closed. It leads to a teleprompter with variable speed, a strip that
previews a line and jumps to it, and a list of sections. It stays until the
reader presses **✓ Done**, and comes back for the next marked line.

Everyone else's phones are unchanged: the lines land in the room as usual.
Only lines spoken in a room are marked. A line addressed to one program stays
a private message.

## Lines the TV says

A beat with a reader's lines and an agent character's lines in it waits for the
reader. The whole beat lands at once, with its cues and branches, but the TV holds
his lines back until the teleprompter's arrow reaches them. Then he says them, the
teleprompter locks and scrolls through them, and it frees when he has finished, or
after the time the words take if the TV is dead or muted.

Nothing here can hang the night. With no reader on their phone the beat plays as it
would without the mark, and a host (**▶ Let him speak** on Show), a director (the same
button on the director phone and at the top of Run's Director page) can let his lines
go at any time. His next scripted line in that room lets them go too: the held ones
play first, then it, so a later beat is never lost behind a reader who stopped.

A beat can hand over by itself: in *Trapped in the Internet*, Clippy's paragraph
about Trabolta fires his entrance when her arrow passes her last line, or she
presses **✓ Done**. The cue's button stays as the backup.

## Other people's lines

Anyone else with a line in a marked beat, but not named in `aloud:`, gets a small
card with their line, and can join the teleprompter from it. It never takes their
phone over. Name a part in `aloud:` only if they should get the whole script.

Everyone in the scene shares one place in the script: anyone can move it, and whoever
is pressing it has it until they let go. Hosts can join from Show.

## A long read, and keeping it off the other phones

*Trapped in the Internet*'s monologue is 14 minutes at the teleprompter, read by
a part after the night's bad endings (`beats/truth.loom`). What makes that work:

- **Give the lines to the part**, `Task Manager: …`, under `aloud: Task Manager`.
  Narration under a part's `aloud:` reaches nobody.
- **Put the beat in a hidden room with no check-in**, `hidden: true` and
  `checkin: false`, so guests' Chats don't list it and the print sheet makes no
  sign for it. Their phones still receive the lines; the room just never shows.
- **Nothing waits for a reader.** A beat is instantaneous, so gate what comes next
  on a director's cue: set a time when the read should be over and let the cue
  ask first until then.
- **A phone reloaded late** shows what landed in the last 20 story-minutes
  (`ALOUD_WINDOW_MS`), which outlasts this read. Older lines are in ≡ Jump.
- **Nothing warns you if nobody holds the part.** Keep a printed copy and a way to
  hand the read to someone else.

## Choosing what to mark

Mark speeches and read-outs. The pop-up takes over the phone, so leave a quick
reaction unmarked if the reader may be busy on their phone at that moment,
judging or scanning. A beat where the reader ends up saying nothing raises
nothing, so one beat can serve two hosts:

```loom
if Night.ceremony_host == "Clippy":
  Clippy: The report lists {Night.award_winner}.
else:
  Trabolta: Come and take your trophy.
```
