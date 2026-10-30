# Reinstallation VR

The golden-duck game for Quest 3: a Godot 4.7 OpenXR project. A program the
Antivirus dragged into **The Internet** is reinstalled by finding Gerald, the
golden duck, in a virtual copy of the house. The design contract is
[`docs/loom-reinstall.md`](../../docs/loom-reinstall.md) (§5 for this game, §1
for the house map, §2 for the server).

Thumbsticks, plus one button for the King (and a laser in the lobby):

| | |
|---|---|
| **Left stick** | walk where you look (dead zone 0.15, 1.4 m/s) |
| **Right stick** | turn smoothly (a small push turns slowly, at most 70°/s; no snap turn since wave 33b — it made people dizzy) |
| **Trigger** (either hand) or **A / X** | hit the King, near and facing him — once per visit |
| **B / Y** (either hand) | mute / unmute the microphone (a short haptic tick when it takes) |
| **Lobby** | point a controller at your program's tile and pull the **trigger** (either hand: a thin beam shows where), or walk the tiles with the stick and hold **right** for 1 s; then **START** (trigger, or hold right again) or **BACK** |
| **The intro** | the same beam and **trigger** (or **A**) on the panel's buttons; the stick walks and turns once the tutorial says so |

With only the **right** controller (the show's headsets), its stick's
forward / back walks and its left / right turns; a slightly crooked push
does only the stronger of the two (`Locomotion.axis_lock`). The edges of
the view darken while moving or turning, and walking into a wall gives a
light buzz.

## The intro (wave 33)

Before every walk the guest stands on a calm practice floor away from the
house (`game/intro_space.gd`, steps in the pure `game/intro_flow.gd`):

1. **The video.** *The Reinstallation Process* plays on a cinema screen
   (3.6 m wide, 3.4 m ahead, eye height) in the dark. It ships inside the
   APK as `media/reinstallation.ogv` (Ogg Theora 720p30 + Vorbis, decoded
   in software by a `VideoStreamPlayer` in a `SubViewport`), so nothing is
   streamed. A missing or undecodable file is skipped, never a hang.
2. **The tutorial**, one thing at a time on a big panel, each step moving
   on when the guest does it (a soft chime and a gentle haptic), with a
   fallback button for the stuck: **look around** (OK after 5 s) →
   **point** the beam at OK and pull the trigger → **walk** into the
   glowing ring (NEXT after 20 s) → **turn** round (the stick, or just the
   body) to face the duck behind you (on 2 s later; NEXT after 20 s) → a
   **comfort** line and **START**.

The video and the tutorial are unskippable until the program has completed
a reinstallation (the assignment's `reinstalled` ≥ 1; then SKIP and SKIP
TUTORIAL). Throughout, the spawn pose
keeps the session alive (the server times one out after 60 s without a
pose) and nothing of the walk runs: no void, find, King, voice link, hum
or quack. At START the guest lands at the spawn, the walk's clocks (the
path reveal, the quack) start, and `POST /api/spatial/ready` restarts the
server's. A session that ends mid-intro (session over, the headset off)
stops the video and goes back to the lobby. `--intro false` (or `"intro":
false` in a station file) skips it; the autopilot never plays it. Its
copy (in `game/intro_flow.gd`) was signed off on 2026-10-28. Unproven on the
Quest: Theora at 720p30 in software, and the video's audio level.

## Layout

