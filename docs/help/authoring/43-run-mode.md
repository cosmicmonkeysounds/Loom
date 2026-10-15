---
title: Run mode — rehearse, go live, be anyone
section: The Editor
order: 43
keywords: run, rehearse, rehearsal, live, go live, launch, deploy, event, cockpit, persona, choices, named events, identity, lens, be, view as, composer, quick fire, world, roster, stage, moderate, co-writer, director, push draft, restart, end, log, export, code, QR, join, passcode, lookup, scratch, private, print, poster, check-in sign, rotate, staff codes, terminals, heartbeat, silent, chime, TV voice, cue sheet, cue, next, ceremony, award, recap, re-pair, lost phone, release, grant codex, give quest, complete quest, fail quest
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
  **stay the same when you go live** — and when you end the run and start
  a new one, since codes belong to the project — so you can print them
  early. If a performer or moderator code leaked (shared at rehearsal,
  typed into a terminal), end the run and tick **New performer +
  moderator codes** under ▶ Start rehearsal before you start the next one:
  those two codes change, the guest code and the printed QRs don't.
- **🖨 Print sheet…** — everything to print, QRs drawn in the browser:
  the **join poster**, one **codex poster** per entry with a code (title,
  QR, the typed code), and one **room check-in sign** per place a guest
  can check into (see [live shows](live-shows.md)). Tick sections, skip
  single cards, choose 1, 2 or 4 per page.
- **Directing now** — every co-writer with a console open, who started
  the run, and when.
- **Terminals** — every wall terminal and the TV that has checked in,
  with its spot and view. One silent for 20 seconds turns red and the
  editor **chimes** — from any mode, again every minute until you
  **ack** it (**✕** forgets one switched off on purpose). The header's
  📟 pill counts the live ones. The **🔊 TV voice** button mutes the TV
  to captions only (the TV's own 🔊 / `M` key does the same).
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
| **Director** | the **cue sheet**, named events (with arguments), beats, broadcasts |
| **Mind** | an agent-voiced character's mind — its arc, drives, brief, the prompts and both models' reasoning, and a control panel ([the mind debugger](44-mind-debugger.md)) |
| **Log** | the raw ledger, event by event — **filter to one participant**; export the run |

## The cue sheet

The Director page opens on the **cue sheet**: the story's `who: admin`
interactions in the order they are declared ([buttons in the
app](live-verbs.md)), one click each. A label's leading code
(`C1 · …`, `V4 · …`) is split off as the cue number. The last cue fired
is amber **LAST**, the one after it is tagged **NEXT**, and every cue
fired tonight gets a ✓ — the same sheet on every director's console,
and it survives a reload. The header shows the story's `Night.phase`;
the box filters by word. A cue that needs a person — an award: every
hook that hears it binds one — has a **who?** picker and an optional
**value** box (read as `{value}`) and fires with that person as the
subject. For the numbers behind an award, open
`/e/<event id>/api/mod/recap?format=text` in a tab while signed in: a
paste-ready list of trust, truths and lies accepted, trips to the
Internet, codex, quests, score, and who joined each side.

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

**Hand out a clue or a quest by hand.** A guest's Inspector has a
**Codex** box (how many entries they hold, and a *grant codex entry…*
picker over the ones they don't — **Grant** unlocks it as if the story
had, so their `learns` rules run) and a **Quests** list: every quest the
story declares, with where it stands for them. **Start** hands out one
they haven't got; an active one has **Update…**, **Complete** and
**Fail**. Each asks for the line their Quest Log thread shows (an update
needs one; the others can be left blank). Use them when a puzzle box
fails, a clue was found the wrong way, or a guest missed a step. Both
work on a local run too, and are journaled under your name on a server
run.

**Someone lost their phone.** On a server run, a guest's Inspector has
**🔁 Re-pair**: it shows a QR that signs whatever phone scans it back in
*as that guest* — same program, codex, quests and score, no new guest
left behind. Use it for a dead phone, a cleared browser, a camera that
opened another browser, or a loaner. The code works once, for ten
minutes. **Sign out old phones** cuts every other phone signed in as
them (one someone else picked up). Keep the QR off the big screen: it
is their sign-in. A character's Inspector has **⏏ Release**: it signs
out whichever booth holds that part, so the performer can sign in again
on another phone with the performer code. The character's threads and
buttons stay.

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
