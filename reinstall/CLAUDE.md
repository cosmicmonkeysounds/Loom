# reinstall — agent guide

The reinstallation games for *Trapped in the Internet*: a marked or
captured program walks a virtual copy of the house to Gerald, the golden
duck, and is released. Two games share one simulation, plus the house map
editor. MIT.

| Folder | What | Stack |
|---|---|---|
| `web/` (`loom-reinstall`) | the web game, the wizard flow and the map editor at `/reinstall/map` | Vite + React 18 + three.js, in the pnpm workspace; served by the event server at `/reinstall/` |
| `vr/` | the Quest 3 game | Godot 4.7 OpenXR (GDScript only). **Not** in the pnpm workspace or the Docker image |

Human overviews: [`README.md`](./README.md), [`web/README.md`](./web/README.md),
[`vr/README.md`](./vr/README.md). The contract is
[`../docs/loom-reinstall.md`](../docs/loom-reinstall.md) (normative; §3 the
web game, §5 VR, §2 the server, §1 the map). The shared map code is
[`../house`](../house/CLAUDE.md); the King's chess is [`../chess`](../chess/CLAUDE.md)
and is played only at a wall terminal, never in these games.

## Commands

```bash
pnpm --filter loom-reinstall dev          # :5176, proxies /api + /e to LOOM_SERVER (default :7000)
pnpm --filter loom-reinstall build        # dist/ (base /reinstall/)
pnpm --filter loom-reinstall test         # vitest: 538 tests, 41 files
pnpm --filter loom-reinstall typecheck
pnpm dev --reinstall                      # repo root: the dev stack + this Vite on :5176
pnpm test:vr                              # = reinstall/vr/test/run.sh [godot]: 730 checks + quest.sh 27
pnpm house:sync                           # after any show-map or house geometry change
reinstall/vr/tools/quest.sh setup|build --station vr-N|install   # the Quest APKs
```

`reinstall/vr/test/run.sh` takes the Godot binary as its argument
(`/Applications/Godot.app/Contents/MacOS/Godot` on a Mac). An end-to-end
run against a live server: `godot --headless --path reinstall/vr --xr-mode
off -- --server … --code <mod> --guest g-… --autopilot` (exits 0 after a
find; `--hit-king` hits the King first).

## Where the code is

| Path | What |
|---|---|
| `web/src/app.tsx`, `flow.tsx`, `flow-state.ts`, `program.ts`, `wizard.tsx` | the standalone device's screens; the choose / play / send flow (mounted by the tent terminal too); what the wizard says about a program |
| `web/src/config.ts`, `api.ts`, `spatial.ts`, `kiosk.ts` | provisioning (`?code= name= role= camera= arrows= voice=`), the spatial routes and stream, the 2 s holds |
| `web/src/game/` | `engine.ts` (three.js), `Play.tsx` + `joystick.tsx`, and pure `physics.ts`, `input.ts`, `pump.ts` (10 Hz latest-only poses), `hud.ts`, `fight.ts` (the King), `trail.ts`, `leash.ts`; `cams.ts`, `voice.ts`, `audio.ts` |
| `web/src/map/` | the editor: `MapApp.tsx`, `Canvas.tsx`, `Toolbar.tsx`, `Inspector.tsx`, `Panels.tsx`, `Preview3D.tsx`, `ProjectBar.tsx`, and pure `plan.ts`, `edit.ts`, `doors.ts`, `yards.ts`, `structure.ts`, `props.ts`, `history.ts`, `check.ts`, `project.ts`; speakers `audio*.ts` + `AudioPanel.tsx`; lights `lights*.ts` + `LightsPanel.tsx` |
| `vr/house/*.gd` | literal GDScript ports of `@loom/house` (walls, locate, route, frames, duck, the King), diffed against `test/golden/` |
| `vr/net/` | `server_link.gd` (the autoload: config, polling, begin / pose / found / hit, the stream), `cam_feeds.gd`, `voice_link.gd` + `voice_codec.gd`, `avatar_cache.gd`, `config.gd` |
| `vr/game/`, `vr/player/` | the state machine, the lobby (PICK YOUR PROGRAM tiles, SET UP THIS HEADSET), the duck, trail, ghosts, HUD; the XR rig and pointer |
| `vr/house/house.json`, `vr/test/golden/` | **copies** written by `pnpm house:sync`; never edit them here |

The server half is `core/server/spatial.ts` (`SpatialHub`), `spatial-cams.ts`,
`spatial-voice.ts` and the `/api/spatial/*` + `/api/mod/spatial/*` routes.

## Rules that span both games

- **Only the outcome is journaled.** Poses are memory only. A find commits
  `the simulation completed` + `the golden duck`; a King hit sets
  `Night.king_hp − 1` and fires `king hit` (`king fallen` at 0). A server
  restart ends every walk (sessions live in memory).
- **The server judges.** The found rule (`nearDuck`: ≤ 2 m plan, within
  `DUCK_MAX_RISE` or the same floor) and the King's reach (`kingReach` plus
  the server's slack) are the server's; both games pre-check tighter so a
  claim is never refused for height.
- **One hit per program per visit**; a visit ends at the duck, not at
  Leave or a timeout (`kingHit` on the assignment).
- **Only marked or captured programs play**; a `force: true` begin is for
  directors only, and the tent terminal never sends it.
- **Maps change live.** A save or a tent ⇄ shed switch carries sessions
  over: a moved duck is re-dealt (`duck` frame), a player who is no longer
  `standable` goes back to the spawn (`bodyAfterRemap` on the web,
  `respawn_after_remap` in VR). A session plays only on the map version it
  was dealt.
- **The tent has no voice link.** The tent spot is `voice: false` and the
  web game's voice link is off by default; the terminals hold their mic
  while playing sound, the games raise their gate (D5b).

## Conventions and gotchas

- **Old devices.** `web/` builds for `chrome87` / `safari14`: use
  `@loom/house` `cloneData`, no regex lookbehind; `scripts/accept/K-14.sh`
  checks the bundle. The game itself needs WebGL2 (it refuses Play here
  without it); the terminals' raycaster is not a fallback for the game.
- **Aliases.** `web/` imports the terminal's scanner (`@loom/terminal/…`)
  and the play app's `api` (`@loom/play/…`) as source. The terminal, in
  turn, imports this app's `flow.tsx` as `@loom/reinstall`. A change to the
  flow's props or CSS affects the tent laptop; run the terminal's
  `reinstall-*` tests too.
- **Pure first.** Physics, input, the pump, the HUD, the trail and every
  map edit are pure and node-tested; keep new logic that way.
- **GDScript ports stay literal.** A change to `@loom/house`'s geometry,
  routing or the King's reach needs the same change in `vr/house/*.gd`,
  regenerated goldens and a green `pnpm test:vr`.
- **Station config.** VR reads `user://station.json` (written by the
  in-headset setup) over the committed `config/station.json` (which must
  keep `CHANGEME`; a test checks it). Never write `res://`.
- **Fiction.** The wizard and the HUD never promise the real server-room
  door; the King's stakes line belongs to the chess terminal.

## Pointers

- The map editor walkthrough: `docs/help/authoring/39-house-map.md`
  (test-pinned by `web/test/help-docs.test.ts` and `lights-help.test.ts`).
- The player's guide: `docs/help/play/11-reinstallation.md`.
- Show devices and kiosk flags: `docs/trapped/kiosk.md`.
