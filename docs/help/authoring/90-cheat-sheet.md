---
title: Cheat sheet — every symbol
section: Reference
order: 90
keywords: cheat sheet, reference, symbols, syntax, quick reference, summary, verbs, when, loom 4
---

**Structure**

| Symbol | Meaning |
|---|---|
| `# Title` | the story's title (and the event name in the app) |
| `start: The First Beat` | which beat starts the story |
| `== Any Words Here` | begins a beat — names are plain words |
| `== Ask About(topic)` | a beat that takes a value |
| `cast:` / `setting:` | who's in a beat / where it is |
| `//` , `/* … */` | comments (for you) |
| triple-backtick fence | notes for the production team (` ```todo ` = task list) |

Names match ignoring case, and spaces / `_` / `-` are all the same:
`-> the front gate` reaches `== The Front Gate`. Inside an
*expression* (a condition, a `set` path, `{…}`) write a multi-word name
with underscores: `Ivo_Marsh.trusts.guest`.

**Dialogue & prose**

| Form | Meaning |
|---|---|
| `Ivo: You came back.` | a one-line speech |
| `Ivo (quietly): …` | with a parenthetical — a hint to the performer |
| `Ivo:` then indented lines | a speech block |
| `IVO` then indented lines | the screenplay cue (still works) |
| `Ivo \| Mara: …` | two speakers at once |
| `Narrator: …` | narration with a voice |
| `Self:` / `SELF` / `ME` | speaker = whoever owns this beat |
| flush-left paragraph | action / narration |
| `\Note: …` | force a line to be prose |
| `INT. PLACE - TIME` | scene heading |

**Choices & flow**

| Form | Meaning |
|---|---|
| `* text` | once-only choice |
| `+ text` | sticky choice |
| `text[ hidden]` | words shown only after the choice |
| `-> The Beat` | go to a beat |
| `-> self.Beat` / `-> Owner.Beat` | go to an owned beat |
| `-> folder/beat` , `-> file#knot` | disambiguated jumps |
| `-> The Beat with k: v` | divert with parameters |
| `-> The Beat as self` | run a beat per participant |
| `(The Beat) ->` … `return` (or `<-`) | tunnel there and back |
| `-> END` | end the story |

**Instructions** — a lowercase verb at the start of a line; block
openers end with `:` and indent their body.

| Form | Meaning |
|---|---|
| `set x = 5` , `+= -= *= /=` | change a value |
| `if cond:` / `else if cond:` / `else:` | conditional |
| `match value:` + `arm:` lines | pick an arm by value |
| `cue x` / `sound x` / `pause` / `flash white, 200` / `anchor x` | stagecraft |
| `fire lockdown` / `fire rally for guest` / `fire alarm with level: 3` | raise a named event |
| `reply text` | private line back to whoever acted |
| `do verb args` | any custom verb (show control, extensions) |
| `Ivo: Lightning?<flash: white, 200>` | the `<verb: args>` long form, for mid-line effects |

**Values & logic**

| Form | Meaning |
|---|---|
| `{expr}` | insert a value into text |
| `let name = formula` | a live, self-updating value |
| `and` `or` `not` `== != > < >= <=` | condition operators |
| `visits("The Beat")` `played(b)` `since(e)` `count(C)` | ask the ledger |
| `[x for x in C where cond]` | list comprehension |
| `30s` `2m` `1h` | durations |

**Variety**

| Form | Meaning |
|---|---|
| `cycle a \| b \| c` | step through in order |
| `shuffle a \| b \| c` | pick at random |
| `each visit:` + `first:` `then:` `finally:` | change on revisit |
| `after cond:` + `otherwise:` | swap content at a turning point |

**Characters & traits**

| Form | Meaning |
|---|---|
| `CHARACTER Ivo Marsh` / `ROLE Guest` | a part / a part many people play |
| `is X, Y` | wear traits / inherit |
| `trusts Guest: 30 of 100` | disposition (`trusts`/`respects`/`fears`) |
| `knows:` | a character's facts |
| `goal name` | something they're pursuing |
| `when <event>:` | a hook — do this when that happens (`on …` still works) |
| `TRAIT Prop(beat)` | reusable shape with a blank |
| `self.field` | "this character's" field |
| `beat Name(params)` inside a character | an owned beat |
| `slot:` / `fill` | template blanks / filling them |
| `super` , `when X: none` | extend / silence an inherited hook |
| `0 to 100 = 50` , `any of KIND` , `a \| b` , `list of` , `text?` | typed slots |

**Stats**

| Form | Meaning |
|---|---|
| `STATS Name` | a stats sheet |
| `attribute` / `stat` / `pool` / `axis` | set value / formula / gauge / track |
| `TREE Name` + `node` | an unlockable skill tree |
| `stats: Combat(strength: 12)` | attach stats to a character |

**Live shows**

| Form | Meaning |
|---|---|
| `PERSON` / `ROSTER` / `cast p as Role` | real people, the night's plan, binding |
| `GROUP` (`hidden: true`) / `LOCATION` (`hidden: true`, `cutscene: true`) / `COHORT` | a side / a place (and a room; hidden until visited or revealed; on rails) / a grouping |
| `move who to Place` | put a participant somewhere |
| `add who to Group` / `remove who from Group` / `reveal X [for who]` | membership / open a hidden group, place, room or character |
| `broadcast cue to scope` (+ indented lines) | send a cue to a subset |
| `participant(X)` `group(G)` `location(L)` , `and` / `but` | broadcast scopes |
| `(improv duration: 45s, advance on: any […])` | an improvised beat |
| `SPACE` / `CHANNEL` | chat sections / rooms |
| `GENERATOR` / `SCENE` , `loop` / `wait until` / `tier:` | background life |
| `spawn X` / `run X(args)` / `cancel X` | launch / await / stop a coroutine |

**`when` events** — inside a CHARACTER, ROLE, or TRAIT body

| Form | Fires when… |
|---|---|
| `when scanned by guest:` | this entity's pass is scanned (`guest` = who) |
| `when guest arrives at The Cellar:` / `when arrives at …:` | someone (or `self`) enters a place |
| `when guest leaves The Cellar:` | …leaves it |
| `when joins The Gardeners:` | membership added |
| `when someone joins:` | a new participant is created |
| `when lockdown:` / `when rally for guest:` | a named event you `fire` |
| `when self.suspicion >= 70:` | a **watcher** — the condition becomes true |
| a `when …:` at file level | a **story rule** — no owner, no `self` |
| `fire x for who with k: v` | raise an event with a subject and details |
| `INTERACTION name` + `label:` / `who:` | a button in the participant app (fires `name`) |
| `theme: plain` / `theme: aol97` (header) | the participant app's skin |
| `every 60s:` / `after 2m:` | the clock |

Filler words (`a`, `the`, `by`, `at`, `to`, `for`, …) are ignored;
a lowercase word binds who acted, a Capitalised word filters.

**v3 spellings still accepted**

| v3 | Loom 4 |
|---|---|
| `entry: x` | `start: x` |
| `<set: x = 5>` , `<if: c>` , `<else>` , `<cue: x>` … | `set x = 5` , `if c:` , `else:` , `cue x` … |
| `<respond: text>` | `reply text` |
| `<capture: g into L>` / `<release:>` / `<escape:>` | `move g to L` + your own flag |
| `<join: g to F>` / `<enroll:>` / `<defect:>` | `add g to G` / `remove g from G` |
| `FACTION` , `faction(F)` | `GROUP` , `group(G)` |
| `on scan guest` , `on enters L who` , `on every 60s` | `when scanned by guest:` , `when who arrives at L:` , `every 60s:` |
| `reacts trust > 60 -> warm` , `on trust passes 80` | `when self.trusts.Player > 60:` |
| `<-` | `return` |
