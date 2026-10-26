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
| `audio:` | `audio/` | the speaker router: `audio.json` on one `sounddevice` stream, numpy mixer, announcements, tests, stops, the house desk's plays, the report, placeholders | the MacBook by default; may move to the Desktop |
| `lights:` | `lights/` | `lights.json` looks → Zigbee2MQTT / WLED, safety clamp, identify / test / pair, device list, catch-up | the Desktop |
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
  trapped.desktop.yaml             extends it: show + lights on John's Desktop (Windows)
  trapped.macbook.yaml             extends it: the audio router on John's MacBook
  laptop.yaml                      git-ignored: the MacBook's agents config (from agents.example.yaml)
  *.local.yaml                     git-ignored: per-machine secrets / overrides
  media/sounds.yaml                tracked list of the 19 story sounds; media/sounds/ is git-ignored
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
    audio/                         module, config, engine (the stream), mixer, routing, sounds, placeholders
    lights/                        module, config, plan (planLook mirror), routing, z2m
    alexa/                         module, config, player (retired)
    replay/                        the K-04 replay harness (`python -m stagehand.replay`)
  tests/                           pytest; fixtures/ holds copied house-package fixtures + the classic snapshot
```

## Commands

```bash
cd stagehand
uv sync                                            # once; makes .venv
uv run pytest                                      # ≈ 1100 tests, ~40 s, no hardware, no network
uv run pytest tests/test_trapped_house.py -q       # after any story or rig change
uv run stagehand modules
uv run stagehand check --config trapped.desktop.yaml --only show,lights
uv run stagehand check --config trapped.macbook.yaml --only audio
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
| John's MacBook (macOS, M3 Max 48 GB) | `agents` + Ollama `gpt-oss:20b`; `audio` + the MOTU 828x + ADAT (default) | `laptop.yaml`; `trapped.macbook.yaml` | `stagehand launchd` | `scripts/house-macbook/audio.md` |
| John's Desktop (Windows) | `show`, `lights` (+ Mosquitto, Zigbee2MQTT, the TV kiosk); `audio` only if it moves | `trapped.desktop.yaml` | `stagehand tasks` | `scripts/house-desktop/README.md` |

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
  password-only `:1884` (user `props`) for the MacBook's router and the
  WLED controllers.
- **Announcements cross machines**: server feed → the Desktop's `show` →
  `show/announce` → the MacBook's router. Story sounds go server feed →
  router directly.
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
  placeholders, sounds: {name: ms}}}` every `health_s` (first after ≤ 5
  s). A 404 (an older server) is logged once and ignored. Tests:
  `tests/test_audio_desk.py`.
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
  `clampForSafety` and the payload builders. Their fixtures are copied byte
  for byte from `house/test/fixtures/` into `tests/fixtures/house-audio/`
  and `house-lights/`, and a test fails until you re-copy after a house
  change.
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
  `tests/test_machine_configs.py` pins the two machine files.
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
- Runbooks: `../scripts/house-macbook/` (audio, lights, zigbee),
  `../scripts/house-desktop/README.md` (the Windows Desktop)
- The show's diagnostics (`pnpm showctl doctor | preflight …`):
  `../scripts/show/`
- Server side of each wire: `../core/server/agents.ts` (agent requests,
  judge, trace, control), `audio.ts`, `lights.ts`, `routes/screen.ts`,
  `event-runtime.ts` (the mod feed and mutations)
- The old README with per-wave notes: `../docs/history/stagehand-readme-2026-10.md`
