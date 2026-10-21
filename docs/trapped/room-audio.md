> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../core/examples/trapped-in-the-internet/OCT31.md)). **The `audio` router module was not built**; QLab stays the room router (OCT31 workaround). The topology is simpler than §1: there is **one house Mac** (the Ollama laptop) — it drives the TV over HDMI, the MOTU (ADAT) speakers and runs Mosquitto / Z2M / stagehand `show` + `agents` + the `alexa` player and Ollama; read "TV computer" and "show laptop" below as that Mac. Built: the TV view (`view=tv`, K-18) speaking Trabolta's lines in The Desktop through `/api/mod/tts` (song beats captioned only, a director mute), the fake Alexa (K-20: chime + voice on MOTU ch 1–4 = living + kitchen, a disk cache + `prewarm:`, `say` as last resort), and Kokoro as a CPU-capped compose service on the VPS (K-19, `KOKORO_CPUS`). Not built: `LOOM_TTS_CACHE_DIR` (the proxy cache is still in memory), `pnpm tts:warm`, the `/media/` route + manifest, the LAN control page.
>
> **Superseded 2026-10-15 (Oct 31 wave 2):** the voices are the **devices' own** — the terminals' and the TV's `speechSynthesis` / Fully Kiosk TTS / the macOS voices, and the alexa player's `say` (`engine: say`). Kokoro is an opt-in behind the compose `tts` profile, `LOOM_TTS_URL` defaults to `off`; the TTS plans below (`LOOM_TTS_CACHE_DIR`, `tts:warm`, SW-AUD-08) are not needed for the show. Terminals with `&announce=1` also say the house announcements (N-09).

> **Wave 17 status (2026-10-20, branch `oct31-w17/router`, not merged or deployed):** **the `audio` router module is built** (SW-AUD-01's core, SW-AUD-05's announcements, SW-AUD-07's health, HW-AUD-10's walk as the map editor's Test buttons). It is **off** until a show switches it on, and what it reads changed from §4: the speakers, zones, the interface's input→output matrix and the per-sound targets are the event's project file **`audio.json`** (the map editor's Audio panel, `@loom/house` `validateAudio`, `GET /api/mod/audio`), not YAML, and rooms are **`house.json` room ids / LOCATIONs**, not the Z2M group names. §11 below is the built contract; §4's YAML (buses, `sync`, `exclusive`, `stop_on`, `show/audio/cmd`, the `:7700` page, the media manifest) is **not** built.

> **Wave 18b status (2026-10-21, branch `oct31-w18/audio`, not merged or deployed): the router is the show's.** The user's answers: the router plays **story sounds and house announcements**, the separate announcement player (stagehand `alexa`) retires, labelled placeholder sounds are generated for every story cue, and **QLab is not part of the rig** (it is struck everywhere below: read every "QLab" in §0–§10 as history). The interface is a **MOTU 828x + an ADAT expander**. `trapped.house.yaml`'s `audio:` section is on (`play_sounds`, `announce`, `passthrough: false`); its 19 OSC sound rules, the OSC target and `duck_music` are gone, and so is `alexa:`. New: `device.expect`, the placeholders, ■ Stop house sounds, and the tablets that also say the announcements as a house list. §11 is updated and §12 is what wave 18b added. The house Mac runbook is [`scripts/house-mac/audio.md`](../../scripts/house-mac/audio.md).

# Audio + TV architecture (Trapped in the Internet)

*2026-10-15. Scope: the living-room TV and the computer that drives it, its
16-channel interface feeding per-room speakers, the wall terminals' own
audio/speech/video (old Android tablets), and how all of it is driven from
the VPS-hosted event server. Binding inputs: Decisions #13/#14 (TV = the main
Trabolta display; 16 outs cover living room, kitchen and other rooms;
terminals still play their own media), #15 (old Android tablets), #16 (VPS),
#20 (house announcements through terminals and house audio), #21 (the
Installation Wizard = pre-recorded video), #23/#31 (tent really outside, shed fallback), #26 (awards ceremony).
Built on `screens.md` (§3.4 TTS, §5.5 media, §6 templates), a research
report; the shipped audio path is `scripts/house-mac/audio.md` (the house
speaker router, wave 18b; it replaced the alexa announcement player) and
`docs/loom-show-control.md`. Not re-derived here.*

---

## 0. Decision in one paragraph

Add a native **room-audio router**: a new stagehand module, `audio`
(Python: `sounddevice`/PortAudio + `soundfile` + `numpy`). It runs on the
**TV computer** next to the `show` module and opens **one 16-channel output
stream** on the interface. It mixes every cue in-process into named rooms
(room → channel(s) in YAML), with per-bus gain, fades, ducking and stop-all.
It takes cues from the server feed it already holds, and from a LAN-only
fallback (MQTT + a local control page) when the uplink drops. It plays only
from a **local media cache** synced from the VPS `/media/` manifest. The
**TV's Chrome kiosk** (terminal TV mode) is a second client on the same
interface: its default output is channels 1–2, which feed the living-room
speakers, so Trabolta's voice, lip-synced to his face, and the video soundtracks
come straight out of the living room with no extra plumbing.
**Tablets keep their own audio**: pilot speech, the WebMD video, and
announcements in rooms the house speakers don't reach (the tent, the
bathroom). They stay muted for anything the house speakers already cover.
**QLab is not chosen.** ~~The existing OSC rules stay in `trapped.house.yaml`
as the zero-code fallback until the module lands, and only if the TV
computer is a Mac.~~ (Wave 18b: QLab is not part of the rig; the OSC rules
are deleted.) **Browser multichannel Web Audio is rejected** as the
router (§2).

**The TV computer: macOS** (a Mac mini, or an old Apple-silicon/Intel
MacBook in clamshell mode). That is the easier choice. CoreAudio exposes a
class-compliant 16-out interface with no drivers. Several apps can share it
at once (Chrome on 1–2 plus the router on all 16), so no JACK or PipeWire
setup is needed. Audio MIDI Setup names the channels and pins 48 kHz. The
crew already works on macOS, and QLab, the fallback, exists only there.
Linux works too, but takes more fiddling: on Ubuntu 24.04 with PipeWire,
switch the card to the "Pro Audio" profile, and PortAudio then reaches the
device through pipewire-alsa or pipewire-jack. Do that only if the box is a
PC. **Not a Pi 5**: three.js + Chrome + a 16-ch mixer + the `show` module +
Mosquitto/Z2M is too much for it, and the CHECKLIST row "TV box: Raspberry
Pi 5" should become "TV computer: Mac mini / MacBook".

