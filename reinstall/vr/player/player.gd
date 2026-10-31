## The player rig (`docs/loom-reinstall.md` §5): an [XROrigin3D] with the
## headset camera and both controllers, carried by a [CharacterBody3D] that
## collides with the house and stands on its floors and ramps.
##
## - **Left stick** walks where the head looks (dead zone 0.15, 1.4 m/s; half
##   that backwards, and 0.6 of it on a stair).
## - **Right stick** turns smoothly about the head (gentle near the centre,
##   at most 50°/s; no snap turn — its jumps made people dizzy). With the
##   left stick idle (the show's headsets have only the right controller),
##   its forward / back walks too, each axis locked out unless the push is
##   a real diagonal ([method Locomotion.axis_lock]).
## - **Every rendered frame** (`_process`): the sticks, the turn, walking,
##   gravity and room scale. On a headset each frame moves by exactly one
##   display interval ([method frame_step]): physics ticks drift against
##   the display (a frame with no tick, then one with two) and the measured
##   frame time is noisy, and either snaps the view while walking or
##   turning. After a [method teleport] the body waits two physics ticks
##   before it moves (a floor built that frame is not in the physics space
##   yet).
## - **Room scale**: each frame the head's horizontal offset from the
##   body is folded into the body with its own slide (so a real step climbs a
##   stair and slides along a wall like a stick step) and taken back out of
##   the origin. Whatever the walls refused is pushed back too (past a few
##   centimetres of slack), so leaning or stepping into a wall slides the
##   world back instead of letting the head through it.
## - A comfort vignette closes in while moving or turning (closing fast,
##   opening gently after).
## - Walking into a wall gives a light buzz ([constant WALL_BUMP_EVERY]), so
##   a first-timer knows why they stopped.
## - **Hit** ([member hit_button]): either trigger, or A / X — the King's
##   hit (the game takes the press, not the hold).
##
## - **Small / big** (wave 49, [method set_eye_scale]): the eye height only;
##   the body's capsule, the poses and the reach stay the real ones.
##
## Without OpenXR (a Mac, the tests) it is a desktop rig: WASD / ↑↓ walk,
## Q/E / ←→ turn, Space / F hit, mouse look (click to capture, Esc to
## release; never in the lobby, where the mouse points — [member
## capture_mouse]) — all feeding the same sticks and button, so the game
## logic can't tell the difference.
class_name VrPlayer
extends CharacterBody3D

## Eye height of the desktop rig (a headset reports its own).
const EYE_HEIGHT := 1.6
const RADIUS := 0.25
const BODY_HEIGHT := 1.5
## Stairs are ~35° ramps.
const MAX_SLOPE_DEG := 45.0
const MOUSE_SENSITIVITY := 0.15
## Room scale: how far the head may stay off the body (horizontally) before
## the view is pushed back: enough that a small lean still moves the view, but
## the eyes stop 17 cm from a wall the body touches.
const MAX_HEAD_GAP := 0.08
## The walk on a stair (a share of [constant Locomotion.WALK_SPEED]): at the full
## pace the eye climbs 0.83 m/s, on a flight under a metre wide.
const STAIR_SPEED := 0.6
## A floor this tilted (the normal's up) is a stair.
const STAIR_NORMAL_Y := 0.95
## How long the view takes to follow the body's height (s): a stair's foot and
## a drop ease instead of kicking. The player's own head is never delayed.
const EYE_EASE := 0.12
## The vignette at full-speed turning (turning is what upsets stomachs
## most), and how fast the vignette closes / opens (per s).
const TURN_VIGNETTE := 0.85
const VIGNETTE_CLOSE := 10.0
const VIGNETTE_OPEN := 2.5
## The longest step (s): a hitch (the first frame after the house loads can
## last a second) must not jump the view round or drop the body through a
## floor.
const MAX_STEP := 1.0 / 30.0
## A headset frame within this share of the display interval counts as
## exactly one interval ([method frame_step]).
const FRAME_SNAP := 0.5
## Frame-timing stats go to the log this often (s) on a headset.
const STATS_EVERY := 10.0
## Walking into a wall buzzes the controllers at most this often (s).
const WALL_BUMP_EVERY := 0.6
## False in the lobby: the sticks drive the picker, not the body.
@export var locomotion_enabled := true

## Whether the rig runs on a headset (set by `main.gd` before play).
var xr_active := false
## The sticks after the dead zone, refreshed every rendered frame (the lobby
## picker reads them). Tests write them directly with [member read_input] off.
var left_stick := Vector2.ZERO
var right_stick := Vector2.ZERO
## The hit button held (a trigger, A / X; Space / F on the desktop rig),
## refreshed with the sticks.
var hit_button := false
## Read the devices each tick (off in tests that drive the sticks).
var read_input := true
## Desktop rig: a click captures the mouse for looking around (off in the
## lobby, where the mouse clicks tiles).
var capture_mouse := true

