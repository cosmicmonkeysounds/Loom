> **Historical (moved from `docs/trapped/` on 2026-10-24).** A planning or audit note from October 2026; the code, the show folder and the package docs win where they differ.

> **Wave 20 (2026-10-23) supersedes §A again.** The server-room door is read by an **LED shining on an LDR** across the gap (the beam reaches the LDR only while the door is shut), on an **Adafruit Grand Central M4** plugged into Steph's laptop in the server room. The server-room terminal page reads it over **Web Serial** and posts `door_sensor_opened` / `door_sensor_closed` to the event; the ESP32's wire-loop contact and the Zigbee contact are no longer read (D16). See §A.5, [`hardware/server-room-door/`](../../../hardware/server-room-m4) and the wave 20 contract (`core/examples/trapped-in-the-internet/CONTRACT-w20.md` §1.2, §2.9). The keypad lock is unchanged.
>
> **Wave 7 (2026-10-17) supersedes the door sections (§A, ≈ lines 34–113).** The server-room door now has a real **standalone keypad lock** (outside only, set by hand to `facts.json` `door.code`, never networked; the inside handle always opens with no code), and the sensor is **two loops of wire / copper tape that touch when the door opens** (`kClosedWhenOpen`, the reed optional; `hardware/server-room/README.md`). The door never alarms; only the second wrong patch-bay combination does. Read the notes below as history; [OCT31 §5 *Wave 7 status*](../../../core/examples/trapped-in-the-internet/OCT31.md) and CHECKLIST §D (HW-DOOR-09) are current.
>
> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../../core/examples/trapped-in-the-internet/OCT31.md)). **Built** from §A–B: the server-room ESP32 (N-08, [`hardware/server-room/`](../../../hardware/server-room)) — reed + copper-tape door, the 2×12 patch bay scanned all-pairs on two MCP23017s, a WS2812 ring, a DFPlayer siren/click and a relay — dialing the house Mac's Mosquitto at `192.168.8.10:1884` as user `props`. The door is a sensor + indicator, never a lock (the maglock rules were deleted, K-05). From §C: `stagehand/trapped.house.yaml` (K-05) — the stairs, bathroom, tent, server room and the server-room → living-room path out of `house`, blackout as per-device WLED offs with the Tube on dim preset 22, retained messages ignored, `edge: true` door rules, `show` / `agents` as separate launchd jobs. From §D: **one house Mac** (the 48 GB Ollama laptop, static IP) drives the TV over HDMI, the speakers through the MOTU and runs Mosquitto / Z2M / stagehand — read "show laptop", "Z2M host" and "TV box / Pi 5" below as that Mac; the Alexa is stagehand's `alexa` player on it (K-20). Parts and wiring advice is still research; signal arguments for the patch bay are still not in stagehand (the YAML judges the combos).

# Trapped In The Internet: hardware research and build notes

Scope: the physical layer of the party, checked against the source design
(`Trapped In The Internet story/`) and what the codebase can already do
(`stagehand/` show module, `core/` event server, `terminal/`). Prices are
approximate as of Oct 2026 and must be re-checked before buying. Where a
number comes from engineering judgment and not a datasheet, it says so.

---

## 0. What the story asks the hardware to do

| Need | Source |
|---|---|
| Pitch-black Mud Room, solo onboarding | `Story Overview.md:41-43` |
| The Tube: a tunnel of lights, wires, chips into the living room; "erratic lighting, may have lines that lead you to specific places" | `Story Overview.md:51`, `STORY BEATS.md:8` |
| TV above the fireplace: Windows screensaver before the inciting event, then Trabolta's questions, the Trust Chart, the ad hijack | `Story Overview.md:53, 119, 153, 178` |
| "Screens in different rooms all alert programs to go to the desktop" + push notification with sound | `Story Overview.md:63-65` |
| The Internet tent: marked exit, two VR headsets, a tablet playing the instructional video; the room screen mirrors the VR player | `Story Overview.md:99-111`, `STORY BEATS.md:16-17` |
| Five-minute warning, Bathroom Mode | `Story Overview.md:165`, `STORY BEATS.md:27` |
| Truth Pong (cup pyramid on a folding table **outside**) | `Story Overview.md:169`, `STORY BEATS.md:28` |
| A printer that won't print because it's full of beans (VLC presses start) | `Story Overview.md:178-182`, `STORY BEATS.md:31` |
| Server room: Trabolta's heart. Disabling him causes a **ten-second blackout**, the chat app flashing "Go to the living room", then one dance song. Turning off the whole computer causes the same blackout, then the purgatory ending | `Story Overview.md:222-228`, `STORY BEATS.md:43-45` |
| Trabolta **is** a video patch bay in the cold-storage room. Use the correct combination ("literally hundreds of potential points"), get in **without tripping the alarm**, and physically place the patch cables "in the right order" | `Story Overview.md:309-310`, `STORY BEATS.md:54` |
| Bobbing for Truth: the Bag of Truth with truth.txt inside | `Story Overview.md:240-248`, `STORY BEATS.md:48-49` |
| Finale songs: "You're the One That I Want", vocoder male lines + "I'm sorry, I didn't understand that" | `Story Overview.md:250-252` |

---

## A. Server-room door sensor

### A.1 The options

