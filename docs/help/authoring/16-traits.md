---
title: Traits — write less by reusing shapes
section: Language
order: 16
keywords: TRAIT, is, inheritance, mixin, parameter, self, reuse, template, composition
---

Once you have a dozen characters, you'll notice they share behaviour. A
**trait** captures a shape once so every character can wear it. This is
the single biggest lever for keeping a large story manageable.

## A trait is a reusable bundle

Write `TRAIT` exactly like `CHARACTER`, but describe a *role* rather
than a specific person:

```loom
TRAIT Keeper
  home: Lighthouse
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

`is` also expresses *"is a kind of"*: `CHARACTER GoblinKing is Goblin`
starts from everything a goblin is.

> Keep the whole `is` clause on one line. A trailing comma or an
> unclosed `(` raises an *unterminated mixin clause* error.

## Traits with a setting: parameters

Put a parameter in parentheses after the trait's name and refer to it
inside as `self.<parameter>`:

```loom
TRAIT Scanner(beat)
  on scan guest
    -> self.beat
```

`Scanner` says: "when someone scans me, jump to *the beat I was told
about*." Each character fills in the blank when they wear it:

```loom
CHARACTER Crawler is Scanner(crawler_report)
CHARACTER Paywall is Scanner(paywall)
```

Named arguments work too: `is CellWatch(loc: Internet, signal: lockdown)`.

`self` always means *"this character"* — the one wearing the trait right
now. A parameter you never supply raises a *required param unfilled*
diagnostic; a parameter used only as `-> self.<param>` that names no
real beat raises *unresolved trait arg*.

## Combining traits into new traits

Traits can wear other traits, forwarding their parameters down:

```loom
TRAIT Algo
  faction: TheAlgorithm

TRAIT AlgoScanner(beat) is Scanner(beat), Algo
```

A whole cast of villain props then collapses to one honest line each:

```loom
CHARACTER Crawler is AlgoScanner(crawler_report)
CHARACTER Captcha is AlgoScanner(captcha_gate)
CHARACTER Paywall is AlgoScanner(paywall)
```

## Extending and silencing inherited hooks

Keep the inherited behaviour and add to it with a bare `super` line:

```loom
CHARACTER ChattyGuard is Guard
  on meeting Player
    super
    GUARD
      And try not to drip on the flagstones.
```

Remove an inherited hook entirely with `: none`:

```loom
CHARACTER SilentGuard is Guard
  on meeting Player: none
```
