# Reinstallation VR

The golden-duck game for Quest 3: a Godot 4.7 OpenXR project. A program the
Antivirus dragged into **The Internet** is reinstalled by finding Gerald, the
golden duck, in a virtual copy of the house. The design contract is
[`docs/loom-reinstall.md`](../../docs/loom-reinstall.md) (§5 for this game, §1
for the house map, §2 for the server).

Thumbsticks, plus one button for the King (and a laser in the lobby):

| | |
|---|---|
| **Left stick** | walk where you look (dead zone 0.15, 1.8 m/s) |
| **Right stick** | snap-turn 45° (flick, let go, flick); smooth turn with `smooth_turn` |
| **Trigger** (either hand) or **A / X** | hit the King, near and facing him — once per visit |
| **Lobby** | point a controller at your program's tile and pull the **trigger** (either hand: a thin beam shows where), or walk the tiles with the stick and hold **right** for 1 s; then **START** (trigger, or hold right again) or **BACK** |

## Layout

| Path | What |
|---|---|
| `house/house_geometry.gd` · `house_locate.gd` · `house_route.gd` · `house_frames.gd` · `house_duck.gd` | Literal GDScript ports of `@loom/house` (`buildWalls` / `buildFloors` / `buildRamps` / `doorGap`, `locate` / `heightAt`, `route` / `sampleTrail`, space transforms, `pickDuckSpot`). They are diffed against the goldens. |
| `house/house_king.gd` | The King's reach (`kingReach`: `KING_REACH` 1.25 m, `KING_CONE_DEG` 55°), the fallen map the trail routes over (the web game's `trailMap`), and the shared `KingState` off the wire. |
| `house/house_builder.gd` · `house_look.gd` | The map as a scene: StaticBody3D walls, fences, lintels and rails; checker floors with stair holes; starfield ceilings; ramps; props; the King with his shared health bar and a shut leaf in each door he guards; terminal screens (or a terminal's live camera feed); room labels. The Web-1.0 look is built from procedural textures. |
| `house/house.json` | The show's map. It is a copy, so do not edit it here; see below. |
| `net/server_link.gd` | The `ServerLink` autoload: config, mod login, station polling, begin / pose / found / King hit / end, house fetch, the shared King, and the spatial stream (`sse_client.gd` + `sse_parser.gd`). The 10 Hz pose pump is latest-only and flushes the newest pose before a claim (`pose_pump.gd`). |
| `net/cam_feeds.gd` | The terminals' live camera feeds: the list every 2 s, the nearest four on the player's floor within 12 m at ~3 fps, one request per spot, JPEG into a texture updated in place, back-off, stopped with the session. |
| `net/avatar_cache.gd` | The ghosts' profile pictures: two downloads at a time off the event's `/api/avatar/<key>`, 2 MB cap, cached, a failure not retried until the next visit; PNG / JPEG / WebP / SVG (rendered once near 256 px, whatever size it declares) by magic bytes, drawn as a Win98-bevelled tile. |
| `net/config.gd` | Station configuration and its precedence; the in-headset setup's `user://station.json` (`save_user` / `forget_user`). |
| `player/` | The XR rig on a CharacterBody3D (`player.tscn`), the locomotion maths (`locomotion.gd`), the comfort vignette, and the lobby's pointer (`pointer.gd`: a laser from each hand's aim pose, the mouse on a desktop). |
| `game/` | The state machine (`game_flow.gd`, `game.gd`), the lobby (`lobby.gd`: the picture tiles, the confirm card; `lobby_tiles.gd`: its geometry; `picker.gd`: the stick; `setup_panel.gd`: SET UP THIS HEADSET), the duck, the chevron trail, ghosts of other players, and the HUD. |
| `main.tscn` / `main.gd` | Bootstrap: OpenXR when there is a runtime, else the desktop rig. |
| `test/` | The headless checks (`run.sh`). |
| `tools/` | `quest.sh` builds, sideloads and provisions the Quest APK (below); `make_action_map.gd` regenerates `openxr_action_map.tres`; `screenshot.gd` renders a few views. |

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
terminals; the game plays either way.

## Run it on a desktop

Without an OpenXR runtime (a Mac) the game runs on the desktop rig. WASD or
↑↓ walk, Q/E or ←→ turn, Space or F hits the King, M mutes the microphone,
and the mouse looks (click to capture it, Esc to release it). In the lobby
the mouse points instead: click a tile, then START. The keys drive the stick picker there:
W/S a row up / down, A or a quick D a tile left / right, holding D or E
for 1 s picks, Enter picks / starts, Backspace goes back.

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
4. the command line after `--`: `--server URL --code PASS --station vr-1 --name "Headset 1" [--guest g-xxxxxx] [--offline] [--smooth-turn] [--autopilot] [--voice false] [--mic false]`

