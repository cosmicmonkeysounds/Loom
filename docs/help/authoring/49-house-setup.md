---
title: Setting up the house: sound, lights and Trabolta
section: Live Shows
order: 49
keywords: house setup, setup, set up the house, Setup pane, Run → House, sound, speakers, router, audio, audio job, MOTU, 828x, ADAT, ASIO, sound files, placeholder, lights, lights job, Zigbee, Zigbee2MQTT, Z2M, Hue, Philips Hue, ThirdReality, ZL1, bulb, pair a bulb, WLED, LED strip, Mosquitto, broker, props, Trabolta, mind, Ollama, gpt-oss, agents, worker, laptop.yaml, Desktop, MacBook, Windows, macOS, fallback, which machine, bring up, order, connected, offline, preflight, showctl, runbook, stagehand
---

The story only *asks* for a sound, a lights look or a line from Trabolta.
Three programs on two house computers make it happen: the **sound
router**, the **lights module** and **Trabolta's mind**. This page says
which computer runs what, the order to bring them up, and how to tell each
one is connected. The step-by-step runbooks live in the repo (paths
below); this is the map.

## Which machine runs what

| | Runs | Runbook |
|---|---|---|
| **John's Desktop** (Windows) | 🔊 **Sound**: the speaker router (stagehand `audio`) on the MOTU 828x and its ADAT expander. 💡 **Lights**: Zigbee2MQTT with the Philips Hue and ThirdReality ZL1 bulbs, the WLED LED strip, and stagehand `lights`. Also the house broker (Mosquitto), stagehand `show` (the cues and the announcements) and the living-room TV. | `scripts/house-desktop/README.md` |
| **John's MacBook** (macOS) | 🧠 **Trabolta**: Ollama with `gpt-oss:20b` and stagehand `agents`. Also the director's Run console and the deploy scripts. | `scripts/house-macbook/trabolta.md` |

The MacBook can take the sound router instead, if the MOTU misbehaves on
Windows: `scripts/house-macbook/audio.md`, and the Desktop README's
*MacBook fallback* section. Only one computer may ever run the router (two
would say every announcement twice).

The machines, the cables and the open questions: `TECH.md` in the show's
folder. Every stagehand job and config: `stagehand/README.md`.

## The order to bring it up

1. **The broker** on the Desktop (Mosquitto). Everything else talks
   through it: the cues, the announcements, the bulbs, the strip.
2. **The audio interface**: the 828x and the expander powered, its
   Windows driver proven (one ASIO device, 32 in / 30 out).
3. **Zigbee2MQTT** on the USB stick, then the **lights job**, then pair
   each bulb (a Hue bulb needs a reset first: Touchlink, its serial
   number, a Hue dimmer or the Hue app, never its switch), name it, and
   set it to come back on after a power cut. The **WLED strip** joins over
   Wi-Fi and dials the broker.
4. **stagehand on the Desktop**: `show`, `lights` and `audio`, one
   scheduled task each, with this event's id and the moderator passcode in
   its local config (never in the repo).
5. **Place everything on the [house map](39-house-map.md)** and **Save to
   project**: each speaker on its output (🔈 Test it), each bulb as a
   *Zigbee bulb* with its Zigbee2MQTT name, a group as a *Zigbee2MQTT
   group*, the strip as a *WLED strip* with its topic `wled/<room>`. Tick
   **safety light** for anything people walk by.
6. **Trabolta on the MacBook**: Ollama running with the model loaded, then
   the `agents` job, then Run → Mind → **Reset**.

## How to know it's connected

Open **Run → House**. Its **Setup** pane has one row per system, green
when it is up and otherwise a short list of what to do next:

- **🔊 Sound**: the router online (on which computer, which interface),
  how many sound files it has, and any problem — no interface found, the
  interface's channels moved (the ADAT expander off or unclocked),
  announcements blocked (the broker), story sounds with no file or still
  the generated placeholder, no speakers placed.
- **💡 Lights**: the lights module online, how many Zigbee lights and
  WLED strips are placed and how many looks are written; a light
  Zigbee2MQTT doesn't know (pair it, then give it exactly that name); 🔗
  **Pair a bulb** opens joining for a new one.
- **🧠 Trabolta**: his mind online and on which worker. Red means guests
  get his holding line: check Ollama, then restart the `agents` job.

Then walk the **Checks** pane (every speaker, every output, every sound,
every light and look, with a Test button and a ✓ / ✗ mark each) and design
the lighting looks in the **Cue designer**. The [house desk](47-house-desk.md)
explains the checks; the [Mind debugger](44-mind-debugger.md) explains
Trabolta's page.

Before the doors, each computer's own preflight must be green:
`.\scripts\house-desktop\preflight.ps1` on the Desktop and
`pnpm showctl preflight macbook` on the MacBook (both take a flag when the
router is on the MacBook: `-NoAudio` / `--router macbook`).
