> **Historical (moved from `docs/trapped/` on 2026-10-24).** A planning or audit note from October 2026; the code, the show folder and the package docs win where they differ.

> **Wave 7 (2026-10-17) supersedes the door / lock sections (≈ lines 193–258).** Nothing in stagehand drives a lock (the real door has a standalone keypad lock, and `test_trapped_house.py` forbids any lock / strike / latch / relay / bolt / solenoid action); `do door` reaches only the ESP32's ring; the door rule fires `server_door_opened` on `open == true` from a contact that closes when the door opens, `debounce_s: 20`, and the story plays The Heart instead of an alarm. Current: [OCT31 §5 *Wave 7 status*](../../../core/examples/trapped-in-the-internet/OCT31.md), `docs/loom-show-control.md`.
>
> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../../core/examples/trapped-in-the-internet/OCT31.md)). Built (K-05, K-20, N-08): retained messages reach the sensor map and are ignored unless `accept_retained: true`; per-rule `edge: true`; a 60 s SSE read deadline so a dead WAN reconnects; the lean mod feed (`&lean=1`, K-22); `stagehand launchd install --job show|agents`; the safety groups and per-device blackout in `trapped.house.yaml`; the maglock rules deleted; Z2M/WLED rules in the right shape (§3); the `alexa` module (a local TTS player for `show/announce`, §6.4); the server-room ESP32 firmware (§4–5, [`hardware/server-room/`](../../../hardware/server-room)). Still open: signal `args` and a `var` action from the sensor map, a cue `delay:` / timed sequences, an audio player beyond OSC → QLab, the editor tech rail.

# Stagehand vs. the *Trapped in the Internet* house hardware: audit

*2026-10-14. Scope: `stagehand/` (the Python show-control and agents daemon), `docs/loom-show-control.md`, and the story → sim → mod SSE → stagehand path, checked against the party's real hardware: Hue/IKEA bulbs on Zigbee2MQTT, PAUTIX COB strips on ESP32 WLED controllers, a server-room door sensor, Trabolta's patch bay, the printer, audio, and Alexa.*

**Test run:** `cd stagehand && uv run pytest -q` gives **153 passed in 0.81s**.

**Config check:** I wrote a draft house config (copied in §9; the built config is now `stagehand/trapped.house.yaml`). `stagehand check` accepts it, and I ran it through the pure `evaluate_cues` / `evaluate_sensors` functions (a throwaway script). Every "works today" snippet below was run that way. One snippet failed in an instructive way (the YAML `on:` trap, §3.3).

---

## 0. Verdict at a glance

