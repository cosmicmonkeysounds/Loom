# The Desktop: where the lights stand (2026-10-29)

A status note for this PC. The full runbook is [`README.md`](./README.md),
starting at *Just the lights: the short path*.

## stagehand did not quit

`.\start-stagehand.ps1 -NoAudio` **installs** the jobs, prints their status
and the last log lines, then returns you to the prompt. The jobs keep
running in the background as scheduled tasks. That's why Run shows the
Desktop online.

Checked at 16:20:

| Task (`\Loom\`) | State |
|---|---|
| `stagehand-show` | Running: logged in to the event, show feed connected |
| `stagehand-lights` | Running: `lights.json` loaded (19 fixtures, 32 looks), the story's look playing |
| `zigbee2mqtt` | Running at boot, no window; `bridge/state` online; frontend http://localhost:8080 |

To see them at any time (from this folder):

```powershell
.\start-stagehand.ps1 -Status     # every task + the last log lines
.\zigbee2mqtt.ps1 -Check
.\setup-mosquitto.ps1 -Check
```

Logs: `%LOCALAPPDATA%\stagehand\logs\show.log` and `lights.log`;
Zigbee2MQTT's in `C:\zigbee2mqtt\data\log\`.

The `warning: fixture … no Zigbee2MQTT device` lines are expected: one per
bulb not paired and renamed yet. They go away one by one as you pair.

**The lights job protects Zigbee2MQTT** (2026-10-30). It keeps one command per
bulb in flight, so a loop can't build a backlog in Z2M. A bulb that stops
answering gets a probe every 30 s and picks up its newest state when it is
back (`lights.log`: *is not answering Zigbee*, *answers again*). If Z2M itself
goes silent for a minute, the job restarts its task and plays the story's look
again (*Zigbee2MQTT has not answered*). `health/lights/stats` counts
`z2m_restarts` and lists the `dark` bulbs. Because a looping look keeps sending,
a change you make in the Z2M frontend lasts only until its next step: for hand
work, `.\lights-reset.ps1 -Hold`, then `-Release` after.

```powershell
.\lights-reset.ps1            # is the chain well? (changes nothing)
.\lights-reset.ps1 -Hold      # the dashboard's changes stick; no look or cue plays
.\lights-reset.ps1 -Release   # the job again, on the story's look
.\lights-reset.ps1 -Reset     # restart Z2M and the job; safe during a show
.\lights-drill.ps1            # break each link and watch it heal; never during a show
```

## First bulb paired

One **ThirdReality ZL1** (`3RCB01057Z`) joined and was interviewed, still
under its address `0xb4e8429137d40000`. Next for it (README §5.4):

1. Z2M frontend → the device → rename (✏) to its room's name from the
   table, e.g. `living_1`.
2. *Exposes* → **Power-on behavior → `on`**.

Then pair the rest the same way, nearest the stick first, and back up
`C:\zigbee2mqtt\data\` when you are done (never commit it).

## Where the lights tools are

Run → House → 🔌 **Setup** is only the status view (module online, how many
lights, which bulbs Zigbee2MQTT doesn't know, 🔗 Pair a bulb). The working
tools are elsewhere:

1. **The Zigbee2MQTT frontend: http://localhost:8080.** Only on this
   Desktop (Z2M runs here, not on the VPS). Rename a bulb (its device page
   → ✏) and set *Exposes → Power-on behavior → `on`*.
2. **The map editor: https://app.mapsandducks.com/reinstall/map.** Not
   linked from the editor's sidebar; open the URL directly. It asks for
   the **mod passcode** once per device. Its **💡 Lights** tab is the main
   lights page:
   - a "getting a bulb working" checklist;
   - **📡 Pair new device**, with a countdown;
   - **Devices**, where a newly joined bulb is marked **★ new**;
   - every light already placed in its room, so you shouldn't need to
     move any;
   - select a light for **💡 Identify** (the bulb pulses) and colour
     swatches;
   - the **Looks** section.

   Help: the *House map* article (`docs/help/authoring/39-house-map.md`,
   "The house lights").
3. **The editor's Run → House:**
   - 🎛 **Desk → Checks** walks every light and look, each with a Test
     button and a ✓ / ✗ mark;
   - 🎨 **Cue designer** previews every look live; ▶ **Test on the house**
     plays it on the real bulbs.

**For each bulb:**

1. Pair it, from the map page's 📡 or Setup's 🔗.
2. In the Zigbee2MQTT frontend, rename it to its name from README §5.4
   (e.g. `living_1`) and set Power-on behavior to `on`.
3. On the map page, 💡 Identify that light to check it's the right one.

When every bulb is paired, walk **Checks**, then play each look from the
**Cue designer**.

## The network: the Asus BE3600

Everything in the repo dials this PC at **`192.168.8.10`** (the WLED strip,
the MacBook's fallback, the old ESP32 config). The simplest setup is to make
the Asus's network `192.168.8.x`, so nothing else has to change.

Asus menus vary a little by firmware; these are the ASUSWRT names. **Not
verified on this model.**

1. **Set it up** (the ASUS Router app or http://www.asusrouter.com, by
   default http://192.168.50.1). Internet from the Bell hub's LAN port.
2. **Its own address:** *Advanced Settings → LAN → LAN IP* → IP address
   **`192.168.8.1`**, subnet `255.255.255.0`. Apply. It reboots and its DHCP
   range moves to `192.168.8.x` (check the *DHCP Server* tab: the start and
   end address should now be `192.168.8.…`).
3. **The reservation:** *LAN → DHCP Server → Manually Assigned IP around
   the DHCP list* → turn it on, add this PC's MAC with **`192.168.8.10`**,
   Apply.
   - **Ethernet** (recommended for the show; the broker, the lights and
     the sound all hang off this PC): `D4-5D-64-D6-B7-DF`
   - Wi-Fi (what it uses now): `90-DE-80-95-64-39`

   Reserve the one you'll actually use (or both, on two addresses: only
   one can be `.10`).
4. **A 2.4 GHz network for the props** (HW-NET-01: the WLED controller,
   ESP32s, tablets). WLED can't join 5/6 GHz and dislikes band steering
   and WPA3-only. Either turn *Smart Connect* off and give the 2.4 GHz band
   its own name (WPA2-Personal), or use the router's IoT network
   (ASUSWRT 5.0: *Network* → add an *IoT Network*, 2.4 GHz).
5. **Move this PC to the Asus**, then in PowerShell:

   ```powershell
   ipconfig /renew
   .\setup-mosquitto.ps1 -Check   # 192.168.8.10:1884 answers, no address warning
   ```

   If the Asus network shows as **Public**, run
   `.\setup-mosquitto.ps1 -SetPrivate` in an Administrator PowerShell (the
   1884 firewall rule only applies on Private networks).
6. **Then the WLED strip** (README §6): Wi-Fi to the Asus's 2.4 GHz name;
   MQTT broker `192.168.8.10`, port `1884`, user `props`, the password you
   set; device topic `wled/living`. Give it a reservation too (README
   §6.1 step 3).
7. Write the reserved addresses on the IP sheet for the server room
   (HW-NET-02).

The stagehand jobs and Zigbee2MQTT only talk to `127.0.0.1` and the VPS,
so they keep working through the move (they reconnect on their own).

## Still open

- `stagehand/trapped.house.yaml` still has the event and the passcode
  typed into it. It is tracked, so undo it:
  `git restore stagehand/trapped.house.yaml` (the git-ignored
  `trapped.house.local.yaml` already holds both).
- The branch `oct31-w40/desktop-lights` (5 commits) is not merged into
  master yet.
