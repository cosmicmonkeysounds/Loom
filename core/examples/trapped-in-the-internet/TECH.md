# Tech: every machine and device for the night

The definitive map of the show's hardware and software for Sat Oct 31 2026:
what each machine runs, how they connect, and where each one's setup
runbook lives. For the night-of steps in order, read
[`SHOWNIGHT.md`](./SHOWNIGHT.md). For the generated overview page (acts,
cues, terminal spots), open [`SHOW.html`](./SHOW.html).

The older docs (OCT31.md, CHECKLIST.md, the stagehand README before wave 22)
describe one "house Mac" that did everything. That house Mac was John's
MacBook (the 48 GB Ollama laptop). Its jobs are now split: the MacBook keeps
Trabolta and the director's console, and John's Windows Desktop takes the
sound (the MOTU 828x and the speaker router, since 2026-10-27), the lights
(Zigbee2MQTT with the Hue and ZL1 bulbs, the WLED strip), the broker,
`show`, `lights` and the TV. The MacBook's old `show` / `lights` / `audio`
jobs, Mosquitto and Zigbee2MQTT are retired before the sync, as the Desktop
takes them over (`SHOWNIGHT.md` §1 steps 5–7). The MacBook can still run the
router as the fallback (below).

Never write a code in this file or any doc: not the moderator, performer or
guest passcodes, the keypad code, the patch-bay combinations, the answer keys
or any codex code. `<mod>` below stands for the moderator passcode.

## The four computers

| Machine | Runs | Setup runbook |
|---|---|---|
| **John's MacBook** (macOS, M3 Max, 48 GB) | **Trabolta**: Ollama with `gpt-oss:20b` + stagehand `agents` (his voice and mind; `stagehand/laptop.yaml`, `mind_mode: new`, launchd). `scripts/ops/predeploy.sh`, `ship.sh`, `pnpm sync-show`, `scripts/ops/showbackup.sh` (launchd, every 10 min 19:00–03:00). A director's Run console in Chrome. **Only as the fallback**: the sound router (`stagehand/trapped.macbook.yaml`). | [`scripts/house-macbook/trabolta.md`](../../../scripts/house-macbook/trabolta.md) (Trabolta); [`scripts/house-macbook/`](../../../scripts/house-macbook) (`audio.md`: the router fallback) |
| **John's Desktop** (Windows) | **Sound**: stagehand **`audio`**, the speaker router, on the **MOTU 828x** + its ADAT expander (USB 2, ASIO; announcements in the SAPI voice). **Lights**: **Zigbee2MQTT** on the CC2652P stick (a COM port, `adapter: zstack`) with the **Philips Hue** and **ThirdReality ZL1** bulbs; the **WLED** strip on its ESP32 controller (Wi-Fi, MQTT); stagehand **`lights`** (`lights.json`). stagehand **`show`** (cues to Zigbee2MQTT / WLED / MQTT, sensors back, and the `do announce` relay). **Mosquitto**, the house broker: anonymous on `127.0.0.1:1883`, password-only user `props` on the LAN at `:1884`. The living-room **TV** over HDMI (Chrome kiosk, spot `desktop-tv`). Each stagehand job is a Task Scheduler task (`stagehand/trapped.desktop.yaml`). | [`scripts/house-desktop/README.md`](../../../scripts/house-desktop/README.md) |
| **Steph's laptop** (the server room) | Chrome kiosk on the server-room terminal: Trabolta's face, the heart talk, a webcam that scans passes, a monitor, mouse and keyboard. The **Grand Central M4** on USB, read over Web Serial: the door sensor and the patch bay. Nothing from stagehand runs here. | [`hardware/server-room-m4/README.md`](../../../hardware/server-room-m4/README.md); [`docs/trapped/kiosk.md`](../../../docs/trapped/kiosk.md) |
| **John's old laptop** (the tent) | Chrome kiosk on spot `tent`: the terminal, the reinstallation wizard and the web game in one. Speaks house announcements itself (`&announce=1`); no voice link (`voice: false` on the map). Needs **WebGL2** for *Play here*; without it the tent can only send a program to a headset. | [`docs/trapped/kiosk.md`](../../../docs/trapped/kiosk.md) (the tent laptop) |

The event server itself runs on the VPS at `app.mapsandducks.com`
(Docker: Postgres, the `loom` server, Caddy). Deploy and recovery:
[`docs/loom-docker-deploy.md`](../../../docs/loom-docker-deploy.md).

## Every other device

