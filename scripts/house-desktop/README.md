# John's Desktop (Windows): the house PC

The house rig used to be one "house Mac". For Oct 31 it is split across two
machines. This folder is the Windows half: what runs on John's Desktop, how
to set it up once, how to start it on show night, and what to do when
something breaks. The MacBook half (Ollama + Trabolta's `agents` worker, the
director's Run console, `ship` / `sync-show` / `showbackup`, and by default
the speaker router) keeps its macOS runbooks in `scripts/house-macbook/`.

| Machine | Runs |
|---|---|
| **John's Desktop** (Windows, this folder) | the **TV**: Chrome kiosk over HDMI, `view=tv`, spot `desktop-tv` · **Mosquitto**, the house broker (anonymous `127.0.0.1:1883`, password-only `props` on the LAN at `:1884`) · **Zigbee2MQTT** on the CC2652P stick (`COMn`) · stagehand **`show`** (cues to Z2M / WLED / MQTT, the sensors back, the `do announce` relay) and **`lights`** (`lights.json`, the server room's RGB bulb) · *optionally* the **`audio`** router + the MOTU 828x, once it is proven on Windows |
| **John's MacBook** (macOS) | Ollama `gpt-oss:20b` + stagehand `agents` (`laptop.yaml`) · the **`audio`** router + the MOTU 828x + ADAT by default (`stagehand/trapped.macbook.yaml`, dialling this PC's broker on `:1884`) · a director's Run console · `scripts/ops/` |
| Steph's laptop | the server-room terminal (Chrome) + the Grand Central M4 on USB |
| John's old laptop | the tent: `/terminal/?…&spot=tent&announce=1` |

**Announcements need both machines.** A story `do announce "…"` reaches the
speakers as: the server → this PC's `show` job → MQTT `show/announce` on
this PC's Mosquitto → the router (on the MacBook, over `:1884`) → the
speakers. With this PC's broker or `show` job down, nothing is spoken (only
the tent's `&announce=1` terminal still says them). `sound X` does not take
this path: the router reads the server's feed itself.

