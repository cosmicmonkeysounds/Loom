# Loom 4 — the human-first surface

> **Status:** language design; Slices 1–3 implemented (2026-09-09).
> This document is the canonical description of how `.loom` is written
> from Loom 4 on. The v3 spec ([`loom-v3.html`](./loom-v3.html)) stays
> as the engine-architecture reference (Simulacra, Meridian, coroutines,
> the scheduler); every *surface* decision here supersedes it. The
> writer-facing manual is [`writing-in-loom.md`](./writing-in-loom.md)
> and the in-app help under [`help/authoring/`](./help/authoring/).

## 0. Why

Loom 3 was a screenplay skin over a programmer's language. Three things
kept leaking through the skin:

1. **Names had rules.** Beats were `snake_case` identifiers, speakers had
   to be ALL CAPS, characters were `Cookie_Banner`. A writer who typed
   `== The Bell Tower at Dawn` or `Wren:` got an error or, worse, prose.
2. **Every instruction wore angle brackets.** `<set: x = 5>`,
   `<if: x > 5>`, `<else>`, `<cue: lx14>`. The brackets carried no
   information a writer needed — and `<if:>`/`<else>` inside `<broadcast:>`
   inside a speaker block read like markup, not a script.
3. **The runtime vocabulary was one party's vocabulary.** `capture`,
   `escape`, `betray`, `defect`, `reveal`, `respond`, `on scan guest`,
   `prison: true`, `FACTION` — the verbs of *Trapped in the Internet* were
   baked into the language, the sim, and the participant app, so every
   other story had to be phrased as a jailbreak.

Loom 4 fixes the surface without changing what the engine is. Ink taught
us that a story language wins when the *common case has no syntax at
all*; Yarn Spinner taught us that `Name: line` is the most legible form
of dialogue ever shipped; articy taught us that entities, places, and
groups are the author's data model, not the engine's. Loom keeps what
none of them have — one file that is simultaneously a script, a
simulation, and a live show — and borrows their ergonomics.

### The four rules

1. **Read like a script, run like a program.** A printed `.loom` file is
   directable. Nothing a writer needs is hidden behind a sigil.
2. **Names are for humans.** Any words. Spaces allowed. Matching ignores
   case and the difference between spaces, underscores and hyphens.
3. **One way to give an instruction:** a plain lowercase verb at the start
   of a line. Angle brackets survive only as the long form for mid-line
   effects and custom verbs.
4. **Everything reactive is `when`.** One hook form, on any entity, that
   takes a built-in event, a named event you fired yourself, a timer, *or
   a condition*. Domain verbs (`capture`, `escape`, …) are not language.

Everything in v3 still parses. Loom 4 is additive at the parser; the
legacy forms are listed in §12 and stay supported until the example
corpus is migrated.

---

## 1. Lineage — what we took from whom

| Idea | From | In Loom 4 |
|---|---|---|
| Knots as free-text headings; `-> target`; `* once` / `+ sticky`; `[hidden]` choice text; tunnels | **Ink** | `== Any Words Here`, `->`, `*`/`+`, `[ ]`, `(Beat) ->` … `<-` |
| Logic with no bracket noise — a line is logic because it *starts* with logic | **Ink** (`~`, `{ }`) | a lowercase verb at line start: `set`, `if …:`, `cue`, `fire` |
| `Name: line` dialogue; `<<command>>` as the *long* form | **Yarn Spinner** | `Ivo: You came back.` ; `<cue: lx14>` only mid-line |
| Entities with typed properties, locations, groups as author data; flow fragments own their conditions and instructions | **articy:draft** | `CHARACTER` / `LOCATION` / `GROUP` with typed slots; beats own `when` |
| One authoritative event log; rules that react to it | **Loom 3 sim** (kept) | the ledger; `when` hooks drain to a fixpoint |
| Screenplay skin — speakers, parentheticals, sluglines, fences for the crew | **Fountain / Loom 3** (kept) | unchanged |

---

## 2. A file

