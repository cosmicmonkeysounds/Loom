## In-game speech (wave 26, C6): the lines a game moment hands back (the
## void's chastising, the heart's monologue, a pickup's line) are captioned
## one at a time — head-locked under the HUD, or on a billboard over a prop
## (the heart) — each held for its reading time ([method reading_ms], the
## terminal engine's), with [constant LINE_GAP_MS] between lines, and
## spoken by the device voice ([method DisplayServer.tts_speak], which
## needs `audio/general/text_to_speech` on in `project.godot`). With no
## device voice ([method DisplayServer.tts_get_voices] empty — Horizon OS
## may ship none) the captions alone carry them.
##
## The voice says [method pronounce] of the line (the shared table,
## `res://config/pronounce.json`, C10: "Antivirus" → "Anti Virus"); the
## caption always shows the display text. While the voice speaks the mic is
## held shut ([member hold], → [method VoiceLink.hold_for]). No caption
## names the speaker: Trabolta may chastise before his reveal.
##
## Tests inject [member voices], [member speaker], [member stopper] and
## [member is_speaking].
class_name Speech
extends Node3D

## A line came up (`{from, text}`).
signal line_started(line: Dictionary)
## The queue ran dry.
signal finished

## Between two lines (ms) — the terminal's LINE_GAP_MS (C11).
const LINE_GAP_MS := 700.0
## The pronunciation table (a byte-identical copy of the terminal's, C10).
const PRONOUNCE_PATH := "res://config/pronounce.json"
## The device voice's volume (0–100): full, not Godot's default 50 — the
## headset plays it in a loud party room.
const TTS_VOLUME := 100
## A voice still speaking this long past its reading time is cut (ms).
const STUCK_AFTER_MS := 4000.0
## The head-locked caption (camera frame) and the prop billboard's lift (m).
const HEAD_AT := Vector3(0, -0.2, -1.1)
const HEAD_WIDTH := 0.9
const BILLBOARD_LIFT := 0.45
const BILLBOARD_WIDTH := 1.2

## Tests: `voices.call() -> Array` (of `{id, name, language}`) in place of the device's.
var voices: Callable = func() -> Array:
	return DisplayServer.tts_get_voices() if DisplayServer.has_feature(DisplayServer.FEATURE_TEXT_TO_SPEECH) else []
## Tests: `speaker.call(text, voice_id)` in place of [method DisplayServer.tts_speak].
var speaker: Callable = func(text: String, voice_id: String) -> void:
	DisplayServer.tts_speak(text, voice_id, TTS_VOLUME)
var stopper: Callable = func() -> void:
	if DisplayServer.has_feature(DisplayServer.FEATURE_TEXT_TO_SPEECH):
		DisplayServer.tts_stop()
var is_speaking: Callable = func() -> bool:
	return DisplayServer.has_feature(DisplayServer.FEATURE_TEXT_TO_SPEECH) and DisplayServer.tts_is_speaking()
## `hold.call(ms)`: hold the mic shut that long (+ its tail) — set by [Game].
var hold: Callable
## The node the head-locked caption hangs from (the camera).
var head: Node3D

## Lines waiting: `{from, text, anchor}` (anchor: a prop's node, or null = head-locked).
var _queue: Array = []
var _line: Dictionary = {}
var _elapsed := 0.0
var _hold_ms := 0.0
var _gap_left := 0.0
var _voiced := false
var _head_caption: Label3D
var _prop_caption: Label3D

static var _table: Array = []
static var _table_loaded := false


func _ready() -> void:
	_prop_caption = _caption(BILLBOARD_WIDTH, 0.06)
	_prop_caption.name = "PropCaption"
	_prop_caption.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	add_child(_prop_caption)


func _caption(width: float, height: float) -> Label3D:
	var l := HouseLook.label("", height, HouseLook.INK)
	l.no_depth_test = true
	l.render_priority = 52
	l.outline_render_priority = 51
	l.outline_size = 18
	l.outline_modulate = Color("#0a0a14")
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.width = width / l.pixel_size
	return l


func _head_label() -> Label3D:
	if _head_caption == null and head != null:
		_head_caption = _caption(HEAD_WIDTH, 0.034)
		_head_caption.name = "HeadCaption"
		_head_caption.position = HEAD_AT
		head.add_child(_head_caption)
	return _head_caption


## Queue `lines` (`[{from, text}]`, display text) captioned head-locked, or
## over `anchor` (a prop's node) when given.
func say(lines: Array, anchor: Node3D = null) -> void:
	for l: Variant in lines:
		if l is Dictionary and str((l as Dictionary).get("text", "")).strip_edges() != "":
			_queue.append({"from": str(l.get("from", "")), "text": str(l["text"]), "anchor": anchor})


## Whether a line is up or waiting.
func busy() -> bool:
	return not _line.is_empty() or not _queue.is_empty() or _gap_left > 0.0


## The caption up now ("" between lines).
func caption_text() -> String:
	if _line.is_empty():
		return ""
	return str(_line["text"])


## Whether the line up now hangs over a prop (else head-locked).
func on_prop() -> bool:
	return not _line.is_empty() and _line["anchor"] != null


## Drop everything (the lobby, a new session): the voice stops, the captions go.
func stop() -> void:
	_queue.clear()
	_end_line()
	_gap_left = 0.0
	if _voiced:
		stopper.call()
	_voiced = false