| | **Copper tape / wire contact → ESP32 GPIO** (the user's idea) | **Wired magnetic reed → ESP32 GPIO** | **Zigbee contact sensor → Zigbee2MQTT** |
|---|---|---|---|
| Parts | Copper foil tape with conductive adhesive, two wires, ESP32 | MC-38-style surface reed + magnet (~$8–10 for 5 pairs), ESP32 | Aqara MCCGQ11LM (~$17–18), Sonoff SNZB-04P (~$15–19, ~€10–12 in EU) |
| How it reads | `INPUT_PULLUP`. Door closed bridges the contacts, so the pin reads LOW. Door open reads HIGH | Same: the reed closes when the magnet is within ~15–25 mm | Event-driven Zigbee report. Payload `{"contact": true}` = **closed**, `{"contact": false}` = **open** (Z2M docs: "false = contact ON") |
| Reliability | **Weakest.** It needs real pressure between two flat foils every time the door shuts. Doors settle, strike plates float, and a 1 mm gap reads "open". Copper oxidises, but for one night that matters less than alignment and pressure. Adhesive conductivity across tape joints is patchy | **Strong.** No contact pressure needed and it tolerates a few mm of misalignment. This is what every alarm panel uses | **Strong**, provided the Zigbee mesh is healthy near that room (cold storage is often a basement or concrete room: put a mains-powered Zigbee router bulb or plug nearby) |
| Latency (judgment) | <5 ms at the pin, plus debounce, plus ~10–50 ms over Wi-Fi MQTT | Same | ~100–300 ms typical (the device sleeps, but a contact change wakes it at once) |
| Debounce | Required: contacts chatter on close. Use 50 ms, plus a "stable open ≥ 300 ms" rule before alarming | 20–50 ms is enough | None needed; Z2M reports clean edges |
| Power | USB to the ESP32 | USB to the ESP32 | Coin cell (MCCGQ11LM uses a CR1632). Battery % can take up to 24 h to report, so fit a fresh cell the week before |
| Tamper | A guest who notices it can tape it over. Both contacts are visible | A magnet held to the reed defeats it, which guests won't think of | SNZB-04P exposes `tamper`. MCCGQ11LM has none |
| Firmware | You write it (or ESPHome `binary_sensor: gpio`) | ESPHome `binary_sensor: gpio`, ~10 lines of YAML | None, since Z2M is already running |
| Avoid | n/a | n/a | **IKEA PARASOLL (E2013).** Z2M's own page advises against buying it for Z2M: it drops off some networks and drains batteries (issue zigbee2mqtt#22579) |

**If you keep copper tape, change the geometry.** Put **both** contacts on the
frame (two parallel strips on the stop moulding with a 5 mm gap) and one
**bridging** strip on the door edge. No wire then runs to the moving door. A
better version of the same idea is a spring contact: a phosphor-bronze
weatherstrip, a door-jamb plunger switch (~$5), or a microswitch with a roller
lever on the frame. All three are cheap and far more repeatable than foil
against foil.

### A.2 Extra sensing ideas (optional; they add drama)

- **Capacitive touch on the door handle.** On the ESP32, run a wire from a
  touch pin (T0–T9, e.g. GPIO4) to a metal knob. `touchRead()` falls when a
  hand closes on it. That is an early warning a second **before** the door
  opens ("Someone is touching Trabolta's door…"). Calibrate on site; grounding
  and humidity shift the baseline. Treat it as atmosphere, not as the alarm.
- **Presence inside the room.** Options: an AM312 mini PIR on the ESP32 (~$2);
  an LD2410 mmWave module (~$5, sees people standing still); or a Zigbee PIR
  (Aqara RTCGQ11LM, IKEA VALLHORN). Zigbee PIRs have a long blind time
  (~60 s), which is fine for "someone is in there" but useless as a trigger.
- **A disarm keypad.** "Enter without tripping the alarm" (`Story
  Overview.md:309`) plays better with a way **to** disarm. One option is a
  4x4 membrane keypad (~$3) on the server-room ESP32: open the door and you
  get 10 s to type the code (learned as a codex entry), like a real alarm
  panel. The no-hardware version: the guest redeems the disarm code in the
  Codex room before going in.

### A.3 "Locked / unlocked" indicator

The story owns the state ("has the faction earned the Legendary fact?"). The
door only **shows** it.

- **Best:** a short WS2812B strip or 12-LED ring above the door, driven by the
  same server-room ESP32: red breathing = armed, solid green = unlocked,
  strobe = alarm. It works locally even if Wi-Fi drops mid-alarm. The story
  drives it with the existing retained `prop:` rule
  (`stagehand/show.example.yaml:29-34`): `<prop: server_room, armed: false>`
  publishes `props/server_room/set {"armed": false, "target": "server_room"}`,
  retained, so a rebooted ESP32 re-converges.
- **Zero-solder alternative:** a Zigbee colour bulb (Hue or IKEA TRÅDFRI
  colour) in a fixture over the door. Publish
  `zigbee2mqtt/Server Door Light/set {"state":"ON","color":{"hex":"#00FF00"},"transition":0}`.

### A.4 Recommendation

- **Primary: a wired reed switch on the server-room ESP32,** the same box that
  scans the patch bay (§B). One device then owns the door, the indicator, the
  local siren and the patch bay, with one MQTT LWT (`health/serverroom`, per
  `docs/loom-show-control.md:184, 296-298`). If you love the copper idea, use
  the frame-bridge or spring-contact version above in place of the reed. It
  plugs into the same GPIO.
- **Fallback, run in parallel: an Aqara MCCGQ11LM** (or SNZB-04P for tamper) on
  the same door, paired to Z2M. Two independent radios, each with its own
  stagehand sensor rule, firing the same story signal. The rules' debounce plus
  the story's `if` keep a double fire harmless.

Stagehand rules (these work today; `stagehand/src/stagehand/show/sensormap.py:52-56`):

```yaml
sensors:
  - on: { topic: "serverroom/door", when: "open == true" }          # ESP32
    signal: { name: "server room opened", debounce_s: 5 }
  - on: { topic: "zigbee2mqtt/Server Room Door", when: "contact == false" }  # Zigbee
    signal: { name: "server room opened", debounce_s: 5 }
  - on: { topic: "zigbee2mqtt/Server Room Door", when: "contact == true" }
    signal: { name: "server room closed", debounce_s: 2 }
```

The story then decides: `when server room opened: if not World.server_room_unlocked: …`
alerts the Antivirus and the mods (a `broadcast "!…"` makes phones chime and
buzz), and sends `<prop: server_room, alarm: true>` back to the siren.

**Gap:** stagehand sensor actions only carry `name` + `subject`
(`sensormap.py:52-56`, `modapi.py:118-119`), but `/api/mod/signal` already
accepts `args` (`core/server/event-runtime.ts:2745-2748`). Payload fields
such as `{"correct": 3}` from the patch bay can't reach the story until
stagehand forwards `args`. It's a small change.

### A.5 Wave 20: LED + LDR on the Grand Central M4 (current)

The user's door: *"There is a door sensor (LDR + LED -- the door is
"closed" when the LED is shining on the LDR, which reads about max value on
an Arduino) … In the server room is Steph's laptop with an Arduino plugged
into it (Grand Central M4) -- the door sensor is connected to it. This
should transmit to the Loom server."* Built in
[`hardware/server-room-door/`](../../../hardware/server-room-m4) (its README
has the wiring, the protocol and the on-site calibration).

