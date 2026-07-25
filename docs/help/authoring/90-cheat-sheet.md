---
title: Cheat sheet — every symbol
section: Reference
order: 90
keywords: cheat sheet, reference, symbols, syntax, quick reference, summary
---

**Structure**

| Symbol | Meaning |
|---|---|
| `# Title` | project / file title |
| `entry: name` | which beat starts the story |
| `== name` | begins a beat |
| `== name(param)` | a beat that takes a value |
| `cast:` / `setting:` | who's in a beat / where it is |
| `//` , `/* … */` | comments (for you) |
| triple-backtick fence | notes for the production team (` ```todo ` = task list) |

**Dialogue & prose**

| Form | Meaning |
|---|---|
| `NAME` then indented line | speaker + their dialogue |
| `(quietly)` | parenthetical — a hint to the performer |
| flush-left paragraph | action / narration |
| `INT. PLACE - TIME` | scene heading |
| `SELF` / `ME` | speaker = whoever owns this beat |
| `A \| B` | two possible speakers |

**Choices & flow**

| Form | Meaning |
|---|---|
| `* text` | once-only choice |
| `+ text` | sticky choice |
| `text[ hidden]` | words shown only after the choice |
| `-> beat` | go to a beat |
| `-> self.beat` / `-> Owner.beat` | go to an owned beat |
| `-> folder/beat` , `-> file#knot` | disambiguated jumps |
| `-> beat with k: v` | divert with parameters |
| `(beat) ->` … `<-` | tunnel there and back |
| `-> END` | end the story |

**Values & logic**

| Form | Meaning |
|---|---|
| `{expr}` | insert a value into text |
| `<set: x = 5>` , `+= -= *= /=` | change a value |
| `<if:>` `<else if:>` `<else>` | conditional |
| `let name = formula` | a live, self-updating value |
| `and` `or` `not` `== != > < >= <=` | condition operators |
| `visits(b)` `played(b)` `since(e)` `count(C)` | ask the ledger |
| `[x for x in C where cond]` | list comprehension |

**Variety**

| Form | Meaning |
|---|---|
| `<cycle: a \| b \| c>` | step through in order |
| `<shuffle: a \| b \| c>` | pick at random |
| `<each visit>` + `first`/`then`/`finally` | change on revisit |
| `<after: cond>` + `<otherwise>` | swap content at a turning point |
| `<match: value>` | pick an arm by value |

**Characters & traits**

| Form | Meaning |
|---|---|
| `CHARACTER Name` / `ROLE Name` | declare a character / a castable part |
| `is X, Y` | wear traits / inherit |
| `trusts P: 30 of 100` | disposition (`trusts`/`respects`/`fears`) |
| `reacts trust > 60 -> mood` | mood on a threshold |
| `knows:` | a character's facts |
| `goal name` | something they're pursuing |
| `on <event>` | a hook — do this when that happens |
| `TRAIT Name(param)` | reusable shape with a blank |
| `self.field` | "this character's" field |
| `beat name()` inside a character | an owned beat |
| `slot:` / `fill` | template blanks / filling them |
| `super` , `on X: none` | extend / silence an inherited hook |
| `range 0 to 100 = 50` , `any of KIND` , `a \| b` | typed slots |

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
| `PERSON` / `ROSTER` / `<cast: p as R>` | real people, the night's plan, binding |
| `COHORT` / `LOCATION` | a group / a place (and a chat room) |
| `<broadcast: scope>` | send lines to a subset |
| `location(X)` `cohort(X)` `participant(X)` , `and` / `but` | broadcast scopes |
| `(improv duration: 45s, advance on: any […])` | an improvised beat |
| `SPACE` / `CHANNEL` | chat sections / rooms |
| `<capture:>` `<release:>` `<escape:>` `<reveal:>` `<respond:>` | live game verbs |
| `<join:>` `<defect:>` `<betray:>` `<enroll:>` `<fire:>` | more live verbs |
| `as participant` / `self` | run one beat per participant |
| `GENERATOR` / `SCENE` , `loop` / `wait until` / `tier:` | background life |
