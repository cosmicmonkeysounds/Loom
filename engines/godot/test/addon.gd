## Headless tests for the addon's scene layer — the nodes above the VM.
##
## The VM itself is covered by the conformance suite (`conformance.sh`),
## which diffs it against the reference interpreter. This file covers what
## conformance cannot: the importer round-trip, [LoomStory]'s pump and
## hold gating, [LoomHook] filtering, [LoomTrigger] firing, and
## [LoomTypewriter] pacing.
##
##   godot --headless --path . --script res://test/addon.gd
extends SceneTree

const BANK_PATH := "res://test/lighthouse.loombank"

var _failures := 0
var _checks := 0


func _initialize() -> void:
	# Nodes added before the first frame never reach `_ready`; run the
	# tests once the root is live so the scene layer behaves as in a game.
	_run.call_deferred()


func _run() -> void:
	if not root.is_node_ready():
		await process_frame

	_test_bank_resource_roundtrip()
	_test_story_pump_and_holds()
	_test_hook_filters()
	_test_trigger_manual()
	_test_typewriter()
	_test_find_for()
	_test_state_queries()
	_test_styles()
	_test_dialogue_box()
	_test_save_slots()
	_test_history()

	print("addon: %d checks, %d failures" % [_checks, _failures])
	quit(1 if _failures > 0 else 0)


func _check(condition: bool, name: String) -> void:
	_checks += 1
	if not condition:
		_failures += 1
		printerr("  FAIL  %s" % name)


# --- tests ----------------------------------------------------------------


## An imported bank arrives from Godot's resource cache with `data` but no
## derived tables; `load_bank` must index it. This is the path every
## exported game takes.
func _test_bank_resource_roundtrip() -> void:
	var bank := LoomBank.from_file(BANK_PATH)
	_check(bank.load_error == "", "roundtrip: fixture loads")
	var saved := ResourceSaver.save(bank, "user://addon_roundtrip.res")
	_check(saved == OK, "roundtrip: bank saves as a resource")

	var restored: Variant = ResourceLoader.load(
		"user://addon_roundtrip.res", "", ResourceLoader.CACHE_MODE_IGNORE
	)
	_check(restored is LoomBank, "roundtrip: restores as LoomBank")

	var vm := LoomRuntime.new()
	_check(vm.load_bank(restored), "roundtrip: restored bank loads")
	vm.start_beat("opening")
	var step := vm.advance()
	_check(str(step["step"]) == LoomOps.STEP_BEAT, "roundtrip: enters the beat")
	step = vm.advance()
	_check(
		str(step["step"]) == LoomOps.STEP_LINE and str(step["text"]) != "",
		"roundtrip: plays a line from the restored bank"
	)
	vm.free()


func _make_story() -> LoomStory:
	var story := LoomStory.new()
	story.bank_path = BANK_PATH
	story.auto_advance = true
	root.add_child(story)
	return story


func _test_story_pump_and_holds() -> void:
	var story := _make_story()
	_check(story.bank != null, "story: bank loads from path at ready")

	var lines: Array = []
	var finished := [false]
	story.line_emitted.connect(func(_s: String, _d: String, text: String) -> void:
		lines.append(text))
	story.story_finished.connect(func() -> void: finished[0] = true)

	# A held story must not pump.
	var gate := RefCounted.new()
	story.hold(gate)
	story.play()
	story._process(0.016)
	_check(lines.is_empty(), "story: hold blocks the pump")

	story.release(gate)
	story._process(0.016)
	_check(lines.size() >= 3, "story: pump runs to the first choice")
	_check(story.is_waiting(), "story: pump parks on the choice")

	# Freed holders release implicitly.
	var doomed: Node = Node.new()
	story.hold(doomed)
	doomed.free()
	_check(not story.is_held(), "story: a freed holder cannot wedge the story")

	_check(story.choose(0), "story: choose resumes")
	story._process(0.016)
	story._process(0.016)
	_check(finished[0], "story: runs to the end")
	# 20 base + 10 choice + 5 from the `on lamp_lit` hook the choice fires.
	_check(
		LoomValue._num(story.get_var("Wren.trust")) == 35.0,
		"story: authored hook ran (Wren.trust == 35, got %s)" % story.get_var("Wren.trust")
	)
	_check(
		lines.any(func(t: String) -> bool: return t == "The lamp holds."),
		"story: hook beat spoke its line"
	)
	story.free()