```loom
# The Glass Orchard
start: The Front Gate

CHARACTER Ivo Marsh
  trusts Player: 30 of 100

== The Front Gate
  setting: Orchard Gate

The gate is open. It should not be.

Ivo: You came back.
Ivo (quietly): I wasn't sure you would.

* Say nothing.
  -> The Orchard Path
* "Where is she?"
  set Ivo_Marsh.trusts.Player += 5
  -> Ask About Mara
```

- `# Title` — the story title (used by the participant app as the event
  name).
- `start: <beat>` — where the story begins. `entry:` is the v3 spelling
  and still works. Without either, the first beat starts.
- Declarations are **shouted** (`CHARACTER`, `LOCATION`, …) — like
  sluglines, they are the only lines that need to be unambiguous.
- `== Name` opens a **beat** — a scene or moment. Beats nest nothing; the
  next `==` closes them.
- Under a beat, indented `key: value` lines are its **contract**:
  `cast:` and `setting:`.
- Comments: `// …` and `/* … */`. Notes for the crew: triple-backtick
  fences.

---

## 3. Names

A **name** is any run of words: letters, digits, spaces, apostrophes,
hyphens, underscores. `The Bell Tower at Dawn`, `Ivo Marsh`, `Mod Lounge`,
`ask_about` are all names.

Two names are the **same name** when they match after folding: lowercase
everything, treat `_` and `-` as spaces, collapse runs of spaces. So
`-> the bell tower at dawn` reaches `== The Bell Tower at Dawn`, and
`Cookie Banner:` speaks as `CHARACTER Cookie_Banner`.

Exact spelling is still preferred (the editor's rename keeps a project
consistent) — folding is there so a writer is never *wrong* for a
capital letter.

**Inside an expression** — a condition, a `set` path, a `{…}` — an
identifier cannot hold a space, so write a multi-word name with
underscores: `Ivo_Marsh.trusts.guest`, `guest.group == The_Collectors`.
The runtime folds the head of every path, so both spellings are the
same entity. Avoid `.` `/` `#` inside a beat name (they are divert
qualifiers) and the words ` with ` / ` as ` (divert tails).

