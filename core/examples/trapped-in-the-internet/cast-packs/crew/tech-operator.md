# Tech operator ([[EDIT: name — by Tue 10-20]])

> Not in the story. Your station is **John's MacBook** all night, and you
> look after the three other show computers. If any of them dies, the house
> loses that part, but **the story keeps running on the VPS** and the phones
> keep working.

## The four computers

| Computer | What runs on it | Its own runbook |
|---|---|---|
| **John's MacBook** (macOS) — your station | Ollama `gpt-oss:20b` + stagehand **`agents`** (Trabolta, `stagehand/laptop.yaml`); `showbackup.sh`; a Run tab; `pnpm showctl status --watch 5` | `scripts/house-macbook/trabolta.md`, [`trabolta-mind.md`](./trabolta-mind.md) |
| **John's Desktop** (Windows) | the **sound**: the speaker router stagehand **`audio`** + the MOTU 828x (no ADAT expander); the **lights**: **Zigbee2MQTT** on the CC2652P stick (the Hue and ZL1 bulbs, each by its `lights.json` name), the living room's WLED strip (it dials the broker), stagehand **`lights`** (every `lights_*` and `heart_*` look); stagehand **`show`**; **Mosquitto**, the house broker (`127.0.0.1:1883`, and `:1884` for the LAN with the `props` password); the **living-room TV** (Chrome kiosk over HDMI, spot `desktop-tv`). The stagehand jobs are Task Scheduler tasks (`\Loom\stagehand-show`, `-lights`, `-audio`). All of it starts by itself after sign-in | `scripts/house-desktop/README.md` |
| **Steph's laptop** (server room) | Chrome kiosk on the server-room terminal: Trabolta's face, the webcam, the mouse and keyboard, and the **Grand Central M4** on USB, which reads the **door sensor and the patch bay** | `hardware/server-room-m4/README.md` |
| **John's old laptop** (the tent) | Chrome kiosk on `/terminal/?code=<mod>&spot=tent&announce=1`: the tent's terminal, the reinstallation wizard and the web game in one. It needs WebGL2 to *Play here*; without it the tent can only send to a headset | `docs/trapped/kiosk.md` |

[[EDIT: where the Desktop sits, and who can reach its keyboard during the
show]]

**Announcements live on the Desktop.** A story `do announce` goes from the
server to the Desktop's `show` task, then over MQTT `show/announce` on the
Desktop's broker to the router (on the Desktop too), then to the speakers.
If the Desktop's broker or `show` task is down, nothing is announced (only
the tent laptop still says them). Story `sound X` does not take that path:
the router reads the server itself.

**The router fallback is the MacBook** (only if the MOTU misbehaves on
Windows: `scripts/house-desktop/README.md` §11). Then the MOTU hangs off the
MacBook, every `audio` line below happens there (`uv run stagehand launchd
… --job audio`, `--config trapped.macbook.yaml`), and the Desktop runs
`.\start-stagehand.ps1 -NoAudio`. Never run both routers: each would speak
every announcement.

## Card

**Boot list (15:00)**

1. Router + UPS on; Wi-Fi up. [[EDIT: SSID]]
2. **The Desktop.** Power on the MOTU first, then the PC; let it sign in. Mosquitto, Zigbee2MQTT, the
   `show`, `lights` and `audio` tasks and the TV kiosk start by themselves. Then, in
   PowerShell in `C:\loom\scripts\house-desktop`, with `$env:LOOM_MOD_CODE`
   set: `.\preflight.ps1` until it exits clean (it ends with `showctl
   preflight desktop`). **Click once into the TV page after every boot**
   (autoplay). The TV speaks every public Trabolta line in the Desktop
   room: the hunt questions, the bottle's *"X. Truth or dare?"* and the
   truths it asks, so its voice must be up before V6. Do Not Disturb on,
   system sounds off (the TV's sound leaves this PC). Run → House → Setup:
   🔊 Sound and 💡 Lights green. The router plays the story's sounds and
   the house announcements through the 828x and owns the chime: the
   story's `sound announce_chime` rides MQTT `show/chime` to it, so a chime
   and an announcement ring once. Since wave 38 it also plays the music
   (a set per act, cued by the story) and Trabolta's TV voice on every
   speaker: Chrome on this PC plays into VoiceMeeter (it must be running),
   which the router sums into the 828x's input 3 (no cable since wave 46),
   and the TV's own volume stays down (or he is heard twice). ■ Stop house
   sounds on Run fades the sounds and the music out.
3. **The MacBook.** On its charger, `caffeinate` running, sleep off;
   **Focus → Do Not Disturb all night**. Ollama with `OLLAMA_KEEP_ALIVE=-1`
   and `OLLAMA_MAX_LOADED_MODELS=2`. Trabolta runs on the story mind
   (`mind_mode: new` in `stagehand/laptop.yaml`): only `gpt-oss:20b` is
   needed. Warm it once (`ollama run gpt-oss:20b hi`); `ollama ps` shows it
   alone (unload the second model with `ollama stop
   tobestyledintro/qwen3.8-9b-distill:q8_0`; it loads again by itself if you
   switch him to classic). The switches: [`trabolta-mind.md`](./trabolta-mind.md).
4. The stagehand **`agents`** launchd job on the MacBook, and no `audio`
   job there (`uv run stagehand launchd status`). Run → Mind shows
   Trabolta's worker connected; Run → House → Setup's 🧠 row is green.
5. `pnpm showctl preflight macbook` (from the main checkout) until green.
   Then leave `pnpm showctl status --watch 5` running in a terminal.
6. **Steph's laptop.** Chrome on the server-room terminal
   (`/terminal/?code=<mod>&spot=server-room&door=serial&camera=user`; the
   kiosk set-up is in `docs/trapped/kiosk.md`). Run → Terminals shows its
   row with 🚪 *shut* (and the level) and 🔌 *0* with no cable in. Open and
   shut the door once; plug one patch cable in and out once. Then
   `pnpm showctl preflight serverroom` on Steph's laptop (it looks for the M4
   on that machine's USB and checks its Chrome; it needs Node ≥ 22.6 and a
   repo checkout there, else only the server half of the check means anything).
