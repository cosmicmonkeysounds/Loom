@icon("res://addons/loom/icons/loom_typewriter.svg")
## Per-character text reveal for any [RichTextLabel] — the standard
## dialogue-box typewriter, as a drop-in node.
##
## UI-agnostic by design: it drives [member RichTextLabel.visible_characters]
## on whatever label you point it at, so it works inside any layout, theme,
## or custom dialogue box, and BBCode markup is revealed correctly (tags
## are never "typed").
##
## Point [member story] at a [LoomStory] (or let it find one) and every
## `line_emitted` plays automatically; while typing it [method
## LoomStory.hold]s the story so an auto-advancing story cannot run past a
## line the player is still reading. The usual input flow is:
##
## [codeblock]
## func _on_continue_pressed() -> void:
##     if typewriter.is_typing():
##         typewriter.skip()      # first tap: reveal the whole line
##     else:
##         _advance_story()       # second tap: next line
## [/codeblock]
class_name LoomTypewriter
extends Node

## The reveal has begun; `text` is the full line.
signal started(text: String)
## One character became visible.
signal character_shown(index: int, character: String)
## The whole line is visible — by pacing or by [method skip].
signal finished

## The label whose text is revealed.
@export var target: RichTextLabel = null
## Story to attach to. When null, the nearest [LoomStory] is found at
## ready ([method LoomStory.find_for]).
@export var story: LoomStory = null
## Play every story line into [member target] automatically. Turn off to
## drive [method play_text] yourself (e.g. one typewriter per portrait).
@export var auto_play_lines := true
## Hold the story's auto-advance while a line is revealing.
@export var hold_story := true
## Base reveal speed.
@export_range(1.0, 300.0, 1.0) var characters_per_second := 45.0
## Extra pause after punctuation, in character-times: `.` at 8 means a
## full stop lingers eight characters longer than a letter. The pause only
## applies at a clause boundary (next char is whitespace), so "3.14" and
## "loom.gd" type straight through.
@export var punctuation_pauses := {
	".": 8.0, "!": 8.0, "?": 8.0, "…": 10.0, ",": 3.0, ";": 4.0, ":": 4.0,
}

var _typing := false
var _budget := 0.0
var _plain := ""


func _ready() -> void:
	set_process(false)
	if story == null:
		story = LoomStory.find_for(self)
	if story != null and auto_play_lines:
		story.line_emitted.connect(_on_line)


func _on_line(_speaker: String, _display: String, text: String) -> void:
	play_text(text)


## Begin revealing `text` in [member target]. Restarts if already typing.
func play_text(text: String) -> void:
	if target == null:
		push_warning("LoomTypewriter: no target RichTextLabel assigned")
		return
	target.text = text
	_plain = target.get_parsed_text()
	target.visible_characters = 0
	_budget = 0.0
	_typing = true
	if hold_story and story != null:
		story.hold(self)
	set_process(true)
	started.emit(text)
	if _plain.is_empty():
		_finish()


func is_typing() -> bool:
	return _typing


## Reveal the rest of the line at once — the "player taps mid-line" path.
func skip() -> void:
	if _typing:
		_finish()


func _process(delta: float) -> void:
	if not _typing or target == null:
		return
	_budget += delta * characters_per_second
	var shown := target.visible_characters
	while shown < _plain.length():
		var cost := char_cost(_plain, shown, punctuation_pauses)
		if _budget < cost:
			break
		_budget -= cost
		shown += 1
		target.visible_characters = shown
		character_shown.emit(shown - 1, _plain[shown - 1])
	if shown >= _plain.length():
		_finish()


func _finish() -> void:
	_typing = false
	set_process(false)
	if target != null:
		target.visible_characters = -1
	if hold_story and story != null:
		story.release(self)
	finished.emit()


## Cost, in character-times, of revealing `plain[index]`. Static and pure
## so pacing is unit-testable headless.
static func char_cost(plain: String, index: int, pauses: Dictionary) -> float:
	if index <= 0 or index >= plain.length():
		return 1.0
	var prev := plain[index - 1]
	if not pauses.has(prev):
		return 1.0
	var next := plain[index]
	if next == " " or next == "\n" or next == "\t":
		return 1.0 + float(pauses[prev])
	return 1.0
