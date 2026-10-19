---
title: Live verbs — building game rules from primitives
section: Live Shows
order: 33
keywords: arm, two taps, tap again to fire, not your button, king hit, king fallen, capture, release, escape, reveal, respond, join, defect, betray, enroll, scan, signal, fire, named event, game, verbs, promote, cast, move, add, remove, reply, when, watcher, primitives, rules, hooks, do, INTERACTION, interaction, button, story rule, arguments, with, for, cue sheet, act, acts, anytime, director page, sequence, repeat, refused, not taken, branch, fallback, chess, chess won, the King, majority, limit, power, screens, slide, overlay, tv, blackout, award, restrict, unrestrict, restricted, marked, quarantine, pin, unpin, sticky, notice, pinned, staff quest, character quest
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
| **Reach** | `restrict guest to The Tube` / `unrestrict guest` — how much of the app they have | `when restricted for guest:` / `when guest.restricted:` |
| **Notices** | `pin "!🚨 Go to the Internet." for guest` / `unpin for guest` — a sticky line above their feed | — |

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
| `restrict who [to Place, Place]` / `unrestrict who` | shrink a participant's app to DMs + the named places, read-only, no buttons — and lift it (below) |
| `pin "text" [in room] [for who]` / `unpin [in room] [for who] ["text"]` | a sticky notice above a stream, and taking it down (below) |
| `start quest X for who` … | the quest log — for a guest, a scope, or a **character** ([quests](quests.md)) |
| `do verb args` | any custom verb — show control, a `.luau` extension |

## Restricting a participant

Capture is a place; **restriction** is a leash. `restrict guest` keeps
the phone signed in but shrinks it: the guest keeps their own feed
(where a pin for them lands), their DMs and private threads and their
pinned Quest Log / Codex / Wallet; every authored room and every place
the story didn't name is gone, every story button is
off (the server refuses `INTERACTION` presses, room check-ins and room
posts while it lasts), the wallet stops (no send, request, pay or
refuse a request, offer, accept, stimulus, grant or 🧊 freeze — not
the same as being frozen, which still lets coin in and a sale go
through; declining an offer and cancelling their own still work), story
cards they already hold (`show …`) stay answerable, and the app
greys out with a ⛔ tag. `restrict
guest to The Tube, The Internet` keeps those places visible too —
read-only, and **by name even if they are hidden**: naming a place is
opening it for them, so name only what they may see. Wherever they are
standing stays visible as well. `unrestrict guest` gives everything
back. A guest button marked `restricted: allow` stays on through a
restriction (Bathroom Mode and its Back, say):

```loom
INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  restricted: allow
```

```loom
when mark_for_reinstallation for program:
  set program.marked = true
  restrict program to The Tube, The Internet
  pin "!🚨 GO TO THE INTERNET. An Antivirus will escort you through the Tube." for program
  pin "🚨 Escort {program.name} to the Internet — {reason}." in quarantine for program

when unmarked for program:
  set program.marked = false
  unrestrict program
  unpin for program "✅ The mark is lifted."
  unpin in quarantine for program "✅ {program.name}: {how}."
```

