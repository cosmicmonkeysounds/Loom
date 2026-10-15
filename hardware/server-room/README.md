# Server-room box (N-08)

One ESP32 in the server room (cold storage) that does three jobs for
*Trapped in the Internet*:

- **Door**: a reed switch, plus copper tape (or a plunger switch) as the
  fallback on a second pin → `sensors/serverroom/door`. Stagehand turns an
  opening into `server_door_opened`, and the story decides whether that is an
  alarm.
- **Trabolta's heart**: the 2×12 video patch bay, scanned all-pairs on two
  MCP23017s → `sensors/patchbay/state`. Stagehand judges Combo A / Combo B /
  rejected.
- **Feedback**: a WS2812 ring over the door (lock state, alarm strobe) and a
  DFPlayer Mini (local siren, cable click), driven from `show/serverroom/*`,
  plus a relay that clicks on every new cable.

The box hard-codes the broker, the **house Mac's static IP**
(`192.168.8.10`), so nothing depends on DHCP (HW-NET-08). The box's own
address is `192.168.8.21`. Change both in `server_room/config.h`, and keep
the broker equal to `show.mqtt.host` in `stagehand/trapped.house.yaml`
(`stagehand/tests/test_serverroom_firmware.py` checks it).

Background and parts list: `core/examples/trapped-in-the-internet/CHECKLIST.md`
§D (door) and §E (patch bay).

## Build and flash

```bash
cp server_room/secrets.example.h server_room/secrets.h   # Wi-Fi SSID + PSK (git-ignored)
test/run.sh            # host tests of the logic (plain c++, ~1 s)
test/run.sh compile    # + compile for the ESP32; installs the 3 libraries on first run
# flash (find the port with: arduino-cli board list)
arduino-cli upload -p /dev/cu.usbserial-XXXX --fqbn esp32:esp32:esp32 \
  --input-dir "${TMPDIR:-/tmp}/server-room-test/build" server_room
```

Or open `server_room/server_room.ino` in Arduino IDE 2: board **ESP32 Dev
Module** (esp32 core 3.x), libraries **PubSubClient**, **Adafruit NeoPixel**
and **DFRobotDFPlayerMini**. The IDE ships its own `arduino-cli`, which
`test/run.sh` finds. Serial monitor: 115200 baud.

The bench check is `scripts/accept/N-08.sh [port]` (≈ 8 min, MQTT only),
then `scripts/accept/K-05.sh` (through stagehand and the story).

## Pins (ESP32-DevKitC, classic WROOM-32)

| GPIO | To | Notes |
|---|---|---|
| 23 | Reed switch → GND | external 4.7–10 kΩ pull-up to 3V3, 100 nF to GND at the ESP, 1 kΩ series |
| 19 | Copper tape / plunger → GND | same conditioning; the 1 kΩ series (or a TVS) is mandatory: guests touch the tape |
| 21 / 22 | I²C SDA / SCL → both MCP23017s | 400 kHz; the Adafruit boards carry their own pull-ups |
| 18 | Ring DIN via 74AHCT125 (5 V) + 330 Ω | 470–1000 µF across the ring's 5 V |
| 25 | Relay IN (**3.3 V-trigger** module) | HIGH = click, 60 ms |
| 16 (RX2) | DFPlayer TX | |
| 17 (TX2) | 1 kΩ → DFPlayer RX | 100–470 µF at the DFPlayer; 3 W speaker on SPK1/SPK2 |
| 0 | the BOOT button | hold 3 s while running = recalibrate (cords out) |

GPIO16/17 are free on a **WROOM-32 only**: on a WROVER they are PSRAM. Leave
strapping pins (0, 2, 5, 12, 15) and flash pins (6–11) alone.

Power: one 5 V 4 A supply feeds the DevKit's 5V pin, the ring, the DFPlayer
and the relay, with all grounds common. **Never plug USB in while the 5 V
supply is connected** (it back-feeds the host). Flash with the supply off.

## The door

Closed = the contact pulls the pin LOW. Open = HIGH. "Open" is reported once
it has held 300 ms, "closed" after 50 ms, so a 250 ms gap in the tape never
reports an opening.

`DOOR_MODE` (in `config.h`) is `DOOR_BOTH` by default: the door reads open
only when **both** inputs say open. An unplugged input floats HIGH, so it
drops out and the other one decides. A tape that gaps open while the door is
shut is outvoted by the reed. `DOOR_REED` / `DOOR_TAPE` force one input. The
payload carries both inputs for the bench:
`{"open": true, "reed": true, "tape": true}`.

The message is **retained**, published on every change and again on every
reconnect. Stagehand's `edge: true` rule primes on a retained message and
fires nothing on it, so a stagehand restart with the door propped open is
silent, and an opening that happened while the box was offline still lands.

The MC-38 reed: check with a meter that it **closes** with the magnet present
(some are sold NO). On a steel frame, mount it on a spacer.

## The bay

