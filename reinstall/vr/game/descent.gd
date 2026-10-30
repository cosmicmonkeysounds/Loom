## The descent (wave 49, `docs/loom-w49-contract.md` C2 + C6): the more often
## a program has been reinstalled, the less the simulation holds together.
## This is the game's half of [HouseDescent]: the runner over the seeded plan
## ([method HouseDescent.descent_plan]), every vision, the talkers' faces and
## their talk. [Game] drives it: [method tick] on a walking frame,
## [method step] on every frame.
##
## - **Level 0 is the game as it always was**: [method start] returns at once,
##   nothing is built or touched.
## - **The look** ([method HouseDescent.descent_look]) is on for the whole
##   walk: the fog, the ambient, the tint, the neon's stutter.
## - **One vision at a time.** A beat waits while [Game] holds it (an escape,
##   a suspended walk, near the King, the Hallway), a talk is open or a vision
##   runs; [method HouseDescent.due_beat] drops the ones held too long. A
##   vision that can't be drawn is skipped.
## - **Nothing here can stop a walk.** A vision only draws and speaks; a talk
##   never takes the player's stick, and a trigger off the panel's rows still
##   hits the King. The autopilot walks through it all.
## - **Comfort.** No camera motion but small / big's eased eye height, no
##   roll, nothing flashing faster than 3 Hz ([method flicker_level],
##   [method neon_level]).
## - **Cheap on a Quest.** Everything is an unshaded mesh built once, at the
##   first deep walk; `dark` is the fog pulled in, so no shader and no light
##   is added; the [HouseLamps] pool stays fixed.
##
## No line here is written in code: the words come from the script, and a
## level with no script plays its visions in silence.
class_name Descent
extends Node3D

## A vision started / ended (the tests read them).
signal vision_started(kind: String)
signal vision_ended(kind: String)

## A beat waits while the player is within this of the King (m, plan).
const KING_CLEAR_M := 3.0
## A talker's face is drawn within this of the player (m, plan).
const FACE_DRAW_M := 8.0
## How far ahead the visions try to stand (m), best first.
const DUCK_AHEAD := [6.0, 5.0, 4.0]
const GRIN_AHEAD := [2.5, 1.9, 1.4]
const SELF_AHEAD := [4.5, 3.5, 2.5]
## `flicker`: when each dip of the lights starts (s), how long it lasts and how
## low it goes. Starts are at least 0.4 s apart: never past 3 Hz.
const FLICKER_DIPS := [0.1, 0.5, 0.95, 1.4, 1.95]
const FLICKER_DIP_S := 0.2
const FLICKER_LOW := 0.2
## Deeper than level 0 the neon's stutter comes more often, so each one is a
## single dip this long and this low instead of the 14 Hz shiver.
const NEON_DIP_S := 0.17
const NEON_DIP := 0.35
## `tint`: the wrong colours, how far they take the light, the ease (s).
const TINTS := ["#ff2bd6", "#39ff7a", "#ff5a1f", "#4a6cff"]
const TINT_BY := 0.6
const TINT_EASE_S := 2.0
## `dark`: the fog's density (a ~3 m pool of sight), its ease (s), what is left
## of the neon, when the growl comes (s).
const DARK_FOG := 0.62
const DARK_EASE_S := 1.2
const DARK_NEON := 0.12
const GROWL_AT := 3.0
## `follower`: a step this often (s) while the player moves faster than this
## (m/s), this far behind them (m).
const STEP_EVERY := 0.55
const STEP_SPEED := 0.4
const BEHIND_M := 2.2
## How far (m) the pale things walk, how fast (m/s).
const DUCK_SPEED := 0.9
const SELF_SPEED := 1.0
const SELF_WALK_S := 3.5
## The pale things' ease in and out (s).
const FADE_S := 1.0
## After [constant HouseDescent.VISION_S] the door fades over this (s).
const DOOR_FADE_S := 1.5
## How far the red under the door spills out on the floor (m).
const SPILL_M := 0.3
## The Hallway's fog and how little of the house's light reaches it.
const POCKET_FOG := 0.05
const POCKET_LIGHT := 0.04

var game: Game
## This walk's level, session, program, words and marks.
var level := 0
var words: Variant = null
var seed_id := ""
var who := {"name": "", "visit": 1}
var told := {}
var plan: Array = []
## Who is awake: `{prop, talker, face, eyes, mouth, anchor, armed}` each.
var awake: Array = []
## A walk is on at level ≥ 1.
var running := false
## The clock of the walk (s), and the first beat not yet spent.
var walk_t := 0.0
var _next := 0
## The vision running ("" = none), its clock, its beat's `n`, its length, its own state.
var vision := ""
var _v_t := 0.0
var _v_n := 0
var _v_dur := 0.0
var _v := {}
## A `do` waiting for the running vision to end, and since when.
var _pending := ""
var _pending_at := 0.0
var _do_n := 0
## The talk open: `{wake, node, phase: "say" | "pick"}`; `{}` = none.
var _talk := {}
## The walk is over (the find): only the eases still run, back to normal.
var _winding := false
## The player is in the Hallway.
var _pocket := false
## Anything was changed that [method stop] must put back.
var _touched := false

