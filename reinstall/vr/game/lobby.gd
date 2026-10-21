## The lobby (`docs/loom-reinstall.md` §5): a dark room far from the house
## where a headset waits between programs. One floating panel, three views:
##
## - **pick** — PICK YOUR PROGRAM: a tile per program the story marked for
##   reinstallation (its profile picture off [AvatarCache], its name, its
##   tag), a grid sized for the list ([LobbyTiles], pages past 8). Point the
##   laser and pull the trigger, click it (desktop), or walk the tiles with
##   the stick ([CandidatePicker]: flicks move, hold RIGHT 1 s picks).
## - **confirm** — "Start as <name>?" with START / BACK (the same three
##   ways; on START the game begins the program). The tablet's *Send to
##   headset* still lands whatever the view.
## - **setup** — SET UP THIS HEADSET ([SetupPanel]) while the station has
##   no passcode ([method LinkBase.needs_setup]).
##
## Above it: the station's name and the connection state; under it a line
## for errors ("Nobody has that pass."), and a ⚙ that forgets a setup made
## here (hold it 2 s). The panel stands [constant PANEL_DISTANCE] m north of
## [constant SPOT] (the player faces north on arrival).
class_name Lobby
extends Node3D

## Where the player stands in the lobby (world frame), far from any house.
const SPOT := Vector3(0, 400, 0)
const PANEL_DISTANCE := 2.4
const TITLE := "PICK YOUR PROGRAM"
const EMPTY := "Nobody is marked for reinstallation yet."
const HINT := "point + trigger · or stick, hold RIGHT 1 s · or click"
## Seconds the ⚙ must be held to forget the setup.
const FORGET_HOLD := 2.0
## A name longer than this is cut on its tile (it must fit the tile's width
## at [constant NAME_HEIGHT]).
const NAME_CHARS := 16
const NAME_HEIGHT := 0.044
## The confirm card's buttons and the ⚙ (panel coordinates).
const START_AT := Vector2(-0.36, 1.06)
const BACK_AT := Vector2(0.36, 1.06)
const CARD_BUTTON := Vector2(0.56, 0.2)
const GEAR_AT := Vector2(1.3, 0.44)
const GEAR_SIZE := Vector2(0.16, 0.16)
const PAGE_Y := 0.64

const BG := "#123844"
## The panel's own backdrop: the ring of posts never shows through the
## tiles, the keyboard or the card.
const BACKDROP := "#0a1f28"
const BACKDROP_SIZE := Vector2(3.0, 2.48)
const BACKDROP_Y := 1.44
## The lobby's message line: an error (a refused begin, no map) or news.
const MESSAGE_ERROR := Color("#ff7a7a")
const MESSAGE_NEWS := Color("#bfe9e4")
const BG_HOVER := "#2a7384"

var picker := CandidatePicker.new()
## The confirm card's START / BACK ([member picker]'s twin, 2 columns).
var card_picker := CandidatePicker.new()
var link: LinkBase
var avatars: AvatarCache
## Avatar key → picture URL ([method LinkBase.avatar_url]).
var url_of: Callable = func(_key: String) -> String: return ""

