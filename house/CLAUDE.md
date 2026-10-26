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
pnpm --filter @loom/house test        # vitest: 370 passed + 4 skipped, 18 files
pnpm --filter @loom/house typecheck
pnpm --filter @loom/house goldens     # regenerate test/golden/ after a deliberate geometry/route/king change
pnpm --filter @loom/house sync        # copy the show's house.json, goldens and voice vectors into reinstall/vr/
pnpm house:sync                       # repo root: goldens + sync
pnpm test:vr                          # the Godot side diffs against the goldens (needs Godot 4.7)
```

`test/sync.test.ts` fails when `reinstall/vr/house/house.json` or
`reinstall/vr/test/golden/` drift from this package. So **any edit to the
show's `house.json`, or to `geometry.ts` / `route.ts` / `locate.ts` /
`king.ts` / `voice.ts` / `escape.ts` / `presence.ts` / `moment.ts`, ends with
`pnpm house:sync`** and a commit that includes the regenerated files.

## Exports

| Entry | Contents |
|---|---|
| `@loom/house` (`src/index.ts`) | `types.ts` (schema v1 + wire types), `clone.ts`, `validate.ts` (`validateHouse`, `TERMINAL_VIEWS`, `guardWarnings`), `geometry.ts` (`buildWalls` normative, `buildFloors`, `buildRamps`, `doorGap`, `propSolid`), `locate.ts` (`locate`, `heightAt`, `standable`, `solidPropAt`), `route.ts` (`route`, `sampleTrail`), `frames.ts` (`toSpace`, `DEFAULT_SPOT_FOV`, `horizontalFov`), `duck.ts` (`pickDuckSpot`, FNV-1a), `king.ts` (`kingReach`, `withFallenKings`, `kingStateOf`), `escape.ts`, `presence.ts`, `moment.ts` (wave 26, below), `audio.ts`, `lights.ts`, `voice.ts` (`hearsTerminals` / `hearsPlayers`: same room only) |
| `@loom/house/three` (`src/three/`) | the three.js scene: `buildHouseScene`, `createDuck`, `createTrail`, `createKing`, `createHeart`, `createPickup`, `createAvatar`, `loadPicture`, `PoseBuffer`, `spaceGroup`. Peer dependency `three` (optional for the root entry) |
| `@loom/house/voice-on` | `voiceOn(house, spot)` alone, so the terminal's main bundle avoids the codec |

## Wave 26 API (contract `docs/loom-w26-contract.md` C5)

Stage B lanes (spatial, web, vr, terminal) build on these exact signatures.

```ts
// escape.ts — the void (R4)
export const ESCAPE_M = 5, ESCAPE_SLACK = 0.5, ESCAPE_COOLDOWN_MS = 20_000, OUTSIDE_GROUND_MARGIN = 30;
export const ESCAPE_SIGNAL = "simulation escape attempt";
export function outsideGround(house: HouseMap, margin?: number): { floor: string; y: number; rect: [number, number, number, number] } | null;
export function voidDistance(house: HouseMap, p: Vec3): number | null; // null in a room; Infinity on a floor with no rooms

// presence.ts — the terminals' link by room (R5)
export const PRESENCE_HYSTERESIS_M = 0.75, PRESENCE_LINGER_MS = 3000;
export function presenceRoom(house: HouseMap, p: Vec3, prev: string | null): string | null;
// prev holds only inside its polygon, within 0.75 m of the gap of a door joining prev and
// locate's room (null: outside), or over a stair joining them; never through a solid wall.
export function linkedSpots(house: HouseMap, rooms: Iterable<string | null>): Set<string>; // never view "reinstall"

// route.ts — the path reveal (R2)
export const PATH_REVEAL_MS = 60_000;

// moment.ts — the heart (R6) and the pickup (R7)
export const HEART_SIGNAL = "simulation heart reached", PICKUP_SIGNAL = "simulation pickup taken";
export const HEART_INSET_M = 0.3, PICKUP_REACH_M = 0.9, PICKUP_SLACK_M = 0.3;
export function heartReached(house: HouseMap, feet: Vec3, heart: Prop): boolean;
export function pickupReach(house: HouseMap, feet: Vec3, prop: Prop, slack?: number): boolean;
export function momentProp(house: HouseMap, id: string, kind: "heart" | "pickup"): Prop | null;
export function heartProps(house: HouseMap): Prop[];
export function pickupProps(house: HouseMap): Prop[];
export function propSignal(prop: Prop): string; // signals.reached / signals.taken ?? the default; "" for other kinds

// types.ts / validate.ts
PropKind += "heart" | "pickup"; Prop.item?: string; Prop.signals += reached?, taken?;
Assignment.picked?: string[]; Assignment.heartHeard?: boolean;
export const PROP_SIGNAL_KEYS: Record<string, readonly string[]>; // king: won/lost/drawn/hit/fallen, heart: reached, pickup: taken

// voice.ts — same room only (R5); VoiceRouteOptions is { only? } (keep is gone)
hearsTerminals(house, { p, room? }, { only? }); hearsPlayers(house, spot, players, { only? });

// three/ — @loom/house/three
createHeart(prop?): Heart; createPickup(item): Pickup; heartPulse(t); HEART_BEAT_S; PICKUP_HOVER;
buildHouseScene(house, { ground?: boolean; pickups?: boolean; … }); // both default false
HouseScene.hearts / .pickups / .ground; HouseScene.setPickupTaken(id, taken): boolean;
// the heart is always built, visible only while every King on the map has fallen (showKing drives it)
```

- Gains are always 1 now (the wire keeps the field). The server must pass
  each player's presence room as `room` (`SpatialHub.voicePlayers()`, C8);
  with no `room` the rule `locate`s the pose (no hysteresis).
- A heart or a pickup has no `label` (refused) and is not solid by
  default. A pickup needs `item`. An older server or bundle refuses both
  kinds: deploy the server first (contract C14).
- GDScript ports: `reinstall/vr/house/house_escape.gd` (`HouseEscape`),
  `house_moment.gd` (`HouseMoment`), `HouseLocate.presence_room` /
  `linked_spots` + the presence constants, `HouseRoute.PATH_REVEAL_MS`,
  `VoiceCodec.hears_terminals` / `hears_players`. `house_builder.gd` builds
  nothing for a heart or a pickup yet (the vr lane draws them).
- `docs/loom-reinstall.md` §2.4 still describes the old 12 m / 8 m reaches
  until the wave 26 docs step rewrites it (the contract gives that file to
  the docs / status step); the code and this file are the rule meanwhile.

## Test layout

| Path | What |
|---|---|
| `test/fixtures/*.json` | small maps (`two-rooms`, `l-room`, `hole`, `stair`, `yard`, `tie`, `props`, `three-floors`) + `audio-*`, `lights-*` (shared with stagehand's Python tests) + `voice-mulaw.json` (μ-law vectors, copied to VR) |
| `test/golden/<map>.{walls,routes,locate,escape,presence}.json` | the GDScript port's reference; `show.king.json` / `show.fallen.json` for the King, `show.moments.json` for the heart and the disk, `constants.json` for the wave 26 constants |
| `test/maps/` | frozen older show maps (`two-floor*`, `three-floor*`) for tests that pin mechanics, so a show-map edit never breaks them |
| `test/show.test.ts` | the real show maps (`house.json` + `house.shed.json`) validate and route; the heart's placement and the disk's distance from the duck spots and the trails |

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
