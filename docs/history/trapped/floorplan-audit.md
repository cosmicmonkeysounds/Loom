> **Historical (moved from `docs/trapped/` on 2026-10-24).** A planning or audit note from October 2026; the code, the show folder and the package docs win where they differ.

> Design/audit note from the 2026-10-14/15 planning sessions for *Trapped in the Internet* (see [SCHEDULE](../../../core/examples/trapped-in-the-internet/SCHEDULE.md) / [CHECKLIST](../../../core/examples/trapped-in-the-internet/CHECKLIST.md)). File:line citations are a snapshot of commit `6884a96`–`fba382b` and will drift.
>
> **Wave 1 status** (merged to master 2026-10-15, not yet deployed to the VPS; [OCT31 §5](../../../core/examples/trapped-in-the-internet/OCT31.md)). **Nothing in the §5 plan was built**: the map page, the schema and per-event map storage are as audited here. Wave 1 only made `@loom/house` run on old tablet WebViews (`cloneData` instead of `structuredClone`, K-14). The measured `house.json` (K-28) still waits on the house survey; every phase below is still a design.

# Floor-plan editor audit: `/reinstall/map`, `@loom/house`, the VR/web/terminal consumers

Audited 2026-10-14 against `packages/loom` @ `6884a96`. All paths are relative to `packages/loom/`.

## TL;DR

- **The map page is a placement-and-tweak editor, not a floor-plan editor.** With the UI you can drag, aim and add or remove **terminals** and **duck spots**. You can drag and aim the **spawn**, move and rotate **props**, and move or resize **rectangular rooms** by their edges. You can also rename a room, set its LOCATION and tint it. Everything structural goes through the raw **JSON tab**: creating or deleting a room, non-rectangular polygons, doors, stairs, floors, prop size/kind/solid, room height and the outdoor flag.
- **The schema (house.json v1) is mostly adequate for the real house.** It handles rectilinear rooms, several floors with elevations and heights, doors with widths, straight stairs, box/cylinder props with a `solid` flag, terminals with yaw/pitch/fov, duck spots and the spawn. The real limits:
  - Rooms cannot have holes.
  - Rooms have no angled walls.
  - There are no windows.
  - Walls have no thickness; they are zero-thickness centre lines.
  - Two floors must be more than 0.5 m apart, so a sunken room or a short step down is not possible.
  - There are no L-shaped or winder stairs.
  - Every shared room edge becomes a wall, so open plan only works with a full-width "door".
- **VR fetches the map from the server at runtime** (`GET /api/spatial/house`, refetched every 2 s while it is out of date). The bundled `reinstall/vr/house/house.json` is only an offline fallback. A director's save reaches the headsets with no Godot rebuild. `pnpm house:sync` is only needed when the *show file* `core/examples/trapped-in-the-internet/house.json` changes: it regenerates the goldens and the VR copy, and a test fails until you do.
- **A save lives only in that event's state dir** (`spatial-house.json`). It never writes back to the show file or the project. A new event, or a fresh deploy, starts again from the show file. The plan below fixes this before you spend hours surveying.
- **The placeholder map does not match the story.** There is no server room / cold storage room. The Internet tent is in the *basement*, not outside. There is no folding table outside for Truth Pong. The ping-pong table is in the basement Rec Room. The Tube is a hallway.

---

## 1. What exists today

### 1.1 Files

