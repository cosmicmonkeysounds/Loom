# showctl — show-night diagnostics

One command for every show computer (macOS, Windows, Linux) that answers
*is everything up, and if not, what do I do?* It reads the event server the
way a director's Run page does, checks the machine it runs on, and prints one
green / amber / red table.

- **Zero install.** Node ≥ 22.6 runs the TypeScript straight
  (`--experimental-strip-types`); no `pnpm install`, no packages.
- **Read-only.** Every command but `fire` only reads. `fire` is guarded.
- **Never registers itself as a device.** No read makes `showctl` show up as a
  fake terminal, a sound router, a lights module, a VR station or a director
  console (see [What it never does](#what-it-never-does)).
- **Never prints a secret.** A passcode prints as its first two characters
  (`MO•••••`), a session token never, a join link only as its origin, and the
  log masks every secret character's value (the Kernel's combos, the door code)
  as `•••`.

## Running it

| Machine | Command |
|---|---|
| any, with the repo + pnpm | `pnpm showctl <command>` |
| macOS / Linux, no pnpm | `scripts/show/showctl.sh <command>` |
| Windows (PowerShell) | `.\scripts\show\showctl.ps1 <command>` |
| Windows, scripts blocked | `powershell -ExecutionPolicy Bypass -File scripts\show\showctl.ps1 <command>` |

Node on Windows: `winget install OpenJS.NodeJS.LTS`.

### Environment

| Variable | Default | |
|---|---|---|
| `LOOM_SERVER` | `https://app.mapsandducks.com` | the event server (`--server` overrides) |
| `LOOM_MOD_CODE` | — | a **moderator** passcode, from Run → Front of house (`--code` overrides). Without it only the health check runs. |
| `LOOM_VPS` | `loom-vps` | the ssh host `preflight macbook` tries (`ssh … true` only) |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where `preflight macbook` looks for Ollama |
| `Z2M_FRONTEND` | `http://127.0.0.1:8080` | where `preflight desktop` looks for Zigbee2MQTT |
| `SHOWCTL_CACHE` | see below | the session cache file |
| `NO_COLOR` | — | turns colour off (it is already off when the output is not a terminal) |

Set the code once per terminal, never in a file you commit:

```bash
export LOOM_MOD_CODE='<mod passcode>'          # macOS / Linux
```
```powershell
$env:LOOM_MOD_CODE = '<mod passcode>'          # Windows
```

**The session cache.** The first run resolves the code
(`POST /api/resolve-code`, throttled per IP) and logs in
(`POST /e/<id>/api/mod/login`); the event id and token are kept in
`~/.config/loom/showctl-sessions.json` (Windows:
`%APPDATA%\loom\showctl-sessions.json`), owner-only, keyed by a hash of the
server and the code — the code itself is never written down. Later runs reuse
it; a re-login sends the old token, so the server upgrades that session instead
of piling up new ones. Delete the file to forget every session.

### Exit codes

`0` all green · `1` warnings (amber) · `2` failures (red), or a usage error ·
`3` a `fire` the live guard (or you) refused. `--json` prints machine output;
`-v` adds the "what it read" column to green rows too.

## Commands

| Command | What it does |
|---|---|
| `doctor [--watch N]` | Every server check in one table (below). `--watch` repeats it every N s (15 by default). |
| `status [--watch N]` | One screen for the tech op: phase, show clock, LAST / NEXT, countdowns, the story's watch values, people, Trabolta, the judge, every terminal, the router and the lights. |
| `log [--follow [s]] [--type a,b] [--who name] [--last N]` | The run's ledger (what Run → Log shows), the last 40 lines; `--follow` polls every 2 s. `--type signal,beatEntered`, `--who Winamp` (a name or an id). |
| `roster [--csv] [--where …] [--all]` | Real guests (personas with `--all`): name, role, faction, room, score, state, last seen. `--where captured \| restricted \| offline \| online \| gone \| personas \| <room or faction>`. |
| `terminals [--watch]` | Every terminal's last heartbeat, plus the map's key spots nobody polls. |
| `recap [--text]` | The night's totals; `--text` is the paste-ready ceremony lists. |
| `preflight <macbook\|desktop\|serverroom\|tent>` | The server checks, then this machine's own screen, then its local checks. |
| `fire <signal> --yes` | Fires a signal or cue (`POST /api/mod/signal`), labelled `showctl · <this computer>` in Run → Log. Options: `--subject <guest>`, `--arg key=value` (repeatable), `--label`. |

## Quick diagnostics on show night

- **Leave one running on the director laptop:** `pnpm showctl status --watch 5`
  (or `doctor --watch 15` for the full table). Anything red is in the top half
  of the screen.
- **Before the doors, on every machine:** `pnpm showctl preflight <machine>`
  until it is green (or every amber is understood).
- **Something feels wrong:** `pnpm showctl doctor`, then for the area that is
  red: `terminals`, `log --follow --type signal,beatEntered`, `roster --where offline`.
- **A device died and the story is stuck:** see [`fire`](#fire--the-hardware-fallback).

## The checks — what they mean, what to do when red

| Row | Reads | Red / amber when | Do this |
|---|---|---|---|
| VPS health | `GET /api/health` | not 200 (`database`, `starting`, `config`, `events`); amber with no control plane (LAN mode) | `starting`: wait 10 s. `database`: on the VPS `docker compose ps`, `docker compose logs db`. Otherwise `docker compose logs server`; `deploy/rollback.sh` if a release broke it. |
| Moderator session | `POST /api/resolve-code` + `/api/mod/login` | wrong code, a guest / performer code, rate-limited | Copy the MOD code again from Run. A 429: wait a minute (the house shares one public IP). |
| Run | `/api/state?role=mod` | amber: paused, or the doors never opened; red: no story loaded | Run's ▶ Resume / 🚪 Open the doors. No story: Push draft or `sync-show`. |
| Event mode | `GET /api/landing` | info only | "LIVE" = this event is the one the front page advertises. A preview never is. |
| Guests / Performers / Directors | the mod view | amber: a performer's phone dropped (part held, not streaming) | Ask them to reopen the app; Run → ⏏ Release frees the part. |
| Trabolta's worker | the mod view's `cast` + `minds` | red: no worker online, or stalled; amber: a request waiting > 40 s, or the mind isn't `new` | On the MacBook: `preflight macbook`, then `cd stagehand && uv run stagehand launchd restart --job agents`. Directors answer from Run meanwhile. |
| Judge | `facts` + the judge's queue | amber: no `facts.json`; red: the judge stalled | Rule on Run → Mind → Judging. A missing facts.json: `sync-show`. |
| Join links | `POST /api/mod/codes` (origin only) | the links aren't the public https origin | Set `LOOM_BASE_URL` in the VPS `.env`, `deploy/release.sh`. |
| 📟 <terminal> | `/api/mod/screen/terminals` | red: silent ≥ 20 s, a door-sensor fault, a patch-bay fault; amber: not full screen, sound locked, mic denied, battery < 20 % unplugged | Silent: its Wi-Fi, power, is the page open? Not full screen: relaunch Chrome `--kiosk` / touch it once. Sound locked: touch the screen once. Door fault: ⚙ on that terminal (calibrate again after a reflash); the 🚪 buttons cover it meanwhile. |
| 📟 <key spot> never polled | the same, against `house.json` | the TV, the server room, the Server Door, the casino or the tent never polled | Open its kiosk URL (`preflight <machine>` prints the pattern). The other wall spots fold into one info row. |
| Terminal builds | the same | two builds in use | Reload the old ones. |
| Door sensor / Patch bay | `/api/screen/state` (no name) | amber: the story follows the 🚪 / 🔌 buttons, not the sensor | Once the sensor reads right: 🚪 *Trust the door sensor again* / the `trust_patch_bay` cue. |
| Sound router | `/api/mod/audio` | red: offline — no story sound or announcement plays | MacBook (default): `uv run stagehand launchd status --job audio`. Announcements also need stagehand `show` running and both on the same broker. |
| Lights module / Zigbee devices | `/api/mod/lights` | red: offline, or `server_room_rgb` not paired | On the Desktop: the lights job, Zigbee2MQTT, the bulb's name in Z2M. |
| VR stations | `/api/mod/spatial/stations` | amber: a headset that polled went quiet | Wake the Quest; it relinks on its own. |
| Server load | `/api/mod/metrics` (×2) | amber: CPU > 80 % of one core, or event-loop p99 > 200 ms | Nothing to do mid-show but watch; note it for the next release. |

### Per machine (`preflight`)

| Machine | Local checks |
|---|---|
| `macbook` (John's MacBook, macOS) | Ollama answering; `gpt-oss:20b` pulled and loaded (warm it: `ollama run gpt-oss:20b hi`); the qwen orchestrator unloaded under `mind_mode: new`; `stagehand/laptop.yaml`'s `mind_mode` (only that line is read); `uv`; the stagehand `agents` and `audio` launchd jobs; the MOTU in Core Audio; ssh to the VPS; AC power; system sleep off (`caffeinate -dims`); `showbackup.sh status`. Run it from the main checkout (where `laptop.yaml` lives). |
| `desktop` (John's Desktop, Windows) | Mosquitto's service and its 1883 (loopback) / 1884 (LAN) listeners; the Zigbee2MQTT frontend; Chrome; stagehand `show` and `lights` running (off the process command lines; the scheduled tasks are `Loom stagehand <job>`, see `scripts/house-desktop/`); whether the router runs here; the TV's `--kiosk` Chrome; sleep and display timeouts (`powercfg /change standby-timeout-ac 0`, `monitor-timeout-ac 0`). Plus the `desktop-tv` terminal row: polling, `view tv`. |
| `serverroom` (Steph's laptop) | Chrome ≥ 89 (Web Serial); the Grand Central M4 on USB; the kiosk URL pattern; then by hand: ⚙ door sensor connected + calibrated, open → shut the door once, one patch cable counted. Plus the `server-room` row: polling, the door sensor's state, the patch bay once reported. |
| `tent` (John's old laptop) | Chrome; the kiosk URL pattern (never `&view=reinstall`: the map's tent spot sets it); WebGL2 by hand at `chrome://gpu` (without it the tent can only send to a headset). Plus the `tent` row: polling, mic off. |

URLs print with `<mod>` where the code goes — `showctl` never builds a link
that carries one.

## `fire` — the hardware fallback

When a device fails mid-show, fire what it would have fired, from any machine:

```bash
pnpm showctl fire door_sensor_closed --yes
pnpm showctl fire patch_combo_a --yes
pnpm showctl fire "chess won" --subject Winamp --yes
```

- On an event whose roster holds a **real guest** (anyone but a director's
  persona or a load-test bot), it refuses — exit 3 — unless you also pass
  `--i-know-this-is-live`. On show night that is the point: you do mean it.
- Without `--yes` it asks y/N (a script without a terminal is refused).
- A name no INTERACTION declares (a device signal like `door_sensor_closed`)
  is fired, with a note: only a story rule listening for that name hears it,
  so a typo does nothing — check the spelling in Run → Log.
- A cue the story turns down prints *REFUSED* with the story's `# hosts` line.

Prefer the Run page's buttons when a director is at one: they arm, show NEXT,
and guard against two presses at once.

## What it never does

- Reads the screen state **without** a `name` (a named read is a terminal's
  heartbeat: it would show up on Run → Terminals as a fake terminal).
- Reads `/api/mod/audio` without `router=1` and `/api/mod/lights` without
  `module=1` (either would mark it as the router / the lights module), and the
  VR stations through the list, never `station?id=` (which registers one).
- Opens no SSE stream (a mod stream counts as a director console); `log
  --follow` polls `/api/mod/log?after=`.
- Puts a token in a URL (it rides the `x-loom-token` header), or prints a code,
  a token, a join link's query, or a secret world value.

## Layout

| File | |
|---|---|
| `showctl.ts` | the entry: argv, help, dispatch |
| `lib/client.ts` | the moderator session + the cache |
| `lib/checks.ts` | the server checks (pure) |
| `lib/local.ts` | the per-machine checks behind a fakeable `Probe` |
| `lib/commands.ts` | the commands |
| `lib/logfmt.ts` | log lines + secret masking |
| `lib/ui.ts`, `lib/args.ts` | the table, colours, masks; argv |
| `test/*.test.ts` | `node --experimental-strip-types --no-warnings --test scripts/show/test/*.test.ts` (also run by `scripts/ops/test/run.sh`, which `predeploy.sh` runs) |
| `tsconfig.json` | typecheck only: `core/node_modules/.bin/tsc -p scripts/show` |
