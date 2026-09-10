---
title: Run mode — rehearse, go live, be anyone
section: The Editor
order: 43
keywords: run, rehearse, rehearsal, live, go live, launch, deploy, event, cockpit, persona, choices, named events, identity, lens, be, view as, composer, quick fire, world, roster, stage, moderate, co-writer, director, push draft, restart, end, log, export, code, QR, join, passcode, lookup, scratch, private
---

Run (`⌘2`) is the control room for your project's **one run**. You
start it from the Run page: **▶ Start rehearsal** (or, on a server
project, *Go live with real guests* straight away).

- On a **server project** the rehearsal runs on the server and every
  co-writer on the project lands in the *same* run the moment they open
  Run — the shared rehearsal. Amber accents everywhere remind you it is
  a rehearsal.
- On a **local folder** the rehearsal runs in this browser (violet
  accents). Nothing reaches anyone else. Hosting a live event needs a
  server project.

Either way: a persona named after you joins, the story's `start:` beat
plays, its choices dock in Chat, and the story map lights up as you go.

## The header

Every page shares one header:

- **The run pill** — which world your actions land in: `local ·
  in-browser`, `shared rehearsal`, or `live event`, with the phase and
  how long it has been going.
- **Pause / Resume**, and a **↺ Restart ▾** menu: *Restart this draft*
  (same text, from the top), **⇪ Push current draft** (restart on the
  project's current text — the button turns amber the moment your files
  move past the running snapshot), **Go live…** (server rehearsals), and
  **■ End**. On a live event the destructive ones ask you to type the
  event code first.
- **👁 The identity control** — who you are right now (see *Being
  anyone*).
- **⚡ Quick-fire** — fire any named event the story declares, from any
  page.
- **⏳ N** — pending decisions across the run; click to answer them in
  Chat.

A banner under the header tells you when a co-writer restarted, pushed
a draft, went live, or ended the run — and who.

## The Run page

Front of house: getting people in.

- **Join** — the guest **event code** (and its QR + link), the
  **performer code**, and the **moderator code**, with copy buttons, plus
  a sign-in line per character to hand to each performer. These codes
  work during the rehearsal (anyone with the event code can join it) and
  **stay the same when you go live**, so you can print them early.
- **Directing now** — every co-writer with a console open, who started
  the run, and when.
- **Look up a guest** — scan a guest's pass QR (or type their id) to
  open them in the Inspector.

Ended a run? The page keeps it: **Export that run** downloads the ledger,
every room's transcript, the roster, and the world state as JSON.

## Going live

**Go live…** promotes the rehearsal in place: the id, codes, and QR are
unchanged; the story restarts from the top; rehearsal personas and
joined phones are removed; performers sign in again with the performer
code. Every director's console switches to the green LIVE chrome. (With
no run yet, the Run page also offers *Go live with real guests* directly.)

## The cockpit pages

| Page | Shows |
|---|---|
| **Run** | start / join codes + QR / directors / guest lookup |
| **Stage** | the floor plan: one card per location with its occupants as chips — **drag a chip between cards to move the guest** (hooks fire) |
| **Chat** | every room the current identity can see, with the composer |
| **Story** | the story map, lit by the run ([story graph](story-graph.md)) |
| **Roster** | all guests and the cast — group, location, score, presence, whose persona |
| **World** | the live state browser — a searchable variables table; **double-click any value to edit it live** |
| **Director** | named events (with arguments), beats, broadcasts |
| **Log** | the raw ledger, event by event — **filter to one participant**; export the run |

## Being anyone

The **👁 identity control** in the header switches the whole cockpit
between the **Operator** (the god view, default) and any participant:
your personas, a co-writer's personas, real guests, or a character.

While you are someone, what you see is **exactly what they see** — the
server's own view of them, the same data their phone renders: their
rooms (with the real "can post here" rule), their feed (a guest never
sees a hidden message), their pending choice docked in the room, and the
story's interaction buttons for them. As a **character** you get the
performer's booth: one thread per guest with **📡 Scan** and the
performer interactions, and you speak as the character everywhere.

Actions happen *as* them. The World and Director pages and the
Inspector's editors close until you switch back (`Esc`, or pick
Operator) — you are a participant right now, not the director.

Speaking as a **persona** you spawned is just rehearsal. Speaking as a
**real guest** is an explicit act: the composer defaults to the Operator,
you pick their name on purpose, confirm once, and the message shows
`via <your name>` to every director (never to guests).

## The super-admin's peek

Click any guest or character to open the **Inspector**: their **view**
(what their screen says), their **feed** (everything they have seen —
hidden lines greyed; for a character, every line they spoke and every
scan readout), their story position on the map, their variables, and
one button to **Be** them. The **Log** page's participant filter shows
every raw engine event that mentions them.

## Directing together

A server run is one world for the whole writing team. Everything a
director does *inside* the story — fire a beat, edit a stat, speak as
someone, spawn a persona — lands in the run's journal **attributed to
them**; a restart, push draft, go live, or end is announced to every
console with the director's name. If a colleague already started a run,
your **Start rehearsal** simply joins it.

Need to try a fix without disturbing a live show (or a colleague
mid-rehearsal)? The header offers **⚗ Test draft privately**: a scratch
run of the current draft in this browser, in the same cockpit, with one
**← Back to the shared run** exit. It is never persisted and never
chosen for you.

## Moderating

Everything above, plus: move a guest between places (or capture /
release them, for stories that use those verbs) from roster context
menus, `set` a guest's score / group / location, fire beats and named
events (optionally *as* a character, so only that character's hooks
hear it), scan on a character's behalf, reveal a hidden group, hide and
show messages, and reply in threads. Every action is journaled on the
run, so the story replays exactly.
