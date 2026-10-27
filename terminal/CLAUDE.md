# terminal — agent guide

`loom-terminal`: the kiosk React app for every screen in the house (wall
tablets, the TV, the server-room laptop, the chess and casino tablets, the
tent laptop). Vite + React 18 + TypeScript, MIT. The event server serves the
build at `/terminal/`. The human-facing overview is [`README.md`](./README.md);
the show's device setup is [`../docs/trapped/kiosk.md`](../docs/trapped/kiosk.md).

## Commands

```bash
pnpm --filter loom-terminal dev        # Vite :5175, proxies /api + /e to LOOM_SERVER (default http://localhost:7000)
pnpm --filter loom-terminal build      # dist/ (base /terminal/)
pnpm --filter loom-terminal test       # vitest run: 1078 tests, 88 files (test/**/*.test.ts)
pnpm --filter loom-terminal typecheck  # tsc --noEmit
pnpm --filter loom-terminal exec vitest run test/door-bridge.test.ts   # one file
```

`scripts/accept/K-14.sh` scans the built bundles for post-Chrome-87 APIs
(terminal + reinstall) and regex lookbehind (terminal + reinstall + play). Run it after a build when you
add browser APIs.

## How it works in one paragraph

A terminal is a trusted device: `config.ts` trades the moderator passcode
for a mod token (`/api/resolve-code` → `/api/mod/login`) and keeps a
`TerminalConfig` in `localStorage` (`loom.terminal`). Every 2 s (TV: 1 s)
`screen.ts` polls `GET /e/<id>/api/screen/state` with the device's health
as query keys; that one answer drives attract/asleep, slides, overlays,
cutscenes, moments, announcements, the King's bar, room state and the
door/patch gates, and the poll itself is the heartbeat Run → Terminals
reads. A terminal that speaks a room's lines (the TV, a `room=` terminal)
also reports `talk` / `said` on it and polls at once when its speech queue
drains (see "Speech done" below). Scanning a pass mints a play-as session for that guest
(`pilot.ts`, `/api/mod/impersonate` with `label`); the terminal reuses the
play app's own `useChatStream` (imported as source) and narrows it to
`dm:<Character>`.

## Layout

