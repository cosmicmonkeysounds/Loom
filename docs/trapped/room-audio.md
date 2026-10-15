> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../core/examples/trapped-in-the-internet/OCT31.md)). **The `audio` router module was not built**; QLab stays the room router (OCT31 workaround). The topology is simpler than §1: there is **one house Mac** (the Ollama laptop) — it drives the TV over HDMI, the MOTU (ADAT) speakers and runs Mosquitto / Z2M / stagehand `show` + `agents` + the `alexa` player and Ollama; read "TV computer" and "show laptop" below as that Mac. Built: the TV view (`view=tv`, K-18) speaking Trabolta's lines in The Desktop through `/api/mod/tts` (song beats captioned only, a director mute), the fake Alexa (K-20: chime + voice on MOTU ch 1–4 = living + kitchen, a disk cache + `prewarm:`, `say` as last resort), and Kokoro as a CPU-capped compose service on the VPS (K-19, `KOKORO_CPUS`). Not built: `LOOM_TTS_CACHE_DIR` (the proxy cache is still in memory), `pnpm tts:warm`, the `/media/` route + manifest, the LAN control page.

# Audio + TV architecture (Trapped in the Internet)

*2026-10-15. Scope: the living-room TV and the computer that drives it, its
16-channel interface feeding per-room speakers, the wall terminals' own
audio/speech/video (old Android tablets), and how all of it is driven from
the VPS-hosted event server. Binding inputs: Decisions #13/#14 (TV = the main
Trabolta display; 16 outs cover living room, kitchen and other rooms;
terminals still play their own media), #15 (old Android tablets), #16 (VPS),
#20 (fake Alexa through terminals and house audio), #21 (WebMD = pre-recorded
video), #23/#31 (tent really outside, shed fallback), #26 (awards ceremony).
Built on `screens.md` (§3.4 TTS, §5.5 media, §6 templates) and
`stagehand-hw.md` (§6.3 audio, §6.4 Alexa). Not re-derived here.*

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
**QLab is not chosen.** The existing OSC rules stay in `trapped.house.yaml`
as the zero-code fallback until the module lands, and only if the TV
computer is a Mac. **Browser multichannel Web Audio is rejected** as the
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
AnalyserNode (`terminal/src/speech/engine.ts:107-121`). Keep the QLab OSC
rules as the fallback until SW-AUD-01 passes rehearsal.

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
- The QLab OSC `sfx` rules (`trapped.house.yaml:287-343`) stay until
  SW-AUD-01 passes, then are deleted. SW-SH-02's test then asserts that every
  `sound <name>` in the `.loom` files has an `audio.cues` entry **and** a
  manifest file (extends the existing check 1).

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
  Replaces the QLab OSC rules (keep them until rehearsal passes).
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
share its `startAt`. The QLab OSC rules cover the gap if the TV computer is a
Mac.

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
