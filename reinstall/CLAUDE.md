# reinstall — agent guide

The reinstallation games for *Trapped in the Internet*: a marked or
captured program walks a virtual copy of the house to Gerald, the golden
duck, and is released. Two games share one simulation, plus the house map
editor. MIT.

| Folder | What | Stack |
|---|---|---|
| `web/` (`loom-reinstall`) | the web game, the wizard flow and the map editor (at `/reinstall/map`, and in Loom Edit as Run → House → 🗺 Map) | Vite + React 18 + three.js, in the pnpm workspace; served by the event server at `/reinstall/` |
| `vr/` | the Quest 3 game | Godot 4.7 OpenXR (GDScript only). **Not** in the pnpm workspace or the Docker image |

Human overviews: [`README.md`](./README.md), [`web/README.md`](./web/README.md),
[`vr/README.md`](./vr/README.md). The contract is
[`../docs/loom-reinstall.md`](../docs/loom-reinstall.md) (normative; §3 the
web game, §5 VR, §2 the server, §1 the map). The shared map code is
[`../house`](../house/CLAUDE.md); the King's chess is [`../chess`](../chess/CLAUDE.md)
and is played only at a wall terminal, never in these games.

## Commands

```bash
pnpm --filter loom-reinstall dev          # :5176, proxies /api + /e to LOOM_SERVER (default :7000)
pnpm --filter loom-reinstall build        # dist/ (base /reinstall/)
pnpm --filter loom-reinstall test         # vitest: 788 tests, 60 files
pnpm --filter loom-reinstall typecheck
pnpm dev --reinstall                      # repo root: the dev stack + this Vite on :5176
pnpm test:vr                              # = reinstall/vr/test/run.sh [godot]: 1236 checks + 300 descent + quest.sh 42
pnpm house:sync                           # after any show-map or house geometry change
reinstall/vr/tools/quest.sh setup|build --station vr-N|install   # the Quest APKs
```

`reinstall/vr/test/run.sh` takes the Godot binary as its argument
(`/Applications/Godot.app/Contents/MacOS/Godot` on a Mac). An end-to-end
run against a live server: `godot --headless --path reinstall/vr --xr-mode
off -- --server … --code <mod> --guest g-… --autopilot` (exits 0 after a
find; `--hit-king` hits the King first; the autopilot ignores the path
reveal, and `--trail-delay 0` turns it off for a hand-driven dev run).

## Where the code is