| Piece | File | Notes |
|---|---|---|
| Map page entry | `reinstall/web/src/main.tsx:8-13` | `/reinstall/map` → `<MapApp/>` (same Vite bundle as the game) |
| Page + editor UI | `reinstall/web/src/map/MapApp.tsx` (1064 lines) | SVG plan, toolbar, inspector, terminals/players/JSON tabs, problems list, save |
| Pure edit ops | `reinstall/web/src/map/edit.ts` (338 lines) | `moveTo`, `setYaw`, `aimAt`, `addTerminal`, `addDuckSpot`, `removeThing`, `moveRectEdge`, `moveRoom`, `patchTerminal`, `patchRoom`, `setHeight`, `draftFromText`, save-state helpers |
| Plan geometry | `reinstall/web/src/map/plan.ts` (207 lines) | viewBox fit, `clientToPlan`, `snap` (5 cm), `viewCone`, `propCorners`, `rectOf`, `hitRectEdge`, `roomUnder` |
| Tests | `reinstall/web/test/map.test.ts` | 33 tests: plan frame, edit ops, JSON tab, remote-map following, save/409 |
| Schema | `house/src/types.ts:19-161` | `HouseMap`, `Floor`, `Room`, `Door`, `Stair`, `TerminalSpot`, `DuckSpot`, `Spawn`, `Prop`, `SpaceTransform`, `HouseStyle` |
| Validator | `house/src/validate.ts` (635 lines) | `validateHouse` (`:56`) → `{ok, problems: string[], house?}`; shape phase (`:104`), geometry phase (`:416`) |
| Normative spec | `docs/loom-reinstall.md` §1.1 (`:56-154`), §1.2 geometry (`:156-322`), §1.3 where the map lives (`:324-369`), §3 map page (`:507-519`), §4 terminals (`:524-548`), §5 VR (`:550-600`) |
| Save route | `core/server/event-runtime.ts:2555-2580` | validate → 400; `base` ≠ current → 409; `store.saveHouse` → `spatial.setHouse` → `houseWarnings` (LOCATION names) |
| Persistence | `core/server/store.ts:81,198-205` | `spatial-house.json` in the event's state dir |
| Show-file fallback | `core/server/event-runtime.ts:163-200` | `LOOM_HOUSE` or the example's `house.json`, re-read when its mtime changes |
| 3D scene builder | `house/src/three/scene.ts:119` `buildHouseScene` | Used by the web game and the terminals; **not used by the map page** |
| VR link | `reinstall/vr/net/server_link.gd:13-24, 80, 349-365` | Loads the bundled copy first, then fetches the server map and refetches while stale |
| VR copy + goldens | `house/scripts/sync.ts`, `house/test/golden.ts` | Copies the show `house.json` and the goldens into `reinstall/vr`; `test/sync.test.ts` fails when they drift |
| Terminal world view | `terminal/src/world/stream.ts:61-70,230-250`, `director.ts`, `minimap.ts` | Fetches the map, refetches on `house`/`hello`; bundled fallback |

### 1.2 What the editor actually does

The editor is behind an **Edit** checkbox (`MapApp.tsx` toolbar ~`:430`) and is only enabled when the map came from the server (`editableSource`, `edit.ts:314`). It offers:

- **Drags** (`MapApp.tsx:101-105` `Drag` union; `:288-318` `onPointerMove`): `move` (a terminal, duck spot, the spawn or a prop), `aim` (a rotate handle; 5° steps, 1° with Shift), `edge` (one edge of a **4-vertex rectangular** room, `edit.ts:166`), `room` (move a rectangular room together with its terminals, duck spots, props and the spawn, `edit.ts:191`). **Doors and stairs stay put** (`edit.ts:186-189`), so moving a room breaks its doors on purpose and the problem list reports it.
- **Snap:** a fixed 5 cm grid (`plan.ts:40`, applied in `onPointerMove`). There is no setting for the step. The grid lines drawn on the plan are 1 m (`MapApp.tsx:512`).
- **Keys** (`:341-375`): ⌘Z undo (a stack of 100, **no redo**), Delete (terminals and duck spots only; `removeThing` ignores props and rooms, `edit.ts:145-159`), arrow nudges of 5 cm (50 cm with Shift). The mouse wheel turns the selected item (`:326-339`).
- **Add buttons:** **+ Terminal** and **+ Duck spot** only (`:434-439`). There is no add button for rooms, doors, stairs, props or floors.
- **Inspector** (`:883-1063`):
  - Terminal: x/y/z, yaw, pitch, vertical fov, name, provisioning link (copy only, no QR).
  - Duck spot: position.
  - Spawn: position, yaw.
  - Prop: position and yaw only. The page itself says "Size, colour and kind are edited in the JSON tab" (`:1027`).
  - Room: label, **story LOCATION (free text)**, tint, and W×D readout for rectangles only. "Only rectangular rooms are resized here; edit this one's polygon in the JSON tab" (`:1058`). Height, outdoor and floor are not editable here.
