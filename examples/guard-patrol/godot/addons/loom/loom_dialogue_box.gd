@icon("res://addons/loom/icons/loom_dialogue_box.svg")
## A complete, styleable dialogue box — the zero-code way to play a Loom
## story.
##
## Drop it in a scene next to a [LoomStory], anchor it where the dialogue
## should live, and press play: it advances the story, types each line
## through an internal [LoomTypewriter], shows the speaker (with per-
## character colors, portraits, and voice blips from a [LoomStyle]),
## renders choices as focusable buttons, and waits on the player with the
## standard two-tap flow — first input reveals the line, second advances.
##
## Everything visual comes from [member style] (a [LoomStyle] resource),
## so reskinning the game is editing one `.tres`. The box builds its own
## control tree, which means it works under any layout or theme; hosts
## that want a fully bespoke UI can ignore this node and use
## [LoomTypewriter] + [LoomRuntime] directly — the box is a convenience,
## not a requirement.
##
## While active it [method LoomStory.hold]s the story, so a story with
## `auto_advance` on cannot fight the box for pacing.
class_name LoomDialogueBox
extends Control

## A line finished revealing and the box is waiting on the player.
signal line_shown(speaker: String, text: String)
## The player picked a choice (the runtime has already consumed it).
signal choice_made(index: int)
## The story ran out of work.
signal finished
## The runtime reported an error; the box shows `message` and stops.
signal errored(code: String, message: String)

@export var story: LoomStory = null
## The skin. Null uses [LoomStyle]'s built-in defaults.
@export var style: LoomStyle = null
## Start the story as soon as the scene is ready.
@export var auto_start := false
## Hide the box when the story finishes.
@export var close_on_finished := false

@export_group("Input")
## Action that reveals / advances (choices use normal button focus).
@export var advance_action: StringName = &"ui_accept"
## Left-click also reveals / advances.
@export var click_to_advance := true
## Advance automatically after a line has revealed ("auto mode" in VNs).
@export var auto_mode := false
## Auto-mode delay: base seconds plus per-character reading time.
@export var auto_delay := 0.8
@export var auto_delay_per_char := 0.02

## The internal typewriter — exposed for tweaks the style does not cover.
var typewriter: LoomTypewriter = null
## The internal voice-blip component ([LoomBlip]) — exposed likewise.
var blip: LoomBlip = null

var _panel: PanelContainer = null
var _margin: MarginContainer = null
var _portrait: TextureRect = null
var _speaker_label: Label = null
var _text_label: RichTextLabel = null
var _choices_box: VBoxContainer = null
var _continue_label: Label = null
var _continue_icon: TextureRect = null
var _button_pool: Array[Button] = []
var _waiting_input := false
var _auto_left := 0.0
var _blink := 0.0


func _ready() -> void:
	if story == null:
		story = LoomStory.find_for(self)
	_build_ui()
	_apply_style()
	set_process(false)
	if auto_start:
		# Deferred so every LoomStory in the scene has loaded its bank.
		start.call_deferred()


## Start (or restart) the story and play its first line. `beat` empty
## means the story's entry.
func start(beat: String = "") -> void:
	if story == null:
		push_warning("LoomDialogueBox: no LoomStory found for %s" % get_path())
		return
	story.hold(self)
	visible = true
	story.play(beat)
	_step()


## Resume presenting after the host restored a save
## ([method LoomStory.load_from_file]): shows the pending choice if one
## was suspended, else advances to the next line.
func resume() -> void:
	if story == null:
		return
	story.hold(self)
	visible = true
	if story.is_waiting():
		_show_choices(story.pending_options())
	else:
		_step()


## The advance input, exposed so touch buttons can drive the box too.
func advance_pressed() -> void:
	if typewriter != null and typewriter.is_typing():
		typewriter.skip()
	elif _waiting_input:
		_waiting_input = false
		_step()


