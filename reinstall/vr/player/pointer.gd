## The lobby's pointer (`docs/loom-reinstall.md` §5): a laser from a
## controller's aim pose on a headset, the mouse on the desktop rig.
##
## - **Headset**: each hand's aim pose (an [XRController3D] on the `aim`
##   pose, the hand's own transform until it tracks) casts a ray; the
##   trigger (click, or pulled past [constant TRIGGER_ON]) is the press.
##   One hand holds the beam. The other takes it by a fresh trigger pull, or
##   by moving *now* — turning faster than [constant TURN_SPEED] or moving
##   faster than [constant MOVE_SPEED] for [constant MOVE_FOR] s — never by
##   slow drift, and never while the beam hand's trigger is held (a 2 s ⚙
##   hold is not stolen). A thin teal beam with a dot where it lands is drawn.
## - **Desktop**: the camera's ray through the mouse (never captured in the
##   lobby — [member VrPlayer.capture_mouse]; captured, as in the intro's
##   tutorial, through the middle of the view); the left button is the
##   press. No beam.
## - **A / X** presses as the trigger does (wave 33).
##
## [method poll] reads one frame; the lobby says what the ray hit and
## [method draw] shows it. Tests [method inject] a ray instead of devices.
## The house's only use of it is a talker's option panel (wave 49, [TalkPanel]):
## the beam is up only while one is open.
class_name LobbyPointer
extends Node3D

## The beam's length when it hits nothing (m), its width, the dot's size.
const BEAM_LENGTH := 3.0
const BEAM_WIDTH := 0.006
const DOT_SIZE := 0.03
## The idle hand takes the beam when its aim turns faster than this (deg/s)
## or moves faster than this (m/s), for [constant MOVE_FOR] s on end.
const TURN_SPEED := 30.0
const MOVE_SPEED := 0.15
const MOVE_FOR := 0.15
## The trigger counts as down past this, up again under [constant TRIGGER_OFF].
const TRIGGER_ON := 0.8
const TRIGGER_OFF := 0.4
## The beam and its dot: over a [TalkPanel], under the HUD and the captions.
const DRAW_ON_TOP := 49

## The rig whose hands / camera point (set by [Game]).
var player: VrPlayer
## The hand holding the beam: "right" or "left" (a headset), "mouse".
var hand := "right"

var _aims := {}
## Each hand's aim on the last frame.
var _last := {}
## How long (s) the idle hand has been moving on end.
var _moving := {}
var _last_ms := -1.0
## Milliseconds now; tests inject a fake.
var clock: Callable = func() -> float: return float(Time.get_ticks_msec())
var _down := {"left": false, "right": false, "mouse": false}
var _injected: Dictionary = {}
var _beam: MeshInstance3D
var _dot: MeshInstance3D


func _ready() -> void:
	_beam = MeshInstance3D.new()
	_beam.name = "Beam"
	var box := BoxMesh.new()
	box.size = Vector3.ONE
	_beam.mesh = box
	# Wave 59: over the talkers' panel, which draws over the walls ([TalkPanel]).
	_beam.material_override = Hud._overlay(Color("#3df2e8"), null, DRAW_ON_TOP)
	_beam.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beam.top_level = true
	_beam.visible = false
	add_child(_beam)
	_dot = MeshInstance3D.new()
	_dot.name = "Dot"
	var sphere := SphereMesh.new()
	sphere.radius = DOT_SIZE / 2.0
	sphere.height = DOT_SIZE
	_dot.mesh = sphere
	_dot.material_override = Hud._overlay(HouseLook.GOLD, null, DRAW_ON_TOP)
	_dot.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_dot.top_level = true
	_dot.visible = false
	add_child(_dot)
	if player != null:
		_add_aims()


func _add_aims() -> void:
	for h: String in ["left", "right"]:
		var aim := XRController3D.new()
		aim.name = "Aim_" + h
		aim.tracker = &"left_hand" if h == "left" else &"right_hand"
		aim.pose = &"aim"
		player.origin.add_child(aim)
		_aims[h] = aim


## Tests: point along (`origin`, `dir`) with the press `down`, until
## [method clear_injection].
func inject(origin: Vector3, dir: Vector3, down := false) -> void:
	_injected = {"origin": origin, "dir": dir, "down": down}


func clear_injection() -> void:
	_injected = {}


## Whether a hand that went from `prev` to `now` in `dt` s is moving now
## (faster than [constant MOVE_SPEED] m/s or [constant TURN_SPEED] deg/s).
static func moving(prev: Transform3D, now: Transform3D, dt: float) -> bool:
	if dt <= 0.0:
		return false
	if prev.origin.distance_to(now.origin) / dt > MOVE_SPEED:
		return true
	var a := -prev.basis.z.normalized()
	var b := -now.basis.z.normalized()
	return rad_to_deg(a.angle_to(b)) / dt > TURN_SPEED