@onready var origin: XROrigin3D = $XROrigin3D
@onready var camera: XRCamera3D = $XROrigin3D/XRCamera3D
@onready var left_hand: XRController3D = $XROrigin3D/LeftHand
@onready var right_hand: XRController3D = $XROrigin3D/RightHand
@onready var vignette: MeshInstance3D = $XROrigin3D/XRCamera3D/Vignette

var _bump_wait := 0.0
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)
var _vignette := 0.0
var _turn_flash := 0.0
var _pitch := 0.0
## Physics ticks still to wait before the body moves (after a teleport).
var _settle := 0
## The rig's eased height (world y, [constant EYE_EASE]).
var _eye_y := 0.0
## The eye height's scale ([method set_eye_scale]).
var eye_scale := 1.0
var _fall := 0.0
var _ticks := 0
var _stats := {"t": 0.0, "frames": 0, "snapped": 0, "long": 0, "dt_min": 1.0, "dt_max": 0.0, "ticks0": 0, "ticks2": 0}


func _ready() -> void:
	floor_max_angle = deg_to_rad(MAX_SLOPE_DEG)
	floor_snap_length = 0.4
	floor_stop_on_slope = true
	floor_constant_speed = true
	# Sliding from any angle: at the default 15 degrees a body pressed to a wall
	# sticks, then lurches off at the first small turn of the head.
	wall_min_slide_angle = 0.0
	_eye_y = global_position.y
	set_xr(xr_active)


## Switch between the headset rig and the desktop rig.
func set_xr(on: bool) -> void:
	xr_active = on
	if not is_node_ready():
		return
	if not on:
		camera.position = Vector3(0, EYE_HEIGHT, 0)
		camera.rotation = Vector3.ZERO
		_pitch = 0.0
	right_hand.visible = on


# --- queries -----------------------------------------------------------------


## The head's yaw (degrees, world frame).
func head_yaw() -> float:
	return HouseFrames.yaw_of(camera.global_basis)


## The head's pitch (degrees, + = up).
func head_pitch() -> float:
	return HouseFrames.pitch_of(camera.global_basis)


## The feet: the floor point under the body (world frame) — under the head
## once room scale has folded it in, unless a wall held the body back. Never
## the head itself: a head leaning through a wall must not report (or find a
## duck in) the next room.
func feet() -> Vector3:
	return global_position


# --- placement ---------------------------------------------------------------


## Put the feet at `pos` facing `yaw` (world frame), whatever the headset's
## physical offset in the play space.
func teleport(pos: Vector3, yaw: float) -> void:
	velocity = Vector3.ZERO
	_fall = 0.0
	_settle = 2
	global_position = pos
	_eye_y = pos.y
	origin.position.y = 0.0
	if xr_active:
		var turn := yaw - head_yaw()
		origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, turn)
		var c := camera.global_position
		origin.global_position -= Vector3(c.x - pos.x, 0.0, c.z - pos.z)
	else:
		origin.transform = Transform3D.IDENTITY
		origin.global_rotation = Vector3(0, deg_to_rad(yaw), 0)
		# Level again: a pitch kept from play would leave the lobby's panel
		# off screen, with no captured mouse there to look back up.
		_pitch = 0.0
		camera.rotation.x = 0.0


## (wave 49) Scale the eye height (`small` / `big`; 1 is the player's own):
## [member XROrigin3D.world_scale] on a headset, about the head, so the head
## stays where it stands in plan however far it is from the origin; the
## camera's height on the desktop rig. The caller eases it: this moves the
## view, and never sideways.
func set_eye_scale(s: float) -> void:
	if is_equal_approx(s, eye_scale):
		return
	if xr_active:
		var was := camera.position
		var now := was * (s / eye_scale)
		origin.global_position += origin.global_basis * Vector3(was.x - now.x, 0.0, was.z - now.z)
		origin.world_scale = s
	else:
		camera.position.y = EYE_HEIGHT * s
	eye_scale = s


## A haptic pulse on both controllers (`amplitude` 0 … 1, `seconds`) —
## nothing on the desktop rig. Counted in [member pulses] for the tests.
func pulse(amplitude: float, seconds: float) -> void:
	pulses += 1
	if not xr_active:
		return
	for hand: XRController3D in [left_hand, right_hand]:
		hand.trigger_haptic_pulse("haptic", 0.0, clampf(amplitude, 0.0, 1.0), seconds, 0.0)


