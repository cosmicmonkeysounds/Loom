## The Hallway (wave 49, C2): the `door` vision's pocket off the map, built once
## like [IntroSpace], with a real floor and walls of its own: a dark corridor
## [constant HouseDescent.HALLWAY_WIDTH_M] × [constant HouseDescent.HALLWAY_HEIGHT_M],
## one light that moves with the player, and a far door
## [constant HouseDescent.HALLWAY_FAR_M] ahead. For
## [constant HouseDescent.HALLWAY_RETREAT_S] the far door backs away at
## [constant HouseDescent.HALLWAY_RETREAT] × the player's pace, then it stays
## and can be reached. The player's camera is never moved: the door is.
##
## This node knows only the pocket. [Game] does the rest, in the shape of
## `_tick_escape`: while [method active], `_tick_play` returns early, poses
## still go out from the door the player came in by, and the void, the heart,
## the pickups, the King and the find are off. [method tick] says when it is
## over: the far door, [constant HouseDescent.HALLWAY_MAX_S], or a fall (it
## never should). Nobody stays in here.
class_name Hallway
extends Node3D

## Where the corridor starts (world): the player's feet on the way in, looking
## along −z. Clear of the lobby and the intro.
const SPOT := Vector3(0, 400, -80)
## The corridor's length: past anywhere the far door can back away to.
const LENGTH := 60.0
## Its walls come in lengths of this, so they light per vertex on `low`.
const SEGMENT := 2.0
const THICK := 0.2
## The light: over the player's head, a little ahead of them.
const LIGHT_AT := Vector3(0, 2.0, -0.6)
const LIGHT_ENERGY := 0.7
const LIGHT_RANGE := 5.5
## How far the far door may back away, and how far under the floor is a fall (m).
const FAR_LIMIT := 56.0
const FELL_BELOW := 3.0
## When the `far` line comes, of the door's retreat.
const FAR_LINE_AT := 0.5

var _built := false
var _inside := false
var _t := 0.0
var _far := 0.0
var _best := 0.0
var _far_said := false
var _door: Node3D
var _light: OmniLight3D


## Make the corridor (once). Its colliders stay in the physics space, far from
## everything, so the body lands on them the moment it is put here.
func build() -> void:
	if _built:
		return
	_built = true
	position = SPOT
	var w := HouseDescent.HALLWAY_WIDTH_M
	var h := HouseDescent.HALLWAY_HEIGHT_M
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := ceili(LENGTH / SEGMENT)
	for i in n + 1:
		var z := 1.0 - SEGMENT * (i + 0.5)
		for box: Array in [
			[Vector3(0, -THICK / 2.0, z), Vector3(w + 2.0 * THICK, THICK, SEGMENT)],
			[Vector3(0, h + THICK / 2.0, z), Vector3(w + 2.0 * THICK, THICK, SEGMENT)],
			[Vector3(-(w + THICK) / 2.0, h / 2.0, z), Vector3(THICK, h, SEGMENT)],
			[Vector3((w + THICK) / 2.0, h / 2.0, z), Vector3(THICK, h, SEGMENT)],
		]:
			HouseBuilder.add_box(st, Transform3D.IDENTITY, box[0], box[1], Color.WHITE)
	var far_z := 1.0 - SEGMENT * (n + 1)
	HouseBuilder.add_box(st, Transform3D.IDENTITY, Vector3(0, h / 2.0, 1.0 + THICK / 2.0), Vector3(w, h, THICK), Color.WHITE)
	HouseBuilder.add_box(st, Transform3D.IDENTITY, Vector3(0, h / 2.0, far_z - THICK / 2.0), Vector3(w, h, THICK), Color.WHITE)
	var mesh := MeshInstance3D.new()
	mesh.name = "Corridor"
	mesh.mesh = st.commit()
	mesh.material_override = HouseLook.hallway()
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mesh)
	var body := StaticBody3D.new()
	body.name = "Colliders"
	add_child(body)
	var mid := (1.0 + far_z) / 2.0
	var length := 1.0 - far_z
	for box: Array in [
		[Vector3(0, -THICK / 2.0, mid), Vector3(w + 2.0, THICK, length + 2.0)],
		[Vector3(-(w + 1.0) / 2.0, h / 2.0, mid), Vector3(1.0, h + 2.0, length + 2.0)],
		[Vector3((w + 1.0) / 2.0, h / 2.0, mid), Vector3(1.0, h + 2.0, length + 2.0)],
		[Vector3(0, h / 2.0, 1.0 + 0.5), Vector3(w, h + 2.0, 1.0)],
		[Vector3(0, h / 2.0, far_z - 0.5), Vector3(w, h + 2.0, 1.0)],
	]:
		var shape := BoxShape3D.new()
		shape.size = box[1]
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.position = box[0]
		body.add_child(cs)
	var door := Descent.make_door()
	_door = door["node"]
	_door.name = "FarDoor"
	_door.rotation.y = PI  # the model's front is −z; this one faces back at them
	add_child(_door)
	_light = OmniLight3D.new()
	_light.name = "Light"
	_light.shadow_enabled = false
	_light.light_specular = 0.0
	_light.light_color = Color("#dfe4ff")
	_light.light_energy = LIGHT_ENERGY
	_light.omni_range = LIGHT_RANGE
	add_child(_light)
	visible = false


## Whether the player is in here.
func active() -> bool:
	return _inside


## Open it: returns where the player's feet go (world), looking along −z.
func enter() -> Vector3:
	build()
	_inside = true
	_t = 0.0
	_far = HouseDescent.HALLWAY_FAR_M
	_best = 0.0
	_far_said = false
	_door.position = Vector3(0, 0, -_far)
	_light.position = LIGHT_AT
	visible = true
	return SPOT


## Close it.
func leave() -> void:
	_inside = false
	visible = false


## One frame with the feet at `feet` (world): "" (go on), "far" (time for the
## `far` line, once) or "done" (out: the far door, the time limit, a fall).
func tick(delta: float, feet: Vector3) -> String:
	if not _inside:
		return ""
	_t += delta
	var walked := SPOT.z - feet.z
	if walked > _best:
		if _t < HouseDescent.HALLWAY_RETREAT_S:
			_far = minf(_far + (walked - _best) * HouseDescent.HALLWAY_RETREAT, FAR_LIMIT)
		_best = walked
	_door.position.z = -_far
	_light.position = (feet - SPOT) + LIGHT_AT
	if _t >= HouseDescent.HALLWAY_MAX_S or walked >= _far - HouseDescent.HALLWAY_DOOR_M or feet.y < SPOT.y - FELL_BELOW:
		return "done"
	if not _far_said and _t >= HouseDescent.HALLWAY_RETREAT_S * FAR_LINE_AT:
		_far_said = true
		return "far"
	return ""


## How far away (from where they came in, m) the far door stands now.
func far_distance() -> float:
	return _far
