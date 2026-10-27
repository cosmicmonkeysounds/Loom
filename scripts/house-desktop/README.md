# John's Desktop (Windows): the house PC

The house rig used to be one "house Mac". For Oct 31 it is split across two
machines. This folder is the Windows half, and since 2026-10-27 it is the
**sound and lights machine**: the MOTU 828x and its ADAT expander (the
speaker router), the Zigbee lights (Philips Hue and ThirdReality ZL1 bulbs
on the CC2652P stick), the WLED LED strip, the house broker and the TV. It
covers what runs here, how to set it up once, how to start it on show
night, and what to do when something breaks.

The MacBook keeps **Trabolta** (Ollama + stagehand `agents`), the
director's Run console and `ship` / `sync-show` / `showbackup`; its
runbooks are in [`scripts/house-macbook/`](../house-macbook/) (start with
its `trabolta.md`). The MacBook can still run the speaker router as the
**fallback** if the 828x misbehaves on Windows (§11).

Stagehand itself (the modules, the config files, `extends:`, the CLI) is
described in [`stagehand/README.md`](../../stagehand/README.md); the show's
cross-machine diagnostics (`pnpm showctl …`) in
[`scripts/show/README.md`](../show/README.md); the whole rig in
`core/examples/trapped-in-the-internet/TECH.md`.

| Machine | Runs |
|---|---|
| **John's Desktop** (Windows, this folder) | the **sound**: stagehand **`audio`** (the router) on the **MOTU 828x** + the ADAT expander over USB 2, through ASIO · the **lights**: **Zigbee2MQTT** on the CC2652P stick (`COMn`) with the Hue and ZL1 bulbs, the **WLED** strip on its ESP32 controller (Wi-Fi), stagehand **`lights`** (`lights.json`) · stagehand **`show`** (the story's cues to Z2M / WLED / MQTT, the sensors back, the `do announce` relay) · **Mosquitto**, the house broker (anonymous `127.0.0.1:1883`, password-only `props` on the LAN at `:1884`) · the **TV**: Chrome kiosk over HDMI, spot `desktop-tv` |
| **John's MacBook** (macOS) | **Trabolta**: Ollama `gpt-oss:20b` + stagehand `agents` (`stagehand/laptop.yaml`) · a director's Run console · `scripts/ops/` · the router only as the fallback (`stagehand/trapped.macbook.yaml`) |
| Steph's laptop | the server-room terminal (Chrome) + the Grand Central M4 on USB |
| John's old laptop | the tent: `/terminal/?…&spot=tent&announce=1` |

**Announcements stay on this PC.** A story `do announce "…"` reaches the
speakers as: the server → this PC's `show` job → MQTT `show/announce` on
this PC's Mosquitto (loopback) → the router (here) → the speakers. With
this PC's broker or `show` job down, nothing is spoken (only the tent's
`&announce=1` terminal still says them). `sound X` does not take this path:
the router reads the server's feed itself.

Everything below runs in **Windows PowerShell 5.1** (the one Windows ships;
no pwsh 7 needed). Run the scripts from this folder. If Windows refuses to
run them, once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**The order, first time:** §1 install → §2 broker → §3 the 828x → §4
Zigbee2MQTT → §5 the bulbs → §6 the WLED strip → §7 stagehand (`show`,
`lights`, `audio`) → §8 place and test everything on the map and in Run →
House → §9 the TV. Show night is §10.

## 1. Install (once)

```powershell
winget install Git.Git OpenJS.NodeJS.LTS EclipseFoundation.Mosquitto Google.Chrome
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"   # uv (stagehand's Python)
```

Open a new PowerShell (so `uv`, `node` and `git` are on PATH), then clone the
repo somewhere without spaces, e.g. `C:\loom`:

```powershell
git config --global core.autocrlf input
git clone <the repo> C:\loom
cd C:\loom\stagehand
uv sync          # fetches Python 3.11+ and every dependency (wheels only, no compiler)
```

No `pnpm install` is needed on this PC: stagehand reads the show's
`audio.json`, `house.json` and `lights.json` straight from the checkout
(`core/examples/trapped-in-the-internet/`). Node is for Zigbee2MQTT and the
show's `showctl` diagnostics.

**The machine itself**:

