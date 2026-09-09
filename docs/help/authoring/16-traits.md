---
title: Traits — write less by reusing shapes
section: Language
order: 16
keywords: TRAIT, is, inheritance, mixin, parameter, self, reuse, template, composition, when, none, super
---

Once you have a dozen characters, you'll notice they share behaviour. A
**trait** captures a shape once so every character can wear it. This is
the single biggest lever for keeping a large story manageable.

## A trait is a reusable bundle

Write `TRAIT` exactly like `CHARACTER`, but describe a *kind of person*
rather than a specific one:

```loom
TRAIT Keeper
  home: The Lighthouse
  voice: solemn

TRAIT Combatant
  hp: 100
```

A trait on its own does nothing — it's a template waiting to be worn.

## Wearing traits: `is`

```loom
CHARACTER Wren is Keeper, Combatant
  hp: 80
```

Wren now has everything from `Keeper` and `Combatant`. When a trait and
the character set the same property, **the character wins** — Wren's
`hp: 80` overrides `Combatant`'s `hp: 100`.

`is` also expresses *"is a kind of"*: `CHARACTER The Goblin King is
Goblin` starts from everything a goblin is.

> Keep the whole `is` clause on one line. A trailing comma or an
> unclosed `(` raises an *unterminated mixin clause* error.

## Traits with a setting: parameters

Put a parameter in parentheses after the trait's name and refer to it
inside as `self.<parameter>`:

```loom
TRAIT Prop(beat)
  when scanned by guest:
    -> self.beat
```

`Prop` says: "when someone scans me, jump to *the beat I was told
about*." Each character fills in the blank when they wear it — a whole
table of scannable objects becomes one honest line each:

```loom
CHARACTER The Sundial   is Prop(The Sundial Speaks)
CHARACTER The Letterbox is Prop(The Letterbox)
CHARACTER The Wine Rack is Prop(The Wine Rack)
```

Named arguments work too: `is Watcher(place: The Cellar, signal: lock_the_cellar)`.

`self` always means *"this character"* — the one wearing the trait right
now. A parameter you never supply raises a *required param unfilled*
diagnostic; a parameter used only as `-> self.<param>` that names no
real beat raises *unresolved trait arg*.

## Combining traits into new traits

Traits can wear other traits, forwarding their parameters down:

```loom
TRAIT Keeper
  society: true

TRAIT Keeper Prop(beat) is Prop(beat), Keeper
```

Now a prop that also belongs to the Society is still a one-liner:

```loom
CHARACTER The Cold Frame is Keeper Prop(The Cold Frame)
CHARACTER The Gnomon    is Keeper Prop(The Sundial Speaks)
```

## Extending and silencing inherited hooks

Keep the inherited behaviour and add to it with a bare `super` line:

```loom
CHARACTER The Chatty Gatekeeper is Gatekeeper
  when scanned by guest:
    super
    Self: And try not to drip on the flagstones.
```

Remove an inherited hook entirely with `: none`:

```loom
CHARACTER The Silent Gatekeeper is Gatekeeper
  when scanned by guest: none
```

(Loom 3 spelled these hooks `on scan guest`; the old opener still
parses inside a trait.)
