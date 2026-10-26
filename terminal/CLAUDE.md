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
pnpm --filter loom-terminal test       # vitest run: 945 tests, 80 files (test/**/*.test.ts)
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
| `src/Setup.tsx`, `src/setup-map.ts` | the two-step setup (passcode, tap a map terminal); `followMap` / `followVoice` re-read the map entry on boot |
| `src/screen.ts` | the screen-state poll + its types (`ScreenState`, `night`, `room`, `king`, `results`, `moments`, `spot`); `voice=`/`room=` + `after=` + `talk=`/`said=`; `useScreenState` paces with `PollPacer` and exposes `pollNow` |
| `src/health.ts` | the heartbeat keys (`deviceQuery`): `ver audio vis fs ann mic bat` + door `door dlv dft dwn` + bay `pb pbc pbx pft` |
| `src/slides.ts`, `src/ScreenLayer.tsx` | the screen layer: overlay > slide > attract > base, holds, `PeekClock`, slide copy, the live Y2K clock and Trust Chart, TV mp4 slides; the glitch takeover (`glitchLayer`, `GlitchTakeover`, `coverOf`: wave 26) |
| `src/Attract.tsx`, `src/attract.ts` | the asleep screen (the idle show full screen); Mystify's pure parts |
| `src/idle-show/` | the idle show: `schedule.ts` (seeded segments; `PATTERN`, `CALM_PATTERN`), `pools.ts` (by `Night.phase`; `calm`, `quiet`), `field.ts` (popup lives, `popupCap`), `ads.ts` + `art.tsx`, `popups.ts`, `storm.ts`, `gags.ts`, `savers/`, `ScanBox.tsx` + `scan-copy.ts` |
| `src/cutscene/` | `SceneDef` (`types.ts`), `pick.ts` (which scene plays), `clock.ts` (server time), `CutsceneLayer.tsx`, `registry.ts`, `kit/` (Win98 blocks, typewriter, particles…), `scenes/{act1,act2,act3,moments,house,heart}.tsx`, `preview.tsx` (`?preview=`) |
| `src/sound/` | `bus.ts` (master, effects, voices buses; `soundPlayingUntil`), `library.ts` (30 synthesised `SFX_NAMES`), `sfx()` |
| `src/speech/` | `engine.ts` (browser → Fully → silent ladder, opt-in server voice, the queue, `VoiceFloor`), `split.ts`, `pick-voice.ts` (male for the character, female for announcements; macOS + Windows names), `said.ts` (wave 25: `RoomSpeech` → `talk` / `said`, `PollPacer`, the drain re-poll) |
| `src/announce.ts` | which house announcements a terminal says, the chime |
| `src/face/` | the SVG face (`Face.tsx`) and `mood.ts` |
| `src/scanner.tsx`, `src/scan.ts`, `src/camera.ts` | QR scan (`BarcodeDetector`, else jsQR); what a code means; one shared ref-counted `MediaStream` |
| `src/pilot.ts`, `src/chat.tsx`, `src/controls.tsx`, `src/idle.ts` | impersonate / say / end; `terminal opened` / `closed` (`VisitLatch`); the thread + composer; the 2 s ⚙ hold; the leash (30 s, files 120 s, heart 180 s) |
| `src/files.ts`, `src/FilePanel.tsx` | 📎 GIVE HIM A FILE: share / redeem as the piloted guest |
| `src/heart/` | `heart.ts` (the heart menu = newest `choices` entry on `dm:<character>` whose beat starts `heart `; tags; when the composer shows), `ChoicePanel.tsx`, `DoorOverlay.tsx`, `DoorSetup.tsx`, `PatchSetup.tsx` |
| `src/serial/` | the M4 bridge: `door-protocol.ts` (JSON lines, pure), `door-bridge.ts` + `patch-bridge.ts` (decisions, pure), `door-serial.ts` (Web Serial + `door=sim`, lazy), `door-status.ts` (store + heartbeat keys), `use-door.ts` (hook) |
| `src/world/` | spatial SSE + house map → `WorldStore`; `presence.ts` (wave 26 R5: `roomOccupied`, `linkedNow`, `linkedPane`, `PresenceLatch`, `usePresenceLatch`, `useRoomLinked`); `director.ts` (mount / follow / orbit, three-free), `minimap.ts`, `WorldView.tsx` (three.js, lazy) |
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
overlays only; `reinstall` (the tent's scan kiosk, wave 26 T3) also takes
beat cutscenes and moments between walks — never a story slide, the
countdown corner or the Y2K clock (`screenLayers` `slides: false`) — and
counts as busy (piloting) during one. Every view takes the glitch.

## Wave 26

- **The glitch (T2).** `layers.glitch` (`slides.ts` `glitchLayer`):
  `program.glitch` while its `at` > 0, younger than `GLITCH_MS` (8 s) and
  later than this page's first screen answer (`ScreenState.firstNow`,
  stamped once per page by `useScreenState` / `withFirstNow`), so history
  and a reload mid-glitch never play it. Piloting, a peek, `bare` and the
  tent never suppress it; a blackout beats it. `coverOf`: covered (the idle
  show pauses), never a takeover (a pilot, a chess game, a tent walk keep
  running). `GlitchTakeover` (`ScreenLayer.tsx`) is CSS only in the main
  bundle (`.screen-glitch`, z 36): ≤ 3 Hz, no red field, transform /
  opacity, reduced motion a still frame. `?preview=glitch` draws it.
