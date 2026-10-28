## Thumbstick locomotion maths (`docs/loom-reinstall.md` §5) — pure, so the
## tests pin it: the dead zone, the one stick's axis lock, head-relative
## walking, smooth turning, and rotating the rig about the head.
##
## Comfort first: most players have never worn a headset. Turning is always
## smooth (a snap turn's jump made people dizzy), gentle near the stick's
## centre, and never faster than [constant TURN_RATE]; walking is an easy
## pace ([constant WALK_SPEED]) that starts and stops at once (no
## acceleration to feel in the stomach).
##
## Sticks are Godot XR `Vector2`s: `x` right, `y` **up** (forward). Yaw is
## degrees, §1 convention (0 = north / −z, + = turning left).
class_name Locomotion
extends RefCounted

const DEAD_ZONE := 0.15
## Metres per second at full stick: a calm walking pace.
const WALK_SPEED := 1.4
## Degrees per second at full stick.
const TURN_RATE := 70.0
## Turning's response curve: `|x|^TURN_CURVE`, so a small push turns slowly.
const TURN_CURVE := 1.6
## The one stick (walk + turn, wave 33b): the weaker axis counts only past
## this share of the stronger one, so a slightly crooked push forward walks
## straight and a crooked turn doesn't creep.
const AXIS_LOCK := 0.5


## Zero inside the dead zone; outside it, rescaled so the edge of the zone is
## 0 and full deflection 1 (no jump at the edge), clamped to the unit disc.
static func dead_zone(v: Vector2, dz := DEAD_ZONE) -> Vector2:
	var l := v.length()
	if l < dz:
		return Vector2.ZERO
	return v / l * minf((l - dz) / (1.0 - dz), 1.0)


## A stick that both walks (y) and turns (x): the weaker axis is dropped
## unless it is at least [constant AXIS_LOCK] of the stronger (a deliberate
## diagonal still walks and turns).
static func axis_lock(v: Vector2) -> Vector2:
	var ax := absf(v.x)
	var ay := absf(v.y)
	if ax < ay * AXIS_LOCK:
		return Vector2(0.0, v.y)
	if ay < ax * AXIS_LOCK:
		return Vector2(v.x, 0.0)
	return v


## The world velocity direction (unit × deflection, horizontal) for a stick
## when the head looks along `head_yaw`: stick up walks where you look,
## stick right steps to your right.
static func head_relative(stick: Vector2, head_yaw: float) -> Vector3:
	var y := deg_to_rad(head_yaw)
	var fwd := Vector3(-sin(y), 0.0, -cos(y))
	var right := Vector3(cos(y), 0.0, -sin(y))
	return fwd * stick.y + right * stick.x


## Turning: degrees to turn this frame (stick right turns right, so the yaw
## falls), along the response curve.
static func smooth_turn(x: float, delta: float) -> float:
	return -signf(x) * pow(minf(absf(x), 1.0), TURN_CURVE) * TURN_RATE * delta


## `t` rotated about the vertical axis through `pivot` by `deg` — turning
## the rig about the head, so turning never slides the view sideways.
static func rotate_about(t: Transform3D, pivot: Vector3, deg: float) -> Transform3D:
	var r := Basis(Vector3.UP, deg_to_rad(deg))
	return Transform3D(r * t.basis, pivot + r * (t.origin - pivot))
