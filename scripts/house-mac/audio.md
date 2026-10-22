# The house sound on the house Mac (wave 18b)

The house speakers are driven by **one** program: stagehand's speaker
router (the `audio` module, its own launchd job). It plays every story
`sound X` and every house announcement (`do announce "…"`: a chime and the
spoken line, "the house system" in the fiction, never a character or a
device) through the **MOTU 828x + an 8-channel ADAT expander**. QLab is not
part of the rig. The `alexa` announcement player is **retired for this
show**: its module code stays in stagehand, but its section and its launchd
job go (*Retire the alexa job* below).

```
story  sound printer_grind   ─┐ the mod feed (sim directive sfx)
                               ├─► stagehand audio (this job)
story  do announce "…"        ─┤   stagehand show → MQTT show/announce {"text": "…"}
story  sound announce_chime   ─┘   stagehand show → MQTT show/chime
        │
        ▼  one output stream on the 828x (audio.json: 24 in / 22 out used)
   voices:  media/sounds/<name>.wav → the audio.json cue's speakers
   announce: chime + macOS `say` (Samantha) → audio.json announce.to,
             the story's sounds ducked −12 dB under it (never dance_song,
             rave or hand_jive)
   tests:   the map editor's 🔈 → a tone + the speaker's name
   stops:   Run's ■ Stop house sounds / a host phone / show/audio/stop
```

Where everything is:

- **What the speakers are, which output each is on, where each sound goes,
  where the announcements play**: the event's `audio.json`, edited on the
  map editor's **Audio** tab (`/reinstall/map`, help *The house map* →
  *The Audio tab*). The repo's copy is
  `core/examples/trapped-in-the-internet/audio.json`.
- **What the router may do on this Mac**: the `audio:` section of
  `stagehand/trapped.house.yaml` (play_sounds, announce, passthrough off,
  the voice, MQTT).
- **The sound files**: `stagehand/media/sounds/<name>.wav` (or `.aiff` /
  `.aif` / `.flac`), git-ignored. `stagehand/media/sounds.yaml` (tracked)
  lists the 19 story sounds and what each real file should be.
- **The code**: `stagehand/src/stagehand/audio/`.
- **Logs**: `~/Library/Logs/stagehand/audio.log`.

## The 828x (install day, ≈ 30 min; do this first)