## How many haptic pulses were asked for ([method pulse]).
var pulses := 0
## How many wall bumps buzzed (for the tests).
var wall_bumps := 0


## Turn the rig about the head to face `yaw` (world frame) — the autopilot's
## steering; a player only ever turns with the stick.
func face(yaw: float) -> void:
	origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, HouseFrames.wrap_yaw(yaw - head_yaw()))


# --- the loop ----------------------------------------------------------------


## Every rendered frame: the sticks, the turn, room scale, walking, gravity
## and the vignette.
func _process(frame: float) -> void:
	var delta := frame_step(frame)
	if xr_active:
		_count(frame)
	if read_input:
		_read_sticks()
	if delta <= 0.0:
		return
	if locomotion_enabled:
		var turn := Locomotion.smooth_turn(right_stick.x, delta)
		if turn != 0.0:
			origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, turn)
			_turn_flash = maxf(_turn_flash, absf(turn) / (Locomotion.TURN_RATE * delta))
	var pace := Locomotion.WALK_SPEED * (STAIR_SPEED if on_stair() else 1.0)
	var walk := Locomotion.head_relative(Locomotion.gait(left_stick), head_yaw()) * pace if locomotion_enabled else Vector3.ZERO
	if _settle == 0:
		if xr_active:
			_fold_head()
		_walk(walk, delta)
		_wall_bump(delta, Vector2(walk.x, walk.z).length())
		if xr_active:
			_ease_eye(delta)
	_update_vignette(delta, Vector2(walk.x, walk.z).length())


## Whether the body stands on a stair.
func on_stair() -> bool:
	return is_on_floor() and get_floor_normal().y < STAIR_NORMAL_Y


## The rig follows the body's height a little behind ([constant EYE_EASE]).
func _ease_eye(delta: float) -> void:
	_eye_y += (global_position.y - _eye_y) * (1.0 - exp(-delta / EYE_EASE))
	origin.position.y = _eye_y - global_position.y


## The walk and gravity over `delta`. move_and_slide moves velocity × the
## engine's own frame time, so the velocity is scaled to cover `delta`.
func _walk(walk: Vector3, delta: float) -> void:
	var engine_dt := get_physics_process_delta_time() if Engine.is_in_physics_frame() else get_process_delta_time()
	var k := delta / engine_dt if engine_dt > 0.0 else 1.0
	if is_on_floor():
		_fall = 0.0
	else:
		_fall -= _gravity * delta
	velocity = Vector3(walk.x, _fall, walk.z) * k
	move_and_slide()
	velocity /= k


## Physics ticks: only the wait after a teleport, and the stats' count.
func _physics_process(_delta: float) -> void:
	_ticks += 1
	_settle = maxi(_settle - 1, 0)


## How far (s) this frame moves the rig: the frame's time, but at most
## [constant MAX_STEP], and on a headset exactly one display interval when
## it is near one (the compositor shows frames one interval apart; the
## measured time only adds noise).
func frame_step(frame: float) -> float:
	var step_s := minf(frame, MAX_STEP)
	if xr_active and Engine.physics_ticks_per_second > 0:
		var interval := 1.0 / Engine.physics_ticks_per_second
		if absf(frame - interval) < interval * FRAME_SNAP:
			return interval
	return step_s


## One tick and one frame of `delta` (the tests' and the autopilot's clock).
func step(delta: float) -> void:
	_physics_process(delta)
	_process(delta)


## Frame-timing stats for the log: frames, their time range, how many were
## snapped to the interval or ran long, and frames with 0 or 2+ physics ticks.
func _count(frame: float) -> void:
	var s := _stats
	s["t"] += frame
	s["frames"] += 1
	s["dt_min"] = minf(s["dt_min"], frame)
	s["dt_max"] = maxf(s["dt_max"], frame)
	var interval := 1.0 / maxi(Engine.physics_ticks_per_second, 1)
	if absf(frame - interval) < interval * FRAME_SNAP:
		s["snapped"] += 1
	else:
		s["long"] += 1
	if _ticks == 0:
		s["ticks0"] += 1
	elif _ticks >= 2:
		s["ticks2"] += 1
	_ticks = 0
	if s["t"] < STATS_EVERY:
		return
	print("reinstall-vr: frames %d in %.1f s (%.1f–%.1f ms; %d on the interval, %d long), physics %d Hz: %d frames without a tick, %d with 2+" % [s["frames"], s["t"], s["dt_min"] * 1000.0, s["dt_max"] * 1000.0, s["snapped"], s["long"], Engine.physics_ticks_per_second, s["ticks0"], s["ticks2"]])
	_stats = {"t": 0.0, "frames": 0, "snapped": 0, "long": 0, "dt_min": 1.0, "dt_max": 0.0, "ticks0": 0, "ticks2": 0}


