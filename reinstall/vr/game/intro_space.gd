## Where the intro happens (wave 33, [IntroFlow]): a calm practice floor
## far from the house and the lobby ([constant SPOT]), with
##
## - **the cinema** — the reinstallation video ([constant VIDEO_PATH],
##   shipped in the APK: Ogg Theora, decoded in software) played by a
##   [VideoStreamPlayer] in a [SubViewport] and shown on a big quad
##   [constant SCREEN_DISTANCE] m in front of the guest at eye height, with
##   a SKIP button under it for a returning program;
## - **the tutorial panel** — big text and big buttons, placed in front of
##   the guest at each step ([method place_panel]); pointed at with the
##   lobby's laser ([LobbyPointer]) and the lobby's button look;
## - **the ring** to walk into and **the duck** to turn around to.
##
## Tests (and a headless run) set [member fake_video]: nothing is decoded,
## the "video" plays until [method finish_video].
class_name IntroSpace
extends Node3D

## Where the guest stands for the intro (world frame): near the lobby's
## spot but clear of its floor.
const SPOT := Vector3(0, 400, 80)
const VIDEO_PATH := "res://media/reinstallation.ogv"
const VIDEO_SIZE := Vector2i(1280, 720)
## The cinema screen: its distance (m), size and centre height.
const SCREEN_DISTANCE := 3.4
const SCREEN_SIZE := Vector2(3.6, 2.025)
const SCREEN_Y := 1.55
const SKIP_AT := Vector2(1.5, 0.36)
const SKIP_SIZE := Vector2(0.62, 0.22)
## The tutorial panel: its usual distance in front of the guest (m).
const PANEL_DISTANCE := 2.0
## The backdrop's width and top; its bottom follows the lowest button up
## ([method _fit_backdrop]).
const BACKDROP_W := 1.9
const BACKDROP_TOP := 2.12
## The panel's content sits around this height: a panel scaled up for
## distance grows about it.
const EYE_LINE := 1.55
const MAIN_AT := Vector2(0, 1.22)
const MAIN_SIZE := Vector2(0.62, 0.2)
const SNAP_AT := Vector2(-0.43, 1.3)
const SMOOTH_AT := Vector2(0.43, 1.3)
const TURN_SIZE := Vector2(0.74, 0.2)
const KEEP_AT := Vector2(0, 0.86)
const KEEP_SIZE := Vector2(0.78, 0.18)
const SKIP_TUTORIAL_AT := Vector2(0, 0.6)
const SKIP_TUTORIAL_SIZE := Vector2(0.6, 0.13)
## Where the ring and the duck go, from the guest (m).
const RING_AHEAD := 2.5
const DUCK_BEHIND := 3.0
const BACKDROP := "#0a1f28"

## No decoding (tests, headless): the video plays until [method finish_video].
var fake_video := false
var video_path := VIDEO_PATH

var _floor: Node3D
var _floor_mesh: MeshInstance3D
var _floor_lit: Material
var _floor_dark: Material
var _lamp: OmniLight3D
var _posts: Node3D
var _cinema: Node3D
var _viewport: SubViewport
var _video: VideoStreamPlayer
var _panel: Node3D
var _backdrop: MeshInstance3D
var _title: Label3D
var _body: Label3D
var _progress: Label3D
var _notes: Array[Label3D] = []
var _ring: MeshInstance3D
var duck: Duck
var _looks := {}  # button id → its node
var _buttons: Array = []  # {id, center, size} on the surface up now
var _surface := "cinema"  # "cinema" (the video) or "panel"
var _hover := ""
var _shown := ""  # what the panel shows (redrawn only on a change)
var _video_on := false
var _video_done := false
var _t := 0.0


func _ready() -> void:
	position = SPOT
	_build_floor()
	_build_cinema()
	_build_panel()
	_ring = MeshInstance3D.new()
	_ring.name = "Ring"
	var torus := TorusMesh.new()
	torus.inner_radius = IntroFlow.RING_RADIUS - 0.08
	torus.outer_radius = IntroFlow.RING_RADIUS
	_ring.mesh = torus
	_ring.material_override = HouseLook.glow_gold()
	_ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_ring.top_level = true
	_ring.visible = false
	add_child(_ring)
	duck = Duck.new()
	duck.name = "Duck"
	add_child(duck)
	visible = false


