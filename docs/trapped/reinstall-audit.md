> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.

# Audit: the reinstallation games + spatial layer vs. "Inside the Internet"

Scope: `house/`, `reinstall/web`, `reinstall/vr`, `core/server/spatial.ts` and its routes in
`core/server/event-runtime.ts`, `docs/loom-reinstall.md`, `reinstall/README.md`, the terminal's
world/mirror view (only where it touches the tent), and the show's current story hooks
(`core/examples/trapped-in-the-internet/`). The source design is
`Trapped In The Internet story/` (STORY BEATS.md, Story Overview, Character Sheet, Clippy Instructions).

Audited 2026-10-14. All paths are relative to `packages/loom/`.

---

## 0. TL;DR

- **The core loop works in code, and every suite is green today.** I re-ran them: `@loom/house` 122/122,
  `loom-reinstall` 120/120, core `spatial` + `spatial-routing` 44/44, Godot VR headless 225 checks with
  0 failures (the autopilot reaches all 10 show duck spots). The pieces are: drag to tent → scan pass
  on the tablet → play on a Quest or the tablet → follow golden chevrons to a randomly dealt spot → found →
  `the simulation completed` releases the program → the TV and terminals watch.
- **None of it has run on real hardware yet.** No Quest APK has been exported. `reinstall/vr/build/`
  and `reinstall/vr/android/` do not exist, and the memory note says JDK 17 was never configured.
  Nothing has run on a real tablet or TV either. The CLAUDE.md "verified end to end" run was over HTTP
  plus headless Godot against a scratch server. The review-round fixes (moved ducks, pause, save
  conflicts, prop routing, fov) are unit-tested only.
- **Goose vs. duck:** the code deliberately uses a golden **duck** called "Gerald", which ties to the
  Maps and Ducks billboard. **The egg-laying and fly-away animation already exists in all three
  renderers** (web, VR, terminals). Two things differ from the story. (a) It is a duck, not a goose:
  a cosmetic and copy change. (b) **The find is proximity-only, with no A button.** Adding an optional
  "press A" step is small, because the OpenXR action map already binds `ax_button`. Roughly half a day,
  including the contract and doc change.
- **Missing for the story:**
  1. The **instructional video** (WebMD). Today it is text lines on the guest's phone, spoken by a
     "The Tablet" character. Nothing plays video anywhere.
  2. **Bathroom Mode from the tent.** It exists only as a phone button. The tablet and headset have
     nothing, and `afk` has no effect anywhere.
  3. **Zip everyone out at once.** There is no bulk release and no "end all spatial sessions". A
     per-guest release also does not end that guest's game session.
  4. **Excel's virus.** Nothing in the games can be picked up. Designs are below. One works with zero
     code today.
  5. **The house map is a placeholder.** It also has **no Server Room** and no living-room fireplace
     wall that matches reality.
  6. **Tent queueing.** `capacity: 3` is not enforced and there is no queue order, but Truth Pong can
     send 5–10 people at once.
- **Hard dependencies for the story rewrite.** `event-runtime.ts:1118-1119` hard-codes the event names
  `the simulation completed` and `the golden duck`. The release relies on the ROLE var `corrupted`, on
  `release program from The Internet`, and on The Internet being `prison: true`. The rewrite must keep
  these names, or the code must change with it.

---

## 1. What exists, and its verification status

| Piece | Where | Status | Verified how |
|---|---|---|---|
| House map, one frame, schema v1, validation, walls/floors/ramps, `locate`, `route` (chevrons), `pickDuckSpot` | `house/src/*.ts` | done | 122 vitest + 24 goldens; ran green 2026-10-14 |
| Three.js scene, duck (incl. `layEgg()`), trail, ghosts | `house/src/three/*.ts` | done | unit tests only; **never seen on a real tablet** |
| SpatialHub (sessions, stations, poses, `found`, map hot-swap) | `core/server/spatial.ts` | done | `spatial.test.ts` + `spatial-routing.test.ts` 44/44; HTTP e2e against a scratch server (CLAUDE.md) |
| Routes `/api/spatial/*`, `/api/mod/spatial/*` | `core/server/event-runtime.ts:982-1105, 2555-2621` | done | as above |
| Tablet game + wizard (setup → scan → Play here / Send to headset → play → found) + map editor `/reinstall/map` | `reinstall/web/src/` | done | 120 vitest; ran green. **Not driven in a real browser or tablet** after the review fixes (CLAUDE.md "not yet re-run … in a browser") |
| Quest 3 game (Godot 4.7 OpenXR, thumbsticks, lobby picker, station polling, egg + flight, autopilot) | `reinstall/vr/` | done in code | 225 headless checks, ran green with `/Applications/Godot.app`; headless autopilot against a live server once (CLAUDE.md). **APK never exported, never on a headset** |
| Terminal world view + `view=mirror` (the TV) | `terminal/src/world/`, `terminal/src/app.tsx:119, 547-565` | done | terminal unit tests; **not checked live on a TV** |
| Story hooks | `main.loom:171-207, 221-227, 293-299, 351-358`, `beats/internet.loom`, `cast/kit.loom:43-52` | done for the duck/release path | `trapped-in-the-internet` core tests |

