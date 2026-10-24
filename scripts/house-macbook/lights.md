# The house lights job (`lights`)

Stagehand's **`lights`** module turns the story's `cue <look>` into
Zigbee2MQTT and WLED commands, for every look the event's `lights.json`
defines. This wave's file holds one fixture: the server room's RGB bulb
`server_room_rgb` (Trabolta's heart). Every other light in the house is
still `trapped.house.yaml`'s `show` rules (scenes + WLED presets).

```
story  cue heart_wake ─► mod feed ─► stagehand lights ─► zigbee2mqtt/server_room_rgb/set (timed steps)
map editor 💡 Identify / ▶ Test / Pair new device ─► GET /api/mod/lights (long poll) ─► the same
zigbee2mqtt/bridge/devices ─► stagehand lights ─► POST /api/mod/lights/devices ─► the map editor's device picker
```

- **What the lights are, where they hang, what each look does**: the event's
  `lights.json`, edited on the map editor's 💡 Lights tab. The repo's copy is
  `core/examples/trapped-in-the-internet/lights.json`.
- **Where it runs**: on **John's Desktop (Windows)** for Oct 31, beside
  Zigbee2MQTT and Mosquitto, as the Task Scheduler task
  `\Loom\stagehand-lights` ([`scripts/house-desktop/README.md`](../house-desktop/README.md) §4).
  Its section is on in `stagehand/trapped.desktop.yaml`. On a Mac it is the
  commented-out `lights:` section of `stagehand/trapped.house.yaml` and a
  launchd job.
- **The code**: `stagehand/src/stagehand/lights/`.
- **Logs**: `%LOCALAPPDATA%\stagehand\logs\lights.log` (Windows),
  `~/Library/Logs/stagehand/lights.log` (macOS).
- **Health**: MQTT `health/lights` (`online`, `lost` on a crash) and
  `health/lights/stats` (retained: fixtures, looks, devices, last look, Z2M
  online / offline).

## Install (after Zigbee2MQTT runs: [`zigbee.md`](./zigbee.md))

1. On the Desktop: nothing to uncomment (`trapped.desktop.yaml` has the
   section). On a Mac: uncomment the `lights:` section at the bottom of
   `stagehand/trapped.house.yaml`.
2. Check, then install the job, then restart `show` (it now hands every
   look `lights.json` defines over to this job, `take_looks: true`):

   ```powershell
   # the Desktop (Windows); .\start-stagehand.ps1 in scripts\house-desktop does all of it
   cd C:\loom\stagehand
   uv run stagehand check --config trapped.desktop.yaml --only lights
   uv run stagehand tasks install --job lights --config trapped.desktop.yaml
   uv run stagehand tasks restart --job show
   uv run stagehand tasks status --job lights
   ```

   ```bash
   # a Mac
   cd stagehand
   uv run stagehand check --config trapped.house.yaml --only lights
   uv run stagehand launchd install --job lights --config trapped.house.yaml
   uv run stagehand launchd restart --job show
   uv run stagehand launchd status --job lights
   ```

   `check` fails (exit 3) with no broker, with Z2M offline, or with a
   fixture whose device Z2M doesn't have; it reads the local `config_file`
   (the repo's `lights.json`) or the last copy the job cached.
3. Run → House map: the 💡 row reads *lights module online*.

## By hand

On the Desktop use `--config trapped.desktop.yaml` (on a Mac,
`trapped.house.yaml`):

```bash
uv run stagehand lights devices --config trapped.desktop.yaml                 # Z2M's devices, the module, the config
uv run stagehand lights test server-room-rgb --config trapped.desktop.yaml    # identify (the okay blink)
uv run stagehand lights test heart_wake --config trapped.desktop.yaml         # play a look
uv run stagehand lights test server-room-rgb --color '#FF0000' --brightness 200 --config trapped.desktop.yaml
uv run stagehand lights pair --seconds 120 --config trapped.desktop.yaml      # let a new device join (0 closes)
```

These go through the event server, so the job must be running and
connected; with the uplink down use `mosquitto_pub` (`zigbee.md` §7).

## What it does

- **Looks.** A `cue heart_wake` in the story plays `looks.heart_wake`: its
  steps at their offsets, `repeat` times or in a loop. A new look on the bulb
  stops the old one there. A `then: "restore"` look (the nag, the warning)
  gives the light back after: the door loop it interrupted restarts, else
  the last settled look comes back.
- **Safety.** A safety fixture is never sent OFF and never below its floor
  (40 / 254 at least; the RGB bulb's is 80, since it is the server room's
  only light), whatever a look or a test says.
- **Catch-up.** After a restart of the job, a broker or feed reconnect, or
  a story reset / reload / go live, it reads the story (`/api/screen/state`):
  the alarm → `heart_alarm`; the door open in the heart sequence →
  `heart_door_open`; else the story's `Night.heart_look`; else `boot`
  (`heart_idle`). It keeps no state file of its own.
- **Offline.** It caches the last `lights.json` and `house.json` in
  `%LOCALAPPDATA%\stagehand\lights` (Windows) or
  `~/Library/Caches/stagehand-lights` (macOS), so a restart with the uplink down
  still plays (from the feed once it is back).

## When something is wrong

| Symptom | Look at |
|---|---|
| The bulb ignores the story | `lights.log` (`look … →` lines); `stagehand lights devices` (is the module online, is the device named `server_room_rgb`?) |
| A look plays twice / fights a scene | the `show` job was not restarted after the install (it still has a YAML rule for that cue); the bulb was added to the Z2M `house` group (a house look then reaches it) |
| Identify / Test does nothing | `stagehand lights devices` → module offline: `.\start-stagehand.ps1 -Restart lights` on the Desktop (`uv run stagehand launchd restart --job lights` on a Mac) |
| Pair new device does nothing | the same; or Z2M offline (`zigbee.md`) |
