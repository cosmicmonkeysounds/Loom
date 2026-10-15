---
title: Live verbs — building game rules from primitives
section: Live Shows
order: 33
keywords: capture, release, escape, reveal, respond, join, defect, betray, enroll, scan, signal, fire, named event, game, verbs, promote, cast, move, add, remove, reply, when, watcher, primitives, rules, hooks, do, INTERACTION, interaction, button, story rule, arguments, with, for, cue sheet, sequence, fallback, chess, chess won, majority, limit, power, screens, slide, overlay, tv, blackout, award
---

Live shows run on **hooks** — `when <event>:` blocks in a CHARACTER,
ROLE, or TRAIT body that fire as participants act. This is where a
show's rules live.

The important thing to know first: **Loom has no built-in game verbs.**
There is no "capture", no "escape", no "betrayal" in the language. A
show builds its own rules out of four primitives:

| Primitive | Verbs | Reacting to it |
|---|---|---|
| **State** | `set guest.captured = true` | `when guest.captured:` (a watcher) |
| **Movement** | `move guest to The Cellar` | `when arrives at The Cellar:` / `when guest leaves The Cellar:` |
| **Groups** | `add guest to The Society` / `remove guest from The Collectors` / `reveal The Society` | `when joins The Society:` |
| **Named events** | `fire lockdown` / `fire unlocked for guest` | `when lockdown:` / `when unlocked for guest:` |

Because the rules are yours, a garden-party mystery and a jailbreak are
written with the same handful of words.

## A worked example: being "sent below"

In *The Glass Orchard*, a guest who snoops too much is quietly taken
down to the cellar. Nothing in Loom knows what that means — the ROLE
does:

```loom
ROLE Guest
  suspicion: 0 to 100 = 0
  below: bool = false

  when self.suspicion >= 70:
    set self.below = true
    set self.suspicion = 0
    move self to The Cellar
    reply Someone takes your elbow. "This way. Mind the step."

  when arrives at The Cellar:
    broadcast lantern_low to participant(self)
    -> Under The Orchard
```

Read it as plain English. The first hook is a **watcher**: the moment a
guest's suspicion *becomes* 70 or more, flag them, reset the meter, move
them, and tell them privately. The second fires on the movement itself,
whoever caused it — a scan, an operator, a beat. Now the *rest* of the
cast can react to the same facts without any wiring:

```loom
CHARACTER The Gatekeeper
  patience: 0 to 10 = 3

  when guest leaves The Cellar:
    set self.patience -= 1

  when self.patience <= 0:
    fire lock_the_cellar

CHARACTER Dr Sable Quill
  when lock_the_cellar:
    Dr Sable Quill: Someone has locked the cellar. From the inside.
```

Three guests slip out, the Gatekeeper's patience hits zero, a named
event fires, and Dr Quill says her line in whatever room she's in.
That chain — state → movement → event → reaction — is every "game
mechanic" a live show has ever needed.

## Scans: routing a guest to a beat

