## A minimal but complete Loom player, built from the addon's scene nodes:
## [LoomStory] hosts the bank, [LoomTypewriter] paces every line into the
## text label, and a [LoomHook] logs directives — the wiring a real game's
## dialogue UI does, with the pull model gating each step on the player.
##
## The Continue button shows the standard two-tap flow: a tap while the
## typewriter is running reveals the rest of the line; a tap after that
## advances the story.
extends Control

@onready var _story: LoomStory = %Story
@onready var _typewriter: LoomTypewriter = %Typewriter
@onready var _speaker: Label = %Speaker
@onready var _text: RichTextLabel = %Text
@onready var _continue: Button = %Continue
@onready var _choices: VBoxContainer = %Choices
@onready var _log: RichTextLabel = %Log


func _ready() -> void:
	# A LoomHook with no filter sees every directive — a real game would
	# use one hook per verb (`sfx`, `cue`, …) connected straight to the
	# audio or lighting node that reacts.
	%DirectiveHook.triggered.connect(_on_directive)
	_story.beat_entered.connect(func(beat: String, _setting: String) -> void:
		_note("→ %s" % beat))
	_story.variable_changed.connect(func(path: String, value: Variant) -> void:
		_note("%s = %s" % [path, LoomValue.display(value)]))

	if _story.bank == null:
		_show("", "Could not load %s. Build one with:\n[code]loom-bank build story.loom -o demo[/code]" % _story.bank_path)
		_continue.disabled = true
		return

	_continue.pressed.connect(_on_continue)
	_step()


func _on_continue() -> void:
	if _typewriter.is_typing():
		_typewriter.skip()
	else:
		_step()


## Advance until something needs the player: a line to read, or a choice.
func _step() -> void:
	_clear_choices()
	while true:
		var step := _story.advance()
		match str(step["step"]):
			LoomOps.STEP_LINE:
				# The typewriter is already revealing the text (it plays
				# every `line_emitted`); only the speaker line is ours.
				var speaker: String = step.get("display", "")
				var note: String = step.get("note", "")
				if note != "":
					# A delivery note is direction for a performer, not a
					# line — show it as such rather than speaking it.
					_speaker.text = "%s  %s" % [speaker, note]
				else:
					_speaker.text = speaker
				return
			LoomOps.STEP_CHOICE:
				_present(step["options"])
				return
			LoomOps.STEP_DONE:
				_show("", "[i]The end.[/i]")
				_continue.disabled = true
				return
			LoomOps.STEP_ERROR:
				_show("", "[color=tomato]%s: %s[/color]" % [step["code"], step["message"]])
				_continue.disabled = true
				return
			_:
				pass  # beats, sets, and directives are narrated via signals


func _present(options: Array) -> void:
	_continue.visible = false
	for option in options:
		var button := Button.new()
		button.text = option["text"]
		var index: int = option["i"]
		button.pressed.connect(func() -> void:
			_story.choose(index)
			_continue.visible = true
			_step()
		)
		_choices.add_child(button)


func _clear_choices() -> void:
	for child in _choices.get_children():
		child.queue_free()


func _show(speaker: String, text: String) -> void:
	_speaker.text = speaker
	_text.text = text


func _note(line: String) -> void:
	_log.text += line + "\n"


func _on_directive(payload: Dictionary) -> void:
	_note("<%s> %s %s" % [payload["verbName"], payload["positional"], payload["named"]])
