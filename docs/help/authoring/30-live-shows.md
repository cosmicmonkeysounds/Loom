---
title: Live shows — people, places, casting
section: Live Shows
order: 30
keywords: badge, badges, L1219, lobby hidden, hidden lobby, live, judge, wanted, wanted board, reinstall, archive, majority, sides, crews, crew, recruit, recruited, founded, unaligned, party favour, L1216, reserved, admin, host, host part, alerts, alert level, interrupt, moment, balloon, sticky, dialog, bsod, blue screen, glitch, crawl, fx, effect text, manner, invitation, claim, for guests, went home, gone, persona, present, PERSON, ROSTER, cast, COHORT, LOCATION, participant, capacity, swings, roster, casting, immersive, ROLE, GROUP, hidden, someone joins, when, participant app, title, check in, checked_in, checkin, sign, qr, header, watch, countdown, director page, glance, board
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
  *reserved*. Its name without the first word is held too (*Excel* for
  *Microsoft Excel*, *Paint* for *MS Paint*). Each reserved program has a secret **claim link**, the
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
  gallery, and picks one (and can switch later from the Start menu).
- **`admin: true`** on a CHARACTER makes it a **host part**: whoever
  signs in as it with the performer code gets the host console in their
  booth — the cue sheet's NEXT bar, judging, announcements, the alert
  level, wallets, parts, answering as an agent-voiced character — never
  the lifecycle (restart, push draft, go live, end) or the god view
  (*Trapped in the Internet*: Task Manager, Adobe Acrobat, the Recycling
  Bin). Signing in as another part drops it. Write it on the CHARACTER,
  never on a TRAIT every host shares (a trait's keys are inherited, so it
  would reach every deriver). Lint `L1211` warns when nobody can sign in
  as that character (a guest's program, a prop, an agent-voiced one).
  The moderator passcode in a booth still gives full admin. A part that
  isn't a host can still **call** chosen cues: `by: <Character>` on an
  admin cue puts it on that booth's 🎤 cue bar (*Trapped in the
  Internet*: Clippy calls the games; [live verbs](live-verbs.md)).
- **`crawl: fx`** on a CHARACTER makes every line it speaks **effect
  text** (below).
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
([currency](currency.md)). A show that judges filed facts against a
`facts.json` key can name an agent-voiced character to rule on the
near misses with `judge: <Character>` in the header (*Trapped in the
Internet*: `judge: Trabolta`); [cards & widgets](widgets.md) has how.

## Sides, recruiting and crews

A guest joins one of your public GROUPs as a **side** through a door, not a
chat room: the app's Sides screen, and a full-screen pair of doors when you
deal them the `sides` card ([cards & widgets](widgets.md)). Joining is the
switching `join` (it leaves the other side); `Leave` puts them back on
neither. Only a declared, joinable, revealed side is offered. Two things
help the screen read your story:

```loom
majority: Night.present / 2 + 1
```

- **`majority: <expr>`** (header) is the head count a side needs: each
  door's bar reads *4 of 13 needed*. It is display only; your own watchers
  still decide the majority.
- **`<Side>.leader`**: set it (`set Unlimited_Power.leader = program`) and
  the door says *led by Excel*; a leader can't leave or switch.

A guest on a side can **recruit** another by scanning their pass; the other
phone gets a big invitation (*Join* / *Not now*), and a yes is the same
switching join. It fires **`recruited`** for the recruit, with `side` (or
`crew`) and **`by`**, the recruiter, as a person:

```loom
when recruited for program:
  if side == "Unlimited Power":
    set by.recruits = by.recruits + 1
    update quest Recruit To Stay for by "🙋 {program.name} walked through your door."
```

Guests may also found **crews** of their own: a name (2–24 characters,
moderated), a members-only room `crew:<id>`, invitations by pass, at most
eight in a night, one per founder. A crew is **never a side**: it never
touches a GROUP's members, `who.group`, a majority, or what an agent-voiced
character hears. The story hears `founded` (the founder, with `crew`), `join`
(a new member, with `crew`; a side's `when who joins <Side>:` never does)
and `unaligned` (someone left their side, with `side`). Directors and hosts
can rename or dissolve a crew.

## The Wanted board, the reinstallation gate, finished threads

Three more header lines (in the first file, like `watch:`):

```loom
wanted: program.marked as program.marked_for by program.escort_by, for Antivirus
reinstall: program.marked == true or program.corrupted == true or Night.ended == true
archive: The Uploader when program.cleared == true
```

- **`wanted: <role>.<flag> [as <role>.<reason>] [by <role>.<claim>], for
  <CHARACTER or GROUP>, …`** gives those booths (and every host) a **Wanted
  board**: a poster, and a pop-out, for every guest whose flag is true, with
  the reason, where they were last seen, when they were marked, and who has
  claimed them (the claim path's value: set it to the claiming character,
  `set program.escort_by = self`; the string `none` reads as nobody). A
  guest caught (captured) stays a minute, stamped. Give the booths a claim
  button of your own (an `INTERACTION` that sets the claim path).
- **`reinstall: <condition>`**, read per guest, is who may enter the
  reinstallation games ([House map](house-map.md)). Without it, a captured
  or restricted guest may; with it, only your condition counts, so include
  captured guests yourself. *Trapped in the Internet* opens it to everyone
  once `Night.ended` is true: a party favour (runs after the end never
  count on the duck board).
- **`archive: <LOCATION | CHANNEL | CHARACTER> when <condition>`**
  (repeatable) moves a guest's finished thread, once the condition holds
  for them, down into *Other rooms* (an arrival DM after they're through the
  door). It still exists and still works.

Lint **`L1216 HeaderLineInvalid`** flags a `wanted:` / `archive:` /
`reinstall:` line that doesn't parse or names nothing.

## Badges and a hidden lobby

```loom
badge: program.afk as 🚻 Bathroom Mode
badge: Clippy.busy as ⏳ Busy, while Night.step >= 2
lobby: hidden
```

- **`badge: <ROLE alias or CHARACTER>.<path> as <glyph> <label>[, while
  <condition>]`** (repeatable) puts the glyph beside a person's name on
  every people list — the People sheet, who's here, a booth's guests, the
  host dock and Run's roster — while the path is true for them (the
  `while`, if any, read with them bound). Never on a chat bubble: a
  bubble is a line already said. Every phone sees a badge, so a ROLE
  `secret:` slot or a `secret: true` CHARACTER is never shown: lint
  **`L1219 BadgeOnSecret`** refuses it (and a line that doesn't parse or
  names nobody).