func _build_floor() -> void:
	_floor = Node3D.new()
	_floor.name = "Floor"
	add_child(_floor)
	var body := StaticBody3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(40, 0.2, 40)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position.y = -0.1
	body.add_child(cs)
	_floor.add_child(body)
	_floor_mesh = MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	_floor_mesh.mesh = plane
	# The house's checker floor, in squares of about a metre; near black
	# while the video plays (a dark, calm cinema).
	var lit := (HouseLook.floor_for("#1f5560", false) as StandardMaterial3D).duplicate() as StandardMaterial3D
	lit.uv1_scale = Vector3(20, 20, 1)
	_floor_lit = lit
	_floor_dark = HouseLook.paint("#04090c")
	_floor_mesh.material_override = _floor_lit
	_floor.add_child(_floor_mesh)
	# A soft lamp over the practice spot, and a wide ring of posts so the
	# space has edges (the lobby's look, calmer).
	_lamp = OmniLight3D.new()
	_lamp.name = "Lamp"
	_lamp.light_color = Color("#fff4dc")
	_lamp.light_energy = 1.4
	_lamp.omni_range = 9.0
	_lamp.position = Vector3(0, 3.2, -1.0)
	_floor.add_child(_lamp)
	_posts = Node3D.new()
	_posts.name = "Posts"
	_floor.add_child(_posts)
	for i in 16:
		var a := TAU * i / 16.0
		var post := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(0.1, 2.2, 0.1)
		post.mesh = box
		post.material_override = HouseLook.screen("#2a9d9d")
		post.position = Vector3(sin(a) * 7.0, 1.1, cos(a) * 7.0)
		_posts.add_child(post)


func _build_cinema() -> void:
	_cinema = Node3D.new()
	_cinema.name = "Cinema"
	_cinema.position = Vector3(0, 0, -SCREEN_DISTANCE)
	add_child(_cinema)
	_viewport = SubViewport.new()
	_viewport.name = "VideoViewport"
	_viewport.size = VIDEO_SIZE
	_viewport.disable_3d = true
	_viewport.transparent_bg = false
	_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	add_child(_viewport)
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.size = Vector2(VIDEO_SIZE)
	_viewport.add_child(black)
	_video = VideoStreamPlayer.new()
	_video.name = "Video"
	_video.expand = true
	_video.size = Vector2(VIDEO_SIZE)
	_video.finished.connect(func() -> void: _video_done = true)
	_viewport.add_child(_video)
	var frame := Lobby._quad(SCREEN_SIZE + Vector2(0.16, 0.16), HouseLook.screen("#050c10"))
	frame.name = "Frame"
	frame.position = Vector3(0, SCREEN_Y, -0.02)
	_cinema.add_child(frame)
	var screen := Lobby._quad(SCREEN_SIZE, _screen_material())
	screen.name = "Screen"
	screen.position = Vector3(0, SCREEN_Y, 0)
	_cinema.add_child(screen)
	_looks["skip"] = Lobby.make_button(_cinema, IntroFlow.LABELS["skip"], SKIP_AT, SKIP_SIZE, 0.1)


func _screen_material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_texture = _viewport.get_texture()
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR
	m.disable_fog = true
	return m


func _build_panel() -> void:
	_panel = Node3D.new()
	_panel.name = "Panel"
	_panel.top_level = true
	add_child(_panel)
	_backdrop = Lobby._quad(Vector2(BACKDROP_W, 1.0), HouseLook.screen(BACKDROP))
	_backdrop.name = "Backdrop"
	_panel.add_child(_backdrop)
	_fit_backdrop([])
	_progress = _label(0.045, HouseLook.TEAL_GLOW, 2.04)
	_title = _label(0.11, HouseLook.GOLD, 1.92)
	_body = _label(0.066, HouseLook.INK, 1.66)
	for id: String in ["ok", "next", "start"]:
		_looks[id] = Lobby.make_button(_panel, IntroFlow.LABELS[id], MAIN_AT, MAIN_SIZE, 0.08)
	_looks["snap"] = Lobby.make_button(_panel, IntroFlow.LABELS["snap"], SNAP_AT, TURN_SIZE, 0.07)
	_looks["smooth"] = Lobby.make_button(_panel, IntroFlow.LABELS["smooth"], SMOOTH_AT, TURN_SIZE, 0.07)
	_looks["keep"] = Lobby.make_button(_panel, "", KEEP_AT, KEEP_SIZE, 0.07)
	Lobby.fit((_looks["keep"] as Node3D).get_node("Label") as Label3D, IntroFlow.LABELS["keep"], KEEP_SIZE.x - 0.06, 0.07)
	_looks["skip_tutorial"] = Lobby.make_button(_panel, "", SKIP_TUTORIAL_AT, SKIP_TUTORIAL_SIZE, 0.045)
	Lobby.fit((_looks["skip_tutorial"] as Node3D).get_node("Label") as Label3D, IntroFlow.LABELS["skip_tutorial"], SKIP_TUTORIAL_SIZE.x - 0.06, 0.045)
	for i in 2:
		var note := _label(0.045, HouseLook.TEAL_GLOW, 1.1)
		note.position.x = SNAP_AT.x if i == 0 else SMOOTH_AT.x
		note.text = IntroFlow.SNAP_NOTE if i == 0 else IntroFlow.SMOOTH_NOTE
		_notes.append(note)
	_panel.visible = false