var _title: Label3D
var _station: Label3D
var _status: Label3D
var _hint: Label3D
var _message: Label3D
var _empty: Label3D
var _page_label: Label3D
var _bar_track: MeshInstance3D
var _bar_fill: MeshInstance3D
var _panel: Node3D
var _grid: Node3D
var _tiles: Array = []  # the page's tile nodes, LobbyTiles.PER_PAGE of them
var _card: Node3D
var _card_text: Label3D
var _card_picture: Sprite3D
var _card_initials: Label3D
var _card_tag: Label3D
var _setup: SetupPanel
var _buttons: Array = []  # {id, center, size} of the view, for hits
var _looks := {}  # button id → its node (for hover)
var _gear: Node3D
var _gear_label: Label3D
var _message_left := 0.0
var _t := 0.0
var _view := "pick"
## The program the confirm card asks about (`{}` = no card).
var _confirming: Dictionary = {}
## START pressed with the laser / mouse: handed out by the next [method tick].
var _chosen: Dictionary = {}
var _hover := ""
var _gear_t := 0.0
var _layout := LobbyTiles.layout(0)
## The view last printed to the log.
var _announced := ""


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

	_panel = Node3D.new()
	_panel.name = "Panel"
	_panel.position = Vector3(0, 0, -PANEL_DISTANCE)
	add_child(_panel)
	var backdrop := _quad(BACKDROP_SIZE, HouseLook.screen(BACKDROP))
	backdrop.name = "Backdrop"
	backdrop.position = Vector3(0, BACKDROP_Y, -0.03)
	_panel.add_child(backdrop)
	_title = _text(_panel, TITLE, 0.15, HouseLook.GOLD, 2.46)
	_station = _text(_panel, "", 0.065, HouseLook.TEAL_GLOW, 2.31)
	_status = _text(_panel, "", 0.05, HouseLook.INK.darkened(0.25), 2.2)
	_empty = _text(_panel, "", 0.075, HouseLook.INK, LobbyTiles.GRID_Y)
	_page_label = _text(_panel, "", 0.05, HouseLook.TEAL_GLOW, PAGE_Y)
	_hint = _text(_panel, HINT, 0.045, HouseLook.TEAL_GLOW, 0.46)
	_message = _text(_panel, "", 0.065, MESSAGE_ERROR, 0.34)

	_bar_track = MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(1.2, 0.04, 0.01)
	_bar_track.mesh = tb
	_bar_track.material_override = HouseLook.paint("#1a2a33")
	_bar_track.position = Vector3(0, 0.55, 0)
	_panel.add_child(_bar_track)
	_bar_fill = MeshInstance3D.new()
	var fb := BoxMesh.new()
	fb.size = Vector3(1.2, 0.04, 0.012)
	_bar_fill.mesh = fb
	_bar_fill.material_override = HouseLook.glow_gold()
	_bar_fill.position = Vector3(0, 0.55, 0.002)
	_bar_fill.scale.x = 0.001
	_panel.add_child(_bar_fill)

	_grid = Node3D.new()
	_grid.name = "Grid"
	_panel.add_child(_grid)
	for i in LobbyTiles.PER_PAGE:
		_tiles.append(_make_tile(i))

	_card = Node3D.new()
	_card.name = "Card"
	_panel.add_child(_card)
	var card_bg := _quad(Vector2(1.7, 0.95), HouseLook.screen("#0b2630"))
	card_bg.position = Vector3(0, LobbyTiles.GRID_Y, -0.01)
	_card.add_child(card_bg)
	_card_text = _text(_card, "", 0.09, HouseLook.GOLD, 1.68)
	_card_picture = _sprite(0.3)
	_card_picture.position = Vector3(0, 1.45, 0.004)
	_card.add_child(_card_picture)
	_card_initials = HouseLook.label("", 0.14, HouseLook.GOLD)
	_card_initials.name = "Initials"
	_card_initials.position = Vector3(0, 1.45, 0.004)
	_card.add_child(_card_initials)
	_card_tag = HouseLook.label("", 0.045, HouseLook.TEAL_GLOW)
	_card_tag.name = "Tag"
	_card_tag.position = Vector3(0, 1.26, 0.004)
	_card.add_child(_card_tag)
	_looks["start"] = make_button(_card, "START", START_AT, CARD_BUTTON, 0.08)
	_looks["back"] = make_button(_card, "BACK", BACK_AT, CARD_BUTTON, 0.08)
	_card.visible = false
	card_picker.columns = 2
	card_picker.set_items([{"id": "start"}, {"id": "back"}])

	_looks["prev"] = make_button(_panel, "◀", Vector2(-0.55, PAGE_Y), Vector2(0.18, 0.12), 0.06)
	_looks["next"] = make_button(_panel, "▶", Vector2(0.55, PAGE_Y), Vector2(0.18, 0.12), 0.06)
	_gear = make_button(_panel, "⚙", GEAR_AT, GEAR_SIZE, 0.09)
	_looks["gear"] = _gear
	_gear_label = _text(_panel, "", 0.04, HouseLook.INK.darkened(0.2), GEAR_AT.y - 0.13)
	_gear_label.position.x = GEAR_AT.x - 0.1

	_setup = SetupPanel.new()
	_setup.name = "Setup"
	_setup.visible = false
	_panel.add_child(_setup)
	_render()


# --- building blocks -------------------------------------------------------------


func _text(parent: Node3D, text: String, height: float, color: Color, y: float) -> Label3D:
	var l := HouseLook.label(text, height, color)
	l.position.y = y
	parent.add_child(l)
	return l