## What a vision does to the light, eased (0 … 1 unless said).
var _dip := 1.0
var _tint_k := 0.0
var _tint := Color.WHITE
var _dark := 0.0
var _dark_want := 0.0
## Small / big: where the ease is (0 … 1), and the scale it eases to.
var _eye_k := 0.0
var _eye_want := 0.0
var _eye_to := 1.0

var _built := false
var _duck: MeshInstance3D
var _duck_mat: StandardMaterial3D
var _grin: Node3D
var _grin_mat: StandardMaterial3D
var _grin_eyes_mat: StandardMaterial3D
var _self: Node3D
var _self_mat: StandardMaterial3D
var _self_visor: StandardMaterial3D
var _door: Dictionary = {}
## Where the follower's steps and the growl come from.
var _behind: AudioStreamPlayer3D
## Where the pale Gerald's wrong quack comes from.
var _duck_voice: AudioStreamPlayer3D

static var _face_eye: SphereMesh
static var _face_pupil: SphereMesh
static var _face_mouth: BoxMesh


# --- the pure rules ---------------------------------------------------------------


## The `flicker` vision's light at `t` s: 1 but for its dips (≤ 3 Hz).
static func flicker_level(t: float) -> float:
	for d: float in FLICKER_DIPS:
		if t >= d and t < d + FLICKER_DIP_S:
			return FLICKER_LOW
	return 1.0


## The neon at `t` s under a level's look (`rate`, its `flicker`): today's
## stutter at 1; deeper, every [constant HouseModels.NEON_FLICKER_S] / `rate`
## s, one dip, however often it comes: never past 3 Hz.
static func neon_level(t: float, rate: float) -> float:
	if rate <= 1.0:
		return HouseModels.neon_flicker(t)
	return NEON_DIP if fposmod(t, HouseModels.NEON_FLICKER_S / rate) < NEON_DIP_S else 1.0


## A pale thing's alpha at `t` of `dur` s: in and out over [constant FADE_S].
static func fade_at(t: float, dur: float) -> float:
	return clampf(minf(t, dur - t) / FADE_S, 0.0, 1.0)


## How far the walk's wrong colour is at `t` of `dur` s (0 … 1).
static func tint_at(t: float, dur: float) -> float:
	return clampf(minf(t, dur - t) / TINT_EASE_S, 0.0, 1.0)


## The eye height's scale `k` (0 … 1, eased) of the way to `to`.
static func eye_scale_at(k: float, to: float) -> float:
	return lerpf(1.0, to, smoothstep(0.0, 1.0, k))


# --- the walk ---------------------------------------------------------------------


## A walk starts (its intro over): `a` the assignment, `lvl` its level, `given`
## the script or null. Level 0 touches nothing.
func start(a: Dictionary, lvl: int, given: Variant) -> void:
	stop()
	level = HouseDescent.clamp_descent(lvl)
	if level == 0:
		return
	_ensure_built()
	seed_id = str(a.get("session", ""))
	who = {"name": str(a.get("name", "")), "visit": HouseDescent.visit_of(a.get("reinstalled"), level)}
	told = (a["told"] as Dictionary).duplicate() if a.get("told") is Dictionary else {}
	plan = HouseDescent.descent_plan(seed_id, level)
	words = given
	running = true
	_touched = true
	game.ghosts.picture_for(a.get("avatar"))  # fetched now, for a `self` later
	game.builder.neon_rate = float(HouseDescent.descent_look(level)["flicker"])
	game.builder.set_descent(level)
	_wake()
	_shade()


## Back to the plain game, at once (the lobby).
func stop() -> void:
	end_talk()
	_end_vision(false)
	running = false
	_winding = false
	_pocket = false
	plan = []
	awake_clear()
	words = null
	level = 0
	walk_t = 0.0
	_next = 0
	_pending = ""
	_dip = 1.0
	_tint_k = 0.0
	_dark = 0.0
	_dark_want = 0.0
	_eye_k = 0.0
	_eye_want = 0.0
	_eye_to = 1.0
	if not _touched:
		return
	_touched = false
	var b := game.builder
	b.neon_rate = 1.0
	b.neon_scale = 1.0
	b.set_haze_scale(1.0)
	b.set_descent(0)
	var l := game.lamps
	l.ambient_scale = 1.0
	l.pool_scale = 1.0
	l.tint = Color.WHITE
	l.tint_by = 0.0
	var env := game.world_env
	if env != null:
		env.fog_density = HouseLook.FOG_DENSITY
		env.fog_light_color = HouseLook.HAZE
		env.background_color = HouseLook.HAZE
	game.player.set_eye_scale(1.0)


