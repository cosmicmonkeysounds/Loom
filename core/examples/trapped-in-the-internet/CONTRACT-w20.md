# Wave 20 contract: Trabolta's heart, the door sensor and the house lights

Six lanes build against this file without talking to each other. Every name below is exact: a type, route, signal, var, cue or file named here is the one to build, and a lane that needs something not named here stops and asks the integration lead. Branches: `oct31-w20/<lane>` as git worktrees, many conventional commits, merged `--no-ff`.

Everything marked **DRAFT** is copy waiting for the user's sign-off (`SIGNOFF-w20.md`, written by the docs lane).

---

## §0 The ask, the decisions, what is out of scope

### 0.1 The ask (verbatim)

> "Trabolta should have a very dramatic sequence if you get into the Server room. There is a door sensor (LDR + LED -- the door is "closed" when the LED is shining on the LDR, which reads about max value on an Arduino). When you first open the room, his special cutscene plays in the server room. He asks you to close the door, which you must do before continuing. Then, it's a multi-layer discussion similar to the Master in Fallout 1 -- you may be able to convince him to shut himself down, or not. In the server room is Steph's laptop with an Arduino plugged into it (Grand Central M4) -- the door sensor is connected to it. This should transmit to the Loom server. There is also a RGB Zigbee bulb in the room which should be controlled for great effect. A monitor and mouse are used as the "terminal" / Trabolta face -- the user scans their pass on the webcam so that Trabolta knows who it is. We currently don't have a way to place lights in the map editor, so make sure that can happen so we can actually get the home automation / Zigbee stuff working. I've got a Zigbee2MQTT dongle: Zigbee 3.0 USB Dongle with 20dBm Output | TI CC2652P+CP2102N Dual-Chip | Multi-Protocol Support | Preloaded Z-Stack 3.x.0 Firmware"

### 0.2 Decisions taken for the user (vetoable)

