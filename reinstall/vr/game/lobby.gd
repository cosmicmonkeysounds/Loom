## The lobby (`docs/loom-reinstall.md` §5): a dark room far from the house
## where a headset waits between programs. Floating panels say "SCAN YOUR
## PASS ON THE TABLET", name the station, show the connection state, and
## carry the joystick picker of candidates ([CandidatePicker]) with its
## hold-to-confirm fill bar.
##
## The panels stand [constant PANEL_DISTANCE] m north of [member spot] (the
## player faces north on arrival).
class_name Lobby
extends Node3D

## Where the player stands in the lobby (world frame), far from any house.
const SPOT := Vector3(0, 400, 0)
const PANEL_DISTANCE := 2.4
## Candidates listed at once (a window around the selection).
const VISIBLE_ROWS := 7

var picker := CandidatePicker.new()

var _title: Label3D
var _station: Label3D
var _status: Label3D
var _list: Label3D
var _hint: Label3D
var _message: Label3D
var _bar_fill: MeshInstance3D
var _message_left := 0.0
var _t := 0.0


func _ready() -> void:
	position = SPOT
	var floor_body := StaticBody3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(12, 0.2, 12)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position.y = -0.1
	floor_body.add_child(cs)
	add_child(floor_body)

	var floor_mesh := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(12, 12)
	floor_mesh.mesh = plane
	floor_mesh.material_override = HouseLook.floor_for("#10283a", false)
	add_child(floor_mesh)

	# A ring of teal posts so the dark has edges.
	for i in 12:
		var a := TAU * i / 12.0
		var post := MeshInstance3D.new()
		var box := BoxMesh.new()
		box.size = Vector3(0.12, 2.6, 0.12)
		post.mesh = box
		post.material_override = HouseLook.screen("#0f8a8a")
		post.position = Vector3(sin(a) * 5.0, 1.3, cos(a) * 5.0)
		add_child(post)

	var panel := Node3D.new()
	panel.position = Vector3(0, 0, -PANEL_DISTANCE)
	add_child(panel)
	_title = _text(panel, "SCAN YOUR PASS ON THE TABLET", 0.16, HouseLook.GOLD, 2.25)
	_station = _text(panel, "", 0.07, HouseLook.TEAL_GLOW, 1.98)
	_status = _text(panel, "", 0.05, HouseLook.INK.darkened(0.25), 1.84)
	_list = _text(panel, "", 0.075, HouseLook.INK, 1.42)
	_list.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_hint = _text(panel, "or pick a program:  stick up / down to choose, hold RIGHT for 1 s to start", 0.05, HouseLook.TEAL_GLOW, 0.86)
	_message = _text(panel, "", 0.07, Color("#ff7a7a"), 0.68)

	var track := MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(1.2, 0.04, 0.01)
	track.mesh = tb
	track.material_override = HouseLook.paint("#1a2a33")
	track.position = Vector3(0, 0.98, 0)
	panel.add_child(track)
	_bar_fill = MeshInstance3D.new()
	var fb := BoxMesh.new()
	fb.size = Vector3(1.2, 0.04, 0.012)
	_bar_fill.mesh = fb
	_bar_fill.material_override = HouseLook.glow_gold()
	_bar_fill.position = Vector3(0, 0.98, 0.002)
	_bar_fill.scale.x = 0.001
	panel.add_child(_bar_fill)
	_render_list()


func _text(parent: Node3D, text: String, height: float, color: Color, y: float) -> Label3D:
	var l := HouseLook.label(text, height, color)
	l.position.y = y
	parent.add_child(l)
	return l


func set_station(name: String) -> void:
	_station.text = "this headset: %s" % name


func set_status(text: String) -> void:
	_status.text = text


func set_candidates(players: Array) -> void:
	picker.set_items(eligible_only(players))
	_render_list()


## Only the programs the story marked for reinstallation (wave 16): the
## server's `eligible`, else (an older server) captured or restricted. The
## server refuses the rest anyway; the picker never offers them.
## The row's tag: in the Internet, or marked. Wave 18 (C7): the server's
## `marked` when it says (a mark no longer restricts), else an older
## server's `restricted`; a restricted program the server still lets in
## is marked too.
static func tag_of(p: Dictionary) -> String:
	if p.get("captured") == true:
		return "  [corrupted]"
	var marked: bool
	if p.get("marked") is bool:
		marked = p.get("marked") == true or (p.get("restricted") == true and p.get("eligible") == true)
	else:
		marked = p.get("restricted") == true
	return "  [marked]" if marked else ""


static func eligible_only(players: Array) -> Array:
	var out: Array = []
	for p in players:
		if not p is Dictionary:
			continue
		var ok: bool = p.get("eligible") if p.get("eligible") is bool else (p.get("captured") == true or p.get("restricted") == true)
		if ok:
			out.append(p)
	return out


## A message under the picker for a few seconds ("Nobody has that pass.").
func flash(text: String, seconds := 5.0) -> void:
	_message.text = text
	_message_left = seconds


## One frame of stick input; returns the confirmed candidate, else `{}`.
func tick(stick: Vector2, delta: float) -> Dictionary:
	_t += delta
	var before := picker.index
	var chosen := picker.update(stick, delta)
	if picker.index != before or not chosen.is_empty():
		_render_list()
	_bar_fill.scale.x = maxf(picker.progress(), 0.001)
	_bar_fill.position.x = -0.6 * (1.0 - picker.progress())
	_title.modulate.a = 0.75 + 0.25 * sin(_t * 2.5)
	if _message_left > 0.0:
		_message_left -= delta
		if _message_left <= 0.0:
			_message.text = ""
	return chosen


func _render_list() -> void:
	if _list == null:
		return
	var items := picker.items
	if items.is_empty():
		_list.text = "(no programs yet)"
		return
	var first := clampi(picker.index - VISIBLE_ROWS / 2, 0, maxi(items.size() - VISIBLE_ROWS, 0))
	var lines: PackedStringArray = []
	for i in range(first, mini(first + VISIBLE_ROWS, items.size())):
		var p: Dictionary = items[i]
		var mark := "> " if i == picker.index else "   "
		lines.append("%s%s%s" % [mark, p.get("name", p.get("id", "?")), tag_of(p)])
	_list.text = "\n".join(lines)