| MCP | Address | Jacks | Pins |
|---|---|---|---|
| top | 0x20 (A0–A2 → GND) | V1–V12 | V1–V7 = GPA0–GPA6, V8–V12 = GPB0–GPB4 |
| bottom | 0x21 (A0 → 3V3) | D1–D12 | D1–D7 = GPA0–GPA6, D8–D12 = GPB0–GPB4 |

V1–V8 / D1–D8 are the story's jacks. 9–12 on each row are decoys (wire them
anyway, so a wrong patch anywhere is seen). **GPA7 and GPB7 stay unused**:
they are output-only since datasheet rev D. Wire each jack's **rear centre**
to its pin, and every shell to GND. Add an external 10 kΩ pull-up per jack
pin (the MCP's internal ~100 kΩ is weak on long jack wires). Keep the MCPs
within ~30 cm of the ESP32, so the jack wires are the long ones.

**Scan** (~12 ms, 20 times a second): every pin is a pulled-up input; one
jack at a time is driven LOW; every other jack that reads LOW shares a cable
with it. A pair counts only if it reads in both directions. A jack that reads
LOW with nothing driven is **stuck** (a 75 Ω self-termination, or a centre
shorted to the shell). It is left out and listed in the diagnostics.

**Published**: once a new map has held for 1 s, `sensors/patchbay/state` (not
retained):

```json
{"pairs":[["V2","D5"],["V4","D1"],["V6","D8"],["V7","D3"]],
 "combo":"V2-D5,V4-D1,V6-D8,V7-D3","count":4,"complete":true}
```

`combo` is canonical: each pair is written in jack order (V before D, then by
number), and the pairs are sorted the same way, so V-to-D combos come out
sorted by V number. That is the exact string `trapped.house.yaml` compares,
however the cords went in. `complete` is `count == 4`. Every published change
that adds a pair clicks the relay and plays track 2.

**Baseline**: the patch is the connection map *minus the baseline*, which is
the map with every cord out.

- On a **normalled** bay (top-N ↔ bottom-N with no cord in), the baseline
  holds those 12 normals. A cord V2→D5 on a bay whose normals **break** when a
  plug goes in (the usual video bay) removes V2–D2 and V5–D5 and adds V2–D5,
  so the patch reads exactly `V2-D5`. The broken normals are listed in the
  diagnostics.
  - Limit: a cord between a jack and its own partner (V9→D9) is invisible on
    a normalled bay, because it was already connected. None of the combos
    does that.
- A bay whose normals do **not** break merges each cord into its normal's
  net, and no scan can tell which jack the cord is in. The patch then reads
  as extra pairs and never completes, so it can never fire a false combo.
  Fix that bay (HW-PATCH-01: swap the modules, cut the normals, or use the
  front panel as a façade).
- The **first boot** records the baseline and stores it in flash. Every later
  boot reuses the stored one, so a brownout mid-Act III with cords in does not
  blind the box. Recalibrate deliberately, **with every cord out**: hold BOOT
  for 3 s, or `mosquitto_pub -h 192.168.8.10 -t show/serverroom/calibrate -m empty`
  (the payload must contain `empty`; never publish it retained; the box clears
  a retained one anyway). The ring flashes white for 1 s.

`sensors/patchbay/diag` (retained, for the bench; no rule listens):
`{"ok", "source": "boot|stored|mqtt|button", "baseline": [...], "broken": [...], "stuck": [...], "door_mode", "audio", "ip"}`.

## MQTT contract

| Topic | Dir | Payload | Retained |
|---|---|---|---|
| `health/serverroom` | out | `online` on connect; `lost` = LWT (keepalive 10 s) | yes |
| `sensors/serverroom/door` | out | `{"open", "reed", "tape"}` | yes |
| `sensors/patchbay/state` | out | above | no |
| `sensors/patchbay/diag` | out | above | yes |
| `show/serverroom/lock` | in | `{"state": "locked"\|"unlocked"}`. Ring: red breathing / solid green. Dim amber until the first one arrives | yes (stagehand) |
| `show/serverroom/alarm` | in | `{"state": "on", "seconds": 120}`: red strobe at 2.5 Hz (≤ 3 Hz) + 3 s siren, ended by the box's own timer, so it keeps going if Wi-Fi drops. `{"state": "off"}` stops both | no |
| `show/serverroom/ring` | in | `{"mode": "green"\|"red"\|"amber"\|"white"\|"blue"\|"off", "seconds": 90}`: a timed override under the alarm (e.g. the chess disarm window). `{"mode": "clear"}` ends it | no |
| `show/serverroom/sound` | in | `{"track": N, "volume": 0-30}` plays `/mp3/000N.mp3`. `{"track": 0}` stops | no |
| `show/serverroom/calibrate` | in | must contain `empty` | never |

Plain payloads work too, for testing by hand: `mosquitto_pub -t show/serverroom/lock -m unlocked`.

While the broker is unreachable, one blue pixel circles the ring.

**microSD** (FAT32): `/mp3/0001.mp3` = the siren, `/mp3/0002.mp3` = the cable
click/beep. Further tracks can be played with `show/serverroom/sound`.
