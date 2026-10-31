# John's Desktop (Windows): the house PC

The house rig used to be one "house Mac". For Oct 31 it is split across two
machines. This folder is the Windows half, and since 2026-10-27 it is the
**sound and lights machine**: the MOTU 828x on its own outs (the speaker
router; no ADAT expander since wave 31), the Zigbee lights (Philips Hue and
ThirdReality ZL1 bulbs on the CC2652P stick, every one of them already in
`lights.json`), the living room's WLED LED strip, the house broker and the TV. It
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
| **John's Desktop** (Windows, this folder) | the **sound**: stagehand **`audio`** (the router) on the **MOTU 828x** (its own outs, no ADAT expander) over USB 2, through ASIO: every story sound, the announcements, the house soundtrack (wave 38) and Trabolta's TV voice on every speaker (the TV's sound reaches input 3 through VoiceMeeter and the router's `audio.tap`, §3.5) · the **lights**: **Zigbee2MQTT** on the CC2652P stick (`COMn`) with the Hue and ZL1 bulbs, the living room's **WLED** strip on its ESP32 controller (Wi-Fi), stagehand **`lights`** (`lights.json`: every bulb, the strip and the story's `lights_*` looks) · stagehand **`show`** (Trabolta's room cuts and the flicker bulb by bulb, the sensors back, the `do announce` relay) · **Mosquitto**, the house broker (anonymous `127.0.0.1:1883`, password-only `props` on the LAN at `:1884`) · the **TV**: Chrome kiosk over HDMI, spot `desktop-tv` |
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

### Just the lights: the short path

The lights don't need the 828x. To get them going before the sound, do
these in order (each step links to its full section):

1. **The broker** (§2), in an **Administrator** PowerShell:
   `.\setup-mosquitto.ps1 -SetPrivate`. The `props` password is one **you
   make up** here; nothing ships one. It is stored hashed in
   `C:\ProgramData\mosquitto\passwd` and goes only into the WLED strip
   (step 5) and the MacBook's fallback overlay. The Zigbee bulbs and this
   PC's stagehand jobs never use it (they use the anonymous loopback
   `127.0.0.1:1883`). Then `.\setup-mosquitto.ps1 -Check`: the service
   running, the password file readable by the service, `1883` and `1884`
   answering.