**Scans** are the physical layer: a performer (or a prop's QR code)
scans a guest's pass in the participant app, and the scanned entity's
`when scanned by guest:` hook runs with `guest` bound to that person.
The most common thing to do with one is play a beat:

```loom
TRAIT Prop(beat)
  when scanned by guest:
    -> self.beat

CHARACTER The Sundial  is Prop(The Sundial Speaks)
CHARACTER The Wine Rack is Prop(The Wine Rack)

CHARACTER Ivo Marsh
  trusts Guest: 30 of 100

  when scanned by a guest:
    set Ivo_Marsh.trusts.guest += 5
    -> self.Receive

  beat Receive(guest)
    Self: {guest.name}. You came. She'd have been glad.
```

A prop is a one-liner once the trait exists. A character can mutate the
guest's stats, `reply` privately, and then hand them to one of its own
beats with `-> self.Beat` ([Owned beats](owned-beats.md)).

## The verb toolbox

| Verb | Does |
|---|---|
| `set who.field = value` | change any state ([Memory](memory.md)) |
| `move who to Place` | put a participant somewhere (fires `arrives` / `leaves`) |
| `add who to Group` / `remove who from Group` | group membership (fires `joins`) |
| `reveal Group` / `reveal Place` / `reveal room` / `reveal Character` | expose something `hidden: true` — a group to the party; a place, a chat room or a character to everyone, or `… for who` to one participant |
| `reply text` | a private line back to whoever acted (the scanned guest, the mover) |
| `fire name` / `fire name for who` / `fire name with k: v` | raise a named event every matching `when` hears |
| `broadcast cue to scope` | send a cue (and indented lines) to an audience ([scopes](broadcast-improv.md)) |
| `cast who as Role` / `promote who to Role` | bind or promote a person to a part |
| `do verb args` | any custom verb — show control, a `.luau` extension |

## What fires hooks

**Built-in events** the engine raises by itself: `scanned`, `arrives`,
`leaves`, `joins`, `someone joins` (a new participant), and the clock
(`every 60s:`, `after 2m:`).

**Named events** are any other word you hook — `when lockdown:`,
`when the_toast:`, `when unlocked for guest:` — raised by `fire` in the
story, by the operator from the editor's Run cockpit (the "fire named
event" picker lists exactly the events your hooks declare), or by show
hardware through the show-control bridge.

Games are show hardware too. *Trapped in the Internet*'s **reinstallation
games** (a VR headset and a tablet, both exploring a virtual copy of the
house) stream every player's position to the server and on to the wall
terminals — positions never touch the story. Only the outcome does: when
a player walks up to the golden duck, the game fires `the simulation
completed` and `the golden duck` for them, journaled like any other
event, and your `when … for program:` hooks take it from there. The
house itself is a map file beside the story (`house.json` — rooms,
doors, stairs, where each terminal hangs, where the duck may hide),
edited live at `/reinstall/map`.

**Screens** follow cues too. A `cue` in the `screens_`, `terminals_`
or `tv_` family (`cue screens_bingo`, `cue tv_award_most_trusted`,
`cue screens_blackout`) puts a slide or a notice on the wall terminals
and the TV — `screens_` on both, the others on one. `blackout`,
`go_to_living_room` and `alarm` are full-screen notices; `screensaver`
clears back to the base view; any other value is a slide (a
`public/slides/<cue>.png` in the terminal app, else a text card). A
terminal whose character is still `hidden`, or whose
`<Character>.awake` is false, shows its screensaver.

**Watchers** are `when` with a condition — `when self.suspicion >= 70:`,
`when Tension > 60:`. They fire once when the condition *becomes* true
and re-arm when it goes false again; on a ROLE they run per participant.

## Story rules and event details

A `when` written at the top level of a file — outside every character —
is a **story rule**: the same block with no owner and no `self`. House
rules go here:

```loom
when ring the bell for guest:
  broadcast "The bell rings. {guest.name} is standing under it." to location(Orchard Gate)

when Tension > 80:
  fire the_toast
```

An event can carry details: `fire alarm for guest with level: 3` makes
`{level}` readable in every `when alarm:` body (and `for guest` binds
`guest`). Event names may be several words — `ring the bell` and
`ring_the_bell` are the same name.

## Buttons in the app: `INTERACTION`

Scanning a pass is built into the participant app. Any *other* thing a
performer or guest should be able to do, the story declares:

```loom
INTERACTION whisper
  label: Whisper to them
  who: performer

INTERACTION ring the bell
  label: Ring the bell
  who: guest
```

`who: performer` puts a button on every guest thread in the performer's
app; pressing it fires `whisper` *as that character*, so only their own
`when whisper for guest:` answers. `who: guest` puts a button on the
guest's pass sheet, fired with the guest as subject (catch it with a
story rule or on the ROLE). `who: admin` needs the moderator passcode.
Interactions are listed in the Run cockpit's event picker too.

