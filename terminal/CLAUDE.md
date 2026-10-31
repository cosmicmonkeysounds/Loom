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
pnpm --filter loom-terminal test       # vitest run: 1462 tests, 102 files (test/**/*.test.ts)
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
| `src/health.ts` | the heartbeat keys (`deviceQuery`): `ver audio vis fs ann mic bat` + door `door dlv dft dwn` + bay `pb pbc pbx pft`; wave 50's `bug` rides `speechQuery` |
| `src/slides.ts`, `src/ScreenLayer.tsx` | the screen layer: overlay > slide > attract > base, holds, `PeekClock`, slide copy, the live Y2K clock and Trust Chart, TV mp4 slides, the glitch (`glitchLayer`, `GlitchTakeover`, `coverOf`) and the ad burst (wave 32: `burstLayer`, `isBurst`; `burst-flash.tsx` where no cutscene layer draws it) |
| `src/Attract.tsx`, `src/attract.ts` | the asleep screen (the idle show full screen); Mystify's pure parts |
| `src/dream/` | Clippy's dream (wave 50): `dream.ts` (pure: the phase, `moshMode`, `dreamYields`), `player.ts` (the page's one video, its health and fallback), `DreamView.tsx` (the hooks + where it plays), `mosh.ts` (pure: a cycle's plan, `drawMosh`), `stamp.ts` (the scene's copy), `Mosh.tsx` (the canvas) |
| `src/idle-show/` | the idle show: `schedule.ts` (seeded segments; `PATTERN`, `CALM_PATTERN`), `pools.ts` (by `Night.phase`; `calm`), `field.ts` (popup lives and places, `popupCap`, `calmPace`), `ads.ts` + `art.tsx`, `popups.ts`, `storm.ts`, `gags.ts`, `savers/`, `ScanBox.tsx` + `scan-copy.ts` |
| `src/cutscene/` | `SceneDef` (`types.ts`), `pick.ts` (which scene plays, `MomentQueue`), `clock.ts` (server time), `CutsceneLayer.tsx`, `registry.ts`, `kit/` (Win98 blocks, typewriter, particles…), `scenes/{act1,act2,act3,moments,house,heart,credits}.tsx` (+ `scenes/language.tsx`, G14's breach, listed in act3's), `kit/lang-breach.ts` + `kit/lang-breach-draw.ts` (wave 48b: the breach's timeline and its canvas), `access-bus.ts` (the app's event base + token for a scene that fetches), `credits-fetch.ts` + `credits-roll.ts` (wave 44), `speech-bus.ts` + `voice-clock.ts` + `voice-scenes.ts` (the TV's voice-timed scenes), `preview.tsx` (`?preview=`) |
| `src/sound/` | `bus.ts` (master, effects, voices buses; `soundPlayingUntil`), `library.ts` (30 synthesised `SFX_NAMES`), `sfx()` |
| `src/speech/` | `engine.ts` (browser → Fully → silent ladder, opt-in server voice, the queue and its pauses, `VoiceFloor`), `lexicon.ts` + `pronounce.json` (how a word is said), `split.ts`, `pick-voice.ts` (male for the character, female for announcements; macOS + Windows names), `said.ts` (`RoomSpeech` → `talk` / `said` / `sp`, `PollPacer`, the drain re-poll), `glitch.ts` (wave 56: pure: a sentence → a plan of fragments), `VoiceBench.tsx` (`?preview=voice`) |
| `src/announce.ts` | which house announcements a terminal says, the chime |
| `src/face/` | the SVG face (`Face.tsx`) and `mood.ts` (`browGeometry`: SVG's y points down, so angry pulls the inner brows down) |
| `src/scanner.tsx`, `src/scan.ts`, `src/camera.ts` | QR scan (`BarcodeDetector`, else jsQR); what a code means; one shared ref-counted `MediaStream` |
| `src/pilot.ts`, `src/chat.tsx`, `src/controls.tsx`, `src/idle.ts` | impersonate / say / end; `terminal opened` / `closed` (`VisitLatch`); a room terminal checks for a locked pass first (`refusesLockedPass`, `passLocked`); the thread + composer; the 2 s ⚙ hold; the leash (30 s, files 120 s, heart 180 s); wave 42b: the guest's place in his line (`pilotWait` over play's `useAgentWait`, `chat.tsx` `WaitLine` + `waitCells`: an amber system line with the phone's `DRAFT w42` words and a ten-block bar where the typing row goes, its estimate counting down; `answering` is the typing row; a queued line holds the leash; the waits are the piloted guest's only and clear on every `history` frame; `test/w42-wait.test.ts`) |
| `src/files.ts`, `src/FilePanel.tsx` | 📎 GIVE HIM A FILE: share / redeem as the piloted guest |
| `src/heart/` | `heart.ts` (the heart menu = newest `choices` entry on `dm:<character>` whose beat starts `heart `; tags; when the composer shows; wave 27: `panelGate` + `panelSince` (the panel waits on his voice and his scenes, and settles again after a skip), `panelPlace` (a ⟦BACK⟧ menu with no composer still draws its bar), `optionKey`, `layerOfCue` (scene timing only; wave 29: no header, card or test shows a layer number), `echoOf` (re-exported from core's `pick-echo.ts`), `composerBlocked` (also held at the heart until his first word, `heartWaitingFirstWord`), `threadFor`, `pilotEndWait`), `pending-pick.ts` (a pick shown at once until the server's line), `ChoicePanel.tsx`, `DoorOverlay.tsx`, `DoorSetup.tsx`, `PatchSetup.tsx` |
| `src/devices.ts` | wave 52: which camera and microphone a stream opens, by part of its name (`config.webcam`) |
| `src/gamepad/` | wave 52: the GameCube controller: `pad.ts` (pure: `GC`, `frameOf`, `PadMachine`, `movedTo`), `PadNav.tsx` (the loop, over `data-pad` / `data-pad-aside` / `data-pad-skip` / `data-pad-back`), `RigSetup.tsx` (⚙) |
| `src/crt/` | wave 52b: the server room's CRT: `CrtStage.tsx` (the 640 × 480 stage, the pipes), `Wave.tsx` (his voice, on the face's handle), `legend.ts` + `Legend.tsx` (the button guide), `cards.ts` (the heart's scenes as text, pinned to `scenes/heart.tsx`), `prompt.ts` (when it asks for a pass, the keyboard's keys), `Keyboard.tsx`, `crt.css` |
| `src/whisper/` | wave 52: spoken answers: `speech.ts` (pure: `wavOf`, `EndOfSpeech`, `cleanText`, `parrotLine`, `VOICE_COPY`, DRAFT w52), `listen.ts` (the mic → whisper.cpp), `VoiceComposer.tsx` (lazy; the composer when `config.whisper`) |
| `src/serial/` | the M4 bridge: `door-protocol.ts` (JSON lines, pure), `door-bridge.ts` + `patch-bridge.ts` (decisions, pure), `door-serial.ts` (Web Serial + `door=sim`, lazy), `door-status.ts` (store + heartbeat keys), `use-door.ts` (hook) |
| `src/world/` | spatial SSE + house map → `WorldStore`; `presence.ts` (linked by room: `linkedNow`, `linkedPane`, `usePresenceLatch`); `director.ts` (mount / follow / orbit, three-free), `minimap.ts`, `WorldView.tsx` (three.js, lazy) |
| `src/raycast/` | the no-WebGL2 Canvas 2D raycaster (lazy, never imports three); `swarm.ts`: its ghosts, a small Canvas 2D swarm |
| `src/shadow/` | `view=shadow`: the camera with ghosts, the world view's swarm with shards dropping out on the flicker (lazy) |
| `src/camfeed.ts` | the camera feed to the games (`POST /api/mod/spatial/cam`); one frame / 2 s while the reply says `watched: false`; never from the tent |
| `src/voice/` | the voice link: `roles.ts` (who takes part, `micReport`), `mic.ts`, `capture.ts`, `uplink.ts`, `stream.ts`, `playback.ts`, `link.ts` (lazy `VoiceLink`), `hook.ts`, `MicCue.tsx` |
| `src/Tv.tsx`, `src/tv.ts` | `view=tv`: which lines are spoken / captioned (`TV_SILENT_BEATS`), the cursor, the mute |
| `src/chess/` | `view=chess`: `session.ts` (pure), `post.ts` (chess results, pending in `loom.terminal.pending-chess`), `ChessTerminal.tsx` (lazy, `@loom/chess`; the board measured to its pane by `useFit` + `fit.ts` `boardSide`, since a phone's `100vh` overshoots), `tutorial.ts` + `Tutorial.tsx` (wave 43: three cards, once per challenger per page, ? HELP; holds the leash, locks the board) |
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
- `?preview=glitch` draws it. `?preview=flicker&lag=<ms>` draws the ⚡ flicker as a screen that polled late sees it (wave 32); under reduced motion the flicker is one soft dim, not nothing.
- **Its own words (wave 32, C5).** A glitch shot may carry `text` (the
  story's `Night.glitch_text`; `screen.ts` clips it at `GLITCH_TEXT_MAX`
  120): the takeover shows it (a long line in a smaller, wrapping style),
  else the old *000. 000. 000.* (`glitchText`).

### The ad burst (wave 32)

A talk scene's ⚡ (`ad_burst`) or its timer, from the ad attack on, cues
`screens_glitch` as a **burst**: never the 8 s takeover, but
`layers.burst` (`slides.ts` `burstLayer`) for `BURST_MS` (3.6 s), under the
takeover's live-only rules (never history, a reload or a late page; a
blackout beats it). `isBurst`: the shot's `light` (the server marks it
when `Night.glitch_kind` is `"burst"`), else, from an older server, a
`BURST_MOMENTS` moment (the burst's `truther_glitch` sound, never the ⚡
signal) within `BURST_WITH_MS` (2 s) of the cue. The 📺 hijack has neither
and keeps its takeover. The cutscene layer draws it
(`kit/ad-burst.tsx` `AdBurst`, `.cutscene-burst` z 31, no taps): a torn
band, 8 popups led by the burst's line (*SPECIAL OFFER*, then the hijack's
`AD_MESSAGES`), the line slammed across the middle as a banner. It plays
over whatever is up, off the moment queue, and never replaces a slide (a
slide cued with it does not wait). Where no cutscene layer is mounted (the
chess and casino terminals) or its chunk is loading or failed, the base
bundle's CSS-only `burst-flash.tsx` `BurstFlash` draws a lighter one
(`cutscene/slot.tsx` falls back to it). Before the ad attack ⚡ is only
`screens_flicker`. `?preview=burst&t=&text=` draws it;
`test/w32-burst.test.ts` reads `main.loom` and pins the pairing, so a
change to the burst rule's sound needs `BURST_MOMENTS` updated.

