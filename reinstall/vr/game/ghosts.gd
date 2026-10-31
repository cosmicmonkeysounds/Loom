## Other players as ghosts (§2.2 stream → `hello` / `join` / `poses` /
## `found` / `leave` / `reset` / `avatar`): a glitchy swarm of the program's
## own profile picture (`avatar`: the avatar key, fetched through
## [member avatars]) that holds to the capsule its body would fill and tears
## into a face staring at you, eased toward each new pose. No name over it.
## The capsule is only that shape: it is never drawn. No key, or a picture
## that won't load, is the same swarm as static in the ghost's tint. One
## [MultiMeshInstance3D] per ghost over one shared [MultiMesh] ([Swarm] is
## the layout, `swarm.gdshader` all the movement). Our own session is
## skipped. Poses arrive in house coordinates; [member builder] maps them
## into the VR world.
class_name Ghosts
extends Node3D

## Seconds to ease halfway toward a new pose (~10 Hz updates).
const EASE := 0.06
## How near the eye a ghost's shards may come (m): one walking through the player
## otherwise fills the view at the near plane.
const NEAR_CUT := 0.6
const SWARM_SHADER := preload("res://game/swarm.gdshader")

static var _shared_shards: MultiMesh

var builder: HouseBuilder
## Our own session id (never drawn).
var own_session := ""

## Avatar key → picture URL ("" = none to fetch): [method LinkBase.avatar_url].
var url_of: Callable = func(_key: String) -> String: return ""
## The picture fetcher (made on first use when not given).
var avatars: AvatarCache

## session → {node, target: Vector3, yaw: float, url: String, p: house [x, y, z],
## worn: bool, facing: float (radians), trail: Swarm.SwarmTrail, mat: ShaderMaterial}
var _ghosts := {}
## Whether a ghost at a house point stands on a hidden floor ([method hide_on]).
var _hidden_at: Callable = func(_p: Array) -> bool: return false


## Hide every ghost for which `hidden_at` (house `[x, y, z]` → bool) says
## so — the ones on a floor [HouseBuilder] hides — now and as they move.
func hide_on(hidden_at: Callable) -> void:
	_hidden_at = hidden_at
	for g: Dictionary in _ghosts.values():
		(g["node"] as Node3D).visible = not hidden_at.call(g["p"])


func _ready() -> void:
	if avatars == null:
		avatars = AvatarCache.new()
		avatars.name = "Avatars"
		add_child(avatars)
	avatars.loaded.connect(_on_picture)


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
		"avatar":
			var sid := str(d.get("session", ""))
			if _ghosts.has(sid):
				_set_avatar(sid, d.get("avatar"))
		"reset":
			clear()


## A new visit: the pictures that failed in an earlier one are asked for
## once more (a timeout then is no reason to leave a guest static all
## night) — for the ghosts here now, and for any that join.
func new_visit() -> void:
	if avatars == null:
		return
	avatars.forget_failures()
	for g: Dictionary in _ghosts.values():
		if g["url"] != "" and avatars.texture(g["url"]) == null:
			avatars.fetch(g["url"])


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
		var node := _make(sid)
		add_child(node)
		node.global_position = pos
		var mat: ShaderMaterial = (node.get_node("Swarm") as MultiMeshInstance3D).material_override
		_ghosts[sid] = {"node": node, "target": pos, "yaw": yaw, "url": "", "p": p["p"], "worn": false, "facing": deg_to_rad(yaw), "trail": Swarm.SwarmTrail.new(), "mat": mat}
		_set_avatar(sid, p.get("avatar"))
		return
	var g: Dictionary = _ghosts[sid]
	g["target"] = pos
	g["yaw"] = yaw
	g["p"] = p["p"]
	g["node"].visible = not _hidden_at.call(p["p"])
	if p.has("avatar"):
		_set_avatar(sid, p["avatar"])


## A ghost's avatar key (`null` / "" = none): fetch its picture, show it
## once it lands (at once when cached), or back to static.
func _set_avatar(sid: String, key: Variant) -> void:
	var g: Dictionary = _ghosts[sid]
	var url: String = str(url_of.call(str(key))) if key is String and str(key) != "" else ""
	if url == g["url"]:
		return
	g["url"] = url
	_show_picture(g, null)
	if url == "" or avatars == null:
		return
	var tex := avatars.bare(url)
	if tex != null:
		_show_picture(g, tex)
	else:
		avatars.fetch(url)


func _on_picture(url: String, _tile: Texture2D) -> void:
	for g: Dictionary in _ghosts.values():
		if g["url"] == url:
			_show_picture(g, avatars.bare(url))


## Make the swarm of `tex` (null: back to static).
func _show_picture(g: Dictionary, tex: Texture2D) -> void:
	var mat: ShaderMaterial = g["mat"]
	g["worn"] = tex != null
	mat.set_shader_parameter("map", tex)
	mat.set_shader_parameter("worn", tex != null)