The flag is `who.restricted` (readable in conditions, settable from
Run through the mod API's `set`), and the edge fires `restricted` /
`unrestricted` for them — `when restricted for guest:` /
`when unrestricted for guest:` — once per real transition, so a second
`restrict` is harmless. Performers see a **⛔ restricted** pill on
that guest's card and on their thread's line in the guest list. In Run,
directors see **⛔** beside the guest on the Stage, the rail and the
Roster, and the guest's Inspector has a **Restricted** field:
**Restrict** / **Unrestrict** is a plain `restrict` / `unrestrict` (no
place list) that runs only the `restricted` / `unrestricted` rules — not a
story's own mark or unmark event, whose flags and pins it leaves alone —
and asks first for a real guest on a live run. *Trapped in the
Internet* uses it for a program **marked for reinstallation**: marked
on the spot by a host's verdict, restricted to the Tube and the
Internet, escorted by an Antivirus, and freed by the capture, the
release, or 🩹 Unmark.

## Sticky notices

`pin "text"` puts a line **above** a stream that stays until the story
takes it down — a standing order, an escort task. Where it goes:

- `pin "…" for guest` — above that one guest's own feed (their lobby);
  with no `for`, the bound subject of the rule.
- `pin "…" in quarantine for guest` — above an authored room or a
  place, for whoever reads that room (a staff back-room's readers are
  its performers and the directors, exactly like `broadcast … to
  channel(hosts)`). The `for` is the pin's **key**: one pin per
  (person, room), so pinning again for the same person replaces it.
  Leave `for` off in a rule with no subject — a story rule such as
  `when lockdown:`, or a `Night.*` watcher — for the room's one unkeyed
  pin; inside a `for program` rule a pin with no `for` is still keyed
  to that program.
- A leading `!` makes it an **alert** as well — chime, buzz, banner —
  and the `!` is not shown.
- A leading `!!` makes it a **takeover**: an alert that covers the
  whole phone with its text, slowly flashing, until the story unpins
  it (`pin "!!GO TO THE LIVING ROOM"` … `unpin "💃 Dance."`). There is
  no close button, so always unpin it.

`unpin [in room] [for who] ["text"]` takes the matching pin down and
posts the optional text as a system notice in its place (default
*📌 Cleared.*). A bare `unpin` is prose; name at least a room or a
person. Pins and unpins are ordinary journaled messages, so a reload
or a restart rebuilds the rail exactly.

## Quests for the cast

The four quest statements take a **character** as well as a guest or a
scope — `start quest Run The Bingo for Clippy`, `complete quest The
Audit for CRA Agent Software "…"` — and land in that performer's own
pinned **Quest Log** room in their booth. The mirror is
`<Character>.quest.<slug>` (`Clippy.quest.run_the_bingo`), and a story
rule hears the step — `when Clippy starts quest Run The Bingo:` /
`completes` / `fails` — exactly as `when program completes quest X:`
does for a guest ([quests](quests.md)); the name in the hook is a
label, not a filter — the rule fires for whoever takes that step, so
use a quest only the cast holds, or check `self`. `… for everyone` stays
guests-only: `fail quest X for everyone` at a deadline never touches
the cast's. Staff quests are how a show briefs its performers in the
app instead of on paper.

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
edited live at `/reinstall/map` (see [the house map](39-house-map.md)).

**Screens** follow cues too. A `cue` in the `screens_`, `terminals_`
or `tv_` family (`cue screens_bingo`, `cue tv_award_most_trusted`,
`cue screens_blackout`) puts a slide or a notice on the wall terminals
and the TV — `screens_` on both, the others on one. `blackout`,
`go_to_living_room` and `alarm` are full-screen notices; `screensaver`
clears back to the base view; any other value is a slide (a
`public/slides/<cue>.png` in the terminal app, else a text card; on the
TV a `public/slides/<cue>.mp4` plays first when there is one). A
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

### Whose button, and when: `by:` and `while:`

A show with many performer buttons can say whose each one is, and when
it is on offer:

```loom
INTERACTION bingo winner
  label: 🎱 Bingo winner
  who: performer
  by: Clippy
  while: Night.phase == "bingo_results"

INTERACTION go to the bathroom
  label: 🚻 Bathroom Mode
  who: guest
  while: program.afk != true
```

`by:` names characters or a GROUP (all its members), comma-separated; a
character that owns a `when` for the event counts too, so a trait's
`when vouch for program:` makes every host's card lead with **Vouch**. A
performer's guest card shows their own buttons that are on offer now and
folds the rest under **More…** (buttons with no `by:`, and their own out
of phase).

**`by:` is enforced.** The server refuses a press of a `by:` button from
any other booth (403 *not your button: … is for …*), and that booth's
card never shows it. A button with no `by:` stays anyone's, a
moderator's booth may press any, and a director's quick-fire from Run
always fires it. Because the server keeps other booths out, a rule for
a `by:` button can be a plain story rule: a quick-fire has no actor, so
a story rule fires once where a hook on a trait would fire once per
character that has it.

`while:` is not enforced (the `when` still decides what happens). It is
a condition: on a performer's button it reads the world with `self` =
the performer; on a guest's it is evaluated for that guest (the ROLE's
name, `program`, is them), and a false one is **hidden** from their
pass — so **Back from the bathroom** only shows while they are away.

### Two taps for a press with no way back: `arm:`

```loom
INTERACTION radio_combo_b
  label: 💥 Patch: Combo B is in
  who: performer
  by: Antivirus
  arm: true
```

`arm: true` makes a button **arm then fire**: the first tap arms it (it
turns black and says *Tap again to fire*), a second tap between 300 ms
and 4 s later fires it, and it disarms by itself after that or when the
page is left. Use it on a performer's or a guest's button whose press
can't be undone — one that ends the night, trips an alarm, hands over a
secret or plays a once-a-night moment. It is the same arm model as the
Director page's cue sheet. The server never refuses an unarmed press:
`arm:` is the app's guard against a stray tap, not a lock.

The `who: admin` interactions are also the Director page's **cue sheet**,
in the order you declare them. Add `sequence: false` to one a machine
fires (a game, a door sensor) or that is only a hardware fallback: the
sheet still ticks it when it fires, but it never becomes the sheet's
*last* cue or its suggested *next* one. Add `repeat: true` to one the
director presses again and again in one stretch (a result per question):
the sheet keeps suggesting it as *next* after it fires, while its `while:`
holds.
An admin cue's `while:` names the branch of the night it belongs to:

```loom
INTERACTION trabolta_recounts
  label: 🏍 After the dance: weakened Trabolta recounts
  who: admin
  while: Night.ending == "disabled" and Night.rank_round != 3
```

The sheet only suggests it as *next* while the condition holds, so the
suggestion follows the ending the night is on. It never hides the cue or
stops a press: the cue's own `when` still checks for itself. Write that
`when` to refuse a press out of turn with a line to the staff room and
nothing else:

```loom
when the_verdict:
  if Night.r3_closed != true:
    broadcast "⚖ Not yet: 🍎 Bobbing for Truth, then 📄 truth.txt first. Nothing happens." to channel(hosts)
  else:
    …
```