| | |
|---|---|
| Parts | Grand Central M4 (ATSAMD51, 12-bit ADC), a CdS LDR + 10 kΩ pull-down on A0, a bright LED + 220 Ω on **D2** (or on 3V3), a **black shroud tube** over the LDR, optional 47 Ω LED-sense resistor on A1 |
| How it reads | 3V3 → LDR → A0 → 10 kΩ → GND: more light, higher reading (near 4095 lit). With the LED on D2 the firmware blinks it and uses `lit − dark` (**`mod`**), so room light can't fake *shut*; on 3V3 it reads the raw level (**`steady`**). `auto` (the default) toggles D2 at boot and picks |
| Timing | A CdS cell is slow: ≥ 30 ms before it starts to fall and far longer to settle, so `mod` waits 150 ms per phase (stored, 20–1000): a frame ≈ 300 ms. Open after 250 ms of open frames (≈ 450–750 ms after the beam breaks), shut after 1 s; a hysteresis band (defaults 1200 / 1800) holds the last state |
| Room light | Non-linear: more ambient raises `dark` and **shrinks** `lit − dark`. The shroud is the fix; `scripts/accept/N-20.sh` measures the worst case on site and proposes the thresholds |
| Failure modes | A saturated cell (`mod`: dark > 4000) or a dead LED (with the sense wire) is a **blocking fault**: the door reads open and the terminal posts nothing (Run shows 🚪 red; the directors' 🚪 buttons take over, `Night.door_override`). A **cut LDR wire** reads exactly like an open door in a dark hall, so `ldr_open` is only a warning and the door still reports open. An unplugged cable → the terminal's `no_port` / `stale` fault |
| Transport | USB CDC JSON lines at 115200 → Chrome's Web Serial in the terminal page (desktop Chrome on https; the port granted once in the kiosk profile, reconnected by `navigator.serial.getPorts()`, granted again after a reflash) → `POST /api/mod/signal` with the terminal's mod token. No Wi-Fi, MQTT or stagehand on the path |
| Calibration | `cal closed` / `cal open` average 2 s each; thresholds at 35 % / 65 % of the span, refused under 200; `save` keeps them in flash (FlashStorage_SAMD), and the terminal re-sends its own on every connect |

Why not the earlier options: the copper-tape / wire-loop contact failed
silently when a loop broke (§A.1, wave 7's README), and the user already
had the LED + LDR and the M4 on the laptop that runs the server-room
terminal. The browser bridge needs no new daemon (contract D1; a stagehand
serial reader is out of scope).

---

## B. Trabolta's heart: the video patch bay

### B.1 What you probably have, and the trap inside it

Broadcast video patch bays are usually **2x24, 2x26 or 2x32**, with
WECO / mini-WECO / BNC front jacks and **BNC on the rear**: one rear BNC per
front jack. Examples are the Canare 24DV (2x24, normal-through), the
Switchcraft VPP 2x24/2x26 (normalled, 75 Ω terminated), and the Bittree
2x32 ("dual body, self-normalling, with 75 Ω termination"). Audio bays
(bantam/TT, ¼") are 2x24/2x48 and usually half-normalled.

Two built-in features **will break any DIY sensing** until dealt with:

1. **Normals.** With nothing plugged in, the top jack's rear is connected to
   the bottom jack's rear in the same column. Wire both to your scanner and
   every column reads as already patched.
2. **Self-termination.** On a "terminated" bay, an empty jack's centre
   conductor is tied to ground through **75 Ω**. Against a 100 kΩ pull-up,
   that pin reads LOW forever, so it looks permanently connected. A voltage
   ladder is ruined the same way.

**Bench test before designing anything.** With nothing plugged in, use a
multimeter on the rear BNCs:

- centre to shell ≈ 75 Ω means terminated;
- top-N centre to bottom-N centre ≈ 0 Ω means normalled.

**Fixes, in order of preference:**

- **(a) Swap the jack modules.** Many bays use per-column modules, so you can
  swap to non-normalled, non-terminated ones (e.g. Canare DVJ-W in place of
  DVJB-W).
- **(b) Open the bay** and cut or desolder the normal links and termination
  resistors.
- **(c) Don't use the bay's internals at all.** Treat the front panel as a
  façade: drill or reuse the jack bodies, and solder your own signal wire to
  each jack's centre contact, with all shells on common ground.
- **Clever, but brittle:** keep the normals and treat an intact normal as a
  free "no plug in this column" detector. Plugging into either jack of a full
  normal breaks it. Only consider this on a full-normal, non-terminated bay.

**Patch cords:** match the jack (WECO vs mini-WECO vs BNC). New video patch
cords run ~$15–40 each; used lots on eBay are cheaper. Buy **more cords than
the solution needs** (e.g. 10–12 for a 5-cable solution) so the count gives
nothing away.

### B.2 Sensing approach 1: analog voltage identification

Each top-row source sits at a unique voltage. Each bottom-row destination is
read by an ADC, and the reading tells you which source is patched in.

- **Sources.** Options are a resistor ladder off 3.3 V (24 taps ≈ 137 mV
  apart), the ESP32's two 8-bit DACs (GPIO25/26, **classic ESP32 only**, not
  S3/C3), or an MCP4728 4-channel 12-bit DAC per 4 jacks.
- **Destinations.** ESP32 ADC1 (8 channels on a classic ESP32; ADC2 is
  unusable while Wi-Fi is on) is nonlinear below ~150 mV and above ~2.5–3.1 V,
  with tens-of-mV noise. Realistically ~12–16 reliable levels after
  calibration. An ADS1115 (16-bit I²C, 4 channels, ~$3–6) resolves 125 µV at
  ±4.096 V FS, so 24+ levels is easy.
- **Problems:**
  - One ADC channel per destination. 24 destinations = 6× ADS1115, but the
    ADS1115 has only **4 I²C addresses**, so you need a second bus or a
    TCA9548A mux.
  - Cable and contact resistance is negligible at these impedances. Oxidised
    jack contacts and leakage are not: a dirty 30-year-old jack can add enough
    resistance or leakage to shift a high-impedance ladder.
  - It can't tell "two sources jumpered to each other" from noise, and it
    can't see top-to-top patches at all.
- **Verdict:** clever, thematically literal ("fixed voltages" / "DACs"), and
  more fragile and expensive than it needs to be.

### B.3 Sensing approach 2: digital all-pairs scanning (recommended)

Each jack's centre goes to one I/O pin and all shells go to GND. To scan:

1. Make jack *i* an output driven LOW. Make every other jack an input with a
   pull-up.
2. Any other jack *j* that reads LOW is connected to *i* by a cable.
3. Repeat for every *i*.

Because each jack holds exactly one plug, each jack connects to at most one
other jack. **There is no ghosting, so no diodes are needed.** Unlike a
keyboard matrix, this is a true point-to-point map. It also catches
top-to-top and bottom-to-bottom patches, which can be "short circuits" in the
fiction.

- **Expanders.** MCP23017 (I²C, 16 I/O, 8 addresses → up to 128 pins on one
  bus; breakouts ~$3–6, Adafruit #5346 with STEMMA QT).
  - **Gotcha: since datasheet rev D (2022), Microchip says GPA7 and GPB7 on the
    MCP23017 are output-only.** The SPI MCP23S17 keeps them bidirectional.
  - Workaround: use 14 pins per chip for jacks that must be read. If you split
    roles strictly (top row only ever drives, bottom row only ever reads), put
    top-row jacks on the GPx7 pins.
  - Count: 2x24 (48 jacks) = 4× MCP23017 at 14 usable pins each. 2x32
    (64 jacks) = 5×. Scales to 96+ jacks on one bus.
- **Cheaper, faster alternative.** 74HC595 shift registers drive the top row
  and 74HC165s read the bottom row (both fine at 3.3 V; 3+3 chips for 2x24;
  daisy-chained on 3 wires). Put a **1 kΩ series resistor** on every '595
  output, so a top-to-top cable can't short two push-pull outputs together.
  This only sees top-to-bottom patches, which is fine for the puzzle.
- **Scan time.** For MCP23017 at 400 kHz I²C: 48 steps × (1 direction write +
  4 port reads) ≈ 48 × 5 × ~60 µs ≈ 15 ms per full scan. Scan at ~20 Hz.
- **Pull-ups.** The MCP23017's internal ~100 kΩ is fine for runs under ~1 m.
  If wires are long or the room is electrically noisy, add 10 kΩ externals.

**Wiring sketch (2x24, MCP23017):**

```
ESP32 (DevKitC, classic WROOM-32)
  3V3 ─────────────┬───────────── MCP#0..#3 VDD, RESET
  GND ─────────────┼───────────── MCP VSS, A-pins per address, ALL JACK SHELLS
  GPIO21 SDA ──────┼── 4.7k ↑ ─── MCP SDA (all four)
  GPIO22 SCL ──────┴── 4.7k ↑ ─── MCP SCL (all four)
  GPIO23 ── reed switch ── GND        (door, INPUT_PULLUP)
  GPIO18 ── WS2812 ring DIN (via 330 Ω; 5 V ring powered from 5 V rail)
  GPIO19 ── relay module IN  (3.3 V-trigger or opto board)
  GPIO25 ── RC filter ── analog panel meter (0–3 V "core voltage")
  GPIO16/17 ── DFPlayer Mini RX/TX ── 3 W speaker   (siren, click, "grease")
  GPIO4  ── door-handle touch wire (optional)

MCP#0 (0x20): GPA0-6, GPB0-6 → top jacks V01–V14
MCP#1 (0x21): GPA0-6, GPB0-6 → top V15–V24, bottom D01–D04
MCP#2 (0x22): → bottom D05–D18
MCP#3 (0x23): → bottom D19–D24  (spare pins = future "MAIN POWER" switch etc.)
Every jack centre → one MCP pin. Every jack shell → GND.
```

**Bill of materials (patch-bay controller + door):**

| Item | Qty | ~Price |
|---|---|---|
| ESP32-DevKitC (WROOM-32) | 1 (+1 spare) | $8–10 each |
| MCP23017 breakout | 4 (+1) | $3–6 each |
| Hookup wire, ribbon cable, Dupont/JST, perfboard | n/a | $15 |
| Reed switch MC-38 (5 pk) | 1 | $8–10 |
| WS2812B ring (12–16 LED) or 0.5 m strip | 1 | $6–8 |
| 1-ch relay module, 3.3 V-trigger / opto (the "click") | 1–5 | $2–3 each |
| DFPlayer Mini + microSD + 3 W 4 Ω speaker | 1 | ~$8 |
| Analog panel voltmeter 0–5 V (85C1 style) + 2 resistors | 1 | ~$8 |
| 5 V 3 A USB-C supply | 1 | $10 |
| Video patch cords matching the bay | 10–12 | $15–40 each (used: less) |
| Optional: 4x4 keypad, LD2410 mmWave, Aqara contact sensor | n/a | $3 / $5 / $18 |

### B.4 Firmware outline (Arduino + `Adafruit_MCP23X17` + PubSubClient)

Use ESPHome for the door/LED-only nodes. The all-pairs scan is easier to get
right in plain Arduino code.

```
setup: wifi (static IP), mqtt (LWT health/serverroom = "lost", retained;
       publish "online" retained), init MCPs, load SOLUTION from config.

loop @ 20 Hz:
  map = scan_all_pairs()            // set of unordered pairs {i,j}
  if map != candidate: candidate = map; since = now
  elif map != stable and now - since >= 1000 ms:   // "stable for 1 s"
      diff = map Δ stable
      for added pairs: append to insertion_order; click relay; beep
      for removed pairs: drop from insertion_order
      stable = map
      publish_state()               // retained
  door: debounce 50 ms; publish serverroom/door {"open": bool} on change
  sub props/server_room/set → {armed, alarm, unlocked} → ring + siren

publish_state():
  pairs   = [["V07","D19"], ...]                   // labels, not pin numbers
  correct = |pairs ∩ SOLUTION|
  wrong   = |pairs − SOLUTION|
  ordered = insertion_order[:correct] matches SOLUTION order   // if ORDER_MATTERS
  solved  = correct == |SOLUTION| && wrong <= ALLOWED_EXTRA && (ordered || !ORDER_MATTERS)
  publish serverroom/patchbay/state  {pairs, correct, of, wrong, solved}  (retained)
  on edge: publish serverroom/patchbay/event {"event":"progress"|"wrong"|"solved"|"reset"}
  meter: PWM = 3.0 V × (1 − correct/of)   // Trabolta's "core voltage" falls
```

**Making it big while the answer stays small.** A 2x24 bay gives 24 × 24 =
**576 top-to-bottom pairs**; 2x32 gives 1,024. A solution of **5 specific
cables** out of 576 is C(576,5) ≈ 5×10¹¹ unordered combinations. Requiring an
order multiplies that by 120. Nobody brute-forces it, so the clues must carry
it:

- Label the top row with absurd "fixed voltages": `+5V`, `−12V`, `GREASE`,
  `LIGHTNING`, `1.21 GW`, `SANDY`, `88 MPH`…
- Label the bottom row `DAC 00`–`DAC 23`, or with Trabolta's subsystems.
- Make each correct pair a **codex entry** (e.g. *The Second Patch: GREASE →
  DAC 19*), earned by the faction that recruits a majority. The Legendary fact
  gives the order (`Story Overview.md:222`).
- This maps onto the current example's "Three Keys" quest
  (`core/examples/trapped-in-the-internet/README.md:111`). The rewrite can
  turn keys into patches.
- **Two finales, two physical actions** (`Story Overview.md:224-228`):
  - combination A = unplug Trabolta (escape);
  - combination B, or a big **MAIN POWER** toggle switch on a spare MCP pin =
    shut the whole computer down (purgatory).

**Feedback layer:**

- A relay click per correct cable.
- The ring LED steps from red toward green.
- The panel meter needle drops.
- DFPlayer clips: a hum that detunes, a "grease" sputter.
- When solved: all relays chatter, the ring strobes, a siren runs for 2 s, and
  then the house blackout (§C.4) comes from the story, not the device, so a
  rehearsal replays it.
- A wrong cable gives a short buzz. Three wrong cables can raise the alarm in
  the story ("Antivirus alerted").

Stagehand rules:

```yaml
- on: { topic: "serverroom/patchbay/event", when: "event == 'solved'" }
  signal: { name: "the heart unplugged", debounce_s: 30 }
- on: { topic: "serverroom/patchbay/event", when: "event == 'progress'" }
  signal: { name: "a patch took", debounce_s: 1 }
- on: { topic: "serverroom/patchbay/event", when: "event == 'wrong'" }
  signal: { name: "a patch sparked", debounce_s: 1 }
- on: { topic: "serverroom/power", when: "on == false" }
  signal: { name: "the computer turned off", debounce_s: 30 }
```

---

## C. Lights

### C.1 Zigbee2MQTT: Hue + IKEA bulbs

- **Pairing Hue bulbs to Z2M.** A new bulb joins on its own. A bulb already on
  a Hue Bridge needs one of these:
  - remove it in the Hue app; or
  - Touchlink reset; or
  - Z2M's `philips_hue_factory_reset` action with the serial numbers printed
    on the bulbs (`zigbee2mqtt/bridge/request/action`); or
  - power-cycle 5× (off 2 s / on 8 s); or
  - the Hue Bluetooth app.
- **Pairing IKEA bulbs.** Factory reset by toggling power **6×** (short on
  pulses, hold the 6th on). 7 pulses sometimes fails. Pair close to the
  coordinator.
- **One Z2M group per room** ("Desktop", "Hall", "Kitchen", "Mud Room",
  "Server Room", "Tent", plus an "All Lights" group). A group command is
  **one** Zigbee multicast, however many bulbs are in it. Per-bulb commands
  are N unicasts. Z2M's docs say groups "significantly reduce the stress on a
  network".
- **Payloads** (`zigbee2mqtt/<Group>/set`):
  - `{"state":"OFF","transition":0}`
  - `{"state":"ON","brightness":80,"color":{"hex":"#3050FF"},"transition":2}`
- **Transition** is in seconds. IKEA bulbs transition only one attribute per
  command: change colour-temp and brightness together and the CT fade is
  ignored. Always send `"transition":0` for hard cuts. Hue bulbs fade by
  default when no transition is given (that part is engineering judgment).
- **Native effects:** `{"effect":"blink"}` / `"breathe"` / `"okay"` /
  `"channel_change"` / `"colorloop"` / `"finish_effect"` / `"stop_effect"`.
  Hue colour bulbs add `candle`, `fireplace`, `sparkle`, `cosmos`,
  `underwater`, `enchant`, and others, with `effect_speed` 0–1 (model and
  firmware dependent). **One command starts an effect that runs in the bulb.**
  This is how to do "erratic lighting" on Zigbee.
- **Scenes for instant restores.** Build each look once, then
  `{"scene_store":{"ID":1,"name":"Desktop normal"}}` on the group. During the
  show, `{"scene_recall":1}` restores every bulb's own colour with **one**
  command. Set a scene's transition with `scene_add`.
- **Rate limits: don't flood the mesh.** Zigbee routers track broadcasts in a
  small **Broadcast Transaction Table**. A TI engineer describes drops after
  ~9 rapid broadcasts. Rules of thumb (judgment):
  - **≤ 1 group command per second sustained**, short bursts of 2–3 OK;
  - **never** drive a flicker by sending ON/OFF at 5–10 Hz from software;
  - use a native `effect`, or put continuous effects on WLED instead.

  The "Trabolta flickers the lights" power (`cast/trabolta.loom:101-106`) must
  map to **one** `effect` command per room, not a loop.
- **RF coexistence.** Zigbee channel 11 sits on top of Wi-Fi channel 1. Don't
  move an existing Z2M network's channel (it means re-pairing everything).
  Move the **Wi-Fi** instead:
  - Zigbee 11 → put 2.4 GHz Wi-Fi on channel 6 or 11;
  - Zigbee 15 → Wi-Fi 11;
  - Zigbee 20 → Wi-Fi 1;
  - Zigbee 25 → Wi-Fi 1 or 6.
- **Mesh.** Mains bulbs are routers. Battery sensors (door contact) are end
  devices and need a router within range, so leave one bulb or a Zigbee plug
  **always powered** near the server room and the tent. Nobody flips wall
  switches during the party; tape them.

### C.2 PAUTIX RGB COB on ESP32 / WLED

**First, identify which PAUTIX strip you have.** PAUTIX sells both kinds of
COB strip:

- **Analog RGB COB** (12/24 V, **4 pins: V+ R G B**). The whole strip is one
  colour; it is dimmed by PWM through MOSFETs. Typical 24 V 840 LED/m RGB COB
  draws ~12–16 W/m.
- **Addressable "RGBIC" / "SRGB" COB**, e.g. the PAUTIX SRGB630F012W24-COB.
  **3 pins: V+ DATA GND**, usually WS2811-type ICs per segment at 24 V. Needs
  a digital WLED controller.

Check the pin labels at the strip end: 4 pins means analog, 3 means
addressable.

**Analog controllers that run WLED:**

| Controller | Notes | ~Price |
|---|---|---|
| **QuinLED An-Penta-Plus / An-Penta-Mini** | ESP32, proper 12 V gate drivers (high PWM frequency, no visible flicker on camera), internally fused outputs, 12–48 V. An-Penta-Plus: 5 high-power analog channels + 1 digital, up to 10 A per channel / 30 A total, Ethernet. Mini: ESP32-C3, 3 analog channels in WLED. Best build quality | check quinled.info |
| **Gledopto GL-C-211WL** | ESP32, WLED preinstalled, analog only, 12–24 V, 10 A per channel / 15 A total | ~€14–24 |
| **Athom WLED analog controller** | WLED preinstalled, 5–24 V, 16 A total. Measured ~900 Hz PWM (some banding on phone video, invisible to eyes) | ~$20 |

**Addressable controllers:** QuinLED Dig-Uno / Dig-Quad (level-shifted,
fused), Gledopto GL-C-015WL-D, or an Athom WLED ESP32 board.

**Analog limitation:** a 4-pin strip in WLED is **one pixel**. Time-based
effects work: Breathe, Strobe, Lightning, Candle, Fade, Colorloop. Chases do
not. "Lines that lead you to specific places" and a moving **Tube** need the
addressable kind, or several analog runs on separate channels.

**Power and safety:**

- **Supply:** 24 V, sized at ~1.25× load. 5 m × ~14 W/m ≈ 70 W ≈ 3 A at 24 V,
  so a Mean Well LRS-100-24 (4.5 A, ~$20–25) per 5 m run, or an LRS-150-24
  (6.5 A) for two runs.
- **Injection:** at 24 V a single 5 m run fed from one end is fine. For 10 m,
  inject at both ends.
- **Fuses:** an **inline fuse per run** at ~1.25× its current (e.g. 5 A blade).
  QuinLED boards fuse internally.
- **Wire:** 18 AWG for ≤ 3 A short runs.
- **Mounting:** keep PSUs off carpet and out of the tent. Use aluminium
  channel if the strips run for hours (COB runs warm).

**WLED MQTT API:**

| Topic | Payload |
|---|---|
| `[deviceTopic]` | `ON` / `OFF` / `T` / `0–255` |
| `[deviceTopic]/col` | `#RRGGBB` |
| `[deviceTopic]/api` | HTTP-API or **JSON-API** syntax, e.g. `{"ps":3}` (apply preset 3) or `{"on":false,"tt":0}` |
| **Group topic** (set in Sync settings, e.g. `wled/all`) | Commands every WLED node at once |
| `[deviceTopic]/g`, `/c` | Published status |

Also, from WLED convention, an online/offline `/status` LWT. Feed it to the
tech rail.

`tt` is a one-call transition in 100 ms units. A WLED **playlist** can run a
timed sequence on the device itself, e.g. *off for 10 s, then preset 5*.

**Show presets** (save on each node, same IDs everywhere):

1. Idle / screensaver blue
2. Tube chase (addressable only)
3. Glitch: strobe + lightning
4. Alarm: red strobe
5. Restore-after-blackout
6. Rave (finale)
7. Desktop "Trust Chart" white

Set **PWM frequency** in LED Preferences as high as the board supports.

### C.3 Mapping story cues to the lights (today's stagehand)

The example's power emits `<cue: lights, room: {room}, state: off>`
(`cast/trabolta.loom:101-102`). The sample routing publishes to
`house/lights/{room}/set` (`stagehand/show.example.yaml:43-45`). **Z2M doesn't
listen there.** Write explicit rules instead. Each rule is evaluated
independently, so several rules matching the same cue fan out to both systems
(`stagehand/src/stagehand/show/cuemap.py:210-237`). Fixed payloads are
supported (`cuemap.py:182-207`).

```yaml
cues:
  - on: { directive: cue }
    match: { target: lights, state: "off" }
    mqtt: { topic: "zigbee2mqtt/{room}/set", payload: { state: "OFF", transition: 0 } }
  - on: { directive: cue }
    match: { target: lights, scene: glitch }
    mqtt: { topic: "zigbee2mqtt/{room}/set", payload: { effect: "breathe" } }
  - on: { directive: cue }
    match: { target: lights, scene: glitch }
    mqtt: { topic: "wled/all/api", payload: { ps: 3 } }
```

Zigbee group names must equal the story's LOCATION names, or the rules need a
lookup.

### C.4 The ten-second blackout (both systems at once)

Story → stagehand → **three** MQTT publishes fired in the same tick:

1. `zigbee2mqtt/All Lights/set {"state":"OFF","transition":0}` (one multicast)
2. `wled/all/api {"on":false,"tt":0}`
3. The screens (terminals + TV) must go black too. That is software, see the
   gap list.

**Latency (judgment):** WLED over LAN MQTT ≈ 20–80 ms. A Z2M group multicast ≈
100–300 ms. Screens via the mod SSE ≈ 100–500 ms. The whole house is dark in
well under half a second, which reads as "instant".

**Restore after 10 s:** `zigbee2mqtt/All Lights/set {"scene_recall": <finale>}`
plus `wled/all/api {"ps":5}`. Stagehand has no delay on MQTT cues (`t_exec`
exists only for OSC, `cuemap.py:44-58`). Either:

- the story fires the restore cue 10 s later (time triggers exist,
  `core/src/runtime/sim/model.ts:28-31`; whether a mid-beat `wait 10s`
  executes in `Sim` needs checking); or
- add `delay_ms` to stagehand MQTT cues; or
- (WLED only) run a playlist "blackout 10 s, then preset 5".

**Recommendation:** add `delay_ms` to stagehand. It's tiny, deterministic, and
covers Zigbee too. DMX / E1.31 not needed.

---

## D. Everything else for the night

### D.1 Network

- **One dedicated router/AP for the show**, separate from the house Wi-Fi.
  Example: GL.iNet GL-MT3000 Beryl AX (~$80–90), plus a mesh node if the house
  is large.
- **A 2.4 GHz-only SSID** for ESP32s, WLED and the tablets: WPA2, no band
  steering, no WPA3-only (ESP32s and old phones choke). Fix the channel per
  §C.1. Put guests on a separate SSID, or on their own cellular data: the
  server is public.
- **DHCP reservations or static IPs** for: the show laptop (Mosquitto, Ollama,
  Kokoro, stagehand), the Z2M host, every ESP32/WLED, every terminal tablet,
  the TV box. Write them into a one-page **IP sheet** taped inside the server
  room.
- **Mosquitto on the house Mac** (as built): `brew install mosquitto`, an
  anonymous listener on `127.0.0.1:1883` for what runs on the Mac
  (stagehand, Z2M, the alexa player) and a password-only LAN listener on
  `:1884` (user `props`) for the WLED controllers and the ESP32
  (`scripts/house-mac/audio.md` → *Lock down the broker*). One broker only.
- **Where the server runs.** If the event server is on the VPS (real domain,
  real TLS), every house device depends on the home uplink. Bring a **phone
  hotspot / LTE router as backup WAN**. Mosquitto, stagehand, Z2M and the
  lights are LAN-local and keep working through an internet drop. The
  story-driven cues don't, because stagehand reads the story from the server.
- **HTTPS matters for the terminals.** Camera access (`getUserMedia`) and the
  Wake Lock API need a secure context. The public domain gives that for free.
  A LAN-only server needs Caddy with a trusted cert, or the terminals fall
  back to typed names (`README.md:137`).

### D.2 Wall terminals and the TV

**Tablets.** Amazon Fire HD 8 (~$55 on sale, ~$100 list) or donated old
Android phones and tablets. Fire 7-class hardware will struggle with the
three.js world view; use the Fire HD 8 or better. Avoid iPads for kiosk
duty: Guided Access works, but there are no MQTT/REST hooks.

**Kiosk browser: Fully Kiosk Browser PLUS**, €8.90 / $10.99 per device, one
time, with a free trial. It gives you:

- autostart on boot, keep screen on, motion wake;
- camera access for the web view;
- PIN-locked exit;
- **REST API + MQTT** (remote reload, screen on/off, so the blackout could
  also blank screens at the OS level);
- QR provisioning.

It runs on Fire OS (sideload the APK).

**Mounting and power:** removable adhesive tablet mounts or 3D-printed
brackets, a 2–3 m USB cable, and a 20 W charger per tablet. For a one-night
show, charging nonstop is fine. Disable OS sleep and set brightness to taste;
the Mud Room screen should be dim.

**The TV above the fireplace** (mirror view, slides, ads, songs) needs a real
browser box. Choose **Raspberry Pi 5** (Chromium kiosk, ~$70–90 with
PSU/case) or an old laptop on HDMI. A Fire TV stick + Fully Kiosk is
possible, but WebGL is weak. The TV box also gives you **HDMI audio** to the
TV or soundbar for the dance song.

**The tent:** the reinstall tablet, 2× Quest 3, and a lit **EXIT** sign
(battery LED exit sign ~$20). Bring charging leads plus a power strip for the
headsets (Quest 3 runs ~2 h on battery), disposable face covers and wipes.

### D.3 Audio

- **Living room:** the TV box or the show laptop feeds a **powered speaker**
  (anything from a $100 party speaker to an Alto TS408-class PA) over a 3.5 mm
  or USB DAC. It plays the dance song after the blackout, the two versions of
  "You're the One That I Want", Trabolta's vocoder voice, and the
  "Go to the living room" sting.
- **Room announcements:** the wall terminals already speak (`/api/mod/tts` →
  Kokoro, `README.md:137`). "The Alexa will let you know when it's time"
  (`Story Overview.md:47`) can be a terminal voice. No per-room speakers
  needed.
- **Optional:** ESP32 + MAX98357 I²S amp (~$6) for local one-shot sounds
  (`docs/loom-show-control.md:299`), or Snapcast on a Pi for synced
  multi-room music.
- **Server room:** the DFPlayer on the patch-bay ESP32 is enough.

### D.4 Props

- **Printer full of beans.**
  - **Simple:** a dead inkjet. Pull the cartridges and paper path, fill the
    cavity with dried beans (loose for the spill gag, or bagged for cleanup),
    and leave the lid closed but unlatched.
  - **Fun:** hide an ESP32 + DFPlayer inside. Its "Start" button (wired to a
    GPIO) plays grinding and error beeps, blinks an LED, and publishes
    `props/printer/pressed`. A stagehand rule sends the signal
    `printer pressed`, so Clippy's beans speech has a story beat behind it.
  - ~$15 for the electronics if you already have a dead printer.
- **Truth Pong.** Folding table, 10–15 cups, balls, a tarp (it's outside,
  `Story Overview.md:169`), and outdoor lighting (one Zigbee or WLED flood on
  the patio so the mood follows the house). Scoring stays human: a performer
  or mod fires *made / missed* from the app. Cup sensors aren't worth it.
- **Bobbing for Truth.** A tub, towels, a floor mat or tarp, and the Bag of
  Truth (a waterproof zip bag in a cloth bag) holding a **laminated**
  truth.txt. Keep every mains cable and PSU out of splash range.
- **Printed matter:**
  - Bingo cards (asterisk layout, checkboxes only, `Story Overview.md:73`);
  - the codex QR posters (`README.md:132`, from `POST /api/mod/codes`);
  - the scavenger-hunt "files" around the house;
  - patch-bay labels;
  - the IP sheet.

---

## E. Hardware and integration checklist

**Server room**

- [ ] Identify the patch bay (rows × columns, jack type) and bench-test
  normals and 75 Ω termination
- [ ] De-normal / de-terminate it (or swap modules, or use it as a façade)
- [ ] Wire 48–64 jacks to MCP23017s, skipping GPx7 for read-pins (or use the
  595/165 chain)
- [ ] Patch-bay firmware (all-pairs scan, stable 1 s, order, MQTT state/event
  retained, LWT)
- [ ] Feedback: relay click, ring LED, panel meter, DFPlayer sounds
- [ ] MAIN POWER toggle for the "turn off the computer" finale
- [ ] Door reed on the same ESP32, plus an Aqara/Sonoff contact as fallback on
  Z2M
- [ ] Locked/unlocked indicator over the door, from the retained
  `props/server_room/set`
- [ ] Optional: handle-touch, LD2410 presence, disarm keypad
- [ ] A Zigbee router (always-on bulb or plug) near the room

**Lights**

- [ ] Pair every Hue/IKEA bulb to Z2M. Make room groups plus "All Lights"
  named after the LOCATIONs. `scene_store` each look
- [ ] Identify the PAUTIX strip (4-pin analog vs 3-pin addressable) and buy the
  matching WLED controller
- [ ] 24 V supplies sized ×1.25, an inline fuse per run, injection on long
  runs
- [ ] WLED: MQTT on, shared group topic `wled/all`, identical preset IDs on
  every node
- [ ] Set the Wi-Fi channel away from the Zigbee channel
- [ ] Rehearse the blackout: both systems dark < 0.5 s, restore at +10 s

**Screens and audio**

- [ ] N tablets with Fully Kiosk PLUS, provisioned with `/terminal/?…`
  URLs, mounted and powered
- [ ] Pi 5 (or laptop) for the living-room TV, plus HDMI audio or a powered
  speaker
- [ ] Tent: tablet, 2× Quest 3, chargers, EXIT sign, face covers

**Network**

- [ ] Show router, 2.4 GHz IoT SSID, DHCP reservations, IP sheet, LTE backup
  WAN
- [ ] One Mosquitto broker. Z2M, stagehand and every ESP32 point at it

**Props**

- [ ] Bean printer (optionally wired), Truth Pong kit + patio light, bobbing
  tub + laminated truth.txt, printed cards and QR posters

### Software gaps the hardware exposes (for the software checklist)

1. **Stagehand sensor actions can't pass `args`.** The server accepts them
   (`core/server/event-runtime.ts:2745-2748`). Stagehand drops them
   (`stagehand/src/stagehand/show/sensormap.py:52-56`,
   `stagehand/src/stagehand/modapi.py:118-119`).
2. **No delay on stagehand MQTT cues** (`t_exec` is OSC-only,
   `cuemap.py:44-58`). The 10 s blackout restore needs one, or a confirmed
   story-side wait.
3. **The sample light routing doesn't match Z2M topics**
   (`show.example.yaml:43-45` → `house/lights/{room}/set`). Write a
   party-specific `show` YAML with Z2M + WLED rules.
4. **The terminal app has no signage/media mode.**
   - `terminal/src/` holds `face/`, `world/`, `speech/` and the scanner, with
     no video playback.
   - The story needs ads, the ad hijack (`Story Overview.md:153`), the
     instructional video in the tent (`:103`), the Windows screensaver on the
     TV (`:53`), "Monitor prompts" V1–V6 (`:61-127`), the Trust Chart
     (`:178`), and a black screen during the blackout plus the flashing
     "Go to the living room" (`:226`).
   - Add a cue-driven `view: signage`/`blackout` (playlist + full-screen
     notice) that listens to the mod feed it already holds. Or, cheaper: run
     Fully Video Kiosk on dedicated "ad" tablets.
5. **"Flicker" must stay one command per room.** Trabolta's
   `flicker the screens` / `cut the lights` powers
   (`cast/trabolta.loom:101-106`) currently target OSC/TouchDesigner
   (`show.example.yaml:46-49`). TouchDesigner isn't part of this party's
   design, so re-target them to WLED presets and Z2M `effect` commands.
6. **The house map has no server room.** The current `house.json` rooms (Mud
   Room, Hall, Desktop TV, Kitchen, Bathroom, Rec Room, Tent) are a
   placeholder. The server room ("cold storage") and its terminal/indicator
   spots need adding once the house is measured.
7. **Health rail:** every ESP32, WLED `/status` and Z2M `availability` should
   feed the Run-mode tech rail (`docs/loom-show-control.md:184`, LWT
   convention).

### Sources

- Zigbee2MQTT device pages: [Aqara MCCGQ11LM](https://www.zigbee2mqtt.io/devices/MCCGQ11LM.html), [IKEA E2013 PARASOLL](https://www.zigbee2mqtt.io/devices/E2013.html), [Sonoff SNZB-04](https://www.zigbee2mqtt.io/devices/SNZB-04.html), [Sonoff SNZB-04P](https://www.zigbee2mqtt.io/devices/SNZB-04P.html), [Hue 9290022166 (effects, reset)](https://www.zigbee2mqtt.io/devices/9290022166.html), [IKEA LED1924G9](https://www.zigbee2mqtt.io/devices/LED1924G9.html)
- Zigbee2MQTT guides: [MQTT topics](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html), [scenes](https://www.zigbee2mqtt.io/guide/usage/scenes.html), [groups](https://www.zigbee2mqtt.io/guide/usage/groups.html)
- Zigbee broadcast limits: [TI forum, broadcast table drops](https://e2e.ti.com/support/wireless-connectivity/zigbee-thread-group/zigbee-and-thread/f/zigbee-thread-forum/316404/timing-issues-in-multicast-and-broadcast), [Zigbee broadcast intro](https://github.com/Jim-tech/IoT-Developer-Boot-Camp/wiki/Introduction-of-Zigbee-Broadcast)
- WLED: [MQTT](https://kno.wled.ge/interfaces/mqtt/), [JSON API](https://kno.wled.ge/interfaces/json-api/)
- WLED-capable controllers: [QuinLED An-Penta](https://quinled.info/quinled-an-penta/), [An-Penta-Plus](https://quinled.info/quinled-an-penta-plus/), [Gledopto GL-C-211WL](https://www.linkshop.gr/smarthome/gledopto-gl-c-211wl-smart-wi-fi-pwm-wled-controller-for-analogue-rgb-rgbw-rgbcct-cct-single-color-led-strips.html?sl=en), [analog controller review (Athom/Gledopto PWM)](https://www.thesmarthomehookup.com/a-zero-flicker-local-control-analog-led-strip-controller/)
- PAUTIX: [44-key controller listing (4-pin COB RGB, 12/24 V, 3 A)](https://mooremuseum.ca/products/pautix-rgb-led-strip-light-wireless-smart-controller-44-key/213648830/), [SRGB630F012W24-COB (addressable)](https://manuals.plus/su/asin/B0BN5N3R82); typical 24 V RGB COB power: [Cutter AGRCOB 12 W/m](https://www.cutter.com.au/product/agrcob-24-840-20-rgb/), [Expert4House 15 W/m](https://www.expert4house.com/en/smart-home/lighting/led-strips/840-leds-per-meter-rgb-cob-led-strip-dc24v-5-meters)
- Patch bays: [Canare 24DV](https://www.markertek.com/product/24dv/canare-24dv-2x24-1ru-75-ohm-digital-video-patch-bay-normal-through), [Switchcraft VPP 2x26](https://www.adorama.com/switchcraft-vpp-2ru-2-x-26-weco-3ghz-video-patchbay/p/swvp263hd75t), [Bittree 2x32](https://www.markertek.com/product/bit-b64t-2mwthd/bittree-b64t-2mwthd-2x32-2ru-video-patchbay-mini-weco)
- MCP23017 GPA7/GPB7 output-only: [best-microcontroller-projects](https://best-microcontroller-projects.com/mcp23017.html), [wolles-elektronikkiste](https://wolles-elektronikkiste.de/en/wp-json/wp/v2/posts/9177)
- [Fully Kiosk Browser (pricing, features)](https://www.fully-kiosk.com/)
- Sensor prices: [smarthomecompared (Aqara)](https://smarthomecompared.com/door-window-sensors/aqara-door-and-window-sensor), [SNZB-04 vs 04P](https://smarthomecompared.com/door-window-sensors/sonoff-snzb-04-zigbee-wireless-door-window-sensor-vs-sonoff-snzb-04p-zigbee-door-window-sensor)
