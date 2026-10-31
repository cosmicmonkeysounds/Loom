---
title: Setting up terminals, the door sensor and headsets
section: Live Shows
order: 48
keywords: terminal setup, set up a terminal, provisioning, provisioning link, tablet, tablets, fleet, spot, view, code, mod passcode, moderator passcode, passcode, re-point, ⚙, advanced, door, door sensor, calibrate, calibrate door, door shut, door open, connect door sensor, door=serial, door=sim, fault, keys=0, keyboard, mouse-only, server room, heart terminal, announcements, say the house announcements, announce, house setting, always, never, tent, tent laptop, shed, reinstall, kiosk, chrome, voice link, microphone, mic, voices, mic=0, voices=0, https, fully kiosk, headset, headsets, VR, quest, set up this headset, connect, play offline, forget, lobby, test mic, ask again, build stamp
---

How the crew gets every screen in the house onto the event: the wall
tablets, the TV, the Server Room laptop with its door sensor, the tent
laptop and the VR headsets. None of this is in the guests' Help (wave 26
moved it here from the play app's *Terminals* and *Simulation*
articles). Run's **Terminals** card ([Run mode](43-run-mode.md)) shows
each screen once it has checked in, and its **🛠 Set up a terminal…**
builds the links below from pickers. The spots, rooms and voice links
come from the [house map](39-house-map.md).

## A tablet

Open `/terminal/` on the tablet, type the event's **moderator passcode**,
then **tap the terminal** this tablet is: the list is the event's house
map (its terminals, by floor and room, each saying what it shows — TV,
casino, chess board, the reinstallation station, a room terminal, a
house terminal). A spot another tablet is using right now says *⚠ online
now*. That's it: the name, the screen and the room come from the map,
which the house map editor sets. A whole fleet: open
`/terminal/?code=<mod passcode>&spot=<terminal id>` on each tablet. To
re-point a running tablet, hold ⚙ for 2 seconds and tap another
terminal.

## The Server Room laptop and its door sensor

The heart terminal (the Server Room, wave 20) bridges the room's door
sensor:
`/terminal/?code=<mod passcode>&spot=server-room&door=serial`. The first
time, hold ⚙ 2 seconds → *advanced* → *door sensor* → **Connect door
sensor** and pick the board in Chrome's list (once per browser profile),
then **Calibrate: door shut**, open the door, **Calibrate: door open**.
Calibrate the door again after every reflash of the board. After that it
reconnects on every boot and replug. ⚙ shows the live reading (*SHUT ·
level 2410*); a sensor that can't be trusted (unplugged, silent, flooded
with light) shows nothing to guests, reads *FAULT* in ⚙ and tells the
story nothing — Run → Terminals shows 🚪 red, and the 🚪 buttons on the
cue sheet take over until *Trust the door sensor*. `&keys=0` is a
mouse-only screen (no typing, only the choices). `&door=sim` is for
testing: **O** opens a pretend door, **C** shuts it, **F** toggles a
fault. The crew's kiosk notes (`docs/trapped/kiosk.md`) have the laptop's
launch line. What the room does with the door is in [Running the server
room](38-server-room.md).

On the night it has no mouse or keyboard: an old 4:3 CRT, a USB webcam, a
GameCube controller and spoken answers, set up with
`&webcam=C310&pad=1&whisper=1&crt=1` on the link or under ⚙ → *advanced* →
*no mouse or keyboard*. `webcam` is part of the camera's name, and it's
both the scanner and the microphone. On the controller, the left stick or
D-pad moves through the answers, **A** picks one, **B** goes back and **Y**
gives him a file; the bottom of the screen always says which buttons work
right now. Nothing on it leaves the terminal, and nothing skips him. The CRT
shows big plain text that types out as he speaks, under a waveform of his
voice, always on the newest line. With the door shut it plays the pipes, with
no ads, glitches or sound effects; when the door opens it asks for a pass, and
holding **Start** opens a virtual keyboard for a program name if the camera
can't read one. Keep Windows on a true 4:3 mode for the sharpest picture. When
a program picks ⟦SPEAK FREELY⟧,
**SPEAK TO HIM** listens, he says their words back, and they confirm
before anything is sent. Their voice stays on the laptop: whisper.cpp runs
there and nothing else hears it. If it isn't running, the choices still
work and **SPEAK TO HIM** says so. `pnpm showctl preflight serverroom`
checks it.