7. **The tent laptop.** Chrome kiosk on
   `/terminal/?code=<mod>&spot=tent&announce=1` (never add `&view=reinstall`:
   the map's tent spot sets the view). `pnpm showctl preflight tent` on the
   tent laptop (same needs as above).
8. Wall tablets in Fully Kiosk (they show the idle show until Trabolta is
   introduced), all green on Run → Terminals (the `📟 N/N` pill goes red and
   chimes on a tablet silent 20 s). Fully Kiosk → *Enable Microphone Access*
   on each, touch each once after a reload, and every placed tablet's row
   reads **🎤** (red **🎤 tap** = untouched since it loaded, **🎤 denied** =
   the permission, **🎤 http** = not the https address); the TV's reads 🎤 off.
9. The **door terminal** outside the server room (the King's chess),
   provisioned
   `/terminal/?code=<mod>&name=Server Door&spot=server-room-door&view=chess`:
   awake all night on THE KING and his bar (no screensaver). A mated King
   shows in the journal as *chess won, by Terminal · Server Door*. In both
   reinstallation games a program may hit him once per visit; his one
   health bar is shared all night (Run shows it; 👑 restores it).
10. `pnpm showctl doctor` from the MacBook: every row green, or every amber
    understood.

The **mod code is never printed**: [[EDIT: where it lives — your password
manager]]. The `props` broker password lives only in each WLED controller, the
MacBook's `trapped.macbook.local.yaml` (for the router fallback and for
firing sounds by hand from the MacBook) and (hashed) in the Desktop's
Mosquitto password file.

**Wave 58, once, after the final merge** (the Oct 30 story; the running order
is `SHOWNIGHT.md` §1):

- **Trabolta's worker.** His persona, his mind and the door code's never-list
  load at boot from the MacBook's checkout, and `sync-show` never reaches them.
  `git pull`, then `cd stagehand && uv run stagehand launchd restart --job
  agents`, then Run → Mind → **Reset**. Pull and restart together, never from a
  half-merged tree: an older worker refuses a persona with `cover:`.
- **The keypad** is re-set by hand to `facts.json` `door.code` before the 15:00
  test. Never say it on the radio.
- **Reload** the TV, every terminal, the tablets, the tent and every booth, then
  check the build stamps on Run → Terminals. An old TV shows the old captions
  under the new speech. An old booth still says *scan the guest's pass* and
  can't take a codex QR.
- **Run → Mind:** an `engine macbook` row means Claude refused a line and the
  standby wrote it, about 99 s at the median. Nobody has heard this persona on
  Claude yet; the battery run is owed (`trabolta-mind.md`).
- **Before G0 📜** the director may ask you for ■ Stop house sounds: a dance
  track never ducks under him. If he drops out mid-way, mute the TV: Task
  Manager takes over.

**Watch all night:** `showctl status --watch 5` · Run → Mind (the worker)
and Run → Terminals (every row, the 🚪 and 🔌 badges on the server room's) ·
the uptime alert on `https://app.mapsandducks.com/api/health` (anything but
200 = loom is down, starting or missing an event). On the Desktop when
something looks off: `.\start-stagehand.ps1 -Status` and the Zigbee2MQTT
frontend.

**Recovery**

| Problem | Do |
|---|---|
| the lights are wrong, or the Desktop's `show` / `lights` task died (**LIGHTS**) | on the Desktop `.\start-stagehand.ps1 -Restart show` (or `lights`): on reconnect it replays the current look (`Night.lights`, never the alarm; under the majority's `server_open` it replays `lights_y2k` first, then `lights_server_open`) and a room Trabolta has cut. Still wrong → set the look by hand from the table below (`Night.lights` in Run → World names it). There is no cue to re-fire: phase cues play once |
| no announcements anywhere | `.\preflight.ps1` on the Desktop (`health/stagehand`, `health/audio`): the Desktop's `show` and `audio` tasks (`.\start-stagehand.ps1 -Restart show` / `-Restart audio`), its broker (`.\setup-mosquitto.ps1 -Check`); in the fallback, the MacBook's router (`uv run stagehand launchd status --job audio`) and its `:1884` password |
| no story sounds | the router: `.\start-stagehand.ps1 -Restart audio` on the Desktop (the fallback: `uv run stagehand launchd restart --job audio` on the MacBook); Run → House → Setup's 🔊 row says whether it listens and what is wrong |
| Trabolta's worker crashed | `uv run stagehand launchd restart --job agents` on the MacBook. The hold line covers the gap; the directors answer DMs meanwhile |
| Trabolta's worker hung but still connected (Run → Mind shows it, nothing answers) | restart the `agents` job at once: the hold line can take minutes to come for a hung worker; the directors answer DMs by hand meanwhile |
| **NEVER** | `pkill -f "stagehand run"` (it kills every job on that machine) |
| Ollama slow / evicted | `ollama ps` shows `gpt-oss:20b` (and the qwen model only if Trabolta is on classic); reload; the first reply after a reload takes ≈ 25 s |
| Trabolta's story mind misbehaves (the directors ask) | the switch ladder in [`trabolta-mind.md`](./trabolta-mind.md): one line in `stagehand/laptop.yaml`, then restart the `agents` job; say in `# hosts` what you changed |
| the door or the patch bay reads wrong (red 🚪 / 🔌 fault on Run → Terminals) | the watch and the directors use the 🚪 / 🔌 💥 ❌ buttons meanwhile. On Steph's laptop: hold the top right corner 2 s for ⚙ (hidden since wave 59), check the board is connected, calibrate the door again after any reflash; the patch bay's readings and **Learn** are in the same panel |
| a terminal hung | tap it; else Fully Kiosk → reload |
| the TV page stalled | on the Desktop `.\tv-kiosk.ps1 -Close`, then `.\tv-kiosk.ps1`; **click once into it** |
| the TV is silent | Run → Terminals (muted?), Windows' default output; `M` on the TV page unmutes |
| Z2M coordinator dead | swap to the spare dongle + restore the `data\` backup (≈ 10 min); meanwhile, wall switches |
| WLED dead | power-cycle the controller (its settings survive; it has no presets to lose), then check it is back on `wled/living` |
| uplink blip | the `lights` task catches the house look and the heart look up by itself when the feed reconnects; check the look and Run → Terminals; wrong → restart the `show` task as above |
| **house internet down** | **fire cues by hand** (table below). Tell the house manager: guests turn Wi-Fi off and use cellular |
| the Desktop dead | the story is fine on the VPS. The TV goes dark, the house speakers go quiet, the lights hold their last look (wall switches / the WLED app), nothing is announced. TV: [[EDIT: a spare computer on the HDMI with the `view=tv` URL]] |
| the MacBook dead | the story is fine on the VPS. Trabolta is down (the directors answer DMs). Backups stop: tell the director |
| Steph's laptop dead | the door and the patch bay go on the 🚪 / 🔌 💥 ❌ buttons (the watch radios); his heart's terminal is gone until it is back |
| router dead | the ISP router (same SSID/password) |
| VPS dead | OP-21: start the warm standby, restore the newest backup, repoint DNS. A standby built before tonight's release runs the older image: `ship.sh` against it before anyone trusts it (no booth scanning, old terminal bundles otherwise) |
| rain / wind mid-show | the shed switch (W-22): open `/reinstall/map` (signed in with the mod code), press **Shed** in the *Map:* bar and confirm — or `POST /e/<event>/api/mod/spatial/variant {"file":"house.shed.json"}` with the mod token. Programs mid-game keep playing; anyone standing in the shed goes back to the new start. Julia (the tent) moves the tent light + speaker. (Copying files on the VPS does nothing: the event plays the project's maps.) |

**ALL STOP:** the director presses 💡 (house lights; it also holds a pending
automatic dance). You press **■ Stop house sounds** (Run's header; if the
server can't be reached, `uv run stagehand sounds stop --announce --config
trapped.macbook.yaml` from the MacBook, which publishes on the Desktop's
broker), mute the TV voice (Run → Terminals,
or `M` on the TV page: Stop house sounds never touches it), then the wall
switches. The music stays off until the next act's music cue; to bring it
back sooner: `uv run stagehand music scene <the current act> --config
trapped.macbook.yaml` from the MacBook (`music status` shows the scene).
You stay at the MacBook; the house manager leads people.

**You own:** the blackout safety check (with the house manager), the ad-hijack
video, the backups check each act (OP-21).

**Radio:** LIGHTS (to you) · HOLD · ALL STOP.

## Firing cues by hand (internet down, or stagehand down)

Run → Director still shows each cue as the director fires it (the director's
laptop can reach the VPS on a phone hotspot if needed). When a cue fires, set
the look yourself. The house network still works without the internet, so
the router still takes a sound by hand from the MacBook over the Desktop's
broker (the MacBook's `trapped.macbook.local.yaml` holds the props
password): `uv run stagehand sounds play <name> --config
trapped.macbook.yaml`, and an announcement:
`uv run stagehand announce --config trapped.macbook.yaml "<line>"` (or read
it over the radio to the room). The lights have no presets or scenes to
recall (wave 31): without the server, set a look by hand from the
Zigbee2MQTT frontend (`http://localhost:8080` on the Desktop: each bulb by
name) and the strip from its WLED page, roughly as the Cue designer's look
describes it; never turn a hall or bathroom bulb off.

