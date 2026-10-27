# The house speaker router on John's MacBook (the fallback)

> **Since 2026-10-27 the router runs on John's Desktop** (Windows, the MOTU
> 828x over USB 2 and ASIO): [`scripts/house-desktop/README.md`](../house-desktop/README.md)
> §3 and §7. This page is the **fallback**: use it only if the 828x won't
> run under ASIO there, or the Desktop dies. The Desktop README's §11 says
> how to switch (stop the Desktop's `audio` task first: only one machine
> may run the router). On a normal night this Mac runs Trabolta
> ([`trabolta.md`](./trabolta.md)) and no `audio` job.

The house speakers are driven by **one** program: stagehand's speaker
router (the `audio` module, its own launchd job). It plays every story
`sound X` and every house announcement (`do announce "…"`: a chime and the
spoken line, "the house system" in the fiction, never a character or a
device) through the **MOTU 828x + an 8-channel ADAT expander**. QLab is not
part of the rig, and the old `alexa` announcement player is retired (its
module code stays in stagehand; *Retire the alexa job* below).

**Where it runs in the fallback.** The router and the MOTU move to **John's
MacBook** (macOS), beside Ollama and Trabolta's `agents` worker. The rest of
the house rig (Mosquitto, Zigbee2MQTT, the stagehand `show` and `lights`
jobs, the TV) stays on **John's Desktop** (Windows), so this Mac's router
dials the Desktop's broker over the LAN. Only one machine may run the
router.

```
story  sound printer_grind   ─┐ the mod feed (sim directive sfx), read by the router itself
                               ├─► stagehand audio (this job, on the MacBook)
story  do announce "…"        ─┤   Desktop's stagehand show → MQTT show/announce {"text": "…"}
story  sound announce_chime   ─┘   Desktop's stagehand show → MQTT show/chime
        │                          (the Desktop's Mosquitto, LAN listener :1884, user props)
        ▼  one output stream on the 828x (audio.json: 24 in / 22 out used)
   voices:  media/sounds/<name>.wav → the audio.json cue's speakers
   announce: chime + macOS `say` (Samantha) → audio.json announce.to,
             the story's sounds ducked −12 dB under it (never dance_song,
             rave or hand_jive)
   tests:   the map editor's 🔈 → a tone + the speaker's name
   stops:   Run's ■ Stop house sounds / a host phone / show/audio/stop
```

**Announcements need both machines.** The router hears `do announce` only
as MQTT from the Desktop's `show` job, on the Desktop's broker. With that
broker or that job down, nothing is spoken (only the tent's `&announce=1`
terminal still says them). Story sounds do not take this path: the router
reads the server's feed itself.

Where everything is:

- **What the speakers are, which output each is on, where each sound goes,
  where the announcements play**: the event's `audio.json`, edited on the
  map editor's **Audio** tab (`/reinstall/map`, help *The house map* →
  *The Audio tab*). The repo's copy is
  `core/examples/trapped-in-the-internet/audio.json`.
- **What the router may do**: the `audio:` section of
  `stagehand/trapped.house.yaml` (play_sounds, announce, passthrough off,
  the voice). The MacBook runs **`stagehand/trapped.macbook.yaml`**, which
  `extends:` the house file, drops its `show:` section (the Desktop runs
  it) and points `audio.mqtt` at the Desktop's broker (`192.168.8.10:1884`,
  user `props`).
- **Secrets** (git-ignored, beside the YAML): `trapped.house.local.yaml`
  holds `server: { event, mod_passcode }`; `trapped.macbook.local.yaml`
  holds the broker password, `audio: { mqtt: { password: "…" } }`.
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
5. **The MacBook's own sounds**: System Settings → Sound → *Play sound
   effects through* the internal speakers, and keep the **internal speakers
   the default output**, so a browser tab, the director's Run console or a
   notification never lands on Analog 1–2 (the living-room speakers). Turn
   on Do Not Disturb for the night.
6. **The CoreAudio name**: `cd stagehand && uv run python -m sounddevice`.
   `audio.json` `device.name` is the substring `828x`; if the device shows a
   name without it, fix `device.name` on the Audio tab (or set `device:` in
   `trapped.macbook.local.yaml`'s `audio:` section).

## Retire the alexa job, switch the router on (once)

1. `scripts/house-macbook/install-alexa.sh --uninstall` (or
   `launchctl bootout gui/$UID/com.mapsandducks.stagehand-alexa`, then
   remove `~/Library/LaunchAgents/com.mapsandducks.stagehand-alexa.plist`).
   The router and alexa share one voice lock, so a leftover alexa agent
   would block the router's announcements (the router logs
   `announce: blocked`; its sounds still play).
2. `git pull`, then the **secrets** beside the tracked YAML:
   ```yaml
   # stagehand/trapped.house.local.yaml
   server: { event: <the live event's id>, mod_passcode: "<the mod passcode>" }
   # stagehand/trapped.macbook.local.yaml
   server: {}
   audio: { mqtt: { password: "<the props password>" } }
   ```
   An old `stagehand/house.yaml` copy (the alexa runbook had you make one)
   is read by nothing: take its event id and passcode into the overlay, then
   `mv stagehand/house.yaml stagehand/house.yaml.retired`. Without the
   server overlay the router can't long-poll the server: Run's ■ Stop house
   sounds never reaches it, and it routes from `config_file` alone.
3. A MacBook that used to run the whole rig still has a `show` (and maybe a
   `lights`) launchd job. Those run on the Desktop now; remove them here or
   every cue fires twice: `uv run stagehand launchd uninstall --job show`
   (and `--job lights`). `uv run stagehand launchd status` lists what is left.
