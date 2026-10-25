---
title: The house desk — cues for the house, and testing every speaker and light
section: Live Shows
order: 47
keywords: house desk, desk, House tab, Run → House, desk.json, cue list, house cue, QLab, GO, standby, playhead, stop, stop all, panic, step, steps, parallel, series, with, then, wait, sound, say, announcement, look, light, story event, done, speech, wait for speech, timeline, sections, cue number, inspector, checks, test, test next, speaker test, output test, story sounds, lights test, colours, mark, heard it, nothing, reset marks, zigbee, pair, pairing, bulb, live, router, lights module, save to project, cue, when, fire, house
---

The **house desk** is the house's own cue list: a small QLab built into
Loom. A **desk cue** is a short timeline of house steps — a sound on some
speakers, an announcement, a lights look, one light colour, stop the
house sounds, a story event, wait for a room's lines to be spoken, or
plain time. You build it, test it and press **GO** in **Run → House**;
hosts can press GO and walk the checks from their phone's **Desk**
window; and the story plays a desk cue by name.

It is also where you **connect and test** the house: every speaker,
every output of the interface, every story sound, every light and every
look, one row at a time.

The desk lives on the event server, so Run → House works on a server
project with a run. On a local folder it explains that it needs one.

## The page

- **The status strip** across the top: is the house Mac's router online
  (and on which interface), missing sound files or placeholders, a moved
  interface layout, is the lights module online, lights Zigbee2MQTT
  doesn't know. **■ STOP ALL** is the panic: it stops every running desk
  cue **and** fades out every house sound. On the right, where the desk
  comes from (the project's `desk.json`, or a director's save for this
  event) with **Save to project**.
- **The transport and the cue list** on the left. The big **GO** plays
  the cue under the playhead (the ▶ row, outlined green) and names the
  story events it will fire, so nobody fires them by surprise. GO moves
  the playhead to the next cue. **■ Stop** stops every running desk cue
  (the story's own sounds keep playing). Each row shows the cue's number,
  name, its steps in one line, how long it plans to take (*≥ 4 s* when a
  step's length is only known once it plays) and its story events as
  ⚡ chips. A running cue shows a progress bar and each step's state
  (· waiting, ▶ playing, ✓ done). Click a row to edit it, **double-click
  to GO it**, click its ▶ to put the playhead there.
- **On the right**, two views: **Cue** (the inspector) and **Checks**.

## Building a cue

Press **+ Cue**, then in the inspector:

- **name**, **number** (shown before the name; any text: `12`, `2.5`)
  and **section** (a heading in the list; later cues join it).
- **id** — what the story writes after `cue`. Lower-case letters,
  digits, `_` and `-`. **↻** makes it from the name. It can never start
  with a screens' prefix (`room_`, `tv_`, `tablet_`, `terminals_`,
  `screens_`) and never equals a lights look's name.
- **when it ends, fire** — a story event fired once the cue's last step
  has ended (never after a stop).
- **notes** for whoever runs the desk.

Then add **steps** with **+ Step…**:

| Step | Does | Lasts |
|---|---|---|
| 🔊 sound | plays a sound file; **to** picks speakers, zones or rooms (none: as the story routes that sound), with a gain | the file's length (or the length you give it) |
| 📢 say | a house announcement in the router's voice, with the chime | as long as the speech |
| 💡 look | plays a lights look | the look's plan (a looping look: no time) |
| 💡 light | one state on some lights: on / off, brightness, colour or white, fade | its fade |
| ■ stop sounds | stops the house sounds (ticked: the announcement too) | a short fade |
| ⚡ story event | fires a story event | no time |
| 🗣 wait for speech | waits until the terminals in a room have said that room's lines (at most a limit) | until they go quiet |
| ⏱ wait | nothing | the time you give it |

Every step can also wait a little after its group starts (**+ s**) and
carry a note. **Save** sends the desk to the event; problems (an unknown
look, a bad id) block the save and show on their cue and step in red;
warnings (a sound the story doesn't know, an event no `when` hears) show
in amber and still save. **Discard** drops your edits. If someone else
saved the desk while you were editing, Save asks whether to load theirs
or keep yours.

## Parallel and series

Steps run in **groups**. A step marked **with ↑** starts together with
the step above it. A step marked **then** waits until **every** step
above it has ended. Click the label to switch. The timeline bar above the
steps draws the cue as planned (grey bars are steps whose length the
house tells the desk only when they play).

Say a cue has: *look heart_wake*, *with ↑ sound server_hum (+0.5 s)*,
*then event heart_speaks*, *with ↑ wait for speech in The Server Room*,
*then look heart_listen*. The flash and the hum start together, the hum
half a second later. When both have ended the story hears `heart_speaks`
and its lines play, and the desk waits for the server-room terminal to
say them. When it falls quiet, the listening look goes up.

## The story and the desk

The story plays a desk cue with `cue` and the cue's id, the same
statement that plays a lights look:

```loom
== The Reveal
cue heart_reveal
```

The desk talks back with story events. An event step and a cue's *when
it ends, fire* each fire an event the story hears with `when`:

```loom
when heart_speaks:
  Trabolta: You came all the way down here.

when heart_reveal_done:
  fire open_the_vault
```

- Pressing GO by hand fires the same events, so a rehearsal can run a
  scene without its trigger. The story's lints know a project
  `desk.json`'s cue ids and events, so a story built on the desk checks
  clean.
- A restart of the server stops a cue that was playing (its *when it
  ends* event never fires); GO it again or fire its event by hand.

## Walking the checks

Open **Checks** and walk the house, a room at a time. The list has
**Speakers**, **Outputs** (each channel of the interface), **Story
sounds**, **Lights** and **Looks**. Each row has **Test** (a tone and its
name on a speaker or output, the sound itself, a light's identify, a
look), colour buttons for a colour bulb, and **✓** / **✗** marks that
every console and the hosts' phones share. Amber hints say what may stop
a row working before anyone listens (*no file on the house Mac*, *the
router is offline*, *Zigbee2MQTT has no device …*).

**▶ Test next** tests the next row with no mark. The keys walk it
without the mouse (click in the checks first):

| Key | Does |
|---|---|
| **T** | test the selected row |
| **Y** | ✓ heard / seen it, then the next open row |
| **N** | ✗ nothing, then the next open row |
| **↓** / **↑** | the next open row / the row above |
| **Esc** | stop the running cues |

The marks are kept for the event (setup happens days before the show);
**Reset marks** clears them all. Once the doors are open, every test asks
first: guests hear and see it. **🔗 Pair a bulb** lets a new Zigbee bulb
join for two minutes (then place it on the [house map](39-house-map.md)).

## Keys in the cue list

| Key | Does |
|---|---|
| **Space** | GO the playhead's cue |
| **↑** / **↓** | move the playhead |
| **Esc** | stop the running cues |

The keys go to the side you last clicked, and never fire while you type
in a field. See [Run mode](43-run-mode.md) for the rest of Run.

## Keeping the desk

A save is kept for this event only. **Save to project** writes it into
the project as `desk.json`, beside `audio.json` and `lights.json`, so it
survives End → relaunch and reaches every co-writer.
