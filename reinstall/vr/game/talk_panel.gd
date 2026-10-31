## The talkers' options (wave 49, [Descent]): a plain world panel near the
## prop, turned to the player, one row per option, chosen with [LobbyPointer]
## (the beam shows only while it is open, the row under it lights up, the
## trigger picks). Up to [constant HouseDescent.TALK_OPTIONS_MAX] rows; a game
## line, so the one text in the house besides captions. Built once, at the
## first deep walk; panel coordinates as [LobbyTiles]' (the panel faces +z).
## Wave 59: it stands wherever the way to the prop puts it, a wall included, so
## all of it draws over the house, under the HUD and the captions.
class_name TalkPanel
extends Node3D

## The panel's distance from the player's eyes (m), how far it stands to their
## right so the face stays in view, and how far under their eyes.
const FROM_EYE := 1.3
const ASIDE := 0.35
const UNDER_EYE := 0.25
const ROW := Vector2(1.2, 0.16)
const ROW_GAP := 0.03
const MARGIN := 0.05
const TEXT_H := 0.062
const BACKDROP := "#0a1f28"
## Draw order, all with no depth test ([method Hud._overlay]): under [Speech]'s
## captions and [Hud]; [LobbyPointer]'s beam goes over them.
const DRAW_BACKDROP := 46
const DRAW_ROW := 47
const DRAW_TEXT := 48

var _backdrop: MeshInstance3D
var _rows: Array[Node3D] = []
var _row_look: Material
var _row_lit: Material
## The rows up now, `{id, center, size}` ([method LobbyTiles.button_at]).
var _buttons: Array = []
var _hover := -1
## A press counts only after the trigger has been seen up: the pull that was
## already held when the panel came up picks nothing.
var _armed := false


## Make the rows (once).
func build() -> void:
	if not _rows.is_empty():
		return
	top_level = true
	_backdrop = Lobby._quad(Vector2.ONE, Hud._overlay(Color(BACKDROP), null, DRAW_BACKDROP))
	_backdrop.name = "Backdrop"
	_backdrop.position.z = -0.03
	add_child(_backdrop)
	_row_look = Hud._overlay(Color(Lobby.BG), null, DRAW_ROW)
	_row_lit = Hud._overlay(Color(Lobby.BG_HOVER), null, DRAW_ROW)
	for i in HouseDescent.TALK_OPTIONS_MAX:
		var row := Lobby.make_button(self, "", Vector2.ZERO, ROW, TEXT_H)
		row.name = "Row_%d" % i
		(row.get_node("Bg") as MeshInstance3D).material_override = _row_look
		var l := row.get_node("Label") as Label3D
		l.no_depth_test = true
		l.render_priority = DRAW_TEXT
		l.outline_render_priority = DRAW_TEXT - 1
		_rows.append(row)
	visible = false


## Where the panel stands for a prop at `prop` (world) and eyes at `eye`: a little
## to the side of the way between them, turned to the player, upright.
static func place(prop: Vector3, eye: Vector3) -> Transform3D:
	var to := Vector3(prop.x - eye.x, 0.0, prop.z - eye.z)
	var dir := to.normalized() if to.length() > 0.01 else Vector3.FORWARD
	var right := dir.cross(Vector3.UP)
	var at := eye + dir * FROM_EYE + right * ASIDE - Vector3(0.0, UNDER_EYE, 0.0)
	var facing := Vector3(at.x - eye.x, 0.0, at.z - eye.z)
	return Transform3D(Basis.looking_at(facing.normalized() if facing.length() > 0.01 else dir, Vector3.UP), at)


## Show `texts`, one row each, at `at` (a world transform, facing +z).
func open(texts: Array, at: Transform3D) -> void:
	build()
	var n := mini(texts.size(), _rows.size())
	var h := n * ROW.y + (n - 1) * ROW_GAP
	_buttons = []
	for i in _rows.size():
		var row := _rows[i]
		row.visible = i < n
		if i >= n:
			continue
		var c := Vector2(0.0, h / 2.0 - ROW.y / 2.0 - i * (ROW.y + ROW_GAP))
		row.position = Vector3(c.x, c.y, 0.0)
		Lobby.fit(row.get_node("Label") as Label3D, str(texts[i]), ROW.x - 0.08, TEXT_H)
		_light(row, false)
		_buttons.append({"id": str(i), "center": c, "size": ROW})
	_backdrop.scale = Vector3(ROW.x + 2.0 * MARGIN, h + 2.0 * MARGIN, 1.0)
	global_transform = at
	_hover = -1
	_armed = false
	visible = true


## Take the panel down.
func close() -> void:
	visible = false
	_buttons = []
	_hover = -1


func is_open() -> bool:
	return visible


## How many rows are up.
func row_count() -> int:
	return _buttons.size()


## The row under the beam now (-1: none).
func hovered() -> int:
	return _hover


## The row a pointer's ray ([method LobbyPointer.poll]) is on, lit up:
## `{index, at}` (`index` -1 on the panel but off the rows), `{}` off it. A row
## counts for a press only once the trigger has been seen up.
func aim(state: Dictionary) -> Dictionary:
	if not visible or state.get("active", false) != true:
		_set_hover(-1)
		return {}
	if state.get("down", false) != true:
		_armed = true
	var h := LobbyTiles.ray_to_panel(state["origin"], state["dir"], global_transform)
	if h.is_empty() or absf((h["point"] as Vector2).x) > _backdrop.scale.x / 2.0 or absf((h["point"] as Vector2).y) > _backdrop.scale.y / 2.0:
		_set_hover(-1)
		return {}
	var id := LobbyTiles.button_at(h["point"], _buttons)
	var i := id.to_int() if id != "" else -1
	_set_hover(i)
	return {"index": i if _armed else -1, "at": h["at"]}


func _set_hover(i: int) -> void:
	if i == _hover:
		return
	_hover = i
	for k in _rows.size():
		_light(_rows[k], k == i)


func _light(row: Node3D, on: bool) -> void:
	(row.get_node("Bg") as MeshInstance3D).material_override = _row_lit if on else _row_look


## Where row `i`'s centre stands in the world (for aiming at it).
func row_world(i: int) -> Vector3:
	var c: Vector2 = _buttons[i]["center"]
	return global_transform * Vector3(c.x, c.y, 0.0)


## Row `i`'s text.
func row_text(i: int) -> String:
	return (_rows[i].get_node("Label") as Label3D).text
