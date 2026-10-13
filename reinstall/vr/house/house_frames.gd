## House ⇄ space transforms — `docs/loom-reinstall.md` §1 "Spaces", a port
## of `house/src/frames.ts`, plus the [Vector3] ⇄ `[x, y, z]` bridges and
## Godot-side helpers (a [Transform3D] for a space, yaw / pitch of a basis).
##
## `world = Ry(yaw) · (scale · house) + offset`. Every pose on the wire is
## in house coordinates; the game converts with `spaces.vr` before sending
## and after receiving. A missing transform is the identity.
class_name HouseFrames
extends RefCounted

const IDENTITY := {"offset": [0.0, 0.0, 0.0], "yaw": 0.0, "scale": 1.0}


## The named space of a house (`"vr"`), identity when missing; a partial
## one is completed.
static func space_of(house: Dictionary, name: String) -> Dictionary:
	var spaces: Variant = house.get("spaces")
	if not spaces is Dictionary or not (spaces as Dictionary).has(name):
		return IDENTITY.duplicate(true)
	var s: Dictionary = spaces[name]
	return {
		"offset": (s["offset"] as Array).duplicate() if s.get("offset") is Array else [0.0, 0.0, 0.0],
		"yaw": float(s["yaw"]) if s.get("yaw") != null else 0.0,
		"scale": float(s["scale"]) if s.get("scale") != null else 1.0,
	}


## Wrap degrees into [−180, 180).
static func wrap_yaw(yaw: float) -> float:
	return fposmod(yaw + 180.0, 360.0) - 180.0


## Rotate a point about +y by `deg` (counter-clockwise seen from above).
static func _rotate_y(p: Array, deg: float) -> Array:
	var r := deg_to_rad(deg)
	var c := cos(r)
	var s := sin(r)
	return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]


static func _t(t: Variant) -> Dictionary:
	return t if t is Dictionary else IDENTITY


## House → space.
static func to_space(t: Variant, p: Array) -> Array:
	var s := _t(t)
	var k: float = s["scale"]
	var r := _rotate_y([p[0] * k, p[1] * k, p[2] * k], s["yaw"])
	var o: Array = s["offset"]
	return [r[0] + o[0], r[1] + o[1], r[2] + o[2]]


## Space → house.
static func from_space(t: Variant, p: Array) -> Array:
	var s := _t(t)
	var o: Array = s["offset"]
	var r := _rotate_y([p[0] - o[0], p[1] - o[1], p[2] - o[2]], -float(s["yaw"]))
	var k: float = s["scale"]
	return [r[0] / k, r[1] / k, r[2] / k]


## A house yaw in the space.
static func yaw_to_space(t: Variant, yaw: float) -> float:
	return wrap_yaw(yaw + float(_t(t)["yaw"]))


## A space yaw in the house.
static func yaw_from_space(t: Variant, yaw: float) -> float:
	return wrap_yaw(yaw - float(_t(t)["yaw"]))


## The unit forward vector (house frame) of a yaw / pitch, degrees; pitch > 0 looks up.
static func forward(yaw: float, pitch := 0.0) -> Array:
	var y := deg_to_rad(yaw)
	var p := deg_to_rad(pitch)
	return [-sin(y) * cos(p), sin(p), -cos(y) * cos(p)]


# --- Godot bridges -----------------------------------------------------------


static func vec(p: Array) -> Vector3:
	return Vector3(p[0], p[1], p[2])


static func arr(v: Vector3) -> Array:
	return [float(v.x), float(v.y), float(v.z)]


## The space transform as a node [Transform3D] (house-frame children land in
## the space).
static func transform_of(t: Variant) -> Transform3D:
	var s := _t(t)
	var basis := Basis(Vector3.UP, deg_to_rad(float(s["yaw"]))).scaled(Vector3.ONE * float(s["scale"]))
	return Transform3D(basis, vec(s["offset"]))


## The §1 yaw (degrees) of a basis whose forward is −z.
static func yaw_of(basis: Basis) -> float:
	var z := basis.z
	return rad_to_deg(atan2(z.x, z.z))


## The pitch (degrees, + = up) of a basis whose forward is −z.
static func pitch_of(basis: Basis) -> float:
	var fwd := -basis.z.normalized()
	return rad_to_deg(asin(clampf(fwd.y, -1.0, 1.0)))
