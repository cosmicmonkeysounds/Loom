# House announcements on the house Mac (K-20)

(The player is stagehand's `alexa` module — a code name kept for now; in
the show it is "the house system", never a character or a device.)

`do announce "…"` in the story → a chime and the spoken line in the
**living room (Z1) and the kitchen (Z2)**, from the house Mac (the one
that also drives the TV over HDMI, the MOTU, Mosquitto, Zigbee2MQTT and
stagehand). QLab only ducks the music: the same `do announce` also
fires its `duck_music` group cue (−12 dB over 0.3 s, ≈ 7 s hold, back over
1 s, on the bed / background group only — build it in the QLab workspace).

```
story  do announce "Go to the living room."
  → stagehand show (cue rule)        MQTT show/announce {"text": "…"}
  → stagehand alexa (this job)       chime ─────────────┐
       voice: macOS `say` (Samantha) rendered to a file ├─► MOTU ch 1/2 (Z1) + 3/4 (Z2)
              ──────────────────────────────────────────┘
       last resort: say -a <device>  (Z1 only — the device's first pair)
story  sound announce_chime          MQTT show/chime → the same chime
                                     (skipped if an announcement started or ended < 10 s ago)
  ↘ the screen state (/api/screen/state `announce`) → every wall terminal
    provisioned with &announce=1 chimes + says it in its own voice (N-09)
```

**The voice is the Mac's own** (`engine: say`, the default since
2026-10-15): no server round-trip, nothing to fetch or cache, and it works
with the house internet down. Pick the voice with `say_voice:` — `say -v '?'`
lists them; a downloaded *Enhanced* / *Premium* one (System Settings →
Accessibility → Spoken Content → System Voice → Manage Voices) sounds much
better than the stock Samantha. `engine: server` opts back in to the VPS's
voice (`/api/mod/tts`, only when it runs the bundled Kokoro —
`COMPOSE_PROFILES=tts`), cached on disk with `prewarm:`, `say` as the
fallback.

The code is the `alexa` module of stagehand
(`stagehand/src/stagehand/alexa/`); the config is the `alexa:` section of
`stagehand/trapped.house.yaml`.

## Set up (once, ≈ 10 min)

1. **Audio.** The MOTU is the Mac's output device; in Audio MIDI Setup
   pin it to 48 kHz. Z1 = outputs 1/2, Z2 = outputs 3/4 (B-4). No
   Multi-Output Device is needed: the player writes the same sound to
   channels 1–4 of the one interface (`channels: [1, 2, 3, 4]`). If the
   zones ever live on two different devices, build a Multi-Output Device
   in Audio MIDI Setup and name *that* in `device:` with `channels:`
   removed (or set to its channel numbers).
2. **Machine config.** `cp stagehand/trapped.house.yaml stagehand/house.yaml`
   (gitignored), then set `server.url: https://app.mapsandducks.com`,
   `server.event` (the live event id) and `server.mod_passcode` (the
   `show` job needs them; `alexa` with `engine: say` never calls the
   server), `alexa.device` to a unique part of the MOTU's name
   (`scripts/accept/K-20.sh devices`) and `alexa.say_voice` to the voice
   you picked.
3. **Install the agent.** `scripts/house-mac/install-alexa.sh` — validates
   the config, writes `~/Library/LaunchAgents/com.mapsandducks.stagehand-alexa.plist`
   from the template here, and loads it. It is a per-user **LaunchAgent**
   (CoreAudio needs the logged-in session), so the house Mac must
   **auto-log-in** that user (System Settings → Users & Groups) and never
   sleep.
4. **The show job must not run alexa too.** Run the show module with
   `--only show`. (If it doesn't, the second player finds
   `player.lock` held and stands by silently — no double voice — but fix
   the job anyway.)

5. **Lock down the broker.** Anyone on the house Wi-Fi who can reach
   Mosquitto can publish `show/announce` (the speakers say it — clipped to
   300 characters) or a sensor topic (a story signal). Everything that
   talks to the broker anonymously runs on this Mac (stagehand, Zigbee2MQTT),
   so bind that listener to localhost and give the network props (the WLED
   controllers, any ESP prop) a password-only listener. In
   `/opt/homebrew/etc/mosquitto/mosquitto.conf`:

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
   `alexa` sections stay on `127.0.0.1:1883`. Check: from another machine,
   `mosquitto_pub -h <mac> -p 1883 -t show/announce -m hi` must be refused.
   (A separate guest SSID for the props works too.)
6. **`stagehand check` probes the device.** It exits non-zero when
   `alexa.device` matches no output or several (a MOTU can expose more than
   one) — every play would otherwise fall back to `say`, maybe on the wrong
   zones. The player logs the same error at start.

## On the night

- **Log:** `tail -f ~/Library/Logs/stagehand-alexa.log` — every line logs
  `received`, then `via device-say` (the Mac's voice through the MOTU — the
  normal one), `via say-device` / `say-default` (the device path failed),
  or `via device` (the server voice, `engine: server` only).
- **Restart:** `launchctl kickstart -k gui/$UID/com.mapsandducks.stagehand-alexa`.
- **House internet down → fire by hand** (the show job can't hear the
  story, but the broker and this player are local, and `say` needs no
  network): `mosquitto_pub -t show/announce -m '{"text":"Go to the living room."}'`
  or `cd stagehand && uv run stagehand announce --config house.yaml "Go to the living room."`.
- **With `engine: server`** the four scripted lines are prewarmed (fetched
  at boot, kept in `~/Library/Caches/stagehand-alexa`) and anything else
  falls back to `say` after `tts_timeout` (4 s).
- **Health:** retained `health/alexa` = `online` / `offline` / `lost`.

## Acceptance

`scripts/accept/K-20.sh` walks it: `devices` → `local` → `offline` →
`install` → `mqtt` → `chime` → `MOD_CODE=… story` (fires
`call_to_the_desktop` on a rehearsal and times the hop: chime + line in
both rooms within 3 s).
