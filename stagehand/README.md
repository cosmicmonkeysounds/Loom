# loom-stagehand

The bridge between a live Loom event (the `@loom/core` event server) and
everything in the house that isn't a phone or a terminal: the lights, the
speakers, the props and sensors, and the characters voiced by a language
model. One Python daemon, one YAML per machine. Each top-level section of
the YAML switches on a **module**:

| Module | Section | Does |
|---|---|---|
| **show** | `show:` | story → MQTT / OSC cues (Trabolta's room cuts and the flicker, bulb by bulb; the announcement relay); MQTT sensors → journaled story signals |
| **agents** | `agents:` | voices every `mind: external` character (Trabolta) with a local model through Ollama |
| **audio** | `audio:` | the house speaker router: every story `sound X`, the house announcements, the soundtrack (music beds per act, ducked under Trabolta, Clippy's mic and the announcements), Trabolta's TV routed to every speaker, speaker tests and Run's ■ Stop house sounds, through one multichannel interface (the MOTU 828x on its own outs, no ADAT expander); also renders the synthesized SFX library |
| **lights** | `lights:` | plays the event's `lights.json` looks (every story `cue lights_*` and `heart_*`) on Zigbee2MQTT / WLED, bulb by bulb, safety-clamped, with identify / test / pairing from the map editor, and catches the house look up from the screen state's `night.lights` |
| **alexa** | `alexa:` | **retired for the show** (wave 18b): a standalone announcement player. The router speaks the announcements now; the code stays for a house that wants one |

Every module in a process shares one authenticated link to the server
(`modapi.ModClient`). A crashed module is restarted without taking its
neighbours down. Machines only dial **out** to the server, so nothing in
the house has to be reachable from the internet.

Design: [`docs/loom-show-control.md`](../docs/loom-show-control.md). Agent
internals: [`docs/agents.md`](./docs/agents.md). Notes for coding agents:
[`CLAUDE.md`](./CLAUDE.md).

## Which machine runs what (Oct 31)

| Machine | stagehand jobs | Config | Supervisor | Runbook |
|---|---|---|---|---|
| **John's MacBook** (macOS, M3 Max 48 GB) | `agents` (Trabolta, with Ollama `gpt-oss:20b`); `audio` only as the fallback | `laptop.yaml` (agents), `trapped.macbook.yaml` (the router fallback) | launchd | [`scripts/house-macbook/trabolta.md`](../scripts/house-macbook/trabolta.md); [`audio.md`](../scripts/house-macbook/audio.md) for the fallback |
| **John's Desktop** (Windows) | `show`, `lights` and `audio` (the MOTU 828x, over ASIO); beside them Mosquitto, Zigbee2MQTT on the CC2652P (the Hue and ZL1 bulbs), the WLED strip's controller and the TV kiosk | `trapped.desktop.yaml` | Task Scheduler | [`scripts/house-desktop/README.md`](../scripts/house-desktop/README.md) |

The audio router runs on the Desktop since 2026-10-27; the MacBook takes it
only if the 828x misbehaves on Windows (the Desktop README's §11). Only
ever run it on one machine.
Steph's laptop (the server room) and John's old laptop (the tent) run no
stagehand: they are terminals in Chrome.

```
            the VPS event server (app.mapsandducks.com)
                 ▲ SSE + POST, dialled out from the house
   ┌─────────────┼──────────────────────────┐
   │ John's MacBook                         │ John's Desktop (192.168.8.10)
   │  agents  ── Ollama gpt-oss:20b         │  show    ─┐
   │                                        │  lights  ─┤ 127.0.0.1:1883
   │  (audio: only the fallback, dialling   │  audio   ─┘ ── MOTU 828x ──► speakers
   │   the Desktop's :1884)                 │  Zigbee2MQTT ── CC2652P ── Hue + ZL1 bulbs
   └────────────────────────────────────────┘  Mosquitto (:1884 for the LAN) ◄── WLED controller (Wi-Fi)
                                               Chrome kiosk ── HDMI ── the TV (picture)
                                               Chrome's sound ── VoiceMeeter ── audio.tap ── 828x input 3
```

**Announcements.** `do announce "…"` reaches the speakers as: the
server's feed → the Desktop's `show` job → MQTT `show/announce` on the
Desktop's broker → the router (on the Desktop; on the MacBook over `:1884`
in the fallback) → the speakers. With that broker or the `show` job down,
nothing is spoken (only terminals provisioned `&announce=1`, the tent,
still say them). Story sounds don't take this path: the router reads the
server's feed itself.

## Install

```bash
cd stagehand
uv sync                       # Python 3.11+, every dependency (wheels, no compiler)
uv run stagehand modules      # the module kinds
```

On Windows the same `uv sync` works in Windows PowerShell 5.1; the
Desktop README covers the rest of that machine.

## Config files

| File | Tracked | What it is |
|---|---|---|
| `show.example.yaml`, `agents.example.yaml`, `audio.example.yaml`, `lights.example.yaml` | yes | commented, test-pinned examples of each section |
| `laptop.yaml` | no | the MacBook's `agents` config (copy `agents.example.yaml`): the server, the models, `mind_mode: new`, the persona path |
| `trapped.house.yaml` | yes | the show's shared base: every `show` cue and sensor rule, the catch-up, the router's settings, the (commented) lights section. Cross-checked against the story by `tests/test_trapped_house.py` |
| `trapped.desktop.yaml` | yes | `extends: trapped.house.yaml`; adds `lights:` (Zigbee2MQTT on loopback) and the router's Windows settings |
| `trapped.macbook.yaml` | yes | `extends: trapped.house.yaml`; `show: null` (the Desktop's), the router's MQTT pointed at the Desktop's `:1884` |
| `<name>.local.yaml` | no | per-machine secrets beside a file (see below) |

**`extends:`** names a file in the same folder. Mappings merge key by key,
anything else replaces, and `null` deletes a key or a whole section.

**Secrets stay out of git.** `load_config` merges a sibling
`<name>.local.yaml` over the file. It must hold a `server:` mapping (event,
mod_passcode, mod_token, url; `server: {}` is fine) and may also hold a
module's `mqtt:` (another machine's broker and its password) and the
router's `device` / `host_api` / `voice_engine` / `say_voice`. The order:
the parent, the parent's `.local.yaml`, the child, the child's
`.local.yaml`, then the environment (`LOOM_SERVER_URL`, `LOOM_EVENT_ID`,
`LOOM_MOD_PASSCODE`, `LOOM_MOD_TOKEN`). So one `trapped.house.local.yaml`
serves every machine that extends the house file:

```yaml
# trapped.house.local.yaml
server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
# trapped.desktop.local.yaml (the Desktop: the MOTU's ASIO name)
server: {}
audio: { device: "<part of the MOTU's ASIO name>" }
# trapped.macbook.local.yaml (only the router fallback)
server: {}
audio: { mqtt: { password: "<the props password>" } }
```

`stagehand check` prints a `PLACEHOLDER …` line while a `CHANGE-ME`
survives.

## The command line

| Command | Does |
|---|---|
| `stagehand check --config F [--only a,b]` | validate the file and describe every module; probes the device, broker and Zigbee2MQTT where the module has one; exits non-zero on a problem |
| `stagehand run --config F [--only a,b] [--log-file P] [-v]` | run the modules (all present, or `--only`) |
| `stagehand modules` | list the module kinds |
| `stagehand launchd install\|uninstall\|restart\|status\|print --job show\|agents\|audio\|lights [--config F]` | macOS: one per-user LaunchAgent per module |
| `stagehand tasks install\|uninstall\|restart\|stop\|status\|print --job … [--config F]` | Windows: one Task Scheduler task per module |
| `stagehand sounds stop [--announce] \| play <name> [--to T] [--gain DB] \| placeholders [--force] [--no-say] [--only a,b] [--out DIR] --config F` | the router by hand over MQTT, and the labelled placeholder sounds |
| `stagehand sounds library [--list] [--only a,b] [--out DIR] [--story] --config F` | render the synthesized SFX library into `media/library/`; `--story` also writes each story sound's stand-in into `sounds_dir` (never over a real file) |
| `stagehand music scene <name> \| next [--playlist X] \| stop \| status --config F` | the soundtrack by hand over MQTT (`next --playlist` skips one bed); `status` prints the scene, each bed's track, the input levels, who is ducking and the house mix's levels that are not at unity |
| `stagehand announce --config F [--no-chime] text…` | one announcement now: through the router over MQTT (or an `alexa:` section's player) |
| `stagehand lights test <fixture\|look> [--color #rrggbb] [--brightness N] [--off] \| pair [--seconds N] \| devices --config F` | the lights through the event server (the `lights` job must be running) |
| `stagehand ask --config laptop.yaml [--character C] [--name N] [--var k=v] [--reflect] [--power P] [text…]` | talk to a persona straight through the model, no server |
| `python -m stagehand.replay live\|offline\|score\|extract …` | the agent replay harness on a scratch server ([`docs/agents.md`](./docs/agents.md)) |

Run every command as `uv run stagehand …` from `stagehand/`.

**Always pass `--only` on a show machine.** A bare `check` or `run` starts
every section in the file, and the machine files inherit sections the
other machine runs. Two `show` jobs fire every cue twice; two routers
speak every announcement twice.

**Never `pkill -f "stagehand run"`.** It kills every job on the machine,
including Trabolta's worker. Restart one job through its supervisor.

### launchd (macOS)

```bash
uv run stagehand launchd install --job agents --config laptop.yaml
uv run stagehand launchd install --job audio  --config trapped.macbook.yaml   # only the router fallback
uv run stagehand launchd status                    # every job
uv run stagehand launchd restart --job agents      # only Trabolta's worker
uv run stagehand launchd print --job agents --config laptop.yaml   # the plist, nothing installed
```

Each job is a per-user LaunchAgent `com.mapsandducks.stagehand.<job>`,
started at login, relaunched if it exits (throttled to 10 s), running
`uv run stagehand run --config <file> --only <job>`, logging to
`~/Library/Logs/stagehand/<job>.log`. `install` validates the config for
that module first. Turn on automatic login so a power cut brings the jobs
back.

### Task Scheduler (Windows)

```powershell
uv run stagehand tasks install --job show   --config trapped.desktop.yaml
uv run stagehand tasks install --job lights --config trapped.desktop.yaml
uv run stagehand tasks install --job audio  --config trapped.desktop.yaml
uv run stagehand tasks status
uv run stagehand tasks restart --job lights
uv run stagehand tasks stop --job show       # disables it as well, so the keep-alive can't restart it
```

Each job is a task `\Loom\stagehand-<job>`, started at the user's logon in
the interactive session (never a session-0 service: ASIO drivers and the
default audio device belong to the desktop), with no time limit and normal
priority. It runs the venv's `pythonw.exe -m stagehand run --config <file>
--only <job> --log-file %LOCALAPPDATA%\stagehand\logs\<job>.log` (no
console window; UTF-8, rotated at 10 MB). A one-minute repeating trigger
restarts it within a minute of dying. `uv sync` must have made `.venv`
first. The PC must sign in by itself after a power cut (Sysinternals
Autologon). `scripts/house-desktop/start-stagehand.ps1` wraps all of this.

## The MacBook: `agents` (and the router fallback)

`laptop.yaml` runs the `agents` module: it holds the agent stream for the
characters it has personas for (`trabolta.persona.md` and its mind file
`trabolta.mind.md`, both in the show folder), and answers each request
with one call on `gpt-oss:20b` (`mind_mode: new`, the story mind). The
second, classic orchestrator model is only loaded under
`mind_mode: classic`.

```bash
ollama pull gpt-oss:20b
uv run stagehand ask   --config laptop.yaml "Hello?"         # the persona, no server
uv run stagehand check --config laptop.yaml                   # prints the mind mode, switches, context sizes
uv run stagehand launchd install --job agents --config laptop.yaml
```

After a persona, mind file or worker change: `uv run stagehand launchd
restart --job agents`, then Run → Mind → Reset. The kill-switch ladder,
the persona keys, the guards and the judge are in
[`docs/agents.md`](./docs/agents.md).

The whole Trabolta runbook (Ollama, keep-alive, `laptop.yaml`, the job,
Run → Mind) is
[`scripts/house-macbook/trabolta.md`](../scripts/house-macbook/trabolta.md).
In the router fallback this Mac also runs `trapped.macbook.yaml`'s `audio`
job: [`scripts/house-macbook/audio.md`](../scripts/house-macbook/audio.md).

## The Desktop: `show`, `lights` and `audio`

`trapped.desktop.yaml` runs `show` (the house rig's cue map, the sensors,
the catch-up, the announcement relay), `lights` (every bulb and strip in
`lights.json`) and `audio` (the speaker router on the MOTU 828x, over ASIO)
against Mosquitto and Zigbee2MQTT on the same PC. Its setup, from
installing Python to the 828x, the Hue / ZL1 bulbs, the WLED strip, the TV
kiosk and a show-night `preflight.ps1`, is
[`scripts/house-desktop/README.md`](../scripts/house-desktop/README.md).

```powershell
uv run stagehand check --config trapped.desktop.yaml --only show,lights,audio
uv run stagehand tasks install --job show   --config trapped.desktop.yaml
uv run stagehand tasks install --job lights --config trapped.desktop.yaml
uv run stagehand tasks install --job audio  --config trapped.desktop.yaml
```

## show — story ⇄ house

**Wire** (`core/server/event-runtime.ts`): the lean mod feed `GET
{url}[/e/:event]/events?role=mod&id=stagehand&lean=1` (`message` / `sim` /
`lifecycle` frames, no snapshots; stagehand reads `sim`), auth by the
`x-loom-token` header (bootstrapped with `POST /api/mod/login {passcode}`),
and mutations `POST /api/mod/signal {name, subject?}`, `/api/mod/beat`,
`/api/mod/set {id, field: "location", value}`.

**The cue map** turns `sim` directives into MQTT publishes or OSC messages
(`show/cuemap.py`): `cue <name>`, the long form `<cue: lights, room: …,
state: …>`, `sound X` (the `sfx` directive), `do announce`, `do door …`.
**The sensor map** turns MQTT topics into story signals, beats or
arrivals (`show/sensormap.py`); a pattern may capture segments
(`vision/{cam}/tamper` subscribes as `vision/+/tamper` and exposes
`{cam}`).

**The real house** is `trapped.house.yaml` plus the show's `lights.json`
(wave 31). Every `cue lights_*` is a `lights.json` look, played by the
`lights` job on each bulb by its Zigbee2MQTT name and on the living room's
WLED strip (`wled/living`); there are no Zigbee groups, Zigbee scenes or
WLED presets. `trapped.house.yaml` keeps what a look can't say: Trabolta's
three-room `cut_the_lights` and its restore and `screens_flicker` (a
one-shot bulb blink), both addressed bulb by bulb, `do announce` →
`show/announce` and `sound announce_chime` → `show/chime` for the router,
and the printer's button and lid sensors back as `printer_button_pressed`
/ `printer_opened`. The safety lights (the three halls and both
bathrooms, never off, never under 60 / 254; the server room's RGB bulb
`server_room_rgb`, never under 80) are clamped by the `lights` job, and no
`show` rule addresses them.

**Not stagehand's:** the server-room door and the patch bay. Both are on
the Grand Central M4 beside Steph's laptop, and that terminal page posts
`door_sensor_opened` / `door_sensor_closed` and `patch_changed {combo}`
to the story itself (`hardware/server-room-m4/`). The ESP32 server-room
box is not installed: its `show/serverroom/*` publishes and
`sensors/patchbay/state` rules stay in the YAML for a bench and fire for
nobody. Nothing in stagehand drives the door's keypad lock.

`tests/test_trapped_house.py` pins the rig to the story: every light cue
is a `lights.json` look, every sound an `audio.json` cue and a `media/sounds.yaml`
entry, every sensor signal a `when` in `main.loom`, the combos match the
story's seeds, and the safety edits hold (no cue darkens a safety room or
all of WLED, nothing drives a lock, nothing reaches the server room's
bulb). The wiring walkthrough is in `docs/loom-show-control.md` → *Trapped
in the Internet: the house rig*.

### Sensor rules: `edge` and retained messages

A state sensor republishes its state (Z2M sends `contact: false` with
every battery report; the broker replays a retained "open" on every
reconnect). Two per-rule switches make it fire once per real change:

```yaml
- on: { topic: "zigbee2mqtt/printer_lid", when: "contact == false" }
  edge: true                 # fire on false → true only (per topic)
  signal: { name: printer_opened, debounce_s: 30 }
```

- **Retained messages never fire a rule** unless it says
  `accept_retained: true`. On an `edge: true` rule they still set the
  level, so a restart with the lid propped open fires nothing.
- `edge: true` needs a `when:`; the level starts false, and a message
  carrying none of the fields the condition reads (a battery-only report)
  is ignored.

### The lights catch up

The mod feed has no replay, so a `cue lights_*` fired while the uplink is
down would be lost. On every (re)connect of the feed or the broker, and
1.5 s after a `reset` / `reload` / `golive` lifecycle frame, `show` reads
`GET /api/state` and replays its `catch_up:` list through the cue map:
the current `lights_{Night.lights}` look (never `alarm`, which would re-arm
the siren; `server_open` replays `lights_y2k` first), then Trabolta's cut
room if it is still dark, or lit again under the look the story restored
it under (`Night.lit_scene`). It waits up to 10 s for the broker session
and replays nothing when a live lights cue arrived meanwhile.
`tests/test_trapped_house.py` checks the rules against the story's own
restore test.

### Conventions

- `retain: false` on every `/set` and WLED `/api` command (a retained OFF
  survives into tomorrow night); quote `"on"` in WLED payloads (a bare
  `on:` key is YAML `true`); never stream flicker over Zigbee.
- Stagehand never validates signal names: a typo is silent, which is what
  `test_trapped_house.py` is for.
- The SSE streams give up after 60 s of silence (the server pings every
  25 s) and reconnect with backoff.
- **`t_exec`**: a cue with `t_exec: "+200ms"` is sent at once with the
  absolute execution time (epoch ms, as a string) appended as the last
  argument, so NTP-synced receivers can fire together.

| Topic | Direction | Notes |
|---|---|---|
| `sensors/<node>/<sensor>` | prop → story | JSON; non-JSON lands as `{"value": …}` |
| `props/<prop>/…` | story → prop | publish retained so props re-converge |
| `show/scene`, `show/vibe` | story → all | retained global show state |
| `show/announce`, `show/chime` | show → router | the house announcements |
| `show/audio/play`, `show/audio/stop`, `show/audio/test`, `show/audio/music` | anyone on the broker → router | by hand, with the uplink down |
| `health/<node>` | LWT | `health/stagehand`, `health/audio`, `health/lights` (`online` / `lost`) |

## agents — characters with a language model for a mind

A story marks a character `mind: external`; the server then turns every
conversation with it (a guest's DM, a performer's Cast thread, a
director's persona) into an **agent request** streamed to connected
workers (`GET /api/agent/stream`). The worker answers `POST
/api/agent/reply {say, adjust, acts}`; the server journals the line,
clamps the adjustments to the story's declared ranges and carries out
each act. One open request per thread; requests queue while no worker is
online (the story's `hold:` line is said after about 20 s), time out after
2 minutes with one retry, and are cancelled by a run restart.

- **`mind_mode: new`** (the show's): one voice call per guest line;
  phase cards in the mind file set his stage, favours, drives, powers and
  brief as `Night.phase` moves; a memo per person; code guards on every
  line (never-words, answer words, invented facts, catchphrases, repeats).
- **`mind_mode: classic`** (an absent key): the voice plus an
  orchestrator model that grows the mind between turns.
- Every model call is a recorded **thought**, streamed to the editor's
  Run → Mind page, whose control panel (reset, rewrite brief, nudge, set,
  pause, re-run, …) sends `control` frames to the worker.
- A story's `judge: <Character>` sends every non-exact fact filing to the
  worker as a `judge` frame: one stateless same-or-not call.
- Answer secrecy: the mind file's `secrets:` keeps hunt answers out of
  every prompt and drops any verdict on them; `never` words (the door
  code, the patch-bay pairs, generated by `titi:facts`) never leave the
  worker.

All of it, with the YAML switches and the kill-switch ladder:
[`docs/agents.md`](./docs/agents.md).

## lights — the house lights

The event's `lights.json` (a project file beside `audio.json`, edited on
the map editor's 💡 Lights tab, served at `GET /api/mod/lights`, schema in
`@loom/house` `house/src/lights.ts`) places each light the story drives —
a Zigbee bulb, a Z2M group or a WLED strip — on a room and defines
**looks** keyed by cue name (`cue heart_wake` plays `looks.heart_wake`).
The show's file places every house bulb (Hue and ThirdReality, each by its
Zigbee2MQTT name), the living room's WLED strip and the server room's RGB
bulb, with every `lights_*` and `heart_*` look (no Zigbee groups, scenes or
WLED presets).

- **The sequencer** (`lights/plan.py`, the Python mirror of `planLook`,
  pinned to the house package's fixtures in
  `tests/fixtures/house-lights/`): each look's timed steps per fixture,
  `repeat` times or looped. A new look on a fixture takes it over. A
  `then: "restore"` look gives back the interrupted loop, else the last
  settled look, else `boot`.
- **Safety**: a `safety: true` fixture is never OFF and never under
  `max(40, min)` (`clamp_for_safety`); the server-room bulb's floor is 80.
- **From the map editor**: identify, look and state tests, *Pair new
  device* (`permit_join`); Zigbee2MQTT's device list is posted back to the
  server for the device picker.
- **The catch-up** reads `GET /api/screen/state` on start, on a reconnect
  and after a reset / reload / go live: the alarm → `heart_alarm`; the door
  open mid-heart → `heart_door_open`; else `night.heart_look`; else `boot`.
- **Presence pulses** (wave 39, `docs/loom-w39-contract.md` C3): when a
  program in the reinstallation games (web or VR) walks under a real
  light, the server marks that fixture present (`presence` on the long
  poll, cursor `presence=<seq>`) and the module pulses the bulb with its
  own firmware effect: Zigbee `{"effect": "breathe"}` (or `lights.json`'s
  `presence.effect`), re-sent every 12 s while the program stays, then
  `{"effect": "finish_effect"}`; a WLED strip its Breathe (`fx 2`; blink
  → `fx 1`) once, then back to the effect its looks left it on. Only what
  `presence.to` reaches, never a `safety` fixture, nothing with
  `presence.enabled: false` (`presence_settings` / `presence_fixtures`
  in `lights/routing.py`, pinned to `lights-presence.json`). A pulse never
  takes a fixture from a look, a look never stops a pulse (a WLED look's
  effect waits until the program leaves) and an identify wins for its 2 s.
  A breathe on a bulb a look turned off shows nothing: a dark scene stays
  dark.
- **What the fixtures show** (wave 39): every command the module sends
  (looks, give-backs, tests, catch-ups, pulses; not identify flashes),
  safety-clamped and merged per fixture like `mergeLightState`, goes to
  `POST /api/mod/lights/shown` 250 ms after a change (at most 4 a second)
  and every 20 s anyway, so the games light their virtual house with the
  real one. Nothing is posted before the first command. An older server
  (a 404) is logged once and the module stops posting until it restarts;
  the games then use the server's own estimate.
- **The hand-off**: with `take_looks: true`, a `show:` in the same config
  drops each cue rule whose look `lights.json` defines, so a cue never
  drives a bulb twice.
- **Health**: `health/lights` and the retained `health/lights/stats`
  (`pulsed`: the fixtures pulsing now; `shown_posts`).

Runbook: [`scripts/house-macbook/lights.md`](../scripts/house-macbook/lights.md)
(it covers the Desktop too).

## audio — the house speaker router

The event's `audio.json` (a project file, the map editor's Audio tab,
`GET /api/mod/audio`) says which speakers sit in which room, which
interface output each is on, the input → output matrix, and where each
story sound and the announcements go. The `audio:` section only says what
the router may do on its machine:

```yaml
audio:
  sounds_dir: media/sounds   # sound printer_grind → media/sounds/printer_grind.wav|aiff|flac
  play_sounds: true          # the router plays `sound X` (the show module then skips OSC sound cues)
  announce: true             # the router plays `do announce` (no alexa: section allowed beside it)
  passthrough: true          # duplex: the TV's input is routed and every input is metered
  tap: { device: "VoiceMeeter Output", host_api: mme, ch: 3 }  # wave 46: a capture device summed into an input
  priority:                  # dB at full activity, per bus (sfx = story sounds, music = the beds)
    trabolta: { music: -18, sfx: -8 }
    announce: { music: -15, sfx: -12 }
    clippy:   { music: -12 }
  sidechain: { threshold_db: -45, attack_s: 0.04, hold_s: 0.8, release_s: 1.2,
               roles: { clippy: { threshold_db: -30 } } }
  soundtrack: media/soundtrack.yaml
```

- **One stream** on the device named by `audio.json` `device.name` (a
  substring; `device:` overrides), mixed in numpy (`audio/mixer.py`):
  voices laid out per speaker, the matrix, priority ducking, a per-output
  trim (the speakers' gain, heard at once on a long bed), a master gain
  and a per-output limiter. A stream that dies is reopened every 2 s.
- **The rig** (wave 38; channels in the 828x's Windows ASIO order since
  wave 46: Main L/R 1–2, Analog 1–8 3–10, S/PDIF 11–12, Phones 13–14): the
  living room is the 828x's Main L/R (outs 1–2) plus the sub on Analog Out
  1 (out 3; its own speaker `living-sub`, its own trim). Chrome's sound on
  the Desktop (the TV's Trabolta) reaches input 3 through VoiceMeeter and
  `audio.tap` (below), and the router sends it to every placed speaker but
  the sub (`audio.json` `routes`); the TV's own speakers get nothing, or
  he plays twice. Clippy's wireless mic (input 1) stays
  mixed in CueMix to the living room; the router only meters it. In
  CueMix, input 3 goes to no output (the router routes it).
- **The tap** (`audio.tap`, wave 46, `audio/tap.py`): a capture device
  summed into one of the interface's inputs, as if it were cabled there.
  The Desktop has no line out, so Chrome plays into VoiceMeeter ("VoiceMeeter
  Input", the VAIO strip on B1 only) and the tap opens "VoiceMeeter Output"
  on MME as a second, capture-only stream and adds it into input 3 in the
  ASIO callback: routed, metered and ducking the music like a cable. A ring
  buffer absorbs the two clocks (~10–30 ms; a `slip` drops frames when it
  runs full, an `underrun` pads silence). `check` prints `audio tap:
  <device> → input 3` or fails naming the device; the health line ends `|
  tap … → in 3 peak N dBFS, underruns N, slips N` (or `NOT OPEN (why)`).
  A tap that fails to open never stops the router (`audio tap failed to
  open (...) — playing on without it`). VoiceMeeter must be running.
- **Priority ducking**: an `audio.json` input with a `role` (`trabolta`,
  `clippy`) is a sidechain: its level over `sidechain.threshold_db` (or
  the role's own) ducks the buses its `priority` row names on the
  speakers its `reach` covers (the TV everywhere, Clippy the living
  room). Announcements duck by `priority.announce`; a takeover track
  silences the music on its speakers. A `no_duck` sound, the
  announcements, the tests and the live inputs are never ducked. Set
  Clippy's threshold at rehearsal: the music at party level, the lav
  idle, read input 1 in `stagehand music status`, set it ~6 dB over.
  The MacBook fallback is output-only: no TV route and no input ducks.
- **The soundtrack** (`media/soundtrack.yaml`; the file's header is the
  guide): a playlist per act (`media/music/doors/`, `act-1/`, `malware/`,
  `act-2/`, `act-3/`, `final/`, `ceremony/`, `afterparty/`; git-ignored,
  any of mp3 / wav / flac / ogg / aiff), shuffled and crossfaded,
  streamed (never decoded whole). The story's `cue music_<scene>` picks
  the scene; after a restart the router catches up from the screen
  state's `night.music`. A story sound under `tracks:` (the dance
  songs, `ceremony_bed`, `ad_jingle`) streams as a takeover: the beds on
  its speakers fall silent until it ends. An empty folder is a `check`
  warning and a silent bed (it retries every 10 s). `check` also flags
  a VBR MP3 with no length header (it would stop early) with the
  `ffmpeg` line that fixes it. By hand: `stagehand music scene act_1`,
  which holds until the story's next music cue or a restart.
- **The SFX library** (`audio/sfx/`): original synthesized sounds
  (sirens, dings, telephony, digital, retro, party, story stand-ins,
  ambient loops), 48 kHz WAVs, rendered byte-identically every time:
  `uv run stagehand sounds library --story --config
  trapped.desktop.yaml` on the Desktop writes `media/library/` and
  replaces each story placeholder that has a stand-in. A real file is
  never replaced, and a real file of any format plays instead of a
  stand-in beside it (`ad_jingle.mp3` beats the stand-in
  `ad_jingle.wav`). Look at them with `uv run --with matplotlib python -m
  stagehand.audio.sfx.inspect --only a,b --out DIR`.
- **`device.expect`**: the show's 828x must report 32 in / 30 out (both
  optical ports on ADAT, even with no expander plugged in); anything else
  means mirroring, 96 kHz or TOSLink moved the layout, and `check` fails.
- **Where a `sound X` goes**, first match: the line's own rooms (`sound X
  in <Place>` / `with rooms:`), `audio.json` `cues[X].to`, the beat's
  setting, everywhere (`audio/routing.py`, the mirror of `@loom/house`
  `resolveTargets`, pinned by shared fixtures).
- **Announcements**: a chime, then the machine's own voice — macOS `say`
  (`Samantha`) or Windows SAPI (`Microsoft Zira Desktop`;
  `voice_engine: auto` picks per platform) — on `announce.to`, the sounds
  ducked −12 dB and the music −15 dB (`priority.announce`) except
  `no_duck` (`dance_song`, `rave`, `hand_jive`).
- **Placeholders**: `media/sounds.yaml` (tracked) lists the 19 story
  sounds; `stagehand sounds placeholders` writes a labelled stand-in for
  each, never over a real file (a wav, aiff, flac, mp3 or ogg; a `.wav`
  wins over the others). `check` lists every placeholder left.
- **Stop all house sounds**: Run's ■, a host's dock or the director phone
  (`POST /api/mod/audio/stop`); a 0.3 s fade of the story sounds, the
  tests and the music beds, `--announce` also cuts the line and the
  queue. The music stays off until the story's next music cue (or a
  catch-up after a restart or a reconnect); bring it back sooner with
  `stagehand music scene <name>`. The TV's route and the live mics are
  untouched. On the LAN: `stagehand sounds stop`.
- **The house desk** (wave 25, [`docs/loom-house-desk.md`](../docs/loom-house-desk.md)
  §4): a desk cue's `sound` and `say` steps reach the router as *plays*
  on its poll (`plays=<seq>`). A sound play routes like `sound X with
  rooms:` its `to` (no `to`: the cue's, else everywhere), its `gain` dB
  on top; a say play is an announcement (the chime unless `chime:
  false`) on its own `to` (else `announce.to`). A play more than 10 s old
  is dropped. Every play and every Test from the server is acked to
  `POST /api/mod/audio/report` with its length, so the desk knows when
  the step ends.
- **The house mixer** (wave 40, [`docs/loom-w40-contract.md`](../docs/loom-w40-contract.md)
  C3): Run → House → 🎚 Mixer (or a host's Desk window) balances the
  sources (`music`, `tracks`, `sfx`, `announce`, each routed input as
  `in:<role>`) everywhere, per room and per speaker. Every poll answer
  carries the mix; the router ramps to it over 50 ms on top of the
  speakers' install trims (it never edits `audio.json`). Speaker tests
  are never mixed, and an input muted everywhere ducks nothing. The
  mixer's transport reaches the router as music commands on the poll
  (`music=<seq>`, dropped after 10 s): ⏭ one bed or all, a scene by hand,
  ■ Stop music (both held until the story's next music cue), *Follow the
  story*. While a panel is open the router posts live meters to
  `POST /api/mod/audio/meters` four times a second.
- **Offline**: the last `audio.json` + `house.json` and the house mix are
  cached, so a boot with the uplink down still routes at the last balance.
- **Health**: a line every `health_s`; `health/audio` and the retained
  `health/audio/stats`; the same numbers go to the server's report (the
  desk's chips and checks), with every file in `sounds_dir` and its
  length, the soundtrack's scene and beds, the input levels, who is
  ducking and the underruns (`pnpm showctl doctor` prints them). A server too old for the report answers 404: logged once, and
  the router plays on.

**Windows** (the Desktop, the router's home since 2026-10-27): `host_api: asio`
opens the 828x as one device (it also sets `SD_ENABLE_ASIO` before
sounddevice loads), SAPI speaks through Windows PowerShell 5.1, the
player lock uses `msvcrt`, and caches live under
`%LOCALAPPDATA%\stagehand\`.

Runbooks: [`scripts/house-desktop/README.md`](../scripts/house-desktop/README.md)
§3 (the Desktop) and
[`scripts/house-macbook/audio.md`](../scripts/house-macbook/audio.md) (the
MacBook fallback). Room-by-room design and history:
[`docs/trapped/room-audio.md`](../docs/trapped/room-audio.md).

## alexa (retired)

A standalone player: MQTT `show/announce` → a chime and the Mac's `say`
voice on a named CoreAudio device, or `engine: server` for the server's
`/api/mod/tts`. Retired for the show in wave 18b: the router does this,
and an `alexa:` section beside `audio.announce: true` is a config error
(the two share one voice lock). Remove a leftover agent with
`scripts/house-macbook/install-alexa.sh --uninstall`.

## Tests

```bash
uv run pytest            # 2193 passed + 4 skipped, ~70 s, no hardware
```

Pure units over fakes: the config loader (`extends:`, overlays,
placeholders), directives, conditions, topics, both maps, the SSE parser,
the whole agents path (persona, prompts, guards, memos, the wire, the
judge, answer secrecy, the classic snapshot, the replay harness without a
model), the router (routing fixtures, the mixer block by block, streams and the
resampler, the soundtrack, priority ducking end to end on the show's
`audio.json`, a fake stream and server), every SFX library sound
(levels, seams, determinism), the lights (planner fixtures, the module, the CLI),
launchd plists and Task Scheduler XML, the SAPI voice, the PowerShell
scripts' syntax (`test_house_desktop_scripts.py`), Windows imports, the
machine files (`test_machine_configs.py`) and the real rig against the
story (`test_trapped_house.py`). Socket wiring is exercised live against
Mosquitto and a scratch event server, not in unit tests.

The README before this rewrite (with the per-wave notes) is kept at
[`docs/history/stagehand-readme-2026-10.md`](../docs/history/stagehand-readme-2026-10.md).
