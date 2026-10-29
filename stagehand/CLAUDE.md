# stagehand — notes for agents

`loom-stagehand` is the Python live-event bridge between the `@loom/core`
event server and the house: lights, speakers, sensors, and the
language-model voice of `mind: external` characters (Trabolta). One
daemon, one YAML per machine; each top-level section of the YAML is a
**module**. Python 3.11+, managed by **uv**, MIT, not in the pnpm
workspace. The human guide is [`README.md`](./README.md); the agent
module's reference is [`docs/agents.md`](./docs/agents.md).

The Prism monorepo's parent `CLAUDE.md` (the `prism` CLI, cargo, Slint)
does not apply here.

## Modules

| Section | Package | What it is | Show machine |
|---|---|---|---|
| `show:` | `show/` | the mod feed's `sim` directives → MQTT / OSC (`cuemap.py`); MQTT topics → `/api/mod/signal` / `beat` / `set` (`sensormap.py`); the lights catch-up | John's Desktop (Windows) |
| `agents:` | `agents/` | the agent worker: holds `GET /api/agent/stream`, answers requests, judges filings, records thoughts, takes `control` frames | John's MacBook |
| `audio:` | `audio/` | the speaker router: `audio.json` on one `sounddevice` stream (duplex: the TV's input routed, every input metered), numpy mixer with priority ducking (the inputs' sidechains, announcements, takeover tracks) and per-output trims, the soundtrack (music beds per scene, `soundtrack.py`), streamed long files, announcements, tests, stops, the house desk's plays, the report, placeholders, the synthesized SFX library (`audio/sfx/`) | John's Desktop (since 2026-10-27); the MacBook is the fallback (output-only) |
| `lights:` | `lights/` | `lights.json` looks (every bulb by name, the WLED strip, every `lights_*` / `heart_*` look; no Zigbee groups, scenes or WLED presets) → Zigbee2MQTT / WLED, safety clamp, identify / test / pair, device list, catch-up (the heart look and `night.lights`), presence pulses for the reinstallation games and the `shown` report (wave 39) | the Desktop |
| `alexa:` | `alexa/` | the standalone announcement player. **Retired for the show** (wave 18b); the code and its `Announcer` stay (the router reuses the announcer and the voice lock) | none |

A module is registered in `module.py::REGISTRY` as a `ModuleSpec(summary,
"package.module:build_x")`. The factory `build(section, base_dir)` parses
and validates its section at load (a bad map fails at boot, never
mid-show) and returns an object with `name`, `describe()` (for `check`) and
`async run(ctx)`. The entry is a string so a machine running only `agents`
never imports paho-mqtt or sounddevice. `app.py` runs every module on one
shared `ModClient` and restarts a crashed one after a pause. Adding a job
is a subpackage plus one registry line.

## Layout