## The credits (wave 44, C8)

At the very end of the night the story cues `screens_credits` (slide
value `credits`, `CREDITS_SLIDE` in `core/src/credits.ts`, imported by
relative path), which beats attract. `scenes/credits.tsx` is its held,
silent scene on the TV and the walls (no speech, no sfx, no face mood):

- **Fetch.** `credits-fetch.ts` asks `GET /e/<id>/api/credits` with
  `x-loom-token` once per slide (`creditsKey(announceEpoch, seq)`; a G12
  re-roll is a new seq). The scenes get the base and token from
  `access-bus.ts`, which `app.tsx` sets while rendering from its config. A
  404 is final; an error shows the fallback and is asked again
  (`CREDITS_RETRY_MS` 5 s, `CREDITS_TRIES` 4 in all). The page's one
  `creditsCache` holds the newest 4 rolls.
- **Roll.** `credits-roll.ts` `rollFrame(t, creditsRollMs(rows), contentPx,
  viewPx)`: the measured column (ResizeObserver, feature-detected) moves
  up at one speed from `ROLL_START` of the screen until every row is gone,
  from the slide's `at` on the server clock (a reload lands mid-roll);
  then the end card (`endCard`: the title + `end` lines) fades in and holds
  for the rest of the slide. The TV: a slow starfield, part beside name. A
  wall: plainer and bigger, part above name.
