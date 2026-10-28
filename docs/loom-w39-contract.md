# Wave 39 contract: the house lights meet the reinstallation games

2026-10-28. Lanes `oct31-w39/<lane>`. This file is the interface between the
lanes: names, shapes and files here are binding; anything not written here is
the lane's own choice. When code and this file disagree, fix one of them in
the same change.

## C0. What the user asked for

1. **A program pulses the real light it walks under.** In the web or the VR
   reinstallation game, when a program walks under a light, that light in the
   real house shows their presence by pulsing.
2. **The games light their scenes with the real lights.** The colour and level
   each real fixture shows now lights the matching spot in the virtual house.
3. **Spruce up both games**: lights and post-processing in Godot and in the
   WebGL game.
4. **The web game must run on the tent's terminal**: a 2014 MacBook (quad-core,
   16 GB, Intel Iris Pro or a GT 750M), with variable quality settings.

Decisions taken for the lanes (the user can overrule any of them):

- **A safety fixture never pulses.** A firmware breathe goes dark and the
  safety floor can't hold (halls, bathrooms, the server-room bulb). With the
  show's `lights.json` the pulsing set is the `rooms` zone.
- **The pulse is the bulb's own firmware effect** (`effect: breathe` on
  Zigbee2MQTT; WLED's Breathe `fx 2`). One command when a program arrives,
  one every `LIGHT_PRESENCE_REPEAT_MS` while it stays, one when it leaves:
  never a stream of brightness steps over Zigbee. A breathe on a bulb that a
  look turned OFF does nothing: a dark scene stays dark.
- **The server judges presence**, from the poses it already has, as it judges
  the duck: both games get it for free and the module needs no map maths.
- **Nothing ships with this wave by itself.** It merges to master; the user
  decides when to ship (the show is 2026-10-31).

## C1. `@loom/house` (done in `oct31-w39/contract`; binding)

`house/src/lights.ts`:

```ts
LightsConfig.presence?: LightPresence;   // absent: on, defaults
interface LightPresence { enabled?: boolean; to?: string[]; radius?: number; effect?: "breathe" | "blink" | "okay" }
export const LIGHT_PRESENCE_EFFECTS, LIGHT_PRESENCE_RADIUS_M = 1.6, LIGHT_PRESENCE_RADIUS_MIN = 0.5, LIGHT_PRESENCE_RADIUS_MAX = 5,
  LIGHT_PRESENCE_LEAVE_M = 0.6, LIGHT_PRESENCE_HOLD_MS = 4000, LIGHT_PRESENCE_REPEAT_MS = 12_000;
export function presenceSettings(lights): { enabled; to; radius; effect };   // defaults filled
export function presenceFixtures(lights, house): LightFixture[];             // presence.to minus safety; [] when off
// validateLights: a malformed block is a problem; targets reaching nothing / naming a safety fixture warn.
```

`house/src/lights-presence.ts`:

```ts
interface PresencePlayer { session: string; room: string | null; p: Vec3 }  // room = the presence room
interface PresenceEntry { sessions: string[]; since: number; last: number }
export function presenceStep(lights, house, players, prev: ReadonlyMap<string, PresenceEntry>, now): Map<string, PresenceEntry>;
export function samePulsed(a, b): boolean;                    // same fixture set
type GameLightsSource = "house" | "estimate";
interface GameLight { id; room; pos: {x,y,z}; kind; color: "#rrggbb"; level: 0..1; effect: LightEffect | null; pulse: boolean; safety: boolean }
interface GameLights { at: number; source: GameLightsSource; pulse: LightPresenceEffect | null; lights: GameLight[] }
export function mergeLightState(was, set): LightState;        // a bulb's memory of commands
export function lampOf(state): LampShown;                     // OFF → 0; missing → LAMP_SETTLED's
export function gameLight(f, lamp, pulse): GameLight;
export function gameLightsOf(raw): GameLights | null;         // the clients' decoder
export function pulseFactor(t, period = 2): number;           // 1 → 0.35 → 1, the games' pulse curve
```

