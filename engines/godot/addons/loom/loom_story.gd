@icon("res://addons/loom/icons/loom_story.svg")
## The scene-first host for a Loom story — the node you drop into a level.
##
## [LoomRuntime] is the engine-agnostic VM: it never touches the scene
## tree, the clock, or your UI. [LoomStory] is the Godot-native skin over
## it, the way an AkBank/AkEvent node skins the Wwise sound engine: assign
## a bank in the inspector, tick [member autoplay], and the story starts
## with the scene. The companion nodes ([LoomTypewriter], [LoomHook],
## [LoomTrigger]) find the nearest LoomStory automatically, so a working
## scene needs no wiring code at all.
##
## Pacing stays a pull model. With [member auto_advance] off (the default)
## you call [method LoomRuntime.advance] yourself, exactly as with the raw
## runtime. With it on, the story pumps itself each frame until something
## needs a decision — but any node can [method hold] the floor (a
## typewriter mid-reveal, a cutscene camera, a voice line) and the pump
## waits until every holder has [method release]d it.
class_name LoomStory
extends LoomRuntime

## Group every LoomStory joins, so companion nodes can find one without an
## explicit reference.
const GROUP := "loom_story"

## The compiled story, as an imported `.loombank` resource. Takes
## precedence over [member bank_path].
@export var bank_resource: LoomBank = null
## Path to a `.loombank` file, for hosts that prefer paths over resources.
## In an exported game this resolves through the importer automatically.
@export_file("*.loombank") var bank_path: String = ""
## Start the story as soon as the node is ready.
@export var autoplay := false
## Beat [method play] starts at. Empty means the bank's `entry:` beat.
@export var entry_beat := ""
## Drive `on every …` / `on after …` timer hooks from the scene clock.
@export var auto_tick := true
## Pump [method LoomRuntime.advance] every frame while nothing [method
## hold]s the story and no choice is pending. Off by default — most
## dialogue UIs drive `advance()` themselves. Turn it on for systemic
## stories consumed entirely through signals and [LoomHook] nodes.
@export var auto_advance := false
## Locale tag passed to the runtime (locale banks; reserved in v1).
@export var locale := ""

var _holds := {}
var _dirty := false


## Nearest story for a companion node: the closest [LoomStory] ancestor,
## else the first member of the [constant GROUP] group.
static func find_for(node: Node) -> LoomStory:
	var walk := node.get_parent()
	while walk != null:
		if walk is LoomStory:
			return walk
		walk = walk.get_parent()
	if node.is_inside_tree():
		var first := node.get_tree().get_first_node_in_group(GROUP)
		if first is LoomStory:
			return first
	return null


func _enter_tree() -> void:
	add_to_group(GROUP)


func _ready() -> void:
	if bank == null:
		if bank_resource != null:
			load_bank(bank_resource)
		elif bank_path != "":
			load_bank_file(bank_path)
	if locale != "":
		set_locale(locale)
	if autoplay and bank != null:
		play()


## Start (or restart) the story at `beat`; empty falls back to
## [member entry_beat], then to the bank's `entry:`.
func play(beat: String = "") -> void:
	if beat == "":
		beat = entry_beat
	if beat == "":
		start_entry()
	else:
		start_beat(beat)


func start(program: int, bindings: Dictionary = {}) -> void:
	super.start(program, bindings)
	_dirty = true


func choose(index: int) -> bool:
	var ok := super.choose(index)
	if ok:
		_dirty = true
	return ok


func signal_event(verb: String, subject: String = "", filter: String = "") -> void:
	super.signal_event(verb, subject, filter)
	_dirty = true


## Block the [member auto_advance] pump while `holder` needs the floor.
## Holds stack: the story resumes only when every holder has released.
## A freed holder releases implicitly, so a dying node cannot wedge the
## story.
func hold(holder: Object) -> void:
	_holds[holder.get_instance_id()] = true


func release(holder: Object) -> void:
	_holds.erase(holder.get_instance_id())


func is_held() -> bool:
	for id in _holds.keys():
		if instance_from_id(id) == null:
			_holds.erase(id)
	return not _holds.is_empty()


func _process(delta: float) -> void:
	if bank == null:
		return
	if auto_tick:
		tick(delta * 1000.0)
		if not _program_queue.is_empty() or not _triggers.is_empty():
			_dirty = true
	if auto_advance and _dirty and not is_waiting() and not is_held():
		_pump()


## Advance until the story needs a decision, finishes, or a signal handler
## takes a hold mid-burst (a typewriter reacting to `line_emitted` does
## exactly that — signals are synchronous, so the hold lands before the
## next advance).
func _pump() -> void:
	while true:
		var step := advance()
		match str(step["step"]):
			LoomOps.STEP_CHOICE, LoomOps.STEP_IDLE:
				return
			LoomOps.STEP_DONE, LoomOps.STEP_ERROR:
				_dirty = false
				return
		if is_held():
			return


# --- save/load convenience ------------------------------------------------


## Persist the whole VM (including a suspended choice) as JSON at `path` —
## typically `user://save.loom.json`.
func save_to_file(path: String) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(save()))
	return true


## Restore a [method save_to_file] snapshot. Mirrors
## [method LoomRuntime.load_state]'s contract: a recompiled bank is
## refused unless `allow_migrate` is passed.
func load_from_file(path: String, allow_migrate: bool = false) -> Dictionary:
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		return {"ok": false, "reason": "cannotRead"}
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY:
		return {"ok": false, "reason": "badJson"}
	var result := load_state(parsed, allow_migrate)
	if bool(result.get("ok", false)):
		_dirty = true
	return result
