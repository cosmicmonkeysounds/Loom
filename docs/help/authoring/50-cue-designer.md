---
title: The Cue designer — lighting looks, sounds and desk cues, tied to the story
section: Live Shows
order: 50
keywords: cue designer, designer, design, lighting, lights, look, looks, animation, lighting animation, light show, template, pulse, heartbeat, flash, flicker, colour cycle, color cycle, alarm, work light, blackout, fade, preview, lamp, scrub, timeline, step, steps, brightness, colour, color, white, colour temperature, fade, transition, effect, safety light, floor, once, repeat, loop, give it back, restore, period, boot, resting look, test on the house, try, sound, sounds, audition, gain, speakers, desk cue, cue, story, cue line, sound line, when, story event, lights.json, save, save to project, Zigbee, WLED, Hue, ThirdReality
---

The **Cue designer** is where you design what the house does and tie it
to the story. Open it in **Run → House → 🎨 Cue designer** (a server
project with its rehearsal running, like the rest of
[the house desk](47-house-desk.md)).

It has three kinds of thing, listed on the left:

| | What it is | The story fires it with |
|---|---|---|
| 💡 **Look** | a lighting animation from `lights.json`: one colour, or timed steps | `cue <name>` |
| 🔊 **Sound** | a sound file on the router's machine | `sound <name>` |
| 🎬 **Desk cue** | sounds, looks, announcements and story events, together or one after another | `cue <id>` |

Pick one and the right side edits it, plays it, and shows **In the
story**: the line to write (with **Copy**), and every line of the story
that already uses it. Click a line to open it in Writing.

## Designing a lighting look

**+ New look** asks for a name (what the story writes after `cue`), a
template, which lights, and a colour:

| Template | What it does |
|---|---|
| Fade to a colour | one smooth change, then it stays |
| Pulse | swells bright and dim, until the next look |
| Heartbeat | thump-thump… thump-thump, until the next look |
| Flash, then give it back | three hard flashes, then the light it was showing comes back |
| Flicker, then give it back | a failing bulb for two seconds, then back to normal |
| Colour cycle | drifts between two colours, until the next look |
| Alarm | hard on-off, as fast as Zigbee bulbs take |
| Work light | plain bright white, for setting up |
| Blackout | off (a safety light stays at its floor) |

Every template is already safe for the house's bulbs. You then tune it:

- **The preview** at the top plays the look on screen, one lamp per light
  it reaches, with ▶ Preview, a scrubber and a marker per step (click a
  marker to pick its step). Timing, colours, brightness and the safety
  floor are exact. Real bulbs fade on their own curve, and their built-in
  effects only roughly look like the preview.
- **Lights**: the fixtures, zones, rooms or LOCATIONs it plays on
  (*reaches …* names the bulbs that means).
- **Plays**: *once*, *a few times*, *until the next look*, or *once, then
  give the light back* (the light the room was showing comes back after
  the period). A repeating look has a period; the field says the shortest
  one the bulbs can take.
- **The house's resting look (boot)**: played when the lights module
  starts and after a story reset.
- **Steps**: each has its time (**at**), power, brightness, colour (a
  colour, a white from cold to warm, or *keep*), fade, an optional bulb
  **effect**, and **only on** to aim one step at fewer lights. **▶ Try**
  sends just that step to one light. **+ Step** adds one far enough after
  the last.

Zigbee bulbs drop commands sent too fast and flicker badly, so steps on a
bulb stay at least 0.15 s apart (0.4 s for a colour change) and a
repeating look on Zigbee is at least 1.5 s long. A **safety** light (the
server room's bulb) never goes off or below its floor. Problems show in
red on the look (they block Save); warnings in amber.

**▶ Test on the house** plays the saved look on the real lights. With
unsaved edits it offers to save first. Once the doors are open, every test
asks first: guests see it.

**Save** stores the lights for this event (the lights module plays them at
once); **Save to project** writes `lights.json` into the project so they
survive End and relaunch and reach your co-writers. **Discard** drops your
edits. If another director saved meanwhile, Save asks whether to load
theirs or keep yours.

The list marks each look: → once, × a few times, ↻ until the next look,
↩ give it back; ★ the resting look; ● unsaved; ⛔ problems; ∅ reaches no
light; ⚡ how many story lines and desk cues play it.

**N more story cues with no look here** (folded) lists the story's
`cue` names that no look or desk cue answers; **+ name** writes a look for
one. In *Trapped in the Internet* every `lights_*` cue is a look (wave 31:
there are no Zigbee scenes or WLED presets any more), except
`lights_server_open`: the server room is the heart's, lit by its
`heart_*` looks. The rest of the list are the screens' cues (`screens_*`,
`tv_*`, …) and the house's show rules (Trabolta's room cuts and
`screens_flicker`, stagehand's `show` job), which work without a look. The
looks are DRAFTs: play each one on the house (▶ Test on the house), retune
it, Save to project.

## Sounds

The story's sounds are listed with what the router's machine has: its
length, *no file* or *placeholder*. Pick one to:

- **Audition** it on the house: as the story routes it, or on chosen
  speakers, zones or rooms, at a gain (−60 to +12 dB).
- **Make a desk cue** that plays it, with a look at the same time, and
  optionally tells the story an event once both have finished.

Sound files live on the machine running the router, in
`stagehand/media/sounds/`. Which speakers a story sound uses by default
is set on the [house map](39-house-map.md)'s 🔊 Audio tab.

## Desk cues

A desk cue shows its steps on a timeline, ▶ **GO**, and **Edit in Desk →**
(the Desk view's inspector, where its steps are edited and the desk is
saved; see [the house desk](47-house-desk.md)). **In the story** also
lists the story events it fires, and whether a `when` hears each one:

```loom
== The Reveal
cue heart_reveal

when heart_reveal_done:
  fire open_the_vault
```

**+ Desk cue with this look** (on a look) and **+ Desk cue** (on a sound)
make a new desk cue and open it in the Desk view. Save the desk there
before the story or GO can play it.

## Which to use

- Just lights? A **look**: `cue <name>`.
- Just a sound, routed as usual? `sound <name>`.
- Lights and sound together, an announcement, or the story should wait
  until it has played? A **desk cue**: `cue <id>`, then `when <event>:`.

Setting up the machines, the audio interface and the bulbs is in
[Setting up the house](49-house-setup.md); **🔌 Setup** in Run → House
shows what is connected.