- **JSON tab** (`:807-822`): a live textarea. `draftFromText` (`edit.ts:253`) accepts any *drawable* JSON, even if invalid, so the problem list can explain it. This is the only way to author structure.
- **Validation:** every draft runs `validateHouse`. Problems are a **flat list of strings** under the plan (capped at 30, `:826-838`). Nothing is highlighted on the plan and you cannot click a problem to select its item.
- **Save:** `POST /api/mod/spatial/house {house, base}`. The 409 path offers "Copy my edits (JSON)" and "Reload" (`:851-860`). Server warnings (a room naming an unknown LOCATION) appear only *after* a save.
- **Live layer:** a floor tab per floor (with a dot when a player is on it), ghosts of other floors' rooms (`:528-531`), live players and their ducks from the spatial stream, terminal view cones (`plan.ts:98`).
- **View:** the plan auto-fits the house (`planBounds` → `viewBoxOf`, `:196`) and is frozen during a drag. There is **no zoom, no pan, no rulers, and no dimension labels on the plan**.

---

## 2. Capability matrix

Legend: **SUPPORTED** = doable in the UI · **PARTIAL** = works with caveats or only via JSON · **MISSING** = not possible, or not in the schema.

### Rooms and structure

| Capability | Status | Evidence / notes |
|---|---|---|
| Draw a new room | **MISSING** (JSON only) | No add-room op in `edit.ts`; no toolbar button |
| Delete a room | **MISSING** (JSON only) | `removeThing` handles terminals and ducks only (`edit.ts:145`) |
| Resize a rectangular room | **SUPPORTED** | Edge drag, 5 cm snap (`edit.ts:166`, `MapApp.tsx:497-509`); min side 0.3 m |
| Type exact room dimensions (W × D in m) | **MISSING** | The inspector shows W×D read-only (`MapApp.tsx:1039`) |
| Rectilinear polygon rooms (L/U shapes) | **PARTIAL** | The schema supports them (`types.ts:63`, validator `polygonProblems` `validate.ts:277`). The UI can neither resize nor create them; JSON only |
| Angled / curved walls, bay windows | **MISSING (schema)** | Polygons must be rectilinear (`docs/loom-reinstall.md:75`); `route`, `buildWalls` and the Godot port all assume axis-aligned walls |
| A room with a hole (tent in the middle of the yard) | **MISSING (schema)** | Polygons are simple. Work-around: put the tent at the yard's edge (notched yard polygon), or split the yard into several outdoor rooms joined by full-width doors (see the open-plan row) |
| Open plan (no wall between two rooms) | **PARTIAL** | Every shared edge becomes a wall or fence (`buildWalls` step 3, doc `:172-178`). Work-around: a door whose width equals the shared run and whose height ≥ the room height (no lintel). Allowed, because only a gap that runs *past* the wall is refused (`validate.ts:506`) |
| Wall thickness | **PARTIAL** | Walls are zero-thickness **centre lines** for physics and routing. `style.wallThickness` only affects rendering (`types.ts:45`, `three/layout.ts:20-50`). Measured interior dimensions must be inflated by half a wall to meet the neighbour's line. The editor gives no help with this |
| Room height (ceiling) | **PARTIAL** | `Room.height` is in the schema; not in the UI |
| Outdoor areas (yard, fence) | **PARTIAL** | `Room.outdoor` + `style.fence` (`types.ts:67`, show uses 1.8 m); not toggleable in the UI |
| Room naming ↔ story LOCATION | **PARTIAL** | Free-text `location` field (`MapApp.tsx:1047`). Not validated (`validate.ts:1-5`); the server warns only on save (`spatial.ts:190`, `event-runtime.ts:931`). ModView already carries `locations` (`core/server/views.ts:335`), so a picker is cheap |
| Floor tint / colour | **SUPPORTED** | `patchRoom` colour (`edit.ts:216`) |