---

## 2. The story vs. the code, item by item

### 2.1 The tent: a clearly marked exit, two VR headsets, a tablet

Story: "Inside the internet – there is a clearly marked exit for safety, two VR headsets, and a tablet
playing a video." (Story Overview §Inside the Internet)

Code:
- **Physical setup is modelled in the virtual house** (`core/examples/trapped-in-the-internet/house.json`).
  The `tent` room is the spawn (`house.json:122`). Props include `vr-station-1`/`-2`, `tablet-stand`,
  `tablet` ("SCAN YOUR PASS"), `exit-sign` and `tent-sign` (`house.json:158-161`). There is a `tent`
  terminal spot (`house.json:106`). The **placeholder** puts the tent in a basement "Registry" room, which
  is invented.
- **Two headsets** = two Godot stations. Each has its own `station`/`name` in `user://station.json` or
  the command line (`reinstall/vr/README.md` §Station config; committed placeholder
  `reinstall/vr/config/station.json`, `code: CHANGEME`). The tablet lists online stations
  (`GET /api/mod/spatial/stations`, online = seen < 5 s, `spatial.ts:35`) and offers **Send to Headset N**.
  Assignments are parked until the headset's first pose claims them (`docs/loom-reinstall.md:393-398`).
- **Tablet** = `loom-reinstall` at `/reinstall/?code=<mod>&name=Tent tablet&role=both`
  (`reinstall/web/README.md:40-48`). With `role=both` it can also **play** the game itself, so the tent
  has 3 concurrent players: 2 Quests and the tablet.
- The **story LOCATION** `The Internet` is `prison: true`, `sealed: true`, `capacity: 3`, `hidden: true`
  (`main.loom:79-84`). `capacity` is **not enforced** anywhere in the sim. `grep capacity` hits only
  `model.ts:90,532`. See §2.10.
- The **exit** exists only as a virtual prop. Using it is "hacking", but only as copy on the guest's
  phone (`beats/internet.loom` The Tablet line 5). Nothing detects a captured program leaving.

Gaps / to do:
- [ ] Physical: battery LED EXIT sign, clear egress path, cable management (see §4).
- [ ] Optional: a "who is in the Internet / who left without Bathroom Mode" view for the Antivirus.
      Today the candidates list (`GET /api/mod/spatial/candidates`, captured first, `spatial.ts:180-188`)
      is the closest thing.

### 2.2 The instructional video (WebMD, "wellness bot who introduces guests to their re-education experience")

Story: the captured program is "directed to watch a video playing on a tablet … a narrator guides them".
In the Character Sheet, WebMD (Julia Tufts) is the guide.

Code:
- **No video playback exists anywhere.** `grep -i video` in `reinstall/web/src` and `terminal/src` finds
  only the camera scanner's `<video>` (`terminal/src/scanner.tsx:71-158`).
- The "video" today is the **`Reinstallation` beat**. It plays privately on the captured guest's
  **phone** the moment they are captured (`main.loom:173-176` → `-> Reinstallation`). The speaker is a
  character called **"The Tablet"**, not WebMD (`beats/internet.loom:12-31`). There is also an
  interactive `The Tablet Video` beat (`internet.loom:33-46`).
- The tablet wizard goes straight from the setup/scan screen to play (`reinstall/web/src/app.tsx:1-9`,
  screens `setup | scan | choose | starting | sent | play`). There is no attract loop and no video step.
- The copy in the beat still says "There are no buttons" (`internet.loom` line 3). That must change if
  §2.3's A button is added.