| Device | What it does | Set up with |
|---|---|---|
| Wall tablets (Android, Fully Kiosk) | One per `auto` spot on the map: the idle show, a corner scan box, a direct line to Trabolta, the world / shadow view while someone reinstalls. Fully's *Enable Microphone Access* on (the voice link). | `/terminal/?code=<mod>&spot=<spot>`; Fully settings in `docs/trapped/kiosk.md` |
| Server Door tablet | `view=chess` beside the real keypad: the King's chess game, awake all night. A checkmate gives the door code. | `/terminal/?code=<mod>&spot=server-room-door` |
| Casino tablet | `view=casino` in the upstairs bedroom (spot `graphics-card`): Truthcoin bets, rolled by the server. | `/terminal/?code=<mod>&spot=graphics-card` |
| Quest 3 headset(s) | The VR reinstallation in the tent, played seated with a spotter. Picks its program in the headset; asks for the microphone in the lobby. | `reinstall/vr/tools/quest.sh`, `reinstall/vr/README.md` |
| MOTU 828x + ADAT expander | The house speakers: every story `sound X` and every announcement. On the Desktop over USB 2 with MOTU's Windows driver (ASIO); the expander on Optical A, clocked from the 828x. `audio.json` expects 32 in / 30 out. | `scripts/house-desktop/README.md` §3; the map editor's 🔊 Audio tab. Fallback on the MacBook: `scripts/house-macbook/audio.md` |
| House speakers | Placed on the map editor's 🔊 Audio tab. Only 5 are placed so far (the living room L/R, the kitchen L/R, the Optical Drive); the rest of `audio.json`'s 22 outputs have no speaker yet. | `/reinstall/map` → 🔊 |
| Zigbee 3.0 USB dongle (TI CC2652P + CP2102N, 20 dBm, Z-Stack 3.x.0 preloaded) | The Zigbee coordinator, on a USB 2.0 extension cable on the Desktop. Touchlink-capable (resets Hue bulbs). | `scripts/house-desktop/README.md` §4 |
| Philips Hue bulbs | House Zigbee bulbs, joined to Zigbee2MQTT directly (no Hue Bridge). A Hue bulb resets by Touchlink, its serial number, a Hue dimmer or the Hue app, never by flicking its switch. Each gets a Z2M friendly name and `power_on_behavior: on`. How many, and which rooms: open (U3). | `scripts/house-desktop/README.md` §5; the map editor's 💡 Lights tab |
| ThirdReality Smart Color Bulb ZL1 (Z2M `3RCB01057Z`) | House Zigbee bulbs (colour, colour temperature, dim). Resets by power-cycling until it blinks. How many, and which rooms: open (U3). | `scripts/house-desktop/README.md` §5 |
| RGB LED strip + WeGoIOT ESP32 controller (WLED) | On the house Wi-Fi; MQTT to the Desktop's broker on `:1884` as `props`, device topic `wled/<room>`, group topic `wled/all`; stagehand sends `wled/<room>/api`. Its room, LED type and count: open (U3). | `scripts/house-desktop/README.md` §6 |
| Server-room RGB bulb | Zigbee name `server_room_rgb`, `power_on_behavior: on`. The room's only light, so its safety light: `lights.json` never takes it below 80 / 254. 13 `heart_*` looks. Which bulb it is (a Hue or a ZL1) is open. | `scripts/house-macbook/zigbee.md` from step 5; the map editor's 💡 Lights tab |
| Grand Central M4 | Door sensor (an LED into an LDR on A0) and the 15-jack patch bay (8 sources V1–V8, 7 inputs D1–D7 on A2–A8). Firmware in `hardware/server-room-m4/`. | `scripts/accept/N-20.sh` (door), `scripts/accept/N-21.sh` (bay) |
| The keypad lock | Standalone, set by hand, never networked. Outside only: the inside handle always opens with no code. | By hand; the code lives in `facts.json` `door.code` and nowhere else |
| Phones | Guests join at `https://app.mapsandducks.com/` (or the join QR). Performers and hosts sign in with the performer code. Android phones and performer booths get push alerts; iPhones only through the Home Screen path when `LOOM_HOMESCREEN=on`. | — |
| Director phone | The cue sheet on a phone: `https://app.mapsandducks.com/?role=director` (moderator passcode + a name). | `docs/help/play/13-director-phone.md` |

**Not installed for Oct 31:** the ESP32 box in `hardware/server-room/`
(ring, siren, relay, its digital patch-bay scanner). The M4 is the server
room's only electronics. The siren is the router's `alarm_siren` sound. The
ESP32's rules in `stagehand/trapped.house.yaml` stay in the file, unused.

## How it connects

