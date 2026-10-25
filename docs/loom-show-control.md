# Loom — show control for the house

> **Status (2026-10-24):** the "house Mac" below is now two machines: John's Desktop (Windows: Mosquitto, Zigbee2MQTT, stagehand `show` + `lights`, the TV) and John's MacBook (stagehand `agents` and, by default, the `audio` router). QLab and the `alexa` player are retired; the router plays sounds and announcements. Current runbooks: `stagehand/`, `scripts/house-desktop/README.md`, `scripts/house-macbook/`.

*2026-07-05. Status: design; build-order step 1 landed — the
`loom-stagehand` cue router exists at `stagehand/`
(Python/uv: SSE→cue-map→OSC/MQTT, MQTT→sensor-map→mod API, `show.yaml`
config, 70 unit tests, smoke-tested end-to-end against the event
server: mod `signal` → SSE → OSC datagram with `t_exec` stamp).
Companion to the `escape-the-internet` immersive show. The rig that
*Trapped in the Internet* actually runs (Zigbee2MQTT + WLED + the stagehand
speaker router, no projectors) is in [Trapped in the Internet: the house
rig](#trapped-in-the-internet-the-house-rig).*

## The premise

The show fills a real house: 8 projectors (4 per floor, driven by two machines
running TouchDesigner), speakers everywhere, RPi5/ESP32 props (a crawl-space TV
with a proximity sensor, relay-driven lights, sensor tripwires), and old cell
phones taped around the house streaming a live "CCTV" feed back into the
projections — a video feedback system. Guests carry their phones in the `play`
web app, which is not just a chatroom: puzzles are played in it, and its layout
and "vibe" mutate on the fly. A VR "portal station" (Quest + Unity) lets a
guest explore a scanned virtual replica of the house — the **Upside Down** —
and their presence in the virtual house bleeds through into the real one via
projections and props.

Everything must synchronize with the story: sensors and cameras and headsets
feed the narrative; the narrative fires cues back out to screens, speakers,
and props.

## Principles

1. **The story brain is authoritative.** The `@loom/core` event server already
   is an event-sourced show controller: journaled mutations in, ordered
   `SimEvent`s out, crash recovery by replay. No second brain. Hardware never
   talks to hardware; a sensor's job is to become a journaled story input, and
   a cue's job is to be the story's journaled output.
2. **The `.loom` script is the cue sheet.** Authors write cues inline with the
   narrative as directives (`<cue: …>`, `<prop: …>`, `<vibe: …>`). Rehearsal
   in Sim mode and the live event replay identically because the cues live in
   the same journal as the dialogue.
3. **Everything inbound is a sensor; everything outbound is a cue.** A PIR on
   an ESP32, a computer-vision tamper detector, and a VR headset's zone entry
   are the same thing to the story: a `signal` / `arrive` mutation. The cue
   router doesn't know which inputs are hardware, software, or virtual.
4. **Presence is presence.** Physical guests are located by scan points and
   cameras; the VR guest is located by headset pose. Both produce `arrive`
   events against the same `LOCATION` model, so `on enters Crawlspace` fires
   whether the body is real or virtual, and the unified conversation model
   moves both kinds of guest through the same `loc:` rooms.
5. **Reflexes bypass the brain; decisions go through it.** Continuous,
   low-latency data (person positions for reactive visuals, VR pose for the
   projection ghost) flows straight to TouchDesigner over OSC. Discrete,
   story-relevant events (zone entries, tamper, puzzle solves) flow through
   MQTT → stagehand → the journaled mod API. Texture vs. plot.
6. **The show runs on a LAN island.** Zero internet dependency (fitting, for a
   show about being trapped in the internet): local NTP, local DNS/mDNS, all
   services on the house network.

## Topology

```
                         ┌──────────────────────────────────────────┐
  old phones (8×) ──────►│ MediaMTX  (RTSP/SRT ingest, fan-out)     │
  (RTSP @ 480p/15fps)    └───┬───────────────┬──────────────┬───────┘
                             │ RTSP          │ RTSP         │ RTSP
                   ┌─────────▼──────┐ ┌──────▼─────────┐ ┌──▼──────────────┐
                   │ TouchDesigner  │ │ TouchDesigner  │ │ stagehand       │
                   │ desktop (4 out)│ │ laptop (4 out) │ │ vision workers  │
                   └─────────▲──────┘ └──────▲─────────┘ └──┬──────────────┘
                             │ OSC (cues,    │ OSC          │ MQTT (vision/…)
                             │  t_exec)      │              │
                        ┌────┴───────────────┴──────────────▼───┐
                        │           stagehand cue router        │
                        │  SSE (mod feed)  ◄──────────────────► │
                        │  POST /e/:id/api/mod/{signal,arrive…} │
                        │  MQTT pub/sub ◄──► Mosquitto          │
                        └───▲──────────▲──────────▲─────────────┘
                            │          │          │
                       ESP32 props  RPi5 props  Unity Upside Down
                       (sensors,    (crawlspace (Quest headset:
                        relays,      TV: mpv)    events via MQTT,
                        LEDs, audio)             pose via OSC → TD)
                            
  guests' phones ──► play app ──► @loom/core event server (SSE/REST)
  author laptop  ──► editor Run mode (mod SSE + /api/mod/*)
```

Colocated on one "brain-stem" box (a mini PC, or the desktop if TouchDesigner
there is GPU-bound rather than CPU-bound): the `@loom/core` event server,
Mosquitto, MediaMTX, stagehand, chrony (NTP). A TD machine can then be
rebooted mid-show without killing the story, the broker, or the ingest.

> **2026-09-16 — stagehand is modular.** The router is now the `show`
> module. A second module, `agents`, runs on the host's laptop and voices
> `mind: external` characters with a local language model (Trabolta in
> *Trapped in the Internet*). The server sends it explicit requests over
> `GET /api/agent/stream`, and it answers with `POST /api/agent/reply`.
> Each machine runs the same `stagehand` with its own YAML. The model can
> move the story's variables, but it never bypasses the story's `when`
> rules. See [`stagehand/README.md`](../stagehand/README.md). The show's
> QR codes / Arduino puzzles / reinstallation games contract is in
> [`core/examples/trapped-in-the-internet/README.md`](../core/examples/trapped-in-the-internet/README.md).
>
> **2026-09-17 — the agent has a mind and hands.** The agents module is
> two-tier: a fast model speaks, a slower *orchestrator* (the Qwen 3.8
> distill, on Ollama's native API with thinking off) grows a persisted
> **mind** between turns and mirrors it to the server (`POST
> /api/agent/mind` → `ModView.minds`). The character can read the whole
> session (`GET /api/agent/facts`) and use story-declared **powers**
> (`INTERACTION … who: agent`, `limit: N`) — each power is a `signal`
> fired *as* the character, so a bargain like "cut the lights in the
> kitchen" is an ordinary `cue` this router already maps to MQTT/OSC
> (`show.example.yaml`: `lights`, `screens`). The model decides *when*
> a favour is earned; the story decides *what it does*.
>
> **2026-09-18 — the mind has a debugger and a control panel.** Every
> model call the worker makes (voice, lookup, reflect, survey, re-run) is
> a recorded *thought* — messages as sent, both models' reasoning, raw
> output, tokens, timing, the parsed result, and the mind diff — streamed
> to the server (`POST /api/agent/trace` → `agentThought` frames on the
> mod stream, paged by `GET /api/mod/agent/trace`) and kept beside the
> mind as `<Character>.trace.jsonl`. The mind itself gained structure the
> mind file declares (`stages:` / `drives:` / `phases:` frontmatter):
> an explicit arc stage with a history of moves, 0–100 drives with a
> per-revision history, a bargain policy, open questions, director
> whispers, and a numbered revision log. The editor's **Run → Mind** page
> draws it all, and its control panel drives the worker through
> `POST /api/mod/agent/control` — `reset` (the same frame the server
> sends on a story restart), `survey`, `nudge`, `set`, `forget`,
> `thinking`, `effort`, `pause`, `rerun`. See `stagehand/README.md`.
>
> **2026-10-19 — wave 12: the story keeps the mind.** Measured on a real
> rehearsal, the orchestrator made about 23 model calls per guest line
> (most of them surveys of an empty house) and its brief rewrites were
> mostly overwritten unread, while the voice repeated its catchphrase. The
> worker now has a second mode, `mind_mode: new` (absent = `classic`, the
> two-model mind above): **one voice call per guest line**, the
> orchestrator never started, and plain code applying the mind file's
> **phase card** for `Night.phase` (stage, favours, drives, live powers,
> what he may tell, the brief) the moment the phase changes. The voice
> writes a short memo on the person it answers in the same call, code
> guards every line before it goes out (secrets, hunt answers, invented
> facts, repeats, the catchphrase), and a quiet conversation gets one
> summary call. The server tags the story's own lines in his threads
> (`story: true`) and adds a short `recent` list per request
> (`core/server/agent-recent.ts`; `LOOM_AGENT_RECENT=off` turns it off),
> and the hello carries `traceAfter` so a reconnect replays only what the
> server lacks. A new `rewrite` control (**Rewrite brief** on Run → Mind)
> replaces the survey there. Classic stays as the kill switch, with a
> survey guard that skips an asleep, paused, ended or unchanged house.
> The replay harness (`python -m stagehand.replay`) measures both minds
> on scratch servers. See `stagehand/README.md` → *The story mind*.

## The seams that already exist

The whole design hangs off engine surfaces that shipped with the SaaS +
conversation-model work — no speculative engine changes:

- **Directive passthrough.** Any directive verb the sim doesn't handle
  natively is recorded as `{ type: "directive", verb, args }` with `{expr}`
  interpolation applied (`core/src/runtime/sim/sim.ts`, default arm of the
  directive switch). Authored `<cue: …>` / `<prop: …>` / `<vibe: …>` lines
  already flow out of the engine as ordered events.
- **The mod SSE feed.** `EventRuntime.fanout` streams every raw `SimEvent` to
  mod-role SSE clients (`core/server/event-runtime.ts`). Stagehand connects as
  a mod and sees `directive`, `beatEntered`, `signal`, `arrived`, `captured`,
  `worldSet`, … in order.
- **The mod API.** `signal`, `beat`, `scan`, `set`, `say` already exist under
  `/e/:eventId/api/mod/*`, authorized by mod token or author session. Sensors
  become `signal`s; identified location changes become `arrive`s.
- **Hooks + named events.** `on <event>` hooks and the model-enumerated
  `namedEvents(model)` list mean the script reacts to anything stagehand
  injects, and the Sim-mode cockpit can already fire every named event by
  hand — the rehearsal surface for the physical show is the existing editor.
- **Locations are rooms.** Each `LOCATION` derives a `loc:` channel; `arrive`
  moves a guest's conversation surface. Camera- or headset-derived movement
  therefore has visible, journaled consequences in chat with no new machinery.
- **The channel-type registry** (`core/src/runtime/sim/channel-types.ts`) is
  the seam for puzzle rooms (below).

## `loom-stagehand`

A Python package at `stagehand/` (Python because the vision and
tracking work lives there; it is not part of the pnpm workspace). Two kinds of
process under one supervisor entry point (`stagehand run --config show.yaml`):

- **The cue router** (asyncio): one SSE connection to the event's mod feed
  (`httpx`), one MQTT session (`paho-mqtt`), OSC send to the TD machines
  (`python-osc`). Translates in both directions through the **cue map** and
  the **sensor map** (below). Stateless — restart at any time; retained MQTT
  and the journal carry all recoverable state, and on every (re)connect (of
  the feed or the broker) or story restart the router replays the story's light mirrors from
  `GET /api/state` (the `catch_up:` list).
- **Vision workers**: one subprocess per camera (frame analysis is CPU-bound),
  each pulling its RTSP feed from MediaMTX via OpenCV, publishing to
  `vision/…` topics and streaming reflex data over OSC. Workers are also
  stateless; identity bindings (below) live in the router and are re-pushed as
  retained messages.

### MQTT topic scheme

| Topic | Direction | Payload | Retained |
|---|---|---|---|
| `sensors/<node>/<sensor>` | prop → router | JSON reading (`{"near": true, "mm": 410}`) | no |
| `vision/<cam>/tamper` | vision → router | `{"kind": "covered"\|"defocus"\|"frozen", "held_s": 4.2}` | no |
| `vision/<cam>/zone` | vision → router | `{"zone": "Hallway", "event": "entered"\|"left", "track": 3, "guest": "g_ab12"\|null}` | no |
| `upsidedown/event` | Unity → router | `{"kind": "zone", "zone": "Crawlspace", "event": "entered"}` / `{"kind": "interact", "object": "alphabet_wall", "arg": "R"}` | no |
| `props/<prop>/<command>` | router → prop | command JSON (`{"channel": 13}`) | **yes** |
| `show/scene` | router → all | current global scene name | **yes** |
| `show/vibe` | router → all | current vibe (`{"name": "crt_glitch", "level": 0.7}`) | **yes** |
| `health/<node>` | node LWT | `"online"` / `"lost"` (broker-set will) | **yes** |

Retained `props/…` + `show/…` topics mean a rebooted prop or TD machine
immediately reconverges on current show state — the MQTT mirror of the
journal's replay guarantee.

### The cue map (story → world)

A YAML file mapping directive/event patterns to outputs. Directives carry
`verb` + free-form `args`; the router parses args with the same `key: value`
convention the engine's directive language uses.

```yaml
cues:
  - on: { directive: cue }            # <cue: projectors, scene: static_takeover>
    match: { target: projectors }
    osc:  { addr: "/cue/scene", args: ["{scene}"], t_exec: +200ms }
  - on: { directive: prop }           # <prop: crawlspace_tv, channel: 13>
    mqtt: { topic: "props/{target}/set", payload_from_args: true }
  - on: { directive: vibe }           # <vibe: crt_glitch, level: 0.7>
    mqtt: { topic: "show/vibe", retain: true }
  - on: { event: beatEntered, beat: lockdown }   # events, not just directives
    osc:  { addr: "/cue/scene", args: ["lockdown"], t_exec: +200ms }
```

`t_exec` is an absolute execution timestamp stamped `now + offset` — both TD
machines (NTP-synced) apply the cue at the same wall-clock instant, so 8
projectors flip scenes within a frame or two of each other with no frame-lock
machinery.

### The sensor map (world → story)

```yaml
sensors:
  - on: { topic: "sensors/crawlspace/proximity", when: "near == true" }
    signal: { name: tv_approached, debounce_s: 10 }
  - on: { topic: "vision/+/tamper" }
    signal: { name: camera_tampered, subject: "{cam}" }
  - on: { topic: "vision/+/zone", when: "guest != null && event == 'entered'" }
    arrive: { person: "{guest}", location: "{zone}" }     # identified → arrive
  - on: { topic: "vision/+/zone", when: "guest == null && event == 'entered'" }
    signal: { name: movement, subject: "{zone}" }         # anonymous → signal
  - on: { topic: "upsidedown/event", when: "kind == 'zone' && event == 'entered'" }
    arrive: { person: "{vr_guest}", location: "{zone}" }  # the VR guest is a guest
```

Anonymous evidence becomes a `signal`; identified evidence becomes an
`arrive`. The story decides what either means.

## The vision layer

Crude on purpose — theatrical, not surveillance-grade.

**Tamper detection** (all cameras, ~5 fps analysis, classical CV, no ML):
mean-luminance collapse (tape → dark/uniform), Laplacian-variance drop
(smeared lens → defocus), frame-difference flatline, sudden histogram shift.
Each heuristic must **hold 3–5 s** before publishing, or a guest leaning in
becomes a false SECURITY BREACH. Crucially, *blocked* ≠ *gone*: MediaMTX's API
(`/v3/paths/list`) reports stream drops — a dead phone battery is an ops alert
routed to the Run-mode tech channel, not a story beat. Only
stream-alive-but-image-wrong feeds the narrative.

**Person detection + zones** (story-relevant cameras only, 2–4 fps): YOLO nano
(person class, 416 px) via onnxruntime — CPU is fine at these rates; keep
inference off the TD machines' GPUs. Each camera's config names polygon zones
**using the model's `LOCATION` names** (`Hallway`, `Crawlspace_Mouth`), so a
zone entry maps 1:1 onto the story's spatial vocabulary.

**Identity, anchored at scan points.** Cross-camera re-identification by
appearance descriptor (torso color histogram) misfires constantly in a dark
house washed by projector light. Two mitigations, both by design:

1. When a guest scans a QR/NFC point (an identified `arrive`), the nearest
   camera captures their descriptor *at that moment* and binds it to their
   guest id. Identified events calibrate the anonymous tracker; between scans
   the tracker coasts.
2. **Errors are diegetic.** The surveillance system is an unreliable narrator:
   when the tracker misidentifies, TheAdmin confidently addresses the wrong
   guest by name. Accuracy requirement: theatrically plausible, not correct.

**Dual outputs.** Zone events → MQTT → story (journaled). Continuous
normalized blob positions → OSC directly to TD
(`/vision/<cam>/blob x y conf`) so projections react to bodies — static
blooming where someone stands, the feedback ghost following them down the
hall — with no round-trip through the brain.

## Video pipeline

- **Phones**: IP Webcam (Android, RTSP) or Larix (SRT), **capped at 480p /
  15 fps / ~1 Mbps** — 8+ streams over WiFi is the single biggest failure
  risk, and low-res haunted-CCTV is the aesthetic anyway. Phones plugged in
  (heat + battery over a 2-hour show), screens dimmed, on the **prop SSID**,
  auto-reconnect on.
- **MediaMTX** on the brain-stem box: one YAML, ingests everything, fans out
  RTSP to both TD machines and the vision workers. Its API doubles as the
  stream-health source.
- **TouchDesigner**: one `.toe`, parameterized by a per-machine JSON (which
  camera paths to pull, which 4 outputs to map). Both machines listen on the
  same OSC cue space and apply cues at `t_exec`. Note: TD non-commercial caps
  output at 1280×1280 — four real projector outputs per machine means the
  commercial license.

## Props

- **RPi5 pattern** (crawl-space TV): local video files, `mpv
  --input-ipc-server` with every "channel" preloaded as a playlist entry —
  channel change is one IPC command, zero load hiccup. A small Python daemon
  subscribes to `props/<name>/#` and publishes its sensors. CRT output goes
  through an HDMI→composite box (the Pi 5 dropped the analog jack). The
  proximity sensor does **not** change the channel directly — it publishes,
  the story decides, the cue comes back down. (The script might also have
  TheAdmin react in chat at the same instant; the prop stays dumb.)
- **ESP32 pattern**: ESPHome for sensor/relay/LED props (zero firmware,
  MQTT-native); bare Arduino + PubSubClient only for custom behavior. LWT on
  every node → `health/<node>` → Run-mode tech rail.
- **Audio**: ESP32 + MAX98357 for local one-shot scares; **Snapcast** clients
  on the RPis for house-wide *sample-synchronized* ambience (one drone
  breathing through every room in phase). Big musical cues stay on the TD
  machines' outputs.

## The Upside Down (Unity + Meta XR)

A VR guest explores a scanned virtual replica of the house while physical
guests roam the real one; the VR guest's presence bleeds through — a figure in
the projections, flickering props, chat presence — Stranger Things inverted.

### Scan pipeline

Two scans with two jobs:

- **The environment mesh** (what the VR player sees): LiDAR/photogrammetry
  scan of the whole house (Polycam / Scaniverse / RealityScan) → cleaned,
  textured mesh → Unity. Art-direct it into the Upside Down: desaturation,
  fog, spores, vines, emissive rot — a post-processing volume over the
  faithful geometry. Quest 3's Space Setup / MRUK scans are per-room and
  coarse (planes + boxes + a lumpy global mesh) — fine for physics and
  passthrough anchoring, wrong for a beauty environment.
- **MRUK scene data** matters only for the v2 roaming-passthrough mode
  (below); v1 doesn't need it.

### Coordinate contract: `house-map.json`

> **Superseded (2026-10-10):** the shipped house map is `house.json` (Y up,
> `+z` south, one frame for both reinstallation games, the server and the
> terminals) — see [`loom-reinstall.md`](./loom-reinstall.md) §1.

One canonical spatial file, consumed by *every* spatial subsystem:

```jsonc
{
  "origin": "front-door NE corner, floor level, +x east, +y north, +z up",
  "locations": [
    { "name": "Hallway",    "floor": 1, "volume": [[x,y,z],[x,y,z]] },
    { "name": "Crawlspace", "floor": 1, "volume": [...] }
  ],
  "cameras":    [ { "id": "cam_kitchen", "zones": [{ "location": "Kitchen", "poly": [[u,v],...] }] } ],
  "projectors": [ { "id": "proj_hall_e", "machine": "desktop", "covers": ["Hallway"] } ],
  "props":      [ { "id": "crawlspace_tv", "location": "Crawlspace", "pos": [x,y,z] } ]
}
```

- Vision workers get their zone polygons (camera space) tagged with location
  names from it.
- TD patches get projector→location coverage from it (which output shows the
  ghost when the VR player is in the Hallway).
- Unity places the scanned mesh in house space and instantiates location
  volumes + prop positions from it.
- Stagehand validates that every location name matches the compiled model's
  `LOCATION`s at boot — one vocabulary, checked.

### Unity app (Quest 3, Meta XR SDK)

- **Outbound, discrete** (→ MQTT, `MQTTnet`/M2Mqtt): zone enter/leave
  (computed locally against the house-map volumes — no server geometry),
  object interactions (`{"kind":"interact","object":"alphabet_wall","arg":"R"}`),
  headset donned/doffed. These become `arrive`s and `signal`s: **the VR player
  is a real guest in the story** — they join with a guest code like anyone
  else, their `arrive`s move them through `loc:` rooms, `on enters Crawlspace`
  fires identically for a virtual entry, and TheAdmin can DM them in-headset
  (a diegetic terminal in the virtual house renders their `play` feed —
  they're *inside* the chatroom's world, of course the chatroom reaches them).
- **Outbound, continuous** (→ OSC, extOSC/OscJack, 15–20 Hz):
  `/upsidedown/pose x y z yaw` in house coordinates, straight to both TD
  machines. TD composites the presence — a translucent silhouette, a
  distortion field, a light bloom — into the projector(s) whose `covers`
  include the player's current location. Because the projections are feedback
  loops of live camera feeds, compositing the figure *into the camera feed of
  the room they virtually occupy* is literal bleed-through.
- **Prop manifestation** needs no Unity-side special casing: proximity to a
  prop in the virtual house is just another zone/interact event; the script
  routes it (`on vr_near_tv` → `<prop: crawlspace_tv, flicker: true>`). The
  Stranger Things alphabet wall is an ESP32 + WS2812 strip: the VR player
  touches letters in the virtual house, `interact` events flow through, the
  real wall lights up letter by letter for the physical guests.

### Phasing the VR layer

- **v1 — the portal station.** One headset, stationary/room-scale in a
  dedicated "terminal room", diegetically framed as jacking deeper into the
  internet. No passthrough, no multi-room guardian problem, a minder nearby.
  This ships the entire bleed-through loop.
- **v2 — roaming passthrough MR** (stretch): a guest walks the *real* house in
  passthrough with Upside Down geometry overlaid — needs MRUK multi-room
  anchoring, careful alignment, and real safety thought (dark house, stairs,
  occluded vision). Deferred until v1 proves the loop.
- **v2.5 — bidirectional haunting** (stretch): pipe 1–2 MediaMTX camera feeds
  *into* Unity as textures on in-world screens, so the VR player watches the
  real house's ghostly CCTV from inside the Upside Down while the real guests
  watch them.
- **Multi-headset**: v1 is single-headset by design. If a second is added,
  relay poses between headsets via MQTT (fine at 15 Hz for ghostly avatars) —
  no Netcode/Photon dependency for a long time.

## The web app as a haunted prop

Two engine-adjacent additions:

- **Vibes.** `<vibe: name, level: n>` directives ride the sim feed; a small
  `fanout` addition pushes a `vibe` SSE event to **guests** (today raw sim
  events reach only mods). The `play` client keeps a vibe reducer: CSS-variable
  theme swaps, a glitch shader layer, channel renames, message reordering,
  fake "SYSTEM is typing…", cursor drift, a room that briefly shows your own
  history from the wrong channel. Journaled directive ⇒ Sim-mode rehearsal
  shows the same haunting.
- **Puzzles.** A `puzzle` channel type in the channel-type registry: messages
  carry structured payloads that `play` renders as interactive components
  (keypad, cipher wheel, drag-tiles) instead of text. Answers go through a
  journaled mutation; a correct answer fires a named event; the script reacts.
  Full loop: *guest cracks the router password → `signal router_unlocked` →
  beat fires → 8 projectors flip + the crawl-space TV wakes + a hidden channel
  appears in every sidebar.*

## Trapped in the Internet: the house rig

*Updated 2026-10-24.* The rest of this document describes the
TouchDesigner-era design for `escape-the-internet`. The show that actually
runs, *Trapped in the Internet* (`core/examples/trapped-in-the-internet`),
uses a smaller, off-the-shelf rig: no projectors, no TouchDesigner, no
vision layer. The story server is the VPS (`app.mapsandducks.com`); the
house only dials out.

**The machines.**

| Machine | Runs |
|---|---|
| **John's Desktop** (Windows, the house's static IP `192.168.8.10`) | Mosquitto; Zigbee2MQTT on the CC2652P stick; stagehand `show` and `lights` as Task Scheduler tasks (`stagehand/trapped.desktop.yaml`); the living-room TV over HDMI (Chrome kiosk, `/terminal/?…&spot=desktop-tv`, `view=tv`). Runbook: [`scripts/house-desktop/README.md`](../scripts/house-desktop/README.md) |
| **John's MacBook** (macOS) | Ollama + stagehand `agents` (Trabolta, `laptop.yaml`); by default the stagehand `audio` router + the MOTU 828x + ADAT expander (`stagehand/trapped.macbook.yaml`), as launchd jobs. Runbook: [`scripts/house-macbook/audio.md`](../scripts/house-macbook/audio.md) |
| **Steph's laptop** | the server-room terminal in Chrome, with the Grand Central M4 on USB (the door sensor and the patch bay) |
| **John's old laptop** | the tent terminal (`spot=tent`, the reinstallation wizard + web game) |

The router may move to the Desktop once the 828x works there (the Desktop
README's §7); only one machine runs it. Both machine files `extends:`
[`stagehand/trapped.house.yaml`](../stagehand/trapped.house.yaml), where
every rule lives once.

**The broker.** Mosquitto on the Desktop has two listeners: anonymous on
`127.0.0.1:1883` for what runs on the Desktop (stagehand `show` and
`lights`, Zigbee2MQTT) and password-only on the LAN at `:1884` (user
`props`) for the MacBook's router and the WLED controllers
(`scripts/house-desktop/setup-mosquitto.ps1`).

**Lights.** Zigbee bulbs and plugs are grouped one group per room plus a
whole-house group:
`house`, `living` (The Desktop), `kitchen` (The Start Bar), `backyard`
(The Cloud), `registry` (The RAM, the basement studio), `tube` (the halls and
both stairs), `mudroom` (The Optical Drive), `bathroom` (Disk Cleanup, both
bathrooms), `tent` (The Internet) and `server_room` (only the RGB bulb,
which is `lights.json`'s, below); the ids predate the real house's room
names and stay as wired. **The stairs, the bathrooms, the tent, the server
room and the server-room → living-room path are not in `house`**, so no
whole-house scene or blackout can darken them (their bulbs have
`power_on_behavior: on`). The addressable LED strips run on off-the-shelf
WLED controllers (`wled/all` plus one topic per strip, identical preset IDs
everywhere).

**Sound.** The stagehand `audio` router plays every story `sound X` and
the house announcements through the 828x, from the event's `audio.json`
(QLab and the `alexa` player are retired since wave 18b). `do announce`
reaches it as `show/announce` from the Desktop's `show` job (and `sound
announce_chime` as `show/chime`): a chime and the line in the router
machine's own voice (macOS `say`, or Windows SAPI). So announcements need
the Desktop's broker and `show` job up. The same announcement rides the
event server's screen state (`/api/screen/state` → `announce`), so a
terminal provisioned with `&announce=1` (the tent) says it in its own voice
too (N-09, decision #20). Design and history:
[`docs/trapped/room-audio.md`](./trapped/room-audio.md).

**The server room** has no stagehand device. An LDR + LED on the door frame
(the door is shut while the LED shines on the LDR) and the 15-jack patch
bay both feed the **Grand Central M4** on a USB cable to Steph's laptop,
and that terminal page (Web Serial) posts the edges to the story itself:
`door_sensor_opened` / `door_sensor_closed`, and `patch_changed {combo}`
during the Y2K hour (wave 22; firmware in
[`hardware/server-room-m4/`](../hardware/server-room-m4)). The ESP32 box
([`hardware/server-room/`](../hardware/server-room)) is **not installed**;
its YAML rules stay for a bench. The door has a **standalone keypad lock**
(code set by hand on the lock, never networked; the inside handle always
opens): nothing in stagehand or on the M4 drives it.

**The house desk (wave 25).** A third project file, `desk.json` (Run →
House; schema `core/src/house-desk.ts`, contract
[`loom-house-desk.md`](./loom-house-desk.md)), is the house's own cue
list: sounds and announcements through the router, looks and light states
through the `lights` job, stops, story events and waits for a room's
lines. The story plays one with `cue <id>`; GO by hand fires the same
events. The show's copy is a DRAFT of tech checks only.

**The house lights' new home (wave 20).** A project file beside
`audio.json`, `lights.json` (the map editor's 💡 Lights tab; schema in
`@loom/house` `house/src/lights.ts`), places the lights the story drives on
the map and defines **looks** keyed by cue name; stagehand's `lights` job
(on the Desktop; `scripts/house-macbook/lights.md`) plays them on Zigbee2MQTT / WLED with timed
steps, never under a safety fixture's floor, and catches up from the story's
screen state after any reconnect. This wave's file holds one fixture, the
server room's RGB bulb `server_room_rgb` (Trabolta's `heart_*` looks); every
other light is still the `show` rules below. Zigbee2MQTT on the Desktop:
the Desktop README's §3; its CC2652P coordinator and the pairing:
`scripts/house-macbook/zigbee.md` (steps 5–9 on any machine).

**Story → house.** The story only emits directives (the full registry
is in the design spec §2.13):

| In the `.loom` | Stagehand sends |
|---|---|
| `cue lights_<look>` (screensaver, tube_chase, call_desktop, game, truth_time, ad_hijack, glitch, pong, trust_chart, y2k, server_open, alarm, blackout, dance, final_reveal, song, rave, purgatory, banish, restore) | Z2M `scene_recall <id>` to the room or `house` group + WLED preset `ps <id>`. Each look has the same ID everywhere: `scene_store` it once per group and build identical WLED presets on every controller. Flicker is a bulb `effect` or a WLED preset, never streamed over Zigbee. |
| `<cue: lights, room: The Start Bar, state: off>` (Trabolta's `cut_the_lights`; allow-listed to The Start Bar, The Desktop, The RAM) | that room's Z2M group `state` + its WLED strip on/off (the kitchen only dims to ~20%). The story turns the room back on 90 s later itself, unless a look that re-lights it (a whole-house look; a living-room look over a Desktop cut; the alarm latch's end) has run since, and records the look it restored under in `Night.lit_scene`. Catch-up replays the room off only mid-cut under a look that kept it dark, and on only under `Night.lit_scene` or a later room-scoped look (pong, glitch, server_open, or a living-room look over any room but The Desktop), never under a whole-house look. |
| `cue heart_<look>` (wake, nag, door_open, sealed, listen, argue, proof, warn, eject, notyet, shutdown, idle, alarm: wave 20) | nothing from `show`: the `lights` job plays `lights.json`'s look on the server room's RGB bulb (Z2M `server_room_rgb/set`, timed steps ≥ 150 ms apart, ≥ 400 ms for a colour, loops ≥ 2 s; never under its 80 / 254 floor, 40 being only the generic minimum). `show` drops any YAML rule whose cue `lights.json` defines (`take_looks`) |
| `cue lights_blackout` | `house` OFF; WLED off **per device** (living, kitchen, backyard, registry), the Tube strip on dim static preset 22, the server room untouched |
| `cue screens_flicker` | a one-shot `effect: blink` on the bulbs (it reverts by itself), so the power is felt in the house. Since wave 9 the LED strips are left alone: the old WLED preset 21 left them on its look after a flicker |
| `sound <name>` (directive `sfx`) | nothing from `show`: the `audio` router reads the feed and plays `media/sounds/<name>.wav` on the speakers `audio.json` names |
| `do announce "…"` | `show/announce {"text": "…"}` → the `audio` router (chime + the machine's own voice, one line at a time); `sound announce_chime` → `show/chime`. Also the screen state's `announce` → terminals with `announce` on (N-09) |
| `do door server_room, state: locked\|unlocked` | `show/serverroom/lock {"state": …}` (retained) for the ESP32's indicator ring only (the ESP32 is not installed, so nobody hears it), never the real (standalone keypad) lock; the story sends `locked` at Power On and nothing sends `unlocked` since wave 7. `lights_alarm` (only a second wrong patch-bay combo) also sends `show/serverroom/alarm` for the ESP32's siren (not installed; the router plays the story's `alarm_siren`), the house scene 12 and WLED preset 12 **per device** — never `wled/all`, since the tube strip (halls + stairs) is a safety light and gets a steady red instead of the strobe (wave 20, D11; every other effect preset — 7, 10, 14, 15, 17 — goes per device too, the tube held on ps 22; the server room has no strip, w20b Q6); the room's RGB bulb plays the story's `heart_alarm` (`lights.json`). The story ends the alarm look itself: when its 120 s latch clears it cues back the look the alarm replaced (`lights_y2k`, + `lights_server_open`, `lights_final_reveal` or `lights_restore`) unless a later cue changed it, and since `lights_server_open` also silences the siren, a majority or The Heart inside the latch holds its server-room look until then |

The `screens_*` / `tv_*` / `terminals_*` / `tablet_*` cues have no
stagehand rule: the screens read them from the server. Every wall terminal
and the TV (`/terminal/?view=tv`, Chrome on John's Desktop) polls
`GET /e/:id/api/screen/state` (`core/server/routes/screen.ts`) — the last
cue per family, the story's `Night.screen` / `Night.terminals` mirrors,
the running countdown, attract mode while the terminal's character is
hidden or asleep, and for the TV the characters' lines to speak — instead
of the mod feed.

**House → story** (MQTT → `POST /api/mod/signal`):

| Sensor | Signal |
|---|---|
| *(not stagehand, wave 20)* The LDR + LED on the server-room door, read by the Grand Central M4 at his heart's terminal (Web Serial) | the terminal posts `door_sensor_opened` / `door_sensor_closed` (`{level}`) itself; the story ignores them while a director's 🚪 override is on. The ESP32's `sensors/serverroom/door` and the Zigbee `server_room_door` are no longer read: a stagehand rule posting `server_door_opened` would itself be a 🚪 override |
| *(not stagehand, wave 22)* The patch bay's 15 jacks, read by the same M4 | the terminal posts `patch_changed {combo}` itself, only in the Y2K hour; the story judges it against its seeds, and while a 🔌 💥 ❌ press holds the bay it only tells `# hosts` (`Night.patch_override`, until *🔌 Trust the patch bay again*) |
| Zigbee button over the printer's START key | `printer_button_pressed` |
| Reed switch on the printer lid | `printer_opened` (the first opening before 🤖 plays the beans + the glitch look; one opened late — the overshare or the Y2K hour — plays only *Full Of Beans*, the spill sound and −20 composure, and leaves the step, the lights, the screens and the terminals alone) |
| The ESP32 patch-bay scanner (`sensors/patchbay/state {"combo", "complete"}`; **not installed**, a bench fallback) | `patch_combo_a` / `patch_combo_b` / `patch_rejected`, judged in the YAML (stagehand's signal rules carry no arguments) |

**Rules of thumb.** `retain: false` on every `/set` and WLED `/api`
command, so a retained `OFF` does not survive into the next night. Quote
`"on"` in WLED payloads (a bare `on:` key is YAML `true`). Stagehand never
validates signal names, so a typo is silent:
`stagehand/tests/test_trapped_house.py` checks that every `cue lights_*`,
`screens_flicker` and `sound` in the story has a rule, that every sensor
signal has a `when` in `main.loom`, and that the two patch-bay combos
equal the `Kernel.combo_*` seeds and the four combo-half codex entries.
Sensor rules ignore retained messages and take `edge: true` (see the
stagehand README); signal arguments and a `delay:` on cues are still
stagehand work.

## Worked example: the reinforcements sequence

Guest tapes over the kitchen camera →

1. Tamper heuristic holds 4 s → `vision/cam_kitchen/tamper {"kind":"covered"}`.
2. Sensor map → `POST /api/mod/signal camera_tampered` (subject `cam_kitchen`).
3. `.loom`: `on camera_tampered` → TheAdmin posts "⚠ VISUAL LOSS — NODE
   kitchen — DISPATCHING UNIT" to the lobby; `<broadcast:>` cues the
   performer's booth; `<cue: projectors, camera_down: kitchen>` rides the feed
   back out.
4. Cue map → OSC → both TD machines flip that camera's slot in the projection
   grid to bars/static — the guests *watch the system lose its eye*.
5. A performer arrives in the kitchen. Every step is in the journal; the whole
   sequence replays in Sim mode with a hand-fired `camera_tampered`.

## Network + ops

- Wired backbone: brain-stem box, both TD machines, MediaMTX path. Dedicated
  AP with **separate SSIDs**: guests vs. props/cameras. Static DHCP leases for
  every node. Local chrony NTP (nothing can reach a time server on the
  island). All streams + MQTT on the wired/prop side; guest WiFi carries only
  the `play` app's SSE + REST.
- **Run mode is the stage-manager console.** Existing: fire beats/signals,
  act-as-anyone, moderate. To add: a tech rail fed by `health/#` LWT +
  MediaMTX path status (prop/camera up-down), manual cue + vibe firing.
- Boot order is a non-event: retained MQTT re-converges props; journal replay
  re-converges the story; stagehand and TD are stateless consumers. The only
  ordered dependency is broker-before-everything, handled by systemd on the
  brain-stem box.
- Consent line for the ticket/waiver: guests are on camera and tracked —
  conveniently, "the house is watching you" is the premise, so consent and
  fiction are the same sentence.

## Build order

1. **Stagehand cue router + Mosquitto + a blinking LED.** The moment
   `<cue:>` in a `.loom` file blinks an ESP32, every later layer is iteration.
2. **MediaMTX + 2 phones + a 1-projector TD patch** — validate the feedback
   loop, the WiFi budget, and `t_exec` scene flips early.
3. **Crawl-space TV daemon** (the template for every RPi prop) + the
   proximity→signal→story→cue round trip.
4. **Tamper heuristic** on all cameras (no ML) → the reinforcements sequence
   end-to-end.
5. **Vibe SSE event + `play` reducer**; **puzzle channel type**.
6. **YOLO zones** on story-relevant cameras; anonymous `movement` signals.
7. **Scan-point identity fusion** (descriptor binding at QR scans →
   identified `arrive`s from cameras).
8. **Upside Down v1**: house scan → Unity portal station → pose ghost on
   projections + zone `arrive`s + one interactive prop (alphabet wall).
9. Stretch: roaming MR, bidirectional camera feeds into VR, second headset.

## Open questions

- Does the `puzzle` answer path ride `say` (journaled today) or a dedicated
  journaled mutation with server-side validation? Leaning dedicated — answers
  shouldn't be spoofable by typing into the wrong channel.
- Cue-map expressiveness: flat pattern list (above) vs. letting `.loom`
  directives address OSC/MQTT namespaces directly (`<osc: /cue/scene …>`).
  Leaning flat list — the script should speak *show* vocabulary, the map
  owns *transport* vocabulary.
- Where does the VR guest's code get provisioned — pre-created performer-style
  account, or scan-to-join at the portal station like any guest? Leaning
  scan-to-join for uniformity.
- Vision descriptor persistence across a mid-show stagehand restart: retained
  MQTT blob vs. recalibrate-at-next-scan. Leaning recalibrate — bindings decay
  fast anyway.