## The find: the talk and the vision end, the eases go back on their own.
func on_found() -> void:
	if not running:
		return
	end_talk()
	_end_vision(false)
	running = false
	_winding = true
	_pending = ""


## An escape took the player away: the talk and any vision end.
func interrupt() -> void:
	if not running:
		return
	end_talk()
	_end_vision(false)
	_pending = ""


## The words landed after the walk began: the same talkers unless they changed.
func adopt_script(given: Variant) -> void:
	if not running or (typeof(given) == typeof(words) and given == words):
		return
	words = given
	end_talk()
	_wake()


## The house was rebuilt under us (a remap): every prop node is new.
func on_rebuilt() -> void:
	if not running:
		return
	end_talk()
	if vision == "door":
		_end_vision(false)
	_wake()


## In the Hallway (`on`), or back: its dark, and nothing of ours shows.
func pocket(on: bool) -> void:
	_pocket = on
	visible = not on
	_shade()


## One walking frame at `feet` (house frame). `held`: [Game] holds the beats.
func tick(house: Dictionary, feet: Array, held: bool) -> void:
	if not running:
		return
	_tick_faces(house, feet)
	_tick_talk(house, feet)
	if vision == "" and _pending != "":
		var kind := _pending
		_pending = ""
		if walk_t - _pending_at <= HouseDescent.DESCENT_LATE_S:
			_begin(kind, _next_n(), house, feet)
	if held or vision != "" or not _talk.is_empty():
		return
	var i := HouseDescent.due_beat(plan, _next, walk_t)
	if i < 0:
		return
	_next = i + 1
	_begin(str(plan[i]["vision"]), int(plan[i]["n"]), house, feet)


## Every frame: the clock, the running vision, the eases.
func step(delta: float) -> void:
	if not running and not _winding:
		return
	if running:
		walk_t += delta
	if vision != "":
		_v_t += delta
		_draw(delta)
		if vision != "" and _v_t >= _v_dur:
			_end_vision(true)
	_eye_k = move_toward(_eye_k, _eye_want, delta / HouseDescent.ALICE_EASE_S)
	game.player.set_eye_scale(eye_scale_at(_eye_k, _eye_to))
	_dark = move_toward(_dark, _dark_want, delta / DARK_EASE_S)
	_shade()
	if _winding and _eye_k <= 0.0 and _dark <= 0.0:
		_winding = false


## What the look and the vision do to the light, the fog and the neon, now.
func _shade() -> void:
	var b := game.builder
	var l := game.lamps
	var look: Dictionary = HouseDescent.descent_look(level)
	var dip := _dip if vision == "flicker" else 1.0
	if _pocket:
		l.ambient_scale = POCKET_LIGHT
		l.pool_scale = POCKET_LIGHT
		l.tint_by = 0.0
		_set_fog(POCKET_FOG, Color.BLACK)
		return
	l.ambient_scale = float(look["ambient"]) * dip
	l.pool_scale = dip
	var by := float(look["tintBy"])
	var tint := Color(str(look["tint"]))
	if _tint_k > 0.0:
		tint = tint.lerp(_tint, _tint_k)
		by = maxf(by, TINT_BY * _tint_k)
	l.tint = tint
	l.tint_by = by
	b.neon_scale = dip * lerpf(1.0, DARK_NEON, _dark)
	b.set_haze_scale(1.0 - _dark)
	_set_fog(lerpf(HouseLook.FOG_DENSITY * float(look["fog"]), DARK_FOG, _dark), HouseLook.HAZE.lerp(Color.BLACK, _dark))


## The fog and the background, only when they change (each set reaches the
## rendering server).
func _set_fog(density: float, color: Color) -> void:
	var env := game.world_env
	if env == null or (is_equal_approx(env.fog_density, density) and env.fog_light_color.is_equal_approx(color)):
		return
	env.fog_density = density
	env.fog_light_color = color
	env.background_color = color


func _next_n() -> int:
	_do_n += 1
	return _do_n


# --- the visions ------------------------------------------------------------------


## A plan point `dists` ahead of `feet` along `yaw` in the room it stands in, the
## first that fits; null when none does. `stand`: a body could stand there.
func _ahead(house: Dictionary, feet: Array, yaw: float, dists: Array, stand := true) -> Variant:
	var room: Variant = HouseLocate.locate(house, feet)["room"]
	if room == null:
		return null
	var f := HouseFrames.forward(yaw)
	for d: float in dists:
		var p: Array = [float(feet[0]) + float(f[0]) * d, float(feet[1]), float(feet[2]) + float(f[2]) * d]
		if HouseLocate.locate(house, p)["room"] == room and (not stand or HouseLocate.standable(house, p)):
			return p
	return null


