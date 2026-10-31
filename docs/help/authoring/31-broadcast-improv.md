---
title: Broadcasts & improvised beats
section: Live Shows
order: 31
keywords: broadcast, scope, big moment, !!, un-ignorable, full screen, with go, go:, exits, buttons, close, auto close, ack, ack: none, ack none, no ok, no acknowledge, L1226, cheer, L1214, L1218, notice, per-person, ~, folded, collapse, location, cohort, participant, and, but, improv, duration, advance on, pedal, speech, gesture, quorum, group, cue, faction
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

## Big moments: `!!`

A cue that starts with `!` is an **alert**: a moment at the story's alert
level ([Live shows](live-shows.md)). Start it with **`!!`** and it is a
**big moment**: on a guest's phone it takes the whole screen whatever the
level, can't be folded or swiped away, and waits for one button after about
a second. Use it for what is *theirs* and decisive: a win, a capture, an
invitation, being found.

```loom
reply !!🎱 BINGO! Name the program for each square, from memory.
reply "!!🎀 You won the Bingo Floppy Disk. Take a bow." with go: codex: Computer Bingo
broadcast "!!🎀 {Night.ribbon_winner} won the Bingo Floppy Disk! Cheer for them at the Desktop." to everyone with close: 6s
show poll "🍾 The bottle landed on you. Truth or dare?" to program with options: "Truth | Dare", moment: big
```

- `reply !!…` makes it a big moment for the one person (the `!!` is not
  shown). On a performer's booth a big readout is a **pop-out** instead,
  never a full screen.
- `broadcast "!!…" to everyone` is a big moment for the **whole house**:
  every phone stops for it. Keep those to an admin cue's own `when` or a
  story rule (lint **`L1218 BigHouseBroadcast`** warns anywhere else), and
  add **`with close: 6s`** so it closes itself (*📣 HOUSE NEWS · Cheer!
  (6)*). A house-wide one that leads with a win emoji (🎀 🏆 🥇 🏅 🎉 🎊 👑
  🥳) also pops a *Congratulations!* window on the TV and the wall
  terminals.
- A card (`show …`) becomes big with `moment: big`; its options are
  answered inside the big moment.
- `pin "!!…"` is unchanged: the takeover ([Live verbs](live-verbs.md)).

The emoji the line starts with picks its look: 🎀 🏆 🎱 🥇 🦆 ✅ 🎉 ♟ an
*achievement*, 🛡 🚨 *virus detected*, 🌐 ⛔ 🔒 *quarantined*.

## Exits: `with go:`

Every moment on a phone carries buttons that take the reader to its place.
Name them with **`with go:`** after the quoted text (repeat `go:` for a
second one, at most two show):

```loom
broadcast "!📣 ALL PROGRAMS: report to the Desktop." to everyone with go: The Desktop
reply "!!🌐 Sent to the Internet." with go: The Internet, go: pass
broadcast "!⏳ FIVE MINUTES. Scan the Desktop's check-in QR." to everyone with go: scan as "📷 Check in", go: The Desktop
broadcast "Look." to everyone with go: codex: The Sandy File, go: quest: The Cold Door, go: wallet as "Count your coin"
```

A `go:` word is a LOCATION (*Go to The Desktop*), a CHANNEL (*Open #
hosts*), a CHARACTER (their thread), a `who: guest` INTERACTION (its
button), `codex` / `codex: <Entry>`, `quests` / `quest: <Quest>`, or a
screen: `pass`, `scan`, `chats`, `mission`, `notifications`, `sides`,
`wallet`, `me`. `as "Label"` renames the button. A room the reader can't
see yet is dropped for them, and **`lobby` is never an exit** (the lobby is
the far-away Chat log). With no `go:` the app still gives one: a card's own
thread, a codex unlock's entry, a quest step's quest, a wallet card's
Wallet, else Mission.

**No OK: `ack: none`** (wave 26). Add `ack: none` to the same tail and a
big moment loses its acknowledge button: only its exits close it.

```loom
reply "!!⛔ QUARANTINED. Sent to the Internet." with go: pass as "🎟 Show my pass", go: go to the bathroom, ack: none
```

`none` is the only value. It needs at least one `go:` in the same tail
(lint **`L1226`**, a warning). A phone that can take none of the exits
(every room dropped for that reader) still shows the usual OK, so a guest
is never trapped; banks ignore it. *Trapped in the Internet* uses it on
the capture and the confrontation, where the phone is about to lock
(`lock:`, [Live shows](live-shows.md)), and on the Dare's moment.

`with` is only read **after a quoted text** (and, on `broadcast`, after its
`to` scope): an unquoted `reply … with go: …` stays prose, and lint
**`L1214 GoTargetUnresolved`** says so. It also flags a `go:` word that names
nothing (the button is dropped).

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
