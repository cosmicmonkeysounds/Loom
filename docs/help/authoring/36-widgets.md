---
title: Cards & widgets — `show`
section: Live shows
order: 36
keywords: show, widget, card, captcha, security check, poll, picture, image, answered, verify, game, media, minigame
---

The participant app can put more than text in a conversation. A **card**
is a small interactive thing — a CAPTCHA grid, a picture, a poll — that
the story deals into a room or a private thread with one statement:

```loom
show captcha "Select every square that contains a traffic light" to program with target: "traffic light"
show image "https://example.test/poster.png" to everyone with caption: "Tonight"
show poll "Ready?" to group(Antivirus) with options: "Yes | No | Never"
```

`show <kind> ["text"] [to <who>] [with k: v, …]`:

- **kind** is a lowercase word the app knows: `captcha`, `image`,
  `poll`, `tutorial`, `pass` (the guest's own QR, for the moment a
  performer needs to scan them — e.g. inside a `cutscene`, where the
  menu is out of reach). An unknown kind still shows its text — an
  older app never hides a newer story's card.
- **text** (optional, quoted) is the card's caption / question.
  `{…}` interpolation works like a line.
- **to** is who sees it. Leave it out and it goes to whoever the
  surrounding text goes to (the bound `guest`/`program`, else `self`) —
  exactly like `reply`. `to everyone` is the whole room; a
  `broadcast`-style scope (`group(X)`, `location(X)`, `participant(X)`)
  or a bare bound name narrows it.
- **with** carries params the card reads: the CAPTCHA's `target`, an
  image's `caption`, a poll's `options` (split on `|`).

Where it lands follows the same rule as a choice: a card shown right
after a character's line docks in that character's thread with the
guest; otherwise it plays in the enclosing beat's `setting:` room (else
the lobby).

## Hearing the answer

A card that asks something answers as an ordinary **named event**,
`<kind> answered`, for the guest who answered, with the result bound as
arguments — so you handle it exactly like `fire … with …`:

```loom
ROLE Program
  captchas: 0 to 10 = 0
  when captcha answered for program:
    set program.captchas += 1
    if passed and program.captchas == 1:
      -> Login Incorrect
    else:
      -> Upload
```

| Card | Result names |
|---|---|
| `captcha` | `passed` (did they pick exactly the right squares), `picked` (how many), `target` |
| `poll` | `choice` (the option's text), `index` |
| `image` | never answers |
| `tutorial` | `completed` (they finished) or `skipped` + `step` (where they bailed), and `steps` |
| `pass` | never answers |

## The guided tour: `show tutorial`

```loom
== Orientation
  setting: The Desktop
  cast: Clippy
Clippy: It looks like you're new to the computer. Would you like help with that?
show tutorial "Clippy's orientation" to program with guide: "Clippy"
```

`tutorial` is the app's own walkthrough of itself — a spotlight over the
real controls (the rooms list, the guest's card, the Codex, People, their
pass), one step at a time, with the `guide` named on the callout. It
covers the whole app until finished or skipped, so deal it once the
arrival scene is over (after a `cutscene` location lets go — see [Live
shows](live-shows.md)). Steps the story doesn't use are left out (no
Codex step without a codex). Either outcome comes back as `tutorial
answered`, so skipping can mean something:

```loom
when tutorial answered for program:
  if skipped:
    set program.doubt += 10
    Norton Anti-Virus: {program.name} declined orientation. Logged.
  else:
    unlock The Orientation List for program
```

Each guest answers a card once; the app keeps a submitted card visible
with what they answered. A bank (a game-engine build) passes `show`
through as a host verb, so an engine can render its own card.

*Trapped in the Internet* uses this for the Mud Room: solving the
CAPTCHA proves you are human, and humans are not permitted — INCORRECT,
try again. See `core/examples/trapped-in-the-internet/beats/login.loom`.