## Start vision `kind`; false when it can't be drawn (then it is skipped).
func _begin(kind: String, n: int, house: Dictionary, feet: Array) -> bool:
	var b := game.builder
	var p := game.player
	var yaw := b.yaw_to_house(p.head_yaw())
	var flat := Vector3(-sin(deg_to_rad(p.head_yaw())), 0.0, -cos(deg_to_rad(p.head_yaw())))
	var v := {}
	match kind:
		"whiteduck":
			var at: Variant = _ahead(house, feet, yaw, DUCK_AHEAD)
			if at == null:
				return false
			_duck.position = b.to_world(at)
			_duck.rotation.y = deg_to_rad(p.head_yaw())
			_duck.visible = true
			v = {"dir": flat}
		"grin":
			var at: Variant = _ahead(house, feet, yaw, GRIN_AHEAD, false)
			if at == null:
				return false
			var spot := b.to_world(at)
			spot.y = p.camera.global_position.y
			_grin.position = spot
			_grin.visible = true
		"self":
			var tex := game.ghosts.picture_for(game.flow.assignment.get("avatar"))
			var at: Variant = _ahead(house, feet, yaw, SELF_AHEAD)
			if tex == null or at == null:
				return false
			Ghosts.set_pale_picture(_self, tex)
			_self.position = b.to_world(at)
			_self.rotation.y = deg_to_rad(p.head_yaw())
			_self.visible = true
			# Walks on only as far as the room goes.
			var walk := 0.0
			var from: Array = at
			for d: float in [SELF_SPEED * SELF_WALK_S, 2.0, 1.0]:
				if _ahead(house, from, yaw, [d]) != null:
					walk = d
					break
			v = {"dir": flat, "walk": walk, "from": _self.position, "yaw": _self.rotation.y}
		"door":
			var spot: Variant = HouseDescent.door_spot(house, feet, yaw)
			if spot == null:
				return false
			var node: Node3D = _door["node"]
			node.position = b.to_world(spot["pos"])
			node.rotation.y = deg_to_rad(b.yaw_to_world(float(spot["yaw"])))
			node.visible = true
			_door_alpha(1.0)
			v = {"spot": spot}
		"small", "big":
			_eye_to = HouseDescent.ALICE_SMALL if kind == "small" else HouseDescent.ALICE_BIG
			_eye_want = 1.0
		"dark":
			_dark_want = 1.0
		"tint":
			_tint = Color(str(TINTS[n % TINTS.size()]))
		"whisper":
			var list: Variant = (words as Dictionary)["whispers"].get(str(level)) if words is Dictionary else null
			_say(list, n)
	vision = kind
	_v_t = 0.0
	_v_n = n
	_v_dur = float(HouseDescent.VISION_S[kind]) + (DOOR_FADE_S if kind == "door" else 0.0)
	_v = v
	_v["said"] = false
	print("reinstall-vr: the descent — %s (level %d, %.0f s in)" % [kind, level, walk_t])
	vision_started.emit(kind)
	return true


## The vision's frame.
func _draw(delta: float) -> void:
	var p := game.player
	match vision:
		"flicker":
			_dip = flicker_level(_v_t)
		"tint":
			_tint_k = tint_at(_v_t, _v_dur)
		"follower":
			_draw_follower(delta)
		"whiteduck":
			_duck_mat.albedo_color.a = 0.85 * fade_at(_v_t, _v_dur)
			_duck.position += (_v["dir"] as Vector3) * DUCK_SPEED * delta
			_duck.rotation.z = 0.12 * sin(_v_t * TAU * 1.5)
			if _v_t >= 0.4 and not _v.get("quacked", false):
				_v["quacked"] = true
				_duck_voice.global_position = _duck.global_position
				game.sfx.play_at(_duck_voice, "quack", 0.9, 0.62)
			if _v_t >= 1.0:
				_say_once("whiteduck")
		"grin":
			_grin.rotation.y = atan2(p.camera.global_position.x - _grin.position.x, p.camera.global_position.z - _grin.position.z)
			# The eyes go first; the smile is the last thing to go.
			_grin_eyes_mat.albedo_color.a = clampf(minf(_v_t, 5.0 - _v_t) / FADE_S, 0.0, 1.0)
			_grin_mat.albedo_color.a = clampf(minf(_v_t, (_v_dur - _v_t) * 0.6) / FADE_S, 0.0, 1.0)
			if _v_t >= 1.5:
				_say_once("grin")
		"dark":
			if _v_t >= _v_dur - DARK_EASE_S:
				_dark_want = 0.0
			if _v_t >= GROWL_AT and not _v.get("growled", false):
				_v["growled"] = true
				_place_behind()
				game.sfx.play_at(_behind, "growl", 0.9)
		"self":
			var alpha := fade_at(_v_t, _v_dur)
			_self_mat.albedo_color.a = 0.5 * alpha
			_self_visor.albedo_color.a = 0.8 * alpha
			Ghosts.set_pale_alpha(_self, 0.9 * alpha)
			var f := clampf(_v_t / SELF_WALK_S, 0.0, 1.0)
			_self.position = (_v["from"] as Vector3) + (_v["dir"] as Vector3) * float(_v["walk"]) * f
			if _v_t >= SELF_WALK_S:
				# It stops and looks back.
				var turn := clampf(_v_t - SELF_WALK_S, 0.0, 1.0)
				var back := atan2(p.camera.global_position.x - _self.position.x, p.camera.global_position.z - _self.position.z) + PI
				_self.rotation.y = lerp_angle(float(_v["yaw"]), back, smoothstep(0.0, 1.0, turn))
				_say_once("self")
		"small", "big":
			if _v_t >= _v_dur - HouseDescent.ALICE_EASE_S:
				_eye_want = 0.0
			if _v_t >= 1.0:
				_say_once(vision)
		"door":
			if _v_t > float(HouseDescent.VISION_S["door"]):
				_door_alpha((_v_dur - _v_t) / DOOR_FADE_S)