4. The sound files:
   `cd stagehand && uv run stagehand sounds placeholders --config trapped.macbook.yaml`
   writes a labelled placeholder per story sound (a distinct tone, then
   "Placeholder. printer grind."). Drop the real files in
   `stagehand/media/sounds/` as they arrive: a real file always wins, and the
   generator never touches one.
5. `uv run stagehand check --config trapped.macbook.yaml --only audio` — it
   shows the device's 32 / 30 against audio.json's 24 / 22 and fails if the
   layout moved; its warnings list every placeholder still there (the
   pre-show gate: none on the night). It must print **no `PLACEHOLDER
   server.…` line** (else step 2's overlay is missing). A warning that
   *the cached audio.json … is older than config_file* means an old
   router's cache is still there: delete
   `~/Library/Caches/stagehand-audio/audio.json` and run it again.
6. `uv run stagehand launchd install --job audio --config trapped.macbook.yaml`.
7. On the Desktop, restart its `show` job once the router is up
   (`.\start-stagehand.ps1 -Restart show`), so the cue map matches.
8. On the map editor's Audio tab, 🔈 Test each speaker, then
   `uv run stagehand announce --config trapped.macbook.yaml "Test."` and
   `uv run stagehand sounds play printer_grind --config trapped.macbook.yaml`.

**Rollback:** reinstall alexa (`scripts/house-macbook/install-alexa.sh`
with a YAML that has an `alexa:` section and `audio.announce: false`), then
restart the Desktop's `show` job. Only for a house without the router.

## Lock down the broker

Anyone on the house Wi-Fi who can reach Mosquitto can publish
`show/announce` (the speakers say it — clipped to 300 characters),
`show/audio/play` (a sound), `show/audio/stop` or a sensor topic (a story
signal). So the broker has two listeners: anonymous on `127.0.0.1:1883`
for what runs on the broker's own machine, and password-only on the LAN at
`:1884` (user `props`) for everything else.

**For Oct 31 the broker is on John's Desktop**, set up by
`scripts/house-desktop/setup-mosquitto.ps1` (the Desktop README's §2): the
Desktop's `show` and `lights` jobs and Zigbee2MQTT use the loopback
listener; this MacBook's router, the WLED controllers and any network prop
dial `192.168.8.10:1884` as `props`.

If the broker ever runs on a Mac instead (a bench, or a fallback with the
Desktop down), the same layout in `/opt/homebrew/etc/mosquitto/mosquitto.conf`:

```
per_listener_settings true

listener 1883 127.0.0.1
allow_anonymous true

listener 1884
allow_anonymous false
password_file /opt/homebrew/etc/mosquitto/passwd
```

`mosquitto_passwd -c /opt/homebrew/etc/mosquitto/passwd props`, then
`brew services restart mosquitto`. Check, from another machine:
`mosquitto_pub -h <broker> -p 1883 -t show/announce -m hi` must be refused.
(A separate SSID for the props works too.)

The MacBook must **auto-log-in** its user (System Settings → Users &
Groups) and never sleep on the night (plugged in; `caffeinate -dims` in a
terminal, or Battery → Options → *Prevent automatic sleeping*): every
stagehand job is a per-user LaunchAgent (CoreAudio needs the logged-in
session).

## On the night

- **Log:** `tail -f ~/Library/Logs/stagehand/audio.log` — each sound logs
  `sound X → <speakers> (<why>) out <channels>`, each announcement
  `announce … via device-say`; the health line every minute carries the
  device, voices, xruns, `LAYOUT MOVED` and any placeholder.
- **Restart:** `uv run stagehand launchd restart --job audio` (a story
  restart already fades every sound; restarting the job does not touch the
  story). Never `pkill -f "stagehand run"`: it also kills Trabolta's worker.
- **Stop all house sounds:** Run → **■ Stop house sounds** (the header, on
  every Run tab) or the *House sound* card, a host phone's dock, or the
  director phone. Every story sound and speaker test fades over 0.3 s;
  *+ announcements* also cuts the line being said and empties the queue.
  It is one-shot (the next `sound X` plays), never journaled, and leaves the
  TV voice, the terminals, the live mics and the story clock alone (the
  dance still starts on time). With the uplink down:
  `uv run stagehand sounds stop [--announce] --config trapped.macbook.yaml`.
- **House internet down → fire by hand** (the router can't hear the
  story, but the broker, the router and `say` are on the LAN):
  `uv run stagehand sounds play dance_song --config trapped.macbook.yaml`
  (`--to living` for other speakers than its cue's), and
  `uv run stagehand announce --config trapped.macbook.yaml "Go to the living room."`.
  Both publish on the Desktop's broker and then read the retained
  `health/audio`: with no router online they say *no router is listening*
  and exit 1 (the message is not kept, so restart the `audio` job and send
  it again).
- **Health:** retained `health/audio` = `online` / `lost`; the stats on
  `health/audio/stats`. The Desktop's `preflight.ps1` reads both.

## Acceptance

`scripts/accept/K-20.sh` walks it through the router:
`devices` → `check` (32 / 30, no layout move) → `install` (the `audio`
job) → `announce` (chime + line on announce.to) → `chime` → `play` one
placeholder → `stop` → `MOD_CODE=… story` (fire `call_to_the_desktop` on
a rehearsal: chime + line within 3 s). Its default config is
`trapped.macbook.yaml` (this fallback); with the router on the Desktop (the
default), walk the same steps there with `--config trapped.desktop.yaml`
(`scripts/house-desktop/README.md` §7).
Then ■ Stop house sounds from Run, from a host phone, and over MQTT with
the uplink down.