| Path | What |
|---|---|
| `house/house_geometry.gd` · `house_locate.gd` · `house_route.gd` · `house_frames.gd` · `house_duck.gd` | Literal GDScript ports of `@loom/house` (`buildWalls` / `buildFloors` / `buildRamps` / `doorGap`, `locate` / `heightAt`, `route` / `sampleTrail`, space transforms, `pickDuckSpot`). They are diffed against the goldens. |
| `house/house_king.gd` | The King's reach (`kingReach`: `KING_REACH` 1.25 m, `KING_CONE_DEG` 55°), the fallen map the trail routes over (the web game's `trailMap`), and the shared `KingState` off the wire. |
| `house/house_builder.gd` · `house_look.gd` | The map as a scene: StaticBody3D walls, fences, lintels and rails; checker floors with stair holes; starfield ceilings; ramps; props; the King with his shared health bar and a shut leaf in each door he guards; Trabolta's heart (shown once he has fallen) and the pickups (the floppy disk); terminal screens (or a terminal's live camera feed); room labels. The Web-1.0 look is built from procedural textures. |
| `house/house_lights.gd` · `house_lamps.gd` | Wave 39: the real house's lights. `house_lights.gd` ports `gameLightsOf` / `pulseFactor` and holds the pure rules (the pool pick, the night ambient, the graphics tiers); `house_lamps.gd` draws a bulb per fixture, pulses the ones a program stands under, lights the nearest with a fixed pool of real lights and dims the ambient (below). |
| `house/house_escape.gd` · `house_moment.gd` | Ports of `@loom/house`'s void (`voidDistance`, `outsideGround`) and the moments (`heartReached`, `pickupReach`) (house lane). |
| `house/house.json` | The show's map. It is a copy, so do not edit it here; see below. |
| `net/server_link.gd` | The `ServerLink` autoload: config, mod login, station polling, begin / pose / found / King hit / end, house fetch, the shared King, and the spatial stream (`sse_client.gd` + `sse_parser.gd`). The 10 Hz pose pump is latest-only and flushes the newest pose before a claim (`pose_pump.gd`). |
| `net/cam_feeds.gd` | The terminals' live camera feeds: the list every 2 s, the terminals in the player's own (presence) room at ~3 fps (never the tent's station), one request per spot, JPEG into a texture updated in place, back-off, stopped with the session. |
| `net/voice_link.gd` · `voice_codec.gd` | The voice link (the terminals heard, the player heard on them), the mic's states, `hold_for` (the game's own sounds keep the mic shut), the lobby's TEST MIC. `voice_codec.gd` is a port (house lane). |
| `net/avatar_cache.gd` | The ghosts' profile pictures: two downloads at a time off the event's `/api/avatar/<key>`, 2 MB cap, cached, a failure not retried until the next visit; PNG / JPEG / WebP / SVG (rendered once near 256 px, whatever size it declares) by magic bytes, drawn as a Win98-bevelled tile. |
| `net/config.gd` | Station configuration and its precedence; the in-headset setup's `user://station.json` (`save_user` / `forget_user`). |
| `player/` | The XR rig on a CharacterBody3D (`player.tscn`), the locomotion maths (`locomotion.gd`), the comfort vignette, and the lobby's pointer (`pointer.gd`: a laser from each hand's aim pose, the mouse on a desktop). |
| `game/` | The state machine (`game_flow.gd`, `game.gd`), the intro (`intro_flow.gd`: its steps, pure; `intro_space.gd`: the cinema, the practice floor and the tutorial panel), the lobby (`lobby.gd`: the picture tiles, the confirm card, the MICROPHONE box; `lobby_tiles.gd`: its geometry; `picker.gd`: the stick; `setup_panel.gd`: SET UP THIS HEADSET), the duck, the chevron trail, ghosts of other players, the HUD (and the void's scare), the game's sounds (`sfx.gd`) and in-game speech (`speech.gd`). |
| `main.tscn` / `main.gd` | Bootstrap: OpenXR when there is a runtime, else the desktop rig. |
| `test/` | The headless checks (`run.sh`). |
| `media/` | `reinstallation.ogv`, the intro's video (shipped in the APK: the preset's `media/*.ogv`). |
| `tools/` | `quest.sh` builds, sideloads and provisions the Quest APK (below); `make_action_map.gd` regenerates `openxr_action_map.tres`; `screenshot.gd` renders a few views (the lobby, the intro's cinema and each tutorial step, the house). |

### The house map

`house/house.json` and `test/golden/` are copies made by `@loom/house`. After
the show's map (`core/examples/trapped-in-the-internet/house.json`) changes:

```bash
pnpm --filter @loom/house goldens && pnpm --filter @loom/house sync
```

At run time the game loads the bundled copy first. It replaces it with the
event's map from `GET /api/spatial/house` as soon as it is connected, and
again whenever the stream announces a `house` change. While a program plays,
the map is fetched with the session token, so the answer also carries that
session's duck; a `duck {session, duck}` stream frame moves it too. If the
map up is not the version the server named (the assignment's `houseVersion`,
or a `house` / `hello` frame), for example because the fetch failed and the
bundled map is still up, the link retries every 2 s and the HUD says the
house may be wrong until the event's map arrives.

## The real house's lights (wave 39)

When the event server sends the spatial stream's `lights` frame (the colour
and level every fixture of the real house shows now, and which ones a
program is standing under), the virtual house shows it:

- a **bulb** at every fixture, in its colour and brightness, with a soft
  glow; a dark fixture is a grey bulb. A fixture someone stands under
  **breathes** (1 → 0.35 → 1 every 2 s), the way the real bulb does;
- the lit fixtures **nearest the player on their floor** light the walls
  and floor for real, from a fixed pool of 2 / 4 / 5 lights (by graphics
  tier; never shadows);
- while the player walks the house, the **ambient dims** toward night
  (never so dark Gerald is hard to find), brighter the brighter the real
  house is, tinted by its colours. The lobby and the intro keep today's
  light.

Without the frame (an older server, no lights module, the link gone) the
house looks as it always did. The real bulb's pulse is the server's and
stagehand's job; the game only shows it.

### Graphics tiers

`graphics` in the station config picks the picture: `low`, `medium` (the
default) or `high`. Every tier tone-maps ACES; none has SSAO, SSR or
volumetric fog.

| | real lights | shading | glow | MSAA |
|---|---|---|---|---|
| `low` | 2 | per vertex | — | — |
| `medium` | 4 | per pixel | — | — |
| `high` | 5 | per pixel | on | 2× |