## Steps behind the player while they move; they stop when the player stops.
## At the end, one step more.
func _draw_follower(delta: float) -> void:
	var at := game.player.feet()
	var last: Vector3 = _v.get("last", at)
	_v["last"] = at
	var moving := delta > 0.0 and Vector2(at.x - last.x, at.z - last.z).length() / delta >= STEP_SPEED
	_v["wait"] = float(_v.get("wait", 0.0)) - delta
	if moving and float(_v["wait"]) <= 0.0:
		_v["wait"] = STEP_EVERY
		_step_behind()
	if _v_t >= _v_dur - delta and not _v.get("last_step", false):
		_v["last_step"] = true
		_step_behind()


func _step_behind() -> void:
	_place_behind()
	game.sfx.play_at(_behind, "step", 0.8)


func _place_behind() -> void:
	var c := game.player.camera
	var y := deg_to_rad(game.player.head_yaw())
	_behind.global_position = c.global_position + Vector3(sin(y), 0.0, cos(y)) * BEHIND_M


## End the running vision: what it drew goes; the eases go back on their own.
func _end_vision(played: bool) -> void:
	if vision == "":
		return
	var kind := vision
	vision = ""
	_v = {}
	_dip = 1.0
	_tint_k = 0.0
	_dark_want = 0.0
	_eye_want = 0.0
	if _built:
		_duck.visible = false
		_grin.visible = false
		_self.visible = false
		(_door["node"] as Node3D).visible = false
	if played:
		vision_ended.emit(kind)


## The door vision's door, while it stands.
func door_spot_now() -> Variant:
	return _v.get("spot") if vision == "door" else null


## Whether feet `feet` have walked within reach of the door.
func door_reached(house: Dictionary, feet: Array) -> bool:
	var spot: Variant = door_spot_now()
	if spot == null:
		return false
	var at: Array = spot["pos"]
	if HouseLocate.floor_of(house, float(feet[1])) != HouseLocate.floor_of(house, float(at[1])):
		return false
	return Vector2(float(at[0]) - float(feet[0]), float(at[2]) - float(feet[2])).length() <= HouseDescent.HALLWAY_DOOR_M


## Through the door: the talk ends, the door is gone. Its spot (`{pos, yaw}`).
func take_door() -> Variant:
	var spot: Variant = door_spot_now()
	end_talk()
	_end_vision(true)
	return spot


func _door_alpha(a: float) -> void:
	(_door["mat"] as StandardMaterial3D).albedo_color.a = a
	(_door["slit"] as StandardMaterial3D).albedo_color.a = a


# --- the words --------------------------------------------------------------------


## Say a line from `list`, unless something is being said already: a vision's
## line never queues up behind another.
func _say(list: Variant, n: int) -> void:
	var line: Variant = HouseDescent.pick_line(list, n)
	if line != null and not game.speech.busy():
		game.speech.say([{"from": "", "text": HouseDescent.fill_line(str(line), who)}], null)


## The running vision's one line, once.
func _say_once(key: String) -> void:
	if _v.get("said", false):
		return
	_v["said"] = true
	if words is Dictionary:
		_say((words as Dictionary).get(key), _v_n)


## The Hallway's lines: `part` is "enter", "far" or "out". `far` is one of
## them, the others all of them.
func say_hallway(part: String) -> void:
	if not words is Dictionary:
		return
	var list: Array = (words as Dictionary)["hallway"][part]
	if part == "far" and not list.is_empty():
		list = [HouseDescent.pick_line(list, HouseDuck.fnv1a32(seed_id) % 1024)]
	game.speech.say(list.map(func(l: String) -> Dictionary: return {"from": "", "text": HouseDescent.fill_line(l, who)}), null)


## What Gerald says at the find, at this level (`[]`: nothing).
func found_lines() -> Array:
	if not words is Dictionary:
		return []
	var line: Variant = HouseDescent.pick_line((words as Dictionary)["found"].get(str(level)), HouseDuck.fnv1a32(seed_id) % 1024)
	return [] if line == null else [{"from": "", "text": HouseDescent.fill_line(str(line), who)}]


# --- the talkers ------------------------------------------------------------------