```
                         ┌───────────── VPS: app.mapsandducks.com ─────────────┐
                         │  loom server · Postgres · Caddy (HTTPS)             │
                         └───────▲──────────▲───────────▲───────────▲──────────┘
             HTTPS (house Wi-Fi, │          │           │           │ or cellular)
          ┌──────────────────────┘          │           │           └──────────────┐
          │                                 │           │                          │
   John's MacBook        John's Desktop (192.168.8.10)                Steph's laptop     tablets, tent laptop,
   agents ── Ollama      audio router ─USB 2─ MOTU 828x ─ADAT─ expander server-room       Quest, phones
   Run console                         └─▶ speakers                     terminal (Chrome)
   ops scripts           show, lights ── Mosquitto :1883 (loopback)          │ USB (Web Serial)
                         Zigbee2MQTT ─USB─ CC2652P ~~Zigbee~~ Hue + ZL1 bulbs, the RGB bulb
                         TV kiosk ─HDMI─▶ TV           Mosquitto :1884 (LAN, user props)
                                                            ▲ MQTT over Wi-Fi
                                              WLED ESP32 controller ── RGB LED strip
```

(In the router fallback the MOTU hangs off the MacBook instead, and the
MacBook's router dials the Desktop's `:1884` like the WLED controller.)

- **Everything reaches the VPS over HTTPS.** Phones keep working on cellular
  if the house internet dies; the house machines need the uplink. LTE
  failover on the router is planned, not yet tested (HW-NET-07).
- **MQTT lives on the Desktop.** `show`, `lights`, `audio` and Zigbee2MQTT
  use the anonymous loopback listener (`127.0.0.1:1883`). The WLED
  controller dials the LAN listener (`:1884`, user `props`; the password is
  typed into its MQTT page), and so does the MacBook's router in the
  fallback (its password in the git-ignored
  `stagehand/trapped.macbook.local.yaml`). The Desktop must hold the house's
  DHCP reservation `192.168.8.10`, which the WLED controllers and
  `trapped.macbook.yaml` dial. **To do:** move the reservation from the
  MacBook to the Desktop on the router (`scripts/house-desktop/README.md`;
  `setup-mosquitto.ps1` warns until it is done).
- **USB:** the MOTU (USB 2) and the CC2652P to the Desktop (the MOTU to the
  MacBook over Thunderbolt in the fallback), the M4 to Steph's laptop.
- **Wi-Fi:** the WLED controller, to the Desktop's broker.
- **HDMI:** the Desktop to the living-room TV. The TV's voice plays from the
  Desktop's default output; HDMI to the TV's own speakers is simplest.
- **Zigbee:** the CC2652P to the Hue and ZL1 bulbs and the server-room bulb.
  Every mains bulb is a Zigbee router, so placed bulbs extend the mesh
  toward the basement; its reach there is still a device check.

### Announcements

A story `do announce "…"` reaches the speakers like this: the VPS → the
Desktop's stagehand `show` → MQTT `show/announce` on the Desktop's Mosquitto
→ the `audio` router (on the Desktop too, over the loopback; on the MacBook
over `:1884` in the fallback) → the speakers. So:

- `show` must run on the Desktop even with no house lights: it is the
  announcement relay.
- `show` and `audio` must share one broker.
- With the Desktop's broker or `show` job down, nothing is spoken. Only the
  tent laptop (`&announce=1`) still speaks announcements. In the fallback,
  announcements need both machines up.

A story `sound X` does not take this path: the router reads the server's
feed itself.

## The sound router: Desktop (default) or MacBook (fallback)

Since 2026-10-27 the MOTU 828x and the router live on the Desktop, beside
the broker and the `show` job. The MacBook stays documented as the fallback
if the 828x misbehaves on Windows. Only one machine may run the router: two
would each speak every announcement.

| | On the Desktop (default) | On the MacBook (fallback) |
|---|---|---|
| Config | `stagehand/trapped.desktop.yaml` (`host_api: asio`, SAPI voice; the MOTU's ASIO name in `trapped.desktop.local.yaml`) | `stagehand/trapped.macbook.yaml` (extends `trapped.house.yaml`; `show: null`; `audio.mqtt` → the Desktop at `:1884`) |
| Service | Task Scheduler: `.\scripts\house-desktop\start-stagehand.ps1` (installs `show`, `lights` and `audio`) | launchd: `uv run stagehand launchd install --job audio --config trapped.macbook.yaml`; the Desktop runs `start-stagehand.ps1 -NoAudio` / `-Stop audio` |
| Announcement voice | Windows SAPI (`voice_engine: auto`, `say_voice: Microsoft Zira Desktop`; a missing voice falls back to the installed female one) | macOS `say`, Samantha |
| The 828x | USB 2 with MOTU's Windows driver (MOTU Audio Installer, ASIO); prove it with `SD_ENABLE_ASIO=1 uv run python -m sounddevice` (one ASIO line, 32 in / 30 out). Walk every speaker with 🔈 Test: ASIO's channel order may differ from Core Audio's. | Thunderbolt (Apple's TB3 → TB2 adapter), Core Audio, the kext approved: the tested path |
| Consequence | The broker is local: announcements need only the Desktop. | Announcements need both machines up. The MOTU and the speaker cabling go to wherever the MacBook sits. |
| Preflight | `.\scripts\house-desktop\preflight.ps1`; `pnpm showctl preflight macbook` | `preflight.ps1 -NoAudio`; `pnpm showctl preflight macbook --router macbook` |