- **Reduce Motion** pages through (`creditsPages` by `PAGE_METRICS` row
  weights, `pageFrame`: equal shares of the roll, cross-faded).
- **Fallback.** 404 / no answer: the end card only, from
  `CREDITS_FALLBACK_TITLE` / `CREDITS_FALLBACK_END` (*Thank you for
  playing.*, `DRAFT w44`). A failed cutscene chunk shows `SLIDE_COPY.credits`.
- `?preview=credits[&programs=<n>][&credits=none]` draws it over
  `fake.ts` `fakeCredits` (made-up names; never the real crew's).

## The ceremony's reports (waves 45, 48, 48b)

G13 and G14 are asides between awards, each a held scene listed in
`scenes/act3.tsx` ahead of the `award_*` row so it wins its slide:
`award_bathroom` (`BathroomScene`, `night.bathroom`; one confetti burst,
never over the numbers) and `award_language` (`scenes/language.tsx`
`LanguageScene`, `night.language` via `languageOf`). A block rides the night
only while its slide is up; without one the slide shows its title and line.
`?preview=bathroom[&bath=one|nobody|none]`.

**The Language Report is a containment breach (wave 48b,
`docs/loom-w48-contract.md` C12, C14).** `languageOf` reads up to 400
censored words, most censored first, each with its count (`counts`; 1 each
from a wave 48 server), `more`, `unsaid` (slurs: a count, never a word),
`level` and `stars` (null from a wave 48 server). The timeline is
`kit/lang-breach.ts`, pure: after the award's intro a DOS window
(`C:\FILTER> type censored.log`) prints every line (`breachLines`: each word
with its ×n, a **redaction bar** for each unsaid word, which has no text
field at all, then "+ n more"), faster and faster (`lineAt`): first line to
last ≤ 20 s for 1 to 400 lines (`breachSpan`), inside a stage of at least
6 s. At the leak the buffer overflows: the window strains (`windowShake`)
and turns red, and the words burst out (`breachSchedule`) to a heap packed
from the floor up round the window (`packTide`: the largest font that fits,
the most censored biggest, a short night's heap under the window, 400
lines up to the top). Deadpan notes pop up and are OK'd away
(`BREACH_NOTES`, `noteLife`); an eye opens in the log (`eyeOpen`,
`eyeLook`: its iris rings of the most censored words, bars when only slurs
were censored); then *Abort, Retry, Censor?*, ✂ Censor sinks, scissors
cross the screen (`scissorsX` / `cutAt`: the heap splits and falls away
behind them) and the window switches off like a CRT (`windowOff`). The
summary holds: who cursed the most, *c of f censored*, the filter's strength
(`levelCaption`), the Password Manager's ⭐, the closed log (lines, the most
censored word, ✂ CONTAINED); no confetti. Nobody flagged: one line. Flagged,
none censored: the summary and its line, no breach. Copy `LANG_COPY`,
`DRAFT w48b`.

