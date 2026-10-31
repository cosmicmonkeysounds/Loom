---
title: The Mixer — balance the house sound
section: Live Shows
order: 51
keywords: mixer, mix, house mix, balance, fader, faders, level, levels, volume, louder, quieter, mute, unmute, dB, decibel, meter, meters, peak, room, rooms, zone, speaker, sub, subwoofer, master, everywhere, source, sources, music, soundtrack, featured tracks, sound effects, sfx, footsteps, steps, announcements, TV, Trabolta's channel, input, CueMix, reset, reset all, plays at, silent, now playing, scene, music scene, by hand, follow the story, skip, skip track, next track, skip all, stop music, playlist, bed, empty playlist, router, Run → House, host, director
---

The **Mixer** is the live balance of the house sound. Open it in
**Run → House → 🎚 Mixer** (a server project with its rehearsal running,
like the rest of [the house desk](47-house-desk.md)). A host's phone has
the same mixer on the 🎚 Mix tab of its **Desk** window. Only directors and hosts can move
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

What is playing, the TIDAL buttons and the playlists moved to
[the Music manager](57-music-manager.md) in **Run → House → 🎵 Music**.

## The console

One column per scope, side by side (scroll across for more rooms):
**Everywhere**, then each room that has a speaker. Each column lists:

| Strip | What it moves |
|---|---|
| **Master** / **Room** | everything in that scope |
| **Music**, **Featured tracks**, **Sound effects**, **Footsteps**, **Announcements** | that source, in that scope. **Footsteps** are the programs walking in the reinstallation games, heard on the house speakers near where they walk |
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
