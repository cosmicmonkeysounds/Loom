---
title: The Desk: setup and tests
section: Performers
order: 20
role: performer
keywords: desk window, setup, connect, connected, all connected, what to do, try it, try a look, try a sound, say on the speakers, say it, announcement, play anyway, sound router, router offline, router never connected, no interface, audio interface, layout moved, adat, announcements blocked, dropouts, missing sound, no file, placeholder, no speakers, lights module, lights offline, zigbee2mqtt, pair a bulb, wled, mind, outside mind, no mind connected, holding line, ollama, how the desk works, go, playing, cue list, walking the house, stop all, panic, lately, mixer, mix, levels, balance, fader, volume, louder, quieter, mute, meter, plays at, reset the mix, now playing, soundtrack, music, skip track, skip all, scene, by hand, follow the story, stop music, no router listening
---

The **Desk** is the house's own control: the speakers, the lights and the
minds that voice characters from outside the story (at *Trapped in the
Internet*, Trabolta). It is where a host connects the house, tests it, and
fires the house cues. Open it from the taskbar's **Desk**. It never edits
a cue: cues are built at the laptop, in the editor's Run → House → Cue
designer. The rest of hosting is in [Hosting the night](hosts.md).

Top to bottom:

- **The status chips**: one line each for the sound router, the lights,
  each outside mind (🧠) and problems in the desk itself.
- **■ STOP ALL**: the panic. It stops every desk cue that is playing
  **and** the house sounds. The music stops too and comes back at the
  next act. Use it whenever something is wrong.
- **▸ How the Desk works**: five lines, folded. Tap to read them.
- **Setup** (below).
- **▸ 🎚 Mixer** (below), folded: the house's sound levels and the music.
- **STANDBY** and the big **GO**, then **Playing**, then the **Cues**.
- **Try it** (below), then the **Checks**, then **Lately**: the last few
  things the house did, with what the house Mac said (*played*,
  *no-file*).

## Setup

One card for each system: **🔊 Sound**, **💡 Lights**, and one **🧠** per
outside mind. Each card says what is connected on one line and has a
mark: ✓ fine, ⚠ worth a look, ✗ not working. A card that isn't fine has
**What to do**: the steps, in order. They are open when the system is
down (✗) and folded when it is only a warning (⚠). When everything is
fine the whole section is one line, **All connected ✓**; tap it to see
the cards.

What each problem means:

- **The sound router has not connected** (or *went quiet*): nothing plays
  on the house speakers. Start, or restart, stagehand's audio job on the
  machine the audio interface is plugged into, then wait a few seconds.
- **No report yet**: the router is connected but hasn't said how it is.
  Wait a few seconds; an old router never reports.
- **No interface**: the router can't find the audio interface. Power it
  on, plug it in, check its driver, then restart the audio job.
- **Other channel counts than expected**: the interface's settings moved
  (an optical port not on ADAT, the wrong rate, or Main and Phones
  mirrored). Fix them on the interface, then restart the audio job.
- **Announcements are blocked**: the router can't reach the house's
  message broker, so house announcements won't play.
- **Audio dropouts**: something else on the audio machine is busy. Close
  other audio apps.
- **Story sounds with no file** / **still the placeholder**: those sounds
  have no real file on the audio machine (a missing one plays nothing).
- **No speakers are placed**: the house map has no speakers yet.
- **The lights module has not connected**: no light changes. Start
  stagehand's lights job on the machine running Zigbee2MQTT.
- **Zigbee2MQTT doesn't know** a light: pair the bulb again and give it
  exactly the name on its card.
- **No lights yet**: no bulb or strip is placed on the house map.
- **🧠 No mind connected**: that character answers with the story's
  holding line instead of speaking for itself. On the mind's machine,
  check Ollama is running, then restart stagehand's agents job.

If a fix needs the house machines, radio whoever is at the laptop: the
steps name the job to start, and the house runbooks say which machine
runs it.

## Try it

Quick tests, with no marks:

- **📢 Say on the speakers**: type a line (up to 280 characters) and tap
  **📢 Say it**. The house says it on the speakers.
- **💡 Looks**: tap a look to play it on its lights.
- **▶ Story sounds**: tap a sound to play it where the story sends it.

A long list is folded behind its count; tap it to open. A row may carry a
warning (*no file on the router's machine*), and a list says once when
nothing can play it (*the sound router is offline*). After a tap, the line
under the box says what was sent (*▶ Playing* and the sound's name), or that it was
sent while nothing was there to play it. Once the doors are open, every
one of these asks first (*The show is live — guests will hear this.
Test anyway?* → **Play anyway**): guests hear the sound and see the
light.

## 🎚 Mixer

Tap **▸ 🎚 Mixer** to open it; it stays live only while it is open. It
moves the live balance of the house sound and steers the music. It never
changes the house map's speaker settings, and a speaker test always plays
at full level, so a muted room can still be walked.

- **No router listening: the mix is kept and applies when it connects**:
  your levels are saved and reach the speakers once the sound router is
  back.
- **NOW PLAYING**: the **Scene** picker (picking one plays it by hand),
  then each playlist that is playing, its track and how far in, with
  **⏭** to skip to its next track. **⏭ Skip all** skips every one;
  **■ Stop music** asks once, then stops it. A scene picked by hand (or a
  stop) says *By hand — the story's music cues are held*: the story's own
  music changes wait until you tap **↺ Follow the story**, which plays
  the story's scene again at once. A playlist with no tracks shows as a
  warning. *No soundtrack reported yet* means the router hasn't said
  what it plays.
- **Everywhere** and one chip per room pick where the levels apply. Each
  row is a slider from −∞ (silent) to +10 dB, its level, a mute (🔈 /
  🔇) and a thin meter of what is playing. **Master** (or **Room**) moves
  everything there; then each source: Music, Featured tracks, Sound
  effects, Footsteps, Announcements and the TV's voice; in a room, each speaker
  (the sub has its own). *plays at −9.0 dB* means the levels above it
  move it too; *silent* means a mute above it. A row marked *meter only*
  is mixed on the audio interface itself, not here.
- **Reset** puts every level of that chip back to 0 dB, unmuted.

Moves show at once and reach the speakers within a moment. The mix
outlives a restart; Reset is the way back.

## STANDBY, GO, Playing and the cues

- **STANDBY** is the cue **GO** plays: its number and name, the
  operator's note, its steps in words and **⚡ Tells the story: …**, the
  story events it fires. GO plays it and stands by the next cue. If
  another host moved the standby just before you, nothing plays and it
  says *Standby moved — press GO again*.
- **Playing**: each running cue with its progress, what it is doing now,
  and **■ Stop**. A step that didn't happen says so.
- **Cues**: the list by section. Tap a cue to stand it by (▶ marks the
  standby, ♪ one that is playing).

## Checks

Before the doors, walk the house with your phone: every speaker, output,
story sound, light and look, one at a time. Tap the big test button,
then **✓ Heard it** (a light: **✓ Saw it**) or **✗ Nothing**. The mark is
saved for everyone and the walk moves to the next unchecked row. **next
›** and **‹ back** move by hand; **Every check** lists them all.
Once the doors are open each test asks first. The full walk is in
[Hosting the night](hosts.md), *Walking the checks*.