Proposal (software):
- [ ] **Story rewrite:** make **WebMD** the narrator (`CHARACTER WebMD`, Julia's part) and retire
      "The Tablet". Julia is a confirmed actor, so she can either **staff the tent live** (her lines then
      come to her performer booth as cues) or **pre-record** the video. Decide which.
- [ ] **Tablet video step** (`reinstall/web`, ~0.5 day): an attract/idle loop plus a `video` screen
      between *scan* and *choose*.
  - `<video src="/reinstall/media/webmd-intro.mp4" playsinline>` (served next to `dist`, or an event
    asset).
  - A full cut the first time a program is captured, and a short "welcome back" cut for repeat visits.
    `reinstalls` is already counted (`main.loom:175`) and could ride on candidates or be queried.
  - Operator **Skip**.
  - Autoplay with sound needs a user gesture. The scan or tap that starts the step provides it.
- [ ] Optional: a `show video` widget kind in `play/src/widgets.tsx` (next to `image`), so the phone can
      play the same clip. This is useful while the tablet is busy with another program.
- [ ] Optional: WebMD voice lines inside VR ("Turn left at the kitchen…") through the existing TTS proxy
      (`GET|POST /api/mod/tts`, `core/server/tts.ts`). The headset is a mod device, so it may call it.
      This is a nice-to-have.

### 2.3 Golden goose → golden duck; egg + fly-away; the A button

Story: "follow indicators in their vision towards a golden goose in one of several random spots in the
house that, once they interact with it by pressing an A button, lays a golden egg and flies away."

| Story element | Code today | Citation |
|---|---|---|
| Golden **goose** | Golden **duck**, "Gerald, gilded". It is a deliberate change: the story's own billboard is *Maps and Ducks*, and the codex says the billboard duck is Gerald | `reinstall/README.md:1-8`; `docs/loom-reinstall.md:604-607` (§6); `codex/world.loom:17-20` (`code: GERALD`); `main.loom:356-358` ("It looked a lot like the duck on the billboard downtown") |
| One of several random spots | **Done.** `pickDuckSpot` = FNV-1a 32 over `house.duck.spots`, skipping the spawn room and the spot this guest found last. The show map has 10 spots | `docs/loom-reinstall.md:415-417`; `spatial.ts:345-356`; `house/src/duck.ts` |
| Follow indicators | **Done.** Golden chevrons every 0.75 m along `route()` (a visibility graph through doors and stairs), refreshed at 2 Hz; warmer/colder HUD; quacks panned toward the duck | `docs/loom-reinstall.md:223-297, 474-478`; `reinstall/web/src/game/engine.ts:388-395, 405-417`; `reinstall/vr/game/trail.gd` |
| **Lays a golden egg and flies away** | **Already implemented, in all three renderers.** Web/terminals: `layEgg()` drops an egg with a bounce, then the bird flies off and the camera turns to watch. VR: `celebrate()` shows the egg, then a 2.6 s climbing, spinning, shrinking flight. Terminals play `layEgg()` when a `found` frame arrives | `house/src/three/duck.ts:4, 27-42, 146-213`; `reinstall/web/src/game/engine.ts:456, 490-505`; `reinstall/vr/game/duck.gd:1-4, 87-110`; `terminal/src/world/WorldView.tsx:128, 222-225` |
| **Press A** to interact | **Not implemented by design.** The find is proximity-only. Web: within 0.9 m in plan, on the duck's floor, ≤ 1.2 m rise → `found()` fires automatically. VR: `is_at_duck` checked every tick. The contract says "No buttons are needed anywhere" | `engine.ts:347-355`; `reinstall/vr/game/game.gd:377-380, 405-415`; `docs/loom-reinstall.md:579-581, 605`; `reinstall/vr/README.md:9` |

**Option A: keep the duck (recommended).** It already fits the story's own world (the billboard, Maps
and *Ducks*). Rewrite the story copy to say "golden duck" everywhere (Story Overview / STORY BEATS say
goose).

**Option B: make it a goose.** This is cosmetic plus copy only.
- Model: lengthen the neck and head in `house/src/three/duck.ts` (primitives) and
  `reinstall/vr/game/duck.gd:19-31`.
- Strings: "Gerald", "YOU FOUND GERALD" (`game.gd:239`), "FOUND THE GOLDEN DUCK"
  (`terminal/src/world/WorldView.tsx:225`), the HUD notices, the codex `The Golden Duck`.
- **Do not rename the event `the golden duck`.** It is hard-coded in `core/server/event-runtime.ts:1119`.
  If you rename it, change that line, `docs/loom-reinstall.md` §2.1/§6, and the story together.
- About 2–3 hours plus a visual check.

**Adding an optional A-button press (~0.5 day + docs):**
- **VR:** `reinstall/vr/openxr_action_map.tres` already defines `ax_button` ("A/X button",
  `:85-86`) and binds it for `/interaction_profiles/oculus/touch_controller` to
  `/user/hand/right/input/a/click` and `/user/hand/left/input/x/click` (`:293-297, :396, :445-449`).
  In `game.gd:_tick_play` (`:377-380`), when a new `press_to_find` station setting is on (add it to
  `net/config.gd` + `station.json`), require `is_at_duck(...)` **and** an `ax_button` rising edge before
  `link.report_found()`. In reach, the HUD shows "Press **A** to touch Gerald". The `--autopilot` path
  auto-presses. The lobby picker's no-button rule (`game/picker.gd:3`) stays as is.
- **Web:** in `engine.ts:347-355`, in reach plus `pressToFind` → show a big "🥚 Touch Gerald" button
  (touch) / Space / Enter instead of calling `found()` directly. Add a `?press=1` provisioning hint to
  `config.ts` (`HINT_KEYS`, `config.ts:105`).
- **Server:** no change. `nearDuck` (`spatial.ts:161-172`, 2.0 m plan) is still the judge, so a press
  can never be accepted from far away.
- **Docs and tests:** update `docs/loom-reinstall.md` §3/§5/§6 ("no buttons" → optional press),
  `reinstall/vr/README.md:9-15`, the Reinstallation beat copy, the help article
  `docs/help/play/11-reinstallation`, and the VR found-rule checks plus a web engine test.