static func _quad(size: Vector2, material: Material) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = size
	m.mesh = q
	m.material_override = material
	m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return m


static func _sprite(side: float) -> Sprite3D:
	var s := Sprite3D.new()
	s.name = "Picture"
	s.shaded = false
	s.alpha_cut = SpriteBase3D.ALPHA_CUT_DISCARD
	s.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	s.set_meta("side", side)
	return s


## A flat button on `parent` at panel point `center`: a teal quad (`Bg`), a
## gold ring behind it (`Ring`, shown when on), its `Label`. Shared with
## [SetupPanel].
static func make_button(parent: Node3D, text: String, center: Vector2, size: Vector2, text_height: float) -> Node3D:
	var n := Node3D.new()
	n.position = Vector3(center.x, center.y, 0.0)
	var ring := _quad(size + Vector2(0.04, 0.04), HouseLook.glow_gold())
	ring.name = "Ring"
	ring.position.z = -0.003
	ring.visible = false
	n.add_child(ring)
	var bg := _quad(size, HouseLook.screen(BG))
	bg.name = "Bg"
	n.add_child(bg)
	var l := HouseLook.label(text, text_height, HouseLook.INK)
	l.name = "Label"
	l.position.z = 0.004
	n.add_child(l)
	parent.add_child(n)
	return n


## Set `label` to `text` at `height` m, shrunk to fit `max_width` m.
static func fit(label: Label3D, text: String, max_width: float, height: float) -> void:
	label.text = text
	var font: Font = label.font if label.font != null else ThemeDB.fallback_font
	var w := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, label.font_size).x
	label.pixel_size = height / float(label.font_size)
	if w > 0.0 and w * label.pixel_size > max_width:
		label.pixel_size = max_width / w


## A button's look: lit while pointed at (`hover`), ringed while `on`.
static func set_look(button: Node3D, hover: bool, on: bool) -> void:
	if button == null:
		return
	(button.get_node("Bg") as MeshInstance3D).material_override = HouseLook.screen(BG_HOVER if hover else BG)
	(button.get_node("Ring") as MeshInstance3D).visible = on


func _make_tile(i: int) -> Node3D:
	var size := Vector2(LobbyTiles.TILE_W, LobbyTiles.TILE_H)
	var t := make_button(_grid, "", Vector2.ZERO, size, NAME_HEIGHT)
	t.name = "Tile_%d" % i
	var pic := _sprite(0.3)
	pic.position = Vector3(0, 0.08, 0.004)
	t.add_child(pic)
	var initials := HouseLook.label("", 0.14, HouseLook.GOLD)
	initials.name = "Initials"
	initials.position = Vector3(0, 0.08, 0.004)
	t.add_child(initials)
	var label := t.get_node("Label") as Label3D
	label.position.y = -0.15
	var tag := HouseLook.label("", 0.036, HouseLook.TEAL_GLOW)
	tag.name = "Tag"
	tag.position = Vector3(0, -0.22, 0.004)
	t.add_child(tag)
	t.visible = false
	return t


# --- the link ----------------------------------------------------------------------


## Wire the lobby to `l` (setup, forget) and share the ghosts' picture
## cache `cache` (one fetch per picture for the whole game).
func attach(l: LinkBase, cache: AvatarCache) -> void:
	link = l
	url_of = l.avatar_url
	avatars = cache
	if avatars != null and not avatars.loaded.is_connected(_on_picture):
		avatars.loaded.connect(_on_picture)
	if not l.setup_answered.is_connected(_on_setup_answered):
		l.setup_answered.connect(_on_setup_answered)
	_setup.link = l
	_render()


func set_station(name: String) -> void:
	_station.text = "this headset: %s" % name


func set_status(text: String) -> void:
	_status.text = text
	_render()


func set_candidates(players: Array) -> void:
	picker.set_items(eligible_only(players))
	if not _confirming.is_empty():
		var still := false
		for p: Dictionary in picker.items:
			if str(p.get("id", "")) == str(_confirming.get("id", "")):
				_confirming = p
				still = true
		if not still:
			_confirming = {}  # gone (released, unmarked): back to the tiles
	_render()