2. **Zigbee2MQTT** (§4). Install it (a normal PowerShell, a few minutes):

   ```powershell
   git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git C:\zigbee2mqtt
   cd C:\zigbee2mqtt; corepack enable; pnpm install --frozen-lockfile; pnpm run build
   ```

   Then from this folder, with the stick's port from `.\zigbee2mqtt.ps1
   -Ports` (on this PC it has shown as `COM3`):

   ```powershell
   .\zigbee2mqtt.ps1 -WriteConfig -Port COM3   # skip if you copied the Mac's data\ (below)
   .\zigbee2mqtt.ps1 -Start                    # wait for "Zigbee2MQTT started!", then Ctrl+C
   .\zigbee2mqtt.ps1 -InstallTask              # Administrator: runs at boot
   .\zigbee2mqtt.ps1 -Check
   ```

   **If bulbs were already paired on the MacBook's Zigbee2MQTT**, copy its
   whole `data\` folder to `C:\zigbee2mqtt\data\` instead of
   `-WriteConfig` and change only `serial.port` to the COM port; a fresh
   config means re-pairing every bulb.
3. **stagehand `show` + `lights`** (§7). Write
   `stagehand\trapped.house.local.yaml` (git-ignored) with the event's id
   and its mod passcode:

   ```yaml
   server: { event: <the event's id>, mod_passcode: "<the mod passcode>" }
   ```

   The event id is a UUID (the `/e/<id>/` in a Run URL), **not** the
   project's or the event's name: a name logs in as `404 unknown event`.
   The mod passcode tells you the id:

   ```powershell
   Invoke-RestMethod -Method Post https://app.mapsandducks.com/api/resolve-code -ContentType application/json -Body '{"code": "<the mod passcode>"}'
   ```

   `uv run stagehand lights devices --config trapped.desktop.yaml` (in
   `stagehand\`) then says `mod login ok`. Never put either in
   `trapped.house.yaml` itself: it is tracked.
   Then `.\start-stagehand.ps1 -NoAudio` (show + lights only, until the
   828x is done). The `lights` job must run **before** pairing: every
   *Pair* button goes through it.
4. **Pair and name every bulb** (§5). Open joining (Run → House → 🔌 Setup
   → 💡 Lights → **🔗 Pair a bulb**, or http://localhost:8080 → *Permit
   join*), then reset the bulb: a **ZL1** by flicking its switch 5–6 times
   until it blinks, a **Hue** by Touchlink from the frontend (or delete it
   in the Hue app while it is still on a bridge). Nearest the stick first.
   For each: **rename** it to its §5.4 name (`living_1`, `hall_main`,
   `server_room_rgb`, …) and set **Power-on behavior → `on`**. Back up
   `C:\zigbee2mqtt\data\` after the session.
5. **The WLED strip** (§6): Wi-Fi, LED preferences, then MQTT to this PC
   on **`1884`**, user `props`, the password from step 1, device topic
   **`wled/living`**.
6. **Sync the lights to the project** (from the **MacBook**, not this PC):
   `sync-show --replace-lights` (with the other flags of the root
   CLAUDE.md's shipping steps) sends the repo's `lights.json` (every bulb,
   the strip, every look) into the project; until then the project knows
   only the server-room bulb. Do it once the bulbs carry their names. If
   anyone saved looks to the project, Download JSON them first and commit
   them, or the replace drops them.
7. **Walk it** (§8): Run → House → 🔌 Setup green for 💡; **Checks**, every
   light and look; the 🎨 **Cue designer**, every look ▶ Tested on the house.

**The address.** The WLED strip and `trapped.macbook.yaml` dial this PC at
**`192.168.8.10`** (the house router's DHCP reservation). `-Check` warns
when this PC has another address: on the show network, move the
reservation to this PC, or point the strip's broker (and the MacBook
overlay's `audio.mqtt.host`) at the PC's real address.

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
- **Windows' default playback device is never the MOTU** (leave it on the
  TV's HDMI): a notification or a stray app must never land on the 828x
  (Analog 1 is the living-room sub). The router opens the MOTU itself,
  through ASIO, whatever the default is. Chrome is the exception: its
  output is **VoiceMeeter Input** (wave 46; this PC has no line out), which
  the router sums into the 828x's input 3 (§3.5).

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

The 828x (Thunderbolt **and** USB 2.0; MOTU's "28x30") drives every house
speaker from its own outputs: **no ADAT expander** (wave 31). On Windows
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
- **Both optical ports stay set to ADAT** (in and out), even with nothing
  plugged in: that is what makes the 828x report the 32 in / 30 out the
  show checks (§3.3). Never TOSLink, never 88.2 / 96 kHz: either changes
  the channel counts.
- **Main outs and Phones NOT mirrored** (in CueMix): the show uses Main L/R
  and Phones L/R as four separate channels; mirrored, they play the same
  thing.
- **CueMix FX**: Clippy's wireless mic (input 1) stays mixed there to the
  living room's outs, as before (hardware, no latency). The living room is
  now **Main L/R**: if the old mix sent the mic to Analog 1–2, move it to
  Main L/R (Analog 1 is the sub now). **Input 3 (the TV) is never in a
  CueMix mix**: the router routes it, and CueMix would play it a second
  time (since wave 46 nothing is plugged into Analog In 1: the TV arrives
  in software, §3.5, so CueMix's input-3 meter stays flat). CueMix sums the
  computer's playback with its mix on each output.
- **The router opens a duplex stream** (`passthrough: true` since wave 38):
  10 in / 14 out of the device's 32 / 30, through ASIO (`stagehand check`
  prints `(10 in / 14 out) duplex`). It plays to the outputs, routes the
  TV's input to the speakers and meters every input, so the music ducks
  under Trabolta and under Clippy's mic (§3.6). Next to it, `audio.tap`
  opens VoiceMeeter's output as a second, capture-only stream and sums it
  into input 3 (§3.5).

**Our channel numbers are the ASIO driver's own** (no channel map), in the
order MOTU's Windows driver names them (read from its channel names on
2026-10-30; not the Core Audio order the docs assumed before wave 46), as
in `audio.json`:

| Output | On the 828x | Show use |
|---|---|---|
| 1–2 | **Main Out L/R** | the living room L/R (`living-l`, `living-r`) |
| 3 | Analog 1 (back) | the living-room **subwoofer** (speaker `living-sub`, its own trim) |
| 4 | Analog 2 (back) | spare |
| 5–6 | Analog 3–4 (back) | the kitchen L/R |
| 7–9 | Analog 5–7 (back) | the hall (The Tube), the Steam Room, the CPU: no speaker yet |
| 10 | Analog 8 (back) | The Optical Drive (the mud room) |
| 11–12 | S/PDIF L/R | unused |
| 13–14 | **Phones L/R**, a front headphone jack | unused |

The ADAT channels (15–30) are not opened.

| Input | On the 828x | Show use |
|---|---|---|
| 1 | Mic/Gtr 1 (front) | Clippy's wireless receiver: mixed in CueMix to the living room; the router only meters it (role `clippy`) |
| 2 | Mic/Gtr 2 (front) | spare |
| 3 | **Analog In 1** (back, nothing plugged in) | **the TV**: Chrome's sound through VoiceMeeter, summed in by `audio.tap` (role `trabolta`, §3.5) |
| 4–10 | Analog In 2–8 (back) | unused |

Then S/PDIF, ADAT, Return 1–2 (29–30) and Reverb 1–2 (31–32), unused. The
6 placed speakers are the living room L/R on 1–2 and its sub on 3, the
kitchen L/R on 5–6 and The Optical Drive on 10. The zone `living` is all three living-room
speakers. The Fan Closet's speaker is placed later (§8).

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
(the show uses 10 in / 14 out of them; `check` prints `828x on ASIO (10 in
/ 14 out) duplex`). `stagehand check --only audio`
(§7) fails, and the router logs `LAYOUT MOVED`, when they differ. Other
counts mean the sample rate, mirroring or an optical port's format is
wrong (§3.2): fix the 828x, never the file. If MOTU's ASIO
driver reports other counts with every setting right, stop and tell the
director before touching `audio.json` (every speaker's channel would need
re-checking).

`trapped.desktop.yaml` already sets `host_api: asio` (which also sets
`SD_ENABLE_ASIO` before sounddevice loads) and the Windows voice
(`voice_engine: auto` → SAPI, `say_voice: Microsoft Zira Desktop`; a missing
voice falls back to the installed female one).

### 3.4 The sound files

Three kinds, all git-ignored (the real tracks include copyrighted songs),
all on this PC only:

| Folder (in `C:\loom\stagehand\media\`) | What | Where it comes from |
|---|---|---|
| `library\<category>\` | the **SFX library**: 115 synthesized sounds (sirens, dings, telephony, digital, retro, party, story, ambient loops), 48 kHz WAV | rendered here: `sounds library` (below) |
| `sounds\` | one file per story `sound <name>` (19 names, `media\sounds.yaml`) | the library's stand-ins, placeholders, then the real files |
| `music\<act>\` | **the soundtrack**: the user's MP3s, one folder per act (§3.6) | copied in by hand |

```powershell
cd C:\loom\stagehand
uv run stagehand sounds library --story --config trapped.desktop.yaml
uv run stagehand sounds placeholders --config trapped.desktop.yaml
```

- **`sounds library --story`** renders the whole library into
  `media\library\` (about half a minute; a file with the same bytes is not
  rewritten, so a re-run changes nothing) and writes the **stand-ins**: the
  13 story sounds with a library equivalent (`library:` in `sounds.yaml`:
  `modem_handshake`, `alarm_siren`, `y2k_chime`, …) go into `media\sounds\`
  as `<name>.wav`. It replaces only a placeholder or an older library file,
  never a real file. It also writes the Fan Closet's dryer loop
  (`library\ambient\dryer-tumble.wav`). `.\start-stagehand.ps1` runs it
  on every install (§7); `.\preflight.ps1` warns when it is missing.
- **`sounds placeholders`** writes a labelled placeholder for each story
  sound still without a file (a distinct tone, then "Placeholder. rave." in
  the SAPI voice): after the stand-ins, that is the 6 songs (`dance_song`,
  `rave`, `hand_jive`, the two *You're the One* versions, `ceremony_bed`).
- **Then copy the real files in** as they arrive, named exactly after the
  sound (`dance_song.wav`, …): a real file always wins over a placeholder
  or a stand-in, and neither generator ever touches one. `.wav`, `.aiff`,
  `.aif`, `.flac`, and since wave 38 `.mp3` and `.ogg` (a `.wav` of the same
  name wins); any rate, resampled. **A real file always beats a stand-in**,
  whatever its format: drop `ad_jingle.mp3` beside the stand-in
  `ad_jingle.wav` and the next `sound ad_jingle` plays the MP3 (no need to
  delete anything; `sounds library --story` never touches a real file).
  The 13 names with a stand-in: `modem_handshake`, `bingo_start`,
  `ad_jingle`, `truther_glitch`, `countdown_tick`, `printer_grind`,
  `beans_spill`, `zip`, `y2k_chime`, `alarm_siren`, `windows_shutdown`,
  `motorcycle`, `award_fanfare`. The **takeover tracks** (`dance_song`,
  `rave`, `hand_jive`, `youre_the_one_vocoder`, `youre_the_one_sandy_only`,
  `ceremony_bed`, `ad_jingle`; `tracks:` in `media\soundtrack.yaml`)
  stream from the file, so an MP3 is fine for them. If the files were
  collected on the MacBook, copy its whole `stagehand/media/sounds/` and
  `media/music/` folders over (a USB stick, or a share).
- **The music**: drop the MP3s into `media\music\doors\`, `act-1\`,
  `malware\`, `act-2\`, `act-3\`, `final\`, `ceremony\`, `afterparty\`
  (`.\start-stagehand.ps1` makes the folders). Any of `.mp3`, `.wav`, `.flac`,
  `.ogg`, `.aiff`, `.aif`, any sample rate; only the folder itself, no
  subfolders. A folder is read again at each pass, so a track dropped in
  mid-show joins the next pass.

`stagehand check --only audio` lists every placeholder still left (none on
the night), each playlist with its file count (an empty one is a warning:
that act plays no music), and **a VBR MP3 without a length header** (it
would stop early: *plays only the first 236 s of 600 s*); re-encode that
one with the `ffmpeg` line the warning prints (`ffmpeg -i in.mp3 -c:a
libmp3lame -q:a 2 out.mp3`) and replace the file.

### 3.5 The TV's sound into input 3 through VoiceMeeter (Trabolta on every speaker)

Trabolta speaks from the TV page (Chrome, spot `desktop-tv`). Since wave 38
he is heard on every house speaker, not the TV's own: the router routes
input 3 to the speakers and ducks the music under it (§3.6). There is no
server round trip: the router hears the signal itself.

This PC has **no line out**, so since wave 46 there is no cable: Chrome
plays into **VoiceMeeter** (a virtual cable), and the router's
**`audio.tap`** (`trapped.desktop.yaml`: `tap: { device: "VoiceMeeter
Output", host_api: mme, ch: 3 }`) opens VoiceMeeter's B1 bus ("VoiceMeeter
Output", MME) as a second, capture-only stream and sums it into input 3
inside the ASIO callback. The matrix routes it, the meters read it and the
music ducks under Trabolta exactly as with a cable. A ring buffer absorbs
the two clocks (VoiceMeeter's and the MOTU's; it adds ~10–30 ms): a `slip`
drops frames when it runs full, an `underrun` pads silence. Proven here on
2026-10-30: a tone into VoiceMeeter Input reached input 3 at full level,
the `trabolta` duck opened fully and released after the hold, with no
underruns, slips or xruns.

1. **VoiceMeeter Potato**, installed (VB-Audio), and **running at
   sign-in**: Menu → **Run on Windows Startup**. Closed, its virtual cable
   passes nothing and input 3 is silent. Menu → System Settings →
   **Preferred Main SampleRate 48000**.
2. **A1, its hardware out: an unused MOTU WDM pair**
   (`WDM: MOTU ADAT Optical B 7-8`, silent), so VoiceMeeter runs on the
   MOTU's clock. Never a pair that reaches a speaker.
3. **The Voicemeeter VAIO strip** (the first virtual input): **B1 on,
   every A button off**, fader at 0 dB. An A button on plays Trabolta
   twice, or straight to a MOTU out without the duck.
4. **Chrome's output to VoiceMeeter Input.** Windows 11: Settings → System
   → Sound → **Volume mixer**; Windows 10: Settings → System → Sound →
   **App volume and device preferences**. Chrome shows there only while it
   plays something: open the TV with `.\tv-kiosk.ps1 -Setup` and press ⚙ →
   TEST VOICE. Set Chrome's **Output device** to **"VoiceMeeter Input
   (VB-Audio VoiceMeeter VAIO)"**.
5. **The router sees the tap.** `uv run stagehand check --config
   trapped.desktop.yaml --only audio` prints `audio tap: VoiceMeeter Output
   … → input 3` (or fails naming the device). The audio log's health line
   ends `| tap VoiceMeeter Output … → in 3 peak N dBFS, underruns N, slips
   N`, or `… NOT OPEN (why)`. A tap that fails to open never stops the
   router: it logs `audio tap failed to open (...) — playing on without
   it`, and then Trabolta is not on the house speakers and nothing ducks
   under him.
6. **The level.** Chrome near full volume. A TEST VOICE should peak well
   above −45 dBFS on input 3 (the duck opens over it) and never clip: `uv
   run stagehand music status --config trapped.desktop.yaml` (`inputs   :
   … 3 -18 dBFS …`; it reads the router's health, sent once a minute, and
   shows the loudest moment since the one before), or VoiceMeeter's own
   VAIO meter.
7. **The TV's own speakers get nothing from Chrome.** Chrome is off HDMI
   (step 4) and the TV's volume is down. Otherwise **Trabolta plays twice**:
   once from the TV, once from the living-room speakers a moment later.
8. **CueMix: input 3 is in no mix** (§3.2; with no cable it carries nothing
   in hardware anyway). The router routes it: the TV row of the map
   editor's Audio-tab matrix (input 3) feeds outputs 1, 2, 5, 6 and 10 (the
   living room L/R, the kitchen L/R, The Optical Drive; not the sub). A new
   speaker (the Fan Closet's) needs its cell ticked on that row, then Save
   to project.
9. **No other Chrome on this PC during the show.** Windows' per-app output
   is per program: every Chrome window on this PC plays through VoiceMeeter
   into every house speaker. The director's Run console is on the MacBook.

**Unverified on this PC:** that the TV page's device voice (Microsoft
David or Mark) follows Chrome's per-app output. TEST VOICE must come out of
the house speakers and not the TV; if it still comes out of the TV, set
Windows' default output to VoiceMeeter Input instead (and keep
notifications and system sounds off, §1). The TV page's own sound effects
are silent since wave 38 (only its voice reaches VoiceMeeter), so a click
on the page never ducks the music.

