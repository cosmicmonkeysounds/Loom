---
title: Broadcasts & improvised beats
section: Live Shows
order: 31
keywords: broadcast, scope, notice, per-person, ~, folded, collapse, location, cohort, participant, and, but, improv, duration, advance on, pedal, speech, gesture, quorum, group, cue, faction
---

## Speaking to a subset: `broadcast`

In a room full of people you rarely address *everyone*. `broadcast`
sends a cue — and, if you indent lines beneath it, those lines — only
to the participants who match a **scope**:

```loom
broadcast lantern_low to participant(self)

broadcast the_toast to location(The Long Table)
  Ivo Marsh: A toast. To my sister, wherever she has got to.

broadcast rally to group(The Gardeners)
  Narrator: A sprig of rosemary is passed from hand to hand.
```

The first word after `broadcast` is the cue name (show control and
channel routing see it); `to` introduces the scope. The scope atoms:

| Atom | Reaches |
|---|---|
| `location(The Long Table)` | everyone standing at the table |
| `group(The Gardeners)` | everyone on that side (`faction(…)` still works) |
| `participant(guest)` | one specific person |
| `channel(hosts)` | posts straight into that authored `CHANNEL` (a staff back-room), for whoever may read it — not the lobby |

Scope arguments are expressions, so `group(guest.group)` broadcasts to
whichever side the acting guest is on.

Combine with `and` (both) and `but` (except):

```loom
broadcast private_choir to group(The Gardeners) and location(The Glasshouse)

broadcast look_up to location(The Cellar) but participant(guest)
  Narrator: The others look up. You don't.
```

The long form `<broadcast: location(The Cellar)>` with lines indented
under it is the v3 spelling and still parses.

## A notice about one person: `~`

A busy room fills with lines about somebody else (*Excel's answer is
accepted*, *a ribbon for Pong*). Start the cue with `~` to mark it as a
**per-person notice**:

```loom
broadcast "~✅ {program.name}'s answer is accepted." to everyone
broadcast "~🤷 {program.name} filed a guess." to everyone
```

The `~` is not shown. On a phone a run of notices in a row folds to one
line by their leading emoji (*✅ 12 · 🤷 3*), tap to read each, and a
notice about the reader stays its own line. Give every notice a leading
emoji: it is the fold's key. The person it is about must still hear
their own result personally — a `reply` to them — because their copy
may be folded with everyone else's. A cue that starts with `!` is an
alert, never a notice: don't combine the two.

## Improvised beats

Live performers don't read every word. An **improv beat** gives them a
direction and a *duration*, and hands control back when a signal
arrives:

```loom
Ivo Marsh:
  (improv duration: 45s, advance on: any [pedal, speech(a toast), gesture(Raise Glass)])
  (Welcome them. Find out which side they picked. Do not mention Mara.)
  -> The Long Table
```

- `duration: 45s` — roughly how long the improv runs.
- `advance on:` — what ends it. Here *any* of: a foot `pedal`, someone
  saying "a toast" (`speech`), or a `Raise Glass` gesture.
- The second parenthetical is the *direction* to the performer — what to
  play, not what to say verbatim.

`advance on` can require more than one signal: `all [...]` waits for
every listed signal; `quorum(8) [...]` waits until 8 people have given
one.

Improv works on any speaker cue — the `Ivo Marsh:` block above, or the
ALL-CAPS `IVO MARSH` screenplay form.
