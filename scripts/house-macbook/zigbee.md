# Zigbee2MQTT and pairing the server-room bulb

The house's Zigbee bulbs, plugs and buttons talk to **Zigbee2MQTT** (Z2M),
which talks to Mosquitto on the same machine. Stagehand never speaks
Zigbee: the `show` job and the `lights` job publish to Z2M's MQTT topics
(`zigbee2mqtt/<device>/set`) and read its bridge topics.

**Where it runs.** For Oct 31, Z2M, Mosquitto and the `show` + `lights`
jobs run on **John's Desktop (Windows)**. Install Z2M there with
[`scripts/house-desktop/README.md`](../house-desktop/README.md) §3, then
come back here for **steps 5–9** (the lights job, pairing, checking,
placing, backing up), which are the same on any machine. The house's
other bulbs (Philips Hue and ThirdReality ZL1: how to reset each, names,
`power_on_behavior`, groups) and the WLED strip are in the Desktop
README's §5–6. Steps 1–4 are
the macOS install, for a bench Mac or a fallback with the Desktop down.
On Windows, `mosquitto_pub` / `mosquitto_sub` are
`"C:\Program Files\mosquitto\mosquitto_pub.exe"` / `…_sub.exe`, and the
stagehand commands take `--config trapped.desktop.yaml`.

```
Zigbee bulbs ─radio─► TI CC2652P stick (USB) ─serial─► Zigbee2MQTT ─► Mosquitto 127.0.0.1:1883
                                                                        ▲        ▲
                                                stagehand show (scenes) ┘        └ stagehand lights (lights.json)
```

The coordinator is the **Zigbee 3.0 USB dongle, 20 dBm, TI CC2652P +
CP2102N, Z-Stack 3.x.0 preloaded**: no flashing needed. The CC2652P is the
radio, the CP2102N the USB-serial bridge in front of it.

**If Z2M already runs here with paired house bulbs, keep its `data/`
folder.** A new network key or PAN id means re-pairing every bulb in the
house. Only a first install generates them (step 3), and they are backed up
once, right after (step 9).

## 1. The stick (macOS)

- Plug it into a **USB 2.0 extension cable** (1 m or more), away from the
  Mac, its USB 3 ports, SSDs and the Wi-Fi router. USB 3 radiates right in
  Zigbee's 2.4 GHz band; a stick in the back of the Mac drops commands.
- Find its port:

  ```bash
  ls /dev/cu.*
  # /dev/cu.usbserial-14310   ← the CP2102N with Apple's own driver (recent macOS)
  # /dev/cu.SLAB_USBtoUART    ← the same, with Silicon Labs' VCP driver installed
  ```

  Use whichever is there. Recent macOS drives the CP2102N itself; you only
  need Silicon Labs' CP210x driver if nothing appears, and never both
  (two drivers fight over the port). On macOS always use **`/dev/cu.*`,
  never `/dev/tty.*`**: opening a `tty.` device waits for a carrier signal
  the stick never raises, and Z2M hangs at "Connecting to adapter".
- The name carries the stick's serial, so it stays the same in any port of
  the same hub. Moving it to another hub can change it: re-check after.

## 2. Install Zigbee2MQTT (2.x, macOS)

Node 20 or 22:

```bash
mkdir -p ~/opt && cd ~/opt
git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git
cd zigbee2mqtt
pnpm install --frozen-lockfile
pnpm run build
```

## 3. `data/configuration.yaml` (first install only)

```yaml
homeassistant:
  enabled: false
mqtt:
  base_topic: zigbee2mqtt          # stagehand's lights.z2m_base
  server: mqtt://127.0.0.1:1883    # Mosquitto's anonymous loopback listener
serial:
  port: /dev/cu.usbserial-14310    # yours, from step 1
  adapter: zstack                  # the CC2652P runs Z-Stack
advanced:
  network_key: GENERATE            # Z2M writes the real values back on first start
  pan_id: GENERATE
  ext_pan_id: GENERATE
  channel: 25                      # HW-NET-01: 15, 20 or 25 (see below)
  transmit_power: 20               # the stick's 20 dBm; lower it if a near bulb misbehaves
  log_level: info
frontend:
  enabled: true
  port: 8080                       # http://<this machine>:8080
availability:
  enabled: true                    # a bulb on a dead switch shows offline
```