In the **MacBook fallback** (§11) the router is output-only: nothing is
routed from input 3, so set Chrome's output back to HDMI and the TV's
volume up, or Trabolta is not heard at all.

**His voice breaks here (wave 56).** `voicefx: true` in `trapped.desktop.yaml`
breaks the voice on input 3 on its way to the speakers. Run → Terminals, 🌀 His
voice says how much. To hear it, open `/terminal/?preview=voice` in a tab beside
the TV and press a flavour; the audio log's health line says `voice fx level …`.

### 3.6 The soundtrack and who ducks what

The router plays **music all night** on its `music` bus, under every story
sound and announcement: one set per act, at −10 dB, from John's TIDAL
playlists (§3.7), or from a folder of files: shuffled (a new order each pass,
never the same track twice in a row), crossfading over 3 s
(`media\soundtrack.yaml`, tracked; `docs/loom-w38-contract.md` C3). The
story picks the set: `cue music_<scene>` at each act change, mirrored in
`Night.music`, which the router reads back after a restart or a reconnect.

| Scene | Plays | Starts at |
|---|---|---|
| `doors` | TITI - Act 1 | Power On (🚪 Open the doors) |
| `act_1` | TITI - Act 1, playing on | the call to the Desktop (or an early Bingo) |
| `malware` | TITI - Act 2 | the Ad Hijack (`ad_jingle` takes the speakers first) |
| `act_2` | TITI - Act 2, playing on | the five-minute warning (or an early Truth Pong) |
| `act_3` | TITI - Act 3 | the Y2K clock |
| `final` | TITI - Act 3, playing on | the final reveal |
| `off` | — | every ending: silence, TIDAL paused |
| `ceremony` | `music\ceremony\` | the ceremony (`ceremony_bed` takes the living room while it plays) |
| `afterparty` | TITI - Rave / Ending | the resurrection, to the end of the night |

**Per room.** Each scene says which playlist each speaker plays: today
every scene is its act's playlist everywhere, plus the dryer loop
(`fan_closet`, the synthesized `dryer-tumble`) in The Fan Closet, which
runs on untouched across the acts. Until the Fan Closet's speaker is
placed, that entry reaches no speaker: `check` warns once (*The Fan Closet
reaches no wired speaker (in 8 scenes …)*), never a failure.

**Takeover tracks.** A story `sound` listed under `tracks:` (the songs,
`ceremony_bed`, `ad_jingle`) silences the music on the speakers it plays
on, and the music comes back over about 2 s after it ends.

**Priority.** At full strength, the music ducks:

| Under | Music | Story sounds | Where |
|---|---|---|---|
| **Trabolta** (the TV, input 3) | −18 dB | −8 dB | every speaker, the sub too |
| **an announcement** | −15 dB | −12 dB | where the announcement plays (`announce.to`: everywhere) |
| **Clippy's mic** (input 1) | −12 dB | — | the living room (L, R, sub) |

The deepest duck on a speaker wins. A source opens when its input's peak
goes over the sidechain threshold, holds 0.8 s after the last loud
moment and lets go over 1.2 s (`audio.priority` and `audio.sidechain` in
`trapped.house.yaml`). `dance_song`, `rave` and `hand_jive` are never
ducked. Trabolta cannot duck Clippy: the mic is in CueMix, outside the
router.

**Set Clippy's threshold at the rehearsal.** The TV's line is clean, so
its threshold is low (−45 dBFS). Clippy's lav hears the party, so his has
its own: `audio.sidechain.roles.clippy.threshold_db`, −30 dBFS in
`trapped.house.yaml`, a guess. At the tech rehearsal: the music at party
level, people talking, the lav on and silent for a minute; read input 1
in `stagehand music status` (the loudest moment of the last minute), and
set the threshold about 6 dB above it. Edit that line in
`stagehand\trapped.house.yaml` (a `.local.yaml` may not set it; the value
is no secret, so commit it):

```yaml
    roles:
      clippy: { threshold_db: -24 }