func awake_clear() -> void:
	for w: Dictionary in awake:
		(w["face"] as Node3D).queue_free()
	awake = []


## Wake this walk's talkers: a face on each.
func _wake() -> void:
	awake_clear()
	var house := game.builder.house
	if not words is Dictionary:
		return
	for w: Dictionary in HouseDescent.wake_talkers(house, words, level, seed_id):
		var prop := _prop(house, str(w["prop"]))
		var talker: Variant = HouseDescent.talker_for(words, prop)
		var anchor := game.builder.part("Prop_%s" % w["prop"]) as Node3D
		if talker == null or anchor == null:
			continue
		anchor.set_meta("height", float(prop["size"][1]))
		var row := {"prop": prop, "talker": talker, "anchor": anchor, "armed": true}
		_make_face(row)
		awake.append(row)


static func _prop(house: Dictionary, id: String) -> Dictionary:
	for p: Dictionary in house.get("props", []):
		if str(p["id"]) == id:
			return p
	return {}


func _make_face(row: Dictionary) -> void:
	if _face_eye == null:
		_face_eye = SphereMesh.new()
		_face_eye.radius = 0.2
		_face_eye.height = 0.4
		_face_eye.radial_segments = 12
		_face_eye.rings = 6
		_face_pupil = SphereMesh.new()
		_face_pupil.radius = 0.1
		_face_pupil.height = 0.2
		_face_pupil.radial_segments = 8
		_face_pupil.rings = 4
		_face_mouth = BoxMesh.new()
		_face_mouth.size = Vector3(0.6, 0.16, 0.06)
	var prop: Dictionary = row["prop"]
	var b := game.builder
	var a := HouseDescent.face_anchor(prop)
	var size: Array = prop["size"]
	var node := Node3D.new()
	node.position = b.to_world(a["pos"])
	node.rotation.y = deg_to_rad(b.yaw_to_world(float(a["yaw"])))
	node.scale = Vector3.ONE * clampf(minf(float(size[0]), float(size[1])) * 0.4, 0.09, 0.34)
	add_child(node)
	var white := HouseLook.screen("#f4f2e8")
	var ink := HouseLook.screen("#08080c")
	var eyes: Array = []
	for side: float in [-1.0, 1.0]:
		var eye := MeshInstance3D.new()
		eye.mesh = _face_eye
		eye.material_override = white
		eye.position = Vector3(side * 0.3, 0.2, -0.04)
		eye.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(eye)
		var pupil := MeshInstance3D.new()
		pupil.mesh = _face_pupil
		pupil.material_override = ink
		pupil.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(pupil)
		eyes.append([eye.position, pupil])
	var mouth := MeshInstance3D.new()
	mouth.mesh = _face_mouth
	mouth.material_override = ink
	mouth.position = Vector3(0, -0.28, -0.03)
	mouth.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	node.add_child(mouth)
	row["face"] = node
	row["eyes"] = eyes
	row["mouth"] = mouth
	node.visible = false


## The faces near the player look at them; the mouth moves while it speaks.
func _tick_faces(house: Dictionary, feet: Array) -> void:
	var fl := HouseLocate.floor_of(house, float(feet[1]))
	var eye_at := game.player.camera.global_position
	for w: Dictionary in awake:
		var node: Node3D = w["face"]
		var at: Array = w["prop"]["pos"]
		var near := HouseLocate.floor_of(house, float(at[1])) == fl and Vector2(float(at[0]) - float(feet[0]), float(at[2]) - float(feet[2])).length() <= FACE_DRAW_M
		node.visible = near
		if not near:
			continue
		var look := node.to_local(eye_at).normalized()
		for e: Array in w["eyes"]:
			(e[1] as Node3D).position = (e[0] as Vector3) + look * 0.14
		var talking: bool = game.speech.busy_on(w["anchor"])
		(w["mouth"] as Node3D).scale.y = 0.4 + 1.6 * absf(sin(walk_t * PI * 2.5)) if talking else 0.4


func _tick_talk(house: Dictionary, feet: Array) -> void:
	if _talk.is_empty():
		for w: Dictionary in awake:
			if not w["armed"]:
				if not HouseDescent.talk_reach(house, feet, w["prop"], HouseDescent.TALK_LEAVE_M):
					w["armed"] = true
			elif HouseDescent.talk_reach(house, feet, w["prop"]):
				_open_talk(w)
				return
		return
	var w: Dictionary = _talk["wake"]
	if not HouseDescent.talk_reach(house, feet, w["prop"], HouseDescent.TALK_LEAVE_M):
		end_talk()
		return
	if _talk["phase"] == "say":
		if game.speech.busy_on(w["anchor"]):
			return
		var options: Variant = _node().get("options")
		if options is Array:
			var texts: Array = (options as Array).map(func(o: Dictionary) -> String: return HouseDescent.fill_line(str(o["text"]), who))
			var c := game.player.camera.global_position
			game.talk.open(texts, TalkPanel.place((w["anchor"] as Node3D).global_position, c))
			_talk["phase"] = "pick"
		else:
			end_talk()
		return
	var aim := game.pointer.poll()
	var hit := game.talk.aim(aim)
	game.pointer.draw(aim, hit)
	if aim.get("pressed", false) == true and int(hit.get("index", -1)) >= 0:
		_pick(int(hit["index"]))