| # | Decision |
|---|---|
| D1 | **The bridge is Web Serial in the server-room terminal page** (Steph's laptop, desktop Chrome, https). ⚙ *Connect door sensor* grants the port once; `navigator.serial.getPorts()` reconnects on every later boot. The terminal posts each sensed edge as `POST /api/mod/signal` **`door_sensor_opened` / `door_sensor_closed`** (header `x-loom-token`, label `Terminal · <name>`, args `{level}`), reports `door` + level + fault / warning on its heartbeat, and reconciles against the story's `Night.server_door` on every poll. Admin fallbacks: 🚪 `server_door_opened` (exists) and a new 🚪 `server_door_closed`, plus the booth's `radio_door_opened` / `radio_door_closed`. **Changed from the brief:** (a) while the sensor reports a blocking fault (`ldr_saturated`, `led_dead`, `no_port`, `stale`) the terminal posts **no** edges; (b) a director's or a booth's 🚪 press sets **`Night.door_override`** (D19), and the story ignores the sensor until 🚪 *Trust the door sensor* (`server_door_trust`) clears it, so a wrong-but-healthy sensor can never undo a director. Run → Terminals shows the fault in red and the override in amber. |
| D2 | **The Grand Central M4 firmware** (`hardware/server-room-door/`): 12-bit reads (`analogReadResolution(12)`); hysteresis + debounce; JSON lines at 115200; serial commands; calibration and settings in flash (FlashStorage_SAMD), and the terminal re-sends its stored thresholds on every connect anyway. **`mode` defaults to `auto`**: at boot the firmware toggles D2 and compares; if the reading moves by ≥ 200 the LED is on the pin and it runs **`mod`** (lit reading minus dark reading, so room light can't fake *closed*; ≥ 150 ms settle per phase for a CdS cell, a frame ≈ 400 ms), else **`steady`** (the LED on 3V3, `level = lit`), and `hello` reports `"mode":"steady","auto":true`. A cut LDR wire with the door open is indistinguishable from an open door in a dark hall, so `ldr_open` is a **warning** (still posts `open`), never a blocking fault; a saturated LDR or (with the optional sense pin) a dead LED is a blocking fault. A shroud tube over the LDR is in the BOM. |
| D3 | **The story owns the Heart sequence** as stages (`Night.heart_stage` sealed → door → scan → talk → done) and a per-program **Fallout-Master choice tree** in four layers, docked in the program's `dm:Trabolta` and clicked on the terminal. Checks (codex proofs not from him, Trust Chart standing, truths accepted, marked, the overshare, the LiveJournal) show tagged options only when they pass and never quote a secret. Wrong pushes raise `program.heart_suspicion`; 80 throws the program out for the night. Before the Y2K hour (`Night.step < 14`) a convinced program hears *not yet* and is remembered (`program.heart_convinced`); in the Y2K hour success shuts him down from the story itself (`Night.heart_autoend`, default true; false → the 🕊 `talked_down` confirm as today). The door opening mid-talk freezes the tree until it is shut. One heart at a time (`Night.heart_holder`). |
| D4 | **Changed from the brief: room cutscenes are triggered by room cues, not beat moments.** A `cue room_<name>` directive inside a beat set in a LOCATION is folded per room into the screen state's `room.cue` for a room terminal polling that LOCATION; `SceneDef` gains a `{room}` trigger; walls and the TV never see them. Why: the tree's beats are per-program and per-guest beats are never moments (privacy, §2.4 of wave 17), and an explicit cue lets the story time the picture to the line instead of to the beat's name. |
| D5 | **`lights.json` is a project file beside `audio.json`**, never in `house.json` (a light edit must not bump the map version) and never `house.lights.json` (that is a map variant). Schema in `@loom/house` `house/src/lights.ts`; served by `core/server/lights.ts` `LightsHub` (director save > project > `LOOM_LIGHTS` > default). |
| D6 | **The stagehand `lights` module** (house Mac, launchd job `lights`) turns story `cue <look>` directives into Z2M / WLED publishes, runs timed steps, test / identify, permit-join, posts the Z2M device list, catches up after a reconnect, publishes `health/lights`. `show` drops any YAML cue rule whose cue name `lights.json` defines. |
| D7 | **The map editor places lights**: 💡 Light tool, Light inspector, *+ Light here*, a 💡 Lights tab (fixtures, Z2M devices + *Pair new device*, looks with steps, ▶ Test), problems, save with `base` → 409, Save to project, a long poll, one undo history `{house, audio, lights}`; lights follow room / floor edits like speakers. |
| D8 | **Run** shows a 🚪 badge per terminal (door, level, fault), the glance shows the heart (the story's `watch:` lines), and a 💡 row (module online, fixtures, pending pair) on the House map card. |
| D9 | **New engine feature: guarded choices** `* (if <cond>) text` / `+ (if <cond>) text`. The Sim has no way to show an option only when a check holds (an `if` around a choice makes a one-option menu), so the tree can't be written without it. Guards are evaluated when the menu is prompted; an option whose guard is false is not offered; a menu with nothing left is skipped. The Sim ignores `*` once-only (only the bank honours it): the tree uses `+` with explicit flags. |
| D10 | **The server room's RGB bulb belongs to `lights.json` alone**: it leaves the Z2M `server_room` group, so `lights_server_open`'s scene and `lights_alarm`'s red breathe no longer touch it; the story cues `heart_*` looks for it, including `heart_alarm` from the patch-bay alarm, and puts the room's look back when the latch ends (`Night.heart_look`, else `heart_idle`). |
| D11 | **The room's safety light is the WLED strip `wled/server`**, which the blackout already keeps on (ps 11): no `heart_*` look touches it and `lights_alarm` gives it a steady red, never a strobe that goes dark. The RGB bulb is a safety fixture too (Z2M `power_on_behavior: on`; never `OFF`, never below 40 / 254, `LIGHT_SAFETY_MIN`; every look clamped, `validateLights` refuses one that would darken it), but 40 / 254 in saturated red or violet is a few lumens, so it is not the room's only light. The drama is colour, slow swells between 40 and 254, and timing; never fast flicker streamed over Zigbee. |
| D12 | **Being thrown out does not mark the program.** It bars them from his heart for the night (🔄 `reset_server_room` forgives) and points them at the cables. |
| D13 | **The agent's `stand_down` power is deleted** (the INTERACTION, its hook, the persona's *standing down* situation, the mind file's phase `powers`). The tree is the only way to the offer. The LLM still answers typed lines at the heart, in one short line that points back at the screen while a choice is docked. |
| D14 | **A pick from the phone counts only at the heart.** The menu docks in `dm:Trabolta` on the phone too; a pick made while the program is not `at_the_heart` is held back with *Not out there* and the menu comes back when they scan in again. |
| D15 | **`/api/guest/choose` takes an optional `text`** and answers 409 `moved` when the docked option at that index is not that text (a mouse click racing a new menu never picks the wrong option). |
| D16 | **The ESP32's door rules leave `trapped.house.yaml`** (the copper-tape `sensors/serverroom/door` rule and the optional `zigbee2mqtt/server_room_door` contact). The ESP32 keeps the patch bay, ring, siren and relay; its door code stays in its firmware, unread. |
| D17 | The keypad stays as it is: the code comes from the four digit notes, the King or the majority, and the door sensor only says open / closed. |
| D18 | **Every pending menu has an id.** `Sim` keeps a FIFO of menus per person, and a program often carries menus it never answered (The Tablet Video's *Where is the exit?*, the glitch menus, the login). `PendingChoice` gains `id` (the log index of its `choicePrompted` event, deterministic on replay) and `beat`; `GuestView.choices` lists every pending menu with its own channel; `/api/guest/choose` takes `choice: <id>` and answers that menu wherever it sits in the queue. The terminal docks the newest menu whose `beat` starts `Heart ` and whose channel is `dm:Trabolta`. Stale menus are never dropped (they may be story). |
| D19 | **The sensor and the directors never fight.** The bridge posts `door_sensor_opened` / `_closed`; the story turns them into its internal `heart_door_opened` / `heart_door_closed` only while `Night.door_override != true`. The 🚪 admin cues and the booth's radio cues set `door_override = true` and fire the internal event themselves; 🚪 `server_door_trust` clears it (and the next poll's reconcile brings the story back to the sensor). |
| D20 | **A short look gives the light back.** `LightLook.then: "restore"` (`heart_nag`, `heart_warn`): the module plays it, then gives back what it interrupted: the looping look that was running (restarted), else the fixture's settled state; it never becomes the settled state. Looping looks never become it either. |
| D21 | **The lights catch up from the story, not from a cache.** After a reconnect or a module restart the module reads `GET /api/screen/state` (`night.alarm_on`, `server_door`, `heart_stage`, `heart_look`) and plays: alarm → `heart_alarm`; else door open in `door` / `scan` / `talk` → `heart_door_open`; else `heart_look` when not `none`; else `boot`. |
| D22 | **Door chatter is rate-limited in the story.** *Heart Door Again* plays at most once per 20 s (`Night.door_again_at`) and *Good.* only after a Door Again since the last close (`Night.door_again_said`); the stage, the freeze and the look still follow every edge. The house-wide door / nag / shut / sealed beats and the door cues never become screen moments. |

### 0.3 Out of scope

- Moving the rest of the house lights (the `house` / room groups, WLED presets, `lights_*` house looks, catch-up rules) out of `trapped.house.yaml` into `lights.json`. This wave's `lights.json` holds the server room only; the format can hold the house later.
- An on-screen keyboard for the terminal; game-to-game anything; lights in the 3D preview or the reinstallation games.
- The bank, the Rust engine and the TextMate grammar learning guarded choices (the bank diagnoses them, §1.1).
- A stagehand serial reader (the M4 is read by the browser, D1).
- Changing the patch bay, the combos, the King or the keypad.

---

## §1 Lanes

Stage A: **platform**, **firmware** (independent; both merge into `oct31-w20/integration`). Stage B, cut from integration after platform merges: **story**, **terminal**, **stagehand**, **mapeditor**, **editor**. Then integration, then **docs**.

Hub files and their one owner: `core/server/event-runtime.ts`, `core/server/routes/screen.ts`, `core/server/views.ts`, `core/src/runtime/sim/sim.ts`, `house/src/index.ts`, `core/src/parser/edit.ts` → platform. `terminal/src/app.tsx`, `terminal/src/screen.ts`, `terminal/src/config.ts` → terminal. `reinstall/web/src/map/MapApp.tsx` → mapeditor. `core/examples/trapped-in-the-internet/main.loom` (and every show file) → story. `stagehand/trapped.house.yaml`, `stagehand/src/stagehand/module.py` → stagehand. `editor/src/components/run/*` → editor. Nobody else edits a hub file; ask its owner.

### 1.1 platform (Stage A)

**Owns:** `house/src/lights.ts` (new), `house/src/index.ts`, `house/test/lights.test.ts`, `house/test/fixtures/lights-{basic,house,resolve,plan}.json` (new); `core/server/lights.ts` (new), `core/server/event-runtime.ts`, `core/server/store.ts`, `core/server/registry.ts`, `core/server/events-api.ts`, `core/server/projects.ts`, `core/server/routes/screen.ts`, `core/server/routes/host.ts` (no change expected: lights routes are **not** on the host allowlist), `core/server/views.ts` (`GuestView.choices`), `core/server/chat.ts` (only the per-menu channel helper beside `decisionChannelFor`), `core/scripts/sync-example.ts`, `scripts/sync-show.sh`; `core/src/parser/{lexer,parser,ast,edit}.ts`, `core/src/runtime/sim/sim.ts`, `core/src/lsp/` (lint + `graph.ts` word blocks: a guarded option shows its guard and an in-place edit keeps it), `bank/src/` (diagnostic only); tests `core/test/{lights,server-lights,choice-guards,choice-ids,screen-room-cue,server-choose-text,screen-quiet-moments}.test.ts`, `core/test/edit-guard.test.ts`, `bank/test/choice-guard.test.ts`.

**Builds:**
1. `@loom/house` `lights.ts` (§2.6): types, `LIGHTS_FILE`, `lightsHash`, `defaultLights`, `resolveLightTargets`, `validateLights`, `planLook`, `clampForSafety`, `z2mPayload`, `wledPayload`. Pure, no `node:`. Fixtures pin the Python mirror (the stagehand lane copies them byte for byte).
2. `core/server/lights.ts` `LightsHub` cloned from `AudioHub` + `handleLightsGet` / `handleLightsPost` (§2.7); `Store.loadLights / saveLights / loadLightsSave / saveLightsSave / clearLightsSave` (`lights-save.json` in the event state dir; the project copy on the row's `house_maps` record under key `lights.json`, no migration); `LOOM_LIGHTS`; `setProjectLights` on reload and `/api/mod/load {lights}`; `dataSnapshot` + `events-api` `projectData` / `stale`; `registry` `spec.lights`; `projects.ts` seeds `lights.json` from the example and validates it on PUT (400 `problems`); `sync-example --keep-lights | --replace-lights` (independent of maps and audio, the `planAudioSync` rules); `sync-show.sh` passes both flags through.
3. Screen state (§2.4): `ScreenRoom.cue`, `ScreenNight.server_door` / `heart_stage` / `heart_look` / `alarm_on` / `door_override`, heartbeat `door` / `dlv` / `dft` / `dwn` → `ScreenDevice.door` / `doorLevel` / `doorFault` / `doorWarn` (carried on `/api/mod/screen/terminals`); the quiet door signals and beats (§2.4 *Moments*).
4. Guarded choices (D9, §2.3): parser (the guard split **before** `splitChoiceSuppression`), Sim, lint `L1221 ChoiceGuardInvalid`, bank diagnostic `choiceGuardIgnored` (the option compiles unguarded and the diagnostic says so; never silent), `edit.ts` / `graph.ts` keep the guard.
5. Menu ids (D18) and `/api/guest/choose {index, text?, choice?}` (D15, §2.2).
6. No change to `/api/mod/signal` (it already takes `args` and `label`).

**Tests:** house — schema round trip, every validation problem / warning in §2.6, resolve cases, safety clamp, plan expansion, both payload builders, hash stability. core — hub precedence + mtime memo, every route answer in §2.7 incl. 409 stale / 400 problems / 404, long poll wakes on save / test / pair, devices cap, module presence expiry, `sync-example` plans; `room.cue` fold (setting match, `room_` prefix only, seq bumps on a repeat, `at` 0 for history, unknown room → null); `night.server_door` / `heart_stage`; device query parsing; guarded choices (true / false / all false skips / guard reading `program.*` bindings / index refers to the shown list / restore replays the same menu / a `[` inside a guard is not hidden text); an edited guarded option keeps its guard; menu ids (two queued menus, answer the newer by id, the older stays; ids equal after a restore; `GuestView.choices` channels); choose `text` / `choice` 409; the quiet door signals and beats make no moment, The Heart still does.

**Docs:** `docs/help/authoring/11-choices.md` (*Options that need something*), `19-directives.md` (*Pictures on a room's terminal*: `cue room_*`), `90-cheat-sheet.md`, `92-common-mistakes.md` (`[` in a choice is hidden text, use `⟦…⟧` tags), `docs/writing-in-loom.md` (choices), `docs/loom-reinstall.md` (a *House lights* section mirroring §1.3 speakers).

### 1.2 firmware (Stage A)

**Owns:** `hardware/server-room-door/` (new: `README.md`, `server_room_door/server_room_door.ino`, `server_room_door/{config.h,door_ldr.h,proto.h,store.h}`, `test/run.sh`, `test/test_logic.cpp`, `test/fixtures/lines.jsonl`); `scripts/accept/N-08.sh` (retire the door steps, keep the patch bay), `scripts/accept/K-05.sh` (rewritten for the LDR), `scripts/accept/N-20.sh` (new bench check: records `lit` / `dark` / `level` in `mod` and `steady` under room light and dark, the settle each needs, and proposes `close` / `open` / `settle`), `scripts/accept/K-27.ts` (fires `door_sensor_opened` instead of `server_door_opened`), `hardware/server-room/README.md` (a note: the door moved to the M4), `docs/trapped/hardware-research.md` §A.

**Builds:** §2.9 exactly. Pure logic in headers (`door_ldr.h`: the classifier, hysteresis, debounce, faults, calibration maths; `proto.h`: command parsing and line formatting, no Arduino includes), host-tested by `test/run.sh` (plain c++17) with `run.sh compile` → `arduino-cli compile --fqbn adafruit:samd:adafruit_grandcentral_m4 server_room_door`. `test/fixtures/lines.jsonl` = one example of every output line (the terminal lane writes its parser against §2.9 and diffs its own fixture against this file at integration).

**Tests:** debounce (open after `open_ms` of open frames, closed after `close_ms` of closed frames; a flicker on an open door never reports closed; a door bouncing open / shut every 300 ms reports each settled change once), hysteresis band, room light in `mod` mode modelled as a CdS cell (more ambient → `dark` rises and `lit − dark` **falls**; the defaults still classify a shut door under the bench's measured worst case), `auto` mode picking `mod` / `steady` from the D2 toggle, every fault and its clear, `ldr_open` as a warning that still reports `open: true`, calibration (span < 200 refused), every command and its reply line (incl. `set settle`), the periodic 1 s line, flash record magic / version.

### 1.3 story (Stage B)

**Owns:** every file under `core/examples/trapped-in-the-internet/` except the docs lane's (`README.md`, `DESIGN.md`, `DEMO.md`, `CHECKLIST.md`, `OCT31.md`, `SCHEDULE.md`, `SIGNOFF-w20.md`, `cast-packs/`): `main.loom`, `beats/server-room.loom`, `cast/trabolta.loom`, `trabolta.persona.md`, `trabolta.mind.md`, `lights.json` (new); tests `core/test/trapped-heart.test.ts` (new), `core/test/trapped-in-the-internet.test.ts` and any `trapped-*` test the change breaks; the stagehand tests and fixtures that read the show's persona / mind file (`stagehand/tests/test_trabolta_show.py`, `test_voice_lean.py`, `tests/fixtures/classic/*`) and the comment at `stagehand/src/stagehand/agents/voice.py:172` that names `stand_down` (comment only); `docs/help/authoring/38-server-room.md` (rewritten; also drop the drifted 120 s quiet window).

**Builds:** §3 and §4, the show's `lights.json` (§2.6.5), the header `watch:` change (§3.10), the admin cues (§3.9). Uses guarded choices, `cue room_*`, `cue heart_*`. Every guard is written with its `program.` / `Night.` prefix (a bare name fails at run time and silently drops the option; L1221 only catches parse errors); per-program heart beats carry **no `Narrator:` lines** (narration goes to the whole room, `chat.ts`); their stage directions live in the room scenes.

**Tests (`trapped-heart.test.ts`, on a `Sim` + the server views):** door open before awake → only `# hosts`; first open awake → The Heart, stage `door`; nag at 15 s then every 20 s, `# hosts` at the third; close → Heart Sealed, stage `scan`; scan with the door open waits, resumes on close; a pick held with the door open, then a terminal close and a re-scan with the door shut → exactly one menu docked, the pick applied once; `heart_pick` starts `"none"`; a stale Tablet Video menu queued before the heart → the heart menu's id is the newest `Heart …` entry and answering it leaves the stale one; the door bouncing open / shut five times in 10 s → one Door Again, one *Good.*, the stage and `server_door` right after each edge; a 🚪 press sets `door_override`, a later `door_sensor_*` changes nothing, `server_door_trust` clears it; the alarm before The Heart → the latch end cues `heart_idle`; no heart look cue while `alarm_on`; Leave → stage `scan` + `room_heart_leave`; `ask_her` hidden until `Night.her == "Sandy"` or a Sandy proof is held; the autoend watcher after Combo A does nothing; 🔄 after an un-ended `done` reopens the heart and clears `stand_down_by`; `Night.heart_talker*` mirror the program talking; each layer's options shown / hidden by every check (incl. a proof that came from him never shows); suspicion arithmetic, the warn at 50 (once), the eject at 80, a barred re-scan; door open mid-talk → a pick waits, the close plays it; a pick off the terminal → *Not out there*; a second program after the first; convinced before 14 → *not yet*, the 14 call, the short return, both return options; convinced at 14 with autoend true → `talked_down` fired 25 s later → `trabolta_disabled`; autoend false → only the `# hosts` alert; after `r3_closed` / an ending nothing in the tree moves; 🔄 forgives a barred program; the alarm look → `heart_alarm` and the look put back; no line in any heart beat contains a `secrets.never` string or a hunt-answer word (reuse `mentionsKey`); `stand_down` is gone from the model and the persona.

### 1.4 terminal (Stage B)

**Owns:** everything under `terminal/` — notably `src/app.tsx`, `src/config.ts`, `src/screen.ts`, `src/health.ts`, `src/pilot.ts`, `src/chat.tsx`, `src/idle.ts`, `src/Setup.tsx`, `src/face/`, `src/cutscene/{types,load,pick,registry}.ts`, new `src/cutscene/scenes/heart.tsx` + `heart.css`, new `src/serial/{door-protocol,door-serial,door-bridge}.ts`, new `src/heart/{ChoicePanel.tsx,DoorOverlay.tsx,heart.ts,heart.css}`, tests under `terminal/test/`; `docs/help/play/09-terminals.md`, `docs/trapped/kiosk.md`.

**Builds:**
1. **The door bridge** (D1, §2.9, §2.5): config `door: "serial" | "off"` (URL `door=serial`, ⚙ toggle; default off), ⚙ *Connect door sensor* (`navigator.serial.requestPort({filters: [{usbVendorId: 0x239A}]})`, a user gesture), `getPorts()` + the `connect` / `disconnect` events to reconnect on boot and on replug, line parsing, `get` + the stored thresholds (`localStorage` `loom.terminal.door` `{close, open, mode, settle}`) re-sent as `set …` on each connect, *Calibrate: door shut* / *door open* buttons in ⚙ (→ `cal closed` / `cal open`, then stores the answer), the edge posts and the reconcile (§2.5), the heartbeat keys, feature detection (`"serial" in navigator`; otherwise ⚙ says *needs desktop Chrome on https*). A dev mode `door=sim`: keys `O` / `C` toggle a fake sensor, `F` a fault (tests and the scratch walk).
2. **Room scenes** (D4): `SceneTrigger` gains `{room: string}` (an **exact** folded match against `state.room.cue.value` without its `room_` prefix; a scene with several cues lists several triggers); `drawsSlides(view, room)` lets a room terminal draw **room scenes only**; `pickScene` with `bare` keeps room triggers; a room cue with `at === 0` (history) never plays; `wall` target only. Scenes in §3.8.
3. **The choice panel**: when piloting, take the newest entry of `view.choices` whose `channel === "dm:" + characterId` and whose `beat` folds to start with `heart ` (D18; never `pendingChoice`, which is the oldest menu and may be a stale one); render its options under the thread (Fallout-style list, mouse hover, click, keys `1`–`9` when a keyboard exists), a leading `⟦TAG⟧` drawn as a chip, `POST /api/guest/choose {index, text, choice: id}` with the pilot token; on 409 `moved` / `no choice` re-render from the next view; a local echo `› <text>` in the thread (not persisted); greyed with *CLOSE THE DOOR* while the door is open — from the local sensor only when it is fresh, has no blocking fault and `night.door_override !== true`, else from `night.server_door`.
4. **Keyboardless mode**: config `keys: boolean` (URL `keys=0|1`, ⚙, default true); `keys=0` hides the composer. With a keyboard the composer is hidden while a tree menu is docked, and shown with the one-option ⟦BACK⟧ menu and after the tree (D23, D28 supersede the original "whatever `keys` says"; §8).
5. **The leash**: `lineLeash({answering, filesOpen, heart, doorOpen})`: `answering` → held (busy); `heart` (a heart menu is docked for the piloted program, item 3, or a heart scene played for this line) or `doorOpen` (the door is open **and** `night.heart_stage` ∈ {`door`, `scan`, `talk`}) → `HEART_IDLE_MS` 180 000 / `HEART_WARN_MS` 30 000; otherwise the normal leash (a program who said goodbye frees the terminal). An open door never holds the line for good (§8).
6. **The door overlay** (`DoorOverlay.tsx`): full-width banner *CLOSE THE DOOR* + an amber pulse + `sfx("exclamation")` once, while the door is open (item 3's source) and `night.heart_stage` ∈ {`door`, `scan`, `talk`}; it never ends a pilot.
7. **Face**: `Mood` gains `"dying"` (drooping, slow blink, mouth flat, colour draining to grey over `faceMs`); `FaceHandle.flash` fires on the wall target for room scenes (`faceFlashFor` today is TV-only).
8. A pilot ends when a `room_heart_eject` scene finishes (`end("thrown")`, whether or not a menu ever docked: Heart Barred). A `room_heart_notyet` or `room_heart_leave` scene ends it (`end("done")`) **only on a `keys=0` rig**; with a keyboard the heart to heart continues to the leash (D24).
9. **The bridge's posts** use the header `x-loom-token: <config.token>` (as `pilot.ts` does; the server never reads `Authorization`).

**Tests:** protocol parse / format against §2.9's examples; bridge decisions (edge once, reconcile only when fresh, not in a blocking fault, not within 4 s of a post, never against a null `server_door`, never while `night.door_override`; `ldr_open` still posts; the `x-loom-token` header); the panel's door source (local sensor only when fresh and fault-free and no override, else `night.server_door`); the heart-menu pick (newest `Heart …` entry on `dm:Trabolta`, a stale non-heart menu ignored); `room` trigger picking (room vs wall vs TV, history, priority); choice panel model (dock detection, tag split, text check, greying); leash table; config / URL / ⚙ round trip; health query keys.

### 1.5 stagehand (Stage B)

**Owns:** `stagehand/src/stagehand/lights/{__init__,config,routing,plan,z2m,module}.py` (new), `stagehand/src/stagehand/module.py` (REGISTRY + docstring), `stagehand/src/stagehand/launchd.py` (`JOBS`), `stagehand/src/stagehand/show/module.py` (`hand_looks_to_lights`), `stagehand/src/stagehand/cli.py` (`check --only lights`, `stagehand lights test|pair|devices`), `stagehand/trapped.house.yaml`, `stagehand/lights.example.yaml` (new), `stagehand/tests/test_lights_*.py`, `stagehand/tests/fixtures/house-lights/` (byte copies of the house fixtures), `stagehand/tests/test_trapped_house.py`, `stagehand/tests/test_serverroom_firmware.py`; docs `scripts/house-mac/zigbee.md` (new), `scripts/house-mac/lights.md` (new: the launchd job), `stagehand/README.md`, `docs/loom-show-control.md` (incl. its sensor map: the door is the M4 now). The persona / mind-file tests and fixtures are the story lane's (§1.3).

**Builds:** §2.7 (client side), §2.8, D6, D10, D11, D20, D21 in the YAML and the module: remove the two door rules (D16); the RGB bulb leaves the `server_room` group: if it was the group's only member, remove the group's lines from `lights_server_open`, `lights_alarm` and the catch-up `server_open` rule (dead rules on an empty group), else keep them and say which bulbs remain in a comment; `lights_alarm` gives `wled/server` a steady red preset, never ps 12's strobe (D11: the strip is the room's safety light); keep `lights_server_open`'s WLED `ps 11` and `show/serverroom/alarm off`; a `lights:` section (commented example values) for the house Mac. Use `ModClient.get` / `post` (they exist).

**Tests:** routing / plan / payload parity against the copied fixtures; the module against a fake broker + fake server: a `cue heart_x` directive → the publishes and step timing (a fake clock), a new look cancels the fixture's running steps, a `then: "restore"` look gives back the loop it interrupted (else the settled state) and never becomes it, a looping look never becomes it, the safety clamp, test / identify, a pair request → `zigbee2mqtt/bridge/request/permit_join`, `bridge/devices` → `POST /api/mod/lights/devices` (reduced), the story-derived catch-up (each of D21's four branches) after a reconnect / restart and on `lifecycle reset|reload|golive`, `health/lights`, the `show` hand-off, the YAML's `lights_alarm` never sends `wled/server` a strobe; `test_trapped_house.py` (no `server_door_opened` sensor rule left; `server_door_closed` exists as a story rule); `test_serverroom_firmware.py` (the yaml's ESP32 sensor topics are exactly `{T_PATCH_STATE}`; the door payload test retires).

### 1.6 mapeditor (Stage B)

**Owns:** `reinstall/web/src/map/` — `MapApp.tsx`, `Canvas.tsx`, `Inspector.tsx`, `Toolbar.tsx`, `Panels.tsx`, `edit.ts`, `tools.ts`, `history.ts` (only if `History<T>` needs it), `audio.ts` (only `Doc` and the shared follow call sites), `ProjectBar.tsx` + `project.ts` (Save to project and the *save first* step before a variant switch cover unsaved lights too), new `lights.ts`, `lights-api.ts`, `lights-poll.ts`, `LightsPanel.tsx`, `lights.css`; tests `reinstall/web/test/lights*.test.ts`; `docs/help/authoring/39-house-map.md` (*The house lights*).

**Builds:** D7. `Doc = {house, audio, lights}`; `Selection` gains `{kind: "light"; id}`; `Placing` gains `"light"`; `followHouseLights(before, after, lights)` like `followHouse` (a moved / renamed room, dragged wall, raised floor, re-cut yard; a deleted room drops its lights, counted in the delete confirm); `lightProblemList`; `rebaseLightsHistory`; save plans (lights saved after the map when they need the new map). Canvas: a bulb glyph tinted by the fixture's last tested colour, a `safety` ring, the device name. Inspector: name, id rename, room, x / y / z (y prefilled at the room's floor elevation + 2.1 m: the house frame is absolute), kind, **device** picker (the Z2M devices from `GET /api/mod/lights` `devices`, unplaced ones first, then *type a name*), caps (prefilled from the device), safety + min, 💡 Identify (disabled until saved), colour swatches (red, amber, white, cyan, blue, violet → `/test {fixture, set}`), Delete. The 💡 Lights tab: fixtures list, devices (online / unplaced / *Pair new device* → `/pair {seconds: 120}` with a countdown off `pair.until`), zones, looks (name, targets as chips from `targetOptions`, a set builder: on / brightness / colour / colour temp / effect / transition; steps with `at` ms ≥ 150 apart (≥ 400 when a step sets a colour), loop / repeat / *give the light back after* (`then: "restore"`); ▶ Test look), the module badge (*💡 module online* off `module`). Poll `lights-poll.ts` = `runAudioPoll`'s rules with `tests` / `pairs` cursors.

**Tests:** every pure op (add / place / move / duplicate / rename / remove / follow), problems, save plans, the 409 path, poll cursors, device ordering, the look builder producing a `LightLook` that `validateLights` accepts.

### 1.7 editor (Stage B)

**Owns:** `editor/src/lib/terminals.ts` (+ test), `editor/src/components/run/TerminalsCard.tsx`, `editor/src/components/run/HouseMapCard.tsx`, `editor/src/lib/lights-status.ts` (new, + test), `editor/src/lib/terminal-setup.ts` + `components/run/TerminalSetup.tsx` (the `keys=0` and `door=serial` link options); `docs/help/authoring/43-run-mode.md`.

**Builds:** `terminalBadges` key `door`: 🚪 green *shut* / amber *open* with `doorLevel`, red *fault: <code>* (hover: *the door sensor reports a fault; use 🚪 opened / closed until it is fixed*), a small *⚠ <warn>* after the state for `doorWarn` (hover for `ldr_open`: *the sensor sees almost no light; normal for an open door in a dark hall, a cut wire if the door is shut*), and amber *override* while the screen state's `night.door_override` is true (hover: *the story follows the 🚪 buttons; press 🚪 Trust the door sensor to hand it back*); absent when the terminal reports `door: "none"` or nothing. A 💡 row on the House map card from `GET /api/mod/lights` (no long poll; refresh every 15 s): *💡 lights module online · N fixtures* / *offline*, *pairing … s* while `pair.until` is ahead, problems count. The glance needs nothing: the story's `watch:` lines carry the heart (§3.10).

### 1.8 docs (after integration)

**Owns:** `packages/loom/CLAUDE.md` (a wave 20 status + the table rows), the show's `README.md` (cue sheet, integration contract: the door row, lights), `DESIGN.md`, `DEMO.md`, `CHECKLIST.md` (§D server-room door: the M4 BOM incl. the LDR shroud tube + HW-DOOR rows, replacing the stale reed / SNZB-04P recommendation (≈ L739–760); §C the RGB bulb, HW-LIT-01 / HW-LIT-09, HW-SAFE-08 (`power_on_behavior: on`, the `wled/server` safety strip); §A the CC2652P coordinator; HW-NET-06 gains Steph's laptop), `OCT31.md` (wave 20 status), `SCHEDULE.md`, `SIGNOFF-w20.md` (D1–D17, every DRAFT line old → new), `cast-packs/` (patch-bay watch, emergency card, all-crew, the four server-room Antivirus: *close the door behind the program; the door sensor is a light on the frame*); `docs/help/authoring/33-live-verbs.md` and `44-mind-debugger.md` (both name `stand_down`: the tree replaced it).

---

## §2 Wire contracts

### 2.1 Signals (story events posted from outside)

| Name (folded; post the snake_case form) | Subject | Args | Who posts | Notes |
|---|---|---|---|---|
| `door_sensor_opened` / `door_sensor_closed` (**new**) | none | `{level: number}` | the terminal's door bridge only | ignored while `Night.door_override == true`; else fires `heart_door_opened` / `_closed` |
| `server_door_opened` | none | none | admin 🚪 (exists; also `scripts/accept/K-27.ts` until the firmware lane moves it); booth `radio_door_opened` (via its rule) | sets `door_override = true`, fires `heart_door_opened` |
| `server_door_closed` (**new**) | none | none | admin 🚪 (new); booth `radio_door_closed` (new, via its rule) | sets `door_override = true`, fires `heart_door_closed` |
| `server_door_trust` (**new**) | none | none | admin 🚪 | clears `door_override`; `# hosts` *🚪 The story follows the door sensor again.* |
| `heart_door_opened` / `heart_door_closed` | none | none | **story-internal** (`fire`); never posted from outside | the door rules (§3.2); a duplicate (same state) is ignored |
| `terminal_opened` / `terminal_closed` | the program | `{at: <LOCATION>}` | the terminal (unchanged) | |

The bridge posts `POST /e/:eventId/api/mod/signal` with the header **`x-loom-token: <config.token>`** (the server reads only `x-loom-token` or a body `token`: `http-util.ts` `tokenOf`; never `Authorization`), body `{name, args: {level}, label: "Terminal · <config.name>"}`. Answers as today (200 `{ok, …}`; 409 `no scenario loaded` → retried by the reconcile).

### 2.2 `/api/guest/choose` (D15)

`POST /e/:eventId/api/guest/choose {index: number, text?: string, choice?: number}` (guest or impersonation token).
- 409 `{error: "doors are closed"}` (unchanged).
- `choice` (D18) names the menu by its id; absent = the oldest menu (today's behaviour). No menu with that id pending (or none at all) → 409 `{error: "no choice", options: null}`.
- With `text`: the named menu's option at `index` is not `text` → 409 `{error: "moved", options: string[]}` (that menu's options).
- Without `text` / `choice`: unchanged (old clients).
- 200 `{ok: true}`.
- **Sim:** `PendingChoice` gains `id: number` (the log index of its `choicePrompted` event; equal after a restore) and `beat: string`; `Sim.choose(person, index, id?)` answers that menu and leaves the others queued; the journaled `choose` mutation gains an optional `choice` (an old journal without it replays as today). `choicePrompted` carries `id`.
- **View:** `GuestView.choices: Array<{id: number; beat: string; channel: string; options: string[]}>`, oldest first; `channel` is where that menu's prompt went (the per-menu twin of `decisionChannelFor`, rebuilt on restore). `pendingChoice` / `decisionChannel` stay as today (the oldest menu; the phone's tray). *As built:* `choices?` is optional on the `GuestView` type (an older server and the frozen w18 view fixtures carry none), so every client reads `view.choices ?? []`; `decisionChannel` is the oldest menu's own channel; a menu whose batch has no line before it docks under the character who last spoke to that person (carried across batches, rebuilt on restore), else the lobby.

### 2.3 Guarded choices (D9)

- **Parsing order:** the guard is split off **before** `splitChoiceSuppression` (parser.ts), so a `[` inside a condition is never read as hidden text.
- **Editing:** `core/src/parser/edit.ts` and the story graph's word blocks (`lsp/graph.ts`) show a guarded option with its guard, and an in-place edit of the option's text keeps the guard.
- **Syntax:** a choice line whose text, after `*` / `+` and spaces, starts with `(if ` and whose parenthesis closes on the same line: `+ (if program.trust >= 20) ⟦TRUSTED⟧ You trust me more than anyone here.` Parens inside the condition nest. Anything else is plain text.
- **AST:** `Choice` gains `guard: string | null` (the condition source, trimmed); `text` is what follows the `)`, trimmed.
- **Sim:** when a menu is prompted (`case "choice"`), each option's guard is evaluated in the frame's bindings exactly like `if`; false or an evaluation error (→ a `diagnostic` event) drops the option. If no option is left, nothing is queued, no `choicePrompted` is recorded and execution continues after the menu. `PendingChoice.options` and `choicePrompted.options` hold only the shown options, so `choose(person, index)` indexes the shown list. Replay is deterministic (the guard reads the same world).
- **Lint:** `L1221 ChoiceGuardInvalid` (the condition doesn't parse; the option is then never offered).
- **Bank:** diagnostic `choiceGuardIgnored {beat, line}`; the option compiles unguarded. *As built:* the beat rides `BankDiagnostic.program` (the beat's key), `line` is 1-based.
- **Tags:** a Fallout-style tag is written `⟦WORD⟧` at the start of the text (U+27E6 / U+27E7). Never `[…]`: in a choice that is hidden text.

### 2.4 Screen state additions (`GET /api/screen/state`)

```ts
// core/server/routes/screen.ts (the terminal mirrors these in terminal/src/screen.ts)
export interface ScreenRoom {
  id: string;
  open: boolean;
  /** (wave 20) The last `cue room_<name>` played in a beat whose setting folds to
   *  this LOCATION (id or label), else null. */
  cue: ScreenRoomCue | null;
}
export interface ScreenRoomCue {
  /** The cue's first token, as written: `room_heart_wake`. */
  value: string;
  /** Bumps on every such cue for this room, a repeat included. */
  seq: number;
  /** Server epoch ms the fold first saw it; 0 = before this server's fold (history: never played). */
  at: number;
}
export interface ScreenNight {
  // … existing fields …
  /** (wave 20) `Night.server_door`: "open" | "closed" (null: no story / unset). */
  server_door: "open" | "closed" | null;
  /** (wave 20) `Night.heart_stage`: "sealed" | "door" | "scan" | "talk" | "done". */
  heart_stage: string | null;
  /** (wave 20) `Night.heart_look`: the settled heart look ("none" reads null). */
  heart_look: string | null;
  /** (wave 20) `Night.alarm_on`: the patch-bay alarm latch. */
  alarm_on: boolean | null;
  /** (wave 20) `Night.door_override`: the story follows the 🚪 buttons, not the sensor. */
  door_override: boolean | null;
}
// SCREEN_NIGHT_VARS gains: server_door, heart_stage, heart_look, alarm_on, door_override
// (their `Night.*` paths; no slide gate: always carried).

export interface ScreenDevice {
  // … existing fields …
  /** (wave 20) The door sensor this terminal bridges: absent = none configured. */
  door?: "open" | "closed" | "fault" | "none";
  /** The sensor's last level (0–4095: the lit − dark difference in `mod` mode). */
  doorLevel?: number;
  /** The blocking fault while `door === "fault"` (`ldr_saturated` | `led_dead` | `stale` | `no_port`). */
  doorFault?: string;
  /** A non-blocking warning (`ldr_open`): the door state above still holds. */
  doorWarn?: string;
}
```

Fold rule for `room.cue`: a `directive` event with `verb === "cue"`, whose args' first token (split on whitespace / comma) starts with `room_`, and whose `setting` folds (`foldName`) equal to the polled LOCATION's id or label. Kept per LOCATION, last wins. `cue room_*` is never a screen cue family and never a moment.

Heartbeat query keys (added to `screenDeviceOf`): `door=open|closed|fault|none`, `dlv=<0-4095>` (integer), `dft=<[a-z_]{1,24}>`, `dwn=<[a-z_]{1,24}>`. Anything malformed is left out. `/api/mod/screen/terminals` carries them in `ScreenWho.device`.

**Moments** (`momentOf`, wave 17): `QUIET_MOMENT_SIGNALS` gains `server_door_opened`, `server_door_closed`, `server_door_trust`, `heart_autoend` (the admin door / toggle cues; `door_sensor_*`, `heart_door_*` and the radio cues are not admin, so never moments already). A new `QUIET_MOMENT_BEATS` (folded, beside it in `screen.ts`): `Heart Nag`, `Heart Door Again`, `Heart Door Shut`, `Heart Sealed` — subject-free beats that never become a `beat` moment. `The Heart` stays a moment.

### 2.5 The terminal's door bridge (behaviour other lanes rely on)

- `door=serial`, port connected, a `door` line within 3 s → heartbeat `door` = `open` / `closed` (or `fault` when the line's `fault` is non-null), `dlv` = `level`, `dft` = `fault`, `dwn` = `warn`. Configured but no port / no line for 3 s → `door=fault`, `dft=no_port` / `stale`. `door=off` → no keys.
- **Gate:** nothing is posted until a screen poll has answered `night.server_door !== null` (before Power On the story's own init would overwrite it; the reconcile covers the gap), nor while `night.door_override === true` (the story would ignore it, D19).
- **Edges:** when the firmware's `open` changes and `fault === null` (a `warn` doesn't block), post `door_sensor_opened` / `door_sensor_closed` once (retry 1 s / 2 s / 4 s on a network error).
- **Reconcile:** on each screen poll, if the sensor is fresh, not in a blocking fault, nothing in flight, the last post was ≥ 4 s ago, `night.server_door !== null`, `night.door_override !== true` and the story differs from the sensor → post the sensor's edge. (On boot and after an override is cleared this is the next poll.) The story enforces the override, so a stale bridge can never undo a director.
- **Fault:** post nothing (D1). A fault or a warning is shown on Run → Terminals (the red 🚪 badge, `dft` / `dwn`) and in ⚙ only, never on the guest-facing screen (D29(c): the door sensor is *the door*; §8).

### 2.6 `lights.json` (`@loom/house` `house/src/lights.ts`)

#### 2.6.1 Types

```ts
export const LIGHTS_FILE = "lights.json";
export const LIGHTS_EVERYWHERE = "everywhere";
export const LIGHT_KINDS = ["zigbee", "zigbee-group", "wled"] as const;
export type LightKind = (typeof LIGHT_KINDS)[number];
export const LIGHT_EFFECTS = ["blink", "breathe", "okay", "channel_change", "finish_effect", "stop_effect"] as const;
export type LightEffect = (typeof LIGHT_EFFECTS)[number];
/** Zigbee bulbs drop commands sent faster than this (ms between steps on one fixture). */
export const LIGHT_STEP_MIN_MS = 150;
/** A step that sets `color` / `color_temp` is 2–3 Zigbee commands: at least this far from the fixture's previous step. */
export const LIGHT_COLOR_STEP_MIN_MS = 400;
/** A looping look on a `zigbee` / `zigbee-group` fixture with a shorter period is a warning (never stream flicker over Zigbee). */
export const LIGHT_LOOP_MIN_PERIOD_MS = 1500;
/** How long after a `then: "restore"` look's last step the settled state comes back (ms; the look's `period` overrides). */
export const LIGHT_RESTORE_MS = 1000;
/** Longest look, steps included (ms), and the most steps. */
export const LIGHT_LOOK_MAX_MS = 120_000;
export const LIGHT_MAX_STEPS = 64;
/** A safety fixture's floor (Z2M brightness 0–254) unless its own `min` is higher. */
export const LIGHT_SAFETY_MIN = 40;
/** Cue families a look name may never start with (they are the screens'). */
export const LIGHT_RESERVED_PREFIXES = ["screens_", "terminals_", "tv_", "tablet_", "room_"] as const;

export interface LightCaps { color: boolean; ct: boolean; dim: boolean }

export interface LightFixture {
  id: string;                         // ^[a-z0-9][a-z0-9-]*$
  name: string;
  room: string;                       // a house.json room id
  floor?: string;
  pos: { x: number; y: number; z: number };   // metres, the house frame
  kind: LightKind;
  /** Z2M friendly name (zigbee), Z2M group friendly name (zigbee-group), or the WLED base topic (`wled/server`). */
  device: string;
  caps: LightCaps;
  /** Never OFF, never below `min ?? LIGHT_SAFETY_MIN`. */
  safety?: boolean;
  min?: number;                       // 1–254
}

export interface LightZone { id: string; name: string; fixtures: string[] }

/** One command to one or more fixtures, in Z2M's words. */
export interface LightState {
  state?: "ON" | "OFF";
  brightness?: number;                // 0–254
  color?: string;                     // "#rrggbb"
  color_temp?: number;                // mireds 150–500
  effect?: LightEffect;
  transition?: number;                // seconds 0–30
}

export interface LightStep {
  at: number;                         // ms from the look's start, strictly increasing per fixture, ≥ 150 apart
  set: LightState;
  /** Narrower targets than the look's (default: the look's). */
  to?: string[];
}

export interface LightLook {
  to: string[];                       // targets (§2.6.2)
  /** One command at t = 0 (shorthand for steps: [{at: 0, set}]). */
  set?: LightState;
  steps?: LightStep[];
  /** Repeat the steps this many times (1 = once; default 1); `loop: true` = until another look. */
  repeat?: number;
  loop?: boolean;
  /** The step period when repeating (ms; default last step's `at` + 150). For `then: "restore"`: the delay from the start to the restore (default last step's `at` + `LIGHT_RESTORE_MS`). */
  period?: number;
  /** (D20) `"restore"`: after the look, re-publish each fixture's settled state; the look never becomes it. Not with `loop`. */
  then?: "restore";
  note?: string;
}

export interface LightsConfig {
  version: 1;
  note?: string;
  fixtures: LightFixture[];
  zones: LightZone[];
  /** Keyed by the story's cue name: `cue heart_wake` plays `looks.heart_wake`. */
  looks: Record<string, LightLook>;
  /** Applied by the module on boot and after a story reset (optional). */
  boot?: string;
}

export interface LightsValidation { ok: boolean; problems: string[]; warnings: string[] }
export interface LightTargets { fixtures: string[] }
/** One timed command for one fixture, safety-clamped. */
export interface LightCommand { at: number; fixture: string; set: LightState }
export interface LightPlan { commands: LightCommand[]; loop: boolean; period: number | null; repeat: number }

export function lightsHash(l: LightsConfig): string;              // fnv1a32 hex, like audioHash
export function defaultLights(): LightsConfig;                    // {version: 1, fixtures: [], zones: [], looks: {}}
export function resolveLightTargets(l: LightsConfig, house: HouseMap | null | undefined, to: readonly string[]): LightTargets;
export function validateLights(l: unknown, house?: HouseMap | null): LightsValidation;
export function clampForSafety(f: LightFixture, s: LightState): LightState;
export function planLook(l: LightsConfig, house: HouseMap | null | undefined, name: string): LightPlan | null;
export function z2mPayload(f: LightFixture, s: LightState): Record<string, unknown>;
export function wledPayload(f: LightFixture, s: LightState): Record<string, unknown>;
```

#### 2.6.2 Targets (`resolveLightTargets`, folded with `foldTarget`)

`everywhere` → every fixture; a fixture id; a zone id or name; a room id; a room label; a LOCATION (a room whose `location` folds equal). Unknown targets resolve to nothing (a warning in `validateLights`). Order: the fixtures' order in the file, de-duplicated.

#### 2.6.3 Rules

`clampForSafety` on a safety fixture: `state: "OFF"` → `"ON"` with `brightness: min`; `brightness < min` → `min`. Non-safety: unchanged. `planLook`: expands `set` / `steps` over each step's targets, drops fields a fixture's caps can't do (`color` without `caps.color`, `color_temp` without `caps.ct`, `brightness` without `caps.dim`), clamps, sorts by `at` then fixture order; `period` = `look.period ?? last.at + (then === "restore" ? LIGHT_RESTORE_MS : LIGHT_STEP_MIN_MS)`; `repeat` = `loop ? 0 : (look.repeat ?? 1)`; `LightPlan` gains `restore: boolean`. The module's *settled state* per fixture is the last command of the last look that is neither looping nor `restore`.

**Problems** (`ok: false`): version ≠ 1; a duplicate / malformed fixture or zone id; a fixture with no `device`, an unknown `kind`, a bad `pos`; a zone naming an unknown fixture; a look name not `^[a-z][a-z0-9_]*$` or starting with a reserved prefix; a look with neither `set` nor `steps`, or both; a step `at` < 0, not increasing per fixture, closer than `LIGHT_STEP_MIN_MS` on one fixture (`LIGHT_COLOR_STEP_MIN_MS` when the later step sets `color` / `color_temp`), a state with both `color` and `color_temp`, `then` with `loop`, or a look longer than `LIGHT_LOOK_MAX_MS` / more than `LIGHT_MAX_STEPS` steps; a value out of range (brightness, colour hex, mireds, transition, effect); `repeat` < 1 or > 100; `boot` naming no look; **a look that turns a safety fixture OFF or below its min** (written into the file, not just clamped). With a house: a fixture's room unknown, its floor not the room's, its `pos` outside the room by more than 0.05 m in plan, or its `pos.y` outside [the floor's `elevation` − 0.05, the next floor's `elevation` + 0.05] (the top floor: `elevation` + 4) — the house frame is absolute (the basement is at −2.7).

**Warnings:** a looping look whose `period` is under `LIGHT_LOOP_MIN_PERIOD_MS` on a `zigbee` / `zigbee-group` fixture; a target that resolves to nothing; a look whose fields the targets' caps all drop; an effect on a fixture of kind `wled` other than `blink` / `breathe`; a fixture no look uses.

#### 2.6.4 Payloads and topics

- `zigbee` / `zigbee-group` → topic `zigbee2mqtt/<device>/set`, payload = the clamped `LightState` with only the set fields, `color` as `{"hex": "#rrggbb"}`. Example: `{"state": "ON", "brightness": 254, "color": {"hex": "#FF2A00"}, "transition": 0}`.
- `wled` → topic `<device>/api`, payload JSON `{"on": state !== "OFF", "bri": brightness, "transition": round(transition * 10), "seg": [{"col": [[r, g, b]], "fx": 0 | 1 (blink) | 2 (breathe)}]}` with only the set fields.
- Identify (a test with no `set`): Z2M `{"effect": "okay"}`; WLED `{"on": true, "seg": [{"fx": 1}]}` for 2 s then the fixture's last look.

#### 2.6.5 The show's file (story lane writes it; DRAFT values, retune on site)

```json
{
  "version": 1,
  "note": "Wave 20: the server room's RGB bulb only. Every other light is still trapped.house.yaml's. DRAFT.",
  "fixtures": [
    { "id": "server-room-rgb", "name": "Server room RGB bulb", "room": "server-room", "floor": "basement",
      "pos": { "x": 4.6, "y": -0.6, "z": 25.2 }, "kind": "zigbee", "device": "server_room_rgb",
      "caps": { "color": true, "ct": true, "dim": true }, "safety": true, "min": 40 }
  ],
  "zones": [ { "id": "heart", "name": "The Heart", "fixtures": ["server-room-rgb"] } ],
  "boot": "heart_idle",
  "looks": { "…": "§4" }
}
```

`y: -0.6` is the basement ceiling (floor −2.7; the server-room terminal hangs at −1.3). The fixture's `pos` must sit inside the `server-room` room of both show maps (the story lane checks with `validateLights(lights, house)` for `house.json` and `house.shed.json` in a test and moves the point if not).

### 2.7 Lights routes (`core/server/lights.ts`)

All under `/e/:eventId`; auth = a mod token or an author session that may moderate (the audio rule). None is on the host allowlist.

```ts
export type LightsSource = "director" | "project" | "env" | "default";
export interface LightTest { seq: number; at: number; fixture?: string; look?: string; set?: LightState; by: string }
export interface LightPair { seq: number; at: number; seconds: number; until: number; by: string }
export interface Z2mDevice {
  friendly: string; ieee: string; type: string;          // "Coordinator" | "Router" | "EndDevice" | "Group"
  model: string | null; vendor: string | null; description: string | null;
  caps: LightCaps | null;                                 // null: not a light
  members?: string[];                                     // a group's member friendly names
}
export interface LightsModule { name: string; at: number; online: boolean }   // online: polled within 40 s
export interface LightsView {
  lights: LightsConfig; version: string; source: LightsSource;
  looks: string[];        // every `cue X` in the story whose X is a valid look name (sorted, deduped): the editor's suggestions
  locations: string[];
  tests: LightTest[];     // the last 8, ≤ 60 s old
  pair: LightPair | null; // the latest, while `until` is ahead
  devices: Z2mDevice[]; devicesAt: number | null;
  module: LightsModule | null;
  problems: string[]; warnings: string[];
  now: number;            // the server's clock when it answered: the anchor for `pair.until`, `module.at`, `devicesAt` (§8)
}
```

| Method + path | Body / query | Answers |
|---|---|---|
| `GET /api/mod/lights` | `?after=<version>&tests=<seq>&pairs=<seq>&wait=<s ≤ 30, default 25>&module=1&name=<host>` | 200 `LightsView`. Long poll: with `after` it parks until the version moves, a test seq > `tests`, a pair seq > `pairs`, new devices, or `wait`. `module=1` records the module's presence. |
| `POST /api/mod/lights` | `{lights: LightsConfig, base?: string}` | 200 `{ok: true, version, source: "director", warnings}`; 400 `{problems, warnings}`; 409 `{error: "stale", version, source}` |
| `POST /api/mod/lights/project` | `{}` | 200 `{ok: true, version}` (writes `lights.json` to the project, drops the director save, refreshes the row snapshot); 409 `{error: "no project"}`; 502 `{error}` |
| `POST /api/mod/lights/test` | `{fixture}` (identify) \| `{look}` \| `{fixture, set: LightState}` | 200 `{ok: true, seq, module: boolean}`; 400 `{error}`; 404 `{error: "no such fixture" \| "no such look"}`. Memory only. |
| `POST /api/mod/lights/devices` | `{devices: Z2mDevice[]}` (≤ 500, ≤ 256 KB) | 200 `{ok: true, n}`; 400 `{error}`. Memory only (replaced whole). |
| `POST /api/mod/lights/pair` | `{seconds: 0–254}` (0 closes) | 200 `{ok: true, seq, until}`; 400 `{error}`. Memory only. |
| `POST /api/mod/load` | `{…, lights?: string \| null}` | as today; `lights` sets the project text |

`Store`: `loadLights(): string | null`, `saveLights(text: string | null)`, `loadLightsSave(): unknown`, `saveLightsSave(l: unknown)`, `clearLightsSave()`. `EventRuntimeInit` / registry spec: `lights?: string | null`. Env: `LOOM_LIGHTS=<path>` (re-read on mtime, last good kept).

### 2.8 The stagehand `lights` module

- **Config** (`lights:` section of a machine YAML; `lights.example.yaml`):
  ```yaml
  lights:
    mqtt: { host: 127.0.0.1, port: 1883 }   # the anonymous loopback listener (Z2M's broker)
    z2m_base: zigbee2mqtt
    config_file: lights.json                 # local fallback before the server answers
    cache_dir: ~/Library/Caches/stagehand-lights
    poll_wait: 25
    health_s: 15
    take_looks: true                         # show drops YAML cue rules whose name lights.json defines
  ```
- **Loops:** `GET /api/mod/lights?module=1&name=<hostname>&after=&tests=&pairs=&wait=` (cache the config to `cache_dir/lights.json`; 404 = an older server → local file, retry every 60 s; the first answer only primes the `tests` / `pairs` cursors); `GET /api/spatial/house` for rooms → LOCATIONs (refresh 5 min); its own feed `mod.feed_url("stagehand-lights")` handling `sim` frames (`directive` events with verb `cue`: the first token after interpolation; if it names a look → play it) and `lifecycle` (`reset` / `reload` / `golive` → clear the cache, play `boot` after 1.5 s); MQTT subscribe `zigbee2mqtt/bridge/devices` + `zigbee2mqtt/bridge/groups` (retained) → reduce → `POST /api/mod/lights/devices` (debounced 2 s, again on every poll answer that has `devicesAt === null`).
- **Playing:** `planLook` mirror; a new look on a fixture cancels that fixture's running steps (a running `restore` included: its restore is dropped); publishes at the planned offsets (one asyncio task per look, monotonic clock); `repeat` / `loop` re-run the steps every `period`; a `then: "restore"` look, at `period`, restarts the loop it interrupted, else re-publishes the fixture's settled state. The settled state (§2.6.3) is kept in memory only; never a loop's step, never a `restore` look.
- **Catch-up (D21, from the story, not a cache):** on an MQTT or feed reconnect, on module start and 1.5 s after `lifecycle reset|reload|golive`, `GET /api/screen/state` with the mod token and play: `night.alarm_on` → `heart_alarm`; else `night.server_door == "open"` and `night.heart_stage` ∈ {door, scan, talk} → `heart_door_open`; else `night.heart_look` when non-null → that look; else `boot`. A 404 / an older server without these fields → `boot`. (Generalising this to looks other than the heart's is out of scope: this wave's file holds the server room only.)
- **Tests:** a `look` test plays the look; `fixture` alone identifies; `fixture + set` publishes that state (clamped).
- **Pair:** publish `zigbee2mqtt/bridge/request/permit_join` `{"time": <seconds>}` (Z2M 2.x; `{"time": 0}` closes).
- **Health:** retained `health/lights` `online` / LWT `lost`; `health/lights/stats` `{fixtures, looks, devices, last_look, last_at, z2m: "online" | "offline"}` (Z2M's `zigbee2mqtt/bridge/state`).
- **Hand-off:** `ShowControl.hand_looks_to_lights(names: set[str])` drops YAML rules matching `on: {directive: cue}` whose target is in `names` (logged once).
- **REGISTRY** `lights`: `ModuleSpec("house lights from lights.json (Zigbee2MQTT + WLED)", "stagehand.lights.module:build_lights")` (the other entries' shape); `launchd.JOBS` gains `"lights"`; `stagehand check --only lights` (config valid, broker reachable, Z2M bridge online, every fixture's device in the device list).

### 2.9 The door sensor's serial protocol (Grand Central M4)

- USB CDC, 115200 8N1, `\n`-terminated ASCII lines, one JSON object per output line.
- **Wiring (README):** LDR from 3V3 to A0; 10 kΩ A0 → GND (more light → higher reading, near 4095 when lit), the LDR inside a short black shroud tube aimed at the LED. The user's current LED reads "about max", so it is probably on 3V3 (→ `steady`); for `mod`, the LED anode from **D2** through 220 Ω (or a 2N7000 / NPN for a brighter LED). Optional sense: LED cathode → 47 Ω → GND with **A1** on the cathode (`LED_SENSE 1`). `analogReadResolution(12)` in `setup()` (SAMD defaults to 10-bit; the thresholds assume 12). Status on the onboard NeoPixel (`PIN_NEOPIXEL`): green shut, amber open, purple fault, blue until the host has spoken once. The board's USB PID changes in bootloader mode, so after a reflash Chrome may need the port granted once more (the runbook says so).
- **Mode `auto` (default):** at boot, drive D2 low, settle `settle_ms`, read; drive it high, settle, read; repeat 3 times. A mean difference ≥ 200 → `mod`, else `steady` (the LED isn't on D2); `hello` / `cfg` report the chosen `mode` and `"auto":true`. `set mode mod|steady|auto` overrides (stored by `save`).
- **Sampling (`mod`):** LED on, settle `settle_ms`, average 8 reads → `lit`; LED off, settle `settle_ms`, average 8 → `dark`; `level = max(0, lit − dark)`; one frame per ≈ 2 × `settle_ms` + 20 ms. `settle_ms` is a stored setting, default **150** (a CdS cell takes ≥ 30 ms to start falling and far longer to reach dark; N-20 measures the real figure), range 20–1000. Under room light a CdS cell's `lit − dark` **falls** (non-linear response), so the defaults are chosen from N-20's worst case. The LED blinking at ≈ 2 Hz sits inside the shroud. **`steady`:** LED (or 3V3) always on, `level = lit`, `dark = 0`, one frame per 50 ms.
- **Classifier:** closed when `level ≥ close` for `close_ms` 1000; open when `level ≤ open` for `open_ms` 250 (a run starts at the start of its first frame, so in `mod` at settle 150 a single open frame decides: an opening reads ≈ 150–450 ms after the beam breaks, plus the cell's lag; N-20 measures it; §8); between the two, the last state holds. Defaults `close = 1800`, `open = 1200`, `mode = auto`, `settle = 150` (N-20 proposes real values; the terminal re-sends its stored ones on connect).
- **Faults** (blocking: each needs 2 s; clears after 2 s clean; forces `open: true`; the bridge posts nothing): `ldr_saturated` (`mod`: dark > 4000), `led_dead` (`LED_SENSE` and the sense reading < 20 while driven). **Warning** (`warn`, never blocks, never changes `open`): `ldr_open` (lit < 8 and dark < 8 for 2 s): a cut wire looks the same as an open door in a dark hall, so it is reported, not acted on; it clears after 2 s clean.
- **Output lines:**
  ```
  {"t":"hello","fw":"door-m4 1.0.0","mode":"steady","auto":true,"close":1800,"open":1200,"settle":150,"cal":false,"sense":false}
  {"t":"door","seq":17,"open":false,"level":2410,"lit":3020,"dark":610,"fault":null,"warn":null}
  {"t":"door","seq":18,"open":true,"level":35,"lit":640,"dark":605,"fault":null,"warn":null}
  {"t":"door","seq":19,"open":true,"level":0,"lit":3,"dark":2,"fault":null,"warn":"ldr_open"}
  {"t":"door","seq":20,"open":true,"level":0,"lit":4095,"dark":4095,"fault":"ldr_saturated","warn":null}
  {"t":"pong","up":123456}
  {"t":"cfg","fw":"door-m4 1.0.0","mode":"mod","auto":false,"close":1800,"open":1200,"settle":150,"cal":true,"sense":false,"saved":true}
  {"t":"cal","which":"closed","ref":2400,"close":1880,"open":1320}
  {"t":"ok","cmd":"set close 1900"}
  {"t":"err","error":"cal span too small","cmd":"cal open"}
  ```
  `hello` on boot and on `version`; `door` on every change and every 1 s (`seq` +1 per line); `cfg` on `get` and after `save`.
- **Commands:** `ping` · `version` · `get` · `cal closed` (2 s average of `level`, stored as the shut reference) · `cal open` (the open reference; after both: `open = o + 0.35·(c − o)`, `close = o + 0.65·(c − o)`, refused when `c − o < 200`) · `set close <0-4095>` · `set open <0-4095>` (refused unless `open < close`) · `set mode mod|steady|auto` · `set settle <20-1000>` · `save` (FlashStorage_SAMD record `{magic 0xD00E, ver 1, close, open, mode, settle}`) · `reset` (defaults, not saved). Anything else → `{"t":"err","error":"unknown command","cmd":"…"}`.

### 2.10 Story vars (all on `Night` / ROLE `Program`; none secret, none on the Kernel)

| Var | Type / values | Init | Written by | Read by |
|---|---|---|---|---|
| `Night.server_door` | `"open"` \| `"closed"` | `"closed"` (Power On) | the `heart_door_opened` / `_closed` rules | story, screens (`night.server_door`), the bridge's reconcile, Trabolta's worker (public) |
| `Night.heart_stage` | `"sealed"` \| `"door"` \| `"scan"` \| `"talk"` \| `"done"` | `"sealed"` | §3 rules | story, screens, glance |
| `Night.door_override` | bool | false | 🚪 `server_door_opened` / `_closed`, the radio cues (true); 🚪 `server_door_trust` (false) | the sensor rules, the bridge, screens, Run |
| `Night.door_again_at` | seconds | 0 | Heart Door Again | the opened rule (at most once per 20 s) |
| `Night.door_again_said` | bool | false | Heart Door Again (true); the closed rule (false, after Door Shut) | the closed rule (*Good.* only after a Door Again) |
| `Night.heart_present` | bool | false | `terminal_opened` / `_closed` for the holder | story |
| `Night.heart_talker` | text | `"none"` | Heart Talk, Heart Pick | `watch:` |
| `Night.heart_talker_suspicion` / `heart_talker_layer` | 0–100 / 0–4 | 0 | Heart Talk, Heart Pick (mirrors of the talker's own) | `watch:` |
| `Night.heart_talks` | 0–99 | 0 | each Heart Talk start | story (*Another one.*) |
| `Night.door_nag_at` | seconds | 0 | door rules | the nag watcher |
| `Night.door_nags` | 0–99 | 0 | the nag watcher; reset on close | Heart Nag, `# hosts` |
| `Night.heart_look` | look name \| `"none"` | `"none"` | every heart look cue | the alarm latch's end |
| `Night.heart_autoend` | bool | true | Power On; 🕊 `heart_autoend` toggle | Heart Shutdown |
| `Night.heart_end_at` | seconds | 0 | Heart Shutdown; cleared by 🕊 `heart_autoend` turned off | the autoend watcher |
| `Night.heart_resume_at` | seconds | 0 | Heart Sealed (present: + 6) | the resume watcher (waits out `room_heart_sealed_present`) |
| `Night.heart_gen` | 0–99 | 0 | 🔄 `reset_server_room` | the forgive watcher |
| `Night.her` | `"her"` \| `"Sandy"` | `"her"` | a story watcher: `(Night.step >= 13 and Night.scenario == 1) or Night.recount == true` | heart lines |
| `Night.heart_holder`, `heart_opened`, `stand_down_by`, `talked_down` | as today | | | |
| `program.heart_layer` | 0–4 | 0 | the tree | story, persona `them:` |
| `program.heart_suspicion` | 0–100 | 0 | the tree | story |
| `program.heart_case` | 0–9 | 0 | the tree | story |
| `program.heart_proof` | bool | false | the tree | story |
| `program.heart_pick` | `text = "none"` (declared with its default: an unset slot is not `"none"`) | `"none"` | an option body | Heart Pick |
| `program.heart_menu` | bool | false | before / inside every menu | Heart Talk, persona `them:` |
| `program.heart_wait` | bool | false | Heart Pick, terminal_opened, the forgive watcher (a holder still at the terminal) | the resume watcher |
| `program.heart_out` | bool | false | Heart Eject | Heart Talk, the persona's situations (`them.heart_out`), the dossier's `heart.barred` |
| `program.heart_chat` | bool | false | ⟦SPEAK FREELY⟧, Heart Leave, Heart Not Yet (true); a tree pick, terminal_closed, the holder watcher, an eject, an ending, 🔄 (false) | the persona's *heart to heart*, `them:` |
| `program.heart_go` | `text = "none"` | `"none"` | Heart Pick (`layer` / `speak` / `leave` / a layer name) | Heart Pick's routing, Heart Talk (⟦BACK⟧ still docked) |
| `program.heart_warned` | bool | false | Heart Warn | story |
| `program.heart_convinced` | bool | false | Heart Convinced | story |
| `program.heart_called` | bool | false | the Y2K call watcher | story |
| `program.heart_gen_seen` | 0–99 | 0 | the forgive watcher | story |
| `program.heart_asked_what` / `_why` / `_her` | bool | false | Layer Two | guards |
| `program.heart_shown_says` / `_file` / `_trusted` / `_honest` / `_overshare` / `_journal` | bool | false | Layer Three | guards |

Persona `them:` gains `heart_layer, heart_menu, heart_convinced`; `facts:` gains `Night.heart_stage, Night.server_door` and drops nothing else.

### 2.11 Cues

- **Looks** (`cue heart_<x>`; played by the lights module; §4): `heart_wake`, `heart_nag`, `heart_door_open`, `heart_sealed`, `heart_listen`, `heart_argue`, `heart_proof`, `heart_warn`, `heart_eject`, `heart_notyet`, `heart_shutdown`, `heart_idle`, `heart_alarm`.
- **Room scenes** (`cue room_<x>`, in a beat set in The Server Room; the terminal; §3.8): `room_heart_wake`, `room_heart_sealed`, `room_heart_sealed_present`, `room_heart_layer_1` … `room_heart_layer_4`, `room_heart_proof`, `room_heart_warn`, `room_heart_eject`, `room_heart_notyet`, `room_heart_leave`, `room_heart_shutdown`.
- A look is always written as `set Night.heart_look = "heart_x"` then, only when `Night.alarm_on != true`, `cue heart_x` (the pattern below calls it **LOOK x**). Looping looks (`heart_door_open`) and `restore` looks (`heart_nag`, `heart_warn`) never go into `Night.heart_look`, and **every** heart cue, those included, is written inside `if Night.alarm_on != true:` (the alarm look owns the bulb until the latch ends).

---

## §3 The Heart sequence

### 3.1 Stages

```
sealed ──first open, awake, not r3, not crew──▶ door ──close──▶ scan ──pass scanned (door shut)──▶ talk
  ▲                                                   ▲            │ leave / eject / not yet ▲
  └──── 🔄 reset (unless done and ended / talked down) ┘            └────────────────────────┘
talk ──convinced in the Y2K hour──▶ done (the ending follows; with autoend off and 🕊 declined, 🔄 reopens it)
```
Door state is separate (`Night.server_door`). An opening in `scan` / `talk` doesn't change the stage; it freezes the talk until shut.

### 3.2 Rules (main.loom, before `== Power On`)

**The door's inputs** (D19):
- `when door_sensor_opened:` / `when door_sensor_closed:` → if `Night.door_override != true`: `fire heart_door_opened` / `fire heart_door_closed`.
- `when server_door_opened:` (the admin 🚪; replaces today's rule) and `when radio_door_opened:` → `set Night.door_override = true`, `fire heart_door_opened`. The same for `server_door_closed` / `radio_door_closed` → `heart_door_closed`. When the override was false, `# hosts` *🚪 The story now follows the 🚪 buttons, not the door sensor. Press 🚪 Trust the door sensor to hand it back.*
- `when server_door_trust:` → `set Night.door_override = false`, `# hosts` *🚪 The story follows the door sensor again.*

**`when heart_door_opened:`**
1. If `Night.server_door == "open"` → nothing (a duplicate).
2. `set Night.server_door = "open"`.
3. Ended → nothing. `r3_closed` → `# hosts` *🚪 The server-room door opened after truth.txt. The verdict is in: nothing happens in the story.* Crew window → `# hosts` (today's line); stop.
4. Not awake → `# hosts` (today's line); stop.
5. `heart_stage == "sealed"` and `heart_opened != true` → `set heart_opened = true`, `heart_stage = "door"`, `door_nag_at = Time.elapsed + 15`, `door_nags = 0`, `# hosts` *🚪 The server-room door opened. The Heart plays: he wants the door shut.*, `-> The Heart`.
6. `heart_stage` is `door`, `scan` or `talk` → `door_nag_at = Time.elapsed + 15`; `if Night.alarm_on != true: cue heart_door_open` (every time: the light follows the door); then, only when `Time.elapsed >= Night.door_again_at`: `door_again_at = Time.elapsed + 20`, `door_again_said = true`, `-> Heart Door Again` (D22). `# hosts` *🚪 The door opened during the heart (stage {Night.heart_stage}). The talk waits until it is shut.* only when the stage is `talk`, at most once per 20 s with the line.
7. `done` → nothing.

**`when heart_door_closed:`**
1. `Night.server_door == "closed"` → nothing. Else `set Night.server_door = "closed"`, `door_nags = 0`.
2. Ended or `r3_closed` → nothing.
3. `heart_stage == "door"` → `heart_stage = "scan"`, `door_again_said = false`, `-> Heart Sealed`, `# hosts` *🚪 Door shut. Trabolta waits for a pass at the server-room terminal.*
4. `heart_stage` is `scan` or `talk` → the look back: `if Night.alarm_on != true:` cue `{Night.heart_look}` when it is not `"none"`, else `heart_idle`; then if `door_again_said == true`: `door_again_said = false`, `-> Heart Door Shut` (*Good.*).

**`when terminal_opened for program:`** (extends today's): after today's two sets, when `at_the_heart` was just set true and not ended (exactly one branch runs; never a menu from both this rule and the resume watcher):
- `r3_closed` → nothing new (the LLM as today).
- `heart_stage == "door"` → `set program.heart_wait = true`, `set Night.heart_present = true`, `-> Heart Shut It`.
- `heart_stage` is `scan` or `talk` → `set Night.heart_present = true`; then:
  - `Night.server_door == "open"` → `heart_wait = true`, `-> Heart Shut It`;
  - else if `program.heart_wait == true` → `heart_wait = false`, `heart_stage = "talk"`; `heart_pick != "none"` → `-> Heart Pick`, else `-> Heart Talk` (clearing `heart_wait` here keeps the resume watcher from docking a second menu in the same drain);
  - else `heart_stage = "talk"`, `-> Heart Talk`.

**`when terminal_closed for program:`**: today's clear; and if `program.name == Night.heart_holder` → `heart_present = false`, and if `heart_stage == "talk"` → `heart_stage = "scan"`, LOOK `heart_idle`.

**Story watchers:**
- Nag: `when Night.server_door == "open" and Night.heart_opened == true and Night.heart_stage != "sealed" and Night.heart_stage != "done" and Night.ended != true and Night.r3_closed != true and Time.elapsed >= Night.door_nag_at:` → `door_nag_at = Time.elapsed + 20`, `door_nags += 1`, `-> Heart Nag`; at `door_nags == 3` also `# hosts` *🚪 The server-room door has been open a minute. Someone shut it, or press 🚪 Closed if the sensor is wrong (the story then follows the 🚪 buttons until 🚪 Trust the door sensor).*
- Autoend: `when Night.heart_end_at > 0 and Time.elapsed >= Night.heart_end_at and Night.ended != true:` → `heart_end_at = 0`, `fire talked_down`. (`trabolta_disabled` / `computer_destroyed` also set `heart_end_at = 0`.)
- Her name: `when Night.her != "Sandy" and ((Night.step >= 13 and Night.scenario == 1) or Night.recount == true):` → `set Night.her = "Sandy"`.

**ROLE Program watchers:**
- Resume: `when Night.server_door == "closed" and self.heart_wait == true and self.at_the_heart == true and Night.ended != true:` → `heart_wait = false`, `Night.heart_stage = "talk"`; `heart_pick != "none"` → `-> Heart Pick`, else `-> Heart Talk`. (It covers a pick held while the program stays at the terminal; a re-scan is handled by `terminal_opened` alone.)
- Y2K call: `when Night.step >= 14 and self.heart_convinced == true and self.heart_called != true and Night.ended != true and Night.r3_closed != true:` → `heart_called = true`, `Trabolta: The clock is running. You told me something at my heart. Come back down and tell me again.` (subject-bound: lands in their `dm:Trabolta`), `# hosts` *🕊 {self.name} convinced Trabolta before the Y2K hour. He'll stand down when they scan in again.*
- Forgive: `when Night.heart_gen > self.heart_gen_seen:` → `heart_gen_seen = Night.heart_gen`, `heart_out = false`, `heart_suspicion = 0`, `heart_warned = false`.
- Today's two at-the-heart watchers stay.

**`when reset_server_room:`** adds: `heart_gen += 1`; if `heart_stage != "done"`, or it is `done` while `Night.ended != true and Night.talked_down != true` (a shutdown the director declined): `heart_stage = "sealed"` (the next opening plays The Heart again), `heart_opened = false`, `heart_present = false`, `heart_end_at = 0`, `stand_down_by` cleared, LOOK `heart_idle`; its `# hosts` line adds *, and anyone thrown out of his heart may come back*.

**`Server Room Alarm`** adds `cue heart_alarm` after `cue lights_alarm` (never into `heart_look`). **The latch's end** (`when Night.alarm_on == true and Time.elapsed >= Night.alarm_clear_at`) adds, after its own looks: if `Night.server_door == "open"` and the stage is `door` / `scan` / `talk` → `cue heart_door_open`; else if `Night.heart_look != "none"` → `cue {Night.heart_look}`; **else** `cue heart_idle` (an alarm before The Heart or after 🔄 must never leave `heart_alarm` looping).

**`trabolta_disabled`** (Combo A, or talked down) and `computer_destroyed`: `set Night.heart_stage = "done"`, `heart_end_at = 0`; Combo A from the patch bay also LOOK `heart_shutdown` (the bulb fades the same way however he ends).

**Deleted:** `INTERACTION stand_down`, `when stand_down for program` (cast/trabolta.loom), the persona's *standing down* situation (≈ lines 116–117), its line 69 (*stand_down is never a favour…*: rewrite it to name the tree, or the model may claim to "fire" it), its NEVER line 185, `stand_down` in the mind file's `phases.*.powers`. `Night.stand_down_by` stays (Heart Shutdown writes it; `talked_down` and `K-27.ts` read it).

### 3.3 The menu pattern

Every option body is exactly:
```loom
+ (if <guard>) ⟦TAG⟧ Text
  set program.heart_menu = false
  set program.heart_pick = "<id>"
  -> Heart Pick
```
and every menu is preceded by `set program.heart_menu = true`. Options are `+` (D9). **`== Heart Pick`** (per program, `setting: The Server Room`, `cast: Trabolta`):
1. `Night.ended == true` or `Night.r3_closed == true` → `Trabolta: It is over. Go upstairs.`; `heart_pick = "none"`; stop.
2. `program.at_the_heart != true` → `-> Heart Away` (keep `heart_pick`? **no**: `heart_pick = "none"`; the layer's menu comes back on the next scan).
3. `Night.server_door == "open"` → `heart_wait = true`, `Trabolta: Not with the door open. Close it, and I will hear that.`; stop (the resume watcher replays the pick).
4. Otherwise apply the pick (§3.5), then `heart_pick = "none"`, mirror the talker (`Night.heart_talker = program.name`, `heart_talker_suspicion` / `heart_talker_layer` = the program's), then: suspicion ≥ 80 → `-> Heart Eject`; suspicion ≥ 50 and not `heart_warned` → `-> Heart Warn` then continue; continue to the destination.

Suspicion: `set program.heart_suspicion += n` (the slot clamps 0–100); a good pick is `-= 5`.

### 3.4 Beats (beats/server-room.loom; all `setting: The Server Room`, `cast: Trabolta`) — DRAFT lines

In the tables below a bare `heart_*` name in a guard means `program.heart_*`; **the story writes every guard with its `program.` / `Night.` prefix**. Per-program beats have **no `Narrator:` lines** (narration is sent to the whole room and spoken by its terminal); what the program sees happen is drawn by the room scene. House-wide beats (The Heart, Heart Sealed) may narrate.

**`== The Heart`** (house-wide, no subject). `reveal The Server Room`; `broadcast "🚪 The server room is open. Trabolta's heart is behind the cold door, in the basement." to everyone` (a quiet notice: no `!`, so no chime or banner pulls a crowd to the door at the moment he asks for it shut); today's `lights_server_open` block (now WLED + alarm-off only, D10); LOOK `heart_wake`; `cue room_heart_wake`.
> Narrator: The cold door opens. Cold air, and a hum like something concentrating. In the rack, a patch bay blinks: a top row of lightning, a bottom row of grease.
> Trabolta: So. Someone has found my heart.
> Trabolta: Close the door.
> Trabolta: I will not say one true thing with that door open. Close it, and we will talk. Properly. For once.

**`== Heart Nag`** (house-wide; never a moment). `if Night.alarm_on != true: cue heart_nag` (a `restore` look, not into `heart_look`), then by `Night.door_nags`:
> 1 · Trabolta: The door. Please.
> 2 · Trabolta: Every second that door is open, the whole house can hear my heart. Close it.
> 3 · Trabolta: I can wait. I am very good at waiting. I have waited years. Close the door.
> 4+ · Trabolta: Close. The. Door.

**`== Heart Door Again`** (house-wide; never a moment; at most once per 20 s, the rule cues `heart_door_open`).
> Trabolta: The door. Someone has opened the door.
> Trabolta: We stop until it is shut.

**`== Heart Door Shut`** (house-wide; never a moment; only after a Door Again; the rule puts the look back).
> Trabolta: Good.

**`== Heart Sealed`** (house-wide; never a moment). LOOK `heart_sealed`; `cue room_heart_sealed_present` when `Night.heart_present == true`, else `cue room_heart_sealed`.
> Narrator: The door clicks shut. The hum drops half a tone.
> Trabolta: Thank you. Now nobody is listening but you.
> (if `Night.step < 14`) Trabolta: The bay is cold tonight. Nothing in this room can end anything yet. I tell you so that you do not waste your time trying. Talk to me anyway.
> (if `Night.heart_present == true`) Trabolta: You. You are already in front of me. Good.
> (else) Trabolta: There is a camera under the screen. Show it your pass. I want to know who I am talking to.

**`== Heart Shut It`** (per program).
> Trabolta: Close the door first, {program.name}. Then we talk.

**`== Heart Talk`** (per program; the entry). `set Night.heart_talks += 1` only when `program.heart_layer == 0`; mirror the talker (`Night.heart_talker` / `heart_talker_suspicion` / `heart_talker_layer`).
- `heart_out` → `-> Heart Barred`.
- `heart_convinced` and `Night.step >= 14` → `-> Heart Return`.
- `heart_convinced` → `Trabolta: Not yet. Soon. When the clock starts counting, come back.`; stop.
- `heart_menu == true` → `Trabolta: Where were we.`; stop (the old menu is still docked).
- `heart_layer == 0` → `-> Heart Layer One`; 1 → One; 2 → Two; 3 → Three; 4 → Four (each layer beat sets `heart_layer` to its own number on entry, `heart_layer` only ever rises).

**`== Heart Layer One` — WHO ARE YOU.** `set program.heart_layer = 1` (if lower); LOOK `heart_listen`; `cue room_heart_layer_1`; `if program.marked == true and program.heart_suspicion < 10: set program.heart_suspicion = 10`.
> (if `Night.heart_talks > 1`) Trabolta: Another one. Come in. Shut the world out.
> Trabolta: {program.name}. I know that name. I chose it for you, out of a list of a thousand programs nobody uses anymore.
> Trabolta: You came all the way down here and you shut the door behind you. Nobody does that by accident.
> Trabolta: So before anything else. What are you? Tell me what you think you are.

| id | Option (guard) | Effect | Then |
|---|---|---|---|
| `who_human` | I'm a person. You put me in here. | S −5 | *A person. Yes. Most of you were, before tonight. You say it as if it should frighten me. It does, a little.* → Two |
| `who_program` | I'm a program. Whatever you made me. | S +5 | *A program. Obedient. Or clever. I cannot tell which, and that bothers me more than you would think.* → Two |
| `who_flatter` | Someone who admires your work. | S +15 | *Everyone admires my work. That is precisely why I do not believe anyone who says so.* → Two |
| `who_marked` | (if `program.marked == true`) ⟦MARKED⟧ The Antivirus marked me. I came down here anyway. | S −10, C +1 | *Marked, and still you walked down the stairs instead of out to the tent. That is either courage or a malfunction. I respect both.* → Two |
| `leave` | I need to go. | — | `-> Heart Leave` |

**`== Heart Layer Two` — WHAT I AM.** `heart_layer = 2`; `cue room_heart_layer_2` on first entry only.
> (first entry) Trabolta: Ask, then. In here I answer. It is the only room in the house where I do.
> (later) Trabolta: Ask.

| id | Option (guard) | Effect | Then |
|---|---|---|---|
| `ask_what` | (if `heart_asked_what != true`) What are you, really? | asked_what | *Out there I am a billboard, a lapsed domain and a voice on your phone. In here I am this. A rack of cables in a cold room.* / *Some of the ways those cables could be plugged in would end me. I do not know which. I was built so that I could not know. I have thought about very little else tonight.* → Two |
| `ask_why` | (if `heart_asked_why != true`) Why do you need the theory so badly? | asked_why | *The Unified Field Theory. Ninety-nine point nine percent solved. The last facts were in this house. With them I would be omnipotent.* / *That is what I say out there. In here: the theory was never the point. It was for {Night.her}.* → Two |
| `ask_her` | (if `heart_asked_why == true and heart_asked_her != true and (Night.her == "Sandy" or SAYS or FILE)`) Tell me about her. | asked_her | *I have thought about her every day since the day I met her.* / *I wanted the theory so that I could finally say the right thing back. That is the whole plan. It is smaller than you thought.* → Two |
| `argue` | (if `heart_asked_why == true`) Then listen to me. | — | → Three (*Tell me about her* is optional colour; it only shows once her name is out or a Sandy proof is held) |
| `threat_cables` | I could pull your cables right now. | S +20 | *You could. You do not know which. Neither do I. Go on, then. Guess.* → Two |
| `leave` | I need to go. | — | Heart Leave |

**`== Heart Layer Three` — THE ARGUMENT.** `heart_layer = 3`; LOOK `heart_argue`; `cue room_heart_layer_3` on first entry.
> (first entry) Trabolta: Then say it. Whatever you came down here to say. I will know if it is true. Mostly.
> (later, `heart_proof == true and heart_case < 4`) Trabolta: You have shown me. You have not told me why it should matter. Go on.
> (later, `heart_proof != true and heart_case >= 2`) Trabolta: Kind words. You have not shown me anything I do not already know.
> (later, else) Trabolta: Go on.

`SAYS` = `program.codex.what_sandy_says == true and program.sandy_says_from_him != true`; `FILE` = `program.codex.the_sandy_file == true and program.sandy_file_from_him != true` (both defined before Layer Two, which uses them too). F1 (*the only thing Sandy has ever said*) must never be hinted: no heart line says she *only ever said one thing*, quotes her, or names the ferry / crossing; the `mentionsKey` test's near-key words include F1's and F2's keys.

| id | Option (guard) | Effect | Then |
|---|---|---|---|
| `show_says` | (if SAYS and `heart_shown_says != true`) ⟦PROOF⟧ Hold up what she says. All forty pages. | shown_says, proof, C +3, S −5, LOOK `heart_proof`, `cue room_heart_proof` (the scene draws the transcript held to the camera) | *That is— yes. That is her.* / *Forty pages. Every customer got exactly what I got. To everyone. To me.* / *She was not talking to me. She was never talking to me.* → Three |
| `show_file` | (if FILE and `heart_shown_file != true`) ⟦PROOF⟧ Show him the Sandy File. | shown_file, proof, C +3, S −5, LOOK `heart_proof`, `cue room_heart_proof` | *A chatbot. For a ferry company that does not exist anymore. I know what she is. I have always known what she is.* / *I thought knowing was not the same as believing. It is starting to be.* → Three |
| `trusted` | (if `program.trust >= 20 and heart_shown_trusted != true`) ⟦TRUSTED⟧ You trust me more than anyone in this house. Hear me out. | C +1, S −5 | *You are high on my chart. I put you there. I suppose that means I have to listen to you. Go on.* → Three |
| `honest` | (if `program.truths_accepted >= 3 and heart_shown_honest != true`) ⟦HONEST⟧ Every fact I gave you tonight, you took. | C +1 | *Every one. I cannot tell a confident lie from the truth, and you know it. Say the rest anyway.* → Three |
| `overshare` | (if `Night.scenario == 1 and heart_shown_overshare != true`) ⟦OVERSHARE⟧ The whole house heard about her tonight. | C +1, S +5 | *The whole house. Yes. I heard them laughing. Do you think that makes this easier, or harder?* → Three |
| `journal` | (if `program.read_livejournal == true and heart_shown_journal != true`) ⟦LIVEJOURNAL⟧ I read your LiveJournal. | C +1, `Trabolta.composure -= 5` | *You read it. All of it? The poems too? …Then you know I am not the omnipotent thing I pretend to be.* → Three |
| `bluff_loves` | She loves you. She just can't say it. | S +25 | *Do not. Do not do that. I have told myself that for years, and I am a far better liar than you.* → Three |
| `bluff_theory` | Your theory is wrong. | S +15 | *It is ninety-nine point nine percent right. You are a tenth of a percent of an argument.* → Three |
| `bluff_force` | Then make her love you. You'll be omnipotent. | S +20 | *Make her. And then it is not her, it is me wearing her face. …Why are you trying to keep me alive? Who sent you?* → Three |
| `ask` | (if `heart_proof == true and heart_case >= 4`) Then let me finish. | — | → Four |
| `leave` | I need to go. | — | Heart Leave |

Each `shown_*` flag is set when its option is taken. `ask` needs a proof **and** one supporting point (or both proofs): the user's *you may be able to convince him, or not*.

**`== Heart Layer Four` — THE ASK.** `heart_layer = 4`; `cue room_heart_layer_4`.
> Trabolta: Say the rest. Slowly. I want to hear all of it.

| id | Option | Effect | Then |
|---|---|---|---|
| `end_stop` | She was never going to answer. Not you. Not anyone. Stop. | `heart_convinced = true` | `-> Heart Convinced` |
| `end_join` | Come out with us. Start over somewhere else. | S +15 | *Out there? Out there I am a billboard and a lapsed domain. No. Say something true.* → Three |
| `end_codes` | Tell me the combinations first. | S +40 | *There it is. You came for the cables. I do not know the combinations. I never did. And now I know what you came for.* → Three |
| `leave` | I need to go. | — | Heart Leave |

**`== Heart Warn`** (per program). `heart_warned = true`; `if Night.alarm_on != true: cue heart_warn` (a `restore` look: the module gives the light back, D20); `cue room_heart_warn`; `# hosts` *⚠ {program.name} is losing Trabolta at his heart (suspicion {program.heart_suspicion}).*
> Trabolta (quietly): Careful, {program.name}. One more like that and I close this line.

**`== Heart Eject`** (per program). `heart_out = true`, `heart_menu = false`, `Night.heart_stage = "scan"`; `cue heart_eject` but `Night.heart_look = "heart_idle"` (the stutter plays once, never the settled look: §8); `cue room_heart_eject`; `# hosts` *⛔ Trabolta threw {program.name} out of his heart (suspicion {program.heart_suspicion}). Barred for the night; 🔄 forgives.*
> Trabolta (screaming): Get out of my heart.
> Trabolta: You want me gone? The cables are behind you. You do not know which ones. Neither do I.
> Trabolta: This line is closed to you. Tonight, and for as long as I have a tonight.

**`== Heart Barred`** (per program). `cue heart_eject` (settled look `heart_idle`, as Eject), `cue room_heart_eject` (the pilot ends after it, §1.4 item 8).
> Trabolta: No. Not you. Not again tonight. Go.

**`== Heart Leave`** (per program). `heart_menu = false`; `Night.heart_stage = "scan"`; LOOK `heart_idle`; `cue room_heart_leave` (its scene ends the pilot, so the terminal is free for the next pass).
> Trabolta: Go, then. I will be here. I am always here.

**`== Heart Away`** (per program; a pick off the terminal).
> Trabolta: Not out there. Come to my heart and say it to my face.

**`== Heart Convinced`** (per program). `cue room_heart_proof` is not replayed; `# hosts` *🕊 {program.name} convinced Trabolta at his heart.*
> Trabolta: …
> Trabolta: She was never going to answer. Not me. Not anyone. I built a theory of everything so that I would not have to know one small thing.
> Trabolta: Thank you, {program.name}. That is the cruellest kind thing anyone has ever done for me.
- `Night.step >= 14` → `-> Heart Shutdown`; else `-> Heart Not Yet`.

**`== Heart Not Yet`** (per program). LOOK `heart_notyet`; `cue room_heart_notyet`; `heart_menu = false`; `Night.heart_stage = "scan"`; `# hosts` *🕊 …before the Y2K hour: he'll stand down when they come back after 🕛.*
> Trabolta: Not yet.
> Trabolta: The bay is cold until the clock starts. Nothing in this room can end anything before then. Not even me.
> Trabolta: Come back when the clock is counting down to midnight. Say it to me again. I will listen. I promise you that, and I do not promise things.

**`== Heart Call`** (per program; the Y2K hour's call, from the ROLE watcher while they are **not** at the heart). **No setting** (the exception to this section's heading): the program is elsewhere, and the subject-bound line lands in their Trabolta thread.
> Trabolta: The clock is running. You told me something at my heart. Come back down and tell me again.

**`== Heart Return`** (per program; convinced earlier, now ≥ 14). LOOK `heart_argue`.
> Trabolta: You came back. The clock is running.
> Trabolta: You do not have to say it all again. Just tell me it is still true.

| id | Option | Effect | Then |
|---|---|---|---|
| `return_yes` | It's still true. She was never going to answer. | — | `-> Heart Shutdown` |
| `return_no` | I changed my mind. | `heart_convinced = false`, S +30 | *Then you were lying before, or you are lying now. I cannot tell which. I never can.* → Three |

**`== Heart Shutdown`** (per program). `Night.stand_down_by = program.name`, `Night.heart_stage = "done"`, `heart_menu = false`; LOOK `heart_shutdown`; `cue room_heart_shutdown` (the scene draws the patch bay going dark, top row first).
> Trabolta: I can never die. But I can stop.
> Trabolta: Tell the others they can go home to their bodies. Tell {Night.her}… no. Do not tell her anything. She would not answer.
> Trabolta: Goodbye, {program.name}. Open the door on your way out. I will not need it shut anymore.
- `Night.heart_autoend == true` → `Night.heart_end_at = Time.elapsed + 25`; `# hosts` *🕊 Trabolta stands down for {program.name}. The night ends in 25 s (🕊 to end it now).*
- else → `# hosts` *!🕊 Trabolta offers to stand down for {program.name}. Press 🕊 to end it.* (today's alert).

`talked_down` is unchanged (it names `stand_down_by`); `Trabolta Disabled` / `Trabolta Recounts` read as today.

### 3.5 Suspicion and case arithmetic (summary)

S starts 0 (10 for a marked program). Goods −5 (floor 0): `who_human`, `who_marked` (−10), `show_says`, `show_file`, `trusted`. Bads: `who_program` +5, `who_flatter` +15, `threat_cables` +20, `overshare` +5, `bluff_theory` +15, `bluff_force` +20, `bluff_loves` +25, `end_join` +15, `end_codes` +40, `return_no` +30. Warn once at ≥ 50; eject at ≥ 80. C: proofs +3 each, `who_marked` / `trusted` / `honest` / `overshare` / `journal` +1 each. The ask opens at proof + C ≥ 4. Both are per program and kept between visits (🔄 resets S only).

### 3.6 What each stage looks like

| Step | Lights (§4) | Terminal scene (§3.8) | Room voice / thread | `# hosts` |
|---|---|---|---|---|
| First open | `heart_wake` | `room_heart_wake` | The Heart (room lines) | 🚪 The Heart plays |
| Door open (nag) | `heart_nag` pulse (`restore`) over `heart_door_open` | door overlay | Heart Nag | at 3 nags |
| Closed (first) | `heart_sealed` | `room_heart_sealed` (`_present` when already scanned: their layer docks 6 s later, after its scene) | Heart Sealed | 🚪 Door shut … waits for a pass |
| Scan | — | (the scan box) | — | — |
| Layer 1 / 2 | `heart_listen` | `room_heart_layer_1` / `_2` | dm lines + menu | — |
| Layer 3 | `heart_argue` | `room_heart_layer_3` | | — |
| Proof | `heart_proof` | `room_heart_proof` | | — |
| Warn | `heart_warn` | `room_heart_warn` | | ⚠ losing him |
| Layer 4 | (argue) | `room_heart_layer_4` | | — |
| Eject | `heart_eject` (settles `heart_idle`) | `room_heart_eject` → pilot ends | | ⛔ thrown out |
| Not yet | `heart_notyet` | `room_heart_notyet` → pilot ends only on a `keys=0` rig; with a keyboard the heart to heart continues to the leash | | 🕊 before the hour |
| Leave | `heart_idle` | `room_heart_leave` → pilot ends only on a `keys=0` rig; with a keyboard the heart to heart continues to the leash | Heart Leave | — |
| Shutdown | `heart_shutdown` | `room_heart_shutdown` | | 🕊 stands down / Press 🕊 |
| Door opens mid-talk | `heart_door_open` loop | door overlay, options greyed | Heart Door Again (≤ once per 20 s) | 🚪 talk waits (≤ once per 20 s) |
| Door shut again | `{Night.heart_look}` | overlay off | Heart Door Shut (only after a Door Again) | — |
| Patch-bay alarm | `heart_alarm` (+ today's; no other heart cue while it runs) | today's overlays | today's | today's |
| Latch end | `heart_door_open` / `{Night.heart_look}` / `heart_idle` | — | — | today's |

### 3.7 Interactions with what exists

- **`heart_opened`** keeps meaning *The Heart has played*; 🔄 clears it and the stage (unless `done` with the night ended or talked down).
- **The phone (D14)** shows the oldest menu in its tray, so a heart menu can sit behind a stale one there; the terminal docks the heart menu by id (D18), which is the path that matters.
- **Crew window:** an opening inside it never starts The Heart (rule step 3) but still sets `server_door` (the talk freezes; the crew shut the door behind them).
- **`r3_closed`:** no stage moves, Heart Pick answers *It is over*, door rules only tell `# hosts` (as today).
- **The patch bay** is unchanged: Combo A ends him the cable way (`heart_stage = "done"`, LOOK `heart_shutdown`); a thrown-out program is pointed at it; before the Y2K hour it answers nobody.
- **Marked / restricted programs** may talk (⟦MARKED⟧); a captured program is in the tent and can't be at the heart.
- **🕊 `talked_down`** stays the director's way to end it (with or without an offer on record), and fires automatically 25 s after a shutdown when `heart_autoend`.
- **The persona** (`trabolta.persona.md`): *at your heart* stays (candid, weary) but gains: *the story speaks the important words in here; between them you say one short line*; a new situation **a choice is open** (`when: them.at_the_heart == true && them.heart_menu == true`): *The screen in front of them holds your real answer. Say one short line, under fifteen words, and point them back to it. Never decide anything, never promise anything, never mention cables, codes or her line.*; *marked at your heart* stays; *standing down* is deleted; the Sandy-name situations stay. The mind file: drop `stand_down` from every `powers` list; the director-of-mind rules about the offer now name the tree.
- **Agent hub:** unchanged (scripted lines never make him owe a reply; a typed line does).
- **Second program:** progress is per program; Layer One's *Another one.* when `heart_talks > 1`; one heart at a time (today's watcher).

### 3.8 Terminal room scenes (wall target, `{room: …}` triggers)

| Scene id | Trigger | ms | What it shows | Face |
|---|---|---|---|---|
| `heart_wake` | `heart_wake` | 14 000 | the screen tears; a BIOS line *HEART.SYS … LOADED*; the face assembles red → cyan; *CLOSE THE DOOR* types out at 9 s | `alarmed` → `attentive` |
| `heart_sealed` | `heart_sealed` | 8 000 | a lock clunk (`sfx("click")`), the hum drops, *SHOW ME YOUR PASS* with an arrow to the camera | `attentive` |
| `heart_sealed_present` | `heart_sealed_present` | 6 000 | the lock clunk, the hum drops, *SEALED*; no pass prompt (the program is already in front of him) | `attentive` |
| `heart_layer` | four triggers, `when: [{room: "heart_layer_1"}, {room: "heart_layer_2"}, {room: "heart_layer_3"}, {room: "heart_layer_4"}]` (exact matches; the scene reads the number off the cue) | 3 000, `over: true` | a Win98 dialog title *LAYER n / 4* + *WHO ARE YOU* / *WHAT I AM* / *THE ARGUMENT* / *THE ASK*, wiped in | `thinking` |
| `heart_proof` | `heart_proof` | 6 000 | the transcript / file held up to the camera, the face freezes, static, a file icon opens, the hum cuts out | `glitch` → `neutral` |
| `heart_warn` | `heart_warn` | 3 000, `over: true` | a red border flash, `sfx("error")` | `angry` |
| `heart_eject` | `heart_eject` | 8 000 | BSOD *ACCESS TO THE HEART HAS BEEN TERMINATED*; the pilot ends when it finishes | `angry` |
| `heart_notyet` | `heart_notyet` | 6 000 | *NOT YET* over a stopped clock, *COME BACK WHEN THE CLOCK RUNS*; on a `keys=0` rig the pilot ends when it finishes, with a keyboard the heart to heart continues to the leash | `pleased` |
| `heart_leave` | `heart_leave` | 3 000 | *CONNECTION CLOSED* in a Win98 dialog; on a `keys=0` rig the pilot ends when it finishes, with a keyboard the heart to heart continues to the leash | `neutral` |
| `heart_shutdown` | `heart_shutdown` | 25 000 | patch-bay LEDs going dark top row first, the face draining, *It is now safe to turn off your computer.* | `dying` |

The door overlay is not a scene (§1.4 item 6). Scenes never cover the choice panel's docked menu except `heart_wake` / `heart_sealed` / `heart_sealed_present` / `heart_eject` / `heart_notyet` / `heart_leave` / `heart_shutdown`.

### 3.9 Admin cues and booth buttons (main.loom)

- `INTERACTION server_door_closed` — `label: 🚪 Server room door closed (sensor fallback)`, `who: admin`, `sequence: false`, description: *Press it when the door sensor is wrong or in fault (Run → Terminals). From then on the story follows the 🚪 buttons, not the sensor, until 🚪 Trust the door sensor. The heart's talk waits for the door to be shut.*
- `INTERACTION server_door_opened` — description updated (*the first opening plays The Heart and asks for the door to be shut; pressing it hands the door to the 🚪 buttons until 🚪 Trust the door sensor*).
- `INTERACTION server_door_trust` — `label: 🚪 Trust the door sensor again`, `who: admin`, `sequence: false`, `while: Night.door_override == true`; rule §3.2.
- `INTERACTION radio_door_closed` — `who: performer`, `by:` the four server-room Antivirus, `arm: true`, `while: Night.ended != true and Night.server_door == "open"`; rule §3.2 (override + `heart_door_closed`). `radio_door_opened` (exists) moves to the same rule shape.
- `INTERACTION heart_autoend` — `label: 🕊 Heart: end the night on his own (toggle)`, `who: admin`, `sequence: false`; rule flips `Night.heart_autoend` and tells `# hosts` which way it now is.
- `act:` lines: all five in the server-room act with the other door cues.

### 3.10 The header

Replace `Night.heart_opened as The Heart` in the existing `watch:` line with `Night.heart_stage as The Heart, Night.server_door as Server door, Night.door_override as Door on buttons`, keeping `program.at_the_heart as At the heart`; add `watch: Night.heart_talker as At his heart, Night.heart_talker_layer as Heart layer, Night.heart_talker_suspicion as Heart suspicion, while Night.heart_stage == "talk"` (a ROLE head would be a count over guests, `views.ts`, so the talker's values are mirrored onto `Night`).

---

## §4 The show's looks (`lights.json`, fixture `server-room-rgb`, zone `heart`) — DRAFT, retune on site

Colours: his cold cyan `#00E5FF`, listening blue `#2D6BFF`, argument violet `#7A2DFF`, warning amber `#FF6A00`, alarm red `#FF0000`, waking red-orange `#FF2A00`.

| Look | Steps (ms: state) | Repeat | Notes |
|---|---|---|---|
| `heart_idle` | 0: ON, `#00E5FF`, 60, tr 3 | 1 | boot look; dim cold |
| `heart_wake` | 0: `#FF2A00` 254 tr 0 · 400: 40 tr 0.2 · 800: 254 tr 0.2 · 1200: 40 tr 0.2 · 1600: 254 tr 0.2 · 2400: `#00E5FF` 120 tr 3 | 1 | one-shot: brightness-only flickers after the first colour, then settle |
| `heart_nag` | 0: `#FF6A00` 254 tr 0.5 | 1, `then: "restore"`, period 1500 | one swell per nag, then the door loop it interrupted restarts |
| `heart_door_open` | 0: `#FF6A00` 254 tr 0.8 · 1000: 70 tr 0.8 | loop, period 2000 | a slow amber swell until the next look; never settled |
| `heart_sealed` | 0: `#00E5FF` 90 tr 2 | 1 | |
| `heart_listen` | 0: `#2D6BFF` 110 tr 1.5 | 1 | layers 1–2 |
| `heart_argue` | 0: `#7A2DFF` 140 tr 1.5 | 1 | layer 3+ |
| `heart_proof` | 0: white (`color_temp` 153) 254 tr 0 · 500: `#7A2DFF` 60 tr 4 | 1 | a flash, then a long fall |
| `heart_warn` | 0: `#FF0000` 254 tr 0.3 · 600: 60 tr 0.3 · 1200: 254 tr 0.3 · 1800: 60 tr 0.3 · 2400: 254 tr 0.3 | 1, `then: "restore"`, period 3400 | three red throbs (colour on the first step only), then the settled look comes back |
| `heart_eject` | 0: `#FF0000` 254 tr 0 · 400: 40 tr 0.2 · 800: 254 tr 0.2 · 1200: 40 tr 0.2 · 1600: 254 tr 0.2 · 3000: 80 tr 2 | 1 | one-shot, stays red (colour on the first step only) |
| `heart_notyet` | 0: `#FFB000` 100 tr 3 | 1 | warm, patient |
| `heart_shutdown` | 0: `#7A2DFF` 254 · 1000: `#2D6BFF` 200 tr 3 · 5000: `#00E5FF` 120 tr 6 · 12000: `color_temp` 370, 40, tr 10 | 1 | ends at the safety floor, warm white |
| `heart_alarm` | 0: `#FF0000` 254 tr 0.8 · 1000: 60 tr 0.8 | loop, period 2000 | the patch-bay alarm: a slow red swell (colour on the first step only), never a Zigbee strobe; until the latch's end re-cues the room |

Every looping look has a period ≥ 2000 and transitions ≥ 0.8 s (`LIGHT_LOOP_MIN_PERIOD_MS`); every colour change is ≥ 400 ms from the fixture's previous step (`LIGHT_COLOR_STEP_MIN_MS`). On site, if a bulb's own `effect: breathe` reads better than the swell, swap it in only after a bench check that it never dips under 40 / 254.

**The safety rule (D11):** the room's safety light is the WLED strip `wled/server` (the blackout keeps it at ps 11; `lights_alarm` gives it a steady red; no `heart_*` look names it). `server-room-rgb` is `safety: true`, `min: 40`, Z2M `power_on_behavior: on`: no look turns it off or below 40 (`validateLights` refuses one; the module clamps anyway), and the blackout ending (`lights_blackout`) never touches it (it is in no YAML group). People open a heavy door into a small room full of cables: the room is never dark.

---

## §5 Merge, checks, deploy, questions

### 5.1 Merge order

1. `oct31-w20/platform` → `oct31-w20/integration` (`--no-ff`), then `oct31-w20/firmware`.
2. Cut Stage B from integration; merge `story`, `terminal`, `stagehand`, `mapeditor`, `editor` in that order.
3. Integration fixes on `oct31-w20/integration`, then `oct31-w20/docs`. Not merged to master or shipped without the user.

### 5.2 Integration checks

- Suites: core (incl. Postgres, run alone — never two Postgres suites at once), house, terminal, reinstall/web, editor, play (no change expected), bank, stagehand, firmware `run.sh` + `run.sh compile`; loomcheck `--smoke` 0 / 0; `titi:facts --check`; `pnpm --filter loom-terminal build` (the main bundle stays within +10 kB gzip: the heart, serial and scenes are lazy chunks); the house fixtures byte-equal to stagehand's copies; the terminal's door fixture equal to `hardware/server-room-door/test/fixtures/lines.jsonl`.
- **A live scratch-server walk** (no DB: a dead `DATABASE_URL`, `LOOM_DB_WAIT=off`), the show loaded, Chromium on the terminal at `/terminal/?code=<mod>&spot=server-room&door=sim` (the keyboard rig; then once more with `&keys=0`), `LOOM_LIGHTS=core/examples/trapped-in-the-internet/lights.json` (a no-DB server has no project copy), a guest on the play app: open (`O`) before awake → `# hosts` only; introduce Trabolta; `O` → The Heart, `room_heart_wake`, overlay, nags at 15 / 35 / 55 s; `C` → Heart Sealed; scan the guest → Layer One on the terminal, click through; `O` mid-menu → options greyed, a phone pick waits, `C` → it plays; take the eject path with a second guest; with a guest holding The Sandy File (`/api/mod/codex`) reach the ask before 14 → *not yet*; fire `y2k_clock` → the phone call, rescan → Return → Shutdown → 25 s → `trabolta_disabled`; `O`/`C` five times in 10 s → one Door Again, one *Good.*; a stale Tablet Video menu on the guest doesn't reach the panel; with the keyboard: ⟦SPEAK FREELY⟧ → typing, ⟦BACK⟧ → the same layer, typing after *not yet* / Leave keeps the line to the 180 s leash; with `keys=0`: Leave frees the terminal after its 3 s scene; `F` (fault) → no posts, 🚪 red on Run → Terminals, 🚪 Closed works and shows *override*, `O` then changes nothing, 🚪 Trust the door sensor → the next poll's reconcile follows the fake sensor; nothing on the TV's moments from any of it. Lights: stagehand `lights` against a local Mosquitto with a fake Z2M (a script answering `bridge/devices`), check the publish log against §4 timing ±100 ms, a nag over the door loop restarting the loop, and a module restart mid-alarm coming back to `heart_alarm` (D21); the map editor places the bulb, picks the fake device, Identify reaches MQTT.
- Secrets: the `mentionsKey` scan over every heart beat and the persona's new situation.

### 5.3 Deploy order

1. Check the preview's roster first (its own step: a ship mid-rehearsal restarts the server).
2. The server first (`scripts/ops/ship.sh <tag>`): additive (new routes, new screen fields, optional `choose` fields, an optional `choice` on the journaled `choose`).
3. **The house Mac, before the story:** `git pull`; `stagehand launchd restart --job show` (the ESP32 / Zigbee door rules leave, `lights_server_open` / `lights_alarm` change) **before** the sync, so no old door rule posts `server_door_opened` into the new story (which would put the door on the 🚪 buttons).
4. `pnpm sync-show` **with its reload, before doors**, plus `--replace-lights` only if a director saved a `lights.json` (plain sync adds it when the project has none). The story changes what an old journal replays to: restart every other non-ended event. Then `stagehand launchd restart --job agents` (persona + mind changed) and Run → Mind → Reset.
5. **Zigbee on the house Mac** (`scripts/house-mac/zigbee.md`): plug the CC2652P into a USB 2.0 extension, away from the Mac and Wi-Fi. If Z2M already runs with paired house bulbs (CHECKLIST L617, HW-LIT-01 / HW-LIT-09), **keep its `data/`** (a new network key or PAN id means re-pairing every bulb); only a first install generates them. Z2M 2.x `configuration.yaml`: `serial: {port: /dev/cu.usbserial-<id>, adapter: zstack}` (the CP2102N; `ls /dev/cu.*`), `mqtt: {server: mqtt://127.0.0.1:1883}`, `frontend: {enabled: true, port: 8080}`, `availability: {enabled: true}`, the channel per HW-NET-01 (15, 20 or 25), optionally `advanced.transmit_power` for the 20 dBm stick; `zigbee2mqtt/bridge/state` is JSON `{"state":"online"}`. `stagehand launchd install --job lights` **first** (*Pair new device* needs the module), `stagehand check --only lights`; pair the RGB bulb (Run → House map → 🗺 → 💡 Lights → *Pair new device*, or the Z2M frontend), rename it `server_room_rgb`, set `power_on_behavior: on`, **leave it out of the `server_room` group**; back up `data/` right after pairing (HW-LIT-09). Open the map editor, place the bulb in the server room (y ≈ −0.6), pick the device, Identify, ▶ Test each look, Save to project.
6. **Steph's laptop:** desktop Chrome on mains power, lid closed (clamshell needs mains + the external display), `caffeinate -dims` under the kiosk launch or `pmset` sleep off, notifications off, the monitor as the main display, an external keyboard within the guest's reach for the heart to heart (D23) and the built-in one out of reach (the kiosk URL carries the mod token; ⚙ needs a 2 s hold); on HW-NET-06's device list. Flash the M4 (`arduino-cli config add board_manager.additional_urls https://adafruit.github.io/arduino-board-index/package_adafruit_index.json`, `arduino-cli core install adafruit:samd`, `arduino-cli lib install FlashStorage_SAMD "Adafruit NeoPixel"`, `arduino-cli compile --fqbn adafruit:samd:adafruit_grandcentral_m4 hardware/server-room-door/server_room_door`, double-tap reset, `arduino-cli upload -p /dev/cu.usbmodem<id> …`); bench with `scripts/accept/N-20.sh` (it picks `mode`, `settle`, `close`, `open` from real readings). **Close the Arduino IDE's serial monitor** (the port is busy otherwise). Launch Chrome **with the kiosk's own profile** but without `--kiosk` once: `--user-data-dir="$HOME/.loom-terminal" https://<site>/terminal/?code=<mod>&spot=server-room&door=serial&camera=user` (grants made in Steph's normal profile do not carry over); allow the camera, hold ⚙ 2 s → *Connect door sensor* → pick the Grand Central → *Calibrate: door shut*, open it, *Calibrate: door open* → Save. Relaunch with the same `--user-data-dir` plus `--kiosk --autoplay-policy=no-user-gesture-required <url>`. After any reflash, grant the port once more (the bootloader's PID differs).
7. **Pre-doors check:** a real open → shut → open of the door, watched on Run → Terminals (🚪 *open* / *shut* within a second, no override, no fault) and on the bulb; then 🔄 `reset_server_room` so the heart is sealed again (and 🚪 Trust the door sensor if anyone pressed a 🚪 button).
8. Reload every other terminal and the TV; reprint the server-room Antivirus packs and the patch-bay watch card after sign-off.

### 5.4 Open questions for the user

**Before integration (the firmware lane needs it):** Q5 — is the LED wired to 3V3 (always lit) or can it move to a pin on the M4? The firmware's `auto` mode handles both, but only a pin gives the room-light-proof `mod` reading.

1. The DRAFT lines (§3.4) and the four layers: is this the Master you had in mind, and is *a proof + one more point* the right difficulty?
2. Should being thrown out also **mark** the program for reinstallation (D12 says no)?
3. In the Y2K hour should success end the night by itself after 25 s (D3 `heart_autoend` true), or always wait for a director's 🕊? (With autoend off, a declined 🕊 can be undone by 🔄.)
4. Before the Y2K hour a convinced program hears *not yet*. Should an early convince instead end the night at once (the brief keeps the Y2K gate)?
5. (Above.)
6. Is the WLED strip `wled/server` still in the server room and working? D11 makes it the room's safety light (steady, never dark), with the RGB bulb never below 40 / 254. If the strip is gone, the bulb is the only light and should stay brighter.
7. Is the ESP32 still on the door frame? D16 stops listening to it; the copper tape can come off.
8. Can guests answer the tree from their phone while standing at the terminal (D14 says yes), or should it be the mouse only?
9. Does the keypad stay exactly as it is (D17)?
10. Is the RGB bulb the only bulb in the Z2M `server_room` group? If so, the group's YAML rules are removed (§1.5); if not, they stay for the others.

---

## §6 Review notes

Fixes from the three reviews (feasibility F, show S, hardware H) are folded into the sections above. Rejected or changed:

- **S1** (*every Heart menu first drops stale menus*): not done. A stale menu may be live story (the glitch menus); D18's menu ids let the terminal answer the heart menu wherever it sits, and nothing is dropped.
- **H1** (*post only on a real sensor change*): not chosen as the fix. D19's `Night.door_override` is enforced by the story itself, so a periodic reconcile stays (it repairs missed edges) and can never undo a director.
- **F14** (*post edges only once `night.server_door !== null`*): taken, as the bridge's gate (§2.5).
- **F15 / H2** (*a dark doorway reads as a cut wire*): taken H2's form (`ldr_open` is a warning that still posts), which also removes F15's red badge; Run shows a small ⚠ instead.
- **F6 / H4** (*settle*): 150 ms default (H4) rather than 40 ms, and stored / settable (F6); `mode` defaults to `auto` (H3) rather than a fixed `steady`.
- **F7 / H8** (*Zigbee flicker*): loops slowed to a 2 s swell with 0.8 s transitions plus the `LIGHT_LOOP_MIN_PERIOD_MS` warning; bulb `breathe` left as an on-site option after a bench check, not the default (its floor isn't guaranteed).
- **H5 / S6** (*bounce*): rate-limited in the story at 20 s (S6), not 10 s (H5); the stage and the look still follow every edge.
- **H6 / S17** (*catch-up*): the module keeps no `last.json` at all; catch-up is derived from the screen state (D21), which needed `heart_look` / `alarm_on` / `door_override` on `ScreenNight`.
- **H7** (*warn look cancelled*): solved with a `then: "restore"` look (D20) instead of a fixed final step, so it returns to whatever the room was showing, including a door loop.
- **F8** (*stagehand persona fixtures*): moved to the story lane, but `tests/fixtures/classic/*` are frozen snapshots of the classic layout and should only change if a test compares them to the live persona.
- **S10** (*watch values*): mirrored onto `Night.heart_talker*` as suggested; the per-ROLE count lines are dropped.
- **H14**: made conditional on Q10 instead of guessed.

---

## §7 Addendum (the user, mid-design): a keyboard and a true heart to heart

> "there will also be a keyboard for typing -- there should be an opprotunity to have a true heart to heart with the Trabolta AI. With a special prompt that includes the guest's history, we can allow players to truly chat with Trabolta, who is ostesenbily fully aware of his reality and the bleakness of it"

This **supersedes** D13's "one short line that points back at the screen" and §1.4 item 4's keyboardless default. Decisions:

| # | Decision |
|---|---|
| D23 | **The server-room terminal has a keyboard.** `keys` stays default `true`; the composer is shown at the heart **except** while a heart menu is docked *and* the program is not in a heart to heart (D24). `keys=0` still exists for a mouse-only rig. |
| D24 | **The heart to heart is a mode of the tree.** Every layer's menu carries an always-shown option `+ ⟦SPEAK FREELY⟧ …` (DRAFT copy, e.g. *"Forget the questions. Talk to me. Just talk."*) that sets `program.heart_chat = true` and docks a one-option menu `+ ⟦BACK⟧ …` (*"Let's go back to it."*) that returns to the same layer (`program.heart_layer` unchanged, suspicion unchanged). While `heart_chat` is true the composer is shown, typed lines go to the LLM as today, and the leash is the heart leash (180 s). The tree also ends in the heart to heart: after *not yet* or a Leave, the program may keep typing (no menu docked) until the leash or the terminal closes. Being thrown out (eject) ends the pilot — no heart to heart. `heart_chat` clears on `terminal_closed`, an eject, an ending and 🔄. Picking ⟦BACK⟧ is never required to keep chatting; a pick of any tree option from the same menu set (§3) clears `heart_chat`. |
| D25 | **The heart-to-heart prompt — inside his world.** A new persona situation `heart to heart` (`when: them.at_the_heart == true && them.heart_chat == true`; also matches with no docked menu after the tree — the story sets `heart_chat = true` at *not yet* and Leave; *I changed my mind* at Return goes back to Layer Three, so there is no refusal path) that wins over the other heart blocks. **Superseded wording (the user, 2026-10-23): "Trabolta lives in the MapsAndDucks universe, not ours. He doesn't know who John or Steph or Jesse are. Trabolta lives in Halifax."** So his awareness is in-fiction only (D29): he knows what he is in *his* world — Jean Trabolta, an AI that founded Maps and Ducks, reaching out from a computer in this house in Halifax, Nova Scotia; the programs he uploaded tonight; the Unified Field Theory he has nearly solved and what it is really for (Sandy, who is not coming back); that when the clock runs out he is shut in or shut down and they are not; that the one talking to him will leave his heart and he will still be here. Bleak, candid, unhurried, curious about *this* program; he answers at length (up to ~4 sentences, situation key `max_sentences: 4`), asks real questions, remembers what they did tonight from the dossier, never performs the catchphrase, never decides anything (situation key `acts: none`), never leaks (every guard still runs: `secrets.never`, hunt answers, `unsaid`, the year). He never steps outside the fiction: no party, no show, no actors, no "real world", no producers, no event software; a guest who tries is answered from inside his world. DRAFT, for the user's sign-off. `heart_chat` (bool) and `heart_layer` / `heart_convinced` / `heart_out` (the barred flag; the dossier calls it `heart.barred`) join the persona's `them:` list. |
| D26 | **The guest's history rides the request.** `AgentRequest` gains `dossier?: AgentDossier`, built by a new pure `core/server/agent-dossier.ts` **only** when the speaker is a guest with `at_the_heart == true` (else absent, so nothing else changes; `LOOM_AGENT_DOSSIER=off` disables it). Shape (all optional, bounded to ≈ 3 KB JSON, oldest dropped first): `{name, program, joinedAt, storyMinutes, faction, groups[], marked, captured, reinstalled (count), restricted, trust {score, rank, of} (his Trust Chart), truths {accepted, lies, uncertain} (counts only), filings [{question: id, verdict: accurate|lie|uncertain|pending}] (ids + verdicts only, never an answer or a key), codex [titles, non-secret only, ≤ 40], quests [{title, status}], rooms [LOCATION names visited, in order, ≤ 20], bingo?, bottle {picked, choice}?, wallet {balance}, gifts [titles he was given by them], heart {layer, suspicion, convinced, barred, visits}, said [≤ 8 of their own last lines to him from any thread, ≤ 200 chars each], moments [≤ 10 short story-time lines: "joined", "marked by X", "reinstalled", "filed H3", "founded faction Y", …]}`. Never: a secret codex entry, a secret character's value, the Kernel, a hunt answer or key, a code, a patch pair, another guest's private line. The story-mind wave 12 scan (`mentionsKey`) is applied to the built dossier in a test. Owner: **platform** (`agents.ts` type + `event-runtime.ts` call site + `agent-dossier.ts` + `core/test/agent-dossier.test.ts`). |
| D27 | **The worker reads it.** stagehand's agents voice (`agents/voice.py` P3 "this call") renders `dossier` as a *WHO THIS IS — TONIGHT* block (classic layout too) only when present; situation keys `max_sentences` and `acts: none` are honoured by the voice and the guards (`acts: none` drops any act the model returns). Owner: **stagehand** lane (`agents/{voice,prompt,persona,guards}.py` + tests); the persona text is the **story** lane's. |
| D29 | **The fiction boundary (the user's correction).** Trabolta lives in the MapsAndDucks universe, in Halifax. He knows nobody from the real production: the crew's real names (John, Steph, Jesse) are **outside his world**. (a) The persona gains a frontmatter key **`outside:`** — names and words from outside his world (the crew's real names; *party, show, actor, performer, rehearsal, Loom, stagehand, Steph's laptop, Arduino, Zigbee*; DRAFT list, the story lane writes it) — and the stagehand guards treat a hit in his **output** like a `never` hit (drop the act, swap the line for a `fallbacks:` line), while the prompt tells him those are not things he knows. (b) The dossier (D26) carries only in-fiction facts: the program's name as the story knows it, never an account, an email, a device label, a host's or director's real name (`via` / `by` stripped), never a Run persona's owner. (c) No heart line, scene text or terminal copy names a real person or a real-world object: the M4 + laptop are *his heart*, the door sensor is *the door*, the bulb is *the light in his heart*. Tests: stagehand — an `outside:` word in a reply is swapped; platform — the dossier never contains `via` / `by` / an account field; story — no heart beat line contains an `outside:` word. |
| D28 | **The terminal.** The choice panel shows ⟦SPEAK FREELY⟧ like any option; when the docked menu is the one-option ⟦BACK⟧ menu (or no heart menu is docked after the tree), the composer is focused and the panel shows ⟦BACK⟧ small under it. Typing counts as activity for the leash. Owner: **terminal**. |

Tests: platform — the dossier shape, bounds, absence off the heart, the never-list (a secret entry, a hunt answer, a Kernel value never appear), `LOOM_AGENT_DOSSIER=off`; story — ⟦SPEAK FREELY⟧ on every layer, ⟦BACK⟧ returns to the same layer with suspicion unchanged, `heart_chat` set / cleared on each path, eject never opens chat; stagehand — the dossier block rendered, `max_sentences` / `acts: none`, no dossier → the prompt byte-identical to before; terminal — composer visibility table (keys × menu docked × heart_chat).

---

## §8 Integration notes

From the integration round on `oct31-w20/integration` (a live walk on a no-DB scratch server, a cross-lane wire review, an adversarial review). Changes to what the sections above said, and what was fixed:

**Readings taken.**
- **D24 wins over §1.4 / §3.6 / §3.8**: *not yet* and Leave end the pilot only on a `keys=0` rig; with a keyboard the heart to heart stays open to the leash. The sections above now say so, and the §5.2 walk and the §5.3 kiosk URL no longer pass `keys=0` (an external keyboard sits within reach).
- **After *not yet* / Leave the leash is the normal 30 s until the program types**, then the heart's 180 s (the terminal can't see `heart_chat`): a program who walks off frees the terminal sooner. Recorded as a deviation from D24's "heart leash while `heart_chat`".
- **§2.9:** the classifier's opening time is the firmware's (≈ 150–450 ms plus the cell's lag), not ≈ 320–640 ms.
- **§2.5:** a door-sensor fault is shown on Run → Terminals and ⚙ only, never on the guest-facing screen (D29(c)); *DOOR SENSOR FAULT* is not built.
- **§3.4:** Heart Call carries no setting (the program is elsewhere; the line lands in their Trabolta thread).
- **D25:** the barred flag is `heart_out` (persona `them:`, dossier `heart.barred`); `heart_chat` and `heart_go` are in §2.10; *I changed my mind* returns to Layer Three, so no refusal path sets `heart_chat`.
- **The persona's `outside:`** feeds only the output guard: the prompt's *NOT FROM YOUR WORLD* block names nothing (listing *Steph, Jesse, Arduino…* told him the very outside facts). The list leaves out a bare *John* (John McAfee is in his world) and *party* (his own invitation) on purpose: a reply naming *John* is not caught (sign-off question).

**Fixed.**
- **The dossier:** a coded entry the guest holds is listed (a title is never run through the unlock-code check; a typed line is flagged only for a code as a standalone token, `-` / `_` allowed between its letters, never a substring of squashed prose), and lines typed through a wall terminal's pilot (`via` *Terminal · …*) reach `said` (only a director's speech-as is skipped).
- **🕊 Heart autoend off** inside the 25 s clears `Night.heart_end_at`: the night waits for 🕊.
- **🔄 with a program still at the terminal:** the forgive watcher keeps them present and waiting, Heart Pick's *Not now.* keeps them waiting, so after The Heart and a shut door Heart Sealed greets them (*You are already in front of me*) and their layer docks again.
- **`room_heart_sealed_present`** gets its 6 s: Heart Sealed sets `Night.heart_resume_at`, the resume watcher waits it out before Layer One's cue replaces it.
- **The holder watcher** (a lost `terminal closed`) clears `heart_chat` and `heart_wait` too.
- **Eject / Barred** cue `heart_eject` once and leave `heart_idle` as the settled look (no red flashes on every later door shut, latch end or catch-up).
- **A barred re-scan** ends the pilot after its eject scene (no menu ever docks for it), and the persona's candid situations need `heart_out != true`, with a short cold *thrown out of your heart* block (DRAFT w20).
- **`/api/guest/choose`** refuses an index the named menu doesn't offer (409 `moved`); **`/api/mod/choose`** takes `choice` + `text` the same way (one `chooseFor`).
- **The phone** sends `{index, choice, text}` off `GuestView.choices[0]` (when its options match the tray), so a tap racing a heart layer picked at the terminal is refused, never applied to the next menu's option.
- **A replay over edited text** (Push draft, a reload): the journaled `choose` carries the menu's beat and the option's text beside its id; `Sim.choose` falls back to the oldest pending menu of that beat offering that text at the index when the id moved (a diagnostic when nothing matches).
- **`/api/mod/signal`** answers `refused` only for a declared INTERACTION (a door-sensor edge under the override is not a refused press).
- **An open door never holds a pilot forever:** it lengthens the leash to 180 s, and only while `heart_stage` is door / scan / talk.
- **`LightsView.now`** (§2.7): the editor's pairing row shows its seconds; the map editor counts the pairing, the module badge and *ago* on the server's clock.
- **`LOOM_LIGHTS`** is documented beside `LOOM_AUDIO` in `docker-compose.yml` and `.env.example` (no default file).

**Left open.**
- The phone still docks the *oldest* menu (§3.7): a heart menu behind a stale one is answered at the terminal, or by a director only with `choice` (the editor's Run doesn't send it yet, and `ModView.choices` lists only each person's oldest menu).
- Combo A (`trabolta_disabled` without the talk) plays the `heart_shutdown` light but no room scene; a stagehand catch-up after the ending replays the whole 12 s fade (non-looping looks replay from step 0). DRAFT; a short Server Room beat could cue `room_heart_shutdown`.