| Story cue | Lights (the `lights.json` look; by hand: Z2M frontend + WLED page) | Sound (`sounds play <name>`) |
|---|---|---|
| `lights_screensaver` (doors) | [[EDIT]] | `modem_handshake` (each login, the Optical Drive) |
| `lights_tube_chase` (each clearance) | a cyan pulse up the halls, then back | — |
| `lights_call_desktop` (C1, C2, ⏳) | [[EDIT]] | `announce_chime` (`countdown_tick` at ⏳) |
| `lights_game` (Bingo, hunts) | [[EDIT]] | `bingo_start` (V2) |
| `lights_truth_time` (V6) | [[EDIT]] | — |
| `lights_ad_hijack` (📺) | [[EDIT]] | `ad_jingle` + the ad video on the TV |
| `lights_glitch` (📥, 🫘 before 🤖, 🤖) | [[EDIT]] | `truther_glitch` / `beans_spill` (a late 🫘 plays only `beans_spill`: the look stays) |
| `lights_pong` (🏓) | [[EDIT]] | — |
| `lights_trust_chart` (📊) | [[EDIT]] | `printer_grind` (🖨) |
| `lights_y2k` (🕚) | [[EDIT]] | `y2k_chime` (+ each clock warning) |
| (🗜 zip everyone out) | — | `zip` |
| `lights_y2k` + `lights_server_open` (majority; The Heart, the first door opening once Trabolta is awake: from 🕚 the server-room look sits on top of the Y2K house look, before 🕚 it lights the server room alone) | [[EDIT]] | — |
| `lights_alarm` (the patch-bay alarm: a second wrong combination) | [[EDIT]] | `alarm_siren` |
| `lights_blackout` → +10 s `lights_dance` (Combo A/B) | blackout (safety bulbs stay on) → dance | `dance_song` (+ `windows_shutdown` on B) |
| `lights_final_reveal` (🌑) | [[EDIT]] | — |
| `lights_song` / `lights_rave` / `lights_purgatory` / `lights_banish` | [[EDIT]] | the ending's track |
| `lights_restore` (💡, endings) | house lights up | `motorcycle` on his exits |