func _node() -> Dictionary:
	return _talk["wake"]["talker"]["nodes"][_talk["node"]]


func _open_talk(w: Dictionary) -> void:
	_talk = {"wake": w, "node": HouseDescent.open_node(w["talker"], told), "phase": "say"}
	print("reinstall-vr: the descent — %s speaks" % w["talker"]["id"])
	_say_node()


## The node's lines over the prop; its `do` sets off a vision.
func _say_node() -> void:
	var w: Dictionary = _talk["wake"]
	var n := _node()
	var lines: Array = (n["say"] as Array).map(func(l: String) -> Dictionary: return {"from": "", "text": HouseDescent.fill_line(l, who)})
	game.speech.say(lines, w["anchor"])
	if n.get("do") is String:
		_do(str(n["do"]))


func _pick(i: int) -> void:
	var w: Dictionary = _talk["wake"]
	var r: Variant = HouseDescent.pick_option(w["talker"], str(_talk["node"]), i)
	if r == null:
		return
	game.talk.close()
	game.pointer.hide_beam()
	game.swallow_hit()
	if r["tell"] != null:
		told[str(w["talker"]["id"])] = str(r["tell"])
		game.link.post_told(str(w["talker"]["id"]), str(r["tell"]))
	if r["vision"] != null:
		_do(str(r["vision"]))
	if r["to"] == null:
		end_talk()
		return
	_talk["node"] = str(r["to"])
	_talk["phase"] = "say"
	_say_node()


## A vision a talk set off: now, or when the running one ends.
func _do(kind: String) -> void:
	_pending = kind
	_pending_at = walk_t


## End the talk (walked away, an escape, the find, the door): its lines go, the
## panel goes, and the talker keeps quiet until the player has left it.
func end_talk() -> void:
	if _talk.is_empty():
		return
	var w: Dictionary = _talk["wake"]
	_talk = {}
	w["armed"] = false
	game.speech.cancel(w["anchor"])
	game.talk.close()
	game.pointer.hide_beam()


## Whether a talk is open.
func talking() -> bool:
	return not _talk.is_empty()


## The talker open now ("" = none).
func talker_id() -> String:
	return "" if _talk.is_empty() else str(_talk["wake"]["talker"]["id"])


## The node the talk is on ("" = none).
func talk_node() -> String:
	return "" if _talk.is_empty() else str(_talk["node"])


## Whether the trigger is the panel's now: a row is under the beam. Anywhere
## else it is the King's hit.
func trigger_taken() -> bool:
	return game.talk.hovered() >= 0


# --- once, at the first deep walk ---------------------------------------------------


func _ensure_built() -> void:
	if _built:
		return
	_built = true
	game.talk.build()
	game.hallway.build()
	_duck_mat = fade_material()
	_duck = MeshInstance3D.new()
	_duck.name = "PaleGerald"
	_duck.mesh = _pale_duck()
	_duck.material_override = _duck_mat
	_duck.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_duck)
	_build_grin()
	_self_mat = fade_material(Color(0.85, 0.95, 0.95))
	_self_visor = fade_material(Color("#e8fbff"))
	_self = Ghosts.make_pale(_self_mat, _self_visor)
	_self.name = "PaleSelf"
	add_child(_self)
	_door = make_door()
	(_door["node"] as Node3D).name = "Door"
	add_child(_door["node"])
	_behind = _emitter("Behind")
	_duck_voice = _emitter("PaleQuack")
	_duck.visible = false
	_grin.visible = false
	_self.visible = false
	(_door["node"] as Node3D).visible = false


func _emitter(node_name: String) -> AudioStreamPlayer3D:
	var e := AudioStreamPlayer3D.new()
	e.name = node_name
	e.bus = Sfx.BUS
	e.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED
	e.max_distance = 0.0
	e.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	add_child(e)
	return e


