## SET UP THIS HEADSET (`docs/loom-reinstall.md` §5): the lobby's panel for
## a station with no passcode — a headset whose APK has none baked in, or a
## run from the Godot editor. Pick a server ([method LinkBase.server_choices]:
## the committed one, and "This computer" on a desktop run), type the
## moderator passcode on the on-screen keyboard (the passcode alphabet, ⌫;
## physical keys too on a desktop), name the station (default "Headset" and
## the hex of the station id it mints, [method LinkBase.default_station_name]),
## then CONNECT ([method LinkBase.try_setup] — a working passcode is saved
## to `user://station.json`) or, on a desktop / editor run only, PLAY
## OFFLINE (on a headset it would be a guest's way out of the show: a game
## nobody is released from).
##
## Drawn on the [Lobby]'s panel and driven by it: [method buttons] for the
## pointer's hits, [method press] for a trigger / click, [method key_input]
## for a keyboard.
class_name SetupPanel
extends Node3D

## The moderator passcode alphabet (`core/server/auth.ts`: no 0 O 1 I L).
const ALPHABET := "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
## A passcode is 6 characters; an env-set one may be longer, up to this.
const CODE_LEN := 6
const CODE_MAX := 16
const NAME_MAX := 24
const KEYS_PER_ROW := 9
const KEY_SIZE := Vector2(0.17, 0.14)
const KEY_STEP := Vector2(0.2, 0.17)
const KEYS_TOP := 1.5
const SERVER_Y := 1.98
const FIELD_Y := 1.74
const ACTION_Y := 0.74
const FIELD_SIZE := Vector2(0.86, 0.14)
const ACTION_SIZE := Vector2(0.74, 0.17)
const CONNECTING := "Connecting…"
const EMPTY_CODE := "Type the moderator passcode."

var link: LinkBase
## `[{url, label}]` and the one chosen.
var choices: Array = []
var server_index := 0
var code := ""
var station := StationConfig.DEFAULT_NAME
## The field the keys type into: "code" or "name".
var field := "code"
## A CONNECT is out.
var busy := false
var message := ""
## The NAME started from the link (once).
var _named := false

var _looks := {}
var _message: Label3D
var _hover := ""


func _ready() -> void:
	var keys := key_ids()
	for i in keys.size():
		var id: String = keys[i]
		var text := "⌫" if id == "key:back" else ("SPACE" if id == "key:space" else id.substr(4))
		_looks[id] = Lobby.make_button(self, text, key_center(i), KEY_SIZE, 0.07 if id != "key:space" else 0.04)
	_looks["field:code"] = Lobby.make_button(self, "", Vector2(-0.46, FIELD_Y), FIELD_SIZE, 0.06)
	_looks["field:name"] = Lobby.make_button(self, "", Vector2(0.46, FIELD_Y), FIELD_SIZE, 0.06)
	_looks["connect"] = Lobby.make_button(self, "CONNECT", Vector2(-0.42, ACTION_Y), ACTION_SIZE, 0.07)
	_looks["offline"] = Lobby.make_button(self, "PLAY OFFLINE", Vector2(0.42, ACTION_Y), ACTION_SIZE, 0.06)
	(_looks["offline"] as Node3D).visible = offers_offline()
	_message = HouseLook.label("", 0.055, Color("#ff7a7a"))
	_message.position.y = 0.56
	add_child(_message)
	refresh()


## PLAY OFFLINE is offered only on a desktop / editor run.
static func offers_offline() -> bool:
	return StationConfig.offers_local()


## Every key, in keyboard order: the alphabet, then ⌫ and SPACE.
static func key_ids() -> Array:
	var out: Array = []
	for ch in ALPHABET:
		out.append("key:" + ch)
	out.append("key:back")
	out.append("key:space")
	return out


## Key `i`'s centre (panel coordinates): rows of [constant KEYS_PER_ROW].
static func key_center(i: int) -> Vector2:
	var c := i % KEYS_PER_ROW
	var r := i / KEYS_PER_ROW
	return Vector2((float(c) - (KEYS_PER_ROW - 1) / 2.0) * KEY_STEP.x, KEYS_TOP - r * KEY_STEP.y)


## The server buttons' centres and size for `n` choices, side by side.
static func server_slots(n: int) -> Array:
	var out: Array = []
	if n <= 0:
		return out
	var w := minf(1.1, 2.6 / n - 0.06)
	for i in n:
		out.append({"center": Vector2((float(i) - (n - 1) / 2.0) * (w + 0.06), SERVER_Y), "size": Vector2(w, 0.13)})
	return out


## What the passcode field shows: typed characters, `·` for the rest.
static func code_text(c: String) -> String:
	var shown := c
	while shown.length() < CODE_LEN:
		shown += "·"
	return "PASSCODE  " + shown


## Whether `ch` may go into the passcode: the alphabet, and on a keyboard
## any letter, digit or `-` (an env-set passcode), upper-cased.
static func code_char(ch: String) -> String:
	var u := ch.to_upper()
	if u.length() != 1:
		return ""
	if ALPHABET.contains(u) or (u >= "A" and u <= "Z") or (u >= "0" and u <= "9") or u == "-":
		return u
	return ""


