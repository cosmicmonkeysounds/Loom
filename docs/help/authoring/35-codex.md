---
title: Lore — knowledge as a currency
section: Live Shows
order: 35
keywords: secret, CODEX, codex, lore, knowledge, unlock, puzzle, share, learns, directory, listed, people, private message, pm, alert, sealed, joinable, mind, LLM, language model, hold, offline, not responding
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

CODEX The LiveJournal
  about: Trabolta
  known to: OpenOffice
  text: A printout of Trabolta's LiveJournal. Current mood: hopeful.
```

| Line | Means |
|---|---|
| `about:` | who or what it concerns — a character, or a topic word (`World`). The entry's card names it, and the directory shows it under that person. |
| `code:` | the unlock code — printed as a QR on a wall, or the answer to a puzzle. Matching ignores case, dashes and spaces. Omit it for story-only lore. |
| `known to:` | characters who hold it from the start. The `about:` character always does. |
| `text:` | the entry, as an indented block (or one line). |

## How lore moves

1. **A code.** A guest scans the QR (its link carries `?unlock=<code>`)
   or types the code into their **Codex room** — a pinned room whose
   message box takes codes; every entry they hold is a card in it. Misses
   fire the named event `wrong code` for them.
2. **The story:** `unlock The LiveJournal for guest` in any beat or hook.
3. **A person:** a guest shares from their Codex; a performer shares
   their character's entries from a guest's thread. One recipient at a
   time.
4. **Show hardware:** `POST /api/mod/codex {who, entry}` through the mod
   API (a puzzle box). A game can also fire a named event whose `when`
   unlocks the entry — the reinstallation games' `the golden duck`.
5. **A trade.** With a [currency](currency.md) declared, a guest can
   offer coin for an entry another guest holds (or offer an entry for
   coin) from their Wallet; when the other side accepts, the server
   moves the coin and shares the entry in one step — so `share` and
   `learns` fire exactly as for a hand-to-hand share.

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
  when who learns The Prom Ticket:
    if who == self:
      set self.composure -= 15
      set self.love -= 10
```

That is how "show him who is taking Sandy to prom" rattles him into
oversharing.

One exception: an **agent-voiced** character (`mind: external`, below)
never takes an entry that is `about` *someone or somewhere else*. Its
holdings are read into its model's prompt and it can share them on, so a
guest could otherwise launder a secret (another person's file, a door
code) through it. Entries with no `about:`, and entries about the agent
itself, go through as usual. Performer characters accept anything.

Some lore must never reach a model at all, even in the holder's own
conversation: a program's private orders, the virus they are carrying.
Mark it `secret: true`. The entry is left out of every agent request and
the agents' facts document (its title, its text, its holders, and the
holder's `codex.<slug>` flag), and an agent refuses it as a share:

```loom
CODEX ILOVEYOU
  title: LOVE-LETTER-FOR-YOU.TXT.vbs
  secret: true
  code: LOVE-LETTER-FOR-YOU
  text:
    It is a virus. You opened it anyway, and now you are carrying it.
```

The same goes for a ROLE's own state. List the slots no agent may read
off a participant in the ROLE's `secret:` line (a plain name, or a dotted
path such as `quest.excel_mission`):

```loom
ROLE Program
  secret: carries_virus, planted_virus, excel_choice, quest.excel_mission
  carries_virus: bool = false
```

Everything else about the guest still reaches the agent's worker; the
persona's `them:` whitelist then picks which of it the models read. One
thing the server hides for you: membership of a `hidden: true` group
nobody has revealed yet (the guest's `group`, `faction` and `groups`,
and the group's own member list) stays out until the story `reveal`s it.

Secrets that belong to nobody (a door combination, which answers were
lies) live best on a hidden bookkeeping character marked `secret: true`.
A character's variables never land in an agent request's world, and
`secret: true` keeps it out of the agents' facts document as well:

```loom
CHARACTER Kernel
  playable: false
  secret: true
  combo_a: text? = none
```

Never keep a secret in a story-wide global such as `Night.combo`: the
agent's worker sees every global.

The codex has a sibling for what guests are *doing*: see *Quests — the
quest log*.

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
chimes, buzzes, and banners it, performers' booths included. A phone that
was asleep banners the newest alert it missed from the last 10 minutes
when it wakes. In Run → Director, tick **🔔 Alert** on the broadcast form
instead of typing the `!`:

```loom
broadcast "!📣 ALL PROGRAMS: report to the Desktop." to everyone
```

## Two small switches

- `GROUP Antivirus` + `joinable: false` — a public group the story
  assigns; guests are never offered it on the side chooser, and the
  server refuses a join or defect to it. The chooser lists exactly the
  sides a guest may take: declared, joinable, and not hidden (or hidden
  and since revealed).
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

If no agent is running at all (the laptop is down), the message waits.
Give the character a `hold:` line and the server says it for them after
about 20 seconds — once per waiting message — then keeps the message for
an agent that comes back. A message a connected agent never answers
(two tries of two minutes each) gets the same line, once. A director can still answer as the character
from Run — that answer settles the waiting message, so an agent that
comes back doesn't answer it twice. Write it in plain words; a wall
terminal reads it aloud:

```loom
CHARACTER Trabolta
  mind: external
  hold: Jean Trabolta is not responding. Please do not move the mouse.
```

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