- Tradeoff: the press makes it an explicit "follow instructions" act, which suits the theme. It also
  adds a failure mode for first-time VR users who can't find A. Recommendation: on, with a large HUD hint
  and a 10 s fallback to auto-find.

### 2.4 Bathroom Mode from the tent

Story: "if they need to leave to use the bathroom or have an emergency, they are requested to put on
'Bathroom Mode' in the in-game app so everyone knows they are not just hacking the Internet." Bathroom
Mode also exempts guests from the Act II five-minute summons (STORY BEATS line 27).

Code:
- `INTERACTION go to the bathroom` / `back from the bathroom` (`who: guest`) → `set program.afk`,
  broadcast to the Antivirus, reply (`main.loom:198-207, 221-227`). **It exists only as a guest-phone
  button.**
- **There is nothing in the tablet or VR game.** `grep -i bathroom|afk` in `reinstall/`, `terminal/src`
  and `play/src` returns nothing. The README's suggestion "Bathroom Mode from inside the tent:
  `POST /api/guest/act` with the guest's token" (story `README.md:135`) cannot work from the tablet,
  because the tablet is a **mod** device and has no guest token.
- **`afk` has no effect.** No five-minute sweep reads it (story-side gap).
- A headset taken off ends the session after a 2 s grace (`docs/loom-reinstall.md:585-589`), so a
  bathroom break just means rescanning on return. That is fine.

To do:
- [ ] **Tablet button** (~1–2 h): on the *choose* screen (and a long-press on the scan screen's
      "In the Internet now" rows), add **🚻 Bathroom Mode** and **Back** buttons →
      `POST /api/mod/signal {name: "go to the bathroom", subject: <guest>}`. The route already takes
      `subject` (`event-runtime.ts:2739-2760`). Add `postSignal` to `reinstall/web/src/api.ts`.
- [ ] Optional VR: the lobby picker gets a "Bathroom Mode" entry for the selected program (same
      `mod/signal`).
- [ ] Story: make `afk` matter. Exempt `afk` programs from the five-minute summons capture, and show
      🚻 on the Antivirus roster / guest card.

### 2.5 The TV mirroring the VR player

Story: "While Clippy explains this, the screen in the room is mirroring the VR version of the house
where you can see the failed bingo player wandering." (Story Overview §Inside the Party)

Code:
- **Done (software).** The TV is a terminal in **`view=mirror`**:
  `/terminal/?code=<mod>&name=Living Room TV&spot=desktop-tv&view=mirror` (spot `desktop-tv` in
  `living`, `house.json`; story README `:138`; `terminal/src/app.tsx:119, 543-565`). It shows the world
  view full screen with no scanner or chat. A pure camera director cuts between **mount** (a window
  where the TV hangs, used while a player is in that room) and **follow** (over the shoulder of the most
  recently active player). A just-found player takes the camera for 8 s (`terminal/src/world/director.ts:37-38, 141-144`).
  It adds a mini-map, name tags, the "REINSTALLATION IN PROGRESS · name · room" banner, the egg-and-flight
  celebration, and "HAS BEEN REINSTALLED" (`WorldView.tsx:222-225`).
- It is a **reconstruction from poses** (ghost avatars in the procedural house), **not the headset's
  real first-person view**. That is the right choice for 2–3 simultaneous players and needs no casting
  hardware.
- **Conflict with the rest of the story:** the TV above the fireplace is also the **presentation
  screen**. It shows the Windows screensaver before the inciting event, Monitor Prompts V1–V6, the three
  trivia questions, and Trabolta's Trust Chart. A `mirror` terminal shows *only* the simulation. The TV
  needs a mode that is **presentation/screensaver by default, cutting to the mirror (or a picture-in-
  picture) while someone is in the Internet**, ideally on a director cue. This belongs to the terminal /
  "monitors" workstream but blocks this beat.
- Not verified on a real TV.

Alternative / addition: Quest **casting** to a Chromecast gives the true first-person view, but only for
one headset, it is flaky over party Wi-Fi, and it needs the Meta app. Use it only as a backup.

### 2.6 The Antivirus zips everyone out of the Internet at once

Story: "Trabolta calls for everyone in the Internet to be zipped up and brought out immediately. The
antivirus pushes them all out and zips them all up for the moment." (Act II, after the beans.) Also the
alternative ending: Trabolta "starts banishing all programs including antivirus to the internet".

Code:
- **There is no bulk form.** `release` is per person: `runRelease` resolves one id
  (`core/src/runtime/sim/sim.ts:2085-2093`). `fire … for <subject>` also takes one subject
  (`sim.ts:1980-2002`). Performers release one program at a time (`cast/kit.loom:48-52`
  `mark as reinstalled`). Trabolta's `pardon a program` is once a night, one target
  (`cast/trabolta.loom:117-121`).