## An unshaded material a vision can fade (its own, never shared).
static func fade_material(color := Color.WHITE, vertex := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = color
	m.disable_fog = true
	m.vertex_color_use_as_albedo = vertex
	m.vertex_color_is_srgb = vertex
	return m


## A blank pale Gerald, one merged mesh: Gerald's own shape, no eyes.
func _pale_duck() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for part: Array in [
		[0.22, Vector3(0, 0.2, 0.03), Vector3(1.0, 0.72, 1.32)],
		[0.15, Vector3(0, 0.22, -0.13), Vector3(1.0, 0.85, 0.9)],
		[0.075, Vector3(0, 0.33, -0.15), Vector3(1.0, 1.4, 1.0)],
		[0.125, Vector3(0, 0.45, -0.17), Vector3(1.0, 0.95, 1.05)],
		[0.1, Vector3(0, 0.29, 0.27), Vector3(1.1, 0.55, 1.2)],
		[0.06, Vector3(0, 0.425, -0.3), Vector3(0.95, 0.32, 1.25)],
	]:
		var s := SphereMesh.new()
		s.radius = part[0]
		s.height = float(part[0]) * 2.0
		s.radial_segments = 12
		s.rings = 6
		st.append_from(s, 0, Transform3D(Basis.from_scale(part[2]), part[1]))
	return st.commit()


## A smile with nothing behind it: a crescent with its teeth, and two eyes that
## go first. Facing +z; [method _draw] turns it to the player.
func _build_grin() -> void:
	_grin = Node3D.new()
	_grin.name = "Grin"
	add_child(_grin)
	_grin_mat = fade_material(Color.WHITE, true)
	_grin_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var top := func(u: float) -> float: return 0.11 * u * u
	var low := func(u: float) -> float: return 0.11 * u * u - 0.12 * (1.0 - u * u)
	var white := Color("#f7f5e6")
	var w := 0.36
	for i in 24:
		var a := -1.0 + 2.0 * i / 24.0
		var b := -1.0 + 2.0 * (i + 1) / 24.0
		_quad(st, Vector3(a * w, top.call(a), 0), Vector3(b * w, top.call(b), 0), Vector3(b * w, low.call(b), 0), Vector3(a * w, low.call(a), 0), white)
	var ink := Color("#0a0a10")
	for i in range(-8, 9):
		var u := i / 9.0
		var t := 0.006
		_quad(st, Vector3(u * w - t, top.call(u), 0.002), Vector3(u * w + t, top.call(u), 0.002), Vector3(u * w + t, low.call(u), 0.002), Vector3(u * w - t, low.call(u), 0.002), ink)
	var smile := MeshInstance3D.new()
	smile.name = "Smile"
	smile.mesh = st.commit()
	smile.material_override = _grin_mat
	smile.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_grin.add_child(smile)
	_grin_eyes_mat = fade_material(Color("#d8ff4a"))
	var ball := SphereMesh.new()
	ball.radius = 0.05
	ball.height = 0.05
	ball.radial_segments = 10
	ball.rings = 4
	for side: float in [-1.0, 1.0]:
		var eye := MeshInstance3D.new()
		eye.mesh = ball
		eye.material_override = _grin_eyes_mat
		eye.position = Vector3(side * 0.17, 0.2, 0)
		eye.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_grin.add_child(eye)


static func _quad(st: SurfaceTool, a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color) -> void:
	for p: Vector3 in [a, b, c, a, c, d]:
		st.set_color(color)
		st.add_vertex(p)


## The door to nowhere ([constant HouseModels.PROP_MODELS]' `door`, its frame and
## black leaf, its red slit), merged and unshaded: `{node, mat, slit}`. Each one
## has its own materials, to fade. The Hallway's far door is one too.
static func make_door() -> Dictionary:
	var model := HouseModels.prop_model("door")
	var size: Array = model["size"]
	var frame := SurfaceTool.new()
	frame.begin(Mesh.PRIMITIVE_TRIANGLES)
	var slit := SurfaceTool.new()
	slit.begin(Mesh.PRIMITIVE_TRIANGLES)
	for part: Dictionary in HouseModels.parts_of("door", float(size[0]), float(size[1]), float(size[2])):
		var role := str(part["role"])
		var c := Color(model["neon"]) if role == "neon" else (Color(model["color"]) if role == "body" else Color(HouseModels.ROLE_COLORS[role]))
		HouseBuilder.add_box(slit if role == "neon" else frame, Transform3D.IDENTITY, part["c"], part["s"], c)
	# The model's slit is a centimetre tall; what reads from across a room is
	# the red it lets out onto the floor.
	var spill := float(size[0]) * 0.84
	HouseBuilder.add_box(slit, Transform3D.IDENTITY, Vector3(0, 0.03, -float(size[2]) / 2.0 - SPILL_M / 2.0), Vector3(spill, 0.004, SPILL_M), Color(model["neon"]))
	var node := Node3D.new()
	var mat := fade_material(Color.WHITE, true)
	var glow := fade_material(Color.WHITE, true)
	for pair: Array in [[frame, mat, "Frame"], [slit, glow, "Slit"]]:
		var mi := MeshInstance3D.new()
		mi.name = pair[2]
		mi.mesh = (pair[0] as SurfaceTool).commit()
		mi.material_override = pair[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mi)
	return {"node": node, "mat": mat, "slit": glow}


# --- for the tests --------------------------------------------------------------


func door_node() -> Node3D:
	return _door.get("node")


func pale_duck() -> MeshInstance3D:
	return _duck


func grin_node() -> Node3D:
	return _grin


func pale_self() -> Node3D:
	return _self


func dark_level() -> float:
	return _dark