`voice` (on by default) is the voice link; `mic: false` keeps it but
listens only (the headset hears the terminals and is never heard).

```json
{ "server": "https://app.mapsandducks.com", "code": "4821", "station": "vr-1", "name": "Headset 1", "smooth_turn": false }
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
carrying the mod passcode. The working project and `test/run.sh` never see
either. The preset `export_presets.cfg` → **Quest**: Android, Gradle build,
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
  needed. Scanning a pass on the tent tablet and choosing **Send to
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
  the HUD says "Gerald moved".
- Finding the duck fires `the simulation completed` and `the golden duck` on
  the server. "REINSTALLATION COMPLETE" means the server released a
  corrupted program; "YOU FOUND GERALD" means the program was not captured
  (never, or freed mid-walk); "GERALD CAN'T HELP" means the story kept them
  captured (the banishment) — the duck stays put. After the
  celebration the headset returns to the lobby.
- **The King** stands in the Server Room door with **one health bar for
  every guest** ("THE KING  n / 15"), held by the server: the `hello` frame's
  `king`, `king` frames, and the session's map fetch. Near him the HUD says
  "Pull the trigger to hit the King — once per visit." A press of the
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
  and, for the nearest four listed terminals on the player's floor within
  12 m, fetches each one's newest JPEG about 3 times a second
  (`GET …/api/spatial/cam?spot=<id>`, one request per spot in flight, on
  the feeds' own HTTPRequests). A frame updates that spot's texture in
  place on an unshaded 4:3 panel (0.48 × 0.36 m, a thin bezel) where the
  terminal's screen hangs, facing its yaw / pitch. A 404, a bad frame, no
  good frame for 5 s, leaving the floor / range or the session ending
  puts the terminal's own screen back (a timeout or a 5xx alone keeps the
  last frame); failures back off, a spot's frames up to 5 s, the list up
  to 30 s.
- **The terminals can hear and be heard** (wave 19, `net/voice_link.gd`,
  [§2.4](../../docs/loom-reinstall.md)): while playing, a person talking at
  a wall terminal is heard from that terminal's screen in the virtual
  house (panned from where it hangs; the server sets how loud — full in the
  same room, fading to nothing at 12 m, the nearest four on your floor),
  and the player's voice is heard on the terminals within 8 m of them. The
  mic is open with a level gate (nothing goes up in silence). While a
  terminal's voice plays here, plus 0.3 s, the gate is **raised** to
  −28 dBFS instead of held (D5b, the barge-in): the room's echo off the
  Quest's speakers stays home, but a player who speaks up is heard at once,
  and the terminal then holds its own mic, so the room pauses for them. A
  faint, far terminal (gain under 0.2) raises nothing. It only uploads
  while some terminal can hear it. **B / Y** (either hand; **M** on a Mac) mutes and unmutes the
  mic. The HUD's bottom line says **🎤 LIVE** (· *someone can hear you*
  when a terminal listens), **🎤 MUTED**, or **NO MIC** (**🎤 …** until
  the mic hands over a real sample: a missing or denied input gives only
  zeros, which read NO MIC). The tent's terminal (the tent laptop beside
  the headsets) is never in the link. A Quest asks to allow recording audio
  (Android's microphone prompt) **in the lobby**, before the first session
  (the dialog pauses the app; in a session that would end it); one still up
  at a start ends nobody's session. Until it is allowed the HUD says *NO MIC ·
  allow the microphone* and the game still hears the terminals. To ask
  again after a refusal: Settings → Apps → Reinstallation VR → Permissions
  → Microphone (or reinstall the APK). Offline there is no voice.
- **The microphone from the Godot editor**: `project.godot` turns audio
  input on (`audio/driver/enable_input`), so an F5 run on a Mac asks once
  for the microphone, as *Godot* (the game runs inside Godot.app). If it
  was refused, the HUD still says 🎤 LIVE but nothing goes up (macOS hands
  the game silence); reset the answer with `tccutil reset Microphone
  org.godotengine.godot` and run again. Debug → Customize Run Instances →
  Main Run Args takes the same arguments as the command line (e.g.
  `-- --server http://127.0.0.1:7000 --code <mod> --station vr-1`, or
  `--mic false` to run without the microphone).

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
- the camera feeds: which spots to poll (listed, my floor, in reach,
  nearest four), the back-off, the list parse, JPEG decode + in-place
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
- a smoke test that `main.tscn` builds the house
- `test/quest_sh.sh`: `tools/quest.sh`'s helpers and dry runs, and the Quest preset's must-haves (no Android SDK needed)
- the autopilot reaching every duck spot of the show from the spawn, once
  kinematically and once with real collision (the body stepped by hand)

`VERBOSE=1` prints the golden match counts. Fixture goldens other than `show`
read their source maps from `house/test/fixtures/` in the monorepo.