func _unhandled_input(event: InputEvent) -> void:
	if not is_visible_in_tree() or story == null:
		return
	var clicked := false
	if click_to_advance and event is InputEventMouseButton:
		var mouse := event as InputEventMouseButton
		clicked = mouse.pressed and mouse.button_index == MOUSE_BUTTON_LEFT
	if clicked or event.is_action_pressed(advance_action):
		# Choices are answered through their buttons, not the advance key.
		if _choices_box.get_child_count() == 0:
			advance_pressed()
			get_viewport().set_input_as_handled()


# --- story flow -----------------------------------------------------------


## Advance until something needs the player — the same loop a bespoke UI
## writes by hand (see the README's code-first section).
func _step() -> void:
	_clear_choices()
	_set_waiting(false)
	while true:
		var step := story.advance()
		match str(step["step"]):
			LoomOps.STEP_LINE:
				_show_line(step)
				return
			LoomOps.STEP_CHOICE:
				_show_choices(step["options"])
				return
			LoomOps.STEP_DONE:
				finished.emit()
				if close_on_finished:
					hide()
				return
			LoomOps.STEP_ERROR:
				_text_label.text = "[i]%s: %s[/i]" % [step["code"], step["message"]]
				_speaker_label.visible = false
				errored.emit(str(step["code"]), str(step["message"]))
				return
			LoomOps.STEP_IDLE:
				if story.is_waiting():
					return
				# An exhausted menu idles once and then continues.
			_:
				pass  # beats, sets, fires, directives → signals and hooks


func _show_line(step: Dictionary) -> void:
	var display := str(step.get("display", ""))
	var speaker := style.speaker_style(display) if style != null else null

	var shown_name := display
	if speaker != null and speaker.display_name != "":
		shown_name = speaker.display_name
	var note := str(step.get("note", ""))
	if note != "":
		# A delivery note is direction, not dialogue — keep it with the
		# name, softly.
		shown_name = "%s  %s" % [shown_name, note]
	_speaker_label.text = shown_name
	_speaker_label.visible = shown_name != ""

	var name_color := style.speaker_color if style != null else Color(0.98, 0.86, 0.6)
	if speaker != null and speaker.color.a > 0.0:
		name_color = speaker.color
	_speaker_label.add_theme_color_override("font_color", name_color)

	var portrait: Texture2D = speaker.portrait if speaker != null else null
	_portrait.texture = portrait
	_portrait.visible = portrait != null

	blip.stream = (
		speaker.blip if speaker != null and speaker.blip != null
		else (style.blip if style != null else null)
	)
	typewriter.play_text(str(step["text"]))


func _on_reveal_done() -> void:
	_set_waiting(true)
	line_shown.emit(_speaker_label.text, _text_label.text)
	if auto_mode:
		_auto_left = auto_delay + auto_delay_per_char * _text_label.get_parsed_text().length()


## Choice buttons are pooled: created once, restyled and reused per menu,
## hidden between menus — no churn while a story runs.
func _show_choices(options: Array) -> void:
	_set_waiting(false)
	while _button_pool.size() < options.size():
		var button := Button.new()
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.pressed.connect(_on_choice_button.bind(button))
		_choices_box.add_child(button)
		_button_pool.append(button)
	for slot in _button_pool.size():
		var button := _button_pool[slot]
		if slot >= options.size():
			button.visible = false
			continue
		var option: Dictionary = options[slot]
		button.text = str(option["text"])
		button.set_meta("choice_index", int(option["i"]))
		if style != null:
			if style.choice_font != null:
				button.add_theme_font_override("font", style.choice_font)
			button.add_theme_font_size_override("font_size", style.choice_font_size)
			button.add_theme_color_override("font_color", style.choice_color)
		button.visible = true
	if not options.is_empty():
		_button_pool[0].grab_focus()


func _on_choice_button(button: Button) -> void:
	_choose(int(button.get_meta("choice_index")))


func _choose(index: int) -> void:
	if not story.choose(index):
		return
	choice_made.emit(index)
	_step()


func _clear_choices() -> void:
	for button in _button_pool:
		button.visible = false


