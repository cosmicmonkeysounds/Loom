---
title: Stats, pools & skill trees
section: Language
order: 18
keywords: STATS, attribute, stat, pool, axis, TREE, node, level, xp, health, regen, requires, progression, numbers
---

*Skip this if your story doesn't need game-style numbers.* If it does —
health, damage, levels, skill trees — Loom has a dedicated toolkit.

## A stats sheet

```loom
STATS Combat
  attribute strength = 10, range 1 to 30
  attribute agility  = 10, range 1 to 30
  stat damage = 8 + strength * 0.5
```

Four kinds of number:

| Kind | Is |
|---|---|
| `attribute` | a plain value you set, optionally clamped to a `range` |
| `stat` | a *computed* value — a formula that recalculates itself |
| `pool` | a spendable, refilling gauge (health, stamina, mana) |
| `axis` | a value that *advances* along a track (like an XP level) |

A pool and an axis:

```loom
STATS Combat
  attribute strength = 10, range 1 to 30

  pool health
    max: max_health
    regen: 2/s when not in_combat

  axis level
    mode: xp_curve
    curve: level * level * 50
    milestones: 5, 10, 20

  stat max_health = 50 + strength * 5
```

- `health` refills 2 per second while out of combat, up to `max_health`.
- `level` climbs an experience curve; `milestones:` marks narrative
  trigger points along it.

## Giving a character stats

Attach a sheet with `stats:`, filling in starting values:

```loom
CHARACTER Wren is Keeper
  stats: Combat(strength: 12)
  hp: 80
```

Read the numbers with a dot path — `Wren.strength`, `Wren.damage`,
`Wren.health`, `Wren.health.max`, `Wren.level` — and change them with
`set`.

## Skill trees

A `TREE` is a set of unlockable nodes, each of which can require others
first:

```loom
TREE WarriorPath
  node armsman_1
    cost: 1
    effect: stat(damage) += 5

  node armsman_2
    cost: 1
    requires: node(armsman_1)
    effect: stat(damage) += 5
```

`armsman_2` can't be taken until `armsman_1` is. Each node's `effect`
changes the character's stats when unlocked; check a node with a dot
path like `Wren.tree.armsman_1`.
