# Loom

Loom is a scripting language for interactive stories — and the
toolchain around it: a writer's IDE, a social-simulation engine, a
compiler that targets game engines, live-event infrastructure, and
show-control bridges for physical spaces.

One `.loom` project can be a branching game dialogue, a solo
interactive fiction, or a hundred-person immersive theater event with
phones in guests' hands and lights firing on cue.

```loom
CHARACTER Wren is Keeper, Combatant
  voice: female_alto
  hp: 80

let trusted = Wren.trusts.Player > 50

== opening
  cast: Wren, Player
  setting: Lighthouse

INT. LIGHTHOUSE - DAWN

A bell rope swings in the gloom.

WREN
  (quietly)
  It hasn't rung in three days.

<if: trusted>
  WREN
    I knew you'd come.

* Ring the bell.
  -> ringing
* Leave quietly.[ but you wonder.]
  -> END
```

Start with the writer's guide
([`docs/writing-in-loom.md`](./docs/writing-in-loom.md)), the friendly
language reference
([`docs/loom-reference.html`](./docs/loom-reference.html)), or the full
spec ([`docs/loom-v3.html`](./docs/loom-v3.html)).

## Take what you need

This repo is a toolbox, not a framework — each piece works on its own.

| I want to… | Use | Needs |
|---|---|---|
| **Play Loom stories in my Godot game** | [`engines/godot`](./engines/godot) — copy `addons/loom/` into your project | Godot 4. Pure GDScript, no build step. Node.js only to compile banks |
| **Write and rehearse a story in a real IDE** | [`editor`](./editor) — Writing / Run / Deploy studio in the browser | Node.js + pnpm |
| **The IDE as a desktop app, wired into my game** | [`desktop`](./desktop) — the editor in a Tauri shell; links a Godot project Wwise-style (installs the addon, builds banks into it) | Node.js + pnpm + Rust |
| **Run a live event** (guests join by passcode on their phones) | [`core`](./core)'s event server + the [`play`](./play) participant app | Node.js; Postgres only for multi-author accounts |
| **Embed the engine in my own JS/TS app** | [`@loom/core`](./core) — parser, sim runtime, LSP surface, all TypeScript | Any TS toolchain (consumed as source) |
| **Compile stories for any game engine** | [`@loom/bank`](./bank) — `.loombank` instruction streams + generated ID headers (`.gd`/`.cs`/`.h`) | Node.js |
| **Fire lights, sound, and props from the story** | [`stagehand`](./stagehand) — SSE → OSC/MQTT show-control bridge | Python 3.11+ / uv |
| **Hack on the language itself** | [`parser`](./parser), [`runtime`](./runtime), [`lsp`](./lsp), [`syntax`](./syntax) (Rust) or `core/src` (TypeScript) | Rust toolchain / Node.js |

The pieces compose through two stable seams: the **`.loom` text format**
(spec: [`docs/loom-v3.html`](./docs/loom-v3.html)) and the **`.loombank`
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
pnpm dev                          # builds play + terminal, runs the event
                                  # server (:7000) + the editor (:5173)
pnpm dev --sync "My Project"      # …and pushes the example story into that
                                  # server project, reloading its event
```

`pnpm dev --no-build` skips the app builds, `--play` adds the play app's
own Vite (:5174, a second origin for a performer phone), `--only server`
runs just one piece. Ctrl+C stops everything (`scripts/dev.mjs`).

### The editor (author IDE)

```bash
pnpm install
pnpm --filter loom-app dev        # → http://localhost:5173
```

Three modes: **Writing** (`⌘1` — screenplay text + story-graph node
editor, editing either edits the same source), **Run** (`⌘2` — rehearse
on an in-browser simulator or moderate the live event, one cockpit),
**Deploy** (`⌘3` — launch, join codes + QR, lifecycle). Works against a
local folder with no account or server.

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
uv run stagehand check --config show.yaml   # validate the cue map
uv run stagehand run   --config show.yaml   # SSE → OSC (TouchDesigner) + MQTT props
```

Declarative `show.yaml` maps story events to cues and MQTT sensors back
to journaled story signals. Design: [`docs/loom-show-control.md`](./docs/loom-show-control.md).

### The Rust crates

```bash
cargo build          # parser, runtime, lsp, syntax
cargo test
cargo build -p loom-runtime --bin loom-play   # terminal player CLI
```

The Rust engine is the original implementation; today the **TypeScript
engine in `core/` is the maintained, feature-complete one** (the Rust
mirror lags it — see `CLAUDE.md` for exact status). `loom-lsp` is a
stdio LSP server for Zed/VSCode; `syntax` generates the TextMate
grammar. The `server/` crate (legacy multi-user relay) builds only
inside the parent Prism monorepo and is excluded from this workspace.

## Layout

| Directory | What it is |
|---|---|
| `core/` | **TypeScript engine + event server** — parser, social-ecosystem sim, LSP surface, SSE/REST live-event backend with chat, access control, and a SaaS control plane |
| `bank/` | Bank compiler + **normative reference interpreter** — the conformance target for every engine runtime |
| `editor/` | React IDE (Writing / Run / Deploy) |
| `desktop/` | Tauri desktop shell for the IDE + Wwise-style Godot integration |
| `play/` | Participant app guests use at events |
| `engines/godot/` | Godot 4 runtime addon + scene layer + conformance harness |
| `stagehand/` | Python show-control bridge (OSC / MQTT) |
| `parser/` `runtime/` `lsp/` `syntax/` | Rust implementation of the language |
| `server/` | Legacy Rust multi-user relay (monorepo-only build) |
| `simulator/` | Deprecated PySide6 GUI for the Rust runtime |
| `examples/` | Reference `.loom` projects, from tutorial to full live events |
| `docs/` | Specs, guides, design docs, and the in-app help content |

## Tests

```bash
pnpm -r test          # core + bank + play + editor (vitest)
cargo test            # Rust workspace
cd stagehand && uv run pytest
./engines/godot/test/conformance.sh   # needs a godot binary on PATH
./engines/godot/test/addon.sh
```

## License

MIT — see [LICENSE](./LICENSE). Exception: `server/` (the legacy Rust
relay) depends on GPL-licensed code from the Prism monorepo and remains
GPL-3.0-or-later.