### Openings, levels, stairs

| Capability | Status | Evidence / notes |
|---|---|---|
| Doors: add / move along a wall / width / delete | **MISSING** (JSON only) | Drawn as a dot with a tooltip (`MapApp.tsx:593-601`). There are no door ops. The validator is strict (on the wall line ± 2 cm, `b` required on shared walls, no overlaps: `validate.ts:477-530`) |
| Door height | **PARTIAL** | `Door.height` / `style.doorHeight` in the schema; JSON only |
| Windows | **MISSING (schema)** | No window type. A window only matters visually (it does not affect collision or routing), so it can wait, or be faked with a thin `label`/`screen` prop on the wall |
| Multiple floors with elevations / heights | **PARTIAL** | Schema `Floor{elevation, height}` (`types.ts:50-57`). The UI shows floor tabs; adding or editing a floor is JSON only. Floors must be **more than 0.5 m apart** (`FLOOR_SLACK`, doc `:116-118`), so sunken living rooms, a step down to a porch, or a split level under 0.5 m cannot be modelled |
| Stairs | **PARTIAL** | Straight single-flight rect with `up` compass (`types.ts:88-94`), plus 0.3 m clearance at the head and foot (`validate.ts:31`). Drawn on the plan (`MapApp.tsx:545-561`); creating or editing is JSON only. No L-shaped stairs, landings or winders. A landing would need its own floor more than 0.5 m away |
| Ramps / outdoor steps | **MISSING** | Only stairs make ramps |

### Furniture and placed things

| Capability | Status | Evidence / notes |
|---|---|---|
| Props: move / rotate | **SUPPORTED** | `moveTo`, `setYaw` (`edit.ts:50,90`); drag + wheel |
| Props: add / delete / resize / height / kind / solid / colour / label | **MISSING** (JSON only) | The page says so (`MapApp.tsx:1027`). Schema: `kind: box\|cylinder\|screen\|label`, `size [w,h,d]`, `solid` (`types.ts:137-150`) |
| Terminal placement with view cone | **SUPPORTED** | Drag, aim handle, wheel, pitch and fov inputs (`MapApp.tsx:958-985`); cone = `horizontalFov(fov ?? 70)` (`plan.ts:98`); add/delete; provisioning link (copy only) |
| Duck spots | **SUPPORTED** | Add (`edit.ts:134`), drag, y input, delete (keeps at least one). The validator checks the height rule and buried-in-prop (`validate.ts:577-623`) |
| Spawn | **SUPPORTED** | Drag, aim, x/y/z inputs. Exactly one (schema) |

### Drawing aids and file handling

| Capability | Status | Evidence / notes |
|---|---|---|
| Grid + snap | **PARTIAL** | Fixed 5 cm snap, 1 m grid; no setting, no snap to other rooms' walls or edges |
| Zoom / pan | **MISSING** | The viewBox always fits the house (`MapApp.tsx:196`) |
| Dimension labels / rulers / measure tool | **MISSING** | — |
| Floor-plan image underlay | **MISSING** | No image layer, no upload |
| Scale calibration (two points + distance) | **MISSING** | — |
| Undo | **SUPPORTED** | 100-step value stack, one step per drag (`MapApp.tsx:205-224, 310-316`) |
| Redo | **MISSING** | — |
| Validation errors inline | **PARTIAL** | Live list, but plain strings (`validate.ts:99` `label()` gives `rooms[3] "hall": …`). Not tied to the plan |
| 3D preview | **MISSING** in the editor | `buildHouseScene` (`house/src/three/scene.ts:119`) already exists and runs in the browser (web game, terminals); not wired into the map page. You cannot walk the draft either: the game needs a server session (`reinstall/web/src/game/engine.ts:66` `assignment`) |
| Export / import JSON | **PARTIAL** | The JSON tab can be copied and pasted; no file download or upload; "Copy my edits" only on a 409 |
| Save to the event | **SUPPORTED** | `POST /api/mod/spatial/house` with `base` → 409 (`event-runtime.ts:2555-2580`) |
| Persist into the project / show file | **MISSING** | The save is per event (`store.ts:205`). The show file is only `LOOM_HOUSE` or the repo example (`event-runtime.ts:163`), mounted read-only in Docker. A map built on a preview event does not follow a new event and is not in git |
| Into the Godot VR build | **SUPPORTED at runtime** | `server_link.gd:13-24`: bundled copy first, then the server map, refetched every 2 s while stale (doc §5 `:556-571`). The geometry is procedural from the JSON (`house_builder.gd`), so **no rebuild is needed for a new map**. Only the offline fallback needs the show file updated → `pnpm house:sync` → `pnpm test:vr` → re-export the APK |