Setting the router up on the Desktop: `scripts/house-desktop/README.md` §3
and §7; switching to the fallback: its §11.

## Configuration files

| File | Machine | Tracked? |
|---|---|---|
| `stagehand/trapped.house.yaml` | all (the base: every show rule, the sensors, the catch-up, the router's settings) | yes. Ships `event: CHANGE-ME-EVENT-ID` and `mod_passcode: "CHANGE-ME"` |
| `stagehand/trapped.house.local.yaml` | every machine that runs stagehand: `server: { event, mod_passcode }` | **git-ignored** |
| `stagehand/trapped.desktop.yaml` (+ `.local.yaml`) | the Desktop: `extends:` the house file, adds `lights:` and the Windows router settings (local: `server: {}` and the MOTU's ASIO name, `audio.device`) | yes (local: ignored) |
| `stagehand/trapped.macbook.yaml` (+ `.local.yaml`) | the MacBook, only in the router fallback: the router, dialling the Desktop's broker (local: the `props` password) | yes (local: ignored) |
| `stagehand/laptop.yaml` | the MacBook: the `agents` worker (`mind_mode: new`, the event id, the passcode) | **git-ignored** |
| `audio.json`, `lights.json`, `desk.json`, `house.json`, `house.shed.json`, `facts.json` | show folder; `pnpm sync-show` pushes them into the server project | yes |

On the Desktop always pass `--only` to `stagehand check` and `stagehand
run` (`--only show,lights,audio`, or `show,lights` in the router fallback):
one machine must never run two copies of a job.

## Terminal addresses

Every terminal follows its spot on the house map, so `spot=` is all a link
needs. Old links with `name=` / `view=` / `room=` override the map and stop
following it: avoid them.

| Terminal | Address |
|---|---|
| Any wall spot | `https://app.mapsandducks.com/terminal/?code=<mod>&spot=<spot>` |
| TV (Desktop) | `…/terminal/?code=<mod>&spot=desktop-tv` (once, via `.\scripts\house-desktop\tv-kiosk.ps1 -Setup`) |
| Server room (Steph's laptop) | `…/terminal/?code=<mod>&spot=server-room&door=serial&camera=user` |
| Server Door | `…/terminal/?code=<mod>&spot=server-room-door` |
| Casino | `…/terminal/?code=<mod>&spot=graphics-card` |
| Tent (old laptop) | `…/terminal/?code=<mod>&spot=tent&announce=1` (never add `&view=reinstall`) |

Kiosk Chrome: launch each profile once **without** `--kiosk` to grant the
camera (and in the server room, the serial port), then relaunch with
`--kiosk --autoplay-policy=no-user-gesture-required`. ⚙ on a terminal needs a
2-second hold. The full spot list is on `SHOW.html` → Terminal spots.

## The server room in detail

- **The door.** An LED shines into an LDR (in a black shroud tube) only while
  the door is shut. The M4 classifies it; the terminal posts
  `door_sensor_opened` / `door_sensor_closed`. Firmware `LED_STEADY` while
  the LED is on 5V (today's wiring); `LED_PULSED` once it moves to D2.
  **Calibrate in ⚙ after every reflash** (⚙ reads *⚠ calibrate again*
  otherwise). A 🚪 button press puts the story on the buttons until
  🚪 *Trust the door sensor again*.
- **The patch bay** (wave 22). The terminal posts `patch_changed {combo}`
  only for a settled, complete patch (exactly four source-to-input cables)
  that differs from the last one it posted; the same cables plugged in again
  never count twice. A source-to-source or input-to-input cable reads as
  incomplete. The story judges it only in the Y2K hour (from 🕚, before an
  ending): one wrong combination is forgiven, the second trips the alarm.
  The terminal never knows the combinations. A 🔌 / 💥 / ❌ press (the
  Antivirus watch's booth or a director's fallback) puts the story on the
  buttons (`Night.patch_override`) until a director presses
  **🔌 Trust the patch bay again** (`trust_patch_bay`). ⚙ on the terminal
  shows a live table: each input's reading and the source it decodes, with
  Learn / Save / Reset.
- **Run → Terminals** shows the server-room row's 🚪 and 🔌 badges (off the
  heartbeat's `door*` and `pb` / `pbc` / `pbx` / `pft` fields).
- **Bench checks:** `scripts/accept/N-20.sh` (the door), `N-21.sh` (the
  bay), `K-05.sh` with `M4BAY=1` (both through the story).

## Show-night diagnostics

`pnpm showctl` ([`scripts/show/README.md`](../../../scripts/show/README.md))
runs on every machine (Windows: `.\scripts\show\showctl.ps1`). It is
read-only except `fire`, and never registers itself as a terminal, router or
console. Set `LOOM_MOD_CODE` in the shell first (never in a file).

| Command | Use |
|---|---|
| `showctl preflight <macbook\|desktop\|serverroom\|tent>` | Before the doors, on each machine, until green (`--router macbook` on `macbook` and `desktop` in the router fallback) |
| `showctl doctor [--watch 15]` | Every server check in one table |
| `showctl status --watch 5` | The tech op's screen during the show |
| `showctl terminals [--watch]` | Every terminal's last heartbeat |
| `showctl fire <signal> --yes` | The hardware fallback (guarded on a live event) |

The Desktop also has `.\scripts\house-desktop\preflight.ps1` (power, the
broker's listeners, Zigbee2MQTT, the tasks incl. the router, the MOTU's ASIO
line, the retained `health/*` topics, then `showctl preflight desktop`;
`-NoAudio` in the router fallback). In the editor, Run → House → **Setup**
shows 🔊 Sound, 💡 Lights and 🧠 Trabolta, each with what to do.

## Open hardware questions

These wait on the user or on a device check.

| # | Question |
|---|---|
| U3 | **Partly answered (2026-10-27):** there are Philips Hue bulbs, ThirdReality ZL1 bulbs and one RGB LED strip on a WeGoIOT ESP32 WLED controller. Still open: **how many of each, which rooms each bulb and the strip go in** (the strip's device topic is named after its room: `wled/living`, `wled/kitchen`, `wled/backyard`, `wled/registry` or `wled/tube`), the strip's LED type, LED count and length, its controller's data GPIO, which bulb is the server room's `server_room_rgb`, which bulbs are safety lights (stairs, halls, bathrooms, tent), and whether the `lights_*` cues will be `lights.json` looks (the Cue designer) or `trapped.house.yaml`'s group scenes + WLED presets. Also still open: the printer's Zigbee button and lid sensor, and battery path lights. Without placed lights the story's screensaver, blackout, alarm, dance and room-cut cues do nothing and the blackout safety rule has nothing to keep lit. |
| U6 | Decided in wave 22: 8 sources and 7 inputs, Combo A changed with it, a re-plugged cable never counts twice, V–V / D–D cables read as incomplete. |
| U7 | Now that the bay judges itself, does an Antivirus still sit inside as the patch-bay watch, and does 🕚 still wait for the radio call IN? (The `y2k_clock` cue's description still assumes a watch.) |
| U8 | Are the eight dividers and the seven input circuits built, and do they read their nominal levels on the bench (`N-21.sh`)? |
| U9 | Which physical jacks are V1–V8 and D1–D7 on the panel? The printed Combo A halves and the patch-bay card use those labels. |
| U10 | **Partly answered (2026-10-27):** the MOTU goes on the Desktop (the MacBook is the fallback). Still open: does the 828x run under ASIO on MOTU's current Windows driver with 32 in / 30 out and no dropouts (`scripts/house-desktop/README.md` §3.3), and which ADAT expander model it is (its clock setting). |
| U11 | What OS is Steph's laptop? (It only changes the kiosk launch and running `N-20.sh` / `N-21.sh`, which need Git Bash on Windows.) Does the old tent laptop have WebGL2? |
| U12 | How many wall tablets for the nine `auto` spots, and how many Quest headsets? |

Device checks still to do: the 828x under ASIO on the Desktop (README
§3.3, then every speaker's 🔈 Test; `K-20.sh` is the macOS walk), each Hue
and ZL1 bulb paired, named and placed, the WLED strip online on `:1884`, the
M4 on the real frame (steady mode near the red bulb, the settle time), Web
Serial after a sleep and a replug, the webcam in the server room's light,
each look on the real bulb incl. the 80 / 254 floor, the CC2652P's reach to
the basement, the tent laptop's webcam and WebGL2, and the voice link's mics
against the room levels.