```
stagehand/
  pyproject.toml, uv.lock          the package (`stagehand` console script)
  *.example.yaml                   one commented section each; test-pinned
  trapped.house.yaml               the show's shared base (every show rule, the router's settings)
  trapped.desktop.yaml             extends it: show + lights + audio on John's Desktop (Windows)
  trapped.macbook.yaml             extends it: the audio router fallback on John's MacBook
  laptop.yaml                      git-ignored: the MacBook's agents config (from agents.example.yaml)
  *.local.yaml                     git-ignored: per-machine secrets / overrides
  media/sounds.yaml                tracked list of the 19 story sounds (`library:` names a story sound's
                                   SFX stand-in); media/sounds/ is git-ignored
  media/soundtrack.yaml            tracked: the soundtrack's playlists, scenes and takeover tracks (wave 38)
  media/music/<act>/               git-ignored: the MP3s, one folder per playlist (doors, act-1, …)
  media/library/<category>/        git-ignored: the rendered SFX library (`stagehand sounds library`)
  docs/agents.md                   the agents reference
  src/stagehand/
    cli.py                         the `stagehand` command (argparse; one function per subcommand)
    config.py                      load_config: extends:, .local.yaml overlays, env, CHANGE-ME placeholders
    module.py, app.py              the registry and the supervisor
    modapi.py, sse.py              the server link: login, POSTs, SSE streams
    conditions.py, templating.py   the `when:` mini-language and payload templates
    launchd.py, tasks.py           macOS LaunchAgents / Windows Task Scheduler, one job per module
    localvoice.py                  the machine's voice: macOS `say` or Windows SAPI (PowerShell 5.1);
                                   `pronounce()` over pronounce.json ("Antivirus" is said "Anti Virus")
    pronounce.json                 the shared pronunciation table (a copy of the terminal's, C10)
    paths.py                       per-user cache dirs (~/Library/Caches/…, %LOCALAPPDATA%\stagehand\…)
    show/                          cuemap, sensormap, mqtt, osc, topics, directives
    agents/                        module (the worker loop), persona, prompt (classic), voice (lean),
                                   story_mind, mind, orchestrator, guards, secrets, judge, trace,
                                   wire, reply, llm, facts, cards
    audio/                         module, config, engine (the stream), mixer, routing, sounds, placeholders;
                                   stream (a file decoded + resampled by a worker into a ring buffer),
                                   soundtrack (playlists, scenes, beds, the `Director`), mp3len (VBR MP3s
                                   with no length header, for `check`), mix (wave 40: the house
                                   mix's levels → the mixer's gain table, effectiveDb's mirror)
    audio/sfx/                     the SFX library: dsp (synthesis toolkit), spec + registry (`SFX`), render,
                                   cli, inspect (PNGs), one module per category (sirens, dings, telephony,
                                   digital, retro, party, story, ambient)
    lights/                        module, config, plan (planLook mirror), routing, z2m
    alexa/                         module, config, player (retired)
    replay/                        the K-04 replay harness (`python -m stagehand.replay`)
  tests/                           pytest; fixtures/ holds copied house-package fixtures + the classic snapshot
```

## Commands

```bash
cd stagehand
uv sync                                            # once; makes .venv
uv run pytest                                      # 2301 passed + 4 skipped, ~75 s, no hardware, no network
uv run pytest tests/test_trapped_house.py -q       # after any story or rig change
uv run stagehand modules
uv run stagehand check --config trapped.desktop.yaml --only show,lights,audio
uv run stagehand check --config trapped.macbook.yaml --only audio   # the router fallback
uv run stagehand sounds library [--list] [--only a,b] [--out DIR] [--story] --config trapped.desktop.yaml
                                                   # render the SFX library; --story also fills sounds_dir
uv run stagehand music scene <name> | next [--playlist X] | stop | status --config trapped.desktop.yaml
uv run --with matplotlib python -m stagehand.audio.sfx.inspect --only a,b --out DIR   # look at sounds
uv run stagehand check --config laptop.yaml        # prints mind mode, switches, context sizes
uv run stagehand ask --config laptop.yaml [--reflect] "text"   # a persona with no server
uv run stagehand launchd print --job agents --config laptop.yaml   # the plist only
uv run stagehand tasks print --job show --config trapped.desktop.yaml   # the task XML only
uv run python -m stagehand.replay score <run dir>  # see docs/agents.md before a live run
```

There is no lint or type-check step in this package; keep the code style
of the file you are in (dataclasses, `from __future__ import annotations`,
module docstrings that explain the why).

## Machines and their configs

| Machine | Jobs | Config | Supervisor | Runbook |
|---|---|---|---|---|
| John's MacBook (macOS, M3 Max 48 GB) | `agents` + Ollama `gpt-oss:20b`; `audio` only as the fallback | `laptop.yaml`; `trapped.macbook.yaml` | `stagehand launchd` | `scripts/house-macbook/trabolta.md`; `audio.md` (fallback) |
| John's Desktop (Windows) | `show`, `lights`, `audio` + the MOTU 828x, no ADAT expander (the living room on Main L/R + the sub on Analog Out 1; Chrome's sound, the TV's Trabolta, cabled into input 3) (+ Mosquitto, Zigbee2MQTT with Hue / ZL1 bulbs, the WLED controller, the TV kiosk) | `trapped.desktop.yaml` | `stagehand tasks` | `scripts/house-desktop/README.md` |