## Only the programs the story marked for reinstallation (wave 16): the
## server's `eligible`, else (an older server) captured or restricted. The
## server refuses the rest anyway; the picker never offers them.
## The row's tag: in the Internet, or marked. Wave 18 (C7): the server's
## `marked` when it says (a mark no longer restricts), else an older
## server's `restricted`; a restricted program the server still lets in
## is marked too. After an ending the server says `favour` (and `marked`
## false for everyone): the reinstallation is a party favour.
static func tag_of(p: Dictionary) -> String:
	if p.get("captured") == true:
		return "  [corrupted]"
	if p.get("favour") == true:
		return "  [party favour]"
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


## A program's name on its tile, cut at [constant NAME_CHARS].
static func tile_name(p: Dictionary) -> String:
	var n := str(p.get("name", p.get("id", "?")))
	return n if n.length() <= NAME_CHARS else n.left(NAME_CHARS - 1) + "…"


## Up to two initials for a tile with no picture ("MS Paint" → "MP").
static func initials_of(name: String) -> String:
	var out := ""
	for w in name.split(" ", false):
		out += w.left(1).to_upper()
		if out.length() == 2:
			break
	return out if out != "" else "?"


## A message under the panel for a few seconds ("Nobody has that pass.").
## A line under the panel for `seconds`: red when `error`, else news.
func flash(text: String, seconds := 5.0, error := false) -> void:
	_message.text = text
	_message.modulate = MESSAGE_ERROR if error else MESSAGE_NEWS
	_message_left = seconds


## The view up: "setup", "confirm" or "pick".
func view() -> String:
	return _view


## The program the confirm card asks about (`{}` when there is no card).
func confirming() -> Dictionary:
	return _confirming


## The button the pointer is over ("" = none).
func hovered() -> String:
	return _hover


## The ⚙ hold so far, 0 → 1.
func forget_progress() -> float:
	return clampf(_gear_t / FORGET_HOLD, 0.0, 1.0)


# --- input ---------------------------------------------------------------------------


## Open the confirm card for `p`.
func ask(p: Dictionary) -> void:
	if p.is_empty():
		return
	_confirming = p
	card_picker.index = 0
	card_picker.disarm()  # a hold that opened the card must let go first
	_render()


## Back from the card to the tiles.
func cancel() -> void:
	_confirming = {}
	picker.disarm()
	_render()


## Back to the tiles with nothing half-done (a session starting or ending:
## a card left up must not start a program by itself later).
func reset() -> void:
	_confirming = {}
	_chosen = {}
	_gear_t = 0.0
	_hover = ""
	# A line flashed before a session (Starting X…) is old news once back.
	_message.text = ""
	_message_left = 0.0
	picker.disarm()
	_render()


## A button was pressed (the laser's trigger, a click): `tile:<n>`,
## `start`, `back`, `prev`, `next`, or one of the [SetupPanel]'s.
func press(id: String) -> void:
	if _view == "setup":
		_setup.press(id)
		_render()
		return
	if id.begins_with("tile:"):
		var i := int(id.substr(5))
		if i >= 0 and i < picker.items.size():
			picker.index = i
			ask(picker.items[i])
	elif id == "start" and not _confirming.is_empty():
		_chosen = _confirming
		_confirming = {}
		_render()
	elif id == "back":
		cancel()
	elif id == "prev" or id == "next":
		var per: int = _layout["per_page"]
		var pages: int = _layout["pages"]
		if pages > 1:
			var page := posmod(LobbyTiles.page_of(picker.index, per) + (1 if id == "next" else -1), pages)
			picker.index = page * per
			_render()


## The button under a ray (`state` from [method LobbyPointer.poll]): `{id,
## at}` (`id` "" off the buttons, but on the panel), or `{}` off the panel.
func hit(state: Dictionary) -> Dictionary:
	if state.get("active", false) != true or not is_visible_in_tree():
		return {}
	var h := LobbyTiles.ray_to_panel(state["origin"], state["dir"], _panel.global_transform)
	if h.is_empty():
		return {}
	return {"id": LobbyTiles.button_at(h["point"], _buttons), "at": h["at"], "point": h["point"]}