- **Releasing a program does not end their game session.** `SpatialHub` only ends sessions on
  found / end / timeout / replaced / reset (`spatial.ts:345-351, 511-526, 542-561`). A program released
  by a performer keeps playing, and on find the VR HUD still says "REINSTALLATION COMPLETE" from the
  assignment's `captured` snapshot (`game.gd:228-239`). This is harmless but wrong.
- **There is no "end every spatial session" director route.** `POST /api/mod/spatial/end` takes one
  `session` (`event-runtime.ts:2617-2621`). `SpatialHub.reset(kind)` ends all sessions but is wired only
  to story restarts (`spatial.ts:556-561`, `event-runtime.ts:1455`).
- Performers (the Antivirus, Clippy) are **characters, not sim persons**. Only guests and personas are
  `createPerson`ed (`event-runtime.ts:2046, 3030`). So the "banish the Antivirus too" ending cannot put a
  performer into the reinstallation game: `begin` returns 404 unknown guest (`event-runtime.ts:2589-2593`).

Proposal (~0.5–1 day total):
- [ ] **Engine:** `release everyone from The Internet` (or `release all from X`). In `runRelease`, when
      the target is `everyone`/`all`, iterate every captured person whose location is X. ~15 lines + a
      `sim` test. Fallback with no engine change: a ROLE watcher such as
      `when Night.zips > self.zips_seen:` → `set self.zips_seen = Night.zips` →
      `if self.corrupted: release self from The Internet`, driven by an admin
      `INTERACTION zip everyone out` that increments `Night.zips`. This needs a test to confirm watchers
      re-fire per participant as described.
