## Other players as ghosts (§2.2 stream → `hello` / `join` / `poses` /
## `found` / `leave` / `reset`): a translucent teal capsule with a visor
## showing where they look and a name tag, eased toward each new pose. Our
## own session is skipped. Poses arrive in house coordinates; [member
## builder] maps them into the VR world.
class_name Ghosts
extends Node3D

## Seconds to ease halfway toward a new pose (~10 Hz updates).
const EASE := 0.06

var builder: HouseBuilder
## Our own session id (never drawn).
var own_session := ""

## session → {node, target: Vector3, yaw: float, name}
var _ghosts := {}


func on_frame(event: String, data: Variant) -> void:
	var d: Dictionary = data if data is Dictionary else {}
	match event:
		"hello":
			clear()
			for p: Dictionary in d.get("players", []):
				_upsert(p)
		"join":
			if d.get("player") is Dictionary:
				_upsert(d["player"])
		"poses":
			for p: Dictionary in d.get("players", []):
				_upsert(p)
		"leave":
			_remove(str(d.get("session", "")))
		"reset":
			clear()


func clear() -> void:
	for s: String in _ghosts.keys():
		_remove(s)


func count() -> int:
	return _ghosts.size()


func has(session: String) -> bool:
	return _ghosts.has(session)


func _upsert(p: Dictionary) -> void:
	var sid := str(p.get("session", ""))
	if sid == "" or sid == own_session or not p.get("p") is Array or builder == null:
		return
	var pos := builder.to_world(p["p"])
	var yaw := builder.yaw_to_world(float(p.get("yaw", 0.0)))
	if not _ghosts.has(sid):
		var node := _make(str(p.get("name", "")))
		add_child(node)
		node.global_position = pos
		_ghosts[sid] = {"node": node, "target": pos, "yaw": yaw}
		return
	var g: Dictionary = _ghosts[sid]
	g["target"] = pos
	g["yaw"] = yaw
	if p.has("name"):
		(g["node"].get_node("Tag") as Label3D).text = str(p["name"])


func _remove(sid: String) -> void:
	if not _ghosts.has(sid):
		return
	var node: Node = _ghosts[sid]["node"]
	_ghosts.erase(sid)
	remove_child(node)
	node.queue_free()


func _make(display: String) -> Node3D:
	var root := Node3D.new()
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.albedo_color = Color(0.24, 0.95, 0.91, 0.35)
	var body := MeshInstance3D.new()
	var cap := CapsuleMesh.new()
	cap.radius = 0.22
	cap.height = 1.55
	cap.radial_segments = 10
	cap.rings = 2
	body.mesh = cap
	body.material_override = mat
	body.position.y = 0.8
	root.add_child(body)
	var visor := MeshInstance3D.new()
	var vb := BoxMesh.new()
	vb.size = Vector3(0.2, 0.06, 0.04)
	visor.mesh = vb
	visor.material_override = HouseLook.screen()
	visor.position = Vector3(0, 1.45, -0.2)
	visor.name = "Visor"
	var head := Node3D.new()
	head.name = "Head"
	head.add_child(visor)
	root.add_child(head)
	var tag := HouseLook.label(display, 0.1, HouseLook.TEAL_GLOW)
	tag.name = "Tag"
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.position.y = 1.85
	root.add_child(tag)
	return root


func _process(delta: float) -> void:
	var k := 1.0 - pow(0.5, delta / EASE)
	for g: Dictionary in _ghosts.values():
		var node: Node3D = g["node"]
		node.global_position = node.global_position.lerp(g["target"], k)
		var head: Node3D = node.get_node("Head")
		head.rotation.y = lerp_angle(head.rotation.y, deg_to_rad(float(g["yaw"])), k)
