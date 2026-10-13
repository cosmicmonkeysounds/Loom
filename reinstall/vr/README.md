# Reinstallation VR

The golden-duck game for Quest 3: a Godot 4.7 OpenXR project. A program the
Antivirus dragged into **The Internet** is reinstalled by finding Gerald, the
golden duck, in a virtual copy of the house. The design contract is
[`docs/loom-reinstall.md`](../../docs/loom-reinstall.md) (§5 for this game, §1
for the house map, §2 for the server).

Thumbsticks only, no buttons anywhere:

| | |
|---|---|
| **Left stick** | walk where you look (dead zone 0.15, 1.8 m/s) |
| **Right stick** | snap-turn 45° (flick, let go, flick); smooth turn with `smooth_turn` |
| **Lobby** | stick up / down picks a program, hold **right** for 1 s to start |

## Layout

| Path | What |
|---|---|
| `house/house_geometry.gd` · `house_locate.gd` · `house_route.gd` · `house_frames.gd` · `house_duck.gd` | Literal GDScript ports of `@loom/house` (`buildWalls` / `buildFloors` / `buildRamps`, `locate` / `heightAt`, `route` / `sampleTrail`, space transforms, `pickDuckSpot`). They are diffed against the goldens. |
| `house/house_builder.gd` · `house_look.gd` | The map as a scene: StaticBody3D walls, fences, lintels and rails; checker floors with stair holes; starfield ceilings; ramps; props; terminal screens; room labels. The Web-1.0 look is built from procedural textures. |
| `house/house.json` | The show's map. It is a copy, so do not edit it here; see below. |
| `net/server_link.gd` | The `ServerLink` autoload: config, mod login, station polling, begin / pose / found / end, house fetch, and the spatial stream (`sse_client.gd` + `sse_parser.gd`). The 10 Hz pose pump is latest-only (`pose_pump.gd`). |
| `net/config.gd` | Station configuration and its precedence. |
| `player/` | The XR rig on a CharacterBody3D (`player.tscn`), the locomotion maths (`locomotion.gd`), and the comfort vignette. |
| `game/` | The state machine (`game_flow.gd`, `game.gd`), the lobby and its picker, the duck, the chevron trail, ghosts of other players, and the HUD. |
| `main.tscn` / `main.gd` | Bootstrap: OpenXR when there is a runtime, else the desktop rig. |
| `test/` | The headless checks (`run.sh`). |
| `tools/` | `make_action_map.gd` regenerates `openxr_action_map.tres`; `screenshot.gd` renders a few views. |

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

## Run it on a desktop

Without an OpenXR runtime (a Mac) the game runs on the desktop rig. WASD or
↑↓ walk, Q/E or ←→ turn, and the mouse looks (click to capture it, Esc to
release it). In the lobby the same keys drive the picker: W/S choose, and
holding D or E for 1 s confirms.

```bash
G=/Applications/Godot.app/Contents/MacOS/Godot
$G --path reinstall/vr -- --offline                     # no server: pick "Offline Program"
$G --path reinstall/vr -- --server http://127.0.0.1:7000 --code <mod passcode> --station vr-1 --name "Headset 1"
$G --path reinstall/vr -- --server … --code … --guest g-3f9a1c   # dev: start that program right away
$G --headless --path reinstall/vr --xr-mode off -- --server … --code … --guest g-3f9a1c --autopilot
```

`--offline` plays with no server: the duck is picked locally with the same
FNV-1a pick the server uses.

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
headset against a live event server.

## Station config

A headset is a *trusted device*. Its moderator passcode resolves to the event
and logs in as a moderator. Settings are applied in this order (lowest first):

1. built-in defaults
2. `res://config/station.json`: committed, with placeholders (`CHANGEME` never dials out)
3. `user://station.json`: per headset
4. the command line after `--`: `--server URL --code PASS --station vr-1 --name "Headset 1" [--guest g-xxxxxx] [--offline] [--smooth-turn] [--autopilot]`

```json
{ "server": "http://192.168.1.10:7000", "code": "4821", "station": "vr-1", "name": "Headset 1", "smooth_turn": false }
```

