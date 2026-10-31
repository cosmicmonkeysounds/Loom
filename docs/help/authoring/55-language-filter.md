---
title: The Language Filter
section: Live Shows
order: 55
keywords: filter, censor, censored, swear, swearing, curse, language, profanity, slur, strength, slider, obscenity, password manager, moderation, suspicion, doubt, stars, awards, ceremony, report, G14
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

Only what a guest types and sends: rooms, DMs, private threads, crew and
faction rooms, the wall terminals' keyboards. Never a director typing as a
guest, a host's, a performer's or a character's line, a menu pick or a
card answer, and never an old line again.

The censor has a **strength** slider, 0–100% in steps of 5, starting at
100% (on her phone: ⊞ Start → 🔑 Filter strength; she is not told where).
Each band adds to the ones below it:

| Strength | Adds |
|---|---|
| 0% | slurs (whole words) |
| 10% | fuck in any form, cunt |
| 25% | shit, asshole, bitch, dick… and the explicit words |
| 50% | crap, balls, butt, ass, damn, bloody… |
| 60% | hell, heck, darn, frick, fart, poop… |
| 75% | a strong swear inside a bigger word (*Scunthorpe*, *cocktail*) |
| 90% | a mild one inside a word (*password*, *button*, *title*) |
| 100% | a soft one inside a word (*hello*, *check*, *shell*) |

Whole words (0–60%) go through the
[`obscenity`](https://github.com/jo3-l/obscenity) library, which sees
through look-alikes, leetspeak and stretched letters (`fuuuck`, `sh!t`,
`a$$hole`) and knows an innocent word. The buried bands are Loom's own, on
purpose over-eager. Lowering the strength hides waiting lines it no longer
catches; raising it shows them again. The lists live in
`core/src/language-filter.ts`.

**Slurs** are handled for you: with a `censor:` header, a slur is starred
before the line is even stored, so nobody (the room, Run, Trabolta, the
journal) ever sees it. The censor still gets the alert, as **[slur]**.

## In the booth

A caught line pops up as **🔑 LANGUAGE**: who, where, and the line with
each swear highlighted in its band's colour. More lines wait behind a
**🔑 n** counter on the tray, which opens the full list.

- **✂ Censor** (two taps) stars what the strength catches in that line on
  every phone, the TV and Run (`p***word`), pays the censor ⭐ and fires
  `swear_censored` for the program.
- **🛡 The part's own capture** (two taps), when the story gives it one: a
  performer button of theirs that sends a guest to the Internet. It shows
  only where the button's `while:` holds for that program, and never after
  the ending. It is the ordinary press, so the button's hook does the work,
  and the line stays, so ✂ Censor and Let it go still work on it. Nothing to
  write: a part with such a button gets it.
- **Let it go** hides it on that phone only.

**The ⭐ game.** A ✂ pays *points × multiplier*, rounded down. A word's
points come from its band (slur 12, 10% 8, 25% 5, 50% 3, 60% 2, the buried
bands 2 / 1 / 1). The multiplier is ×3 rested and drops a notch with each
✂ (×2, ×1.5, ×1, ×½, ×¼), climbing back a notch every 20 s.

## In the story

Three events, fired by the server:

- `swear_filter`, when the censor moves the slider: `level`, `was`.
- `swear_flagged`, for each caught line, for the program who typed it:
  `words` (how many words were caught at the strength of the time),
  `list` (them, `"hello, password"`; a slur is `[slur]`), `level`.
- `swear_censored`, for each ✂, with the censor as the actor: `words`,
  `list`, `fresh` (words nobody censored before tonight, never a slur),
  `unsaid` (slurs), `points`, `mult`, `stars`, `top` (the five words
  censored most tonight) and `distinct` (how many different words).

The show counts them (`lang_flagged`, `lang_censored`, `Night.lang_top`,
`lang_distinct`, `lang_unsaid`, `lang_stars`, `lang_level`), pays her the
`stars` and raises the program's suspicion (`doubt` +5, up to 100). The
program gets an automated notice. Censoring marks nobody for
reinstallation. After the ending a censor counts but pays nothing.

## The report (G14)

**G14 · 🔑 The Language Report** is on the cue sheet in act G, after G13.
NEXT never suggests it: press it yourself between any two awards, from G1
until G11. The host reads who cursed the most (the most words caught; a
tie names everyone), how many words were censored out of every word the
filter caught, the five words censored most, how many words they will not
say (slurs), her ⭐ and where she left the slider. The TV and the walls
then let every censored word out at once, the most censored biggest
(slurs as black bars). Press it again for the newest numbers. Under ✍
Trabolta's template lines are skipped, as for an award.
