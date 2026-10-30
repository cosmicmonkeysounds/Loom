## Head-locked text, only when there is something to say: the big found
## screen ("REINSTALLATION COMPLETE" / "YOU FOUND GERALD"), a short notice,
## and the void's scare. While walking the view is clear: no room name, no
## instruction, no mic line. It never shows the King's health (that hangs
## over him, [HouseBuilder]). Parented to the camera by [Game].
class_name Hud
extends Node3D

var _big: Label3D
var _sub: Label3D


func _ready() -> void:
	_big = _label(0.14, HouseLook.GOLD, Vector3(0, 0.12, -1.8))
	_sub = _label(0.06, HouseLook.INK, Vector3(0, -0.06, -1.8))
	hide_all()


func _label(height: float, color: Color, pos: Vector3) -> Label3D:
	var l := HouseLook.label("", height, color)
	l.no_depth_test = true
	l.render_priority = 50
	l.outline_render_priority = 49
	l.position = pos
	add_child(l)
	return l


func hide_all() -> void:
	for l: Label3D in [_big, _sub]:
		l.text = ""
	_scare_alpha = 0.0
	_scare_target = 0.0
	_apply_scare()


# --- the void's jump scare (wave 26, R4) -------------------------------------

## The scare's panel text (glitch art, no name).
const SCARE_TEXT := "FATAL EXCEPTION 0E"
## How fast the scare fades out (alpha per second). It comes on at once —
## one hard flash, never a flicker (nothing faster than 3 Hz).
const SCARE_FADE := 2.5
## In front of the eyes (camera frame): a full-view glitch quad and the panel.
const SCARE_Z := -0.45

var _scare: Node3D
var _scare_glitch: StandardMaterial3D
var _scare_alpha := 0.0
var _scare_target := 0.0


## The scare on (at once) or off (a short fade). Head-locked, but it never
## moves the camera.
func scare(on: bool) -> void:
	if _scare == null:
		_build_scare()
	_scare_target = 1.0 if on else 0.0
	if on:
		_scare_alpha = 1.0
	_apply_scare()


## Whether the scare shows at all (fading counts).
func scare_shown() -> bool:
	return _scare != null and _scare.visible


func scare_text() -> String:
	return SCARE_TEXT if scare_shown() else ""


func _process(delta: float) -> void:
	if _scare_alpha > _scare_target:
		_scare_alpha = maxf(_scare_target, _scare_alpha - SCARE_FADE * delta)
		_apply_scare()


func _apply_scare() -> void:
	if _scare == null:
		return
	_scare.visible = _scare_alpha > 0.001
	_scare_glitch.albedo_color.a = _scare_alpha
	for l: Label3D in [_scare.get_node("Panel/Text") as Label3D]:
		l.modulate.a = _scare_alpha
		l.outline_modulate.a = _scare_alpha
	for n: String in ["Panel/Face", "Panel/Bar"]:
		var m := (_scare.get_node(n) as MeshInstance3D).material_override as StandardMaterial3D
		m.albedo_color.a = _scare_alpha


func _build_scare() -> void:
	_scare = Node3D.new()
	_scare.name = "Scare"
	_scare.position = Vector3(0, 0, SCARE_Z)
	add_child(_scare)
	var glitch := MeshInstance3D.new()
	glitch.name = "Glitch"
	var q := QuadMesh.new()
	q.size = Vector2(2.4, 1.8)
	glitch.mesh = q
	_scare_glitch = _overlay(Color(1, 1, 1, 1), glitch_texture(), 60)
	glitch.material_override = _scare_glitch
	_scare.add_child(glitch)
	var panel := Node3D.new()
	panel.name = "Panel"
	panel.position = Vector3(0, 0.02, 0.01)
	_scare.add_child(panel)
	var face := MeshInstance3D.new()
	face.name = "Face"
	var fq := QuadMesh.new()
	fq.size = Vector2(0.42, 0.14)
	face.mesh = fq
	face.material_override = _overlay(Color("#c0c0c0"), null, 61)
	panel.add_child(face)
	var bar := MeshInstance3D.new()
	bar.name = "Bar"
	var bq := QuadMesh.new()
	bq.size = Vector2(0.42, 0.03)
	bar.mesh = bq
	bar.position = Vector3(0, 0.07, 0.001)
	bar.material_override = _overlay(Color("#000080"), null, 62)
	panel.add_child(bar)
	var text := HouseLook.label(SCARE_TEXT, 0.036, Color("#000000"))
	text.name = "Text"
	text.no_depth_test = true
	text.render_priority = 63
	text.outline_size = 0
	text.position = Vector3(0, -0.01, 0.002)
	panel.add_child(text)


static func _overlay(color: Color, tex: Texture2D, priority: int) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.no_depth_test = true
	m.render_priority = priority
	m.albedo_color = color
	if tex != null:
		m.albedo_texture = tex
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_NEAREST
	return m


## The scare's glitch art: black, torn red and cyan scan bands and blocks
## (seeded: the same every time; still, never animated).
static func glitch_texture() -> ImageTexture:
	var img := Image.create(96, 72, false, Image.FORMAT_RGBA8)
	img.fill(Color(0.02, 0.0, 0.0, 0.92))
	var rng := RandomNumberGenerator.new()
	rng.seed = 0x0e
	for y in 72:
		var band := rng.randf()
		if band < 0.35:
			var shift := rng.randi_range(-12, 12)
			var c := Color(0.75 + rng.randf() * 0.25, 0.0, 0.05, 0.95) if band < 0.25 else Color(0.0, 0.7, 0.75, 0.9)
			for x in 96:
				if (x + shift) % 7 != 0:
					img.set_pixel(x, y, c * (0.55 + 0.45 * rng.randf()))
	for i in 18:
		var bx := rng.randi_range(0, 90)
		var by := rng.randi_range(0, 68)
		var c := Color(1, 1, 1, 0.9) if i % 5 == 0 else Color(0.9, 0.05, 0.1, 0.95)
		for y in range(by, mini(72, by + rng.randi_range(1, 4))):
			for x in range(bx, mini(96, bx + rng.randi_range(3, 16))):
				img.set_pixel(x, y, c)
	return ImageTexture.create_from_image(img)


## While playing: a clear view.
func show_play() -> void:
	_big.text = ""
	_sub.text = ""


## The found screen.
func show_found(title: String, name: String) -> void:
	_big.text = title
	_sub.text = name


## A short centred notice (session ended, …); the caller clears it.
func notice(text: String) -> void:
	_big.text = ""
	_sub.text = text


## The notice up now ("" for none).
func notice_text() -> String:
	return _sub.text if _big.text == "" else ""


func big_text() -> String:
	return _big.text

