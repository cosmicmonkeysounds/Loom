# Loom

Loom is a scripting language for interactive stories — and the
toolchain around it: a writer's IDE, a social-simulation engine, a
compiler that targets game engines, live-event infrastructure, and
show-control bridges for physical spaces.

One `.loom` project can be a branching game dialogue, a solo
interactive fiction, or a hundred-person immersive theater event with
phones in guests' hands and lights firing on cue.

```loom
# The Lighthouse
start: The Bell Tower at Dawn

CHARACTER Wren
  voice: female_alto

LOCATION Lighthouse

== The Bell Tower at Dawn
  cast: Wren
  setting: Lighthouse

A bell rope swings in the gloom.

Wren (quietly): It hasn't rung in three days.

if Wren.trusts.Player > 50:
  Wren: I knew you'd come.

* Ring the bell.
  -> The Ringing
* Leave quietly.[ but you wonder.]
  -> END

== The Ringing
  setting: Lighthouse

The bell rings out over the water.
```

Start with the writer's guide
([`docs/writing-in-loom.md`](./docs/writing-in-loom.md)) or the Loom 4
design ([`docs/loom-4.md`](./docs/loom-4.md)). The older v3 forms
(`WREN` cues, `<if: …>` directives) still parse. Every doc is listed in
[`docs/README.md`](./docs/README.md).

## Take what you need

This repo is a toolbox, not a framework — each piece works on its own.

| I want to… | Use | Needs |
|---|---|---|
| **Play Loom stories in my Godot game** | [`engines/godot`](./engines/godot) — copy `addons/loom/` into your project | Godot 4. Pure GDScript, no build step. Node.js only to compile banks |
| **Write and rehearse a story in a real IDE** | [`editor`](./editor) — Writing / Run / Integrations studio in the browser | Node.js + pnpm |
| **The IDE as a desktop app, wired into my game** | [`desktop`](./desktop) — the editor in a Tauri shell; links a Godot project Wwise-style (installs the addon, builds banks into it) | Node.js + pnpm + Rust |
| **Run a live event** (guests join by passcode on their phones) | [`core`](./core)'s event server + the [`play`](./play) participant app, plus [`terminal`](./terminal) for wall screens | Node.js; Postgres only for multi-author accounts |
| **Embed the engine in my own JS/TS app** | [`@loom/core`](./core) — parser, sim runtime, LSP surface, all TypeScript | Any TS toolchain (consumed as source) |
| **Compile stories for any game engine** | [`@loom/bank`](./bank) — `.loombank` instruction streams + generated ID headers (`.gd`/`.cs`/`.h`) | Node.js |
| **Fire lights, sound, and props from the story** | [`stagehand`](./stagehand) — the show-control bridge: MQTT cues and sensors, Zigbee / WLED lights, a multichannel speaker router, an LLM-voiced character worker | Python 3.11+ / uv (macOS and Windows) |
| **Hack on the language itself** | [`parser`](./parser), [`runtime`](./runtime), [`lsp`](./lsp), [`syntax`](./syntax) (Rust) or `core/src` (TypeScript) | Rust toolchain / Node.js |

The pieces compose through two stable seams: the **`.loom` text format**
(guide: [`docs/writing-in-loom.md`](./docs/writing-in-loom.md)) and the **`.loombank`
binary format** (spec: [`docs/loom-banks.md`](./docs/loom-banks.md), with
a normative reference interpreter and golden-trace conformance harness
in [`bank`](./bank)). Anything that speaks one of those can replace or
skip everything else.

## Quick starts

### Godot

```bash
# 1. Copy the addon into your project (no build, no GDExtension):
cp -r engines/godot/addons/loom  YOUR_PROJECT/addons/

# 2. Enable "Loom" in Project → Project Settings → Plugins.

# 3. Compile your .loom sources into a bank (one-time Node setup: pnpm install):
cd bank
npx tsx bin/loom-bank.ts build path/to/your/story -o YOUR_PROJECT/story --name main
```

Drop a `LoomStory` node in a scene, point it at `main.loombank`, and
connect signals — or use the zero-script `LoomDialogueBox`. Full tour:
[`engines/godot/README.md`](./engines/godot/README.md).

### The whole dev stack, one command

```bash
pnpm install
pnpm dev                          # builds play + terminal + reinstall, runs the
                                  # event server (:7000) + the editor (:5173)
pnpm dev --sync "My Project"      # …and pushes the example story into that
                                  # server project, reloading its event
```

`pnpm dev --no-build` skips the app builds, `--play` adds the play app's
own Vite (:5174, a second origin for a performer phone), `--reinstall` the
game's (:5176), `--only server`
runs just one piece. Ctrl+C stops everything (`scripts/dev.mjs`).

### The editor (author IDE)

```bash
pnpm install
pnpm --filter loom-app dev        # → http://localhost:5173
```

Three modes: **Writing** (`⌘1` — screenplay text + story-graph node
editor, editing either edits the same source), **Run** (`⌘2` — the control
room for the project's one run: an in-browser simulator for a local
folder, the project's shared event for a server project; launch, codes
and QR, go live, moderate), **Integrations** (`⌘3` — game-engine targets;
the Godot link needs the desktop app). Works against a local folder with
no account or server.

