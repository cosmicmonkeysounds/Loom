---
title: Your first scene
section: Language
order: 10
keywords: dialogue, action, speaker, beat, scene, parenthetical, indentation, cast, setting, title, entry, INT, EXT, scene heading, start, narrator, names
---

## The two rules of a screenplay

1. **A name followed by a colon is a person speaking.** What comes
   after the colon — or pushed in underneath it — is what they say.
2. **A paragraph on its own is stage action** — something that happens,
   or something we see.

```loom
Wren: It hasn't rung in three days.

A bell rope swings in the gloom.
```

`Wren` is the speaker. The sentence about the bell rope is action —
nobody says it; it just happens.

A longer speech can open a block: the name and a colon on their own,
the lines *indented* beneath it. The screenplay habit of an ALL-CAPS
cue works too — both of these are the same speech:

```loom
Wren:
  It hasn't rung in three days.
  Not once.

WREN
  It hasn't rung in three days.
  Not once.
```

> Indentation carries meaning in Loom. Getting it right is how Loom
> knows what belongs to what — two spaces per step is the convention.
> Use spaces, not tabs.

**What counts as a name?** One to three words before the colon, the
first of them capitalised: `Wren:`, `Ivo Marsh:`, `Ivo the Younger:`.
Lowercase heads such as `cast:` and `setting:` are properties (below),
never speakers, so you can't accidentally invent a character called
"cast". `Narrator:` is the stage voice — its lines are narration, not a
character's speech. If a line of action happens to *look* like a cue,
start it with `\` — `\Note: the bell has not rung.` — and it stays
prose.

## The smallest complete file

A real file needs a **title** and at least one **beat**. A beat is a
chunk of story — a scene or a moment. Open one with `==` and a name.
Any words make a name:

```loom
# The Lighthouse

== The Bell Tower at Dawn

Wren: It hasn't rung in three days.

A bell rope swings in the gloom.
```

- `# The Lighthouse` — the title (the `#` marks the title line).
- `== The Bell Tower at Dawn` — begins a beat with that name. Everything
  after it, until the next `==`, belongs to this beat.

Names match loosely: capitals don't matter, and spaces, `_` and `-` are
treated alike, so `-> the bell tower at dawn` reaches this beat. Pick a
spelling and stay with it anyway; the editor's rename keeps a project
consistent.

This is a complete, playable Loom story.

## Parentheticals — a hint to the performer

To tell the actor *how* to say a line, put it in parentheses between
the name and the colon — or, in a block, on its own line above the
words:

```loom
Wren (quietly): It hasn't rung in three days.

Wren:
  (quietly)
  It hasn't rung in three days.
```

`(quietly)` is guidance for whoever performs the line; it isn't spoken.

## Scene headings

Screenplays announce location in a line like `INT. LIGHTHOUSE - DAWN`
("INT." = interior, "EXT." = exterior). Loom recognises these:

```loom
== The Bell Tower at Dawn

INT. LIGHTHOUSE - DAWN

A bell rope swings in the gloom.

Wren (quietly): It hasn't rung in three days.
```

A scene heading is a signpost for readers and directors — but the *beat*
(`==`) is what actually organises the story.

## Who's in the scene, and where

Right under a beat's `==` line, you can note who's present and the
setting. These indented lowercase `key: value` lines are the beat's
**contract**:

```loom
== The Bell Tower at Dawn
  cast: Wren, Player
  setting: The Lantern Room
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
Dockhand | Fisher: Storm's coming.
```