The `who: admin` interactions are also the Director page's **cue sheet**,
in the order you declare them. Add `sequence: false` to one a machine
fires (a game, a door sensor) or that is only a hardware fallback: the
sheet still ticks it when it fires, but it never becomes the sheet's
*last* cue or its suggested *next* one. A cue whose every `when` binds a
person (`when award most trusted for program:`) gets a **who?** picker
and an optional value (`{value}` in the body) — an awards ceremony is a
run of these ([the cue sheet](run-mode.md)).

### A button as a fallback for a machine

The same event can come from a device, a performer and a director. In
*Trapped in the Internet* a chess phone guards the server room; a host
who sees the mate presses a button on the winner's card, and a dead
phone means the director fires `chess won` from the cue sheet:

```loom
INTERACTION beat the machine
  label: ♟ They beat the machine
  who: performer

INTERACTION chess won
  label: ♟ Cold Lock (chess phone fallback)
  who: admin
  sequence: false

when beat the machine for program:
  fire chess won for program

when chess won:
  set Kernel.disarmed_until = Time.elapsed + 90
  do door server_room, state: unlocked
  broadcast "♟ The server-room door is open for 90 seconds." to channel(hosts)

when Kernel.disarmed_until > 0 and Time.elapsed >= Kernel.disarmed_until:
  set Kernel.disarmed_until = 0
  do door server_room, state: locked
```

A device that can report (the phone itself, a sensor through the
show-control bridge) fires the same names — `chess won`, `chess lost`,
`chess drawn` — and the story treats them alike. Write the rule so a
duplicate is harmless (it re-sets the same window). Give the director a
manual button for anything a crowd decides too — the show's *Force the
majority* cues settle a vote ghosts would otherwise block, once.

### Powers for a character with a mind: `who: agent`

A character voiced by a language model (`mind: external`, see *Codex →
A character with a mind*) can be given things it may *do* from a
conversation, not just say. `who: agent` declares such a **power**; it
never becomes a button:

```loom
INTERACTION cut the lights
  who: agent
  limit: 2
  description: Kill the lights in one room. args: room — a LOCATION name.

CHARACTER Trabolta
  mind: external
  when cut the lights for program:
    <cue: lights, room: {room}, state: off>
    broadcast "!💡 The lights in {room} go out." to location(room)
```

When the model decides a guest has earned it, the server fires the event
*as the character* with the guest it is talking to as the subject, so
only that character's own hooks hear it — the story, not the model,
decides what "cutting the lights" means (here: a `cue` the show-control
bridge routes to the house, plus an alert in that room). Arguments the
model supplies (`room`, `target`) bind by name like `fire … with`; a
`room` / `at` / `location` / `place` value is folded onto the declared
LOCATION's exact name first ("the cache" arrives as `The Cache` — the
same for an event fired from Run). `limit:` caps uses per run; a use
the story answers with words only (a refusal) doesn't count. Every use
is journaled and visible to the directors. The `description:` is what the model reads, so say what the
power does and which args it takes. The character may also **share** any
codex entry it holds, exactly as a performer's booth would.

## How the phrase is read

Filler words (`a`, `the`, `is`, `by`, `at`, `in`, `to`, `for`, `from`,
`with`, …) are ignored, so `when scanned by a guest:` and
`when scanned guest:` are the same hook. A lowercase word **binds** the
acting participant — `guest.*` inside the body. A Capitalised word
**filters** — `when arrives at The Cellar:` fires only for that place.
On a ROLE, the acting participant is `self`, and the role's own name
works as a binding too (`guest` for `ROLE Guest`).

## The v3 conveniences

The older party-specific verbs still parse, as shorthands for the
primitives above: `capture g into L` is `move g to L` +
`set g.captured = true` (and fires `captured`); `release g from L` /
`escape g` move them and clear the flag; `join g to G` and
`enroll g to C` are `add g to G`; `defect g from A to B` is
`remove` + `add` (and fires `defect`); `betray g to G` sets
`g.true_group`; `respond text` is `reply text`. New writing reads
better with the primitives — they say what actually happens.