```

then `.\start-stagehand.ps1 -Restart audio`. Too low and the living room's music stays ducked all
night; too high and it doesn't duck while he talks. `check` prints the
result (`sidechain: … clippy over -24 dBFS …`).

**By hand** (over this PC's broker, so it works with the uplink down):

```powershell
uv run stagehand music status --config trapped.desktop.yaml       # the scene, each bed's track, the input levels, who is ducking
uv run stagehand music scene act_2 --config trapped.desktop.yaml  # any scene in soundtrack.yaml; `off` is silence
uv run stagehand music next --config trapped.desktop.yaml         # skip the current track everywhere
uv run stagehand music stop --config trapped.desktop.yaml         # scene off
```

- A **hand `music scene` or `music stop` holds** until the next music cue
  the story sends live (the next act), a story restart or a router
  restart; a feed reconnect does not undo it.
- **■ Stop house sounds** (Run, a host phone, `sounds stop`) fades the
  music out too. It stays off until the next act's music cue, a `music
  scene <name>`, or the router's catch-up after a restart or a reconnect.
  To bring it back at once: `music scene <the current act>`. It never
  touches the TV's route: Trabolta still plays on the speakers (`M` on
  the TV page mutes him).
- `pnpm showctl doctor` prints the scene and the input levels too.

**The mixer** (wave 40). Run → House → 🎚 Mixer in the editor, or 🎚 Mixer
in a host's Desk window, balances the house live: Music, Featured tracks,
Sound effects, Announcements and Trabolta's TV, everywhere, per room and
per speaker (the sub has its own fader), with live meters while the panel
is open. Its Now playing shows each bed's track with ⏭ Skip, the scene
picker (a hand scene, held like `music scene`), Stop music and *Follow the
story*. The mix is kept by the server for the event (a router restart
picks it up) and never edits `audio.json`: the speaker trims stay the
install. Speaker tests ignore it. Clippy's mic shows as a meter only (it
lives in CueMix). Muting the TV *everywhere* also stops it ducking the
music; a featured track muted somewhere takes nothing over there.
`pnpm showctl doctor`'s Mixer row lists what is off 0 dB.

### 3.7 The soundtrack from the TIDAL app

Hosts run all of this from 🎵 Music (the Desk, Run → House): pause, previous,
next, and any playlist in the app's sidebar (wave 58,
`docs/loom-w58-contract.md`). Those buttons work through the same control port,
so the app must be started as below.

The acts and the ending are John's TIDAL playlists, **played by the TIDAL
app on this PC** and heard like the TV: through VoiceMeeter, on a bus of
their own. Custom songs stay MP3s (below). Proven on this PC on 2026-10-30:
every scene change against the real app, stereo at full level, and 4 minutes
on the 828x's own clock (the numbers are in `docs/loom-w52-contract.md`).

    TIDAL -> VoiceMeeter Aux Input -> the AUX strip, B2 only
          -> VoiceMeeter Aux Output -> the router's music bus

1. **VoiceMeeter's AUX strip** (the second virtual input): **B2 on, every A
   button off**, fader at 0 dB. A1 stays as in §3.5, so this bus runs on the
   MOTU's clock. The strip stays clear of Trabolta's VAIO / B1.
2. **Sign in to TIDAL once by hand.** Then start it for the show:
   `.\tidal.ps1`, and `.\tidal.ps1 -InstallTask` to do that at every
   sign-in. Started any other way (the Start menu, a tray click after a
   quit) it has no control port, and the router can't reach it.
3. **Nothing else to set in TIDAL.** The router picks **VoiceMeeter Aux
   Input** in the app's Sound output menu, sets Repeat, and plays the
   playlist in TIDAL's own order. Keep the app's volume at full; the level
   is the mixer's. Don't use the app during the show: it belongs to the
   router, and a stray pause resumes within a second.
4. **`.\tidal.ps1 -Check`** (part of `preflight.ps1`), then `uv run
   stagehand music scene act_1 --config trapped.desktop.yaml`: `music
   status` names the track, and Run -> House -> 🎚 Mixer shows it with ⏭.
   The audio log's health line ends `| tidal playing <track>, capture peak N
   dBFS`, or `| tidal PROBLEM: <why>`.

**What it does by itself.** A scene change fades the old act out, changes
playlist and fades the new one in (about 3 s; two playlists can't crossfade
through one app). The `off` scene and Stop house sounds pause the app after
their fade, and the same act coming back resumes. A TIDAL that restarts
is put back on the wanted playlist, from its top. A router that restarts
finds the app playing and leaves it alone. Ducking, the mixer's strips and
⏭ work as on any bed.

**The fallback.** If the app doesn't answer, the playlist won't start or
the cable carries nothing for 20 s, the bed crossfades to that act's folder
(`media\music\act-1\`, `act-2\`, `act-3\`, `afterparty\`) if it holds
files; the next scene tries TIDAL again. With an empty folder it stays
silent and keeps trying. So the night depends on this PC's internet unless
those folders are filled.

**Custom songs.** A song the story fires (`sound dance_song`, `hand_jive`, …)
goes in `media\sounds\` as `<name>.mp3`, as before, and takes the speakers
over; the story cues `music_off` first, so TIDAL pauses under it. A folder
playlist can't be mixed into a TIDAL one, but any scene can be a folder
instead: point its `play:` at one in `media\soundtrack.yaml`, as `ceremony`
does. Playlist ids are in that file; renaming a playlist in TIDAL changes
nothing, and a new one needs the id from the end of its share link.

**In the MacBook fallback** (§11) the router has no `tidal:` section, so
every act plays its folder: copy them over.

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
- the map editor (Run → House → 🗺 Map) → **💡 Lights** tab → **📡 Pair
  new device**;
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

### 5.4 Name it and set its power-on (no groups, no scenes)

Every bulb is already a fixture in the show's `lights.json` (wave 31),
placed in its room on the map, and its `device` is the Zigbee2MQTT
**friendly name** below. So the whole job per bulb is: pair it, rename it
to its name, set its power-on. Which physical bulb (Hue or ZL1) gets which
name doesn't matter; put it in that room.

| Friendly name | Room (map) | Safety |
|---|---|---|
| `living_1`, `living_2`, `living_3` | the living room (The Desktop) | — |
| `kitchen_1`, `kitchen_2`, `kitchen_3` | the kitchen (The Start Bar) | — |
| `hall_main` | the main floor hall | **safety** |
| `hall_up` | the upstairs hall | **safety** |
| `hall_basement` | the basement hall | **safety** |
| `casino` | The Graphics Card (bedroom 2, upstairs; the casino) | — |
| `bath_down` | the basement bathroom | **safety** |
| `bath_up` | the upstairs bathroom | **safety** |
| `fan_closet_1`, `fan_closet_2` | the fan closet | — |
| `ram_1`, `ram_2`, `ram_3` | The RAM (the studio) | — |
| `server_room_rgb` | the server room (Trabolta's heart) | **safety**, never under 80 |

That is 18 house bulbs plus the server room's (9 Hue + 12 ZL1 were
bought). The rest are spares: one more was meant for "the bedroom", but
the map has no other bedroom room yet, so it is not placed (place it with
the map editor once its room is on the map). A **safety** bulb is never
turned off and never goes under 60 / 254 (`server_room_rgb`: 80); the
`lights` job clamps every look that reaches it.

1. **Rename it** to its friendly name: the Z2M frontend's device page →
   rename (✏). Or:

   ```powershell
   & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t zigbee2mqtt/bridge/request/device/rename -m '{\"from\": \"0x0017880100000001\", \"to\": \"living_1\"}'
   ```

   The name must match exactly (lower case, underscores): it is the
   `device` the light in `lights.json` points at (the Setup pane says
   *Zigbee2MQTT doesn't know …* when they differ).
2. **`power_on_behavior: on`** on **every** bulb, and above all the safety
   ones: a flipped wall switch or a breaker brings the bulb back **lit**,
   never dark. The frontend's device → *Exposes* → *Power-on behavior* →
   `on`, or:

   ```powershell
   & "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t zigbee2mqtt/hall_main/set -m '{\"power_on_behavior\": \"on\"}'
   ```

   (Some older Hue firmware or converters call it `hue_power_on_behavior`:
   use whichever the device's Exposes tab shows. Hue needs firmware from
   late 2018 or newer for it at all.)

**No Zigbee groups, no Zigbee scenes.** Every look (the story's `cue
lights_*`) is a `lights.json` look that the `lights` job plays bulb by
bulb, and Trabolta's room cuts and the flicker in `trapped.house.yaml`
address each bulb by its name too. Don't create groups or store scenes;
groups left over from an older setup are harmless but unused.

**Back up `C:\zigbee2mqtt\data\` after every pairing session**
(`zigbee.md` §9: stop the task, zip the folder, start it again; keep a copy
off this PC, never commit it). It holds the network key and every paired
bulb.

## 6. The living room's WLED strip (WeGoIOT ESP32 controller)

The living room's RGB LED strip (**6200 LEDs over 32.8 ft / 10 m, on a 24 V
/ 6 A supply**) runs on a **WeGoIOT ESP32 controller with WLED**, on the
house Wi-Fi. It is `lights.json`'s fixture `living-strip` (kind `wled`,
device `wled/living`, in the `living` zone with the three living-room
bulbs). It listens to MQTT on this PC's broker; stagehand never talks to it
any other way.

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

Per output (the strip is one output):

- **LED type**: the strip's chip, from its label, reel or listing (e.g.
  WS2811, WS2814, SK6812).
- **Length** = the number of **addressable pixels**, not LEDs. 6200 LEDs on
  10 m is 620 per metre, a COB-style strip, and on a 24 V addressable COB
  strip several LEDs share one IC (one pixel). Read the strip's label or
  listing for its chip and its LEDs per pixel (or pixels per metre), and
  enter pixels = 6200 ÷ LEDs per pixel. If you can't find it, set the
  length high enough to cover the strip, light it white, and check that the
  **far end** lights; then lower it until the far end just stays lit.
- **Color order**: try **GRB** (WLED's default), then pick a red in the
  colour wheel: if it shows green or blue, change the order until red is
  red.
- **(Data/Clk) GPIO(s)**: the pin the WeGoIOT board's output terminal is
  wired to. **Unverified:** which GPIO that board uses; a pre-flashed
  controller usually ships with it set, so check what is there before
  changing it, and read the board's silkscreen or its listing if the strip
  stays dark.

Then, for the whole controller:

- **Enable automatic brightness limiter: ON**, **Maximum PSU Current:
  about `5500` mA** (WLED counts in mA; the supply is 6 A, so this leaves
  margin). WLED's default is 3000 mA. The limiter estimates the current
  from each output's *mA/LED* setting, whose default is for 5 V WS281x
  pixels, so on a 24 V strip it is only an estimate: if the strip's
  listing gives the current per pixel, pick a custom *mA/LED* with it; if
  the supply runs hot on full white, lower the limit.
- **Turn LEDs on after power up/reset: ON**, with a **Bootup brightness**
  that lights the room (a power blip must not leave it dark).

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
| Device Topic | **`wled/living`** |
| Group Topic | `wled/all` (WLED's default; it can stay, nothing sends to it now) |

The device topic must be exactly `wled/living`: it is `lights.json`'s
`device` for the strip, and Trabolta's living-room cut in
`trapped.house.yaml` turns it off and on there. stagehand publishes WLED
commands to **`wled/living/api`** (WLED's JSON API: `on`, `bri`,
`transition`, and one segment's `col` / `fx`). WLED sends credentials
unencrypted, which is why the props password is only for props.

Check it from this PC (WLED's `/api` topic also takes the HTTP API's
syntax, which needs no JSON quoting: `T=1` on, `A=` brightness 0–255):

```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h 127.0.0.1 -t 'wled/#' -v      # it reports on wled/<name>/g, /c, /v
& "C:\Program Files\mosquitto\mosquitto_pub.exe" -h 127.0.0.1 -t wled/living/api -m "T=1&A=128"
```

**No WLED presets.** The story's looks reach the strip as `lights.json`
looks (colour, brightness, effect) from the `lights` job; nothing recalls a
preset, so none need saving.

## 7. stagehand (`show` + `lights` + `audio`)

The secrets first: `C:\loom\stagehand\trapped.house.local.yaml` (git-ignored;
every machine file that extends the house file reads it):

```yaml
server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
```

and `trapped.desktop.local.yaml` with the MOTU's ASIO name (§3.3). Then:

```powershell
.\start-stagehand.ps1            # uv sync, render the SFX library, check, install + start the show, lights and audio tasks
.\start-stagehand.ps1 -Status    # every task + the last lines of each log
.\start-stagehand.ps1 -NoAudio   # show + lights only (the router runs on the MacBook: §11)
```

Each job is its own Task Scheduler task (`\Loom\stagehand-show`,
`\Loom\stagehand-lights`, `\Loom\stagehand-audio`; `uv run stagehand tasks
…` underneath, stagehand's `tasks.py`), the Windows twin of the Mac's
launchd jobs: started at sign-in in your session (ASIO needs it), no
console window, normal priority, restarted within a minute if it dies.
Logs: `%LOCALAPPDATA%\stagehand\logs\<job>.log`.

Before the check the script renders the SFX library and the story's
stand-ins (`sounds library --story`, §3.4; unchanged files are not
rewritten) and makes the empty `media\music\<act>\` folders; `-NoAudio`
skips both. `check --only show,lights,audio` (the script runs it before
installing) must show the MOTU with **32 in / 30 out** (`duplex`) and no
`PLACEHOLDER server.…` line. Its warnings list each placeholder sound
still left, each empty music folder, any VBR MP3 without a length header
and The Fan Closet reaching no speaker (expected until it is placed); its
`priority :`, `sidechain:` and `music    :` lines show the ducking and
every playlist's file count. Then, with the router up:

```powershell
cd C:\loom\stagehand
uv run stagehand announce --config trapped.desktop.yaml "Test."               # chime + the line on announce.to
uv run stagehand sounds play printer_grind --config trapped.desktop.yaml      # one story sound
uv run stagehand sounds stop --announce --config trapped.desktop.yaml         # stop everything
uv run stagehand music scene doors --config trapped.desktop.yaml              # the soundtrack (§3.6)
uv run stagehand music status --config trapped.desktop.yaml
uv run stagehand music stop --config trapped.desktop.yaml
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
  even if it was tested on the Mac: ASIO's channel order is not Core
  Audio's (§3.2). **The sub** (`living-sub`, output 3): its 🔈 Test is a tone
  around 440 Hz and the speaker's name, which the sub's own low-pass
  mostly removes, so expect little from it. Test it with music instead:
  a track in `music\act-1\`, `music scene act_1`, and the bass comes from
  the sub. Set its level with its own trim on the Audio tab (a trim is
  heard at once, even on the music). Place **The Fan Closet's speaker**
  when it is cabled: its output, 🔈 Test, then tick its cell on the TV row
  (input 3) of the matrix, Save to project; the router re-reads
  `audio.json` and the dryer loop starts there during a scene.
- **The TV route** (after §3.5): `music scene act_1`, then a TEST VOICE on
  the TV (⚙). Trabolta comes out of the living room, the kitchen and The
  Optical Drive, **not** the TV's own speakers, once, and the music dips
  under him on every speaker, the sub too. Talk into Clippy's mic: the
  living room's music dips, the kitchen's does not. `stagehand music
  status` after the next health (up to a minute) shows inputs 1 and 3
  over their thresholds on its `inputs` line (and `ducking  : trabolta …`
  if he is speaking at that moment). Then
  `music stop`.
- **Lights**: nothing to place. `lights.json` already holds every bulb of
  §5.4 and the living-room strip, each in its room with its `device` name,
  its safety flag and its floor, plus the zones (`living`, `kitchen`,
  `fan-closet`, `ram`, `paths` = the halls and bathrooms, `rooms`,
  `room-bulbs`, `house`, `heart`) and every look. The job is: pair each
  bulb under its name (§5), set up the strip (§6), then walk it in Run →
  House below. If a bulb hangs somewhere else in the room, drag it on the
  map editor's **💡 Lights** tab (the height `y` is in the house frame: the
  basement is below 0), **Save**, **💡 Identify** it (a bulb does Z2M's
  `okay` blink; the strip blinks), then **Save to project**. The module
  only knows saved lights. The project gets the new `lights.json` only from
  a `sync-show --replace-lights` (a plain sync keeps the project's old copy,
  which has only the server-room bulb); before any later replace, Download
  JSON what was saved to the project and commit it into the repo.
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
    <look>` in the story plays `lights.json`'s look of that name). Every
    story `lights_*` look and every `heart_*` look is there, a DRAFT to
    retune on site: play each one with **▶ Test on the house**, adjust it
    if needed, **Save**, then **Save to project**.

  Done when Setup is green (🔊, 💡, 🧠), Checks has every light and every
  look walked (*heard it* / *nothing*), and every look has been played on
  the real bulbs from the Cue designer.

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
→ *Make this my main display*) and use `-Display 1`. Sound: Chrome's
output is VoiceMeeter Input, summed into the 828x's input 3 by the
router's `audio.tap`, so Trabolta plays on the house speakers and not on
the TV's own (§3.5; VoiceMeeter running, the TV's volume down).
`M` mutes the TV voice; Run → Terminals shows it.