- **A fixed address.** Move the router's DHCP reservation **192.168.8.10**
  (the old house Mac's) to this PC: every WLED controller dials it (§6), and
  so does the MacBook in the router fallback (§11).
- **Sign in by itself after a power cut**, or no job comes back:
  [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)
  (or `netplwiz`). The router needs the signed-in session: ASIO drivers
  are unreliable from a service.
- **Never sleep**: `.\preflight.ps1 -FixPower` (sleep, screen off, hibernate
  never on AC). No screen saver. Also Device Manager → *Universal Serial
  Bus controllers* → each *USB Root Hub* → Power Management → untick
  *Allow the computer to turn off this device* (the MOTU and the Zigbee
  stick are both USB).
- **Windows Update → Pause updates** past Nov 1, and set active hours.
- **Do not disturb on** (Settings → System → Notifications), **system sounds
  off** (Sound → More sound settings → Sounds → *No Sounds*).
- **Windows' default playback device stays the TV (HDMI)**, never the MOTU:
  Chrome, a notification or the director's console must never land on the
  828x's Analog 1–2 (the living-room speakers). The router opens the MOTU
  itself, through ASIO, whatever the default is.

## 2. Mosquitto (the house broker)

From an **elevated** PowerShell (Run as administrator):

```powershell
.\setup-mosquitto.ps1              # asks for the props password (twice)
.\setup-mosquitto.ps1 -SetPrivate  # also mark the house network Private, if it was Public
.\setup-mosquitto.ps1 -Check       # any time, no admin needed
```

It writes `mosquitto.conf` (this folder's template) into
`C:\Program Files\mosquitto\`, where the Windows service reads it (the
installer's original is kept as `mosquitto.conf.orig`), makes the password
file `C:\ProgramData\mosquitto\passwd` (user `props`), sets the service to
Automatic, restarts it, and opens **TCP 1884 only** on the Private / Domain
firewall profiles. `1883` never leaves this PC: `-Check` fails if it answers
on the LAN address.

Everything on this PC (`show`, `lights`, `audio`, Zigbee2MQTT) uses the
anonymous loopback `1883`. The props password goes only into what dials in
from the LAN: each WLED controller (§6) and, in the fallback, the MacBook's
`stagehand/trapped.macbook.local.yaml`. Never into a tracked file, a doc or
a chat.

## 3. The MOTU 828x (the sound)

The 828x (Thunderbolt **and** USB 2.0; MOTU's "28x30") plus an 8-channel
ADAT expander on its optical port drive every house speaker. On Windows
use the **USB 2.0** port with the USB cable that came in the box: MOTU
markets the 828x as working with "any Mac or PC with either Thunderbolt or
high-speed USB 2.0", but its Thunderbolt port is Thunderbolt 1/2, and
whether it works through a TB3/TB4 adapter on this PC under Windows is
**unverified** — don't try it on show week.

**Prove this section first, before anything else on the sound side.** If
the 828x can't be made to work here by the end of the day, put the router
on the MacBook (§11) and move on.

### 3.1 The driver

1. Download **MOTU Audio Installer (PC)** from the 828x's downloads page,
   <https://motu.com/en-us/download/product/303/> (on 2026-10-27 that page
   lists v92178, 2022-09-28, for Windows 11 / Windows 10 64-bit; an
   earlier v89606 names the 828x among its devices). The same page has the
   **828x Firmware (PC) v1.07** and the **828x User Guide for Windows**.
2. Install it with the 828x **unplugged**, reboot, then plug the 828x into a
   USB port on the PC itself (not a hub), and power it on. Windows should
   find it; Device Manager lists it under *Sound, video and game
   controllers*.
3. The installer adds MOTU's control software (the **MOTU Audio Console** —
   where the sample rate, clock source and optical formats are set — and
   **CueMix FX**, the hardware mixer). MOTU's clock tech note:
   <https://motu.com/techsupport/technotes/clock>. The exact Windows menu
   names for the 828x's optical settings are **unverified** here; the
   settings below are what matter, wherever the console puts them.
4. If the firmware is older than 1.07, update it with the PC firmware
   updater from the same page (only with nothing else using the 828x).

### 3.2 The settings (the same as on the Mac)

- **48 kHz**, clock source **Internal** on the 828x.
- **Optical A = ADAT** in and out (the expander). Set the **expander's**
  clock to **ADAT / external optical**, so the 828x is the master and the
  expander follows it. Its lock / sync LED must be steady; a blinking
  lock means a clock fight (clicks, dropouts).
- **Optical B** = ADAT (or leave it). Never TOSLink on Optical A, never
  88.2 / 96 kHz: either halves the ADAT channels and moves every channel
  number after it.
- **Main outs and Phones NOT mirrored.**
- Live mics are mixed in **CueMix FX** (hardware, no latency): the router
  opens an output-only stream (`passthrough: false`) and CueMix sums the
  computer's playback with its mix on each output.

**Our channel numbers are the 828x's own** (no channel map): outputs
Analog 1–8, Main 9–10, **ADAT A 15–22** (the expander); inputs Mic/Gtr
1–2, Analog 3–10, **ADAT A 17–24**. Phones 11–12 and S/PDIF 13–14 are left
unlabelled.

### 3.3 Prove it: one ASIO device, 32 in / 30 out

```powershell
cd C:\loom\stagehand
$env:SD_ENABLE_ASIO = '1'; uv run python -m sounddevice
```

There must be **one line with `ASIO`** for the MOTU, e.g. `… MOTU …, ASIO
(32 in, 30 out)`. Under any other host API (MME, DirectSound, WASAPI) the
828x shows up as a row of stereo pairs the router can't use: that is
expected, ignore those lines. The ASIO line's name is set by MOTU's driver
and may not contain `828x` (older MOTU Windows drivers called their ASIO
device "MOTU Pro Audio"; **unverified** for v92178). Put a unique part of
that ASIO name in `C:\loom\stagehand\trapped.desktop.local.yaml`
(git-ignored):

```yaml
server: {}
audio: { device: "<part of the MOTU's ASIO name>" }
```

(`server: {}` must be there: a `.local.yaml` with no `server:` mapping
fails to load. The real event id and passcode come from
`trapped.house.local.yaml`, §7.)

**The counts must be 32 in / 30 out**, `audio.json`'s `device.expect`
(the show uses 24 in / 22 out of them). `stagehand check --only audio`
(§7) fails, and the router logs `LAYOUT MOVED`, when they differ. Other
counts mean the clock, the sample rate, mirroring or an optical port's
format is wrong (§3.2): fix the 828x, never the file. If MOTU's ASIO
driver reports other counts with every setting right, stop and tell the
director before touching `audio.json` (every speaker's channel would need
re-checking).

`trapped.desktop.yaml` already sets `host_api: asio` (which also sets
`SD_ENABLE_ASIO` before sounddevice loads) and the Windows voice
(`voice_engine: auto` → SAPI, `say_voice: Microsoft Zira Desktop`; a missing
voice falls back to the installed female one).

### 3.4 The sound files

The router plays `stagehand\media\sounds\<name>.wav` (or `.aiff` / `.aif`
/ `.flac`) for every story `sound <name>`. The folder is git-ignored (the
real tracks include copyrighted songs). `stagehand\media\sounds.yaml`
(tracked) lists the 19 story sounds and what each real file should be.

```powershell
cd C:\loom\stagehand
uv run stagehand sounds placeholders --config trapped.desktop.yaml
```

writes a labelled placeholder per story sound (a distinct tone, then
"Placeholder. printer grind." in the SAPI voice). Then **copy the real
files in** as they arrive, named exactly after the sound
(`dance_song.wav`, …; 48 kHz is best, others are resampled): a real file
always wins over a placeholder, and the generator never touches a real
file. If the files were collected on the MacBook, copy its whole
`stagehand/media/sounds/` folder over (a USB stick, or a share). `stagehand
check --only audio` lists every placeholder still left: none on the night.

## 4. Zigbee2MQTT on the CC2652P

The coordinator is the **Zigbee 3.0 USB dongle, TI CC2652P + CP2102N, 20
dBm, Z-Stack 3.x.0 preloaded**: no flashing needed. Put it on a **USB 2.0
extension cable**, away from USB 3 ports, the MOTU's cable and the Wi-Fi
router. Windows Update usually installs the CP210x driver; if Device
Manager shows it under *Other devices*, install Silicon Labs' CP210x VCP
driver.

```powershell
git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git C:\zigbee2mqtt
cd C:\zigbee2mqtt; corepack enable; pnpm install --frozen-lockfile; pnpm run build
cd C:\loom\scripts\house-desktop
.\zigbee2mqtt.ps1 -Ports                      # e.g. COM5  Silicon Labs CP210x USB to UART Bridge (COM5)
.\zigbee2mqtt.ps1 -WriteConfig -Port COM5     # FIRST install only
.\zigbee2mqtt.ps1 -Start                      # once by hand: "Zigbee2MQTT started!", then Ctrl+C
.\zigbee2mqtt.ps1 -InstallTask                # elevated: \Loom\zigbee2mqtt, at boot, no window
.\zigbee2mqtt.ps1 -Check
```

**If Z2M already ran on the Mac with paired bulbs, copy its whole `data\`
folder to `C:\zigbee2mqtt\data\` instead of `-WriteConfig`** and change only
`serial.port` to `COMn`: the keys in it *are* the network, and new ones mean
re-pairing every bulb. `-WriteConfig` never overwrites an existing config.
The config (`zigbee2mqtt-configuration.example.yaml` here) puts the network
on **channel 25** (pick 15, 20 or 25, whichever is furthest from the house
Wi-Fi's 2.4 GHz channel, and never change it after the first bulb pairs),
the frontend on **http://localhost:8080**, and `availability` on (a bulb
on a dead wall switch shows offline).

The background and the macOS install are in
[`scripts/house-macbook/zigbee.md`](../house-macbook/zigbee.md); on this PC
`mosquitto_pub` / `mosquitto_sub` are
`"C:\Program Files\mosquitto\mosquitto_pub.exe"` / `…_sub.exe` (`&` in front
when you type the quoted path in PowerShell).

## 5. The Zigbee bulbs: Philips Hue and ThirdReality ZL1

Every bulb joins **Zigbee2MQTT directly**: no Hue Bridge, no ThirdReality
hub. Both kinds are mains-powered Zigbee *routers*, so each one placed
extends the mesh (the basement's server-room bulb is reached through them).
Pair the bulbs nearest the stick first, then outwards.

**Before pairing: the `lights` job must run** (§7, or at least
`.\start-stagehand.ps1 -NoAudio` until the 828x is done), because every
*Pair* button goes through it.

### 5.1 Open joining

Any of these opens joining for a couple of minutes (it closes by itself):

- Run → House → **Setup** pane → 💡 Lights → **🔗 Pair a bulb**;
- the map editor (`/reinstall/map`, or Run → House map → 🗺) → **💡
  Lights** tab → **📡 Pair new device**;
- the Z2M frontend (http://localhost:8080) → *Permit join (All)*;
- `uv run stagehand lights pair --seconds 120 --config trapped.desktop.yaml`.

Then reset the bulb (below). It shows up in the Z2M frontend as `0x…`,
*interviewing*, then *successful*; the map editor lists it under Devices
marked ★ new.

### 5.2 Philips Hue bulbs

A Hue bulb **can't be reset by flicking its switch on and off** (that
works for IKEA, ThirdReality and most others, not Hue). Use one of these:

- **Still on a Hue Bridge?** Delete it in the Hue app **while it is still
  on the bridge**: that factory-resets it. Then power-cycle it once with
  joining open.
- **Touchlink from Zigbee2MQTT** (the CC2652P is a TI adapter, which Z2M's
  touchlink fully supports): hold the bulb **within about 10 cm of the
  stick**, freshly powered on, with **every other untargeted bulb off**
  (a touchlink reset takes the first device it finds). Z2M frontend →
  **Touchlink** → *Scan*, then *Factory reset* on the bulb. Or by MQTT:

  ```powershell
  & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t zigbee2mqtt/bridge/request/touchlink/factory_reset -m '{}'
  ```

  An empty request resets the first touchlink device it finds. A scan
  stops all Zigbee traffic for up to a minute (never during the show).
- **By the serial number printed on the bulb** (no scan, any distance in
  range): Z2M frontend → **Touchlink** → **Philips Hue reset**, or the
  `philips_hue_factory_reset` action on `zigbee2mqtt/bridge/request/action`
  with the bulb's `serial_numbers` (see Z2M's Hue device pages for the
  payload).
- **A Hue Dimmer Switch** (one that was never paired to anything else):
  power-cycle the bulb, hold the dimmer right next to it, press **I/On and
  0/Off together for 10–12 s** until the bulb flashes a few times, keep
  holding one more second, then switch the bulb off and on: it pairs.
- **The Hue app over Bluetooth** (Bluetooth bulbs only, and only for a
  couple of minutes after the bulb is powered on): the app's light
  settings can factory-reset it. Z2M's docs name the standalone *Hue
  Bluetooth* app; whether today's Hue app still offers the reset without a
  bridge is **unverified**.

If a reset fails, power-cycle the bulb and try again straight away (Hue
bulbs turn touchlink off a few minutes after power-on).

### 5.3 ThirdReality Smart Color Bulb ZL1

Z2M supports it as **3RCB01057Z** (colour xy, colour temperature 142–454
mireds, brightness, `power_on_behavior`, effects `blink` / `breathe` /
`colorloop`). A new ZL1 joins on its own when joining is open and it is
powered on. To reset one that was paired elsewhere, **power-cycle it at
its switch until it blinks** (then it is in pairing mode). Reports differ
on the timing: rapid on/off **5–6 times** (ThirdReality's community forum),
or **5 s on, 5 s off, 5 times** (a Home Assistant guide). ThirdReality's
own manual was not reachable to confirm: try the rapid one first. Keep it
within 2–3 m of the stick for the first join.

ZL1 bulbs have been reported to keep hidden touchlink group bindings that
make them answer another group's commands; the only fix reported is the
power-cycle reset and re-pairing. If a ZL1 follows a look it shouldn't,
reset it and pair it again.

### 5.4 Name it, set its power-on, group it

1. **Rename it** to its friendly name: the Z2M frontend's device page →
   rename (✏). Or:

   ```powershell
   & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t zigbee2mqtt/bridge/request/device/rename -m '{\"from\": \"0x0017880100000001\", \"to\": \"living_lamp_1\"}'
   ```

   Names: lower case, underscores, `<room>_<what>_<n>` (`living_lamp_1`,
   `kitchen_ceiling_2`, `stairs_down_1`). The server-room bulb is
   **`server_room_rgb`** (it is already in `lights.json`). This name is the
   `device` the map editor's light points at: a rename later means editing
   the light too (the Setup pane says *Zigbee2MQTT doesn't know …* when they
   differ).
2. **`power_on_behavior: on`**: a flipped wall switch or a breaker brings
   the bulb back **lit**, never dark. The frontend's device → *Exposes* →
   *Power-on behavior* → `on`, or:

   ```powershell
   & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t zigbee2mqtt/living_lamp_1/set -m '{\"power_on_behavior\": \"on\"}'
   ```

   (Some older Hue firmware or converters call it `hue_power_on_behavior`:
   use whichever the device's Exposes tab shows. Hue needs firmware from
   late 2018 or newer for it at all.)
3. **Zigbee groups** (only where a look should hit a whole room at once, or
   for the `show` job's scene cues): the frontend → *Groups* → add a group
   and its members, or `zigbee2mqtt/bridge/request/group/add`
   (`{"friendly_name": "living"}`) and
   `zigbee2mqtt/bridge/request/group/members/add`
   (`{"group": "living", "device": "living_lamp_1"}`). The group names the
   show's cue map already uses are listed at the top of
   `stagehand/trapped.house.yaml` (`house`, `living`, `kitchen`, `backyard`,
   `registry`, `tube`, `mudroom`, `bathroom`, `tent`, `server_room`), with
   the **safety rule**: a bulb on the stairs, in a bathroom, in the tent, in
   the server room or on the server-room → living-room path is **never** in
   `house` (a blackout must not darken it), and `server_room_rgb` is in no
   group a house look reaches.

**Back up `C:\zigbee2mqtt\data\` after every pairing session**
(`zigbee.md` §9: stop the task, zip the folder, start it again; keep a copy
off this PC, never commit it). It holds the network key and every paired
bulb.

## 6. The WLED strip (WeGoIOT ESP32 controller)

The RGB LED strip runs on a **WeGoIOT ESP32 controller with WLED**, on the
house Wi-Fi. It listens to MQTT on this PC's broker; stagehand never talks
to it any other way.

### 6.1 Wi-Fi (first time)

1. Power it (the strip's own supply; never power a long strip through the
   ESP32). A WLED controller with no Wi-Fi opens an access point: join
   **`WLED-AP`** (password **`wled1234`**, the WLED default; a vendor build
   may differ — check the box) and open **http://4.3.2.1** (or
   `wled.me`).
2. ⚙ Config → **WiFi Setup**: the house network and its password, an mDNS
   name (e.g. `wled-living`), and change the AP password. *Save & Connect*.
3. Back on the house Wi-Fi, find it at `http://wled-living.local` or in the
   router's client list, and give it a **DHCP reservation** too (so its page
   is always at the same address).

### 6.2 LED Preferences (Config → LED Preferences)

- **LED type**: the strip's chip (WS281x, SK6812 RGBW, …; written on the
  strip or its reel), **color order** (WS2812B is usually **GRB**; if red
  shows green, change it), **length** = the number of LEDs (count them, or
  LEDs per metre × metres), and the **data GPIO** the controller's output
  terminal is wired to. **Unverified:** which GPIO the WeGoIOT board uses;
  a pre-flashed controller usually ships with it set, so check what is
  there before changing it, and read the board's silkscreen or its listing
  if the strip stays dark.
