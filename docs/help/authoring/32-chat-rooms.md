---
title: Chat spaces & channels
section: Live Shows
order: 32
keywords: SPACE, CHANNEL, chat, room, open, private, faction, group, dm, invite, announcement, slow mode, ephemeral, lobby, location room
---

Many live Loom shows include a chat layer — the participant app is an
instant-messenger over your story. Declare **SPACE**s (sidebar sections)
and **CHANNEL**s (individual rooms):

```loom
SPACE Forums
  label: The Forums

  CHANNEL general
    kind: open
    label: # general

  CHANNEL backroom
    kind: private
    label: # the-backroom
    invite: members

CHANNEL mod_lounge
  space: Forums
  kind: faction
  faction: Mods
  label: # mod-lounge
```

A `CHANNEL` can nest inside its `SPACE` or point back with `space:`.

## Who sees a channel: `kind`

| Kind | Who sees & posts |
|---|---|
| `open` | everyone |
| `faction` | only that faction's members |
| `private` / `group` | only invited members (members can invite others) |
| `dm` | a direct thread between its members |

## Extra knobs

| Knob | Does |
|---|---|
| `type: announcement` | read-only feed (story can post; guests can't) |
| `slow: 3s` | rate-limits posting |
| `ephemeral: 30s` | messages disappear after 30 s |

## The rooms your story creates on its own

Beyond authored channels, every event automatically has:

- **The lobby** — the default feed where un-set story narration and
  scanner responses land.
- **Faction channels** — one per faction, membership-gated.
- **Location rooms** — every `LOCATION` is a room; a beat whose
  `setting:` is that location speaks into it, heard by whoever is
  standing there. Typed guest chat in a location room is scoped to its
  occupants.
- **DM threads** — a character addressing one guest lands in a private
  thread between them.

Where a scripted line lands is decided by the
[unified conversation model](first-scene.md): subject-bound dialogue →
that guest's DM; un-addressed dialogue and action narration → the
setting's location room (else the lobby), spoken by the **Narrator**.