Everything below runs in **Windows PowerShell 5.1** (the one Windows ships;
no pwsh 7 needed). Run the scripts from this folder. If Windows refuses to
run them, once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

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
  (the old house Mac's) to this PC: the MacBook's `trapped.macbook.yaml`
  dials it, and so does every WLED controller. If you can't, put this PC's
  address in the MacBook's `trapped.macbook.local.yaml`
  (`audio: { mqtt: { host: … } }`).
- **Sign in by itself after a power cut**, or no job comes back:
  [Sysinternals Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)
  (or `netplwiz`).
- **Never sleep**: `.\preflight.ps1 -FixPower` (sleep, screen off, hibernate
  never on AC). No screen saver.
- **Windows Update → Pause updates** past Nov 1, and set active hours.
- **Do not disturb on** (Settings → System → Notifications), **system sounds
  off** (Sound → More sound settings → Sounds → *No Sounds*): the TV's audio
  leaves this PC, and a notification ping would play in the living room.

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

The props password goes into the MacBook's
`stagehand/trapped.macbook.local.yaml` (git-ignored) and each WLED
controller (Config → Sync Interfaces → MQTT: this PC, port 1884, user
`props`). Never into a tracked file, a doc or a chat.

## 3. Zigbee2MQTT on the CC2652P

The stick (TI CC2652P + CP2102N, Z-Stack preloaded) on a **USB 2.0 extension
cable**, away from USB 3 ports and the Wi-Fi router. Windows Update usually
installs the CP210x driver; if Device Manager shows it under *Other devices*,
install Silicon Labs' CP210x VCP driver.

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
re-pairing every bulb. Back up `data\` after the first start (never commit
it). `-WriteConfig` never overwrites an existing config.

Then follow `scripts/house-macbook/zigbee.md` from step 5 (the lights job before
pairing, pairing the bulb as `server_room_rgb`, `power_on_behavior: on`,
placing it in the map editor's 💡 Lights tab, ▶ Test, Save to project): the
MQTT commands there work the same with `"C:\Program Files\mosquitto\mosquitto_pub.exe"`.

## 4. stagehand (`show` + `lights`)

The secrets first: `C:\loom\stagehand\trapped.house.local.yaml` (git-ignored;
every machine file that extends the house file reads it):

```yaml
server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
```

Then:

```powershell
.\start-stagehand.ps1            # uv sync, check, install + start the show and lights tasks
.\start-stagehand.ps1 -Status    # both tasks + the last lines of each log
```

Each job is its own Task Scheduler task (`\Loom\stagehand-show`,
`\Loom\stagehand-lights`; `uv run stagehand tasks …` underneath, stagehand's
`tasks.py`), the Windows twin of the Mac's launchd jobs: started at sign-in in
your session, no console window, normal priority, restarted within a minute
if it dies. Logs: `%LOCALAPPDATA%\stagehand\logs\<job>.log`.

The config is `stagehand/trapped.desktop.yaml`. It **extends**
`trapped.house.yaml` (every show rule lives once, there) and adds the
`lights:` section and the router's Windows settings. Always pass `--only`
on this PC (`--only show,lights`): a bare `check` or `run` would start the
audio section too.

## 5. The TV

```powershell
$env:LOOM_MOD_CODE = '<the mod passcode>'   # this window only
.\tv-kiosk.ps1 -Setup        # Chrome, no kiosk, opens /terminal/?code=<mod>&spot=desktop-tv
```

In that window: check it took the TV spot; hold ⚙ for 2 s → device voice →
**Microsoft David** (or Mark) for Trabolta → TEST VOICE (Edge's "Natural"
voices are nicer but untested on `view=tv`). Close it. From then on the
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
Windows' default output — HDMI to the TV's speakers is simplest. `M` mutes
the TV voice; Run → Terminals shows it.

## 6. Show night

1. Power on, let it sign in. Mosquitto (service), Zigbee2MQTT (boot task),
   `show` + `lights` (sign-in tasks) and the TV (if `-InstallTask`) start
   by themselves.
2. `.\preflight.ps1` — power, Windows Update, sign-in, the broker's two
   listeners, the COM port, `zigbee2mqtt/bridge/state`, `stagehand check`,
   the tasks, the retained `health/stagehand`, `health/lights` and
   `health/audio` (the MacBook's router, through this broker), the server's
   `/api/health`, the TV kiosk, then `showctl preflight desktop` (set
   `$env:LOOM_MOD_CODE` in that window first). Exit 1 on any FAIL.
3. Run → Terminals: the TV live. Run → House map: 💡 lights module online.

## 7. If the router moves to this PC

Only once the MOTU 828x works on Windows (MOTU's legacy Windows driver over
USB 2; Thunderbolt on Windows is doubtful for this model). Prove it first:

```powershell
$env:SD_ENABLE_ASIO = '1'; cd C:\loom\stagehand; uv run python -m sounddevice
```

There must be one line like `… MOTU …, ASIO (32 in, 30 out)`. Under any other
host API (MME, DirectSound, WASAPI) the 828x is a row of stereo pairs the
router can't use. Put a unique part of that ASIO name in
`stagehand\trapped.desktop.local.yaml`:

```yaml
server: {}
audio: { device: "<part of the MOTU's ASIO name>" }
```

`trapped.desktop.yaml` already sets `host_api: asio` (which also sets
`SD_ENABLE_ASIO` before sounddevice loads) and the Windows voice
(`voice_engine: auto` → SAPI, `say_voice: Microsoft Zira Desktop`; a missing
voice falls back to the installed female one). Then:

1. On the MacBook: `uv run stagehand launchd uninstall --job audio` (two
   routers would each speak every announcement).
2. Here: `.\start-stagehand.ps1 -WithAudio`. `check --only audio` must show
   the device's 32 in / 30 out (audio.json's `device.expect`).
3. Walk every speaker with 🔈 Test in the map editor's Audio tab: ASIO's
   channel numbers may not be CoreAudio's.
4. `.\preflight.ps1 -WithAudio`.

`stagehand sounds placeholders` labels the placeholder sounds with SAPI
here, or generate them on the MacBook and copy `stagehand\media\sounds\`.
To go back: `.\start-stagehand.ps1 -Stop audio`, then reinstall the
MacBook's job.

## 8. When something is wrong

| Symptom | Look | Fix |
|---|---|---|
| No announcements anywhere | `.\preflight.ps1`: `health/stagehand`, `health/audio` | this PC's `show` job (`.\start-stagehand.ps1 -Restart show`), the broker (`.\setup-mosquitto.ps1 -Check`), the MacBook's router (`uv run stagehand launchd status --job audio` there) and its `:1884` password |
| The server-room bulb ignores the story | `health/lights`, `.\zigbee2mqtt.ps1 -Check` | `.\start-stagehand.ps1 -Restart lights`; a moved stick has a new `COMn`: fix `serial.port` in `C:\zigbee2mqtt\data\configuration.yaml`, then `Start-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt` |
| A job keeps dying | `.\start-stagehand.ps1 -Status` (the log) | `.\start-stagehand.ps1 -Stop <job>`, then `-Foreground <job>` to watch it in a window |
| `config error` / CHANGE-ME | `.\start-stagehand.ps1 -Check` | `stagehand\trapped.house.local.yaml` (§4) |
| The MacBook's router can't connect | its log: `Not authorized` / timeout | the props password in its `.local.yaml`; this PC's address (192.168.8.10?); the network Private (`.\setup-mosquitto.ps1 -SetPrivate`) |
| The TV is silent | Run → Terminals (muted?), Windows' default output | `M` unmutes; Settings → Sound; reopen with `.\tv-kiosk.ps1` (autoplay flag) |
| Every house sound must stop now | — | Run → ■ Stop house sounds; or `uv run stagehand sounds stop --announce --config trapped.macbook.yaml` on the MacBook |

The tasks by hand: `uv run stagehand tasks status|restart|stop|uninstall
--job show|lights|audio` from `C:\loom\stagehand`, or Task Scheduler → `Loom`.
Ending a task in Task Scheduler stops it until its keep-alive trigger
restarts it within a minute; `tasks stop` disables it first.