## One frame of the pointer: hover, press on the trigger / click, the ⚙
## hold. Returns the hit ([method hit]) for the beam.
func aim(state: Dictionary, delta: float) -> Dictionary:
	var h := hit(state)
	var id := str(h.get("id", ""))
	if id != _hover:
		_hover = id
		_render_looks()
	if id == "gear" and state.get("down", false) == true:
		_gear_t += delta
		if _gear_t >= FORGET_HOLD:
			_gear_t = 0.0
			if link != null:
				link.forget_setup()
			flash("This headset's setup is forgotten.")
			_render()
	elif _gear_t > 0.0:
		_gear_t = 0.0
	if id != "" and id != "gear" and state.get("pressed", false) == true:
		press(id)
	_gear_label.text = ("forget this setup: hold %d s" % int(FORGET_HOLD)) if id == "gear" else ""
	return h


## One frame of stick input; returns the program to begin (START), else `{}`.
func tick(stick: Vector2, delta: float) -> Dictionary:
	_t += delta
	_sync_view()
	var out := {}
	if not _chosen.is_empty():
		out = _chosen
		_chosen = {}
	elif _view == "pick":
		var before := picker.index
		var picked := picker.update(stick, delta)
		if not picked.is_empty():
			ask(picked)
		elif picker.index != before:
			_render()
	elif _view == "confirm":
		var before := card_picker.index
		var got := card_picker.update(stick, delta)
		if card_picker.index != before:
			_render_looks()
		if got.get("id") == "start":
			out = _confirming
			_confirming = {}
			_render()
		elif got.get("id") == "back":
			cancel()
	var p := 0.0
	if _view == "pick":
		p = picker.progress()
	elif _view == "confirm":
		p = card_picker.progress()
	if _gear_t > 0.0:
		p = forget_progress()
	_bar_fill.scale.x = maxf(p, 0.001)
	_bar_fill.position.x = -0.6 * (1.0 - maxf(p, 0.001))
	_title.modulate.a = 0.75 + 0.25 * sin(_t * 2.5)
	if _message_left > 0.0:
		_message_left -= delta
		if _message_left <= 0.0:
			_message.text = ""
	return out


## Desktop keys: the SET UP panel types; Enter picks / starts, Backspace
## goes back. (The stick keys — W/S, A/D, ←/→ — come through the rig.)
func _unhandled_input(event: InputEvent) -> void:
	if not is_visible_in_tree() or not event is InputEventKey or not event.pressed:
		return
	var k := event as InputEventKey
	if _view == "setup":
		if _setup.key_input(k):
			get_viewport().set_input_as_handled()
			_render()
		return
	if k.keycode == KEY_ENTER or k.keycode == KEY_KP_ENTER:
		if _view == "confirm":
			press("start")
		else:
			ask(picker.selected())
	elif k.keycode == KEY_BACKSPACE and _view == "confirm":
		cancel()


func _on_setup_answered(ok: bool, message: String) -> void:
	_setup.answered(ok, message)
	if ok and link != null:
		set_station(link.station_name())
		flash("This headset is set up.", 4.0)
	_render()


func _on_picture(url: String, _tex: Texture2D) -> void:
	if url != "":
		_render()


# --- drawing ---------------------------------------------------------------------------


func _sync_view() -> void:
	var v := "pick"
	if link != null and link.needs_setup():
		v = "setup"
	elif not _confirming.is_empty():
		v = "confirm"
	if v != _view:
		_view = v
		_render()


func _picture(key: Variant) -> Texture2D:
	if avatars == null or not key is String or str(key) == "":
		return null
	var url := str(url_of.call(str(key)))
	if url == "":
		return null
	var tex := avatars.texture(url)
	if tex == null:
		avatars.fetch(url)
	return tex


static func _show(sprite: Sprite3D, tex: Texture2D) -> void:
	sprite.texture = tex
	sprite.visible = tex != null
	if tex != null:
		sprite.pixel_size = float(sprite.get_meta("side", 0.3)) / float(maxi(1, maxi(tex.get_width(), tex.get_height())))