- **The TV** draws the heap on one canvas (`BreachTide`): the words at rest
  go once onto an offscreen layer as they land, so each frame is one
  `drawImage` plus the words in flight (`flightAt`) and four tentacles of
  words (`drawTentacles`); the log's canvas holds the eye. The heap breathes
  and the window bulges.
- **A wall** draws each word once, straight onto the canvas, where it lands
  (no flights, tentacles, scaling or filters), redraws its log and eye at
  10 fps, and shows three notes.
- **Reduced motion**: no shake, flight, spin, look or sweep; the heap fills
  in place in 250 ms steps, two notes, everything fades at the snap.
- Nothing blinks faster than 1 Hz (the cursor 530 ms, the OVERFLOW 500 ms
  half-periods; reduced: steady); no full-screen flash.
- `kit/lang-breach-draw.ts` draws over a plain 2D context, so
  `test/lang-breach.test.ts` records it: every word reaches `fillText`, a
  bar never does.
- `?preview=language&lang=none|kept|one|dozen|unsaid|bars|hundreds|max|tie|w48|old`
  (`fake.ts` `fakeLanguage`; the default is a 120-word night); `&t=` freezes
  a frame, `&play=1` runs it.

## Clippy's dream (wave 50, `docs/loom-w50-contract.md`)