Set it with `--graphics` (desktop), `"graphics"` in `user://station.json`,
or bake / push it: `tools/quest.sh build --station vr-1 --graphics low`
(or `provision` / `station … --graphics`). If a headset drops frames on
`medium`, try `low`. There is no in-headset control (a guest could reach it).

Wave 47's look (computer horror, squeaky clean): a prop with a `model`
(`house_models.gd`, the port of `@loom/house` `models.ts`, golden-tested)
is drawn from its parts, and every prop is merged into one mesh per role
(glossy white bodies, chrome trim, black gloss, screens, red alarms); neon
skirting and cove strips run along every wall; the neon is unlit, unfogged
and stutters now and then; the fog is a violet exponential haze, thicker
near the floor, with drifting haze sheets per floor (none on `low`, one on
`medium`, two on `high`). The King is a turned chess king, Gerald a smoother
duck on a gold ring, the terminals carry a neon rim.

## Run it from the Godot editor

Open `reinstall/vr/project.godot` in Godot 4.7 and press **F5**. No headset,
no build, no arguments:

1. **The OpenXR noise is harmless.** With no OpenXR runtime on the Mac the
   log shows five `OpenXR-Loader` errors, `OpenXR: Failed to enumerate
   number of extension properties` and *OpenXR was requested but failed to
   start … Godot will start in normal mode.* (`startup_alert=false`, so no
   dialog). The game then runs on the desktop rig.
2. **SET UP THIS HEADSET.** The committed `config/station.json` carries the
   placeholder passcode, so the lobby asks: pick a server (the show's,
   or **This computer · 127.0.0.1:7000** (`http://127.0.0.1:7000`), which an editor or desktop
   run always offers), type the event's **moderator passcode** on the
   on-screen keyboard or the Mac's keys (Tab switches to the name field,
   Enter connects), and click **CONNECT**. A wrong code says *That isn't a
   moderator passcode.*; no server says *Can't reach the server.*; **PLAY
   OFFLINE** plays this run with no server. The Output panel prints each
   lobby view (`reinstall-vr: lobby — SET UP THIS HEADSET`).
3. **It asks once.** A working passcode is saved to `user://station.json`
   — on a Mac `~/Library/Application Support/Godot/app_userdata/Reinstallation
   VR/station.json` — so the next F5 goes straight to PICK YOUR PROGRAM.
   To forget it, hold the lobby's **⚙** for 2 s (or delete that file).
   Never put a dev file under `config/`: the Quest preset ships
   `config/*.json`, passcode included.
4. **Pick and play with the mouse and keys.** In the lobby the mouse is
   never captured: click a tile, then **START**. The keys work too (W/S
   ↑/↓ a row, A/← and a quick D/→ a tile, hold D/E/→ 1 s to pick, Enter to
   pick / start, Backspace to go back). In the house: WASD walk, Q/E turn,
   Space / F hit the King, click to capture the mouse and look, Esc to let
   it go.

**A local server.** *This computer* is `http://127.0.0.1:7000`, the event
server `pnpm dev` runs (`--sync "<project>"` pushes a story into it); the
moderator passcode is on the editor's Run page. A scratch server on another
port works too (`LOOM_PORT=7641 LOOM_MOD_PASS=… pnpm --filter @loom/core
serve`, plus `LOOM_DB_WAIT=off` with no database): name it with
`--server http://127.0.0.1:7641` (below) and the setup panel offers it
first. Only a marked or captured program has a tile (`/api/mod/set
{id, field: "captured", value: true}` makes one).

**Run arguments from the editor.** *Debug → Customize Run Instances…* →
*Main Run Args*, everything after `--` (the command-line flags below):
`-- --offline`, `-- --server http://127.0.0.1:7641`, or a whole station
`-- --server http://127.0.0.1:7000 --code <mod passcode> --station vr-1`
(which skips the setup panel and saves nothing).

**The microphone.** Once the voice link records (`audio/driver/enable_input`
in `project.godot`), macOS asks once whether Godot may use the microphone;
the prompt is attributed to Godot.app. Allow it to be heard on the
terminals; the game plays either way. The lobby's **TEST MIC** (left of the
panel) opens it with no session and shows a level meter.

## Run it on a desktop

Without an OpenXR runtime (a Mac) the game runs on the desktop rig. WASD or
↑↓ walk, Q/E or ←→ turn, Space or F hits the King, M mutes the microphone,
and the mouse looks (click to capture it, Esc to release it). In the lobby
the mouse points instead: click a tile, then START. The keys drive the stick picker there:
W/S a row up / down, A or a quick D a tile left / right, holding D or E
for 1 s picks, Enter picks / starts, Backspace goes back.
In the intro the mouse points at the cinema's SKIP and the panel's buttons
(click); once captured for looking around, it points through the middle of
the view (a gold dot) and a click presses. WASD and Q/E walk and turn when
the tutorial says so; `--intro false` skips it all.

