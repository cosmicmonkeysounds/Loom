---
title: Run mode — rehearse & moderate
section: The Editor
order: 43
keywords: run, sim, live, rehearse, cockpit, persona, choices, named events, perspective, lens, composer, quick fire, world, roster, stage, moderate
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
  events your hooks declare (`on lockdown` → `lockdown`); quick-fire in
  the header works on both sources.
- **The Log page** is the raw ledger — every engine event as it
  happens.

## The cockpit pages

| Page | Shows |
|---|---|
| **Chat** | every room the current lens can see, with the composer |
| **Roster** | all guests — faction, location, score, presence, badges |
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

## Moderating Live

Everything above, plus: capture/release from roster context menus,
`set` a guest's score/faction/location, fire beats and signals, scan on
a character's behalf, reveal a hidden faction, and reply in threads.
Every action is journaled on the event, so the story replays exactly.
