---
title: Owned beats, SELF, slots & fills
section: Language
order: 17
keywords: owned beat, beat block, SELF, self, slot, fill, super, template, qualified divert, class-owned
---

## Beats that belong to a character

A character can *own* a beat — written right inside them, so their scene
lives beside the behaviour that triggers it. Use `beat name(...)` and
reach it with `-> self.beat`:

```loom
CHARACTER Sysadmin is Algo
  on scan guest
    -> self.interrogation

  beat interrogation(guest)
    SELF
      Designation {guest.name}. Talk.
    * Name the Glitchers
      <set: guest.heat -= 10>
    * Say nothing
      <set: guest.karma += 20>
```

- **`SELF`** (or `ME`) is a special speaker meaning "whoever owns this
  beat" — no need to restate the name. In a beat with no owner bound,
  `SELF` falls back to the beat's first `cast:` member.
- Because the beat is *owned*, two characters can each have their own
  `interrogation` with no collision.

## Qualified diverts

| You write | Goes to |
|---|---|
| `-> lockdown` | the global beat `lockdown` (unchanged behaviour) |
| `-> self.interrogation` | this character's own beat |
| `-> Sysadmin.interrogation` | a specific owner's beat — `SELF` inside speaks as *that* owner |

A slash still outranks the dot: `-> folder/beat` is a file-path
disambiguation, not an owner lookup.

## Shared templates with blanks: `slot:` and `fill`

A trait can ship a beat whose varying lines are `slot:` holes; each
deriving character supplies `fill` blocks:

```loom
TRAIT Gatekeeper
  beat confront(guest)
    SELF
      <if: guest.captured>
        slot: pitch
      <else>
        slot: dismissal

CHARACTER Bouncer is Gatekeeper
  fill pitch
    List's closed, {guest.name}. Name a Mod who'll vouch, or wait.
  fill dismissal
    Not on the list? Then you were never here.
```

Every gatekeeper gets the same shape (`confront`), but the Bouncer
speaks the Bouncer's words.

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
-> ask_about with topic: the_bell, NPC: Wren
```

It can also hand whole blocks of content *into* the target beat. Indent
`<name>:` blocks under the divert; the beat receives them at its
`slot: <name>` lines:

```loom
-> ask_about with topic: the_bell
  opener:
    WREN
      Ask, then.
```
