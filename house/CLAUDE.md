# house — agent guide

`@loom/house`: the shared spatial model. One coordinate frame (metres, Y up,
`+z` south, yaw 0 = north, counter-clockwise positive) used by the event
server (`core/server/spatial*.ts`, `audio.ts`, `lights.ts`), the web game
and map editor (`reinstall/web`), the Godot VR game (`reinstall/vr`, via
ported GDScript + goldens), the wall terminals (`terminal`) and stagehand's
Python mirrors of the audio and lights rules. Pure TypeScript, no runtime
dependencies, no `node:` imports in `src/`. Consumed as source
(`workspace:*`, no build step). MIT.

The human overview with every module and constant is [`README.md`](./README.md).
The normative contract is [`../docs/loom-reinstall.md`](../docs/loom-reinstall.md):
§1 the map, §1.2 the geometry (normative, golden-tested), §1.3 where maps,
`audio.json` and `lights.json` live, §1.4 lights, §2.4 the voice wire. When
code and that file disagree, fix one of them in the same change.

## Commands

```bash
pnpm --filter @loom/house test        # vitest: 329 passed + 4 skipped, 16 files
pnpm --filter @loom/house typecheck
pnpm --filter @loom/house goldens     # regenerate test/golden/ after a deliberate geometry/route/king change
pnpm --filter @loom/house sync        # copy the show's house.json, goldens and voice vectors into reinstall/vr/
pnpm house:sync                       # repo root: goldens + sync
pnpm test:vr                          # the Godot side diffs against the goldens (needs Godot 4.7)
```

`test/sync.test.ts` fails when `reinstall/vr/house/house.json` or
`reinstall/vr/test/golden/` drift from this package. So **any edit to the
show's `house.json`, or to `geometry.ts` / `route.ts` / `locate.ts` /
`king.ts` / `voice.ts`, ends with `pnpm house:sync`** and a commit that
includes the regenerated files.

## Exports

| Entry | Contents |
|---|---|
| `@loom/house` (`src/index.ts`) | `types.ts` (schema v1 + wire types), `clone.ts`, `validate.ts` (`validateHouse`, `TERMINAL_VIEWS`, `guardWarnings`), `geometry.ts` (`buildWalls` normative, `buildFloors`, `buildRamps`, `doorGap`, `propSolid`), `locate.ts` (`locate`, `heightAt`, `standable`, `solidPropAt`), `route.ts` (`route`, `sampleTrail`), `frames.ts` (`toSpace`, `DEFAULT_SPOT_FOV`, `horizontalFov`), `duck.ts` (`pickDuckSpot`, FNV-1a), `king.ts` (`kingReach`, `withFallenKings`, `kingStateOf`), `audio.ts`, `lights.ts`, `voice.ts` |
| `@loom/house/three` (`src/three/`) | the three.js scene: `buildHouseScene`, `createDuck`, `createTrail`, `createKing`, `createAvatar`, `loadPicture`, `PoseBuffer`, `spaceGroup`. Peer dependency `three` (optional for the root entry) |
| `@loom/house/voice-on` | `voiceOn(house, spot)` alone, so the terminal's main bundle avoids the codec |

## Test layout

| Path | What |
|---|---|
| `test/fixtures/*.json` | small maps (`two-rooms`, `l-room`, `hole`, `stair`, `yard`, `tie`, `props`, `three-floors`) + `audio-*`, `lights-*` (shared with stagehand's Python tests) + `voice-mulaw.json` (μ-law vectors, copied to VR) |
| `test/golden/<map>.{walls,routes,locate}.json` | the GDScript port's reference; `show.king.json` / `show.fallen.json` for the King |
| `test/maps/` | frozen older show maps (`two-floor*`, `three-floor*`) for tests that pin mechanics, so a show-map edit never breaks them |
| `test/show.test.ts` | the real show maps (`house.json` + `house.shed.json`) validate and route |

## Conventions and gotchas

- **Runs on old tablets.** Use `cloneData` (not `structuredClone`) and
  avoid post-Chrome-87 APIs and regex lookbehind anywhere a terminal or the
  web game imports.
- **Integer millimetres.** `buildWalls` works in integer mm; door
  tolerance is checked against the mm-rounded wall line. Prop obstacles are
  rounded to µm (`um`) so ports agree. Never change rounding without
  regenerating goldens and re-running `pnpm test:vr`.
- **Validation is the server's gate.** The event server refuses a map
  `validateHouse` rejects, and an older server refuses newer fields (a king
  `hp` over 9 on a pre-wave-11 server, `view: "reinstall"` before 18b).
  Additive schema changes must keep older maps valid.
- **Speakers and lights never live in the map.** `audio.json` and
  `lights.json` are separate project files (a speaker or light edit never
  bumps the map version). Do not name them `house.<x>.json`: that pattern
  is a map variant.
- **Python mirrors.** stagehand re-implements `resolveTargets`,
  `planLook`, `clampForSafety` and the payloads in Python; the shared
  fixtures here pin both sides. A rule change here needs the same change in
  `stagehand/src/stagehand/{audio,lights}/` and their tests.
- **Show coordinates in docs.** Spot positions quoted in docs come from
  `core/examples/trapped-in-the-internet/house.json`; read them from the
  file, not from older docs.

## Pointers

- Map editor (where maps, speakers and lights are edited):
  `reinstall/web/src/map/`, Help → `docs/help/authoring/39-house-map.md`.
- Server hub: `core/server/spatial.ts`, `spatial-voice.ts`, `spatial-cams.ts`.
- VR port: `reinstall/vr/house/*.gd`.
