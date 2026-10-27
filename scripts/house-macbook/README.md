# John's MacBook (macOS): Trabolta and the console

Since 2026-10-27 the MacBook has three jobs on the night:

| Job | What | Runbook |
|---|---|---|
| **Trabolta** | Ollama `gpt-oss:20b` + stagehand `agents` (`stagehand/laptop.yaml`, launchd) | [`trabolta.md`](./trabolta.md) |
| **The director's console** | the editor's Run mode in Chrome (Run → Mind, Run → House, Run → Terminals) | `docs/help/authoring/43-run-mode.md` |
| **Ops** | `scripts/ops/predeploy.sh`, `ship.sh`, `pnpm sync-show`, `showbackup.sh` (launchd, every 10 min 19:00–03:00), `pnpm showctl` | the root `CLAUDE.md`; `core/examples/trapped-in-the-internet/SHOWNIGHT.md` |

**The house sound and lights are John's Desktop's** (Windows): the MOTU
828x and the speaker router, Zigbee2MQTT with the Hue and ZL1 bulbs, the
WLED strip, Mosquitto, stagehand `show` + `lights`, the TV —
[`scripts/house-desktop/README.md`](../house-desktop/README.md).

The other files here:

| File | What it is now |
|---|---|
| [`audio.md`](./audio.md) | **The fallback**: the speaker router on this Mac, if the 828x misbehaves on Windows (the Desktop README's §11 says when and how to switch) |
| [`zigbee.md`](./zigbee.md) | Zigbee2MQTT background, the macOS install (a bench or a fallback), pairing and backing up the bulbs; on the Desktop start from its README §4–5 |
| [`lights.md`](./lights.md) | stagehand's `lights` job (`lights.json`): what it does, by hand, on either machine |
| [`alexa.md`](./alexa.md), `install-alexa.sh` | the retired announcement player (only to uninstall it) |

A MacBook that once ran the whole rig (the old "house Mac") may still have
`show`, `lights`, `audio` or `alexa` jobs, Mosquitto or Zigbee2MQTT: retire
them (`SHOWNIGHT.md` §1, step 5), or every cue fires twice.
`uv run stagehand launchd status` (in `stagehand/`) should list **only
`agents`** — plus `audio` in the fallback.