---

## 3. How the map flows to every consumer

```
director edits at /reinstall/map
   └─ POST /api/mod/spatial/house {house, base}
        ├─ STATE_DIR/<event>/spatial-house.json      (per event — the only persistence)
        └─ SpatialHub.setHouse → SSE `house {version}` (+ `duck` frames)
              ├─ web game (reinstall/web)   refetch, rebuild scene in place
              ├─ terminals world view       refetch (terminal/src/world/stream.ts:230-250)
              └─ VR (Godot)                 refetch every 2 s while stale (server_link.gd)

show file core/examples/trapped-in-the-internet/house.json   (fallback for every event with no save)
   ├─ pnpm house:sync → reinstall/vr/house/house.json (bundled offline fallback) + goldens
   ├─ house goldens include `show` → editing it without `pnpm --filter @loom/house goldens` fails tests
   └─ bundled into web game + terminal builds as their offline stand-in
```

Consequences:

- **Godot needs nothing new to *play* a new house.** A save shows up on the headset within seconds.
- **The VR autopilot is a free sanity check for the real map.** `pnpm test:vr` checks that the autopilot reaches every *show* duck spot, with real collision. It only covers the show file, so the final surveyed map should be promoted into the show file.
- **Schema changes are expensive.** Each one costs TS (`house/`) + GDScript ports + goldens. Keep v1 additive and editor-only where possible. Unknown top-level keys are tolerated: `checkShape` has no unknown-key check, and `normalizeHouse` `structuredClone`s the map (`validate.ts:71`). So an editor-only `editor: {...}` block costs the games nothing. Verify the Godot loader ignores it too (it reads named keys from a Dictionary).

---

## 4. The current placeholder map against the house in the story

The current map's `origin` reads "PLACEHOLDER, not yet surveyed: the front door's outside threshold". It has 2 floors: ground at 0 m, basement at −2.7 m.

| Placeholder room (id) | Floor | LOCATION | Story docs say | Match? |
|---|---|---|---|---|
| Mud Room (`mudroom`) | ground | The Mud Room | Enter "exclusively through the front door"; pitch black; CAPTCHA + leave something behind | **Yes.** The front door is on the mud room (`front`, b = null) and the origin is the front door |
| Hall (`hall`, L-shaped) | ground | The Tube | "a tube of lights and wires … that leads you to the living room"; failed programs are marched "through the Tube into the Internet" | **Partial.** The Tube is modelled as a hallway from the mud room to the living room. It also has to lead to the Internet tent, which is not where the map puts it. A basement `landing` is *also* labelled The Tube |
| Living Room (`living`) | ground | The Desktop | Blacked-out LED mess; **TV above the fireplace**, the AI's screen | **Yes (plausible).** The `fireplace` prop is on the east wall with terminal `desktop-tv` at y 1.8, pitch −10 above it. The real wall and size are unknown |
| Kitchen (`kitchen`) | ground | The Cache | Not mentioned in the story docs | Invented |
| Bathroom (`bathroom`) | ground | The Recycle Bin | "Bathroom Mode" (the 5-minute deadline excuse) | Room exists; LOCATION name is a show invention |
| Backyard (`backyard`, outdoor) | ground | The Cloud | "a folding table **outside**" for Truth Pong | **Partial.** The yard exists but has a picnic table, BBQ and shed, and **no Truth Pong folding table** |
| Stair Landing (`landing`) | basement | The Tube | — | Invented |
| Rec Room (`registry`) | basement | The Registry | — | Invented; has the only `ping-pong` table (basement, indoor) |
| The Tent (`tent`) | **basement** | The Internet | "the reeducation **tent** ('The Internet')" — clearly marked exit, two VR headsets, a tablet playing a video | **Contents yes, place no.** VR stations 1/2, tablet, EXIT and THE INTERNET signs are present, but the tent is an indoor basement room off the Rec Room. The story puts it outside, reached through the Tube. The spawn (`tent`) follows it |
| — | — | — | **Server room = the cold storage room**: Trabolta's heart is a video patch bay; the self-destruct / patch-cable sabotage happens there | **Missing.** No room and no LOCATION (`main.loom:64-98` declares Desktop, Mud Room, Tube, Internet, Cache, Recycle Bin, Cloud, Registry; no server room) |
| — | — | — | Bobbing for Truth (Bag of Truth) | No place or prop yet (a tub prop wherever it runs) |