## Saying the house announcements

Under ⚙ → *advanced*, *say the house announcements* has three settings.
**House setting** (the default) follows the house's own list of
terminals out of earshot of the speakers: Run → Terminals marks those
with 📢, and a director turns a spot on or off there. **Always** says
them whatever the list says, and **Never** never does. On a provisioning
link, `&announce=1` is Always and `&announce=0` Never. A link built on
Run → Terminals' *Set up a terminal* carries `&announce=1` only when you
tick Always and no `announce` at all otherwise, so the tablet follows the
house list. Never write `&announce=0` by hand unless you mean Never: it
pins the tablet quiet whatever the house list says. The TV stays off:
its room hears the speakers.

## The tent laptop

`/terminal/?code=<mod passcode>&spot=tent&announce=1`, in Chrome started
in kiosk mode (the crew's kiosk notes have the line). The spot alone sets
its view and its name (*Tent*, or *Shed* on a rain night); don't add
`&view=reinstall`, or it keeps the name *Terminal* and stops following
the map. Between walks it is a scan kiosk (wave 26): the Reinstallation
Wizard card with the camera, a typed-name box and the programs **in the
Internet now** as quick picks, over a dimmed idle show. It is never
linked to the game: no camera into it, no voice link, no world view.

## The voice link

The voice link needs nothing set up: a placed terminal hears and is heard
as soon as someone touches it once (a tablet may not make or take sound
before a first touch; the TV's Chrome needs none), and the first time it
asks for the **microphone** — allow it. It carries sound only while a
reinstalling player is in that terminal's room in the game (wave 26). It
needs `https` (the event's own address is; a bare `http://192.168…` LAN
address isn't), and in Fully Kiosk, *Enable Microphone Access*. Under ⚙ →
advanced, **let the games hear this room** turns one tablet's microphone
off (or the TV's on), and **play the players near this screen** its
speaker; `&mic=0` / `&voices=0` in the link do the same. The house map
editor turns a terminal's voice link off for good (the tent's is off
already); a tablet picks that up within a minute, no reload. Run →
Terminals shows the 🎤 for each tablet: red **🎤 denied** (the microphone
was refused), **🎤 http** (no microphone over plain http) or **🎤 tap**
(nobody has touched it since it loaded, so it can neither hear nor be
heard); **🎤 off** where ⚙, its view or the map turns it off.

## A headset

**A headset that says SET UP THIS HEADSET** has no moderator passcode
yet: point at the server, type the event's moderator passcode on its
keyboard with the trigger, name it, and pull the trigger on **CONNECT**.
It remembers; holding the lobby's **⚙** for 5 seconds (2 on a computer)
forgets it. If its passcode stops working (the staff codes were changed),
the panel comes back on its own. **PLAY OFFLINE**, on a computer only,
plays without the event server. The first time a headset is set up it
asks to use the **microphone** while it sits in the lobby — allow it.
The lobby's mic line (wave 26) has **TEST MIC** (a level meter, no
session needed), **ASK AGAIN** for a refused microphone, and the build
stamp, so check both before doors.

**Before doors, on the headset:** Settings → General → Power → **Battery
saver off**. On, it holds the display at 72 Hz and dims it, and guests feel
it. Charge from a wall charger, not a computer's USB port. For each guest, turn
the lens spacing wheel (bottom left) until the picture is sharp, and wipe the
lenses.
