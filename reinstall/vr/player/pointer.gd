## The lobby's pointer (`docs/loom-reinstall.md` §5): a laser from a
## controller's aim pose on a headset, the mouse on the desktop rig.
##
## - **Headset**: each hand's aim pose (an [XRController3D] on the `aim`
##   pose, the hand's own transform until it tracks) casts a ray; the
##   trigger (click, or pulled past [constant TRIGGER_ON]) is the press.
##   One hand holds the beam — whichever last moved its aim past
##   [constant TURN_DEG] / [constant MOVE_M] or pulled its trigger. A thin
##   teal beam with a dot where it lands is drawn.
## - **Desktop**: the camera's ray through the mouse (never captured in the
##   lobby — [member VrPlayer.capture_mouse]); the left button is the press.
##   No beam.
##
## [method poll] reads one frame; the lobby says what the ray hit and
## [method draw] shows it. Tests [method inject] a ray instead of devices.
class_name LobbyPointer
extends Node3D

## The beam's length when it hits nothing (m), its width, the dot's size.
const BEAM_LENGTH := 3.0
const BEAM_WIDTH := 0.006
const DOT_SIZE := 0.03
## A hand whose aim turns this far (deg) or moves this far (m) from where it
## rested takes the beam.
const TURN_DEG := 4.0
const MOVE_M := 0.03
## The trigger counts as down past this, up again under [constant TRIGGER_OFF].
const TRIGGER_ON := 0.8
const TRIGGER_OFF := 0.4

## The rig whose hands / camera point (set by [Game]).
var player: VrPlayer
## The hand holding the beam: "right" or "left" (a headset), "mouse".
var hand := "right"

var _aims := {}
var _rest := {}
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
	_beam.material_override = HouseLook.screen("#3df2e8")
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
	_dot.material_override = HouseLook.glow_gold()
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


## Whether the hand at `now` has moved away from `rest` enough to take
## the beam ([constant TURN_DEG], [constant MOVE_M]).
static func takes_beam(rest: Transform3D, now: Transform3D) -> bool:
	if rest.origin.distance_to(now.origin) > MOVE_M:
		return true
	var a := -rest.basis.z.normalized()
	var b := -now.basis.z.normalized()
	return rad_to_deg(a.angle_to(b)) > TURN_DEG


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
	for h: String in ["left", "right"]:
		var c: XRController3D = player.left_hand if h == "left" else player.right_hand
		downs[h] = trigger_down(_down[h], c.get_float("trigger"), c.is_button_pressed("trigger_click"))
		var now := _aim_of(h)
		if not _rest.has(h):
			_rest[h] = now
		# The other hand takes the beam by pulling its trigger or by moving.
		if h != hand and ((downs[h] and not _down[h]) or takes_beam(_rest[h], now)):
			hand = h
			_rest.clear()
			_rest[h] = now
	for h: String in ["left", "right"]:
		if h != hand:
			_down[h] = downs[h]
	var t := _aim_of(hand)
	return _state(hand, t.origin, -t.basis.z, downs[hand])


func _poll_mouse() -> Dictionary:
	hand = "mouse"
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		return {"active": false, "pressed": false, "released": false, "down": false}
	var vp := get_viewport()
	var cam := vp.get_camera_3d() if vp != null else null
	if cam == null:
		return {"active": false, "pressed": false, "released": false, "down": false}
	var m := vp.get_mouse_position()
	return _state("mouse", cam.project_ray_origin(m), cam.project_ray_normal(m), Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))


## Show the beam for `state` ([method poll]) ending at `hit` (`{at}` —
## where it landed — or `{}`): a headset only; the desktop has its cursor.
func draw(state: Dictionary, hit: Dictionary) -> void:
	var show: bool = state.get("active", false) == true and player != null and player.xr_active
	_beam.visible = show
	_dot.visible = show and hit.has("at")
	if not show:
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