Fixing this needs the real survey anyway. These schema facts matter for the outdoor parts:

- **An outdoor tent:** model it as an *indoor* room (it has a ceiling) on the ground floor, touching the yard. The yard becomes a notched rectilinear polygon around it, with a door from yard to tent. A tent in the middle of the yard means splitting the yard into outdoor strips joined by full-width doors (rooms cannot have holes).
- **The folding table:** a `box` prop about 1.8 × 0.75 × 0.75 m in the yard, `solid: true`.
- **The cold storage / server room:** a room + a `LOCATION The Server Room` in the story (so the room check-in QR and `houseWarnings` line up) + a patch-bay prop. Mind the `duck-*` spots: put none in a room guests are not allowed into.

**Link to the QR work.** Every room with a `location` is a natural **room check-in sign**. The map can generate the printable sheet: one poster per room carrying `?code=<event>&checkin=<location>` and the room's floor-plan thumbnail. Terminal provisioning links (`edit.ts:240`) currently copy only. A printable QR per terminal (without the mod passcode, which `provisionLink` already omits) belongs to the same print sheet.

---

## 5. Proposed implementation plan

**Principle: no v1 schema change for the games.** Everything below either edits fields that already exist, or lives in an optional `editor` block that the games ignore. The two real schema gaps (windows, sub-0.5 m level changes) are deliberately deferred.

### Phase 0: make the map belong to the project (do this before surveying), **M**

The problem: a save is per event, and the show file is read-only in deploys. Hours of survey work could be stranded on a preview event.

- Make **`house.json` a project file** in server projects (`project_file`, already co-edited via `CollabHub`).
- Event map resolution: **director save > the project's `house.json` (snapshot at launch, like `scenario_source`) > `LOOM_HOUSE` / the show file**.
- Add a **"Save to project"** action on the map page (or make Save write both).
- `core/scripts/sync-example.ts` pushes the example's `house.json` along with the `.loom` files.
- For the repo and offline copies: a **Download JSON** button. The committed `core/examples/.../house.json` then goes through `pnpm house:sync` + `pnpm test:vr`.
- Files: `core/server/event-runtime.ts` (`spatialHouse()` resolution, `:163-200`), `core/server/projects.ts`/`events-api.ts` (snapshot at launch), map page buttons. Tests: core `spatial` + `db`.

### Phase 1: complete the editor on the existing schema, **L** (the core of a real floor-plan editor)

Split `MapApp.tsx` (already 1064 lines) into `map/canvas/` (SVG layers + tools), `map/inspector/`, `map/tools.ts`. Keep `edit.ts` pure and unit-tested.

1. **Tool palette** (Select · Room · Door · Stair · Prop · Terminal · Duck · Measure) with a per-tool click/drag state machine. Pure helpers live in `map/tools.ts`.
2. **Rooms:**
   - Drag-to-draw rectangles.
   - Draw rectilinear polygons click by click, with axis lock.
   - Type **W × D** in the inspector.
   - Drag *any* polygon edge: generalise `moveRectEdge` to move a rectilinear edge and its two neighbours.
   - Add a notch by splitting an edge; delete a vertex when its edges are collinear.
   - Inspector fields for height, outdoor and floor.
   - **Snap to neighbouring walls and vertices** (within 10–15 cm), so adjacent rooms share an exact line. Doors depend on that.
   - Delete a room, with a cascade prompt for its doors, stairs and placed things.