---

## 1. Topology

```
                 VPS (Caddy + @loom/core event server, Kokoro TTS, /media/)
                      ▲  SSE out to the house  ▲ HTTPS
   home uplink (+ LTE failover) ─────────────────────────────────────────
                      │                         │
  ┌─ TV computer (macOS, wired, UPS) ─────────┐  │   ┌─ show laptop ───────────────┐
  │ Chrome --kiosk  /terminal/?spot=desktop-tv │  │   │ Ollama (gpt-oss:20b, Qwen)  │
  │   face + TTS voice + video  → ch 1/2 ──┐   │  │   │ stagehand --only agents ────┼─► VPS (outbound SSE)
  │ stagehand --only show   (MQTT ⇄ lights)│   │  │   │ (optional local Kokoro)     │
  │ stagehand --only audio  (16-ch mixer) ─┤   │  │   └─────────────────────────────┘
  │ Mosquitto + Z2M (Zigbee dongle)        │   │  │
  │ local control page :7700 (LAN only)    │   │  └── tablets (old Android, Fully Kiosk) → VPS
  └────────────────────────────────────────┼───┘        own speakers: pilot TTS, video, uncovered-room announce
                       USB → 16-out interface (48 kHz)
           1/2 living · 3/4 kitchen · 5/6 registry · 7/8 backyard · 9 hall/tube · 10 mudroom
           11 server room · 12 bathroom (opt.) · 13/14 spare/sub · 15/16 headphone/cue monitor
                       → balanced runs → powered speakers / amps per room
```

- **Everything connects outbound to the VPS.** Stagehand `show` + `audio`
  (TV computer), stagehand `agents` (laptop), Chrome on the TV and every
  tablet each open their own SSE to the VPS. Nothing at home needs an inbound
  port. That is the point of #16.
- **Why stagehand moves to the TV computer.** It is wired, always on and on
  the UPS. It already has to be powered for the TV. It sits next to the
  living room, where the interface and the long speaker runs start. The
  laptop then carries only the LLM load (SW-AI-08 already worries about RAM
  and heat). Mosquitto + Z2M can move there too, which updates HW-NET-03/06:
  "the show laptop never sleeps" becomes "the TV computer never sleeps", and
  the laptop can die without taking down the lights.
- Run `show` and `audio` as **two supervised processes**
  (`--only show` / `--only audio`, launchd `KeepAlive`), per SW-SH-13. Then a
  mixer crash never drops the lights and a broker hiccup never drops the
  music.

---

## 2. Options evaluated

| | Browser Web Audio multichannel (on the TV page) | **Native router: stagehand `audio`** (chosen) | QLab |
|---|---|---|---|
| >2 discrete outs | Chrome on macOS: `AudioContext.destination.maxChannelCount` reports the device's channels. Set `channelCount = 16`, `channelInterpretation = "discrete"`, then a `ChannelMergerNode(16)`, and `AudioContext.setSinkId()` (Chrome 110+) to pick the interface. Works, but discrete multichannel has a history of quirks. Chromium on **Linux** (PulseAudio/PipeWire backend) is unreliable above 8 channels. **Bench-verify before trusting either.** | PortAudio opens all 16 directly (CoreAudio / ALSA-PipeWire). Routing is exact: our own matrix, no OS channel-layout guessing. | Yes, natively. Multichannel output is gated by the paid licence tier (historically "Audio"; rentable by the day). **Verify the QLab 5 tier.** |
| Dynamic TTS (Alexa, ceremony) | Yes (fetch `/api/mod/tts`). | Yes. Fetch from the VPS proxy, cache on disk, play. | No real path. Files only. |
| Server-clock scheduling (lyrics / ad sync) | Yes. | Yes (§5). | No. OSC fires on arrival. |
| Survives the uplink dropping | No. The page is served from the VPS, and a reload loses the unlock. | **Yes**: local cache + MQTT + a local control page (§7). | Yes, if operated by hand. |
| Blast radius | One tab carries three.js + the face + TTS + every room's music. A GC hitch or reload glitches the whole house. | Its own process. A crash is a 2 s launchd restart that resumes music (§7). | Its own app. |
| Room map lives in | terminal code | **YAML in the repo** (`trapped.house.yaml`), cross-checked by tests | a binary `.qlab5` workspace |
| Health on the Tech rail | Needs heartbeat plumbing. | Publishes `health/audio` (MQTT LWT) → `Tech.audio` (SW-SH-12). | No. |
| Platform | any Chrome | macOS / Linux | macOS only |
| Cost | none | ~6–8 dev-days total (§10) | licence + hand-building ~25 cues in a GUI that drifts from the story |

**Verdict.** Use the native router for room audio. Use the TV page's
*ordinary stereo output* for the living-room voice and video, which is the
one thing the browser must own because the face lip-syncs to its own
AnalyserNode (`terminal/src/speech/engine.ts:107-121`). ~~Keep the QLab OSC
rules as the fallback until SW-AUD-01 passes rehearsal.~~ (Deleted in wave 18b.)