| # | Item | Status | One line |
|---|---|---|---|
| 1a | Zigbee2MQTT lights (Hue/IKEA) | **PARTIAL** | The router can publish exact Z2M payloads with explicit `payload:` dicts. The shipped example rule (`house/lights/{room}/set` + `payload_from_args` + `retain`) is the wrong shape for Z2M. No timed sequences (blackout, then back on). |
| 1b | WLED (PAUTIX COB on ESP32) | **PARTIAL** | `wled/<topic>/api` with a JSON body (`{"ps": N}`) works today. **YAML trap:** an unquoted `on:` key in a payload becomes `"true"`. Presets/playlists have to be built in each WLED UI. |
| 1c | Light scenes (10 named looks) | **PARTIAL** | Doable today as one rule per scene × fixture group, about 20 rules. No lookup table, no delays, no reconvergence after a stagehand restart. |
| 2 | Server-room door sensor → alert | **PARTIAL** | The MQTT → `signal` path exists and is tested. Missing: edge detection, ignoring retained messages, a `var` action, signal `args`. "Unlocked" logic belongs in the story and works today. |
| 3 | Patch bay → self-destruct | **PARTIAL** | Works today **if stagehand YAML judges the combination** (`when: "combo == '…'"` → two different signals). The story cannot judge it, because stagehand can't send signal `args` even though the server accepts them. No hardware or firmware exists yet. |
| 4a | Printer button / lid | **SUPPORTED** (stagehand side) | A Zigbee button or ESP32 → `signal`. Story hooks and hardware not built. |
| 4b | Other prop sensors (tube PIR, front door, server-room PIR, keys) | **SUPPORTED** (stagehand side) | Same pattern. None authored in the story. |
| 4c | Audio (dance song, Trabolta's song, ad audio, alarm siren) | **PARTIAL** | The only audio path is OSC to an external player (TouchDesigner, as designed, or QLab). That works today with zero code. Stagehand has no built-in player or HTTP output. |
| 4d | Alexa announcements | **PARTIAL / MISSING** | Today "Alexa" is just a `broadcast "!🔊 ALEXA: …"` chat alert. A real speaker means either MQTT → Home Assistant → Alexa Media Player (works from stagehand today, but needs the cloud) or a local TTS player (needs code). |
| 5 | Admin panel → hardware | **SUPPORTED via authoring** | No mod route fires a raw cue. A director fires a named event (or edits a `Night.*` world var), and a story rule issues the `cue`. The editor has no tech rail (`health/#`). |
| 6 | Monitors (terminal tablets) showing ads / beats / video | **MISSING** (outside stagehand) | The terminal app has face, world view, mirror and scanner, but no media or "screen cue" mode. Nothing consumes `cue screens …` except an OSC target. |

---

## 1. How story statements reach the house today

```
.loom statement ──lexer──► directive text ──Sim──► SimEvent ──EventRuntime.fanout──► mod SSE "sim" frame ──► stagehand show module ──► MQTT / OSC
                                                                                                         ▲
MQTT sensor msg ──► stagehand sensor map ──► POST /api/mod/{signal,beat,set} ──► journaled commit ─────────┘ (hooks fire, cues come back out)
```

1. **Statement table.** `core/src/parser/statements.ts:74-76`:
   - `cue` takes `SINGLE_NAME`. The regex (`statements.ts:35`) is `^[A-Za-z_][A-Za-z0-9_.\-]*(\s+with\s+.+)?$`.
   - `sound` is renamed to **`sfx`**.
   - Line 116: `do <verb> args` is the escape hatch for any custom verb (`prop`, `vibe`, `announce`, …).
2. **Directive passthrough.** In the default arm of the sim's directive switch (`core/src/runtime/sim/sim.ts:2005-2007`), any verb the sim doesn't handle natively is recorded as `{type:"directive", verb, args}`, with `{expr}` interpolated. `cue`, `sfx`, `prop`, `vibe` and `announce` all take this path. `fire` is recorded too (`sim.ts:2001`) and also fires hooks.
3. **Other events stagehand can match.**
   - `broadcast` → `{type:"broadcast", cue, audience, scope}` (`sim.ts:2142-2156`).
   - `set` → `{type:"worldSet", path, value}` (`sim.ts:2034-2055`; type at `core/src/runtime/sim/event.ts:75`).
   - Also `beatEntered`, `signal`, `arrived`, `captured`, …
4. **Fanout.** `EventRuntime.fanout` sends every raw SimEvent to each mod-role SSE client as a `sim` frame (`core/server/event-runtime.ts:558-567`). The mod SSE needs a mod token or an author session (`event-runtime.ts:1592-1600`).
   - The README note at `stagehand/README.md:265-270` ("the SSE stream itself grants the raw mod feed to any client") is **stale**. Delete it.
5. **Stagehand, story → world.**
   - `ShowControl._sse_loop` / `_on_sim` (`stagehand/src/stagehand/show/module.py:96-121`) handle only `sim` frames.
   - `evaluate_cues` (`show/cuemap.py:210-237`) matches by directive verb plus `match:` on the parsed target/kwargs, or by raw event type plus field equality.
   - Outputs are OSC (`show/osc.py`) or MQTT (`show/mqtt.py:72-73`).
6. **Stagehand, world → story.**
   - `_sensor_loop` → `evaluate_sensors` (`show/sensormap.py:121-153`) → `_mod_call` (`show/module.py:134-145`).
   - Only three actions exist (`sensormap.py:52-56`): `signal{name, subject}`, `beat{name, subject}`, `arrive{person, location}`.
   - `ModClient.signal` sends only `{name, subject}` (`stagehand/src/stagehand/modapi.py:118-119`).
   - The **server already accepts `args`** and `actor` on `/api/mod/signal` (`event-runtime.ts:2739-2758`), and `Sim.signal` binds args by name in hook bodies (`sim.ts:336-360`).
   - The server also has `POST /api/mod/var {path, value}` (`event-runtime.ts:2957-2972`), which writes any world variable and emits `worldSet`. Stagehand can't call it.
7. **Module registry.** `stagehand/src/stagehand/module.py:80-89` registers `show` and `agents`. A new job (for example an `audio` module) is a subpackage plus one registry line.

### 1.1 What the current show actually cues

`core/examples/trapped-in-the-internet/` issues exactly **two** hardware cues, both Trabolta "powers" (`cast/trabolta.loom:101-107`):
- `<cue: lights, room: {room}, state: off>`
- `<cue: screens, effect: flicker>`

Everything else that sounds physical is a `broadcast` to phones only ("All screens go red", "Every door in the house locks"; see `beats/endings.loom:48,89,123`). The rewrite has to add real `cue` lines.

---

## 2. Authoring gotchas found (these will bite the rewrite)

I ran each form through `statementToDirective` (core) and `parse_directive` (stagehand):

| Written in `.loom` | Lowered directive | What stagehand sees | Result |
|---|---|---|---|
| `cue alarm` | `cue: alarm` | target=`alarm` | ✅ **Use this.** One-word scene names, matched by `match: {target: alarm}`. |
| `<cue: lights, room: Kitchen, state: OFF>` | (long form) | target=`lights`, kwargs room/state | ✅ works |
| `cue lights, room: Kitchen` | **`null`, so the line is PROSE** | nothing | ❌ The whole line is shown to guests as narration. |
| `cue lights with scene: alarm` | `cue: lights with scene: alarm` | kwargs `{"lights with scene": "alarm"}`, target `""` | ❌ **Silently matches nothing.** Stagehand's parser (`show/directives.py:80-94`) doesn't know Loom 4's `with` syntax. |
| `sound dance_song` | `sfx: dance_song` | verb **`sfx`** | ✅ but rules must use `directive: sfx`, not `sound` |
| `do announce "ALL PROGRAMS: to the Desktop, now."` | `announce: "…"` | target = the unquoted text (commas and colons inside quotes survive) | ✅ |
| `do prop printer, state: jammed` | `prop: printer, state: jammed` | target `printer`, kwargs | ✅ |

**Fix (small, recommended).** Teach `parse_directive` the `X with k: v, k2: v2` form:
- split off a top-level ` with `
- the head becomes the first target
- the tail goes through the existing kwargs splitter

Add a test. Until then, **author one-word cues (`cue tube_chase`) or the bracket long form.**

Event-name rules from the show's own gotcha list still apply to sensor signal names:
- don't start with a built-in verb word (`release …`, `scan …`)
- don't contain ` is `
- a filler word plus one word collapses (`the door` becomes `door`)

Good names: `server door opened`, `trabolta unplugged`, `printer button pressed`, `patch rejected`. Stagehand never checks that a YAML signal name matches a story `when` rule. A typo is a silent no-op. Improvement: have `stagehand check` fetch the model's named events and warn.

---

## 3. LIGHTS

### 3.1 Zigbee2MQTT (Philips Hue + IKEA)

What Z2M wants:
- **Topic:** `zigbee2mqtt/<friendly_name>/set` (a device *or* a group).
- **Payload:** JSON, for example `{"state":"ON"|"OFF"|"TOGGLE", "brightness":0-254, "color":{"hex":"#FF0000"}` (or `{"x","y"}`, `{"r","g","b"}`, `{"hue","saturation"}`), `"color_temp": mireds, "transition": seconds, "effect": "blink"|"breathe"|"okay"|"channel_change"|"finish_effect"|"stop_effect"}`. Recent Hue bulbs also support `candle`/`fireplace`/`colorloop`; IKEA bulbs support only the basic set.
- **Native scenes:** `{"scene_store": {"ID": 3, "name": "alarm"}}` once while setting up, then `{"scene_recall": 3}` during the show. Run against a **group**, this is one Zigbee multicast, so every bulb in the group changes at the same moment.

**Does stagehand produce this today?**
- **The example rule is wrong for Z2M** (`stagehand/show.example.yaml:42-45`): `topic: "house/lights/{room}/set", payload_from_args: true, retain: true`.
  1. The topic namespace is generic, not `zigbee2mqtt/…`. That's a translation layer nobody has written.
  2. `payload_from_args` always injects `"target": "lights"` (`show/cuemap.py:223-225`) and passes every kwarg through, including `room`. Z2M logs "No converter available for 'target' / 'room'" on every cue. It still applies `state`, but it's noisy.
  3. `retain: true` on a `/set` command means Z2M re-applies it on every restart. A retained room "OFF" also survives into the next night, so it is stale state. **Use `retain: false` for Z2M and WLED command topics.**
- **What works today:** an explicit `payload:` dict with the topic pointed at Z2M. Verified:
  - `<cue: lights, room: kitchen, state: OFF>` → `zigbee2mqtt/kitchen/set {"state":"OFF","transition":0}`
  - `cue alarm` → `zigbee2mqtt/server_room/set {"state":"ON","brightness":254,"color":{"hex":"#FF0000"},"effect":"breathe"}`
  - Nested *static* dicts are fine.
- **Limits:**
  - Placeholders render only in **top-level string values** (`templating.py:54-65`; `cuemap.py:190-198`). `color: {hex: "{hex}"}` is sent literally.
  - A lone placeholder keeps its type: `"{state}"` stays a string, `"{bri}"` becomes an int. Good.
  - Room names become Z2M friendly names, so **name the Z2M groups exactly as the LOCATIONs (or a slug), and avoid `/`** (Z2M treats it as hierarchy).
  - **Zigbee rate limit.** Group commands are broadcasts, and Zigbee limits how many broadcasts can be in flight. Don't stream flicker frames over Zigbee: more than about 1 group command per second sustained will start dropping. Do erratic flicker with the bulb's own `effect` or on WLED.

**Hardware notes:**
- Hue bulbs must be factory-reset off the Hue Bridge (Z2M touchlink, or the Hue app's reset for Bluetooth bulbs). IKEA bulbs reset by power-cycling 6×.
- Use one coordinator: a Sonoff ZBDongle-E/-P or SLZB-06, plus a USB extension cable away from WiFi.
- Mains-powered bulbs act as routers, so keep them powered. A wall switch turned off breaks the mesh.
- Build one Z2M **group per room** plus a `house` group for whole-house blackouts.
- Test `effect` and transition support on each bulb model. IKEA handles colour + transition poorly.

### 3.2 WLED (PAUTIX RGB COB on ESP32)

What WLED wants:
- **MQTT** (device topic `wled/<topic>`, plus a configurable group topic, default `wled/all`, with the same subtopics):
  - `wled/<t>` takes `ON` / `OFF` / `T` / `0-255`
  - `wled/<t>/col` takes `#RRGGBB`
  - **`wled/<t>/api`** takes an HTTP-API string (`FX=…&SX=…`) **or a JSON state object** (`{"on":true,"bri":200,"ps":4}`, `{"seg":[{"col":[[255,0,0]],"fx":…}]}`)
  - WLED publishes `wled/<t>/status` (online/offline, as LWT), `/g` and `/c`.
- **JSON API:** `POST http://<ip>/json/state`, same body.
- **Presets and playlists:**
  - `{"ps": N}` recalls a preset.
  - `{"playlist":{"ps":[a,b],"dur":[100,1],"transition":0,"repeat":1,"end":c}}`. Durations are in tenths of a second, so a 10 s blackout followed by a restore is a playlist that lives on the controller.
- **E1.31/DDP:** real-time pixel streaming from TouchDesigner or xLights. While a stream is active WLED is in "realtime" mode and ignores presets until it times out. Don't mix the two casually.

**Does stagehand produce this today?** Yes, via `wled/<t>/api` with a static or lightly templated JSON payload, `retain: false`.

**YAML trap (verified):** `payload: { on: true, ps: 1 }` is emitted as `{"true": true, "ps": 1}`, because YAML 1.1 parses a bare `on` key as boolean `True`. Stagehand works around this for the rule's own `on:` key (`cuemap.py:95-96`) but not inside payloads. **Always quote it: `"on": true`.** Also fix it in code: in `_render_mqtt`, map a `True` key back to `"on"` (or warn at parse time), and add a test.

**Hardware notes:**
- **Confirm which PAUTIX COB variant you have.**
  - *Analog 3-channel RGB COB* (4-pin, 12/24 V): WLED drives it as **"PWM RGB"** through 3 MOSFETs (an Athom/Gledopto/QuinLED analog controller, or a DIY IRLZ44N board). Effects then apply to the whole strip only: flash, breathe and colour work; chases don't.
  - *RGBIC / WS2811 COB* (3-pin): use a digital output with a 3.3→5 V level shifter (74AHCT125). You get per-segment chases, which you want for **the Tube**.
- One 24 V PSU per strip run with proper gauge wire and fusing. Inject power at both ends for long runs.
- Build **identical preset IDs on every controller**, so one `{"ps": N}` on `wled/all/api` means the same look everywhere. Save presets in the WLED UI and export `presets.json` as a backup.
- Optional: sound-reactive effects need the AudioReactive usermod (WLED 0.14+) plus an INMP441 I2S mic. Good for the rave ending.

### 3.3 Scene cues for the story's ten looks (works today)

Convention:
- The story writes **`cue <scene>`**: one word, so it survives both parsers.
- Stagehand fans each scene out to a Z2M group scene and a WLED preset.
- Store the Z2M scenes once per group with `scene_store`, using the same IDs in every group.
- **Keep a state mirror.** Alongside the cue, the story sets `set Night.lights = <scene>`. A director can then *see* the current look in Run → World, and *set* it there (`/api/mod/var` emits `worldSet`, which stagehand can match). That gives an admin lights panel today with no new UI. Pick one trigger per scene, either the `cue` directive or the `worldSet`, so it doesn't fire twice.

| Scene (story moment) | `.loom` | Z2M (`zigbee2mqtt/<group>/set`) | WLED (`wled/all/api`) | Notes |
|---|---|---|---|---|
| `screensaver`: arrivals, pre-inciting event | `cue screensaver` in `Power On` | `house` `{"scene_recall":1,"transition":3}` (dim cool blue) | `{"on":true,"ps":1}` slow "Pipes"-ish drift | The TV's actual screensaver is a terminal/TV job (§6) |
| `call_desktop`: "everyone to the Desktop" | `cue call_desktop` beside the `!` broadcast | `house` `{"effect":"okay"}` then `living_room` `{"scene_recall":2}` | `{"ps":2}` white sweep toward the living room | Lines on the floor that "lead you to specific places" (overview) suit WLED segments |
| `tube_chase`: entering the Tube | `cue tube_chase` (or a sensor-driven `when someone entered the tube:`) | — | Tube controller only: `wled/tube/api {"ps":3}` chase | Needs RGBIC strip for a real chase |
| `glitch`: erratic flicker, malware | `cue glitch` | `house` `{"effect":"candle"}` (Hue) / `"breathe"` (IKEA) | `{"ps":4}` Lightning/Strobe preset | Never stream flicker over Zigbee |
| `ad_hijack`: the advert takes over | `cue ad_hijack` | `living_room` `{"scene_recall":5}` (garish magenta) | `{"ps":5}` | Pair with the ad video on the TV (§6) |
| `alarm`: server room, red | `cue alarm` | `server_room` `{"state":"ON","color":{"hex":"#FF0000"},"brightness":254,"effect":"breathe"}` | `wled/server/api {"ps":6}` red strobe | Plus a siren audio cue (§6) |
| `blackout`: 10 s, on Trabolta kill / shutdown | `cue blackout` | `house` `{"state":"OFF","transition":0}` | `{"playlist":{"ps":[7,8],"dur":[100,1],"repeat":1,"end":8}}` (7 = all off, 8 = dance) | **Z2M has no "off, then back on after 10 s".** See below. |
| `dance`: one dance song | `cue dance` | `house` `{"scene_recall":8}` | `{"ps":8}` (audio-reactive if fitted) | Song is an audio cue |
| `rave`: Trapdoor / party-over ending | `cue rave` | `house` `{"effect":"colorloop"}` (Hue) | `{"ps":9}` | |
| `y2k`: 11 pm Dec 31 1999 countdown | `cue y2k` | `house` `{"scene_recall":10}` (amber, dim) | `{"ps":10}` slow red pulse | The countdown clock itself is a screen job (§6) |

**The timing gap: blackout then restore.** The sim has no relative delay:
- `wait` is in the statement table but the sim doesn't execute it; it falls through to the default directive arm.
- Timer hooks (`every 30s` / `after 2m`) count from the start of the story clock (`sim.ts:751-786`), not from the moment a cue fired.

Stagehand has no delay or sequence output either. Options:
1. **Device-side** (works today): a WLED playlist handles the strips. For Zigbee, a second stagehand rule can't be delayed, so…
2. **Story-side:** a director fires the restore by hand (`cue dance` from a named event). Clunky.
3. **Recommended code change:** an optional `delay: "10s"` on a cue output. In `_on_sim`, schedule with `loop.call_later`; cancel pending timers on a `lifecycle` frame. About 30 lines plus tests. That makes "blackout → 10 s → dance song + `dance` lights" one `cue blackout`.

---

## 4. The server-room door sensor

### 4.1 Hardware options

| Option | Wiring | Topic / payload | Verdict |
|---|---|---|---|
| **Zigbee contact sensor** (Aqara MCCGQ11LM, IKEA PARASOLL, Sonoff SNZB-04) | none; pairs to the same Z2M | `zigbee2mqtt/server_room_door {"contact": false, "battery": 87, "linkquality": 120}`. `contact:false` means OPEN. | **Recommended primary.** No firmware, reports instantly, battery lasts months. |
| **Copper tape** (your idea): two pads on frame and door, touching when closed | ESP32 GPIO with `INPUT_PULLUP` to one pad, GND to the other | ESPHome `binary_sensor` → `<node>/binary_sensor/server_door/state` `ON`/`OFF` (non-JSON, so stagehand decodes it as `{"value":"ON"}`; `show/module.py:148-160`) | Works and looks diegetic, but tape oxidises, the door gap varies and contacts bounce. Use **ESPHome `filters: [delayed_on: 50ms, delayed_off: 300ms]`**. Better: copper *leaf springs* or a **magnetic reed switch** ($2, same wiring, no contact wear). |
| Microswitch / lever on the hinge side | same as copper | same | Robust if the door closes consistently |
| Backup: **Zigbee PIR inside the server room** | none | `zigbee2mqtt/server_room_pir {"occupancy": true}` | Catches someone who walks in through a door left open |

### 4.2 Stagehand mapping (works today)

```yaml
sensors:
  - on: { topic: "zigbee2mqtt/server_room_door", when: "contact == false" }
    signal: { name: server door opened, debounce_s: 20 }
  - on: { topic: "zigbee2mqtt/server_room_door", when: "contact == true" }
    signal: { name: server door closed, debounce_s: 20 }
  # ESPHome copper-tape/reed variant (state topic is plain text):
  - on: { topic: "server-door/binary_sensor/server_door/state", when: "value == 'OFF'" }
    signal: { name: server door opened, debounce_s: 20 }
```

Verified: the first Z2M `contact:false` message fires. A follow-up battery report with `contact:false` inside the window is suppressed.

### 4.3 Edge and debounce semantics: the real gaps

- **The debouncer only rate-limits on the leading edge** (`sensormap.py:104-118`). It fires on the first match, then drops matches for `debounce_s`, keyed by (rule, action, rendered identity). It is **not edge detection**:
  - Z2M republishes the full state on *every* attribute change (battery, linkquality) and on periodic reports.
  - While the door stands open, each report after the window re-fires `server door opened`.
  - Reasonable for a repeating alarm, wrong for a one-shot.
- **Retained messages:**
  - ESPHome publishes state topics **retained by default**. Z2M doesn't by default, but some setups enable it.
  - The bridge drops paho's `msg.retain` flag (`show/mqtt.py:57-58`).
  - So each time stagehand reconnects, the retained "door open" is replayed and **fires a spurious alarm**.
- **Fixes, in order of value:**
  1. Pass `msg.retain` through the queue and **ignore retained messages for sensor rules by default**, with an opt-in `accept_retained: true`. About 10 lines.
  2. Add a per-rule **`edge: true`**: fire only when `when:` goes false → true for that identity. The first message primes the state without firing. About 25 lines plus tests.
  3. Add a **`var:` action** (`{path, value}` → `POST /api/mod/var`), for example `var: {path: Night.server_door, value: open}`. The door state is then visible in Run → World, and the story reacts with a **watcher** (`when Night.server_door == "open":`). Watchers are already edge-triggered and evaluated to a fixpoint (Loom 4), so the story gets clean edges for free. About 15 lines in `sensormap.py` / `modapi.py` / `module.py`.

### 4.4 How the story knows "unlocked" vs alarm (story-side; works today)

The alarm decision belongs in the `.loom`, not in stagehand. Sketch:

```
// Night.server_room_unlocked starts false. The Legendary fact, or a director, flips it.
when program learns The Legendary Fact:
  set Night.server_room_unlocked = true
  cue server_disarmed                       // e.g. server-room WLED goes from red to dim green

when server door opened:
  if Night.server_room_unlocked:
    broadcast "🔓 The server room door opens. Something hums." to group(Antivirus)
  else:
    set Night.alarms += 1
    cue alarm
    sound siren
    broadcast "!🚨 INTRUSION — SERVER ROOM. Antivirus: sweep now." to group(Antivirus)
    broadcast "!🚨 An alarm screams somewhere in the machine." to everyone
```

- **Admin override:** set `Night.server_room_unlocked` in Run → World (`/api/mod/var`), or declare an `INTERACTION unlock the server room` / `server room locked` pair with `who: admin` whose rules set the variable. Both fire from the Director page.
- **Design gap to resolve in the rewrite.** The overview says "break into this room (without tripping the alarm)", but nothing says *who* is unlocked. A single global flag lets everyone in once one person learns the fact. Per-person disarm options:
  - (a) A terminal or QR on the door: the program scans their pass, and the story checks `program.codex.the_legendary_fact` and opens a 60 s window. The window needs a delay or timer feature (see §3.3), or `set Night.unlocked_until = Time.elapsed + 60` plus an `if Time.elapsed < Night.unlocked_until` check in the door rule. **The second works today**, because `Time.elapsed` is a world var (`sim.ts:753`).
  - (b) A keypad on the door (ESP32 + 3×4 keypad, publishing the typed code) → a stagehand `when: "code == '0451'"` → `server room unlocked`.

---

## 5. The patch bay (Trabolta's heart)

### 5.1 Reading the patch: hardware

The brief says one row of fixed voltages and one row of DACs. To *detect* a patch, the second row has to be **read**, so in practice that row is ADC inputs (or digital inputs).

- **(A) Voltage-ID, as described.**
  - Each top-row jack gets a unique DC level from a resistor ladder off 3.3 V.
  - Each bottom-row jack goes to an ADC channel through about 100 kΩ, with a pulldown so "unpatched" reads 0.
  - ESP32 problem: only ADC1's 8 channels are usable while WiFi is on (ADC2 is blocked).
  - A 16–26-pair bay therefore needs **ADS1115** I2C ADCs (4 channels each, up to 4 per bus → 16) or a **CD74HC4067** mux.
  - Voltage bands must be wide (≥150 mV apart), and multiples (one source patched to several destinations) still read fine.
- **(B) Recommended: a digital scan matrix.**
  - Drive one top-row jack at a time (74HC595 shift registers, or GPIO) and read every bottom-row jack (74HC165 shift registers, pulldowns).
  - Unambiguous, cheap, and noise-proof. It finds any topology, including multiples and top→top.
  - You can still *call* them "voltage rails" and "DACs" in the fiction. Labels and LED level meters fed from real DACs (ESP32 GPIO25/26) sell the story.
- **Video-bay specifics:**
  - Most video patch bays are **normalled**: top connects to bottom through switch contacts until a plug is inserted. Desolder or isolate the normals, or the scan will see phantom patches.
  - BNC/RCA shields are common ground. Wire only the centre pins.
- **Firmware** (Arduino + PubSubClient, or ESPHome with a lambda):
  - Scan at about 20 Hz.
  - Publish **only after the pattern has been stable for about 1.5 s**.
  - Canonicalise the pairs, sort them, and send:

    `sensors/patchbay/state` → `{"pairs":[["V1","D4"],["V2","D7"]], "combo":"V1-D4,V2-D7", "count":2, "complete":true}`

    (`complete` = the expected number of cables is in), **not retained**, with LWT `health/patchbay`.
  - Optional **commit button** (a big red momentary switch, or the story's three key switches), published as `sensors/patchbay/commit`, so a half-finished patch never "submits" by accident.

### 5.2 Forwarding and judging: works today if stagehand judges

Verified with `evaluate_sensors`:

```yaml
sensors:
  - on: { topic: "sensors/patchbay/state", when: "complete == true && combo == 'V1-D4,V2-D7,V5-D1,V8-D3'" }
    signal: { name: trabolta unplugged, debounce_s: 60 }          # disable Trabolta → escape ending
  - on: { topic: "sensors/patchbay/state", when: "complete == true && combo == 'V1-D1,V2-D2,V3-D3,V4-D4'" }
    signal: { name: the computer shut down, debounce_s: 60 }      # whole computer off → purgatory ending
  - on: { topic: "sensors/patchbay/state", when: "complete == true && combo != 'V1-D4,V2-D7,V5-D1,V8-D3' && combo != 'V1-D1,V2-D2,V3-D3,V4-D4'" }
    signal: { name: patch rejected, debounce_s: 10 }              # Trabolta notices; the alarm, Antivirus
```

Story:
- `when trabolta unplugged:` → `cue blackout` / `sound dance_song` / the "Go to the living room" takeover / `-> Trabolta Disabled`
- `when the computer shut down:` → the same theatrics plus `-> Improper Shutdown`
- Guard both with `if not Night.ended:` so they're idempotent.
- Optionally, refuse while `Night.alarms > 0` or until `Night.server_room_unlocked`. That gives "without tripping the alarm" a teeth-y consequence.

**Why that isn't enough:** the combinations then live in stagehand YAML, not in the story. Sim rehearsal can't exercise them, the codex that reveals them can't be checked against them, and changing them means editing two files.

**Recommended change** (small; the server already supports it at `event-runtime.ts:2745-2748` and `sim.ts:336-360`):
1. `sensormap.py`: allow an `args:` mapping on `signal` with templated values (lone placeholders keep their type).
2. `modapi.py:118`: `signal(name, subject, args=None)` → body `{name, subject, args}`.
3. `module.py:138`: pass it through.
4. Tests.

The story then judges:

```
when patch changed:
  if Night.ended:
    return
  if combo == Night.kill_combo:
    -> Trabolta Disabled
  else if combo == Night.shutdown_combo:
    -> Improper Shutdown
  else:
    Trabolta: Stop touching me.
```

with `signal: { name: patch changed, args: { combo: "{combo}", count: "{count}" }, debounce_s: 2 }`. I also suggest an optional `actor`, so "fired as Trabolta" hooks can listen.

---

## 6. Printer, other props, audio, Alexa, monitors

### 6.1 Printer (VLC presses start → nothing → full of beans): SUPPORTED on the stagehand side

- **Hardware:** a Zigbee button (IKEA SOMRIG/STYRBAR, Aqara WXKG11LM) stuck over the printer's real button, or an ESP32 wired to the button. Optionally a **reed switch on the lid**, so "opened the printer" is its own event.
- **Config (verified):**
  ```yaml
  - on: { topic: "zigbee2mqtt/printer_button", when: "action == 'single'" }
    signal: { name: printer button pressed, debounce_s: 3 }
  - on: { topic: "zigbee2mqtt/printer_lid", when: "contact == false" }
    signal: { name: printer opened, debounce_s: 30 }
  ```
  Z2M also publishes `action: ""` on later state messages, which the `when` ignores.
- **Story:** `when printer button pressed:` only matters during the Trust-Chart beat (`if Night.phase == "trust chart"`). It plays a `sound printer_grind` / `cue glitch` blip, then Clippy's "beans = malware" line on `printer opened`.

### 6.2 Other sensors implied by the narrative (all SUPPORTED as signal rules; none authored yet)

| Prop / moment | Sensor | Signal → story |
|---|---|---|
| Front door / Mud Room "enter alone" | Zigbee contact on the front door | `front door opened` → optional Alexa "new program detected"; rolling-arrival pacing for operators |
| The Tube of lights | Zigbee PIR at the Tube entrance | `someone entered the tube` (debounce 5 s) → `cue tube_chase` |
| Server room | PIR inside, plus the door contact (§4) | `server room occupied` |
| Self-destruct "keys" (the current story's three keys) | Key switches on the patch-bay panel (ESP32 inputs) | `key turned` with `args {slot}` (needs args) or three named signals today |
| Truth Pong / Bobbing / Bag of Truth | — (a performer or director fires the named event from the booth) | already INTERACTION-shaped |
| Bathroom Mode | — (in-app) | exists |

### 6.3 Audio (dance song, Trabolta's vocoder "You're the One That I Want", Sandy's IVR lines, ad audio, siren, Y2K): PARTIAL

- **Stagehand has no player.** The only audio path is OSC to an external machine. As designed, that's TouchDesigner (`docs/loom-show-control.md:299-302`: "big musical cues stay on the TD machines").
  - This show's "monitors" are tablets, not projectors, so TD may not even be in the rig.
- **Works today with zero code: QLab** (macOS; OSC on UDP 53000; check which licence tier you need for your output count), or any OSC-controllable player.
  ```yaml
  osc: { targets: { qlab: { host: 127.0.0.1, port: 53000 } } }
  cues:
    - on: { directive: sfx }
      match: { target: dance_song }
      osc: { addr: "/cue/dance_song/start", to: qlab }   # no t_exec: QLab doesn't want the extra string arg
  ```
  The `.loom` side is `sound dance_song` (lowered to `sfx`). Verified to render `OscCue('/cue/dance_song/start', to=('qlab',))`.
- **Cross-platform alternative (needs code):** a small `audio` output or module driving `mpv --input-ipc-server` (`loadfile`, `stop`, `set volume`) on the laptop wired to the house speakers. About 80 lines.
  - `docs/loom-show-control.md:299-301` also proposes Snapcast for synced multi-room ambience, and ESP32 + MAX98357 for local one-shots.
- **Dynamic lines** (the Trust-Chart names, Sandy's "I'm sorry, I didn't understand that"): the server already proxies a neural TTS (`/api/mod/tts` → `LOOM_TTS_URL`, Kokoro). An `http:` output in stagehand (POST a templated body, for example to a local "say this" player) would reuse it.
- **Recommended code change:** a generic **`http:` cue output** (method, URL, templated JSON body, timeout, fire-and-forget). About 40 lines. It also unlocks the WLED JSON API, Home Assistant webhooks and a TTS player in one feature.

### 6.4 Alexa announcements: PARTIAL / MISSING

- **Today:** "Alexa" is only a chat alert (`cast/hosts.loom:56,59`: `broadcast "!🔊 ALEXA: …"`). The show README casts Alexa as "the voice in every room (or an actual speaker + the operator)".
- **Option A, a real Echo (stagehand side works today, needs the cloud):** Home Assistant + Alexa Media Player.
  - Stagehand publishes `show/announce {"text": "…"}`. Verified with `do announce "ALL PROGRAMS: report to the Desktop, now."` → `{"text":"ALL PROGRAMS: report to the Desktop, now."}`.
  - An HA automation on that MQTT topic calls `notify.alexa_media` with `data: {type: announce}`.
  - Costs: 2–5 s latency, and it **breaks the show-control doc's LAN-island principle** (`loom-show-control.md:52-54`).
- **Option B, a fake Alexa (recommended, local):** an Echo used as a Bluetooth speaker, or any speaker, driven by the laptop. `announce` → Kokoro TTS (already running for the terminals) → play. Needs the `http:`/`audio` output above. Fixed announcements can simply be pre-rendered QLab cues today (`cue alexa_call_desktop`).

### 6.5 Monitors (terminal tablets) for ads, story beats, video and the reinstall view: outside stagehand, but on the path

- The **terminal app** (`terminal/`) has face, world view (the reinstall spectator), `mirror` view and pilot/scanner.
- It has **no media/"screen" mode**. Nothing plays an advert or a beat video, or shows a Y2K countdown, a "Go to the living room" flash, or the Trust Chart.
- **Nothing consumes `cue screens …`** except an OSC target (`show.example.yaml:47-49`), which has no receiver in this rig.
- The terminal already holds a **mod token**, so the clean design is:
  - Terminals subscribe to the mod SSE and react directly to `directive` events with `verb: "screen"` (for example `do screen ad_hijack`, or `do screen video, src: beat3.mp4`), plus `worldSet` on `Night.screen`.
  - No stagehand hop is needed, and the state mirror (`Night.screen`) lets a reloaded tablet re-converge from `/api/state`.
- The flashing "Go to the living room" takeover on **phones** after the blackout is a `play` app feature (a vibe/takeover event). Today `vibe` has no consumer in `play` or the server; `loom-show-control.md:401-406` is design only.

---

## 7. Reliability and ops gaps (cross-cutting)

1. **No reconvergence after a stagehand restart.**
   - Missed `sim` frames are gone: stagehand ignores `snapshot`/`history` (`show/module.py:99-101`).
   - Retained MQTT only covers rules that set `retain: true`, which you *don't* want for Z2M/WLED.
   - Fix: on connect, `GET /api/state?role=mod`, read the configured mirror paths (`Night.lights`, `Night.screen`), and replay the matching `worldSet` rules. About 30 lines.
2. **Lifecycle blind spot.**
   - A story restart, reload, go-live or end sends a `lifecycle` frame (`event-runtime.ts:492-495`). Stagehand drops it.
   - Lights stay in whatever the last run left, until the `entry:` beat re-cues. **Mitigation today:** the opening beat (`Power On`) must issue `cue screensaver` and `set Night.lights = screensaver`.
   - Code: allow `on: {lifecycle: reset}` cue rules, and cancel pending `delay:` timers.
3. **MQTT publish isn't checked** (`show/mqtt.py:72-73`). A cue published during a broker blip is dropped without a log. Log `rc != MQTT_ERR_SUCCESS`; consider `qos: 1` for show-critical cues.
4. **No tech rail.**
   - Stagehand publishes `health/stagehand` (`mqtt.py:18,38,49`). Z2M publishes `zigbee2mqtt/<dev>/availability` and WLED publishes `wled/<t>/status`.
   - The editor shows none of it (`loom-show-control.md:438-440` lists it as "to add").
   - Cheapest path: stagehand subscribes to `health/#`, `zigbee2mqtt/+/availability` and `wled/+/status`, and mirrors them as `set Tech.<node> = online` through the proposed `var` action. Run → World then becomes the tech rail.
5. **Unknown signal names are silent** (no `stagehand check` validation against the model's named events).
6. **The broadcast matcher is exact-equality only** (`cuemap.py:161-168`). You can't key hardware off broadcast text such as "starts with `!🔊 ALEXA`". That's fine: author explicit `cue`/`do announce` lines instead.
7. **Stale docs.**
   - `stagehand/README.md:265-270`: the SSE "anyone can read" note is now false.
   - `docs/loom-show-control.md` is written for the old *escape-the-internet* projector show (8 projectors, Upside Down Unity). It needs a *Trapped* section covering Z2M/WLED, the door, the patch bay and terminals-as-monitors.
   - `show.example.yaml:42-45` should show Z2M/WLED-shaped rules with `retain: false`.

---

## 8. Code changes, ranked (all inside `stagehand/` unless noted)

| # | Change | Where | Size | Unlocks |
|---|---|---|---|---|
| 1 | Parse the Loom 4 `cue X with k: v` form | `show/directives.py:80-94` + test | S | Keyword-form cues stop silently failing |
| 2 | `signal.args` (templated map) → `/api/mod/signal {args}` | `sensormap.py:52-56,121-153`, `modapi.py:118`, `module.py:138` | S | Patch bay judged in the story; key slots; any sensor value as a story argument |
| 3 | `var:` action → `POST /api/mod/var` | same three files | S | Door/tech state visible + editable in Run → World; edge-triggered watchers |
| 4 | Ignore retained sensor messages by default; `edge: true` per rule | `mqtt.py:57-58`, `sensormap.py` | S–M | No spurious alarms on reconnect; true one-shots |
| 5 | `delay:` on cue outputs; cancel on `lifecycle` | `show/module.py:107-121`, `cuemap.py` | S–M | 10 s blackout → dance; timed sequences |
| 6 | Map a YAML `True` key back to `"on"` in payloads (or reject it) | `cuemap.py:182-207` | XS | WLED `"on"` trap |
| 7 | `http:` cue output | `cuemap.py`, `show/module.py`, new `show/http.py` | M | WLED JSON API, HA webhooks, TTS / announce player |
| 8 | Reconverge on connect from `/api/state` mirror paths; handle `lifecycle` rules | `show/module.py` | M | Restart-safe lights/screens |
| 9 | Optional `table:` lookup in cue rules (scene → {z2m_scene, wled_ps}) | `cuemap.py` | S | 10 scenes in about 10 lines instead of about 20 rules |
| 10 | `stagehand check` warns on signal names the model doesn't define | `cli.py` + one server GET | S | Typos caught at boot |
| 11 | Optional `audio` module (mpv IPC) | new `stagehand/audio/` + `module.py:80` registry line | M | No QLab/TD dependency for music |
| 12 | (terminal) screen/media mode listening to `directive verb=screen` + `Night.screen` | `terminal/` | M–L | Ads, beat videos, Y2K clock, Trust Chart, "Go to the living room" on monitors |
| 13 | (play) takeover/vibe event for the post-blackout flashing screen | `core/server` fanout + `play` | M | Overview finale beat |

---

## 9. The draft config that passes `stagehand check` today

(The 2026-10-14 draft; superseded by `stagehand/trapped.house.yaml`. Per §3.2, quote `"on"` inside WLED payloads.)

```yaml
server: { url: http://127.0.0.1:7000, event: default, mod_passcode: "CHANGE-ME" }
show:
  mqtt: { host: 127.0.0.1, port: 1883, client_id: stagehand-house }
  osc:  { targets: { qlab: { host: 127.0.0.1, port: 53000 } } }
  cues:
    - on: { directive: cue }
      match: { target: screensaver }
      mqtt: { topic: "zigbee2mqtt/house/set", payload: { scene_recall: 1, transition: 2 } }
    - on: { directive: cue }
      match: { target: screensaver }
      mqtt: { topic: "wled/all/api", payload: { "on": true, ps: 1 } }       # QUOTE "on"
    - on: { directive: cue }
      match: { target: alarm }
      mqtt: { topic: "zigbee2mqtt/server_room/set",
              payload: { state: "ON", brightness: 254, color: { hex: "#FF0000" }, effect: "breathe" } }
    - on: { directive: cue }                                                # Trabolta's "cut the lights" power
      match: { target: lights }
      mqtt: { topic: "zigbee2mqtt/{room}/set", payload: { state: "{state}", transition: 0 } }
    - on: { event: worldSet, path: Night.lights, value: blackout }          # admin edits Night.lights in Run → World
      mqtt: { topic: "zigbee2mqtt/house/set", payload: { state: "OFF", transition: 0 } }
    - on: { directive: sfx }                                                # `sound dance_song`
      match: { target: dance_song }
      osc: { addr: "/cue/dance_song/start", to: qlab }
    - on: { directive: announce }                                           # `do announce "…"` → HA → Alexa
      mqtt: { topic: "show/announce", payload: { text: "{target}" } }
  sensors:
    - on: { topic: "zigbee2mqtt/server_room_door", when: "contact == false" }
      signal: { name: server door opened, debounce_s: 20 }
    - on: { topic: "sensors/patchbay/state", when: "complete == true && combo == 'V1-D4,V2-D7,V5-D1,V8-D3'" }
      signal: { name: trabolta unplugged, debounce_s: 60 }
    - on: { topic: "sensors/patchbay/state", when: "complete == true && combo == 'V1-D1,V2-D2,V3-D3,V4-D4'" }
      signal: { name: the computer shut down, debounce_s: 60 }
    - on: { topic: "zigbee2mqtt/printer_button", when: "action == 'single'" }
      signal: { name: printer button pressed, debounce_s: 3 }
```

Dry-run results (exact payloads emitted):
- `cue screensaver` → `zigbee2mqtt/house/set {"scene_recall": 1, "transition": 2}` + `wled/all/api {"true": true, "ps": 1}`. That second payload is **the bug, with `on` unquoted**.
- `cue alarm` → `zigbee2mqtt/server_room/set {"state":"ON","brightness":254,"color":{"hex":"#FF0000"},"effect":"breathe"}`
- `<cue: lights, room: kitchen, state: OFF>` → `zigbee2mqtt/kitchen/set {"state":"OFF","transition":0}`
- `cue lights with scene: alarm` → **`[]`** (silent miss, §2)
- worldSet `Night.lights = blackout` → `zigbee2mqtt/house/set {"state":"OFF","transition":0}`
- `sound dance_song` → OSC `/cue/dance_song/start` → qlab
- Door `contact:false` → `signal server door opened`. A second report inside 20 s → suppressed.
- Patch kill combo → `signal trabolta unplugged`. A wrong combo → `patch rejected` (with the negative rule).

---

## 10. Checklist items to fold into the master list

**Software**
- [ ] Stagehand: changes #1–#6 (parse `with`, signal args, var action, retained/edge, delay, the `"on"` fix), then #7–#10.
- [ ] Rewrite `show.example.yaml` + `docs/loom-show-control.md` for *Trapped* (Z2M/WLED/door/patch bay/printer/audio). Drop the stale SSE note in the README.
- [ ] Story: one-word `cue <scene>` lines at every physical moment, plus `set Night.lights = <scene>` mirrors. `Power On` sets the base look.
- [ ] Story: `when server door opened:` alarm logic, `Night.server_room_unlocked` (Legendary fact + admin override), per-person disarm window via `Time.elapsed`.
- [ ] Story: `when trabolta unplugged:` / `when the computer shut down:` / `when patch rejected:` (or `when patch changed:` with args after #2), all idempotent.
- [ ] Story: `when printer button pressed:` / `when printer opened:` gated to the Trust-Chart phase.
- [ ] Story: `sound …` for dance song, Trabolta's song (vocoder version), Sandy IVR, siren, advert audio; `do announce "…"` for Alexa.
- [ ] Director "panel" INTERACTIONs (`who: admin`) for each scene + blackout + unlock/lock the server room.
- [ ] Terminal: screen/media mode (ads, beat videos, Y2K countdown, Trust Chart, "Go to the living room").
- [ ] Play: post-blackout takeover screen.
- [ ] Tech rail (health/availability mirrored into `Tech.*`).

**Hardware**
- [ ] Mosquitto on the brain-stem box. Z2M on the same broker with a USB coordinator on an extension.
- [ ] Pair every Hue/IKEA bulb to Z2M. One **group per room** + `house` group. `scene_store` the 10 looks per group with fixed IDs.
- [ ] ESP32 WLED controllers per COB run. **Identify analog-RGB vs RGBIC PAUTIX.** 24 V PSUs, fusing, level shifter (RGBIC) or MOSFET board (analog). Identical preset IDs 1–10 everywhere. Blackout playlist. Group topic `wled/all`.
- [ ] Server-room door: a Zigbee contact sensor as primary; copper tape / reed + ESP32 (ESPHome, `delayed_on`/`delayed_off`) as optional diegetic backup. Optional Zigbee PIR inside. Optional keypad.
- [ ] Patch bay: de-normal the bay, wire centre pins, ESP32 + 74HC595/74HC165 scan matrix (or ADS1115 voltage-ID), stable-1.5 s publish to `sensors/patchbay/state`, LWT, optional commit button / key switches, fake "voltage" LED meters.
- [ ] Printer: Zigbee button over the start button + contact sensor on the lid; beans.
- [ ] Tube entrance PIR; front-door contact.
- [ ] Audio: house speakers + a cue player (QLab over OSC, or the mpv module); pre-rendered song/IVR/siren/advert/Alexa files; Kokoro TTS on the laptop for dynamic lines.
- [ ] Alexa: decide between a real Echo via HA (cloud) and a local fake-Alexa speaker.