Reserved: `END` (the story's end), `SELF` / `ME` (the owning character),
`self` / `me` in expressions, `super`, `none`, `Player`, `Narrator`,
and the lowercase statement verbs at the start of a line (§6).

---

## 4. Dialogue and action

Loom 4 keeps the screenplay block and adds Yarn's one-liner.

```loom
IVO
  (quietly)
  You came back.

Ivo:
  You came back.
  I wasn't sure you would.

Ivo: You came back.
Ivo (quietly): I wasn't sure you would.
Ivo | Mara: We both did.
```

**A speaker cue is** any of:

- a line in ALL CAPS (`IVO`, `IVO | MARA`) — the screenplay habit;
- a name followed by a colon and nothing else (`Ivo:`) — opens a block;
- a name, an optional parenthetical, a colon, and text
  (`Ivo (quietly): …`) — a one-line speech. Indented lines beneath it
  continue the same speech.

A **name-shaped head** is one to three words, the first capitalised
(`Ivo`, `Ivo Marsh`, `Ivo the Younger`), and whitespace must follow the
colon. Lowercase heads (`cast:`, `setting:`, `slot:`) are properties,
never speakers, so the contract zone can't be mistaken for a character
called "cast".
Everything else on its own line is **action** — narration, nobody says
it.

`SELF` / `Self:` / `ME` speaks as whoever owns the beat (§9). Speakers
that fold to a declared character's name canonicalise to that character
(`Ivo marsh:` / `IVO MARSH` → `Ivo Marsh`), so private-message routing
never splits a character across spellings. `Narrator:` (any casing) is
the stage voice: its lines are narration, not a character's speech. An
undeclared speaker is fine — the *unknown speaker* lint (§13) is Slice 2.

To force a line that *looks* like a cue to be action, start it with `\`:
`\Note: the bell has not rung.`

---

## 5. Choices and flow

Unchanged from v3 — this is the Ink core and it is already human.

```loom
* Ring the bell.            // once-only
+ Ask about the rope.       // sticky — stays on the menu
* Leave quietly.[ But you wonder.]   // [hidden] shows only after picking
  -> END

-> The Bell Tower           // go to a beat
-> The Bell Tower with tone: low   // with parameters
(Inspect The Rope) ->       // tunnel there …
<-                          // … and back (or the word `return`)
```

A beat with parameters: `== Ask About(topic)`; call it with
`-> Ask About with topic: the bell`.

---

## 6. Statements — instructions without brackets

A line that **starts with a known lowercase verb** is an instruction to
the runtime. Block-openers end with a colon; their body is indented.

```loom
set coins = 10
set coins += 5
set Ivo.knows.met_player = true

if coins > 5:
  Ivo: Keep your coins. You'll need them.
else if coins > 0:
  Ivo: That won't get you far.
else:
  Ivo: Broke, then. Figures.

match weather:
  storm:
    The rain comes sideways.
  fog:
    You can't see the harbour wall.

each visit:
  first:
    Ivo: Who are you?
  then:
    Ivo: You again.
  finally:
    Ivo: I'm tired of your questions.

after Mara.knows.the_truth:
  Mara: I've known since the orchard.
otherwise:
  Mara: I don't know what you mean.

let tense = Tension > 60          // a live, self-updating value

cycle Quiet night. | Stars are out. | Tide's calm.
shuffle Storm's close. | Sky's wrong. | Time to tie down.

cue lx_dawn
sound bell_toll
pause
fire lockdown
fire alarm with level: 3
anchor the_bell_rings
```

### 6.1 The verb table

| Verb | Does | v3 |
|---|---|---|
| `set path = value` / `+=` `-=` `*=` `/=` | change a value | `<set:>` |
| `if cond:` / `else if cond:` / `else:` | branch | `<if:>` … |
| `match value:` + `arm:` lines | pick an arm by value | `<match:>` |
| `each visit:` + `first:` `then:` `finally:` | vary on revisit | `<each visit>` |
| `after cond:` / `otherwise:` | swap content at a turning point | `<after:>` |
| `let name = expr` | live binding | `let` / `<let:>` |
| `cycle a \| b` / `shuffle a \| b` | variety | `<cycle:>` `<shuffle:>` |
| `cue name` / `sound name` / `sfx name` / `pause` / `flash …` / `anchor name` | stagecraft | same verbs in `<>` |
| `fire name [with k: v]` | raise a named event | `<fire:>` |
| `broadcast cue to scope` | send a cue to an audience | `<broadcast:>` |
| `reply text` | private line back to whoever acted | `<respond:>` |
| `move who to Place` | put a participant somewhere | `arrive` / `<capture:>` |
| `add who to Group` / `remove who from Group` | group membership | `<join:>` `<defect:>` `<enroll:>` |
| `reveal Group` | make a hidden group public | `<reveal:>` |
| `cast who as Role` / `promote who to Role` | casting | same |
| `spawn` / `run` / `cancel` / `wait` | coroutines | same |
| `do verb args` | any custom verb (show control, extensions) | `<verb: args>` |
| `return` | come back from a tunnel | `<-` |

### 6.2 How a statement is told from prose

The verb must be **lowercase and at the start of the line**, followed by a
space or a colon. Prose starts with a capital letter, so *If you look
closely…* is narration and `if you_looked:` is logic. A verb that is not
in the table is prose (`move slowly through the dark` is narration; `move
guest to Cellar` is an instruction because `move` is followed by a
recognisable `to`). The two rules that make this safe:

- `set` needs `name = value` / `name += value`; `move` needs `to`; `add`
  needs `to`; `remove` needs `from`; `fire`/`cue`/`sound`/`anchor` need a
  single name; block openers need their trailing colon **or** an indented
  body. A line that fails its verb's shape is prose.
- `\` at the start of a line forces prose.

### 6.3 The long form

`<verb: args>` still works everywhere and is the only way to fire an
effect *inside* a line:

```loom
Ivo: Lightning?<flash: white, 200>
```

Use it for that, and for verbs the project registers itself (a `.luau`
extension, a show-control cue). Everything else reads better without.

---

## 7. Memory and expressions

Unchanged: `{expr}` interpolation, `and` / `or` / `not`, comparisons,
`visits(Beat Name)` / `played(Beat Name)` / `since(event)` / `count(C)`,
list comprehensions, `let`. Beat names inside `visits()`/`played()` may
be quoted when they contain spaces: `visits("The Bell Tower")`; an
unquoted single word still works.

Durations: `30s`, `2m`, `1h`.

---

## 8. Characters, places, groups

```loom
CHARACTER Ivo Marsh is Keeper, Combatant
  voice: baritone
  hp: 80
  trusts Player: 30 of 100
  knows:
    met_player: bool = false
    bell_origin: unknown | suspects | confirmed = unknown
  goal find_mara
    priority: 0.8
    completes when: Ivo.knows.saw_mara

LOCATION Orchard Gate
  label: The Front Gate
  capacity: 40

GROUP The Society           // FACTION is the v3 spelling
  hidden: true
  ethos: control

TRAIT Keeper
  home: any of LOCATION
```

- **Properties** are `key: value`; typed slots (`0 to 100 = 0`, `a | b`,
  `any of KIND`, `list of`, `map of … to …`, `text?`) as in v3 §8.
- **Feelings** — `trusts` / `respects` / `fears X: N of M`.
- **Knowledge** — `knows:` facts, schema-checked on write.
- **Goals** — small state machines.
- **Groups** are what v3 called factions: membership + `hidden`. A
  participant may belong to any number of groups; `who.group` reads the
  *displayed* one (the first public membership), `who.groups` the list.
- **Places** are locations; each is also a chat room (see
  [`loom-conversation-model.md`](./loom-conversation-model.md)).
- **Traits** compose (`is X, Y`, `TRAIT Scanner(beat)`, `slot:`/`fill`,
  `super`, `: none`) exactly as in
  [`loom-functional-redesign.md`](./loom-functional-redesign.md).

---

## 9. `when` — the one reactive form

A hook is `when <something>:` inside a `CHARACTER`, `ROLE`, `TRAIT`, or
`GROUP` body, with the reaction indented beneath. `on …` is the v3
spelling and still parses.

```loom
CHARACTER The Gatekeeper
  when scanned by guest:
    -> self.Confront

  when guest arrives at Cellar:
    broadcast lights_down to participant(guest)

  when lockdown:
    Gatekeeper: Nobody moves.

  when Tension > 60:
    fire the_room_turns

  every 60s:
    set self.patience -= 1

ROLE Guest
  heat: 0 to 100 = 0
  when self.heat >= 75:
    move self to Cellar
    set self.heat = 0
    reply You pushed it too far.
```

### 9.1 What can follow `when`

| Form | Fires when… | Binds |
|---|---|---|
| `when scanned by guest` | this entity's pass is scanned (or it scans) | `guest` = the scanned participant |
| `when guest arrives at Cellar` / `when arrives at Cellar` | someone (or `self`) enters a place | `guest`; `self` for a ROLE |
| `when guest leaves Cellar` | …leaves it | same |
| `when guest joins Rebels` / `when joins Rebels` | group membership added | same |
| `when someone joins` | a new participant is created | `self` = them (ROLE) |
| `when lockdown` / `when rally for guest` | a **named event** you `fire` (or the operator fires) | `guest` if named |
| `when <condition>` | the condition **becomes** true (edge-triggered; re-arms when false) | `self` = owner, per participant on a ROLE |
| `every 30s` / `after 2m` | the clock | `self` |

**Filler words are ignored** in an event phrase — `a`, `an`, `the`, `is`,
`by`, `at`, `in`, `on`, `to`, `for`, `from`, `with`, `into`, `of` — so
`when scanned by a guest` and `when scanned guest` are the same hook.
The first non-filler word that names a built-in event is the **event**;
a lowercase word is a **binding**; a run of Capitalised words is a
**filter** (`arrives at The Cellar` fires only for that place).

A **named event** may be several words. Its binding, if any, follows
`for`: `when ring the bell for guest:`. Event names are names (§3), so
`fire ring_the_bell for guest` and an `INTERACTION ring the bell` both
reach it. Without `for`, a phrase that carries a filler word is one event
(`when ring the bell:`); a bare two-word phrase keeps the v3 shape
(`on rally guest` = event `rally`, binding `guest`).

**Watchers** (`when <condition>`) are the general form of v3's
`reacts trust > 60 -> warm` and `on trust passes 80`: any expression over
the world. They are evaluated after every change reaches a fixpoint and
fire once per false→true edge. A ROLE watcher runs with `self` bound to
each participant in turn.

### 9.2 Named events are the extension point

A named event is any word that is not a built-in. `fire lockdown` raises
it; every `when lockdown:` hears it. Events carry **arguments**:
`fire alarm for guest with level: 3, who: guest` binds `level` (a value)
and `who` (an entity — `who.name` works) in every `when alarm:` body. The
operator's `signal` API takes the same arguments as JSON. The editor's
Run cockpit enumerates every named event the project declares —
including every `INTERACTION` (§10) — so an operator fires them from a
closed list, and the show-control bridge maps them to OSC/MQTT.

This is how a story defines its own verbs. *Trapped in the Internet*'s
`capture` is:

```loom
ROLE Guest
  captured: bool = false
  when captured_by scanner:       // named event; scanner = who did it
    set self.captured = true
    move self to The Internet
    set self.score -= 25
```

fired by `fire captured_by with guest: guest` from a prop's hook, or —
with no ceremony — `move guest to The Internet` and a
`when arrives at The Internet:` hook on the ROLE. Nothing about prisons
lives in the language. (The v3 verbs `capture` / `release` / `escape` /
`betray` / `defect` / `join` / `enroll` / `respond` remain as
conveniences — §12.)

### 9.3 Story rules

A `when …:` at file level, outside any declaration, is a **story rule** —
the same hook with no owner and no `self`. House rules live here:

```loom
when ring the bell for guest:
  broadcast "The bell rings. {guest.name} is under it." to location(Orchard Gate)

when Tension > 80:
  fire the_toast

every 5m:
  cycle The moths change lanterns. | Somewhere, a cork.
```

Rules take events, conditions (watchers), and timers exactly like a
character's `when`. Inside a beat, a line starting with `when` is prose.

---

## 10. Live shows

The live layer is unchanged in shape; only its vocabulary generalised.

- **Participants** are created by the app (a pass, a code). Every
  participant is cast into the project's first `ROLE` unless cast
  otherwise.
- **Interactions** are what the app can physically do. Scanning a pass
  is built in: a scan fires `when scanned by X` on the scanned entity.
  Everything else a project declares:

  ```loom
  INTERACTION whisper
    label: Whisper to them
    who: performer          // performer | guest | admin
    description: A quiet word, in character, to one guest.
  ```

  The client shows a button for each (§11). Pressing it fires the named
  event `whisper` with the acting participant as subject — a performer's
  press runs **only their own character's** `when whisper for guest:`
  (plus role hooks and story rules), a guest's press (`who: guest`) runs
  with the guest as subject, `who: admin` needs moderator powers.
- **Rooms**: every `LOCATION` is a room; `SPACE` / `CHANNEL` declare
  extra ones; `broadcast … to participant(x) | group(G) | location(L)`
  (`faction(G)` still accepted).
- **Improv** parentheticals, `COHORT`, `PERSON`, `ROSTER`, `cast`, and
  `SCENE` / `GENERATOR` coroutines are as in v3 §13 / §10.5.

---

## 11. The participant app is not the story

The `play` client is a **generic participant client**. Nothing about
*Trapped in the Internet* is in it any more. What a project supplies:

| The story says | The app shows |
|---|---|
| `# Title` | the event name on the join screen, the lobby room, the story's sidebar section, the browser tab |
| `theme: aol97` (header) | the skin. Default is `plain` — quiet paper, one accent, system type. `aol97` is the beveled 1997 chat-room look the *Internet* party shipped with; both are variable sets in `play/src/styles.css`, keyed on `<html data-theme>` |
| `LOCATION`s, `SPACE`/`CHANNEL`s, `GROUP`s | the rooms sidebar (a room per public `GROUP`; a guest's group pill is coloured from its name) |
| `INTERACTION … who: performer / admin` | a button on every guest thread in the performer console (`/api/prime/act`) |
| `INTERACTION … who: guest` | a button on the guest's own pass sheet (`/api/guest/act`) |
| a `prison: true` location (v3) | the legacy capture / release buttons — only then |

Every view (`GuestView`, `PrimeView`, `ModView`, `ResolvedCode`) carries
`title`, `theme`, and the interactions its role may fire; the derived
rooms live in the `story` space. The only vocabulary left in the client
is Loom's own: rooms, threads, a pass, a scan.

---

## 12. Legacy forms (still parse)

| v3 | Loom 4 | Notes |
|---|---|---|
| `entry: x` | `start: x` | both read |
| `WREN` + indented lines | `Wren:` / `Wren: line` | ALL CAPS still a cue |
| `<set: x = 5>` | `set x = 5` | |
| `<if: c>` `<else if: c>` `<else>` | `if c:` `else if c:` `else:` | |
| `<match: v>` / `<each visit>` / `<after: c>` `<otherwise>` / `<let: n = e>` | `match v:` / `each visit:` / `after c:` `otherwise:` / `let n = e` | |
| `<cycle: …>` `<shuffle: …>` as a whole line | `cycle …` / `shuffle …` | inline form unchanged |
| `<cue: x>` `<sfx: x>` `<fire: x>` … | `cue x` `sound x` `fire x` … | |
| `<respond: text>` | `reply text` | |
| `<capture: g into L>` | `move g to L` + your own `captured` flag | `capture` kept as a macro: move + `captured = true` + event `captured` |
| `<release: g from L>` / `<escape: g>` | `move g to Place` + `set g.captured = false` | kept |
| `<join: g to F>` / `<enroll: g → C>` | `add g to G` | kept |
| `<defect: g from A to B>` | `remove g from A` + `add g to B` | kept; fires `defect` |
| `<betray: g to F>` | `set g.true_group = F` | kept |
| `FACTION` | `GROUP` | both read; `faction(G)` and `group(G)` scopes |
| `on scan guest` | `when scanned by guest:` | `on` still opens a hook |
| `on enters Cellar captive` | `when captive arrives at Cellar:` | |
| `on every 60s` | `every 60s:` | |
| `reacts trust > 60 -> warm` / `on trust passes 80` | `when self.trusts.Player > 60:` | watchers |
| `<-` | `return` | both |
| `<broadcast: cue to faction(F)>` | `broadcast cue to group(F)` | |

---

## 13. Diagnostics

| Code | Meaning |
|---|---|
| `L1201 UnknownSpeaker` (warning) | a `Name:` cue (not an ALL-CAPS cue, not `Self` / `Narrator` / `Player`) that folds to no declared CHARACTER / ROLE / PERSON — only once the project declares at least one |
| `L1202 AmbiguousName` (warning) | two declarations of one kind, or two beats, whose names fold to the same key |

Both are **workspace** lints (`Workspace.diagnosticsFor`), layered onto
the parser's diagnostics — the lexer itself stays silent by design (a
line that is not a statement is prose, a `Name:` head is a speaker).

---

## 14. Implementation status

**Slice 1 (2026-09-09, TS `core/` + `editor` highlighter):**

- Lexer: `Name:` / `Name (paren): text` speaker forms; keyword statements
  lowered onto the existing directive AST (`if c:` → directive `if: c`,
  so the parser, the sim, the bank compiler, and the story graph are
  untouched); `return`; `\` prose escape; beat names with spaces.
- Names: `foldName()` in `parser/names.ts`; the sim and the story graph
  resolve diverts, `visits()`, and speakers through a folded index when
  the exact key misses; `start:` read alongside `entry:`.
- Hooks: `when …:` opens a hook; `parseTrigger` understands the filler
  grammar and verb synonyms; **watchers** (`when <condition>:`) are
  evaluated per drain to a fixpoint, per participant on a ROLE.
- Verbs: `move` / `add` / `remove` / `reply` / `do`; `GROUP` as a
  declaration kind (alias of `faction`); `group(G)` broadcast scope.
- Speakers canonicalise to the declared character (`SELF` resolves to
  `Ivo Marsh`, not `IVO_MARSH`); `Narrator:` / `NARRATOR` is narration
  (an `action` event, routed to the setting's room, never a DM).
- Expressions address a multi-word entity with underscores
  (`Ivo_Marsh.trusts.guest`): the `World` folds the head segment of every
  path through an alias table, so `set` / `if` / `{…}` all reach
  `Ivo Marsh.…`. A bare `The_Collectors` reads as the group id.
- ROLE hooks bind the role's own name as well as `self`
  (`ROLE Guest` → `guest`), so a beat reached from a role hook reads
  `guest.x` exactly as one reached from a scan does. `fire event for x`
  binds the subject; a ROLE's `group` mirrors its `faction`.
- The sim now plays `each visit:` (`first` / `then` / `finally` by visit
  count) and whole-line `cycle` / `shuffle` — previously bank-only.
- Editor: the CodeMirror highlighter recognises every form above. (The
  VS Code / Zed TextMate grammar is generated from the **Rust**
  `loom-parser` keyword table in `syntax/` and has not been updated —
  it still highlights only the v3 forms.)
- Docs: this file, the writer's guide, the help collection, and a new
  non-Internet example project (`core/examples/glass-orchard`, played
  end to end by `core/test/glass-orchard.test.ts`).
- Tests: 454 in `core` (incl. `loom4.test.ts` + the Orchard), 122 in the
  editor; the bank parity suite compares speakers in the bank's
  upper-cased ID form (see Slice 4).

**Slice 2 (2026-09-09, TS `core/`):**

- **Story rules** (§9.3): the lexer's `rule` line, an `Item` of kind
  `rule`, `model.rules` as ownerless hooks (`ownerKind: "story"`), fired,
  watched, and timed by the sim; listed in `documentSymbols`;
  highlighted at file level.
- **Event arguments** (§9.2): `fire x [for who] [with k: v, …]`;
  `Sim.signal(name, subject?, args?, actor?)`; `/api/mod/signal` accepts
  `args`. Value arguments alias per-fire world keys (`event#N.k`, hidden
  from `worldEntries`); entity arguments bind as ids.
