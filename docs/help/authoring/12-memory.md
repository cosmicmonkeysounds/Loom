---
title: Memory — variables & conditions
section: Language
order: 12
keywords: variable, set, if, else, condition, let, interpolation, curly braces, expression, and, or, not, operators, state, underscores
---

A branching story is good; a story that *remembers* is better.

## Dropping a value into text

Curly braces `{ }` insert a value into a line:

```loom
Wren: You have {coins} coins left.
```

If `coins` is 3, the audience reads: *You have 3 coins left.* Any
expression works inside the braces — `{coins * 2}`, `{Wren.trusts.Player}`.

## Changing a value: `set`

An instruction is a plain lowercase verb at the start of a line. The
one you'll use most is `set`:

```loom
set coins = 10
set coins += 5
set coins -= 2
```

- `=` assigns a value; `+=` adds; `-=` subtracts (`*=` and `/=` too).
- Record facts the same way: `set rang_the_bell = true`.

> **Names inside expressions.** A character or place called with spaces
> — `CHARACTER Ivo Marsh` — is written with underscores wherever it
> appears in a `set` path, a condition, or `{ }`:
> `set Ivo_Marsh.trusts.Player += 5`. Matching ignores the difference,
> so it's the same Ivo. (Loom 3 spelled this `<set: coins = 10>`; the
> bracketed form still works.)

## Reacting to values: `if`

Show something only when a condition holds. The condition ends with a
colon and the reaction is indented beneath. Add `else if` for more
cases and `else` for "otherwise":

```loom
if coins > 5:
  Wren: Keep your coins. You'll need them.
else if coins > 0:
  Wren: That won't get you far.
else:
  Wren: Broke, then. Figures.
```

Everything indented under an arm plays only when that arm's condition is
true. Because the verb is lowercase, *If you look closely…* is still
narration.

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
if coins > 5 and not rang_the_bell:
  ...
```

> **`=` changes a value; `==` compares.** `set x = 5` assigns;
> `if x == 5:` tests. Swapping them is a classic slip.

## Living values: `let`

A `let` gives a name to a *formula*. It stays true to its definition and
updates itself whenever the pieces change:

```loom
let trusted = Wren.trusts.Player > 50
```

Now `trusted` is always up to date:

```loom
if trusted:
  Wren: I knew you'd come.
```

Put a `let` at the top of your file (near the title) to make it
available everywhere, or inside a beat to keep it local to that beat —
a beat-local `let` doesn't leak once the beat returns.

## Collections and comprehensions

Loom publishes virtual collections — `Characters`, `Participants`,
`Items` — you can filter with a comprehension:

```loom
let allies = [c for c in Characters where c.group == Player.group]
```
