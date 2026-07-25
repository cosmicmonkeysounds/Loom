---
title: Memory — variables & conditions
section: Language
order: 12
keywords: variable, set, if, else, condition, let, interpolation, curly braces, expression, and, or, not, operators, state
---

A branching story is good; a story that *remembers* is better.

## Dropping a value into text

Curly braces `{ }` insert a value into a line:

```loom
WREN
  You have {coins} coins left.
```

If `coins` is 3, the audience reads: *You have 3 coins left.* Any
expression works inside the braces — `{coins * 2}`, `{Wren.trusts.Player}`.

## Changing a value: `<set: …>`

Angle brackets `< >` tell the runtime to *do* something. The most common
directive is `set`:

```loom
<set: coins = 10>
<set: coins += 5>
<set: coins -= 2>
```

- `=` assigns a value; `+=` adds; `-=` subtracts.
- Record facts the same way: `<set: rang_the_bell = true>`.

## Reacting to values: `<if:>`

Show something only when a condition holds. Add `<else if:>` for more
cases and `<else>` for "otherwise":

```loom
<if: coins > 5>
  WREN
    Keep your coins. You'll need them.
<else if: coins > 0>
  WREN
    That won't get you far.
<else>
  WREN
    Broke, then. Figures.
```

Everything indented under an arm plays only when that arm's condition is
true.

## Condition operators

| You write | Means |
|---|---|
| `>` `<` `>=` `<=` | greater / less than (or equal) |
| `==` | is equal to |
| `!=` | is not equal to |
| `and` | both must be true |
| `or` | either can be true |
| `not` | flips true/false |

```loom
<if: coins > 5 and not rang_the_bell>
  ...
```

> **`=` changes a value; `==` compares.** `<set: x = 5>` assigns;
> `<if: x == 5>` tests. Swapping them is a classic slip.

## Living values: `let`

A `let` gives a name to a *formula*. It stays true to its definition and
updates itself whenever the pieces change:

```loom
let trusted = Wren.trusts.Player > 50
```

Now `trusted` is always up to date:

```loom
<if: trusted>
  WREN
    I knew you'd come.
```

Put a `let` at the top of your file (near the title) to make it
available everywhere, or inside a beat to keep it local to that beat —
a beat-local `<let:>` doesn't leak once the beat returns.

## Collections and comprehensions

Loom publishes virtual collections — `Characters`, `Participants`,
`Items` — you can filter with a comprehension:

```loom
let allies = [c for c in Characters where c.faction == Player.faction]
```
