---
title: Chat spaces & channels
section: Live Shows
order: 32
keywords: SPACE, CHANNEL, chat, room, open, private, faction, group, dm, invite, announcement, slow mode, ephemeral, lobby, location room, participant app, title, theme
---

Many live Loom shows include a chat layer — the participant app is an
instant-messenger over your story. Declare **SPACE**s (sidebar sections)
and **CHANNEL**s (individual rooms):

```loom
SPACE The Party
  label: The Party

  CHANNEL announcements
    kind: open
    type: announcement
    label: # announcements

  CHANNEL the lawn
    kind: open
    label: # the-lawn

  CHANNEL potting shed
    kind: private
    label: # potting-shed
    invite: members

CHANNEL gardeners
  space: The Party
  kind: faction
  faction: The Gardeners
  label: # gardeners
```

A `CHANNEL` can nest inside its `SPACE` or point back with `space:`.
Names can be several words (`CHANNEL potting shed`); the `label:` is
what the sidebar shows.

## Who sees a channel: `kind`

| Kind | Who sees & posts |
|---|---|
| `open` | everyone |
| `faction` | only members of the `faction:` group (`faction` is still the kind word for a `GROUP` room) |
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

- **The lobby** — the story's own room, titled from your `# Title`
  line. Narration from a beat with no `setting:` and `reply` lines
  with nowhere better to go land here.
- **Group rooms** — one per *public* `GROUP`, membership-gated. A
  `hidden: true` group gets its room only once the story `reveal`s it.
- **Location rooms** — every `LOCATION` is a room; a beat whose
  `setting:` is that location speaks into it, heard by whoever is
  standing there. Typed guest chat in a location room is scoped to its
  occupants.
- **DM threads** — a character addressing one guest lands in a private
  thread between them; so does `reply`.

Where a scripted line lands is decided by the
[unified conversation model](first-scene.md): subject-bound dialogue →
that guest's DM; un-addressed dialogue and action narration → the
setting's location room (else the lobby), spoken by the **Narrator**.

## The app is a generic client

Nothing about any particular party is built into the participant app.
The event name (`# Title`) names the lobby and the story's sidebar
section; the rooms and the sides a guest can pick come from your
`LOCATION` / `SPACE` / `GROUP` declarations; the buttons a performer or
guest gets come from `INTERACTION`s ([Live verbs](live-verbs.md)); and
the skin comes from a header line:

```loom
# The Glass Orchard
theme: plain
```

`plain` (the default) is a quiet neutral look; `aol97` is a beveled
1997 chat-room look. Change the story and the app changes with it.