- **`extends:`** (`config.py`): a file in the same folder; mappings merge
  key by key, anything else replaces, `null` deletes. Order: parent,
  parent's `.local.yaml`, child, child's `.local.yaml`, then
  `LOOM_SERVER_URL` / `LOOM_EVENT_ID` / `LOOM_MOD_PASSCODE` /
  `LOOM_MOD_TOKEN`.
- **A `.local.yaml`** must hold a `server:` mapping and may hold only a
  module's `mqtt:` and audio's `device` / `host_api` / `voice_engine` /
  `say_voice`. It never switches a module on.
- **The broker** is on the Desktop (`192.168.8.10`): anonymous on
  `127.0.0.1:1883` for the Desktop's own jobs and Zigbee2MQTT,
  password-only `:1884` (user `props`) for the WLED controllers and the
  MacBook's router in the fallback.
- **Announcements**: server feed → the Desktop's `show` → `show/announce`
  → the router (the Desktop's; the MacBook's over `:1884` in the
  fallback). Story sounds go server feed → router directly.
- **The router's server wire** (`audio/module.py`; the house desk
  contract `../docs/loom-house-desk.md` §4). It reads `GET
  /api/mod/audio?router=1&name=&after=&tests=&stops=&plays=&wait=`
  (audio.json, tests, stops, plays, `now`); each list's first answer only
  primes its cursor, and a stop or play more than 10 s old by `now` is
  dropped. A play is `{seq, at, by, sound | say, to, gain, chime?}`. It
  reports `POST /api/mod/audio/report` with `{acks: [{seq, kind: play |
  test, result, ms?}]}` as soon as a play or a server test is handled
  (`ms`: the file's length; chime + speech; tone + label), and `{health:
  {ok, device, layout, voices, xruns, peakDb, announce, missing,
  placeholders, sounds: {name: ms}, inputs: {"<ch>": dBFS}, sources:
  {name: 0..1}, underruns, music?: {scene, beds: [{playlist, speakers,
  track, posS}], missing}}}` every `health_s` (first after ≤ 5 s; wave 38
  added the last four, camelCase like `peakDb`; no `music` without a
  soundtrack). A 404 (an older server) is logged once and ignored. The
  soundtrack's catch-up reads `GET /api/screen/state` → `night.music`.
  **The house mixer** (wave 40, `../docs/loom-w40-contract.md` C3): the
  GET answer also carries `mix {seq, levels}`, `music` (the mixer's
  commands `{seq, at, by, action: next | scene | stop | story, playlist?,
  scene?}`) and `mixWatch`; the poll passes `mix=<seq>` (once one is
  known), `music=<seq>` (primed by the first answer, like `plays=`) and
  `watch=0|1` (what the router believes; the server answers when it
  differs). A mix whose seq moved is applied (`mix.mix_gains` →
  `Mixer.set_mix`, ramped over `TRIM_S`) and cached as `cache_dir/mix.json`;
  music commands older than 10 s by `now` are dropped, the rest act in
  press order with the stops and plays (`next` → `Director.next(playlist)`,
  `scene` / `stop` → `music_scene(…, hand=True)`, `story` → the hand let
  go and the catch-up now). While `mixWatch` (or the last meters answer's
  `watch`) is true it posts `POST /api/mod/audio/meters {outputs, inputs,
  sources, buses, music}` every 0.25 s (dBFS, 1-based channel strings;
  `buses` = each strip → output → its peak before the limiter; `music` =
  the health's, camelCased, at most once a second); `watch: false` stops
  it, a 404 stops it for good. The health's `music` gains `scenes`,
  `hand`, `playlists [{name, tracks, loop}]` and each bed's `durS`; the
  MQTT stats gain `mix` (for `stagehand music status`), the report does
  not. Tests: `tests/test_audio_desk.py`, `tests/test_audio_router.py`,
  `tests/test_audio_mix.py`, `tests/test_audio_mixer_wire.py`.
- **The server room** is not stagehand's: the Grand Central M4 on Steph's
  laptop reads the door and the patch bay, and the terminal page posts
  `door_sensor_*` and `patch_changed {combo}` (wave 22,
  `hardware/server-room-m4/`). The ESP32 rules in `trapped.house.yaml`
  are for a box that is not installed.

## Conventions

- **Tests use fakes, never the real thing.** `launchd.py` and `tasks.py`
  take the command runner and directories as arguments; the router runs
  over a fake `sounddevice` stream and a fake server; `localvoice.py`'s
  subprocess calls are injectable; the agents loop runs against a fake
  server and a mock model transport. Keep new code injectable the same way.
- **Mirrors of TypeScript are pinned by copied fixtures.**
  `audio/routing.py` mirrors `@loom/house` `resolveTargets` and
  `lights/plan.py` / `routing.py` / `z2m.py` mirror `planLook`,
  `clampForSafety`, the payload builders and (wave 39) `presenceSettings`
  / `presenceFixtures` / `mergeLightState` (`lights-presence.json`). Their fixtures are copied byte
  for byte from `house/test/fixtures/` into `tests/fixtures/house-audio/`
  and `house-lights/`, and a test fails until you re-copy after a house
  change. `audio/mix.py` mirrors `core/src/house-mixer.ts` `effectiveDb`
  (wave 40): `tests/fixtures/house-mixer.json` is a byte-for-byte copy of
  `core/test/fixtures/house-mixer.json`.
- **One pronunciation table, three copies** (wave 26, V3).
  `src/stagehand/pronounce.json` is byte for byte
  `terminal/src/speech/pronounce.json` (and `reinstall/vr/config/`),
  pinned by `tests/test_pronounce.py` and the terminal's
  `lexicon.test.ts`; edit all three together. `localvoice.pronounce()`
  wraps `renderer()` / `speaker()` / `render_voice` / `speak_voice` (the
  wrapper's `__wrapped__` is the engine's own function), so the router's
  announcements, desk `say` steps and Alexa's `say` engine say it; Alexa's
  `engine: server` `Announcer` pronounces before the `/api/mod/tts` fetch,
  before its `say` fallbacks, and in its disk / prewarm cache key. Logs keep
  the written text.
- **The rig is pinned to the story.** `tests/test_trapped_house.py` reads
  `main.loom`, `audio.json`, `media/sounds.yaml` and the codex: a new
  `cue lights_*` or `sound X` in the story needs a rule here, a new sensor
  signal needs a `when` in the story, and the safety edits (no lock, no
  darkened safety room, nothing to the server-room bulb) are asserted.
  `tests/test_machine_configs.py` pins the two machine files. Since wave
  38 the soundtrack is pinned too: every `cue music_*` and `Night.music`
  value is a `soundtrack.yaml` scene, every scene but `off` is cued by the
  story, and every `no_duck` sound is a `tracks:` entry.
- **The audio callback never waits** (wave 38, `audio/stream.py`). It
  never decodes, resamples or does file I/O, and holds a lock only for an
  index update or a buffer copy; a stream's worker thread does the rest.
  An underrun plays silence and counts. Keep new mixer work O(block) and
  allocation-light (the callback's budget is ~10 ms at 512 frames).
- **Long files stream, never cache.** Soundtrack beds and `tracks:` open
  as a `Stream` (`SoundBank.stream`); at most the current and next track
  of each bed are open; `_preload` skips tracks. Short story sounds stay
  decoded in memory.
- **The SFX library is original and deterministic** (C6): no samples,
  no trademarked motifs; each sound's seed comes from its name, so a
  re-render is byte-identical. One-shots are set by loudness (the loudest
  400 ms at −16 dBFS RMS, the peak capped at −1 dBFS by gain); loops sit
  near −18 dBFS RMS and are seamless. `--story` overwrites only a
  placeholder or an older `loom-sfx` file.
- **Windows must import.** `tests/test_windows_import.py` re-imports every
  module with no `fcntl` / `os.getuid` and a fake `msvcrt`. No POSIX-only
  name at import time; guard it (see `alexa/module.py`'s lock).
- **PowerShell is ASCII.** `scripts/house-desktop/*.ps1` are lint-checked
  without PowerShell by `tests/test_house_desktop_scripts.py`: ASCII only
  (5.1 reads a BOM-less file as ANSI), 5.1-only syntax, balanced
  delimiters, a help / param block, no secret.
- **YAML examples are test-pinned** (`test_config.py`, `test_launchd.py`,
  `test_audio_router.py`, `test_lights_example.py`, `test_orchestrator.py`).
  Edit their comments freely; a value change needs the test.
- **Stage requests** (wave 32, `docs/loom-w32-contract.md` C4/C7). During
  a talk scene the server sends a **public** request: `thread.public`,
  `speaker.stage`, `stage {room, scene, direction?}`, the room's own lines
  as history (scripted ones `story: true`). `prompt.is_stage` /
  `stage_of` recognise it. The lean voice (`voice.py`) gives it a person
  card that says Clippy is speaking aloud to the whole Desktop, the room's
  last `ROOM_LINES` (12) lines as context (`room_lines`, never dropped as
  story lines; hunt and never words filtered), only the live exchange as
  named turns (`history_turns`), and `stage.direction` as a must-follow
  steer (`stage_steer`, ≤ `MAX_STEER` 300 chars). The classic prompt
  (`voice.layout: classic`, `mind_mode: classic`) does the same through
  `voice.classic_stage_block`. The persona's `before the whole Desktop`
  block and one block per `Night.talk` hold (`speaker.stage == true`);
  `orchestrator.situation_chars` counts the stage-only blocks apart.
  **Priority lane:** `slots.py` `Slots` keeps one generation slot but
  serves waiters by lane: `module.lane_of` puts a stage request in
  `FIRST`, a guest at his heart (`them.at_the_heart`) in `HEART`, every
  other DM and ruling in `NORMAL`, and the quiet summaries and a
  director's re-run in `BACKGROUND`. A generation already running is
  never interrupted, so the longest a stage line waits is one generation.
  The server orders its own queue the same way (`AgentHubOptions.rank`)
  when a worker attaches or a stall clears. A stage exchange
  feeds no quiet summary. `_send` returns whether the server applied the
  reply: on a 410 (the scene closed) the worker skips the memo,
  `after_turn` and `remember_said`, so an unsaid line is never "already
  said". Tests: `tests/test_talk_back.py`.
- Docstrings cite "the wave 12 contract §Cn.m": that lane contract was
  never committed. `docs/agents.md` and the tests describe the behaviour.

## Gotchas

- **Never `pkill -f "stagehand run"`.** It kills every job on the machine,
  including the user's own Trabolta worker. Restart one job:
  `stagehand launchd restart --job X` (Mac) or `stagehand tasks restart
  --job X` (Windows). When testing, run your own worker on its own YAML
  and stop only the PID you started.
- **Always `--only` on a show machine.** The machine files inherit every
  section from the house file; a bare `run` starts jobs that belong to the
  other machine (cues twice, announcements twice).
- **Secrets never go in tracked files or docs**: the event id, the mod
  passcode, the `props` broker password, the door code, the patch-bay
  combinations, hunt answers, codex and digit-note codes. Note that
  `trapped.house.yaml`'s `sensors/patchbay/state` rules necessarily spell
  the combinations (the test cross-checks them against `Kernel.combo_*`);
  never copy them anywhere else.
- **`trabolta.mind.md` has a generated block** (`# <titi-facts:secrets>`)
  written by `pnpm --filter @loom/core titi:facts`; edit `facts.json`, not
  the block. The persona and mind files live in the show folder
  (`core/examples/trapped-in-the-internet/`) and are runtime input read by
  many tests here and in `core`.
- **Ollama + gpt-oss**: use `api: ollama` (native `/api/chat`) — the
  OpenAI-compatible shim ignores `think: false` and `keep_alive`; without
  `keep_alive` a quiet spell evicts the voice and the next guest waits
  ≈ 25 s for a reload. gpt-oss sometimes answers with `tool_calls` instead
  of JSON content; `llm.tool_calls_as_json` folds them back. Its reasoning
  tokens count against `max_tokens` (keep ≥ 1000). Set `num_ctx`
  (voice 32768, orchestrator 20480 are the defaults the loader applies):
  Ollama's own default can silently truncate. `stagehand check` estimates
  the late-night prompt and warns.
- **The replay harness and a live worker share Ollama.** Real-model runs
  take `<tmp>/loom-replay/ollama.lock` and wait for the house worker's
  trace to be quiet for 10 minutes. Never point a replay at the live event.
- **A scratch event server for live checks** needs a dead `DATABASE_URL`
  (an unset one means the `loom_dev` database) and `LOOM_DB_WAIT=off`.
- **The fiction boundary.** Trabolta lives in Halifax in the MapsAndDucks
  universe. He never knows the crew (John, Steph, Jesse, …), the party,
  the show or its kit. The persona's `outside:` list is withheld from his
  output like a `never` word; `stagehand check` warns when an `outside:`
  word appears in his own text. Never add a real-world reference to a
  persona, a phase card or a fallback.
- **An absent `mind_mode` is classic.** The show runs `mind_mode: new`;
  an older YAML silently keeps the two-model mind.
- **`check` exit codes matter to scripts**: `preflight.ps1`,
  `start-stagehand.ps1` and `scripts/accept/*.sh` read them.
- **The house mix is not the install trim** (wave 40). audio.json's
  speaker `gain` stays the trim (`set_trim`); the mix (`set_mix`) rides on
  top, per strip (`music`, `tracks` = a `soundtrack.yaml` `tracks:` entry,
  `sfx`, `announce` incl. the chime; `test` is never mixed) and per input
  (× its routes). A role muted at `master` or `src:in:<role>` ducks
  nothing; a room or speaker mute leaves the ducking alone. The mixer's
  `take_live` meters have their own accumulators: `take_meters` (the
  health line) is untouched, and the per-strip sums run only while
  `take_live` is called.
- **The soundtrack's scene has three owners** (wave 38). A live `cue
  music_<scene>` wins; a hand `stagehand music stop | scene` (MQTT) holds
  against feed catch-ups until the next live music cue or a story
  restart (so does the mixer's scene / stop, wave 40; its *Follow the
  story* lets go); else the catch-up (`night.music`). Stop house sounds forgets
  the scene: the beds stay silent until the next music cue or catch-up.
  An empty or dead playlist retries every 10 s (`RETRY_S`).
- **Three ranks of sound file.** `sounds._best` ranks a file someone put
  there (no tag) over a library stand-in (`loom-sfx v1`, `is_stand_in`)
  over a placeholder (`loom-placeholder v1`), then `EXTENSIONS` order, so
  a real `ad_jingle.mp3` beats the stand-in `ad_jingle.wav`. A stand-in
  is not a placeholder: `check` never lists it. `sounds.SFX_TAG` must
  equal `sfx/render.SFX_TAG` (`tests/test_audio_stand_in.py`).
- **The MacBook fallback is output-only** (`passthrough: false` in
  `trapped.macbook.yaml`): a launchd job gets no microphone, so the TV is
  not routed and nothing ducks under Trabolta or Clippy there.
- `stagehand check` with no `--only` on a YAML holding `audio:` imports
  sounddevice and probes the device; on a machine without the interface it
  fails by design.

## After a change

1. `uv run pytest` (the whole suite is fast).
2. A change to a persona, a mind file or the agents worker: on the MacBook
   `git pull`, `uv run stagehand launchd restart --job agents`, then Run →
   Mind → Reset.
3. A change to `trapped.house.yaml` or the show module: restart the
   Desktop's `show` job (`.\start-stagehand.ps1 -Restart show`).
4. A change to the router: restart `audio` where it runs.
5. Update `README.md` (people) or `docs/agents.md` (the agent reference)
   when behaviour a person relies on moves; the root `CLAUDE.md` row stays
   one paragraph.

## Pointers

- Show-control design and the house rig: `../docs/loom-show-control.md`
- Room audio design and history: `../docs/trapped/room-audio.md`
- Runbooks: `../scripts/house-desktop/README.md` (the Windows Desktop: the
  sound, the lights, the broker, the TV), `../scripts/house-macbook/`
  (`trabolta.md`; `audio.md`, the router fallback; lights, zigbee)
- The show's diagnostics (`pnpm showctl doctor | preflight …`):
  `../scripts/show/`
- Server side of each wire: `../core/server/agents.ts` (agent requests,
  judge, trace, control), `audio.ts`, `lights.ts`, `routes/screen.ts`,
  `event-runtime.ts` (the mod feed and mutations)
- The old README with per-wave notes: `../docs/history/stagehand-readme-2026-10.md`