- **Multi-word named events** (§9.1) with folded matching.
- **Groups are additive** (§8): `add` keeps existing memberships,
  `who.groups` lists them, `who.group` / `.faction` is the primary,
  `remove` promotes the next; v3 `join` / `defect` still switch.
- **Loose rename**: `renameBeat` accepts spaced names and rewrites
  loosely spelled references + `start:`.
- **Lints** `L1201` / `L1202` (§13).
- The bank compiler diagnoses (rather than drops) watchers and story
  rules: `watcherIgnored`, `storyRulesIgnored`.

**Slice 3 (2026-09-09, `core/server` + `play`):** everything in §11.
`INTERACTION` is a declaration kind; `/api/guest/act` and
`/api/prime/act` (character-scoped via `Trigger.actor`); `theme:` +
title on every view and on `/api/resolve-code`; the default space is
`story`, the lobby is titled after the story, broadcast cues written as
prose are their own copy; the play client's Internet constants
(`Faction`, `internet`, "The Internet", `.pill.Mods`, the AOL skin as the
only skin) are gone.

**Slice 4:** the bank compiler already consumes the Loom 4 AST (every
statement lowers to the directive node it compiled before). Open
decision: banks still display speakers in the upper-cased ID form their
stable engine IDs + golden traces are hashed from; switching them to the
declared name means regenerating goldens and `LoomIDs.*`. The Rust
mirror is deprioritised.
