# The house lights job on the house Mac (wave 20)

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
- **Where Z2M is**: the `lights:` section of `stagehand/trapped.house.yaml`.
- **The code**: `stagehand/src/stagehand/lights/`.
- **Logs**: `~/Library/Logs/stagehand/lights.log`.
- **Health**: MQTT `health/lights` (`online`, `lost` on a crash) and
  `health/lights/stats` (retained: fixtures, looks, devices, last look, Z2M
  online / offline).

## Install (after Zigbee2MQTT runs: [`zigbee.md`](./zigbee.md))

1. Uncomment the `lights:` section at the bottom of
   `stagehand/trapped.house.yaml`.
2. Check, then install the job, then restart `show` (it now hands every
   look `lights.json` defines over to this job, `take_looks: true`):

   ```bash
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

```bash
uv run stagehand lights devices --config trapped.house.yaml                 # Z2M's devices, the module, the config
uv run stagehand lights test server-room-rgb --config trapped.house.yaml    # identify (the okay blink)
uv run stagehand lights test heart_wake --config trapped.house.yaml         # play a look
uv run stagehand lights test server-room-rgb --color '#FF0000' --brightness 200 --config trapped.house.yaml
uv run stagehand lights pair --seconds 120 --config trapped.house.yaml      # let a new device join (0 closes)
```

These go through the event server, so the job must be running and
connected; with the uplink down use `mosquitto_pub` (`zigbee.md` §7).

## What it does

- **Looks.** A `cue heart_wake` in the story plays `looks.heart_wake`: its
  steps at their offsets, `repeat` times or in a loop. A new look on the bulb
  stops the old one there. A `then: "restore"` look (the nag, the warning)
  gives the light back after: the door loop it interrupted restarts, else
  the last settled look comes back.
- **Safety.** A safety fixture (the RGB bulb) is never sent OFF and never
  below 40 / 254, whatever a look or a test says.
- **Catch-up.** After a restart of the job, a broker or feed reconnect, or
  a story reset / reload / go live, it reads the story (`/api/screen/state`):
  the alarm → `heart_alarm`; the door open in the heart sequence →
  `heart_door_open`; else the story's `Night.heart_look`; else `boot`
  (`heart_idle`). It keeps no state file of its own.
- **Offline.** It caches the last `lights.json` and `house.json` in
  `~/Library/Caches/stagehand-lights`, so a restart with the uplink down
  still plays (from the feed once it is back).

## When something is wrong

| Symptom | Look at |
|---|---|
| The bulb ignores the story | `lights.log` (`look … →` lines); `stagehand lights devices` (is the module online, is the device named `server_room_rgb`?) |
| A look plays twice / fights a scene | the `show` job was not restarted after the install (it still has a YAML rule for that cue); the bulb is still in the Z2M `server_room` group |
| Identify / Test does nothing | `stagehand lights devices` → module offline: `launchctl kickstart -k gui/$(id -u)/com.mapsandducks.stagehand.lights` |
| Pair new device does nothing | the same; or Z2M offline (`zigbee.md`) |
