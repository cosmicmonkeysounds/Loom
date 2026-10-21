## Head-locked text (kept low and small — a VR HUD must not crowd the view):
## the room you are in + "follow the golden arrows" while playing, and the
## big found screen ("REINSTALLATION COMPLETE" / "YOU FOUND GERALD").
## Parented to the camera by [Game].
class_name Hud
extends Node3D

var _room: Label3D
var _hint: Label3D
var _big: Label3D
var _sub: Label3D


func _ready() -> void:
	_room = _label(0.045, HouseLook.GOLD, Vector3(0, -0.36, -1.1))
	_hint = _label(0.03, HouseLook.TEAL_GLOW, Vector3(0, -0.42, -1.1))
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
	for l: Label3D in [_room, _hint, _big, _sub]:
		l.text = ""


## While playing: the room label and the instruction.
func show_play(room_label: String) -> void:
	_room.text = room_label
	_hint.text = "follow the golden arrows to the duck"
	_big.text = ""
	_sub.text = ""


func set_room(room_label: String) -> void:
	_room.text = room_label


## The found screen.
func show_found(title: String, name: String) -> void:
	_room.text = ""
	_hint.text = ""
	_big.text = title
	_sub.text = name


## A short centred notice (session ended, …); the caller clears it.
func notice(text: String) -> void:
	_big.text = ""
	_sub.text = text


# --- voice ---

var _mic: Label3D


## The voice link's line under the hint (🎤 LIVE / 🎤 MUTED / NO MIC; "" hides it).
func set_mic(text: String) -> void:
	if _mic == null:
		if text == "":
			return
		_mic = _label(0.026, HouseLook.TEAL_GLOW, Vector3(0, -0.465, -1.1))
	_mic.text = text


func mic_text() -> String:
	return _mic.text if _mic != null else ""


func big_text() -> String:
	return _big.text


func room_text() -> String:
	return _room.text