A press that does nothing, or nothing but post to a staff room (an
authored `kind: faction` CHANNEL whose GROUP no guest may join), is read
as **refused**: the sheet doesn't tick it or make it *last*, and the
director's phone says *Not taken*. Bookkeeping doesn't count either: a
world variable whose last name starts with `_` (`Night._ask_at`) is the
cue sheet's own, so a cue that asks first can note the time in one and
still read as refused:

```loom
when resurrection:
  if Night.ceremony_done != true and (Night._ask_at == 0 or Time.elapsed > Night._ask_at + 30):
    set Night._ask_at = Time.elapsed + 1
    broadcast "🎃 The last award isn't presented yet. Press G11 again within 30 seconds to end the show anyway." to channel(hosts)
  else:
    …
```

A cue no rule hears (only the
show-control bridge reacts to it) always counts as fired. A cue whose every `when` binds a
person (`when award most trusted for program:`) gets a **who?** picker
and an optional value (`{value}` in the body) — an awards ceremony is a
run of these ([the Director page](run-mode.md)).

### Acts: `act:`

A long night reads better in sections. An `act:` line on an admin cue
opens an **act** on the Director page and the director's phone; every
later `who: admin` cue, in declaration order, belongs to it until the
next `act:`:

```loom
INTERACTION call_to_the_desktop
  label: C1/V1 · 📣 Call everyone to the Desktop
  who: admin
  act: B · Act I: the Desktop, Bingo and the first truth

INTERACTION start_the_bingo
  label: V2 · 🎱 Start Computer Bingo (20 min)
  who: admin

INTERACTION restore_the_lights
  label: 💡 Restore the house lights
  who: admin
  sequence: false
  act: Anytime
```

`start_the_bingo` is in act B with no line of its own. A short code
before ` · ` (here `B`) is the act's code on the stepper. The name
matches loosely (case, `_`, `-`, spaces), so a second `act: Anytime`
**rejoins** the first rather than making another, and acts are ordered by
where each name first appears. An act whose cues are all `sequence:
false` is an *anytime* act: never the night's current act, always on
hand. Cues before the first `act:` form one unnamed act; a story with no
`act:` is one act. `act:` on a performer's or guest's button is ignored.

**Acts never change NEXT, LAST, a refusal or what a press does**: they
only group the page (the current act is the one holding NEXT, else
LAST). So moving a cue to another act is a one-line edit that renumbers
nothing.

### A button as a fallback for a machine

The same event can come from a device, a performer and a director. In
*Trapped in the Internet* the **King** plays chess on a wall terminal
outside the real server-room door, and that terminal posts `chess won`
itself when a program checkmates him. When it can't (it died mid-mate,
the Wi-Fi dropped), a host who saw the mate presses a button on the
winner's card, and if nobody could, the director fires `chess won` from
the cue sheet, naming the winner. The prize is knowledge — the code to
the real server-room door's keypad, a secret codex entry — so the rule
needs a recipient:

```loom
INTERACTION beat the machine
  label: ♟ They beat the machine
  who: performer

INTERACTION chess won
  label: ♟ They beat the King: the door code (fallback)
  who: admin
  sequence: false

when beat the machine for program:
  fire chess won for program

when chess won for program:
  if program.name == null:
    broadcast "♟ A win with no winner named: press ♟ on the winner's card." to channel(hosts)
  else if program.codex.the_door_code == true:
    broadcast "♟ {program.name} already has the door code: nothing changed." to channel(hosts)
  else:
    unlock The Door Code for program
    broadcast "♟ {program.name} beat the King: the door code is in their Codex." to channel(hosts)
```

Because the rule's head names a subject (`for program`), the cue sheet
and the director's phone ask **who?** before firing it. A device that
can report (the door terminal, a sensor through the show-control bridge)
fires the same names — `chess won`, `chess lost`, `chess drawn` — and
the story treats them alike. The event server fires some itself: a hit
on the King in a reinstallation game is `king hit` (and `king fallen`
at 0) for the guest who landed it, after the server has written his new
health into the story (`Night.king_hp`). The rule only narrates; it
never changes the health itself. Write the rule so a duplicate is harmless
(here a second win changes nothing but a note), and never let a machine
drive something a person relies on for safety: the real door's lock is
standalone, and the story only hears that it opened
(`server_door_opened`). Give the director a
manual button for anything a crowd decides too — the show's *Force the
majority* cues settle a vote ghosts would otherwise block, once.
A story with a [currency](currency.md) hears its wallet the same way:
`transfer_received`, `transfer_denied`, `stimulus` … are named events
the server fires; your rules narrate them and never move coin.

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
LOCATION's exact name first ("the start bar" arrives as `The Start Bar` — the
same for an event fired from Run). `limit:` caps uses per run; a use
the story answers with words only (a refusal) doesn't count, and
neither does one tried while the show is **paused**: the character's
words still post, but every power answers *doors are closed* until the
doors open again. Every use
is journaled `by: agent:<Character>` and visible to the directors, so
the count survives a server restart; a director firing the same event
from Run never spends one. The `description:` is what the model reads, so say what the
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
