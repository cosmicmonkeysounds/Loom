## The VR player's right hand: their own profile picture as a small swarm
## (the ghosts' shards and `swarm.gdshader`, at [constant SCALE]), its face on
## the hand and its tail hanging under it, dragging behind in the world. The
## face only tears together now and then: a hand is always near the eye, so
## the ghosts' "closer than 4 m" rule is off here. No picture is static, as
## on a ghost. The left hand is not drawn at all.
class_name HandSwarm
extends MultiMeshInstance3D

## The swarm's size against a ghost's.
const SCALE := 0.32
## In view all the time at arm's length, so slower than a ghost, and under the
## 3 Hz a flicker needs to stay below.
const STEP_HZ := 3.0
## How near the eye a shard may come (m).
const NEAR_CUT := 0.2

## The picture fetcher ([member Ghosts.avatars]) and avatar key → URL.
var avatars: AvatarCache
var url_of: Callable = func(_key: String) -> String: return ""
## Our session (its `avatar` frames change the hand).
var own_session := ""

var _url := ""
var _worn := false
var _mat := ShaderMaterial.new()
var _trail := Swarm.SwarmTrail.new()


func _init() -> void:
	name = "Swarm"
	# The shader reads the shards' world offsets, so never the hand's turn.
	top_level = true
	multimesh = Ghosts.shards()
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_mat.shader = Ghosts.SWARM_SHADER
	_mat.set_shader_parameter("swarm_scale", SCALE)
	_mat.set_shader_parameter("near_weight", 0.0)
	_mat.set_shader_parameter("step_hz", STEP_HZ)
	_mat.set_shader_parameter("near_cut", NEAR_CUT)
	material_override = _mat


## Hand it the cache (its `loaded` signal shows a picture that lands later).
func attach(cache: AvatarCache, urls: Callable) -> void:
	avatars = cache
	url_of = urls
	avatars.loaded.connect(_on_picture)


## Wear an avatar key's picture (null / "" = none: static).
func wear(key: Variant) -> void:
	var url: String = str(url_of.call(str(key))) if key is String and str(key) != "" else ""
	if url == _url:
		return
	_url = url
	_show(null)
	if url == "" or avatars == null:
		return
	var tex := avatars.bare(url)
	if tex != null:
		_show(tex)
	else:
		avatars.fetch(url)


## The stream's `avatar` frame, when it is about us.
func on_frame(event: String, data: Variant) -> void:
	var d: Dictionary = data if data is Dictionary else {}
	if event == "avatar" and own_session != "" and str(d.get("session", "")) == own_session:
		wear(d.get("avatar"))


func worn() -> bool:
	return _worn


func picture_url() -> String:
	return _url


func _on_picture(url: String, _tile: Texture2D) -> void:
	if url == _url:
		_show(avatars.bare(url))


func _show(tex: Texture2D) -> void:
	_worn = tex != null
	_mat.set_shader_parameter("map", tex)
	_mat.set_shader_parameter("worn", tex != null)


func _process(delta: float) -> void:
	var hand := get_parent() as Node3D
	if hand == null or not is_visible_in_tree():
		return
	var at := hand.global_position - Vector3(0.0, Swarm.FACE_Y * SCALE, 0.0)
	global_transform = Transform3D(Basis.IDENTITY, at)
	_trail.step(at, delta)
	_mat.set_shader_parameter("origin", at)
	_mat.set_shader_parameter("trail", _trail.offsets)