```bash
G=/Applications/Godot.app/Contents/MacOS/Godot
$G --path reinstall/vr -- --offline                     # no server: pick "Offline Program"
$G --path reinstall/vr -- --server http://127.0.0.1:7000 --code <mod passcode> --station vr-1 --name "Headset 1"
$G --path reinstall/vr -- --server … --code … --guest g-3f9a1c   # dev: start that program right away
$G --headless --path reinstall/vr --xr-mode off -- --server … --code … --guest g-3f9a1c --autopilot
```

`--offline` plays with no server: the duck is picked locally with the same
FNV-1a pick the server uses, and the King's bar is kept on the headset (one
hit per session, he falls at 0).

`--autopilot` (dev / CI only, `game/autopilot.gd`) plays by itself: it
walks to the duck through the real sticks and collision, then quits — exit 0
after a find, 1 otherwise or after 180 s. It follows the §1.2 route, the
same path the golden chevrons trace. That route already goes round walls,
reflex corners, stair holes and ramps, and solid props (grown 0.25 m). The
autopilot adds one thing: it crosses every door and stair end square-on,
between approach points 0.5 m either side. Any leg those approach points add
that the route's own visibility test would refuse detours over the route's
corner waypoints in that room. When the body makes no headway for 3 s it
re-plans from where it stands, and it re-plans when the map or the duck
changes. With `--headless --xr-mode off` it is the end-to-end check of a
headset against a live event server. `--hit-king` sends it to the King first: it stops 0.9 m in
front of him, faces him, presses the hit button once and goes on to the duck
whatever the answer — the shared bar's end-to-end check.

## Station config

A headset is a *trusted device*. Its moderator passcode resolves to the event
and logs in as a moderator. Settings are applied in this order (lowest first):

1. built-in defaults
2. `res://config/station.json`: committed, with placeholders (`CHANGEME` never dials out)
3. `user://station.json`: per headset — written by the lobby's **SET UP THIS
   HEADSET** panel (or pushed by `quest.sh provision`)
4. the command line after `--`: `--server URL --code PASS --station vr-1 --name "Headset 1" [--guest g-xxxxxx] [--offline] [--autopilot] [--voice false] [--mic false] [--trail-delay 0] [--intro false] [--graphics low|medium|high]`

