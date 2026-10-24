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
| [`trapped/kiosk.md`](./trapped/kiosk.md) | Kiosk settings for the tablets, the TV and the laptops (Fully Kiosk, Chrome `--kiosk`). Operational, partly stale: "the house Mac" is now John's Desktop (the TV) plus John's MacBook. |
| [`trapped/room-audio.md`](./trapped/room-audio.md) | The house speaker router plan (§11–12 are the operational parts). Partly stale: the wave 1 banner names QLab and one house Mac; the wave 18b banner retires QLab, and the house Mac is now the MacBook (router) plus the Desktop (broker, `show`). |

## Running it in production

| File | What it is |
|---|---|
| [`loom-docker-deploy.md`](./loom-docker-deploy.md) | The VPS walkthrough: Docker, Caddy, DNS, releases, backups. Tests read it. |
| [`loom-deployment.md`](./loom-deployment.md) | The security model and the server's environment variables. |

Show-night operations are elsewhere: `scripts/show/README.md` (`pnpm
showctl`), `scripts/house-desktop/README.md` (the Windows Desktop),
`scripts/house-mac/` (macOS runbooks: `audio.md` is the MacBook's router;
`zigbee.md` and `lights.md` predate the Windows Desktop, see
`scripts/house-desktop/`),
`scripts/accept/README.md` (per-item device checks), and the show
folder's `SHOW.html` and `OCT31.md` §11.

## In-app help

[`help/`](./help/) holds the markdown articles the editor (`authoring/`) and
the play app (`play/`) bundle at build time, plus the search engine
`help/helpdoc.ts`. Do not move or rename this folder: the apps import it
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
- `docs/trapped/kiosk.md` — printed by `scripts/accept/K-16.sh`.
- The `Dockerfile` copies `docs/` into the server image.
