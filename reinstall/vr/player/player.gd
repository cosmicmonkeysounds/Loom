## The player rig (`docs/loom-reinstall.md` §5): an [XROrigin3D] with the
## headset camera and both controllers, carried by a [CharacterBody3D] that
## collides with the house and stands on its floors and ramps.
##
## - **Left stick** walks where the head looks (dead zone 0.15, 1.8 m/s).
## - **Right stick** snap-turns 45° about the head (re-arm under 0.3), or
##   turns smoothly with [member smooth_turn].
## - **Room scale**: each physics tick the head's horizontal offset from the
##   body is folded into the body with its own slide (so a real step climbs a
##   stair and slides along a wall like a stick step) and taken back out of
##   the origin. Whatever the walls refused is pushed back too (past a few
##   centimetres of slack), so leaning or stepping into a wall slides the
##   world back instead of letting the head through it.
## - A comfort vignette closes in while moving or turning — at once on a
##   snap turn, opening gently after.
##
## Without OpenXR (a Mac, the tests) it is a desktop rig: WASD / ↑↓ walk,
## Q/E / ←→ turn, mouse look (click to capture, Esc to release) — all
## feeding the same sticks, so the game logic can't tell the difference.
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
## the view is pushed back — slack for a slope's slower climb, well short of
## [constant RADIUS] so the head never reaches a wall the body touches.
const MAX_HEAD_GAP := 0.05
## The snap-turn vignette, and how fast the vignette closes / opens (per s).
const SNAP_VIGNETTE := 0.9
const VIGNETTE_CLOSE := 10.0
const VIGNETTE_OPEN := 2.5

## Smooth turning instead of 45° snaps.
@export var smooth_turn := false
## False in the lobby: the sticks drive the picker, not the body.
@export var locomotion_enabled := true

## Whether the rig runs on a headset (set by `main.gd` before play).
var xr_active := false
## The sticks after the dead zone, refreshed every physics tick (the lobby
## picker reads them). Tests write them directly with [member read_input] off.
var left_stick := Vector2.ZERO
var right_stick := Vector2.ZERO
## Read the devices each tick (off in tests that drive the sticks).
var read_input := true

@onready var origin: XROrigin3D = $XROrigin3D
@onready var camera: XRCamera3D = $XROrigin3D/XRCamera3D
@onready var left_hand: XRController3D = $XROrigin3D/LeftHand
@onready var right_hand: XRController3D = $XROrigin3D/RightHand
@onready var vignette: MeshInstance3D = $XROrigin3D/XRCamera3D/Vignette

var _snap := Locomotion.SnapTurn.new()
var _gravity: float = ProjectSettings.get_setting("physics/3d/default_gravity", 9.8)
var _vignette := 0.0
var _turn_flash := 0.0
var _pitch := 0.0


func _ready() -> void:
	floor_max_angle = deg_to_rad(MAX_SLOPE_DEG)
	floor_snap_length = 0.4
	floor_stop_on_slope = true
	floor_constant_speed = true
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
	left_hand.visible = on
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
	global_position = pos
	if xr_active:
		var turn := yaw - head_yaw()
		origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, turn)
		var c := camera.global_position
		origin.global_position -= Vector3(c.x - pos.x, 0.0, c.z - pos.z)
	else:
		origin.transform = Transform3D.IDENTITY
		origin.global_rotation = Vector3(0, deg_to_rad(yaw), 0)
	_snap.armed = false  # a stick held through a teleport must not snap at once


## Turn the rig about the head to face `yaw` (world frame) — the autopilot's
## steering; a player only ever turns with the stick.
func face(yaw: float) -> void:
	origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, HouseFrames.wrap_yaw(yaw - head_yaw()))


# --- the loop ----------------------------------------------------------------


func _physics_process(delta: float) -> void:
	if read_input:
		_read_sticks()
	if xr_active:
		_fold_head()
	var turn := 0.0
	if locomotion_enabled:
		turn = Locomotion.smooth_turn(right_stick.x, delta) if smooth_turn else _snap.update(right_stick.x)
		if turn != 0.0:
			origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, turn)
			if smooth_turn:
				_turn_flash = maxf(_turn_flash, absf(right_stick.x))
			else:
				_turn_flash = 1.0
				_vignette = maxf(_vignette, SNAP_VIGNETTE)  # closed on the frame of the snap
	var walk := Locomotion.head_relative(left_stick, head_yaw()) * Locomotion.WALK_SPEED if locomotion_enabled else Vector3.ZERO
	velocity.x = walk.x
	velocity.z = walk.z
	if is_on_floor():
		velocity.y = 0.0
	else:
		velocity.y -= _gravity * delta
	move_and_slide()
	_update_vignette(delta, Vector2(velocity.x, velocity.z).length())


func _read_sticks() -> void:
	if xr_active:
		left_stick = Locomotion.dead_zone(left_hand.get_vector2("primary"))
		right_stick = Locomotion.dead_zone(right_hand.get_vector2("primary"))
		return
	var k := func(a: Key, b: Key) -> float:
		return 1.0 if Input.is_physical_key_pressed(a) or Input.is_physical_key_pressed(b) else 0.0
	left_stick = Vector2(k.call(KEY_D, KEY_NONE) - k.call(KEY_A, KEY_NONE), k.call(KEY_W, KEY_UP) - k.call(KEY_S, KEY_DOWN)).limit_length(1.0)
	right_stick = Vector2(k.call(KEY_E, KEY_RIGHT) - k.call(KEY_Q, KEY_LEFT), 0.0)


## Room scale: move the body under the head with a slide of its own (floor
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
	target = maxf(target, _turn_flash * SNAP_VIGNETTE)
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
	if event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event is InputEventKey and event.pressed and event.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var m := event as InputEventMouseMotion
		origin.global_transform = Locomotion.rotate_about(origin.global_transform, camera.global_position, -m.relative.x * MOUSE_SENSITIVITY)
		_pitch = clampf(_pitch - m.relative.y * MOUSE_SENSITIVITY, -80.0, 80.0)
		camera.rotation.x = deg_to_rad(_pitch)