3. **Doors:**
   - Click on a wall line: auto-resolve `a`/`b` from the rooms that share that segment, or `b = null` on an exterior wall.
   - Drag along the line, clamped to the shared run.
   - Width and height inputs, presets for 0.76 / 0.81 / 0.86 / 0.91 m, and a "full opening" toggle (width = run, height = room height).
   - **Carry doors when a room or edge moves.** Today they are left behind (`edit.ts:186`). A door on a moved edge should follow it.
4. **Stairs:** draw a rect over two rooms on adjacent floors; pick `up` by drag direction; `from`/`to` resolved from the floors; show the 0.3 m clearance zones.
5. **Floors:** a floors table (label, elevation, height). Warn about the 0.5 m rule as you type.
6. **Props:**
   - A palette of furniture presets: couch, table, folding table 1.83 × 0.76 × 0.76, counter, fridge, bed, tub, patch bay, VR mat, sign.
   - Add, delete, duplicate.
   - Resize handles on the plan, plus W/H/D and y inputs.
   - Kind, solid, colour and label inputs.
   - Rotate with the existing aim/wheel.
7. **View:**
   - Zoom (wheel with ⌘/Ctrl, since a plain wheel already turns the selection) and pan (space-drag / middle button).
   - "Fit".
   - A snap setting: 1 / 5 / 10 / 25 cm.
   - **Dimension labels** on the selected room's edges, rulers, and a **measure tool** (click two points to read the distance).
   - Show other floors' walls as faint lines (today only filled ghost polygons are shown).
8. **History:** redo (⌘⇧Z) next to the existing undo, one entry per tool action.
9. **Import / export:** download `house.json`, upload a `.json` file (through `draftFromText` + `validateHouse`), and keep copying from the JSON tab.

### Phase 2: measurement-first workflow, **M**

- **Wall-thickness aware entry.** A per-map "interior measurements" mode with `style.wallThickness` (already in the schema). You type the *interior* W × D you taped. The editor stores the polygon on the wall centre line, outset by t/2 on interior walls and the full wall on exterior walls, depending on the setting. Adjacent rooms then meet on one line automatically. Pure function `centreLineFromInterior(rect, t, exteriorEdges)` with unit tests.
- **Tape-walk entry** for odd rooms: "4.12 E, 3.05 S, 1.20 W, 0.80 N…" → a rectilinear polygon, with a closure error shown.
- **Origin helper:** set the origin by clicking the front-door threshold (it shifts the whole map), matching `origin` in the doc (`docs/loom-reinstall.md:41-44`).

### Phase 3: image underlay + scale calibration, **M**

- Upload a photo or scan of the hand-drawn, measured plan **per floor**.
- **Calibrate:** click two points, type the real distance → metres per pixel. Optionally click a third point to set north / rotation, then drag to align. Opacity slider and lock.
- Storage: the image goes through a new mod route `POST /api/mod/spatial/underlay` (PNG/JPEG ≤ ~8 MB). It is saved in the event's state dir, or as a project asset after Phase 0. The transform lives in an **editor-only block** `editor.underlays[floorId] = {src, metresPerPx, offset, rotation, opacity}`. The games never read it (unknown keys are tolerated, `validate.ts:71-97`).
- Render it as an SVG `<image>` under the rooms, transformed into plan coordinates. Rooms are then traced with the snap-to-image-corners-free Room tool from Phase 1.

### Phase 4: inline validation + LOCATION picker, **S**

- Make `validateHouse` emit **structured problems** (`{message, kind, id, index, field?}`) alongside the string list. Add a `problemsDetailed` field so the server and goldens keep the strings; `label()` at `validate.ts:99` already carries kind, index and id. The UI then highlights offending items in red on the plan, clicking a problem selects and zooms to its item, and badges appear on inspector fields.
- **LOCATION dropdown.** Add `locations` (from `sim.model.locations`) to `GET /api/spatial/house` for moderators, or read ModView's `locations` (`views.ts:335`). Show the "no such LOCATION" warning live, not only after a save. Show which story LOCATIONs have *no* room, such as the missing server room.

