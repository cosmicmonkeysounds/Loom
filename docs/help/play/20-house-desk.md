---
title: The Desk: setup and tests
section: Performers
order: 20
role: performer
keywords: tabs, sub-tabs, cues tab, music tab, mix tab, house tab, setup tab, the top, playing chip, his voice, voice, clean, broken, auto, flavour, break his next words, clippy's dream, dream, terminals, build, build stamp, old build, identify, tv voice, mute the tv, stop the announcement, costume, descent, music, tidal, playlist, pause, trabolta at the stereo, keep him off the music, desk window, setup, connect, connected, all connected, what to do, try it, try a look, try a sound, say on the speakers, say it, announcement, play anyway, sound router, router offline, router never connected, no interface, audio interface, layout moved, adat, announcements blocked, dropouts, missing sound, no file, placeholder, no speakers, lights module, lights offline, zigbee2mqtt, pair a bulb, wled, mind, outside mind, no mind connected, holding line, ollama, how the desk works, go, playing, cue list, walking the house, stop all, panic, lately, mixer, mix, levels, balance, fader, volume, louder, quieter, mute, meter, plays at, reset the mix, now playing, soundtrack, music, skip track, skip all, scene, by hand, follow the story, stop music, no router listening
---

The **Desk** is the house's own control: the speakers, the lights and the
minds that voice characters from outside the story (at *Trapped in the
Internet*, Trabolta). It is where a host connects the house, tests it, and
fires the house cues. Open it from the taskbar's **Desk**. It never edits
a cue: cues are built at the laptop, in the editor's Run → House → Cue
designer. The rest of hosting is in [Hosting the night](hosts.md).

## The top

Whichever tab is open, the top of the window stays where it is:

- **The status chips**: one line each for the sound router, the lights,
  each outside mind (🧠) and problems in the desk itself.
- **■ STOP ALL**: the panic. It stops every desk cue that is playing
  **and** the house sounds. The music stops too and comes back at the
  next act. Use it whenever something is wrong.
- **▶ and the cue's name**, beside it, while a cue is playing. Tap it to
  jump to **🎛 Cues**.
- **What just happened**: a line for a few seconds, over the top of the tab.
- **The tabs**: **🎛 Cues · 🎵 Music · 🎚 Mix · 🖥 House · 🔌 Setup**. A ✗ or
  ⚠ on 🔌 Setup says a system needs you, and a number on 🖥 House counts
  the terminals gone silent.

Your phone remembers the tab you were on. The first time, Task Manager
opens on 🎵 Music and everyone else on 🎛 Cues.

## 🎛 Cues

- **STANDBY** is the cue **GO** plays: its number and name, the
  operator's note, its steps in words and **⚡ Tells the story: …**, the
  story events it fires. GO plays it and stands by the next cue. If
  another host moved the standby just before you, nothing plays and it
  says *Standby moved — press GO again*.
- **Playing**: each running cue with its progress, what it is doing now,
  and **■ Stop**. A step that didn't happen says so.
- **Cues**: the list by section. Tap a cue to stand it by (▶ marks the
  standby, ♪ one that is playing).
- **Lately**: the last few things the house did, with what the house said
  back (*played*, *no-file*).

## 🎵 Music

It stays live only while this tab is open. The line at the top says where the music is
coming from: **Playing from TIDAL**, **TIDAL is paused**, **Playing files**, or
what is wrong. *TIDAL isn't answering* means the app needs starting on the
Desktop with `tidal.ps1`.

- **NOW PLAYING**: the **Scene** picker (picking one plays it by hand). While
  the music is on TIDAL, **⏮ ⏸ ⏭** are the app's own buttons; a pause holds until
  you tap ▶ or the scene changes. Then each playlist that is playing, its track
  and how far in, with **⏭** to skip it. A file playlist has no pause: it has
  **⏭ Skip all**. **■ Stop music** asks once, then stops it. A playlist with no
  tracks shows as a warning. *No soundtrack reported yet* means the router hasn't
  said what it plays.
- *By hand — until the story's next music cue, or ↺ Follow the story*: a scene,
  playlist or stop you picked. It stays until the story's next music cue takes
  over, or until you tap **↺ Follow the story**, which plays the story's scene
  again at once.
- **PLAY NOW**: the show's playlists, **Your TIDAL playlists** (everything in the
  app's sidebar), or paste a TIDAL playlist link. Each plays where the scene's
  music plays, by hand. An album's or a song's link won't play.
