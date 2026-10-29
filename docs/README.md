# Loom docs

What is in this folder and which file to read for what. Package details
live next to the code (each package's `CLAUDE.md` or `README.md`), and the
show's own files live in `core/examples/trapped-in-the-internet/` (start at
its `INDEX.md`).

## The language

| File | What it is |
|---|---|
| [`writing-in-loom.md`](./writing-in-loom.md) | The writer's guide, from a first line to a live show. Current. |
| [`loom-4.md`](./loom-4.md) | The Loom 4 design: names as words, `Name:` dialogue, keyword statements, `when` rules. Current. |
| [`loom-grammar.md`](./loom-grammar.md) | The formal grammar of the v3 surface (July 2026). |
| [`loom-v3.html`](./loom-v3.html) | The original v3 design spec. Historical surface. |
| [`loom-reference.html`](./loom-reference.html) | A v3-era friendly reference. Historical. |

## Engines and platform

| File | What it is |
|---|---|
| [`loom-banks.md`](./loom-banks.md) | **Normative** `.loombank` format and the cross-engine runtime contract (`bank/`, `engines/godot/`). |
| [`loom-conversation-model.md`](./loom-conversation-model.md) | How every line lands in one room (locations are rooms). Implemented. |
| [`loom-functional-redesign.md`](./loom-functional-redesign.md) | Traits with parameters, owned and derived beats, `SELF`. Implemented in the TS engine; a design record. |
| [`loom-desktop.md`](./loom-desktop.md) | The Tauri desktop app and the Godot integration. |

## The live show stack

| File | What it is |
|---|---|
| [`loom-reinstall.md`](./loom-reinstall.md) | **Normative** contract for the house map, the reinstallation games, the spatial terminals, the voice link, the house audio and lights files. Tests read it. |
| [`loom-show-control.md`](./loom-show-control.md) | stagehand's design: cues, sensors, the house rig. |
| [`loom-house-desk.md`](./loom-house-desk.md) | **Normative** contract for the house desk (wave 25): `desk.json` cue lists, parallel / series timelines with the story, the speaker and light checks, Run → House and the host's Show / Desk. |
| [`loom-w26-contract.md`](./loom-w26-contract.md) | The wave 26 contract (the rehearsal notes of 2026-10-26): the glitch, the locked phone, the guest BINGO, the void, the heart and the virus in the games, terminals linked by room, voice-timed cutscenes, no hints. Decisions, routes and shapes (`POST /api/spatial/moment` is C6), file ownership. The code wins where they differ. |
| [`loom-w32-contract.md`](./loom-w32-contract.md) | The wave 32 contract (*Trabolta talks back*): the four talk scenes (`Night.talk`), ⚡ and the ad bursts, `POST /api/mod/talk` and the public talk thread, the hosts' 🤖 Talk card, the stage voice and what may slip. The show text is on `SIGNOFF-w32.md`. The code wins where they differ. |
| [`loom-w38-contract.md`](./loom-w38-contract.md) | The wave 38 contract (the house soundtrack): `audio.json` inputs that duck (`role`, `reach`), the router's priority ducking, streams and per-output trims, `soundtrack.yaml` (playlists, scenes, takeover tracks), `cue music_<scene>` and `Night.music`, the synthesized SFX library; the living room on Main L/R + the sub and the TV into input 3. Its integration changes are noted at the top. The code wins where they differ. |
| [`loom-w40-contract.md`](./loom-w40-contract.md) | The wave 40 contract (the house mixer): the mix's keys and sums (`core/src/house-mixer.ts`), `GET /api/mod/audio/mixer`, `POST /api/mod/audio/mix` / `music` / `meters`, the router's strips, live meters and music commands, the editor's 🎚 Mixer and the host Desk's. Its integration changes are at the end. |
| [`loom-w42-contract.md`](./loom-w42-contract.md) | The wave 42 contract (Trabolta under load, and as intended): the windowed agent hub (`capacity=`), the guests' `agentWait` queue strip, overflow engines for one mind, the DM guards and fallbacks by intent, and the measured 50-guest and 54-scenario results. |
| [`trapped/kiosk.md`](./trapped/kiosk.md) | Kiosk settings for the tablets, the TV and the laptops (Fully Kiosk, Chrome `--kiosk`). Operational, partly stale: "the house Mac" is now John's Desktop (the TV) plus John's MacBook. |
| [`trapped/room-audio.md`](./trapped/room-audio.md) | The house speaker router plan (§11–12 are the operational parts). Partly stale: the wave 1 banner names QLab and one house Mac; the wave 18b banner retires QLab, and the house Mac is now the Desktop (the router since 2026-10-27, the broker, `show`) plus the MacBook (Trabolta; the router fallback). |