1. **Thunderbolt only** on an Apple Silicon Mac (MOTU lists the
   "828x (Thunderbolt only)"; a modern Mac needs Apple's TB3 → TB2 adapter).
   Startup Security: **Reduced Security** with *Allow user management of
   kernel extensions from identified developers*, then approve the MOTU
   kext. This is the biggest risk of the day: prove it before anything else.
2. **MOTU Audio Setup / CueMix FX**: 48 kHz, internal clock; Optical A =
   ADAT (the expander, both directions; set the expander's clock to ADAT so
   the 828x is the master); Optical B = ADAT (or leave it); **Main outs and
   Phones NOT mirrored**. The device then reports **32 in / 30 out**.
   Mirroring, 96 kHz or an optical port on TOSLink moves every channel after
   it; `audio.json` `device.expect` (32 / 30) makes `stagehand check` fail
   and the router log an error when that happens.
3. **Our channel numbers are the 828x's own** (no channel map): outputs
   Analog 1–8, Main 9–10, **ADAT A 15–22** (the expander); inputs Mic/Gtr
   1–2, Analog 3–10, **ADAT A 17–24**. Phones 11–12 and S/PDIF 13–14 are
   left unlabelled (the director's cue monitor is set in CueMix).
4. **Live mics are mixed in CueMix FX** (hardware: no latency, no microphone
   permission for a launchd job). The router opens an output-only stream
   (`passthrough: false`); CueMix sums the computer's playback with its mix
   on each output.
5. **The Mac's own sounds**: System Settings → Sound → *Play sound effects
   through* the internal speakers, and make HDMI (the TV) the default
   output, so Chrome's TV tab and alert sounds never land on Analog 1–2 (the
   living-room speakers).
6. **The CoreAudio name**: `cd stagehand && uv run python -m sounddevice`.
   `audio.json` `device.name` is the substring `828x`; if the device shows a
   name without it, fix `device.name` on the Audio tab (or set `device:` in
   the YAML's `audio:` section).

## Retire the alexa job, switch the router on (once)

1. `scripts/house-mac/install-alexa.sh --uninstall` (or
   `launchctl bootout gui/$UID/com.mapsandducks.stagehand-alexa`, then
   remove `~/Library/LaunchAgents/com.mapsandducks.stagehand-alexa.plist`).
   The router and alexa share one voice lock, so a leftover alexa agent
   would block the router's announcements (the router logs
   `announce: blocked`; its sounds still play).
2. `git pull`, then the **machine config**. The router and the `show` job
   both run `stagehand/trapped.house.yaml`; its event id and passcode are
   `CHANGE-ME` placeholders, and the real ones go in
   `stagehand/trapped.house.local.yaml` (git-ignored, merged over
   `server:`; it may hold only that mapping):
   ```yaml
   server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
   ```
   The old alexa runbook had you copy the YAML to `stagehand/house.yaml`
   with those values in it: take them from there into the overlay, then
   retire the copy (`mv stagehand/house.yaml stagehand/house.yaml.retired`;
   nothing reads it any more). See which file the `show` job runs:
   `plutil -p ~/Library/LaunchAgents/com.mapsandducks.stagehand.show.plist | grep -A1 -- --config`.
   If it names `house.yaml`, reinstall it on the tracked file:
   `uv run stagehand launchd install --job show --config trapped.house.yaml`.
   Without the overlay the router can't long-poll the server: Run's ■ Stop
   house sounds never reaches it, and it routes from `config_file` alone.
3. The sound files:
   `cd stagehand && uv run stagehand sounds placeholders --config trapped.house.yaml`
   writes a labelled placeholder per story sound (a distinct tone, then
   "Placeholder. printer grind."). Drop the real files in
   `stagehand/media/sounds/` as they arrive: a real file always wins, and the
   generator never touches one.
4. `uv run stagehand check --config trapped.house.yaml --only audio` — it
   shows the device's 32 / 30 against audio.json's 24 / 22 and fails if the
   layout moved; its warnings list every placeholder still there (the
   pre-show gate: none on the night). It must print **no `PLACEHOLDER
   server.…` line** (else step 2's overlay is missing). A warning that
   *the cached audio.json … is older than config_file* means the wave 17
   router's cache (16 / 16) is still there: `check` reads the layout off
   the repo's file, but the router would boot on the cache until the
   server answers, so delete `~/Library/Caches/stagehand-audio/audio.json`
   and run it again.
5. `uv run stagehand launchd install --job audio --config trapped.house.yaml`.
6. `uv run stagehand launchd restart --job show` (the cue map changed: no
   QLab rules).
7. On the map editor's Audio tab, 🔈 Test each speaker, then
   `uv run stagehand announce --config trapped.house.yaml "Test."` and
   `uv run stagehand sounds play printer_grind --config trapped.house.yaml`.

**Rollback:** check out the previous `trapped.house.yaml` and reinstall
alexa (`scripts/house-mac/install-alexa.sh`), then restart the `show` job.

## Lock down the broker

Anyone on the house Wi-Fi who can reach Mosquitto can publish
`show/announce` (the speakers say it — clipped to 300 characters),
`show/audio/play` (a sound), `show/audio/stop` or a sensor topic (a story
signal). Everything that talks to the broker anonymously runs on this Mac
(stagehand, Zigbee2MQTT), so bind that listener to localhost and give the
network props (the WLED controllers, any ESP prop) a password-only listener.
In `/opt/homebrew/etc/mosquitto/mosquitto.conf`:

```
per_listener_settings true

listener 1883 127.0.0.1
allow_anonymous true

listener 1884
allow_anonymous false
password_file /opt/homebrew/etc/mosquitto/passwd
```

`mosquitto_passwd -c /opt/homebrew/etc/mosquitto/passwd props`, then
`brew services restart mosquitto`, and point each WLED controller
(Config → Sync Interfaces → MQTT) at the Mac's LAN address, port 1884,
user `props`. The server-room ESP32 dials the same listener (its
`secrets.h`: `SR_MQTT_USER` / `SR_MQTT_PASS`); stagehand's `show` and
`audio` sections stay on `127.0.0.1:1883`. Check: from another machine,
`mosquitto_pub -h <mac> -p 1883 -t show/announce -m hi` must be refused.
(A separate guest SSID for the props works too.)

The house Mac must **auto-log-in** its user (System Settings → Users &
Groups) and never sleep: every stagehand job is a per-user LaunchAgent
(CoreAudio needs the logged-in session).

## On the night

- **Log:** `tail -f ~/Library/Logs/stagehand/audio.log` — each sound logs
  `sound X → <speakers> (<why>) out <channels>`, each announcement
  `announce … via device-say`; the health line every minute carries the
  device, voices, xruns, `LAYOUT MOVED` and any placeholder.
- **Restart:** `uv run stagehand launchd restart --job audio` (a story
  restart already fades every sound; restarting the job does not touch the
  story).
- **Stop all house sounds:** Run → **■ Stop house sounds** (the header, on
  every Run tab) or the *House sound* card, a host phone's dock, or the
  director phone. Every story sound and speaker test fades over 0.3 s;
  *+ announcements* also cuts the line being said and empties the queue.
  It is one-shot (the next `sound X` plays), never journaled, and leaves the
  TV voice, the terminals, the live mics and the story clock alone (the
  dance still starts on time). With the uplink down:
  `uv run stagehand sounds stop [--announce] --config trapped.house.yaml`
  (or `mosquitto_pub -t show/audio/stop -m '{}'`).
- **House internet down → fire by hand** (the show job can't hear the
  story, but the broker, the router and `say` are local):
  `uv run stagehand sounds play dance_song --config trapped.house.yaml`
  (`--to living` for other speakers than its cue's), and
  `uv run stagehand announce --config trapped.house.yaml "Go to the living room."`
  (or `mosquitto_pub -t show/announce -m '{"text":"Go to the living room."}'`).
  The `stagehand` commands look at the retained `health/audio` after
  sending: with no router online they say *no router is listening* and
  exit 1 (the message is not kept, so restart the `audio` job and send it
  again).
- **Health:** retained `health/audio` = `online` / `lost`; the stats on
  `health/audio/stats`.

## Acceptance

`scripts/accept/K-20.sh` walks it through the router (wave 18b):
`devices` → `check` (32 / 30, no layout move) → `install` (the `audio`
job) → `announce` (chime + line on announce.to) → `chime` → `play` one
placeholder → `stop` → `MOD_CODE=… story` (fire `call_to_the_desktop` on
a rehearsal: chime + line within 3 s). Then ■ Stop house sounds from Run,
from a host phone, and over MQTT with the uplink down.