- [ ] **Server:** when a `released` sim event is fanned out and did **not** come from `commitFound`, end
      that guest's spatial session with a new leave reason `released`. Add `SpatialHub.endGuest(guest,
      reason)`, call it from the fanout in `event-runtime.ts`, and add `"released"` to `LeaveReason` and
      `docs/loom-reinstall.md` §2.2.
- [ ] **Server:** `POST /api/mod/spatial/end {all: true}` → finish every session as `ended`, for the
      director's "clear the tent" button. Add the button on `/reinstall/map` and/or the Run cockpit.
- [ ] **Games:** handle `leave {reason: "released"}`. Web shows an end screen: "The Antivirus zipped you
      out. Take the headset off." VR: HUD "ZIPPED OUT", then the lobby. Both `leave` handlers exist
      (`reinstall/web/src/game/engine.ts` stream handling; `game.gd:_on_session_over`).
- [ ] **Story:** "zipped up" could be a WinZip pun: a temporary `zipped` state (phone shows a
      "compressed" cutscene) until unzipped. WinZip is in the assignable pool (`cast/pool.loom:30`).
- [ ] Alt ending: allow `begin` for performer ids (`p-xxxxxx`, which `parseScan` already accepts), with
      no story effect on found, or create personas for the Antivirus.

### 2.7 Excel's secret mission: "get yourself sent to the internet and bring back a virus"

Story (Character Sheet, Excel, both glitch branches): "get yourself sent to the internet to try and
bring back a virus" / "Try to get into the internet to bring back another antivirus which turns out to
be a virus anyway". STORY BEATS Act II branches on **whether Excel planted the virus** (Scenarios 1–4),
and Act II Final round says Excel "should still retrieve the virus from the internet".

Code: **there is no way to pick up anything in either game.** The only interactive object is the duck.
There is no item schema, no pickup route, and no story flag for a virus (`grep -i virus` in the story
returns only the Antivirus group). The story's endings do not branch on it yet.

Three designs, cheapest first:

**C. Physical token, zero code (works today).**
- A "virus" floppy disk or USB stick hidden in the tent (e.g. taped under VR station 2), with a printed
  **codex QR** (`?code=&unlock=` links are already printable from `GET /api/mod/codes`, story
  README / `CODEX … code:`).
- Story: `CODEX ILOVEYOU` (the May-2000 love-letter worm, which fits Trabolta's Sandy arc), with
  `code: LOVE-LETTER-FOR-YOU`, `known to:` nobody.
  `when program learns ILOVEYOU:` → `set program.carries_virus = true`, `set Night.virus_planted = true`
  (or require a second "plant" step, below), complete Excel's quest step, and add a note to Trabolta's
  context. The `learn` trigger fires on redeem (codex economy, CLAUDE.md 2026-09-10).
- Anyone in the tent could find it. That is a feature: "someone brought back a virus" (Act II
  Scenario 1).

**A. In-world clue, zero code.**
- A `label` prop in the virtual house reading e.g. `C:\WINDOWS\TEMP\LOVE-LETTER-FOR-YOU.TXT.vbs —
  ILOVEYOU`, tucked off-route (behind the furnace). Label props render in both web
  (`house/src/three/scene.ts:266-272`) and VR (`house_builder.gd:375-386`).
- The player memorizes the code and redeems it on their phone afterwards. The "bring it back" part is
  remembering it, which echoes the "use your computer memory" bingo rule.
- Downside: terminals and the TV render the same house, so a spectator could spot it. That may be fine.

**B. Real in-game pickup, ~1–1.5 days (stretch).**
- **Deal:** in `SpatialHub.begin`, deal a `virus` spot only when the story wants it. Add an injected
  `wantsVirus(guest)` callback reading world var `<guest>.seeks_virus` (set on Excel's glitch choice) or
  an active quest. Reuse `pickDuckSpot(house, id + ":virus", [duck.id, …])` so no schema change is
  needed. Add `virus?: {id, room, pos, label}` to `Assignment`. The label comes from the branch, e.g.
  `VIRUS.EXE` vs `ANTIVIRUS_FREE_TRIAL.EXE`, so the "antivirus that turns out to be a virus" branch is
  covered.
- **Route:** `POST /api/spatial/pickup {item: "virus"}` (session token) uses the same `nearDuck`-style
  check against the virus position. It is refused while paused (like `found`), idempotent per session,
  and commits `signal("a virus was brought back", guest)` journaled `by` the device.
  **Not broadcast on the spatial stream**, so the terminals and TV never show it (it is secret).
- **Games:** a glitchy red bug model (`house/src/three/virus.ts` + `reinstall/vr/game/virus.gd`). There
  are no chevrons to it, only a static-crackle "warmer" sound near it. Walking into it (or pressing A,
  see §2.3) posts the pickup and shows "VIRUS.EXE copied to your program". The duck is still required
  to leave.
- **Story:** `when a virus was brought back for program:` → `carries_virus`, the codex entry, the quest
  step, `Night.virus_planted` (if Excel, or after planting).
- **Tests:** spatial (deal only when wanted, near/far/paused/repeat), a web engine test, VR checks.

**"Planting" (optional second step):** STORY BEATS distinguishes *bringing back* a virus from *planting*
it. The cheapest plant step is a guest-only INTERACTION `plant the virus`, gated `if program.carries_virus`.
A more physical option is scanning a QR prop on Trabolta's patch bay or the router. That overlaps the
server-room hardware workstream.

Recommendation: ship **C** (and optionally **A**) for the party, and keep **B** as a stretch.

### 2.8 `house.json` is a placeholder

- The file says so itself (`house.json:3-4`: "PLACEHOLDER layout until the real house is measured";
  origin "not yet surveyed").
- Contents: 2 floors (ground 0 m / basement −2.7 m), 9 rooms (mudroom, hall, living, kitchen, bathroom,
  backyard (outdoor), landing, registry, tent), 9 doors, 1 stair, 7 terminal spots, 10 duck spots,
  spawn in the tent, 32 props.
- **Missing from the story's world:**
  - **No Server Room.** Trabolta's patch bay lives in the "cold storage room", the finale location.
    There is no room or LOCATION for it. Keep duck spots *out* of it, but it should exist so routes and
    terminals are right.
  - No Truth Pong table outside. The backyard has bbq, shed and picnic-table props.
  - The Tube's real geometry (mud room → living room tunnel) is unknown.
- `room.location` must name the rewritten story's LOCATIONs. The server only **warns**
  (`docs/loom-reinstall.md:152-154`, `houseWarnings` in `spatial.ts:190`), so after the rewrite renames
  locations, update every room's `location`.

Measuring checklist:
- [ ] Laser distance meter + tape. Origin = outside threshold of the front door, floor level, east jamb
      (`docs/loom-reinstall.md:40-42`). +x east, +z south, metres.
- [ ] Per floor: elevation and ceiling height. Per room: a rectilinear polygon. Per door: centre point
      on the wall line ± 2 cm, and width. The stair rect plus its `up` direction.
- [ ] Solid props that matter for walking (couch, counter, fireplace, tables, the ping-pong / Truth Pong
      table).
- [ ] **Every real terminal tablet's mount:** `pos` (screen centre), `yaw` (facing into the room),
      `pitch`, `fov`. This is what makes the "window into the virtual room" line up.
- [ ] 6–10 duck spots, none in the spawn room, none buried in a prop (put them on top, e.g. the counter),
      ≤ 1.2 m above the floor.
- [ ] Edit in `/reinstall/map` (drag terminals/spots, live validation) or by hand. Then
      `pnpm house:sync` (goldens + copy to `reinstall/vr`) and re-run `pnpm test:vr`, where the
      autopilot must reach every new spot. Then re-export the APK so the bundled fallback matches. The
      live fetch overrides it anyway.
- [ ] **Gotcha:** a director's save (`STATE_DIR/<eventId>/spatial-house.json`) **wins over the show file
      forever** for that event (`docs/loom-reinstall.md:330-343`). After committing the measured
      `house.json`, delete any stale `spatial-house.json` from the event state dir, or the old map keeps
      serving.

### 2.9 Throughput and queueing in the tent

- Truth Pong ("Everyone who fails to get a shot in is marched to the tunnel") and the scavenger-hunt
  judging can capture **5–10 programs at once**. There are 3 devices.
- `capacity: 3` on The Internet is **not enforced** (§2.1). The candidates list sorts captured first,
  then **by name**, not by capture time (`spatial.ts:180-188`). There is no "next up".
- A web session idles out after 120 s with no input (`docs/loom-reinstall.md:490-491`). A find takes
  roughly 1–3 min.

To do:
- [ ] Sort candidates by capture time, and show a "Next up" list with wait counts on the tablet scan
      screen. ~1–2 h. It needs `captured_at` (the world already stores `captured_from`;
      `sim.ts:2068-2083`).
- [ ] Decide the overflow policy. Either the queue waits in the tent (seating), or the Antivirus can
      `pardon` or zip out (§2.6). The mid-Act-II zip-out naturally drains the tent.
- [ ] Optional: let a spare phone run `/reinstall/?role=player` as a 4th device. It only needs the mod
      passcode at setup.

### 2.10 Integration constraints the story rewrite must respect

- Event names **`the simulation completed`** and **`the golden duck`** are hard-coded in
  `core/server/event-runtime.ts:1118-1119` (`commitFound`). Keep them, with matching `INTERACTION`s
  (`main.loom:293-299`) and `when … for program:` rules (`main.loom:351-358`), or change the code and the
  contract (`docs/loom-reinstall.md` §2.1, §6) in the same change.
- "Released" is computed as captured before and not after (`event-runtime.ts:1112-1124`). The story's
  `when the simulation completed` must actually **release** a captured program
  (`release program from The Internet`), and the prison LOCATION must stay `prison: true`
  (`main.loom:79-84`). Otherwise the HUD shows "YOU FOUND GERALD" instead of "REINSTALLATION COMPLETE".
- Capture comes from the performer `send to the internet` interaction (`cast/kit.loom:43-46`). The tablet
  only lists programs that are sim persons, so guests and personas only.
- Help articles to keep in sync: `docs/help/play/11-reinstallation`, `play/09-terminals`,
  `authoring/33-live-verbs`.

---

## 3. Verified vs. not

| Claim | Status |
|---|---|
| Unit/golden suites (house 122, reinstall 120, core spatial 44, VR 225) | **Re-ran green today** |
| HTTP e2e: route walk → 409 far → 200 released → codex → `leave found` after 8 s → 410; station park/claim | Done once, 2026-10-10 (CLAUDE.md), scratch server, **before** the review-round fixes |
| Headless Godot `--autopilot` finding ducks on a live server (exit 0) | Done once, 2026-10-10. It caught and fixed the `PosePump.flush` bug |
| Moved-duck adoption, pause ("doors are closed") retry, map-save 409s, prop routing, fov | **Unit-tested only.** Not re-run live, in a browser, or on a headset (CLAUDE.md) |
| Tablet game in a real browser on a real tablet (touch sticks, camera scan, WebGL perf) | **Never** |
| Quest 3: APK export, install, OpenXR input, comfort, presence-based session end | **Never.** No `build/`, no `android/` template in this checkout, JDK 17 not configured (memory note) |
| Android cleartext HTTP from the Quest to a LAN `http://` server | **Unverified risk.** Android 9+ blocks cleartext unless the manifest allows it. `export_presets.cfg:64-67` sets only the network permissions. Confirm on the first real export, or serve HTTPS |
| TV `view=mirror` on an actual TV | **Never** |
| Terminal "window" alignment with real walls | Impossible until the house is measured |