| Path | What |
|---|---|
| `web/src/app.tsx`, `flow.tsx`, `flow-state.ts`, `program.ts`, `wizard.tsx`, `IntroVideo.tsx` | the standalone device's screens; the choose / video / play / send flow (mounted by the tent terminal too); what the wizard says about a program; the intro video (wave 33) |
| `web/src/config.ts`, `api.ts`, `spatial.ts`, `kiosk.ts` | provisioning (`?code= name= role= camera= arrows= voice= intro= quality=`), the spatial routes and stream, the 2 s holds |
| `web/src/game/` | `engine.ts` (three.js), `Play.tsx` + `joystick.tsx`, and pure `physics.ts` (with the outside ground), `input.ts`, `pump.ts` (10 Hz latest-only poses), `hud.ts` (with the path reveal and `kingInView`), `fight.ts` (the King), `trail.ts`, `leash.ts`; wave 26: `moments.ts` (the void, the heart, the disk: when to post and what each answer means), `lines.ts` (`LinePlayer`: in-game captions + the device voice), `Scare.tsx` (the jump scare); wave 33 `tutorial.ts` (the training's steps, the skip rule); wave 39 `quality.ts` (the tiers, `auto`'s frame-time rule, the cap and the remembered setting; pure), `house-lights.ts` (the lights frame's bulbs: levels, the pulse, the point lights' pick, the ambient's dim; pure), `lamps.ts` (their three.js half) and `post.ts` (bloom + the grade, a lazy chunk); `cams.ts`, `voice.ts`, `audio.ts` |
| `web/src/map/` | the editor: `MapEditor.tsx` (the editor, needing neither `Setup` nor the game), `MapApp.tsx` (the page: `Setup`, `?code=`), `embed.tsx` + `embed-css.ts` (wave 49: the embed for Loom Edit, a shadow root), `Canvas.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx`, `Preview3D.tsx`, `ProjectBar.tsx`, and pure `plan.ts`, `edit.ts`, `doors.ts`, `yards.ts`, `structure.ts`, `props.ts`, `history.ts`, `check.ts`, `project.ts`; speakers `audio*.ts` + `AudioPanel.tsx` (wave 38: an input's *Ducks as* role and its reach, `setInputRole` / `setInputReach` / `inputReachSpeakers`; renaming or removing a speaker or zone rewrites every input's reach too); lights `lights*.ts` + `LightsPanel.tsx` (wave 39: the Presence block, `setLightPresence`) |
| `vr/house/*.gd` | literal GDScript ports of `@loom/house` (walls, locate + presence, route, frames, duck, the King, and wave 26's `house_escape.gd` + `house_moment.gd`), diffed against `test/golden/`; `house_builder.gd` also draws the heart and the disk; wave 39 `house_lights.gd` (`gameLightsOf` / `pulseFactor` ported, the pool pick, the night ambient, the graphics tiers) and `house_lamps.gd` (the real house's bulbs, the fixed `OmniLight3D` pool, the ambient) |
| `vr/net/` | `server_link.gd` (the autoload: config, polling, begin / pose / found / hit / moment, wave 33 `mark_ready`, the stream), `cam_feeds.gd` (the presence room's feeds), `voice_link.gd` (with `hold_for`, TEST MIC, ASK AGAIN) + `voice_codec.gd`, `avatar_cache.gd`, `config.gd` (with `trail_delay`, wave 33 `intro`, wave 39 `graphics` and the build stamp); the stream's `lights` frame → `LinkBase.lights_changed` / `lights` (wave 39) |
| `vr/game/`, `vr/player/` | the state machine (`game.gd`: the path reveal, the void, the heart, the disk, the intro), wave 33's intro (`intro_flow.gd`: the video → tutorial steps and the skip rule, pure; `intro_space.gd`: the cinema, the practice floor, the tutorial panel), the lobby (PICK YOUR PROGRAM tiles, SET UP THIS HEADSET, the MICROPHONE box with the build stamp), the duck, trail, ghosts (wave 51: `ghosts.gd` + `swarm.gd` + `swarm.gdshader`), HUD; wave 26 `sfx.gd` (synthesised sounds on the `Sfx` bus) and `speech.gd` (captions + `tts_speak`); the XR rig and pointer |
| `vr/media/reinstallation.ogv` | the intro's video (Theora 720p30), shipped in the APK |
| `vr/house/house.json`, `vr/test/golden/` | **copies** written by `pnpm house:sync`; never edit them here |

The server half is `core/server/spatial.ts` (`SpatialHub`, with the
presence rooms and `moment`), `spatial-cams.ts`, `spatial-voice.ts` and the
`/api/spatial/*` + `/api/mod/spatial/*` routes.

## Rules that span both games

- **Only the outcome is journaled.** Poses are memory only. A find commits
  `the simulation completed` + `the golden duck`; a King hit sets
  `Night.king_hp − 1` and fires `king hit` (`king fallen` at 0). A server
  restart ends every walk (sessions live in memory).
- **The server judges.** The found rule (`nearDuck`: ≤ 2 m plan, within
  `DUCK_MAX_RISE` or the same floor) and the King's reach (`kingReach` plus
  the server's slack) are the server's; both games pre-check tighter so a
  claim is never refused for height.
- **One hit per program per visit**; a visit ends at the duck, not at
  Leave or a timeout (`kingHit` on the assignment).
- **Only marked or captured programs play**; a `force: true` begin is for
  directors only, and the tent terminal never sends it.
- **Maps change live.** A save or a tent ⇄ shed switch carries sessions
  over: a moved duck is re-dealt (`duck` frame), a player who is no longer
  `standable` goes back to the spawn (`bodyAfterRemap` on the web,
  `respawn_after_remap` in VR). A session plays only on the map version it
  was dealt.
- **Terminals link by room** (wave 26, R5). Voice, camera feeds and the
  world view follow the player's presence room (`presenceRoom`, a 0.75 m
  doorway hysteresis): a game hears, sees and is heard by only the
  terminals of the room it is in. The server filters anyway, so the games'
  picks (`pickFeeds`, `spots_to_poll`) only save requests.
- **The tent has no voice link.** The tent spot is `voice: false`, the
  `view: "reinstall"` station is never linked, and the web game's voice
  link is off by default; the terminals hold their mic while playing
  sound, the games raise their gate (D5b) and hold it shut while they play
  a sound or line of their own (`holdFor` / `hold_for`).
- **The moments** (wave 26, C6). The void, Trabolta's heart and the virus
  disk each post `POST /api/spatial/moment`, after flushing a pose; answers
  are read by their `error` string, and any 404 but `no such prop` is an
  old server. An escape always teleports back to the spawn, whatever the
  answer. The lines in an answer are game-only: caption and speak them,
  never name the speaker. Neither game hints at the void, the heart or
  the disk, and the play help never describes them.
- **The path reveal** (R2). Both games hide the trail, the compass pip, the
  distance and warmer / colder for the first `PATH_REVEAL_MS` of each
  session — counted from the end of the intro (wave 33); the quack is
  never delayed.
- **The intro** (wave 33). The Reinstallation Process video, then a
  controls tutorial, before every walk; both are skippable only when the
  assignment's (or candidate's) `reinstalled` ≥ 1. The web game plays the
  video before the begin (`reinstall/web/public/intro/reinstallation.mp4`)
  and the training in the house (`game/tutorial.ts`); VR ships its own
  Theora copy in the APK (`vr/media/reinstallation.ogv`) and teaches the
  one right controller. VR turns smoothly only (wave 33b: the snap turn
  and its saved setting are gone; the server's `POST /api/spatial/prefs`
  stays, unused).
  Both post `POST /api/spatial/ready` when the intro ends (the run clock
  restarts). Off with `?intro=0` (web) / `intro: false` (VR); the VR
  autopilot never plays it. Re-encode both videos from the source if it
  changes (the ffmpeg lines are in `docs/loom-reinstall.md` §3).

