---
title: Live shows — people, places, casting
section: Live Shows
order: 30
keywords: founding, faction mode, founded faction, factions, majority_faction, faction_of, faction_name, faction_founder, L1220, badge, badges, L1219, lobby hidden, hidden lobby, live, judge, wanted, wanted board, reinstall, archive, majority, sides, crews, crew, recruit, recruited, founded, unaligned, party favour, L1216, reserved, admin, host, host part, alerts, alert level, interrupt, moment, balloon, sticky, dialog, bsod, blue screen, glitch, crawl, fx, effect text, manner, invitation, claim, for guests, went home, gone, persona, present, PERSON, ROSTER, cast, COHORT, LOCATION, participant, capacity, swings, roster, casting, immersive, ROLE, GROUP, hidden, someone joins, when, participant app, title, check in, checked_in, checkin, sign, qr, header, watch, countdown, director page, glance, board, lock, lock:, locked, locked phone, lock screen
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
  A picture the app ships is `picture:<file>` (`picture:trabolta.svg`, a
  lower-case svg / png / webp in the app's `pictures/`). An option may end
  in **`when <condition>`** (the character as `self`) to swap the picture
  live: `avatar: picture:trabolta.svg | picture:trabolta-broken.svg when
  self.broken == true` shows the second while it holds (the last true
  `when` wins), else the first. Give one option with no `when` as the
  default; when every option has one, the first is the default.
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
  isn't a host (nor a player, below) can still **call** chosen cues:
  `by: <Character>` on an admin cue puts it on that booth's 🎤 cue bar
  ([live verbs](live-verbs.md)).
- **`player: true`** on a CHARACTER makes it a **player**: a performer
  part that plays the night's game like the guests do (*Trapped in the
  Internet*: Clippy and the four Antivirus). Its booth is lean: it learns
  only its own buttons (a `by:` button for somebody else never shows),
  the countdowns guests see (`for guests`), no act letter, and only the
  staff rooms of a GROUP it is in. It gets a **Mission** home off its
  OBJECTIVEs (the first live one, and its `go:` room), score tiles from
  the header's `stat:` lines (below), and a row on the Trust Chart beside
  the programs when it declares a numeric `trust` slot, marked as staff.
  A player **never calls cues**, even when an admin cue's `by:` names it:
  the hosts and the directors call them (lint **`L1222
  PlayerCallsCue`**). Lint **`L1224 PlayerNotAPart`** warns when nobody
  can sign in as it.
- **`private: covert, defiance`** on a CHARACTER lists slots no agent
  ever reads (a request's vars, the facts document, what he recently
  saw) and no other character's `badge:`, `watch:` or `stat:` line shows:
  a player's sneaky defections live there. Its own booth may show one on
  a `stat:` line. Lint **`L1225 PrivateSlotRead`** warns on a `watch:` /
  `countdown:` item or another's `stat:` condition that reads one.
