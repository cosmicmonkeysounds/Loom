## The indicator trail — "follow the golden arrows" (§3/§5): golden
## chevrons every 0.75 m along [method HouseRoute.route], each pointing along
## its leg, drawn as one [MultiMeshInstance3D] (one draw call however long
## the trail). [Game] refreshes it twice a second.
class_name Trail
extends Node3D

const MAX := 400
## Lift above the floor so chevrons never z-fight it.
const LIFT := 0.04

var _mm: MultiMesh
var _t := 0.0


func _ready() -> void:
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.mesh = chevron_mesh()
	_mm.instance_count = MAX
	_mm.visible_instance_count = 0
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = _mm
	mmi.material_override = HouseLook.glow_gold()
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# Instances span the whole house; never cull the batch.
	mmi.custom_aabb = AABB(Vector3(-1e4, -1e4, -1e4), Vector3(2e4, 2e4, 2e4))
	add_child(mmi)


## A flat "^" pointing −z, 0.36 m wide, both faces.
static func chevron_mesh() -> ArrayMesh:
	var w := 0.18
	var tip := -0.16
	var arm := 0.07
	# Outline of a chevron (tip forward), as a strip of quads.
	var outer_l := Vector3(-w, 0, 0.1)
	var outer_r := Vector3(w, 0, 0.1)
	var tip_o := Vector3(0, 0, tip)
	var tip_i := Vector3(0, 0, tip + arm * 1.6)
	var inner_l := Vector3(-w + arm, 0, 0.1 + arm * 0.4)
	var inner_r := Vector3(w - arm, 0, 0.1 + arm * 0.4)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for tri: Array in [
		[outer_l, tip_o, tip_i], [outer_l, tip_i, inner_l],
		[tip_o, outer_r, inner_r], [tip_o, inner_r, tip_i],
	]:
		for v: Vector3 in tri:
			st.add_vertex(v)
		for i in [2, 1, 0]:
			st.add_vertex(tri[i])
	return st.commit()


## Lay chevrons at world points: `[{pos: Vector3, yaw: float}]` (yaw degrees).
func show_points(points: Array) -> void:
	var n := mini(points.size(), MAX)
	for i in n:
		var p: Dictionary = points[i]
		var t := Transform3D(Basis(Vector3.UP, deg_to_rad(float(p["yaw"]))), (p["pos"] as Vector3) + Vector3(0, LIFT, 0))
		_mm.set_instance_transform(i, t)
	_mm.visible_instance_count = n


func clear() -> void:
	_mm.visible_instance_count = 0


func count() -> int:
	return _mm.visible_instance_count


func _process(delta: float) -> void:
	_t += delta
	position.y = sin(_t * 3.0) * 0.015