func _test_hook_filters() -> void:
	var story := _make_story()

	var sfx_payloads: Array = []
	var sfx_hook := LoomHook.new()
	sfx_hook.kind = LoomHook.Kind.DIRECTIVE
	sfx_hook.filter = "sfx"
	sfx_hook.story = story
	root.add_child(sfx_hook)
	sfx_hook.triggered.connect(func(payload: Dictionary) -> void:
		sfx_payloads.append(payload))

	var beats: Array = []
	var beat_hook := LoomHook.new()
	beat_hook.kind = LoomHook.Kind.BEAT
	beat_hook.story = story
	root.add_child(beat_hook)
	beat_hook.triggered.connect(func(payload: Dictionary) -> void:
		beats.append(str(payload["name"])))

	var vars: Array = []
	var var_hook := LoomHook.new()
	var_hook.kind = LoomHook.Kind.VARIABLE
	var_hook.filter = "Wren.*"
	var_hook.story = story
	root.add_child(var_hook)
	var_hook.triggered.connect(func(payload: Dictionary) -> void:
		vars.append(str(payload["path"])))

	story.play()
	story._process(0.016)
	_check(sfx_payloads.is_empty(), "hook: sfx filter silent before the sfx path")
	_check(beats == ["opening"], "hook: beat hook saw the entry beat")

	# Option 2 plays `<sfx: door_close, gain: -6>` then `-> END`.
	story.choose(1)
	story._process(0.016)
	_check(sfx_payloads.size() == 1, "hook: sfx directive matched once")
	if not sfx_payloads.is_empty():
		var payload: Dictionary = sfx_payloads[0]
		_check(str(payload["verbName"]) == "sfx", "hook: verb name pre-parsed")
		_check(payload["positional"] == ["door_close"], "hook: positional args pre-parsed")
		_check(str(payload["named"].get("gain", "")) == "-6", "hook: named args pre-parsed")
	_check(vars.is_empty(), "hook: Wren.* untouched on the leave path")

	var_hook.free()
	beat_hook.free()
	sfx_hook.free()
	story.free()


func _test_trigger_manual() -> void:
	var story := _make_story()

	var fired := [false]
	var trigger := LoomTrigger.new()
	trigger.action = LoomTrigger.Action.FIRE_SIGNAL
	trigger.target_name = "lamp_lit"
	trigger.subject = "Guest01"
	trigger.story = story
	root.add_child(trigger)
	trigger.triggered.connect(func() -> void: fired[0] = true)

	var lines: Array = []
	story.line_emitted.connect(func(_s: String, display: String, text: String) -> void:
		lines.append([display, text]))

	trigger.trigger()
	_check(fired[0], "trigger: fires")
	story._process(0.016)
	_check(
		LoomValue._num(story.get_var("Wren.trust")) == 25.0,
		"trigger: `on lamp_lit` hook mutated the world"
	)
	_check(
		lines.any(func(pair: Array) -> bool:
			return pair[0] == "WREN" and pair[1] == "The lamp holds."),
		"trigger: hook beat spoke as its owner"
	)

	trigger.once = true
	trigger.trigger()
	trigger.trigger()
	story._process(0.016)
	_check(
		LoomValue._num(story.get_var("Wren.trust")) == 25.0,
		"trigger: `once` blocks re-fires"
	)
	trigger.free()
	story.free()


