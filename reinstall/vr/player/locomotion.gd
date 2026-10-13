## Thumbstick locomotion maths (`docs/loom-reinstall.md` §5) — pure, so the
## tests pin it: the dead zone, head-relative walking, snap turning with
## its re-arm, smooth turning, and rotating the rig about the head.
##
## Sticks are Godot XR `Vector2`s: `x` right, `y` **up** (forward). Yaw is
## degrees, §1 convention (0 = north / −z, + = turning left).
class_name Locomotion
extends RefCounted

const DEAD_ZONE := 0.15
## Metres per second at full stick.
const WALK_SPEED := 1.8
const SNAP_ANGLE := 45.0
## A snap fires past this deflection…
const SNAP_FIRE := 0.6
## …and re-arms once the stick is back under this.
const SNAP_REARM := 0.3
## Degrees per second at full stick (the `smooth_turn` setting).
const SMOOTH_RATE := 90.0


## Zero inside the dead zone; outside it, rescaled so the edge of the zone is
## 0 and full deflection 1 (no jump at the edge), clamped to the unit disc.
static func dead_zone(v: Vector2, dz := DEAD_ZONE) -> Vector2:
	var l := v.length()
	if l < dz:
		return Vector2.ZERO
	return v / l * minf((l - dz) / (1.0 - dz), 1.0)


## The world velocity direction (unit × deflection, horizontal) for a stick
## when the head looks along `head_yaw`: stick up walks where you look,
## stick right steps to your right.
static func head_relative(stick: Vector2, head_yaw: float) -> Vector3:
	var y := deg_to_rad(head_yaw)
	var fwd := Vector3(-sin(y), 0.0, -cos(y))
	var right := Vector3(cos(y), 0.0, -sin(y))
	return fwd * stick.y + right * stick.x


## Smooth turning: degrees to turn this frame (stick right turns right, so
## the yaw falls).
static func smooth_turn(x: float, delta: float) -> float:
	return -x * SMOOTH_RATE * delta


## `t` rotated about the vertical axis through `pivot` by `deg` — turning
## the rig about the head, so turning never slides the view sideways.
static func rotate_about(t: Transform3D, pivot: Vector3, deg: float) -> Transform3D:
	var r := Basis(Vector3.UP, deg_to_rad(deg))
	return Transform3D(r * t.basis, pivot + r * (t.origin - pivot))


## Snap turning with hysteresis: one 45° step per flick.
class SnapTurn:
	extends RefCounted

	var armed := true

	## Degrees to turn now for the stick's x (0 most frames).
	func update(x: float) -> float:
		if absf(x) < SNAP_REARM:
			armed = true
			return 0.0
		if armed and absf(x) >= SNAP_FIRE:
			armed = false
			return -signf(x) * SNAP_ANGLE
		return 0.0