- **Max current / automatic brightness limiter**: set to what the strip's
  power supply can deliver (WLED's default is 3000 mA).
- **Turn LEDs on after power up/reset: ON**, with a boot brightness that
  lights the room (a power blip must not leave a hallway dark).

Test it from the controller's own page (a colour, the brightness slider)
before MQTT.

### 6.3 MQTT (Config → Sync Interfaces → MQTT)

| Field | Value |
|---|---|
| Enable MQTT | ✓ (reboot after saving) |
| Broker | `192.168.8.10` (this PC) |
| Port | **`1884`** (the LAN listener; `1883` is refused from the LAN) |
| Username | `props` |
| Password | the props password (§2) |
| Client ID | unique per controller, e.g. `wled-living` |
| Device Topic | **`wled/<name>`** — the room it lights: `wled/living`, `wled/kitchen`, `wled/backyard`, `wled/registry`, `wled/tube` (halls + stairs) |
| Group Topic | **`wled/all`** |

The `<name>` matters twice: the map editor's light points at it, and the
`show` job's cue map in `trapped.house.yaml` already sends looks to
`wled/living`, `wled/kitchen`, `wled/backyard`, `wled/registry`, `wled/tube`
and `wled/all`. stagehand publishes WLED commands to **`wled/<name>/api`**
(WLED's JSON API: `on`, `bri`, `transition`, and one segment's `col` /
`fx`). WLED sends credentials unencrypted, which is why the props password is
only for props. A strip in the halls or on the stairs (`wled/tube`) is a
**safety light**: mark it so on the map (§8).

Check it from this PC (WLED's `/api` topic also takes the HTTP API's
syntax, which needs no JSON quoting: `T=1` on, `A=` brightness 0–255):

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h 127.0.0.1 -t 'wled/#' -v      # it reports on wled/<name>/g, /c, /v
& "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t wled/living/api -m "T=1&A=128"
```

**Presets** (only if the strip plays the `show` job's `lights_*` scene
cues): `trapped.house.yaml`'s table gives each look one preset ID, the
same on every controller (`ps 1`–`20`, and `ps 22`, the tube's dim static
safety preset). A strip driven only by `lights.json` looks (the Cue
designer, §8) needs no presets.

## 7. stagehand (`show` + `lights` + `audio`)

The secrets first: `C:\loom\stagehand\trapped.house.local.yaml` (git-ignored;
every machine file that extends the house file reads it):

```yaml
server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
```

and `trapped.desktop.local.yaml` with the MOTU's ASIO name (§3.3). Then:

```powershell
.\start-stagehand.ps1            # uv sync, check, install + start the show, lights and audio tasks
.\start-stagehand.ps1 -Status    # every task + the last lines of each log
.\start-stagehand.ps1 -NoAudio   # show + lights only (the router runs on the MacBook: §11)
```

Each job is its own Task Scheduler task (`\Loom\stagehand-show`,
`\Loom\stagehand-lights`, `\Loom\stagehand-audio`; `uv run stagehand tasks
…` underneath, stagehand's `tasks.py`), the Windows twin of the Mac's
launchd jobs: started at sign-in in your session (ASIO needs it), no
console window, normal priority, restarted within a minute if it dies.
Logs: `%LOCALAPPDATA%\stagehand\logs\<job>.log`.

`check --only show,lights,audio` (the script runs it before installing)
must show the MOTU with **32 in / 30 out** and no `PLACEHOLDER server.…`
line; its warnings list each placeholder sound still left. Then, with the
router up:

```powershell
cd C:\loom\stagehand
uv run stagehand announce --config trapped.desktop.yaml "Test."               # chime + the line on announce.to
uv run stagehand sounds play printer_grind --config trapped.desktop.yaml      # one story sound
uv run stagehand sounds stop --announce --config trapped.desktop.yaml         # stop everything
```

The config is `stagehand/trapped.desktop.yaml`. It **extends**
`trapped.house.yaml` (every show rule lives once, there) and adds the
`lights:` section and the router's Windows settings. Always pass `--only`
to a bare `stagehand check` or `run` on this PC (`--only
show,lights,audio`): one machine must never run two copies of a job.

## 8. Place and test it (the map, then Run → House)

Everything the story can address has to be **on the map**, saved to the
project:

- **Speakers**: the map editor's **🔊 Audio** tab. Place each speaker in its
  room on its 828x output channel, then **🔈 Test** each one: a tone and its
  name come out of exactly that speaker. Walk every speaker once on this PC
  even if it was tested on the Mac: ASIO's channel order may not be Core
  Audio's.
- **Lights**: the **💡 Lights** tab → the **💡 Light** tool → click in the
  room (the height `y` is in the house frame: the basement is below 0). In
  the inspector:

  | Light | `kind` | `device` |
  |---|---|---|
  | a Hue or ZL1 bulb | **Zigbee bulb** (`zigbee`) | its Z2M friendly name (`living_lamp_1`), picked from the devices Z2M reported, or typed |
  | a Z2M group of bulbs | **Zigbee2MQTT group** (`zigbee-group`) | the group's friendly name (`living`) |
  | the WLED strip | **WLED strip** (`wled`) | its device topic, **`wled/<name>`** (`wled/living`), without `/api` |

  Caps (colour / colour temperature / dim) fill in from Z2M for a bulb; set
  them by hand for a WLED strip (colour + dim, no colour temperature). Tick
  **safety light (never dark)** for anything people walk by — stairs,
  halls, bathrooms, the tent, the server room — and give it a floor. **Save**,
  then **💡 Identify** (a bulb does Z2M's `okay` blink; a strip blinks, or a
  safety strip flashes steady white), try a colour swatch, then **Save to
  project**. Testing needs the light *saved* first: the module only knows
  saved lights.
- **Run → House** (the editor's Run mode) then shows the house as the show
  sees it:
  - **Setup**: one row each for **🔊 Sound**, **💡 Lights** and **🧠
    Trabolta**, green when connected and otherwise what to do next, in
    order (start the job, a missing sound file, a light Z2M doesn't know,
    pairing). Start here.
  - **Checks**: every speaker, every output of the interface, every story
    sound, every light and every look, one row at a time with a Test
    button; mark each *heard it* / *nothing*.
  - **Cue designer**: where the lighting **looks** are designed (`cue
    <look>` in the story plays `lights.json`'s look of that name).

Then `.\preflight.ps1` (§10) end to end.

## 9. The TV

```powershell
$env:LOOM_MOD_CODE = '<the mod passcode>'   # this window only
.\tv-kiosk.ps1 -Setup        # Chrome, no kiosk, opens /terminal/?code=<mod>&spot=desktop-tv
```

In that window: check it took the TV spot; hold ⚙ for 2 s → device voice →
**Microsoft David** (or Mark) for Trabolta → TEST VOICE (Edge's "Natural"
voices are nicer but untested on `view=tv`). The ⚙ **pace** reads
**0.92×** (wave 26: a TV set up before keeps its saved 1.00×; re-opening
the link with `-Setup` sets 0.92, or move the slider by hand). Close it,
and once the kiosk is back up check the TV's build stamp on Run →
Terminals (an old bundle has none of wave 26). From then on the
Chrome profile (`%LOCALAPPDATA%\loom-tv`) remembers the setup, no code
needed:

```powershell
.\tv-kiosk.ps1               # kiosk on the last display (the TV, as a 2nd screen)
.\tv-kiosk.ps1 -Display 1    # or pick one
.\tv-kiosk.ps1 -InstallTask  # open the kiosk 20 s after every sign-in
.\tv-kiosk.ps1 -Close
```

If the kiosk opens on the wrong screen (display scaling can shift Chrome's
window position), make the TV the main display (Settings → System → Display
→ *Make this my main display*) and use `-Display 1`. Sound: Chrome plays to
Windows' default output — HDMI to the TV's speakers (§1: never the MOTU).
`M` mutes the TV voice; Run → Terminals shows it.

## 10. Show night

1. Power on the 828x and the ADAT expander **before** the PC (or replug
   the 828x's USB after), then the PC; let it sign in. Mosquitto
   (service), Zigbee2MQTT (boot task), `show` + `lights` + `audio`
   (sign-in tasks) and the TV (if `-InstallTask`) start by themselves.
   Check the expander's lock LED is steady.
2. `.\preflight.ps1` — power, Windows Update, sign-in, the broker's two
   listeners, the COM port, `zigbee2mqtt/bridge/state`, `stagehand check
   --only show,lights,audio`, the tasks, the retained `health/stagehand`,
   `health/lights` and `health/audio`, the MOTU's ASIO line, the server's
   `/api/health`, the TV kiosk, then `showctl preflight desktop` (set
   `$env:LOOM_MOD_CODE` in that window first). Exit 1 on any FAIL. With the
   router on the MacBook tonight: `.\preflight.ps1 -NoAudio`.
3. Run → House → Setup: 🔊, 💡 and 🧠 all green. Run → Terminals: the TV
   live.

## 11. The MacBook fallback (the router on the MacBook)

If the 828x won't run under ASIO here (no ASIO line, wrong counts that
won't settle, dropouts), move the router, the 828x and its cabling to the
MacBook, where Core Audio is the tested path. Only one machine may run the
router: two would each speak every announcement.

1. Here: `.\start-stagehand.ps1 -Stop audio` (the task stays installed but
   disabled; `-Restart audio` brings it back).
2. On the MacBook: [`scripts/house-macbook/audio.md`](../house-macbook/audio.md)
   (the 828x over Thunderbolt with Apple's adapter, the kext, its
   `trapped.macbook.local.yaml` with the props password,
   `uv run stagehand launchd install --job audio --config trapped.macbook.yaml`).
   The MacBook dials this PC's broker on `:1884`, so announcements then need
   both machines up.
3. Copy `stagehand\media\sounds\` to the MacBook.
4. Walk every speaker with 🔈 Test again (Core Audio's channel order).
5. Preflight with the fallback flag on both machines: `.\preflight.ps1
   -NoAudio` here (it runs `showctl preflight desktop --router macbook`),
   `pnpm showctl preflight macbook --router macbook` there.

To come back: `uv run stagehand launchd uninstall --job audio` on the
MacBook, then `.\start-stagehand.ps1 -Restart audio` here.

## 12. When something is wrong

| Symptom | Look | Fix |
|---|---|---|
| No announcements anywhere | `.\preflight.ps1`: `health/stagehand`, `health/audio`; Run → House → Setup | the `show` job (`.\start-stagehand.ps1 -Restart show`), the router (`-Restart audio`), the broker (`.\setup-mosquitto.ps1 -Check`); in the fallback, the MacBook's router (`uv run stagehand launchd status --job audio` there) and its `:1884` password |
| No sound at all, Setup says *no audio interface* | `.\start-stagehand.ps1 -Status` (the audio log); `$env:SD_ENABLE_ASIO='1'; uv run python -m sounddevice` | the 828x powered and on USB, MOTU's driver (§3.1), `audio.device` in `trapped.desktop.local.yaml`; then `-Restart audio` |
| *LAYOUT MOVED* / other channel counts | the audio log; the 828x's settings | §3.2: 48 kHz, internal clock, Optical A = ADAT, no mirroring; the expander's clock on ADAT and its lock LED steady |
| Clicks or dropouts (the Setup row counts xruns) | the audio log | the expander's clock (a blinking lock); close other audio apps; the USB cable straight into the PC; USB power saving off (§1) |
| A sound plays on the wrong speaker | 🔈 Test on the map's Audio tab | the speaker's output channel on the Audio tab (ASIO's numbering), Save to project |
| A bulb ignores the story | `health/lights`, `.\zigbee2mqtt.ps1 -Check`; Setup's 💡 row | `.\start-stagehand.ps1 -Restart lights`; the Z2M friendly name = the light's `device`; a moved stick has a new `COMn`: fix `serial.port` in `C:\zigbee2mqtt\data\configuration.yaml`, then `Start-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt` |
| A bulb shows *offline* in Z2M | its wall switch / breaker | switch it on (power-on behaviour brings it back lit); too far from any other mains bulb: move it or add one between |
| The WLED strip ignores the story | `mosquitto_sub … -t 'wled/#' -v`; its page → Info | MQTT connected (Info shows it); broker `192.168.8.10`, port `1884`, user `props`; the device topic = the light's `device` |
| A job keeps dying | `.\start-stagehand.ps1 -Status` (the log) | `.\start-stagehand.ps1 -Stop <job>`, then `-Foreground <job>` to watch it in a window |
| `config error` / CHANGE-ME | `.\start-stagehand.ps1 -Check` | `stagehand\trapped.house.local.yaml` (§7) |
| The TV is silent | Run → Terminals (muted?), Windows' default output | `M` unmutes; Settings → Sound (the TV's HDMI); reopen with `.\tv-kiosk.ps1` (autoplay flag) |
| Every house sound must stop now | — | Run → ■ Stop house sounds; or `uv run stagehand sounds stop --announce --config trapped.desktop.yaml` here |

The tasks by hand: `uv run stagehand tasks status|restart|stop|uninstall
--job show|lights|audio` from `C:\loom\stagehand`, or Task Scheduler → `Loom`.
Ending a task in Task Scheduler stops it until its keep-alive trigger
restarts it within a minute; `tasks stop` disables it first.

## Sources for the device steps

Checked 2026-10-27; re-check if a step doesn't match what you see.

- MOTU 828x downloads (Windows installer, firmware, Windows guide):
  <https://motu.com/en-us/download/product/303/>; clock settings:
  <https://motu.com/techsupport/technotes/clock>.
- Zigbee2MQTT touchlink: <https://www.zigbee2mqtt.io/guide/usage/touchlink.html>;
  a Hue bulb's page (serial-number reset, dimmer reset, power-on):
  <https://www.zigbee2mqtt.io/devices/9290024684.html>; the ZL1:
  <https://www.zigbee2mqtt.io/devices/3RCB01057Z.html>.
- ZL1 reset reports: <https://discuss.3reality.com/d/226-third-reality-zl1-bulbs-persistent-hidden-touchlink-group-bindings>,
  <https://selorahomes.com/docs/how-to/zigbee/third-reality-zl1-zha-pairing-issues>.
- WLED: <https://kno.wled.ge/basics/getting-started/>,
  <https://kno.wled.ge/features/settings/>, <https://kno.wled.ge/interfaces/mqtt/>.
