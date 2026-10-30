---
title: The Language Filter
section: Live Shows
order: 55
keywords: filter, censor, censored, swear, swearing, curse, language, profanity, password manager, moderation, mark, awards, ceremony, report, G14
---

A story can give one part a language filter. In *Trapped in the
Internet* it is the Password Manager's: every line a guest types that
holds a swear word comes to her booth, and she decides what is censored.

## Turning it on

Name the part in the story's header:

```loom
censor: Password Manager
```

Without the line nothing is filtered. The part must be a declared
CHARACTER.

## What gets caught

Every line a guest types: rooms, DMs, private threads, crew and faction
rooms, the wall terminals' keyboards, and a director typing as a guest.
Never a host's, a performer's or a character's line, a menu pick or a card
answer.

A line is caught when any word in it holds a swear stem, anywhere inside
the word, so *password* is caught for "ass" and *hello* for "hell". That is
deliberate. Look-alikes count (`a$$`, `sh1t`) and so does a self-censored
`f*ck`. The stems are one list in `core/src/language-filter.ts`.

## In the booth

A caught line pops up as **🔑 LANGUAGE**: who, where, and the line with
the swear highlighted. More lines wait behind a **🔑 n** counter on the
tray, which opens the full list.

- **✂ Censor** (two taps) stars the swear out of that line on every phone,
  the TV and Run (`p***word`) and fires `swear_censored` for the program.
- **Let it go** hides it on that phone only.

## In the story

Two events, both fired by the server for the program who typed the line:

- `swear_flagged`, for each caught line: `words` (how many words were
  caught) and `list` (them, `"hello, password"`).
- `swear_censored`, for each ✂, with the censor as the actor: `words`,
  `list`, and `fresh` (the words nobody censored before tonight).

The show counts them (`lang_flagged`, `lang_censored`, `Night.lang_words`)
and marks the program for reinstallation (*censored: password*) while the
night is on and they are loose. After the ending a censor only counts.

## The report (G14)

**G14 · 🔑 The Language Report** is on the cue sheet in act G, after G13.
NEXT never suggests it: press it yourself between any two awards, from G1
until G11. The host reads who cursed the most (the most words caught; a
tie names everyone), how many words were censored out of every word the
filter caught, and every censored word. The TV and the walls show the
same. Press it again for the newest numbers. Under ✍ Trabolta's template
lines are skipped, as for an award.
