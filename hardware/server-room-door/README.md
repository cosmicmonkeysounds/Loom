# Server-room door sensor (wave 20)

An **Adafruit Grand Central M4** on Steph's laptop in the server room that
watches the server-room door with an **LED shining on an LDR** across the
gap: the beam reaches the LDR only while the door is shut. It reports the
door as JSON lines over USB serial (115200). The server-room terminal page
(desktop Chrome on that laptop) reads them with **Web Serial** and posts
`door_sensor_opened` / `door_sensor_closed` to the event (contract §2.1,
§2.5). Nothing here touches the network, MQTT or the lock.

This replaces the ESP32's wire-loop door contact (`hardware/server-room/`,
D16): the ESP32 keeps the patch bay, the ring, the siren and the relay, and
stagehand no longer listens to its door topic.

```
server_room_door/
  server_room_door.ino   the sketch: pins, flash, Serial, the status NeoPixel
  config.h               pins, defaults, timings
  door_ldr.h             sampler, boot probe, classifier, faults, calibration maths
  proto.h                command parsing, output lines
  store.h                the flash record (FlashStorage_SAMD)
  engine.h               the three together (begin / tick / command)
test/
  run.sh                 host tests; `run.sh compile` builds the sketch
  test_logic.cpp         the tests (a modelled CdS cell, every command)
  shim/FlashStorage_SAMD.h   the library's EEPROM calls over a byte array
  fixtures/lines.jsonl   one example of every output line (the terminal diffs against it)
```

## Parts

| Part | Notes |
|---|---|
| Adafruit Grand Central M4 Express (ATSAMD51P20) | USB to Steph's laptop; it powers the LED and LDR too |
| LDR (CdS photocell, GL5528 or similar, 10–20 kΩ at 10 lux) | on the frame, facing the LED |
| 10 kΩ resistor | A0 → GND, the divider's bottom half |
| A bright LED (5 mm, red or white) + 220 Ω | on the door edge or the opposite jamb, aimed at the LDR; a 2N7000 or NPN + 1 kΩ base resistor for a brighter one |
| **A shroud tube**: 2–3 cm of black heat-shrink or a black straw | over the LDR, open end toward the LED: keeps room light off the cell (the most important part for a stable reading) |
| Optional: 47 Ω | the LED's cathode → GND, with A1 on the cathode (LED sense) |
| 3-core cable, a long micro-USB cable | the LED and LDR may sit a few metres from the board |

## Wiring

```
          Grand Central M4
        ┌────────────────────┐
        │ 3V3 ───────────────┼──────┬──────────────────────┐
        │                    │      │                      │
        │                    │    [LDR]  (in its shroud,   │  (steady: LED anode
        │                    │      │     facing the LED)  │   on 3V3 instead of D2)
        │ A0 ────────────────┼──────┤                      ┆
        │                    │      │                      ┆
        │                    │   [10 kΩ]                   ┆
        │                    │      │                      ┆
        │ GND ───────────────┼──────┴───────────┐          ┆
        │                    │                  │          ┆
        │ D2 ────────────────┼──[220 Ω]──►|─────┤ LED      ┆
        │                    │          (anode) │(cathode) ┆
        │ A1 (optional) ─────┼──────────────────┤          ┆
        │                    │                [47 Ω] (only with LED_SENSE 1;
        │                    │                  │   else the cathode → GND)
        │                    │                 GND
        │ USB ═══════════════╪══ Steph's laptop (Chrome, Web Serial)
        └────────────────────┘

   door shut:  LED ──── beam ────► (shroud)LDR   reading high (near 4095)
   door open:  LED  ↘                    LDR   reading low
```

- **More light, higher reading**: LDR from 3V3 to A0, 10 kΩ from A0 to GND.
  The firmware reads 12 bits (`analogReadResolution(12)`; SAMD defaults to
  10), so the thresholds run 0–4095.
- **The LED on D2** (through 220 Ω, or a transistor for a brighter LED)
  lets the firmware blink it and read `lit − dark`, so room light can't
  fake *shut*: mode **`mod`**. **The LED on 3V3** is always on and the
  reading is the raw level: mode **`steady`**. The user's LED reads "about
  max" today, so it is probably on 3V3; moving it to D2 is better (Q5).
- **LED sense (optional)**: put 47 Ω between the cathode and GND and wire
  A1 to the cathode, then set `LED_SENSE 1` in `config.h`. A dead LED then
  reads as the fault `led_dead` instead of an open door.