`voice` (on by default) is the voice link; `mic: false` keeps it but
listens only (the headset hears the terminals and is never heard).
`trail_delay` (seconds, default 60 = the house's `PATH_REVEAL_MS`) holds
the golden trail back at the start of each walk; `--trail-delay 0` for a
quick dev walk. `intro` (on by default) plays the video and the tutorial
before each walk; `--intro false` for a quick dev walk. `graphics`
(`medium` by default) is the picture's tier (above).

```json
{ "server": "https://app.mapsandducks.com", "code": "4821", "station": "vr-1", "name": "Headset 1", "graphics": "medium" }
```

`station` is the id the tablet's **Send to <station>** targets (§2.1). Give
every headset its own `station` and `name`. A headset set up in the lobby
mints its own station id from its name (`vr-<name>-<4 hex>`), so two
headsets both called *Headset* never share one.

**Setting a headset up in the headset.** An APK with no passcode baked in
(`quest.sh build` or `build --debug` without `--station`: the committed
placeholder) shows **SET UP THIS HEADSET** in the lobby instead of dialling
out — so one APK can serve every headset: point at the server, type
the moderator passcode on the keyboard with the laser, name the headset,
pull the trigger on **CONNECT**. A headset build never offers *This
computer*. The setup is kept until someone holds the lobby's ⚙ for 2 s.

## The Quest build

`tools/quest.sh` does the whole Android side. It exports from a **staging
copy** (`build/stage/`, git-ignored): it rsyncs the project there, adds the
[OpenXR vendors plugin](https://github.com/GodotVR/godot_openxr_vendors)
(pinned `5.1.0-stable`, checksum-checked, a 48 MB binary GDExtension that
never goes into git), and optionally bakes a per-headset `station.json`
carrying the mod passcode. It also stamps the staged copy's
`config/build.json` with the short commit (`+` for uncommitted changes) and
the UTC time, which the lobby shows under the MICROPHONE box ("build
abc1234 · 2026-10-26T12:00Z"; an editor run says "build dev") — check it on
each headset after a sideload. The working project and `test/run.sh` never see
any of them. The preset `export_presets.cfg` → **Quest**: Android, Gradle build,
OpenXR, the **Meta vendor plugin** (`com.oculus.intent.category.VR`,
`supportedDevices = quest3|quest3s`), arm64-v8a only, `INTERNET`,
package `com.mapsandducks.reinstall`, immersive. There is **no cleartext
opt-in**: Android refuses plain `http://`, so a headset talks to the VPS over
HTTPS (`https://app.mapsandducks.com`, the committed `config/station.json`).

### What you run, once (≈ 15 min)

| | |
|---|---|
| Godot 4.7 + export templates | `/Applications/Godot.app`; *Editor → Manage Export Templates → Download and Install* (Android included) |
| JDK 17–21 | `brew install --cask temurin@17`, or nothing if Android Studio is installed (its bundled JBR 21 works; verified with Godot 4.7.1's Gradle 8.11 / AGP 8.6) |
| Android SDK | Android Studio → SDK Manager: `platform-tools`, `build-tools` 35+, `platforms;android-36`, *Command-line Tools (latest)*; accept the licences |
| Meta developer mode | done (Horizon app → Devices → Developer Mode) |

Then:

```bash
reinstall/vr/tools/quest.sh setup
```

It checks all of the above and fixes what it can, asking first: Godot's
*Java SDK Path* / *Android SDK Path* editor settings (it backs the file up
to `*.bak-quest`), the vendors plugin download, a debug keystore
(`~/.android/debug.keystore`), and a **release keystore**
(`~/.config/loom/reinstall-release.keystore`, its password in
`reinstall-release.env` next to it, mode 600). **Back the release keystore
up**: an update over an installed release build must be signed with the same
key, otherwise it's `adb uninstall com.mapsandducks.reinstall` first.

### Build and sideload

One APK per headset, release-signed, with its station baked in (the fast
template; `run-as` can't reach a release build's files, so baking is how a
release headset gets its config):

```bash
Q=reinstall/vr/tools/quest.sh
export LOOM_MOD_CODE=…                     # the event's mod passcode (or --code)
$Q build --station vr-1                     # → build/reinstall-vr-vr-1.apk ("Headset 1", the VPS)
$Q build --station vr-2                     # → build/reinstall-vr-vr-2.apk
# plug in headset 1 by USB-C, accept "Allow USB debugging" inside it
$Q install build/reinstall-vr-vr-1.apk      # adb install -r + launch
$Q logs                                     # adb logcat, the game's lines
```

`--name "…"` and `--server URL` override the defaults (`Headset N`, the
VPS); a non-HTTPS server prints a warning, since the APK can't reach it.
Each export takes about a minute (the first one installs the Android build
template into `build/stage/android/`). `--dry-run` prints every command
without running it.

For quick iteration, a **debug** build (`$Q build --debug`) carries the
committed placeholder and is provisioned over adb afterwards:

```bash
$Q build --debug && $Q install
$Q provision vr-1 --code …                  # pushes user://station.json via run-as, restarts the game
```

`$Q station vr-1 --code …` prints the JSON either route would write. The
lobby shows the station name and the connection state ("Connected to …", or
what is wrong).

The acceptance check (K-30) is `scripts/accept/K-30.sh`: setup, both
exports, sideload one headset at a time, wait for each station to poll the
VPS, then send a captured program to `vr-1` and wait for the `found` frame
with `released: true` while you walk to Gerald.

### On the night

- The headset waits in the lobby: **PICK YOUR PROGRAM**, a tile with the
  profile picture of every program marked for reinstallation (*Nobody is
  marked for reinstallation yet.* when there are none). The player points
  at theirs and pulls the trigger (or walks the tiles with the stick and
  holds right 1 s), then **START** on *Start as <name>?* — no tablet
  needed. Scanning a pass on the tent laptop and choosing **Send to
  Headset 1** still starts that program within a second, whatever the
  lobby shows.
- Taking the headset off ends the session after a 2 s grace (`user_presence`
  OpenXR extension). On runtimes without it, losing focus ends the session
  after 15 s. The grace runs on the wall clock, so a headset that went to
  sleep and is handed on later starts in the lobby, not in the last
  program's game.
- If the event ends (or the server forgets it), the headset notices within a
  second (its station poll gets a 404), drops back to the lobby, and links
  to whatever event the passcode names now. No answer at all for 5 s shows
  "Lost the server — retrying…".
- Room scale: physically stepping or leaning into a virtual wall pushes the
  view back instead of letting the head through it, and walking up a stair
  climbs it.
- The game claims the duck within 0.9 m of it in plan, when the feet are
  within 1.2 m of its height or on its floor. That is the server's own
  `found` rule (`DUCK_MAX_RISE`, `nearDuck`), only tighter in plan (the
  server allows 2 m), so a claim the game makes is never refused for height.
  If a map edit moves the duck mid-game, it moves in the headset too, and
  the HUD says "Gerald moved." ("Gerald moved — follow the arrows." once
  the trail is up).
- **The trail waits a minute** (wave 26, R2): for the first 60 s of each
  walk (played time from the end of the intro; a re-scan starts it again) there is no golden trail
  and the HUD just says "find Gerald". Then "A golden trail flickers on."
  and the chevrons draw at once. Gerald's quack never waits.
- **Sound** (wave 26, R8, `game/sfx.gd`): Gerald quacks from where he
  sits (louder and more often within 7 m, as in the web game), the find
  quacks and plays the fanfare (none for "GERALD CAN'T HELP"), a refused
  find buzzes once per approach (never for closed doors or a dropped
  request, which retry in silence), a King hit thuds, his fall plays the fanfare, and a quiet hum
  runs while playing. Everything is synthesised at boot (no assets) and
  plays on an **Sfx** bus. While any one-shot plays (plus 0.3 s) the mic
  sends nothing, so the Quest never sends the game's own sound to the
  terminals. The hum holds nothing; it pauses whenever a terminal
  listens, so no game sound plays while the mic could send.
- **The void** (wave 26, R4): the mud room's front door leads outside.
  5 m past the walls, every time, one hard glitch flash comes on in front
  of the eyes ("FATAL EXCEPTION 0E", a noise, a haptic pulse; no camera
  motion, nothing flickers), the walk freezes and an escape goes up
  (`POST /api/spatial/moment {kind: escape}`, the newest pose first). On
  the answer (at least 1.5 s of scare; at most 3 s of waiting) the player
  is back at the spawn in the tent and his lines are captioned and spoken.
  The teleport happens whatever the server says (closed doors, an older
  server, a refusal). Within 20 s (wall clock, from the post) of the last,
  walking out again just puts them back.
- **Trabolta's heart** (R6): once the King has fallen, a dark rack with a
  beating red core stands in the virtual Server Room. The first time a
  program walks in, his lines play over it (`moment {kind: heart}`); before
  he is awake there are none, and the next way in tries again.
- **The virus disk** (R7): a spinning floppy disk with a green glow. Walking
  into it (0.9 m) takes it (`moment {kind: pickup}`): the disk goes, a blip
  plays and any line is captioned. A program that already took it (or
  heard the heart) tonight never sees it again on a re-scan (`picked`,
  `heartHeard` on the assignment).
- **Speech** (`game/speech.gd`): lines are captioned one at a time
  (head-locked, or over the heart), each for its reading time with 0.7 s
  between, and spoken by the headset's own voice at full volume when it
  has one
  (`audio/general/text_to_speech` is on; "Antivirus" is said "Anti Virus",
  `config/pronounce.json`). With no device voice the captions carry them.
  Captions never name the speaker.
- Finding the duck fires `the simulation completed` and `the golden duck` on
  the server. "REINSTALLATION COMPLETE" means the server released a
  corrupted program; "YOU FOUND GERALD" means the program was not captured
  (never, or freed mid-walk); "GERALD CAN'T HELP" means the story kept them
  captured (the banishment) — the duck stays put. After the
  celebration the headset returns to the lobby.
- **The King** stands in the Server Room door with **one health bar for
  every guest** ("THE KING  n / 15") hanging over him — never on the HUD —
  held by the server: the `hello` frame's
  `king`, `king` frames, and the session's map fetch. Near him the HUD says
  "Pull the trigger to hit the King." A press of the
  trigger (or A / X) within 1.25 m and facing him (55°) flushes the newest
  pose and posts `POST /api/spatial/king/hit` with the session token; the
  server judges the reach off that pose. "You hit him." — and one hit per
  reinstallation visit (the server's 409 `already hit` counts too). A visit
  ends at the duck: a re-scan before it is the same visit, and the
  assignment's `kingHit` starts it spent ("You hit him this reinstallation.
  Find Gerald before you hit him again."). At 0 he
  kneels for everyone: his collider and the door leaf go, the trail routes
  through the door, and the HUD says "He is down: the cold door is open."
  A director's restore stands him up and shuts the door again — but not on
  a player behind it, in the doorway or on his spot: for them it stays open
  (his collider and the leaf off, the trail through it) until they are
  clear (the web game's `keepDoorOpen`, `HouseKing.keep_door_open`). A
  remap while crossing a fallen King's spot keeps them there. The chess
  itself is at the real door's terminal; nothing here plays it. A server
  with no shared King (an older release) shows no bar and takes no hit.
- **Ghosts wear the guest's profile picture** as a head (the event's
  `/api/avatar/<key>`, the `avatar` key on each player and the `avatar`
  frame); a guest with no picture, or one Godot can't decode (GIF, AVIF),
  stays a plain capsule.
- **The terminals show the real rooms** (wave 14, `net/cam_feeds.gd`):
  while playing, the headset lists the live camera feeds every 2 s
  (`GET /e/<event>/api/spatial/cams`, the token the map is fetched with)
  and, for the listed terminals in the player's own room (wave 26: the
  presence room, with a 0.75 m doorway hold; never the tent's station; the
  nearest four), fetches each one's newest JPEG about 3 times a second
  (`GET …/api/spatial/cam?spot=<id>`, one request per spot in flight, on
  the feeds' own HTTPRequests). A frame updates that spot's texture in
  place on an unshaded 4:3 panel (0.48 × 0.36 m, a thin bezel) where the
  terminal's screen hangs, facing its yaw / pitch. A 404, a bad frame, no
  good frame for 5 s, leaving the room or the session ending
  puts the terminal's own screen back (a timeout or a 5xx alone keeps the
  last frame); failures back off, a spot's frames up to 5 s, the list up
  to 30 s.
- **The terminals can hear and be heard** (wave 19, `net/voice_link.gd`,
  [§2.4](../../docs/loom-reinstall.md)): while playing, a person talking at
  a wall terminal is heard from that terminal's screen in the virtual
  house (panned from where it hangs; wave 26: the server routes only the
  terminals in the player's own room, the nearest four), and the player's
  voice is heard on the terminals in their room. The
  mic is open with a level gate (nothing goes up in silence). While a
  terminal's voice plays here, plus 0.3 s, the gate is **raised** to
  −28 dBFS instead of held (D5b, the barge-in): the room's echo off the
  Quest's speakers stays home, but a player who speaks up is heard at once,
  and the terminal then holds its own mic, so the room pauses for them. A
  faint, far terminal (gain under 0.2) raises nothing. It only uploads
  while some terminal can hear it. **B / Y** (either hand; **M** on a Mac) mutes and unmutes the
  mic — only while it is open (a press while it is asking, refused or
  missing does nothing, so it never comes up muted unseen). The HUD's
  bottom line (wave 26, no emoji) says **MIC ON · B or Y mutes** (*MIC ON ·
  someone can hear you* while a terminal listens), **MIC MUTED · press B
  or Y**, **MIC STARTING…** (until the mic hands over a real sample),
  **MIC · allow it in the headset's prompt** (the Android prompt is up),
  **NO MIC · not allowed · ASK AGAIN in the lobby** (the prompt was
  refused) or **NO MIC** (no device, or only zeros). The tent's terminal
  (the tent laptop beside the headsets) is never in the link. A Quest asks
  to allow recording audio (Android's microphone prompt) **in the lobby**,
  before the first session (the dialog pauses the app; in a session that
  would end it); one still up at a start ends nobody's session. The game
  still hears the terminals without it. Every mic change logs one
  `reinstall-vr: mic — …` line (state, route, rate, grant): `quest.sh logs`
  shows why a headset says what it says. Offline there is no voice.
- **The lobby's MICROPHONE box** (wave 26, left of the panel, every view):
  what the mic is doing ("MIC · allowed", "MIC · not allowed yet · ASK
  AGAIN", "MIC · not allowed · ASK AGAIN, or Settings → Apps →
  Permissions", "MIC · not allowed on this computer" when a desktop's
  privacy settings refuse it, …), **TEST MIC** (opens the mic with no session and shows a
  level meter: "MIC TEST · it hears you"; STOP TEST, or it closes after
  30 s or when a program starts), **ASK AGAIN** while the grant is missing
  or refused (after "don't ask again", only Settings → Apps → Reinstallation
  VR → Permissions → Microphone can allow it, or a reinstall), and the
  build stamp. A spotter can check each headset's mic before handing it on.
- **The microphone from the Godot editor**: `project.godot` turns audio
  input on (`audio/driver/enable_input`), so an F5 run on a Mac asks once
  for the microphone, as *Godot* (the game runs inside Godot.app). If it
  was refused, macOS hands the game silence and the HUD says NO MIC after
  2 s (the lobby's TEST MIC says "only silence — no mic"); reset the answer with `tccutil reset Microphone
  org.godotengine.godot` and run again. Debug → Customize Run Instances →
  Main Run Args takes the same arguments as the command line (e.g.
  `-- --server http://127.0.0.1:7000 --code <mod> --station vr-1`, or
  `--mic false` to run without the microphone).

## Tests

```bash
./reinstall/vr/test/run.sh        # [path-to-godot]; or `pnpm test:vr` from the repo root
```

On 2026-10-28 (wave 39, branch `oct31-w39/vr`, Godot 4.7.1) it reports
1237 checks and `quest.sh` 42, all passing.

The runner refreshes the import, compiles every script and loads every
scene, then runs `test/game.gd` headless with `--offline`:

- the §1.2 walls / routes / locate ports against every golden at 1e-3, with
  the first mismatches printed
- the frames round trip and the duck pick
- locomotion maths: dead zone, the one stick's axis lock, head-relative
  walking, the turn curve, rotate-about-head; the rig's wall-bump buzz
- config precedence and command-line parsing
- latest-only pose coalescing, and the SSE parser
- the lobby picker's hold-to-confirm, and the tile grid's stick (rows,
  left / right, a right flick let go early moves on)
- the lobby's tiles (layout, pages, hit mapping, the ray onto the panel,
  the beam's hand rule), and on `main.tscn` with a fake link: tiles with
  pictures / initials / tags, the laser's hover and press, *Start as
  <name>?* with START / BACK, Enter / Backspace, a card closed when its
  program leaves, the tablet's program landing with a card up, pages, the
  ⚙ hold
- the SET UP panel: the laser and physical keys typing, the server choice,
  CONNECT's answers, PLAY OFFLINE; and the server link's setup over a fake
  transport (every refusal stays unconfigured, a working passcode is saved
  to a user file and links, an older setup's late answer is dropped,
  forget, offline); the committed `config/station.json` still holds
  `CHANGEME`
- the server link over a fake transport: the heartbeat, the claim schedule,
  the map refetch / warning when the wrong map is up, the duck adopted
  from the map answer and from `duck` frames, the shared King from `hello` /
  `king` frames and the map answer, and the hit (pose flushed first, every
  answer, one claim at a time, offline)
- the King's reach, his door's gap and the fallen map; the picture decoder
  (tiny PNG / JPEG / WebP / SVG drawn in the test, a 40000 px SVG rendered
  once near 256 px, GIF / AVIF refused)
- the game's state machine with a fake link, incl. the King (bar, notice,
  hit once per visit, the fall for everyone — the body walks through his
  door — and the restore, held open for a player behind it until they
  walk out) and ghosts' pictures (two at a time, cached, a failure retried
  once on the next visit, `avatar` frames)
- the camera feeds: which spots to poll (listed, my own room, never the
  tent's station, nearest four), the back-off, the list parse, JPEG decode + in-place
  texture updates, the panel's transform from pos / yaw / pitch, and the
  loop over a fake requester (one request per spot, ~3 fps, a 404 → the
  screen back, kept across a rebuild, stop ignores late answers)
- the voice link (`net/voice_codec.gd` against `@loom/house`'s vectors in
  `test/golden/voice-mulaw.json` — the constants, every μ-law byte, the
  resampler, the RMS level, the gate, the jitter plan, `voice_on` and
  `hears_terminals` on the show map), the uplink over a fake
  `HTTPClient`-like (one keep-alive connection, one POST in flight, `seq`
  up, two chunks a batch, at most 1 s queued, reconnects, the idle
  reopen), and the link with fake frames / playbacks / clock (listen on
  and off, the gate, half-duplex, the emitter under `Terminal_<id>` at the
  server's gain, the jitter target and skip, `bye`, a rebuild re-attaching
  it, mute, stop, listen-only), and the game running it while a session
  plays (B / Y / M, the HUD line, stopped in the lobby, off offline or with
  `--voice false`)
- wave 26: the mic's states (denied, B / Y only while open, the log line,
  ASK AGAIN, TEST MIC, `hold_for`), the lobby's MICROPHONE box (by the
  laser too, every view, overlapping nothing) and the build stamp; the
  sounds (lengths, levels, the WAVs, the Sfx bus, the quack's schedule)
  and the game playing them (the mic held, the find's fanfare, none for a
  refused find, the King's); speech (the pronunciation table, captions,
  the device voice, the mic held, a stuck voice cut, a prop's billboard);
  the path reveal and the HUD never carrying the King's health; the
  moment route over a fake transport (one claim per kind, every answer by
  its error string, 410, offline); the void (4.8 m is nothing, 5.2 m the
  scare and one moment, the teleport on the answer or after 3 s, every
  refusal still teleports, the cooldown, a session ending mid-scare); the
  heart and the disk (drawn, no text, no collider, shown with the King's
  fall, each moment's answers, `picked` / `heartHeard`)
- wave 33, the intro: its steps (the skip rule, what advances each step,
  the fallback buttons, the arm delay, the turn step's hold, the ring and
  facing geometry), `ready` over a fake transport
  (the session's token, a 404 ignored, a 410 ends it, nothing offline),
  and the game playing it with a fake video (the spawn pose every frame,
  no void / find / voice / hum / quack, each step by the laser, the panel
  coming round, the walk's clocks and one `ready` after START, a returning
  program's skips, a session over
  mid-video or the headset off mid-tutorial, `intro: false`, the autopilot)
- wave 39, the real lights: `game_lights_of` / `pulse_factor` against
  what the TS answers for the same inputs, the shown level, a fixture's
  floor, the pool pick, the night ambient, the tiers (the environment,
  MSAA, per-vertex on `low`), the `graphics` key (file, flags, a bad tier
  ignored, the committed `medium`), the frame on the link (kept,
  signalled, a bad or unknown frame harmless, forgotten when the link
  drops), the lamps on the show map (a bulb per fixture, the pulse, the
  fixed pool on the player's floor and its hand-over, the ambient easing
  down and back, a rebuild), and `main.tscn` wiring the tier and a frame
- a smoke test that `main.tscn` builds the house
- `test/quest_sh.sh`: `tools/quest.sh`'s helpers and dry runs, and the Quest preset's must-haves (no Android SDK needed; wave 33: the intro video shipped)
- the autopilot reaching every duck spot of the show from the spawn, once
  kinematically and once with real collision (the body stepped by hand)

`VERBOSE=1` prints the golden match counts. Fixture goldens other than `show`
read their source maps from `house/test/fixtures/` in the monorepo.