func _test_typewriter() -> void:
	var pauses: Dictionary = {".": 8.0}
	_check(
		LoomTypewriter.char_cost("a. b", 2, pauses) == 9.0,
		"typewriter: pauses after a full stop at a clause boundary"
	)
	_check(
		LoomTypewriter.char_cost("3.14", 2, pauses) == 1.0,
		"typewriter: no pause inside a number"
	)
	_check(
		LoomTypewriter.char_cost("a. b", 1, pauses) == 1.0,
		"typewriter: plain characters cost one"
	)

	var label := RichTextLabel.new()
	root.add_child(label)
	var typewriter := LoomTypewriter.new()
	typewriter.target = label
	root.add_child(typewriter)

	var started := [0]
	var shown: Array = []
	var finished := [0]
	typewriter.started.connect(func(_text: String) -> void: started[0] += 1)
	typewriter.character_shown.connect(func(_i: int, c: String) -> void: shown.append(c))
	typewriter.finished.connect(func() -> void: finished[0] += 1)

	typewriter.play_text("Hi there")
	_check(typewriter.is_typing(), "typewriter: typing after play_text")
	_check(label.visible_characters == 0, "typewriter: starts hidden")
	typewriter._process(0.5)  # 45 cps * 0.5s covers all 8 characters
	_check(not typewriter.is_typing(), "typewriter: completes on pacing")
	_check(label.visible_characters == -1, "typewriter: fully visible when done")
	_check("".join(shown) == "Hi there", "typewriter: every character reported")
	_check(finished[0] == 1, "typewriter: finished exactly once")

	# LoomBlip and LoomTalkAnimator consume the raw character/started/
	# finished signals — the typewriter itself knows nothing about them.
	var blip := LoomBlip.new()
	blip.stream = AudioStreamWAV.new()
	blip.polyphony = 3
	typewriter.add_child(blip)  # auto-finds its parent typewriter
	var blip_count := [0]
	blip.blipped.connect(func(_c: String) -> void: blip_count[0] += 1)

	var animator := LoomTalkAnimator.new()
	typewriter.add_child(animator)
	var talk := [0, 0]
	animator.talk_started.connect(func() -> void: talk[0] += 1)
	animator.talk_stopped.connect(func() -> void: talk[1] += 1)

	typewriter.play_text("A long enough line that a small tick cannot finish.")
	typewriter._process(0.1)
	_check(typewriter.is_typing(), "typewriter: still typing mid-line")
	_check(blip_count[0] > 0, "blip: character signals became blips")
	_check(blip._players.size() == 3, "blip: player pool built to polyphony")
	_check(animator.is_talking() and talk[0] == 1, "talk animator: talking during reveal")
	blip.stream = null
	typewriter.skip()
	_check(not animator.is_talking() and talk[1] == 1, "talk animator: idle after skip")
	animator.free()
	blip.free()
	_check(not typewriter.is_typing(), "typewriter: skip completes the line")
	_check(label.visible_characters == -1, "typewriter: skip reveals everything")
	_check(finished[0] == 2, "typewriter: skip emits finished")

	# Attached to a story, the typewriter holds the auto-advance pump so a
	# burst stops at each line until the reveal (and any reader) is done.
	var story := _make_story()
	typewriter.story = story
	typewriter.hold_story = true
	story.line_emitted.connect(typewriter._on_line)
	story.play()
	story._process(0.016)
	_check(typewriter.is_typing(), "typewriter: picks up the story line")
	_check(story.is_held(), "typewriter: holds the story while typing")
	var before := label.get_parsed_text()
	story._process(0.016)
	_check(
		label.get_parsed_text() == before,
		"typewriter: pump stays parked on the held line"
	)
	typewriter.skip()
	_check(not story.is_held(), "typewriter: releases on finish")
	story.free()
	typewriter.free()
	label.free()


func _test_state_queries() -> void:
	var story := _make_story()
	_check(story.current_beat() == "", "query: no beat before play")
	_check(
		story.bank.beat_names() == ["Wren.reassure", "lamp_room", "opening"],
		"query: bank lists playable beats"
	)

	story.play()
	story._process(0.016)  # pump to the first choice
	_check(story.current_beat() == "opening", "query: current beat")
	_check(story.current_setting() == "Lighthouse", "query: current setting")
	_check(story.is_waiting() and not story.is_finished(), "query: waiting ≠ finished")
	_check(not story.has_played("lamp_room"), "query: has_played false before the visit")

	var options := story.pending_options()
	_check(options.size() == 2, "query: pending options re-render")
	_check(
		options.size() == 2 and str(options[0]["text"]).begins_with("Climb"),
		"query: pending option text matches the menu"
	)

	# The suspended choice survives a save → file → load round trip.
	_check(story.save_to_file("user://addon_slot.json"), "query: save_to_file writes")
	var restored := _make_story()
	var result: Dictionary = restored.load_from_file("user://addon_slot.json")
	_check(bool(result.get("ok", false)), "query: load_from_file restores")
	_check(restored.is_waiting(), "query: restored story still parked on the menu")
	_check(restored.pending_options() == options, "query: restored options identical")

	restored.choose(0)
	restored._process(0.016)
	_check(restored.has_played("lamp_room"), "query: has_played after the visit")
	_check(restored.visits_of("lamp_room") == 1, "query: visit count")
	_check(restored.is_finished(), "query: finished after the story ends")
	_check(
		restored.world_snapshot().has("Wren.trust"),
		"query: world snapshot carries variables"
	)

	restored.free()
	story.free()


func _test_styles() -> void:
	var fallback: LoomStyle = load("res://addons/loom/styles/default.tres")
	_check(fallback is LoomStyle, "style: default resource loads")

	var demo_style: LoomStyle = load("res://demo/demo_style.tres")
	_check(demo_style is LoomStyle, "style: demo resource loads")
	var wren := demo_style.speaker_style("Wren")
	_check(wren != null, "style: speaker lookup is case-insensitive")
	_check(
		wren != null and wren.display_name == "Wren" and wren.color.a > 0.0,
		"style: speaker entry carries overrides"
	)
	_check(demo_style.speaker_style("DOCKHAND") == null, "style: unknown speaker is null")
	_check(LoomStyle.new().speaker_style("WREN") == null, "style: empty style is safe")