func _set_waiting(waiting: bool) -> void:
	_waiting_input = waiting
	_continue_label.visible = waiting and _continue_icon.texture == null
	_continue_icon.visible = waiting and _continue_icon.texture != null
	set_process(waiting)
	_blink = 0.0


func _process(delta: float) -> void:
	if not _waiting_input:
		return
	_blink += delta
	var alpha := 0.55 + 0.45 * sin(_blink * 5.0)
	_continue_label.modulate.a = alpha
	_continue_icon.modulate.a = alpha
	if auto_mode:
		_auto_left -= delta
		if _auto_left <= 0.0:
			_waiting_input = false
			_step()


# --- construction ---------------------------------------------------------


func _build_ui() -> void:
	_panel = PanelContainer.new()
	_panel.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(_panel)

	_margin = MarginContainer.new()
	_panel.add_child(_margin)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_margin.add_child(row)

	_portrait = TextureRect.new()
	_portrait.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_portrait.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_portrait.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	_portrait.visible = false
	row.add_child(_portrait)

	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 6)
	row.add_child(column)

	_speaker_label = Label.new()
	_speaker_label.visible = false
	column.add_child(_speaker_label)

	_text_label = RichTextLabel.new()
	_text_label.bbcode_enabled = true
	_text_label.fit_content = true
	_text_label.size_flags_vertical = Control.SIZE_EXPAND_FILL
	column.add_child(_text_label)

	_choices_box = VBoxContainer.new()
	_choices_box.add_theme_constant_override("separation", 4)
	column.add_child(_choices_box)

	_continue_label = Label.new()
	_continue_label.visible = false
	_continue_label.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_continue_label.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_continue_label.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_continue_label.offset_right = -10.0
	_continue_label.offset_bottom = -6.0
	add_child(_continue_label)

	_continue_icon = TextureRect.new()
	_continue_icon.visible = false
	_continue_icon.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	_continue_icon.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	_continue_icon.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_continue_icon.offset_right = -10.0
	_continue_icon.offset_bottom = -6.0
	add_child(_continue_icon)

	typewriter = LoomTypewriter.new()
	typewriter.target = _text_label
	# The box drives the story itself; the typewriter must not auto-play
	# lines or take its own holds.
	typewriter.auto_play_lines = false
	typewriter.hold_story = false
	typewriter.story = story
	add_child(typewriter)
	typewriter.finished.connect(_on_reveal_done)

	blip = LoomBlip.new()
	blip.typewriter = typewriter
	typewriter.add_child(blip)


## Re-apply [member style] to the built controls. Called at ready; call
## again after swapping [member style] at runtime.
func _apply_style() -> void:
	var active := style if style != null else LoomStyle.new()
	_panel.add_theme_stylebox_override(
		"panel", active.panel if active.panel != null else LoomStyle.fallback_panel()
	)
	for side in ["left", "top", "right", "bottom"]:
		_margin.add_theme_constant_override("margin_%s" % side, active.padding)

	_portrait.custom_minimum_size = active.portrait_size

	if active.speaker_font != null:
		_speaker_label.add_theme_font_override("font", active.speaker_font)
	_speaker_label.add_theme_font_size_override("font_size", active.speaker_font_size)
	_speaker_label.add_theme_color_override("font_color", active.speaker_color)

	if active.font != null:
		_text_label.add_theme_font_override("normal_font", active.font)
	_text_label.add_theme_font_size_override("normal_font_size", active.font_size)
	_text_label.add_theme_color_override("default_color", active.text_color)

	_continue_label.text = active.continue_text
	_continue_label.add_theme_color_override("font_color", active.text_color)
	_continue_icon.texture = active.continue_icon

	typewriter.characters_per_second = active.characters_per_second
	typewriter.punctuation_pauses = active.punctuation_pauses
	blip.stream = active.blip
	blip.every = active.blip_every
	blip.pitch_range = active.blip_pitch_range


## Swap the skin at runtime.
func set_style(new_style: LoomStyle) -> void:
	style = new_style
	if _panel != null:
		_apply_style()