- **`lobby: hidden`** keeps the lobby (the story's own chat log room) off
  every guest's phone. Nothing is rerouted: its lines still reach each
  guest as moments and in Notifications, and booths and Run keep the room.

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
too, as the clock in their taskbar's tray (*⏳ 4:59*; tap it for *Hunt 1
ends in 14 min 59 s*):

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

**ROLE items are the booth card's facts.** A `watch:` item on a ROLE
path (`guest.cleared as Cleared`) is also a fact on every performer's
guest card while its line is live: a yes / no slot shows when it's on
(and when a gate such as *Cleared* or *Checked in* is off: *✗ Not
cleared*), any other value when it's set. So list there what a performer
must see at a glance, and never a ROLE `secret:` slot: the card leaves
those out, and `L1205` warns.

## How loud the phones are: `alerts:`

A **big** moment (`reply !!…`, `with moment: big`; see
[Broadcasts](broadcast-improv.md)) is above this ladder: it is full screen
on every level. Everything else — an `!` alert, a card that asks one
guest (`with moment: major`, [cards & widgets](widgets.md)), a loud
[objective](objectives.md), a `reply` to someone, a quest starting — comes
on a ladder of four levels, quiet to loud:

| Level | On a phone |
|---|---|
| `balloon` | a tip by the taskbar's tray that goes away by itself |
| `sticky` | a banner across the top until tapped (the default) |
| `dialog` | a full-screen Win95 box with OK, one at a time (*1 of 3*) |
| `bsod` | the blue screen: every story line addressed to the guest takes the screen too |

A major moment renders at the level; a minor one (a quest starting, a
readout, a note to one person) one step lower, never below a balloon. A
booth never goes above `sticky`, so a performer is never stopped
mid-scene (a big moment there is a pop-out). A `pin "!!…"` takeover is
above the ladder and unchanged. A moment to one guest comes before a house
announcement, one house banner shows at a time (the newest), and a queued
announcement from an earlier `Night.phase` is dropped once the phase moves
on. Every moment carries its exits (`with go:`) and lands in the guest's
**Recycle Bin** (their notifications); a phone that wakes replays only an
unanswered big moment (for fifteen minutes) and the newest live house
banner, and the rest waits in the bin.

The level is a world value the story sets. The header names it:

```loom
# Trapped in the Internet
alerts: Night.alerts
```

`Night.alerts` is the default, so the line is only needed to choose
another path. Then set it like any value — `set Night.alerts =
"dialog"` at the summons, `"bsod"` at the final reveal, `"sticky"` after
— and a host's console can switch it live. Anything other than the four
words reads `sticky`. **Every phone glitches** for a moment when the
level changes. `alerts:` is read from the first file's header only; lint
`L1210` warns when it's elsewhere or is no dotted path.

## Effect text

A line can perform instead of just reading. It is **effect text** when
its manner (the parenthetical after the name) contains one of the
effect words — `glitch`, `glitching`, `glitched`, `static`, `corrupted`,
`corrupt`, `scream`, `screaming`, `screams`, `distorted`, `garbled`,
`error`, `flicker`, `flickering`, `bsod` — or its speaker has `crawl:
fx`:

```loom
Truther Download (glitch): THEY ARE LYING TO YOU.
Narrator (static): The screens roll.
Wren (quietly, flickering): Is anyone there?
```

On the phone an effect line scrambles into place, flickers and shakes,
slower on purpose; under Reduce Motion it shows at once with a still
look. Alerts and takeovers are effect text by themselves. An ordinary
manner (`quietly`, `whispering`, `through tears`) is a note to the
performer, and now shows on the phone after the name, in italics.
Other scripted lines type out fast, and only when they arrive in a room
the guest has open: typed chat, agent replies, the backlog, other rooms
and a reload are instant.