- **The calm idle show (T1).** `IdleContext.calm` (pool `early` / `hunt`,
  i.e. before the 📺 ad hijack): `CALM_PATTERN` (one ad a ~2 min cycle),
  a window every 18–39 s (`CALM_POPUP_PACE`), `CALM_MAX_POPUPS` (2), no
  storms, no `adLike` windows. After the hijack the flood as before.
  `quiet` (`IdleShow quiet`, the tent's backdrop): one window, no TOUCH ME,
  no face, no storm unless hijacked.
- **Terminals link by room (R5).** `world/presence.ts`: a placed wall
  shows the world (pane, or full screen asleep) only while `spot.here > 0`
  (the house-wide rule only when the server sends no `here`), latched 3 s;
  no spot or `reinstall`: never; `mirror` / `shadow`: house-wide.
  `watchWhileAsleep(state, view, room, spot)`. The TV's gate is the voice
  lane's `Tv.tsx`: `useRoomLinked(state?.spot, inSimulation)`.
- **The tent (T3).** A centred Reinstallation Wizard card: the camera,
  the typed field (`TypedFallback` `focus` / `clearOnPick`), the picks as
  48 px buttons, N REINSTALLING; a `tablet_*` cue is a status line in it.
  No world pane, no camera feed.
- **Copy.** G1 (the filing steps, the reminders, Truth Pong, the summons,
  the chess stakes line) and D1 (`dare_chosen` on the `Dare Chosen` beat,
  `DARE_ORDER`) carry `// DRAFT w26`.

## Speech done (wave 25)

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
mic= voices= door= keys= bay=` (`UrlHints`). A new key needs three edits in
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
- **Tests read the show.** Several tests read
  `core/examples/trapped-in-the-internet/` (`house.json`,
  `house.shed.json`, `generated/questions.loom`, `cast/trabolta.loom`,
  `beats/finale.loom`). A show edit can fail a terminal test; that is
  intended.
- **Build stamp.** `__BUILD__` is the git short sha + build time
  (`LOOM_BUILD` overrides); Run → Terminals flags a device on an old build.
- **Stale comments.** `src/tv.ts` still says "QLab plays the sung track":
  the house router plays it now. The behaviour (song beats captioned, not
  spoken) is right.

## Pointers

- Spatial contract: `docs/loom-reinstall.md` §2 (server, cams §2.3, voice
  §2.4) and §4 (the terminals' world view).
- Firmware + wiring: `hardware/server-room-m4/README.md`.
- Help articles: `docs/help/play/09-terminals.md`,
  `docs/help/authoring/38-server-room.md`, `docs/help/authoring/43-run-mode.md`
  (Run → Terminals).
- History: `docs/history/terminal-readme-2026-10.md` (the full README before
  the 2026-10-24 split).
