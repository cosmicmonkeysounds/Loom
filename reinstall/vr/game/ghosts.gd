## Other players as ghosts (§2.2 stream → `hello` / `join` / `poses` /
## `found` / `leave` / `reset` / `avatar`): a translucent teal capsule with
## a visor showing where they look and a name tag, eased toward each new
## pose. A guest with a profile picture (`avatar`: the avatar key) also
## wears it as a head — a Win98-bevelled billboard square over the capsule
## ("Picture"), fetched through [member avatars]; no key, or a picture that
## won't load, leaves the plain capsule. Our own session is skipped. Poses
## arrive in house coordinates; [member builder] maps them into the VR world.
class_name Ghosts
extends Node3D

## Seconds to ease halfway toward a new pose (~10 Hz updates).
const EASE := 0.06
## The picture head: its side (m) and its centre's height; the name tag
## rises above it.
const PICTURE_SIZE := 0.42
const PICTURE_Y := 1.78
const TAG_Y := 1.85
const TAG_Y_PICTURE := 2.1

var builder: HouseBuilder
## Our own session id (never drawn).
var own_session := ""

## Avatar key → picture URL ("" = none to fetch): [method LinkBase.avatar_url].
var url_of: Callable = func(_key: String) -> String: return ""
## The picture fetcher (made on first use when not given).
var avatars: AvatarCache

## session → {node, target: Vector3, yaw: float, url: String}
var _ghosts := {}


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
## once more (a timeout then is no reason to leave a guest a capsule all
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
		var node := _make(str(p.get("name", "")))
		add_child(node)
		node.global_position = pos
		_ghosts[sid] = {"node": node, "target": pos, "yaw": yaw, "url": ""}
		_set_avatar(sid, p.get("avatar"))
		return
	var g: Dictionary = _ghosts[sid]
	g["target"] = pos
	g["yaw"] = yaw
	if p.has("name"):
		(g["node"].get_node("Tag") as Label3D).text = str(p["name"])
	if p.has("avatar"):
		_set_avatar(sid, p["avatar"])


## A ghost's avatar key (`null` / "" = none): fetch its picture, show it
## once it lands (at once when cached), or back to the plain capsule.
func _set_avatar(sid: String, key: Variant) -> void:
	var g: Dictionary = _ghosts[sid]
	var url: String = str(url_of.call(str(key))) if key is String and str(key) != "" else ""
	if url == g["url"]:
		return
	g["url"] = url
	_show_picture(g["node"], null)
	if url == "" or avatars == null:
		return
	var tex := avatars.texture(url)
	if tex != null:
		_show_picture(g["node"], tex)
	else:
		avatars.fetch(url)


func _on_picture(url: String, tex: Texture2D) -> void:
	for g: Dictionary in _ghosts.values():
		if g["url"] == url:
			_show_picture(g["node"], tex)


## Put `tex` on the ghost's head (null: take it off).
func _show_picture(node: Node3D, tex: Texture2D) -> void:
	var pic := node.get_node_or_null("Picture") as Sprite3D
	var tag := node.get_node("Tag") as Label3D
	if tex == null:
		if pic != null:
			node.remove_child(pic)
			pic.queue_free()
		tag.position.y = TAG_Y
		return
	if pic == null:
		pic = Sprite3D.new()
		pic.name = "Picture"
		pic.billboard = BaseMaterial3D.BILLBOARD_ENABLED
		pic.shaded = false
		pic.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
		pic.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		pic.position.y = PICTURE_Y
		node.add_child(pic)
	pic.texture = tex
	pic.pixel_size = PICTURE_SIZE / float(maxi(1, maxi(tex.get_width(), tex.get_height())))
	tag.position.y = TAG_Y_PICTURE


## The URL a ghost's picture is (or would be) from ("" = none).
func picture_url(session: String) -> String:
	return str(_ghosts[session]["url"]) if _ghosts.has(session) else ""


## Whether a ghost wears its picture.
func has_picture(session: String) -> bool:
	return _ghosts.has(session) and (_ghosts[session]["node"] as Node).get_node_or_null("Picture") != null


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
	tag.position.y = TAG_Y
	root.add_child(tag)
	return root


func _process(delta: float) -> void:
	var k := 1.0 - pow(0.5, delta / EASE)
	for g: Dictionary in _ghosts.values():
		var node: Node3D = g["node"]
		node.global_position = node.global_position.lerp(g["target"], k)
		var head: Node3D = node.get_node("Head")
		head.rotation.y = lerp_angle(head.rotation.y, deg_to_rad(float(g["yaw"])), k)
