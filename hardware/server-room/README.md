# Server-room box (N-08)

One ESP32 in the server room (cold storage) that does three jobs for
*Trapped in the Internet*:

- **Door**: two loops of wire / copper tape that **touch when the door
  opens** (a reed switch on a second pin is optional) →
  `sensors/serverroom/door`. Stagehand turns an opening into
  `server_door_opened`, and the story starts the server-room cutscene (the
  door never raises an alarm; only a wrong patch-bay combo does). The real
  door has a **standalone keypad lock**: its code is set by hand on the lock,
  it is never networked, and nothing on this box or in stagehand can lock or
  unlock it.
- **Trabolta's heart**: the 2×12 video patch bay, scanned all-pairs on two
  MCP23017s → `sensors/patchbay/state`. Stagehand judges Combo A / Combo B /
  rejected.
- **Feedback**: a WS2812 ring over the door (lock indicator, alarm strobe) and a
  DFPlayer Mini (local siren, cable click), driven from `show/serverroom/*`,
  plus a relay that clicks on every new cable.

The box hard-codes the broker, the **house Mac's static IP**
(`192.168.8.10`), so nothing depends on DHCP (HW-NET-08). The box's own
address is `192.168.8.21`. Change both in `server_room/config.h`. It dials
Mosquitto's **password-only LAN listener** on `:1884` as user `props`
(`SR_MQTT_USER` / `SR_MQTT_PASS` in `secrets.h`); the anonymous listener is
bound to 127.0.0.1 for stagehand + Zigbee2MQTT on the Mac
(`scripts/house-mac/audio.md` → *Lock down the broker*;
`stagehand/tests/test_serverroom_firmware.py` pins the port and login,
`scripts/accept/K-05.sh` checks the Mac owns the address).

Background and parts list: `core/examples/trapped-in-the-internet/CHECKLIST.md`
§D (door) and §E (patch bay).

## Build and flash

```bash
cp server_room/secrets.example.h server_room/secrets.h   # Wi-Fi SSID + PSK + the props MQTT password (git-ignored)
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
| 19 | The door contact (wire loops / copper tape) → GND | **closes when the door opens**; external 4.7–10 kΩ pull-up to 3V3, 100 nF to GND at the ESP, 1 kΩ series (or a TVS), mandatory: guests touch the loops |
| 23 | Reed switch → GND (optional, not fitted by default) | closed when shut; same conditioning |
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

**The lock is not ours.** The server-room door has a standalone electronic
keypad lock on the **outside only**: the code is set by hand on the lock and
is never networked. The ring's `show/serverroom/lock` is an indicator, and
nothing in stagehand or on this box drives the lock.

**Safety:** the lock must be single-cylinder with a mechanical inside lever
or thumb-turn: the **inside handle always opens, with no code**, batteries in
or out. No inside keypad, never double-cylinder. Egress never depends on
power; the outside may stay locked on a dead battery (a standalone keypad
deadbolt does), so the override key stays with the house manager. Fit the wire loops so they never
hold the latch or the door shut.

**The contact**: two loops of wire / copper tape on GPIO19 that **touch when
the door opens** (`TAPE_POLARITY door::kClosedWhenOpen`). Touching pulls the
pin LOW = open; apart (HIGH) = shut. Each input is debounced 300 ms to open
and 1500 ms to close (`DOOR_OPEN_MS` / `DOOR_CLOSE_MS`), and the combined
door state again on top, so the box reports "open" about 0.6 s after the
loops touch and "closed" about 3 s after they part: a loop that flickers on
an open door never reports closed and never re-arms stagehand's edge rule.

The contact is **direction-blind**: an entry with the keypad code and an
exit by the inside handle are both one opening. A door propped open is one
opening for as long as it stays open. The story's cutscene latch handles all
three; stagehand's 20 s debounce turns a group filing through into one.

**Failure modes**: an unplugged or broken loop reads **shut** forever and
fails **silently** (no opening ever fires: the director presses 🚪
`server_door_opened` when the crew sees the door open). A shorted loop reads
open once, then goes silent. `scripts/accept/N-08.sh` has to open the real
door to prove the contact.

**Polarity is per input** (`door.h`: `kClosedWhenShut` / `kClosedWhenOpen`).
`DOOR_MODE` (in `config.h`) is `DOOR_TAPE` by default: the wire loops alone.
`DOOR_REED` reads only the reed (`REED_POLARITY door::kClosedWhenShut`, an
MC-38: closed with the magnet present). `DOOR_BOTH` reads open only when both
say open, and it needs **both inputs fitted**: an unplugged closed-when-open
input reads shut and would veto every opening (an unplugged closed-when-shut
reed floats open and drops out, as before).

The payload reports only the inputs the mode reads, plus the mode:
`{"open": true, "tape": true, "mode": "tape"}` (`"reed"` appears in
`DOOR_REED` / `DOOR_BOTH`). Stagehand's rule reads only `open`. The
diagnostics carry `door_mode`, `reed_polarity` and `tape_polarity`.

The message is **retained**, published on every change and again on every
reconnect. Stagehand's `edge: true` rule primes on a retained message and
fires nothing on it, so a stagehand restart with the door propped open is
silent, and an opening that happened while the box was offline still lands.

If you fit the optional MC-38 reed: check with a meter that it **closes**
with the magnet present (some are sold NO). On a steel frame, mount it on a
spacer.

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
`{"ok", "source": "boot|stored|mqtt|button", "baseline": [...], "broken": [...], "stuck": [...], "door_mode", "reed_polarity", "tape_polarity", "audio", "ip"}`
(the polarities read `closed_when_open` / `closed_when_shut`).

## MQTT contract

| Topic | Dir | Payload | Retained |
|---|---|---|---|
| `health/serverroom` | out | `online` on connect; `lost` = LWT (keepalive 10 s) | yes |
| `sensors/serverroom/door` | out | `{"open", "tape", "mode"}` (`"reed"` only when the mode reads it) | yes |
| `sensors/patchbay/state` | out | above | no |
| `sensors/patchbay/diag` | out | above | yes |
| `show/serverroom/lock` | in | `{"state": "locked"\|"unlocked"}`: the ring's **indicator only** (the real keypad lock is standalone; nothing drives it). Ring: red breathing / solid green. Dim amber until the first one arrives. The story sends `locked` at Power On and nothing sends `unlocked` | yes (stagehand) |
| `show/serverroom/alarm` | in | `{"state": "on", "seconds": 120}`: red strobe at 2.5 Hz (≤ 3 Hz) + 3 s siren, ended by the box's own timer, so it keeps going if Wi-Fi drops. `{"state": "off"}` stops both | no |
| `show/serverroom/ring` | in | `{"mode": "green"\|"red"\|"amber"\|"white"\|"blue"\|"off", "seconds": 90}`: a timed override under the alarm (a bench or director look). `{"mode": "clear"}` ends it | no |
| `show/serverroom/sound` | in | `{"track": N, "volume": 0-30}` plays `/mp3/000N.mp3`. `{"track": 0}` stops | no |
| `show/serverroom/calibrate` | in | must contain `empty` | never |

Plain payloads work too, for testing by hand: `mosquitto_pub -t show/serverroom/lock -m unlocked`.

While the broker is unreachable, one blue pixel circles the ring.

**microSD** (FAT32): `/mp3/0001.mp3` = the siren, `/mp3/0002.mp3` = the cable
click/beep. Further tracks can be played with `show/serverroom/sound`.