func _render() -> void:
	if _grid == null:
		return
	var v := "pick"
	if link != null and link.needs_setup():
		v = "setup"
	elif not _confirming.is_empty():
		v = "confirm"
	_view = v
	if v != _announced and link != null:
		# The editor's Output says where the lobby is.
		_announced = v
		print("reinstall-vr: lobby — %s" % ("SET UP THIS HEADSET" if v == "setup" else ("Start as %s?" % _confirming.get("name", "") if v == "confirm" else TITLE)))
	_buttons = []
	var items := picker.items
	_layout = LobbyTiles.layout(items.size())
	var cols: int = _layout["cols"]
	var rows: int = _layout["rows"]
	var per: int = _layout["per_page"]
	var pages: int = _layout["pages"]
	picker.columns = maxi(1, cols)
	var page := LobbyTiles.page_of(picker.index, per)
	var on_page := LobbyTiles.count_on_page(items.size(), page, per)

	_title.text = "SET UP THIS HEADSET" if v == "setup" else TITLE
	_station.visible = v != "setup"  # the panel's NAME field says it
	_setup.visible = v == "setup"
	_grid.visible = v == "pick"
	_card.visible = v == "confirm"
	_hint.visible = v != "setup"
	_bar_track.visible = v != "setup"
	_bar_fill.visible = v != "setup"
	_empty.text = EMPTY if v == "pick" and items.is_empty() else ""
	var paged := v == "pick" and pages > 1
	_page_label.text = "page %d / %d" % [page + 1, pages] if paged else ""
	(_looks["prev"] as Node3D).visible = paged
	(_looks["next"] as Node3D).visible = paged
	_gear.visible = v != "setup" and link != null and link.can_forget_setup()
	for id: String in _looks.keys():
		if id.begins_with("tile:"):
			_looks.erase(id)  # tiles are reused page to page
	if v == "setup":
		_setup.refresh()
		_buttons = _setup.buttons()
	elif v == "pick":
		for slot in LobbyTiles.PER_PAGE:
			var t: Node3D = _tiles[slot]
			t.visible = slot < on_page
			if slot >= on_page:
				continue
			var i := page * per + slot
			var p: Dictionary = items[i]
			var c := LobbyTiles.tile_center(slot, cols, rows)
			t.position = Vector3(c.x, c.y, 0.0)
			fit(t.get_node("Label") as Label3D, tile_name(p), LobbyTiles.TILE_W - 0.04, NAME_HEIGHT)
			(t.get_node("Tag") as Label3D).text = tag_of(p).strip_edges()
			var tex := _picture(p.get("avatar"))
			_show(t.get_node("Picture") as Sprite3D, tex)
			(t.get_node("Initials") as Label3D).text = "" if tex != null else initials_of(str(p.get("name", "")))
			_looks["tile:%d" % i] = t
			_buttons.append({"id": "tile:%d" % i, "center": c, "size": Vector2(LobbyTiles.TILE_W, LobbyTiles.TILE_H)})
		if paged:
			_buttons.append({"id": "prev", "center": Vector2(-0.55, PAGE_Y), "size": Vector2(0.18, 0.12)})
			_buttons.append({"id": "next", "center": Vector2(0.55, PAGE_Y), "size": Vector2(0.18, 0.12)})
	else:
		fit(_card_text, "Start as %s?" % str(_confirming.get("name", _confirming.get("id", "?"))), 1.6, 0.09)
		var card_tex := _picture(_confirming.get("avatar"))
		_show(_card_picture, card_tex)
		_card_initials.text = "" if card_tex != null else initials_of(str(_confirming.get("name", "")))
		_card_tag.text = tag_of(_confirming).strip_edges()
		_buttons.append({"id": "start", "center": START_AT, "size": CARD_BUTTON})
		_buttons.append({"id": "back", "center": BACK_AT, "size": CARD_BUTTON})
	if _gear.visible:
		_buttons.append({"id": "gear", "center": GEAR_AT, "size": GEAR_SIZE})
	_render_looks()


func _render_looks() -> void:
	if _view == "setup":
		_setup.set_hover(_hover)
		return
	for id: String in _looks:
		var on := false
		if id.begins_with("tile:"):
			on = _view == "pick" and int(id.substr(5)) == picker.index
		elif id == "start" or id == "back":
			on = _view == "confirm" and card_picker.selected().get("id") == id
		set_look(_looks[id], id == _hover, on)


## The tile node showing program `index` (null when it isn't on the page).
func tile_node(index: int) -> Node3D:
	var per: int = _layout["per_page"]
	if per <= 0 or index < 0 or index >= picker.items.size() or LobbyTiles.page_of(index, per) != LobbyTiles.page_of(picker.index, per):
		return null
	return _tiles[index % per]


## The panel's global transform (tests aim at it).
func panel_transform() -> Transform3D:
	return _panel.global_transform


## The SET UP panel (tests type on it).
func setup_panel() -> SetupPanel:
	return _setup