func type_text(ch: String) -> void:
	if busy:
		return
	if field == "code":
		var c := code_char(ch)
		if c != "" and code.length() < CODE_MAX:
			code += c
	elif station.length() < NAME_MAX and ch.length() == 1 and ch.unicode_at(0) >= 32 and ch.unicode_at(0) < 127:
		station += ch
	message = ""
	refresh()


func backspace() -> void:
	if busy:
		return
	if field == "code":
		code = code.left(maxi(0, code.length() - 1))
	else:
		station = station.left(maxi(0, station.length() - 1))
	refresh()


## The pointer's targets: `[{id, center, size}]`.
func buttons() -> Array:
	var out: Array = []
	var slots := server_slots(choices.size())
	for i in slots.size():
		out.append({"id": "server:%d" % i, "center": slots[i]["center"], "size": slots[i]["size"]})
	out.append({"id": "field:code", "center": Vector2(-0.46, FIELD_Y), "size": FIELD_SIZE})
	out.append({"id": "field:name", "center": Vector2(0.46, FIELD_Y), "size": FIELD_SIZE})
	var keys := key_ids()
	for i in keys.size():
		out.append({"id": keys[i], "center": key_center(i), "size": KEY_SIZE})
	out.append({"id": "connect", "center": Vector2(-0.42, ACTION_Y), "size": ACTION_SIZE})
	if offers_offline():
		out.append({"id": "offline", "center": Vector2(0.42, ACTION_Y), "size": ACTION_SIZE})
	return out


## A button pressed (a trigger, a click).
func press(id: String) -> void:
	if id.begins_with("server:"):
		if not busy:
			server_index = clampi(int(id.substr(7)), 0, maxi(0, choices.size() - 1))
	elif id == "field:code" or id == "field:name":
		field = id.substr(6)
	elif id == "key:back":
		backspace()
	elif id == "key:space":
		type_text(" ")
	elif id.begins_with("key:"):
		type_text(id.substr(4))
	elif id == "connect":
		connect_now()
	elif id == "offline" and not busy and link != null and offers_offline():
		link.play_offline()
	refresh()


## CONNECT: try the chosen server with the typed passcode.
func connect_now() -> void:
	if busy or link == null:
		return
	if code == "":
		message = EMPTY_CODE
		refresh()
		return
	var url := str(choices[server_index]["url"]) if server_index < choices.size() else ""
	busy = true
	message = CONNECTING
	refresh()
	link.try_setup(url, code, station)


## [signal LinkBase.setup_answered]: done, or say why not (the passcode
## stays typed for a fix).
func answered(ok: bool, text: String) -> void:
	busy = false
	message = "" if ok else text
	refresh()


## A keyboard key (desktop): letters / digits type, Backspace, Tab switches
## the field, Enter connects. True when it was ours.
func key_input(k: InputEventKey) -> bool:
	match k.keycode:
		KEY_BACKSPACE:
			backspace()
			return true
		KEY_TAB:
			field = "name" if field == "code" else "code"
			refresh()
			return true
		KEY_ENTER, KEY_KP_ENTER:
			connect_now()
			return true
	if k.unicode >= 32 and k.unicode < 127:
		type_text(String.chr(k.unicode))
		return true
	return false


func set_hover(id: String) -> void:
	_hover = id
	_render_looks()


## Redraw from the state (the server buttons follow [member choices]).
func refresh() -> void:
	if _message == null:
		return
	if link != null and choices.is_empty():
		choices = link.server_choices()
	if link != null and not _named:
		_named = true
		if station == StationConfig.DEFAULT_NAME:
			station = link.default_station_name()
	server_index = clampi(server_index, 0, maxi(0, choices.size() - 1))
	var slots := server_slots(choices.size())
	for i in maxi(slots.size(), 8):
		var id := "server:%d" % i
		if i < slots.size():
			if not _looks.has(id):
				_looks[id] = Lobby.make_button(self, "", slots[i]["center"], slots[i]["size"], 0.05)
			var b: Node3D = _looks[id]
			b.visible = true
			b.position = Vector3(slots[i]["center"].x, slots[i]["center"].y, 0.0)
			Lobby.fit(b.get_node("Label") as Label3D, str(choices[i]["label"]), float(slots[i]["size"].x) - 0.04, 0.05)
		elif _looks.has(id):
			(_looks[id] as Node3D).visible = false
	Lobby.fit(_looks["field:code"].get_node("Label") as Label3D, code_text(code), FIELD_SIZE.x - 0.04, 0.06)
	Lobby.fit(_looks["field:name"].get_node("Label") as Label3D, "NAME  " + (station if station != "" else "…"), FIELD_SIZE.x - 0.04, 0.06)
	(_looks["connect"].get_node("Label") as Label3D).text = CONNECTING if busy else "CONNECT"
	_message.text = message
	# Connecting… is news; a refusal is an error.
	_message.modulate = Lobby.MESSAGE_NEWS if busy else Lobby.MESSAGE_ERROR
	_render_looks()


func _render_looks() -> void:
	for id: String in _looks:
		var on := false
		if id.begins_with("server:"):
			on = int(id.substr(7)) == server_index
		elif id.begins_with("field:"):
			on = id.substr(6) == field
		Lobby.set_look(_looks[id], id == _hover, on)