From the moment Trabolta names the Y2K bug (`ScreenState.dream {at}`, known
ahead of time, so every screen goes at one server instant) the dream replaces
the idle show on every screen, each terminal at its own place in the hour
(`@loom/house` `dreamPositionS`, keyed on `dreamKeyOf`: the spot the server's
feed to the games uses too). `screenLayers` carries `dream` (`off` · `armed` ·
`take` · `through`; `dreamReady` from the player); a terminal with no picture
stays `armed`, on its old idle show.

- **Where it plays.** `IdleShow` renders `DreamView` over itself and stops, so
  the scan box, the tent's card and a line keep their places. `Tv.tsx`, chess
  and casino (idle half only) mount their own. `coverOf` lets the y2k slide
  through; `Y2kTv` / `Y2kWall` draw transparent with `dreamThrough`, and
  `data-dream-clock` on the body takes the stage out of the taps' way.
- **The player** is a module singleton in the base bundle (never a lazy chunk:
  it starts hours after boot), armed by `useDreamArm`, handed between views by
  `hold` and kept playing for the mosh by `keep`. It pauses after 20 s with no
  view. Health is the pure `dreamHealthAfter`: video → frames → failed.
- **The mosh** (`Mosh`, `LiveScreenLayer`) mounts only while `moshMode` says
  something is getting through: an overlay, a moment, a slide but `y2k`, the
  glitch, a burst, the banner (`announcing`), his face after `DREAM_HOLD_MS`.
  Never a blackout; never on a screen in use (`bare`) but for an overlay.
- **His word.** `Tv.tsx` calls `RoomSpeech.namedBug` when a chunk matches
  `DREAM_BUG_LINE`: `bug=1` on an immediate poll, carried 4 s. If the beat's
  sentence changes, change the regex (`core/test/w50-dream.test.ts` pins it).
- `?preview=dream&what=banner|slide|take|plain[&target=tv][&key=<spot>]` on the
  real media. `test/dream.test.ts`, `test/dream-mosh.test.ts`.

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
- **A throwing engine (wave 28).** A chunk whose `play()` throws counts
  as said, and `SpeechQueue` always clears `running`: one bad chunk never
  silences the page (it once held every heart menu on LISTENING until the
  20 s cap). `BrowserEngine` leaves out a voice the utterance refuses.
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
  sentence count, so a story edit that changes one fails there. Wave 32:
  a sentence's place across all his lines in the scene reaches the scene
  as `SceneVoice.mark` (`CutsceneLayer` `sceneVoiceOf`), and a scene may
  give each spoken line its own marks (`byLine`, so a short name merged
  into the next sentence never steals a mark).