- **The descent** (wave 49, `docs/loom-w49-contract.md`). A walk's level is
  `descentOf(assignment)`, 0 on a first walk: level 0 is the game as it always
  was, at no extra cost. Both games run the same seeded plan and wake the same
  props (`@loom/house` `descent.ts`, the VR port `house_descent.gd`, diffed
  against the golden); what a vision looks like is each game's own. A vision or
  a talk never blocks a find, a hit or a moment, talking never stops walking,
  and one vision runs at a time. In the Hallway (the `door` vision) the pose
  pump keeps sending the pose at the door it entered, and everything judged is
  off. A `from` prop is drawn only by the games, at its level, and is never
  solid. The words are `descent.json`, served live; the props know nothing
  useful, and the play help never describes any of it.

## Conventions and gotchas

- **Old devices.** `web/` builds for `chrome87` / `safari14`: use
  `@loom/house` `cloneData`, no regex lookbehind; `scripts/accept/K-14.sh`
  checks the bundle. The game itself needs WebGL2 (it refuses Play here
  without it); the terminals' raycaster is not a fallback for the game.
- **Aliases.** `web/` imports the terminal's scanner (`@loom/terminal/…`)
  and the play app's `api` (`@loom/play/…`) as source. The terminal, in
  turn, imports this app's `flow.tsx` as `@loom/reinstall`. A change to the
  flow's props or CSS affects the tent laptop; run the terminal's
  `reinstall-*` tests too.
- **Pure first.** Physics, input, the pump, the HUD, the trail and every
  map edit are pure and node-tested; keep new logic that way.
- **The map runs embedded** (wave 49, C7). Loom Edit mounts `MapEditor` in a
  shadow root in its own React 19 page, so map code answers to that too. At
  the window `e.target` is the shadow host: read a key's target through
  `keyOrigin` (`unlock.ts`), and a new key the map answers to goes in
  `mapAnswersKey`, or it also fires the host's shortcut. Never bring `app.tsx`,
  `flow.tsx` or the three.js game into `MapEditor`'s static imports
  (`test/map-embed.test.ts` walks them): the 3D preview stays a lazy import,
  and CSS goes through `embed.tsx` (`?inline`), not a stylesheet import in
  `MapEditor.tsx`. `editor/tsconfig.app.json` typechecks these sources, and is
  stricter than ours (no parameter properties, no unused imports or
  parameters). `@font-face` doesn't apply in a shadow root: the embed puts
  VT323 on the document. A link out of the page (`Toolbar`'s ✕) is hidden when
  `embedded`. `MapEditor`'s `connections` prop: long polls on its own page,
  short polls embedded, none while the host keeps it off screen.
- **The house lights and quality** (wave 39). The web game's point-light
  pool is sized by the quality tier and changes only with it (a light-count
  change recompiles every material); the post-processing stays a lazy
  import (`post.ts`) so `low` and first load never pay for it. The
  terminals' world view never gets the lights or the post: only the games.
  The pulse is a surprise: the guests' play help never describes it.
- **GDScript ports stay literal.** A change to `@loom/house`'s geometry,
  routing or the King's reach needs the same change in `vr/house/*.gd`,
  regenerated goldens and a green `pnpm test:vr`.
- **Terminals at 3×** (wave 33b). Both games draw every terminal (the
  screen and the camera window, the mirror into the real house) three
  times its size across the wall (`GAME_TERMINAL_SCALE`, VR
  `HouseBuilder.TERMINAL_SCALE`); the terminals' world view and the map
  editor keep 1×. The terminals send 320 × 240 frames to fill them.
- **Clippy's dream** (wave 50, `docs/loom-w50-contract.md` C4). From the Y2K
  bug the terminals stay on their real room cameras, and the server breaks
  the video through them down the same routes in irregular spurts (3–6 s,
  about every 30 s, each terminal on its own clock; never the tent's), a
  terminal with no camera included. Neither game has any code for it, so an
  older APK shows it; it is 3 fps, like the feeds.
- **Comfort in VR** (wave 33b). Smooth turning only, gentle near the
  stick's centre; a 1.4 m/s walk with no acceleration; the one stick's
  axis lock; the vignette; a light buzz on a wall. Keep new movement to
  that standard: most players have never worn a headset.
- **Graphics tiers** (wave 39). VR's `graphics` (`low | medium | high`,
  default `medium`) sets the house lights' pool (2 / 4 / 5), the shading
  (per vertex on `low`), and glow + 2× MSAA (`high` only; MSAA on
  `medium` drew a black void on the Quest 3); ACES on all. The rig moves every rendered frame (turn, walk,
  gravity, room scale), each headset frame by exactly one display interval
  (`VrPlayer.frame_step`): physics ticks drift against the display and
  snap the view. After a teleport the body waits two physics ticks (new
  floors). The physics tick is matched to the display's rate (72 Hz on the
  Quest 3: it ignores the 90 Hz request so far). `Game._catch_fall` puts a
  body fallen out of the lobby or the intro back.
  Quest 3 must hold its frame rate on `medium`: keep SSAO / SSR / SSIL /
  volumetric fog off, ≤ 8 omni lights on a mesh (5 pool + the duck, heart and disk), and the pool fixed.