- **The channel.** Zigbee and 2.4 GHz Wi-Fi share the band. Zigbee 15, 20
  and 25 sit between Wi-Fi channels 1, 6 and 11; pick the one furthest from
  the house Wi-Fi's 2.4 GHz channel (HW-NET-01) and **never change it
  later**: a channel change makes most bulbs drop off until re-paired.
- **`GENERATE`**: on the first start Z2M replaces the three `GENERATE`s with
  random values in this file. Those values *are* the network. Back them up
  (step 9); never commit them.
- Z2M 2.x no longer reads `permit_join` from the file: joining is opened on
  demand (step 6).

Start it once by hand and watch it connect:

```bash
cd ~/opt/zigbee2mqtt && pnpm start
# … "Zigbee2MQTT started!"
mosquitto_sub -h 127.0.0.1 -t zigbee2mqtt/bridge/state -C 1
# {"state":"online"}
```

## 4. Run it as a LaunchAgent (macOS)

`~/Library/LaunchAgents/com.mapsandducks.zigbee2mqtt.plist` (start at login,
restart on exit; log to `~/Library/Logs/zigbee2mqtt.log`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.mapsandducks.zigbee2mqtt</string>
  <key>WorkingDirectory</key><string>/Users/<you>/opt/zigbee2mqtt</string>
  <key>ProgramArguments</key><array><string>/opt/homebrew/bin/node</string><string>index.js</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/<you>/Library/Logs/zigbee2mqtt.log</string>
  <key>StandardErrorPath</key><string>/Users/<you>/Library/Logs/zigbee2mqtt.log</string>
</dict></plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mapsandducks.zigbee2mqtt.plist
launchctl kickstart -k gui/$(id -u)/com.mapsandducks.zigbee2mqtt   # restart
```

(`which node` gives the node path; with nvm use that version's full path.)

## 5. The lights job before pairing

*Pair new device* in the map editor goes through stagehand's `lights` job
(the server asks it to publish `permit_join`), so install it first
([`lights.md`](./lights.md)). On the Desktop the `lights:` section is
already on in `stagehand/trapped.desktop.yaml`:

```powershell
cd C:\loom\stagehand
uv run stagehand check --config trapped.desktop.yaml --only lights
uv run stagehand tasks install --job lights --config trapped.desktop.yaml
```

On a Mac, uncomment `lights:` in `stagehand/trapped.house.yaml`, then
`uv run stagehand launchd install --job lights --config trapped.house.yaml`.

`check` says *Zigbee2MQTT is not online* until step 3's start worked, and
names every `lights.json` fixture whose device Z2M doesn't have yet (the RGB
bulb, until step 6).

## 6. Pair the server room's RGB bulb

1. Open joining for two minutes: Run → House map → 🗺 → **💡 Lights** →
   *Pair new device* (or the Z2M frontend's *Permit join (All)*, or
   `uv run stagehand lights pair --config trapped.desktop.yaml`).
2. Put the bulb in **pairing mode by power-cycling it** at its switch:
   off/on about 5–6 times, ~1 s each, ending on (IKEA: 6 toggles; most
   Tuya / Gledopto: 3–5; ThirdReality ZL1: 5–6; a Hue bulb can't be reset
   this way: Touchlink, its serial number, a Hue dimmer or the Hue app, in
   the Desktop README's §5.2). It blinks when it resets. Keep it within a
   few metres of the stick for the pairing; it can move after.
3. The frontend (`:8080`) shows the new device as `0x…` and *interviewing*;
   wait for *successful*.
4. **Rename it `server_room_rgb`** (the `device` in `lights.json`): the
   frontend's device page → rename, or

   ```bash
   mosquitto_pub -h 127.0.0.1 -t zigbee2mqtt/bridge/request/device/rename \
     -m '{"from": "0x0017880100000001", "to": "server_room_rgb"}'
   ```
5. **`power_on_behavior: on`** (HW-SAFE-08: a flipped wall switch brings it
   back lit, never dark):

   ```bash
   mosquitto_pub -h 127.0.0.1 -t zigbee2mqtt/server_room_rgb/set -m '{"power_on_behavior": "on"}'
   ```
6. **Never add it to `house`** (or any group a house look reaches). It is
   the server room's only light and `lights.json`'s alone (wave 20, D10 /
   w20b Q10): `lights.json` addresses it by its own name, and nothing in
   `trapped.house.yaml` sends it or the `server_room` group anything, so it
   may stay that group's only member. To check what a group holds:

   ```bash
   mosquitto_sub -h 127.0.0.1 -t zigbee2mqtt/bridge/groups -C 1
   ```

Pairing closes on its own after the two minutes (or *Pair new device* →
close, `stagehand lights pair --seconds 0`).

## 7. Check it from the command line

```bash
mosquitto_pub -h 127.0.0.1 -t zigbee2mqtt/server_room_rgb/set \
  -m '{"state": "ON", "brightness": 200, "color": {"hex": "#00E5FF"}, "transition": 1}'
mosquitto_pub -h 127.0.0.1 -t zigbee2mqtt/server_room_rgb/set -m '{"effect": "okay"}'   # the identify blink
mosquitto_sub -h 127.0.0.1 -t zigbee2mqtt/server_room_rgb -C 1                            # its state
uv run stagehand lights devices --config trapped.desktop.yaml   # Z2M's list as the server sees it
```

Never send it `"state": "OFF"` by hand on the night: the story never does
(it is the room's only light and its safety light, floor 80 / 254), and
nothing would turn it back on
but a look.

## 8. Place it and test it

The map editor (`/reinstall/map`, Run → House map → 🗺) → **💡 Light**
tool → click in the Server Room (y ≈ −0.6 m, the basement ceiling: the
house frame is absolute) → the inspector's **device** picker shows
`server_room_rgb` from Z2M's list → caps fill in → **Save** → **💡
Identify** (the bulb does Z2M's `okay` blink) → the 💡 Lights tab → **▶ Test**
each `heart_*` look → **Save to project**.

## 9. Back up `data/` (right after pairing; HW-LIT-09)

```powershell
# Windows (the Desktop): stop Z2M first so the database is consistent
Stop-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt
Compress-Archive C:\zigbee2mqtt\data "$HOME\zigbee2mqtt-data-$(Get-Date -f yyyyMMdd-HHmm).zip"
Start-ScheduledTask -TaskPath \Loom\ -TaskName zigbee2mqtt
```

```bash
# macOS
tar czf ~/loom-ops/zigbee2mqtt-data-$(date +%Y%m%d-%H%M).tgz -C ~/opt/zigbee2mqtt data
```

`data/` holds the network key, the PAN ids and every paired device: with it
a dead machine or a reinstall is a restore, without it every bulb is
re-paired. Back it up again after any pairing, keep a copy off the machine,
and never commit it.

## When something is wrong

| Symptom | Look at |
|---|---|
| Z2M hangs at "Connecting to adapter" | Windows: the wrong `COMn` (`.\zigbee2mqtt.ps1 -Ports`); macOS: `/dev/tty.*` in `serial.port` (use `/dev/cu.*`); another program holds the port (`lsof /dev/cu.usbserial-*`); two CP210x drivers |
| `bridge/state` is `offline` | Windows: `.\zigbee2mqtt.ps1 -Check` and `C:\zigbee2mqtt\data\log\`; macOS: the LaunchAgent log. Mosquitto down (`.\setup-mosquitto.ps1 -Check` / `brew services list`) |
| A bulb is *offline* in the frontend | its wall switch is off (availability); too far from any mains-powered router device |
| Commands work, then drop | the stick next to USB 3 / the computer: use the extension; a loop faster than 1.5 s (`lights.json` warns) |
| The map editor lists no devices | the `lights` job is not running (`uv run stagehand tasks status --job lights` on Windows, `launchd status` on a Mac); `stagehand lights devices` |
