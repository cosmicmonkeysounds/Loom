# Loom

Loom is a scripting language for interactive stories, from branching game
dialogue to live, multi-person events. This repo holds the language (a
maintained TypeScript engine and an older Rust one), the tools around it
(an editor, a language server, a bank compiler for game engines) and a live
event stack: a multi-tenant event server, the phone app guests and
performers use, wall terminals, two reinstallation games and the house
show-control bridge. Its first big production is the party show *Trapped in
the Internet* on 2026-10-31.

License: MIT for everything except `server/` (GPL-3.0-or-later, because it
depends on `prism-core`).

## This repo is not Prism

Loom is its own git repo, nested at `prism-root/packages/loom`. The parent
`prism-root/CLAUDE.md` describes the Prism framework. **Its rules do not
apply here**: there is no `prism` CLI, no Slint / femtovg / Taffy, and you
use `pnpm`, `cargo` and `uv` directly. This file and the package files it
points to are the ones to follow.

`.claude/worktrees/` holds many git worktrees (git-ignored), each with old
copies of these docs. Exclude `.claude/` from any recursive grep or find.

## Packages

The TypeScript engine in `core/` is the maintained implementation. The Rust
crates are the original one and lag far behind it.

| Path | What it is | Agent docs |
|---|---|---|
| `core/` | `@loom/core`: the TS parser, runtime (`Sim`), in-process LSP, and the event server (`pnpm --filter @loom/core serve`, :7000) with the SaaS control plane | `core/CLAUDE.md` |
| `core/examples/trapped-in-the-internet/` | The show's story, maps, facts, show book and runbooks | `INDEX.md` there |
| `play/` | `loom-play`: the guest and performer phone app (Vite React) | `play/CLAUDE.md` |
| `editor/` | `loom-app`: the author IDE (Writing ⌘1, Run ⌘2, Integrations ⌘3) | `editor/CLAUDE.md` |
| `terminal/` | `loom-terminal`: wall terminals, the TV, the server room, chess, casino, the tent | `terminal/CLAUDE.md` |
| `house/` | `@loom/house`: the house map, audio and lights schemas, routing, voice wire format | `house/CLAUDE.md` |
| `reinstall/` | The golden-duck games: `web/` (`loom-reinstall`, plus the map editor) and `vr/` (Godot 4.7, Quest 3) | `reinstall/CLAUDE.md` |
| `chess/` | `@loom/chess`: the King's chess, played on the Server Door terminal | `chess/CLAUDE.md` |
| `bank/` | `@loom/bank`: the `.loombank` compiler and the normative reference interpreter | `bank/CLAUDE.md` |
| `engines/godot/` | The GDScript runtime + Godot addon, conformance-tested against `bank` | `engines/godot/CLAUDE.md` |
| `desktop/` | `loom-desktop`: the editor in a Tauri 2 shell, with the Godot integration | `desktop/README.md` |
| `stagehand/` | Python (uv) live-event bridge: `agents` (Trabolta's voice), `show`, `lights`, `audio` | `stagehand/CLAUDE.md` |
| `hardware/server-room-m4/` | Grand Central M4 firmware: the server-room door sensor and the patch bay | its `README.md` |
| `hardware/server-room/` | ESP32 firmware. **Not installed** for Oct 31 | its `README.md` |
| `invite/` | `loom-invite`: the party invitation one-pager | — |
| `parser/`, `runtime/`, `lsp/`, `syntax/` | The Rust workspace (`cargo build` / `cargo test` from the root) | crate docs |
| `server/` | Rust multi-user relay. Builds only inside the Prism monorepo; excluded from the workspace | `docs/history/` |
| `examples/` | Reference `.loom` projects | — |
| `mind/` | Superseded by stagehand `agents`; awaiting deletion | — |
| `simulator/` | Old, kept runnable | its `README.md` |
| `scripts/` | `dev.mjs`, `ops/` (predeploy, ship, backups, checklist), `accept/` (per-item device checks), `show/` (`showctl`), `house-desktop/` (Windows runbook), `house-macbook/` (macOS runbooks) | `scripts/show/`, `scripts/accept/`, `scripts/house-desktop/` READMEs |
| `deploy/` | VPS release, rollback, backup and restore scripts + the Caddyfile | `docs/loom-docker-deploy.md` |
| `docs/` | Design docs, specs, runbooks, in-app help, history | `docs/README.md` |

`Trapped In The Internet story/` at the root holds the author's original
story documents. Leave them as they are; quote the path in shell commands.

## Commands

```bash
pnpm install                           # every JS package (one pnpm workspace)
pnpm dev                               # build play + terminal + reinstall, run the
                                       # server (:7000) + editor (:5173)
pnpm dev --sync "<project>"            # also push the example story into a server project
pnpm dev --only server --no-build      # just the server
pnpm test                              # pnpm -r test
pnpm --filter <name> test              # one package (@loom/core, loom-play, loom-app, …)
pnpm --filter <name> typecheck

pnpm --filter @loom/core titi:facts [--check]   # regenerate the show's files from facts.json
pnpm --filter @loom/core show:page [--check]    # regenerate SHOW.html
pnpm --filter @loom/core loomcheck examples/trapped-in-the-internet --smoke  # lint a story
pnpm house:sync                        # house goldens + copy into reinstall/vr
pnpm test:vr                           # the Godot suite (needs Godot 4.7)

cd stagehand && uv run pytest          # stagehand
hardware/server-room-m4/test/run.sh    # M4 firmware host checks (`run.sh compile` builds it)
cargo test                             # the Rust crates

pnpm showctl doctor                    # show-night diagnostics (scripts/show/README.md)
scripts/ops/predeploy.sh [--vr]        # the full pre-deploy gate; stamps the commit
scripts/ops/ship.sh <tag>              # rsync + deploy/release.sh on the VPS
LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm sync-show
                                       # push the show story into the VPS project + reload
```

The DB-gated core tests need Postgres:
`DATABASE_URL=postgres://127.0.0.1:5432/loom_dev pnpm --filter @loom/core test`
(they skip silently without it).

## Conventions

- **Branches.** Build each wave on worktree branches named
  `oct31-wN/<lane>`, commit often with Conventional Commits
  (`type(scope): description`), and merge each lane into master with
  `--no-ff`. Never leave one big uncommitted change.
- **Never deprecate.** Rename, move, break and fix. The tests are the
  safety net.
- **Tests with every change.** vitest in the TS packages, pytest in
  stagehand, `test/run.sh` for firmware, the Godot suite for VR. Keep the
  in-app help tests green when you touch `docs/help/`.
- **Search gotcha.** ugrep treats `core/src/runtime/sim/sim.ts` as binary.
  Use `grep -a` on it.
- **Scratch servers.** An unset `DATABASE_URL` defaults to `loom_dev`, which
  holds the user's own dev events. Give a scratch server a dead URL
  (`DATABASE_URL=postgres://127.0.0.1:1/none`), `LOOM_DB_WAIT=off` and a
  fresh `LOOM_STATE_DIR`.
- **Never `pkill -f "stagehand run"`.** It kills the user's own Trabolta
  worker. Stop the process you started by its pid.
- **Trabolta's fiction.** Trabolta lives in Halifax, in the MapsAndDucks
  universe. He never knows the crew (John, Steph, Jesse), the party, the
  show, Loom or the hardware. Every prompt, persona line, dossier and scene
  stays inside his world (the persona's `outside:` list enforces it).
- **Secrets stay out of public surfaces.** Never write the patch-bay combo
  strings, the door code, hunt answer keys, codex or digit-note codes, or
  live join / mod codes into a doc, a README, a CLAUDE.md, SHOW.html, a
  commit message or test output. They live in the story (the hidden
  `Kernel`) and `facts.json`.
- **Deploy gate.** Before `ship.sh`, check the preview's roster
  (`guests` / `modsOnline`) in its own step. A release restarts the
  server; if anyone is on, ask first. Run `sync-show` only after `ship.sh`
  succeeds.
- **Live events.** `sync-show` refuses to reload an event with real guests
  (exit 3) unless told `--i-know-this-is-live`. Never Restart, Push draft,
  Go live or End after the doors open.

## How the live stack fits together

- **Control plane** (needs Postgres): BetterAuth author accounts, projects
  and files (`/api/projects/*`), members and invites, real-time co-editing
  over Yjs. Without a database the event plane still runs.
- **Event plane:** one `EventRuntime` per event under `/e/:eventId`.
  Guests, performers and terminals join with a short code
  (`/api/resolve-code`). An author's session moderates their own events
  (Run == admin). Every mutation is journaled; a restart replays the
  journal.
- **Clients:** `play` (phones), `terminal` (`/terminal/`), `reinstall/web`
  (`/reinstall/`), the editor (`/edit/` behind Caddy). The server serves the
  built `play`, `terminal` and `reinstall` bundles.
- **Docker:** the root `Dockerfile` and `docker-compose.yml` build the
  server, Postgres and a Caddy proxy (`docs/loom-docker-deploy.md`).
  Releases are pinned image tags (`deploy/release.sh`, `rollback.sh`).
- **In-app help:** markdown in `docs/help/{authoring,play}/`, bundled into
  the editor and play at build time. Do not move that folder.

## The show this week

*Trapped in the Internet*, Oct 31 2026. Start at
`core/examples/trapped-in-the-internet/INDEX.md` (what each file is, which
ones code and tests read). The crew's show book is `SHOW.html` in that
folder, generated by `show:page`. The night-of runbook is `SHOWNIGHT.md` (its §4
pre-show checklist is what `scripts/ops/checklist.sh` prints); the machines
are in `TECH.md`.

### Machines

| Machine | Runs |
|---|---|
| VPS (`app.mapsandducks.com`) | The event server, Postgres, Caddy |
| John's MacBook (macOS, M3 Max 48 GB) | Ollama `gpt-oss:20b` + stagehand `agents` (`stagehand/laptop.yaml`, local); `predeploy` / `ship` / `sync-show` / `showbackup`; a director's Run console; **by default** the audio router (stagehand `audio`, `trapped.macbook.yaml`) with the MOTU 828x + ADAT, dialling the Desktop's broker on :1884 |
| John's Desktop (Windows) | The living-room TV over HDMI (Chrome kiosk, spot `desktop-tv`); Mosquitto (anonymous on 127.0.0.1:1883, password-only `props` on the LAN at :1884); Zigbee2MQTT on the CC2652P; stagehand `show` + `lights` as Task Scheduler tasks (`trapped.desktop.yaml`). The audio router may move here once the MOTU is proven on Windows. Runbook: `scripts/house-desktop/README.md` |
| Steph's laptop | The server-room terminal in Chrome (`…&spot=server-room&door=serial&camera=user`) + the Grand Central M4 over USB (door + patch bay); webcam, monitor, mouse, keyboard |
| John's old laptop | The tent: `/terminal/?code=<mod>&spot=tent&announce=1`, the reinstall wizard and web game. Needs WebGL2 |

Also in the show: the wall tablets (Fully Kiosk), the Server Door chess
and casino terminals, a Quest 3, the server-room RGB bulb, and phones.

House announcements need both house machines: the server → the Desktop's
`show` job → MQTT `show/announce` → the router → the speakers. With the
broker or `show` down, only `&announce=1` terminals still speak them.

### Release status

The VPS runs `w27` (master `2e6e36b2`, shipped 2026-10-27; rollback
`w26`, which had carried waves 18b Stage B through 26 since 2026-10-26),
and the "trapped in the internet" preview event was synced and reloaded on
it. Wave 27 is the first meeting at Trabolta's heart: the talk branches on
who the program is and what it did tonight (Heart Evidence / Heart Reasons
sub-menus, ≤ 9 options a menu), and the heart terminal shows only this
visit, fits the whole menu and holds it while he speaks. The server side is
done; the house machines are not (steps 4–5 and 7–10 below: retire the
MacBook's `show`/`lights`, the Desktop's stagehand, the router, the M4, and
reload every terminal and the TV, which still ran a 10-24 build on
2026-10-27). Wave 23 needs the badges printed from Run →
Print sheet (Badges) and the cast cards reprinted (each now carries its own
part's QR). The show text of waves 18b, 20, 21, 22, 26 and 27 is marked DRAFT
(`DRAFT w26`, `DRAFT w27`) and awaits the user's sign-off (the `SIGNOFF-*.md`
files, `SIGNOFF-w27.md` for the heart, `SIGNOFF-w28.md` for wave 28's
`DRAFT w28` # hosts lines on the 📥 Truther Download (branch
`oct31-w28/heart-followups`, not yet shipped); wave 26's
`core/examples/trapped-in-the-internet/SIGNOFF-w26.md` includes the game
map's *MAINFRAME* rack label). Wave 26 ships in its contract's C14 order:
the server release → `sync-show` → reload every terminal and the TV →
re-export and sideload the Quest APK. After the sign-off, reprint the cast
packs `clippy`, `task-manager`, `norton`, `mcafee`, `password-manager`,
`cra-agent`, `crew/director`, `performers/installation-wizard` and
`featured/microsoft-excel`. Not yet proven
on real hardware: the Quest's audio, TTS and mic (`tools/quest.sh logs`),
the glitch on real phones, and the real speakers.

### Shipping master (summary)

1. Decide on the DRAFT text sign-off; shipping carries every DRAFT line.
2. Check the preview's roster in its own step. Ask if anyone is on.
3. MacBook: `scripts/ops/predeploy.sh --vr`, then `scripts/ops/ship.sh <tag>`.
   Check `/api/health`, then `deploy/release.sh --check-env` on the VPS.
   Rollback is `deploy/rollback.sh` on the VPS.
4. MacBook (the old house Mac): retire what moved to the Desktop, or every
   cue fires twice. `uv run stagehand launchd uninstall --job show` and
   `--job lights`, `scripts/house-macbook/install-alexa.sh --uninstall`, stop
   Mosquitto (`brew services stop mosquitto`) and the Zigbee2MQTT launchd
   agent.
5. Desktop: `git pull`, set `server.event` / `mod_passcode` in
   `stagehand/trapped.house.local.yaml`, then
   `scripts\house-desktop\start-stagehand.ps1` (checks the config, installs
   and starts the `show` and `lights` tasks) **before** the sync, so no old
   rule posts into the new story.
6. MacBook: `LOOM_SSH=loom-vps LOOM_PROJECT="trapped in the internet" pnpm
   sync-show --replace-audio --replace-maps [--replace-lights] [--replace-desk]`
   **with its reload, before doors**. Wave 26 changed both show maps (the
   heart, the virus disk, the *MAINFRAME* rack label), and the project's
   maps win without `--replace-maps`. First Download JSON any map edits
   saved to the project and commit them into the repo's `house.json`.
   Restart every other non-ended event.
7. MacBook: install the router (`uv run stagehand sounds placeholders
   --config trapped.macbook.yaml`, `uv run stagehand check --only audio
   --config trapped.macbook.yaml`, `uv run stagehand launchd install --job
   audio --config trapped.macbook.yaml`); `uv run stagehand launchd restart
   --job agents`; then Run → Mind → Reset. The router must be wave 26's
   (desk plays and its report; *Anti Virus* said right, V3): `git pull`
   first, and if it is already installed, `uv run stagehand launchd restart
   --job audio --config trapped.macbook.yaml`. Walk Run → House → Checks
   once it is up.
8. Desktop: Zigbee2MQTT on the CC2652P, pair the bulb as
   `server_room_rgb`, place it in the map editor, test each look, Save to
   project (`scripts/house-desktop/README.md`).
9. Steph's laptop: flash the M4 (`door-m4 1.2.0`), bench with
   `scripts/accept/N-20.sh` and `N-21.sh`, then calibrate the door and
   learn the patch bay in the terminal's ⚙ (always after a reflash).
10. Reload every terminal and the TV (mandatory since wave 26: check each
    device's build stamp on Run → Terminals), set the show TV's pace to
    0.92× in its ⚙ (re-opening its link sets it), touch each tablet once, re-export and sideload the Quest
    APK, test the door open → shut → open, and reprint the cast packs after
    the sign-off.
11. Morning of the show: pause the event first, then sync, Push draft and
    Go live in place, before anyone registers. Open the doors at doors
    time (open question: 19:00 or 20:00; the story's clock reads 7:00 PM
    at the doors).

Run `pnpm showctl doctor` (and `pnpm showctl preflight <macbook|desktop|serverroom|tent>`
on each machine) to see what is up. The full list is in `SHOW.html` and
`SHOWNIGHT.md` §4 (the machines in `TECH.md`).

## Where to read more

- Docs map: [`docs/README.md`](./docs/README.md).
- Language: [`docs/writing-in-loom.md`](./docs/writing-in-loom.md),
  [`docs/loom-4.md`](./docs/loom-4.md).
- History (wave diaries, the old package catalogue, planning audits):
  [`docs/history/`](./docs/history/).