The server room's RGB bulb plays the `heart_*` looks from `lights.json`
through the Desktop's `lights` task; by hand, the Zigbee2MQTT frontend sets
it (never under 80 / 254: it is the room's safety light).

## Before the night

- [ ] Bench with John: the door sensor and the patch bay on the Grand
      Central M4 (`scripts/accept/N-20.sh` for the door, `N-21.sh` for the
      bay, on Steph's laptop), then the kiosk's ⚙ *Connect door sensor* +
      both calibrations and the patch bay's readings, then `K-05.sh` (with
      `M4BAY=1` for the bay); the server room's RGB bulb (paired as
      `server_room_rgb`, `power_on_behavior: on`, placed in the map editor,
      every `heart_*` look ▶ Tested; `stagehand check --only lights` green on
      the Desktop), the keypad lock (code + egress), the lights, the blackout
      test (stopwatch every flashing look ≤ 3 Hz).
- [ ] Tech run 10-28, dress 10-29 (incl. the shed switch in < 15 min).
- [ ] Your MacBook has the mod code and the map page (`/reinstall/map`)
      provisioned and signed in, showing the *Map: Tent | Shed* bar (W-22).
- [ ] The IP sheet + one-page runbook taped in the server room (every device's
      IP, these recovery steps, the mirror-view fallback URL, the rollback
      command). [[EDIT: write the IP sheet after the bench]]