## Whether the idle hand takes the beam: a fresh pull of its trigger, or
## moving for [constant MOVE_FOR] s — never while the beam hand's trigger is down.
static func takes_beam(pulled: bool, moving_for: float, beam_down: bool) -> bool:
	if beam_down:
		return false
	return pulled or moving_for >= MOVE_FOR


## A trigger with hysteresis: down past [constant TRIGGER_ON], up under
## [constant TRIGGER_OFF] (a click counts as fully pulled).
static func trigger_down(was: bool, value: float, click: bool) -> bool:
	if click:
		return true
	return value > (TRIGGER_OFF if was else TRIGGER_ON)


## One frame: `{active, origin, dir, down, pressed, released, source}`
## (`active` false: nothing points — a test with no injection, a hidden
## mouse, no hand tracked).
func poll() -> Dictionary:
	if not _injected.is_empty():
		return _state("test", _injected["origin"], _injected["dir"], _injected["down"])
	if player == null or not player.read_input:
		return {"active": false, "pressed": false, "released": false, "down": false}
	if player.xr_active:
		return _poll_hands()
	return _poll_mouse()


func _state(source: String, origin: Vector3, dir: Vector3, down: bool) -> Dictionary:
	var was: bool = _down.get(source, false)
	_down[source] = down
	return {"active": true, "origin": origin, "dir": dir.normalized(), "down": down,
		"pressed": down and not was, "released": was and not down, "source": source}


func _aim_of(h: String) -> Transform3D:
	var aim := _aims.get(h) as XRController3D
	if aim != null and aim.get_has_tracking_data():
		return aim.global_transform
	return (player.left_hand if h == "left" else player.right_hand).global_transform


func _poll_hands() -> Dictionary:
	var downs := {}
	var ms := float(clock.call())
	var dt := clampf((ms - _last_ms) / 1000.0, 0.0, 0.1) if _last_ms >= 0.0 else 0.0
	_last_ms = ms
	var beam_down: bool = _down.get(hand, false)
	for h: String in ["left", "right"]:
		var c: XRController3D = player.left_hand if h == "left" else player.right_hand
		# A (X) presses too (wave 33: the tutorial says "the trigger", but a
		# first-timer's thumb finds A as often).
		downs[h] = trigger_down(_down[h], c.get_float("trigger"), c.is_button_pressed("trigger_click") or c.is_button_pressed("ax_button"))
		var now := _aim_of(h)
		var prev: Transform3D = _last.get(h, now)
		_last[h] = now
		if h == hand:
			_moving[h] = 0.0
			continue
		_moving[h] = float(_moving.get(h, 0.0)) + dt if moving(prev, now, dt) else 0.0
		if takes_beam(downs[h] and not _down[h], float(_moving[h]), beam_down):
			hand = h
			_moving.clear()
	for h: String in ["left", "right"]:
		if h != hand:
			_down[h] = downs[h]
	var t := _aim_of(hand)
	return _state(hand, t.origin, -t.basis.z, downs[hand])


func _poll_mouse() -> Dictionary:
	hand = "mouse"
	var vp := get_viewport()
	var cam := vp.get_camera_3d() if vp != null else null
	if cam == null:
		return {"active": false, "pressed": false, "released": false, "down": false}
	# A captured mouse (the intro's tutorial, which also looks around) points
	# through the middle of the view.
	var m := vp.get_visible_rect().size / 2.0 if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED else vp.get_mouse_position()
	return _state("mouse", cam.project_ray_origin(m), cam.project_ray_normal(m), Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))


## Show the beam for `state` ([method poll]) ending at `hit` (`{at}` —
## where it landed — or `{}`): a headset only; the desktop has its cursor.
func draw(state: Dictionary, hit: Dictionary) -> void:
	var show: bool = state.get("active", false) == true and player != null and player.xr_active
	_beam.visible = show
	_dot.visible = show and hit.has("at")
	if not show:
		# A captured mouse has no cursor: the dot alone shows where it points.
		if state.get("active", false) == true and state.get("source") == "mouse" and hit.has("at") and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
			_dot.visible = true
			_dot.global_position = hit["at"]
		return
	var o: Vector3 = state["origin"]
	var d: Vector3 = state["dir"]
	var end: Vector3 = hit["at"] if hit.has("at") else o + d * BEAM_LENGTH
	var length := maxf(o.distance_to(end), 0.01)
	var up := Vector3.UP if absf(d.dot(Vector3.UP)) < 0.99 else Vector3.FORWARD
	var basis := Basis.looking_at(d, up)
	basis.x *= BEAM_WIDTH
	basis.y *= BEAM_WIDTH
	basis.z *= length
	_beam.global_transform = Transform3D(basis, o + d * (length / 2.0))
	if _dot.visible:
		_dot.global_position = end


## Hide the beam (out of the lobby).
func hide_beam() -> void:
	_beam.visible = false
	_dot.visible = false


func beam_visible() -> bool:
	return _beam.visible