func _label(height: float, color: Color, y: float) -> Label3D:
	var l := HouseLook.label("", height, color)
	l.position = Vector3(0, y, 0.004)
	_panel.add_child(l)
	return l


# --- the video ----------------------------------------------------------------


## Play the video from the start (the cinema up, the panel away). A missing
## or undecodable file counts as finished at once, so the intro never hangs.
func start_video() -> void:
	visible = true
	_surface = "cinema"
	_panel.visible = false
	_cinema.visible = true
	_lights(false)
	_video_on = true
	_video_done = false
	if fake_video:
		return
	var stream: VideoStream = null
	if video_path != "" and ResourceLoader.exists(video_path):
		stream = load(video_path) as VideoStream
	if stream == null:
		push_warning("reinstall-vr: no intro video at %s — skipping it" % video_path)
		_video_done = true
		return
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	_video.stream = stream
	_video.play()
	if not _video.is_playing():
		push_warning("reinstall-vr: the intro video would not play — skipping it")
		_video_done = true


## Stop the video and take the cinema down.
func stop_video() -> void:
	_video_on = false
	if _video.is_playing():
		_video.stop()
	_video.stream = null
	_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_cinema.visible = false
	_lights(true)


## The practice floor lit (the tutorial) or dark (the cinema).
func _lights(on: bool) -> void:
	_floor_mesh.material_override = _floor_lit if on else _floor_dark
	_lamp.visible = on
	_posts.visible = on


## Whether the practice floor is lit (the tutorial), not the dark cinema.
func lit() -> bool:
	return _lamp.visible


## Tests / a fake video: the video has played to its end.
func finish_video() -> void:
	_video_done = true


func video_finished() -> bool:
	return _video_done


## Whether the video is up (playing, or the fake one waiting).
func video_on() -> bool:
	return _video_on and not _video_done


## The real player's position (s) — 0 with a fake video.
func video_position() -> float:
	return _video.stream_position if _video.stream != null else 0.0


# --- the tutorial ----------------------------------------------------------------


## Show `flow`'s step: the cinema's SKIP during the video, else the panel's
## title, text and buttons; the ring and the duck when their step is up.
func render(flow: IntroFlow) -> void:
	var ids := flow.buttons()
	if flow.step == IntroFlow.Step.VIDEO:
		_surface = "cinema"
		_buttons = []
		(_looks["skip"] as Node3D).visible = "skip" in ids
		if "skip" in ids:
			_buttons.append({"id": "skip", "center": SKIP_AT, "size": SKIP_SIZE})
		_render_looks(flow)
		return
	_surface = "panel"
	_panel.visible = flow.running()
	var sig := "%d|%s|%s|%s" % [flow.step, ",".join(ids), flow.turn, flow.body()]
	if sig == _shown:
		_render_looks(flow)
		return
	_shown = sig
	_progress.text = flow.progress()
	_title.text = flow.title()
	_body.text = flow.body()
	_buttons = []
	for id: String in ["ok", "next", "start", "snap", "smooth", "keep", "skip_tutorial"]:
		var on: bool = id in ids
		(_looks[id] as Node3D).visible = on
		if on:
			_buttons.append({"id": id, "center": _center_of(id), "size": _size_of(id)})
	for note in _notes:
		note.visible = "snap" in ids
	_fit_backdrop(ids)
	_render_looks(flow)


## The backdrop from [constant BACKDROP_TOP] down to just under the lowest
## of `ids` (just under the text when there is none).
func _fit_backdrop(ids: Array) -> void:
	var bottom := 1.42
	for id: String in ids:
		bottom = minf(bottom, _center_of(id).y - _size_of(id).y / 2.0 - (0.2 if id in ["snap", "smooth"] else 0.08))
	_backdrop.scale = Vector3(1.0, BACKDROP_TOP - bottom, 1.0)
	_backdrop.position = Vector3(0, (BACKDROP_TOP + bottom) / 2.0, -0.03)


