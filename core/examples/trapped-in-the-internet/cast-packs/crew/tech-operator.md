# Tech operator ([[EDIT: name — by Tue 10-20]])

> Not in the story. You stay at **the house Mac** all night. It drives the TV
> over the long HDMI run, plays room audio through the **MOTU** (ADAT), and
> runs Mosquitto, Zigbee2MQTT, stagehand `show` + `agents`, Ollama and the
> Alexa player. If it dies, the house goes quiet but **the story keeps
> running on the VPS** and the phones keep working.

## Card

**Boot list (15:00)**

1. Router + UPS on; Wi-Fi up. [[EDIT: SSID]]
2. House Mac on its charger: `caffeinate` running, sleep off (`pmset`).
3. Ollama with `OLLAMA_KEEP_ALIVE=-1` and `OLLAMA_MAX_LOADED_MODELS=2` (48 GB:
   both models stay loaded). Warm both models once.
4. Mosquitto, Zigbee2MQTT (frontend loads, every device seen), WLED
   controller answers (its app/web page).
5. stagehand **`show`** job and **`agents`** job (separate launchd jobs)
   [[EDIT: labels]]. Run → Mind shows Trabolta's worker connected.
6. The Alexa (announce) player running.
7. QLab show file open, audio routed to the MOTU zones. [[EDIT: or the
   router, if it replaced QLab]]
8. Chrome kiosk on the TV: `/terminal/?code=<mod>&name=Living Room
   TV&spot=<spot>&view=tv`. **Click once into the TV page after every boot**
   (autoplay).
9. Wall tablets in Fully Kiosk, all green on the heartbeat card.

The **mod code is never printed**: [[EDIT: where it lives — your password
manager]].

**Watch all night:** Run → Mind (worker status) · the Z2M frontend · the
stagehand log · the heartbeat card · QLab.

**Recovery**

| Problem | Do |
|---|---|
| stagehand `show` crashed | restart its job [[EDIT: `launchctl kickstart -k gui/$(id -u)/<show label>`]], then **re-fire the current lights cue** (ask the director which) |
| Trabolta's worker crashed | restart the `agents` job, or `uv run stagehand run --config <house>.yaml --only agents`. The hold line covers the gap; the directors answer DMs meanwhile |
| **NEVER** | `pkill -f "stagehand run"` (it kills both jobs) |
| Ollama slow / evicted | check `ollama ps` shows both models; reload; the first reply after a reload takes ≈ 25 s |
| a terminal hung | tap it; else Fully Kiosk → reload |
| the TV page stalled | reload Chrome, **click once into it** |
| Z2M coordinator dead | swap to the spare dongle + restore the backup (≈ 10 min); meanwhile, wall switches |
| WLED dead | power-cycle the controller; presets survive |
| uplink blip | after it's back: re-fire the current lights cue, check the heartbeat card (OP-16) |
| **house internet down** | **fire cues by hand** (table below). Tell the house manager: guests turn Wi-Fi off and use cellular |
| house Mac dead | the story is fine on the VPS. Lights hold their last look; use wall switches / the WLED app. TV: [[EDIT: a spare laptop on the HDMI with the `view=tv` URL]]. Trabolta is down: the directors answer DMs |
| router dead | the ISP router (same SSID/password) |
| VPS dead | OP-21: start the warm standby, restore the newest backup, repoint DNS |
| rain / wind mid-show | the shed switch: `show-map-switch shed` over SSH from this device (W-22); WebMD moves the tent light + speaker |

**ALL STOP:** QLab **Esc** (panic), mute the TV voice, then the wall switches.
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
| `lights_screensaver` (doors) | [[EDIT]] | `modem_handshake` (each login, Mud Room) |
| `lights_tube_chase` (each clearance) | WLED Tube chase [[EDIT: preset #]] | — |
| `lights_call_desktop` (C1, C2, ⏳) | [[EDIT]] | `alexa_chime` (`countdown_tick` at ⏳) |
| `lights_game` (Bingo, hunts) | [[EDIT]] | `bingo_start` (V2) |
| `lights_truth_time` (V6) | [[EDIT]] | — |
| `lights_ad_hijack` (📺) | [[EDIT]] | `ad_jingle` + the ad video on the TV |
| `lights_glitch` (📥, 🫘, 🤖) | [[EDIT]] | `truther_glitch` / `beans_spill` |
| `lights_pong` (🏓) | [[EDIT]] | — |
| `lights_trust_chart` (📊) | [[EDIT]] | `printer_grind` (🖨) |
| `lights_y2k` (🕚) | [[EDIT]] | `y2k_chime` (+ each clock warning) |
| (🗜 zip everyone out) | — | `zip` |
| `lights_server_open` (majority / chess) | [[EDIT]] | — |
| `lights_alarm` (breach) | [[EDIT]] | `alarm_siren` |
| `lights_blackout` → +10 s `lights_dance` (Combo A/B) | blackout (safety bulbs stay on) → dance | `dance_song` (+ `windows_shutdown` on B) |
| `lights_final_reveal` (🌑) | [[EDIT]] | — |
| `lights_song` / `lights_rave` / `lights_purgatory` / `lights_banish` | [[EDIT]] | the ending's track |
| `lights_restore` (💡, endings) | house lights up | `motorcycle` on his exits |

Alexa lines (`do announce`) by hand: `say -a <MOTU device> "<line>"` in a
terminal, or read them over the radio to the room.

## Before the night

- [ ] Bench Thu 10-22 with John: the reed, the bay, the lights, the blackout
      test (stopwatch every flashing preset ≤ 3 Hz).
- [ ] Tech run 10-28, dress 10-29 (incl. the shed switch in < 15 min).
- [ ] Your device has the SSH key + `show-map-switch` (W-22) and the mod code.
- [ ] The IP sheet + one-page runbook taped in the server room (every device's
      IP, these recovery steps, the mirror-view fallback URL, the rollback
      command). [[EDIT: write the IP sheet after the 10-22 bench]]