Under = the fixture's `room` is the player's presence room **and** the plan
distance (x, z) ≤ `radius` (+ `LIGHT_PRESENCE_LEAVE_M` for a session already
under it). Held `LIGHT_PRESENCE_HOLD_MS` after the last program left (the
entry stays with `sessions: []`). Tests: `house/test/lights-presence.test.ts`.
The show's `lights.json` carries `presence: {enabled: true, to: ["rooms"],
radius: 1.6, effect: "breathe"}`.

## C2. The event server (lane `server`)

Files: `core/server/lights.ts`, a new `core/server/lights-shown.ts`,
`core/server/spatial.ts`, `core/server/event-runtime.ts`, their tests,
`docs/loom-reinstall.md` §1.4 + §2.2, `core/CLAUDE.md` if it lists routes.

### C2.1 Presence

- `SpatialHub` runs `presenceStep` on every pose flush (≤ 10 Hz) over its live,
  claimed sessions (`{session: s.id, room: s.presence, p: s.pose.p}`), with
  the lights config in force (an injected getter; the hub must not import
  `LightsHub`) and the house in force; also when a session leaves, on a reset
  and on a map swap. A fixture that has a program under it **only through a
  director's `force`** walk still counts (any live session).
- When the pulsed **set** changes (`samePulsed` false), `LightsHub.setPresence(entries)`
  bumps `presenceSeq` and wakes the long poll.
- `LightsView` (GET `/api/mod/lights`) gains
  `presence: {seq: number, fixtures: Array<{fixture: string, since: number}>}`
  (`since` server ms; file order). The GET takes a `presence=<seq>` cursor: it
  answers at once when `presenceSeq > cursor` (like `tests`). An older module
  sends no cursor and ignores the field.

### C2.2 What the fixtures show

- `POST /api/mod/lights/shown {fixtures: {[id]: LightState}}` (a mod token,
  like `/devices`; never on the host allowlist): the module's model of every
  fixture (C3.2), replacing the last whole. Unknown ids are kept out; a state
  is read with `lightStateProblems` (a bad one dropped, not the post). 400
  only when `fixtures` is not an object. Memory only. Answers `{ok: true}`.
- The **source** is `house` while the module is online (`LightsView.module.online`)
  and its last `shown` is ≤ `LIGHTS_SHOWN_FRESH_MS` = 30 000 ms old; else
  `estimate`.
- The **estimate** (`lights-shown.ts`): per fixture, the last look or test that
  reached it, replayed with `planLook` + `previewAt` at `now − start` from
  what the fixture showed when it started (a `restore` look gives back that
  start state). Fed by: a live batch's `cue X` directives naming a look (next
  to `deskCues`; never on a journal replay), every `LightsHub.test` with a
  `look` or a `{fixture, set}`, and the config's `boot` look at start and
  after a story reset (`kind: reset`). An identify test is ignored.

### C2.3 The games' frame

- The spatial stream gets a `lights` frame, `GameLights` (C1). `lights[]` is
  every fixture in the config in force (file order; a fixture whose room is
  not on the map in force is left out), `pulse` true for a fixture in the
  current presence map, top-level `pulse` = `presenceSettings().effect` or
  null when presence is off.
- Sent: to each new stream subscriber right after its `hello`; to all on any
  change (a `shown` post, a presence change, a cue / test, a config or map
  change), at most once per `GAME_LIGHTS_MIN_MS` = 250 ms (trailing edge kept);
  and while the source is `estimate` and a fade, effect or loop is running,
  re-computed every 250 ms and sent only when it changed (levels rounded to
  0.001, so a settled house sends nothing). Never on a ping-only connection
  with no subscriber.
- Older clients ignore an unknown frame (both games and the terminals do
  today; the lanes must keep it so).

## C3. stagehand `lights` (lane `stagehand`)

Files: `stagehand/src/stagehand/lights/*.py`, its tests, `stagehand/README.md`
(the lights section), `docs/loom-show-control.md` if it lists the wire.

### C3.1 Pulses

- The long poll sends `presence=<seq>` (primed by the first answer, like tests)
  and reads `presence.fixtures`.
- A fixture entering the set (and still eligible locally: in the doc's
  `presence` targets per C1, never `safety`, presence enabled): Zigbee /
  Zigbee group → publish `{"effect": <presence.effect>}` on its `/set` topic,
  then again every `LIGHT_PRESENCE_REPEAT_MS` (12 s) while it stays. WLED →
  its breathe (`seg fx 2`; blink → `fx 1`; okay → `fx 2`) once.
- A fixture leaving: Zigbee → `{"effect": "finish_effect"}`; WLED → the `fx`
  it had before (its model's effect, else 0) — never a full re-publish.
- A pulse never takes a fixture away from a running look (the sequencer's
  `running` stays as it is) and a look's command never stops a pulse's
  repeat. An identify test on a pulsed fixture wins for its 2 s.
- Python mirror of `presenceSettings` / `presenceFixtures` in `routing.py`,
  pinned by a new shared fixture `house/test/fixtures/lights-presence.json`
  (the lane writes it from the TS functions and copies it byte for byte to
  `stagehand/tests/fixtures/house-lights/`; a house test pins the TS side).

### C3.2 The report

- The module keeps `shown: dict[fixture, state]`: every command it publishes
  (looks, restores, tests, catch-ups, pulses) merged like `mergeLightState`
  (C1). It posts `POST /api/mod/lights/shown {fixtures: shown}` 250 ms after
  a change (debounced; at most 4 a second) and every 20 s anyway (the
  freshness keepalive). A 404 (an older server) is logged once, then the
  module stops posting until its next restart.

## C4. The web game (lane `web`)

Files: `reinstall/web/src/game/**`, `reinstall/web/src/spatial.ts`,
`reinstall/web/src/config.ts`, `reinstall/web/src/map/` (the presence block in
`LightsPanel`), their tests, `reinstall/web/README.md`,
`docs/help/authoring/39-house-map.md` (keep `help-docs.test.ts` and
`lights-help.test.ts` green), `docs/loom-reinstall.md` §3 (a short
subsection). `house/src/three/` only for additive, opt-in helpers that the
terminals don't use by default (their world view must not change).

- **Real lights in the house**: each `GameLight` is a bulb (emissive mesh +
  additive glow sprite, cheap, always drawn) at its `pos` in its colour ×
  level, pulsing with `pulseFactor` when `pulse`. The nearest lit fixtures
  (same floor first) get real `PointLight`s from a **fixed pool** per quality
  tier (the pool's size never changes at runtime: three.js recompiles every
  material when the light count changes); unused pool lights have intensity
  0. With a `lights` frame the ambient lights (hemi + sun) dim toward a night
  floor (never so dark the duck hunt suffers); without one the house looks
  as today.
- **Post-processing**: bloom (glowing screens, the trail, the duck, the
  bulbs), a grade pass (filmic tone map, vignette, light grain; a faint
  chromatic edge on high), via three's `EffectComposer` (`three/examples/jsm`).
- **Quality**: `low | medium | high`, plus `auto` (the default). `?quality=` on
  the URL (also passed through by the tent terminal's flow), and a control in
  the game's settings, remembered in `localStorage` (guarded). Tiers (the
  lane tunes the numbers):

  | | pixel ratio | point lights | bloom | grade | antialias |
  |---|---|---|---|---|---|
  | low | ≤ 1 (0.75 under pressure) | 2 | off | tone map only (renderer) | off |
  | medium | ≤ 1 | 4 | half resolution | vignette + grain | FXAA-free |
  | high | ≤ 1.5 | 8 | full | + chromatic edge | MSAA on the target (WebGL2) |

  `auto` starts at `medium` on a desktop GPU and `low` on a coarse pointer,
  measures the frame time and steps down when the median of a 2 s window is
  over 24 ms (under ~42 fps), up after 10 s under 13 ms, at most one change
  per 5 s, never above the URL's / the setting's cap. Pure and node-tested
  (`quality.ts`), like `physics.ts`.
- Builds for `chrome87` / `safari14` still; `scripts/accept/K-14.sh` passes;
  the first-load size grows by the post-processing passes only (lazy-import
  them if it is large).

## C5. The VR game (lane `vr`)

Files: `reinstall/vr/**` (GDScript only), `reinstall/vr/test/`,
`reinstall/vr/README.md`, `docs/loom-reinstall.md` §5 (a short subsection),
`reinstall/vr/config/station.json` (a new `graphics` key, default `medium`).

- `server_link.gd`: the `lights` frame → `signal lights_changed(lights: Dictionary)`,
  the latest kept (`lights` property), a GDScript port of `gameLightsOf` and
  `pulseFactor` (`house/house_lights.gd` or similar, unit-tested in
  `test/run.sh`).
- The house: a bulb (unshaded emissive sphere + glow quad) per `GameLight`,
  `OmniLight3D`s from a fixed pool (low 2, medium 4, high 5 — with the duck, heart and disk lights ≤ 8 on a mesh; no shadows, the
  nearest lit fixtures on the player's floor), pulsing with `pulseFactor`;
  the ambient dims toward a night floor while frames arrive.
- `HouseLook.environment()`: a filmic / ACES tone map and, on `high`, glow
  (the Mobile renderer has it) — Quest 3 must hold its frame rate: `medium`
  is the default and carries no glow. `graphics` in `station.json` (and the
  in-headset setup if it is cheap to add) picks the tier.
- `pnpm test:vr` stays green; comfort rules unchanged.

## C6. Docs and help

- `docs/loom-reinstall.md` §1.4 (presence), §2.2 (the `lights` frame), §3 and
  §5 (each game's lights and quality): the lane that owns the code writes its
  section.
- `docs/help/authoring/39-house-map.md` (the presence block, lane `web`);
  the guests' play help never describes the pulse (it is a surprise).
- `house/CLAUDE.md` gets a Wave 39 API block (done in the contract lane).