| Path | What |
|---|---|
| `src/main.tsx`, `src/app.tsx` | boot; the screen machine: setup → asleep (idle show) → awake → connecting → piloting; per-view routing and lazy chunks |
| `src/config.ts` | `TerminalConfig`, `VIEWS` / `VIEW_INFO`, URL hints (`hintsFromSearch`, `withoutSecrets`), `provision` / `connect`, `roomOf`, `tvRoomOf` |
| `src/Setup.tsx`, `src/setup-map.ts` | the two-step setup (passcode, tap a map terminal); `followMap` / `followVoice` re-read the map entry on boot; `linkConfig` (a `?code=` link: `urlConfig` + `withViewDefaults`, so a spot-only TV link speaks at 0.92) |
| `src/screen.ts` | the screen-state poll + its types (`ScreenState`, `night`, `room`, `king`, `results`, `moments`, `spot`); `voice=`/`room=` + `after=` + `talk=`/`said=`; `useScreenState` paces with `PollPacer` and exposes `pollNow` |
| `src/health.ts` | the heartbeat keys (`deviceQuery`): `ver audio vis fs ann mic bat` + door `door dlv dft dwn` + bay `pb pbc pbx pft` |
| `src/slides.ts`, `src/ScreenLayer.tsx` | the screen layer: overlay > slide > attract > base, holds, `PeekClock`, slide copy, the live Y2K clock and Trust Chart, TV mp4 slides, the glitch (`glitchLayer`, `GlitchTakeover`, `coverOf`) |
| `src/Attract.tsx`, `src/attract.ts` | the asleep screen (the idle show full screen); Mystify's pure parts |
| `src/idle-show/` | the idle show: `schedule.ts` (seeded segments; `PATTERN`, `CALM_PATTERN`), `pools.ts` (by `Night.phase`; `calm`), `field.ts` (popup lives and places, `popupCap`, `calmPace`), `ads.ts` + `art.tsx`, `popups.ts`, `storm.ts`, `gags.ts`, `savers/`, `ScanBox.tsx` + `scan-copy.ts` |
| `src/cutscene/` | `SceneDef` (`types.ts`), `pick.ts` (which scene plays, `MomentQueue`), `clock.ts` (server time), `CutsceneLayer.tsx`, `registry.ts`, `kit/` (Win98 blocks, typewriter, particles…), `scenes/{act1,act2,act3,moments,house,heart}.tsx`, `speech-bus.ts` + `voice-clock.ts` + `voice-scenes.ts` (the TV's voice-timed scenes), `preview.tsx` (`?preview=`) |
| `src/sound/` | `bus.ts` (master, effects, voices buses; `soundPlayingUntil`), `library.ts` (30 synthesised `SFX_NAMES`), `sfx()` |
| `src/speech/` | `engine.ts` (browser → Fully → silent ladder, opt-in server voice, the queue and its pauses, `VoiceFloor`), `lexicon.ts` + `pronounce.json` (how a word is said), `split.ts`, `pick-voice.ts` (male for the character, female for announcements; macOS + Windows names), `said.ts` (`RoomSpeech` → `talk` / `said` / `sp`, `PollPacer`, the drain re-poll) |
| `src/announce.ts` | which house announcements a terminal says, the chime |
| `src/face/` | the SVG face (`Face.tsx`) and `mood.ts` (`browGeometry`: SVG's y points down, so angry pulls the inner brows down) |
| `src/scanner.tsx`, `src/scan.ts`, `src/camera.ts` | QR scan (`BarcodeDetector`, else jsQR); what a code means; one shared ref-counted `MediaStream` |
| `src/pilot.ts`, `src/chat.tsx`, `src/controls.tsx`, `src/idle.ts` | impersonate / say / end; `terminal opened` / `closed` (`VisitLatch`); a room terminal checks for a locked pass first (`refusesLockedPass`, `passLocked`); the thread + composer; the 2 s ⚙ hold; the leash (30 s, files 120 s, heart 180 s) |
| `src/files.ts`, `src/FilePanel.tsx` | 📎 GIVE HIM A FILE: share / redeem as the piloted guest |
| `src/heart/` | `heart.ts` (the heart menu = newest `choices` entry on `dm:<character>` whose beat starts `heart `; tags; when the composer shows; wave 27: `panelGate` + `panelSince` (the panel waits on his voice and his scenes, and settles again after a skip), `panelPlace` (a ⟦BACK⟧ menu with no composer still draws its bar), `optionKey`, `layerOfBeat`, `echoOf` + `echoTime`, `composerBlocked` (also held at the heart until his first word, `heartWaitingFirstWord`), `threadFor`, `pilotEndWait`), `ChoicePanel.tsx`, `DoorOverlay.tsx`, `DoorSetup.tsx`, `PatchSetup.tsx` |
| `src/serial/` | the M4 bridge: `door-protocol.ts` (JSON lines, pure), `door-bridge.ts` + `patch-bridge.ts` (decisions, pure), `door-serial.ts` (Web Serial + `door=sim`, lazy), `door-status.ts` (store + heartbeat keys), `use-door.ts` (hook) |
| `src/world/` | spatial SSE + house map → `WorldStore`; `presence.ts` (linked by room: `linkedNow`, `linkedPane`, `usePresenceLatch`); `director.ts` (mount / follow / orbit, three-free), `minimap.ts`, `WorldView.tsx` (three.js, lazy) |
| `src/raycast/` | the no-WebGL2 Canvas 2D raycaster (lazy, never imports three) |
| `src/shadow/` | `view=shadow`: the camera with ghosts (lazy) |
| `src/camfeed.ts` | the camera feed to the games (`POST /api/mod/spatial/cam`); one frame / 2 s while the reply says `watched: false`; never from the tent |
| `src/voice/` | the voice link: `roles.ts` (who takes part, `micReport`), `mic.ts`, `capture.ts`, `uplink.ts`, `stream.ts`, `playback.ts`, `link.ts` (lazy `VoiceLink`), `hook.ts`, `MicCue.tsx` |
| `src/Tv.tsx`, `src/tv.ts` | `view=tv`: which lines are spoken / captioned (`TV_SILENT_BEATS`), the cursor, the mute |
| `src/chess/` | `view=chess`: `session.ts` (pure), `post.ts` (chess results, pending in `loom.terminal.pending-chess`), `ChessTerminal.tsx` (lazy, `@loom/chess`) |
| `src/casino/` | `view=casino`: `session.ts` (pure), `post.ts` (`/api/mod/casino/bet`, never retried), `CasinoTerminal.tsx` (lazy) |
| `src/reinstall/` | `view=reinstall`: `session.ts` (pure: what a pass does), `ReinstallTerminal.tsx` (the scan kiosk between walks), `pane.tsx` (shadow root), `scope-css.ts`, `adapter.ts` |
| `src/kiosk.ts`, `src/fullscreen.ts`, `src/webgl.ts` | Wake Lock + the ⚙ long press; `KioskFullscreen`; the one-time WebGL2 probe |
| `public/slides/` | slide PNG / MP4 files named after the cue (see its README) |
| `test/` | one file per pure module; `fixtures/door-lines.jsonl`; `fake-audio.ts`, `world-fixture.ts` |

Server side lives in `core/server`: `routes/screen.ts` (the screen state,
the heartbeat parse, `/api/mod/screen/terminals`), `event-runtime.ts`
(`/api/mod/impersonate`, `/api/mod/signal`), `spatial.ts`,
`spatial-cams.ts`, `spatial-voice.ts`, `tts.ts`, and `server.ts` (static
`/terminal/`, `LOOM_TERMINAL_DIST`).

## Views

`auto` · `world` · `face` · `mirror` · `tv` · `chess` · `shadow` · `casino`
· `reinstall` (`config.ts` `VIEWS`, mirrored by `@loom/house`
`TERMINAL_VIEWS`). While piloting the pane is always the face. `roomOf`
returns null for `tv`, `chess`, `casino` and `reinstall`: those never sleep
on a room. `chess`, `casino` and `reinstall` are awake all night and take
overlays only; `reinstall` also takes beat cutscenes and moments between
walks (never a story slide, the countdown corner or the Y2K clock:
`screenLayers` `slides: false`) and counts as busy (piloting) during one.
Every view takes the glitch.

### Linked by room (wave 26, R5)

A terminal shows the Internet only while a reinstalled player is in its
spot's room in the game. `world/presence.ts` `linkedNow` is the one rule
for the walls, the TV and the tests:

- A placed `auto` **or `world`** wall shows the world only while the
  screen state's `spot.here > 0`: the face pane awake (`linkedPane`), full
  screen asleep (`watchWhileAsleep(state, view, room, spot)`). `world` no
  longer means always.
- The TV's world pane uses the same rule (view `tv`). A TV with no spot
  never shows it and opens no spatial stream (`Tv.tsx`).
- `mirror` / `shadow`: house-wide (anyone in the simulation), as before.
- No spot, or `reinstall`: never.
- Only when the server sends no `here` (an older server, no map) does a
  placed terminal fall back to the house-wide rule.

`usePresenceLatch` turns on at once and off only after 3 s unlinked
(`PRESENCE_LINGER_MS`), so a doorway crossing never flickers. The server
counts `here` with `@loom/house` `presenceRoom` and routes the voice and the
cameras per room itself (`docs/loom-reinstall.md` §2).

### The tent (wave 26, T3)

Between walks `view=reinstall` is a scan kiosk
(`reinstall/ReinstallTerminal.tsx`): a centred 💿 Reinstallation Wizard card
with the live camera, the typed field, ☣ IN THE INTERNET NOW as 48 px
buttons and a status bar with the reinstalling count. A `tablet_*` cue (the
capture) is a status line in the card that names nobody. The typed field
takes the focus back after any tap outside the card (`TypedFallback`
`focus` / `scope` / `clearOnPick`, `takesFocusBack`). The camera shrinks
(44vh down to 140 px) before any row under it clips. Behind it the idle
show is `quiet` and never lands a window on the card (`field.ts`
`placePopup` / `stormPlace` return null, `spawn` adds nothing); at 1366x768
landscape none fits, so none comes. The tent draws no world, sends no
camera feed and has no voice link. A pass gets NOT MARKED or the reinstall
flow full screen (`pane.tsx`).

## The glitch (wave 26, T2)

The story's 📺 glitch is an 8 s takeover on every terminal.
`layers.glitch` (`slides.ts` `glitchLayer`) is `program.glitch` while its
`at` > 0, younger than `GLITCH_MS` (8 s) and later than this page's first
screen answer (`ScreenState.firstNow`, stamped once per page by
`withFirstNow`), so history and a reload mid-glitch never play it. A page
that first saw the cue more than `GLITCH_FRESH_MS` (4 s) after it never
plays it either (`ScreenState.glitchSeen`: a server lost and back
mid-takeover).

- Piloting, a peek, `bare` and the tent never suppress it; a blackout beats
  it. `coverOf` makes it a cover (the idle show pauses), never a takeover:
  a pilot, a chess game or a tent walk keeps running under it.
- `GlitchTakeover` (`ScreenLayer.tsx`) is CSS only in the main bundle
  (`.screen-glitch`, z 36): ≤ 3 Hz, no red field, transform and opacity
  only, a still frame under reduced motion. It unmounts itself at its end
  (`glitchLeftMs`) and sounds once per cue per page (`claimGlitchSounds`).
- The app's `layer` is `<Fragment key="screen-layer">`: keep the key, so
  the glitch and scenes don't remount when an asleep wall flips between
  the idle show and the world.
- A slide cued with it (the ad hijack) runs its scene from the takeover's
  end (`slideClockAt`); the hold still counts from the cue.
- `?preview=glitch` draws it.

## The idle show

`idle-show/` runs the asleep screen. Before the 📺 ad hijack it is calm
(`IdleContext.calm`, pools `early` / `hunt`): `CALM_PATTERN` (one ad a
~2 min cycle), a window every 18–39 s (`CALM_POPUP_PACE`), at most
`CALM_MAX_POPUPS` (2), no storms, no ad-like windows. After the hijack it
floods as before. `quiet` (the tent's backdrop) holds one window, no TOUCH
ME, no face, no storm unless hijacked, and the calm pace all night
(`calmPace`). A popup's arrival time survives a segment change
(`relayout(f, layout, prev)` resets it only when a storm starts or ends),
so calm walls keep their spacing.

## The voice

Everything the page says goes through a `SpeechQueue`
(`speech/engine.ts`), and every voice waits on the one `VoiceFloor`. The
terminal has four queues: the room terminal's (`app.tsx`), the TV's
(`Tv.tsx`), the announcements' (`announce.ts`) and Setup's TEST VOICE. On
the tent laptop the mounted reinstall game adds its own
(`reinstall/web/src/game/lines.ts`), on the same `VoiceFloor`.

- **Pauses (wave 26, V2).** `CHUNK_GAP_MS` (300) between two sentences of
  a line, `LINE_GAP_MS` (700) before the next line, never after the last;
  `stop()` cuts a pause short. `gapsFor(config)` scales both by
  `config.pause` (0–3, default 1: `pause=` on a link, the pauses slider in
  ⚙). The character's queues take `gapsFor(config)`; announcements take
  `ANNOUNCE_GAPS` (250 ms, no line gap: the chime parts them).
- **Speed.** The TV speaks at `TV_SPEED` (0.92). `withViewDefaults` turns a
  `view=tv` config's speed 1 into 0.92 whenever a link provisions it:
  `provision`, then `linkConfig` (`urlConfig` + `withViewDefaults`, because
  a spot-only TV link learns `view: "tv"` from the map). Setup gives 0.92
  only to a first-time TV whose pace slider was never moved (`setupPace`,
  `paceForView`). A reload keeps the saved speed.
- **Pronunciation (V3).** `SpeechQueue.prepare` runs every sentence through
  `speech/lexicon.ts` `pronounce()` over `speech/pronounce.json`: every
  voice says "Anti Virus" while the transcript and the captions keep
  "Antivirus". Whole words only, case folded in ASCII only, no lookbehind.
  The JSON is copied byte for byte to `stagehand/src/stagehand/` and
  `reinstall/vr/config/` (`test/lexicon.test.ts` pins all three); the web
  game imports the terminal's. Change all three together.
- **Started means heard (V1).** `SpeechEngine.play(p, onLevel, onStart)`:
  the browser voice calls `onStart` at its utterance start (or first word
  boundary), the server voice when its audio starts, Fully and silent at
  handover. The queue fires `chunk` from that, with a fallback when an
  engine ends without starting, and nothing after a stop. A
  `LinePlayer` with `captionOnStart` (`tv.ts`; the TV and the room
  terminal) captions a spoken line when he starts it, not a line gap early.
- **Voice-timed scenes (the TV, V1).** The TV puts what its voice does on
  `cutscene/speech-bus.ts` (`queued` / `line` / `chunk` / `done`, with
  `cut` for a dropped line). A scene listed in `cutscene/voice-scenes.ts`
  (`marks`, `ownCaption`, `drawn`) is drawn at a `t` warped to his speech
  (`voice-clock.ts`): it holds before each sentence until he starts it, and
  goes back to the plain clock for good after `VOICE_WAIT_MS` (6 s) with no
  voice. `MomentQueue.extendTo` / `resetEnd` (`pick.ts`) move the moment's
  end with him. The layer captions the sentence he is saying
  (`SceneProps.voice`, `.cutscene-voice-caption`) unless the scene draws it.
  `test/voice-scenes.test.ts` reads `beats/*.loom` and pins each scene's
  sentence count, so a story edit that changes one fails there.
- **`sp=`.** The TV also reports `sp=<seq>:<chunk>` / `sp=<seq>:d`; the
  server keeps it as `tvSpeech`. The walls don't follow it yet: they keep
  the server clock.

### Speech done (wave 25)

The house desk's `speech` step waits on it (`docs/loom-house-desk.md` §5).
The App owns one `RoomSpeech` (`speech/said.ts`) beside the voice cursor;
the TV's and the room terminal's `LinePlayer` attach to it while mounted
and report the `speak` lines they queue, each one finished, and a drop
(`stop`: the mute, attract, unmount). The poll that names `voice=` (TV) or
`room=` adds:

- `talk=1|0`: 1 while a spoken room line is queued or being said.
- `said=<seq>`: every room line at or before it is finished. A muted,
  song, text-only or other speaker's line, or anything planned on attract,
  is finished at once; only lines it will really speak hold it back (the
  seq just before the first unsaid one). With no player mounted (the setup
  screen) it is `talk=0` with the last head heard. Left out until the
  first answer.

A terminal that names neither `voice=` nor `room=` sends neither field.
When the queue drains (talk 1 → 0), `pollNow` polls at once; `PollPacer`
keeps two poll starts at least `DRAIN_REPOLL_GAP_MS` (500 ms) apart, and a
drain during a poll in flight polls again right after it.

## Provisioning keys

`?code= name= character= camera= engine= spot= view= room= announce= cam=
mic= voices= door= keys= bay= pause=` (`UrlHints`). A new key needs three edits in
`config.ts`: `UrlHints`, `hintsFromSearch`, and `withoutSecrets` (which
scrubs the bar), plus `provision`'s defaults. `name` / `view` / `room` on a
link override the map and stop `fromMap`; the setup-by-map path leaves
them out.

## The M4 bridge (door + patch bay)

- One board, one port: `door-serial.ts` opens the Grand Central M4
  (Adafruit VID `0x239a`), sends `version` + `get`, re-sends the stored
  calibration (`loom.terminal.door`) only when it was taken in the board's
  current mode, and never sends `set mode`.
- Posts go to `POST /api/mod/signal` with the header **`x-loom-token`**
  (the server never reads `Authorization`) and `label: "Terminal · <name>"`.
- Door gate: nothing until `night.server_door !== null` (Power On played),
  nothing while `night.door_override` or a blocking fault. A poll-time
  reconcile repairs missed edges (≥ 4 s since the last post).
- Patch gate: `night.server_door !== null` and `night.step >= 14`, not
  `night.ended`, not `night.patch_override`. A set completed while the gate
  is shut is let go, never posted later; the first line after a connect is
  only looked at; a new run (step < 14) forgets the last posted set.
- The bridge never knows the combinations. **Never put combination
  strings, the door code or other live codes in code, tests or docs.**
- The parser is tested line for line against the firmware's
  `hardware/server-room-m4/test/fixtures/lines.jsonl` and the terminal's
  own `test/fixtures/door-lines.jsonl`. A protocol change touches the
  firmware, both fixtures, `door-protocol.ts` and its test together.

## Conventions and gotchas

- **Old browsers.** The build targets `chrome87` / `safari14`
  (`vite.config.ts`): syntax only. No regex lookbehind (Safari 14 throws).
  No `structuredClone` (use `@loom/house` `cloneData`), no `aspect-ratio`
  where layout depends on it. Feature-detect `BarcodeDetector`,
  `navigator.serial`, `getBattery`, Wake Lock and the webkit fullscreen
  calls.
- **Keep the main bundle lean.** three.js, the raycaster, shadow, chess,
  casino, reinstall, cutscenes, the voice link and the serial bridge are
  lazy chunks. `voice-on` comes from `@loom/house/voice-on` so the codec
  stays in its chunk. A chunk that fails to load must never take the
  scanner down (error boundaries fall back to the face).
- **Pure first.** Decisions live in pure modules (`*-bridge.ts`,
  `session.ts`, `pick.ts`, `slides.ts`, `tv.ts`, `heart.ts`, `roles.ts`,
  `director.ts`) with timers, fetch and ports injected; tests drive them in
  node. Follow that shape.
- **Aliases.** `@loom/play` → `../play/src` (the chat stream, `api`, types),
  `@loom/reinstall` → `../reinstall/web/src`, `@loom/terminal` → `./src`.
  React and three are deduped. An edit to the play app's stream or the
  reinstall flow changes the terminal too.
- **One camera stream.** The scanner, camera feed and shadow view share
  `camera.ts`'s ref-counted stream; the voice link opens its own audio-only
  stream (`MicHub`). Never add a second video `getUserMedia`.
- **Sound.** Terminals play only synthesised accents through `sfx()`,
  dropped while a voice holds the floor. Never play a story `sound X` here;
  those are the house router's. Every voice on the page waits on the one
  `VoiceFloor`.
- **Fiction safety.** Nothing names the character before the
  introduction (idle-show copy, scenes with `namesCharacter`). Casino bets
  are never retried. Chess results are retried and kept for 60 s across a
  reload. The TV and mirrors never peek under a slide.
- **Locked passes (wave 26, R1).** A room terminal (the server room) asks
  the server whether a pass is locked before it pilots (`passLocked`, 3 s
  timeout, then it opens as before). A locked pass gets
  `LOCKED_PASS_NOTICE` and no line; the story guards `terminal_opened`
  too. Other walls open the line and the server refuses every post.
- **DRAFT copy.** New show copy carries `// DRAFT w26` (G1: the filing
  steps, the reminders, Truth Pong, the summons, the chess stakes line
  *Checkmate him.*; D1: `dare_chosen` on the `Dare Chosen` beat,
  `DARE_ORDER`; `LOCKED_PASS_NOTICE`). The rows are in the show's
  `SIGNOFF-w26.md`; it awaits the user's sign-off.
- **Tests read the show.** Several tests read
  `core/examples/trapped-in-the-internet/` (`house.json`,
  `house.shed.json`, `generated/questions.loom`, `cast/trabolta.loom`,
  `beats/finale.loom`). A show edit can fail a terminal test; that is
  intended.
- **Build stamp.** `__BUILD__` is the git short sha + build time
  (`LOOM_BUILD` overrides); Run → Terminals flags a device on an old build.
- **The heart's thread (wave 27).** The heart terminal (`threadFor`) draws
  `session.visitLines` (past the visit's floor, `pilot.ts` `floorAfter`),
  never the whole DM thread; every other terminal, room ones included,
  keeps the whole thread; `terminal opened` is posted from an effect once the stream's
  history is in (2.5 s fallback, `pinFloor`), never in `connect()`.
- **Room scene stages.** A room scene's stage carries `cutscene-room`
  (`cutscene-${kind}`); the wrapper's `display: contents` rule is
  `.cutscene-top.cutscene-room` so the stage keeps its box. A side scene
  (layer card, proof, warning) draws over the face pane only.
- **Stale comments.** `src/tv.ts` still says "QLab plays the sung track":
  the house router plays it now. The behaviour (song beats captioned, not
  spoken) is right. ⚙'s `VIEW_INFO.world` still reads "the simulation,
  always"; since wave 26 it is only while linked.

## Pointers

- Spatial contract: `docs/loom-reinstall.md` §2 (server, cams §2.3, voice
  §2.4) and §4 (the terminals' world view).
- Firmware + wiring: `hardware/server-room-m4/README.md`.
- Help articles: `docs/help/play/09-terminals.md` (guests),
  `docs/help/play/19-house-workings.md` (staff: the hidden rules, linked
  terminals, the glitch), `docs/help/authoring/48-terminal-setup.md`
  (setting up terminals, the door sensor, headsets),
  `docs/help/authoring/38-server-room.md`, `docs/help/authoring/43-run-mode.md`
  (Run → Terminals).
- History: `docs/history/terminal-readme-2026-10.md` (the full README before
  the 2026-10-24 split).