- **The ghosts are a swarm** (wave 51). A program's profile picture cut into
  shards (`@loom/house/three` `swarm.ts`, VR `game/swarm.gdshader`, the
  raycaster's `terminal/src/raycast/swarm.ts`): they hold to the capsule the
  body would fill (never drawn; ghosts collide with nothing) and tear into a
  face that always stares at the camera, which also forms whenever one comes
  within ~4 m. No visor, no ring, no tile: where a ghost looks only leans
  its face. Keep it one draw per ghost, opaque and cut with `discard`, all
  motion in the vertex shader (Quest 3, old tablets), and any storm under the
  glitch's 3 Hz.
- **Station config.** VR reads `user://station.json` (written by the
  in-headset setup) over the committed `config/station.json` (which must
  keep `CHANGEME`; a test checks it). Never write `res://`.
- **No text in the VR house** (wave 46). VR draws no room names, terminal
  captions, prop captions, signs or player name tags, and its HUD has no
  room line, hint or mic line; only the found screen, notices, captions of
  game lines and the King's own bar remain. A guest cannot mute the mic.
- **Seen from outside** (wave 46). Outdoors, both games hide every floor
  above the outside one (`hiddenFloors` / `HouseEscape.hidden_floors`),
  with Gerald and the ghosts on it; they show again on that floor or at
  the foot of a stair up. `stairWells` closes the band between a ceiling
  and the floor above round each stair's hole; VR draws floors on the bare
  grid (`cells(…, false)`: no T-junction cracks).
- **Fiction.** The wizard and the HUD never promise the real server-room
  door; the King's stakes line belongs to the chess terminal. The HUD has
  no King bar (wave 26, R3): the bar over his head is his only display.
  The heart carries no label, rows or colours that could hint at the
  patch bay.
- **Copy.** Wave 26's strings are listed in
  `core/examples/trapped-in-the-internet/SIGNOFF-w26.md`, signed off on
  2026-10-27 (their comments keep a `w26 (<note>)` tag). New copy awaiting
  sign-off is marked `DRAFT w<N>` in source.
- **Quest audio is unproven on hardware.** Whether Horizon OS has a TTS
  voice and whether the Quest mic gives real samples is checked on the
  device (HW-TENT-07): the lobby's TEST MIC, `tools/quest.sh logs`, and a
  game line spoken aloud, not only captioned.
  Re-export and sideload after the server ships, then check each lobby's
  build stamp.

## Pointers

- The map editor in Loom Edit: `docs/loom-w49-contract.md` C7, `editor/CLAUDE.md`.
- The map editor walkthrough: `docs/help/authoring/39-house-map.md`
  (test-pinned by `web/test/help-docs.test.ts` and `lights-help.test.ts`).
- The player's guide: `docs/help/play/11-reinstallation.md`.
- Show devices and kiosk flags: `docs/trapped/kiosk.md`.
- Wave 26: `docs/loom-w26-contract.md` (C5 the house API, C6 the moment
  route's wire shapes, C12 the shared copy, C14 the deploy order and old
  clients).
- The void, the heart and the virus for staff:
  `docs/help/play/19-house-workings.md` (performer-only; the guests' help
  never describes them).
- Setting up a headset: `docs/help/authoring/48-terminal-setup.md` (A
  headset).
