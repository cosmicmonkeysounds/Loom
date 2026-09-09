---
title: Owned beats, SELF, slots & fills
section: Language
order: 17
keywords: owned beat, beat block, SELF, self, slot, fill, super, template, qualified divert, class-owned, Self
---

## Beats that belong to a character

A character can *own* a beat — written right inside them, so their scene
lives beside the behaviour that triggers it. Use `beat Name(...)` and
reach it with `-> self.Name`:

```loom
CHARACTER Ivo Marsh is Keeper
  when scanned by guest:
    -> self.Receive

  beat Receive(guest)
    Self: {guest.name}. You came. She'd have been glad.
    * "Where is she, Ivo?"
      set guest.suspicion += 20
      -> Ask About Mara
    + Admire the orchard.
      set guest.favour += 5
      Self: It's the light. Everything looks forgiven in this light.
```

- **`Self:`** (or `SELF` / `ME` as a block cue) is a special speaker
  meaning "whoever owns this beat" — no need to restate the name. In a
  beat with no owner bound, `Self` falls back to the beat's first
  `cast:` member.
- Because the beat is *owned*, two characters can each have their own
  `Receive` with no collision.

## Qualified diverts

| You write | Goes to |
|---|---|
| `-> The Long Table` | the global beat `The Long Table` (unchanged behaviour) |
| `-> self.Receive` | this character's own beat |
| `-> Wren.Confront` | a specific owner's beat — `Self` inside speaks as *that* owner |

A slash still outranks the dot: `-> folder/beat` is a file-path
disambiguation, not an owner lookup.

## Shared templates with blanks: `slot:` and `fill`

A trait can ship a beat whose varying lines are `slot:` holes; each
deriving character supplies `fill` blocks:

```loom
TRAIT Doorkeeper
  beat Confront(guest)
    if guest.invited:
      slot: welcome
    else:
      slot: dismissal

CHARACTER The Gatekeeper is Doorkeeper
  fill welcome
    Self: Invitation. Thank you. Straight through, the table's on the left.
  fill dismissal
    Self: Not on the list, {guest.name}? Then you were never here.
```

Every doorkeeper gets the same shape (`Confront`), but the Gatekeeper
speaks the Gatekeeper's words.

> Note the spelling: `slot:` keeps its colon (it's a labelled blank);
> `fill` doesn't (it opens a block, like `beat`).

Diagnostics keep templates honest: a hole with no matching `fill` raises
*unfilled derived slot*; two parents shipping a same-named beat raise
*derived beat conflict*; a child re-declaring a derived `beat`
whole-overrides it.

## Beat-level `super`

A re-declared owned beat can splice its parent's template where a bare
`super` line appears — extend the inherited scene rather than replacing
it.

## Passing values and content into a beat

A divert can carry parameters with `with`:

```loom
-> Ask About with topic: the bell, NPC: Wren
```

It can also hand whole blocks of content *into* the target beat. Indent
`<name>:` blocks under the divert; the beat receives them at its
`slot: <name>` lines:

```loom
-> Ask About with topic: the bell
  opener:
    Wren: Ask, then.
```