- Keep the LDR and LED out of reach and out of the doorway's path; the
  door must close and open freely, and nothing here holds it. The lock is
  the standalone keypad (D17): nothing here drives it.

## Modes

`mode` defaults to **`auto`**: at boot the firmware drives D2 low, waits
`settle` ms, reads; drives it high, waits, reads; three times. A mean
difference of 200 or more means the LED hangs off D2 → **`mod`**, else
**`steady`**. `hello` reports what it chose with `"auto":true`. `set mode
mod|steady|auto` overrides it (kept by `save`).

- **`mod`**: LED on, wait `settle`, average 8 reads → `lit`; LED off, wait
  `settle`, average 8 → `dark`; `level = max(0, lit − dark)`. One frame per
  ≈ 2 × `settle` (300 ms at the default 150). A CdS cell is slow (≥ 30 ms
  to start falling, much longer to reach dark), hence the generous settle;
  `scripts/accept/N-20.sh` measures the real one. Room light raises `dark`
  and, the cell being non-linear, **shrinks** `lit − dark`, so the
  thresholds come from the bench's worst case. The LED blinks at ≈ 2 Hz
  inside the shroud.
- **`steady`**: `level = lit`, `dark = 0`, one frame per 50 ms. Bright room
  light on the LDR can read *shut*: the shroud matters most here.

## How it decides

