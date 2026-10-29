---
title: The Mixer — balance the house sound and steer the soundtrack
section: Live Shows
order: 51
keywords: mixer, mix, house mix, balance, fader, faders, level, levels, volume, louder, quieter, mute, unmute, dB, decibel, meter, meters, peak, room, rooms, zone, speaker, sub, subwoofer, master, everywhere, source, sources, music, soundtrack, featured tracks, sound effects, sfx, announcements, TV, Trabolta's channel, input, CueMix, reset, reset all, plays at, silent, now playing, scene, music scene, by hand, follow the story, skip, skip track, next track, skip all, stop music, playlist, bed, empty playlist, router, Run → House, host, director
---

The **Mixer** is the live balance of the house sound. Open it in
**Run → House → 🎚 Mixer** (a server project with its rehearsal running,
like the rest of [the house desk](47-house-desk.md)). A host's phone has
the same mixer in its **Desk** window. Only directors and hosts can move
it.

What you move here rides on top of the install: each speaker's gain on
the house map stays the install trim, and the mix never changes
`audio.json` or the story. It is kept on the event server, so it
survives a server, router or story restart. **Reset** is the way back.

## The strip

Across the top: is the sound router listening, and its machine's name.
With no router the mix is kept and applies the moment it connects.
**Reset all** (it asks first) puts every fader and mute back to 0 dB.

## Now playing

The soundtrack, as the router last reported it:

- **Scene**: pick one to play it by hand. A hand scene is held: the
  story's `cue music_*` lines are ignored until you press **Follow the
  story** (the badge says *by hand*), or until the story's next live
  music cue.
- Each **bed** (a playlist playing on some speakers): the rooms it plays
  in, the track and how far in, and **⏭ Skip** for the next track.
  **⏭ Skip all** skips every bed.
- **■ Stop music** stops the soundtrack, held like a hand scene.
- An empty playlist (no file on the router's machine) shows as a warning.

*No soundtrack reported yet* means the router has no `soundtrack.yaml`,
or hasn't sent its first report.

## The console

One column per scope, side by side (scroll across for more rooms):
**Everywhere**, then each room that has a speaker. Each column lists:

| Strip | What it moves |
|---|---|
| **Master** / **Room** | everything in that scope |
| **Music**, **Featured tracks**, **Sound effects**, **Announcements** | that source, in that scope |
| An input (Trabolta's channel, the TV) | that routed input, in that scope |
| A speaker (in a room's column) | that one speaker: the sub has its own |
| A meter only (Clippy's mic) | nothing: it is mixed in CueMix, not by the router |

What a source plays at on a speaker is the sum of its faders: the
Master, the source everywhere, the room, the source in that room, and the
speaker. A strip whose sum differs from its own fader says **plays at**;
one silenced by a mute above it says **silent**. Any mute, or a fader at
the bottom (−∞), silences it.

- Faders run from −∞ (−60 dB) to +10 dB in half-dB steps. Drag, or focus
  one and use the arrow keys.
- **Double-click**, **Alt-click** or press **0** on a fader to put it
  back to 0 dB. **M** mutes.
- The bar under each fader is its live meter (green, amber near the top,
  red at the limiter). Meters show only while someone has a mixer open.
- A column's **Reset** puts its faders back to 0 dB.

## Good to know

- Moves are heard within a moment; the router's limiter still holds the
  peak.
- Muting Trabolta's channel **everywhere** (or the Master) also stops it
  ducking the music, so the soundtrack doesn't dip under a voice nobody
  hears. Muting it in one room leaves the ducking alone.
- Speaker tests (the desk's checks) are never mixed, so a muted room can
  still be walked.

Setting up the router and the speakers is in
[Setting up the house](49-house-setup.md).