- **Music**: the level, the same one as in 🎚 Mix.
- **🤖 TRABOLTA**: he will change the music for a program he has grown chummy
  with. It shows who, and what he did last. While he has it, *Trabolta has the
  music*: it goes back by itself, or tap **↺ Take it back**. While you hold the
  music by hand he can't touch it. **🔒 Keep him off the music** stops him until
  you let him back, and hands back what he had on.

## 🎚 Mix

It stays live only while this tab is open. It moves the live balance of the
house sound. It never
changes the house map's speaker settings, and a speaker test always plays
at full level, so a muted room can still be walked.

- **No router listening: the mix is kept and applies when it connects**:
  your levels are saved and reach the speakers once the sound router is
  back.
- **Everywhere** and one chip per room pick where the levels apply. Each
  row is a slider from −∞ (silent) to +10 dB, its level, a mute (🔈 /
  🔇) and a thin meter of what is playing. **Master** (or **Room**) moves
  everything there; then each source: Music, Featured tracks, Sound
  effects, Footsteps, Announcements and **Trabolta (in 3)**, the TV's voice; in a
  room, each speaker (the sub has its own). *plays at −9.0 dB* means the levels
  above it move it too; *silent* means a mute above it. **Clippy (in 1)**, her
  wireless mic on the interface's Mic 1, reads *meter only*: she is mixed on the
  audio interface itself (CueMix), not here.
- **Reset** puts every level of that chip back to 0 dB, unmuted.

Moves show at once and reach the speakers within a moment. The mix
outlives a restart; Reset is the way back.

## 🖥 House

What you can do to the house's machines from your phone:

- **🌀 His voice**: **Auto** follows the night, **Clean** keeps him clean
  whatever happens (the kill switch), **Broken** breaks him until you change
  it. **Break his next words** breaks the next 8 seconds in one way you pick,
  in any of the three.
- **🔊 Mute the TV voice**: the TV stops speaking. Tap again to bring it back.
- **■ Stop + the announcement**: ■ STOP ALL lets an announcement finish; this
  cuts it and empties its queue.
- **🌀 Clippy's dream**: it starts by itself and runs until an ending. **Put the
  terminals back** returns every terminal and the games' terminals to their
  usual screens, and **Bring the dream back** undoes it. It asks first. It is off
  until 🕚.
- **⚡ Glitch**, only during a talk scene that has one.
- **[Try it](#try-it)**: a line on the speakers, a look or a story sound.
- **📟 Terminals**: every terminal and the TV, the silent ones first in red, then
  by name, each with its last poll and **Identify** (its name, full screen, on the
  terminal: once the doors are open it asks first, and a terminal that isn't
  answering may never show it). A row says what needs a person: **🔇 touch it** (its sound waits for a tap), **💤
  hidden** (the screen is off or something covers it), **⛶ not full**, a low
  battery, **🚪** the door sensor. The last mark is its build: red means it runs
  something other than the rest, so reload it. The head counts them.

A director's, on Run: **🎭 the costume's switch** and link (Run → Terminals) and
the descent (the House map card). Radio whoever is at the laptop.

## Try it

Quick tests on 🖥 House, with no marks:

- **📢 Say on the speakers**: type a line (up to 280 characters) and tap
  **📢 Say it**. The house says it on the speakers.
- **💡 Looks**: tap a look to play it on its lights.
- **▶ Story sounds**: tap a sound to play it where the story sends it.

A long list is folded behind its count; tap it to open. A row may carry a
warning (*no file on the router's machine*), and a list says once when
nothing can play it (*the sound router is offline*). After a tap, the line at the
top says what was sent (*▶ Playing* and the sound's name), or that it was
sent while nothing was there to play it. Once the doors are open, every
one of these asks first (*The show is live — guests will hear this.
Test anyway?* → **Play anyway**): guests hear the sound and see the
light.

## 🔌 Setup

**▸ How the Desk works** is five lines, folded: a line per tab. Under it **Setup**
and the **Checks**.

### Setup

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
  (an optical port not set to ADAT, or Main and Phones mirrored). Fix them
  on the interface, then restart the audio job.
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
  restart stagehand's agents job. If that isn't it, check the model: Claude's
  key, and Ollama, the standby, running.

If a fix needs the house machines, radio whoever is at the laptop: the
steps name the job to start, and the house runbooks say which machine
runs it.

### Checks

Before the doors, walk the house with your phone: every speaker, output,
story sound, light and look, one at a time. Tap the big test button,
then **✓ Heard it** (a light: **✓ Saw it**) or **✗ Nothing**. The mark is
saved for everyone and the walk moves to the next unchecked row. **next
›** and **‹ back** move by hand; **Every check** lists them all.
Once the doors are open each test asks first. The full walk is in
[Hosting the night](hosts.md), *Walking the checks*.
