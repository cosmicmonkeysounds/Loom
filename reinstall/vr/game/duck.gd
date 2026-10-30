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
	# Wave 47: smoother and shaped — a rounded body with a chest, a neck into
	# the head, a two-part beak, glinting eyes, an upturned tail and swept
	# wings, still all primitives — on a thin golden ring.
	var gold := HouseLook.gilded()
	var beak := HouseLook.paint("#f0902a")
	_part(_sphere(0.22), Vector3(0, 0.2, 0.03), Vector3(1.0, 0.72, 1.32), gold)          # body
	_part(_sphere(0.15), Vector3(0, 0.22, -0.13), Vector3(1.0, 0.85, 0.9), gold)          # chest
	_part(_sphere(0.075), Vector3(0, 0.33, -0.15), Vector3(1.0, 1.4, 1.0), gold)          # neck
	_part(_sphere(0.125), Vector3(0, 0.45, -0.17), Vector3(1.0, 0.95, 1.05), gold)        # head
	_part(_sphere(0.1), Vector3(0, 0.29, 0.27), Vector3(1.1, 0.55, 1.2), gold, Vector3(deg_to_rad(-30.0), 0, 0))  # tail
	_part(_sphere(0.06), Vector3(0, 0.425, -0.3), Vector3(0.95, 0.32, 1.25), beak)        # upper beak
	_part(_sphere(0.05), Vector3(0, 0.405, -0.285), Vector3(0.85, 0.24, 1.1), beak)       # lower beak
	for side: float in [-1.0, 1.0]:
		_part(_sphere(0.024), Vector3(0.072 * side, 0.48, -0.265), Vector3.ONE, HouseLook.paint("#0b0b10"))
		_part(_sphere(0.008), Vector3(0.08 * side, 0.488, -0.284), Vector3.ONE, HouseLook.glow_gold())  # glint
		_part(_sphere(0.11), Vector3(0.165 * side, 0.23, 0.05), Vector3(0.32, 0.55, 1.15), gold, Vector3(deg_to_rad(-12.0), deg_to_rad(8.0 * side), 0))  # wings
	var ring := TorusMesh.new()
	ring.inner_radius = 0.34
	ring.outer_radius = 0.36
	ring.rings = 32
	ring.ring_segments = 6
	var halo := MeshInstance3D.new()
	halo.name = "Ring"
	halo.mesh = ring
	halo.position.y = 0.01
	halo.material_override = HouseLook.glow_gold()
	add_child(halo)
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
	s.radial_segments = 24
	s.rings = 12
	return s


func _part(mesh: Mesh, pos: Vector3, scl: Vector3, mat: Material, rot := Vector3.ZERO) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.position = pos
	mi.rotation = rot
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
	_placed = true
	visible = not _floor_hidden


func remove() -> void:
	_placed = false
	visible = false
	_flying = -1.0


## Hide him while his floor is hidden ([method HouseBuilder.hide_floors]),
## wherever he sits; he comes back once it is drawn again (if still placed).
func set_floor_hidden(on: bool) -> void:
	_floor_hidden = on
	visible = _placed and not on


var _placed := false
var _floor_hidden := false


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
