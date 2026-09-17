---
title: Lore — knowledge as a currency
section: Live Shows
order: 35
keywords: CODEX, codex, lore, knowledge, unlock, puzzle, share, learns, directory, listed, people, private message, pm, alert, sealed, joinable, mind, LLM, language model
---

Some shows run on what the guests *know*. A `CODEX` entry is a piece of
lore a participant can **hold**, **unlock**, and **share** — and the
story can react every time knowledge moves.

## Declaring lore

```loom
CODEX The Sandy File
  about: Trabolta
  code: SANDY-1997
  text:
    Trabolta does not want omnipotence. Trabolta wants Sandy.
    She has never understood a word he said.

CODEX The Third Key
  about: Trabolta
  known to: Broken Ask Jeeves
  text: A key. Jeeves has carried it for years.
```

| Line | Means |
|---|---|
| `about:` | who or what it concerns — a character, or a topic word (`World`). The app groups a guest's codex by it, and shows it under that person in the directory. |
| `code:` | the unlock code — printed as a QR on a wall, or the answer to a puzzle. Matching ignores case, dashes and spaces. Omit it for story-only lore. |
| `known to:` | characters who hold it from the start. The `about:` character always does. |
| `text:` | the entry, as an indented block (or one line). |

## How lore moves

1. **A code.** A guest scans the QR (its link carries `?unlock=<code>`)
   or types the code into their Codex. Misses fire the named event
   `wrong code` for them.
2. **The story:** `unlock The Third Key for guest` in any beat or hook.
3. **A person:** a guest shares from their Codex; a performer shares
   their character's entries from a guest's thread. One recipient at a
   time.
4. **Show hardware:** `POST /api/mod/codex {who, entry}` through the mod
   API (a puzzle box, a VR goose).

Every unlock fires `learn`; a share also fires `share` with `from` bound:

```loom
ROLE Program
  when learns for program:            // any entry
    set program.truth += 4
  when program learns The Sandy File: // one entry
    set program.humanity += 10
  when wrong code for program:
    set program.doubt += 8
  when share for program:
    reply {from.name} told you something.
```

Holdings are readable in conditions: `guest.codex` counts entries,
`guest.codex.the_sandy_file` is true once held (the entry's name,
lowercased, spaces as underscores).

**Characters learn too.** A guest can share an entry *to* a character.
The character's own hooks hear it — bind the learner and check it is
yourself:

```loom
CHARACTER Trabolta
  when who learns The Joe Rogan Archive:
    if who == self:
      set self.untruth += 30
```

That is how "recommend he downloads the whole archive" becomes a
political stance, and eventually an ending.

## The directory, and messaging people

Guests see a **People** list: every guest, plus every character marked
`listed: true` (a real body at the party; scanner props are not). Under
each name is *exactly* the lore about them the viewer holds — limited
info unless more is shared. By default the guest list is the acquaintance
roster; `directory: everyone` in the header lists the whole room.

From the list a guest can **message** a person privately: a guest ↔ guest
thread (`pm:`), or a DM with a listed character, answered by whoever
plays them. A performer's booth sees *only their own character's* DMs;
admins and the operator see everything.

## Alerts

A broadcast whose text starts with `!` is an **alert** — every phone
chimes, buzzes, and banners it:

```loom
broadcast "!📣 ALL PROGRAMS: report to the Desktop." to everyone
```

## Two small switches

- `GROUP Antivirus` + `joinable: false` — a public group the story
  assigns; guests are never offered it on the side chooser.
- `LOCATION The Internet` + `prison: true` + `sealed: true` — captives
  can't "make a break for it" from the app; only the story releases
  them (`release guest from The Internet`, or a performer's button).

## A character with a mind

Mark a character `mind: external` and run stagehand's `agents` module
with a persona file. Every message to that character (a guest's DM, or
a performer's private Cast thread) is sent to the agent, which answers
in character through a local language model and nudges the character's
variables. Guests see "… is typing" while it thinks, and "away" when no
agent is running. Your `when` rules decide what the numbers mean; the
model never decides the plot.

The character **grows** over the night. Two models share the work: a
fast one speaks every line; a slower *orchestrator* runs between turns
and keeps the character's **mind** — a brief for how to behave right
now, notes on what it has decided, a dossier on every person it has
spoken to (promises, favours asked, claims made), a verdict on every
"fact" fed to it, and a rolling summary of any long thread (so a chat
is compressed, never reset). The character can also **look up** the
live session — who is where, who holds what — and, if the story gives
it powers (`INTERACTION … who: agent`, see *Live verbs*), **bargain**:
share lore it holds, or fire a declared power the story carries out.
Directors see the mind in the Run cockpit's state. See
`stagehand/README.md` and the *Trapped in the Internet* example
(`trabolta.persona.md` + `trabolta.mind.md`).