- **The introduction (wave 58).** *Trabolta Introduction* is the first 5
  sentences of his speech: `INTRO_LINE` plus `INTRO_MORE` (word for word,
  pinned against the beat), captioned by `lineCaptions` (a sentence gap
  inside a line, `LINE_GAP_MS` between lines). The picture's beats wait
  for the sentences in `INTRO_SAYS` (`captionWith` throws at import if a
  word goes, so change them with the beat): *Happy Halloween, programs.*
  types big, the setup, TRABOLTA and ALL SYSTEMS ONLINE run under his long
  sentence, and it hands back to the live face. `INTRO_MS` is computed from
  them (≈ 34 s; up to ≈ 54 s with the voice's stretch). *Trabolta Greeting*,
  the questions and his sign-off run after it under the plain face with
  `.tv-caption`, on no scene's clock: that is deliberate, so about three
  minutes of speech never holds a scene up. He plays it clean: nothing
  stalls or tears. The TV says his lines back to back: it does not wait for
  Clippy's. The `bingo_time` slide can still be up under it: the beat's
  `cue tv_mirror` clears it. *Bottle Landed* adds `BOTTLE_HUNGER`
  (`kit/tv1-time.ts`, two marks).
- **The full truth (wave 58, [`docs/loom-w58-contract.md`](../docs/loom-w58-contract.md)
  C2).** `CLEAN_BEATS` holds *Heart Heard*, *Advice Helped* and *The Full Truth*.
  `speech/split.ts` no longer cuts a sentence at *Jr.* or *Sr.*. `TRUTH_TXT` is a
  short teaser, the same words as the story's. The `recount` scene (`act2.tsx`) is
  what is left of him while Task Manager reads: it holds until the ceremony, its
  errors stop after the first half minute so nothing sounds under the reading, and
  there is no ride any more. The award slide's title steps down for a long tie
  (`most_correct` names everyone tied).
- **The mirror before him (wave 58).** The TV keeps the screensaver until
  he is revealed, but Clippy's *"We can follow their progress!"* comes
  first: on the host's 📺 (`Night.screen` "mirror") `tv.ts` `mirrorBeforeHim`
  lets a linked walker through attract, full screen and with no face
  (`.mirror-first`), only while he is hidden.
- **`sp=`.** The TV also reports `sp=<seq>:<chunk>` / `sp=<seq>:d`; the
  server keeps it as `tvSpeech`. The walls don't follow it yet: they keep
  the server clock.

### His voice comes apart (wave 56, `docs/loom-w56-contract.md`)

The server's `voiceFx` (`screen.ts` `voiceFxOf`) says how broken he is; a queue
that speaks him (the TV's, the room terminal's) has a shaper (`voiceShaper`) that
turns each sentence into a plan as it starts, so a spike reaches the next
sentence. `breakChunk` is pure and seeded. Nine flavours, each a function of the
window's words.

- **Only his own words**, or their letters: no glitch can say anything new. The
  written text is never touched, so captions, `moodOfText` and `DREAM_BUG_LINE`
  read as ever. Announcements and TEST VOICE have no shaper.
- **One sentence stays one chunk.** A plan plays inside one `engine.play`
  (`BrowserEngine.playPlan`), so `chunk`, `done`, `said=` and the voice clock see
  the same sentences, only longer. A plain sentence takes the old path untouched.
- **`pace` is whole SAPI steps, never a multiplier** (`paceRate`). Chrome on
  Windows truncates `10 · log10(rate)`, so a gentle rate is no change at all on
  the TV, and its 0.92 sounds like 1. Pitch moves in tenths.
- **`cutMs` is a real cut-off**: `cancel()`, counted from the fragment's start,
  then `CANCEL_SETTLE_MS` before the next `speak()`. Only the first fragment can
  write the engine off; a later one gets `FRAG_START_MS` and is skipped.
- `isCleanBeat`: `CLEAN_BEATS` are never broken (`Utterance.clean`).
- Fully Kiosk gets `flatText` (no pace, pitch or voice per call), the server voice
  and silent the sentence as it stands (`withPlan`).
- `voiceNoise` (`sound/bus.ts`) plays on the master bus: it is his voice, not an
  effect, so it reaches the house from the TV, where effects are silent.
- The house speakers get far more than this: the router tears up the sound itself
  (`stagehand/audio/voicefx.py`). The server room has only the plan.

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
mic= voices= door= keys= bay= pause= webcam= pad= whisper= crt=` (`UrlHints`). A new key needs three edits in
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
- ⚙ reads in the panel's own names (`SOURCE_JACKS`, `INPUT_JACKS`): the panel
  has 8 live jacks of 16, and `V<k>` / `D<i>` stay the wire's. Keep the table in
  step with the firmware's `config.h` (`core/test/trapped-w22-patchbay.test.ts`).
- The bridge never knows the combinations. **Never put combination
  strings, the door code or other live codes in code, tests or docs.**
- The parser is tested line for line against the firmware's
  `hardware/server-room-m4/test/fixtures/lines.jsonl` and the terminal's
  own `test/fixtures/door-lines.jsonl`. A protocol change touches the
  firmware, both fixtures, `door-protocol.ts` and its test together.

## No mouse or keyboard (wave 52)

The server room runs on a USB webcam, a GameCube controller (Mayflash adapter
in PC mode), whisper.cpp on the laptop and an old 4:3 CRT:
`&webcam=C310&pad=1&whisper=1&crt=1`.
Keep `keys` true: it means the program can answer freely, and `false` ends
the line at *not yet* and *leave*.

- **The controller walks the DOM.** `PadNav` lights `[data-pad]` elements in
  page order, and A clicks the lit one, so a new button joins by taking the
  attribute. `data-pad-aside` is reachable but never lit by itself (the file
  strip). A clicks `[data-pad-skip]` first (his voice). B clicks the first
  `[data-pad-back]`, and only B goes back: the ⟦BACK⟧ bar is deliberately not
  `data-pad`. Y clicks `[data-pad-y]`, a held Start `[data-pad-hold]`. Something
  that wants the raw controller (the keyboard) takes it with `grabPad`.
  DISCONNECT and ⚙ stay out of it: there's no way out of the terminal from the
  controller.
- **The adapter's map is measured, not standard** (`mapping` is empty): `GC`
  in `pad.ts`, from a real controller, 2026-10-30. Chrome shows four pads,
  one per port, so `frameOf` merges them.
- **Thread.** `Thread` stands on the newest line (`pin`), through a new line,
  a reveal or a menu docking under it (the ResizeObserver). On a touch screen
  only someone scrolling up stops it (`followAfter`); a render landing before
  the scroll event must not undo that (`look`). The CRT can't scroll at all.
- **Spoken answers.** `VoiceComposer` replaces `Composer`. Each listen has a
  `turn`, and B moves it on, so a late transcript is dropped. Whisper stays on
  127.0.0.1: an https page may fetch it once the site has Chrome's device-
  access grant, and CORS is whisper-server's own `*`. The server's
  `TERMINAL_CSP` adds that one origin to `connect-src` (`WHISPER_ORIGIN`,
  pinned to `WHISPER_URL` by `test/w52-rig.test.ts`). Vite sends no CSP, so a
  local test can't show this: check a change here on a served build. A local
  origin can't show the device grant either: Chrome asks only a public page
  (`scripts/server-room/start-terminal.ps1 -Setup`).
- **Local tests.** Vite against a scratch server, `door=sim`:
  `LOOM_SERVER=http://127.0.0.1:7391 pnpm --filter loom-terminal dev`. Vite's
  watcher misses rapid writes in the OneDrive folder on Steph's laptop: if a
  change doesn't show, restart it. A hidden browser pane runs no
  `requestAnimationFrame`, so `PadNav` stops there.
- **The CRT (`crt`).** Laid out in the stage's own 640 × 480 pixels, never `vw`
  or `vh` (`CrtStage` stretches the stage, so those would count twice). No
  line under 3 px, no glow, no dim text, 26 px at the smallest, nothing outside
  the 7% margin. `Terminal` renders its own tree and swaps `Face` for `Wave`;
  all the session logic above it is shared. `plainLayers` keeps the glitch,
  burst, flicker and dream off it, `cutscenes` is off (`cards.ts` instead) and
  effects are at volume 0. `hold` keeps the answers away while he speaks
  (`panelGate`), and `busy` does the same for the spoken composer, so nothing
  cuts him off. `Typed` types his lines to the end of the sentence he's on.
  Door shut: the pipes, the scanner hidden behind them. Door open, or any
  controller press: `promptUp`, the camera shown (`.crt-scan.shown`), until a
  minute after it shuts. The story asks the first guest; `speaksPrompt` asks
  the rest, in the story's words (`PASS_LINE`).

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
  `VoiceFloor`. **The TV's effects are silent** since wave 38
  (`sound/bus.ts` `VIEW_VOLUME.tv = 0`): Chrome's sound on the Desktop is
  cabled into the 828x as Trabolta's channel, which the router plays on
  every house speaker and ducks the music under, so a TV accent would
  play house-wide and duck the music like his voice.
- **Fiction safety.** Nothing names the character before the
  introduction (idle-show copy, scenes with `namesCharacter`). Casino bets
  are never retried. Chess results are retried and kept for 60 s across a
  reload. The TV and mirrors never peek under a slide.
- **Locked passes (wave 26, R1).** A room terminal (the server room) asks
  the server whether a pass is locked before it pilots (`passLocked`, 3 s
  timeout, then it opens as before). A locked pass gets
  `LOCKED_PASS_NOTICE` and no line; the story guards `terminal_opened`
  too. Other walls open the line and the server refuses every post.
- **Signed-off copy.** Wave 26's show copy (G1: the filing steps, the
  reminders, Truth Pong, the summons, the chess stakes line *Checkmate
  him.*; D1: `dare_chosen` on the `Dare Chosen` beat, `DARE_ORDER`;
  `LOCKED_PASS_NOTICE`) is in the show's `SIGNOFF-w26.md`, signed off on
  2026-10-27; its comments keep a `// w26 (<note>)` tag. New copy awaiting
  sign-off carries `// DRAFT w<N>` (wave 29's heart card and G11 line:
  `SIGNOFF-w29.md`).
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
  history is in (2.5 s fallback, `pinFloor`), never in `connect()`. Since
  wave 28 a pin floors at `Pilot.seq` (the newest chat seq the server
  answered `/api/mod/impersonate` with), so a late history on slow wifi
  still shows only this visit; an older server (no `seq`) pins at -1.
  Gap 2b: the server also answers `visitSeq` (`Pilot.visitSeq`), the
  floor it keeps per guest + terminal label (`core/server/terminal-visits.ts`);
  a re-scan within 3 min of a pagehide end (`endPilot` with `keepalive`
  sends `resumable: true`: a reload mid-visit) carries the first scan's
  floor; a leash end (thrown out, timed out, done, left) forgets the visit,
  so the next scan floors fresh, and `floorAfter` uses it whenever it is
  sent, so a reloaded heart terminal shows the whole visit (his lines and
  the picks) and nothing older. Nor a late answer to a phone DM sent before
  the scan: a line whose `answers` (the guest line an agent reply, hold or
  busy line answers, core `answeredSeq`) is at or below the floor is left
  out of `visitLines` and never said here (`answersBeforeVisit`,
  `session.beforeVisit`); it still lands on the phone. Each thread line
  carries `data-seq` (the heart spec checks it against `/api/history`).
- **Picks are server lines (wave 28).** A pick at the choice panel comes
  back on the stream as the program's own `pick: true` line (`act: true`
  for a deed) in `dm:<character>`, before his reply; the phone shows the
  same line, and a reload keeps it (`chat.tsx` `lineClass` draws a pick
  as YOU with the `echo` / `act` style). Until the server's line is back
  (slow wifi) the pick shows as a pending YOU row, dimmed (`pending`,
  `heart/pending-pick.ts`: `pendingPickOf`, `unansweredPicks`,
  `withPendingPicks`, play's `withEchoes` shape); the server's matching
  pick line (same room, same words, past the pick) replaces it, never
  doubled, and a failed pick drops it. A pick never counts as the program
  typing (`typedAfter`).
- **Room scene stages.** A room scene's stage carries `cutscene-room`
  (`cutscene-${kind}`); the wrapper's `display: contents` rule is
  `.cutscene-top.cutscene-room` so the stage keeps its box. A side scene
  (the question card, proof, warning) draws over the face pane only.
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
