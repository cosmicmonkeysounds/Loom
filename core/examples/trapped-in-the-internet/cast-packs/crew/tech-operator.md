# Tech operator ([[EDIT: name — by Tue 10-20]])

> Not in the story. You stay at **the house Mac** all night. It drives the TV
> over the long HDMI run, plays room audio through the **MOTU** (ADAT), and
> runs Mosquitto, Zigbee2MQTT, stagehand `show` + `agents`, Ollama and the
> house announcement player. If it dies, the house goes quiet but **the story keeps
> running on the VPS** and the phones keep working.

## Card

**Boot list (15:00)**

1. Router + UPS on; Wi-Fi up. [[EDIT: SSID]]
2. House Mac on its charger: `caffeinate` running, sleep off (`pmset`);
   **Focus → Do Not Disturb all night** ("Allow notifications when
   mirroring" off), so no banner lands on the TV. The show-night backup job
   is silent by default since wave 9 (a banner only with `LOOM_NOTIFY=1`).
3. Ollama with `OLLAMA_KEEP_ALIVE=-1` and `OLLAMA_MAX_LOADED_MODELS=2` (48 GB:
   both models stay loaded). Warm both models once.
4. Mosquitto, Zigbee2MQTT (frontend loads, every device seen), WLED
   controller answers (its app/web page).
5. stagehand **`show`** job and **`agents`** job (separate launchd jobs:
   `com.mapsandducks.stagehand.show` / `.agents`; `uv run stagehand launchd
   status`). Run → Mind shows Trabolta's worker connected.
6. The house announcements player running: stagehand's `alexa` module
   (its code name; in the show it is only "the house system") — launchd
   job `com.mapsandducks.stagehand-alexa`, runbook `scripts/house-mac/alexa.md`.
   It owns the chime: the story's `sound announce_chime` rides MQTT
   `show/chime` to it, never QLab, so a chime and an announcement ring once.
7. QLab show file open, audio routed to the MOTU zones. [[EDIT: or the
   router, if it replaced QLab]]
8. Chrome kiosk on the TV: `/terminal/?code=<mod>&name=TV&character=Trabolta&spot=desktop-tv&view=tv`. **Click once into the TV page after every boot**
   (autoplay). The TV speaks every public Trabolta line in the Desktop: the
   hunt questions, the bottle's *"X. Truth or dare?"* and the truth questions
   it asks, so its voice must be up before V6.
9. Wall tablets in Fully Kiosk (`view=auto`: they show the screensaver + ads
   until Trabolta is introduced), all green on the heartbeat card (the Run
   page's Terminals card; the `📟 N/N` pill goes red + chimes on a tablet silent 20 s).
10. The tent tablet on `/reinstall/?code=<mod>&name=Tent tablet`. In both
    games a program may hit the King once per visit; his one health bar is
    shared all night (Run shows it; 👑 restores it). The King's **chess**
    is only on the **door terminal** outside the server room (a wall
    terminal by the keypad, on the Terminals card like the others; its
    name is what the journal shows when the King is mated: *chess won, by
    Terminal · <name>*). [[EDIT: the door terminal's provisioning URL, from
    the chess lane]]

The **mod code is never printed**: [[EDIT: where it lives — your password
manager]].

**Watch all night:** Run → Mind (worker status) · the Z2M frontend · the
stagehand log · the heartbeat card · QLab · the uptime alert on
`https://app.mapsandducks.com/api/health` (anything but 200 = loom is down,
starting or missing an event).

**Recovery**

| Problem | Do |
|---|---|
| stagehand `show` crashed, or the lights are wrong (**LIGHTS**) | restart its job (`uv run stagehand launchd restart --job show`): on reconnect it replays the current look (`Night.lights`, never the alarm; under the majority's `server_open` it replays `lights_y2k` first, then `lights_server_open`) and a room Trabolta has cut (off mid-cut; on again under the look its 90 s restore lit it in, or a later look that never re-lit that room). Still wrong → set the look by hand from the table below (`Night.lights` in Run → World names it). There is no cue to re-fire: phase cues play once |
| Trabolta's worker crashed | restart the `agents` job, or `uv run stagehand run --config <house>.yaml --only agents`. The hold line covers the gap; the directors answer DMs meanwhile |
| Trabolta's worker hung but still connected (Run → Mind shows it, nothing answers) | restart the `agents` job at once: the hold line can take minutes to come for a hung worker (known gap); the directors answer DMs by hand meanwhile |
| **NEVER** | `pkill -f "stagehand run"` (it kills both jobs) |
| Ollama slow / evicted | check `ollama ps` shows both models; reload; the first reply after a reload takes ≈ 25 s |
| a terminal hung | tap it; else Fully Kiosk → reload |
| the TV page stalled | reload Chrome, **click once into it** |
| Z2M coordinator dead | swap to the spare dongle + restore the backup (≈ 10 min); meanwhile, wall switches |
| WLED dead | power-cycle the controller; presets survive |
| uplink blip | the `show` job catches the lights up by itself when the feed reconnects; check the look and the heartbeat card (OP-16); wrong → restart the `show` job as above |
| **house internet down** | **fire cues by hand** (table below). Tell the house manager: guests turn Wi-Fi off and use cellular |
| house Mac dead | the story is fine on the VPS. Lights hold their last look; use wall switches / the WLED app. TV: [[EDIT: a spare laptop on the HDMI with the `view=tv` URL]]. Trabolta is down: the directors answer DMs |
| router dead | the ISP router (same SSID/password) |
| VPS dead | OP-21: start the warm standby, restore the newest backup, repoint DNS |
| rain / wind mid-show | the shed switch (W-22): on this device open `/reinstall/map` (signed in with the mod code), press **Shed** in the *Map:* bar and confirm — or `POST /e/<event>/api/mod/spatial/variant {"file":"house.shed.json"}` with the mod token. Programs mid-game keep playing; anyone standing in the shed goes back to the new start. Julia (the tent) moves the tent light + speaker. (Copying files on the VPS does nothing: the event plays the project's maps.) |

**ALL STOP:** the director presses 💡 (house lights; it also holds a pending
automatic dance), you press QLab **Esc** (panic), mute the TV voice, then
the wall switches.
You stay at the house Mac; the house manager leads people.

**You own:** the blackout safety check (with the house manager), the ad-hijack
video, the backups check each act (OP-21).

**Radio:** LIGHTS (to you) · HOLD · ALL STOP.

## Firing cues by hand (internet down, or stagehand down)

Run → Director still shows each cue as the director fires it (the director's
laptop can reach the VPS on a phone hotspot if needed). When a cue fires, set
the look yourself. [[EDIT: fill the preset numbers / scene names after the
10-22 bench]]

| Story cue | Lights (WLED preset / Z2M scene) | Sound (QLab) |
|---|---|---|
| `lights_screensaver` (doors) | [[EDIT]] | `modem_handshake` (each login, the Optical Drive) |
| `lights_tube_chase` (each clearance) | WLED Tube chase [[EDIT: preset #]] | — |
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

House announcements (`do announce`) by hand: `say -a <MOTU device> "<line>"` in a
terminal, or read them over the radio to the room.

## Before the night

- [ ] Bench Thu 10-22 with John: the door contact (wire loops that touch when
      the door opens), the keypad lock (code + egress), the bay, the lights, the blackout
      test (stopwatch every flashing preset ≤ 3 Hz).
- [ ] Tech run 10-28, dress 10-29 (incl. the shed switch in < 15 min).
- [ ] Your device has the mod code and the map page (`/reinstall/map`) provisioned
      and signed in, showing the *Map: Tent | Shed* bar (W-22).
- [ ] The IP sheet + one-page runbook taped in the server room (every device's
      IP, these recovery steps, the mirror-view fallback URL, the rollback
      command). [[EDIT: write the IP sheet after the 10-22 bench]]