## Whether the device has a voice to speak with.
func has_voice() -> bool:
	return not (voices.call() as Array).is_empty()


func _process(delta: float) -> void:
	tick(delta)


## Advance by `delta` s (public for the tests).
func tick(delta: float) -> void:
	if not _line.is_empty():
		_elapsed += delta * 1000.0
		var speaking := _voiced and bool(is_speaking.call())
		if speaking and hold.is_valid():
			hold.call(maxf(delta * 1000.0, 100.0))
		var done := _elapsed >= _hold_ms and (not speaking or _elapsed >= _hold_ms + STUCK_AFTER_MS)
		if not done:
			return
		if speaking:
			stopper.call()
		_end_line()
		_gap_left = LINE_GAP_MS
		return
	if _gap_left > 0.0:
		_gap_left -= delta * 1000.0
		if _gap_left > 0.0:
			return
		_gap_left = 0.0
		if _queue.is_empty():
			finished.emit()
			return
	if _queue.is_empty():
		return
	_start_line(_queue.pop_front())


func _start_line(l: Dictionary) -> void:
	_line = l
	_elapsed = 0.0
	_hold_ms = reading_ms(str(l["text"]))
	var anchor: Variant = l["anchor"]
	if anchor is Node3D and is_instance_valid(anchor):
		_prop_caption.text = str(l["text"])
		_prop_caption.global_position = (anchor as Node3D).global_position + Vector3(0, float((anchor as Node3D).get_meta("height", 1.7)) + BILLBOARD_LIFT, 0)
		_prop_caption.visible = true
	else:
		_line["anchor"] = null
		var hc := _head_label()
		if hc != null:
			hc.text = str(l["text"])
	var list: Array = voices.call()
	_voiced = not list.is_empty()
	if _voiced:
		speaker.call(pronounce(str(l["text"])), pick_voice(list))
		if hold.is_valid():
			hold.call(_hold_ms)
	line_started.emit({"from": l["from"], "text": l["text"]})


func _end_line() -> void:
	_line = {}
	if _head_caption != null:
		_head_caption.text = ""
	if _prop_caption != null:
		_prop_caption.text = ""
		_prop_caption.visible = false


## The device voice to speak with: the first English one, else the first.
static func pick_voice(list: Array) -> String:
	for v: Variant in list:
		if v is Dictionary and str(v.get("language", "")).to_lower().begins_with("en"):
			return str(v.get("id", ""))
	return str((list[0] as Dictionary).get("id", "")) if not list.is_empty() and list[0] is Dictionary else ""


## How long a line takes to read (ms) — the terminal engine's `readingMs`.
static func reading_ms(text: String) -> float:
	return minf(8000.0, maxf(900.0, 62.0 * text.length()))


# --- the pronunciation table (C10) ----------------------------------------------


## The table's words, longest first (`[{word, say}]`; loaded once).
static func table() -> Array:
	if not _table_loaded:
		_table_loaded = true
		_table = parse_table(FileAccess.get_file_as_string(PRONOUNCE_PATH) if FileAccess.file_exists(PRONOUNCE_PATH) else "")
	return _table


## A table's JSON (`{version: 1, words: [{word, say}]}`) → its rows, longest
## word first; `[]` for anything else.
static func parse_table(text: String) -> Array:
	var json := JSON.new()  # not JSON.parse_string: junk logs nothing
	var parsed: Variant = json.data if text != "" and json.parse(text) == OK else null
	if not parsed is Dictionary or not (parsed as Dictionary).get("words") is Array:
		return []
	var rows: Array = []
	for w: Variant in parsed["words"]:
		if w is Dictionary and str(w.get("word", "")) != "" and w.get("say") is String:
			rows.append({"word": str(w["word"]), "say": str(w["say"])})
	rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return str(a["word"]).length() > str(b["word"]).length())
	return rows


## `s` with A–Z lowered and every other character kept: always `s`'s length.
static func ascii_lower(s: String) -> String:
	var out := ""
	for k in s.length():
		var u := s.unicode_at(k)
		out += char(u + 32) if u >= 0x41 and u <= 0x5a else s[k]
	return out


static func _boundary(c: String) -> bool:
	if c == "":
		return true
	var u := c.unicode_at(0)
	return not ((u >= 0x41 and u <= 0x5a) or (u >= 0x61 and u <= 0x7a) or (u >= 0x30 and u <= 0x39))


## `text` as the voice should say it: every whole-word, case-insensitive
## match of a table word (a boundary is any character outside [A-Za-z0-9],
## so "Anti-Virus" never matches and "Antivirus'" does; the longest word
## wins) replaced by its `say`, as written (C10).
static func pronounce(text: String, rows: Variant = null) -> String:
	var words: Array = rows if rows is Array else table()
	if words.is_empty():
		return text
	var out := ""
	var i := 0
	# A–Z only (C10, as the terminal and stagehand fold): Godot's to_lower()
	# may change a string's length, and the indexes into `text` would drift.
	var lower := ascii_lower(text)
	while i < text.length():
		var hit := false
		if i == 0 or _boundary(text[i - 1]):
			for w: Dictionary in words:
				var word := ascii_lower(str(w["word"]))
				var n := word.length()
				if lower.substr(i, n) == word and (i + n >= text.length() or _boundary(text[i + n])):
					out += str(w["say"])
					i += n
					hit = true
					break
		if not hit:
			out += text[i]
			i += 1
	return out
