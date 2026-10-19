---
title: Live shows — people, places, casting
section: Live Shows
order: 30
keywords: live, reserved, invitation, claim, for guests, went home, gone, persona, present, PERSON, ROSTER, cast, COHORT, LOCATION, participant, capacity, swings, roster, casting, immersive, ROLE, GROUP, hidden, someone joins, when, participant app, title, check in, checked_in, checkin, sign, qr, header, watch, countdown, director page, glance, board
---

In a live Loom show, the audience aren't just readers — they're
**participants**. They move between rooms, pick sides, get scanned,
chat, and make choices, while performers run scripted and improvised
beats around them. Loom coordinates all of it.

## The kinds of "person"

| You write | Means |
|---|---|
| `CHARACTER` | a *part* in the script — Ivo Marsh, The Gatekeeper |
| `ROLE` | a part *many people* play at once — every guest at the party |
| `PERSON` | a *real human* who might perform — Jamie Lee |
| `ROSTER` | the plan for one night — who plays what |
| `cast who as Role` | the live act of a person taking a part |

Every participant the app creates (a pass, a join code) is cast into
your project's **first `ROLE`** unless you cast them otherwise. That
role carries the per-person state and the rules that apply to everyone:

```loom
ROLE Guest
  group: any of GROUP
  suspicion: 0 to 100 = 0
  favour: 0 to 100 = 10
  below: bool = false

  when someone joins:
    reply Welcome to the orchard. Keep your invitation where it can be scanned.
```

`when someone joins:` fires once per new participant with `self` bound
to them; `reply` sends a private line back to that one person.

## Real people: PERSON and ROSTER

```loom
PERSON jamie_lee
  display_name: Jamie Lee
  pronouns: they/them
  content_tolerance: [no_strobe]
```

A **ROSTER** is the line-up for a specific performance:

```loom
ROSTER preview_night
  date: 2026-09-12T19:30
  capacity: 30

  cast
    Ivo Marsh := jamie_lee
    Guest     := any of [audience]

  swings
    Ivo Marsh := [raja_park, kim_ho]
```

`:=` assigns a person to a part; `any of [audience]` means any walk-up
can fill it; `swings` lists covers. At showtime:

```loom
do load_roster preview_night
cast jamie_lee as Ivo Marsh
```

Your *script* never names a real person — the same script runs with a
different cast tomorrow.

## Sides, places, groupings

```loom
GROUP The Gardeners
  ethos: tend

GROUP The Society
  ethos: keep the orchard
  hidden: true

LOCATION The Cellar
  label: Under the Orchard
  ambient: drip
  capacity: 8

COHORT Early Arrivals
  label: The Early Arrivals
  capacity: 12
```

- A **GROUP** is a side a participant can be on (`FACTION` is the older
  spelling). `hidden: true` keeps it secret until the story `reveal`s
  it. `add who to Group` / `remove who from Group` change membership;
  `who.group` reads the side they're publicly on.
- A **LOCATION** is a place participants can be `move`d to — and every
  location is also a chat room: when a beat's `setting:` is a location,
  its dialogue and narration land in that room, heard by whoever is
  standing there (see [Chat spaces & channels](chat-rooms.md)).
  `hidden: true` keeps the room off a guest's phone until they have
  **stood there**, or until the story opens it — `reveal The Cellar`
  (for everyone) or `reveal The Cellar for guest` (for one person).
  `cutscene: true` puts the app **on rails** while a guest stands there:
  no rooms list, no buttons — one full-screen stream of what the story
  says *to them* (their lines, cards, decision), and a *Continue* into
  the app once the story moves them on. Use it for an arrival scene.
- Every location also gets a **check-in sign** on Run's print sheet: a
  QR a guest scans with their phone camera. It moves nobody by itself —
  it fires `checked_in` for that guest with `at` set to the exact
  location name, and your `when checked_in for guest:` rule decides:
  `if at == "The Cellar":` then `move guest to The Cellar` (compare with
  the exact name; never `move guest to at`). The server refuses captured
  guests, guests on rails, rooms hidden from them, prisons and
  cutscenes, and more than one check-in per 20 seconds; `checkin: false`
  leaves a place off the sheet and never lands a guest there (a locked
  room).
- A `listed: true` **CHARACTER** can be `hidden: true` too: out of the
  People directory (and, for an agent-voiced one, off every phone) until
  `reveal Name` / `reveal self`.
- **Who signs in as whom** is read off the cast. A character with a
  *part* — hooks, owned beats, a body (`listed: true`), a mind — is a
  **performer's**: the performer sign-in lists the parts nobody holds
  yet, one booth each. A character that is **nothing but a name**
  (`CHARACTER Calculator`, no body) is a **program a guest may be**: the
  guest sign-in lists the unclaimed ones, one guest each, and a guest
  who wants something else searches the program directory (any
  software on Wikipedia — **never antivirus**) and becomes that. A
  guest can never take a part, and never a name in a `joinable: false`
  group. `playable: false` keeps a character off both lists (a scanned
  prop). A program typed in another case (`bugdom`) is registered under
  the story's own spelling (`Bugdom`), so `program.name == "Bugdom"`
  still hears them.
