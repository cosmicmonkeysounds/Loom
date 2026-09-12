# Writing in Loom

*A complete guide for writers — from your very first line to a live,
interactive show.*

---

## Before you start

**You do not need to know how to program.** You do not even need to have
written a screenplay. If you can write a conversation between two people,
you can write in Loom. This guide starts there and builds up slowly.

**What Loom is.** Loom looks like a script. Underneath, it is also a
little machine that *plays* your story — it remembers what the audience
chose, tracks how characters feel, branches when you want it to branch,
and (when you're ready) runs a live event with real people in a real
room. You write one file; it serves the reader, the director, the
performers, and the runtime all at once.

**What a `.loom` file is.** A plain text file whose name ends in
`.loom`. You can write it in the Loom editor, or in any text editor. A
**project** is just a folder of these files.

**Three things to know before anything else.**

1. **Names are words.** A scene can be called `The Front Gate`. A
   character can be called `Ivo Marsh`. Capital letters and spaces don't
   have to be exact when you refer to them later.
2. **Instructions are plain verbs.** When you want the story to *do*
   something — remember a number, play a sound, branch — you write a
   lowercase verb at the start of a line: `set`, `if`, `cue`, `fire`. No
   brackets, no punctuation to memorise.
3. **Reactions start with `when`.** Anything that should happen on its
   own — when a guest walks into a room, when a number crosses a line,
   when you fire an event — is a `when` block.

**How to read this guide.** Each part adds one new idea and shows it
working. Read in order the first time. Later, use it as a reference —
the [cheat sheet](#appendix-a--cheat-sheet) at the end lists every form
on one page.

| Part | You'll learn to… |
|---|---|
| [1](#part-1--your-first-scene) | Write dialogue, action, and a scene |
| [2](#part-2--branching-giving-the-audience-a-choice) | Offer choices and branch the story |
| [3](#part-3--memory-values-and-conditions) | Remember things and react to them |
| [4](#part-4--variety-making-lines-feel-alive) | Vary lines so nothing feels canned |
| [5](#part-5--characters) | Give characters feelings, memory, and goals |
| [6](#part-6--when-making-the-story-react) | Make the story react on its own |
| [7](#part-7--traits-writing-less-by-reusing-shapes) | Reuse behaviour so you write each idea once |
| [8](#part-8--numbers-stats-pools-and-progression) | Add stats, health, levels, skill trees |
| [9](#part-9--cues-sound-light-and-custom-verbs) | Trigger sound, light, and effects |
| [10](#part-10--organising-a-project) | Split a big story across many files |
| [11](#part-11--live--interactive-shows) | Run a live event with a real audience |

Let's write something.

---

## Part 1 — Your first scene

### 1.1 The two rules of a script

1. **A name with a colon is a person speaking.** What follows the colon
   is what they say.
2. **A paragraph on its own is stage action** — something that happens,
   or something we see.

```loom
Ivo: It hasn't rung in three days.

A bell rope swings in the gloom.
```

`Ivo` is the speaker. *It hasn't rung in three days.* is his line. The
sentence about the bell rope is action — nobody says it; it just happens.

If a speech runs long, put the name and colon on their own line and
indent the lines underneath. The screenplay form — the name in CAPITALS
on its own line — works too; they are the same thing:

```loom
Ivo:
  It hasn't rung in three days.
  Three days, and the tide still comes in.

IVO
  It hasn't rung in three days.
```

> **Indentation carries meaning.** Lines pushed to the right belong to
> the line above them. Two spaces per step is the convention used
> throughout this guide. Use spaces, not tabs.

### 1.2 The smallest complete file

A real file needs a **title** and at least one **beat**. A *beat* is a
chunk of story — think of it as a scene or a moment. Open a beat with two
equals signs, `==`, and a name. Any words will do:

```loom
# The Lighthouse

== The Bell Tower at Dawn

Ivo: It hasn't rung in three days.

A bell rope swings in the gloom.
```

- `# The Lighthouse` — the title. (The `#` just marks the title line.)
- `== The Bell Tower at Dawn` — begins a beat with that name. Everything
  after it, until the next `==`, belongs to this beat.

This is a complete, playable Loom story. Short, but complete.

### 1.3 Parentheticals — a hint to the performer

To tell the actor *how* to say a line — quietly, angrily, with a laugh —
put it in parentheses just before the colon, or on its own indented line
above the words:

```loom
Ivo (quietly): It hasn't rung in three days.

Ivo:
  (quietly)
  It hasn't rung in three days.
```

`(quietly)` is a **parenthetical**. It's guidance for whoever performs the
line; it isn't spoken aloud.

### 1.4 Narration

Any paragraph on its own is narration. If you'd rather *label* narration
— useful in a long scene with many speakers — use `Narrator:`. The
runtime treats it exactly like a bare paragraph: it's the story's voice,
not a character's.

```loom
Narrator: The gate is open. It should not be.
```

### 1.5 Where are we? Scene headings

Screenplays often announce a location in a bold line like `INT. LIGHTHOUSE
- DAWN` ("INT." means *interior*; "EXT." is *exterior*). Loom recognises
these as signposts for readers and directors:

```loom
== The Bell Tower at Dawn

INT. LIGHTHOUSE - DAWN

A bell rope swings in the gloom.

Ivo (quietly): It hasn't rung in three days.
```

Good to know: in Loom, the *beat* (`==`) is what actually organises the
story — the scene heading is just a label inside it.

### 1.6 Who's in the scene, and where

Right under a beat's `==` line, you can note who's present and the
setting. These indented `key: value` lines are the beat's **contract**:

```loom
== The Bell Tower at Dawn
  cast: Ivo, Player
  setting: Lighthouse

Ivo (quietly): It hasn't rung in three days.
```

- `cast:` — the characters in this beat. (`Player` is the audience/reader.)
- `setting:` — where it takes place.

Notice these keys are lowercase. That's how Loom tells a `key: value`
note from a `Name: line` of dialogue — **speakers start with a capital
letter; keys don't.**

**You now know enough to write a linear scene.** Next: letting the
audience change what happens.

---

## Part 2 — Branching: giving the audience a choice

### 2.1 A choice

Put a `*` at the start of a line to offer the audience a choice:

```loom
Ivo (quietly): It hasn't rung in three days.

* Ring the bell.
* Leave quietly.
```

The reader sees two options and picks one. Whatever is indented **under**
a choice happens when they pick it:

```loom
* Ring the bell.
  The sound carries across the rocks.
* Leave quietly.
  You slip out before he can turn around.
```

### 2.2 Going somewhere: diverts

A story with more than one moment needs a way to move between beats.
That's a **divert**, written `->` ("go to"):

```loom
== The Bell Tower at Dawn

Ivo: It hasn't rung in three days.

* Ring the bell.
  -> Ringing
* Leave quietly.
  -> END

== Ringing

The sound carries across the rocks.

Ivo (stunned): You... rang it.

-> END
```

- `-> Ringing` jumps to the beat named `Ringing`.
- `-> END` ends the story.

Beats can be in any order in the file — a divert finds its target by
name. And the name is forgiving: `-> ringing`, `-> the bell tower at
dawn`, and `-> The_Bell_Tower_at_Dawn` all reach the same beat. Loom
ignores capital letters and treats spaces, underscores and hyphens
alike.

### 2.3 The starting beat

When a project has several beats, Loom needs to know which one starts.
Name it at the top with `start:`:

```loom
# The Lighthouse
start: The Bell Tower at Dawn
```

If you don't write `start:`, the first beat in the file is the start.

### 2.4 Once vs. sticky choices

- `*` is a **once-only** choice — after the audience picks it, it's gone.
- `+` is a **sticky** choice — it stays available on later visits.

```loom
+ Ask about the bell.
  -> Ask About The Bell
* Storm out.
  -> END
```

Use `+` for things like "Ask another question" that should remain on the
menu, and `*` for one-time decisions.

### 2.5 Hidden text on a choice

Sometimes the *button* should read one way and the *story* another. Wrap
the extra words in square brackets `[ ]` and they show up only after the
choice is taken:

```loom
* Leave quietly.[ But you wonder what you're walking away from.]
  -> END
```

The audience sees the button **Leave quietly.** After they click it, the
narration reads: *Leave quietly. But you wonder what you're walking away
from.*

### 2.6 Nesting choices

Anything under a choice can include *more* choices, dialogue, action, and
diverts — as deep as you like:

```loom
* Confront him.
  Ivo: You shouldn't have come.
  * Apologise.
    -> Make Up
  * Hold your ground.
    -> Standoff
* Say nothing.
  -> END
```

### 2.7 Go and come back: tunnels

A **tunnel** visits a beat and then returns to where it left off. Call it
with parentheses, and end the tunnelled beat with `return`:

```loom
(Inspect The Rope) ->

Ivo: Done looking?

== Inspect The Rope

The rope is frayed near the top.

return
```

Use tunnels for reusable asides — examining objects, side conversations —
that shouldn't lose the audience's place. (`<-` is the older spelling of
`return`; both work.)

**You can now write a branching story.** Next: making it remember things.

---

## Part 3 — Memory: values and conditions

A branching story is good; a story that *remembers* is better. Loom keeps
track of numbers, facts, and what the audience has done.

### 3.1 Dropping a value into text

Curly braces `{ }` insert a value into a line:

```loom
Ivo: You have {coins} coins left.
```

If `coins` is 3, the audience reads: *You have 3 coins left.*

### 3.2 Changing a value: `set`

To change a value, write `set` at the start of a line:

```loom
set coins = 10
set coins += 5
set coins -= 2
```

- `=` gives a value.
- `+=` adds to it; `-=` subtracts.

So after those three lines, `coins` is 13. Record facts the same way:

```loom
set rang_the_bell = true
```

> **How Loom tells an instruction from a sentence.** An instruction is a
> lowercase verb at the *start* of a line, followed by what that verb
> needs. Ordinary sentences start with a capital letter, so *Set the
> table for two.* is narration and `set the table for two.` — with no
> `=` — is narration too. If you ever need to start narration with a
> lowercase verb that Loom might mistake, begin the line with `\`.

### 3.3 Reacting to values: `if`

Show something only when a condition holds, using `if` and a colon. Add
`else if` for more cases and `else` for "otherwise". Everything indented
under an arm plays only when that arm's condition is true:

```loom
if coins > 5:
  Ivo: Keep your coins. You'll need them.
else if coins > 0:
  Ivo: That won't get you far.
else:
  Ivo: Broke, then. Figures.
```

The words you can use in a condition:

| You write | Means |
|---|---|
| `>`  `<`  `>=`  `<=` | greater / less than (or equal) |
| `==` | is equal to |
| `!=` | is not equal to |
| `and` | both must be true |
| `or` | either can be true |
| `not` | flips true/false |

```loom
if coins > 5 and not rang_the_bell:
  ...
```

> `=` changes a value; `==` compares. `set x = 5` assigns; `if x == 5:`
> tests. Swapping them is a classic slip.

### 3.4 Names inside a condition

Inside a condition, a `set` path, or `{ }`, a name can't contain a space.
Write a multi-word name with underscores, and Loom will know who you mean:

```loom
set Ivo_Marsh.trusts.Player += 10

if guest.group == The_Collectors:
  Ivo: You'd like her keys, I expect.
```

### 3.5 Living values: `let`

A `let` gives a name to a *formula*. It's not a one-time calculation — it
stays true to its definition and updates itself whenever the pieces
change:

```loom
let trusted = Ivo_Marsh.trusts.Player > 50
```

Now `trusted` is always up to date, and you can use it anywhere:

```loom
if trusted:
  Ivo: I knew you'd come.
```

Put a `let` at the top of your file (near the title) to make it available
everywhere, or inside a beat to keep it local to that beat.

### 3.6 What has the audience already done?

Loom keeps a running record — a **ledger** — of everything that's
happened. A few questions you can ask it, right inside a condition:

| You write | Answers |
|---|---|
| `played(Ringing)` | Have we ever played the `Ringing` beat? |
| `visits(Ringing)` | How many times? (a number) |
| `since(bell_rung)` | How long since that happened? |

```loom
if visits(Ringing) == 1:
  Ivo: First time here, I see.

if since(bell_rung) < 30s:
  The echo hasn't faded yet.
```

(`30s` means 30 seconds. You can write `s` for seconds, `m` for minutes.
A beat name with spaces goes in quotes: `visits("The Bell Tower")`.)

**Your story can now remember and react.** Next: keeping it from sounding
repetitive.

---

## Part 4 — Variety: making lines feel alive

A line the audience hears twice shouldn't read identically both times.
Loom has small tools for this.

### 4.1 Cycles and shuffles

`cycle` steps through options in order, one per visit. `shuffle` picks one
at random. Separate options with `|`:

```loom
Fisher:
  cycle Quiet night. | Stars are out. | Tide's calm.

Dockhand:
  shuffle Storm's close. | Sky's wrong. | Time to tie down.
```

The first time the fisher speaks he says "Quiet night."; next time, "Stars
are out."; and so on. The dockhand's line is random each time.

### 4.2 First time, next time, finally

`each visit:` lets you write a beat that changes as it's revisited:

```loom
each visit:
  first:
    Ivo: Who are you?
  then:
    Ivo: You again.
  finally:
    Ivo: I'm tired of your questions.
```

- `first:` — plays on visit 1.
- `then:` — plays on visits after that.
- `finally:` — plays from the third visit on.

### 4.3 Before and after a turning point

`after` swaps content once something becomes true. Pair it with
`otherwise:` for the "before" version:

```loom
Mara:
  after Mara.knows.the_truth:
    I've known since the orchard. I just couldn't say it.
  otherwise:
    I don't know what you mean.
```

Before `Mara.knows.the_truth` is true, the audience gets the denial.
After, they get the confession — permanently.

### 4.4 Choosing by value: `match`

When a value has several possible states, `match` picks the matching arm:

```loom
match weather:
  storm:
    The rain comes sideways.
  fog:
    You can't see the harbour wall.
  clear:
    Gulls wheel over a flat sea.
```

**Your lines can now vary naturally.** Next: real characters.

---

## Part 5 — Characters

So far, speakers have just been names. Loom lets you make them into real
**characters** — with feelings, memory, and goals — so the story can react
to *them*, not just to what the audience clicked.

### 5.1 Declaring a character

Write `CHARACTER`, a name (any words), and (indented) some properties.
Declarations are the one place Loom shouts — `CHARACTER`, `LOCATION`,
`GROUP` in capitals, like a slugline — so they can never be mistaken for
a line of dialogue:

```loom
CHARACTER Ivo Marsh
  voice: baritone
  home: Lighthouse
  hp: 80
```

Properties are just `key: value` facts about them. You choose the keys.

### 5.2 How they feel about you: disposition

Characters can hold feelings toward others on a scale. The built-in ones
are `trusts`, `respects`, and `fears`. Write the feeling, who it's about,
and the value `N of M` (N out of a maximum of M):

```loom
CHARACTER Ivo Marsh
  trusts Player: 30 of 100
  respects Player: 50 of 100
  fears Player: 0 of 100
```

Ivo starts trusting the Player 30 out of 100. Nudge these with `set`:

```loom
set Ivo_Marsh.trusts.Player += 20
```

### 5.3 What they know: `knows`

A character can carry a little sheet of facts — their **knowledge**. List
them under `knows:`, each with a type and a starting value:

```loom
CHARACTER Ivo Marsh
  knows:
    met_player: bool = false
    bell_origin: unknown | suspects | confirmed = unknown
```

- `bool` means true/false; `= false` is the starting value.
- A fact with several stages is written with `|` between the options, so
  `Ivo_Marsh.knows.bell_origin` moves through `unknown` → `suspects` →
  `confirmed` as your story reveals things.

Update knowledge like any other value: `set Ivo_Marsh.knows.met_player =
true`.

### 5.4 Goals

A **goal** is something a character is trying to achieve. Loom tracks it as
a little state machine — it becomes active, then completes or fails on the
conditions you set:

```loom
CHARACTER Ivo Marsh
  goal find_mara
    priority: 0.8
    active when: true
    completes when: Ivo_Marsh.knows.saw_mara
```

- `priority` — how much it matters (0 to 1), when goals compete.
- `active when` — the condition under which he's pursuing it.
- `completes when` — the condition that satisfies it.

You can also add `fails when:` and `on complete:` / `on fail:` follow-ups.

### 5.5 Places and groups

Two more kinds of declaration you'll use constantly:

```loom
LOCATION The Cellar
  label: Under the Orchard
  capacity: 8

GROUP The Society
  hidden: true
```

A `LOCATION` is somewhere a character or a guest can be. A `GROUP` is a
side people can belong to — a faction, a house, a team, a secret
society. `hidden: true` keeps a group invisible until the story reveals
it (Part 11). A character's own group is just a property: `group: The
Society`.

**Your characters are now real.** Next: making the story react to them
without wiring every reaction by hand.

---

## Part 6 — `when`: making the story react

Everything so far happens because the audience *reached* it. A `when`
block happens because something *became true*. Write `when`, what to
watch for, a colon, and indent what should happen. `when` lives inside
a character (or role, or trait — Part 7).

### 6.1 Watching a value

The simplest `when` watches a condition. It fires the moment the
condition becomes true, and it re-arms when the condition goes false
again:

```loom
CHARACTER Ivo Marsh
  calm: 0 to 100 = 60

  when self.calm < 20:
    Ivo Marsh: A toast. To my sister, wherever she has got to.
    set self.calm = 60
```

`self` means *this character* — the one the `when` is written inside.
Every time Ivo's calm drops below 20, he makes his toast and steadies
himself. This is how moods, thresholds, and tipping points work in
Loom: no special syntax, just a condition.

### 6.2 Watching an event

Some things aren't values — they're moments. Loom announces a handful of
these on its own, and you can listen for them in plain English:

| Write | Fires when… |
|---|---|
| `when guest arrives at The Cellar:` | someone enters a place |
| `when guest leaves The Cellar:` | someone leaves it |
| `when guest joins The Society:` | someone is added to a group |
| `when scanned by guest:` | a guest scans this character (live shows) |
| `when someone joins:` | a new participant arrives (live shows) |
| `every 60s:` | on a repeating timer |
| `after 2m:` | once, after a delay |

The lowercase word (`guest`) becomes a name you can use inside the
block for whoever did the thing. Small connecting words — `a`, `the`,
`at`, `by`, `to` — are ignored, so write the phrase the way you'd say
it.

```loom
CHARACTER The Gatekeeper
  patience: 0 to 10 = 3

  when guest leaves The Cellar:
    set self.patience -= 1
    The Gatekeeper: Mind the step, {guest.name}.
```

### 6.3 Your own events: `fire`

Any word that isn't one of the built-in moments is an event *you*
invent. Announce it with `fire`; every `when` that names it hears it:

```loom
== The Long Table

Ivo Marsh: Everyone. A moment.
fire the_toast

CHARACTER Dr Sable Quill
  when the_toast:
    Dr Sable Quill: To Mara. Wherever she is.

CHARACTER The Gatekeeper
  when the_toast:
    set self.patience += 1
```

One line in the story, and two characters react — without the beat
knowing or caring who's listening. That decoupling is the whole point.

An event can say who it's about, and carry details:

```loom
fire unlocked for guest
fire alarm for guest with level: 3, who: guest
```

`for` makes `guest` available inside `when unlocked for guest:`; `with`
binds whatever you list, so `when alarm:` can read `{level}` and
`{who.name}`. An event's name can be several words — `fire ring the
bell` is fine, and so is `fire ring_the_bell`; they're the same name.

In a live show, the operator can fire any event your story declares
from the Run cockpit, and show hardware can fire them too (Part 11).

### 6.4 House rules

A `when` doesn't have to belong to anyone. Written at the top level of a
file — outside every character — it's a **story rule**: the same block,
with no `self`.

```loom
when ring the bell for guest:
  broadcast "The bell rings. {guest.name} is standing under it." to location(Orchard Gate)
  set guest.suspicion += 5

when Tension > 80:
  fire the_toast

every 5m:
  Narrator: Somewhere, a cork.
```

Use them for the things that are true of the whole evening rather than
of one person.

### 6.5 Sending someone somewhere, or into a group

`when` blocks (and beats) can also *do* things to people:

| Write | Does |
|---|---|
| `move guest to The Cellar` | put a participant in a place |
| `add guest to The Society` | put them in a group (they keep any others; `guest.groups` lists them all, `guest.group` is their first) |
| `remove guest from The Collectors` | take them out of one |
| `reveal The Society` | make a hidden group visible to everyone |
| `reply You pushed it too far.` | a private line to whoever just acted |

Put these together and you have a game mechanic — with no special
vocabulary at all. Here is the Glass Orchard's "sent below" rule: snoop
too much and the Society quietly takes you down to the cellar.

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
    -> Under The Orchard
```

(`ROLE` is a character *shape* every participant wears — Part 11.)

**The story now reacts on its own.** Next: how to stop repeating
yourself.

---

## Part 7 — Traits: writing less by reusing shapes

Once you have a dozen characters, you'll notice they share behaviour. A
**trait** captures a shape once so every character can wear it.

### 7.1 A trait is a reusable bundle

Write `TRAIT` exactly like `CHARACTER`, but describe a *kind* rather than
a specific person:

```loom
TRAIT Keeper
  home: Lighthouse
  voice: solemn

TRAIT Combatant
  hp: 100
```

A trait on its own does nothing — it's a template waiting to be worn.

### 7.2 Wearing traits: `is`

Give a character traits with `is`, separating several with commas:

```loom
CHARACTER Ivo Marsh is Keeper, Combatant
  hp: 80
```

Ivo now has everything from `Keeper` and `Combatant`. When a trait and the
character set the same property, the character wins — here Ivo's `hp: 80`
overrides `Combatant`'s `hp: 100`.

### 7.3 Traits with a setting: parameters

A trait becomes far more useful when it can be *pointed at* something.
Put a parameter in parentheses after the trait's name, and refer to it
inside as `self.<parameter>`:

```loom
TRAIT Prop(beat)
  when scanned by guest:
    -> self.beat

CHARACTER The Sundial   is Prop(The Sundial Speaks)
CHARACTER The Letterbox is Prop(The Letterbox)
```

`Prop` says: "when someone scans me, jump to *the beat I was told
about*." Scanning the Sundial goes to `The Sundial Speaks`; scanning the
Letterbox goes to `The Letterbox`. One trait, written once, aims wherever
you send it.

### 7.4 Beats that belong to a character

A character can *own* a beat — written right inside them, so their scene
lives beside the behaviour that triggers it. Use `beat Name(...)` and
reach it with `-> self.Name`:

```loom
CHARACTER Ivo Marsh
  when scanned by guest:
    -> self.Receive

  beat Receive(guest)
    Self: {guest.name}. You came. She'd have been glad.
    * "Where is she, Ivo?"
      set guest.suspicion += 20
    + Admire the orchard.
      Self: It's the light. Everything looks forgiven in this light.
```

Two things to notice:

- **`Self:`** is a special speaker meaning "whoever owns this beat." Here
  it speaks as Ivo Marsh, so you don't have to name him again.
- Because the beat is *owned*, two different characters can each have
  their own `Receive` with no collision.

### 7.5 Shared templates with blanks: `slot` and `fill`

Sometimes several characters share the *structure* of a beat but differ in
the words. A trait can ship a beat with blanks — `slot:` lines — and each
character fills them in with a `fill` block:

```loom
TRAIT Gatekeeper
  beat Confront(guest)
    Self:
      if guest.below:
        slot: warning
      else:
        slot: welcome

CHARACTER The Gatekeeper is Gatekeeper
  fill warning
    You again. Down is easier than up. Remember that.
  fill welcome
    Invitation. Thank you. Straight through, the table's on the left.
```

Every gatekeeper gets the same shape (`Confront`), but this one speaks
these words. Note the small spelling difference: `slot:` keeps its colon
(it's a labelled blank); `fill` doesn't (it opens a block).

### 7.6 Extending, not replacing: `super`

If a character overrides a trait's `when` but wants to *keep* the original
behaviour and add to it, drop a bare `super` line where the inherited body
should run:

```loom
CHARACTER Chatty Guard is Guard
  when scanned by guest:
    super
    Chatty Guard: And try not to drip on the flagstones.
```

To *remove* an inherited reaction entirely, silence it with `: none`:

```loom
CHARACTER Silent Guard is Guard
  when scanned by guest: none
```

**You can now build a large cast without repeating yourself.** The next
two parts are optional depending on your project.

---

## Part 8 — Numbers: stats, pools, and progression

*Skip this part if your story doesn't need game-style numbers.* If it does
— health, damage, levels, skill trees — Loom has a dedicated toolkit called
**stats**.

### 8.1 A stats sheet

Declare a `STATS` block with named numbers:

```loom
STATS Combat
  attribute strength = 10, range 1 to 30
  attribute agility  = 10, range 1 to 30
  stat damage = 8 + strength * 0.5
```

There are four kinds of number:

- **`attribute`** — a plain value you set, optionally clamped to a `range`.
- **`stat`** — a *computed* value: a formula that recalculates itself.
- **`pool`** — a spendable, refilling gauge (health, stamina, mana).
- **`axis`** — a value that *advances* along a track (like an XP level).

```loom
STATS Combat
  attribute strength = 10, range 1 to 30

  pool health
    max: max_health
    regen: 2/s when not in_combat

  axis level
    mode: xp_curve
    curve: level * level * 50

  stat max_health = 50 + strength * 5
```

### 8.2 Giving a character stats

Attach a stats sheet with `stats:`, filling in any starting values:

```loom
CHARACTER Ivo Marsh is Keeper
  stats: Combat(strength: 12)
```

You can then read the numbers with a dot path — `Ivo_Marsh.strength`,
`Ivo_Marsh.damage`, `Ivo_Marsh.health` — and change them with `set`.

### 8.3 Skill trees

A `TREE` is a set of unlockable nodes, each of which can require others
first:

```loom
TREE Warrior Path
  node armsman_1
    cost: 1
    effect: stat(damage) += 5

  node armsman_2
    cost: 1
    requires: node(armsman_1)
    effect: stat(damage) += 5
```

**That's the numbers layer.** Reach for it only when your story is
game-like; a pure narrative piece never needs it.

---

## Part 9 — Cues: sound, light, and custom verbs

You've met `set`, `if`, `fire`, `move`. The rest of the verbs a writer
reaches for are **cues** — instructions to the booth.

### 9.1 Stagecraft verbs

| Write | Does |
|---|---|
| `sound bell_toll` | play a sound effect |
| `cue lx_dawn` | fire a lighting/tech cue |
| `pause` | hold for a beat |
| `flash white, 200` | a 200 ms white flash |
| `anchor the_bell_rings` | name this spot in the story (tests, analytics, show control) |

```loom
Ivo (startled): Lightning?

sound distant_thunder
```

### 9.2 Effects in the middle of a line

A verb on its own line fires *between* lines. To fire something at an
exact word — mid-sentence — use the long form, angle brackets, right in
the text:

```loom
Ivo (startled): Lightning?<flash: white, 200> That wasn't lightning.
```

The long form `<verb: arguments>` works everywhere a verb does. You only
*need* it mid-line.

### 9.3 Your own verbs: `do`

A show usually has cues Loom has never heard of — a haze machine, a
projector, a prop that opens. Write them with `do`:

```loom
do haze 30%
do projector scene_4
do trapdoor open
```

Anything the runtime doesn't recognise is passed along, unchanged, to
the show-control bridge (Part 11) or to a `.luau` extension that defines
the verb. In the browser, unknown verbs are simply logged — the story
never stops.

### 9.4 Verbs that open a block

A few verbs wrap a chunk of story. `broadcast` (Part 11) is one — it
opens, and everything indented beneath belongs to it:

```loom
broadcast to location(The Long Table):
  Narrator: Welcome to the orchard. Tonight, you choose a side.
```

The rule is consistent everywhere in Loom: **indentation shows what
belongs to what.**

---

## Part 10 — Organising a project

A short story fits in one file. A big one shouldn't.

### 10.1 A project is a folder

Put your `.loom` files in a folder. One of them is `main.loom` — the front
door, where the title and `start:` live:

```
the-glass-orchard/
  main.loom          ← title, start, groups, places, the Guest role
  rooms.loom         ← chat rooms for the live show
  cast/
    hosts.loom
    props.loom
  beats/
    arrival.loom
    glasshouse.loom
    cellar.loom
```

### 10.2 Names find each other automatically

You never write file paths in your story. A divert just names its target,
and Loom finds it *anywhere in the project* — even in another file,
another folder:

```loom
-> The Glasshouse at Night
```

The same goes for characters: declare `Ivo Marsh` in `cast/hosts.loom`
and write `Ivo Marsh:` (or `Ivo:` if that's unambiguous, or `IVO MARSH`)
in any beat. Loom matches names loosely — capital letters, spaces,
underscores and hyphens don't matter — so you move files around and
rename freely without breaking diverts.

### 10.3 When two beats share a name

If you deliberately have two beats named `Ringing` in different folders,
be specific with a `/`:

```loom
-> Lighthouse/Ringing
```

And to jump to a specific spot inside a file, use `#`:

```loom
-> cast/hosts#Backstory
```

### 10.4 Notes to yourself: comments

Anything after `//` is a **comment** — a note for you, ignored by the
runtime and invisible to the audience. For a longer note, wrap it in `/*
... */`:

```loom
// rough order: bell, beat, lantern up, line
Ivo: It hasn't rung in three days. // pick up the pace here

/*
  Blocking sketch from rehearsal 04-12:
  Ivo crosses to the lantern on "three."
*/
```

### 10.5 Notes for the production team: fences

A **fence** — a block wrapped in triple backticks — holds information for
the director, stage manager, or crew. The runtime ignores it, but it stays
visible in the prompt book:

````loom
Ivo: It hasn't rung in three days.
  ```blocking: cross to the lantern on "three"```

```note
This scene ran long at the table read. Consider cutting the lantern beat.
```
````

Comments are for *you*; fences are for the *team*. Both leave the story
itself untouched.

**You can now structure a project of any size.** The final part is where
Loom does something no screenplay can: run live.

---

## Part 11 — Live & interactive shows

This is Loom's reason for being. Everything so far — characters, choices,
memory, `when` — was building toward stories that play out *with a real
audience, in a real space, in real time*.

### 11.1 The idea

In a live Loom show, the audience aren't just readers — they're
**participants**. They move between physical (or virtual) rooms, join
sides, get scanned, chat, and make choices, while performers run scripted
and improvised beats around them. Loom coordinates all of it and keeps the
story consistent for everyone.

The running example for this part is *The Glass Orchard*: thirty guests
at a garden party, two sides to choose between, a hidden society, and a
host whose sister has gone missing.

### 11.2 Everyone wears a role

A **ROLE** is a character shape that every participant wears. It holds
the per-person state and the rules that apply to everybody:

```loom
ROLE Guest
  group: any of GROUP
  suspicion: 0 to 100 = 0
  favour: 0 to 100 = 10

  when someone joins:
    reply Welcome to the orchard. Keep your invitation where it can be scanned.

  when joins The Gardeners:
    reply A sprig of rosemary is pinned to your lapel.
```

The first `ROLE` in a project is the one new participants are cast into.
Inside a role's `when` blocks, `self` — and the role's own name, `guest`
— both mean *the participant this is happening to*.

### 11.3 Scans: the physical layer

Every participant carries a scannable pass. Performers and props scan
it; the scanned character's `when scanned by guest:` runs with `guest`
bound to that person. That's how a physical action becomes a story
beat:

```loom
CHARACTER Ivo Marsh
  when scanned by a guest:
    set Ivo_Marsh.trusts.guest += 5
    -> self.Receive
```

Because a scan is just an event, a prop can be a one-liner (Part 7.3),
and a guest scanning *another guest's* pass works the same way with a
`when scanned by other:` on the role.

### 11.3a Your own buttons: `INTERACTION`

Scanning is the one thing the app can do on its own. Everything else the
app should offer, the story declares:

```loom
INTERACTION whisper
  label: Whisper to them
  who: performer
  description: A quiet word, in character, to one guest.

INTERACTION ring the bell
  label: Ring the bell
  who: guest
```

A `who: performer` interaction is a button on every guest's thread in the
performer's app; pressing it fires `whisper` **as that character**, so
only *their* `when whisper for guest:` answers. A `who: guest` interaction
is a button on the guest's own pass; it fires with the guest as subject —
usually caught by a house rule (Part 6.4) or the role. `who: admin` needs
the moderator passcode. Every interaction also appears in the Run
cockpit's event list.

### 11.4 Places are rooms

Every `LOCATION` is also a chat room in the participant app. A beat
whose `setting:` is that place speaks into it, heard by whoever is
standing there. Moving people is `move`; hearing them move is `when
arrives at` / `when leaves`:

```loom
ROLE Guest
  when arrives at The Glasshouse:
    set self.suspicion += 5
```

### 11.5 Groups are sides

`add guest to The Gardeners` puts someone on a side; `remove` takes them
off it. A guest can be in several groups at once — `add` never takes
them out of one; `guest.groups` lists them all, and `guest.group` is
the one they joined first. A `hidden: true` group is invisible until
you `reveal` it — the classic secret-villain (or secret-ally) reveal:

```loom
* Give her the key.
  fire unlocked for guest
  remove guest from The Collectors
  add guest to The Society
  reveal The Society
```

### 11.6 Talking to a subset: `broadcast`

`broadcast` sends a cue, or a block of lines, to an audience you describe:

```loom
broadcast lantern_low to participant(guest)
broadcast lights_out to group(The Gardeners) | location(The Cellar)

broadcast to location(The Long Table):
  Narrator: The fountain at the centre is dry. Nobody admits it.
```

Scopes are `participant(X)`, `group(G)`, and `location(L)`, joined with
`|`.

### 11.7 Improv beats

A performer's cue can carry an **improv** parenthetical — a timed,
open-ended moment with a rule for when to move on:

```loom
Ivo Marsh | Dr Sable Quill:
  (improv duration: 60s, advance on: quorum(8) [speech(go), gesture(Cue)])
  (Argue about the orchard. Pull individual guests into your camp.)
```

`duration` is the window; `advance on` says who has to signal (`all`,
`any`, or `quorum(N)`) and how (`speech(word)`, `gesture(name)`,
`pedal`).

### 11.8 Chat rooms

Beyond the rooms every place makes, declare sidebar sections and extra
rooms with `SPACE` and `CHANNEL`:

```loom
SPACE The Party
  label: The Party

  CHANNEL the lawn
    kind: open
    label: # the-lawn

  CHANNEL potting shed
    kind: private
    invite: members
```

A channel's `kind` is `open`, `private`, `faction` (one group's members),
`group`, or `dm`. `type: announcement` makes a read-only feed; `slow: 3s`
rate-limits; `ephemeral: 30s` makes messages vanish.

### 11.9 Real people: PERSON and ROSTER

A `CHARACTER` is a part; a `PERSON` is a real human who might perform it;
a `ROSTER` is the plan for one night:

```loom
PERSON jamie_lee
  display_name: Jamie Lee
  pronouns: they/them
  content_tolerance: [no_strobe]

ROSTER Preview Night
  date: 2026-10-03
  cast:
    Ivo Marsh: jamie_lee
    The Gatekeeper: any of [sam_okafor, rae_lin]
  swings:
    Ivo Marsh: sam_okafor
```

At show time, `cast jamie_lee as Ivo Marsh` binds a person to a part;
`promote` and `demote` move people between parts mid-show.

### 11.10 Background life

A `GENERATOR` emits ambient lines on a timer; a `SCENE` is a small
looping state machine for a performer or prop:

```loom
GENERATOR Crickets
  tier: ambient
  every 30s
  yield bark from Cutlery. | A cork. | Somewhere, a moth finds a lantern.
```

Start one from a beat with `spawn Crickets`; stop it with `cancel
Crickets`; run a scene and wait for it with `run investigate(Ivo Marsh)`.

### 11.11 The booth and the bridge

While the show runs, the editor's **Run** mode is the booth: it shows
every room, every participant's position, every pending choice, and a
closed list of the events your `when` blocks and `INTERACTION`s declare
— fire any of them with one click, or `move` / `add` / `set` anyone by
hand. **Show control** connects the same events to real hardware: every
`do` verb and named event can go out as a lighting or sound cue, and a
sensor on a door can come back in as `fire`. The story never knows the
difference.

### 11.12 What the guests see

The participant app is not decorated for any particular story. Its
title, its rooms, its sides, its buttons — all of it comes from your
declarations. Two more header lines shape it:

```loom
# The Glass Orchard
theme: plain
```

`theme: plain` (the default) is a quiet, neutral skin. `theme: aol97`
is a beveled 1997 chat-room look — the one an earlier party was built
around. Whatever you pick, the lobby is named after the story, and a
guest's group tag takes its colour from the group's name.

### 11.13 Knowledge as a currency: the Codex

Some shows run on what the guests *know*. Declare a piece of lore with
`CODEX`; guests hold it, unlock it, and trade it:

```loom
CODEX The Sandy File
  about: Trabolta
  code: SANDY-1997
  text:
    Trabolta does not want omnipotence. Trabolta wants Sandy.
```

`about:` says who or what it concerns; `code:` is the unlock code
(printed as a QR, or the answer to a puzzle — capitals, dashes and spaces
don't matter); `known to:` names characters who hold it from the start.
The story hands lore out with `unlock The Sandy File for guest`, and
hears it move:

```loom
ROLE Guest
  when guest learns The Sandy File:
    set guest.suspicion += 10
  when wrong code for guest:
    reply Nothing happens.
```

A guest can share an entry with anyone — including a character, whose
own `when who learns X:` hook then runs (check `who == self`). Mark a
character `listed: true` so guests can find and message them; write
`directory: everyone` in the header to list every guest to every guest.
A broadcast that starts with `!` is an **alert** — every phone chimes.

**That's the whole language.** Write a little, press Run, add one idea.
That loop — not this guide — is how you'll actually learn Loom.

---

## Appendix A — Cheat sheet

**Structure**

| Form | Meaning |
|---|---|
| `# Title` | the story's title |
| `start: Beat Name` | which beat starts the story |
| `== Beat Name` / `== Beat(param)` | begins a beat |
| `cast:` / `setting:` | who's in a beat / where it is |
| `//` , `/* … */` | comments (for you) |
| triple-backtick fence | notes for the production team |

**Dialogue & prose**

| Form | Meaning |
|---|---|
| `Name: line` / `Name (how): line` | a line of speech |
| `Name:` + indented lines / `NAME` + indented lines | a speech block |
| `Narrator: …` / a bare paragraph | narration |
| `INT. PLACE - TIME` | scene heading |
| `Self:` / `SELF` | speaker = whoever owns this beat |
| `A \| B:` | two speakers at once |
| `\` at line start | force plain prose |

**Choices & flow**

| Form | Meaning |
|---|---|
| `* text` / `+ text` | once-only / sticky choice |
| `text[ hidden]` | words shown only after the choice |
| `-> Beat Name` / `-> END` | go to a beat / end the story |
| `-> Beat with k: v` | divert with parameters |
| `(Beat) ->` … `return` | tunnel there and back |
| `-> self.Beat` / `-> Owner.Beat` | go to an owned beat |
| `-> folder/Beat` , `-> file#Beat` | disambiguated jumps |

**Instructions**

| Form | Meaning |
|---|---|
| `set x = 5` , `+= -= *= /=` | change a value |
| `if c:` `else if c:` `else:` | conditional |
| `match v:` + `arm:` | pick an arm by value |
| `each visit:` + `first:` `then:` `finally:` | change on revisit |
| `after c:` + `otherwise:` | swap content at a turning point |
| `let name = formula` | a live, self-updating value |
| `cycle a \| b` / `shuffle a \| b` | vary a line |
| `cue x` `sound x` `pause` `flash …` `anchor x` | stagecraft |
| `fire event` / `fire event for who` / `fire event with k: v` | raise a named event (with a subject / details) |
| `move who to Place` | movement |
| `add who to Group` / `remove who from Group` / `reveal Group` | groups |
| `broadcast cue to scope` / `broadcast to scope:` | send to an audience |
| `reply text` | private reply to whoever acted |
| `cast who as Role` / `promote` / `demote` | casting |
| `spawn X` / `run X` / `cancel X` / `wait …` | background scenes |
| `do verb args` | any custom cue |
| `<verb: args>` | the long form — mid-line effects |

**Values & logic**

| Form | Meaning |
|---|---|
| `{expr}` | insert a value into text |
| `and` `or` `not` `== != > < >= <=` | condition operators |
| `Multi_Word.name` | a multi-word name inside an expression |
| `visits(b)` `played(b)` `since(e)` `count(C)` | ask the ledger |
| `30s` `2m` | durations |

**Characters & traits**

| Form | Meaning |
|---|---|
| `CHARACTER Name` / `ROLE Name` | a character / a shape every participant wears |
| `LOCATION Name` / `GROUP Name` | a place / a side (`hidden: true`) |
| `is X, Y` | wear traits / inherit |
| `trusts P: 30 of 100` | disposition (`trusts`/`respects`/`fears`) |
| `knows:` | a character's facts |
| `goal name` | something they're pursuing |
| `TRAIT Name(param)` + `self.param` | reusable shape with a blank |
| `beat Name()` inside a character | an owned beat |
| `slot:` / `fill` | template blanks / filling them |
| `super` , `when X: none` | extend / silence an inherited reaction |
| `range 0 to 100 = 50` , `any of KIND` , `a \| b` | typed slots |

**`when` — reactions**

| Form | Fires when… |
|---|---|
| `when self.x > 5:` | a condition becomes true (re-arms when false) |
| `when guest arrives at Place:` / `leaves` | movement |
| `when guest joins Group:` | group membership |
| `when scanned by guest:` | a scan (live) |
| `when someone joins:` | a new participant (live) |
| `when my_event:` / `when my_event for guest:` | a `fire`d event (several words allowed) |
| a `when …:` at file level | a **story rule** — no owner, no `self` |
| `every 30s:` / `after 2m:` | the clock |

**Live shows**

| Form | Meaning |
|---|---|
| `PERSON` / `ROSTER` / `cast p as R` | real people, the night's plan, binding |
| `COHORT` | a named group of the audience |
| `participant(X)` `group(G)` `location(L)` , `\|` | broadcast scopes |
| `(improv duration: 45s, advance on: any […])` | an improvised beat |
| `SPACE` / `CHANNEL` | chat sections / rooms |
| `INTERACTION name` + `label:` `who:` | a button in the participant app (fires a named event) |
| `CODEX name` + `about:` `code:` `known to:` `text:` | a piece of lore guests hold, unlock, and share |
| `unlock X for who` · `when who learns X:` · `when wrong code for who:` · `when share for who:` | lore moving |
| `listed: true` (character) · `directory: everyone` (header) | the People directory + private messages |
| `broadcast "!…" to …` | an alert (chime + banner) |
| `joinable: false` (group) · `sealed: true` (prison) | no side chooser · no self-escape |
| `theme: plain` / `theme: aol97` | the participant app's skin (header) |
| `GENERATOR` / `SCENE` , `every` / `yield` / `wait until` | background life |

**Older spellings that still work:** `entry:` (= `start:`), `WREN` cues,
`<set: …>` / `<if: …>` / `<else>` and every other `<verb: …>` line,
`on scan guest` (= `when scanned by guest:`), `on every 60s`,
`FACTION` (= `GROUP`), `<respond:>` (= `reply`), `<-` (= `return`), and
the convenience verbs `capture` / `release` / `escape` / `join` /
`defect` / `betray` / `enroll` — each of which is a short way of writing
`move` + `set` + `add`/`remove` + `fire`.