## (wave 49) The bare picture of avatar key `key`, once it is here (asked
## for otherwise); null when there is none, or not yet.
func picture_for(key: Variant) -> Texture2D:
	var url: String = str(url_of.call(str(key))) if key is String and str(key) != "" else ""
	if url == "" or avatars == null:
		return null
	var tex := avatars.bare(url)
	if tex == null:
		avatars.fetch(url)
	return tex


## (wave 49, the `self` vision) The program's own copy: a swarm of its
## picture ([method set_pale_picture]) that fades by losing shards.
static func make_pale() -> Node3D:
	var root := Node3D.new()
	var mat := ShaderMaterial.new()
	mat.shader = SWARM_SHADER
	mat.set_shader_parameter("near_cut", NEAR_CUT)
	var swarm := MultiMeshInstance3D.new()
	swarm.name = "Swarm"
	swarm.multimesh = shards()
	swarm.material_override = mat
	swarm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(swarm)
	return root


static func _pale_mat(root: Node3D) -> ShaderMaterial:
	return (root.get_node("Swarm") as MultiMeshInstance3D).material_override as ShaderMaterial


static func set_pale_picture(root: Node3D, tex: Texture2D) -> void:
	_pale_mat(root).set_shader_parameter("map", tex)
	_pale_mat(root).set_shader_parameter("worn", tex != null)


## How much of the copy is there, 0 … 1.
static func set_pale_alpha(root: Node3D, a: float) -> void:
	_pale_mat(root).set_shader_parameter("present", a)


## After moving it: the shader works in world space from here.
static func place_pale(root: Node3D) -> void:
	_pale_mat(root).set_shader_parameter("origin", root.global_position)


static func pale_picture(root: Node3D) -> Texture2D:
	return _pale_mat(root).get_shader_parameter("map")


## The URL a ghost's picture is (or would be) from ("" = none).
func picture_url(session: String) -> String:
	return str(_ghosts[session]["url"]) if _ghosts.has(session) else ""


## Whether a ghost's swarm is made of its picture.
func has_picture(session: String) -> bool:
	return _ghosts.has(session) and bool(_ghosts[session]["worn"])


func _remove(sid: String) -> void:
	if not _ghosts.has(sid):
		return
	var node: Node = _ghosts[sid]["node"]
	_ghosts.erase(sid)
	remove_child(node)
	node.queue_free()


func _make(sid: String) -> Node3D:
	var root := Node3D.new()
	var seed_of := float(sid.hash() % 1000)
	var mat := ShaderMaterial.new()
	mat.shader = SWARM_SHADER
	mat.set_shader_parameter("swarm_seed", seed_of / 10.0)
	mat.set_shader_parameter("near_cut", NEAR_CUT)
	mat.set_shader_parameter("tint", Color.from_hsv(seed_of / 1000.0, 0.6, 1.0))
	var swarm := MultiMeshInstance3D.new()
	swarm.name = "Swarm"
	swarm.multimesh = shards()
	swarm.material_override = mat
	swarm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(swarm)
	return root


## Every swarm's one set of shards, built once. Its bounds cover the trail
## and the shards that jump: the shader places them, so Godot can't know.
static func shards() -> MultiMesh:
	if _shared_shards != null:
		return _shared_shards
	var quad := QuadMesh.new()
	quad.size = Vector2.ONE
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.use_custom_data = true
	mm.mesh = quad
	mm.custom_aabb = AABB(Vector3(-3.0, -1.0, -3.0), Vector3(6.0, 4.0, 6.0))
	var shards := Swarm.layout()
	mm.instance_count = shards.size()
	for i in shards.size():
		var s: Dictionary = shards[i]
		var size: Vector2 = s["size"]
		mm.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3(size.x, size.y, 1.0)), s["home"]))
		mm.set_instance_color(i, s["cell"])
		mm.set_instance_custom_data(i, s["rand"])
	_shared_shards = mm
	return mm


func _process(delta: float) -> void:
	var k := 1.0 - pow(0.5, delta / EASE)
	for g: Dictionary in _ghosts.values():
		var node: Node3D = g["node"]
		node.global_position = node.global_position.lerp(g["target"], k)
		if not node.visible:
			continue
		var facing := lerp_angle(float(g["facing"]), deg_to_rad(float(g["yaw"])), k)
		g["facing"] = facing
		var trail: Swarm.SwarmTrail = g["trail"]
		trail.step(node.global_position, delta)
		var mat: ShaderMaterial = g["mat"]
		mat.set_shader_parameter("origin", node.global_position)
		mat.set_shader_parameter("look", Vector3(-sin(facing), 0.0, -cos(facing)))
		mat.set_shader_parameter("trail", trail.offsets)