### A live event

```bash
pnpm install
pnpm --filter loom-play build      # participant app, served by the event server
pnpm --filter @loom/core serve     # → http://<lan-ip>:7000, guests join by passcode
```

The event server journals everything, so a crashed server rehydrates
mid-show. Postgres (`DATABASE_URL` + `pnpm --filter @loom/core migrate`)
adds author accounts and multi-project hosting; without it the event
plane still runs LAN-only. See [`docs/loom-deployment.md`](./docs/loom-deployment.md).

### Show control

```bash
cd stagehand
uv run stagehand modules                            # what each module does
uv run stagehand check --config show.example.yaml   # validate a config
uv run stagehand run   --config show.example.yaml   # run it against an event
```

One daemon, one YAML per machine; each top-level section turns on a
module (`show`, `lights`, `audio`, `agents`). `stagehand launchd …` runs a
module as a macOS job and `stagehand tasks …` as a Windows Task Scheduler
task. Docs: [`stagehand/README.md`](./stagehand/README.md),
[`docs/loom-show-control.md`](./docs/loom-show-control.md).

### The Rust crates

```bash
cargo build          # parser, runtime, lsp, syntax
cargo test
cargo build -p loom-runtime --bin loom-play   # terminal player CLI
```

The Rust engine is the original implementation; today the **TypeScript
engine in `core/` is the maintained, feature-complete one** (the Rust
mirror lags it badly). `loom-lsp` is a
stdio LSP server for Zed/VSCode; `syntax` generates the TextMate
grammar. The `server/` crate (legacy multi-user relay) builds only
inside the parent Prism monorepo and is excluded from this workspace.

## Trapped in the Internet

Loom's first big production is *Trapped in the Internet*, a party show on
2026-10-31: guests become programs uploaded into a house-sized computer by
Trabolta, a rogue AI voiced live by a local language model. It uses most
of this repo at once: the event server on a VPS, the play app on every
phone, wall terminals and a TV, the reinstallation games (a web game and a
Quest 3), an Adafruit Grand Central M4 for the server-room door and patch bay,
and stagehand driving the house speakers and lights.

Its files live in
[`core/examples/trapped-in-the-internet/`](./core/examples/trapped-in-the-internet/)
(start at `INDEX.md`; the crew's show book is `SHOW.html`).
`pnpm showctl doctor` checks a running show
([`scripts/show/README.md`](./scripts/show/README.md)).

## Layout

| Directory | What it is |
|---|---|
| `core/` | **TypeScript engine + event server** — parser, social-ecosystem sim, LSP surface, SSE/REST live-event backend with chat, access control, and a SaaS control plane |
| `bank/` | Bank compiler + **normative reference interpreter** — the conformance target for every engine runtime |
| `editor/` | React IDE (Writing / Run / Integrations) |
| `desktop/` | Tauri desktop shell for the IDE + Wwise-style Godot integration |
| `play/` | Participant app guests and performers use at events |
| `terminal/` | Wall terminals, the TV, the server-room, chess, casino and tent screens |
| `house/` | The house map, audio and lights schemas shared by the server, terminals and games |
| `reinstall/` | The reinstallation games (`web/` three.js + map editor, `vr/` Godot / Quest 3) |
| `chess/` | The King's chess (shared TS source) |
| `invite/` | The party invitation page |
| `hardware/` | Firmware: `server-room-m4/` (the M4 door sensor and patch bay), `server-room/` (ESP32, not installed) |
| `engines/godot/` | Godot 4 runtime addon + scene layer + conformance harness |
| `stagehand/` | Python show-control bridge (MQTT, lights, speakers, the agent worker) |
| `parser/` `runtime/` `lsp/` `syntax/` | Rust implementation of the language |
| `server/` | Legacy Rust multi-user relay (monorepo-only build) |
| `simulator/` | Old PySide6 GUI for the Rust runtime |
| `mind/` | Superseded by stagehand's `agents`; awaiting deletion |
| `examples/` | Reference `.loom` projects, from tutorial to full live events |
| `scripts/`, `deploy/` | Dev stack, ops (predeploy, ship, backups), device checks, `showctl`, house runbooks; VPS release scripts |
| `docs/` | Specs, guides, design docs, the in-app help, and history ([index](./docs/README.md)) |

## Tests

```bash
pnpm -r test          # every JS package (vitest)
cargo test            # Rust workspace
cd stagehand && uv run pytest
hardware/server-room-m4/test/run.sh  # firmware host checks
pnpm test:vr          # the Godot VR game (needs Godot 4.7)
./engines/godot/test/conformance.sh   # needs a godot binary on PATH
./engines/godot/test/addon.sh
```

## License

MIT — see [LICENSE](./LICENSE). Exception: `server/` (the legacy Rust
relay) depends on GPL-licensed code from the Prism monorepo and remains
GPL-3.0-or-later.