## 10. Show night

1. Power on the 828x **before** the PC (or replug its USB after), then
   the PC; let it sign in. Mosquitto
   (service), Zigbee2MQTT (boot task), `show` + `lights` + `audio`
   (sign-in tasks) and the TV (if `-InstallTask`) start by themselves.
2. `.\preflight.ps1` — power, Windows Update, sign-in, the broker's two
   listeners, the COM port, `zigbee2mqtt/bridge/state`, `stagehand check
   --only show,lights,audio`, the tasks, the retained `health/stagehand`,
   `health/lights` and `health/audio`, the MOTU's ASIO line, the server's
   `/api/health`, the TV kiosk, then `showctl preflight desktop` (set
   `$env:LOOM_MOD_CODE` in that window first), and a warning for each
   empty music folder. Exit 1 on any FAIL. With the router on the MacBook
   tonight: `.\preflight.ps1 -NoAudio`.
3. Run → House → Setup: 🔊, 💡 and 🧠 all green. Run → Terminals: the TV
   live.
4. The sound: `uv run stagehand music status --config
   trapped.desktop.yaml` answers with no `no files :` line (scene `off`
   or none before the doors; `doors` once Power On plays). A TV TEST
   VOICE plays on the house speakers and ducks the music, and not from
   the TV's own speakers (§8). Close the TV's ⚙ afterwards.

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
3. Copy `stagehand\media\sounds\`, `media\library\` and `media\music\`
   to the MacBook (or render the library there: `sounds library --story`).
4. Walk every speaker with 🔈 Test again (Core Audio's channel order).
   The fallback is **output-only on purpose** (`passthrough: false` in
   `trapped.macbook.yaml`): nothing is routed from the TV's input and
   nothing ducks under Trabolta or Clippy (announcements still duck the
   music, takeover tracks still silence it). So set Chrome's output back to
   the TV's HDMI here and turn the TV's volume up (§3.5), or Trabolta is
   not heard.
5. Preflight with the fallback flag on both machines: `.\preflight.ps1
   -NoAudio` here (it runs `showctl preflight desktop --router macbook`),
   `pnpm showctl preflight macbook --router macbook` there.

To come back: `uv run stagehand launchd uninstall --job audio` on the
MacBook, then `.\start-stagehand.ps1 -Restart audio` here, and Chrome's
output back to VoiceMeeter Input with the TV's volume down (§3.5).

## 12. When something is wrong

| Symptom | Look | Fix |
|---|---|---|
| No announcements anywhere | `.\preflight.ps1`: `health/stagehand`, `health/audio`; Run → House → Setup | the `show` job (`.\start-stagehand.ps1 -Restart show`), the router (`-Restart audio`), the broker (`.\setup-mosquitto.ps1 -Check`); in the fallback, the MacBook's router (`uv run stagehand launchd status --job audio` there) and its `:1884` password |
| No sound at all, Setup says *no audio interface* | `.\start-stagehand.ps1 -Status` (the audio log); `$env:SD_ENABLE_ASIO='1'; uv run python -m sounddevice` | the 828x powered and on USB, MOTU's driver (§3.1), `audio.device` in `trapped.desktop.local.yaml`; then `-Restart audio` |
| *LAYOUT MOVED* / other channel counts | the audio log; the 828x's settings | §3.2: 48 kHz, internal clock, both optical ports on ADAT, Main and Phones not mirrored |
| Clicks or dropouts (the Setup row counts xruns) | the audio log | the 828x's clock on Internal; close other audio apps; the USB cable straight into the PC; USB power saving off (§1) |
| A sound plays on the wrong speaker | 🔈 Test on the map's Audio tab | the speaker's output channel on the Audio tab (ASIO's numbering), Save to project |
| A bulb ignores the story | `health/lights`, `.\zigbee2mqtt.ps1 -Check`; Setup's 💡 row | `.\start-stagehand.ps1 -Restart lights`; the Z2M friendly name = the light's `device`; a moved stick has a new `COMn`: fix `serial.port` in `C:\zigbee2mqtt\data\configuration.yaml`, then `Start-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt` |
| A bulb shows *offline* in Z2M | its wall switch / breaker | switch it on (power-on behaviour brings it back lit); too far from any other mains bulb: move it or add one between |
| The WLED strip ignores the story | `mosquitto_sub … -t 'wled/#' -v`; its page → Info | MQTT connected (Info shows it); broker `192.168.8.10`, port `1884`, user `props`; the device topic = the light's `device` |
| A job keeps dying | `.\start-stagehand.ps1 -Status` (the log) | `.\start-stagehand.ps1 -Stop <job>`, then `-Foreground <job>` to watch it in a window |
| `config error` / CHANGE-ME | `.\start-stagehand.ps1 -Check` | `stagehand\trapped.house.local.yaml` (§7) |
| The TV is silent | Run → Terminals (muted?); the house speakers (Trabolta plays there, not on the TV, §3.5) | `M` unmutes; Chrome's output on VoiceMeeter Input, VoiceMeeter running; reopen with `.\tv-kiosk.ps1` (autoplay flag) |
| No music, TIDAL | The audio log: `tidal PROBLEM: <why>`, `falls back to its files`; TIDAL's clock moving? | `.\tidal.ps1 -Check`; `.\tidal.ps1` (restarts the app; it picks the playlist up from its top); AUX strip on B2 only (§3.7) |
| No music | `uv run stagehand music status --config trapped.desktop.yaml`: the scene, `no files :` | no scene (■ Stop house sounds, or no act cue yet): `music scene <the current act>`; an empty folder: copy the MP3s into `media\music\<act>\` (they join at the next pass, or `music next`); `stagehand check --only audio` for a VBR MP3 that stops early |
| The music doesn't duck under Trabolta | `music status`: input 3 on the `inputs` line after he talks (`—` means an output-only stream) | VoiceMeeter running; Chrome's output on VoiceMeeter Input; the VAIO strip on B1; the health line's `tap` part (`NOT OPEN`? its peak?) (§3.5); the level over −45 dBFS; `passthrough: true` (the house file; the MacBook fallback never ducks) |
| The music doesn't duck under Clippy, or stays ducked in the living room | `music status`: input 1's peak with the lav idle | the receiver into Mic/Gtr 1; `audio.sidechain.roles.clippy.threshold_db` about 6 dB over the idle peak (§3.6), then `-Restart audio` |
| Trabolta heard twice (an echo in the living room) | the TV's volume; Windows' Volume mixer; VoiceMeeter's VAIO strip; CueMix | Chrome off HDMI and the TV's volume down; every A button off on the VAIO strip (B1 only); input 3 in no CueMix mix (§3.5) |
| Trabolta not heard on the house speakers | Volume mixer: Chrome's output; VoiceMeeter's VAIO meter; the audio log's `tap` part (`NOT OPEN`, peak) | VoiceMeeter running (Run on Windows Startup); Chrome to VoiceMeeter Input; the VAIO strip on B1; `stagehand check --only audio` finds the tap, then `.\start-stagehand.ps1 -Restart audio`; the TV row of the Audio-tab matrix ticked for each speaker |
| The Fan Closet is silent | the map's Audio tab; `music status` (`no files : fan_closet`) | place its speaker (§8); render the library (`sounds library --story`, or `.\start-stagehand.ps1`) |
| A howl, a hum or a buzz on every speaker (the TV route) | mute the VAIO strip in VoiceMeeter: if it stops, it is the TV's route (while it is muted Trabolta is heard nowhere: Chrome back to HDMI and the TV's volume up) | no ground loop any more (no cable); a howl: Chrome's output must not be the MOTU, VoiceMeeter's A1 an unused MOTU pair and every A button off on the VAIO strip, input 3 in no CueMix mix, and in Windows' Sound → Recording no device has *Listen to this device* ticked. To cut the route: untick the TV row (input 3) on the map's Audio tab and 💾 Save speakers (the router follows at once), or mute the VAIO strip. ■ Stop house sounds never touches the route |
| Every house sound must stop now | — | Run → ■ Stop house sounds; or `uv run stagehand sounds stop --announce --config trapped.desktop.yaml` here (the music too, until the next act's cue or `music scene <name>`). The TV's voice still plays through the house: mute it with `M` on the TV page or Run → Terminals |

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