### Phase 5: 3D preview + "walk it", **M**

- A **3D pane** (split or toggle) using `buildHouseScene(draft)` from `@loom/house/three` with OrbitControls. It rebuilds when the draft changes (throttled) and highlights the selected item. Floor isolation slider. **S–M** on its own, because the scene builder already exists and is browser-tested.
- **Walk the draft:** run the web game engine in a sessionless sandbox (no assignment, local duck pick, no `found` POST) on the current draft. Useful for checking door widths, stair clearances and prop collisions at eye height before printing anything. Needs a small seam in `reinstall/web/src/game/engine.ts` (`assignment` → an optional local stub). **M.**
- Optionally a "terminal view" preview: render from a selected terminal's mount camera with `world/director.ts`'s mount framing, so the TV over the fireplace can be aimed visually.

### Phase 6: getting it into VR, **S** (mostly process)

- Runtime: **nothing to build**. Headsets fetch the event map. Confirm on the real network that `server_link.gd`'s 2 s stale refetch lands after a save.
- Release checklist once the survey is final:
  1. Export the JSON into `core/examples/trapped-in-the-internet/house.json`.
  2. Run `pnpm house:sync` (goldens + VR copy).
  3. Run `pnpm --filter @loom/house test`.
  4. Run `pnpm test:vr`. The autopilot must reach every duck spot with real collision; this is the best automated "the real house is walkable" check.
  5. Re-export the Quest APK, so the offline fallback is the real house.
  6. Rebuild the web/terminal bundles (their bundled stand-ins).
- Add a map-page button **"Check walkability"**: run `route()` from the spawn to every duck spot in the browser and flag unreachable spots. This is the same algorithm the autopilot follows, without needing Godot. **S.**

### Phase 7: print sheet hook (shared with the QR pre-bake work), **S–M**

- From the map: **Print room check-in signs** (one per room with a `location`: big QR, room name, LOCATION, a mini floor-plan "you are here") and **terminal setup cards** (a QR of `provisionLink`, which already omits the mod passcode, `edit.ts:235-243`). The QR payload and the server route belong to the QR pre-bake design. The map only supplies the rooms, terminals and thumbnails.

### Deferred schema extensions (each costs TS + GDScript + goldens; only if the real house needs it)

- `Window {room, at, width, sill, head}`: rendering only, ignored by physics and routing. **M** (TS scene + Godot builder + doc; no golden change if it stays out of `buildWalls`).
- Sub-0.5 m level changes (sunken room, porch step): needs per-room floor offsets in `locate`/`heightAt`/`route` and the Godot ports. **L.** Avoid by modelling small steps as flat.
- Room holes, angled walls, L-shaped stairs: **L** each. Avoid them for this house.

### Effort summary

| Phase | What | Effort |
|---|---|---|
| 0 | House map as a project file; save-to-project; download | **M** |
| 1 | Full structural editing (rooms/polygons/doors/stairs/floors/props), zoom/pan, snap, dimensions, measure, redo, file import/export | **L** |
| 2 | Interior-measurement + wall-thickness entry, tape-walk polygons, origin helper | **M** |
| 3 | Image underlay per floor + 2-point scale calibration + rotation | **M** |
| 4 | Structured inline validation + LOCATION picker / coverage | **S** |
| 5 | 3D orbit preview (S–M) + sessionless "walk the draft" (M) | **M** |
| 6 | VR: release checklist + in-browser walkability check | **S** |
| 7 | Print room check-in signs / terminal cards from the map | **S–M** (with the QR pre-bake work) |

**Suggested order:** 0 → 3 → 1 (rooms, doors, props first) → 2 → 4 → 5 → 6 → 7. That puts the underlay and room drawing in your hands earliest. Phase 0 first, so nothing you trace is lost to a per-event save.
