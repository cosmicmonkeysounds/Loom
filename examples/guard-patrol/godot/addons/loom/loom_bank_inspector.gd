@tool
## Inspector preview for [LoomBank] resources — the "Wwise Browser" of the
## Loom addon, in miniature.
##
## Click any imported `.loombank` in the FileSystem dock and the inspector
## shows what is inside: the entry beat, every playable beat (with a
## copy-name button, so a `start_beat` call or a [LoomHook] filter never
## has a typo'd name), the authored `on <verb>` hooks a [LoomTrigger] can
## fire, and any compiler diagnostics baked into the bank.
extends EditorInspectorPlugin

const MAX_ROWS := 200


func _can_handle(object: Object) -> bool:
	return object is LoomBank


func _parse_begin(object: Object) -> void:
	var bank := object as LoomBank
	if bank.load_error != "":
		add_custom_control(_label("Load error: %s" % bank.load_error))
		return
	bank.build_index()

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)

	var names: Array = bank.data.get("names", [])
	var programs: Array = bank.data.get("programs", [])
	var hooks: Array = bank.data.get("hooks", [])

	var entry := bank.entry_program()
	var entry_name := ""
	if entry >= 0 and entry < programs.size():
		entry_name = str(names[int(programs[entry].get("name", 0))])
	box.add_child(_header("Loom Bank — %s" % str(bank.data.get("bankName", ""))))
	box.add_child(_label("entry: %s" % (entry_name if entry_name != "" else "(none)")))
	box.add_child(_label("source: %s" % bank.source_hash().left(12)))

	var beats: Array = []
	for program in programs:
		var kind := str(program.get("kind", ""))
		if kind == "beat" or kind == "ownedBeat":
			beats.append(str(names[int(program.get("name", 0))]))
	beats.sort()

	box.add_child(_header("Beats (%d)" % beats.size()))
	for i in mini(beats.size(), MAX_ROWS):
		box.add_child(_name_row(beats[i]))
	if beats.size() > MAX_ROWS:
		box.add_child(_label("… %d more" % (beats.size() - MAX_ROWS)))

	if not hooks.is_empty():
		box.add_child(_header("Hooks (%d)" % hooks.size()))
		for hook in hooks:
			var verb := str(names[int(hook.get("verb", 0))])
			var owner := str(names[int(hook.get("owner", 0))])
			var timer: Variant = hook.get("timer")
			var line := (
				"every %sms (%s)" % [timer["ms"], owner] if timer != null
				else "on %s (%s)" % [verb, owner]
			)
			box.add_child(_name_row(verb, line))

	var diagnostics: Array = bank.data.get("diagnostics", [])
	if not diagnostics.is_empty():
		box.add_child(_header("Diagnostics (%d)" % diagnostics.size()))
		for diagnostic in diagnostics:
			box.add_child(_label(str(diagnostic)))

	add_custom_control(box)


func _header(text: String) -> Control:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override(
		"font_size", int(EditorInterface.get_editor_scale() * 13.0)
	)
	label.add_theme_color_override("font_color", Color(0.9, 0.87, 0.75))
	return label


func _label(text: String) -> Control:
	var label := Label.new()
	label.text = text
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return label


## A row with the name and a copy button, so beat names travel into code
## and hook filters without typos.
func _name_row(copy_text: String, display: String = "") -> Control:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = display if display != "" else copy_text
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	row.add_child(label)
	var copy := Button.new()
	copy.text = "copy"
	copy.flat = true
	copy.tooltip_text = "Copy \"%s\" to the clipboard" % copy_text
	copy.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(copy_text)
	)
	row.add_child(copy)
	return row
