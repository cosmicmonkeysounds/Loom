---
title: Run mode — rehearse & moderate
section: The Editor
order: 43
keywords: run, sim, live, rehearse, cockpit, persona, choices, named events, perspective, lens, composer, quick fire, world, roster, stage, moderate, co-writer, director, push draft, restart, log, export
---

Run (`⌘2`) is one cockpit with a **Sim ⇄ Live source switch**:

- **Sim** (violet) — rehearse on a local, in-browser simulator compiled
  from your current sources. No server, no event, no account.
- **Live** (amber for a shared rehearsal, green for the real event) —
  moderate the launched event through the same surface. As the project's
  author you *are* the operator; no code to type.

Flipping the switch never reconnects anything — the same chat, roster,
world, and story surfaces just point at the other world. The chrome's
accent colour always tells you **which world your actions land in**.

## Rehearsing on Sim

- **Start / Pause / Reset** on the Setup page. Reset recompiles from
  your current files (a hint appears when sources changed under a
  running sim).
- **Personas** — local guests you act as. One is created on start; add
  more from the rail ("new persona…"). Answer their choices on the
  persona card, in the Inspector, or in the room's decision tray.
- **Named events** — the Director page's fire picker lists exactly the
  events your `when <event>:` hooks declare (a `when lockdown:` hook
  anywhere in the project puts `lockdown` on the list, and firing it
  does what `fire lockdown` would); quick-fire in the header works on
  both sources.
- **The Log page** is the raw ledger — every engine event as it
  happens. **Export run** downloads the ledger, every room's transcript,
  the roster, and the world state as one JSON file (on either source).

## The cockpit pages

| Page | Shows |
|---|---|
| **Chat** | every room the current lens can see, with the composer |
| **Roster** | all guests — group, location, score, presence, badges |
| **Stage** | the floor plan: one card per location with its occupants as chips — **drag a chip between cards to move the guest** (hooks fire) |
| **World** | the live state browser — a searchable variables table; **double-click any value to edit it live** |
| **Story** | the story map, lit by the run ([story graph](story-graph.md)) |
| **Director** | named events + broadcast controls |

## The perspective lens

The rail's lens picker switches the cockpit between the **Operator**
god view, any **guest**, or any **character** — the rooms rail and feed
filter to what that identity can see, and the composer speaks as them.
"View as" on any roster row or message jumps the lens.

## Acting in the story

The composer's "post as" picker is grouped **Story (Operator ·
Narrator) · Guests · Cast**. Guest speech goes through the same
journaled path the play app uses (and is presence-gated in location
rooms), so anything you type replays deterministically.

A guest's pending choice docks as a **decision tray** above the
composer — answer it on their behalf; it lands exactly like their own
tap, in Sim and Live alike.

## Directing together on Live

A shared rehearsal (or the live event) is one world for the whole
writing team: every co-writer on the project opens Run → Live and
lands in the *same* run, with the same feed, journal, and story map.
The Live **Setup** page is the team's control room:

- **Pause / Resume / Restart / End** — every director's console follows
  along. Restart replays the story from the top and clears chat for
  everyone at once (nobody is left looking at a stale feed).
- **Push current draft** — the event runs a *snapshot* of your files
  taken at launch. When anyone edits the project afterwards, the Setup
  page (and the header) flags **draft changed**; pushing restarts the
  story on the current text so you can test the edit live without
  ending the event. Join codes stay the same.
- **Directing now** — who else has a console open (the rail's director
  count names them on hover).
- **Your personas** — the guests you puppet, with their pending choices;
  other directors' personas show up in the Roster.
- **Fire named event** on the Director page takes **arguments**
  (`level: 3, who: Ivo`) that bind in the listening body exactly like
  `fire alarm with level: 3`.

If a co-writer launches or ends the event from their own editor, your
Live pane picks it up within a few seconds — no reload needed.

## Moderating Live

Everything above, plus: move a guest between places (or capture /
release them, for stories that use those verbs) from roster context
menus, `set` a guest's score / group / location, fire beats and named
events, scan on a character's behalf (running their `when scanned by
guest:` hook), reveal a hidden group such as The Society, and reply in
threads. Every action is journaled on the event, so the story replays
exactly.
