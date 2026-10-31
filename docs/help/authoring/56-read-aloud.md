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