Considered and deferred: **Chrome → BlackHole → router** (a loopback driver,
so the router takes the TV's voice as an input). That would allow mirroring
Trabolta's voice to the kitchen and sidechain-ducking music under it. But it
adds a driver, and if the router dies the TV goes silent. Kept as an option
in SW-AUD-13 (P2).

---

## 3. Who plays what

| Sound | Where it comes from | Rooms | Notes |
|---|---|---|---|
| Trabolta's Desktop lines, his presentations, the awards host | **TV Chrome** (SW-SCR-17 room voice; `SpeechQueue`, voice `am_michael`) | living (ch 1/2) | Lip-synced. Kitchen mirroring is P2 (SW-AUD-13). |
| Sandy's spoken IVR lines | TV Chrome, voice `sandy` (a per-line voice override in the queue) | living | Her chat bubble on screen. Her song lines are baked into the track. #28 stays open. |
| `dance_song`, `youre_the_one_vocoder`, `youre_the_one_sandy_only`, `rave`, `hand_jive`, ceremony bed + fanfares | **router**, music bus | `house` group (song: living + kitchen + registry) | Sync cues (§5) when screens show lyrics or visuals. |
| sfx (`modem_handshake`, `bingo_start`, `y2k_chime`, `printer_grind`, `beans_spill`, `zip`, `windows_shutdown`, `motorcycle`, `truther_glitch`, `countdown_tick`) | router, sfx bus | per-cue default rooms (§4) | Immediate (not scheduled). |
| `alarm_siren` | router (hall + server room) **and** the patch-bay ESP32's DFPlayer (HW-DOOR-05) | hall, server_room | Never in the tent. |
| Fake Alexa (`do announce "…"`): chime + TTS | **router** in covered rooms **and** `announce`-tagged tablets in uncovered rooms (tent, bathroom, shed) | announce rooms | Both start at the same `startAt`. Covered-room tablets stay silent, because two sources a few hundred ms apart sound awful. |
| Ad hijack (`screens_ad_hijack`) | video on every screen; sound from the **TV** (living) + the router playing the ad's extracted audio track to kitchen/registry/hall + uncovered-room tablets | all | Covered-room tablets muted. Same `startAt` everywhere. |
| WebMD intro (#21) | the **tent tablet** plays the video with sound (+ a small wired/BT speaker, since the tent is outside) and the phone video card | tent | Not the router. The tent is outdoors and far from the interface. |
| Pilot conversation (a guest scanned at a wall terminal talking to Trabolta) | **that tablet's** speech queue (exists today) | that tablet | Always local and private. Never routed to the house. |
| Attract-mode media player (SW-SCR-07) | tablets **muted** in covered rooms; with sound only where `media_audio: on` | — | Music in the house comes from the router, if at all. |

**Terminal audio roles.** Add two provisioning flags per terminal, next to
`spot` / `view` (SW-AUD-09):

- `announce: on|off`: speaks Alexa announcements (chime + TTS).
- `media_audio: on|off`: video and ad soundtracks play unmuted.

Defaults: **on** for `tent` and `bathroom` and wherever there is no house
speaker; **off** elsewhere. The TV is `on/on`, since it *is* the living-room
speaker. Pilot speech ignores both flags. The router's YAML lists the rooms
it covers, and `stagehand audio check` prints that list, so the director can
match the tablet flags on install day (HW-AUD-10).

---

## 4. The cue contract (YAML, on the TV computer)

A new top-level `audio:` section in `stagehand/trapped.house.yaml`, read by
the `audio` module. Room ids reuse the names the Z2M groups already use
(`living · kitchen · registry · backyard · tube · mudroom · bathroom · tent ·
server_room`), so lights and sound speak one vocabulary.

```yaml
audio:
  device: "UMC1820"           # substring of the PortAudio device name (`stagehand audio devices`)
  channels: 16
  samplerate: 48000           # pin the interface to 48 kHz in Audio MIDI Setup too
  blocksize: 256              # ~5 ms; raise to 512 on xruns
  latency_ms: 0               # calibration added to scheduled starts (§5)
  lead_ms: 1500               # sync cues start at server `at` + lead
  media:
    manifest: /media/manifest.json      # relative to server.url
    cache: ~/Library/Caches/stagehand/media
  tts:
    via: server               # POST {server}/e/{event}/api/mod/tts (scoped device token, SW-QR-10)
    fallback_url: http://127.0.0.1:8880/v1   # LAN Kokoro (laptop or this box), used when the VPS is unreachable
    voices: { alexa: af_sky, sandy: af_bella, trabolta: am_michael }
  rooms:                      # room → interface outputs (1-based), trim in dB
    living:      { out: [1, 2] }          # also the TV's Chrome default output
    kitchen:     { out: [3, 4], gain: -3 }
    registry:    { out: [5, 6] }
    backyard:    { out: [7, 8] }          # Truth Pong; outdoor speaker on a GFCI
    tube:        { out: [9] }             # mono rooms take an L+R fold-down
    mudroom:     { out: [10], gain: -6 }
    server_room: { out: [11] }
  groups:
    house:    [living, kitchen, registry, tube, mudroom, backyard]
    indoors:  [living, kitchen, registry, tube, mudroom]
    announce: [living, kitchen, registry, tube, mudroom]   # tablets cover tent/bathroom
  buses:
    music:    { gain: 0,  duck: { under: [announce], db: -12, attack_ms: 150, release_ms: 900 } }
    sfx:      { gain: 0 }
    announce: { gain: 0 }
  cues:                       # key = the `sound <name>` target; files are manifest names
    dance_song:            { file: dance_song,  rooms: house,  bus: music, sync: true, exclusive: music, resume: true }
    youre_the_one_vocoder: { file: youre_the_one_vocoder, rooms: [living, kitchen, registry], bus: music, sync: true, exclusive: music }
    youre_the_one_sandy_only: { file: youre_the_one_sandy_only, rooms: [living, kitchen, registry], bus: music, sync: true, exclusive: music }
    rave:                  { file: rave, rooms: house, bus: music, exclusive: music, resume: true }
    alarm_siren:           { file: alarm_siren, rooms: [tube, server_room], bus: sfx }
    alexa_chime:           { file: alexa_chime, rooms: announce, bus: announce }
    ad_hijack_audio:       { file: ad_hijack.m4a, rooms: [kitchen, registry, tube], bus: sfx, sync: true }
    countdown_tick:        { file: countdown_tick, rooms: indoors, bus: sfx }
    # … one line per name in the spec's §2.13 sound registry (HW-AUD-01/02)
  announce:                   # `do announce "…"`
    rooms: announce
    chime: alexa_chime
    voice: alexa
    sync: true                # same startAt as the tablets' announce program
  stop_on:                    # cues that silence a bus (e.g. the blackout kills music before the dance)
    - { directive: cue, target: lights_blackout, stop: [music], fade_ms: 0 }
```

**From the story** (no language change is needed for v1):

- `sound dance_song` lowers to directive `sfx` with target `dance_song` and
  plays with the YAML defaults (`core/src/parser/statements.ts:76`; today
  `sound` takes a single name).
- An override uses the **long form**, which works today because stagehand
  parses kwargs (`show/directives.py:80-94`):
  `<sfx: dance_song, rooms: living kitchen, gain: -6>`.
  Stop with `<sfx: stop, bus: music, fade: 3>` or `<sfx: dance_song, action: stop>`.
  A Loom 4 nicety, `sound X in kitchen` / `stop sound X`, rides with
  SW-SH-08.
- `do announce "…"` lowers to directive `announce` with target = the text.
  It already exists in the story (`main.loom:1142,1253,1381,1687,1737`), and
  in the YAML at `trapped.house.yaml:347` as an MQTT stub. That stub is
  replaced by the module.
- ~~The QLab OSC `sfx` rules (`trapped.house.yaml:287-343`) stay until
  SW-AUD-01 passes, then are deleted.~~ Deleted in wave 18b. The test
  (`test_trapped_house.py` `test_every_sound_is_routed`) asserts that every
  `sound <name>` in the `.loom` files has an `audio.json` cue **and** a
  `media/sounds.yaml` entry, and that no sound rule goes to OSC.

**Local command topic** (LAN, always on): `show/audio/cmd` with
`{"play": "<cue>", "rooms": [...]}`, `{"stop": "music", "fade_ms": 2000}`,
`{"say": "…", "voice": "alexa", "rooms": "announce"}`, `{"master": {"kitchen": -10}}`.
`show` rules, the local control page and an emergency Stream Deck all go
through this one entry.

---

## 5. Latency and sync

**Budget.** An immediate cue travels: the story event → the VPS fans out the
mod SSE `sim` frame → the home uplink → the router. That is typically
**80–300 ms**. Fine for sfx, chimes and the siren. Lights and audio both
leave the same box from the same frame, so they stay aligned to within a
few ms of each other.

**Sync cues** (songs with lyrics, the ad hijack, announcements that tablets
also speak) need one shared start time:

1. **Server stamp.** Add `at` (server `Date.now()`) to every mod SSE `sim`
   frame and every screen-stream program (SW-AUD-03). Today the frame is the
   bare `SimEvent` (`core/server/event-runtime.ts:567`;
   `core/src/runtime/sim/event.ts:94` has no time). Then `startAt = at +
   lead_ms`, computed identically by `ScreenHub` (SW-SCR-03/05) and the
   router. The two never have to talk to each other.
2. **Clock offset.** `GET /api/time → {now}`, sampled 5× at boot and every
   60 s; keep the minimum-RTT sample (NTP-style). Over a home uplink, expect
   ±10–30 ms of error. Tablets do the same for the screens (SW-SCR-15 already
   needs this).
3. **Output latency.** The router knows its PortAudio output latency
   (`stream.latency`) and subtracts it. Chrome reports
   `AudioContext.outputLatency` / `baseLatency` and subtracts it for the TV.
   Whatever is left over is calibrated once on install day: play a click on
   the TV and the router together, then adjust `latency_ms` until it sounds
   like one click (HW-AUD-10).
4. **Late arrival.** A sync cue that arrives after `startAt` starts at
   `now - startAt` into the file (`late: seek`, the default for music).
   One-shot stingers use `late: skip` if more than 2 s late.

Different rooms 20–40 ms apart are inaudible, because the rooms are
acoustically separate. The only boundary that matters is living ↔ kitchen
during the song: keep that within ~20 ms. **TV video ↔ living-room audio
lip sync** is automatic, because the TV page plays the video's own
soundtrack through its own output. The router never plays audio that has to
lip-sync to the TV picture; for the ad, the router feeds only the *other*
rooms.

**The blackout → dance sequence** (E4/E6). `lights_blackout` and
`dance_song` arrive in the same story drain. The router `stop_on` kills
music instantly. `dance_song` keeps its 10 s silent head (HW-AUD-01), so
music lands with the story's +10 s `lights_dance` even with no scheduling.

---

## 6. Media pipeline

**Masters** (WAV/ProRes, outside git) → **`pnpm media:build`** (SW-AUD-12;
a small ffmpeg-driven script in `core/scripts/`):

- Loudness: speech/announce at **−16 LUFS**, music at **−14 LUFS**, true
  peak −1 dBTP (`loudnorm` two-pass), so no cue needs a level ride.
- Router copies: **FLAC 48 kHz** (stereo, or mono for VO).
- Terminal copies: **AAC-LC `.m4a` 128–192 k, 44.1/48 kHz**, plus **MP3**
  for the oldest WebViews. Video is **H.264 Main@L3.1, 720p30, AAC-LC
  stereo, `-movflags +faststart`**. No HEVC/VP9/AV1/Opus-in-MP4: old Android
  hardware decoders choke. Lyrics are `.vtt`.
- The ad hijack's soundtrack is also extracted to `ad_hijack.m4a`, cut from
  the same master, so the router's rooms match the TV picture.
- It writes **`media/manifest.json`**: `{name, file, kind, duration_ms,
  sha256, bytes, lufs, spots?}`. Filenames carry the hash
  (`dance_song.3f9a1c.flac`), so every cache is immutable and a
  re-render can never play stale audio.
- Checks: every name in the spec's §2.13 registry exists, `dance_song` has a
  ≥ 9.5 s silent head, and nothing clips.

**On the VPS:** `rsync media/ vps:/srv/loom/media/` is the `LOOM_MEDIA_DIR`
read-only bind mount, served at `GET /media/<file>` with Range/206, ETag and
`Cache-Control: immutable`, plus the manifest. That is SW-SCR-04 (already
P0); this design only adds the manifest + `.flac` type.

**On the TV computer:** at boot, and on the `media.sync` command, the router
fetches the manifest and downloads anything missing or with a bad hash into
`~/Library/Caches/stagehand/media/`. It **only ever plays from local disk**:
nothing streams at cue time. `stagehand audio check` lists missing or stale
files, and the router publishes `media_ready` on `health/audio`. Long music
is streamed from disk in blocks by `soundfile`; short sfx are preloaded into
RAM.

**On the tablets:** SW-SCR-25 precache, scoped to what that spot uses. Old
Android tablets have small storage and RAM, so the tent gets WebMD; every
screen gets the ad hijack, chime and slides.

**TTS clips:** see §8.

---

## 7. Failure plan

| Failure | What happens | Mitigation |
|---|---|---|
| Uplink down (or the VPS) | The story stops, so no new cues arrive. Music already playing keeps playing (local files). | Failover to the LTE router (HW-NET "LTE hotspot" row → make it **automatic failover**, not a tether someone has to notice). The **local control page** `http://tv.local:7700` (LAN, no auth beyond the show SSID, PIN for destructive buttons) offers a cue board grouped by act, stop/fade per bus, master per room, "say" with TTS through `fallback_url`, and the live meters. `show/audio/cmd` works from any LAN device. The director keeps the house sounding right by hand until the story resumes. |
| Router crash | Silence on 15 channels; the TV voice still works. | launchd `KeepAlive`, which restarts it in ~2 s. A local state file records the cues in flight (`cue, startedAt`). Within 5 min it **resumes** `resume: true` music at the right offset. One-shots don't resume. |
| Interface unplugged / sleeps | PortAudio error | Retry the open every 2 s. `health/audio {ok: false}` → a Tech rail alarm (SW-SH-12 / SW-ADM-06). Disable macOS power-down of USB audio; the box is on the UPS. |
| TV Chrome crash / reload | The living room loses Trabolta's voice. | Chrome `--kiosk --autoplay-policy=no-user-gesture-required` under launchd. **No wake tap needed** on the TV. The screen stream replays state on connect (SW-SCR-03). |
| VPS → Kokoro broken | No neural voice on terminals or for announcements | §8: Kokoro runs *on the VPS*, with a disk cache prewarmed from the script. The router falls back to LAN Kokoro, then to a pre-rendered file, then to macOS `say`. Tablets fall back to `speechSynthesis` (poor on old Android: plan on prewarm). |
| Tablet audio not unlocked | Silent tablet | Fully Kiosk "Autoplay videos / audio" removes the gesture. The heartbeat reports `audio: false` → "needs a tap" on the Screens page (SW-SCR-21). |

---

## 8. TTS on a VPS (resolves SW-AI-15)

Today `/api/mod/tts` proxies to `LOOM_TTS_URL` (`core/server/tts.ts:36-47`),
with an **in-memory** LRU. On a VPS, Kokoro on the house laptop sits behind
NAT and cannot be reached.

**Recommendation: run Kokoro on the VPS** as a compose service
(`ghcr.io/remsky/kokoro-fastapi-cpu`, `LOOM_TTS_URL=http://kokoro:8880/v1`).
Kokoro-82M is small, and on a 4 vCPU / 8 GB VPS short lines synthesise
faster than real time. **Measure it on the chosen plan before the party;
size the VPS for it.** In addition:

- **A disk-backed cache** (`LOOM_TTS_CACHE_DIR`, keyed by
  `sha(text, voice, speed, model)`). Without it, a server restart drops every
  warm line.
- **`pnpm tts:warm`**: extract every fixed spoken line from the story (each
  `do announce "…"`, the hold line, every scripted `Trabolta:` / `Sandy:`
  line in `loc:The Desktop`, the ceremony's fixed frames) and render them
  through the proxy. The fixed script then costs **zero synthesis** during
  the show. Only agent replies and ceremony ad-libs are synthesised live.
- The router and the TV both call the VPS proxy, so there is one voice
  config and one cache. The router mirrors clips on its own local disk.

Alternatives, kept as fallbacks: a Tailscale/cloudflared tunnel from the VPS
to the laptop's Kokoro (best quality-per-dollar if the laptop has headroom,
but it adds the laptop and the tunnel as dependencies), or a hosted
OpenAI-compatible TTS (the proxy already supports `LOOM_TTS_API_KEY`). It
needs the internet anyway, and the voice changes.

---

## 9. Old Android tablets (audio/video specifics, #15)

- **Chrome/WebView ceilings by OS** (last Chrome on each): Android 5 → 95,
  6 → 106, 7 → 119, 8/9 → ~138. The terminal builds with Vite 5's default
  target (`chrome87`), so **Android 5 is the floor**. Android 4.4 tablets are
  out. Fully Kiosk uses the *System WebView*: update it from Play where the
  OS allows.
- **three r186 needs WebGL2** (WebGL1 was dropped in r163). GLES2-only GPUs
  (old Mali-400 / Adreno 3xx-class) can't run the world view, so those
  tablets run `view=face` / signage only. Bench-test with HW-SCR-06.
- Codecs: H.264 Main 720p + AAC-LC + MP3 everywhere. Decode at most one
  video at a time.
- `speechSynthesis` on old Android is the Google TTS engine at its worst.
  The neural voice through the VPS is the real path, which is why the
  prewarm matters.
- Tablet speakers are tiny. **The tent tablet gets a small powered speaker**
  (3.5 mm or BT; it is outdoors). That also covers the shed fallback (#31):
  the speaker travels with the tablet.
- Fully Kiosk: "Autoplay videos", "Keep screen on", "Restart on crash", and
  media volume pinned with "Set volume level" per device (HW-SCR-02 gains
  the volume line).

---

## 10. New checklist items + size

**Software** (new section `SW-AUD`, or fold into §1 Screens / §9 Stagehand):

- **SW-AUD-01** 🔴 P0 · L — **stagehand `audio` module core.** A
  `sounddevice` 16-ch stream, voice mixer (rooms, buses, gain, fades,
  `exclusive`, `stop_on`, mono fold-down), config parse + validation,
  consuming `sfx` / `announce` / stop from the existing mod feed, plus
  `stagehand audio devices | test <room> | walk`. Tests use a fake sink.
  Replaces the QLab OSC rules (deleted in wave 18b).
  `module.py` gets one registry line.
- **SW-AUD-02** 🔴 P0 · S — **Media manifest + local cache sync** on the TV
  computer (sha-verified, plays from disk only, `media_ready` health).
  Depends on SW-SCR-04.
- **SW-AUD-03** 🔴 P1 · S — **Server clock**: `at` on mod-SSE `sim` frames
  and screen programs + `GET /api/time`. Shared by ScreenHub and the router.
- **SW-AUD-04** 🔴 P1 · S — **Sync scheduling** in the router (`startAt =
  at + lead`, offset estimation, `latency_ms`, `late: seek|skip`) for songs,
  the ad hijack and announcements.
- **SW-AUD-05** 🔴 P1 · M — **Fake Alexa end to end**: `do announce` →
  chime + TTS on the router's `announce` rooms **and** an `announce` program
  to `announce: on` tablets (supersedes the "either/or" in SW-SH-07 /
  SW-SCR-18: it is both), with music ducking.
- **SW-AUD-06** 🔴 P1 · M — **Uplink-failure kit**: the `show/audio/cmd`
  MQTT entry, the local control page `:7700` (cue board, buses, room
  masters, say, meters), and resume-after-restart.
- **SW-AUD-07** 🔴 P1 · S — **Health**: `health/audio` LWT (device,
  xruns, playing, media_ready) → `Tech.audio` (SW-SH-12, SW-ADM-06).
- **SW-AUD-08** 🔴 P0 · M — **Kokoro on the VPS** (compose service),
  `LOOM_TTS_CACHE_DIR` disk cache in `core/server/tts.ts`, and
  `pnpm tts:warm` extracting the fixed lines. **Closes SW-AI-15.**
- **SW-AUD-09** 🔴 P1 · S — **Terminal audio roles**: the
  `announce` / `media_audio` provisioning flags, muted media in covered rooms,
  TV = `on/on`, and the per-line `voice` (Sandy) in `SpeechQueue`.
- **SW-AUD-10** 🔴 P1 · S — **Old-Android media compatibility**: codec
  profile, MP3 fallback, a WebGL2 probe → `view=face`, Fully volume. A
  bench script that plays one of each format.
- **SW-AUD-11** 🔴 P1 · S — **Story/test glue**: long-form `rooms:` /
  stop documented in the writer's help; SW-SH-02 asserts every `sound` has an
  `audio.cues` entry + a manifest file; ceremony cues (`drumroll`,
  `award_fanfare`, `ceremony_bed`) added to the spec's §2.13 registry.
- **SW-AUD-12** 🔴 P1 · S — **`pnpm media:build`** (loudnorm, transcodes,
  faststart, hashed names, manifest, registry/silent-head checks).
- **SW-AUD-13** 🔴 P2 · M — The Desktop PA mirror (Trabolta's TV voice
  into the kitchen) + dynamic ducking under the TV voice, via a BlackHole
  input to the router *or* `speaking` frames on the screen stream.

**Size.** About **9–11 dev-days** for the P0+P1 set. The P0 slice
(01 + 02 + 08), where every `sound` plays in the right rooms from local
files and the terminals have a reachable neural voice, is **~4.5 days**.
SW-AUD-03/04/05/09 come after ScreenHub (SW-SCR-03) exists, because they
share its `startAt`. ~~The QLab OSC rules cover the gap if the TV computer
is a Mac.~~ (No QLab since wave 18b.)

**Hardware** (extend §H Audio / §B Screens):

- **HW-AUD-07** 🔴 P0 — **TV computer: a Mac mini or MacBook (clamshell)**
  replaces the "Raspberry Pi 5 TV box" row. HDMI to the TV, wired Ethernet,
  on the UPS, never sleeps (`pmset`, caffeinate). Chrome kiosk + stagehand
  `show`/`audio` (+ Mosquitto/Z2M) under launchd.
- **HW-AUD-08** 🔴 P0 — **Confirm the 16-out interface**: class-compliant
  USB Audio 2.0, and whether there are 16 *analog* outs or 8 + ADAT (ADAT
  needs a DA converter such as an ADA8200-class box). Pin 48 kHz and name the
  channels in Audio MIDI Setup. Set it as the system default output, so
  Chrome lands on 1/2 = living.
- **HW-AUD-09** 🔴 P1 — **Per-room speakers + runs**: a powered speaker
  (or a 2-ch class-D amp + passives) per covered room; balanced TRS→XLR/TRS
  runs labelled by channel; ground-loop isolators where the TV/HDMI hums;
  an IP-rated speaker on a GFCI for the backyard (HW-SAFE-03). The tent is
  covered by its tablet + a small speaker, not a 30 m run.
- **HW-AUD-10** 🔴 P1 — **Install-day audio walk**: `stagehand audio walk`
  speaks "kitchen, channels three and four" in each room; the click-sync
  calibration of `latency_ms` against the TV; levels set with people in the
  rooms; tablet `announce`/`media_audio` flags matched to the router's room
  list.
- **HW-AUD-11** 🔴 P1 — **Tent/shed audio**: a small powered speaker
  for the tent tablet (WebMD + announcements), which moves to the shed in bad
  weather (#31).
- **Updates to existing rows**: HW-AUD-04 now reads "wire `sound` → the
  `audio.cues` map". HW-AUD-05/06 (pre-rendered files) become **fallbacks**
  for SW-AUD-05 / SW-SCR-17. HW-NET-03/06 move the broker + "never sleeps"
  to the TV computer. The "LTE hotspot" row becomes **automatic WAN
  failover**. Decision #14 ("where music plays") is **closed** as "the
  router through the 16-out interface". Add ceremony assets (`drumroll`,
  `award_fanfare`, `ceremony_bed`) to HW-AUD-02.

---

## 11. What wave 17 built (the `audio` module), as wave 18b runs it

Code: `stagehand/src/stagehand/audio/` (`routing.py`, `mixer.py`,
`engine.py`, `sounds.py`, `placeholders.py`, `config.py`, `module.py`);
config: `stagehand/audio.example.yaml` and the `audio:` section at the end
of `stagehand/trapped.house.yaml` (on since wave 18b); the README's
*audio — the house speaker router*. Every part runs in pytest with no device (a fake `sounddevice`
stream, a fake server).

### 11.1 Two files, two owners

| | `audio.json` (the event's project file) | `audio:` (the house Mac's YAML) |
|---|---|---|
| Says | the device (name substring, channels used — the show's 828x: 24 in / 22 out — rate, `expect`), input + output labels, **speakers** (room, position, outputs, trim), **zones**, the **routes** matrix, **cues** (sound → targets, gain), `announce.to` / `announce.terminals`, `voice.tv` | what this Mac may do: `play_sounds`, `announce`, `passthrough`, `sounds_dir`, levels (`master_db`, `limit_db`, `duck_db`), `say_voice`, `chime`, an optional broker |
| Edited in | the map editor's Audio panel (a director save in the event state dir beats the project copy; `LOOM_AUDIO` is the LAN fallback) | the file, then `stagehand launchd restart --job audio` |
| Reaches the router | a long-poll, `GET /api/mod/audio?router=1&name=<host>&after=<version>&tests=<seq>&stops=<seq>&wait=25` (returns at once on a new version, a pending speaker test or a stop; `router=1` is what the editor's router badge reads) | at boot |

The router keeps the last `audio.json` and `house.json` it saw in
`cache_dir` (`~/Library/Caches/stagehand-audio`), so a boot with the house
internet down still routes; failing that, `config_file` / `house_file`. A
server with no `/api/mod/audio` (an older release) is logged once.

### 11.2 The stream

One `sounddevice` stream on the interface, opened by device index at the
device rate: **duplex** (N in / N out) while `passthrough: true`, so the
routes matrix can pass the inputs (mics, a line, the TV) to the speakers;
**output-only** with `passthrough: false` (no microphone permission). A
numpy callback per block mixes:

1. the matrix, `in @ gains`, every change crossfaded over 50 ms;
2. the voices — each sound laid out per speaker: a mono file on every
   output; a stereo file L → a pair's first output and R → its second (the
   speaker's own `out` order), the mono downmix ((L + R) / 2) on a
   one-output speaker. The speaker's trim + the cue's gain, 5 ms fade-in, a
   fade-out on stop; at most 32 (the oldest sfx drops);
3. the duck: sfx voices −12 dB (down over 0.3 s, back over 1 s) while the
   router's own announcement plays — or, while the `alexa` player speaks
   them (`announce: false`, or its lock still held), for `duck_hold_s` (7 s)
   after each `do announce` on the feed. Sounds
   in `no_duck` (the show's `dance_song`, `rave`, `hand_jive`) or with
   `duck: false` on their `audio.json` cue never duck;
4. the master gain, then a per-output peak limiter (−1 dBFS, instant
   attack, 0.25 s release) and a hard clip.

A stream that closes, or stays "active" but stops calling back (a replugged
MOTU), is reopened by a 2 s watchdog. PortAudio reads its device list only
when it initialises, so every open after a failure (a dead or stalled
stream, an open that raised) re-initialises PortAudio first and a replugged
interface is found again (`reinits` in the health line). A blank
`device.name` (the server's default `audio.json`) opens the Mac's default
output, with one warning. A story restart (`reset`, `reload`,
`golive`, `ended`) fades every sound out over 1 s.

### 11.3 Where a sound goes

`sound X` arrives as the mod feed's `sim` directive `sfx`. First rule that
applies:

1. the story line's rooms — `sound X with rooms: a b` / `sound X in <Place>`,
   lowered to the `rooms:` argument (an unlowered `X with rooms: …` from an
   older server reads the same);
2. `audio.json` `cues[X].to`;
3. the enclosing beat's `setting` (a LOCATION; the directive event carries it);
4. everywhere.

A target is `everywhere` (every speaker) or reaches the union of everything
it names: a speaker id, a zone id or name, a `house.json` room id or label,
a LOCATION (every room whose `location` it is). Names fold like
`foldTarget` (case, `_` / `-` → a space, runs of spaces collapse; `startbar`
is not `Start Bar`). `The Desktop` stays one name when it resolves whole;
`desktop start-bar` and `a, b` split. The Python `resolve_targets` mirrors
`@loom/house` `resolveTargets` exactly; both run the shared cases in
`house/test/fixtures/audio-resolve.json` (stagehand keeps byte-identical
copies in `tests/fixtures/house-audio/`, diffed against the house files
when they sit beside it).

Files: `sounds_dir/X.wav | .aiff | .aif | .flac` (exact name, then
case-insensitive), resampled once to the device rate with a band-limited
FFT resampler (songs are full range; the alexa player's linear resample is
for a chime and a voice) and kept in memory
(re-read when the file changes), preloaded on every config change. A name
with no file, a cue that reaches no wired speaker, or a closed stream is
logged once and skipped — never a crash. A cue's `to` that reaches no
speaker does **not** fall through to the setting or everywhere: the sound is
skipped. `GET /api/mod/audio` lists it as a warning (*… reaches no
speaker*), and so does the map editor's problem list, so check the warnings
before setting `play_sounds: true`. The starter gives the mud room (The
Optical Drive) a speaker for exactly this reason: every arrival's
`modem_handshake` is cued there.

The story's `sound announce_chime` is never a cue: the chime rings with the
announcements, on `announce.to` (or from the `alexa` player). The Audio tab
shows its row as *rings with the announcements*, and a cue keyed on it is
warned about.

### 11.4 Who plays the sounds, announcements, one voice

- The show (wave 18b): `play_sounds: true` and `announce: true` — the router
  plays every `sound X` and every announcement; `trapped.house.yaml` has no
  OSC sound rule and no `alexa:` section.
- `play_sounds: false` (the module's default, for another house): another
  cue player keeps `sound X`; the router runs only the matrix and the tests.
- `play_sounds: true` beside OSC sound rules: the config loader drops every
  `show` cue rule `on: {directive: sfx}` with an OSC output — in the show's
  own `--only show` job too, which is why `audio:` lives in
  `trapped.house.yaml`. The `announce_chime` MQTT rule stays.
- `announce: true`: the router plays `do announce` — the chime, then the
  line rendered by the Mac's `say` — through the `alexa` module's own
  `Announcer` (the 10 s chime merge, `say -a <device>` as the fallback) on
  `audio.json` `announce.to`. With `mqtt:` it takes `show/announce` /
  `show/chime` (the show's existing rules); without, the feed's `announce`
  directive and `sound announce_chime`; never both. An `alexa:` section beside
  `announce: true` is a config error, and the router takes the alexa
  player's `player.lock` before it speaks: while a player (a leftover
  launchd agent) holds it, only the announcements wait — dropped, never
  queued for later, `announce: blocked` in the health JSON — and every
  sound, the matrix and the tests play from the start; the router retries
  the lock every 5 s.
- Trabolta's TV voice still comes from Chrome on the TV. Since wave 18b
  the house Mac's default output should be HDMI (the TV), not the 828x's
  Analog 1–2; `audio.json` `voice.tv` documents where it should also reach;
  build that fan-out in CueMix FX.

### 11.5 Speaker tests and health

- The map editor's Test (`POST /api/mod/audio/test {speaker | out}`) reaches
  the router in the long-poll's `tests`; it plays a 1.5 s tone (three rising
  beeps, the pitch stepped by the output number) then says the label
  ("Start Bar. Outputs 3, 4.") at `test_gain_db` (−12). Tests seen at boot
  are never replayed; a restarted server's new sequence still plays (the
  cursor is the server's `at`). With `mqtt:` also `show/audio/test
  {"speaker": "desk-l"}` / `{"out": 3}`.
- The server knows whether a router is listening: its polls say
  `router=1`, and `GET /api/mod/audio` and every Test's answer carry
  `router {online, lastSeen, name}` (online while it is parked on a long
  poll or polled in the last 40 s). The Audio tab shows *router online* /
  *router last seen …*, and a Test sent while nobody listens says it was
  only queued: check the `audio` job on the house Mac.
- `stagehand check --only audio` probes the device against the cached /
  local `audio.json` (channel counts, and `device.expect`: §12.1), lists cue
  sounds with no file and every placeholder still in `sounds_dir` (§12.2), and
  names every file in `sounds_dir` not at the device rate (convert those
  offline; they still play, resampled at load). On a fresh house Mac with
  nothing cached it asks the server once (3 s, no long poll) and checks
  against that, the story's own sound names included; a server it can't
  reach is a warning, never a failed check.
- Every `health_s` (60) a log line: device, config version + source,
  voices, played / skipped, xruns, limiter blocks, peak, `announce` (`off` /
  `on` / `blocked`), sounds with no file (the JSON adds `reinits`);
  with `mqtt:` the same JSON retained on `health/audio/stats`, `online` /
  `lost` on `health/audio`.
- Its own launchd job: `stagehand launchd install --job audio --config
  trapped.house.yaml`.

### 11.6 Switching it on (the show)

Done in the YAML since wave 18b. On the house Mac (the full runbook is
`scripts/house-mac/audio.md`): retire alexa (`install-alexa.sh
--uninstall`), `stagehand sounds placeholders`, `stagehand check --only
audio`, `launchd install --job audio`, `launchd restart --job show`, then
Test each speaker in the map editor (the walk).

### 11.7 Not checked on hardware

Nothing here has run on the 828x. Open: whether the unit presents 32 in /
30 out to CoreAudio at 48 kHz with the expander on Optical A (and whether
its CoreAudio name contains `828x`); Thunderbolt + Reduced Security + the
MOTU kext on the house Mac; sharing the device with Chrome in CoreAudio's
shared mode (make HDMI the default output); the right `blocksize` /
`latency` for no xruns with Ollama loading the CPU; the limiter's levels on
real speakers; `say` render time before an announcement (≈ 0.3–1 s,
covered by the chime). `passthrough: false` sidesteps the microphone
permission a launchd duplex stream would need.

## 12. What wave 18b added

### 12.1 The 828x and `device.expect`

`audio.json` declares the channels we use, numbered as the 828x numbers
them (no channel map, D1): 24 inputs (Mic/Gtr 1–2, Analog 3–10, the virtual
returns 11–14, S/PDIF 15–16, the expander's ADAT A 17–24) and 22 outputs
(Analog 1–8, Main 9–10, ADAT A 15–22; Phones 11–12 and S/PDIF 13–14 stay
unlabelled). The optional `device.expect {inputs: 32, outputs: 30}` is what
the device itself reports when its layout is as planned. A device that
reports other totals has moved its layout (mirroring, 96 kHz, TOSLink), so
every channel number after the move is wrong: `stagehand check` fails, and
the router logs an error at every stream open, puts `layout: "moved"` in its
health, and **plays anyway** (refusing to open mid-show would be worse).
The router parses `expect` leniently and never reads `announce.terminals`.

### 12.2 Placeholder sounds

`stagehand/media/sounds.yaml` (tracked) lists the 19 story sounds (every
`sound X` but `announce_chime`, which the router synthesises) with each
one's motif, length, lead silence (`dance_song` opens with exactly 10 s:
the blackout) and what the real file should be. `stagehand sounds
placeholders --config … [--force] [--no-say] [--only a,b] [--out DIR]`
(`audio/placeholders.py`) writes `<sounds_dir>/<name>.wav`: 48 kHz / 16-bit
/ mono, ≈ −6 dBFS peak, a distinct motif then the name in the Mac's `say`
voice, tagged `loom-placeholder v1 — <real>` in a RIFF INFO chunk. It never
overwrites an untagged file and skips a name that already has a real
`.wav` / `.aiff` / `.aif` / `.flac`. `stagehand/media/sounds/` is
git-ignored (the real tracks include copyrighted songs). The router's
`SoundBank.find` prefers a real file over a tagged one (a `.wav` used to win
over a real `.aiff`), and `stagehand check` warns about every placeholder
still there (the pre-show gate); the health JSON lists them.

### 12.3 Stop all house sounds

Run's **■ Stop house sounds** (the header and the *House sound* card), a
host's dock and the director phone post `POST /api/mod/audio/stop
{announce?}`. The router polls with `stops=<seq>` (cursored like the tests:
the first answer primes, a restarted server's seqs never hide a stop, one
older than 10 s by the server's `now` is dropped) and runs `stop_all`:
every sfx voice and speaker test (its spoken label too) fades over 0.3 s.
With *+ announcements* the line being said is cut too (its chime and its
voice alike) and every line queued before the stop is dropped; a line the
story sends after the stop plays at once. The Announcer's output and its
`say -a` fallback return quietly for a cut line, so no voice speaks around
the router. One-shot (the next `sound X` plays), never journaled; the TV voice,
the terminals, the live inputs and the story clock are untouched (stopping
`dance_song` does not move `Night.dance_at`). On the LAN with the uplink
down: `show/audio/stop` (`{}` or `{"announce": true}`) or `stagehand sounds
stop [--announce]`.

### 12.4 By hand over MQTT

`show/audio/play {"name", "to"?}` plays one sound (QLab's old hand GO;
`stagehand sounds play <name> [--to …]`). `stagehand announce` publishes
`{text, chime}` on the router's `show/announce` once the YAML has no
`alexa:` section. All of them exit 2 with the reason when the YAML has no
broker or the broker refuses.

### 12.5 Tablets that also say the announcements

Still an option, off by default (D6). `audio.json` `announce.terminals`
lists the house map's terminal spot ids whose tablets also say each
announcement in their own voice; each tablet's own setting is three-way
(*House setting* — the default — · Always · Never). It lives in
`audio.json`, not `house.json`, so a toggle never bumps the map version.
The map editor's Audio tab lists every terminal spot by room with a
speaker-reach hint (*the house speakers here say them too: the tablet would
echo them* / *no house speaker in this room: the tablet would be the only
voice*); Run → Terminals shows a 📢 badge and a per-spot toggle.