static func _center_of(id: String) -> Vector2:
	match id:
		"snap": return SNAP_AT
		"smooth": return SMOOTH_AT
		"keep": return KEEP_AT
		"skip_tutorial": return SKIP_TUTORIAL_AT
	return MAIN_AT


static func _size_of(id: String) -> Vector2:
	match id:
		"snap", "smooth": return TURN_SIZE
		"keep": return KEEP_SIZE
		"skip_tutorial": return SKIP_TUTORIAL_SIZE
	return MAIN_SIZE


func _render_looks(flow: IntroFlow) -> void:
	for id: String in _looks:
		var on := (id == "snap" or id == "smooth") and id == flow.turn
		Lobby.set_look(_looks[id], id == _hover, on)


## Stand the panel `distance` m in front of feet `feet` along `yaw` (world,
## degrees), facing back at the guest; farther panels are scaled up so
## they read the same.
func place_panel(feet: Vector3, yaw: float, distance := PANEL_DISTANCE) -> void:
	var f := _forward(yaw)
	var k := distance / PANEL_DISTANCE
	var at := Vector3(feet.x, SPOT.y + EYE_LINE * (1.0 - k), feet.z) + f * distance
	_panel.global_transform = Transform3D(Basis(Vector3.UP, deg_to_rad(yaw)).scaled(Vector3.ONE * k), at)


## The ring [constant RING_AHEAD] m ahead of `feet` along `yaw`; returns where.
func place_ring(feet: Vector3, yaw: float) -> Vector3:
	var at := Vector3(feet.x, SPOT.y + 0.02, feet.z) + _forward(yaw) * RING_AHEAD
	_ring.global_position = at
	_ring.visible = true
	return at


## The duck [constant DUCK_BEHIND] m behind `feet` (facing them); returns where.
func place_duck(feet: Vector3, yaw: float) -> Vector3:
	var at := Vector3(feet.x, SPOT.y, feet.z) - _forward(yaw) * DUCK_BEHIND
	duck.place(at, yaw + 180.0)
	return at


func hide_ring() -> void:
	_ring.visible = false


func ring_shown() -> bool:
	return _ring.visible


static func _forward(yaw: float) -> Vector3:
	var r := deg_to_rad(yaw)
	return Vector3(-sin(r), 0.0, -cos(r))


## The button under a pointer ray ([method LobbyPointer.poll]) on the
## surface up now: `{id, at, point}` (`id` "" on the surface but off the
## buttons), or `{}` off it.
func aim(state: Dictionary) -> Dictionary:
	if state.get("active", false) != true or not visible:
		return {}
	var surface: Node3D = _cinema if _surface == "cinema" else _panel
	if not surface.visible:
		return {}
	var h := LobbyTiles.ray_to_panel(state["origin"], state["dir"], surface.global_transform)
	if h.is_empty():
		return {}
	var id := LobbyTiles.button_at(h["point"], _buttons)
	_hover = id
	return {"id": id, "at": h["at"], "point": h["point"]}


## Everything down (the intro is over, or the session ended).
func close() -> void:
	stop_video()
	_panel.visible = false
	_ring.visible = false
	duck.remove()
	_shown = ""
	_hover = ""
	visible = false


func _process(delta: float) -> void:
	if not visible:
		return
	_t += delta
	if _ring.visible:
		_ring.scale = Vector3.ONE * (1.0 + 0.06 * sin(_t * 2.0))
	# A decoder that stops without its `finished` (a stream error) still ends it.
	if _video_on and not fake_video and _video.stream != null and not _video.is_playing() and not _video.paused:
		_video_done = true


# --- for the tests and the screenshot tool ---


func panel_shown() -> bool:
	return _panel.visible


func panel_transform() -> Transform3D:
	return _panel.global_transform


func cinema_transform() -> Transform3D:
	return _cinema.global_transform


func cinema_shown() -> bool:
	return _cinema.visible


## The button ids a pointer can press now.
func button_ids() -> Array:
	return _buttons.map(func(b: Dictionary) -> String: return str(b["id"]))


## Where button `id` sits in the world (its centre), for aiming at it.
func button_world(id: String) -> Vector3:
	var on_cinema := id == "skip"
	var surface: Node3D = _cinema if on_cinema else _panel
	var c := _center_of(id) if not on_cinema else SKIP_AT
	return surface.global_transform * Vector3(c.x, c.y, 0.0)


func title_text() -> String:
	return _title.text


func body_text() -> String:
	return _body.text
