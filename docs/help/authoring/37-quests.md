---
title: Quests — the quest log
section: Live Shows
order: 37
keywords: QUEST, quest, quests, quest log, start quest, update quest, complete quest, finish quest, fail quest, objective, task, mission, completes quest, fails quest, starts quest
---

The codex is what a guest *knows*; a **quest** is what the night has
asked them to *do*. Each quest a guest holds is a card in their pinned
**Quest Log** room, and every step of it lands in that card's own
thread, in the giver's voice.

## Declaring a quest

```loom
QUEST Three Keys
  title: The Three Keys
  from: OpenOffice
  text:
    There are three keys to the machine, and they are in three
    people's heads. Find them. Turn yours from your pass.
```

| Line | Means |
|---|---|
| `title:` | what the phone shows (defaults to the quest's name). |
| `from:` | who hands it out — a character. Their picture and name head the card. |
| `text:` | the brief — the card's opening words (an indented block, or one line). |

Give a quest a name of its own, not the name of a beat or a codex entry
beside it (`Three Facts`, not `The Truth Scavenger Hunt`); the `title:`
is what guests read.

## Moving it

Four statements, each `for` a guest, `everyone`, or a scope
(`group(The Awakened)`, `location(The Cellar)`), with an optional line
for the thread:

```loom
start quest Three Keys for everyone
update quest Three Keys for program "You hold the First Key."
complete quest Three Keys for everyone "Three turned. The machine is dying."
fail quest Three Keys for everyone "The keys never turned."
```

- `start` hands it out — once. A quest that was finished never restarts.
- `update` adds a step to an **active** quest (it does nothing for
  someone who never got it, or already settled it).
- `complete` (or `finish`) and `fail` settle an active quest. Without a
  line, the thread says *Quest complete.* / *Quest failed.*

So `fail quest X for everyone` at the deadline fails only those still
working on it — whoever finished keeps their ✅.

Lines interpolate like dialogue: `"Fact {program.hunt_facts} of 3."`.

## Reacting to quests

```loom
when program completes quest Three Facts:
  set program.truth += 10
when program fails quest Three Keys:
  reply Too late.
when program starts quest Three Facts:
  if program.hunt_facts > 0:
    update quest Three Facts for program "You already hold {program.hunt_facts} of 3."
```

The word `quest` is required after the verb (`starts` / `completes` /
`finishes` / `fails`), so an ordinary named event such as
`the simulation completed` is never mistaken for one. Leave the quest
name off to hear every quest.

A quest's state is readable in conditions: `guest.quest.three_keys` is
`"active"`, `"done"`, or `"failed"` (the name lowercased, spaces as
underscores), and absent before it is handed out.

## Show hardware and directors

`POST /e/:id/api/mod/quest {who, quest, action, text?}` — `action` is
`start` (default), `update`, `complete`, or `fail` — moves one guest's
quest through the mod API: a puzzle box that finishes a quest, or a
director doing it by hand. It is journaled like every other mutation, so
a restart rebuilds every Quest Log thread exactly.

Directors see each guest's Quest Log (and Codex) as rooms of their own in
the Run cockpit (`Quest Log · Ada`); performers' booths don't see them.