func _test_dialogue_box() -> void:
	var story := _make_story()
	var box := LoomDialogueBox.new()
	box.story = story
	box.style = load("res://demo/demo_style.tres")
	root.add_child(box)

	var lines: Array = []
	var done := [false]
	box.line_shown.connect(func(speaker: String, _text: String) -> void:
		lines.append(speaker))
	box.finished.connect(func() -> void: done[0] = true)

	box.start()
	_check(story.is_held(), "box: holds the story while active")
	_check(box.typewriter.is_typing(), "box: types the first line")
	_check(not box._speaker_label.visible, "box: narration hides the speaker")

	box.typewriter.skip()
	_check(box._waiting_input, "box: waits for input after the reveal")
	box.advance_pressed()
	_check(
		box._speaker_label.text.begins_with("Wren"),
		"box: per-speaker display name applied (got %s)" % box._speaker_label.text
	)
	_check(box._speaker_label.visible, "box: speaker shown for dialogue")

	var guard := 0
	while _visible_choices(box) == 0 and guard < 10:
		if box.typewriter.is_typing():
			box.typewriter.skip()
		box.advance_pressed()
		guard += 1
	_check(_visible_choices(box) == 2, "box: renders both options")
	_check(box._button_pool.size() == 2, "box: buttons come from the pool")

	box._button_pool[0].pressed.emit()
	_check(_visible_choices(box) == 0, "box: pooled buttons hidden after choosing")
	guard = 0
	while not done[0] and guard < 20:
		if box.typewriter.is_typing():
			box.typewriter.skip()
		box.advance_pressed()
		guard += 1
	_check(done[0], "box: plays through to finished")
	_check(lines.any(func(s: String) -> bool: return s.begins_with("Wren")),
		"box: line_shown carried the styled speaker")

	box.free()
	story.free()


func _visible_choices(box: LoomDialogueBox) -> int:
	var count := 0
	for button in box._button_pool:
		if button.visible:
			count += 1
	return count


func _test_save_slots() -> void:
	var story := _make_story()
	var slots := LoomSaveSlots.new()
	slots.story = story
	slots.directory = "user://addon_slots"
	root.add_child(slots)

	story.play()
	story._process(0.016)  # park on the choice
	_check(slots.save_slot("mid_choice"), "slots: saves a named slot")
	_check(slots.has_slot("mid_choice"), "slots: has_slot sees it")

	var listed := slots.list_slots()
	_check(not listed.is_empty(), "slots: list returns the slot")
	if not listed.is_empty():
		var meta: Dictionary = listed[0]
		_check(str(meta["beat"]) == "opening", "slots: metadata carries the beat")
		_check(bool(meta["waiting"]), "slots: metadata knows a choice was pending")

	var fresh := _make_story()
	slots.story = fresh
	var result := slots.load_slot("mid_choice")
	_check(bool(result.get("ok", false)), "slots: load restores into another story")
	_check(fresh.is_waiting(), "slots: restored story parked on the same menu")

	_check(slots.delete_slot("mid_choice"), "slots: delete removes the file")
	_check(not slots.has_slot("mid_choice"), "slots: slot gone after delete")

	fresh.free()
	slots.free()
	story.free()


func _test_history() -> void:
	var story := _make_story()
	var history := LoomHistory.new()
	history.story = story
	root.add_child(history)

	story.play()
	story._process(0.016)
	_check(history.entries.size() >= 3, "history: records lines")
	_check(
		not history.entries.is_empty() and str(history.entries[0]["beat"]) == "opening",
		"history: tags each line with its beat"
	)
	_check(history.as_bbcode().contains("[b]WREN[/b]"), "history: bbcode dump names speakers")
	history.clear()
	_check(history.entries.is_empty(), "history: clear empties the backlog")

	history.free()
	story.free()


func _test_find_for() -> void:
	var story := LoomStory.new()
	root.add_child(story)
	var child := Node.new()
	story.add_child(child)
	_check(LoomStory.find_for(child) == story, "find_for: ancestor wins")

	var sibling := Node.new()
	root.add_child(sibling)
	_check(LoomStory.find_for(sibling) == story, "find_for: group fallback")

	sibling.free()
	story.free()
	var orphan := Node.new()
	root.add_child(orphan)
	_check(LoomStory.find_for(orphan) == null, "find_for: null when no story exists")
	orphan.free()
