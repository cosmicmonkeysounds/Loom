## Gerald, gilded — the golden duck (`docs/loom-reinstall.md` §5). A
## low-poly duck from primitives (no imported model), bobbing and turning
## slowly on its spot with a warm light, and quacking from where he sits
## ([member emitter], wave 26). On [method celebrate] it lays a golden egg
## and flies away.
class_name Duck
extends Node3D

## Plan distance at which the player has found it (the server allows 2.0).
const FIND_RADIUS := 0.9
const FLIGHT := 2.6

## Where Gerald's quack comes from ([method Sfx.quack_at]): on him, panned
## by where he is, at the volume the schedule says (no distance roll-off —
## [method Sfx.quack_plan] already says how close he is).
var emitter: AudioStreamPlayer3D
var _model: Node3D
var _egg: MeshInstance3D
var _t := 0.0
var _flying := -1.0
var _home := Vector3.ZERO


func _ready() -> void:
	_model = Node3D.new()
	add_child(_model)
	var gold := HouseLook.gilded()
	_part(_sphere(0.22), Vector3(0, 0.2, 0.02), Vector3(1.0, 0.75, 1.3), gold)       # body
	_part(_sphere(0.13), Vector3(0, 0.42, -0.17), Vector3.ONE, gold)                 # head
	_part(_sphere(0.09), Vector3(0, 0.27, 0.27), Vector3(1.2, 0.6, 1.0), gold)       # tail
	var beak := BoxMesh.new()
	beak.size = Vector3(0.1, 0.04, 0.12)
	_part(beak, Vector3(0, 0.4, -0.31), Vector3.ONE, HouseLook.paint("#e8851c"))
	for side: float in [-1.0, 1.0]:
		_part(_sphere(0.022), Vector3(0.075 * side, 0.46, -0.27), Vector3.ONE, HouseLook.paint("#101010"))
		_part(_sphere(0.1), Vector3(0.17 * side, 0.22, 0.04), Vector3(0.35, 0.6, 1.0), gold)  # wings
	var light := OmniLight3D.new()
	light.light_color = HouseLook.GOLD
	light.light_energy = 1.4
	light.omni_range = 2.5
	light.position.y = 0.5
	add_child(light)
	_egg = MeshInstance3D.new()
	_egg.mesh = _sphere(0.07)
	_egg.scale = Vector3(1.0, 1.3, 1.0)
	_egg.material_override = HouseLook.glow_gold()
	_egg.visible = false
	add_child(_egg)
	emitter = AudioStreamPlayer3D.new()
	emitter.name = "Quack"
	emitter.bus = Sfx.BUS
	emitter.position.y = 0.35
	emitter.attenuation_model = AudioStreamPlayer3D.ATTENUATION_DISABLED
	emitter.max_distance = 0.0
	emitter.doppler_tracking = AudioStreamPlayer3D.DOPPLER_TRACKING_DISABLED
	add_child(emitter)
	visible = false


static func _sphere(r: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 10
	s.rings = 6
	return s


func _part(mesh: Mesh, pos: Vector3, scl: Vector3, mat: Material) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.scale = scl
	mi.material_override = mat
	_model.add_child(mi)


## Sit on a spot (world frame, feet), facing `yaw`.
func place(pos: Vector3, yaw := 0.0) -> void:
	_home = pos
	global_position = pos
	rotation = Vector3(0, deg_to_rad(yaw), 0)
	_model.position = Vector3.ZERO
	_model.rotation = Vector3.ZERO
	_model.scale = Vector3.ONE
	_egg.visible = false
	_flying = -1.0
	visible = true


func remove() -> void:
	visible = false
	_flying = -1.0


func is_flying() -> bool:
	return _flying >= 0.0


## Lay the egg and fly off.
func celebrate() -> void:
	_egg.visible = true
	_egg.position = Vector3(0, 0.07, 0.15)
	_flying = 0.0


func _process(delta: float) -> void:
	if not visible:
		return
	_t += delta
	if _flying < 0.0:
		_model.position.y = 0.05 + sin(_t * 2.2) * 0.04
		_model.rotation.y = sin(_t * 0.7) * 0.6
		return
	_flying += delta
	var f := clampf(_flying / FLIGHT, 0.0, 1.0)
	_model.position = Vector3(0, f * f * 3.5 + 0.05, -f * 2.0)
	_model.rotation.y += delta * 6.0
	_model.scale = Vector3.ONE * (1.0 - f * 0.7)
	if f >= 1.0:
		_model.visible = false
	else:
		_model.visible = true