- **`stat: self.<path> as <glyph> <label>[, for <who>][, while
  <condition>]`** (a repeatable header line) is a score tile on a booth:
  `stat: self.score as ⭐ Points`. `<who>` is `players` (the default),
  or CHARACTER names and GROUPs; the value and the `while` are read with
  `self` = the booth's character. An unset numeric slot shows 0. A line
  that doesn't parse is lint **`L1223 StatLineInvalid`**.
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
`facts.json` key can name an agent-voiced character to rule on every
filing that isn't an exact match with `judge: <Character>` in the
header (*Trapped in the Internet*: `judge: Trabolta`). An exact match is
accepted at once; the rest wait in a queue his worker takes one at a
time (a guest talking to him goes first), and whatever he can't rule
by the round's settle falls back to the house rule (a near miss
credited, a plain miss a lie at 100, a guess below); [cards &
widgets](widgets.md) has how.

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
eight at once (an empty crew frees its place), one per founder. A crew is **never a side**: it never
touches a GROUP's members, `who.group`, a majority, or what an agent-voiced
character hears. The story hears `founded` (the founder, with `crew`), `join`
(a new member, with `crew`; a side's `when who joins <Side>:` never does)
and `unaligned` (someone left their side, with `side`). Directors and hosts
can rename or dissolve a crew.

### Founded factions: `founding:`

One more header line turns crews into **factions** that race like your
sides:

```loom
majority: count([p for p in Persons where p.gone != true and p.persona != true]) / 2 + 1
founding: Night.truther_sent == true and Kernel.majority_reached != true and program.cleared == true
```

- **`founding: <condition>`** (read with the founder bound as `program` /
  `self`) says when a program may found one. With it the story is in
  **faction mode**: a founded faction and every declared, joinable side
  are peers in one race, and membership is **one faction at a time** —
  founding or joining a faction leaves your side (`unaligned`), joining a
  side (`join`, `defect`, `add`, a yes to a recruit) leaves your faction.
  A `joinable: false` group (your hosts) never touches a faction.
- **A founder leaving disbands it**; its members go back to neither. A
  side's leader can't found or join one; a restricted or captured program
  can't either, and the same holds for a yes to an invitation (a founder's
  or a leader's yes is void; founding closes your own open invitations).
  At most eight live at once (a disbanded one frees its place), one live
  one per founder. A guest may also walk in from the Factions list
  (`join`, with `crew`).
- **Who sees the counts:** each member sees their own faction's head
  count, the `majority:` line and how many more it needs; never anyone
  else's. People cards show a faction only to its own members, or on its
  founder or a side's leader.
- **The race, read by the story:** `majority_faction()` is the faction
  over the line now (else null), `faction_of(who)` the faction someone is
  in, `faction_name(id)` its name, `faction_founder(id)` its founder (a
  side's leader). With no `founding:` line all four read null. The
  majority is yours to latch, as before:

```loom
when Night.final_round == true and Kernel.majority_reached != true and majority_faction() != null:
  set Kernel.majority_reached = true
  set Kernel.majority_id = majority_faction()
  fire settle_majority
```

Use a direct count for `majority:` (above) rather than a `Night.present`
kept by another rule, which lags one pass behind a late arrival. Keep a
faction's name (it is typed by a guest) out of anything an agent-voiced
character hears. Lint **`L1220 FoundingInvalid`** flags a `founding:` that
is no expression. With no `founding:` line, crews stay friend clubs.

## The Wanted board, the reinstallation gate, the locked phone, finished threads

Four more header lines (in the first file, like `watch:`):

```loom
wanted: program.marked as program.marked_for by program.escort_by, for Antivirus
reinstall: program.marked == true or program.corrupted == true or Night.ended == true
lock: program.corrupted == true and Night.banish != true and Night.ended != true
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
- **`lock: <condition>`** (wave 26), read per guest like `reinstall:`,
  **locks** a guest's phone while it holds for them. The phone shows a
  lock screen: the current objective, a read-only copy of the
  Installation Wizard's thread, the pass and the `restricted: allow`
  buttons (Bathroom Mode). The server refuses every state-changing guest
  route (`403 locked`), DMs, the codex, the wallet, check-ins, crews and
  every other `act` included, except session housekeeping that posts
  nothing into the story (sign-in, resume, rejoin, badge linking, push, the
  home-screen check and log out). Reads still work. A director's Run →
  Players or a terminal piloting a locked guest is refused the same way. The lock is never journaled: it follows the story's state, so
  release (`set program.corrupted = false`) lifts it on the next update.
  It is for guests only (a player's booth never locks), so nothing the
  story waits on should need a locked guest's answer. Pair it with `ack:
  none` on the capture's moment ([Broadcasts](broadcast-improv.md)).
- **`archive: <LOCATION | CHANNEL | CHARACTER> when <condition>`**
  (repeatable) moves a guest's finished thread, once the condition holds
  for them, down into *Other rooms* (an arrival DM after they're through the
  door). It still exists and still works.

Lint **`L1216 HeaderLineInvalid`** flags a `wanted:` / `archive:` /
`reinstall:` line that doesn't parse or names nothing (a warning), and a
`lock:` line that is no expression (an error).

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
  `secret:` slot, a `secret: true` CHARACTER or a CHARACTER's `private:`
  slot is never shown: lint
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