- **Shut** once `level ≥ close` for 1 s; **open** once `level ≤ open` for
  250 ms (a run counts from the start of its first frame, so in `mod` at
  the default settle one whole open frame decides: an opening reads
  150–450 ms after the beam breaks, plus the cell's own lag). Between `open` and `close` the last
  state holds, and a frame there breaks a run, so a hand flickering in the
  beam of an open door never reads shut. Defaults `close` 1800, `open`
  1200.
- **Faults** (blocking: each needs 2 s, clears after 2 s clean, forces
  `open: true`, and the terminal posts nothing while one holds):
  `ldr_saturated` (`mod` only: `dark > 4000`, a lamp straight into the
  shroud) and `led_dead` (with `LED_SENSE`: the sense reading under 20 while
  the LED is driven). While one is building (those 2 s) the last state
  holds and calibration skips the frames, so a light flash never reads as
  an opening; after a boot or a `set mode` / `set settle` / `reset` no
  `door` line goes out until a clean frame decides (or the fault latches).
- **Warning** `ldr_open` (`lit < 8` and `dark < 8` for 2 s): a cut LDR wire
  reads exactly like an open door in a dark hall, so it is reported (`warn`)
  and never changes `open` or blocks.

## The serial protocol (contract §2.9)

USB CDC, 115200 8N1, `\n`-terminated ASCII lines, one JSON object per
output line. `test/fixtures/lines.jsonl` has one of each:

| Line | When |
|---|---|
| `{"t":"hello","fw","mode","auto","close","open","settle","cal","sense"}` | at boot (only if a host has the port open) and on `version` |
| `{"t":"door","seq","open","level","lit","dark","fault","warn"}` | on every change of `open`, `fault` or `warn`, and every 1 s; `seq` +1 per line |
| `{"t":"pong","up"}` | `ping` (`up` = ms since boot) |
| `{"t":"cfg",…,"saved"}` | `get`, and after `save` (`saved` = the live settings are the ones in flash) |
| `{"t":"cal","which","ref","close","open"}` | 2 s after `cal closed` / `cal open` |
| `{"t":"ok","cmd"}` / `{"t":"err","error","cmd"}` | every other command |

Commands: `ping` · `version` · `get` · `cal closed` · `cal open` · `set
close <0-4095>` · `set open <0-4095>` · `set mode mod|steady|auto` · `set
settle <20-1000>` · `save` · `reset` (defaults, not saved). Errors: `unknown
command`, `bad value`, `bad mode`, `out of range`, `open must be below
close`, `cal span too small`, `cal busy`, `sensor fault`, `line too long`,
`flash write failed`.

For a host (the terminal's bridge):

- The board drops its output while no host has the port open, so **send
  `version` (and `get`) after connecting**; door lines follow within 1 s.
- `set open` is refused unless it stays below `close`, and `set close`
  unless it stays above `open`. To re-send a stored pair: **`set open`
  first when the new `open` is below the board's current `close`, else
  `set close` first** (the board's current pair is in the `hello` / `cfg`
  line). That order never trips the rule.
- `set mode` / `set settle` / `reset` restart sampling: the door state is
  relearnt from the next frame.

**Calibration** (`cal closed`, then `cal open`, either order): each
averages `level` over 2 s and answers a `cal` line. After both, `open = o +
0.35·(c − o)` and `close = o + 0.65·(c − o)`; refused (`cal span too
small`) when `c − o < 200`. A hand-set threshold clears `cal`.

**Flash**: `save` writes `{magic 0xD00E, ver 1, flags (cal), close, open,
mode, settle}` through FlashStorage_SAMD (12 bytes); a blank, foreign or
out-of-range record boots with the defaults. The terminal re-sends its own
stored thresholds on every connect anyway.

**Status NeoPixel**: purple a fault; blue until the host has sent one
line; then green shut, amber open.

## Build and flash

```bash
test/run.sh            # host tests of the logic (plain c++17, ~1 s)
test/run.sh compile    # + compile for the Grand Central M4 (installs the core + 2 libraries on first run)
```

By hand (contract §5.3 step 6), on the laptop the board plugs into:

```bash
arduino-cli config add board_manager.additional_urls https://adafruit.github.io/arduino-board-index/package_adafruit_index.json
arduino-cli core update-index && arduino-cli core install adafruit:samd
arduino-cli lib install FlashStorage_SAMD "Adafruit NeoPixel"
arduino-cli compile --fqbn adafruit:samd:adafruit_grandcentral_m4 hardware/server-room-door/server_room_door
# double-tap RESET (the board's LED pulses: the bootloader), then:
arduino-cli board list                      # the port, e.g. /dev/cu.usbmodem14101
arduino-cli upload -p /dev/cu.usbmodem<id> --fqbn adafruit:samd:adafruit_grandcentral_m4 hardware/server-room-door/server_room_door
```

Or open `server_room_door/server_room_door.ino` in Arduino IDE 2: board
**Adafruit Grand Central M4 (SAMD51)** (Boards Manager → *Adafruit SAMD
Boards*), libraries **FlashStorage_SAMD** and **Adafruit NeoPixel**. Serial
monitor: 115200 baud, line ending *Newline*; type `get`.

**Close the Arduino IDE's serial monitor** (and any `arduino-cli monitor`)
before the terminal page connects: only one program can hold the port.

## Pairing with the terminal page (Web Serial)

- Web Serial needs **desktop Chrome** (or Edge) on **https** (or
  `localhost`). Safari and Firefox have none.
- The first time, the terminal's ⚙ (hold 2 s) → *Connect door sensor* opens
  Chrome's port picker: choose the Grand Central. Chrome remembers the
  grant per profile, and the page reconnects with `navigator.serial.getPorts()`
  on every later boot, with no prompt.
- Grant it **in the kiosk's own profile** (`--user-data-dir="$HOME/.loom-terminal"`),
  launched once without `--kiosk`: a grant made in Steph's everyday profile
  doesn't carry over.
- **After any reflash grant it once more**: the board's USB product id
  differs in bootloader mode, and Chrome may treat it as a new device.
- On a Mac nothing else needs installing (the board is a USB CDC device:
  `/dev/cu.usbmodem…`).

## Calibration on site

1. Fit the LED and the LDR (in its shroud) across the gap with the door
   shut; aim until the reading is near its top: in the serial monitor, `get`
   and watch `level` on the door lines (or the terminal's ⚙, which shows the
   live level).
2. Run the bench check: `scripts/accept/N-20.sh /dev/cu.usbmodem<id>`. It
   records `lit` / `dark` / `level` in `mod` and `steady`, door shut and
   open, room lights on and off, finds the settle each needs and proposes
   `mode`, `settle`, `close` and `open`. Apply them with `set …` and `save`
   (it offers to).
3. Or calibrate from the terminal page: ⚙ → *Calibrate: door shut* (`cal
   closed`), open the door, *Calibrate: door open* (`cal open`), Save
   (`save`). Do it with the room lit as on the night.
4. Check: open → `"open":true` within a second, shut → `"open":false`
   about a second after it closes; with the room lights at show level.
5. Pre-doors (contract §5.3 step 7): a real open → shut → open watched on
   Run → Terminals (🚪 *open* / *shut*, no fault, no override).

If the reading drifts on the night (a knocked LED, a bulb on in the hall):
re-run *Calibrate*, or a director presses 🚪 and the story follows the
buttons until 🚪 *Trust the door sensor* (D19).