---

## 4. Hardware checklist for the tent and the reinstall plane

**Headsets (×2)**
- [ ] 2× Meta Quest 3 (3S also works; same OpenXR touch profile), on the latest OS, each in
      **Developer Mode** (Meta Horizon app; needs a Meta developer org on the account).
- [ ] Per headset: APK sideloaded (`adb install -r`, `reinstall/vr/README.md:121-130`) and its own
      `station.json` (`station: vr-1` / `vr-2`, `name`, `server`, mod `code`), pushed via `run-as` or baked
      into a per-headset export.
- [ ] Boundary: **stationary** boundary. Players use thumbstick locomotion in a small tent. Provide a
      swivel stool or a standing mat with a tactile edge.
- [ ] Settings: keep the proximity sensor **on**, because the game ends a session 2 s after removal
      (`user_presence`). Raise the display-off timeout. Turn off passthrough auto-switch. Pin the app or
      use a kiosk launcher.
- [ ] Controllers: Quest 3 Touch Plus uses 1× AA each. Bring rechargeable AAs and spares (4–6), plus
      wrist straps.
- [ ] Hygiene: silicone face-interface covers or disposable covers, lens-safe wipes. Hair ties for long
      hair.
- [ ] **Charging:** a Quest 3 lasts about 2–2.5 h of active use. The party is about 4–5 h. Options: a
      USB-C PD 45 W charger and short cable per headset at the station, so it charges between players;
      or a battery strap (e.g. a head strap with a battery) on both, plus a charging dock for swaps. Use a
      powered tent power strip with cable runs taped down.

**Tablet (the tent tablet)**
- [ ] A ≥ 10" tablet with a **rear camera**. Android plus Chrome is preferred: `BarcodeDetector` works
      natively. An iPad falls back to `jsQR`, which also works.
