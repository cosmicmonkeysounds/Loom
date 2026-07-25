---
title: Your first scene
section: Language
order: 10
keywords: dialogue, action, speaker, beat, scene, parenthetical, indentation, cast, setting, title, entry, INT, EXT, scene heading
---

## The two rules of a screenplay

1. **A name on its own line is a person speaking.** The lines
   *underneath* it (pushed in a little) are what they say.
2. **A paragraph on its own is stage action** — something that happens,
   or something we see.

```loom
WREN
  It hasn't rung in three days.

A bell rope swings in the gloom.
```

`WREN` is the speaker. The sentence about the bell rope is action —
nobody says it; it just happens.

> Capitalisation and indentation carry meaning in Loom. A speaker's name
> is written in CAPITALS. Their dialogue is *indented* underneath.
> Getting the indentation right is how Loom knows who's talking — two
> spaces per step is the convention. Use spaces, not tabs.

## The smallest complete file

A real file needs a **title** and at least one **beat**. A beat is a
chunk of story — a scene or a moment. Open one with `==` and a name:

```loom
# The Lighthouse

== opening

WREN
  It hasn't rung in three days.

A bell rope swings in the gloom.
```

- `# The Lighthouse` — the title (the `#` marks the title line).
- `== opening` — begins a beat named `opening`. Everything after it,
  until the next `==`, belongs to this beat.

This is a complete, playable Loom story.

## Parentheticals — a hint to the performer

To tell the actor *how* to say a line, put it in parentheses on its own
indented line, above the words:

```loom
WREN
  (quietly)
  It hasn't rung in three days.
```

`(quietly)` is guidance for whoever performs the line; it isn't spoken.

## Scene headings

Screenplays announce location in a line like `INT. LIGHTHOUSE - DAWN`
("INT." = interior, "EXT." = exterior). Loom recognises these:

```loom
== opening

INT. LIGHTHOUSE - DAWN

A bell rope swings in the gloom.

WREN
  (quietly)
  It hasn't rung in three days.
```

A scene heading is a signpost for readers and directors — but the *beat*
(`==`) is what actually organises the story.

## Who's in the scene, and where

Right under a beat's `==` line, you can note who's present and the
setting. These indented `key: value` lines are the beat's **contract**:

```loom
== opening
  cast: Wren, Player
  setting: Lighthouse
```

- `cast:` — the characters in this beat (`Player` is the audience).
- `setting:` — where it takes place. In a live show, a beat's `setting:`
  decides which **room** hears its lines (see
  [Chat spaces & channels](chat-rooms.md)).

You don't have to write these at first, but they matter for live shows —
a good habit from day one.

## Multiple speakers on one cue

Two performers can share a line — write both names separated by `|`:

```loom
DOCKHAND | FISHER
  Storm's coming.
```