## Running it in production

| File | What it is |
|---|---|
| [`loom-docker-deploy.md`](./loom-docker-deploy.md) | The VPS walkthrough: Docker, Caddy, DNS, releases, backups. Tests read it. |
| [`loom-deployment.md`](./loom-deployment.md) | The security model and the server's environment variables. |

Show-night operations are elsewhere: `scripts/show/README.md` (`pnpm
showctl`), `scripts/house-desktop/README.md` (the Windows Desktop: the
sound router on the MOTU, the Hue / ZL1 bulbs, the WLED strip, the broker,
the TV), `scripts/house-macbook/` (macOS runbooks: `trabolta.md` sets up
Trabolta; `audio.md` is the router fallback; `zigbee.md` and `lights.md`
predate the Windows Desktop, see `scripts/house-desktop/`),
`scripts/accept/README.md` (per-item device checks), and the show
folder's `SHOW.html`, `SHOWNIGHT.md` (§4 is the pre-show checklist) and
`TECH.md`.

## In-app help

[`help/`](./help/) holds the markdown articles the editor (`authoring/`) and
the play app (`play/`) bundle at build time, plus the search engine
`help/helpdoc.ts`. The `role: performer` articles in `play/` (07, 13,
14 and 19) show only on staff phones; `play/19-house-workings.md` is what
the guest guide leaves out (marks, the lock, the King, the heart, the
void, the virus). `authoring/48-terminal-setup.md` is how the crew sets
up the terminals, the door sensor and the headsets. Both are wave 26.
Do not move or rename this folder: the apps import it
and tests check every article. Run
`pnpm --filter loom-app exec vitest run src/lib/help-content.test.ts` and
`pnpm --filter loom-play exec vitest run test/help.test.ts` after an edit.

## History

| File | What it is |
|---|---|
| [`history/waves.md`](./history/waves.md) | The build diary: every wave and landing from May to October 2026, newest first. |
| [`history/package-catalog-2026-10.md`](./history/package-catalog-2026-10.md) | The root `CLAUDE.md`'s old package table and prose, verbatim. |
| [`history/trapped/`](./history/trapped/) | October planning audits (screens, QR, floor plan, hardware, the chess phone, Trabolta's arc, …). |
| [`loom-ide-redesign.md`](./loom-ide-redesign.md) | The earlier five-mode editor design. Historical. |
| [`loom-editor.html`](./loom-editor.html) | The editor as of July 2026. Historical. |
| [`loom-multiuser.md`](./loom-multiuser.md) | The Rust relay backbone (`server/`). Superseded by the TS server. |
| [`loom-web-shipping.md`](./loom-web-shipping.md) | The WASM + relay shipping plan. Superseded. |

## Files code reads

Some docs are read by code or tests. Keep their paths and the pinned
parts unless you change the code and test in the same commit:

- `docs/help/**` — bundled by the editor and play; checked by their help tests and by `reinstall/web`'s help tests.
- `docs/loom-reinstall.md` — `reinstall/web/test/help-docs.test.ts`.
- `docs/loom-docker-deploy.md` — `scripts/ops/test/run.sh` checks its rsync rules against `ship.sh`.
- `docs/trapped/kiosk.md` — referenced by `scripts/accept/K-16.sh`'s output.
- The `Dockerfile` copies `docs/` into the server image.