- [ ] Stand or arm at chest height, power always on, screen timeout off, kiosk / guided access, volume
      up (quacks, fanfare, the WebMD video).
- [ ] **Camera needs a secure context** (`https://` or `localhost`, `reinstall/web/README.md:53`). Either
      serve HTTPS (VPS / Caddy deployment with the real domain, or a local cert), or set
      `chrome://flags/#unsafely-treat-insecure-origin-as-secure` for the server origin on each tablet.
      Otherwise only typed-name lookup works.
- [ ] Optional: a cheap Bluetooth keyboard for an operator. The keyboard also drives the web game.

**TV (the mirror above the fireplace)**
- [ ] The TV plus a device that runs modern Chrome with WebGL: an old laptop or mini-PC on HDMI
      (recommended), or a spare tablet on HDMI. Streaming sticks' browsers are too weak or unreliable for
      three.js.
- [ ] Chrome kiosk mode, opened at `/terminal/?…&spot=desktop-tv&view=mirror`.

**Network**
- [ ] A dedicated Wi-Fi 6/6E router or mesh for the show (the Quests, ~8 terminals, the tablet, the TV
      box, ~30 phones). Load is modest (10 Hz poses ≈ < 2 KB each; 1 Hz station polls; SSE). Reliability
      and coverage of the tent matter most: put an AP or mesh node near the tent.
- [ ] A DHCP reservation / static IP for the server laptop if serving on the LAN. The headset config
      hard-codes the server URL (`station.json` `"server": "http://192.168.1.10:7000"`).
- [ ] Decide **LAN laptop vs. VPS** (Docker deploy). On a VPS everything is HTTPS, which solves both
      the tablet camera and the Android cleartext issue. It then depends on the venue's internet uplink.
      A LAN laptop keeps working with no uplink but needs a certificate or the Chrome flag, and the
      cleartext check.

**Tent physical**
- [ ] A battery LED **EXIT** sign at the real exit, with the egress path kept clear of cables.
- [ ] Two marked VR station mats (`house.json` models them at 1.4 m squares) and seating for the queue.
- [ ] Optional: a hidden "virus" floppy or USB prop with a codex QR (design C, §2.7).
- [ ] Lighting: low but not dark (Quest tracking needs some light). Avoid strong IR or LED strobe right
      at the headsets.

---

## 5. Software checklist (prioritized)

**P0: must happen before the party**
- [ ] Measure the house → real `house.json` (§2.8), including a **Server Room** room/LOCATION and real
      terminal mounts. Then `pnpm house:sync`, `pnpm test:vr`, and clear any stale `spatial-house.json`.
- [ ] Story rewrite keeps the hard-coded event names and the release semantics (§2.10).
- [ ] **First real Quest export:** JDK 17 + Android SDK, install the Android build template, export
      `Quest`, sideload on both headsets, confirm the server connection (cleartext/HTTPS) and the lobby →
      Send to Headset → find → lobby loop.
- [ ] **First real tablet run:** provisioning link, camera scan (secure context), Play here with touch
      sticks, WebGL frame rate on the actual tablet, Send to Headset.
- [ ] **Live re-run of the review-round fixes** against a scratch server: pause/resume during a find, a
      director map save mid-game (duck moves), a save conflict (409) in `/reinstall/map`, and a TV mirror
      on the real TV.
- [ ] Tablet **Bathroom Mode** buttons via `mod/signal` (§2.4).

**P1: story fidelity**
- [ ] WebMD instructional **video step** on the tablet, plus an attract loop. Story: WebMD narrates and
      replaces "The Tablet" (§2.2).
- [ ] **Zip everyone out:** a bulk `release everyone from The Internet`, spatial sessions ended on any
      non-found release (`leave: released`), and a director "end all sessions" route + button (§2.6).
- [ ] Excel's virus, **design C** (physical codex token) and/or **A** (in-world label code), with story
      flags `carries_virus` / `Night.virus_planted` feeding the Act II scenarios (§2.7).
- [ ] TV: presentation/screensaver by default, cutting to the mirror while someone is in the Internet
      (coordinate with the monitors/terminal workstream, §2.5).
- [ ] Tent queue: capture-time order + "Next up" on the tablet (§2.9).

**P2: polish / stretch**
- [ ] Optional **press-A** to touch the duck/goose (VR `ax_button` already bound; web Touch button /
      Space), with docs and contract updates (§2.3).
- [ ] Goose model + copy, *or* rewrite the story to say "duck" (recommended) (§2.3).
- [ ] Excel's virus, **design B** (real in-game pickup, secret from spectators) (§2.7).
- [ ] WebMD voice guidance inside VR through `/api/mod/tts` (§2.2).
- [ ] Let performers enter the sim for the "banish even the Antivirus" ending (§2.6).
- [ ] Make `afk` matter in the five-minute summons sweep; show 🚻 on rosters (§2.4).