## A light buzz when a walk is held up by a wall (not on every frame of it).
func _wall_bump(delta: float, wanted: float) -> void:
	_bump_wait = maxf(0.0, _bump_wait - delta)
	if wanted < 0.3 * Locomotion.WALK_SPEED or not is_on_wall():
		return
	var real := get_real_velocity()
	if Vector2(real.x, real.z).length() > 0.5 * wanted or _bump_wait > 0.0:
		return
	_bump_wait = WALL_BUMP_EVERY
	wall_bumps += 1
	pulse(0.12, 0.03)


func _read_sticks() -> void:
	if xr_active:
		left_stick = Locomotion.dead_zone(left_hand.get_vector2("primary"))
		right_stick = Locomotion.axis_lock(Locomotion.dead_zone(right_hand.get_vector2("primary")), right_stick)
		# One controller: with the left stick idle (or no left controller),
		# the right stick's forward / back walks while its sideways turns.
		if left_stick == Vector2.ZERO:
			left_stick = Vector2(0.0, right_stick.y)
		hit_button = false
		for hand: XRController3D in [right_hand, left_hand]:
			if hand.is_button_pressed("trigger_click") or hand.is_button_pressed("ax_button") or hand.get_float("trigger") > 0.8:
				hit_button = true
		return
	var k := func(a: Key, b: Key) -> float:
		return 1.0 if Input.is_physical_key_pressed(a) or Input.is_physical_key_pressed(b) else 0.0
	left_stick = Vector2(k.call(KEY_D, KEY_NONE) - k.call(KEY_A, KEY_NONE), k.call(KEY_W, KEY_UP) - k.call(KEY_S, KEY_DOWN)).limit_length(1.0)
	right_stick = Vector2(k.call(KEY_E, KEY_RIGHT) - k.call(KEY_Q, KEY_LEFT), 0.0)
	hit_button = k.call(KEY_SPACE, KEY_F) > 0.0


## Room scale (each frame): move the body under the head with a slide of its own (floor
## snap, slopes and walls all apply — `move_and_collide` would stop dead at
## the foot of a stair), take the horizontal part of that move back out of
## the origin (the climb stays, so the head rises with the body), then push
## back whatever the walls refused beyond [constant MAX_HEAD_GAP].
func _fold_head() -> void:
	var c := camera.global_position
	var d := Vector3(c.x - global_position.x, 0.0, c.z - global_position.z)
	if d.length_squared() < 1e-6:
		return
	# move_and_slide moves velocity × the engine's own delta (physics or idle).
	var dt := get_physics_process_delta_time() if Engine.is_in_physics_frame() else get_process_delta_time()
	if dt <= 0.0:
		return
	var before := global_position
	var keep := velocity
	velocity = d / dt
	move_and_slide()
	velocity = keep
	var moved := global_position - before
	origin.global_position -= Vector3(moved.x, 0.0, moved.z)
	var g := camera.global_position - global_position
	var gap := Vector3(g.x, 0.0, g.z)
	if gap.length() > MAX_HEAD_GAP:
		origin.global_position -= gap - gap.normalized() * MAX_HEAD_GAP


## The head's horizontal distance from the body (m) — room scale's slack.
func head_gap() -> float:
	var g := camera.global_position - global_position
	return Vector2(g.x, g.z).length()


func _update_vignette(delta: float, speed: float) -> void:
	_turn_flash = move_toward(_turn_flash, 0.0, delta * 4.0)
	var target := clampf(speed / Locomotion.WALK_SPEED, 0.0, 1.0) * 0.75
	target = maxf(target, _turn_flash * TURN_VIGNETTE)
	# Close fast (it must be there while the view moves), open gently.
	_vignette = move_toward(_vignette, target, delta * (VIGNETTE_CLOSE if target > _vignette else VIGNETTE_OPEN))
	vignette.visible = _vignette > 0.01
	(vignette.material_override as ShaderMaterial).set_shader_parameter("strength", _vignette)


func vignette_strength() -> float:
	return _vignette


# --- desktop mouse -------------------------------------------------------------


func _unhandled_input(event: InputEvent) -> void:
	if xr_active:
		return
	if event is InputEventMouseButton and event.pressed and capture_mouse and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var m := event as InputEventMouseMotion
		origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, -m.relative.x * MOUSE_SENSITIVITY)
		_pitch = clampf(_pitch - m.relative.y * MOUSE_SENSITIVITY, -80.0, 80.0)
		camera.rotation.x = deg_to_rad(_pitch)


## The lobby: stop capturing clicks, and let go of a captured mouse.
func release_mouse() -> void:
	capture_mouse = false
	if not xr_active and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