`station` is the id the tablet's **Send to <station>** targets (§2.1). Give
every headset its own `station` and `name`.

## The Quest build

The preset `export_presets.cfg` → **Quest**: Android, Gradle build, OpenXR,
arm64-v8a only, `INTERNET` permission, package `com.mapsandducks.reinstall`,
immersive. The bundled `house/*.json` and `config/*.json` are included.

One-time setup:

1. **JDK 17** (e.g. `brew install --cask temurin@17`) and the **Android SDK**
   (Android Studio, or the command-line tools) with `platform-tools`,
   `build-tools` and a current `platforms;android-3x`. In Godot: *Editor
   Settings → Export → Android*, set `Java SDK Path` (the JDK 17 home) and
   `Android SDK Path`. Godot creates a debug keystore on its own. For a
   release build, set your own keystore in the preset.
2. Open the project in the editor and run *Project → Install Android Build
   Template…*. This creates `android/`, which is git-ignored.
3. The export templates for 4.7.1, Android included, must be installed (they
   already are on this machine).
4. Put the headset in **developer mode** (Meta Horizon app → Devices →
   Developer Mode), connect it by USB, and accept the debugging prompt inside
   the headset. `adb devices` should then list it.

Build and install:

```bash
G=/Applications/Godot.app/Contents/MacOS/Godot
mkdir -p reinstall/vr/build
$G --headless --path reinstall/vr --export-debug Quest build/reinstall-vr.apk
adb install -r reinstall/vr/build/reinstall-vr.apk
adb shell am start -n com.mapsandducks.reinstall/com.godot.game.GodotApp
adb logcat -s godot           # the game's prints and errors
```

The Khronos OpenXR loader built into Godot drives the Quest, so no vendor
plugin is needed. Add `godot_openxr_vendors` only for Meta-specific
extensions (passthrough, …), which this game does not use.

### Configuring a headset

The simplest route is to edit `config/station.json` before the export, which
bakes it into the APK. Do this for a per-headset build, or when all headsets
share one server and passcode and differ only in a field you change before
each export.

Otherwise, push a per-headset `user://station.json`. On Android that file is
the app's private `files/` directory, which a **debug** build can reach with
`run-as`:

```bash
adb push station.json /data/local/tmp/station.json
adb shell run-as com.mapsandducks.reinstall sh -c 'mkdir -p files && cp /data/local/tmp/station.json files/station.json'
```

Restart the app afterwards. The lobby shows the station name and the
connection state ("Connected to …", or what is wrong).

### On the night

- The headset waits in the lobby. Scanning a pass on the tent tablet and
  choosing **Send to Headset 1** starts that program within a second. Without
  a tablet, the player picks themselves from the list.
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
  the HUD says "Gerald moved".
- Finding the duck fires `the simulation completed` and `the golden duck` on
  the server. "REINSTALLATION COMPLETE" means a corrupted program was
  released; "YOU FOUND GERALD" means the program was never captured. After the
  celebration the headset returns to the lobby.

## Tests

```bash
./reinstall/vr/test/run.sh        # [path-to-godot]
```

The runner refreshes the import, compiles every script and loads every
scene, then runs `test/game.gd` headless with `--offline`:

- the §1.2 walls / routes / locate ports against every golden at 1e-3, with
  the first mismatches printed
- the frames round trip and the duck pick
- locomotion maths: dead zone, head-relative walking, snap re-arm,
  rotate-about-head
- config precedence and command-line parsing
- latest-only pose coalescing, and the SSE parser
- the lobby picker's hold-to-confirm
- the server link over a fake transport: the heartbeat, the claim schedule,
  the map refetch / warning when the wrong map is up, and the duck adopted
  from the map answer and from `duck` frames
- the game's state machine with a fake link
- a smoke test that `main.tscn` builds the house
- the autopilot reaching every duck spot of the show from the spawn, once
  kinematically and once with real collision (the body stepped by hand)

`VERBOSE=1` prints the golden match counts. Fixture goldens other than `show`
read their source maps from `house/test/fixtures/` in the monorepo.
