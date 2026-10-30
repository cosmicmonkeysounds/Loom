# The server-room M4: the door sensor (wave 20) and the patch bay (wave 22)

An **Adafruit Grand Central M4** on Steph's laptop in the server room that
reads the **patch bay** ([below](#the-patch-bay-wave-22)) and watches the
server-room door with an **LED shining on an LDR** across the
gap: the beam reaches the LDR only while the door is shut. It reports the
door as JSON lines over USB serial (115200). The server-room terminal page
(desktop Chrome on that laptop) reads them with **Web Serial** and posts
`door_sensor_opened` / `door_sensor_closed` to the event (contract §2.1,
§2.5). Nothing here touches the network, MQTT or the lock.

This replaces the ESP32's wire-loop door contact (`hardware/server-room/`,
D16), and for Oct 31 it is the **only** electronics in the server room
(Q7, the user, 2026-10-23: *"No, just the Grand Central M4"*): the ESP32
box (ring, siren, relay, its digital patch-bay scanner) is not installed,
and the siren is the house router's `alarm_siren` sound
(`hardware/server-room/README.md`). Since wave 22 this board reads the
patch bay too: the terminal posts `patch_changed {combo}` and the story
judges it; the Antivirus watch's `radio_*` buttons stay as the fallback
(a press puts the story on the buttons until 🔌 *Trust the patch bay*).

```
server_room_m4/
  server_room_m4.ino     the sketch: pins, flash, Serial, the status NeoPixel
  config.h               pins, defaults, timings (the door's and the bay's)
  door_ldr.h             sampler, boot probe, classifier, faults, calibration maths
  patch.h                the bay: scan, decode, settle, canonical pairs, learn
  proto.h                command parsing, output lines
  store.h                the two flash records (FlashStorage_SAMD)
  engine.h               the three together (begin / tick / command)
test/
  run.sh                 host tests; `run.sh compile` builds the sketch
  test_logic.cpp         the tests (a modelled CdS cell, a modelled bay, every command)
  shim/FlashStorage_SAMD.h   the library's EEPROM calls over a byte array
  fixtures/lines.jsonl   one example of every output line (the terminal diffs against it)
```

## Parts

| Part | Notes |
|---|---|
| Adafruit Grand Central M4 Express (ATSAMD51P20) | USB to Steph's laptop; it powers the LED and LDR too. **3.3 V logic: no pin takes 5 V** |
| LDR (CdS photocell, GL5528 or similar, 10–20 kΩ at 10 lux) | on the frame, facing the LED |
| 10 kΩ resistor | A14 → GND, the divider's bottom half |
| A bright LED (5 mm) + its resistor | on the door edge or the opposite jamb, aimed at the LDR. Today: switched by **D23** (the pulsed wiring below) |
| **A shroud tube**: 2–3 cm of black heat-shrink or a black straw | over the LDR, open end toward the LED: keeps room light off the cell (the most important part for a stable reading, and the only defence the steady wiring has) |
| For the pulsed wiring: an NPN (2N3904 / PN2222 / 2N2222) + 1 kΩ, **or** a red LED + 220 Ω | B below: keeps today's 5 V LED and its resistor; A: a red LED straight off D2 |
| Optional: 47 Ω | the LED sense resistor (A1), below |
| 3-core cable, a long micro-USB cable | the LED and LDR may sit a few metres from the board |

## Wiring

The LDR side is the same in every wiring, and always on **3V3, never 5V**
(the SAMD51's analog pins are not 5 V tolerant):

```
   3V3 ──[LDR in its shroud]──┬── A14
                              │
                           [10 kΩ]
                              │
                             GND
```

More light, higher reading: near 4095 with the beam on the cell. The
firmware reads 12 bits (`analogReadResolution(12)`; SAMD defaults to 10),
so the thresholds run 0–4095.

The LED has two wirings. The firmware is built for one of them with
`LED_MODE` in `server_room_m4/config.h` (Q5, the user, 2026-10-23: *"Currently
on 5V, actually, but it could be on a digital pin to allow pulsing for
better light/dark detection"*).

The pins are `PIN_DOOR_LDR` (A14) and `PIN_DOOR_LED` (D23) in `config.h`;
D2 below means `PIN_DOOR_LED`.

### Steady: the LED on 5V (`LED_MODE LED_STEADY`)

```
   5V ──[its resistor]──►|── GND          (always lit; D2 is driven high and unused)
              (the LED: anode toward 5V)
```

The firmware reads the raw LDR level (`mode` `steady`, `dark = 0`). Light
from the room that gets into the shroud reads as the beam, so an open door
in a bright room can read **shut**. The server room's own RGB bulb (the
heart looks, up to full red) is the light to worry about: aim the shroud
away from it and calibrate with it at its brightest.

### Pulsed: the LED switched by D2 (today's rig, `LED_MODE LED_PULSED`, the default)

The firmware turns the LED on, waits `settle`, reads (`lit`); off, waits,
reads (`dark`); the door is judged on `level = lit − dark` (`mode` `mod` on
the wire). Steady room light raises `lit` and `dark` alike and cancels out,
so the heart bulb or a hall lamp can't fake *shut*.

**B — keep today's 5 V LED and its resistor** (any colour, as bright as now):

```
   5V ──[its resistor]──►|──┐
                            │ C
   D2 ──[1 kΩ]──────────── B  NPN (2N3904 or PN2222A: flat face toward you, legs down, E B C; a P2N2222A is C B E, check yours)
                            │ E
                           GND
```

A logic-level N-MOSFET (AO3400, IRLZ44N) works the same with 100 Ω in the
gate; a 2N7000 is marginal at 3.3 V (its threshold can be 3 V).

**A — a red LED straight off the pin** (no transistor):

```
   D2 ──[220 Ω]──►|── GND        (≈ 6 mA for a red LED, Vf ≈ 2.0 V)
```

A white or blue LED (Vf ≈ 3 V) gets about 1 mA from a 3.3 V pin: too dim.
Use B for those.

Then, either **reflash** with `LED_MODE LED_PULSED` (edit the line in
`config.h`, or `test/run.sh compile` builds both), or keep this firmware
and type `set mode mod` + `save` in the serial monitor (a `reset` then goes
back to steady). **Calibrate again** from the terminal's ⚙ afterwards: a
steady level is not a `lit − dark` level, so the terminal does not re-send
a calibration taken in the other mode (⚙ says *calibrate again: the
sensor's wiring changed*).

### LED sense (optional): a dead LED as a fault

Without it, a dead LED reads exactly like an open door **in either
wiring**: the beam is gone either way (`lit`, or `lit − dark`, falls), so
the LDR alone can't tell the two apart. With it, a dead LED is the blocking
fault `led_dead` (the terminal then posts nothing, and Run shows it).

Put **47 Ω as the last thing before GND** in the LED's path and wire **A1
to the top of the 47 Ω**; then set `LED_SENSE 1` in `config.h`. While the
LED is driven, A1 reads `I · 47 Ω` (≈ 0.2–0.9 V); a dead LED reads 0.

- Steady (5V): `5V ─[its resistor]─►|─┬─[47 Ω]─ GND`, A1 on the `┬`.
- Pulsed A: `D2 ─[220 Ω]─►|─┬─[47 Ω]─ GND`, A1 on the `┬` (≈ 290).
- Pulsed B: **no sense wire.** With the transistor off the collector floats
  up toward 5 V, which A1 must never see.

### Both

- Keep the LDR and LED out of reach and out of the doorway's path; the
  door must close and open freely, and nothing here holds it. The lock is
  the standalone keypad (D17, Q9: it keeps the door locked): nothing here
  drives it.
- The ESP32 (`hardware/server-room/`) is **not installed** for Oct 31
  (Q7): this board is the only electronics on the server-room door.

## Modes

`mode` is what the sampler runs; a blank board (and `reset`) runs the
build's `LED_MODE`:

| `LED_MODE` | `mode` | |
|---|---|---|
| `LED_STEADY` | `steady` | `level = lit`, `dark = 0`, one frame per 50 ms. Nothing touches D2 after boot |
| `LED_PULSED` (default) | `mod` | LED on, wait `settle`, average 8 reads → `lit`; off, wait, average 8 → `dark`; `level = max(0, lit − dark)`; one frame per ≈ 2 × `settle` (300 ms at the default 150), so the LED blinks at ≈ 3 Hz inside the shroud |
| `LED_AUTO` | probed | the wave 20 behaviour: at boot D2 low / high three times, a mean difference ≥ 200 → `mod`, else `steady`; while it runs `steady` it re-probes on every close (≈ 0.9 s with the loop blocked) |

`hello` / `cfg` report the running `mode` (`mod` or `steady`) and `auto`.
`set mode steady|mod|pulsed|auto` overrides the build (`pulsed` is a name
for `mod`), kept by `save`; a board's saved mode wins over its build until
`reset`.

- **`mod`**: a CdS cell is slow (≥ 30 ms to start falling, much longer to
  reach dark), hence the generous settle; `scripts/accept/N-20.sh`
  measures the real one. Room light raises `dark` and, the cell being
  non-linear, **shrinks** `lit − dark`: far more light in the shroud than
  the bench's worst case drops a shut door's level below `close`, and it
  reads *open* (never a false *shut*); calibrate with the room lit as on
  the night.
- **`steady`**: bright room light on the LDR can read *shut*: the shroud
  matters most here (the host tests model 5 lux inside the shroud with the
  LED spilling round an open door: steady reads it shut, pulsed open).

**With `LED_AUTO`, boot it, and connect the terminal, with the door shut.**
With the door open the beam is blocked, so an LED on D2 looks like no LED
and the probe picks `steady` until the door next reads shut.

## How it decides

- **Shut** once `level ≥ close` for 1 s; **open** once `level ≤ open` for
  250 ms (a run counts from the start of its first frame). An opening
  reads **150–450 ms** after the beam breaks in `mod` at the default settle
  (one whole 300 ms open frame decides) and **250–300 ms** in `steady`
  (five 50 ms frames), plus the cell's own lag in both; a close reads
  about a second after the door shuts. Between `open` and `close` the last
  state holds, and a frame there breaks a run, so a hand flickering in the
  beam of an open door never reads shut. Defaults `close` 1800, `open`
  1200.
- **Faults** (blocking: each needs 2 s, clears after 2 s clean, forces
  `open: true`, and the terminal posts nothing while one holds):
  `ldr_saturated` (`mod` only: `dark > 4000`, a lamp straight into the
  shroud) and `led_dead` (with `LED_SENSE`, in either wiring that can carry
  it: the sense reading under 20 while the LED is driven; without it a dead
  LED reads as an open door). While one is building (those 2 s) the last state
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
close <0-4095>` · `set open <0-4095>` · `set mode mod|pulsed|steady|auto`
(`pulsed` = `mod`; the lines always say `mod`) · `set settle <20-1000>` ·
`save` · `reset` (the defaults with the build's `LED_MODE`, not saved). Errors: `unknown
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
- Don't send `set mode`: the mode is the LED's wiring, which the build
  (`LED_MODE`) or the board's own flash knows. The terminal re-sends a
  stored calibration only when it was taken in the mode the board reports
  now, and otherwise asks for a new one in ⚙.

**Calibration** (`cal closed`, then `cal open`, either order): each
averages `level` over 2 s and answers a `cal` line. After both, `open = o +
0.35·(c − o)` and `close = o + 0.65·(c − o)`; refused (`cal span too
small`) when `c − o < 200`. A hand-set threshold clears `cal`.

**Flash**: `save` writes `{magic 0xD00E, ver 1, flags (cal), close, open,
mode, settle}` through FlashStorage_SAMD (12 bytes); a blank, foreign or
out-of-range record boots with the defaults (the build's `LED_MODE`). The
terminal re-sends its own stored thresholds and settle on every connect
anyway (never the mode, and nothing at all from a calibration taken in
another mode). A reflash may keep or wipe the record: check `get` after one.

**Status NeoPixel**: purple a fault; blue until the host has sent one
line; then green shut, amber open.

## Build and flash

```bash
test/run.sh            # host tests of the logic (plain c++17, ~1 s)
test/run.sh compile    # + compile for the Grand Central M4, the shipped (pulsed) build and a steady one
                       #   (installs the core + 2 libraries on first run)
```

The steady build by hand: edit `#define LED_MODE LED_PULSED` in
`config.h` to `LED_STEADY`, or add
`--build-property "compiler.cpp.extra_flags=-DLED_MODE=LED_STEADY" --clean`
to the compile and upload below.

By hand (contract §5.3 step 6), on the laptop the board plugs into:

```bash
arduino-cli config add board_manager.additional_urls https://adafruit.github.io/arduino-board-index/package_adafruit_index.json
arduino-cli core update-index && arduino-cli core install adafruit:samd
arduino-cli lib install FlashStorage_SAMD "Adafruit NeoPixel"
arduino-cli compile --fqbn adafruit:samd:adafruit_grandcentral_m4 hardware/server-room-m4/server_room_m4
# double-tap RESET (the board's LED pulses: the bootloader), then:
arduino-cli board list                      # the port, e.g. /dev/cu.usbmodem14101
arduino-cli upload -p /dev/cu.usbmodem<id> --fqbn adafruit:samd:adafruit_grandcentral_m4 hardware/server-room-m4/server_room_m4
```

Or open `server_room_m4/server_room_m4.ino` in Arduino IDE 2: board
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
   open, room lights on and off (the server room's RGB bulb at its
   brightest red included), finds the settle each needs and proposes
   `mode`, `settle`, `close` and `open`. Apply them with `set …` and `save`
   (it offers to). With the LED on 5V `mod` can't separate anything (the
   LED never blinks): it proposes `steady`.
3. Then calibrate from the terminal page too (it keeps its own copy and
   re-sends it on connect): ⚙ → *Calibrate: door shut* (`cal closed`),
   open the door, *Calibrate: door open* (`cal open`), Save (`save`). Do it
   with the room lit as on the night. ⚙'s line names the wiring the board
   runs (*steady* / *pulsed*).
4. Check: open → `"open":true` within a second, shut → `"open":false`
   about a second after it closes; with the room lights at show level.
5. Pre-doors (contract §5.3 step 7): a real open → shut → open watched on
   Run → Terminals (🚪 *open* / *shut*, no fault, no override).

If the reading drifts on the night (a knocked LED, a bulb on in the hall):
re-run *Calibrate*, or a director presses 🚪 and the story follows the
buttons until 🚪 *Trust the door sensor* (D19).

## The patch bay (wave 22)

Fifteen ¼" **TS** jacks on the server-room patch panel, every one live (no
decoys): a top row of **8 sources V1–V8** and a bottom row of **7 inputs
D1–D7**. The board reads the inputs on **A2–A8**, decodes which source each
is patched to, and sends the bay as a `patch` line; the terminal posts
`patch_changed {combo}` once four V–D cables settle into a set it hasn't
just posted, and the **story** judges it (the combinations live only in the
story: nothing here, in the terminal or on the heartbeat knows them).

### Wiring

**Every sleeve to the M4's GND.** Plain (unswitched) TS jacks, or leave the
switch lugs unconnected; insulate the jacks from a metal panel unless the
panel is GND too. Everything stays on **3V3**, never 5V.

**Each source is its own divider** off 3V3 (never one shared ladder: a V–V
cable across a ladder would drag every other tap off its level), then 1 kΩ
in series to the jack's tip (a tip sliding across a sleeve on insertion
shorts only through the 1 kΩ):

```
   3V3 ──[top]──┬──[1 kΩ]── V<k> tip
                │
             [bottom]
                │
               GND
```

| Source | Top | Bottom | Nominal V | 12-bit counts (`PB_NOMINAL`) |
|---|---|---|---|---|
| V1 | 8.2 kΩ | 1.0 kΩ | 0.36 | 445 |
| V2 | 6.2 kΩ | 1.8 kΩ | 0.74 | 921 |
| V3 | 6.8 kΩ | 3.3 kΩ | 1.08 | 1338 |
| V4 | 6.2 kΩ | 5.1 kΩ | 1.49 | 1848 |
| V5 | 5.1 kΩ | 6.2 kΩ | 1.81 | 2247 |
| V6 | 3.3 kΩ | 6.8 kΩ | 2.22 | 2757 |
| V7 | 1.8 kΩ | 6.2 kΩ | 2.56 | 3174 |
| V8 | 1.0 kΩ | 8.2 kΩ | 2.94 | 3650 |

1 % metal film. The values only need to stay in order and well apart (the
closest two, V4 and V5, are ≈ 400 counts apart): `pb learn` measures the
real levels on the bench. The eight dividers draw ≈ 2.5 mA.

**Each input:** tip → **220 kΩ to GND** at the jack (an empty jack reads
≈ 0) → **1 kΩ** → the ADC pin → **100 nF to GND** at the pin (a stiff source
for the SAMD51's sample-and-hold, and a little filtering).

```
   D<i> tip ──┬──[1 kΩ]──┬── A(1+i)        D1 → A2 … D7 → A8
              │          │
          [220 kΩ]    [100 nF]
              │          │
             GND        GND
```

A patched input reads within ≈ 2 % of its source (the 220 kΩ against the
divider's ≈ 1–3 kΩ). The ADC reads against the SAMD51's 3.3 V analog rail,
the same 3V3 the dividers hang off, so the levels are ratiometric; **check
on the bench** that V4 into any input reads ≈ 1848 (`N-21.sh` prints it).

### What a cable reads

- **V–D:** that source's level on that input: the pair `V<k>-D<i>`.
- **V–V:** two sources joined: no input sees it.
- **D–D:** two inputs joined, both pulled to GND: they read empty.
- So the bay counts **V–D cables only**. Four cables with a top-to-top or
  bottom-to-bottom one among them read as three pairs: *incomplete*, never a
  wrong combination (the watch presses ❌ by hand for those).
- **Between levels** (a half-seated plug, a dirty tip, a wrong resistor):
  the input reads `-1` and the bay is not complete.

### How it decides

- Every 50 ms each input is read once (a throwaway read after the ADC's mux
  moves), then 8 times and averaged; each mean is decoded: **empty** under
  `floor` (150), **V<k>** within `tol` (120) of V<k>'s level, else
  **between** (`-1`).
- The decode of all seven inputs must hold **unchanged for 1 s** to become
  the *settled* bay (a tip brushing the sleeve on its way in, a hand still
  moving cables, never settles).
- The settled bay's **pairs**: `V<k>-D<i>` per patched input, sorted by
  source then input, joined by `,` (e.g. `V1-D2,V3-D1,V5-D4,V8-D6`; the same
  form the old ESP32 scanner sent). **Complete** = exactly four pairs, no
  input between levels, no source on two inputs (impossible with TS cables:
  a wiring fault or crosstalk).
- A `patch` line goes out on every settled change and at least once a
  second, from boot (so ⚙'s live table shows before anything settles).

### Lines and commands

| Line | When |
|---|---|
| `{"t":"patch","seq","pairs","count","complete","raw":[7],"src":[7],"stable"}` | every settled change, and every 1 s. `pairs` / `count` / `complete`: the settled bay; `raw`: the latest 12-bit mean per input, D1 first; `src`: their decode (0 empty, 1–8, −1 between); `stable`: the latest scan is the settled bay |
| `{"t":"pbcal","src","raw","levels":[8],"floor","tol","saved"}` | after `pb learn V<k>` (`src` k, `raw` what it read) and every other `pb` command (`src` 0, `raw` 0); `saved`: these are the levels in flash |

`hello` and `cfg` carry `"pbv":8,"pbd":7` (0 / 0 on a build or rig with no
bay; an older terminal ignores both, and the new lines). `fw` is
`door-m4 1.2.0`.

Commands: `pb learn V<1-8>` (exactly one cable in, from that source into
any input: averages 1 s; refused with `pb: need exactly one cable` for none,
two or a cable that moves, `pb: too close to V<j>` when the level would sit
within 2·`tol` of another source's, `pb: too faint`, `pb busy`) · `pb get`
(a `patch` line, then `pbcal`) · `pb save` (the levels, `floor` and `tol`
to flash) · `pb reset` (the nominal table, not saved) · `pb floor <20-1000>`
· `pb tol <20-1000>` (`out of range` if a level would fall under `floor +
tol`). A board with no bay answers every `pb` command `pb: no bay`.

**Flash:** a second record at EEPROM address 16, `{magic 0xBA7E, ver 1,
sources 8, level ×8, floor, tol}` (24 bytes). The door's 12-byte record at
0 never moves: `save` and `pb save` each leave the other's bytes alone, and
a board flashed from 1.1.0 keeps its door calibration.

### Learning the levels on site

`scripts/accept/N-21.sh` (serial only, ~10 minutes): it learns V1–V8 one
cable at a time, walks a source through every input, prints the table and
checks the floor and the tolerance, then offers `pb save`. By hand, in the
serial monitor: one cable from V1 into any input, `pb learn V1`, and so on
to V8, then `pb save`. From the terminal: hold ⚙ 2 s → *patch bay*: the
live readings per input, **Learn** per source, **Save** / **Reset**.

The crew check before doors: patch V1 into D1, D2 … D7 in turn and see every
row read V1; then V2 … V8 into one input.

## What the terminal does with the bay

The server-room terminal page (`terminal/src/serial/patch-bridge.ts`)
reads the `patch` lines on the same port as the door. When the settled
bay *becomes* complete with a set of pairs it has not just posted, it posts
`patch_changed {combo}` (`POST /api/mod/signal`, labelled *Terminal ·
<name>*). It posts only in the Y2K hour (the story's `night.step >= 14`),
never after an ending, and never while a director's 🔌 / 💥 / ❌ press has
put the bay on the buttons (`Night.patch_override`, lifted by 🔌 *Trust
the patch bay again*). A set completed while that gate is shut is never
posted later: pull a cable and push it back to play it. The cables already
in when the port connects are only looked at, so a reboot never re-posts
them. Neither the board nor the terminal knows which combinations matter:
the story does.

`&bay=0` on the terminal's link (or ⚙) turns the bay off; a board whose
`hello` says `pbd 0` has none.

**Heartbeat** (Run → Terminals' 🔌 badge, `pnpm showctl terminals`): `pb`
is the number of V–D cables in the settled bay, or `fault`; `pbc=1` the
bay is complete; `pbx` inputs reading between levels; `pft` the fault
(`no_port`, `stale` with no `patch` line for a while, `dup` a source on two
inputs).

## Checks

| Check | What |
|---|---|
| `hardware/server-room-m4/test/run.sh` | the host tests (807 checks on 2026-10-24); `run.sh compile` builds both firmware variants |
| `scripts/accept/N-20.sh [port]` | the door sensor on the bench or the real frame (proposes `mode`, `settle`, `close`, `open`) |
| `scripts/accept/N-21.sh [port]` | the patch bay: learn V1–V8, walk a source through every input, check the tolerance, offer `pb save` |
| `M4BAY=1 MOD_CODE=… scripts/accept/K-05.sh` | through the story: the terminal posts the bay's combination in the Y2K hour |
| `pnpm showctl preflight serverroom` | on Steph's laptop: Chrome, the board on USB, the kiosk link pattern; then by hand the door and one cable |

## Steph's laptop on Windows

Nothing here assumes macOS except the examples. On Windows the board is a
`COMn` port (Device Manager → Ports): `arduino-cli upload -p COM5 …`,
`scripts/accept/N-21.sh COM5` under Git Bash with pyserial (`py -m pip
install pyserial`). Web Serial works the same in desktop Chrome or Edge on
https. The kiosk line for each OS is in
[`docs/trapped/kiosk.md`](../../docs/trapped/kiosk.md) → *The server room*.