- **`reserved: true`** holds a guest's program for one invited person
  (*Trapped in the Internet*'s nine featured programs). Everyone else's
  picker shows it **🔒 Reserved**, and its `wiki:` article too in the
  directory search; registering it without the invitation answers 409
  *reserved*. Each reserved program has a secret **claim link**, the
  same across restarts and End → relaunch: Run → 🖨 Print sheet prints
  one invitation per program, and an invitee who scans it gets their
  program (with the claim, registering its `wiki:` article makes them
  that program too). For a lost invitation the invitation card's
  **🔓 lost? open 2 min** opens it to anyone for two minutes. `reserved`
  is not a part: the program stays a guest's.
- **Profile pictures** are hand-picked with `avatar:` — a link, or a
  Wikipedia / Commons file by name (`avatar: File:Winamp Logo.svg`,
  copied from the file's page). `avatar: File:A.png | File:B.png` offers
  more than one; the first is the default. A character with no `avatar:`
  gets the best picture its article has (a logo before a screenshot).
  `wiki: Microsoft Minesweeper` names the article when the name alone
  would find the wrong one. Every picture is downloaded when the story
  loads, so the night never waits on Wikipedia. A guest choosing a
  program sees its hand-picked pictures first, then the article's own
  gallery, and picks one (and can switch later from their pass).
- A **COHORT** is a plain named grouping with a capacity, for when you
  need to count heads without it being a "side".

**Who is still here.** A head count over `Persons` counts everyone who
ever joined, so a show that needs the guests still in the house (a
majority) leaves two kinds out. A director marks a guest who left
**👋 Went home** on Run (a journaled `<id>.gone = true`), and every
rehearsal persona made from Run carries `<id>.persona = true`, set
before its join rules run:

```loom
when Night.final_round == true and count([p for p in Unlimited_Power.members where p.gone != true and p.persona != true]) * 2 > count([p for p in Persons where p.gone != true and p.persona != true]):
  fire majority_reached
```

Your story can read all of these memberships and counts — `count(The
Gardeners)`, `guest.group == The_Gardeners` — and react to them with
`when` hooks ([Live verbs](live-verbs.md)). A show can also give its
guests money: one header line, `currency: score as Truthcoin`, turns a
ROLE slot into a wallet they send, request and trade from their phones
([currency](currency.md)).

## One beat, many participants

A `ROLE` hook runs *per participant*, with `self` bound to each person
in turn. Add `as self` to a divert and one beat serves everyone, each
seeing themselves in it:

```loom
ROLE Guest
  no_strobe: bool = false

  when someone joins:
    -> Orientation as self

== Orientation
  cast: self

if self.no_strobe:
  -> A Gentle Welcome as self
-> The Front Gate as self
```

Checking *their* preferences, routing *them* individually — all from one
piece of writing. (`as participant` is the older spelling and still
works.)

## The app is not the story

The participant app is a generic client. Everything it shows comes from
your project: the `# Title` line is the event name on the join screen
and lobby, your `LOCATION`s / `SPACE`s / public `GROUP`s are its rooms
sidebar, and the named events you `fire` are what the operator can
fire from the Run cockpit. Nothing story-specific is baked in.

## The director's board: `watch:` and `countdown:`

Two header keys choose what the Run → Director page keeps in view ([Run
mode](run-mode.md)). Each may be written as many times as you like, and
every line can end in `, while <condition>` so it only shows while the
night is in that stretch:

```loom
# The Glass Orchard
start: The Front Gate
watch: guest.suspicion as Suspicion, guest.favour as Favour
watch: Ivo Marsh, Mara Vell
```

That watches two slots of the story's `ROLE Guest` and where two of its
hosts are. A story with globals and a timed hunt watches those too — the
`Night.…` names must be ones a line of *that* story `set`s, spelled the
same way (The Glass Orchard sets none, so these lines don't belong in
it):

```loom
watch: Night.round as Round, Night.lights as Lights, while Night.step >= 2
countdown: Night.hunt_end as Hunt ends, while Night.hunt_on == true
```

- A `watch:` item is a path (`Night.round`), with `as <Label>` for its
  name on the board (else the last part, `round` → *Round*). A path
  that starts with a ROLE's name (`guest.suspicion`) counts over every
  guest (a `bool` slot as *Cleared 44/45*, a number summed with the
  highest). A path on a `secret: true` CHARACTER is shown
  masked (the director presses and holds 👁 to read it) and never
  reaches the director's phone. An item with no dot names a person: the
  board shows where they are and whether they are online.
- A `countdown:` item is a path holding a **story time in seconds**
  (`set Night.hunt_end = Time.elapsed + 900`). It shows, ticking down,
  only while its line's `while` holds and the time is still ahead; it
  stops while the run is paused. The Director page's NOW card lists the
  running countdowns when there is nothing to press, so a quiet sheet
  during a timer reads as meant.

End a `countdown:` line with **`, for guests`** and the guests see it
too, ticking in a strip under their room header:

```loom
countdown: Night.hunt_end as Hunt 1 ends, while Night.hunt_on == true, for guests
```

Only the flagged lines reach guests, never a head on a `secret: true`
CHARACTER, and only while one is running. `for guests` on a `watch:`
line is a lint (`L1205`): only a countdown takes it.

These lines belong in the **header** — above the file's first beat,
declaration or rule, which is what ends it (blank and comment lines
don't) — and **only in the first file** of the project: the event server
plays the files as one source, so it reads the first header only. Lint
`L1205` flags a line that won't parse, a head that names nothing in the
story, or a board line in another file. With no `watch:` line the board
shows the globals the story changed most recently instead.
